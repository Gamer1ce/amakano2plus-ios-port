import {argumentsOf} from './expressions.js';
import {layerIds} from './renderer.js';
import {parseSourceLpb,sourceLpbScalarAtCounter} from './source-lpb-scalar-f32.js';
import {SourceLipCounter,isSourceLipCounter,sourceLipCounterValue} from './source-lip-counter.mjs';
import {isSourceBlinkRNG,createSourceBlinkRNG,copySourceBlinkRNGState,restoreSourceBlinkRNGState,createSourceBlinkController,sourceBlinkControllerState,restoreSourceBlinkController,setSourceBlinkControllerEnabled,sourceBlinkFrameAtTick} from './source-blink-controller.js';
import {restoreTransactionFromOptions,assertRestoreActive} from './restore-transaction.js';
import {PortOwnSaveFrameClock} from './source-save-clock-owner.js';
import {SourceLpbRepository} from './source-lpb-repository.js';
import {registerRestoreChild,withSharedSourceSnapshot,awaitSourceRestore} from './source-performance-restore-coordinator.js';

// Actual ordinary named-pattern terminal scalar, selected-node/reset order,
// explicit LPB counters and blink arithmetic. Source visual fade20 is not a
// fabricated linear tween. Saved deadlines use the common port-owned clock.
export const SOURCE_CHARACTER_SAVE_POLICY='port-own-source-characters';
const require=(condition,message)=>{if(!condition)throw new Error('Source characters: '+message)};
const clone=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value)}return value};
const identical=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=layer=>`${layer.group}:${layer.id}`;
const u32=(v,label)=>{require(Number.isInteger(v)&&v>=0&&v<=0xffffffff,`uint32 ${label} required`);return v};
const stores=new WeakMap();
const FLAGS=['lipEnabled','blinkEnabled','force158','force110','field9c','field10c','argument0c'];
function checkedFlags(value){
 require(value&&typeof value==='object'&&Object.keys(value).length===FLAGS.length&&FLAGS.every(k=>Object.hasOwn(value,k)),'complete original flag context required');
 const f={};for(const n of FLAGS){require(typeof value[n]==='boolean',`explicit ${n} required`);f[n]=value[n]}return f;
}
export function sourceCharacterSelection(lipOracle,blinkOracle,profile,variant,digits){
 require(typeof profile==='string'&&typeof variant==='string'&&Array.isArray(digits)&&digits.length<=32&&digits.every(d=>typeof d==='string'&&d.length<=32),'exact source profile/vector required');
 const joinKey=`${profile.toLowerCase()}/${variant}`,join=lipOracle.profiles[joinKey],blinkJoin=blinkOracle.profiles[joinKey];
 require(join&&blinkJoin&&join.model===blinkJoin.model&&join.configuration===blinkJoin.configuration,'original profile joins unavailable or differ');
 const config=lipOracle.configurations[join.configuration],blinkConfig=blinkOracle.configurations[blinkJoin.configuration];
 require(config&&blinkConfig&&!blinkConfig.unresolved.length,'unclosed source blink include');
 let lipNode=null;for(let i=digits.length-1;i>=0;i--){const k=`${i+1}:${digits[i]}`;require(!config.unresolvedLipRows.some(r=>r.position===String(i+1)&&r.selector===digits[i]),'unclosed original lip node');if(config.lipNodes[k]){lipNode=config.lipNodes[k];break}}
 const blinkNodes=[];for(let i=0;i<digits.length;i++){const n=blinkConfig.nodes[`${i+1}:${digits[i]}`];if(n)blinkNodes.push(n)}
 return {profile:profile.toLowerCase(),variant,model:join.model,configuration:join.configuration,config,digits:[...digits],lipNode,blinkNodes};
}
function configuredLabels(selection){
 const labels=new Set([...selection.blinkNodes.map(n=>n.variable),...(selection.lipNode?[selection.lipNode.variable]:[])]);
 for(let i=0;i<selection.digits.length;i++)for(const label of Object.keys(selection.config.patterns[`${i+1}:${selection.digits[i]}`]??{}))labels.add(label);
 return labels;
}
function activeRecord(renderer,layer){const s=stores.get(renderer),r=s.models.get(layer);require(r&&r.player===layer.player&&layer.asset===r.selection.model,'prepared current source character required');return r}
function cancelContext(context){if(!context)return;for(const dispose of [...context.resources]){try{dispose()}catch(error){context.cleanupErrors.push(error)}}context.resources.clear()}
function cancelPending(store,layer){store.pending.get(layer)?.controller.abort();store.pending.delete(layer)}
function detach(renderer,layer,{restoreBase=true}={}){
 const s=stores.get(renderer),binding=s.bindings.get(layer);cancelPending(s,layer);if(!binding)return;
 s.bindings.delete(layer);for(const [event,listener] of Object.entries(binding.listeners))binding.audio.removeEventListener(event,listener);
 const r=s.models.get(layer);if(restoreBase&&binding.wrote&&r&&r.player===layer.player&&layer.asset===r.selection.model&&r.selection.lipNode)r.player.setVariable(r.selection.lipNode.variable,Math.fround(r.selection.lipNode.initialBase));
}
function installBinding(renderer,layer,{channel,audio,name,counter,enabled,nodeActive,loaded,ownerTransaction=null}){
 const s=stores.get(renderer),r=activeRecord(renderer,layer),record={sha256:loaded.sha256,bytes:loaded.bytes?.byteLength};
 require(loaded.kind==='source-lpb-bytes'&&loaded.name===name,'verified present source LPB required');
 const config=r.selection.config;require(identical(config.initialControllerRange,[0,5]),'unclosed source LPB range');
 const plan=r.selection.lipNode?parseSourceLpb(loaded.bytes,{weights:config.weights,smoothRadius:config.smoothRadius}):null;
 detach(renderer,layer);const listeners={},terminate=()=>detach(renderer,layer);
 for(const event of ['ended','emptied','error']){listeners[event]=terminate;audio.addEventListener(event,terminate)}
 const binding={ownerTransaction,identityToken:Object.freeze({}),channel,audio,name,counter,enabled,nodeActive:nodeActive&&!!r.selection.lipNode,record,plan,listeners,wrote:false,loadedBytes:new Uint8Array(loaded.bytes)};s.bindings.set(layer,binding);
 if(!enabled&&r.selection.lipNode)r.player.setVariable(r.selection.lipNode.variable,Math.fround(r.selection.lipNode.initialBase));return binding;
}
export function withSourceCharacterPerformance(BaseRenderer){
 require(BaseRenderer.sourceRestoreTransactionVersion===1,'transaction-aware source parent required');
 return class SourceCharacterPerformanceRenderer extends BaseRenderer{
  constructor(options){
   const enabled=options.sourceCharacterPerformance??false;require(typeof enabled==='boolean','boolean feature gate required');
   if(enabled){
    require(options.sourceLipOracle?.schemaVersion===1&&options.sourceBlinkOracle?.schemaVersion===1,'source profile oracles required');
    require(isSourceBlinkRNG(options.sourceBlinkRng),'shared original RNG state required');
    require(options.sourcePerformanceClock instanceof PortOwnSaveFrameClock,'port-owned shared save clock required');
    require(options.sourceLpbRepository instanceof SourceLpbRepository,'full source LPB repository required');
   }
   super(options);this.sourceCharacterPerformance=enabled;
   stores.set(this,{lipOracle:enabled?freeze(clone(options.sourceLipOracle)):null,blinkOracle:enabled?freeze(clone(options.sourceBlinkOracle)):null,
    rng:options.sourceBlinkRng,clock:options.sourcePerformanceClock,repository:options.sourceLpbRepository,models:new Map(),flags:new Map(),bindings:new Map(),pending:new Map(),restore:null});
  }
  setSourceCharacterFlags(layer,flags){const f=checkedFlags(flags),s=stores.get(this),old=s.models.get(layer),previous=s.flags.get(key(layer));if(old)activeRecord(this,layer);s.flags.set(key(layer),f);if(old){if(previous.blinkEnabled!==f.blinkEnabled)this.setSourceBlinkEnabled(layer,f.blinkEnabled);if(previous.lipEnabled!==f.lipEnabled)this.setSourceLipEnabled(layer,f.lipEnabled)}}
  sourceCharacterRestoreIsResetting(){return stores.get(this).restore?.resetting===true}
  sourceCharacterFlags(layer){const flags=stores.get(this).flags.get(key(layer));return flags?{...flags}:null}
  sourceBoundLipIdentity(layer){const s=stores.get(this),b=s.bindings.get(layer);if(!b)return null;activeRecord(this,layer);require(this.audio.get(b.channel)===b.audio&&this.audioState.get(b.channel)?.name===b.name,'stale bound source identity');return {identityToken:b.identityToken,channel:b.channel,audio:b.audio,name:b.name,counter:b.counter,enabled:b.enabled,nodeActive:b.nodeActive};}
  clearSourceLipBinding(layer){activeRecord(this,layer);detach(this,layer);}
  clearSourceLipBindingOwnedBy(layer,transaction){const b=stores.get(this).bindings.get(layer);if(!b||b.ownerTransaction!==transaction)return false;activeRecord(this,layer);detach(this,layer);return true;}
  sourceCharacterState(layer){const s=stores.get(this),r=s.models.get(layer),b=s.bindings.get(layer);return r?{selection:clone({profile:r.selection.profile,variant:r.selection.variant,model:r.selection.model,digits:r.selection.digits}),flags:{...s.flags.get(key(layer))},blink:r.controllers.map(sourceBlinkControllerState),lip:b?{channel:b.channel,name:b.name,enabled:b.enabled,nodeActive:b.nodeActive,counter:b.counter.snapshot()}:null}:null}
  async character(layer,values,...rest){
   if(!this.sourceCharacterPerformance)return super.character(layer,values,...rest);
   const s=stores.get(this),transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
   // Prepared saved vectors belong only to the exact restore proxy. A normal
   // operation supersedes that owner; it must never be rewritten as a save load.
   if(s.restore&&transaction!==s.restore.proxy){cancelContext(s.restore);s.restore=null;}
   const restoring=s.restore?.preparedBanks.get(key(layer));
   const actual=restoring?[restoring.saved.profile,restoring.saved.variant,...restoring.saved.digits]:values;
   if(restoring)s.flags.set(key(layer),{...restoring.saved.flags});
   const [profile,variant,...digits]=actual,selection=sourceCharacterSelection(s.lipOracle,s.blinkOracle,profile,variant,digits),flags=s.flags.get(key(layer));require(flags,'explicit original bank flags required');
   require(this.profiles[profile.toLowerCase()]?.variants[variant]?.model===selection.model,'converted/source model join differs');
   const old=s.models.get(layer),same=old&&old.player===layer.player&&layer.asset===selection.model&&old.selection.profile===selection.profile&&old.selection.variant===variant;
   if(same&&identical(old.selection.digits,digits)&&!flags.force158&&!flags.force110&&!restoring)return;
   // Prevalidate the scalar sink before a same-player update. Parent applies
   // ordinary terminal values, then actual source selected blink/lip resets.
   if(layer.player&&layer.asset===selection.model)for(const label of configuredLabels(selection))require(layer.player.variableList?.some(v=>v.label===label),`configured SDK variable absent: ${label}`);
   if(old&&!same)detach(this,layer);
   cancelPending(s,layer);
   // Keep the parent model/layout/timeline load, but suppress its broad
   // reapplication of unchanged positions. The source handler481f2e skips
   // identical per-position selectors unless force158 is set.
   await super.character(layer,[profile,variant],...rest);assertRestoreActive(transaction);
   require(layer.player&&layer.asset===selection.model,'source character did not commit');
   for(const label of configuredLabels(selection))require(layer.player.variableList?.some(v=>v.label===label),`configured SDK variable absent: ${label}`);
   let applied=false;const queue=[];
   if(!restoring){
    const tick=s.clock.currentTick();
    for(let i=0;i<digits.length;i++){
     if(same&&old.selection.digits[i]===digits[i]&&!flags.force158)continue;
     const pattern=selection.config.patterns[`${i+1}:${digits[i]}`];
     if(!pattern)continue;
     const kind=same&&!flags.field9c&&flags.argument0c&&flags.field10c?5:0;
     queue.push({position:i+1,old:same?old.selection.digits[i]??null:null,selector:digits[i],kind,duration:kind===5?20:0,start:tick,end:(tick+(kind===5?20:0))>>>0});
     for(const [label,value]of Object.entries(pattern)){require(Number.isFinite(Math.fround(value)),'source pattern nonfinite');layer.player.setVariable(label,Math.fround(value))}applied=true;
    }
   }
   const controllers=selection.blinkNodes.map(n=>createSourceBlinkController(n,s.rng,{enabled:flags.blinkEnabled,selected:true}));
   const record={selection,player:layer.player,controllers,queue};s.models.set(layer,record);
   const binding=s.bindings.get(layer);
   if(same&&binding){binding.plan=selection.lipNode?parseSourceLpb(binding.loadedBytes,{weights:selection.config.weights,smoothRadius:selection.config.smoothRadius}):null;if(applied){binding.nodeActive=false;binding.wrote=false;}}
   if(same&&!restoring){
    // Source OR-a4 restoration happens once any ordinary position applies.
    if(applied){for(const n of selection.blinkNodes)layer.player.setVariable(n.variable,Math.fround(n.initialBase));if(selection.lipNode)layer.player.setVariable(selection.lipNode.variable,Math.fround(selection.lipNode.initialBase));}
   }
   if(restoring){record.controllers=restoring.saved.blink.map((entry,i)=>restoreSourceBlinkController(selection.blinkNodes[i],s.rng,entry));}
  }
  async bindSourceLip(layer,{channel,audio,name,counter,enabled}={},...rest){
   require(this.sourceCharacterPerformance,'source feature disabled');const s=stores.get(this),transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
   require(typeof channel==='string'&&/^voice(?:0|[1-9]\d*)$/.test(channel),'real voice channel required');
   require(audio&&this.audio.get(channel)===audio&&this.audioState.get(channel)?.name===name,'current real voice identity required');
   require(isSourceLipCounter(counter)&&typeof enabled==='boolean','branded source counter and explicit flag required');
   const r=activeRecord(this,layer);require(s.flags.get(key(layer)).lipEnabled===enabled,'binding must use current source lip flag');cancelPending(s,layer);const pending={channel,controller:new AbortController()};s.pending.set(layer,pending);
   try{
    const loaded=await s.repository.read(name,{signal:pending.controller.signal,...(transaction?{restoreTransaction:transaction}:{})});assertRestoreActive(transaction);
    require(loaded.kind==='source-lpb-bytes','missing LPB backend D4 is outside this source-LPB path');
    require(s.pending.get(layer)===pending&&s.models.get(layer)===r&&layer.player===r.player&&layer.asset===r.selection.model&&this.audio.get(channel)===audio&&this.audioState.get(channel)?.name===name&&s.flags.get(key(layer)).lipEnabled===enabled,'source changed during LPB read');
    const binding=installBinding(this,layer,{channel,audio,name,counter,enabled,nodeActive:enabled,loaded,ownerTransaction:transaction});binding.loadedBytes=new Uint8Array(loaded.bytes);
    return {kind:'source-lpb-bound',name,sourceSHA256:loaded.sha256,nodeActive:binding.nodeActive};
   }finally{if(s.pending.get(layer)===pending)cancelPending(s,layer)}
  }
  setSourceLipEnabled(layer,enabled){
   require(typeof enabled==='boolean','explicit source lip flag required');const s=stores.get(this),r=activeRecord(this,layer),flags=s.flags.get(key(layer));flags.lipEnabled=enabled;
   const b=s.bindings.get(layer);if(!b)return;b.enabled=enabled;b.nodeActive=enabled&&!!r.selection.lipNode;
   if(!enabled&&r.selection.lipNode){r.player.setVariable(r.selection.lipNode.variable,Math.fround(r.selection.lipNode.initialBase));b.wrote=false;}
  }
  setSourceBlinkEnabled(layer,enabled){
   require(typeof enabled==='boolean','explicit source blink flag required');const s=stores.get(this),r=activeRecord(this,layer);s.flags.get(key(layer)).blinkEnabled=enabled;
   for(const controller of r.controllers){const write=setSourceBlinkControllerEnabled(controller,enabled);if(write)r.player.setVariable(write.variable,write.value)}
  }
  applySourceCharacterFrame(layer,{backendAvailable}={}){
   require(typeof backendAvailable==='boolean','explicit backend availability required');const s=stores.get(this),r=activeRecord(this,layer),tick=s.clock.currentTick(),writes=[];
   for(const controller of r.controllers){const w=sourceBlinkFrameAtTick(controller,tick);if(w){r.player.setVariable(w.variable,w.value);writes.push(w)}}
   const b=s.bindings.get(layer);if(b){require(this.audio.get(b.channel)===b.audio&&this.audioState.get(b.channel)?.name===b.name,'stale source voice');if(b.enabled&&b.nodeActive&&r.selection.lipNode){const dc=sourceLipCounterValue(b.counter,{backendAvailable}),counter=dc<0&&dc!==-1?dc>>>0:dc,n=r.selection.lipNode,value=sourceLpbScalarAtCounter(b.plan,counter,{minimum:0,maximum:5,latency:r.selection.config.latency});r.player.setVariable(n.variable,value);b.wrote=true;writes.push({kind:'source-lpb-scalar',variable:n.variable,value,counter})}}
   return writes;
  }
  clear(layer,...rest){const s=stores.get(this);if(s){detach(this,layer);s.models.delete(layer)}return super.clear(layer,...rest)}
  stopSound(channel,...rest){const s=stores.get(this);for(const [layer,pending]of s?.pending??[])if(pending.channel===channel)cancelPending(s,layer);for(const [layer,binding]of s?.bindings??[])if(binding.channel===channel)detach(this,layer);return super.stopSound(channel,...rest)}
  reset(...rest){const s=stores.get(this);if(s){if(!s.restore?.resetting){cancelContext(s.restore);s.restore=null}for(const layer of [...s.pending.keys()])cancelPending(s,layer);for(const layer of [...s.bindings.keys()])detach(this,layer);s.models.clear();s.flags.clear()}return super.reset(...rest)}
  snapshot(...rest){
   if(!this.sourceCharacterPerformance)return super.snapshot(...rest);const s=stores.get(this);require(!s.restore,'pending restore cannot be saved');require(!s.pending.size,'pending source read cannot be saved');
   return withSharedSourceSnapshot(s.clock,clock=>{
    const data=super.snapshot(...rest),banks=[];
    for(const [layer,r]of s.models){activeRecord(this,layer);const b=s.bindings.get(layer);if(b)require(this.audio.get(b.channel)===b.audio&&this.audioState.get(b.channel)?.name===b.name,'stale source voice save');banks.push({group:layer.group,id:String(layer.id),profile:r.selection.profile,variant:r.selection.variant,digits:[...r.selection.digits],flags:{...s.flags.get(key(layer))},blink:r.controllers.map(sourceBlinkControllerState),lip:b?{channel:b.channel,name:b.name,sourceSHA256:b.record.sha256,enabled:b.enabled,nodeActive:b.nodeActive,wrote:b.wrote,counter:{...b.counter.snapshot()}}:null})}
    return {...data,sourceCharacters:{version:1,policy:SOURCE_CHARACTER_SAVE_POLICY,clock:{...clock},rng:copySourceBlinkRNGState(s.rng),banks}};
   });
  }
  validateSave(saved,...rest){
   const data=super.validateSave(saved,...rest);if(!this.sourceCharacterPerformance)return data;
   const s=stores.get(this),extra=data.sourceCharacters;require(extra?.version===1&&extra.policy===SOURCE_CHARACTER_SAVE_POLICY&&Array.isArray(extra.banks)&&extra.banks.length<=12,'source own-save descriptor required');
   s.clock.validateClockSnapshot(extra.clock);createSourceBlinkRNG(extra.rng);
   const keys=new Set(),channels=new Map();
   for(const bank of extra.banks){
    const k=`${bank.group}:${bank.id}`;require(!keys.has(k)&&['mpl','fmpl'].includes(bank.group)&&/^\d+$/.test(bank.id),'source saved bank invalid or duplicate');keys.add(k);
    const layer=data.layers.find(l=>`${l.group}:${l.id}`===k);require(layer?.emote&&layer.profile===bank.profile&&layer.variant===bank.variant,'saved character metadata differs');
    const selection=sourceCharacterSelection(s.lipOracle,s.blinkOracle,bank.profile,bank.variant,bank.digits);require(selection.model===layer.asset,'saved model/source differs');checkedFlags(bank.flags);require(Array.isArray(layer.variables)&&layer.variables.every(v=>typeof v.label==='string'&&Number.isFinite(v.value)),'finite saved SDK variables required');for(const label of configuredLabels(selection))require(layer.variables.some(v=>v.label===label),'saved configured variable absent');
    require(Array.isArray(bank.blink)&&bank.blink.length===selection.blinkNodes.length,'saved blink selection differs');
    bank.blink.forEach((entry,i)=>{restoreSourceBlinkController(selection.blinkNodes[i],s.rng,entry);require(entry.selected===true&&entry.enabled===bank.flags.blinkEnabled,'saved blink flags differ')});
    if(bank.lip){const b=bank.lip;require(typeof b.enabled==='boolean'&&typeof b.nodeActive==='boolean'&&typeof b.wrote==='boolean'&&b.enabled===bank.flags.lipEnabled&&(!b.nodeActive||b.enabled&&selection.lipNode),'saved lip flags differ');new SourceLipCounter(b.counter);require(typeof b.sourceSHA256==='string'&&/^[a-f0-9]{64}$/.test(b.sourceSHA256),'saved LPB pin required');require(/^voice(?:0|[1-9]\d*)$/.test(b.channel)&&data.audio.some(a=>a.channel===b.channel&&a.name===b.name),'saved voice/source differs');if(channels.has(b.channel))require(identical(channels.get(b.channel),{name:b.name,counter:b.counter}),'shared saved counter differs');else channels.set(b.channel,{name:b.name,counter:b.counter});}
   }
   require(data.layers.filter(l=>l.emote).length===keys.size,'orphan saved character');return data;
  }
  async restore(saved,...rest){
   if(!this.sourceCharacterPerformance)return super.restore(saved,...rest);const s=stores.get(this),transaction=restoreTransactionFromOptions(rest[0]);require(transaction,'explicit restore owner required');assertRestoreActive(transaction);
   const data=clone(this.validateSave(saved,...rest)),context={preparedBanks:new Map(),resetting:false,resources:new Set(),cleanupErrors:[]};cancelContext(s.restore);s.restore=context;
   const proxy={assertActive:()=>{require(s.restore===context,'superseded source restore');transaction.assertActive()},registerResource:dispose=>{proxy.assertActive();const owned=()=>{context.resources.delete(owned);dispose()};const unregister=transaction.registerResource(owned);require(typeof unregister==='function','restore unregister required');context.resources.add(owned);return ()=>{context.resources.delete(owned);unregister()}},resetFromRestore:(...args)=>{proxy.assertActive();context.resetting=true;try{s.clock.restoreClock(data.sourceCharacters.clock,{restoreTransaction:proxy});restoreSourceBlinkRNGState(s.rng,data.sourceCharacters.rng);return transaction.resetFromRestore(...args)}finally{context.resetting=false}}};
   registerRestoreChild(proxy,transaction);
   context.proxy=proxy;const options={...(rest[0]??{}),restoreTransaction:proxy},tail=[options,...rest.slice(1)];
   try{
    for(const bank of data.sourceCharacters.banks){let loaded=null;if(bank.lip){loaded=await s.repository.read(bank.lip.name,{restoreTransaction:proxy});proxy.assertActive();require(loaded.kind==='source-lpb-bytes'&&loaded.sha256===bank.lip.sourceSHA256,'saved original LPB unavailable or pin differs');const selection=sourceCharacterSelection(s.lipOracle,s.blinkOracle,bank.profile,bank.variant,bank.digits);if(selection.lipNode)parseSourceLpb(loaded.bytes,{weights:selection.config.weights,smoothRadius:selection.config.smoothRadius});}context.preparedBanks.set(`${bank.group}:${bank.id}`,{saved:bank,loaded})}
    proxy.assertActive();await awaitSourceRestore(proxy,()=>super.restore(data,...tail));proxy.assertActive();const counters=new Map();
    for(const {saved:bank,loaded}of context.preparedBanks.values())if(bank.lip){const layer=this.bank(bank.group,bank.id),b=bank.lip,audio=this.audio.get(b.channel);require(audio&&this.audioState.get(b.channel)?.name===b.name,'restored actual Audio differs');if(!counters.has(b.channel))counters.set(b.channel,new SourceLipCounter(b.counter));const binding=installBinding(this,layer,{channel:b.channel,audio,name:b.name,counter:counters.get(b.channel),enabled:b.enabled,nodeActive:b.nodeActive,loaded});binding.wrote=b.wrote;}
    proxy.assertActive();
   }finally{cancelContext(context);if(s.restore===context)s.restore=null;require(!context.cleanupErrors.length,'restore resource cleanup failed')}
  }
  async command(command,args,state,...rest){
   if(this.sourceCharacterPerformance&&['mpl','fmpl'].includes(command)){
    const parts=argumentsOf(args);if(['m2enable_lip','m2enable_blink'].includes(parts[1])){require(parts.length===3,'source enable arity unsupported');const value=this.numeric(parts[2],state);require(value===0||value===1,'source enable outside0/1');for(const id of layerIds(parts[0],state)){const layer=this.bank(command,id),s=stores.get(this),f=s.flags.get(key(layer));require(f,'explicit source flags required');if(s.models.has(layer)){if(parts[1]==='m2enable_lip')this.setSourceLipEnabled(layer,!!value);else this.setSourceBlinkEnabled(layer,!!value)}else f[parts[1]==='m2enable_lip'?'lipEnabled':'blinkEnabled']=!!value;}return;}
   }
   return super.command(command,args,state,...rest);
  }
 };
}
