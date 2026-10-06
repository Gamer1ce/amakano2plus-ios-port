// Source: original cs2.exe 51bac0/51bb40; unsigned64 helper 6e6cb0.
// Exact normal scheduler arithmetic, with an explicit browser millisecond epoch.
export const NATIVE_TRANSITION_CLOCK_SOURCE=Object.freeze({sourceReportSHA256:'8a43993511a709de6a68609b694243d3c893755ae06fce24b0fff2d0976a750b',sourceFPS:60,browserEpochPolicy:'explicit monotonic millisecond source; Windows uptime phase is not reproduced',pauseLifecycleAccepted:false});
const require=(condition,message)=>{if(!condition)throw new Error(message)};
function milliseconds(value){require(Number.isFinite(value)&&value>=0&&value<=0xffffffff,'Clock outside original unsigned32 millisecond interval');return Math.floor(value)}
export function nativeFramePeriodQ32(fps){require(Number.isSafeInteger(fps)&&fps>0&&fps<=1000,'Invalid original frame rate');return (1000n<<32n)/BigInt(fps)}
export function nativeFrameBucket(nowMilliseconds,fps){return (BigInt(milliseconds(nowMilliseconds))<<32n)/nativeFramePeriodQ32(fps)}
export class NativeTransitionFrameClock{
 constructor({fps,millisecondSource}){require(typeof millisecondSource==='function','Explicit clock source required');this.fps=fps;this.periodQ32=nativeFramePeriodQ32(fps);this.millisecondSource=millisecondSource;this.lastMilliseconds=milliseconds(millisecondSource());this.bucket=nativeFrameBucket(this.lastMilliseconds,fps);this.tick=0;this.samples=[]}
 update(nowMilliseconds=this.millisecondSource(),{skipUpdate=false}={}){
  const ms=milliseconds(nowMilliseconds),bucket=nativeFrameBucket(ms,this.fps);require(ms>=this.lastMilliseconds&&bucket>=this.bucket,'Clock moved backward or wrapped; lifecycle mapping required');
  if(bucket===this.bucket)return {tick:this.tick,advanced:false,milliseconds:ms,bucket:String(bucket)};
  const difference=Number(BigInt.asUintN(32,bucket-this.bucket));
  const delta=skipUpdate?0:Math.floor((Math.imul(difference,60)>>>0)/this.fps);
  this.tick=(this.tick+delta)>>>0;this.bucket=bucket;this.lastMilliseconds=ms;
  const sample={tick:this.tick,delta,advanced:true,milliseconds:ms,bucket:String(bucket),skipUpdate:!!skipUpdate};this.samples.push(sample);if(this.samples.length>256)this.samples.shift();return sample;
 }
 currentTick(){return this.update().tick}
}
// Exact arithmetic of original Task fields58/5c/60/64/68 (51c790).
// While paused the raw getter may DECREASE; caller must suppress painting.
export class NativeTransitionTaskClock{
 constructor(globalTick){this.pauseOffset=0;this.paused=false;this.lastTick=0;this.oneStep=false;this.tickField=0;this.update(globalTick)}
 update(globalTick){require(Number.isSafeInteger(globalTick)&&globalTick>=0&&globalTick<=0xffffffff,'Invalid propagated Task tick');const delta=(globalTick-this.lastTick)>>>0;
  if(this.paused){this.pauseOffset=(this.pauseOffset+delta)>>>0;this.oneStep=false}
  else{if(this.oneStep){this.pauseOffset=(this.pauseOffset+delta-1)>>>0;this.oneStep=false}this.tickField=globalTick}
  this.lastTick=globalTick;return this.currentTick();
 }
 currentTick(){return (this.tickField-this.pauseOffset)>>>0}
 setPaused(value){this.paused=!!value}
 singleStep(){this.oneStep=true}
}
