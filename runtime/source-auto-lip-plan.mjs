// Pure plan for the bounded original KCS MPL automatic/selected binder.
// Inputs are source field snapshots. This does not bind Audio, create a clock,
// infer a native handle, apply writes, or name an SDK variable.
export const SOURCE_AUTO_LIP_PROVENANCE=Object.freeze({
  originalKcsSHA256:'8645169ee0649fd0ffe877779800771c50d2aaf23271958bf81525fabeab1758',
  originalSndanmSHA256:'cba1635022c1d1768eaf8cdc6febfe2e351233297c22ddca1737cf88d7a16448',
  report:'lip-auto-binding-review.json',nativeIntegrationAccepted:false,
  sourceRegions:Object.freeze([817261,818071,819054,819944]),
  maxAutomaticMatches:2,comparison:'Source native21 ASCII case-insensitive prefix; non-ASCII rejected'
});
const pairs=[['styuuh','AA'],['strei','BB'],['stchit','CC'],['stsara','DD'],['stsayu','YA'],['stmizu','YB'],['stkoha','YC'],['sthona','YD'],['stkana','YE'],['styuzu','YF'],['struik','YG'],['stayun','YR'],['stkosk','ZD'],['styuki','ZE']];
export const SOURCE_SNDANM_CONFIG=Object.freeze(pairs.map(([image,sound],index)=>Object.freeze({index,image,sound,limit:1,active:true})));
const require=(condition,message)=>{if(!condition)throw new Error(message)};
const integer=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
const signed=value=>Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff;
const name=value=>typeof value==='string'&&value.length<=128&&/^[\x01-\x7f]*$/.test(value);
const fold=value=>value.replace(/[A-Z]/g,char=>String.fromCharCode(char.charCodeAt(0)+32));
const prefix=(value,part)=>fold(value.slice(0,part.length))===fold(part);
export function sourceActorBankLocation(bank){
  require(Number.isInteger(bank)&&bank>=67&&bank<79,'Original actor bank67..78 required');
  return bank<77?{group:'mpl',id:bank-67}:{group:'fmpl',id:bank-77};
}
export function planSourceLipBinding({sound,actors,configurationLoaded,mode}={}){
  require(typeof configurationLoaded==='boolean','Explicit source configuration load flag required');
  require(Number.isInteger(mode),'Explicit source sndanm mode required');
  require(sound&&Number.isInteger(sound.index)&&sound.index>=0&&sound.index<23,'Explicit original sound record0..22 required');
  require(name(sound.filename),'Bounded original ASCII sound record+4 required');
  require(integer(sound.nativeHandleBits)&&integer(sound.flags200)&&signed(sound.lipSpecified232)&&signed(sound.lipActorBank236),'Explicit original sound fields required');
  require(Array.isArray(actors)&&actors.length===12,'Complete original actor bank67..78 snapshot required');
  const indexed=new Map();
  for(const actor of actors){
    require(actor&&Number.isInteger(actor.bank)&&actor.bank>=67&&actor.bank<79&&!indexed.has(actor.bank),'Unique original actor bank67..78 required');
    require(name(actor.name)&&signed(actor.field4)&&integer(actor.flags888)&&integer(actor.taskId680),'Explicit original actor name+8/field4/flags888/taskId680 required');
    indexed.set(actor.bank,{...actor});
  }
  const result={kind:'source-lip-binding-plan',route:sound.lipSpecified232===0?'automatic':'selected',configurationIndex:null,actorBanks:[],nativeCalls:[],writes:[],reason:null};
  if(sound.nativeHandleBits===0xffffffff){result.reason='native-handle-minus-one';return result}
  if(!configurationLoaded||mode!==1){result.reason='source-MPL-configuration-gate';return result}
  if(sound.lipSpecified232!==0&&(sound.lipActorBank236<67||sound.lipActorBank236>=79)){
    result.route=sound.lipActorBank236<27?'other-bank-binder':'unhandled-selected-bank';result.reason='outside-MPL-actor-route';return result;
  }
  if((sound.flags200&32)!==0||sound.filename===''){result.reason='source-sound-gate';return result}
  // Wrapper817261/819054 stops at the first active table row matching sound.
  const config=SOURCE_SNDANM_CONFIG.find(row=>row.active&&prefix(sound.filename,row.sound));
  if(!config){result.reason='no-source-sound-prefix';return result}
  result.configurationIndex=config.index;
  const banks=result.route==='automatic'?Array.from({length:12},(_,i)=>67+i):[sound.lipActorBank236];
  for(const bank of banks){
    const actor=indexed.get(bank);
    if(actor.name===''||!prefix(actor.name,config.image)||(actor.flags888&4)===0||actor.field4===0)continue;
    const position=result.actorBanks.length;result.actorBanks.push(bank);
    result.writes.push({record:'actor',bank,offset:796,value:sound.index});
    result.writes.push({record:'sound',index:sound.index,offset:220+4*position,value:bank});
    if(actor.taskId680!==0)result.nativeCalls.push({native:924,args:[actor.taskId680,1,sound.nativeHandleBits],actorBank:bank});
    if(result.actorBanks.length>=2)break;
  }
  if(!result.actorBanks.length)result.reason='no-source-actor-prefix-or-gates';
  return result;
}
