import {argumentsOf,numericArgument} from './expressions.js';
import {layerIds} from './renderer.js';
import {SOURCE_BMODE_PORT_POLICY,sourceBmode5MapOpaquePixels} from './source-bmode-pixel-policy.js';
const require=(ok,message)=>{if(!ok)throw new Error('Source bmode: '+message)};
const modeOf=value=>value===undefined?0:value;
function createCanvas(width,height){const value=document.createElement('canvas');value.width=width;value.height=height;require(value.getContext('2d'),'Canvas2D');return value}
function release(row){if(row?.raw){row.raw.width=row.raw.height=0}}
function validateState(data){
 const state=data?.sourceBmode;require(state&&Object.getPrototypeOf(state)===Object.prototype&&Object.keys(state).sort().join(',')==='planes,policy,version'&&state.version===1&&state.policy===SOURCE_BMODE_PORT_POLICY&&Array.isArray(state.planes)&&state.planes.length<=1000,'own save policy');
 const map=new Map();for(const row of state.planes){require(row&&Object.getPrototypeOf(row)===Object.prototype&&Object.keys(row).sort().join(',')==='id,mode'&&typeof row.id==='string'&&/^(?:0|[1-9]\d{0,2})$/.test(row.id)&&[1,5].includes(row.mode)&&!map.has(row.id),'saved mode bank');map.set(row.id,row.mode)}
 require([...map.keys()].every(id=>data.layers.some(row=>row.group==='pl'&&String(row.id)===id)),'saved plane present');return map;
}
export function withSourceBmode(BaseRenderer){return class SourceBmodeRenderer extends BaseRenderer{
 constructor(options,...rest){
  const enabled=options?.sourceBmode??false;require(typeof enabled==='boolean','explicit enable boolean');if(enabled)require(options.sourceBmodePolicy===SOURCE_BMODE_PORT_POLICY,'explicit pixel/alpha policy');
  super(options,...rest);this.sourceBmodeEnabled=enabled;this.sourceBmodeRawFrames=new Map();this.sourceBmodeEvents=[];
  if(enabled&&typeof globalThis.CSS?.supports==='function')require(CSS.supports('mix-blend-mode','plus-lighter')&&CSS.supports('mix-blend-mode','color-dodge'),'required live CSS blend support');
 }
 sourceBmodeEvent(row){this.sourceBmodeEvents?.push(Object.freeze(row));if(this.sourceBmodeEvents?.length>256)this.sourceBmodeEvents.shift()}
 sourceBmodeForLayer(layer){return modeOf((layer.group==='pl'?layer:this.layers.get('pl:'+String(layer.planeId)))?.sourceBmode)}
 place(layer,...rest){
  // A source bitmap repaint changes frame identity first. Restore only an exact
  // same-frame blend surface before the parent color pipeline sees live pixels.
  const before=this.sourceBmodeRawFrames?.get(layer),sameBefore=before&&before.element===layer.element&&before.frameId===layer.frame?.id&&before.asset===layer.asset;
  if(this.sourceBmodeEnabled&&sameBefore){const ctx=layer.element.getContext('2d');ctx.clearRect(0,0,layer.element.width,layer.element.height);ctx.drawImage(before.raw,0,0)}
  super.place(layer,...rest);if(!this.sourceBmodeEnabled||!layer.element)return;
  const mode=this.sourceBmodeForLayer(layer),element=layer.element,previous=this.sourceBmodeRawFrames.get(layer);require([0,1,5].includes(mode),'unimplemented live mode');
  const same=previous&&previous.element===element&&previous.frameId===layer.frame?.id&&previous.asset===layer.asset;
  if(previous&&(!same||mode!==5)){release(previous);this.sourceBmodeRawFrames.delete(layer)}
  if(mode===5){
   require(layer.group==='eg'&&String(layer.id)==='4'&&layer.asset==='bg_flare2'&&element.tagName==='CANVAS','mode5 source actual used texture/ANM Canvas');
   require(Number(element.style.opacity)===1||Number(element.style.opacity)===0,'mode5 actual used opacity scope');
   const color=this.sourceBitmapColorFrame?.(layer)??null;
   if(color)require(color.element===element&&color.frame===layer.frame&&color.asset===layer.asset&&Number.isSafeInteger(color.revision)&&typeof color.paintTo==='function','post-color/pre-blend current frame lease');
   const raw=same?previous.raw:createCanvas(element.width,element.height);
   try{
    if(color)color.paintTo(raw);
    else if(!same){const ctx=raw.getContext('2d');ctx.clearRect(0,0,raw.width,raw.height);ctx.drawImage(element,0,0)}
    const pixels=raw.getContext('2d',{willReadFrequently:true}).getImageData(0,0,raw.width,raw.height),mapped=sourceBmode5MapOpaquePixels(pixels.data);
    pixels.data.set(mapped);element.getContext('2d').putImageData(pixels,0,0);
    this.sourceBmodeRawFrames.set(layer,{element,frameId:layer.frame.id,asset:layer.asset,raw,colorRevision:color?.revision??null});
    if(!same)this.sourceBmodeEvent({type:'frame-mapped',group:layer.group,id:layer.id,asset:layer.asset,frameId:layer.frame.id,policy:SOURCE_BMODE_PORT_POLICY});
    else if(previous.colorRevision!==(color?.revision??null))this.sourceBmodeEvent({type:'color-remapped',group:layer.group,id:layer.id,asset:layer.asset,frameId:layer.frame.id,revision:color?.revision??null});
   }catch(error){if(!same)raw.width=raw.height=0;throw error}
   element.style.mixBlendMode='color-dodge';
  }else if(mode===1){
   require(layer.group==='pl'&&['5','31'].includes(String(layer.id))&&layer.color?.toLowerCase()==='$ffffffff'||layer.group==='eg'&&String(layer.id)==='2'&&layer.asset==='bg_flare3','mode1 source actual white/flare scope');element.style.mixBlendMode='plus-lighter';
  }else element.style.mixBlendMode='normal';
 }
 // Called synchronously by freezeNativePumpFront, before its await/lookahead.
 // The returned record owns copied raw pixels, not a live ANM Canvas pointer.
 sourceBmodeFrozenRecord(layer,bitmap){
  if(!this.sourceBmodeEnabled)return {};
  const mode=this.sourceBmodeForLayer(layer);if(mode===5){const row=this.sourceBmodeRawFrames.get(layer);require(row&&row.element===layer.element&&row.frameId===layer.frame?.id,'raw current frame for capture');const ctx=bitmap.getContext('2d');ctx.clearRect(0,0,bitmap.width,bitmap.height);ctx.drawImage(row.raw,0,0,bitmap.width,bitmap.height)}
  return {sourceBmode:mode,sourceBmodePolicy:SOURCE_BMODE_PORT_POLICY};
 }
 initialize(layer,...rest){if(this.sourceBmodeEnabled&&layer.group==='pl')layer.sourceBmode=0;return super.initialize(layer,...rest)}
 clear(layer,...rest){const row=this.sourceBmodeRawFrames?.get(layer);release(row);this.sourceBmodeRawFrames?.delete(layer);return super.clear(layer,...rest)}
 async command(cmd,args,state,location,...rest){
  if(!this.sourceBmodeEnabled)return super.command(cmd,args,state,location,...rest);
  const parts=argumentsOf(args);if(cmd==='pl'&&parts[1]==='bmode'){
   const mode=numericArgument(parts[2]??'0',state);require(Number.isSafeInteger(mode)&&[0,1,5].includes(mode),'source used mode0/1/5');require(parts.length===2||parts.length===3,'bmode argument count');
   await this.interruptSourceGlobalRestore?.();this.cancelPortMotionRestore?.();this.cancelSourceImageRestoreForNormalOperation?.();
   for(const id of layerIds(parts[0],state)){const layer=this.bank('pl',id);layer.sourceBmode=mode;this.place(layer);this.sourceBmodeEvent({type:'plane-mode',id:String(id),mode,location})}return;
  }
  return super.command(cmd,args,state,location,...rest);
 }
 snapshot(...rest){const data=super.snapshot(...rest);if(!this.sourceBmodeEnabled)return data;return {...data,sourceBmode:{version:1,policy:SOURCE_BMODE_PORT_POLICY,planes:[...this.layers.values()].filter(row=>row.group==='pl'&&modeOf(row.sourceBmode)!==0).map(row=>({id:String(row.id),mode:row.sourceBmode}))}}}
 validateSave(saved,...rest){const data=super.validateSave(saved,...rest);if(!this.sourceBmodeEnabled)return data;const map=validateState(data);return {...data,layers:data.layers.map(row=>({...row,...(row.group==='pl'?{sourceBmode:map.get(String(row.id))??0}:{})}))}}
 async restore(saved,...rest){if(!this.sourceBmodeEnabled)return super.restore(saved,...rest);return super.restore(this.validateSave(saved,...rest),...rest)}
 reset(...rest){const result=super.reset(...rest);for(const row of this.sourceBmodeRawFrames?.values()??[])release(row);this.sourceBmodeRawFrames?.clear();return result}
 }}
