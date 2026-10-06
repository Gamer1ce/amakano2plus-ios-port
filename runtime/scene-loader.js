// Prototype only. Original KCS call-failure proof is recorded separately.
export const KNOWN_NATIVE_CALL_ABSENT_TARGETS=Object.freeze(['e_chip03n_09','e_chip10n_20','e_chip16n_06']);
const catalogAbsenceToken=Symbol('validated-catalog-absence');
const issuedCatalogAbsences=new WeakMap();
const sourceCatalogs=new WeakMap();

export class SceneAbsentError extends Error {
  constructor(id,token,loader) {
    if(token!==catalogAbsenceToken)throw new TypeError('SceneAbsentError must originate from a catalog absence');
    super(`Scene absent from catalog: ${id}`);
    this.name='SceneAbsentError';this.id=id;
    issuedCatalogAbsences.set(this,loader);
  }
}

export function isCatalogSceneAbsent(error,id,loader) {
  const scenes=sourceCatalogs.get(loader)?.scenes;
  return error instanceof SceneAbsentError&&typeof loader==='function'&&issuedCatalogAbsences.get(error)===loader&&error.id===id&&
    !!scenes&&typeof scenes==='object'&&!Array.isArray(scenes)&&!Object.hasOwn(scenes,id);
}

export function createCatalogSceneLoader(manifest,readScene) {
  if(!manifest||!manifest.scenes||typeof manifest.scenes!=='object'||Array.isArray(manifest.scenes))throw new Error('Invalid scene catalog');
  if(typeof readScene!=='function')throw new TypeError('Scene reader required');
  const loader=async id=>{
    if(!Object.hasOwn(manifest.scenes,id))throw new SceneAbsentError(id,catalogAbsenceToken,loader);
    const entry=manifest.scenes[id];
    if(!entry||typeof entry!=='object'||typeof entry.file!=='string'||!entry.file||!/^[-\w]+\.json$/i.test(entry.file))throw new Error(`Invalid scene catalog entry ${id}`);
    // IO/fetch, JSON, schema and caller-provided integrity errors propagate.
    return readScene(entry,id);
  };
  sourceCatalogs.set(loader,manifest);
  return loader;
}
