import {SourceLpbRepository} from './source-lpb-repository.js';
import {createSourceBlinkRNG} from './source-blink-controller.js';
import {sourceByteSHA256} from './source-byte-sha256.js';
import {awaitSourceRestore} from './source-performance-restore-coordinator.js';
import {restoreTransactionFromOptions,assertRestoreActive} from './restore-transaction.js';

// Resource roots are distinct: renderer assets use game-data/converted,
// while catalog members are already rooted at game-data/source-lpb.
export const SOURCE_CHARACTER_RESOURCE_PINS=Object.freeze({"lipOracle":{"file":"runtime/source-lip-nodes.json","bytes":673980,"sha256":"fa23696499a4478391f878d1a34a90fd26b87d7e59889bf6d03e09f1c448758a"},"blinkOracle":{"file":"runtime/source-blink-nodes.json","bytes":274990,"sha256":"f536b337a9fe636efc2177de716ca9cf2f6bee7f05f01af4917512fd43673e2b"},"genericOracle":{"file":"runtime/source-generic-lip-configurations.json","bytes":581476,"sha256":"6118d4e3748214d561d082ed630229579cc0202fa3826062f85e83ca0de03c1a"},"lpbCatalog":{"file":"game-data/source-lpb-catalog.json","bytes":4961464,"sha256":"6d5fb4ec5eca28cd58924394f1c97996064cd0b80a2fb3a7027c96239d32b6d1"},"originalAudioNames":{"file":"runtime/source-original-audio-names.json","bytes":391272,"sha256":"099fa6bfbdb4a9142645b957fb0b69cdf8493e13dd4b4b76648b1b2f4f8692c0"}});
for(const value of Object.values(SOURCE_CHARACTER_RESOURCE_PINS))Object.freeze(value);
export const PORT_BLINK_SEED_POLICY='port-crypto-624-word-state-v1';
const require=(ok,message)=>{if(!ok)throw new Error('Source character resources: '+message)};
export function createPortSourceBlinkRNG({randomFill=words=>globalThis.crypto.getRandomValues(words)}={}){
 require(typeof randomFill==='function','explicit crypto word provider required');
 const words=new Uint32Array(624);randomFill(words);
 // Source 624-state algorithm is reused. This entropy/initial index is a port
 // seed policy; Windows startup seed or ensuing RNG sequence is not claimed.
 return {rng:createSourceBlinkRNG({words,index:624}),policy:PORT_BLINK_SEED_POLICY};
}
export async function loadSourceCharacterResources({contentRoot,fetchData=fetch,randomFill,restoreTransaction}={}){
 require(contentRoot instanceof URL&&['game:','https:','http:'].includes(contentRoot.protocol)&&contentRoot.pathname.endsWith('/'),'explicit Content root URL required');
 require(typeof fetchData==='function','resource fetch provider required');
 const transaction=restoreTransactionFromOptions({restoreTransaction});assertRestoreActive(transaction);const controller=new AbortController(),unregister=transaction?.registerResource(()=>controller.abort())??(()=>{});
 try{
  const rows=await Promise.all(Object.entries(SOURCE_CHARACTER_RESOURCE_PINS).map(async([key,pin])=>{
   const response=await awaitSourceRestore(transaction,()=>fetchData(new URL(pin.file,contentRoot),{signal:controller.signal}));assertRestoreActive(transaction);
   require(response?.ok&&typeof response.arrayBuffer==='function','resource unavailable: '+pin.file);
   const raw=await awaitSourceRestore(transaction,()=>response.arrayBuffer());assertRestoreActive(transaction);
   require(raw instanceof ArrayBuffer&&raw.byteLength===pin.bytes,'resource byte count differs: '+pin.file);const bytes=new Uint8Array(raw);
   require(sourceByteSHA256(bytes)===pin.sha256,'resource SHA256 differs: '+pin.file);
   return [key,(key==='lpbCatalog'||key==='originalAudioNames')?new Uint8Array(bytes):JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))];
  }));assertRestoreActive(transaction);const data=Object.fromEntries(rows),seed=createPortSourceBlinkRNG({randomFill});
  require(data.genericOracle.schemaVersion===1&&data.lipOracle.schemaVersion===1&&data.blinkOracle.schemaVersion===1,'source oracle schema differs');
  return {sourceLipOracle:data.lipOracle,sourceBlinkOracle:data.blinkOracle,sourceGenericLipOracle:data.genericOracle,sourceBlinkRng:seed.rng,sourceBlinkSeedPolicy:seed.policy,
   sourceLpbRepository:new SourceLpbRepository({indexBytes:data.lpbCatalog,indexSHA256:SOURCE_CHARACTER_RESOURCE_PINS.lpbCatalog.sha256,audioIndexBytes:data.originalAudioNames,audioIndexSHA256:SOURCE_CHARACTER_RESOURCE_PINS.originalAudioNames.sha256,root:contentRoot,fetchData,maxCacheBytes:4*1024*1024})};
 }finally{controller.abort();unregister();}
}
