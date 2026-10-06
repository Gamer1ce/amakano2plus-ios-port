// Source-backed integer transition kernels. This module supplies no pixel
// capture, mask scaling, frame-rate assumption, or DOM opacity fallback.
export const NATIVE_TRANSITION_PROVENANCE=Object.freeze({
  report:'native-transition-source-review.json',
  sha256:'d7b038d05007c7d878a9035e1872e62da01815aba658c8965c41f46051ea5812',
  nativeDefaultDrawTicks:20,nativeDefaultWipeTicks:20,
  maskChannel:'blue',maskScaleAccepted:false,tickToMillisecondsAccepted:false,
});
function integer(value,label,{min=Number.MIN_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER}={}) {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Invalid ${label}`);
  return value;
}
function parsed(token,evaluate,label) {
  const value=evaluate(token);
  if(!Number.isFinite(value))throw new Error(`Invalid ${label}`);
  return integer(Math.trunc(value),label);
}
export function nativeTransitionSpec(command,args,{evaluate=Number,drawTicks=20,wipeTicks=20}={}) {
  if(!['rdraw','rwipe'].includes(command)||!Array.isArray(args))throw new Error('Unsupported native transition specification');
  if(command==='rwipe'&&(!args[0]||typeof args[0]!=='string'))throw new Error('Native rwipe requires its actual mask resource');
  const offset=command==='rwipe'?1:0;
  const duration=args[offset]===undefined?integer(command==='rwipe'?wipeTicks:drawTicks,'native default duration'):parsed(args[offset],evaluate,'native duration');
  const from=args[offset+1]===undefined?0:parsed(args[offset+1],evaluate,'capture range from');
  const to=args[offset+2]===undefined?45000:parsed(args[offset+2],evaluate,'capture range to');
  return Object.freeze({kind:command,mask:command==='rwipe'?args[0].toLowerCase():null,
    suppliedTicks:duration,internalTicks:duration>2?duration-2:0,enabled:duration>2,
    captureRange:Object.freeze({from,to}),sourceTaskType:command==='rwipe'?39:38});
}
export function nativeTransitionDefaults(command,args,previous={drawTicks:20,wipeTicks:20},{evaluate=Number}={}) {
  if(!['drawdef','wipedef'].includes(command)||!Array.isArray(args))throw new Error('Invalid native transition defaults command');
  const result={...previous};
  if(args[0]!==undefined)result[command==='drawdef'?'drawTicks':'wipeTicks']=parsed(args[0],evaluate,'native default duration');
  // Second native drawdef/wipedef argument changes the ordinary draw/wipe
  // effect number at globals177604/177612; rdraw/rwipe do not consume it.
  return result;
}
function tickRatio(elapsed,duration,multiplier) {
  integer(elapsed,'elapsed task ticks',{min:0});integer(duration,'internal duration',{min:1});
  const product=BigInt(Math.min(elapsed,duration))*BigInt(multiplier);
  return Number(product/BigInt(duration));
}
export function nativeRdrawOldAlpha(elapsed,duration) {
  return 255-tickRatio(elapsed,duration,255);
}
export function nativeRwipeOldAlpha(maskBlue,elapsed,duration,{alphaBits=8}={}) {
  integer(maskBlue,'native mask blue',{min:0,max:255});
  if(alphaBits!==8&&alphaBits!==4)throw new Error('Unsupported native mask alpha format');
  const q=tickRatio(elapsed,duration,512);
  const alpha=255-Math.min(255,Math.max(0,maskBlue+q-256));
  return alphaBits===4?alpha&0xf0:alpha;
}
export function nativeRwipeAlphaTable(elapsed,duration,options) {
  const table=new Uint8Array(256);
  for(let blue=0;blue<256;blue++)table[blue]=nativeRwipeOldAlpha(blue,elapsed,duration,options);
  return table;
}
export function nativeRwipePreparedRGBA(maskRGBA,elapsed,duration) {
  if(!(maskRGBA instanceof Uint8Array||maskRGBA instanceof Uint8ClampedArray)||maskRGBA.length%4)throw new Error('Expected already prepared native-size RGBA mask pixels');
  const table=nativeRwipeAlphaTable(elapsed,duration),alphas=new Uint8Array(maskRGBA.length/4);
  // Native input is BGRA byte0; a standard Canvas RGBA readback puts BLUE at2.
  for(let pixel=0;pixel<alphas.length;pixel++)alphas[pixel]=table[maskRGBA[pixel*4+2]];
  return alphas;
}
