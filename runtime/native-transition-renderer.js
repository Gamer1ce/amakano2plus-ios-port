import {composeSourceBmodeCanvases} from './source-bmode-pixel-policy.js';
import {Renderer as BaseRenderer} from './renderer.js';
import {planNativeCapture} from './native-capture-lookahead.js';
import {nativeTransitionSpec,nativeTransitionDefaults,nativeRdrawOldAlpha,nativeRwipeAlphaTable} from './native-transitions.js';
import {scaleNativeMaskBlue} from './native-mask-scaler.js';
import {argumentsOf,numericArgument} from './expressions.js';
import {NativeTransitionTaskClock} from './native-transition-clock.js';

export const NATIVE_RENDERER_TRANSITION_PROVENANCE=Object.freeze({sourceSHA256:'d7b038d05007c7d878a9035e1872e62da01815aba658c8965c41f46051ea5812',maskScalerSHA256:'bd3fa1a4dcf03ce9e686f88f5b4bba003fa4a971483a9e505594b9c405b30c7e',browserMaskSHA256:'b64cba3f4cae3b5da1cc0fc2e6d3aaedb995e507fa3fd967c08b7ee157902218',currentLayerGeometryAccepted:false,nativeTickMillisecondsAccepted:false});
const require=(value,message)=>{if(!value)throw new Error(message)};
const canvas=(width,height)=>{const result=document.createElement('canvas');result.width=width;result.height=height;require(result.getContext('2d'),'2D snapshot canvas unavailable');return result};
const pixels=value=>value.getContext('2d',{willReadFrequently:true}).getImageData(0,0,value.width,value.height);
function numericCSS(value,label){const number=parseFloat(value);require(Number.isFinite(number),'Invalid snapshot '+label);return number}
// Filter Effects 1: functions operate on a local sRGB plane before opacity and
// transform. Native WebKit implements SVG primitives even without Canvas2D.filter.
// Only the frozen PNG is embedded; no live DOM or external URL is consulted.
export const NATIVE_SNAPSHOT_FILTER_POLICY='webkit-svg-local-srgb-filter-v1';
export function nativeSnapshotFilterPlan(filter){
 require(typeof filter==='string','Invalid snapshot CSS filter');
 const text=filter.trim();if(text===''||text==='none')return {functions:[],padding:0};
 const functions=[],pattern=/([a-z-]+)\(\s*([^()]*)\s*\)/gy;let offset=0,blur=0;
 const scalar=(input,fallback,unit)=>{
  const value=input.trim();if(!value)return fallback;
  const match=/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%|px|deg|rad|grad|turn)?$/i.exec(value);
  require(match,'Unsupported snapshot filter argument: '+value);let number=Number(match[1]);require(Number.isFinite(number),'Non-finite snapshot filter argument');
  const suffix=match[2]??'';
  if(unit==='length')require(suffix==='px'||suffix===''&&number===0,'Snapshot blur requires computed px');
  else if(unit==='angle'){
   require(['deg','rad','grad','turn'].includes(suffix)||suffix===''&&number===0,'Invalid snapshot hue angle');
   number*=suffix==='rad'?180/Math.PI:suffix==='grad'?.9:suffix==='turn'?360:1;
  }else{require(suffix===''||suffix==='%','Snapshot filter requires a number or percentage');if(suffix==='%')number/=100;}
  require(Number.isFinite(number)&&(unit==='angle'||number>=0),'Invalid snapshot filter amount');return number;
 };
 while(offset<text.length){
  while(offset<text.length&&/\s/.test(text[offset]))offset++;
  if(offset===text.length)break;pattern.lastIndex=offset;const match=pattern.exec(text);require(match,'Unsupported snapshot CSS filter: '+text.slice(offset));offset=pattern.lastIndex;
  const name=match[1];require(['blur','brightness','contrast','grayscale','sepia','saturate','hue-rotate','invert','opacity'].includes(name),'Unsupported snapshot CSS filter function: '+name);
  const unit=name==='blur'?'length':name==='hue-rotate'?'angle':'amount',fallback=name==='blur'||name==='hue-rotate'?0:1;
  let amount=scalar(match[2],fallback,unit);if(['grayscale','sepia','invert','opacity'].includes(name))amount=Math.min(amount,1);
  if(name==='blur')blur+=amount;functions.push({name,amount});
 }
 // Transparent padding extends beyond the visible eight-bit Gaussian tail.
 // Its negative offset is applied before the original local transform.
 const padding=blur>0?Math.ceil(blur*6)+1:0;require(Number.isSafeInteger(padding),'Invalid snapshot blur extent');
 return {functions,padding};
}
function snapshotFilterPrimitives(plan,region){
 const matrix=values=>`<feColorMatrix ${region} type="matrix" values="${values.join(' ')}"/>`;
 return plan.functions.map(({name,amount:a})=>{
  if(name==='blur')return `<feGaussianBlur ${region} stdDeviation="${a}" edgeMode="none"/>`;
  if(name==='grayscale')return matrix([1-.7874*a,.7152*a,.0722*a,0,0,.2126*a,1-.2848*a,.0722*a,0,0,.2126*a,.7152*a,1-.9278*a,0,0,0,0,0,1,0]);
  if(name==='sepia')return matrix([1-.607*a,.769*a,.189*a,0,0,.349*a,1-.314*a,.168*a,0,0,.272*a,.534*a,1-.869*a,0,0,0,0,0,1,0]);
  if(name==='saturate'||name==='hue-rotate')return `<feColorMatrix ${region} type="${name==='saturate'?'saturate':'hueRotate'}" values="${a}"/>`;
  if(name==='opacity')return `<feComponentTransfer ${region}><feFuncA type="table" tableValues="0 ${a}"/></feComponentTransfer>`;
  const channels=['R','G','B'].map(channel=>name==='invert'?`<feFunc${channel} type="table" tableValues="${a} ${1-a}"/>`:`<feFunc${channel} type="linear" slope="${a}" intercept="${name==='contrast'?.5-.5*a:0}"/>`).join('');
  return `<feComponentTransfer ${region}>${channels}</feComponentTransfer>`;
 }).join('');
}
function decodeSnapshotSVG(source,signals){
 require(signals.every(signal=>!signal.aborted),'Snapshot filter capture was cancelled');
 return new Promise((resolve,reject)=>{
  const image=new Image(),url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'}));let settled=false,timer;
  const clean=()=>{clearTimeout(timer);image.onload=image.onerror=null;for(const signal of signals)signal.removeEventListener('abort',cancel);URL.revokeObjectURL(url);};
  const finish=error=>{if(settled)return;settled=true;clean();if(error){image.src='';reject(error)}else resolve(image);};
  const cancel=()=>finish(new Error('Snapshot filter capture was cancelled'));
  for(const signal of signals)signal.addEventListener('abort',cancel,{once:true});
  if(signals.some(signal=>signal.aborted)){cancel();return;}
  image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0?null:new Error('Snapshot SVG filter decoded an empty image'));
  image.onerror=()=>finish(new Error('WebKit could not decode the local snapshot SVG filter'));
  timer=setTimeout(()=>finish(new Error('Snapshot SVG filter decode timed out')),15000);image.src=url;
 });
}
function snapshotFilterIsIdentity(plan){return plan.functions.every(({name,amount})=>['blur','grayscale','sepia','invert'].includes(name)?amount===0:name==='hue-rotate'?amount%360===0:amount===1);}
export async function bakeNativeSnapshotFilter(bitmap,filter,{signals=[]}={}){
 require(Array.isArray(signals)&&signals.every(signal=>typeof signal?.addEventListener==='function'),'Invalid snapshot cancellation signals');
 const plan=nativeSnapshotFilterPlan(filter),identity=snapshotFilterIsIdentity(plan);
 if(identity)return {canvas:bitmap,left:0,top:0,temporary:false};
 require(Number.isSafeInteger(bitmap.width)&&Number.isSafeInteger(bitmap.height)&&bitmap.width>0&&bitmap.height>0,'Invalid filtered snapshot dimensions');
 const p=plan.padding,width=bitmap.width+2*p,height=bitmap.height+2*p;
 require(width<=8192&&height<=8192&&width*height<=33554432,'Filtered snapshot exceeds bounded local plane');
 const encoded=bitmap.toDataURL('image/png');require(encoded.startsWith('data:image/png;base64,'),'Frozen snapshot PNG unavailable');
 const region=`x="${-p}" y="${-p}" width="${width}" height="${height}"`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${-p} ${-p} ${width} ${height}"><defs><filter id="snapshot" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${region} color-interpolation-filters="sRGB">${snapshotFilterPrimitives(plan,region)}</filter></defs><image x="0" y="0" width="${bitmap.width}" height="${bitmap.height}" preserveAspectRatio="none" xlink:href="${encoded}" filter="url(#snapshot)"/></svg>`;
 const image=await decodeSnapshotSVG(svg,signals);require(signals.every(signal=>!signal.aborted),'Snapshot filter capture was cancelled');
 const result=canvas(width,height);
 try{result.getContext('2d').drawImage(image,0,0);return {canvas:result,left:-p,top:-p,temporary:true};}
 catch(error){result.width=result.height=0;throw error;}
}
function layerLocalBitmap(layer,style){
 const element=layer.element,width=Math.round(numericCSS(style.width,'width')),height=Math.round(numericCSS(style.height,'height'));
 require(width>0&&height>0&&width<=8192&&height<=8192,'Invalid snapshot layer dimensions');
 const bitmap=canvas(width,height),ctx=bitmap.getContext('2d');
 if(layer.player||element.tagName==='CANVAS'||element.tagName==='IMG')ctx.drawImage(element,0,0,width,height);
 else if(layer.color){ctx.fillStyle=style.backgroundColor;ctx.fillRect(0,0,width,height)}
 else if(layer.composite){for(const child of element.children){require(child.tagName==='IMG','Unsupported composite snapshot child');const s=getComputedStyle(child);require(s.transform==='none'&&s.filter==='none','Transformed composite child is outside current renderer');ctx.drawImage(child,numericCSS(s.left,'child left'),numericCSS(s.top,'child top'),numericCSS(s.width,'child width'),numericCSS(s.height,'child height'))}}
 else throw new Error('Unrecognized visible layer bitmap');
 return bitmap;
}
// Runs synchronously at pump entry BEFORE the readonly ahead-scan itself. Each
// current bitmap and computed CSS matrix is frozen, including live SDK canvases.
export function freezeNativePumpFront(renderer){
 const records=[],presentationRecords=[],captureAbort=new AbortController();
 try{
  for(const layer of renderer.layers.values()){
   if(!layer.element)continue;const computed=getComputedStyle(layer.element),style=renderer.sourcePlaneMaskFrozenStyle?.(layer,computed)??computed;
   if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
   const bitmap=layerLocalBitmap(layer,style),bmode=renderer.sourceBmodeFrozenRecord?.(layer,bitmap),visual=renderer.sourceVisualFrozenRecord?.(layer,bitmap),matrix=style.transform==='none'?new DOMMatrix():new DOMMatrix(style.transform),origin=style.transformOrigin.split(/\s+/);
   require(matrix.is2D,'3D layer snapshot unsupported');
   const paintPriority=Number(renderer.scenePaintPriority?.(layer)??layer.priority);require(Number.isFinite(paintPriority),'Invalid snapshot paint priority');
   records.push({...bmode,bitmap,priority:Number(layer.priority),paintPriority,left:numericCSS(style.left,'left'),top:numericCSS(style.top,'top'),opacity:Number(style.opacity),originX:numericCSS(origin[0],'transform origin X'),originY:numericCSS(origin[1],'transform origin Y'),matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],filter:style.filter,playerCanvas:!!layer.player,group:layer.group,id:layer.id,planeId:layer.planeId,...visual});
  }
  const presentationLayers=renderer.scenePresentationLayers?.()??[];require(Array.isArray(presentationLayers),'Invalid presentation layer list');
  for(const layer of presentationLayers){
   require(layer.element?.tagName==='IMG'&&layer.presentationCompositeOperation==='source-atop','Invalid presentation layer policy');
   const style=getComputedStyle(layer.element);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
   const matrix=style.transform==='none'?new DOMMatrix():new DOMMatrix(style.transform),origin=style.transformOrigin.split(/\s+/),paintPriority=Number(layer.priority);
   require(matrix.is2D&&Number.isFinite(paintPriority),'Invalid presentation layer geometry');
   const geometry={left:numericCSS(style.left,'left'),top:numericCSS(style.top,'top'),opacity:Number(style.opacity),originX:numericCSS(origin[0],'transform origin X'),originY:numericCSS(origin[1],'transform origin Y'),matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f]};
   const bitmap=layerLocalBitmap(layer,style);presentationRecords.push({...geometry,bitmap,priority:paintPriority,paintPriority,presentationOnly:true,presentationCompositeOperation:'source-atop',filter:style.filter,playerCanvas:false,group:layer.group,id:layer.id});
  }
  const front={width:1600,height:900,records,presentationRecords,signal:captureAbort.signal,capturedBeforeLookahead:true,release(){captureAbort.abort();for(const row of [...records,...presentationRecords]){row.bitmap.width=0;row.bitmap.height=0}records.length=0;presentationRecords.length=0}};
  renderer.sourcePlaneMaskFrozenFront?.(front);return front;
  }catch(error){captureAbort.abort();for(const row of [...records,...presentationRecords]){row.bitmap.width=0;row.bitmap.height=0}throw error}
}
function frozenRangeSelection(front,{from,to}){
 require(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from<=to,'Invalid native snapshot priority range');
 for(const row of front.records)if(row.sourcePlaneMaskPriorities){const selected=row.sourcePlaneMaskPriorities.map(priority=>priority>=from&&priority<=to);require(selected.every(Boolean)||selected.every(value=>!value),'Partial source mask plane capture is outside the source-used range');}
 const presentation=from===0&&to===45000?(front.presentationRecords??[]):[];
 return [...front.records.filter(row=>row.priority>=from&&row.priority<=to),...presentation].sort((a,b)=>(a.paintPriority??a.priority)-(b.paintPriority??b.priority));
}
function paintFrozenLocal(result,front,row,local){
 const temporary=row.sourceBmode===5?canvas(front.width,front.height):null,paint=(temporary??result).getContext('2d');
 try{
  paint.save();try{paint.globalAlpha=row.opacity;if(row.presentationCompositeOperation==='source-atop')paint.globalCompositeOperation='source-atop';else if(row.sourceBmode===1)paint.globalCompositeOperation='lighter';
   paint.translate(row.left+row.originX,row.top+row.originY);paint.transform(...row.matrix);paint.translate(-row.originX,-row.originY);paint.drawImage(local.canvas,local.left,local.top);
  }finally{paint.restore();}
  if(temporary)composeSourceBmodeCanvases(5,temporary,result);
 }finally{if(temporary)temporary.width=temporary.height=0;}
}
function frozenRangeResult(front,range,result,selected){
 return {canvas:result,layers:selected.map(({priority,paintPriority,presentationOnly,playerCanvas,group,id})=>({priority,paintPriority,presentationOnly,playerCanvas,group,id})),captureRange:{from:range.from,to:range.to},capturedBeforeLookahead:front.capturedBeforeLookahead};
}
// The source-used plane mask repaints synchronously inside place/refresh. Its
// bitmap sepia is already baked before freezing; any residual nonidentity CSS
// filter must fail explicitly rather than be dropped or introduce a Promise.
export function composeNativeFrozenIdentityRange(front,range,{signal}={}){
 const selected=frozenRangeSelection(front,range),signals=[front.signal,signal].filter(Boolean);
 require(signals.every(value=>!value.aborted),'Snapshot filter capture was cancelled');
 for(const row of selected)require(snapshotFilterIsIdentity(nativeSnapshotFilterPlan(row.filter)),'Synchronous source plane mask capture requires already-baked identity CSS filters');
 const result=canvas(front.width,front.height);
 try{for(const row of selected){require(signals.every(value=>!value.aborted),'Snapshot filter capture was cancelled');paintFrozenLocal(result,front,row,{canvas:row.bitmap,left:0,top:0});}}
 catch(error){result.width=result.height=0;throw error;}
 return frozenRangeResult(front,range,result,selected);
}
// UI color coats an exact full-scene OLD capture with source-atop and unchanged scene alpha.
// The live NEW plate remains under that alpha, so its transparency cannot be doubled.
export async function composeNativeFrozenRange(front,range,{signal}={}){
 const selected=frozenRangeSelection(front,range),result=canvas(front.width,front.height);
 try{for(const row of selected){
  const signals=[front.signal,signal].filter(Boolean);require(signals.every(value=>!value.aborted),'Snapshot filter capture was cancelled');
  const local=await bakeNativeSnapshotFilter(row.bitmap,row.filter,{signals});
  try{require(signals.every(value=>!value.aborted),'Snapshot filter capture was cancelled');paintFrozenLocal(result,front,row,local);}
  finally{if(local.temporary)local.canvas.width=local.canvas.height=0;}
 }}catch(error){result.width=result.height=0;throw error;}
 return frozenRangeResult(front,range,result,selected);
}
export function nativeCapturePaintPriority(bitmap,fallback){
 require(Array.isArray(bitmap?.layers)&&Number.isFinite(fallback),'Invalid native capture paint bounds');
 // Mixed captures retain the full source range ceiling, including NEW banks.
 // Only a capture made exclusively of demoted decorations can move behind actors.
 const pureDecoration=bitmap.layers.length>0&&bitmap.layers.every(row=>Number(row.paintPriority??row.priority)!==Number(row.priority));
 return pureDecoration?Math.max(...bitmap.layers.map(row=>Number(row.paintPriority))):fallback;
}
function releasePrepared(value){if(value?.hold){value.hold.remove();value.hold.width=value.hold.height=0}if(value?.bitmap?.canvas){value.bitmap.canvas.width=0;value.bitmap.canvas.height=0}}

// Mixin keeps the source-backed audio Renderer intact when the root integrates
// this candidate. Pass an explicit prototype clock; no native time claim.
export function withNativeTransitions(ParentRenderer){return class NativeTransitionRenderer extends ParentRenderer{
 constructor(options){
  super(options);const {nativeMaskRoot,nativeMasks,nativeTransitionTickMilliseconds,nativeTransitionClock}=options;
  require(nativeMasks&&typeof nativeMasks==='object'&&!Array.isArray(nativeMasks),'Exact native mask descriptor required');
  require(typeof nativeTransitionClock?.currentTick==='function'||Number.isFinite(nativeTransitionTickMilliseconds)&&nativeTransitionTickMilliseconds>0,'Explicit source-backed clock or prototype tick milliseconds required');
  this.nativeMaskRoot=nativeMaskRoot??this.root;this.nativeMasks=nativeMasks;this.nativeTickMs=nativeTransitionTickMilliseconds;this.nativeTransitionClock=nativeTransitionClock??null;
  this.nativeDrawDefaults={drawTicks:20,wipeTicks:20};this.nativeMaskCache=new Map();this.nativePrepared=null;this.nativeCommitting=null;this.nativeHiddenElements=new Map();this.nativeEffect=null;this.nativeTransitionEvents=[];this.nativePaused=false;this.nativePreparationGeneration=0;this.nativeCaptureAbort=null;
 }
 restoreNativeHiddenLayers(){for(const [element,visibility]of this.nativeHiddenElements??[])element.style.visibility=visibility;this.nativeHiddenElements?.clear();this.sourcePlaneMaskNativeVisibilityChanged?.()}
  discardNativePreparation(){this.nativePreparationGeneration=(this.nativePreparationGeneration??0)+1;this.nativeCaptureAbort?.abort();this.nativeCaptureAbort=null;releasePrepared(this.nativePrepared);releasePrepared(this.nativeCommitting);this.nativePrepared=this.nativeCommitting=null;this.restoreNativeHiddenLayers()}
 place(layer){super.place(layer);const pending=this.nativePrepared??this.nativeCommitting;if(!pending||!layer.element)return;const {from,to}=pending.plan.target.range,element=layer.element;if(layer.priority>=from&&layer.priority<=to){if(!this.nativeHiddenElements.has(element))this.nativeHiddenElements.set(element,element.style.visibility);element.style.visibility='hidden'}else if(this.nativeHiddenElements.has(element)){element.style.visibility=this.nativeHiddenElements.get(element);this.nativeHiddenElements.delete(element)}}
  async prepareNativePump(vm){
   const requestGeneration=(this.nativePreparationGeneration??0)+1;this.nativePreparationGeneration=requestGeneration;
   if(this.nativeEffect)await this.nativeEffect.finished;
   require(requestGeneration===this.nativePreparationGeneration,'Superseded native snapshot preparation');this.discardNativePreparation();const generation=this.nativePreparationGeneration,captureAbort=new AbortController();this.nativeCaptureAbort=captureAbort;
  // Capture pixels first, before scene IO/condition/call scanning can await.
  const front=freezeNativePumpFront(this);let plan;
  try{
   plan=await planNativeCapture(vm);require(generation===this.nativePreparationGeneration&&!captureAbort.signal.aborted,'Superseded native snapshot preparation');
   if(plan.status==='capture'){
    const bitmap=await composeNativeFrozenRange(front,plan.target.range,{signal:captureAbort.signal});
    if(generation!==this.nativePreparationGeneration||captureAbort.signal.aborted){bitmap.canvas.width=bitmap.canvas.height=0;throw new Error('Superseded native snapshot preparation');}
    // Keep the frozen OLD range visible while real DOM/image/mask decode
    // mutations await. Otherwise a new picture can flash before transition0.
    let hold;try{
     hold=canvas(bitmap.canvas.width,bitmap.canvas.height);hold.dataset.nativeTransition='prepared-old';hold.style.cssText=`position:absolute;left:0;top:0;width:1600px;height:900px;pointer-events:none;z-index:${nativeCapturePaintPriority(bitmap,plan.target.range.to)}`;hold.getContext('2d').drawImage(bitmap.canvas,0,0);
     const stage=document.getElementById('layers');require(stage,'Layer stage absent');stage.append(hold);
     this.nativePrepared={plan,bitmap,hold};for(const layer of this.layers.values())if(layer.element)this.place(layer);
    }catch(error){hold?.remove();if(hold)hold.width=hold.height=0;bitmap.canvas.width=bitmap.canvas.height=0;if(this.nativePrepared?.bitmap===bitmap)this.nativePrepared=null;throw error;}
    this.nativeTransitionEvents.push({type:'prepared',target:plan.target,layerCount:bitmap.layers.length,playerCanvasCount:bitmap.layers.filter(row=>row.playerCanvas).length,capturedBeforeLookahead:true,oldPixelsShownBeforeMutations:true});
   }
   return plan;
  }finally{front.release();if(this.nativeCaptureAbort===captureAbort)this.nativeCaptureAbort=null;}
 }
 async nativeMask(name,width,height){
  const key=name+':'+width+'x'+height;if(this.nativeMaskCache.has(key))return this.nativeMaskCache.get(key);
  const item=this.nativeMasks[name];require(item?.kind==='native-transition-mask'&&item.id===0&&item.browserAlpha===255,'Missing exact BLUE mask '+name);
  const image=new Image();image.src=new URL(item.file,this.nativeMaskRoot).href;await image.decode();require(image.naturalWidth===item.width&&image.naturalHeight===item.height,'Mask decode size mismatch '+name);
  const source=canvas(item.width,item.height);let blue;
  try{source.getContext('2d').drawImage(image,0,0);const data=pixels(source).data;blue=new Uint8Array(item.width*item.height);for(let i=0;i<blue.length;i++){require(data[i*4+3]===255,'Mask transport lost opaque alpha');blue[i]=data[i*4+2]}}
  finally{source.width=0;source.height=0}
  const scaled=scaleNativeMaskBlue(blue,item.width,item.height,width,height);this.nativeMaskCache.set(key,scaled);return scaled;
 }
 paintNativeTransition(elapsed){
  const job=this.nativeEffect;require(job,'No active native transition');const {spec,overlay,old,maskBlue,maskCanvas,maskPixels}=job,ctx=overlay.getContext('2d');
  require(Number.isSafeInteger(elapsed)&&elapsed>=0,'Invalid native transition task tick');
  ctx.clearRect(0,0,overlay.width,overlay.height);
  if(spec.kind==='rdraw'){ctx.globalAlpha=nativeRdrawOldAlpha(elapsed,spec.internalTicks)/255;ctx.drawImage(old,0,0);ctx.globalAlpha=1}
  else{
   const table=nativeRwipeAlphaTable(elapsed,spec.internalTicks);
   for(let p=0;p<maskBlue.length;p++){maskPixels.data[p*4]=maskPixels.data[p*4+1]=maskPixels.data[p*4+2]=255;maskPixels.data[p*4+3]=table[maskBlue[p]]}
   maskCanvas.getContext('2d').putImageData(maskPixels,0,0);ctx.drawImage(old,0,0);ctx.globalCompositeOperation='destination-in';ctx.drawImage(maskCanvas,0,0);ctx.globalCompositeOperation='source-over';
  }
  job.lastTick=elapsed;return {elapsed,oldAlpha:spec.kind==='rdraw'?nativeRdrawOldAlpha(elapsed,spec.internalTicks):null};
 }
 stopNativeTransition(){
  const job=this.nativeEffect;if(!job)return;cancelAnimationFrame(job.request);job.overlay.remove();job.overlay.width=job.overlay.height=0;job.old.width=job.old.height=0;if(job.maskCanvas)job.maskCanvas.width=job.maskCanvas.height=0;this.nativeEffect=null;job.resolve();
 }
 setNativeTransitionPaused(paused){
  this.nativePaused=!!paused;const job=this.nativeEffect;if(!job?.taskClock)return;
  const globalTick=this.nativeTransitionClock.currentTick();job.taskClock.update(globalTick);
  job.taskClock.setPaused(paused);if(!paused)job.taskClock.update(globalTick);
  this.nativeTransitionEvents.push({type:'explicitPause',paused:!!paused,globalTick,sourceTaskClockFields:{tickField:job.taskClock.tickField,pauseOffset:job.taskClock.pauseOffset,lastTick:job.taskClock.lastTick},browserLifecycleMappingAccepted:false});
 }
 async startNativeTransition(command,args,state,location){
  require(!this.nativeEffect,'Previous transition still running');const prepared=this.nativePrepared,target=prepared?.plan.target;
  require(target&&target.kind===command&&target.scene===location?.scene&&target.index===location?.index,'Transition did not have the correct OLD bitmap prepared before pump mutations');
  const spec=nativeTransitionSpec(command,argumentsOf(args),{...this.nativeDrawDefaults,evaluate:token=>numericArgument(token,state)});
  require(spec.captureRange.from===target.range.from&&spec.captureRange.to===target.range.to,'Frozen capture range differs from executed transition range');
  this.nativePrepared=null;this.nativeCommitting=prepared;
  if(!spec.enabled){releasePrepared(prepared);this.nativeCommitting=null;this.restoreNativeHiddenLayers();this.nativeTransitionEvents.push({type:'disabled',command,location,suppliedTicks:spec.suppliedTicks});return}
  let maskBlue;
  try{if(spec.kind==='rwipe')maskBlue=await this.nativeMask(spec.mask,1600,900)}catch(error){releasePrepared(prepared);this.nativeCommitting=null;this.restoreNativeHiddenLayers();throw error}
  const old=prepared.bitmap.canvas,overlay=prepared.hold;require(overlay?.isConnected,'Prepared OLD overlay was removed before transition commit');overlay.dataset.nativeTransition=command;
  let resolve;const finished=new Promise(done=>{resolve=done}),job={spec,old,overlay,maskBlue,finished,resolve,started:performance.now(),startedTick:this.nativeTransitionClock?.currentTick()??null,request:0,lastTick:0};
  if(this.nativeTransitionClock){job.taskClock=new NativeTransitionTaskClock(job.startedTick);job.taskClock.setPaused(this.nativePaused)}
  if(maskBlue){job.maskCanvas=canvas(old.width,old.height);job.maskPixels=job.maskCanvas.getContext('2d').createImageData(old.width,old.height)}
  this.nativeEffect=job;this.nativeCommitting=null;this.restoreNativeHiddenLayers();this.paintNativeTransition(0);
  this.nativeTransitionEvents.push({type:'started',command,location,spec,preparedLayers:prepared.bitmap.layers,capturedBeforeLookahead:true,nativeTickMillisecondsAccepted:false,sourceClockArithmetic:!!this.nativeTransitionClock,startedGlobalTick:job.startedTick});
  this.animations.add(finished);finished.finally(()=>this.animations.delete(finished));
  const tick=now=>{if(this.nativeEffect!==job)return;let elapsed;
   if(job.taskClock){job.taskClock.update(this.nativeTransitionClock.currentTick());if(job.taskClock.paused){job.request=requestAnimationFrame(tick);return}elapsed=Math.min(spec.internalTicks,(job.taskClock.currentTick()-job.startedTick)>>>0)}
   else elapsed=Math.min(spec.internalTicks,Math.floor((now-job.started)/this.nativeTickMs));
   this.paintNativeTransition(elapsed);if(elapsed>=spec.internalTicks)this.stopNativeTransition();else job.request=requestAnimationFrame(tick)};
  job.request=requestAnimationFrame(tick);
 }
 async command(command,args,state,location){
  if(command==='drawdef'||command==='wipedef'){this.nativeDrawDefaults=nativeTransitionDefaults(command,argumentsOf(args),this.nativeDrawDefaults,{evaluate:token=>numericArgument(token,state)});return}
  if(command==='rdraw'||command==='rwipe')return this.startNativeTransition(command,args,state,location);
  return super.command(command,args,state,location);
 }
 reset(){this.stopNativeTransition();this.discardNativePreparation();super.reset()}
 }}
export const Renderer=withNativeTransitions(BaseRenderer);
