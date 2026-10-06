import {Renderer as BaseRenderer} from './renderer.js';
import {argumentsOf,numericArgument} from './expressions.js';

const OPERATIONS=new Set(['end','vol','fade','pause','replay','pos','stop','wait']);
const KNOWN_ABSENT='se_k_0225';
export const NATIVE_AUDIO_PROOF_SHA='f4566429c1021cae149b3974d9eed6ed7911f4c7608f016110553123b8e28def';

// Pure matcher for an audit or command handler. It performs no media, selector
// or cursor mutations. A present entry, even an invalid one, is never absent.
export function nativeExplicitSEAbsence(command,parts,state,assets){
  if(command!=='se'||!/^(?:\d+|#\d+)$/.test(parts[0]??''))return null;
  const operation=parts[1],name=operation==='loop'?parts[2]:operation;
  if(!operation||OPERATIONS.has(operation)||name?.toLowerCase()!==KNOWN_ABSENT||Object.hasOwn(assets,KNOWN_ABSENT))return null;
  const bank=numericArgument(parts[0],state);
  if(!Number.isInteger(bank)||bank<0||bank>9)throw new Error('Native explicit SE absence bank outside proven range0..9');
  return {name:KNOWN_ABSENT,channel:`se${bank}`,explicitBank:bank};
}

// Isolated candidate: the real used command has an explicit bank. Never infer
// the original shared SE/PCM cursor from R5's first-free bank selection.
export class Renderer extends BaseRenderer {
  constructor(options){
    super(options);this.compatibilityDiagnostics=[];
    this.nativeExplicitSEAbsenceCompatibility=options.nativeExplicitSEAbsenceCompatibility===undefined?false:options.nativeExplicitSEAbsenceCompatibility;
    if(typeof this.nativeExplicitSEAbsenceCompatibility!=='boolean')throw new Error('Invalid native explicit SE compatibility opt-in');
  }
  waitSound(audio){
    if(!audio||audio.ended||audio.paused)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const clean=()=>{for(const event of ['ended','pause','emptied','error'])audio.removeEventListener(event,listeners[event])};
      const finish=()=>{clean();resolve()};
      // load() can cancel a queued pause event. The real emptied event ends
      // waiting for the previous resource without synthesizing media events.
      const listeners={ended:finish,pause:finish,emptied:finish,error:()=>{clean();reject(new Error('Sound playback failed while waiting'))}};
      for(const [event,listener] of Object.entries(listeners))audio.addEventListener(event,listener,{once:true});
    });
  }
  async command(cmd,args,state,...rest){
    if(!this.nativeExplicitSEAbsenceCompatibility||cmd!=='se')return super.command(cmd,args,state,...rest);
    const parts=argumentsOf(args),absence=nativeExplicitSEAbsence(cmd,parts,state,this.assets);
    if(!absence)return super.command(cmd,args,state,...rest);
    const p=parts.slice(2),loop=parts[1]==='loop',channel=this.soundBank('se',parts[0],state);
    const pan=this.numeric(p[loop?1:0]??0,state),delay=p[loop?2:1];
    if(pan)this.warn('se 立体声声像尚未还原');
    if(delay!==undefined)await new Promise(resolve=>setTimeout(resolve,this.frames(delay,state)));
    this.stopSound(channel);
    const diagnostic={code:'verified-original-null-audio-load',name:absence.name,channel,explicitBank:absence.explicitBank,
      outcome:'selected-bank-cleared-no-new-audio',evidenceSHA256:NATIVE_AUDIO_PROOF_SHA,
      scope:'single-known-absent-SE-explicit-bank',originalDebugDialogNotReproduced:true};
    this.compatibilityDiagnostics.push(diagnostic);
    this.warn(`原代码已验证声音加载失败返回：${absence.name} (${channel})`);
    return diagnostic;
  }
}
