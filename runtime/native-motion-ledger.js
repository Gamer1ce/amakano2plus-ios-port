import {validateNativeArc,sampleNativeArc,restoreNativeArc} from './native-arc-sampling.js';
import {validateNativePositionMotion,sampleNativePositionMotion,nativeWorkingXYZ,nativeRoundPosition} from './native-position-motion.js';
import {restoreNativeContinuousSpline,sampleNativeContinuousSpline} from './native-continuous-spline.js';
import {restoreNativeScaleMotion,sampleNativeScaleMotion} from './native-scale-motion.js';
import {restoreNativeFadeMotion,sampleNativeFadeMotion,nativeAlphaByte} from './native-fade-motion.js';
const f=Math.fround,axes=['x','y','z'];
const fail=message=>{throw new TypeError(message)};
function uint(value,label){if(!Number.isInteger(value)||value<0||value>0xffffffff)fail(`Invalid native motion ${label}`);return value}
function exact(value,keys){return value&&Object.keys(value).sort().join()===keys.slice().sort().join()}
export function nativeAdditionalMotionAdapterMap(adapters=[]){if(!Array.isArray(adapters)||adapters.length>16)fail('Invalid additional motion adapters');const map=new Map();for(const entry of adapters){if(!exact(entry,['kind','restore','sample',...(entry?.channel===undefined?[]:['channel'])])||typeof entry.kind!=='string'||!/^[a-zA-Z][a-zA-Z0-9]{1,40}$/.test(entry.kind)||['motFade','motScale','motArc','mcArc','mcSpline','move','amove1','amove2','amove3'].includes(entry.kind)||entry.channel!==undefined&&!['position','scale'].includes(entry.channel)||typeof entry.restore!=='function'||typeof entry.sample!=='function'||map.has(entry.kind))fail('Invalid additional motion adapter');map.set(entry.kind,entry)}return map}
function cloneMotion(motion,adapters=new Map()){
 if(adapters.has(motion?.kind))return adapters.get(motion.kind).restore(motion);
 if(motion?.kind==='motFade')return restoreNativeFadeMotion(motion);
 if(motion?.kind==='motScale')return restoreNativeScaleMotion(motion);
 if(motion?.kind==='motArc'||motion?.kind==='mcArc')return restoreNativeArc(motion);
 if(motion?.kind==='mcSpline')return restoreNativeContinuousSpline(motion);
 validateNativePositionMotion(motion);return Object.freeze({...motion,delta:Object.freeze({...motion.delta})});
}
const sample=(motion,time,stop,adapters)=>adapters.has(motion.kind)?adapters.get(motion.kind).sample(motion,time,{stopRequested:stop}):motion.kind==='motFade'?sampleNativeFadeMotion(motion,time,{stopRequested:stop}):motion.kind==='motScale'?sampleNativeScaleMotion(motion,time,{stopRequested:stop}):motion.kind==='mcSpline'?sampleNativeContinuousSpline(motion,time,{stopRequested:stop}):['motArc','mcArc'].includes(motion.kind)?sampleNativeArc(motion,time,{stopRequested:stop}):sampleNativePositionMotion(motion,time,{stopRequested:stop});
function delayedSample(motion,clockElapsed,delayFrames,stopRequested,adapters){
 // MOT+4b0 delay is compared unsigned before VM reset. Waiting entries simply
 // copy their input working buffer through unchanged. Stop bypasses the delay.
 if(clockElapsed<delayFrames&&!stopRequested)return {delta:{x:0,y:0,z:0},finished:false,roundWorkingPosition:false,elapsed:0};
 const elapsed=(clockElapsed-delayFrames)>>>0;return {...sample(motion,elapsed,stopRequested,adapters),elapsed};
}
function normalizedXYZ(value){const xyz=nativeWorkingXYZ(value);for(const key of axes)if(xyz[key]!==value[key])fail('Non-normalized saved working XYZ');return xyz}
export const NATIVE_MOTION_LEDGER_SOURCE=Object.freeze({
 controllerEvaluate:'0x6d3df0',perEvaluationVMReset:'0x87cc10',anyActive:'0x6d40b0',
 bankUpdateKCS:571149,allFinishedBranchKCS:572372,clearWholeListKCS:572440,commitWorkingToBankKCS:572902,
 scope:'ordered position, motScale and motFade list with source speed1; rotation/quake still require joining',
 nativeDelaySetter:'0x6d4bb0',nativeRoundSetter:'0x6d4bd0',gameBankRoundInitialization:true,
 originalSaveAcceptance:false,nativeRasterAcceptance:false,
});

// Working XYZ is reconstructed from base on each integer Task tick. A finished
// finite entry remains in order until the ENTIRE list is inactive; committing
// or removing individual finished entries would change subsequent frames.
export class NativeMotionLedger{
 #additionalMotions;#base;#working;#baseScale;#workingScale;#scaleEnabled=false;#baseAlpha;#workingAlpha;#alphaEnabled=false;#jobs=[];#lastTick;#nextId=1;
 constructor(base={x:0,y:0,z:0},{tick=0,scale={x:1,y:1,z:1},alphaByte=255,additionalMotions=[]}={}){this.#additionalMotions=nativeAdditionalMotionAdapterMap(additionalMotions);this.#base=nativeWorkingXYZ(base);this.#working={...this.#base};this.#baseScale=nativeWorkingXYZ(scale);this.#workingScale={...this.#baseScale};this.#baseAlpha=nativeAlphaByte(alphaByte);this.#workingAlpha=this.#baseAlpha;this.#lastTick=uint(tick,'initial tick')}
 get baseAlpha(){return this.#baseAlpha}get workingAlpha(){return this.#workingAlpha}get hasAlpha(){return this.#alphaEnabled}
 get baseScale(){return {...this.#baseScale}}get workingScale(){return {...this.#workingScale}}get hasScale(){return this.#scaleEnabled}
 get base(){return {...this.#base}}get working(){return {...this.#working}}get size(){return this.#jobs.length}get tick(){return this.#lastTick}
 jobs(){return this.#jobs.map(({id,tag,delayFrames,active,stopRequested,lastStopSampled,started,rawElapsed,elapsed,motion})=>({id,tag,delayFrames,active,stopRequested,lastStopSampled,started,rawElapsed,elapsed,motion:JSON.parse(JSON.stringify(motion))}))}
 append(motion,{tag=0,delayFrames=0}={}){
  if(![0,1].includes(tag))fail('Unclosed native motion tag');uint(delayFrames,'delay');if(delayFrames>0x7fffffff)fail('Unclosed negative native delay');const stored=cloneMotion(motion,this.#additionalMotions),id=this.#nextId++;
  if(stored.kind==='motScale'||this.#additionalMotions.get(stored.kind)?.channel==='scale')this.#scaleEnabled=true;
  if(['motFade'].includes(stored.kind))this.#alphaEnabled=true;
  this.#jobs.push({id,tag,delayFrames,motion:stored,active:true,stopRequested:false,lastStopSampled:false,sampled:false,started:false,startTick:0,epochElapsed:0,rawElapsed:0,elapsed:0});return id;
 }
 active(tag){if(tag!==undefined&&![0,1].includes(tag))fail('Invalid native motion tag');return this.#jobs.filter(job=>job.active&&(tag===undefined||job.tag===tag)).map(job=>job.id)}
 requestStop({tag,id}={}){
  if(tag!==undefined&&![0,1].includes(tag))fail('Invalid stop tag');if(id!==undefined)uint(id,'stop id');
  const selected=this.#jobs.filter(job=>(tag===undefined||job.tag===tag)&&(id===undefined||job.id===id));for(const job of selected)job.stopRequested=true;return selected.map(job=>job.id);
 }
 setBase(base){if(this.#jobs.length)fail('Direct base change while native motions exist requires original setter closure');const normalized=nativeWorkingXYZ(base);this.#base=normalized;this.#working={...normalized}}
 setScaleBase(scale){if(this.#jobs.length)fail('Direct scale base change while native motions exist requires original setter closure');this.#baseScale=nativeWorkingXYZ(scale);this.#workingScale={...this.#baseScale}}
 setAlphaBase(alphaByte){if(this.#jobs.length)fail('Direct alpha base change while native motions exist requires source setter closure');this.#baseAlpha=nativeAlphaByte(alphaByte);this.#workingAlpha=this.#baseAlpha}
 update(tick){
  uint(tick,'Task tick');const step=(tick-this.#lastTick)>>>0;if(step>0x7fffffff)fail('Backward Task clock; pause/restore mapping required');
  let working={...this.#base},workingScale={...this.#baseScale},workingAlpha=this.#baseAlpha;const jobs=this.#jobs.map(job=>({...job})),finished=[];
  for(const job of jobs){
   // Native controller uses zero as the unstarted sentinel. At tick0 the
   // sentinel remains zero, and a later nonzero first evaluation sets it.
   if(!job.started&&tick!==0){job.startTick=tick;job.started=true}
   const raw=job.started?job.epochElapsed+((tick-job.startTick)>>>0):0;
   // Source speed1: uint→float32, mulss1, addss0.5, int conversion. The original
   // overflow conversion is outside this used-game candidate.
   if(raw>0x7fffffff)fail('Unclosed elapsed conversion overflow');
   const clockElapsed=Math.trunc(f(f(raw)+f(.5)));uint(clockElapsed,'elapsed frame');
   const result=delayedSample(job.motion,clockElapsed,job.delayFrames,job.stopRequested,this.#additionalMotions);
   const target=(job.motion.kind==='motScale'||this.#additionalMotions.get(job.motion.kind)?.channel==='scale')?workingScale:working;
   for(const axis of axes){target[axis]=f(target[axis]+result.delta[axis]);if(!Number.isFinite(target[axis]))fail('Native motion result overflow');if(result.roundWorkingPosition)target[axis]=nativeRoundPosition(target[axis])}
   // Native controller copies the complete working buffer into/out of each
   // MOT. Fade writes its alpha byte; position/scale preserve that byte.
   if(result.alphaByte!==undefined)workingAlpha=nativeAlphaByte(result.alphaByte);
   job.rawElapsed=raw;job.elapsed=result.elapsed;job.lastStopSampled=job.stopRequested;job.sampled=true;
   if(job.active&&result.finished){job.active=false;finished.push(job.id)}
  }
  const committed=jobs.length>0&&!jobs.some(job=>job.active);
  this.#working=working;this.#workingScale=workingScale;this.#workingAlpha=workingAlpha;this.#lastTick=tick;
  if(committed){this.#base={...working};this.#baseScale={...workingScale};this.#baseAlpha=workingAlpha;this.#jobs=[]}else this.#jobs=jobs;
  return {tick,working:{...working},base:this.base,finished,active:this.active(),committed,...(this.#scaleEnabled?{workingScale:this.workingScale,baseScale:this.baseScale}:{}),...(this.#alphaEnabled?{workingAlpha:this.workingAlpha,baseAlpha:this.baseAlpha}:{})};
 }
 snapshot(){return {version:this.#alphaEnabled?4:this.#scaleEnabled?3:2,kind:this.#alphaEnabled?'nativePositionScaleAlphaLedger':this.#scaleEnabled?'nativePositionScaleLedger':'nativeXYZLedger',base:this.base,working:this.working,...(this.#scaleEnabled||this.#alphaEnabled?{baseScale:this.baseScale,workingScale:this.workingScale}:{}),...(this.#alphaEnabled?{baseAlpha:this.baseAlpha,workingAlpha:this.workingAlpha,scaleEnabled:this.#scaleEnabled}:{}),nextId:this.#nextId,jobs:this.#jobs.map(job=>({id:job.id,tag:job.tag,delayFrames:job.delayFrames,motion:JSON.parse(JSON.stringify(job.motion)),active:job.active,stopRequested:job.stopRequested,lastStopSampled:job.lastStopSampled,...(this.#alphaEnabled||this.#additionalMotions.has(job.motion.kind)?{sampled:job.sampled}:{}),started:job.started,rawElapsed:job.rawElapsed,elapsed:job.elapsed}))}}
 static validateSnapshot(data,{additionalMotions=[]}={}){
  const adapters=nativeAdditionalMotionAdapterMap(additionalMotions);
  const alpha=data?.version===4&&data?.kind==='nativePositionScaleAlphaLedger',mixed=alpha||data?.version===3&&data?.kind==='nativePositionScaleLedger';
  if(!exact(data,['version','kind','base','working','nextId','jobs',...(mixed?['baseScale','workingScale']:[]),...(alpha?['baseAlpha','workingAlpha','scaleEnabled']:[])])||(!mixed&&(data.version!==2||data.kind!=='nativeXYZLedger'))||!Number.isSafeInteger(data.nextId)||data.nextId<1||!Array.isArray(data.jobs)||data.jobs.length>10000)fail('Invalid native motion ledger save');
  normalizedXYZ(data.base);normalizedXYZ(data.working);if(mixed){normalizedXYZ(data.baseScale);normalizedXYZ(data.workingScale)}if(alpha){nativeAlphaByte(data.baseAlpha);nativeAlphaByte(data.workingAlpha);if(typeof data.scaleEnabled!=='boolean')fail('Invalid alpha-ledger scale flag')}const ids=new Set();let lastId=0,working={...data.base},workingScale=mixed?{...data.baseScale}:{x:1,y:1,z:1},workingAlpha=alpha?data.baseAlpha:255;
  for(const job of data.jobs){
   const hasSampled=alpha||adapters.has(job.motion?.kind);
   if(!exact(job,['id','tag','delayFrames','motion','active','stopRequested','lastStopSampled','started','rawElapsed','elapsed',...(hasSampled?['sampled']:[])])||!Number.isSafeInteger(job.id)||job.id<=lastId||job.id>=data.nextId||ids.has(job.id)||![0,1].includes(job.tag)||typeof job.active!=='boolean'||typeof job.stopRequested!=='boolean'||typeof job.lastStopSampled!=='boolean'||typeof job.started!=='boolean'||hasSampled&&typeof job.sampled!=='boolean'||(job.lastStopSampled&&!job.stopRequested))fail('Invalid saved native motion entry');
   const validatedMotion=cloneMotion(job.motion,adapters);if((!mixed||alpha&&!data.scaleEnabled)&&(job.motion.kind==='motScale'||adapters.get(job.motion.kind)?.channel==='scale'))fail('Scale motion requires mixed save schema');if(!alpha&&['motFade'].includes(job.motion.kind))fail('Fade motion requires alpha save schema');uint(job.elapsed,'saved elapsed');uint(job.rawElapsed,'saved raw elapsed');uint(job.delayFrames,'saved delay');if(job.rawElapsed>0x7fffffff||job.delayFrames>0x7fffffff)fail('Invalid saved delay/elapsed conversion');if(!job.started&&job.rawElapsed!==0)fail('Unstarted saved native motion has elapsed frames');
   if(hasSampled&&!job.sampled){if(job.started||job.rawElapsed!==0||job.elapsed!==0||!job.active||job.lastStopSampled)fail('Invalid unsampled native motion state');ids.add(job.id);lastId=job.id;continue}
   // Retain the sampled stop state separately from an unevaluated stop request.
   const result=delayedSample(validatedMotion,Math.trunc(f(f(job.rawElapsed)+f(.5))),job.delayFrames,job.lastStopSampled,adapters);
   if(result.elapsed!==job.elapsed)fail('Invalid saved elapsed conversion');
   if(job.active===result.finished)fail('Saved native motion active state is inconsistent');
   const target=(job.motion.kind==='motScale'||adapters.get(job.motion.kind)?.channel==='scale')?workingScale:working;
   for(const axis of axes){target[axis]=f(target[axis]+result.delta[axis]);if(result.roundWorkingPosition)target[axis]=nativeRoundPosition(target[axis])}
   if(result.alphaByte!==undefined)workingAlpha=nativeAlphaByte(result.alphaByte);
   ids.add(job.id);lastId=job.id;
  }
  if(data.jobs.length&&!data.jobs.some(job=>job.active))fail('Finished list must have committed to base');for(const axis of axes)if(working[axis]!==data.working[axis])fail('Saved working position differs from ordered MOT samples');if(mixed)for(const axis of axes)if(workingScale[axis]!==data.workingScale[axis])fail('Saved working scale differs from ordered MOT samples');if(alpha&&workingAlpha!==data.workingAlpha)fail('Saved working alpha differs from ordered MOT samples');return data;
 }
 static restore(data,{tick,scale,alphaByte,additionalMotions=[]}={}){
  NativeMotionLedger.validateSnapshot(data,{additionalMotions});uint(tick,'restore epoch');
  const ledger=new NativeMotionLedger(data.base,{tick,scale:data.baseScale??scale,alphaByte:data.baseAlpha??alphaByte,additionalMotions});ledger.#working={...data.working};ledger.#nextId=data.nextId;if(data.version===3||data.version===4){ledger.#scaleEnabled=data.version===3||data.scaleEnabled;ledger.#workingScale={...data.workingScale}}if(data.version===4){ledger.#alphaEnabled=true;ledger.#workingAlpha=data.workingAlpha}
  ledger.#jobs=data.jobs.map(job=>({...job,sampled:job.sampled??true,motion:cloneMotion(job.motion,ledger.#additionalMotions),startTick:job.started?tick:0,epochElapsed:job.rawElapsed}));return ledger;
 }
}
