// Normal original 32-bit full-rectangle scaler. No browser resize filter.
export const NATIVE_MASK_SCALER_PROVENANCE=Object.freeze({report:'native-transition-mask-scaling-source.json',sha256:'bd3fa1a4dcf03ce9e686f88f5b4bba003fa4a971483a9e505594b9c405b30c7e',dispatcher:0x5c7ce0,scaler:0x5c8520,neighbours:0x5c78f0});
const Q=32768;
export function scaleNativeMaskBlue(blue,sourceWidth,sourceHeight,width,height){
  for(const value of [sourceWidth,sourceHeight,width,height])if(!Number.isSafeInteger(value)||value<1||value>8192)throw new Error('Invalid native mask dimensions');
  if(!(blue instanceof Uint8Array||blue instanceof Uint8ClampedArray)||blue.length!==sourceWidth*sourceHeight)throw new Error('Invalid exact source mask BLUE');
  if(sourceWidth>width*4||sourceHeight>height*4)throw new Error('Extreme native mask shrink path is outside this candidate');
  if(sourceWidth===width&&sourceHeight===height)return new Uint8Array(blue);
  const stepX=Math.trunc(sourceWidth*Q/width),stepY=Math.trunc(sourceHeight*Q/height),out=new Uint8Array(width*height);
  for(let y=0;y<height;y++){
    const cy=y*stepY,sy=Math.floor(cy/Q),fy=cy%Q,iy=Q-fy;
    for(let x=0;x<width;x++){
      const cx=x*stepX,sx=Math.floor(cx/Q),fx=cx%Q,ix=Q-fx;
      const tl=blue[sy*sourceWidth+sx];
      const tr=sx+1<sourceWidth?blue[sy*sourceWidth+sx+1]:tl;
      const bl=sy+1<sourceHeight?blue[(sy+1)*sourceWidth+sx]:tl;
      // Actual right-edge native branch returns upper-left for bottom-right.
      const br=sx+1<sourceWidth?(sy+1<sourceHeight?blue[(sy+1)*sourceWidth+sx+1]:tr):tl;
      const wtl=Math.floor(ix*iy/Q),wtr=Math.floor(fx*iy/Q),wbl=Math.floor(ix*fy/Q),wbr=Math.floor(fx*fy/Q);
      out[y*width+x]=Math.floor((tl*wtl+tr*wtr+bl*wbl+br*wbr)/Q);
    }
  }
  return out;
}
