// Explicit 2D port mapping of this game's four PL0 Y180 calls and PL4 Z-450.
// Raw source degrees/XYZ are retained. Original D3D raster/camera equivalence
// is not claimed; unsupported 3D vectors are rejected before bank mutation.
import {argumentsOf} from './expressions.js';
import {projectPortPlaneZ} from './port-plane-z-projection.js';
export const SOURCE_USED_PLANE_ROTATION_POLICY='port-used-plane-cardinal-world-pivot-2d-v1';
const contexts=new WeakMap();
const require=(ok,message)=>{if(!ok)throw new Error('Source used plane rotation: '+message)};
const field='sourcePlaneRotationXYZ';
function vector(id,xyz){
 require(['0','4'].includes(String(id))&&Array.isArray(xyz)&&xyz.length===3&&xyz.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.fround(v)===v),'source-used raw rotation bank/vector');
 require(xyz[0]===0&&((xyz[1]===0&&xyz[2]===0)||(String(id)==='0'&&xyz[1]===180&&xyz[2]===0)||(String(id)==='4'&&xyz[1]===0&&xyz[2]===-450)),'unaccepted plane rotation vector');
 return Object.freeze([...xyz]);
}
function axis(token,size){
 require(typeof token==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?$/.test(token),'resolved 2D CSS coordinate');
 const value=parseFloat(token);require(Number.isFinite(value),'finite CSS coordinate');
 if(token.endsWith('%')){const length=parseFloat(size);require(Number.isFinite(length)&&length>0,'resolved canvas dimensions');return value*length/100}
 return value;
}
export function usedPlaneRotationMatrix({id,xyz,pivotX,pivotY,left,top,originX,originY}){
 const raw=vector(id,xyz);for(const v of[pivotX,pivotY,left,top,originX,originY])require(Number.isFinite(v),'finite plane and element pivot');
 // Exact cardinal display matrices; normalize only the display, never raw Z.
 const [a,b,c,d]=raw[1]===180?[-1,0,0,1]:raw[2]===-450?[0,-1,1,0]:[1,0,0,1];
 const x=pivotX-left-originX,y=pivotY-top-originY,e=(1-a)*x-c*y,f=-b*x+(1-d)*y;
 return Object.freeze([a,b,c,d,e,f]);
}
function savedPlanes(data){
 const extra=data?.sourceUsedPlaneRotation;
 require(extra&&Object.getPrototypeOf(extra)===Object.prototype&&Object.keys(extra).sort().join(',')==='planes,policy,version'&&extra.version===1&&extra.policy===SOURCE_USED_PLANE_ROTATION_POLICY&&Array.isArray(extra.planes)&&extra.planes.length<=2,'own save descriptor');
 const map=new Map();for(const row of extra.planes){
  require(row&&Object.getPrototypeOf(row)===Object.prototype&&Object.keys(row).sort().join(',')==='id,xyz'&&typeof row.id==='string'&&!map.has(row.id),'saved plane identity');
  const xyz=vector(row.id,row.xyz),layers=data.layers.filter(layer=>layer.group==='pl'&&String(layer.id)===row.id);
  require(layers.length===1&&layers[0].rotation===xyz[2],'saved raw Z/plane mismatch');map.set(row.id,xyz);
 }
 for(const layer of data.layers)if(Object.hasOwn(layer,field))require(layer.group==='pl'&&map.has(String(layer.id))&&JSON.stringify(layer[field])===JSON.stringify(map.get(String(layer.id))),'foreign saved rotation field');
 return map;
}
export function withSourceUsedPlaneRotation(Base){return class SourceUsedPlaneRotation extends Base{
 constructor(options,...rest){
  const enabled=options?.sourceUsedPlaneRotations??false;require(typeof enabled==='boolean','explicit boolean gate');
  if(enabled)require(options.sourceUsedPlaneRotationPolicy===SOURCE_USED_PLANE_ROTATION_POLICY,'explicit 2D port policy');
  super(options,...rest);this.sourceUsedPlaneRotations=enabled;
  const readStyle=options?.sourcePlaneRotationComputedStyle??options?.portPlaneComputedStyle??(typeof globalThis.getComputedStyle==='function'?el=>globalThis.getComputedStyle(el):undefined);
  require(!enabled||this.nativePositionMotions&&typeof readStyle==='function','native owner hook and actual computed style required');
  contexts.set(this,{readStyle,command:null});
 }
 // NativeMOT invokes this hook only after its existing owner/cancellation and
 // mixed-controller guards. Known rotation leaves native rectangle END intact.
 applySourceUsedPlaneRotation(layer,parameters){
  const plan=contexts.get(this)?.command;if(!this.sourceUsedPlaneRotations||!plan||layer.group!=='pl'||String(layer.id)!==plan.id||parameters.join(' ')!==plan.parameters.join(' '))return false;
  require(this.layers.get('pl:'+plan.id)===layer,'current plane identity');layer[field]=[...plan.xyz];return true;
 }
 place(layer,...rest){
  // A PL canvas uses the same bank Z as its children. Base's local rotate
  // would count that Z twice; suppress only that synchronous local display,
  // then restore the raw logical value before applying one world rotation.
  const own=this.sourceUsedPlaneRotations&&layer.group==='pl'&&layer[field]?vector(layer.id,layer[field]):null;
  let result;
  if(own){const rawZ=layer.rotation;require(rawZ===own[2],'current plane raw Z');try{layer.rotation=0;result=super.place(layer,...rest)}finally{layer.rotation=rawZ}}
  else result=super.place(layer,...rest);
  if(!this.sourceUsedPlaneRotations||!layer.element)return result;
  const plane=layer.group==='pl'?layer:this.layers.get('pl:'+String(layer.planeId));if(!plane?.[field])return result;
  const xyz=vector(plane.id,plane[field]);if(xyz[1]===0&&xyz[2]===0)return result;
  let pivotX=plane.x,pivotY=plane.y;
  if(this.portPlaneZProjection&&(plane.z??0)!==0){const projected=projectPortPlaneZ({left:pivotX,top:pivotY,sx:1,sy:1,z:plane.z});pivotX=projected.left;pivotY=projected.top}
  const style=contexts.get(this).readStyle(layer.element),origin=String(style.transformOrigin).trim().split(/\s+/);
  require(origin.length>=2&&origin.length<=3,'computed 2D origin');if(origin.length===3)require(axis(origin[2],'0px')===0,'zero CSS origin depth');
  const matrix=usedPlaneRotationMatrix({id:plane.id,xyz,pivotX,pivotY,left:axis(style.left,style.width),top:axis(style.top,style.height),originX:axis(origin[0],style.width),originY:axis(origin[1],style.height)});
  // Parent place regenerates its CSS first; prepending one conjugated matrix
  // prevents accumulation and retains its existing rotation/SDK canvas pivot.
  const el=layer.element;el.style.transform=`matrix(${matrix.join(',')}) ${el.style.transform==='none'?'':el.style.transform??''}`.trim();return result;
 }
 initialize(layer,...rest){if(this.sourceUsedPlaneRotations&&layer.group==='pl')delete layer[field];return super.initialize(layer,...rest)}
 async command(cmd,args,state,location,...rest){
  if(!this.sourceUsedPlaneRotations)return super.command(cmd,args,state,location,...rest);
  const parts=argumentsOf(args);if(cmd!=='pl'||parts[1]!=='rot')return super.command(cmd,args,state,location,...rest);
  require(parts.length===5&&/^(?:0|4)$/.test(parts[0])&&parts.slice(2).every(v=>/^[+-]?\d+$/.test(v)),'actual used literal plane rotation grammar');
  const owner=contexts.get(this),plan={id:parts[0],parameters:parts.slice(2),xyz:vector(parts[0],parts.slice(2).map(Number))};require(!owner.command,'concurrent plane rotation command');owner.command=plan;
  try{return await super.command(cmd,args,state,location,...rest)}finally{if(owner.command===plan)owner.command=null}
 }
 snapshot(...rest){
  const data=super.snapshot(...rest);if(!this.sourceUsedPlaneRotations)return data;
  const planes=[];const layers=data.layers.map(saved=>{const live=this.layers.get(saved.group+':'+saved.id);if(live?.group==='pl'&&live[field]){const xyz=vector(live.id,live[field]);require(saved.rotation===xyz[2],'saved parent raw Z');planes.push({id:String(live.id),xyz:[...xyz]});return {...saved,[field]:[...xyz]}}return saved});
  return {...data,layers,sourceUsedPlaneRotation:{version:1,policy:SOURCE_USED_PLANE_ROTATION_POLICY,planes}};
 }
 validateSave(saved,...rest){
  const data=super.validateSave(saved,...rest);if(!this.sourceUsedPlaneRotations){require(data.sourceUsedPlaneRotation===undefined&&!data.layers.some(row=>Object.hasOwn(row,field)),'saved rotation feature disabled');return data}
  const planes=savedPlanes(data);return {...data,layers:data.layers.map(row=>({...row,...(row.group==='pl'&&planes.has(String(row.id))?{[field]:[...planes.get(String(row.id))]}:{})}))};
 }
 // Raw rotation is an ordinary validated saved layer field: Base's existing
 // guarded Object.assign and resource-commit transactions restore it before
 // place. There is no asynchronous post-restore field installation to leak.
 async restore(saved,...rest){if(!this.sourceUsedPlaneRotations)return super.restore(saved,...rest);return super.restore(this.validateSave(saved,...rest),...rest)}
};}
