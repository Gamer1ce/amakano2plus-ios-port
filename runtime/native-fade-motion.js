import {nativeRoundPosition} from './native-position-motion.js';
const f=Math.fround;
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
const fail=message=>{throw new TypeError(message)};
export const NATIVE_FADE_SOURCE=Object.freeze({
 registration:95556,selector:126990,wrapper:129268,handler:153824,
 mot:'motFade.kcs',motBodyBytes:688,motInstructions:93,
 native17:'0x6d4f70',native41:'0x6d5750',colorByteIndex:3,
 sourceConstructorDefaults:Object.freeze([30,0,0]),
 controllerWorkingCopyIn:'0x6d49c0',controllerWorkingCopyOut:'0x6d49f0',
 nativeRasterAcceptance:false,
});
export function nativeAlphaByte(value){if(!Number.isInteger(value)||value<0||value>255)fail('Invalid source alpha byte');return value}
// The browser host stores opacity as a ratio. This explicitly named adapter
// quantizes that PORT state; it is not a claim about the native object owner.
export function portOpacityToAlphaByte(opacity){if(!Number.isFinite(opacity)||opacity<0||opacity>1)fail('Invalid port opacity');return Math.max(0,Math.min(255,nativeRoundPosition(f(f(opacity)*f(255)))))}
export function createNativeFadeMotion(durationFrames=30,startAlpha=0,endAlpha=0){
 for(const value of [durationFrames,startAlpha,endAlpha])if(!Number.isInteger(value)||value< -2147483648||value>2147483647)fail('Native fade parameters must be signed32 integers');
 // The MOT body clamps durations below1 in its per-evaluation parameter copy.
 return Object.freeze({version:1,kind:'motFade',durationFrames:f(Math.max(1,durationFrames)),startAlpha:f(startAlpha),endAlpha:f(endAlpha)});
}
export function restoreNativeFadeMotion(plan){
 if(!exact(plan,['version','kind','durationFrames','startAlpha','endAlpha'])||plan.version!==1||plan.kind!=='motFade')fail('Invalid saved native fade');
 // Constructor integers can round outside signed32 after float32 conversion.
 // Restore accepts exactly finite normalized f32 source parameter values.
 for(const name of ['durationFrames','startAlpha','endAlpha'])if(!Number.isInteger(plan[name])||f(plan[name])!==plan[name])fail('Non-normalized saved native fade');
 if(plan.durationFrames<1||plan.durationFrames>2147483648||plan.startAlpha< -2147483648||plan.startAlpha>2147483648||plan.endAlpha< -2147483648||plan.endAlpha>2147483648)fail('Saved native fade outside constructor range');
 return Object.freeze({...plan});
}
export function sampleNativeFadeMotion(plan,elapsedFrames,{stopRequested=false}={}){
 const copy=restoreNativeFadeMotion(plan);
 if(!Number.isInteger(elapsedFrames)||elapsedFrames<0||elapsedFrames>0xffffffff||typeof stopRequested!=='boolean')fail('Invalid native fade sample');
 const elapsed=f(elapsedFrames),finished=stopRequested||elapsedFrames>=copy.durationFrames;
 let value;
 if(finished)value=copy.endAlpha;
 else if(elapsed<=0)value=copy.startAlpha;
 else value=f(f(f(elapsed/copy.durationFrames)*f(copy.endAlpha-copy.startAlpha))+copy.startAlpha);
 // Native17 round occurs before the [0,255] clamp and byte store. Conversion
 // overflow remains rejected by the inherited nativeRoundPosition scope.
 const alphaByte=Math.max(0,Math.min(255,nativeRoundPosition(value)));
 return {alphaByte,finished,delta:{x:0,y:0,z:0},roundWorkingPosition:false};
}
