import {parseSourceAnm,sourceAnmFrameAtTick} from './source-anm-timeline.js';
import {SOURCE_IMAGE_ANM_DATA} from './source-image-anm-data.js';
import {SourceBitmapFrameCache} from './source-bitmap-frame-cache.js';
import {restoreTransactionFromOptions} from './restore-transaction.js';
import {registerRestoreRoot,assertRootDescendant,withSharedSourceSnapshot,awaitSourceRestore} from './source-performance-restore-coordinator.js';
const require=(ok,message)=>{if(!ok)throw new Error('Source bitmap ANM: '+message)};
const FRAME_KEYS=['id','width','height','totalWidth','totalHeight','x','y','baseX','baseY','file','transparent','cptype'];
const source=new Map(SOURCE_IMAGE_ANM_DATA.map(entry=>[entry.name,entry]));
const tick=value=>{require(Number.isSafeInteger(value)&&value>=0&&value<=0x7fffffff,'unsupported integer clock/wrap');return value};
const releasePrepared=prepared=>{if(!prepared)return;prepared.unregisterRestoreResource?.();prepared.cache.dispose();prepared.element.width=prepared.element.height=0};
const cancelPending=pending=>{if(!pending)return;releasePrepared(pending.prepared);pending.element?.removeAttribute?.('src')};
function neighbours(plan,elapsed){
 const phase=plan.loop?elapsed%plan.totalTicks:Math.min(elapsed,plan.totalTicks-1);
 const index=plan.frames.findLastIndex(frame=>frame.startTick<=phase),ids=[];
 for(let offset=0;offset<3;offset++){
  const next=index+offset;if(!plan.loop&&next>=plan.frames.length)break;
  const id=plan.frames[next%plan.frames.length].frameId;if(!ids.includes(id))ids.push(id);
 }
 return ids;
}
function paint(prepared,bitmap,id){
 const frame=prepared.frames.get(id),element=prepared.element;
 // The current Canvas surface remains independent of evicted ImageBitmaps.
 // Canvas vs Image pixels and physical browser memory require native checks.
 if(element.width!==frame.width)element.width=frame.width;
 if(element.height!==frame.height)element.height=frame.height;
 const context=element.getContext('2d');require(context,'Canvas2D unavailable');
 context.clearRect(0,0,element.width,element.height);context.drawImage(bitmap,0,0);
}
export function withSourceBitmapImageAnimations(BaseRenderer){
 return class SourceBitmapImageAnimationRenderer extends BaseRenderer{
  constructor(options,...rest){
   const enabled=options?.sourceImageAnimations??false;require(typeof enabled==='boolean','explicit boolean opt-in');
   if(enabled)require(options?.sourceImageClock===options?.nativeTransitionClock&&options.sourceImageClock?.fps===60&&typeof options.sourceImageClock.currentTick==='function','same explicit normal60 clock');
   if(enabled&&options?.sourceCharacterPerformance)require(options.sourceImageClock===options.sourcePerformanceClock,'same character/bitmap save clock');
   super(options,...rest);this.sourceImageAnimations=enabled;this.sourceImageClock=options?.sourceImageClock;
   this.sourceImageDecoder=options?.sourceImageBitmapDecoder;
   this.sourceImageJobs=new Map();this.sourceImagePending=new Map();this.sourceImageEvents=[];
   this.sourceImageFailure=null;this.sourceImageFrame=null;this.sourceImageUpdating=null;this.sourceImageResetGeneration=0;
   this.sourceImageRestorePlans=null;this.sourceImageRestorePending=null;
   this.sourceImageRequestFrame=options?.sourceImageRequestFrame??(callback=>requestAnimationFrame(callback));
   this.sourceImageCancelFrame=options?.sourceImageCancelFrame??(handle=>cancelAnimationFrame(handle));
   require(typeof this.sourceImageRequestFrame==='function'&&typeof this.sourceImageCancelFrame==='function','frame scheduler');
  }
  sourceImageEvent(event){this.sourceImageEvents.push(Object.freeze(event));if(this.sourceImageEvents.length>256)this.sourceImageEvents.shift()}
  cancelSourceImageRestoreForNormalOperation(options){
   if(options?.restoreTransaction!==undefined)return;
   const owner=this.sourceImageRestorePending;if(!owner)return;
   owner.cancel();if(this.sourceImageRestorePending===owner)this.sourceImageRestorePending=null;if(this.sourceImageRestorePlans===owner.plans)this.sourceImageRestorePlans=null;
  }
  async character(layer,values,...rest){
   this.cancelSourceImageRestoreForNormalOperation(rest[0]);
   return super.character(layer,values,...rest);
  }
  assertSourceImageAnimationsHealthy(){if(this.sourceImageFailure)throw this.sourceImageFailure}
  sourceImagePlan(name){
   const entry=source.get(name);require(entry,'unbound source timeline');
   const asset=Object.hasOwn(this.assets,name)?this.assets[name]:undefined;
   require(asset?.kind==='image'&&Array.isArray(asset.frames),'present source image catalog');
   const frames=new Map();
   for(const expected of entry.frames){const matches=asset.frames.filter(frame=>frame?.id===expected.id);require(matches.length===1&&FRAME_KEYS.every(key=>Object.is(matches[0][key],expected[key])),'source frame metadata '+name+':'+expected.id);frames.set(expected.id,Object.freeze({...expected}))}
   const raw=Uint8Array.from(entry.rawHex.match(/../g),value=>parseInt(value,16));
   return {name,frames,plan:parseSourceAnm(raw,new Set(frames.keys()))};
  }
  async prepareSourceImage(name,elapsedTicks=0,pending=null,transaction=null){
   transaction?.assertActive();tick(elapsedTicks);const prepared=this.sourceImagePlan(name);prepared.element=document.createElement('canvas');prepared.element.style.position='absolute';
   prepared.cache=new SourceBitmapFrameCache(prepared.frames,{url:file=>this.url(file),...(this.sourceImageDecoder?{decode:this.sourceImageDecoder}:{})});
   if(transaction)prepared.unregisterRestoreResource=transaction.registerResource(()=>releasePrepared(prepared));
   if(pending)pending.prepared=prepared;
   try{
    const id=sourceAnmFrameAtTick(prepared.plan,elapsedTicks),lease=await prepared.cache.acquire(id);
    try{paint(prepared,lease.bitmap,id)}finally{lease.release()}
    await Promise.all(neighbours(prepared.plan,elapsedTicks).map(next=>prepared.cache.prefetch(next)));
    transaction?.assertActive();prepared.frameId=id;return prepared;
   }catch(error){releasePrepared(prepared);throw error}
  }
  commitSourceImage(layer,prepared,elapsedTicks=0){
   const now=tick(this.sourceImageClock.currentTick()),id=sourceAnmFrameAtTick(prepared.plan,elapsedTicks),initial=prepared.frames.get(0);
   require(initial&&prepared.frameId===id&&!prepared.cache.diagnostics().disposed,'prepared painted source image');
   // Detach this pending resource before clear() disposes the old live bank.
   const pending=this.sourceImagePending.get(layer);if(pending?.prepared===prepared)this.sourceImagePending.delete(layer);
   this.clear(layer);layer.asset=prepared.name;layer.frame=prepared.frames.get(id);layer.baseX=initial.baseX??0;layer.baseY=initial.baseY??0;layer.element=prepared.element;
   document.getElementById('layers').append(prepared.element);this.place(layer);
   this.sourceImageJobs.set(layer,{prepared,origin:now-elapsedTicks,elapsedTicks,frameId:id,element:prepared.element});
   prepared.unregisterRestoreResource?.();
   this.cgRegistry?.registerImage(layer.asset);
   this.sourceImageEvent({kind:'source-image-anm-start',group:layer.group,id:layer.id,name:prepared.name,elapsedTicks,frameId:id});this.scheduleSourceImages();
  }
  async image(layer,name,frameId,...rest){
   this.assertSourceImageAnimationsHealthy();const normalized=String(name).toLowerCase(),key=layer.group+':'+layer.id,transaction=rest[0]?.restoreTransaction;
   transaction?.assertActive();
   this.cancelSourceImageRestoreForNormalOperation(rest[0]);
   const owner=this.sourceImageRestorePending;
   if(transaction&&owner)assertRootDescendant(transaction,owner);
   const restore=transaction&&owner?owner.plans.get(key):null;
   const prior=this.sourceImagePending.get(layer);cancelPending(prior);
   const pending={token:Symbol(),prepared:null};this.sourceImagePending.set(layer,pending);
   if(!this.sourceImageAnimations||!['bg','eg'].includes(layer.group)){
    try{return await super.image(layer,name,frameId,...rest)}finally{if(this.sourceImagePending.get(layer)===pending)this.sourceImagePending.delete(layer)}
   }
   if(!source.has(normalized)||(frameId!==undefined&&!restore)){
    // Frozen R6's inherited Image.decode path has no cancellation fence. Keep
    // opted-in bg/eg static images transactional with the same intrinsic load
    // and successful ExtraRenderer registry hook, before replacing a live ANM.
    let committed=false,unregister=null;
    try{
     const frame=this.imageFrame(name,frameId),element=new Image();element.src=this.url(frame.file);
     pending.element=element;
     if(transaction)unregister=transaction.registerResource(()=>cancelPending(pending));
     await element.decode();transaction?.assertActive();require(this.sourceImagePending.get(layer)===pending,'superseded image request');
     require(element.naturalWidth===frame.width&&element.naturalHeight===frame.height,'decoded static frame dimensions');
     this.sourceImagePending.delete(layer);this.clear(layer);layer.asset=normalized;layer.frame=frame;layer.baseX=frame.baseX??0;layer.baseY=frame.baseY??0;layer.element=element;
     document.getElementById('layers').append(element);this.place(layer);committed=true;this.cgRegistry?.registerImage(layer.asset);
    }finally{unregister?.();if(!committed)cancelPending(pending);if(this.sourceImagePending.get(layer)===pending)this.sourceImagePending.delete(layer)}
    return;
   }
   let committed=false;
   try{
    pending.prepared=restore?.prepared??await this.prepareSourceImage(normalized,0,pending,transaction);
    transaction?.assertActive();require(this.sourceImagePending.get(layer)===pending,'superseded image request');
    this.commitSourceImage(layer,pending.prepared,restore?.elapsedTicks??0);committed=true;if(restore)restore.committed=true;
   }finally{if(this.sourceImageJobs.get(layer)?.prepared===pending.prepared){if(restore)restore.committed=true}else if(!committed)releasePrepared(pending.prepared);if(this.sourceImagePending.get(layer)===pending)this.sourceImagePending.delete(layer)}
  }
  async updateSourceImageBank(layer,job,now){
   require(this.layers.get(layer.group+':'+layer.id)===layer&&layer.asset===job.prepared.name&&layer.element===job.element,'live source bank identity');
   let elapsed=tick(now-job.origin),id=sourceAnmFrameAtTick(job.prepared.plan,elapsed);
   if(id!==job.frameId){
    let lease;
    try{lease=await job.prepared.cache.acquire(id)}catch(error){if(this.sourceImageJobs.get(layer)!==job)return;throw error}
    try{
     if(this.sourceImageJobs.get(layer)!==job)return;
     const latest=tick(this.sourceImageClock.currentTick()-job.origin);
     // A late decode must not paint a frame belonging to an expired phase.
     if(sourceAnmFrameAtTick(job.prepared.plan,latest)!==id)return;
     elapsed=latest;paint(job.prepared,lease.bitmap,id);layer.frame=job.prepared.frames.get(id);job.frameId=id;this.place(layer);
     this.sourceImageEvent({kind:'source-image-anm-frame',group:layer.group,id:layer.id,name:job.prepared.name,frameId:id,elapsedTicks:elapsed});
    }finally{lease.release()}
   }
   if(this.sourceImageJobs.get(layer)!==job)return;job.elapsedTicks=elapsed;
   try{await Promise.all(neighbours(job.prepared.plan,elapsed).map(next=>job.prepared.cache.prefetch(next)))}catch(error){if(this.sourceImageJobs.get(layer)===job)throw error}
  }
  updateSourceImageAnimations(){
   this.assertSourceImageAnimationsHealthy();if(!this.sourceImageAnimations)return Promise.resolve();if(this.sourceImageUpdating)return this.sourceImageUpdating;
   const now=tick(this.sourceImageClock.currentTick()),jobs=[...this.sourceImageJobs];
   const work=Promise.all(jobs.map(([layer,job])=>this.updateSourceImageBank(layer,job,now))).then(()=>undefined);
   this.sourceImageUpdating=work;work.then(()=>{if(this.sourceImageUpdating===work)this.sourceImageUpdating=null},()=>{if(this.sourceImageUpdating===work)this.sourceImageUpdating=null});return work;
  }
  scheduleSourceImages(){
   if(this.sourceImageFrame!==null||![...this.sourceImageJobs.values()].some(job=>job.prepared.plan.loop||job.elapsedTicks<job.prepared.plan.totalTicks))return;
   this.sourceImageFrame=this.sourceImageRequestFrame(async()=>{
    this.sourceImageFrame=null;
    try{await this.updateSourceImageAnimations();this.scheduleSourceImages()}catch(error){this.sourceImageFailure=error;this.sourceImageEvent({kind:'source-image-anm-failure',message:String(error?.message??error)});this.warn('原图像动画失败：'+String(error?.message??error))}
   });
  }
  clear(layer,...rest){
   const pending=this.sourceImagePending?.get(layer);cancelPending(pending);this.sourceImagePending?.delete(layer);
   const job=this.sourceImageJobs?.get(layer);if(job)releasePrepared(job.prepared);this.sourceImageJobs?.delete(layer);
   if(this.sourceImageJobs?.size===0&&this.sourceImageFrame!==null){this.sourceImageCancelFrame?.(this.sourceImageFrame);this.sourceImageFrame=null}
   return super.clear(layer,...rest);
  }
  reset(...rest){
   this.sourceImageResetGeneration=(this.sourceImageResetGeneration??0)+1;
   const transaction=this.sourceImageRestorePending;if(!this.sourceImageRestoreResetting){transaction?.cancel();if(this.sourceImageRestorePending===transaction)this.sourceImageRestorePending=null;if(this.sourceImageRestorePlans===transaction?.plans)this.sourceImageRestorePlans=null;}
   for(const pending of this.sourceImagePending?.values()??[])cancelPending(pending);this.sourceImagePending?.clear();
   return super.reset(...rest);
  }
  async command(...args){this.assertSourceImageAnimationsHealthy();return super.command(...args)}
  snapshot(...args){
   this.assertSourceImageAnimationsHealthy();if(!this.sourceImageAnimations)return super.snapshot(...args);
   const capture=()=>{const saved=super.snapshot(...args);return {...saved,sourceImageAnimations:{version:1,policy:'port-own-painted-phase-normal-clock',jobs:[...this.sourceImageJobs].map(([layer,job])=>({group:layer.group,id:layer.id,name:job.prepared.name,elapsedTicks:job.elapsedTicks,frameId:job.frameId}))}}};
   return typeof this.sourceImageClock.withAtomicSnapshot==='function'?withSharedSourceSnapshot(this.sourceImageClock,capture):capture();
  }
  validateSave(saved,...rest){
   const data=super.validateSave(saved,...rest),state=data.sourceImageAnimations;if(state===undefined)return data;
   require(this.sourceImageAnimations&&state?.version===1&&state.policy==='port-own-painted-phase-normal-clock'&&Array.isArray(state.jobs)&&state.jobs.length<=1000,'saved animation policy');const keys=new Set();
   for(const job of state.jobs){
    require(job&&['bg','eg'].includes(job.group)&&/^\d+$/.test(String(job.id))&&typeof job.name==='string'&&source.has(job.name),'saved animation identity');const key=job.group+':'+job.id;require(!keys.has(key),'duplicate saved animation bank');keys.add(key);
    tick(job.elapsedTicks);const prepared=this.sourceImagePlan(job.name),layers=data.layers.filter(layer=>layer.group===job.group&&String(layer.id)===String(job.id));
    require(layers.length===1&&layers[0].asset===job.name&&!layers[0].emote&&!layers[0].composite&&!layers[0].color,'orphan/conflicting saved animation');
    require(job.frameId===sourceAnmFrameAtTick(prepared.plan,job.elapsedTicks)&&String(layers[0].frameId)===String(job.frameId),'saved painted phase/frame mismatch');
   }return data;
  }
  async restore(saved,options={},...rest){
   if(!this.sourceImageAnimations)return super.restore(saved,options,...rest);
   const data=this.validateSave(saved);require(BaseRenderer.sourceRestoreTransactionVersion===1,'parent restore transaction hooks required');require(!this.sourceImageRestorePending,'concurrent restore');require(options&&typeof options==='object'&&!Array.isArray(options),'restore transaction options');
   const parent=restoreTransactionFromOptions(options);parent?.assertActive();tick(this.sourceImageClock.currentTick());if(this.sourceCharacterPerformance)tick(data.sourceCharacters.clock.tick);
   const plans=new Map(),resources=new Set(),cleanupErrors=[];let canceled=false,unregisterParent=()=>{};
   const transaction={plans,assertActive:()=>{require(!canceled&&this.sourceImageRestorePending===transaction,'superseded restore');parent?.assertActive()},resetFromRestore:(...args)=>{transaction.assertActive();this.sourceImageRestoreResetting=true;try{return parent?parent.resetFromRestore(...args):super.reset(...args)}finally{this.sourceImageRestoreResetting=false}},registerResource:dispose=>{transaction.assertActive();require(typeof dispose==='function','restore resource disposer');const row={dispose};resources.add(row);return ()=>resources.delete(row)},cancel:()=>{if(canceled)return;canceled=true;try{unregisterParent()}catch(error){cleanupErrors.push(error)}const pending=[...resources];resources.clear();for(const row of pending)try{row.dispose()}catch(error){cleanupErrors.push(error)}}};
   this.sourceImageRestorePending=transaction;
   try{
    registerRestoreRoot(transaction);if(parent){const registered=parent.registerResource(transaction.cancel);require(typeof registered==='function','parent restore unregister');unregisterParent=registered;if(canceled)unregisterParent();transaction.assertActive();}
    // Each saved bank prepares only its current/next two frames before old reset.
    for(const job of data.sourceImageAnimations?.jobs??[]){const prepared=await awaitSourceRestore(transaction,()=>this.prepareSourceImage(job.name,job.elapsedTicks,null,transaction));plans.set(job.group+':'+job.id,{prepared,elapsedTicks:job.elapsedTicks,committed:false})}
    transaction.assertActive();this.sourceImageRestorePlans=plans;const result=await awaitSourceRestore(transaction,()=>super.restore(data,{...options,restoreTransaction:transaction},...rest));transaction.assertActive();return result;
   }catch(error){if(canceled)throw new Error('Source bitmap ANM: superseded restore',{cause:error});throw error}
   finally{transaction.cancel();for(const plan of plans.values())if(!plan.committed)releasePrepared(plan.prepared);if(this.sourceImageRestorePlans===plans)this.sourceImageRestorePlans=null;if(this.sourceImageRestorePending===transaction)this.sourceImageRestorePending=null;require(!cleanupErrors.length,'restore resource cleanup failed')}
  }
 };
}
