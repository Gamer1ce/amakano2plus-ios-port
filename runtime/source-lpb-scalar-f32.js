// Bounded transcription of the pinned LPB SSE scalar instruction sequence.
// Explicit IEEE binary32 nearest rounding; original process MXCSR is unverified.
export const SOURCE_LPB_F32_PROVENANCE=Object.freeze({
  scalarReportSHA256:'bd6bcb324ab3f29cc31b0c149976b63ed97653670836ed9325a180a5d5fc622d',
  soundClockReportSHA256:'df058d9fb913a0102278b5abb14e306a82c3c702cd03e305ea435db0e5fc5901',
  arithmetic:'Each pinned subss/divss/mulss/addss operation rounds to IEEE binary32 nearest; no fused operation.',
  supportedRecords:'Contiguous original 32-byte LPB records, source corpus header60; single-record native preprocess yields zero.',
  originalMXCSRProven:false,rendererIntegrationAccepted:false,nativeClockSelectionAccepted:false
});
const storage=new WeakMap(),f32=Math.fround;
const require=(condition,message)=>{if(!condition)throw new Error(message)};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const asFloat=(value,message)=>{require(finite(value)&&Number.isFinite(f32(value)),message);return f32(value)};
export function parseSourceLpb(bytes,{weights,smoothRadius}={}){
  require(bytes instanceof Uint8Array,'LPB requires original bytes');
  require(Array.isArray(weights)&&weights.length===6&&weights.every(value=>finite(value)&&value>=0&&value<=1),'Explicit six-category LPB weights required');
  require(Number.isSafeInteger(smoothRadius)&&smoothRadius>=0&&smoothRadius<=64,'Explicit bounded LPB smoothing radius required');
  require(bytes.byteLength>=52&&bytes.byteLength<=8*1024*1024,'Invalid LPB byte bound');
  const original=bytes.slice(),view=new DataView(original.buffer,original.byteOffset,original.byteLength);
  require(view.getUint32(0,true)===0x0044504c,'Invalid original LPB signature');
  const sourceFPS=view.getUint32(4,true),recordBytes=view.getUint32(8,true),recordCount=view.getUint32(12,true),threshold=-view.getFloat32(16,true);
  require(sourceFPS===60&&recordBytes===32&&recordCount>0&&20+recordCount*recordBytes===original.byteLength,'Unsupported or truncated original LPB layout');
  require(smoothRadius<=recordCount,'Radius beyond source timeline is unsupported');
  require(finite(threshold)&&threshold>20,'Invalid LPB threshold');
  const sourceWeights=weights.map(f32),raw=new Float32Array(recordCount),denominator=f32(threshold-20);
  for(let index=0;index<recordCount;index++){
    const start=20+index*32,frame=view.getUint32(start,true),category=view.getUint32(start+4,true),feature=view.getFloat32(start+28,true);
    require(frame===index,'Noncontiguous LPB timeline needs separate source closure');
    require(category<6&&finite(feature),'Invalid consumed LPB record field');
    // Native 4ad399 skips its record lookup when record count <=1.
    if(recordCount===1)continue;
    const clipped=Math.min(Math.max(-feature,20),threshold);
    const clippedDifference=f32(clipped-20),numerator=f32(denominator-clippedDifference);
    const strength=f32(numerator/denominator),scaled=f32(strength*f32(.4));
    const offset=f32(scaled+f32(.6));
    raw[index]=f32(offset*sourceWeights[category]);
  }
  const smoothed=raw.slice(),diameter=f32(smoothRadius*2+1);
  if(smoothRadius>0){
    for(let index=smoothRadius;index<recordCount-smoothRadius;index++){
      let total=0;
      for(let offset=-smoothRadius;offset<=smoothRadius;offset++)total=f32(total+raw[index+offset]);
      smoothed[index]=f32(total/diameter);
    }
  }
  const plan=Object.freeze({kind:'source-lpb-scalar-f32',sourceFPS,recordCount,sourceByteLength:original.byteLength,smoothRadius,threshold});
  storage.set(plan,{original,smoothed});return plan;
}
export function sourceLpbScalarAtCounter(plan,counter,{minimum,maximum,latency}={}){
  const data=storage.get(plan);require(data,'Unrecognized LPB plan');
  require(Number.isSafeInteger(counter)&&(counter===-1||(counter>=0&&counter<=0xffffffff)),'Explicit original unsigned32 LPB counter or -1 sentinel required');
  const lo=asFloat(minimum,'Explicit finite Float32 LPB minimum required'),hi=asFloat(maximum,'Explicit finite Float32 LPB maximum required');
  require(hi>=lo&&Number.isFinite(f32(hi-lo)),'Unsupported LPB range');
  require(Number.isSafeInteger(latency)&&latency>=0&&latency<=0xffffffff,'Explicit unsigned32 LPB latency required');
  const unsigned=counter===-1?0xffffffff:counter;
  if(unsigned<latency)return lo;
  const index=unsigned-latency;
  if(index>=plan.recordCount)return lo;
  const delta=f32(hi-lo),product=f32(delta*data.smoothed[index]);
  return f32(product+lo);
}
export function copySourceLpbBytes(plan){const data=storage.get(plan);require(data,'Unrecognized LPB plan');return data.original.slice()}
