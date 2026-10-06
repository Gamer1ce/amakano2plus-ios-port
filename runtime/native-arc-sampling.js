// Isolated numeric MOT candidate. Caller supplies actual elapsed integer frames
// and the native working-position buffer. No clock, renderer, or command hook.
const f = Math.fround;
const PI32 = f(3.1415927410125732);
const fields = ['durationFrames','startRadians','endRadians','radiusX','radiusY','radiusZ'];

function integer(value, label, {unsigned=false}={}) {
  if (!Number.isInteger(value) || value < (unsigned ? 0 : -2147483648) || value > (unsigned ? 4294967295 : 2147483647)) {
    throw new TypeError(`Invalid native Arc ${label}`);
  }
  return value;
}
function radians(degrees) { return f(f(f(degrees) * PI32) / f(180)); }
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(f(value))) throw new TypeError(`Invalid native Arc ${label}`);
  return f(value);
}

export const NATIVE_ARC_PROVENANCE = Object.freeze({
  scope:'original numeric MOT only; no native clock/renderer/scheduler acceptance',
  extractionSHA256:'57b1cd80453fa4b921e0c3b014a17b1977cf693e0db6c68283de8ed1e6c61925',
  nativeContinuousHandler:234019, nativeFiniteHandler:152435,
  motionArchive:'mot.int', motionNames:Object.freeze(['motArc.kcs','mcArc.kcs']),
});

export function createNativeArc(parameters=[], {continuous=false, roundFinal=false}={}) {
  if (!Array.isArray(parameters) || parameters.length > 6 || typeof continuous !== 'boolean' || typeof roundFinal !== 'boolean') throw new TypeError('Invalid native Arc parameters');
  const defaults=[30,0,0,0,0,0];
  const numbers=defaults.map((fallback,index)=>integer(parameters[index]===undefined?fallback:parameters[index], `parameter ${index}`));
  // mcArc has no source clamp. Zero divisor and negative→unsigned conversion
  // are outside this conservative candidate, and never silently normalized.
  if (continuous && numbers[0] <= 0) throw new RangeError('Unclosed native mcArc nonpositive period');
  const duration=f(continuous?numbers[0]:Math.max(1,numbers[0]));
  integer(duration,'float-normalized duration');
  return Object.freeze({version:1,kind:continuous?'mcArc':'motArc',
    durationFrames:duration,
    startRadians:radians(numbers[1]),endRadians:radians(numbers[2]),
    radiusX:f(numbers[3]),radiusY:f(numbers[4]),radiusZ:f(numbers[5]),roundFinal});
}

export function validateNativeArc(motion) {
  if (!motion || motion.version !== 1 || !['motArc','mcArc'].includes(motion.kind) || typeof motion.roundFinal !== 'boolean' || Object.keys(motion).sort().join() !== ['version','kind',...fields,'roundFinal'].sort().join()) throw new TypeError('Invalid saved native Arc');
  integer(motion.durationFrames, 'duration');
  if (motion.durationFrames < 1) throw new RangeError('Invalid saved native Arc duration');
  for (const key of fields) if(finite(motion[key],key)!==motion[key]) throw new TypeError('Non-normalized saved native Arc');
  return motion;
}

export function sampleNativeArc(motion, elapsedFrames, {stopRequested=false}={}) {
  validateNativeArc(motion);integer(elapsedFrames,'elapsed',{unsigned:true});
  if (typeof stopRequested !== 'boolean') throw new TypeError('Invalid native Arc stop state');
  const continuous=motion.kind==='mcArc';
  // Source mcArc calls native38 and returns before coordinate additions.
  if (continuous && stopRequested) return {delta:{x:0,y:0,z:0},finished:true,roundWorkingPosition:false};
  const duration=f(motion.durationFrames);
  const time=continuous?elapsedFrames%motion.durationFrames:(stopRequested?motion.durationFrames:Math.min(elapsedFrames,motion.durationFrames));
  // Native41 receives float start/end/time0/time1/current, with clamped ends.
  const angle=time===0?motion.startRadians:time>=duration?motion.endRadians:
    f(f(f(motion.endRadians-motion.startRadians)*f(f(time)/duration))+motion.startRadians);
  const c0=f(Math.cos(motion.startRadians)),c=f(Math.cos(angle));
  const s0=f(Math.sin(motion.startRadians)),s=f(Math.sin(angle));
  const finished=!continuous && (stopRequested || elapsedFrames>=motion.durationFrames);
  return {delta:{x:f(f(c-c0)*motion.radiusX),y:f(f(-f(s-s0))*motion.radiusY),z:f(f(c-c0)*motion.radiusZ)},
    finished,roundWorkingPosition:finished&&motion.roundFinal};
}

export function addNativeArcToWorkingPosition(working, motion, elapsedFrames, options) {
  if (!working || Object.keys(working).sort().join() !== 'x,y,z') throw new TypeError('Invalid native working position');
  const start=Object.fromEntries(['x','y','z'].map(key=>[key,finite(working[key],key)]));
  const sample=sampleNativeArc(motion,elapsedFrames,options);
  const position=Object.fromEntries(['x','y','z'].map(key=>{
    let value=finite(f(start[key]+sample.delta[key]),'result '+key);
    // Original native17 adds float0.5 then calls a floor implementation.
    if (sample.roundWorkingPosition) value=f(Math.floor(f(value+f(0.5))));
    return [key,value];
  }));
  return {...sample,position};
}

export function snapshotNativeArc(motion) {validateNativeArc(motion);return {...motion};}
export function restoreNativeArc(data) {validateNativeArc(data);return Object.freeze({...data});}
