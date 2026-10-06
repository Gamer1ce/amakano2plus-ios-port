import {SOURCE_SNDANM_CONFIG,sourceActorBankLocation} from './source-auto-lip-plan.mjs';
import {SourceLipCounter,isSourceLipCounter,sourceLipCounterUpdate} from './source-lip-counter.mjs';
import {PortOwnSaveFrameClock} from './source-save-clock-owner.js';
import {restoreTransactionFromOptions,assertRestoreActive} from './restore-transaction.js';
import {sourceCharacterSelection} from './source-character-performance.js';
import {SourceLpbRepository} from './source-lpb-repository.js';
const stores=new WeakMap();
const require=(v,m)=>{if(!v)throw new Error('Source voice slot: '+m)};
const clone=v=>JSON.parse(JSON.stringify(v));
const unsigned=v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff;
const signed=v=>Number.isInteger(v)&&v>=-0x80000000&&v<=0x7fffffff;
const ascii=v=>typeof v==='string'&&v.length<=128&&/^[\x01-\x7f]*$/.test(v);
const fold=v=>v.replace(/[A-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+32));
const prefix=(v,p)=>fold(v.slice(0,p.length))===fold(p);
const index=v=>{require(Number.isInteger(v)&&v>=12&&v<=22,'explicit original PCM record12..22 required');return v};
function actorFields(actors){
 require(Array.isArray(actors)&&actors.length===12,'complete source actor67..78 snapshot required');const seen=new Set();
 return actors.map(a=>{require(a&&Number.isInteger(a.bank)&&a.bank>=67&&a.bank<=78&&!seen.has(a.bank)&&ascii(a.name)&&signed(a.field4)&&unsigned(a.flags888)&&typeof a.taskAvailable==='boolean','invalid source actor fields');seen.add(a.bank);return {bank:a.bank,name:a.name,field4:a.field4,flags888:a.flags888,taskAvailable:a.taskAvailable}});
}
function checkedSound(fields){require(fields&&unsigned(fields.flags200)&&signed(fields.lipSpecified232)&&signed(fields.lipActorBank236),'explicit source sound200/232/236 fields required');return {flags200:fields.flags200,lipSpecified232:fields.lipSpecified232,lipActorBank236:fields.lipActorBank236}}
export function planPortSourceVoiceSlot({sourceIndex,name,soundFields,actors,configurationLoaded,mode,backendHandleAvailable}){
 index(sourceIndex);require(ascii(name)&&typeof configurationLoaded==='boolean'&&Number.isInteger(mode)&&typeof backendHandleAvailable==='boolean','explicit source mode/config/backend context required');
 const sound=checkedSound(soundFields),all=actorFields(actors),route=sound.lipSpecified232===0?'automatic':'selected',result={kind:'explicit-source-voice-slot-plan',sourceIndex,route,configurationIndex:null,matchedActors:[],reason:null};
 if(!backendHandleAvailable){result.reason='explicit-backend-unavailable';return result}if(!configurationLoaded||mode!==1){result.reason='source-configuration-gate';return result}
 if(sound.lipSpecified232!==0&&(sound.lipActorBank236<67||sound.lipActorBank236>78)){result.route=sound.lipActorBank236<27?'other-bank-binder':'unhandled-selected-bank';result.reason='outside-MPL-route';return result}
 if((sound.flags200&32)!==0||name===''){result.reason='source-sound-gate';return result}
 const configuration=SOURCE_SNDANM_CONFIG.find(row=>row.active&&prefix(name,row.sound));if(!configuration){result.reason='no-source-sound-prefix';return result}result.configurationIndex=configuration.index;
 for(const bank of route==='automatic'?Array.from({length:12},(_,i)=>67+i):[sound.lipActorBank236]){
  const a=all.find(a=>a.bank===bank);if(!a.name||!prefix(a.name,configuration.image)||(a.flags888&4)===0||a.field4===0)continue;
  result.matchedActors.push({...a});if(result.matchedActors.length===2)break;
 }
 if(!result.matchedActors.length)result.reason='no-source-actor-prefix-or-gates';return result;
}
// This deliberately never derives a physical record from first-unused Audio,
// invents a native handle/task ID, or maps audio.currentTime to native DC.
export function withExplicitSourceVoiceSlots(BaseRenderer){
 require(typeof BaseRenderer.prototype.bindSourceLip==='function','source character parent required');
 return class ExplicitSourceVoiceSlotRenderer extends BaseRenderer{
  constructor(options){
   const enabled=options.sourceVoiceSlotAdapter??false;require(typeof enabled==='boolean','explicit opt-in required');super(options);this.sourceVoiceSlotAdapter=enabled;
   if(enabled){require(this.sourceCharacterPerformance===true,'source characters must be enabled');require(options.sourcePerformanceClock instanceof PortOwnSaveFrameClock,'same source clock owner required')}
   stores.set(this,{clock:options.sourcePerformanceClock,slots:new Map(),pending:new Map(),restoring:false,repository:options.sourceLpbRepository,lipOracle:clone(options.sourceLipOracle??{}),blinkOracle:clone(options.sourceBlinkOracle??{}),genericOracle:clone(options.sourceGenericLipOracle??{}),emptyFlowPolicy:options.sourceEmptyFlowAbsencePolicy??false});
   if(enabled)require((options.sourceEmptyFlowAbsencePolicy??false)===false||options.sourceEmptyFlowAbsencePolicy==='source-empty-flow-preserve-initial-base','unsupported absent-LPB policy');
  }
  sourceVoiceSlotState(sourceIndex){const row=stores.get(this).slots.get(index(sourceIndex));return row?{sourceIndex:row.sourceIndex,channel:row.channel,name:row.name,soundFields:{...row.soundFields},actors:clone(row.actors),configurationLoaded:row.configurationLoaded,mode:row.mode,backendHandleAvailable:row.backendHandleAvailable,counter:{...row.counter.snapshot()},plan:clone(row.plan),...(row.fallback?{fallback:clone(row.fallback)}:{})}:null}
  async bindSourceVoiceSlot(value,...rest){
   require(this.sourceVoiceSlotAdapter,'adapter disabled');const s=stores.get(this),transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
   const {sourceIndex,channel,audio,name,counter,actors,configurationLoaded,mode,backendHandleAvailable}=value??{};index(sourceIndex);
   require(/^voice(?:0|[1-9]\d*)$/.test(channel)&&audio&&this.audio.get(channel)===audio&&this.audioState.get(channel)?.name===name,'explicit current real Audio/channel identity required');require(isSourceLipCounter(counter),'branded original arithmetic counter required');
   const soundFields=checkedSound(value.soundFields),ownedActors=actorFields(actors),plan=planPortSourceVoiceSlot({sourceIndex,name,soundFields,actors:ownedActors,configurationLoaded,mode,backendHandleAvailable});
   // Validate all already loaded task projections before the first binding.
   // name is explicit source+8 or a caller-certified prefix projection. The
   // module does not reconstruct that original raw string from joined digits.
   const tasks=[];for(const actor of plan.matchedActors){const where=sourceActorBankLocation(actor.bank),layer=this.layers.get(`${where.group}:${where.id}`);if(!actor.taskAvailable)continue;const state=layer&&this.sourceCharacterState(layer);require(state&&layer.player&&prefix(actor.name,state.selection.profile.slice(0,6))&&state.flags.lipEnabled,'source actor projection/current task differs');tasks.push(layer)}
   const selections=new Map(tasks.map(layer=>[layer,clone(this.sourceCharacterState(layer).selection)]));const assertTasks=()=>{for(const layer of tasks){const current=this.sourceCharacterState(layer);require(current&&JSON.stringify(current.selection)===JSON.stringify(selections.get(layer))&&current.flags.lipEnabled,'source actor changed during slot binding');}};
   for(const [i,row]of s.slots)require(i===sourceIndex||row.channel!==channel&&row.audio!==audio,'same current Audio cannot alias two physical slots');
   s.pending.get(sourceIndex)?.cancel();const resources=new Set(),pending={channel,audio,committed:false,cancel:()=>{if(s.pending.get(sourceIndex)===pending)s.pending.delete(sourceIndex);const errors=[];for(const d of [...resources])try{d()}catch(e){errors.push(e)}resources.clear();if(!pending.committed)for(const layer of tasks)try{this.clearSourceLipBindingOwnedBy(layer,proxy)}catch(e){errors.push(e)}require(!errors.length,'source slot cleanup failed: '+errors.map(e=>e.message).join('; '));}};s.pending.set(sourceIndex,pending);
   const proxy={assertActive(){assertRestoreActive(transaction);require(s.pending.get(sourceIndex)===pending,'superseded source slot')},resetFromRestore(){throw new Error('normal slot bind cannot reset')},registerResource(dispose){proxy.assertActive();let live=true,unregister=()=>{};const owned=()=>{if(!live)return;live=false;resources.delete(owned);unregister();dispose()};if(transaction)unregister=transaction.registerResource(owned);resources.add(owned);return()=>{if(!live)return;live=false;resources.delete(owned);unregister()}}};
   const tail=[{...(rest[0]??{}),restoreTransaction:proxy},...rest.slice(1)];
   try{
    let fallback=null;
    if(s.emptyFlowPolicy){
     require(s.repository instanceof SourceLpbRepository,'full typed source repository required');const loaded=await s.repository.read(name,{restoreTransaction:proxy});proxy.assertActive();assertTasks();
     if(loaded.kind==='source-lpb-absent'){
      require(s.genericOracle.schemaVersion===1,'actual generic table oracle required');const nodes=[];
      for(const layer of tasks){const state=this.sourceCharacterState(layer),selection=sourceCharacterSelection(s.lipOracle,s.blinkOracle,state.selection.profile,state.selection.variant,state.selection.digits),node=selection.lipNode;if(!node)continue;const original=s.genericOracle.configurations[selection.configuration]?.nodes[`${node.position}:${node.selector}`];require(original&&original.variable===node.variable&&Math.fround(original.initialBase)===Math.fround(node.initialBase)&&Array.isArray(original.flow)&&original.flow.length===0,'absent LPB requires exact source-closed empty-flow node');nodes.push({bank:layer.group==='mpl'?67+Number(layer.id):77+Number(layer.id),variable:original.variable,initialBase:Math.fround(original.initialBase),sourceConfigurationSHA256:original.sourceConfiguration.sha256});}
      fallback={policy:s.emptyFlowPolicy,kind:'source-lpb-absent',indexSHA256:loaded.indexSHA256,nodes,finiteOutputPolicy:'source empty-flow non-finite output is never sent to SDK; preserve selected initialBase'};
     }
    }
    if(!fallback)for(const layer of tasks){assertRestoreActive(transaction);assertTasks();require(s.pending.get(sourceIndex)===pending&&this.audio.get(channel)===audio&&this.audioState.get(channel)?.name===name,'superseded source slot');await this.bindSourceLip(layer,{channel,audio,name,counter,enabled:true},...tail);proxy.assertActive()}
    require(s.pending.get(sourceIndex)===pending&&this.audio.get(channel)===audio&&this.audioState.get(channel)?.name===name,'superseded source slot');
    const previous=s.slots.get(sourceIndex);
    if(previous)for(const actor of previous.plan.matchedActors){const where=sourceActorBankLocation(actor.bank),layer=this.layers.get(`${where.group}:${where.id}`);if(layer&&(!tasks.includes(layer)||fallback)){const b=this.sourceBoundLipIdentity(layer);if(b?.audio===previous.audio&&b.counter===previous.counter)this.clearSourceLipBinding(layer);}}
    if(fallback)for(const node of fallback.nodes){const w=sourceActorBankLocation(node.bank),layer=this.layers.get(`${w.group}:${w.id}`);proxy.assertActive();this.clearSourceLipBinding(layer);layer.player.setVariable(node.variable,node.initialBase);}
    s.slots.set(sourceIndex,{sourceIndex,channel,audio,name,counter,soundFields,actors:ownedActors,configurationLoaded,mode,backendHandleAvailable,plan,...(fallback?{fallback}:{})});
    pending.committed=true;return {...clone(plan),actualPortAudioChannel:channel,boundTaskCount:fallback?0:tasks.length,...(fallback?{fallback:clone(fallback)}:{}),identityPolicy:'explicit-original-index-plus-current-port-Audio; no-Windows-handle-invented'};
   }finally{if(s.pending.get(sourceIndex)===pending)pending.cancel()}
  }
  sourceVoiceSlotIdentity(sourceIndex){const row=stores.get(this).slots.get(index(sourceIndex));if(!row)return null;require(this.audio.get(row.channel)===row.audio&&this.audioState.get(row.channel)?.name===row.name,'stale explicit source slot');return {sourceIndex,row:clone(this.sourceVoiceSlotState(sourceIndex)),audio:row.audio,counter:row.counter};}
  advanceSourceVoiceSlot(sourceIndex,context){
   const s=stores.get(this),row=s.slots.get(index(sourceIndex));require(row&&this.audio.get(row.channel)===row.audio&&this.audioState.get(row.channel)?.name===row.name,'current explicit source slot required');return sourceLipCounterUpdate(row.counter,s.clock.currentTick(),context);
  }
  controlSourceVoiceSlot(sourceIndex,message){const row=stores.get(this).slots.get(index(sourceIndex));require(row,'explicit source slot required');if(message===0xb7)return row.counter.applyMessageB7();if(message===0xb6)return row.counter.applyMessageB6Immediate();return row.counter.applyImmediateControl(message)}
  stopSound(channel,...rest){const s=stores.get(this);for(const [i,row]of s?.slots??[])if(row.channel===channel)s.slots.delete(i);for(const [i,row]of s?.pending??[])if(row.channel===channel)row.cancel();return super.stopSound(channel,...rest)}
  reset(...rest){const s=stores.get(this);s?.slots.clear();for(const row of [...s?.pending.values()??[]])row.cancel();return super.reset(...rest)}
  snapshot(...rest){if(!this.sourceVoiceSlotAdapter)return super.snapshot(...rest);const s=stores.get(this);require(!s.pending.size&&!s.restoring,'pending explicit source slot phase cannot be saved');const data=super.snapshot(...rest);return {...data,sourceVoiceSlots:{version:1,policy:'port-own-explicit-source-voice-slots',slots:[...s.slots.values()].map(row=>{require(this.audio.get(row.channel)===row.audio&&this.audioState.get(row.channel)?.name===row.name,'stale source slot save');return this.sourceVoiceSlotState(row.sourceIndex)})}}}
  validateSave(saved,...rest){const data=super.validateSave(saved,...rest);if(!this.sourceVoiceSlotAdapter)return data;const extra=data.sourceVoiceSlots;require(extra?.version===1&&extra.policy==='port-own-explicit-source-voice-slots'&&Array.isArray(extra.slots)&&extra.slots.length<=11,'explicit source slots save descriptor required');const seen=new Set(),channels=new Set();for(const row of extra.slots){index(row.sourceIndex);require(!seen.has(row.sourceIndex)&&!channels.has(row.channel),'duplicate saved source slot/channel');seen.add(row.sourceIndex);channels.add(row.channel);new SourceLipCounter(row.counter);require(data.audio.some(a=>a.channel===row.channel&&a.name===row.name),'saved slot/current Audio differs');const plan=planPortSourceVoiceSlot(row);require(JSON.stringify(plan)===JSON.stringify(row.plan),'saved source actor plan differs');if(row.fallback){require(stores.get(this).emptyFlowPolicy===row.fallback.policy&&row.fallback.policy==='source-empty-flow-preserve-initial-base'&&row.fallback.kind==='source-lpb-absent'&&Array.isArray(row.fallback.nodes),'unsupported saved empty-flow policy');const expected=[];for(const actor of plan.matchedActors)if(actor.taskAvailable){const bank=data.sourceCharacters.banks.find(b=>(b.group==='mpl'?67+Number(b.id):77+Number(b.id))===actor.bank);require(bank&&!bank.lip,'fallback saved actor differs');const selection=sourceCharacterSelection(stores.get(this).lipOracle,stores.get(this).blinkOracle,bank.profile,bank.variant,bank.digits),node=selection.lipNode;if(!node)continue;const original=stores.get(this).genericOracle.configurations[selection.configuration]?.nodes[`${node.position}:${node.selector}`];require(original&&original.flow.length===0,'saved fallback source flow differs');const n={bank:actor.bank,variable:original.variable,initialBase:Math.fround(original.initialBase),sourceConfigurationSHA256:original.sourceConfiguration.sha256};expected.push(n);const layer=data.layers.find(l=>l.group===bank.group&&String(l.id)===String(bank.id));require(layer?.variables?.some(v=>v.label===n.variable&&v.value===n.initialBase),'saved fallback scalar differs from selected source initialBase');}require(JSON.stringify(expected)===JSON.stringify(row.fallback.nodes),'saved fallback nodes omitted or differ');}for(const b of data.sourceCharacters.banks)if(b.lip?.channel===row.channel)require(b.lip.name===row.name&&JSON.stringify(b.lip.counter)===JSON.stringify(row.counter),'saved slot/character counter differs');}return data}
  async restore(saved,...rest){if(!this.sourceVoiceSlotAdapter)return super.restore(saved,...rest);const s=stores.get(this),transaction=restoreTransactionFromOptions(rest[0]);require(transaction,'explicit restore transaction required');assertRestoreActive(transaction);const data=clone(this.validateSave(saved,...rest));s.restoring=true;try{for(const row of data.sourceVoiceSlots.slots)if(row.fallback){const loaded=await s.repository.read(row.name,{restoreTransaction:transaction});assertRestoreActive(transaction);require(loaded.kind==='source-lpb-absent'&&loaded.indexSHA256===row.fallback.indexSHA256,'saved typed LPB absence changed');}await super.restore(data,...rest);assertRestoreActive(transaction);for(const row of data.sourceVoiceSlots.slots){const audio=this.audio.get(row.channel);require(audio&&this.audioState.get(row.channel)?.name===row.name,'restored actual Audio differs');let counter=null;for(const bank of data.sourceCharacters.banks)if(bank.lip?.channel===row.channel){const bound=this.sourceBoundLipIdentity(this.bank(bank.group,bank.id));require(bound?.audio===audio&&JSON.stringify(bound.counter.snapshot())===JSON.stringify(row.counter)&&(!counter||counter===bound.counter),'restored original counter differs');counter=bound.counter}if(!counter)counter=new SourceLipCounter(row.counter);s.slots.set(row.sourceIndex,{...clone(row),audio,counter});assertRestoreActive(transaction)}}finally{s.restoring=false}}
 };
}
