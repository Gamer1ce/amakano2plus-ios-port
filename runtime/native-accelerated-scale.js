// Original non-p motAScale1/3. The native PL constructor, target units and
// original per-axis Float32 angle operations are retained; Math.sin/cos is the
// explicit browser arithmetic boundary, not Windows CRT/x87 bit parity.
import {createNativePositionMotion,nativeRoundPosition} from './native-position-motion.js';
import {numericArgument} from './expressions.js';
import {createNormalizedNativeScaleMotion,createDimensionNativeScaleMotion} from './native-scale-motion.js';
const fail=message=>{throw new TypeError(message)};
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
const KINDS=Object.freeze(['motAScale1','motAScale3']);
const EASING=Object.freeze({motAScale1:'amove1',motAScale3:'amove3'});
export const NATIVE_ACCELERATED_SCALE_OPERATIONS=Object.freeze(['ascale1','ascale3','m2ascale1','m2ascale3']);
export const NATIVE_ACCELERATED_SCALE_SOURCE=Object.freeze({ordinary:{ascale1:303616,ascale3:310450},m2:{m2ascale1:318208,m2ascale3:325042},parameterCount:7,channel:'scale',roundWorkingPosition:false,sourceStop:'full endpoint contribution then native38 finish',browserMath:'Math.sin/cos with source Float32 operation order; no Windows CRT bit claim'});
export function createNativeAcceleratedScaleMotion(durationFrames,delta,{kind='motAScale1'}={}){
 if(!KINDS.includes(kind))fail('Unsupported source accelerated scale kind');
 const line=createNativePositionMotion(durationFrames,delta,{kind:EASING[kind],roundFinal:false});
 if(line.durationFrames>2147483647)fail('Unclosed signed source accelerated scale duration conversion');
 return Object.freeze({version:1,kind,durationFrames:line.durationFrames,delta:line.delta});
}
export function restoreNativeAcceleratedScaleMotion(plan){
 if(!exact(plan,['version','kind','durationFrames','delta'])||plan.version!==1||!KINDS.includes(plan.kind))fail('Invalid saved accelerated scale motion');
 const copy=createNativeAcceleratedScaleMotion(plan.durationFrames,plan.delta,{kind:plan.kind});
 if(copy.durationFrames!==plan.durationFrames||['x','y','z'].some(axis=>copy.delta[axis]!==plan.delta[axis]))fail('Non-normalized saved accelerated scale motion');
 return copy;
}
export function sampleNativeAcceleratedScaleMotion(plan,elapsedFrames,{stopRequested=false}={}){
 const copy=restoreNativeAcceleratedScaleMotion(plan);
 if(!Number.isInteger(elapsedFrames)||elapsedFrames<0||elapsedFrames>0xffffffff||typeof stopRequested!=='boolean')fail('Invalid accelerated scale time/stop');
 const finished=stopRequested||elapsedFrames>=copy.durationFrames;
 if(finished)return {delta:{...copy.delta},finished:true,roundWorkingPosition:false};
 const f=Math.fround,radians=degrees=>f(f(f(degrees)*f(3.1415927410125732))/f(180));
 const interpolate=(a,b)=>elapsedFrames<=0?a:f(f(f(f(elapsedFrames)/copy.durationFrames)*f(b-a))+a);
 const delta={};
 for(const axis of ['x','y','z']){
  const y=axis==='y',angles=copy.kind==='motAScale1'?(y?[180,270]:[90,0]):(y?[90,270]:[180,0]);
  const start=radians(angles[0]),theta=interpolate(start,radians(angles[1])),trig=y?Math.sin:Math.cos;
  // Actual 87cb80 pops the rightmost pushed operand first: theta-start,
  // B-A, then y sign-bit negate. Retain this source order even when an
  // algebraic two-negation rewrite would yield the same normalized curve.
  let difference=f(f(trig(theta))-f(trig(start)));if(y)difference=f(-difference);
  let amplitude=f(copy.delta[axis]-f(0));if(copy.kind==='motAScale3')amplitude=f(amplitude*f(.5));
  delta[axis]=f(f(difference*amplitude)+f(0));if(!Number.isFinite(delta[axis]))fail('Source accelerated scale sample overflow');
 }
 return {delta,finished:false,roundWorkingPosition:false};
}
export function createNormalizedNativeAcceleratedScaleMotion(durationFrames,targets,baseScale,workingScale,{kind='motAScale1'}={}){
 const normalized=createNormalizedNativeScaleMotion(durationFrames,targets,baseScale,workingScale);
 return createNativeAcceleratedScaleMotion(normalized.durationFrames,normalized.delta,{kind});
}
export function createDimensionNativeAcceleratedScaleMotion(durationFrames,targets,workingScale,dimensions,{kind='motAScale1'}={}){
 const normalized=createDimensionNativeScaleMotion(durationFrames,targets,workingScale,dimensions);
 return createNativeAcceleratedScaleMotion(normalized.durationFrames,normalized.delta,{kind});
}
export function sourceAcceleratedScaleOperation(operation){
 if(!NATIVE_ACCELERATED_SCALE_OPERATIONS.includes(operation))fail('Unsupported original accelerated scale operation');
 return Object.freeze({kind:operation.endsWith('1')?'motAScale1':'motAScale3',tag:operation.startsWith('m2')?1:0,channel:'scale'});
}
export function nativeAcceleratedScaleAdapters(){
 return KINDS.map(kind=>Object.freeze({kind,channel:'scale',restore:plan=>{if(plan?.kind!==kind)fail('Accelerated scale adapter kind differs');return restoreNativeAcceleratedScaleMotion(plan)},sample:sampleNativeAcceleratedScaleMotion}));
}

// The production factory opens only this game's proved PL type2 callers.
// Other image/MPL groups and ascale2 remain outside this source-bound subset.
export function nativeAcceleratedScaleFactory({layer,operation,parameters,state,ledger,sourcePlaneDimensions}){
 const info=sourceAcceleratedScaleOperation(operation);
 if(layer?.group!=='pl'||!sourcePlaneDimensions||typeof sourcePlaneDimensions.dimensions!=='function')fail('Source accelerated scale PL type2 dimensions required');
 if(!Array.isArray(parameters)||parameters.length>4||parameters.some(token=>typeof token!=='string'))fail('Invalid source accelerated scale arguments');
 if(parameters[0]?.includes('@')||parameters[0]?.includes('%'))fail('Source accelerated scale duration calculator context is not closed');
 const duration=parameters[0]===undefined?30:numericArgument(parameters[0],state);
 if(!Number.isInteger(duration)||duration < -2147483648||duration>2147483647)fail('Source accelerated scale duration must be signed integer');
 const dimensions=sourcePlaneDimensions.dimensions(layer),working=ledger.workingScale;
 const motion=createDimensionNativeAcceleratedScaleMotion(duration,parameters.slice(1),working,dimensions,{kind:info.kind});
 if(motion.delta.z!==0||working.z!==1)fail('Source accelerated scale Z projection is not closed');
 let calculatorWrite;
 for(const [index,axis] of ['x','y','z'].entries())if(parameters[index+1]!==undefined)calculatorWrite=nativeRoundPosition(Math.fround(working[axis]*dimensions[axis]));
 return {...(calculatorWrite===undefined?{}:{calculatorWrite}),motion,tag:info.tag};
}
