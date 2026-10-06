import {argumentsOf} from './expressions.js';
import {freezeNativePumpFront,composeNativeFrozenIdentityRange} from './native-transition-renderer.js';
import {applySourcePlaneAlphaMask,SOURCE_PLANE_ALPHA_MASK_POLICY} from './source-plane-alpha-mask-kernel.js';
import {registerRestoreRoot,awaitSourceRestore} from './source-performance-restore-coordinator.js';
export const SOURCE_PLANE_IMAGE_MASK_POLICY='source-used-eg3-plane3-crop-channel4-v1';
const owners=new WeakMap(),require=(ok,message)=>{if(!ok)throw new Error('Source plane mask: '+message)};
const expected={id:0,width:1072,height:900,totalWidth:1600,totalHeight:900,x:528,y:0,baseX:0,baseY:0,file:'assets/images/sozai_mask01_0.webp'};
const styleKeys=['display','visibility','opacity','width','height','left','top','transform','transformOrigin','filter','backgroundColor','mixBlendMode'];
const styleCopy=s=>Object.fromEntries(styleKeys.map(k=>[k,s[k]]));
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;require(c.getContext('2d'),'Canvas2D required');return c};
const dispose=c=>{if(c){c.remove?.();c.width=c.height=0}};
const key=layer=>layer.group+':'+layer.id;
function descriptor(row){return {group:'eg',id:'3',name:'sozai_mask01',frameId:0,planeId:3,channel:4,modifier:row.modifier};}
function checkedDescriptor(row){require(row&&Object.keys(row).length===7&&row.group==='eg'&&row.id==='3'&&row.name==='sozai_mask01'&&row.frameId===0&&row.planeId===3&&row.channel===4&&['\\ma','\\\\ma'].includes(row.modifier),'saved source mask identity');return {...row};}
function requireFrame(renderer){const frame=renderer.imageFrame('sozai_mask01',0);require(Object.entries(expected).every(([k,v])=>Object.is(frame[k]??(k.startsWith('base')?0:undefined),v)),'exact source HG3 crop metadata');return frame;}
function releaseHidden(renderer,own){for(const [element,row]of own.hidden){if(renderer.nativeHiddenElements?.has(element)){renderer.nativeHiddenElements.set(element,row.visibility);element.style.visibility='hidden'}else element.style.visibility=row.visibility;}own.hidden.clear();}
function forget(renderer,own){releaseHidden(renderer,own);dispose(own.group);own.group=null;own.binding=null;}
function hide(renderer,own,layer){const element=layer.element;if(!element)return;const prior=renderer.nativeHiddenElements?.has(element)?renderer.nativeHiddenElements.get(element):element.style.visibility??'';own.hidden.set(element,{visibility:prior,layer});element.style.visibility='hidden';}
function assertUnitMask(renderer,binding){
 const l=binding.layer;require(renderer.layers.get('eg:3')===l&&l.element===binding.element&&l.asset==='sozai_mask01','live mask bank identity');
 require(l.planeId===3&&l.x===0&&l.y===0&&l.sx===1&&l.sy===1&&l.rotation===0&&l.opacity===1&&l.priority===5003&&(!l.mode||l.mode==='none')&&!l.blur,'source-used unit mask bank');
 const g=renderer.geometry(l);require(g.left===528&&g.top===0&&g.sx===1&&g.sy===1&&g.opacity===1,'source-used mask geometry');
 require((renderer.bank('pl',3).sourceBmode??0)===0,'source-used plane3 normal blend');return g;
}
function relevant(renderer,binding){return [...renderer.layers.values()].filter(layer=>layer!==binding.layer&&layer.element&&layer.group!=='pl'&&Number(layer.planeId)===3&&layer.priority<binding.layer.priority);}
function applyGroup(renderer,own,front){
 const binding=own.binding;if(!binding)return;const geometry=assertUnitMask(renderer,binding);
 const keys=new Set(relevant(renderer,binding).map(key)),rows=front.records.filter(row=>keys.has(row.group+':'+row.id));
 if(!binding.layer.visible||!geometry.visible)return;
 require(rows.every(row=>(row.sourceBmode??0)===0),'source-used normal plane3 capture');
 // Keep synchronous place/refresh: source bitmap sepia is already in these pixels.
 const grouped=composeNativeFrozenIdentityRange({width:front.width,height:front.height,records:rows,capturedBeforeLookahead:true},{from:0,to:45000}).canvas;
 try{
  const ctx=grouped.getContext('2d',{willReadFrequently:true}),data=ctx.getImageData(0,0,grouped.width,grouped.height);
  data.data.set(applySourcePlaneAlphaMask({destination:data.data,width:grouped.width,height:grouped.height,source:binding.pixels,sourceWidth:1072,sourceHeight:900,left:528,top:0}));ctx.putImageData(data,0,0);
  const selected=new Set(rows);for(let i=front.records.length-1;i>=0;i--)if(selected.has(front.records[i])){dispose(front.records[i].bitmap);front.records.splice(i,1)}
  front.records.push({bitmap:grouped,priority:5003,left:0,top:0,opacity:1,originX:0,originY:0,matrix:[1,0,0,1,0,0],filter:'none',sourceBmode:0,playerCanvas:false,group:'source-mask-plane',id:'3',planeId:3,sourcePlaneMaskPolicy:SOURCE_PLANE_ALPHA_MASK_POLICY,sourcePlaneMaskPriorities:[...rows.map(row=>row.priority),5003],sourcePlaneMaskMembers:rows.map(row=>({group:row.group,id:row.id,priority:row.priority}))});
 }catch(error){dispose(grouped);throw error}
}
export function withSourcePlaneImageMasks(Parent){return class SourcePlaneImageMaskRenderer extends Parent{
 constructor(options={},...rest){super(options,...rest);require(options.sourcePlaneImageMasks===undefined||typeof options.sourcePlaneImageMasks==='boolean','boolean opt-in');owners.set(this,{enabled:options.sourcePlaneImageMasks===true,binding:null,group:null,hidden:new Map(),refreshing:false,loading:null,restore:null,generation:0,events:[]});}
 sourcePlaneMaskFrozenStyle(layer,computed){
  const own=owners.get(this);if(!own?.enabled)return computed;
  const style=styleCopy(computed);if(own.binding?.layer===layer){style.display='none';return style;}
  const hidden=own.hidden.get(layer.element);if(hidden){style.visibility=this.nativeHiddenElements?.has(layer.element)?'hidden':hidden.visibility||'visible';}
  return style;
 }
 sourcePlaneMaskFrozenFront(front){const own=owners.get(this);if(own?.enabled)applyGroup(this,own,front);}
 sourcePlaneMaskNativeVisibilityChanged(){const own=owners.get(this);if(!own?.group)return;const range=(this.nativePrepared??this.nativeCommitting)?.plan?.target?.range;own.group.style.visibility=range&&5003>=range.from&&5003<=range.to?'hidden':'';if(!range&&!own.refreshing)this.refreshSourcePlaneMask();}
 refreshSourcePlaneMask(){
  const own=owners.get(this);if(!own?.enabled||own.refreshing)return;if(!own.binding){releaseHidden(this,own);dispose(own.group);own.group=null;return;}
  own.refreshing=true;
  try{
   assertUnitMask(this,own.binding);releaseHidden(this,own);
   const targets=relevant(this,own.binding),facade={layers:new Map(targets.map(l=>[key(l),l])),sourceBmodeFrozenRecord:this.sourceBmodeFrozenRecord?.bind(this),sourceVisualFrozenRecord:this.sourceVisualFrozenRecord?.bind(this)};
   // Live repaint samples current pixels after Sepia/place. It deliberately does
   // not bypass native preparation hiding or a legitimate opacity/display gate.
   const front=freezeNativePumpFront(facade);let next;
   try{applyGroup(this,own,front);const row=front.records.find(r=>r.group==='source-mask-plane');if(row){next=row.bitmap;front.records.splice(front.records.indexOf(row),1)}}finally{front.release();}
   if(next){next.dataset.sourcePlaneMask='3';next.style.cssText='position:absolute;left:0;top:0;width:1600px;height:900px;z-index:5003;pointer-events:none';document.getElementById('layers').append(next);}
   dispose(own.group);own.group=next??null;if(next)for(const layer of targets)hide(this,own,layer);hide(this,own,own.binding.layer);this.sourcePlaneMaskNativeVisibilityChanged();
  }finally{own.refreshing=false;}
 }
 place(layer,...rest){const result=super.place(layer,...rest);const own=owners.get(this);if(own?.enabled&&own.binding)this.refreshSourcePlaneMask();return result;}
 cancelSourcePlaneMaskRestore(){const own=owners.get(this),token=own?.restore;if(token)token.cancel();}
 cancelSourceImageRestoreForNormalOperation(options,...rest){if(options?.restoreTransaction===undefined)this.cancelSourcePlaneMaskRestore();return super.cancelSourceImageRestoreForNormalOperation?.(options,...rest);}
 cancelPortMotionRestore(...rest){return super.cancelPortMotionRestore?.(...rest);}
 async interruptSourceGlobalRestore(...rest){const own=owners.get(this);if(!own?.delegatingRestore)this.cancelSourcePlaneMaskRestore();return super.interruptSourceGlobalRestore?.(...rest);}
 async prepareSourcePlaneMask(transaction){
  const frame=requireFrame(this),image=new Image();image.src=this.url(frame.file);let unregister=()=>{};
  try{
   if(transaction)unregister=transaction.registerResource(()=>{image.removeAttribute?.('src')});
   await awaitSourceRestore(transaction,()=>image.decode());transaction?.assertActive();require(image.naturalWidth===1072&&image.naturalHeight===900,'decoded source crop dimensions');
   const c=canvas(1072,900);try{const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const bytes=ctx.getImageData(0,0,1072,900).data;require(bytes.length===1072*900*4,'decoded complete RGBA');return new Uint8ClampedArray(bytes);}finally{dispose(c)}
  }finally{unregister();image.removeAttribute?.('src');}
 }
 async image(layer,name,frameId,...rest){
  const own=owners.get(this);if(!own?.enabled)return super.image(layer,name,frameId,...rest);
  const transaction=rest[0]?.restoreTransaction;if(!transaction)this.cancelSourcePlaneMaskRestore();
  const loading=own.loading?.layer===layer&&!own.loading.used&&String(name).toLowerCase()==='sozai_mask01'?own.loading:null;if(loading)loading.used=true;
  const plan=loading?loading.plan:(own.restore?.plan&&key(layer)==='eg:3'&&String(name).toLowerCase()==='sozai_mask01'?own.restore.plan:null);
  if(!plan)return super.image(layer,name,frameId,...rest);
  const pixels=await this.prepareSourcePlaneMask(transaction);transaction?.assertActive();if(loading)require(own.generation===loading.generation,'superseded mask image');const token=own.restore;
  await super.image(layer,name,frameId,...rest);transaction?.assertActive();if(token)token.assertActive();
  require(layer.asset==='sozai_mask01'&&layer.frame?.id===0,'committed mask source');
  own.binding={layer,element:layer.element,pixels,modifier:plan.modifier,restoreToken:token};this.refreshSourcePlaneMask();own.events.push({kind:'source-plane-alpha-mask',group:'eg',id:'3',planeId:3,channel:4,modifier:plan.modifier});
 }
 clear(layer,...rest){const own=owners.get(this);if(own?.binding?.layer===layer)forget(this,own);const result=super.clear(layer,...rest);if(own?.enabled&&own.binding)this.refreshSourcePlaneMask();return result;}
 reset(...rest){const own=owners.get(this);if(own){own.generation++;if(!own.restore?.resetting)this.cancelSourcePlaneMaskRestore();forget(this,own);}return super.reset(...rest);}
 async command(cmd,args,state,...rest){
  const own=owners.get(this);if(!own?.enabled)return super.command(cmd,args,state,...rest);this.cancelSourcePlaneMaskRestore();own.generation++;
  const p=argumentsOf(args),modifier=p.at(-1);
  if(!['\\ma','\\\\ma'].includes(modifier))return super.command(cmd,args,state,...rest);
  require(cmd==='eg'&&p.length===7&&p[0]==='3'&&p[1].toLowerCase()==='sozai_mask01'&&p.slice(2,6).join(' ')==='0 0 0 3','only exact source-used mask command');
  const layer=this.bank('eg',3);requireFrame(this);const request={layer,plan:{modifier},generation:own.generation,used:false};own.loading=request;
  try{return await super.command(cmd,p.slice(0,-1).join(' '),state,...rest)}finally{if(own.loading===request)own.loading=null;}
 }
 snapshot(...rest){const data=super.snapshot(...rest),own=owners.get(this);if(!own?.enabled)return data;return {...data,sourcePlaneImageMasks:{version:1,policy:SOURCE_PLANE_IMAGE_MASK_POLICY,masks:own.binding?[descriptor(own.binding)]:[]}};}
 validateSave(saved,...rest){const data=super.validateSave(saved,...rest),own=owners.get(this),s=data.sourcePlaneImageMasks;
  if(s!==undefined){require(own?.enabled&&s?.version===1&&s.policy===SOURCE_PLANE_IMAGE_MASK_POLICY&&Array.isArray(s.masks)&&s.masks.length<=1&&Object.keys(s).length===3,'saved policy');
   for(const row of s.masks){checkedDescriptor(row);requireFrame(this);const matches=data.layers.filter(l=>l.group==='eg'&&String(l.id)==='3');require(matches.length===1&&matches[0].asset==='sozai_mask01'&&matches[0].frameId===0&&matches[0].planeId===3&&!matches[0].emote&&!matches[0].composite&&!matches[0].color,'saved mask has original image bank');const l=matches[0];require(l.x===0&&l.y===0&&l.sx===1&&l.sy===1&&l.opacity===1&&l.rotation===0&&l.priority===5003,'saved unit mask');}
  }return data;}
 async restore(saved,options={},...rest){
  const own=owners.get(this);if(!own?.enabled)return super.restore(saved,options,...rest);const data=this.validateSave(saved,...rest);require(!own.restore,'concurrent restore');
  const parent=options.restoreTransaction;parent?.assertActive();const resources=new Set();let active=true,unregisterParent=()=>{};
  const token={plan:data.sourcePlaneImageMasks?.masks[0]??null,resetting:false,assertActive:()=>{require(active&&own.restore===token,'superseded restore');parent?.assertActive();},registerResource:dispose=>{token.assertActive();const row={dispose};resources.add(row);return()=>resources.delete(row);},resetFromRestore:(...args)=>{token.assertActive();token.resetting=true;try{return parent?parent.resetFromRestore(...args):super.reset(...args)}finally{token.resetting=false;}},cancel:()=>{if(!active)return;active=false;unregisterParent();for(const row of [...resources]){resources.delete(row);row.dispose();}if(own.binding?.restoreToken===token){const layer=own.binding.layer,element=own.binding.element;forget(this,own);if(layer.element===element&&this.layers.get('eg:3')===layer)this.clear(layer);}if(own.restore===token)own.restore=null;}};
  own.restore=token;registerRestoreRoot(token);if(parent)unregisterParent=parent.registerResource(token.cancel);
  try{const result=await awaitSourceRestore(token,()=>{own.delegatingRestore=true;try{return super.restore(data,{...options,restoreTransaction:token},...rest)}finally{own.delegatingRestore=false;}});token.assertActive();if(own.binding?.restoreToken===token)own.binding.restoreToken=null;active=false;unregisterParent();resources.clear();own.restore=null;this.refreshSourcePlaneMask();return result;}
  catch(error){token.cancel();throw error;}
 }
 sourcePlaneMaskDiagnostics(){const own=owners.get(this);return {enabled:own.enabled,policy:SOURCE_PLANE_IMAGE_MASK_POLICY,active:!!own.binding,planeId:own.binding?3:null,groupCanvas:!!own.group,hiddenElements:own.hidden.size,restorePending:!!own.restore,events:own.events.map(e=>({...e}))};}
};}
