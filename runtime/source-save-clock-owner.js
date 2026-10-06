import {NativeTransitionFrameClock,nativeFramePeriodQ32} from './native-transition-clock.js';

// Port-owned save policy. Original Windows save/pause semantics are not implied.
export const SOURCE_SAVE_CLOCK_POLICY='port-own-absolute-source-tick';
const require=(ok,message)=>{if(!ok)throw new Error('Source save clock: '+message)};
const KEYS=['version','policy','fps','tick'];
function checkedSnapshot(value,fps){
 require(value&&Object.getPrototypeOf(value)===Object.prototype,'plain snapshot required');
 const keys=Reflect.ownKeys(value);require(keys.length===KEYS.length&&keys.every(key=>KEYS.includes(key)),'unknown or missing snapshot fields');
 const descriptors=Object.getOwnPropertyDescriptors(value);require(KEYS.every(key=>Object.hasOwn(descriptors[key],'value')),'data snapshot fields required');
 const owned=Object.fromEntries(KEYS.map(key=>[key,descriptors[key].value]));
 require(owned.version===1&&owned.policy===SOURCE_SAVE_CLOCK_POLICY,'unsupported snapshot policy');
 nativeFramePeriodQ32(owned.fps);require(owned.fps===fps,'foreign snapshot fps');
 require(Number.isSafeInteger(owned.tick)&&owned.tick>=0&&owned.tick<=0xffffffff,'uint32 snapshot tick required');
 return Object.freeze(owned);
}
export class PortOwnSaveFrameClock extends NativeTransitionFrameClock{
 static sourceSaveClockVersion=1;
 #nativeState;#nativeMutation=false;#snapshotHold=null;#restores=[];
 constructor(options){
  super(options);
  this.#nativeState={tick:this.tick,bucket:this.bucket,lastMilliseconds:this.lastMilliseconds};
  // Only the clock owner may rebase tick or update its monotonic bucket. Other
  // modules get the common instance and public reads, not private epoch setters.
  for(const key of ['tick','bucket','lastMilliseconds'])Object.defineProperty(this,key,{configurable:false,enumerable:true,get:()=>this.#nativeState[key],set:value=>{require(this.#nativeMutation,'owner-only '+key+' mutation');this.#nativeState[key]=value}});
  for(const key of ['fps','periodQ32','millisecondSource'])Object.defineProperty(this,key,{configurable:false,enumerable:true,writable:false,value:this[key]});
 }
 update(...args){
  require(!this.#snapshotHold,'explicit update during atomic snapshot');
  // Match the original default-argument evaluation order, before permitting
  // original normal-scheduler writes. A custom source cannot write our epoch.
  const now=args[0]===undefined?this.millisecondSource():args[0];
  const {skipUpdate=false}=args[1]===undefined?{}:args[1];
  this.#nativeMutation=true;
  try{return super.update(now,{skipUpdate})}finally{this.#nativeMutation=false}
 }
 currentTick(){return this.#snapshotHold?.tick??super.currentTick()}
 validateClockSnapshot(saved){return checkedSnapshot(saved,this.fps)}
 snapshotClock(){
  if(this.#snapshotHold)return this.#snapshotHold;
  return Object.freeze({version:1,policy:SOURCE_SAVE_CLOCK_POLICY,fps:this.fps,tick:this.currentTick()});
 }
 withAtomicSnapshot(capture){
  require(typeof capture==='function'&&capture.constructor?.name!=='AsyncFunction','synchronous snapshot callback required');
  require(!this.#snapshotHold,'nested atomic snapshot unsupported');
  const saved=this.snapshotClock();this.#snapshotHold=saved;
  try{const result=capture(saved);require(!result||typeof result.then!=='function','thenable snapshot result unsupported');return result}finally{this.#snapshotHold=null}
 }
 restoreClock(saved,{restoreTransaction}={}){
  // Validate and copy every field before any millisecond source call or writes.
  const owned=this.validateClockSnapshot(saved);
  require(!this.#snapshotHold,'restore during atomic snapshot');
  require(restoreTransaction&&typeof restoreTransaction.assertActive==='function','explicit restore transaction required');
  restoreTransaction.assertActive();
  const now=this.millisecondSource();
  restoreTransaction.assertActive();
  const previousTick=this.tick;
  this.#nativeMutation=true;
  try{
   // Original arithmetic and zero-bucket behavior remain exact. Align to NOW
   // without crediting decode/downtime; never restore a saved browser epoch.
   const aligned=super.update(now,{skipUpdate:true});
   this.tick=owned.tick;
   this.#restores.push(Object.freeze({previousTick,restoredTick:this.tick,milliseconds:aligned.milliseconds,bucket:aligned.bucket,bucketAdvanced:aligned.advanced,policy:SOURCE_SAVE_CLOCK_POLICY}));
   if(this.#restores.length>256)this.#restores.shift();
  }finally{this.#nativeMutation=false}
  return owned;
 }
 clockRestoreEvents(){return this.#restores.slice()}
}
