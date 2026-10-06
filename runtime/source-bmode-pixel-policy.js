// Derived source D3D factors: mode1 SRCALPHA/ONE; mode5 DESTCOLOR/ONE.
// This port owns coverage and alpha. It does not claim D3D GPU quantization.
export const SOURCE_BMODE_PORT_POLICY='opaque-source-mode-1-5-coverage-alpha-v1';
const require=(ok,message)=>{if(!ok)throw new Error('Source bmode: '+message)};
const byte=value=>{require(Number.isInteger(value)&&value>=0&&value<=255,'8-bit component');return value};
// macOS WK native q/destination measurements showed five source bytes whose
// original rounded q produced a two-byte error at one destination each. Lower
// these display encodings by one; ideal float color-dodge stays within one byte
// over all65,536 source/destination pairs. Actual corrected Native/iPad runs
// remain required; the source/raw-capture blend equation below is unchanged.
const lowerDisplayQ=new Set([180,183,186,189,192]);
export const SOURCE_BMODE5_DISPLAY_QUANTIZATION_POLICY='port-five-byte-q-exceptions-v1';
export function sourceBmode5MappedByte(value){value=byte(value);const q=Math.floor(255*value/(255+value)+.5);return q-(lowerDisplayQ.has(value)?1:0)}
export function sourceBmodeRGBByte(mode,source,destination,coverage=255){
 source=byte(source);destination=byte(destination);coverage=byte(coverage);
 require(mode===1||mode===5,'implemented source mode');
 return Math.min(255,Math.floor((mode===1?destination+source*coverage/255:destination*(1+source*coverage/(255*255)))+.5));
}
export function sourceBmode5MapOpaquePixels(input){
 require(input instanceof Uint8ClampedArray&&input.length%4===0,'RGBA pixels');
 // Validate the full source before any owned Canvas is changed.
 for(let i=3;i<input.length;i+=4)require(input[i]===255,'mode5 requires bound opaque source texture');
 const output=new Uint8ClampedArray(input.length);
 for(let i=0;i<input.length;i+=4){for(let c=0;c<3;c++)output[i+c]=sourceBmode5MappedByte(input[i+c]);output[i+3]=255}
 return output;
}
export function composeSourceBmodePixels(mode,source,destination){
 require(source instanceof Uint8ClampedArray&&destination instanceof Uint8ClampedArray&&source.length===destination.length&&source.length%4===0,'matching RGBA buffers');
 require(mode===1||mode===5,'implemented source mode');const output=new Uint8ClampedArray(destination.length);
 for(let i=0;i<source.length;i+=4){
  const coverage=source[i+3];
  for(let c=0;c<3;c++)output[i+c]=sourceBmodeRGBByte(mode,source[i+c],destination[i+c],coverage);
  // Source mode1 alpha on opaque backdrop remains opaque. Transparent capture
  // ranges use additive alpha. Mode5 preserves backdrop alpha and does not turn
  // an omitted/transparent capture background into an opaque flare rectangle.
  output[i+3]=mode===1?Math.min(255,destination[i+3]+coverage):destination[i+3];
 }
 return output;
}
export function composeSourceBmodeCanvases(mode,source,destination){
 require(source.width===destination.width&&source.height===destination.height,'matching Canvas bounds');
 const width=source.width,height=source.height,s=source.getContext('2d',{willReadFrequently:true}),d=destination.getContext('2d',{willReadFrequently:true});require(s&&d,'Canvas2D');
 const result=d.getImageData(0,0,width,height);result.data.set(composeSourceBmodePixels(mode,s.getImageData(0,0,width,height).data,result.data));d.putImageData(result,0,0);
}
