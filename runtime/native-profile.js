// The FES wizard commits boot849 only after the selected heroine page exits.
// Names are the two Chinese-patch fields10/20. The 20-character bound belongs
// to this port's existing settings format; it is not a proven Windows limit.
export const PROFILE_HEROINES=Object.freeze([{id:1,name:'结灯'},{id:2,name:'千岁'},{id:3,name:'玲'},{id:4,name:'咲来'}].map(Object.freeze));
export const PROFILE_FLAGS=Object.freeze({boot:849,birthdayMonth:865,birthdayDay:866,birthdayWith:725,underhair:530,heartEyes:532,displayMode:724});
const finiteNumbers=numbers=>{if(!numbers||typeof numbers!=='object'||Array.isArray(numbers)||Object.values(numbers).some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('Invalid profile numeric flags');return {...numbers}};
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>20)throw new Error('请输入1至20字的姓名');return value.trim()}
export function profileName(value){return name(value)}
export function birthdayDays(month){if(!Number.isInteger(month)||month<1||month>12)throw new Error('Invalid birthday month');return [31,29,31,30,31,30,31,31,30,31,30,31][month-1]}
export function profileBirthday(month,day){if(!Number.isInteger(day)||day<1||day>birthdayDays(month))throw new Error('Invalid birthday date');return {month,day}}
export function needsNativeProfile(numbers){return (finiteNumbers(numbers)[849]??0)===0}
export function createNativeProfileDraft(settings,{firstRun=false}={}){
 if(typeof firstRun!=='boolean')throw new Error('Invalid first-run state');
 return {step:'name',firstRun,familyName:firstRun?'和仓':name(settings.familyName),firstName:firstRun?'贤一':name(settings.firstName),month:1,day:1,heroine:null};
}
export function confirmNativeProfileName(draft,familyName,firstName){if(draft?.step!=='name')throw new Error('Profile name page is not current');return {...draft,familyName:name(familyName),firstName:name(firstName),step:'birthday'}}
export function confirmNativeProfileBirthday(draft,month,day,confirmed){if(draft?.step!=='birthday'||typeof confirmed!=='boolean')throw new Error('Profile birthday page is not current');const birthday=profileBirthday(month,day);return {...draft,...birthday,step:confirmed?'heroine':'birthday'}}
export function selectNativeProfileHeroine(draft,heroine){if(draft?.step!=='heroine'||!PROFILE_HEROINES.some(value=>value.id===heroine))throw new Error('请选择陪伴生日的角色');return {...draft,heroine,step:'complete'}}
export function completeNativeProfile(numbers,settings,draft){
 const result=finiteNumbers(numbers);if(draft?.step!=='complete'||typeof draft.firstRun!=='boolean'||!PROFILE_HEROINES.some(value=>value.id===draft.heroine))throw new Error('Profile wizard is incomplete');
 const birthday=profileBirthday(draft.month,draft.day),familyName=name(draft.familyName),firstName=name(draft.firstName);
 if(draft.firstRun&&(result[849]??0)!==0)throw new Error('First-run profile was already completed');
 result[127]=result[738]=familyName==='和仓'&&firstName==='贤一'?0:1;result[865]=birthday.month;result[866]=birthday.day;result[725]=draft.heroine;if(draft.firstRun)result[849]=1;
 return {numbers:result,settings:{...settings,familyName,firstName},strings:{10:familyName,20:firstName,40:familyName,50:firstName,850:familyName,851:firstName}};
}
export function setNativeImagePreference(numbers,flag,value){const result=finiteNumbers(numbers);if(![530,532,724].includes(flag)||!Number.isInteger(value)||(flag===724?![1,2,3].includes(value):![0,1].includes(value)))throw new Error('Invalid native image preference');result[flag]=value;return result;}
export function resetNativeImagePreferences(numbers){const result=finiteNumbers(numbers);result[530]=0;result[532]=1;return result;}
export const NATIVE_DISPLAY_MODES=Object.freeze([{id:1,label:'默认模式',frame:200},{id:2,label:'内衣模式',frame:210},{id:3,label:'裸体模式',frame:220}].map(Object.freeze));
export const NATIVE_PROFILE_PROVENANCE=Object.freeze({sourceReviewSHA256:'d45fab513c76e79656981b8154fd1bab996776f01904d145b52b14c4383748b5',sourceFixtureSHA256:'bd769a0282910f84cac412075d4bf53f4cead1bd0c248a24b42632d58ac3d65b',titleControlImageMappingSHA256:'279fb1fa2bfeabc1382683029f8aac9e874c39cdd35ca9fbfaf15b685ab70ebf'});
export function persistNativeProfileCompletion(storage,globalFlags,numbers,settings,draft){
 const result=completeNativeProfile(numbers,settings,draft),key='amakano2plus-settings-v1',previous=storage.getItem(key);
 storage.setItem(key,JSON.stringify(result.settings));
 try{globalFlags.write(result.numbers)}catch(failure){
   try{if(previous===null)storage.removeItem(key);else storage.setItem(key,previous)}catch(rollbackFailure){throw new AggregateError([failure,rollbackFailure],'个人设置写入失败，姓名设置恢复也失败')}
   throw failure;
 }
 return result;
}
export function nativeProfileLaunchInitial(settings,numbers){
 const result=finiteNumbers(numbers),familyName=name(settings.familyName),firstName=name(settings.firstName);result[127]=result[738]=familyName==='和仓'&&firstName==='贤一'?0:1;
 return {numbers:result,strings:{10:familyName,20:firstName,40:familyName,50:firstName,850:familyName,851:firstName}};
}
// Port save-restoration policy: user-confirmed setup/image preferences belong
// to persistent device settings. Restoring oldR6 scene globals must not undo
// completed setup. Saved names and127/738 retain their scene-specific meaning.
export const PERSISTENT_NATIVE_PROFILE_FLAGS=Object.freeze([530,532,724,725,849,865,866]);
export function nativeProfileRestoreNumbers(savedNumbers,persistedNumbers){
 const saved=finiteNumbers(savedNumbers),persisted=finiteNumbers(persistedNumbers);
 for(const flag of PERSISTENT_NATIVE_PROFILE_FLAGS)if(Object.hasOwn(persisted,flag))saved[flag]=persisted[flag];
 return saved;
}
