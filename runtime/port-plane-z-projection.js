// Explicit visual port policy for the source PL depth arcs. Source XYZ motion
// stays in the ledger; this module projects it into the browser's 2D stage.
// The original Windows camera and depth rasterization are not reproduced here.
export const PORT_PLANE_Z_POLICY='port-center-perspective-1600-v1';
const computedStyleReaders=new WeakMap();
const require=(ok,message)=>{if(!ok)throw new Error('Port plane projection: '+message)};
export function projectPortPlaneZ({left,top,sx,sy,z}){
 for(const value of [left,top,sx,sy,z])require(Number.isFinite(value),'finite geometry required');
 require(z<1600,'plane reaches the port camera');
 const scale=1600/(1600-z),x=800*(1-scale),y=450*(1-scale);
 const projected={left:800+(left-800)*scale,top:450+(top-450)*scale,sx:sx*scale,sy:sy*scale,scale,translateX:x,translateY:y,policy:PORT_PLANE_Z_POLICY};
 require(Object.values(projected).every(v=>typeof v!=='number'||Number.isFinite(v)),'projection overflow');
 return projected;
}
export function withPortPlaneZProjection(Base){return class PortPlaneZProjection extends Base{
 constructor(...args){
  const enabled=args[0]?.portPlaneZProjection??false;require(typeof enabled==='boolean','explicit boolean gate required');super(...args);
  require(!enabled||this.nativePositionMotions,'native source XYZ ledger required');this.portPlaneZProjection=enabled;
  const readStyle=args[0]?.portPlaneComputedStyle??(typeof globalThis.getComputedStyle==='function'?element=>globalThis.getComputedStyle(element):undefined);
  require(!enabled||typeof readStyle==='function','actual computed canvas style required');computedStyleReaders.set(this,readStyle);
 }
 allowsPortPlaneZ(layer){return this.portPlaneZProjection&&layer?.group==='pl'}
 geometry(layer,...rest){
  const original=super.geometry(layer,...rest);if(!this.portPlaneZProjection)return original;
  const plane=this.bank('pl',layer.planeId),z=plane.z??0;if(z===0)return original;
  const projection=projectPortPlaneZ({...original,z});return {...original,left:projection.left,top:projection.top,sx:projection.sx,sy:projection.sy};
 }
 place(layer,...rest){
  const result=super.place(layer,...rest);
  if(!this.portPlaneZProjection||!layer.player||!layer.element)return result;
  const plane=this.bank('pl',layer.planeId),z=plane.z??0;
  const style=layer.element.style;
  if(z===0)return result;
  const p=projectPortPlaneZ({left:0,top:0,sx:1,sy:1,z});
  const css=computedStyleReaders.get(this)(layer.element),parts=String(css.transformOrigin??'').trim().split(/\s+/);
  require(parts.length>=2&&parts.length<=3,'computed 2D canvas origin required');
  const axis=(token,size)=>{
   require(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?$/.test(token),'computed origin unit required');
   const number=parseFloat(token);require(Number.isFinite(number),'finite canvas origin required');
   if(token.endsWith('%')){const length=parseFloat(size);require(Number.isFinite(length)&&length>0,'resolved canvas dimensions required');return number*length/100}
   return number;
  };
  const ox=axis(parts[0],css.width),oy=axis(parts[1],css.height);
  require(parts.length===2||axis(parts[2],'0px')===0,'2D parent origin required');
  // CSS wraps this matrix around the parent origin O. Conjugating P by O
  // preserves the parent rotation pivot: T(O) T(-O) P T(O) R T(-O).
  const tx=(1-p.scale)*(800-ox),ty=(1-p.scale)*(450-oy);
  style.transform=`translate(${tx}px, ${ty}px) scale(${p.scale}) ${style.transform}`;
  return result;
 }
};}
