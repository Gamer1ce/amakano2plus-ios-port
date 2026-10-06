// Original CPU path Native737 -> 685160 -> 5ceaf0. The browser decoder and
// premultiplication remain port responsibilities; the RGB byte kernel is exact.
export const SOURCE_BITMAP_SEPIA_POLICY='source-f32-truncated-lut-sepia-v1';
export const PORT_MPL_SEPIA_POLICY='port-standard-sepia-matrix-v1';
const coefficients=Object.freeze([Math.fround(0.298911988735199),Math.fround(0.5866109728813171),Math.fround(0.11447799950838089)]);
const tables=coefficients.map(value=>Uint8Array.from({length:256},(_,index)=>Math.trunc(Math.fround(index*value))));
const require=(condition,message)=>{if(!condition)throw new Error('Source bitmap sepia: '+message)};
export function applySourceBitmapSepia(rgba){
 require(rgba instanceof Uint8ClampedArray||rgba instanceof Uint8Array,'RGBA byte array');
 require(rgba.length%4===0,'RGBA length');
 for(let index=0;index<rgba.length;index+=4){
  const gray=(tables[0][rgba[index]]+tables[1][rgba[index+1]]+tables[2][rgba[index+2]])&255;
  rgba[index]=Math.min(gray+30,255);rgba[index+1]=Math.min(gray+5,255);rgba[index+2]=Math.max(gray-35,0);
 }
 return rgba;
}
export function applyPortMplSepia(rgba){
 require(rgba instanceof Uint8ClampedArray&&rgba.length%4===0,'port MPL RGBA byte array');
 // This explicit port matrix corresponds to live CSS sepia(1). Its arithmetic
 // is a port policy, independent of the unclosed original driver/GPU shader.
 for(let i=0;i<rgba.length;i+=4){const r=rgba[i],g=rgba[i+1],b=rgba[i+2];rgba[i]=Math.min(255,Math.round(.393*r+.769*g+.189*b));rgba[i+1]=Math.min(255,Math.round(.349*r+.686*g+.168*b));rgba[i+2]=Math.min(255,Math.round(.272*r+.534*g+.131*b))}
 return rgba;
}
const owned=new WeakMap();
const dimensions=layer=>{
 const width=layer.frame?.width,height=layer.frame?.height;
 require(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width*height<=16777216,'bounded frame dimensions');
 return {width,height};
};
const context=canvas=>{const value=canvas.getContext('2d',{willReadFrequently:true});require(value,'Canvas2D');return value};
function release(entry){if(entry?.staticCanvas){entry.original.remove?.();entry.staticCanvas.width=entry.staticCanvas.height=0}if(entry)entry.raw=null}
function paintComposite(original,canvas,sepia){
 const ctx=context(canvas);ctx.clearRect(0,0,canvas.width,canvas.height);
 const scratch=document.createElement('canvas');
 try{for(const child of original.children){
  require(child.tagName==='IMG'&&Number.isSafeInteger(child.naturalWidth)&&Number.isSafeInteger(child.naturalHeight)&&child.naturalWidth>0&&child.naturalHeight>0,'decoded composite child');
  const left=Number.parseFloat(child.style.left),top=Number.parseFloat(child.style.top);
  require(Number.isFinite(left)&&Number.isFinite(top),'composite child position');
  if(!sepia){ctx.drawImage(child,left,top);continue}
  // Native737 visits every image in the image collection. Filter each source
  // child before compositing so overlapping alpha is not filtered twice.
  scratch.width=child.naturalWidth;scratch.height=child.naturalHeight;const c=context(scratch);c.drawImage(child,0,0);
  const data=c.getImageData(0,0,scratch.width,scratch.height);applySourceBitmapSepia(data.data);c.putImageData(data,0,0);ctx.drawImage(scratch,left,top);
 }}finally{scratch.width=scratch.height=0}
}
export function withSourceBitmapSepia(BaseRenderer){
 return class SourceBitmapSepiaRenderer extends BaseRenderer{
  constructor(options={},...rest){
   super(options,...rest);require(options.sourceBitmapSepia===undefined||typeof options.sourceBitmapSepia==='boolean','boolean bitmap option');
   require(options.portMplSepia===undefined||typeof options.portMplSepia==='boolean','boolean MPL option');
   owned.set(this,{bitmap:options.sourceBitmapSepia===true,mpl:options.portMplSepia===true,entries:new Map(),revision:0});
  }
  place(layer,...rest){
   const state=owned.get(this);
   // A parent constructor can call a virtual place before this wrapper owns state.
   if(!state)return super.place(layer,...rest);
   if(state.mpl&&layer.group==='mpl'&&layer.player&&layer.mode==='sepia'){
    layer.element.dataset.portColorPolicy=PORT_MPL_SEPIA_POLICY;
    this.warn('MPL 棕褐色使用移植滤镜；原版 GPU 像素尚未对照');
   }else if(layer.group==='mpl'&&layer.element?.dataset)delete layer.element.dataset.portColorPolicy;
   if(!state.bitmap||!['bg','eg'].includes(layer.group)||!layer.element||layer.player)return super.place(layer,...rest);
   let entry=state.entries.get(layer);
   const sepia=layer.mode==='sepia';
   if(!sepia&&!entry)return super.place(layer,...rest);
   require(!layer.color,'bitmap sepia solid color is outside the used source domain');
   const size=dimensions(layer),element=layer.element;
   require(element.tagName==='IMG'||element.tagName==='CANVAS'||(element.tagName==='DIV'&&layer.composite),'bitmap image, source composite or animation canvas');
   const replaced=entry&&element!==entry.canvas;
   if(replaced){release(entry);state.entries.delete(layer);entry=null}
   const fresh=!entry||entry.frame!==layer.frame||entry.asset!==layer.asset;
   if(fresh){
    if(entry)require(!entry.staticCanvas,'static frame replacement must use the image lifecycle');
    let canvas=element,staticCanvas=null;
    if(element.tagName!=='CANVAS'){
     if(element.tagName==='IMG')require(element.naturalWidth===size.width&&element.naturalHeight===size.height,'intrinsic static dimensions');
     canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;canvas.style.position='absolute';
     if(element.tagName==='DIV')paintComposite(element,canvas,false);else context(canvas).drawImage(element,0,0);staticCanvas=canvas;
    }
    require(canvas.width===size.width&&canvas.height===size.height,'painted animation dimensions');
    const ctx=context(canvas),pixels=ctx.getImageData(0,0,size.width,size.height);
    require(pixels.data instanceof Uint8ClampedArray&&pixels.data.length===size.width*size.height*4,'complete RGBA pixels');
    const next={original:element,canvas,staticCanvas,frame:layer.frame,asset:layer.asset,raw:new Uint8ClampedArray(pixels.data),sepia:false,revision:++state.revision};
    // Pixel acquisition precedes replacing the live static element.
    if(staticCanvas){element.remove();document.getElementById('layers').append(canvas);layer.element=canvas}
    entry=next;state.entries.set(layer,entry);
   }
   if(entry.sepia!==sepia){
    const ctx=context(entry.canvas),pixels=ctx.createImageData(size.width,size.height);pixels.data.set(entry.raw);
    if(sepia&&entry.original.tagName==='DIV')paintComposite(entry.original,entry.canvas,true);
    else{if(sepia)applySourceBitmapSepia(pixels.data);ctx.putImageData(pixels,0,0)}entry.sepia=sepia;entry.revision=++state.revision;
   }
   const savedMode=layer.mode;
   // The visible pixels already include mode2. Avoid applying CSS sepia again.
   if(sepia)layer.mode=undefined;
   try{return super.place(layer,...rest)}finally{layer.mode=savedMode;entry.canvas.dataset.sourceColorPolicy=SOURCE_BITMAP_SEPIA_POLICY}
  }
  clear(layer,...rest){const state=owned.get(this),entry=state?.entries.get(layer);state?.entries.delete(layer);release(entry);return super.clear(layer,...rest)}
  sourceBitmapColorFrame(layer){
   const state=owned.get(this),entry=state.entries.get(layer);if(!entry)return null;
   require(entry.canvas===layer.element&&entry.frame===layer.frame&&entry.asset===layer.asset,'color pipeline bank identity');
   const revision=entry.revision,sepia=entry.sepia,size=dimensions(layer);
   // A final blend owner can copy post-mode/pre-blend pixels without reading
   // its previously mapped live canvas. This callback never returns raw storage.
   return Object.freeze({element:entry.canvas,frame:entry.frame,asset:entry.asset,revision,policy:SOURCE_BITMAP_SEPIA_POLICY,paintTo:target=>{
    require(state.entries.get(layer)===entry&&entry.revision===revision&&entry.canvas===layer.element,'stale color frame lease');
    require(target!==entry.canvas&&target.tagName==='CANVAS'&&target.width===size.width&&target.height===size.height,'separate correctly sized blend canvas');
    if(sepia&&entry.original.tagName==='DIV'){paintComposite(entry.original,target,true);return}
    const ctx=context(target),pixels=ctx.createImageData(size.width,size.height);pixels.data.set(entry.raw);if(sepia)applySourceBitmapSepia(pixels.data);ctx.putImageData(pixels,0,0);
   }});
  }
  sourceVisualFrozenRecord(layer,bitmap,...rest){
   const inherited=super.sourceVisualFrozenRecord?.(layer,bitmap,...rest)??{};
   const state=owned.get(this);if(!state.mpl||layer.group!=='mpl'||!layer.player||layer.mode!=='sepia')return inherited;
   require(bitmap?.tagName==='CANVAS'&&Number.isSafeInteger(bitmap.width)&&Number.isSafeInteger(bitmap.height)&&bitmap.width>0&&bitmap.height>0&&bitmap.width*bitmap.height<=16777216,'bounded frozen MPL canvas');
   const ctx=context(bitmap),pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height);applyPortMplSepia(pixels.data);ctx.putImageData(pixels,0,0);
   // Root capture adapter calls this once for each newly cloned frozen bitmap.
   // Keep an unrelated blur if present; sepia has already entered the pixels.
   return {...inherited,filter:layer.blur?`blur(${layer.blur}px)`:'none',portColorPolicy:PORT_MPL_SEPIA_POLICY};
  }
  sourceBitmapSepiaDiagnostics(){const state=owned.get(this);return {bitmapEnabled:state.bitmap,mplEnabled:state.mpl,retainedFrames:state.entries.size,retainedRGBABytes:[...state.entries.values()].reduce((total,entry)=>total+(entry.raw?.byteLength??0),0)}}
  snapshot(...rest){const data=super.snapshot(...rest),state=owned.get(this);return state.bitmap||state.mpl?{...data,sourceBitmapSepia:{version:1,bitmap:state.bitmap,mpl:state.mpl,bitmapPolicy:SOURCE_BITMAP_SEPIA_POLICY,mplPolicy:PORT_MPL_SEPIA_POLICY}}:data}
  validateSave(saved,...rest){
   const data=super.validateSave(saved,...rest),policy=data.sourceBitmapSepia,state=owned.get(this);
   if(policy!==undefined)require(policy?.version===1&&policy.bitmap===state.bitmap&&policy.mpl===state.mpl&&policy.bitmapPolicy===SOURCE_BITMAP_SEPIA_POLICY&&policy.mplPolicy===PORT_MPL_SEPIA_POLICY&&Object.keys(policy).length===5,'saved policy');
   return data;
  }
 };
}
