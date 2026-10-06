// Target cs2.exe native728 -> bitmap mask type4 -> CPU 5c96a0.
// Only already-composited destination alpha changes; RGB and outside crop remain.
export const SOURCE_PLANE_ALPHA_MASK_POLICY='source-cpu-channel4-byte-alpha-product-on-source-crop';
const require=(ok,message)=>{if(!ok)throw new Error('Source plane alpha mask: '+message)};
const uint=(value,max,label)=>{require(Number.isSafeInteger(value)&&value>=0&&value<=max,label);return value};
export function sourcePlaneMaskAlpha(destinationAlpha,sourceAlpha){
 uint(destinationAlpha,255,'destination byte');uint(sourceAlpha,255,'source byte');
 return (((destinationAlpha+1)*(sourceAlpha+1))-1)>>>8;
}
export function applySourcePlaneAlphaMask({destination,width,height,source,sourceWidth,sourceHeight,left,top}){
 uint(width,8192,'width');uint(height,8192,'height');uint(sourceWidth,8192,'source width');uint(sourceHeight,8192,'source height');
 require(width>0&&height>0&&sourceWidth>0&&sourceHeight>0&&width*height<=16777216&&sourceWidth*sourceHeight<=16777216,'bounded positive dimensions');
 require(Number.isSafeInteger(left)&&Number.isSafeInteger(top),'integer crop placement');
 require((destination instanceof Uint8Array||destination instanceof Uint8ClampedArray)&&destination.length===width*height*4,'destination RGBA');
 require((source instanceof Uint8Array||source instanceof Uint8ClampedArray)&&source.length===sourceWidth*sourceHeight*4,'source RGBA');
 const result=new Uint8ClampedArray(destination),x0=Math.max(0,left),y0=Math.max(0,top),x1=Math.min(width,left+sourceWidth),y1=Math.min(height,top+sourceHeight);
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const d=(y*width+x)*4+3,s=((y-top)*sourceWidth+x-left)*4+3;
  result[d]=sourcePlaneMaskAlpha(result[d],source[s]);
 }
 return result;
}
