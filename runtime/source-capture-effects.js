import {argumentsOf,numericArgument} from './expressions.js';
import {planSourceCaptureEffects} from './source-capture-effect-lookahead.js';
import {freezeNativePumpFront,composeNativeFrozenRange,nativeCapturePaintPriority} from './native-transition-renderer.js';
import {NativeTransitionTaskClock} from './native-transition-clock.js';
import {createSourceRpflipMesh,sampleSourceRpflipMesh} from './source-rpflip-kernel.js';
import {createSourceRpflipPainter} from './source-rpflip-painter.js';
import {createRfmosSequence,sampleRfmosSequence} from './source-rfmos-kernel.js';

const require=(ok,message)=>{if(!ok)throw new Error('Source capture effect: '+message)};
export function sourceCaptureEffectSpec(command,args,state){
 require(['rpflip','rfmos'].includes(command)&&Array.isArray(args),'known command and arguments required');
 const values=args.map(token=>numericArgument(token,state));require(values.every(Number.isFinite),'finite arguments required');
 const expected=command==='rpflip'?[60,290,256,180]:[100,60,1];
 require(values.length===expected.length&&values.every((x,i)=>x===expected[i]),'only source-used arguments are supported');
 return Object.freeze({kind:command,suppliedTicks:values[0],internalTicks:values[0]-2,captureRange:Object.freeze({from:command==='rfmos'?1:0,to:45000}),sourceTaskType:command==='rpflip'?57:51,values:Object.freeze(values)});
}
const createCanvas=(w,h)=>{const value=document.createElement('canvas');value.width=w;value.height=h;return value};
export function withSourceCaptureEffects(Parent){return class SourceCaptureEffects extends Parent{
 constructor(options){super(options);this.sourceCaptureEffects=options.sourceCaptureEffects===true;this.sourceCaptureEffectClock=options.sourceCaptureEffectClock??this.nativeTransitionClock;this.sourceCaptureEffect=null;this.sourceCaptureEffectEvents=[];this.sourceCaptureGeneration=0;if(this.sourceCaptureEffects){require(typeof this.sourceCaptureEffectClock?.currentTick==='function'&&this.sourceCaptureEffectClock.fps===60,'shared 60-unit source clock required');require(typeof this.discardNativePreparation==='function','native capture parent required')}}
 async prepareNativePump(vm,...rest){
  if(!this.sourceCaptureEffects)return super.prepareNativePump(vm,...rest);
  const generation=++this.sourceCaptureGeneration;
  if(this.sourceCaptureEffect)await this.sourceCaptureEffect.finished;
  if(this.nativeEffect)await this.nativeEffect.finished;
  require(generation===this.sourceCaptureGeneration,'superseded pump');this.discardNativePreparation();
  const front=freezeNativePumpFront(this),captureAbort=new AbortController();this.nativeCaptureAbort=captureAbort;
  try{
   const plan=await planSourceCaptureEffects(vm);require(generation===this.sourceCaptureGeneration,'superseded pump');
   if(plan.status==='capture'){
    const bitmap=await composeNativeFrozenRange(front,plan.target.range,{signal:captureAbort.signal});let hold;
    try{
     require(generation===this.sourceCaptureGeneration&&!captureAbort.signal.aborted&&this.nativeCaptureAbort===captureAbort,'superseded pump');
     hold=createCanvas(bitmap.canvas.width,bitmap.canvas.height);const ctx=hold.getContext('2d');require(ctx,'OLD capture canvas unavailable');hold.dataset.nativeTransition='prepared-old';hold.style.cssText=`position:absolute;left:0;top:0;width:1600px;height:900px;pointer-events:none;z-index:${nativeCapturePaintPriority(bitmap,plan.target.range.to)}`;ctx.drawImage(bitmap.canvas,0,0);const stage=document.getElementById('layers');require(stage,'stage unavailable');stage.append(hold);
     this.nativePrepared={plan,bitmap,hold};for(const layer of this.layers.values())if(layer.element)this.place(layer);
    }catch(error){hold?.remove();if(hold)hold.width=hold.height=0;bitmap.canvas.width=bitmap.canvas.height=0;throw error}
    this.sourceCaptureEffectEvents.push({type:'prepared',kind:plan.target.kind,location:{scene:plan.target.scene,index:plan.target.index},captureRange:plan.target.range,capturedBeforeLookahead:true});
   }
   return plan;
  }finally{front.release();if(this.nativeCaptureAbort===captureAbort)this.nativeCaptureAbort=null;}
 }
 stopSourceCaptureEffect(error){
  const job=this.sourceCaptureEffect;if(!job)return;this.sourceCaptureEffect=null;cancelAnimationFrame(job.request);job.painter?.dispose();job.overlay.remove();job.overlay.width=job.overlay.height=0;job.old.width=job.old.height=0;if(job.textureCanvas)job.textureCanvas.width=job.textureCanvas.height=0;job.previousPixels=null;job.sequence=null;job.mesh=null;
  if(error)job.reject(error);else job.resolve();
 }
 setNativeTransitionPaused(value,...rest){
  const result=super.setNativeTransitionPaused(value,...rest),job=this.sourceCaptureEffect;
  if(job){job.taskClock.update(this.sourceCaptureEffectClock.currentTick());job.taskClock.setPaused(value);if(!value)job.taskClock.update(this.sourceCaptureEffectClock.currentTick())}return result;
 }
 paintSourceCaptureEffect(elapsed){
  const job=this.sourceCaptureEffect;require(job,'active effect required');require(Number.isSafeInteger(elapsed)&&elapsed>=0,'integer elapsed required');
  if(job.mesh){const frame=sampleSourceRpflipMesh(job.mesh,elapsed);job.painter.paint(frame);return frame}
  const frame=sampleRfmosSequence(job.sequence,elapsed,{destinationPixels:job.previousPixels,firstUpdate:job.firstUpdate,previousRecordTick:job.previousRecordTick});job.firstUpdate=false;
  if(frame.textureUpdated){job.previousPixels=frame.pixels;job.previousRecordTick=frame.recordTick;}
  const ctx=job.overlay.getContext('2d');ctx.clearRect(0,0,job.overlay.width,job.overlay.height);
  if(frame.vertexAlpha>0&&job.previousPixels){job.textureContext.putImageData(new ImageData(new Uint8ClampedArray(job.previousPixels),job.old.width,job.old.height),0,0);ctx.globalAlpha=frame.vertexAlpha/255;ctx.drawImage(job.textureCanvas,0,0);ctx.globalAlpha=1}
  return frame;
 }
 async startSourceCaptureEffect(command,args,state,location){
  require(!this.sourceCaptureEffect&&!this.nativeEffect,'previous effect still active');const spec=sourceCaptureEffectSpec(command,argumentsOf(args),state),prepared=this.nativePrepared,target=prepared?.plan.target;
  require(target&&target.kind===command&&target.scene===location?.scene&&target.index===location?.index,'matching OLD capture required');require(target.range.from===spec.captureRange.from&&target.range.to===spec.captureRange.to,'capture range mismatch');
  const old=prepared.bitmap.canvas;let overlay,painter,mesh,sequence,textureCanvas,textureContext;
  try{
   overlay=createCanvas(old.width,old.height);overlay.dataset.nativeTransition=command;overlay.style.cssText=prepared.hold.style.cssText;const stage=document.getElementById('layers');require(stage,'stage unavailable');
   if(command==='rpflip'){mesh=createSourceRpflipMesh({width:old.width,height:old.height});painter=createSourceRpflipPainter(overlay,old,mesh)}
   else{const ctx=old.getContext('2d',{willReadFrequently:true});require(ctx,'captured OLD pixels unavailable');const rgba=ctx.getImageData(0,0,old.width,old.height).data;sequence=createRfmosSequence({pixels:new Uint8Array(rgba),width:old.width,height:old.height,duration:98,blocks:60});require(overlay.getContext('2d'),'rfmos overlay unavailable');textureCanvas=createCanvas(old.width,old.height);textureContext=textureCanvas.getContext('2d');require(textureContext,'rfmos texture unavailable')}
   stage.append(overlay);
  }catch(error){painter?.dispose();overlay?.remove();if(overlay)overlay.width=overlay.height=0;if(textureCanvas)textureCanvas.width=textureCanvas.height=0;throw error}
  const startedTick=this.sourceCaptureEffectClock.currentTick();let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no});finished.catch(()=>{});
  const job={spec,old,overlay,painter,mesh,sequence,textureCanvas,textureContext,firstUpdate:true,previousPixels:undefined,previousRecordTick:undefined,startedTick,taskClock:new NativeTransitionTaskClock(startedTick),request:0,resolve,reject,finished};
  job.taskClock.setPaused(this.nativePaused);this.sourceCaptureEffect=job;this.nativePrepared=null;prepared.hold.remove();prepared.hold.width=prepared.hold.height=0;this.restoreNativeHiddenLayers();this.animations.add(finished);finished.then(()=>this.animations.delete(finished),()=>this.animations.delete(finished));
  try{this.paintSourceCaptureEffect(0)}catch(error){this.stopSourceCaptureEffect(error);throw error}
  this.sourceCaptureEffectEvents.push({type:'started',kind:command,location,spec,sourceClockShared:true,preparationTimingPolicy:'two source preparation phases represented by two shared 60-unit ticks',windowsGPUExact:false,canvasAlphaPolicy:'Canvas straight RGBA; source first equal-size memcpy initializes prior texture; no opaque/black substitution'});
  const tick=()=>{
   if(this.sourceCaptureEffect!==job)return;
   try{job.taskClock.update(this.sourceCaptureEffectClock.currentTick());if(!job.taskClock.paused){const since=(job.taskClock.currentTick()-startedTick)>>>0;if(since>=2){const elapsed=Math.min(spec.internalTicks,since-2);this.paintSourceCaptureEffect(elapsed);if(elapsed>=spec.internalTicks){this.stopSourceCaptureEffect();return}}}job.request=requestAnimationFrame(tick)}catch(error){this.stopSourceCaptureEffect(error)}
  };job.request=requestAnimationFrame(tick);
 }
 async command(command,args,state,location,...rest){if(this.sourceCaptureEffects&&(command==='rpflip'||command==='rfmos'))return this.startSourceCaptureEffect(command,args,state,location);return super.command(command,args,state,location,...rest)}
 snapshot(...rest){if(this.sourceCaptureEffects)require(!this.sourceCaptureEffect&&!['rpflip','rfmos'].includes(this.nativePrepared?.plan?.target?.kind),'port save requires completed capture effect');return super.snapshot(...rest)}
 async restore(saved,...rest){if(this.sourceCaptureEffects){this.validateSave(saved,...rest);this.sourceCaptureGeneration++;this.stopSourceCaptureEffect();this.discardNativePreparation()}return super.restore(saved,...rest)}
 reset(...rest){this.sourceCaptureGeneration=(this.sourceCaptureGeneration??0)+1;this.stopSourceCaptureEffect();return super.reset(...rest)}
 }}
