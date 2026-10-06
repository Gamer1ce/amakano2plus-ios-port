import {argumentsOf} from './expressions.js';
import {layerIds} from './renderer.js';
import {NativeMotionLedger} from './native-motion-ledger.js';
import {SourcePlaneDimensions} from './native-plane-dimensions.js';
import {NativeCalculatorCurrent} from './native-calculator-current.js';
import {portOpacityToAlphaByte} from './native-fade-motion.js';
const groups=new Set(['bg','cg','pl','mpl','fg','eg','fw']),globalOps=new Set(['stop','tone','mode','attr_def','quake']);
export const PORT_NATIVE_MOTION_OWNER_POLICY='port-shared-tick-before-capture-and-own-save';
const require=(ok,message)=>{if(!ok)throw new Error('Port MOT owner: '+message)};
const clone=value=>structuredClone(value);
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
// Explicit host policy: the native numeric kernels are reused, but scheduling,
// scene replacement and own-save are PORT ownership decisions, not a claim
// that Windows Task/camera/capture/save semantics have been reproduced.
export function withPortNativeMotionOwner(BaseRenderer){return class PortNativeMotionOwner extends BaseRenderer{
 #phase=null;#frame=null;#restore=null;#failure=null;
 constructor(...args){
  super(...args);const o=args[0],enabled=o?.portNativeMotionOwner??false;require(typeof enabled==='boolean','boolean opt-in required');this.portNativeMotionOwner=enabled;
  this.nativeMotionOwnerEvents=[];this.nativeMotionRequestFrame=o?.nativeMotionRequestFrame??(callback=>requestAnimationFrame(callback));this.nativeMotionCancelFrame=o?.nativeMotionCancelFrame??(id=>cancelAnimationFrame(id));this.nativeMotionSharedSnapshot=o?.nativeMotionSharedSnapshot;this.nativeMotionOwnerOnError=o?.nativeMotionOwnerOnError??(()=>{});
  if(enabled)require(this.nativePositionMotions&&this.nativeMotionTick&&this.nativeTransitionClock===o.nativeMotionClock&&typeof this.nativeMotionSharedSnapshot==='function'&&typeof this.nativeMotionRequestFrame==='function'&&typeof this.nativeMotionCancelFrame==='function'&&typeof this.nativeMotionOwnerOnError==='function','native list, one clock and exact shared snapshot coordinator required');
 }
 event(event){this.nativeMotionOwnerEvents.push(Object.freeze(event));if(this.nativeMotionOwnerEvents.length>256)this.nativeMotionOwnerEvents.shift()}
 allowsNativeMotionOwnerBoundary(){return this.portNativeMotionOwner&&this.#phase!==null}
 assertPortMotionHealthy(){if(this.#failure)throw this.#failure}
 boundary(phase,callback){require(!this.#phase,'nested motion boundary');this.#phase=phase;try{return callback()}finally{this.#phase=null}}
 hasPortNativeMotions(){return [...this.nativePositionLedgers.values()].some(ledger=>ledger.size)}
 cancelPortMotionFrame(){if(this.#frame!==null){this.nativeMotionCancelFrame(this.#frame);this.#frame=null}}
 schedulePortNativeMotions(){
  if(!this.portNativeMotionOwner||this.#frame!==null||!this.hasPortNativeMotions()||this.#restore)return;
  this.#frame=this.nativeMotionRequestFrame(()=>{this.#frame=null;try{this.updateNativePositionMotions();this.schedulePortNativeMotions()}catch(error){this.#failure=error;for(const promises of this.nativePositionPromises.values())for(const entry of promises.values())entry.reject?.(error);this.nativeMotionOwnerOnError(error);this.event({kind:'scheduler-failed',message:String(error?.message??error)})}});
 }
 appendNativePosition(...args){const id=super.appendNativePosition(...args);this.schedulePortNativeMotions();return id}
 updateNativePositionMotions(tick){if(!this.portNativeMotionOwner)return super.updateNativePositionMotions(tick);this.assertPortMotionHealthy();require(!this.#restore,'motion update during asynchronous restore');const owned=tick??this.nativeMotionTick();return this.boundary('frame',()=>super.updateNativePositionMotions(owned))}
 async prepareNativePump(...args){
  if(!this.portNativeMotionOwner)return super.prepareNativePump(...args);this.assertPortMotionHealthy();require(!this.#restore,'capture during asynchronous restore');
  if(this.nativeEffect)await this.nativeEffect.finished;
  // The transition owner releases its prior preparation before the new tick.
  this.discardNativePreparation();const tick=this.nativeMotionTick();
  const result=this.boundary('capture',()=>{super.updateNativePositionMotions(tick);this.event({kind:'capture-front-tick',tick,live:this.hasPortNativeMotions()});return super.prepareNativePump(...args)});
  return result;
 }
 mutationLayers(cmd,parts,state){
  if(!groups.has(cmd))return [];
  if(this.nativeAdditionalMotionBankSelector?.({cmd,parts,state,layers:this.layers}))return [];
  if(this.nativeMotionOperationHandled(parts[0]))return [];
  if(!parts.length||globalOps.has(parts[0]))return [...this.layers.values()].filter(l=>l.group===cmd);
  const implicit=!/^(?:\[|#|\d)/.test(parts[0]),operation=parts[implicit?0:1];if(this.nativeMotionOperationHandled(operation)||operation==='delay')return [];
  return (implicit?['0']:layerIds(parts[0],state)).map(id=>this.bank(cmd,id));
 }
 stopPortNativeBanks(layers,tick){
  const stopped=[];for(const layer of layers){const key=layer.group+':'+layer.id,ledger=this.nativePositionLedgers.get(key);if(ledger?.size){ledger.requestStop();stopped.push(key)}}
  if(stopped.length){super.updateNativePositionMotions(tick);this.event({kind:'before-bank-mutation-stop',tick,banks:stopped})}return stopped;
 }
 command(...args){
  if(!this.portNativeMotionOwner)return super.command(...args);this.assertPortMotionHealthy();require(!this.#restore,'command during asynchronous restore');
  const [cmd,raw,state]=args,parts=argumentsOf(raw),layers=this.mutationLayers(cmd,parts,state),tick=this.nativeMotionTick();
  // Boundary is synchronous. It covers only validation/sample and immediate
  // entry into the real command; it never remains open while resource IO waits.
  return this.boundary('command',()=>{this.stopPortNativeBanks(layers,tick);return super.command(...args)});
 }
 snapshot(...args){
  if(!this.portNativeMotionOwner)return super.snapshot(...args);this.assertPortMotionHealthy();require(!this.#restore&&!this.nativePrepared&&!this.nativeCommitting&&!this.nativeEffect,'save requires completed capture/transition transaction');
  return this.nativeMotionSharedSnapshot(this.nativeTransitionClock,clock=>this.boundary('save',()=>{
   super.updateNativePositionMotions(clock.tick);const data=super.snapshot(...args);
   // Base host saves only XY. Depth is part of this explicit PL-only port
   // projection, so preserve its logical source channel within the same lease.
   const layers=data.layers.map(saved=>{const live=this.layers.get(saved.group+':'+saved.id);if(live?.group==='pl'&&this.allowsPortPlaneZ?.(live)){const z=live.z??0;require(Number.isFinite(z)&&Math.fround(z)===z&&(live.sz??1)===1,'saved PL depth/scale');return {...saved,z,sz:1}}return saved});
   return {...data,layers,portNativeMotions:{version:1,policy:PORT_NATIVE_MOTION_OWNER_POLICY,clock:{...clock},ledgers:this.snapshotNativePositionLedgers(),dimensions:this.sourcePlaneDimensions?this.snapshotSourcePlaneDimensions():null,calculator:this.nativeCalculatorCurrent?this.snapshotNativeCalculatorCurrent():null}};
  }));
 }
 validateSave(saved,...args){
  const data=super.validateSave(saved,...args),extra=data.portNativeMotions;if(extra===undefined){require(!this.portNativeMotionOwner,'owned motion save descriptor required');return data}
  require(this.portNativeMotionOwner&&exact(extra,['version','policy','clock','ledgers','dimensions','calculator'])&&extra.version===1&&extra.policy===PORT_NATIVE_MOTION_OWNER_POLICY&&Array.isArray(extra.ledgers)&&extra.ledgers.length<=1000,'owned motion schema');
  const clock=this.nativeTransitionClock.validateClockSnapshot(extra.clock);if(data.sourceCharacters)require(JSON.stringify(clock)===JSON.stringify(data.sourceCharacters.clock),'foreign saved character clock');
  if(extra.dimensions!==null){require(this.sourcePlaneDimensions,'saved plane bridge disabled');SourcePlaneDimensions.restore(extra.dimensions)}
  if(extra.calculator!==null){require(this.nativeCalculatorCurrent,'saved calculator owner absent');NativeCalculatorCurrent.restore(extra.calculator)}
  for(const layer of data.layers){const permitted=layer.group==='pl'&&this.allowsPortPlaneZ?.(layer);if(Object.hasOwn(layer,'z'))require(Number.isFinite(layer.z)&&Math.fround(layer.z)===layer.z&&(layer.z===0||permitted),'unaccepted saved depth');if(Object.hasOwn(layer,'sz'))require(layer.sz===1,'unaccepted saved depth scale')}
  const keys=new Set();for(const entry of extra.ledgers){
   require(exact(entry,['bank','delayFrames','ledger'])&&typeof entry.bank==='string'&&!keys.has(entry.bank)&&Number.isInteger(entry.delayFrames)&&entry.delayFrames>=0&&entry.delayFrames<=0x7fffffff,'owned motion bank');keys.add(entry.bank);
   NativeMotionLedger.validateSnapshot(entry.ledger,{additionalMotions:this.nativeAdditionalMotionAdapters});const layers=data.layers.filter(l=>l.group+':'+l.id===entry.bank);require(layers.length===1,'orphan saved motion bank');const layer=layers[0],ledger=entry.ledger;
   require(layer.x===ledger.working.x&&layer.y===ledger.working.y&&(layer.z??0)===ledger.working.z,'saved host/MOT working coordinates');
   if(ledger.version>=3)require(layer.sx===ledger.workingScale.x&&layer.sy===ledger.workingScale.y&&(layer.sz??1)===ledger.workingScale.z,'saved host/MOT scale');
   if(ledger.version===4)require(this.nativeFadeMotions&&portOpacityToAlphaByte(layer.opacity)===ledger.workingAlpha,'saved host/MOT alpha');
   require((layer.motions??[]).length===0,'legacy animation conflicts with native saved list');
  }return data;
 }
 cancelPortMotionRestore(){const context=this.#restore;if(!context)return;this.#restore=null;context.canceled=true;for(const dispose of [...context.resources])try{dispose()}catch(error){context.errors.push(error)}context.resources.clear()}
 async restore(saved,options={},...args){
  if(!this.portNativeMotionOwner)return super.restore(saved,options,...args);const data=clone(this.validateSave(saved,options,...args));this.cancelPortMotionRestore();this.cancelPortMotionFrame();
  const extra=data.portNativeMotions,external=options.restoreTransaction,context={canceled:false,resources:new Set(),errors:[],resetting:false};this.#restore=context;
  const transaction={assertActive:()=>{require(this.#restore===context&&!context.canceled,'superseded whole motion restore');external?.assertActive()},registerResource:dispose=>{transaction.assertActive();require(typeof dispose==='function','restore disposer');context.resources.add(dispose);return ()=>context.resources.delete(dispose)},resetFromRestore:(...resetArgs)=>{transaction.assertActive();context.resetting=true;try{if(!data.sourceCharacters)this.nativeTransitionClock.restoreClock(extra.clock,{restoreTransaction:transaction});return super.reset(...resetArgs)}finally{context.resetting=false}}};
  let unregister=()=>{};if(external){unregister=external.registerResource(()=>this.cancelPortMotionRestore());require(typeof unregister==='function','outer restore unregister')}
  try{
   await super.restore(data,{...options,restoreTransaction:transaction},...args);transaction.assertActive();require(this.nativeTransitionClock.currentTick()>=extra.clock.tick,'restored clock epoch mismatch');
   this.boundary('restore',()=>{if(extra.dimensions!==null)this.restoreSourcePlaneDimensions(extra.dimensions);this.restoreNativePositionLedgers(extra.ledgers,{tick:this.nativeMotionTick()});if(extra.calculator!==null)this.restoreNativeCalculatorCurrent(extra.calculator)});
   this.event({kind:'whole-motion-restore-complete',savedTick:extra.clock.tick});
  }finally{unregister();if(this.#restore===context)this.#restore=null;context.canceled=true;for(const dispose of [...context.resources])try{dispose()}catch(error){context.errors.push(error)}context.resources.clear();require(!context.errors.length,'restore cleanup failed')}
  this.schedulePortNativeMotions();
 }
 reset(...args){if(this.portNativeMotionOwner){this.cancelPortMotionRestore();this.cancelPortMotionFrame();this.#failure=null}return super.reset(...args)}
 };}
