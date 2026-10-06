import {argumentsOf,numericArgument} from './expressions.js';
import {layerIds} from './renderer.js';
import {restoreTransactionFromOptions,assertRestoreActive} from './restore-transaction.js';

export const SOURCE_NEUTRAL_GLOBAL_POLICY='source-fixed-bank-controls-and-port-own-neutral-camera-v1';
const capacities=Object.freeze({bg:6,cg:6,eg:6,fg:6,fw:3,pl:32,mpl:10});
const modes=new Set(['bg:0','eg:2','eg:4','eg:5','mpl:1']);
const stateOf=new WeakMap(),copy=value=>structuredClone(value);
const require=(ok,message)=>{if(!ok)throw new Error('Source global controls: '+message)};
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
const key=(group,id)=>group+':'+String(id);
const fresh=()=>({records:new Map(),cameraInitialized:false,pending:null,restore:null,interruption:null});
const defaultRecord=()=>({tone:[100,100,100],mode:0,attributes:[-1,-1,-1,-1,-1]});
function recordFor(state,group,id){const bank=key(group,id);if(!state.records.has(bank))state.records.set(bank,defaultRecord());return state.records.get(bank)}
function bankParts(bank){const m=/^(bg|cg|eg|fg|fw|pl|mpl):(0|[1-9]\d*)$/.exec(bank);require(m&&Number(m[2])<capacities[m[1]],'unsupported physical bank');return [m[1],m[2]]}
function savedControls(state){return {version:1,policy:SOURCE_NEUTRAL_GLOBAL_POLICY,cameraInitialized:state.cameraInitialized,records:[...state.records].map(([bank,value])=>({bank,...copy(value)}))}}
export function validateSourceNeutralGlobalControls(value){
 require(exact(value,['version','policy','cameraInitialized','records'])&&value.version===1&&value.policy===SOURCE_NEUTRAL_GLOBAL_POLICY&&typeof value.cameraInitialized==='boolean'&&Array.isArray(value.records)&&value.records.length<=69,'invalid saved controls');
 const state=fresh();state.cameraInitialized=value.cameraInitialized;
 for(const row of value.records){
  require(exact(row,['bank','tone','mode','attributes']),'invalid saved bank fields');bankParts(row.bank);require(!state.records.has(row.bank),'duplicate saved bank');
  require(Array.isArray(row.tone)&&row.tone.length===3&&row.tone.every(v=>v===100),'non-neutral saved tone');
  require(row.mode===0||(row.mode===2&&modes.has(row.bank)),'unsupported saved mode');
  require(Array.isArray(row.attributes)&&row.attributes.length===5&&(row.attributes.every(v=>v===-1)||row.attributes.every((v,i)=>v===401+i)),'unsupported saved attribute destinations');
  state.records.set(row.bank,{tone:[...row.tone],mode:row.mode,attributes:[...row.attributes]});
 }
 return state;
}

// The source attr_def handler changes destination variable numbers, never the
// PL rectangle. Consume only the observed bindings, so the strict parent PL
// reload guard remains in effect for every other command. Sepia is observed
// and forwarded to the existing port renderer; it is not certified here as
// the original bitmap CPU filter or E-mote driver shader.
export function withSourceNeutralGlobalControls(BaseRenderer){return class SourceNeutralGlobalControls extends BaseRenderer{
 constructor(...args){super(...args);const enabled=args[0]?.sourceNeutralGlobalControls??false;require(typeof enabled==='boolean','boolean opt-in required');this.sourceNeutralGlobalControls=enabled;stateOf.set(this,fresh());}
 applySourceGlobalRecord(layer){
  if(!this.sourceNeutralGlobalControls||!Object.hasOwn(capacities,layer.group))return layer;
  const state=stateOf.get(this);if(!state)return layer;const value=state.records.get(key(layer.group,layer.id))??defaultRecord();
  layer.sourceTone=[...value.tone];layer.sourceAttributeDestinations=[...value.attributes];layer.mode=value.mode===2?'sepia':undefined;return layer;
 }
 bank(...args){const layer=super.bank(...args);return this.applySourceGlobalRecord(layer);}
 initialize(layer,...rest){const result=super.initialize(layer,...rest);this.applySourceGlobalRecord(layer);this.place(layer);return result;}
 reset(...args){
  const state=stateOf.get(this),old=state?.restore;
  if(this.sourceNeutralGlobalControls&&state){
   if(old){require(typeof this.cancelPortMotionRestore==='function','whole-restore cancellation owner required');state.interruption=old.settled;this.cancelPortMotionRestore();state.restore=null;}
   state.pending=null;state.records=new Map();state.cameraInitialized=false;
  }
  // The real whole owner's resetFromRestore uses its own lexical super.reset.
  // Every reset reaching this outer wrapper is a NORMAL reset, never an
  // instruction to commit a pending save's controls.
  return super.reset(...args);
 }
 sourceGlobalControlsSnapshot(){require(this.sourceNeutralGlobalControls,'controls disabled');return savedControls(stateOf.get(this));}
 rollbackSourceGlobalControls(previous){
  const state=stateOf.get(this);state.records=copyRecords(previous.records);state.cameraInitialized=previous.cameraInitialized;
  for(const layer of this.layers.values()){this.applySourceGlobalRecord(layer);this.place(layer);}
 }
 cancelSourceImageRestoreForNormalOperation(options){
  const state=stateOf.get(this),old=state?.restore;
  if(this.sourceNeutralGlobalControls&&old&&options?.restoreTransaction===undefined){
   require(typeof this.cancelPortMotionRestore==='function','whole-restore cancellation owner required');this.cancelPortMotionRestore();
   state.interruption=old.settled;state.restore=null;state.pending=null;this.rollbackSourceGlobalControls(old.previousControls);
  }
  return super.cancelSourceImageRestoreForNormalOperation?.(options);
 }
 async interruptSourceGlobalRestore(){
  const state=stateOf.get(this);
  for(;;){
   const old=state.restore;
   if(!old){const wait=state.interruption;if(!wait)return;await wait;if(state.interruption===wait)state.interruption=null;continue;}
  // Use the real whole-restore owner before any new bank mutation. Its public
  // cancellation disposes the registered Bitmap/Character child transactions.
  // Wait for that owned operation to settle, never for its stale provider.
  require(typeof this.cancelPortMotionRestore==='function','whole-restore cancellation owner required');
   state.interruption=old.settled;this.cancelPortMotionRestore();this.cancelSourceImageRestoreForNormalOperation?.();
   state.restore=null;state.pending=null;await old.settled;if(state.interruption===old.settled)state.interruption=null;
  }
 }
 async command(cmd,args,state,...rest){
  if(!this.sourceNeutralGlobalControls)return super.command(cmd,args,state,...rest);
  await this.interruptSourceGlobalRestore();
  const parts=argumentsOf(args),owned=stateOf.get(this);
  if(cmd==='cam'){
   require(!parts.length||parts.length===2&&parts[0]==='0'&&['pos','scale'].includes(parts[1]),'camera outside the three source-used neutral forms');
   // Every source scene camera command is neutral. No arbitrary camera move,
   // rotation or original Windows camera/capture matrix is fabricated.
   owned.cameraInitialized=true;return;
  }
  if(!Object.hasOwn(capacities,cmd))return super.command(cmd,args,state,...rest);
  const operation=parts[0];
  if(['tone','mode','attr_def'].includes(operation)){
   const parameters=parts.slice(1);
   if(operation==='tone')require(parameters.length===0||parameters.length===3&&parameters.every(v=>numericArgument(v,state)===100),'tone outside the used neutral domain');
   else if(operation==='mode')require(parameters.length===0,'global mode outside the used omitted default');
   else require(parameters.length===5&&parameters.every((v,i)=>v===String(401+i)),'attr_def outside the five source-used destination IDs');
   for(let id=0;id<capacities[cmd];id++){
    const value=recordFor(owned,cmd,String(id));
    if(operation==='tone')value.tone=[100,100,100];else if(operation==='mode')value.mode=0;else value.attributes=[401,402,403,404,405];
    const layer=this.layers.get(key(cmd,id));if(layer){this.applySourceGlobalRecord(layer);this.place(layer);}
   }
   return;
  }
  // Preserve source mode state across future bank access, initialization and
  // own-save. The original filter implementation is a separate opt-in scope.
  if(parts[1]==='mode'){
   const ids=layerIds(parts[0],state);require(parts.length===3&&parts[2]==='sepia'&&ids.length===1&&modes.has(key(cmd,ids[0])),'bank mode outside the used sepia allowlist');
   const result=await super.command(cmd,args,state,...rest);recordFor(owned,cmd,ids[0]).mode=2;this.applySourceGlobalRecord(this.bank(cmd,ids[0]));return result;
  }
  return super.command(cmd,args,state,...rest);
 }
 snapshot(...args){const result=super.snapshot(...args);if(!this.sourceNeutralGlobalControls)return result;return {...result,sourceNeutralGlobalControls:this.sourceGlobalControlsSnapshot()};}
 validateSave(saved,...rest){if(this.sourceNeutralGlobalControls)validateSourceNeutralGlobalControls(saved?.sourceNeutralGlobalControls);return super.validateSave(saved,...rest);}
 async restore(saved,...rest){
  if(!this.sourceNeutralGlobalControls)return super.restore(saved,...rest);
  const next=validateSourceNeutralGlobalControls(saved?.sourceNeutralGlobalControls),transaction=restoreTransactionFromOptions(rest[0]),state=stateOf.get(this);assertRestoreActive(transaction);
  await this.interruptSourceGlobalRestore();assertRestoreActive(transaction);
  let settle,committed=false;const token={settled:new Promise(resolve=>{settle=resolve}),previousControls:{records:copyRecords(state.records),cameraInitialized:state.cameraInitialized}};
  state.pending=next;state.restore=token;
  try{await super.restore(saved,...rest);assertRestoreActive(transaction);require(state.restore===token,'superseded controls restore');state.records=copyRecords(next.records);state.cameraInitialized=next.cameraInitialized;for(const layer of this.layers.values()){this.applySourceGlobalRecord(layer);this.place(layer);}committed=true;}
  finally{try{if(state.restore===token){state.pending=null;state.restore=null;if(!committed)this.rollbackSourceGlobalControls(token.previousControls);}}finally{settle();}}
 }
};}
function copyRecords(records){return new Map([...records].map(([bank,value])=>[bank,copy(value)]))}
