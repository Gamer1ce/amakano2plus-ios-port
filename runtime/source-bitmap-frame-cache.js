// Decoded bitmap ownership for streaming source ANM. No browser/process memory
// claim follows from these JS ownership counters; native observation is separate.
const require=(ok,message)=>{if(!ok)throw new Error('Source bitmap cache: '+message)};
export class SourceBitmapCacheDisposedError extends Error{
 constructor(){super('Source bitmap cache disposed');this.name='SourceBitmapCacheDisposedError'}
}
export async function decodeSourceFrameBitmap(frame,url,{signal}={}){
 require(typeof createImageBitmap==='function','ImageBitmap decoder unavailable');
 const response=await fetch(url,{signal});require(response.ok,'frame fetch '+frame.file);
 const blob=await response.blob();
 // Default browser image conversion, matching the displayed source images.
 // Native Canvas/Image pixel comparison remains a required acceptance gate.
 return createImageBitmap(blob);
}
export class SourceBitmapFrameCache{
 #frames;#loader;#url;#capacity;#loaded=new Map();#pending=new Map();#requested=new Map();#queue=Promise.resolve();#closed=false;#sequence=0;#controller=null;#owned=new WeakSet();#closedBitmaps=new WeakSet();#peak=0;#peakPixels=0;#decodes=0;#evictions=0;
 constructor(frames,{url,decode=decodeSourceFrameBitmap,capacity=3}={}){
  require(frames instanceof Map&&frames.size>0&&frames.size<=256,'bounded frame map');
  require(typeof url==='function'&&typeof decode==='function','explicit URL and decoder');
  require(Number.isSafeInteger(capacity)&&capacity>=1&&capacity<=3,'bitmap capacity1..3');
  this.#frames=new Map();
  for(const [id,frame]of frames){
   require(Number.isSafeInteger(id)&&id>=0&&frame&&Number.isSafeInteger(frame.width)&&Number.isSafeInteger(frame.height)&&frame.width>0&&frame.height>0&&frame.width*frame.height<=32*1024*1024&&typeof frame.file==='string'&&frame.file,'frame shape');
   this.#frames.set(id,Object.freeze({...frame}));
  }
  this.#url=url;this.#loader=decode;this.#capacity=capacity;
 }
 #assert(){if(this.#closed)throw new SourceBitmapCacheDisposedError()}
 #close(bitmap){if(!this.#closedBitmaps.has(bitmap)){this.#closedBitmaps.add(bitmap);bitmap.close()}}
 #recordPeak(){this.#peak=Math.max(this.#peak,this.#loaded.size);const pixels=[...this.#loaded.values()].reduce((sum,row)=>sum+row.pixels,0);this.#peakPixels=Math.max(this.#peakPixels,pixels)}
 #evict(){
  let victim=null;
  for(const [id,row]of this.#loaded)if((this.#requested.get(id)??0)===0&&(!victim||row.touched<victim.row.touched))victim={id,row};
  require(victim,'all retained bitmaps leased');this.#loaded.delete(victim.id);this.#close(victim.row.bitmap);this.#evictions++;
 }
 #ensure(id){
  this.#assert();require(this.#frames.has(id),'unknown frame');
  if(this.#loaded.has(id)){const row=this.#loaded.get(id);row.touched=++this.#sequence;return Promise.resolve(row.bitmap)}
  if(this.#pending.has(id))return this.#pending.get(id);
  const pending=this.#queue.then(async()=>{
   this.#assert();if(this.#loaded.has(id))return this.#loaded.get(id).bitmap;
   while(this.#loaded.size>=this.#capacity)this.#evict();
   const frame=this.#frames.get(id),controller=new AbortController();this.#controller=controller;
   let bitmap,ownedByAttempt=false;
   try{
    this.#decodes++;bitmap=await this.#loader(frame,this.#url(frame.file),{signal:controller.signal});
    require(bitmap&&typeof bitmap==='object'&&typeof bitmap.close==='function','closable bitmap');
    require(!this.#owned.has(bitmap),'decoder reused another owned bitmap');this.#owned.add(bitmap);ownedByAttempt=true;
    if(this.#closed){this.#close(bitmap);throw new SourceBitmapCacheDisposedError()}
    require(bitmap.width===frame.width&&bitmap.height===frame.height,'decoded source frame dimensions');
    this.#loaded.set(id,{bitmap,touched:++this.#sequence,pixels:frame.width*frame.height});this.#recordPeak();return bitmap;
   }catch(error){if(ownedByAttempt&&!this.#loaded.has(id))this.#close(bitmap);throw error}
   finally{if(this.#controller===controller)this.#controller=null}
  });
  this.#pending.set(id,pending);this.#queue=pending.catch(()=>{});
  pending.then(()=>{if(this.#pending.get(id)===pending)this.#pending.delete(id)},()=>{if(this.#pending.get(id)===pending)this.#pending.delete(id)});
  return pending;
 }
 acquire(id){
  this.#assert();require(this.#frames.has(id),'unknown frame');
  this.#requested.set(id,(this.#requested.get(id)??0)+1);let released=false;
  const release=()=>{if(released)return;released=true;const count=(this.#requested.get(id)??0)-1;if(count>0)this.#requested.set(id,count);else this.#requested.delete(id)};
  let pending;try{pending=this.#ensure(id)}catch(error){release();throw error}
  return pending.then(bitmap=>{
   if(this.#closed){release();throw new SourceBitmapCacheDisposedError()}
   if(this.#loaded.get(id)?.bitmap!==bitmap){release();require(false,'lease bitmap ownership')}
   return Object.freeze({bitmap,release});
  },error=>{release();throw error});
 }
 prefetch(id){return this.#ensure(id).then(()=>undefined)}
 diagnostics(){
  return Object.freeze({capacity:this.#capacity,retainedBitmaps:this.#loaded.size,pendingRequests:this.#pending.size,leasedFrames:this.#requested.size,retainedPixels:[...this.#loaded.values()].reduce((sum,row)=>sum+row.pixels,0),peakRetainedBitmaps:this.#peak,peakRetainedPixels:this.#peakPixels,decodeCalls:this.#decodes,evictions:this.#evictions,disposed:this.#closed,physicalBrowserMemoryAccepted:false});
 }
 dispose(){
  if(this.#closed)return;this.#closed=true;this.#controller?.abort();
  for(const row of this.#loaded.values())this.#close(row.bitmap);this.#loaded.clear();
 }
}
