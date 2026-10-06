import {PortOwnSaveFrameClock} from './source-save-clock-owner.js';

// Private identities join renderer-owned proxies without changing the exact
// proxy passed through the character restore/character call boundary.
const lineage=new WeakMap(),snapshotLeases=new WeakMap();
let currentSnapshot=null;
const require=(ok,message)=>{if(!ok)throw new Error('Source coordinator: '+message)};
function checkedTransaction(transaction){
 require(transaction&&['assertActive','registerResource','resetFromRestore'].every(k=>typeof transaction[k]==='function'),'explicit transaction hooks required');
 transaction.assertActive();return transaction;
}
export function registerRestoreRoot(transaction){
 checkedTransaction(transaction);require(!lineage.has(transaction),'restore owner already registered');
 lineage.set(transaction,{root:transaction,parent:null});return transaction;
}
export function registerRestoreChild(child,parent){
 checkedTransaction(parent);checkedTransaction(child);
 require(child!==parent&&!lineage.has(child),'fresh exact child proxy required');
 // A standalone Character owner is still a supported explicit root. The
// Bitmap whole-restore path registers its root before entering Character.
 if(!lineage.has(parent))registerRestoreRoot(parent);
 const root=lineage.get(parent).root;assertRootDescendant(parent,root);
 lineage.set(child,{root,parent});return child;
}
export function assertRootDescendant(transaction,root){
 require(lineage.get(root)?.root===root&&lineage.get(root)?.parent===null,'registered exact root required');
 require(lineage.get(transaction)?.root===root,'foreign restore proxy');
 let current=transaction;
 while(current){checkedTransaction(current);const entry=lineage.get(current);require(entry?.root===root,'broken restore lineage');current=entry.parent;}
 return transaction;
}
function captureSynchronously(capture,saved){
 const result=capture(saved);require(!result||typeof result.then!=='function','thenable snapshot result unsupported');return result;
}
export function withSharedSourceSnapshot(clock,capture){
 require(clock instanceof PortOwnSaveFrameClock,'owned shared snapshot clock required');
 require(typeof capture==='function'&&capture.constructor?.name!=='AsyncFunction','synchronous snapshot callback required');
 if(currentSnapshot){
  require(currentSnapshot.clock===clock&&snapshotLeases.get(clock)===currentSnapshot,'different or foreign nested snapshot clock');
  return captureSynchronously(capture,currentSnapshot.saved);
 }
 return clock.withAtomicSnapshot(saved=>{
  const lease={clock,saved};snapshotLeases.set(clock,lease);currentSnapshot=lease;
  try{return captureSynchronously(capture,saved)}finally{currentSnapshot=null;snapshotLeases.delete(clock)}
 });
}
// Cancellation settles our await even when a provider ignores disposal. Both
// late success and late rejection remain observed; no timer grants acceptance.
export function awaitSourceRestore(transaction,operation){
 require(typeof operation==='function','restore operation required');
 if(!transaction)return Promise.resolve().then(operation);
 checkedTransaction(transaction);
 return new Promise((resolve,reject)=>{
  let settled=false,unregister=()=>{};
  const finish=(callback,value)=>{if(settled)return;settled=true;try{unregister()}catch(error){reject(error);return}callback(value)};
  const cancel=()=>{
   let error;try{transaction.assertActive()}catch(cause){error=cause}
   finish(reject,error??new Error('Source restore: superseded restore (cancelled await)'));
  };
  try{
   const registered=transaction.registerResource(cancel);require(typeof registered==='function','restore unregister required');unregister=registered;
   if(settled){unregister();return}
   Promise.resolve().then(()=>{checkedTransaction(transaction);return operation()}).then(value=>{
    try{checkedTransaction(transaction);finish(resolve,value)}catch(error){finish(reject,error)}
   },error=>finish(reject,error));
  }catch(error){finish(reject,error)}
 });
}
