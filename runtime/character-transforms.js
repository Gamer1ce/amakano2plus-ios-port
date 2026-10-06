// Isolated opt-in candidate from this game's original DLL/EXE default layout.
// No plane/base/shift, independent sy, raster half-pixel, or easing inference.
export const NATIVE_CHARACTER_TRANSFORM_PROOF_SHA='5c6362b3d13a1a74ee4006047e7be1005a56559e7c2b2e7cce2ab12fa34b5876';
const finite=(value,label)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`Invalid native character ${label}`);return value};
function pair(value,label){if(!Array.isArray(value)||value.length!==2)throw new Error(`Invalid native character ${label}`);return value.map((v,i)=>finite(v,`${label}[${i}]`))}
export function nativeCharacterTransform(layer,layout){
  if(!layout||typeof layout.model!=='string'||layer.asset!==layout.model)throw new Error('Native character source layout/model mismatch');
  const position=pair(layout.position,'DIF position'),scale=pair(layout.scale,'DIF scale'),offset=pair(layout.scaleOffset,'DIF scaleoffset');
  const sx=finite(layer.sx,'bank scale X'),x=finite(layer.x,'bank X'),y=finite(layer.y,'bank Y');
  return {x:x+Math.trunc(position[0])+offset[0]*(1-sx),y:y+Math.trunc(position[1])+offset[1]*(1-sx),scale:scale[0]*sx};
}
export function withNativeCharacterTransforms(BaseRenderer){
  return class NativeCharacterTransformRenderer extends BaseRenderer {
    constructor(options){
      const enabled=options.nativeCharacterTransforms??false;
      if(typeof enabled!=='boolean')throw new Error('Invalid native character transforms option');
      const layouts=options.nativeCharacterLayouts??{};
      if(!layouts||typeof layouts!=='object'||Array.isArray(layouts))throw new Error('Invalid native character source layouts');
      super(options);this.nativeCharacterTransforms=enabled;
      // Take ownership of immutable numeric tuples; no caller mutation changes
      // the already accepted default source oracle or a restored save's meaning.
      this.nativeCharacterLayouts=Object.freeze(Object.fromEntries(Object.entries(layouts).map(([key,l])=>[key,Object.freeze({model:l.model,position:Object.freeze(pair(l.position,'DIF position')),scale:Object.freeze(pair(l.scale,'DIF scale')),scaleOffset:Object.freeze(pair(l.scaleOffset,'DIF scaleoffset'))})])));
    }
    nativeCharacterLayout(layer){
      const key=`${layer.profile}/${layer.variant}`;
      if(!Object.hasOwn(this.nativeCharacterLayouts,key))throw new Error(`Native character source layout unproven: ${key}`);
      return this.nativeCharacterLayouts[key];
    }
    place(layer){
      if(!this.nativeCharacterTransforms||!layer.player)return super.place(layer);
      const t=nativeCharacterTransform(layer,this.nativeCharacterLayout(layer)),el=layer.element;
      if(!el)throw new Error('Native character canvas absent');
      layer.player.setScale(t.scale,0,0);layer.player.setCoord(t.x,t.y,0,0);
      el.style.opacity=String(layer.opacity);el.style.display=layer.visible?'':'none';el.style.zIndex=String(layer.priority);
      el.style.filter=[layer.blur?`blur(${layer.blur}px)`:'',layer.mode==='sepia'?'sepia(1)':layer.mode==='gray'?'grayscale(1)':''].filter(Boolean).join(' ');
      // Existing rotation policy is inherited; this candidate proves only X/Y
      // and uniform scale. It makes no claim of native rotation equivalence.
      el.style.transform=`rotate(${layer.rotation}deg)`;
    }
    validateSave(saved){
      const data=super.validateSave(saved);
      if(this.nativeCharacterTransforms)for(const layer of data.layers)if(layer.emote){nativeCharacterTransform(layer,this.nativeCharacterLayout(layer));}
      return data;
    }
  };
}
