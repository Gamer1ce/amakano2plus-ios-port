import {nativeRoundPosition} from './native-position-motion.js';

export const NATIVE_CALCULATOR_COMMAND_EFFECTS_SOURCE=Object.freeze({
 sourceBodySHA256:'8645169ee0649fd0ffe877779800771c50d2aaf23271958bf81525fabeab1758',
 bgInstantScaleHandler:144966,bgCurrentWrites:Object.freeze([145403,145627,145851]),
 groupParser:109279,resourceLoad:610072,waitHandler:459517,rdrawHandler:500690,
 soundResourceParser:353778,soundOptionalCurrentWrites:Object.freeze([356589,356846]),
 scope:'narrow BG instant scale and source resource/wait/rdraw/SE-loop paths with no optional volume/pan',
 nativeRasterAcceptance:false,
});
const signedLiteral=token=>/^[+-]?\d+$/.test(token)&&Number(token)>=-2147483648&&Number(token)<=2147483647;
const bank=token=>/^\d+$/.test(token)&&Number(token)<=9;
const scaleToken=token=>/^[+-]?\d+%?$/.test(token)&&signedLiteral(token.endsWith('%')?token.slice(0,-1):token);

// These effects never infer current from Arc's bank or from screen dimensions.
// Neutral commands preserve UNKNOWN as well as known values. Any other path is
// left unknown by the wrapper until the source host publishes its own writes.
export function nativeCalculatorCommandEffect(cmd,parts,layer){
 if(!Array.isArray(parts)||parts.some(token=>typeof token!=='string'))throw new TypeError('Invalid native calculator command parts');
 if(cmd==='bg'&&parts.length>=2&&parts.length<=5&&bank(parts[0])&&parts[1]==='scale'&&parts.slice(2).every(scaleToken)){
  if(!layer||layer.group!=='bg'||String(layer.id)!==String(Number(parts[0])))throw new Error('Source BG scale bank must be supplied');
  let current;
  for(const [index,axis]of ['sx','sy','sz'].entries())if(parts[index+2]!==undefined)current=nativeRoundPosition(Math.fround(layer[axis]??1));
  return current===undefined?{kind:'neutral'}:{kind:'write',current};
 }
 if(cmd==='bg'&&parts.length===2&&bank(parts[0])&&/^bg_[A-Za-z0-9_]+$/.test(parts[1]))return {kind:'neutral'};
 if(cmd==='eg'&&parts.length===2&&bank(parts[0])&&/^effect_[A-Za-z0-9_]+$/.test(parts[1]))return {kind:'neutral'};
 if(['wait','rdraw'].includes(cmd)&&parts.length===1&&signedLiteral(parts[0])&&Number(parts[0])>=0)return {kind:'neutral'};
 if(cmd==='se'&&parts.length===3&&bank(parts[0])&&parts[1]==='loop'&&/^SE_[A-Za-z0-9_]+$/.test(parts[2]))return {kind:'neutral'};
 return {kind:'unknown'};
}
