import {Renderer,layerIds} from './renderer.js';
import {argumentsOf,numericArgument} from './expressions.js';
import {createNativeArc} from './native-arc-sampling.js';
import {createNativePositionMotion,nativeRoundPosition} from './native-position-motion.js';
import {NativeMotionLedger} from './native-motion-ledger.js';
import {createNativeContinuousSpline} from './native-continuous-spline.js';
import {createNormalizedNativeScaleMotion,createDimensionNativeScaleMotion} from './native-scale-motion.js';
import {SourcePlaneDimensions} from './native-plane-dimensions.js';
import {NativeCalculatorCurrent} from './native-calculator-current.js';
import {nativeCalculatorCommandEffect} from './native-calculator-command-effects.js';
import {createNativeFadeMotion,portOpacityToAlphaByte} from './native-fade-motion.js';
const groups=['bg','cg','pl','mpl','fg','eg','fw'];
const motionOperation=operation=>['arc','mcarc','mcspline','mscale','m2scale'].includes(operation)||/^(?:m2)?(?:move|amove[123])$/.test(operation);
const key=layer=>`${layer.group}:${layer.id}`;
function integerArgument(value,state,current=0){const result=numericArgument(value,state,current);if(!Number.isInteger(result)||result < -2147483648||result>2147483647)throw new Error('Native MOT argument must be a signed integer');return result}

// Explicitly opt-in isolated renderer. Caller drives updateNativePositionMotions
// with the shared INTEGER Task clock. No per-job RAF/fractional-ms clocks.
// Position, motScale and opt-in motFade share the source ordered list.
// Visual Z, MPL dimension-dependent scale, rotation and host capture remain pending.
export function withNativePositionMotions(BaseRenderer){return class NativePositionMotions extends BaseRenderer{
 constructor(...ctorArgs){
  const options=ctorArgs[0],enabled=options?.nativePositionMotions??false;if(typeof enabled!=='boolean')throw new Error('Invalid native position option');super(...ctorArgs);this.nativePositionMotions=enabled;
  const planeDimensions=options?.sourceNativePlaneDimensions??false;if(typeof planeDimensions!=='boolean')throw new Error('Invalid source plane dimensions option');this.sourcePlaneDimensions=enabled&&planeDimensions?new SourcePlaneDimensions():undefined;
  if(options?.nativeCalculatorCurrent!==undefined&&!(options.nativeCalculatorCurrent instanceof NativeCalculatorCurrent))throw new Error('Invalid shared native calculator current');this.nativeCalculatorCurrent=enabled?options?.nativeCalculatorCurrent:undefined;
  const calculatorEffects=options?.nativeCalculatorCommandEffects??false;if(typeof calculatorEffects!=='boolean')throw new Error('Invalid native calculator command effects option');this.nativeCalculatorCommandEffects=enabled&&calculatorEffects;
  const fadeMotions=options?.nativeFadeMotions??false;if(typeof fadeMotions!=='boolean')throw new Error('Invalid native fade option');this.nativeFadeMotions=enabled&&fadeMotions;
  if(enabled&&this.nativeTransitionClock){if(options.nativeMotionClock!==this.nativeTransitionClock||options.nativeMotionClock.fps!==60)throw new Error('Explicit shared source60 transition clock required');this.nativeMotionTick=()=>options.nativeMotionClock.currentTick()}
  else{if(enabled&&typeof options.nativeMotionTick!=='function')throw new Error('Explicit source60 integer Task clock required');this.nativeMotionTick=options?.nativeMotionTick}
  this.nativeAdditionalMotionAdapters=options?.nativeAdditionalMotionAdapters??[];this.nativeAdditionalMotionFactory=options?.nativeAdditionalMotionFactory;this.nativeAdditionalMotionOperations=options?.nativeAdditionalMotionOperations??[];this.nativeAdditionalMotionBankSelector=options?.nativeAdditionalMotionBankSelector;if(!Array.isArray(this.nativeAdditionalMotionOperations)||!this.nativeAdditionalMotionOperations.every(v=>typeof v==='string')||this.nativeAdditionalMotionOperations.length&&!this.nativeAdditionalMotionFactory||this.nativeAdditionalMotionFactory!==undefined&&typeof this.nativeAdditionalMotionFactory!=='function'||this.nativeAdditionalMotionBankSelector!==undefined&&typeof this.nativeAdditionalMotionBankSelector!=='function')throw new Error('Invalid additional native motion factory');this.nativePositionLedgers=new Map();this.nativePositionPromises=new Map();this.nativeBankDelays=new Map();this.nativePositionDisposing=false;this.nativeMotionCandidateScope='ordered XY arc/move/amove1..3, actual mcSpline, normalized BG/CG/EG/FG/FW motScale and optional source type2 PL dimensions, Arc @ from explicit shared calculator; optional ordered byte-alpha fade; actual @ prefix owner, Z, MPL scale/rotation and native lifecycle unaccepted'
 }
 allowsPortPlaneZ(layer){return false}
 allowsNativeMotionOwnerBoundary(){return false}
 nativeMotionOperationHandled(operation){return motionOperation(operation)||this.nativeFadeMotions&&['fade','m2fade'].includes(operation)||this.nativeAdditionalMotionOperations.includes(operation)}
 snapshotNativeCalculatorCurrent(){if(!this.nativeCalculatorCurrent)throw new Error('Shared native calculator current is not bound');return this.nativeCalculatorCurrent.snapshot()}
 restoreNativeCalculatorCurrent(snapshot){if(!this.nativeCalculatorCurrent)throw new Error('Shared native calculator current is not bound');const restored=NativeCalculatorCurrent.restore(snapshot);const state=restored.snapshot();if(state.current===null)this.nativeCalculatorCurrent.invalidate(state.reason);else this.nativeCalculatorCurrent.setCurrentInteger(state.current)}
 nativeSharedIntegerArgument(value,state){if(typeof value==='string'&&value.includes('@')){if(!this.nativeCalculatorCurrent)throw new Error('Native Arc @ calculator context is not closed');return this.nativeCalculatorCurrent.evaluateAtInteger(value)}return integerArgument(value,state)}
 assertNativePositionCaptureIdle(){if((this.nativePrepared||this.nativeCommitting||this.nativeEffect)&&!this.allowsNativeMotionOwnerBoundary())throw new Error('Native position with pending/active source capture is not accepted')}
 prepareNativePump(...rest){if(this.nativePositionMotions&&[...this.nativePositionLedgers.values()].some(ledger=>ledger.size)&&!this.allowsNativeMotionOwnerBoundary())throw new Error('Source capture while native positions run is not accepted');return super.prepareNativePump(...rest)}
 nativePositionLedgerFor(layer){const id=key(layer);if(!this.nativePositionLedgers.has(id))this.nativePositionLedgers.set(id,new NativeMotionLedger({x:layer.x,y:layer.y,z:layer.z??0},{tick:this.nativeMotionTick(),scale:{x:layer.sx??1,y:layer.sy??1,z:layer.sz??1},alphaByte:portOpacityToAlphaByte(layer.opacity??1),additionalMotions:this.nativeAdditionalMotionAdapters}));return this.nativePositionLedgers.get(id)}
 updateNativePositionMotions(tick){
  if(!this.nativePositionMotions)return [];this.assertNativePositionCaptureIdle();if(tick===undefined)tick=this.nativeMotionTick();
  const results=[];
  for(const [id,ledger] of this.nativePositionLedgers){
   if(!ledger.size)continue;const layer=this.layers.get(id);if(!layer)throw new Error('Native motion has orphan bank');
   if((layer.animations??[]).length)throw new Error('Mixed original MOT controller not closed');
   const result=ledger.update(tick);Object.assign(layer,result.working);if(result.workingScale)Object.assign(layer,{sx:result.workingScale.x,sy:result.workingScale.y,sz:result.workingScale.z});if(result.workingAlpha!==undefined)layer.opacity=result.workingAlpha/255;this.place(layer);results.push({bank:id,...result});
   const promises=this.nativePositionPromises.get(id);
   for(const entryId of result.finished){const entry=promises?.get(entryId);if(entry){this.animations.delete(entry.finished);entry.resolve();promises.delete(entryId)}}
  }
  return results;
 }
 appendNativePosition(layer,operation,parameters,state){
  this.assertNativePositionCaptureIdle();
  if((layer.animations??[]).length)throw new Error('Mixed original MOT controller not closed');
  const ledger=this.nativePositionLedgerFor(layer),working=ledger.working;let motion,calculatorWrite,tag=operation.startsWith('m2')||operation==='mcarc'||operation==='mcspline'?1:0;
   if(this.nativeAdditionalMotionOperations.includes(operation)){const result=this.nativeAdditionalMotionFactory({layer,operation,parameters,state,ledger,sourcePlaneDimensions:this.sourcePlaneDimensions,nativeCalculatorCurrent:this.nativeCalculatorCurrent});if(!result||Object.keys(result).some(v=>!['motion','tag','calculatorWrite'].includes(v))||!result.motion||![0,1].includes(result.tag))throw new Error('Invalid additional native motion construction');motion=result.motion;tag=result.tag;calculatorWrite=result.calculatorWrite;}else if(operation==='fade'||operation==='m2fade'){
    if(!this.nativeFadeMotions||parameters.length>3)throw new Error('Native fade option/arity is not accepted');
    const duration=parameters[0]===undefined?30:this.nativeSharedIntegerArgument(parameters[0],state);
    const target=token=>{
     if(token===undefined)return 0;
     if(!/^[+-]?\d+$/.test(token)&&!/^@(?:[+-]\d+)?%?$/.test(token))throw new Error('Native fade target grammar outside actual literal/@ scope');
     if(token.includes('@')){const temporary=new NativeCalculatorCurrent();temporary.setCurrentInteger(ledger.workingAlpha);return temporary.evaluateAtInteger(token)}
     return integerArgument(token,state);
    };
    motion=createNativeFadeMotion(duration,target(parameters[1]),target(parameters[2]));
    if(parameters[1]!==undefined||parameters[2]!==undefined)calculatorWrite=ledger.workingAlpha;
   }else if(operation==='mscale'||operation==='m2scale'){
   const plane=layer.group==='pl'&&this.sourcePlaneDimensions;
   if(!['bg','cg','eg','fg','fw'].includes(layer.group)&&!plane)throw new Error('Mixed native PL/MPL scale dimension basis is not closed');
   if(parameters.length>4||working.z!==0||ledger.workingScale.z!==1)throw new Error('Native scale arity/Z projection is not closed');
   if(parameters[0]?.includes('@')||parameters[0]?.includes('%'))throw new Error('Native scale duration shared calculator context is not closed');
   const duration=parameters[0]===undefined?30:integerArgument(parameters[0],state);
   motion=plane?createDimensionNativeScaleMotion(duration,parameters.slice(1),ledger.workingScale,this.sourcePlaneDimensions.dimensions(layer)):createNormalizedNativeScaleMotion(duration,parameters.slice(1),ledger.baseScale,ledger.workingScale);
   if(motion.delta.z!==0)throw new Error('Native scale Z projection is not closed');
   for(const [index,axis]of ['x','y','z'].entries())if(parameters[index+1]!==undefined)calculatorWrite=nativeRoundPosition(Math.fround(plane?Math.fround(ledger.workingScale[axis]*this.sourcePlaneDimensions.dimensions(layer)[axis]):Math.fround(ledger.baseScale[axis]*Math.fround(100))));
  }else if(operation==='mcspline'){
   if(ledger.size)throw new Error('Native Spline construction during a live controller is not closed');
   if(working.z!==0||parameters.length!==2||parameters.some(v=>v?.includes('@')||v?.includes('%')))throw new Error('Native Spline Z/context/point count is not closed');
   const points=parameters.map(v=>{const fields=v.split(',');if(fields.length!==3)throw new Error('Native Spline control group is not closed');const [durationFrames,x,y]=fields.map(v=>integerArgument(v,state));return {durationFrames,x,y,z:ledger.base.z}});
   motion=createNativeContinuousSpline(points,ledger.base);
  }else if(operation==='arc'||operation==='mcarc'){
   // Arc reads the shared calculator. It never installs a layer coordinate.
   // A known context must come from the owner's native209/native212 lifecycle.
   if(parameters.length>6)throw new Error('Invalid native Arc arity');
   const defaults=[30,0,0,0,0,0],values=defaults.map((fallback,index)=>parameters[index]===undefined?fallback:this.nativeSharedIntegerArgument(parameters[index],state));
   // KCS game-bank initialization calls native586(controller,1). MOT creation
   // copies controller+134 to MOT+4ac (VM-relative rounding flag4a4).
   motion=createNativeArc(values,{continuous:operation==='mcarc',roundFinal:true});
   if((motion.radiusZ!==0||working.z!==0)&&!(layer.group==='pl'&&this.allowsPortPlaneZ(layer)))throw new Error('Native Arc Z projection is not closed');
  }else{
   if(parameters.length>4)throw new Error('Invalid native move arity');
   const duration=parameters[0]===undefined?30:this.nativeSharedIntegerArgument(parameters[0],state),delta={};
   // Source native319 rounds the WORKING axis, native212 installs it for @,
   // native213 evaluates the target, then the float working axis is subtracted.
   for(const [index,axis]of ['x','y','z'].entries()){delta[axis]=Math.fround((parameters[index+1]===undefined?working[axis]:integerArgument(parameters[index+1],state,nativeRoundPosition(working[axis])))-working[axis]);if(parameters[index+1]!==undefined)calculatorWrite=nativeRoundPosition(working[axis])}
   if(delta.z!==0||working.z!==0)throw new Error('Native move Z projection is not closed');
   motion=createNativePositionMotion(duration,delta,{kind:operation.replace(/^m2/,''),roundFinal:true});
  }
  if(calculatorWrite!==undefined)this.nativeCalculatorCurrent?.setCurrentInteger(calculatorWrite);
  const id=ledger.append(motion,{tag,delayFrames:this.nativeBankDelays.get(key(layer))??0});let resolve,reject;const finished=new Promise((done,fail)=>{resolve=done;reject=fail});finished.catch(()=>{});
  const bank=key(layer);if(!this.nativePositionPromises.has(bank))this.nativePositionPromises.set(bank,new Map());this.nativePositionPromises.get(bank).set(id,{resolve,reject,finished});if(tag===0)this.animations.add(finished);
  return id;
 }
 stop(layer,...rest){
  if(!this.nativePositionMotions)return super.stop(layer,...rest);
  const ledger=this.nativePositionLedgers?.get(key(layer));
  if(ledger?.size){if(this.nativePositionDisposing)this.disposeNativeBank(layer);else ledger.requestStop()}
  return super.stop(layer,...rest);
 }
 disposeNativeBank(layer){const id=key(layer);for(const entry of this.nativePositionPromises?.get(id)?.values()??[]){this.animations.delete(entry.finished);entry.resolve()}this.nativePositionPromises?.delete(id);this.nativePositionLedgers?.delete(id)}
 clear(layer,...rest){if(!this.nativePositionMotions)return super.clear(layer,...rest);this.sourcePlaneDimensions?.invalidate(layer);if(this.nativePositionLedgers?.has(key(layer)))this.disposeNativeBank(layer);return super.clear(layer,...rest)}
 initialize(layer,...rest){if(!this.nativePositionMotions)return super.initialize(layer,...rest);this.disposeNativeBank(layer);this.nativeBankDelays?.delete(key(layer));const result=super.initialize(layer,...rest);this.sourcePlaneDimensions?.initialize(layer);return result}
 reset(...rest){if(!this.nativePositionMotions)return super.reset(...rest);this.nativePositionDisposing=true;try{const result=super.reset(...rest);this.nativePositionLedgers?.clear();this.nativePositionPromises?.clear();this.nativeBankDelays?.clear();this.sourcePlaneDimensions?.clear();return result}finally{this.nativePositionDisposing=false}}
 updateSourcePlaneRectangle(layer,rectangle){if(!this.sourcePlaneDimensions)throw new Error('Source plane dimensions bridge is disabled');this.sourcePlaneDimensions.updateRectangle(layer,rectangle)}
 snapshotSourcePlaneDimensions(){if(!this.sourcePlaneDimensions)throw new Error('Source plane dimensions bridge is disabled');return this.sourcePlaneDimensions.snapshot()}
 restoreSourcePlaneDimensions(snapshot){if(!this.sourcePlaneDimensions)throw new Error('Source plane dimensions bridge is disabled');if([...this.nativePositionLedgers.values()].some(ledger=>ledger.size))throw new Error('Restore plane dimensions before live motion ledgers');this.sourcePlaneDimensions=SourcePlaneDimensions.restore(snapshot)}
 command(cmd,args,state,...rest){if(!this.nativePositionMotions)return super.command(cmd,args,state,...rest);return this.executeNativePositionCommand(cmd,args,state,...rest).catch(error=>{this.nativeCalculatorCurrent?.invalidate('Failed native command leaves shared calculator writes unaccepted');throw error})}
 async executeNativePositionCommand(cmd,args,state,...rest){
  const parts=argumentsOf(args);
  if(groups.includes(cmd)&&parts.length){
   if(parts[0]==='stop'){for(const layer of this.layers.values())if(layer.group===cmd)this.stop(layer);return}
   if(cmd==='pl'&&this.sourcePlaneDimensions&&['tone','mode','attr_def','quake'].includes(parts[0])&&!this.nativeAdditionalMotionOperations.includes(parts[0])){
    if([...this.nativePositionLedgers].some(([bank,ledger])=>bank.startsWith('pl:')&&ledger.size))throw new Error(`Mixed original global PL ${parts[0]} while positions run is not closed`);
    this.sourcePlaneDimensions.invalidateAll(`Mixed global PL ${parts[0]} rectangle lifetime is not closed`);
   }
   const implicit=!/^(?:\[|#|\d)/.test(parts[0]),ids=implicit?['0']:layerIds(parts[0],state),operation=parts[implicit?0:1],parameters=parts.slice(implicit?1:2);
   if(operation==='delay'){
    this.assertNativePositionCaptureIdle();
    if(parameters.length>1||parameters.some(value=>value.includes('@')))throw new Error('Native delay calculator context/arity is not closed');
    const delayFrames=parameters[0]===undefined?0:integerArgument(parameters[0],state);if(delayFrames<0)throw new Error('Negative native delay is not closed');
    // Source setter affects only subsequent MOT creation, even while an older
    // motion is active. Each existing object keeps its copied +4b0 delay.
    for(const id of ids)this.nativeBankDelays.set(key(this.bank(cmd,id)),delayFrames);return;
   }
   const extra=this.nativeAdditionalMotionBankSelector?.({cmd,parts,state,layers:this.layers});if(extra){if(!this.nativeAdditionalMotionOperations.includes(extra.operation)||!Array.isArray(extra.bankIds)||!Array.isArray(extra.parameters))throw new Error('Invalid additional native bank selection');for(const id of extra.bankIds)this.appendNativePosition(this.bank(cmd,id),extra.operation,extra.parameters,state);return;}
   // Validate the complete selected bank set before appending anything.
   if(this.nativeMotionOperationHandled(operation)){
    if(ids.length!==1)throw new Error('Native motion multi-bank transactional parsing not closed');
    const layer=this.bank(cmd,ids[0]);this.appendNativePosition(layer,operation,parameters,state);return;
   }
   if(operation==='stop'){for(const id of ids)this.stop(this.bank(cmd,id));return}
   for(const id of ids){const layer=this.bank(cmd,id),ledger=this.nativePositionLedgers.get(key(layer));if(ledger?.size)throw new Error(`Mixed original MOT/setter ${operation??'initialize'} while positions run is not closed`);if(!(operation==='rot'&&this.applySourceUsedPlaneRotation?.(layer,parameters)===true))this.sourcePlaneDimensions?.observeCommand(layer,operation)}
  }
  // A generic forwarded command may write the same ancestor-owned calculator.
  // The source host must publish its native212 effects after it completes.
  // Keeping an older motion's value here would silently make a later @ wrong.
  const calculatorEffect=this.nativeCalculatorCommandEffects?nativeCalculatorCommandEffect(cmd,parts,cmd==='bg'&&/^\d+$/.test(parts[0]??'')?this.bank(cmd,String(Number(parts[0]))):undefined):{kind:'unknown'};
  if(calculatorEffect.kind==='unknown')this.nativeCalculatorCurrent?.invalidate(`Shared calculator effects of forwarded ${cmd} command are not closed`);
  const result=await super.command(cmd,args,state,...rest);
  if(calculatorEffect.kind==='write')this.nativeCalculatorCurrent?.setCurrentInteger(calculatorEffect.current);
  // An immediate command with no live list becomes the next base position.
  for(const [id,ledger]of this.nativePositionLedgers){if(!ledger.size){const layer=this.layers.get(id);if(layer){ledger.setBase({x:layer.x,y:layer.y,z:layer.z??0});ledger.setScaleBase({x:layer.sx??1,y:layer.sy??1,z:layer.sz??1});ledger.setAlphaBase(portOpacityToAlphaByte(layer.opacity??1))}}}
  return result;
 }
 snapshot(...rest){if(!this.nativePositionMotions)return super.snapshot(...rest);if([...this.nativePositionLedgers.values()].some(ledger=>ledger.size)&&!this.allowsNativeMotionOwnerBoundary())throw new Error('Use snapshotNativePositionLedgers; original renderer save schema cannot represent ordered MOT');return super.snapshot(...rest)}
 snapshotNativePositionLedgers(){if(!this.nativePositionMotions)return [];return [...new Set([...this.nativePositionLedgers.keys(),...this.nativeBankDelays.keys()])].map(bank=>({bank,delayFrames:this.nativeBankDelays.get(bank)??0,ledger:this.nativePositionLedgerFor(this.layers.get(bank)).snapshot()}))}
 restoreNativePositionLedgers(entries,options={}){
  if(!this.nativePositionMotions)throw new Error('Native position candidate is disabled');this.assertNativePositionCaptureIdle();const tick=options.tick??this.nativeMotionTick();
  if(!Array.isArray(entries)||entries.length>1000)throw new Error('Invalid native position save');
  const prepared=new Map(),delays=new Map();
  for(const entry of entries){
   if(!entry||Object.keys(entry).sort().join()!=='bank,delayFrames,ledger'||typeof entry.bank!=='string'||prepared.has(entry.bank)||!this.layers.has(entry.bank)||!Number.isInteger(entry.delayFrames)||entry.delayFrames<0||entry.delayFrames>0x7fffffff)throw new Error('Invalid native position bank');
   const layer=this.layers.get(entry.bank),ledger=NativeMotionLedger.restore(entry.ledger,{tick,scale:{x:layer.sx??1,y:layer.sy??1,z:layer.sz??1},alphaByte:portOpacityToAlphaByte(layer.opacity??1),additionalMotions:this.nativeAdditionalMotionAdapters}),working=ledger.working;
   if((layer.animations??[]).length||((working.z!==0||ledger.base.z!==0||ledger.jobs().some(job=>job.motion.radiusZ||job.motion.delta?.z))&&!(layer.group==='pl'&&this.allowsPortPlaneZ(layer))))throw new Error('Unclosed mixed/Z native motion save');
   if(ledger.hasScale&&(!['bg','cg','eg','fg','fw'].includes(layer.group)&&!(layer.group==='pl'&&this.sourcePlaneDimensions)||ledger.workingScale.z!==1||ledger.baseScale.z!==1||layer.sx!==ledger.workingScale.x||layer.sy!==ledger.workingScale.y||(layer.sz??1)!==ledger.workingScale.z))throw new Error('Renderer and native saved scale differs or is outside accepted group/Z scope');
   if(ledger.hasScale&&layer.group==='pl')this.sourcePlaneDimensions.dimensions(layer);
   if(ledger.hasAlpha&&(!this.nativeFadeMotions||portOpacityToAlphaByte(layer.opacity??1)!==ledger.workingAlpha))throw new Error('Renderer and native saved alpha differs or fade option is disabled');
   if(layer.x!==working.x||layer.y!==working.y||(layer.z??0)!==working.z)throw new Error('Renderer and native saved working positions differ');
   prepared.set(entry.bank,ledger);delays.set(entry.bank,entry.delayFrames);
  }
  // All schemas, bank references and working values are checked first.
  for(const [id]of this.nativePositionLedgers)this.disposeNativeBank(this.layers.get(id));
  this.nativePositionLedgers=prepared;this.nativeBankDelays=delays;
  for(const [bank,ledger]of prepared){
   const promises=new Map();for(const job of ledger.jobs())if(job.active){let resolve,reject;const finished=new Promise((done,fail)=>{resolve=done;reject=fail});finished.catch(()=>{});promises.set(job.id,{resolve,reject,finished});if(job.tag===0)this.animations.add(finished)}this.nativePositionPromises.set(bank,promises);
  }
 }
};}

// Backward-compatible isolated class; production composes the factory around its
// own full renderer chain. Both are off unless nativePositionMotions is true.
export class NativeMotionRenderer extends withNativePositionMotions(Renderer){}
