import {sourceByteSHA256} from './source-byte-sha256.js';
import {restoreTransactionFromOptions,assertRestoreActive,ownRestoreResource} from './restore-transaction.js';
const states=new WeakMap(),require=(ok,message)=>{if(!ok)throw new Error(message)};
const asciiName=name=>typeof name==='string'&&/^[a-z0-9_]+$/.test(name);
const audioName=name=>typeof name==='string'&&/^[a-z0-9_#+-]+$/.test(name);
const abortError=()=>new DOMException('Source LPB request cancelled','AbortError');
// Cancellation belongs to this repository even when a byte provider ignores
// AbortSignal. Keep both provider handlers attached after an abort wins.
const awaitOwnedOperation=(operation,signal)=>new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(settle,value)=>{
    if(settled)return;
    settled=true;signal.removeEventListener('abort',abort);settle(value);
  };
  const abort=()=>finish(reject,abortError());
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return}
  try{Promise.resolve(operation()).then(value=>finish(resolve,value),error=>finish(reject,error))}
  catch(error){finish(reject,error)}
});
export class SourceLpbRepository {
  constructor({indexBytes,indexSHA256,audioIndexBytes,audioIndexSHA256,root,fetchData=globalThis.fetch,maxCacheBytes=4*1024*1024}){
    require(indexBytes instanceof Uint8Array&&indexBytes.length<=8*1024*1024,'Bounded original LPB byte index required');
    require(typeof indexSHA256==='string'&&/^[0-9a-f]{64}$/.test(indexSHA256),'Explicit LPB index pin required');
    const owned=new Uint8Array(indexBytes);require(sourceByteSHA256(owned)===indexSHA256,'Original LPB index digest differs');
    const index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(owned));
    require(index.schemaVersion===1&&index.entries&&Array.isArray(index.voiceNames),'Invalid source LPB index');
    const entries=new Map(),voices=new Set();
    for(const name of index.voiceNames){require(asciiName(name)&&!voices.has(name),'Invalid/duplicate voice name');voices.add(name)}
    for(const [name,entry] of Object.entries(index.entries)){
      require(asciiName(name)&&entry.file===`game-data/source-lpb/${name}.lpb`&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=24&&entry.bytes<=8*1024*1024&&/^[0-9a-f]{64}$/.test(entry.sha256),'Invalid original LPB source record');
      entries.set(name,Object.freeze({file:entry.file,bytes:entry.bytes,sha256:entry.sha256}));
    }
    const audioNames=new Set();
    if(audioIndexBytes!==undefined||audioIndexSHA256!==undefined){
      require(audioIndexBytes instanceof Uint8Array&&audioIndexBytes.length<=8*1024*1024&&typeof audioIndexSHA256==='string'&&/^[0-9a-f]{64}$/.test(audioIndexSHA256),'Pinned original audio name index required');
      const audioBytes=new Uint8Array(audioIndexBytes);require(sourceByteSHA256(audioBytes)===audioIndexSHA256,'Original audio name index digest differs');
      const audioIndex=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(audioBytes));
      require(audioIndex.schemaVersion===1&&/^[0-9a-f]{64}$/.test(audioIndex.sourceAssetCatalogSHA256)&&Array.isArray(audioIndex.audioNames),'Invalid original audio name index');
      for(const name of audioIndex.audioNames){require(audioName(name)&&!audioNames.has(name),'Invalid/duplicate original audio name');audioNames.add(name)}
    }
    require(typeof fetchData==='function','Actual byte fetch provider required');
    require(Number.isSafeInteger(maxCacheBytes)&&maxCacheBytes>=0&&maxCacheBytes<=16*1024*1024,'Invalid bounded raw LPB cache budget');
    const base=new URL(root);require(['game:','http:','https:'].includes(base.protocol),'Unsupported source byte root');
    states.set(this,{entries,voices,audioNames,audioIndexSHA256,fetchData,base,indexSHA256,maxCacheBytes,cachedBytes:0,cache:new Map(),requests:new Set(),generation:0});
  }
  statistics(){const s=states.get(this);return Object.freeze({entries:s.entries.size,voices:s.voices.size,qualifiedAudioNames:s.audioNames.size,cachedBytes:s.cachedBytes,cachedEntries:s.cache.size,pendingRequests:s.requests.size})}
  clear(){const s=states.get(this);++s.generation;for(const controller of s.requests)controller.abort();s.cache.clear();s.cachedBytes=0}
  async read(name,options={}){
    const s=states.get(this),transaction=restoreTransactionFromOptions(options),signal=options.signal;
    assertRestoreActive(transaction);
    // voiceNames describes converted voices; a proven original LPB entry is also
    // a valid exact name. The separately pinned complete audio inventory also
    // qualifies source absence; no route permits a neighboring-name alias.
    require((asciiName(name)&&(s.voices.has(name)||s.entries.has(name)))||(audioName(name)&&s.audioNames.has(name)),'Unknown current voice cannot obtain an LPB alias');
    if(signal!==undefined)require(signal&&typeof signal.aborted==='boolean'&&typeof signal.addEventListener==='function'&&typeof signal.removeEventListener==='function','Invalid source byte abort signal');
    if(signal?.aborted)throw abortError();
    const record=s.entries.get(name);
    // This is source inventory absence, not successful lip processing. The
    // original DF/DBT/D4 owner must handle it; no generic table or fake LPB.
    if(!record)return Object.freeze({kind:'source-lpb-absent',name,indexSHA256:s.indexSHA256});
    const cached=s.cache.get(name);
    if(cached){s.cache.delete(name);s.cache.set(name,cached);assertRestoreActive(transaction);if(signal?.aborted)throw abortError();return {kind:'source-lpb-bytes',name,bytes:new Uint8Array(cached),sha256:record.sha256,cached:true}}
    const generation=s.generation,controller=new AbortController();s.requests.add(controller);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    let owner;
    const active=()=>{assertRestoreActive(transaction);if(controller.signal.aborted||generation!==s.generation)throw abortError()};
    try {
      owner=ownRestoreResource(transaction,abort);active();
      const response=await awaitOwnedOperation(()=>Reflect.apply(s.fetchData,globalThis,[new URL(record.file,s.base).href,{signal:controller.signal}]),controller.signal);active();
      require(response&&response.ok===true,`Present source LPB read failed: ${name} (${response?.status??'no response'})`);
      const length=response.headers?.get('Content-Length');if(length!==null&&length!==undefined)require(/^\d+$/.test(length)&&Number(length)===record.bytes,'Present source LPB Content-Length differs');
      const body=await awaitOwnedOperation(()=>response.arrayBuffer(),controller.signal);active();
      require(body instanceof ArrayBuffer&&body.byteLength===record.bytes,'Present source LPB byte count differs');
      const bytes=new Uint8Array(new Uint8Array(body));require(sourceByteSHA256(bytes)===record.sha256,'Present source LPB digest differs');active();
      if(bytes.byteLength<=s.maxCacheBytes){
        const old=s.cache.get(name);if(old){s.cachedBytes-=old.byteLength;s.cache.delete(name)}
        while(s.cachedBytes+bytes.byteLength>s.maxCacheBytes){const first=s.cache.keys().next().value;s.cachedBytes-=s.cache.get(first).byteLength;s.cache.delete(first)}
        s.cache.set(name,bytes);s.cachedBytes+=bytes.byteLength;
      }
      return {kind:'source-lpb-bytes',name,bytes:new Uint8Array(bytes),sha256:record.sha256,cached:false};
    }catch(error){active();throw error}
    finally{signal?.removeEventListener('abort',abort);s.requests.delete(controller);owner?.release()}
  }
}
