import {nativeWorkingXYZ,nativeRoundPosition,createNativePositionMotion,sampleNativePositionMotion} from './native-position-motion.js';
const f=Math.fround,axes=['x','y','z'];
const fail=message=>{throw new TypeError(message)};
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
export const NATIVE_SCALE_SOURCE=Object.freeze({kcsMScale:177398,kcsM2Scale:268232,mot:'motScale',workingSelector:4,baseScaleOffset:0xd4,delayOffset:0x2d4,percentNative:'0x57b510',percentParser:'0x5e95a0',normalizedGroups:['bg','cg','eg','fg','fw'],nativeRasterAcceptance:false});

// The original percentage helper parses an integer PREFIX, wraps its 32-bit
// accumulation, rejects a following decimal point, then overwrites the token.
// Thus 12+3% becomes 12 at basis100; this is not a postfix expression operator.
export function nativePercentToken(token,basis){
 if(typeof token!=='string'||!Number.isInteger(basis)||basis<0||basis>0xffffffff)fail('Invalid native percentage token/basis');
 if(!token.endsWith('%'))return token;
 let i=0,negative=false;if(token[i]==='-'||token[i]==='+'){negative=token[i]==='-';i++}
 if(!/[0-9]/.test(token[i]??''))return token;
 let value=0;
 if(token[i]==='0'&&/[xX]/.test(token[i+1]??'')){
  i+=2;while(/[0-9a-fA-F]/.test(token[i]??'')){value=((value<<4)+parseInt(token[i++],16))|0}
 }else{
  while(/[0-9]/.test(token[i]??'')){value=(Math.imul(value,10)+Number(token[i++]))|0}
  if(token[i]==='.')return token;
 }
 if(negative)value=(-value)|0;
 const result=f(f(f(value)*f(basis))/f(100));
 // CVTTSS2SI returns INT_MIN for an out-of-range result.
 return String(!Number.isFinite(result)||result>=2147483648||result< -2147483648?-2147483648:Math.trunc(result));
}

export function nativeScaleTarget(token,current){
 token=nativePercentToken(String(token),100);
 const match=/^(@|[+-]?(?:0[xX][0-9a-fA-F]+|\d+))([+-]\d+)?$/.exec(token);
 if(!match)fail('Native scale calculator grammar beyond literal/@ offset is not closed');
 const lhs=match[1]==='@'?current:Number(match[1]),rhs=match[2]===undefined?0:Number(match[2]);
 if(!Number.isInteger(lhs)||lhs< -2147483648||lhs>2147483647||!Number.isInteger(rhs)||rhs< -2147483648||rhs>2147483647)fail('Native scale integer operand outside signed32 scope');
 return (lhs+rhs)|0;
}

export function createNativeScaleMotion(durationFrames,delta){
 const line=createNativePositionMotion(durationFrames,delta);
 return Object.freeze({version:1,kind:'motScale',durationFrames:line.durationFrames,delta:line.delta});
}
export function restoreNativeScaleMotion(plan){
 if(!exact(plan,['version','kind','durationFrames','delta'])||plan.version!==1||plan.kind!=='motScale')fail('Invalid saved native scale motion');
 const copy=createNativeScaleMotion(plan.durationFrames,plan.delta);
 if(copy.durationFrames!==plan.durationFrames||axes.some(axis=>copy.delta[axis]!==plan.delta[axis]))fail('Non-normalized saved scale motion');return copy;
}
export function sampleNativeScaleMotion(plan,elapsedFrames,{stopRequested=false}={}){
 const copy=restoreNativeScaleMotion(plan);
 // motScale uses the same native41 linear interpolation; its body never calls
 // native17 for working position or scale rounding.
 return sampleNativePositionMotion({...copy,kind:'move',roundFinal:false},elapsedFrames,{stopRequested});
}
export function createNormalizedNativeScaleMotion(durationFrames,targets,baseScale,workingScale){
 if(!Array.isArray(targets)||targets.length>3)fail('Invalid native scale target arity');
 const base=nativeWorkingXYZ(baseScale),working=nativeWorkingXYZ(workingScale),delta={};
 for(const [i,axis]of axes.entries()){
  const current=nativeRoundPosition(f(base[axis]*f(100)));
  const target=targets[i]===undefined?f(1):f(f(nativeScaleTarget(targets[i],current))/f(100));
  delta[axis]=f(target-working[axis]);
 }
 return createNativeScaleMotion(durationFrames,delta);
}

// The PL/MPL caller uses rectangle END x/y (bank+100/+104), unlike the
// normalized image caller. native46 truncates percent to integer pixel units
// before division. Its @ is rounded WORKING scale times the same dimension.
// This numeric entry point requires the caller to supply source-derived fields;
// it does not infer dimensions from a texture, viewport or browser rectangle.
export function createDimensionNativeScaleMotion(durationFrames,targets,workingScale,dimensions){
 if(!Array.isArray(targets)||targets.length>3)fail('Invalid native dimension scale target arity');
 const working=nativeWorkingXYZ(workingScale),size=nativeWorkingXYZ(dimensions),delta={};
 if(size.z!==1||size.x<=0||size.y<=0)fail('Native plane scale nonpositive/nonunit dimension basis is not closed');
 for(const [i,axis]of axes.entries()){
  const dimension=size[axis],basis=nativeRoundPosition(dimension);
  const current=nativeRoundPosition(f(working[axis]*dimension));
  const targetUnits=targets[i]===undefined?dimension:f(nativeScaleTarget(nativePercentToken(String(targets[i]),basis),current));
  const target=f(targetUnits/dimension);
  delta[axis]=f(target-working[axis]);
 }
 return createNativeScaleMotion(durationFrames,delta);
}
