// Original MOT arithmetic for motMove / motAMove1..3. This is a numeric
// candidate, not x87/CRT bit parity or renderer acceptance.
const f=Math.fround, axes=['x','y','z'], kinds=['move','amove1','amove2','amove3'];
const fail=message=>{throw new TypeError(message)};
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
function finite(value,label){if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(f(value)))fail(`Invalid native position ${label}`);return f(value)}
function integer(value,label){if(!Number.isInteger(value)||value<0||value>0xffffffff)fail(`Invalid native position ${label}`);return value}
export function nativeWorkingXYZ(value){if(!exact(value,axes))fail('Invalid native working XYZ');return Object.fromEntries(axes.map(key=>[key,finite(value[key],key)]))}
export function nativeRoundPosition(value){const rounded=f(Math.floor(f(finite(value,'round input')+f(.5))));if(rounded < -2147483648||rounded>2147483647)throw new RangeError('Unclosed native17 signed integer conversion overflow');return rounded}
const radians=degrees=>f(f(f(degrees)*f(3.1415927410125732))/f(180));
function lerp(a,b,duration,time){return time<=0?a:time>=duration?b:f(f(f(b-a)*f(f(time)/duration))+a)}

export function createNativePositionMotion(durationFrames,delta,{kind='move',roundFinal=false}={}){
 if(!kinds.includes(kind)||typeof roundFinal!=='boolean'||!Number.isInteger(durationFrames)||durationFrames < -2147483648||durationFrames>2147483647)fail('Invalid native position parameters');
 const duration=f(Math.max(1,durationFrames));
 if(!Number.isInteger(duration))fail('Unclosed native duration normalization');
 return Object.freeze({version:1,kind,durationFrames:duration,delta:Object.freeze(nativeWorkingXYZ(delta)),roundFinal});
}
export function validateNativePositionMotion(motion){
 if(!exact(motion,['version','kind','durationFrames','delta','roundFinal'])||motion.version!==1||!kinds.includes(motion.kind)||typeof motion.roundFinal!=='boolean'||motion.durationFrames<1||integer(motion.durationFrames,'duration')!==motion.durationFrames||f(motion.durationFrames)!==motion.durationFrames)fail('Invalid saved native position motion');
 const normalized=nativeWorkingXYZ(motion.delta);for(const key of axes)if(normalized[key]!==motion.delta[key])fail('Non-normalized saved position delta');return motion;
}
export function sampleNativePositionMotion(motion,elapsedFrames,{stopRequested=false}={}){
 validateNativePositionMotion(motion);integer(elapsedFrames,'elapsed');if(typeof stopRequested!=='boolean')fail('Invalid native stop flag');
 const finished=stopRequested||elapsedFrames>=motion.durationFrames;
 if(finished)return {delta:{...motion.delta},finished:true,roundWorkingPosition:motion.roundFinal};
 const delta={};
 for(const axis of axes){
  const end=motion.delta[axis];
  if(motion.kind==='move'){delta[axis]=lerp(0,end,motion.durationFrames,elapsedFrames);continue;}
  // Preserve original per-axis angles and float32 operation order. The
  // normalized trigonometric curves alone lose source rounding differences.
  const y=axis==='y';
  const angles=motion.kind==='amove1'?(y?[180,270]:[90,0]):motion.kind==='amove2'?(y?[90,180]:[180,90]):(y?[90,270]:[180,0]);
  const start=radians(angles[0]),finish=radians(angles[1]),angle=lerp(start,finish,motion.durationFrames,elapsedFrames);
  const trig=y?Math.sin:Math.cos;
  let difference=f(f(trig(start))-f(trig(angle)));if(y)difference=f(-difference);
  let amplitude=f(0-end);if(motion.kind==='amove3')amplitude=f(amplitude*f(.5));
  delta[axis]=f(f(difference*amplitude)+f(0));
 }
 return {delta,finished:false,roundWorkingPosition:false};
}
