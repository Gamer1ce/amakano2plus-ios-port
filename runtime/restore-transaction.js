// Explicit opt-in transaction for an asynchronously restored renderer save.
// Callers own cancellation; parents check the same object at every boundary.
export function restoreTransactionFromOptions(options){
 const transaction=options?.restoreTransaction;
 if(transaction===undefined)return null;
 if(!transaction||['assertActive','resetFromRestore','registerResource'].some(key=>typeof transaction[key]!=='function'))throw new Error('Invalid explicit restore transaction');
 return transaction;
}
export const assertRestoreActive=transaction=>transaction?.assertActive();
export function restoreTransactionIsActive(transaction){try{assertRestoreActive(transaction);return true}catch{return false}}
export function ownRestoreResource(transaction,dispose){
 let owned=true,unregister=()=>{};
 const release=()=>{if(!owned)return;owned=false;try{dispose()}finally{unregister()}};
 if(transaction){assertRestoreActive(transaction);try{const registered=transaction.registerResource(release);if(typeof registered!=='function')throw new Error('Restore resource registration must return unregister');unregister=registered}catch(error){release();throw error}}
 return {release,transfer(){if(!owned)return;assertRestoreActive(transaction);owned=false;unregister()}};
}
export function discardRestoreImage(image){image.removeAttribute?.('src');image.remove();}
const preparedOwners=new WeakMap();
export function bindPreparedRestoreMedia(prepared,transaction,owners){if(transaction)preparedOwners.set(prepared,{transaction,owners});return prepared}
export function assertPreparedRestoreMedia(prepared){assertRestoreActive(preparedOwners.get(prepared)?.transaction)}
export function transferPreparedRestoreMedia(prepared){const state=preparedOwners.get(prepared);if(!state)return;assertRestoreActive(state.transaction);for(const owner of state.owners)owner.transfer();preparedOwners.delete(prepared)}
export function releasePreparedRestoreMedia(prepared){const state=preparedOwners.get(prepared);if(!state)return;for(const owner of state.owners)owner.release();preparedOwners.delete(prepared)}
