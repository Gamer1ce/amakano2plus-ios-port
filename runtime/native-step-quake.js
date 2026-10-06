// Original motQuake chooses the first cumulative duration > elapsed.
// It adds a fixed XYZ displacement; it does not interpolate between steps.
const storage=new WeakMap();
const fail=message=>{throw new TypeError(message)};
const f=Math.fround;
export function createNativeStepQuake(steps){
  if(!Array.isArray(steps)||!steps.length||steps.length>1000)fail('Explicit bounded quake steps required');
  let durationFrames=0;
  const normalized=steps.map(step=>{
    if(!Array.isArray(step)||step.length!==4)fail('Quake step must contain duration and XYZ');
    const [duration,...delta]=step;
    // Source-used input arrays have positive integer durations. Native17/16
    // conversions of other arrays are outside this bounded port contract.
    if(!Number.isInteger(duration)||duration<=0||duration>0x7fffffff||f(duration)!==duration)fail('Unclosed quake duration');
    if(!delta.every(value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(f(value))))fail('Invalid Float32 quake displacement');
    durationFrames+=duration;if(durationFrames>0x7fffffff)fail('Quake cumulative duration overflow');
    return Object.freeze({until:durationFrames,duration,delta:Object.freeze({x:f(delta[0]),y:f(delta[1]),z:f(delta[2])})});
  });
  const plan=Object.freeze({kind:'motQuakeSteps',stepCount:normalized.length,durationFrames});
  storage.set(plan,Object.freeze(normalized));return plan;
}
export function sampleNativeStepQuake(plan,elapsedFrames,{stopRequested=false}={}){
  const steps=storage.get(plan);if(!steps)fail('Unrecognized quake plan');
  if(!Number.isInteger(elapsedFrames)||elapsedFrames<0||elapsedFrames>0xffffffff||typeof stopRequested!=='boolean')fail('Explicit integer quake elapsed and stop flag required');
  if(stopRequested||elapsedFrames>=plan.durationFrames)return {delta:{x:0,y:0,z:0},finished:true,roundWorkingPosition:false};
  const selected=steps.find(step=>step.until>elapsedFrames);
  return {delta:{...selected.delta},finished:false,roundWorkingPosition:false};
}
