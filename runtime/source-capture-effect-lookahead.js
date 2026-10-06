import {expression,expand,splitIf,argumentsOf,numericArgument} from './expressions.js';
import {sourceCorrection} from './compatibility.js';
import {isCatalogSceneAbsent,KNOWN_NATIVE_CALL_ABSENT_TARGETS} from './scene-loader.js';

export const NATIVE_CAPTURE_PROVENANCE=Object.freeze({
  report:'native-transition-source-review.json',sha256:'d7b038d05007c7d878a9035e1872e62da01815aba658c8965c41f46051ea5812',
  pump:76786,lookahead:78167,preprocessor:551735,captureNative:568,
});
const BARRIERS=new Set(['next','wait','select','title','eyecatch','movie','ptsel','end','staffroll','fes','select2']);
const OTHER_CAPTURES=new Set(['rwmos','rfmos','wbreak','rpflip','rcflip']);
// This reports the original preprocessor's treatment of FEX/fselect, not the
// modern UI's acceptance status. No helper/global/renderer side effects run.
export async function planSourceCaptureEffects(vm,{maxReads=20000}={}) {
  if(!Number.isSafeInteger(maxReads)||maxReads<1)throw new Error('Invalid capture lookahead budget');
  const state=structuredClone(vm.state),frozenVariables=structuredClone({numbers:state.numbers,strings:state.strings});
  const stack=structuredClone(state.stack),trace=[],sceneCache=new Map(vm.cache??[]);
  let reads=0;
  const result=(status,details={})=>({version:1,status,...details,reads,trace,
    captureBeforeMutations:status==='capture',globalsChanged:false,originalCursorChanged:false,
    semanticScope:'KCS source lookahead; actual bitmap capture and native UI pump scheduling unverified'});
  const seen=new Set();
  async function scene(id) {
    if(!sceneCache.has(id))sceneCache.set(id,await vm.loadScene(id));
    const value=sceneCache.get(id);if(!Array.isArray(value?.lines))throw new Error(`Invalid lookahead scene ${id}`);
    return value;
  }
  async function inspect(source,location,depth=0) {
    if(depth>64)throw new Error('Native lookahead nested if depth exceeded');
    let line=source.trim();if(!line)return null;
    const correction=depth===0?sourceCorrection(line,location):null;if(correction)line=correction.replacement;
    if(/^if\s*\(/.test(line)) {
      const [condition,body]=splitIf(line);
      if(!body)throw new Error('Unsupported CST block if in native capture lookahead');
      const truth=!!expression(condition,frozenVariables);
      trace.push({kind:'if',...location,condition,truth});
      return truth?inspect(body,location,depth+1):null;
    }
    const match=/^(\S+)(?:\s+(.*))?$/.exec(line),command=match[1],raw=match[2]??'';
    if(command==='rdraw'||command==='rwipe') {
      const args=argumentsOf(expand(raw,frozenVariables));
      const offset=command==='rwipe'?1:0;
      const from=args[offset+1]===undefined?0:Math.trunc(numericArgument(args[offset+1],frozenVariables));
      const to=args[offset+2]===undefined?45000:Math.trunc(numericArgument(args[offset+2],frozenVariables));
      if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to))throw new Error('Invalid native capture range');
      return result('capture',{target:{kind:command,scene:location.scene,index:location.index,
        source:line,mask:command==='rwipe'?args[0]??null:null,range:{from,to}},
        preparationPhase:'original-pump-start-lookahead',
        durationGateEvaluated:false,
        note:'Original pre-capture does not inspect transition duration. Actual command parses duration after real commands run.'});
    }
    if(command==='rpflip'||command==='rfmos') {
      const args=argumentsOf(expand(raw,frozenVariables));
      // Actual551735 differs from task configuration: rpflip tokens6/7,
      // rfmos tokens4/5. In the sole rfmos use, mode1 is also capture-from1.
      const offset=command==='rpflip'?4:2;
      const from=args[offset]===undefined?0:Math.trunc(numericArgument(args[offset],frozenVariables));
      const to=args[offset+1]===undefined?45000:Math.trunc(numericArgument(args[offset+1],frozenVariables));
      if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>to)throw new Error('Invalid source effect capture range');
      return result('capture',{target:{kind:command,scene:location.scene,index:location.index,source:line,range:{from,to}},preparationPhase:'original-pump-start-lookahead',durationGateEvaluated:false});
    }
    if(OTHER_CAPTURES.has(command))return result('unresolved-source-capture',{command,location});
    if(BARRIERS.has(command))return result('barrier',{command,location});
    if(command==='end_of_kaisou'&&state.executionMode==='replay')return result('barrier',{command,location});
    if(command==='call') {
      const target=expand(raw,frozenVariables).replace(/\.cst$/i,'').toLowerCase();
      if(!/^[\w-]+$/.test(target))throw new Error(`Invalid native lookahead call ${target}`);
      if(stack.length>=65)throw new Error('Native lookahead call depth exceeded');
      try{await scene(target)}catch(error){
        if(vm.nativeCallAbsenceCompatibility&&KNOWN_NATIVE_CALL_ABSENT_TARGETS.includes(target)&&isCatalogSceneAbsent(error,target,vm.loadScene)) {
          trace.push({kind:'native-call-load-failed',...location,target,action:'continue-caller'});return null;
        }
        throw error;
      }
      trace.push({kind:'call',...location,target});stack.push({id:target,index:0});return null;
    }
    if(command==='return') {trace.push({kind:'return',...location});stack.pop();return null;}
    // Portable FESds represents a native FES dispatch. Its helper execution is
    // a known pump boundary; native GUI FES ordering is still not accepted.
    if(command==='fesds')return result('portable-fes-boundary',{command,location,sourceMappingAccepted:false});
    // Native fselect91/FEX82 and ordinary assignments/str/strcmp/effects fall
    // through without executing, exactly as native preprocessor551735 does.
    return null;
  }
  while(reads<maxReads) {
    const key=JSON.stringify(stack);if(seen.has(key))return result('cycle',{stack:structuredClone(stack)});seen.add(key);
    const frame=stack.at(-1);if(!frame)return result('eof',{stackEmpty:true});
    const value=await scene(frame.id),index=frame.index++,line=value.lines[index];reads++;
    // Original EOF stops the ahead-scan; do not auto-return like ScriptVM.advance.
    if(!line)return result('eof',{scene:frame.id,index});
    const originalType=line.type>>>8;
    if(originalType===2||originalType===3)return result('text-boundary',{scene:frame.id,index,originalType});
    if(originalType!==48)continue;
    const stop=await inspect(line.text,{scene:frame.id,index});if(stop)return stop;
  }
  return result('budget',{maxReads});
}

// Explicit preparation lifecycle. The app must call prepare at each original
// pump boundary before any real command adapter, then supply a real canvas/GL
// snapshot. This class never captures at the rdraw/rwipe command itself.
export class NativeCapturePreparation {
  constructor({capture}) {if(typeof capture!=='function')throw new Error('Missing native bitmap capture callback');this.capture=capture;this.pending=null;this.sequence=0;}
  async prepare(vm,options) {
    if(this.pending)throw new Error('Previous native capture has not been consumed/discarded');
    const plan=await planNativeCapture(vm,options);
    if(plan.status!=='capture')return plan;
    const bitmap=await this.capture(plan.target.range,plan);
    if(bitmap===undefined||bitmap===null)throw new Error('Native capture callback returned no real bitmap');
    this.pending={sequence:++this.sequence,plan,bitmap};return plan;
  }
  take(command,location) {
    const pending=this.pending;if(!pending)throw new Error('Native transition has no bitmap prepared before scene mutations');
    const target=pending.plan.target;
    if(target.kind!==command||target.scene!==location?.scene||target.index!==location?.index)throw new Error('Native transition differs from frozen-variable lookahead; integration has not accepted this case');
    this.pending=null;return pending;
  }
  discard(){this.pending=null;}
}
