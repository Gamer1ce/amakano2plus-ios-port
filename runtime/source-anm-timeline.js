// Exact observed ANM subset. This is an integer-tick parser/evaluator, not an image renderer.
const trustedPlans=new WeakSet();
function fail(message){throw new Error(`Unsupported source ANM: ${message}`);}
export function parseSourceAnm(bytes,availableFrameIds){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<32)fail('header');
  if(!(availableFrameIds instanceof Set)||![...availableFrameIds].every(id=>Number.isSafeInteger(id)&&id>=0))fail('frame catalog');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),word=at=>view.getUint32(at,true);
  if(word(0)!==0x004d4e41||word(4)!==0||[12,16,20,24,28].some(at=>word(at)!==0))fail('magic/header fields');
  const count=word(8);if(count===0||count>256||bytes.byteLength!==32+count*68)fail('record count/length');
  const frames=[];let loop=false,total=0;
  for(let index=0;index<count;index++){
    const at=32+index*68,row=Array.from({length:17},(_,n)=>word(at+4*n));
    if(row[0]===3){
      if(index!==count-1||row.slice(1).some(value=>value!==0)||frames.length===0)fail('jump scope');
      loop=true;continue;
    }
    if(row[0]!==0||row[1]!==0||row[3]!==0||row[5]!==0||row[4]!==row[6]||row[4]===0||row.slice(7).some(value=>value!==0))fail('record semantics');
    if(!availableFrameIds.has(row[2]))fail(`absent required frame ${row[2]}`);
    if(total+row[4]>0x7fffffff)fail('duration overflow');
    frames.push(Object.freeze({recordIndex:index,frameId:row[2],startTick:total,durationTicks:row[4]}));total+=row[4];
  }
  if(frames.length===0)fail('empty timeline');
  const plan=Object.freeze({frames:Object.freeze(frames),loop,totalTicks:total,clockDomain:'original-integer-ticks'});
  trustedPlans.add(plan);return plan;
}
export function sourceAnmFrameAtTick(plan,elapsedTicks){
  if(!trustedPlans.has(plan))fail('unparsed plan');
  if(!Number.isSafeInteger(elapsedTicks)||elapsedTicks<0||elapsedTicks>0x7fffffff)fail('integer elapsed clock');
  const tick=plan.loop?elapsedTicks%plan.totalTicks:Math.min(elapsedTicks,plan.totalTicks-1);
  // A frame changes exactly when previous duration expires, including jump0's immediate next record.
  let low=0,high=plan.frames.length-1;
  while(low<high){const middle=(low+high+1)>>1;if(plan.frames[middle].startTick<=tick)low=middle;else high=middle-1;}
  return plan.frames[low].frameId;
}
