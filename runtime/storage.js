import {GLOBAL_FLAG_RANGE,REPLAY_UNLOCK_FLAGS} from './system-config.js';

const GAME='Amakano 2+';
export const SAVE_SLOTS=8;
export class GlobalFlagStore {
  constructor(storage) {this.storage=storage;this.key='amakano2plus-global-flags-v1'}
  values(numbers) {
    if(!numbers||typeof numbers!=='object'||Array.isArray(numbers))throw new Error('Invalid global numeric flags');
    return Array.from({length:GLOBAL_FLAG_RANGE.count},(_,offset)=>{
      const raw=numbers[GLOBAL_FLAG_RANGE.start+offset],value=raw===undefined?0:raw;
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Invalid global numeric flag value');
      return value;
    });
  }
  read() {
    const text=this.storage.getItem(this.key);let values;
    if(text===null)values=Array(GLOBAL_FLAG_RANGE.count).fill(0);
    else {
      let data;try{data=JSON.parse(text)}catch{throw new Error('全局进度内容已损坏，无法读取')}
      if(data?.version!==1||data.game!==GAME||data.range?.start!==GLOBAL_FLAG_RANGE.start||data.range?.count!==GLOBAL_FLAG_RANGE.count||!Array.isArray(data.values)||data.values.length!==GLOBAL_FLAG_RANGE.count||data.values.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('全局进度版本或数字标志不兼容');
      values=data.values;
    }
    return Object.fromEntries(values.map((value,offset)=>[GLOBAL_FLAG_RANGE.start+offset,value]));
  }
  write(numbers) {
    this.storage.setItem(this.key,JSON.stringify({version:1,game:GAME,range:GLOBAL_FLAG_RANGE,values:this.values(numbers)}));
  }
  mergeReplayUnlocks(numbers) {
    // Port policy for loading an earlier save: retain only source-observed
    // replay registrations already equal to 1. Other globals follow the save.
    const globals=this.read(),merged={...numbers};
    for(const flag of REPLAY_UNLOCK_FLAGS)if(globals[flag]===1)merged[flag]=1;
    this.values(merged);return merged;
  }
  async run(vm,task) {
    let result,failure,failed=false;
    try{result=await task()}catch(reason){failure=reason;failed=true}
    try{this.write(vm.state.numbers)}catch(reason){
      if(failed)throw new AggregateError([failure,reason],`${failure?.message??failure}\n全局进度保存失败：${reason?.message??reason}`);
      throw reason;
    }
    if(failed)throw failure;
    return result;
  }
}
export class SaveStore {
  constructor(storage){this.storage=storage}
  key(slot){if(!Number.isInteger(slot)||slot<0||slot>=SAVE_SLOTS)throw new Error('Invalid save slot');return `amakano2plus-save-v2:${slot}`}
  read(slot){
    let text=this.storage.getItem(this.key(slot));
    if(!text&&slot===0)text=this.storage.getItem('amakano2plus-save-v1');
    if(!text)return null;
    let data;try{data=JSON.parse(text)}catch{throw new Error('存档内容已损坏，无法读取')}
    if(data.version===1)return {...data,game:GAME};
    if(data.version!==2||data.game!==GAME||typeof data.date!=='string'||!data.script||!data.layers)throw new Error('存档版本或内容不兼容');
    return data;
  }
  write(slot,data){this.storage.setItem(this.key(slot),JSON.stringify({...data,version:2,game:GAME,date:new Date().toISOString()}))}
  entries(){return Array.from({length:SAVE_SLOTS},(_,slot)=>{try{return {slot,data:this.read(slot)}}catch(error){return {slot,error:error.message}}})}
  remove(slot){this.storage.removeItem(this.key(slot));if(slot===0)this.storage.removeItem('amakano2plus-save-v1')}
}
export const DEFAULT_SETTINGS={bgm:.35,voice:.8,se:.8,movie:.8,muted:false,autoDelay:3000,familyName:'和仓',firstName:'贤一',extraUnlockAll:false};
export function readSettings(storage){
  const settings={...DEFAULT_SETTINGS};let data;
  try{data=JSON.parse(storage.getItem('amakano2plus-settings-v1')??'{}')}catch{return settings}
  for(const key of ['bgm','voice','se','movie'])if(typeof data?.[key]==='number'&&data[key]>=0&&data[key]<=1)settings[key]=data[key];
  if(typeof data?.muted==='boolean')settings.muted=data.muted;
  if(typeof data?.extraUnlockAll==='boolean')settings.extraUnlockAll=data.extraUnlockAll;
  if(Number.isFinite(data?.autoDelay)&&data.autoDelay>=1000&&data.autoDelay<=10000)settings.autoDelay=data.autoDelay;
  for(const key of ['familyName','firstName'])if(typeof data?.[key]==='string'&&data[key].trim()&&data[key].length<=20)settings[key]=data[key].trim();
  return settings;
}
export function writeExtraUnlockAllSetting(storage,settings,value){
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||typeof value!=='boolean')throw new Error('Invalid extra-mode unlock setting');
  const next={...settings,extraUnlockAll:value};
  storage.setItem('amakano2plus-settings-v1',JSON.stringify(next));
  return next;
}
