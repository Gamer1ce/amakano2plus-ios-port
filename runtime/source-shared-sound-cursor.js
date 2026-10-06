// Original KCS194980 resource selection/advance kernel. Fresh/reset/save events
// below are an explicit port policy, not a mapping of native state1/2/25 phases.
export const SOURCE_SHARED_SOUND_CURSOR_POLICY='port-own-load-reset-save-v1';
export const SOURCE_SHARED_SOUND_CURSOR_PROOF_SHA='f96dcd953caec5272cdc204593a16330d27b03130896736346d7bb2e00358ead';
const states=new WeakMap();
const require=(ok,message)=>{if(!ok)throw new Error('Source shared sound cursor: '+message)};
const physicalChannel=index=>{require(Number.isInteger(index)&&index>=0&&index<=22,'target outside closed original sound-record0..22 range');return index<2?'bgm'+index:index<12?'se'+(index-2):'voice'+(index-12)};
const cursor=value=>Number.isSafeInteger(value)&&value>=0&&value<=11;
export class SourceSharedSoundCursor {
 constructor(){states.set(this,{value:0,revision:0})}
 reset(){const s=states.get(this);s.value=0;s.revision++}
 peek(family){require(family==='se'||family==='pcm','shared family must be SE or PCM');return physicalChannel((family==='se'?2:12)+states.get(this).value)}
 allocate(family,explicitBank){
  require(family==='se'||family==='pcm','shared family must be SE or PCM');
  const s=states.get(this),before=s.value,explicit=explicitBank!==undefined;
  // Native213 has no clamp. This port supports only the proven physical sound
  // record region; it rejects wider inputs instead of truncating native values.
  if(explicit)require(Number.isInteger(explicitBank)&&explicitBank>=0&&explicitBank<=(family==='se'?9:10),'explicit bank outside closed physical family range');
  const physical=(family==='se'?2:12)+(explicit?explicitBank:before),channel=physicalChannel(physical);
  const after=!explicit?(before>=9?0:before+1):family==='pcm'?(before>=9?0:explicitBank+1):before;
  require(cursor(after),'resource update outside bounded source cursor state');
  // This precedes actual pending native load. I/O/play failure never rolls the
  // resource parser's update back; it is not a successful-load-only commit.
  s.value=after;s.revision++;
  return Object.freeze({family,explicit,explicitBank:explicit?explicitBank:null,physicalRecord:physical,channel,before,after,revision:s.revision,advancePhase:'before-native-load'});
 }
 snapshot(){const s=states.get(this);return {version:1,policy:SOURCE_SHARED_SOUND_CURSOR_POLICY,value:s.value}}
 validate(saved){require(saved&&saved.version===1&&saved.policy===SOURCE_SHARED_SOUND_CURSOR_POLICY&&cursor(saved.value),'invalid own-save cursor descriptor');require(Object.keys(saved).length===3,'unknown own-save cursor fields');return {version:1,policy:SOURCE_SHARED_SOUND_CURSOR_POLICY,value:saved.value}}
 restore(saved){const checked=this.validate(saved),s=states.get(this);s.value=checked.value;s.revision++}
}
