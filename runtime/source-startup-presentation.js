import {NativeTransitionTaskClock} from './native-transition-clock.js';

const abortError=()=>new Error('Startup presentation canceled');
function active(signal){if(signal?.aborted)throw abortError();}
export class SourceStartupFrameScheduler{
 constructor(clock,{requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id),hidden=false}={}){
  if(typeof clock?.currentTick!=='function'||typeof requestFrame!=='function'||typeof cancelFrame!=='function')throw new Error('Explicit source frame scheduler required');
  this.clock=clock;this.requestFrame=requestFrame;this.cancelFrame=cancelFrame;
  this.task=new NativeTransitionTaskClock(clock.currentTick());this.paused=false;this.setPaused(hidden);
 }
 setPaused(value){const raw=this.clock.currentTick();this.task.update(raw);this.paused=!!value;this.task.setPaused(this.paused);if(!this.paused)this.task.update(raw);}
 sample(){const raw=this.clock.currentTick();this.task.update(raw);return this.paused?(raw-this.task.pauseOffset)>>>0:this.task.currentTick();}
 wait(frames,signal,paint=()=>{}){
  if(!Number.isSafeInteger(frames)||frames<0||frames>=0x80000000)throw new Error('Invalid source frame duration');
  active(signal);const start=this.sample();
  return new Promise((resolve,reject)=>{
   let id,done=false;
   const finish=error=>{if(done)return;done=true;if(id!==undefined)this.cancelFrame(id);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
   const abort=()=>finish(abortError());
   const tick=()=>{
    id=undefined;
    try{
     active(signal);const now=this.sample();
     if(!this.paused){const elapsed=(now-start)>>>0;paint(frames===0?1:Math.min(1,elapsed/frames),elapsed);if(elapsed>=frames){finish();return;}}
     id=this.requestFrame(tick);
    }catch(error){finish(error)}
   };
   signal?.addEventListener('abort',abort,{once:true});tick();
  });
 }
}

export function createSourceStartupPresentation(renderer,clock,{document:doc=globalThis.document,Image:ImageClass=globalThis.Image,hidden=false,onError=error=>{throw error},requestFrame,cancelFrame}={}){
 const scheduler=new SourceStartupFrameScheduler(clock,{hidden,...requestFrame?{requestFrame}:{},...cancelFrame?{cancelFrame}:{}});
 let overlay=null,prepared=null,musicJob=null,musicGeneration=0;
 const white=()=>{
  overlay?.remove();overlay=doc.createElement('div');overlay.dataset.sourceStartup='plane';
  overlay.style.cssText='position:absolute;inset:0;width:1600px;height:900px;background:white;z-index:9999;pointer-events:none';
  doc.getElementById('layers').append(overlay);doc.getElementById('dialogue').hidden=true;return overlay;
 };
 const cancelMusic=()=>{musicJob?.abort();musicJob=null;musicGeneration++;};
 const clear=()=>{overlay?.remove();overlay=null;if(prepared){prepared.removeAttribute('src');prepared.remove();prepared=null}};
 const releaseImage=image=>{image.removeAttribute('src');image.remove();if(prepared===image)prepared=null;};
 const musicFade=async(from,to,frames,signal)=>{
  const audio=renderer.audio.get('bgm30');
  await scheduler.wait(frames,signal,ratio=>{
   if(!audio||renderer.audio.get('bgm30')!==audio)return;
   const state=renderer.audioState.get('bgm30');if(!state)return;
   state.volume=(from+(to-from)*ratio)/100;renderer.applyVolume('bgm30',audio);
  });
 };
 return {
  scheduler,
  setPaused:value=>scheduler.setPaused(value),
  cancel(){cancelMusic();clear();renderer.portMovieJob?.cancel('Startup presentation canceled');},
  hide(){clear();},
  clear(){cancelMusic();clear();},
  async logo(name,signal){
   active(signal);white();renderer.messageWindow.keyskip('off');
   // Exact active pl[0] draw30 duration. The undefined FES "white" object
   // prevents claiming pixel-equivalence for this browser white underlay.
   await scheduler.wait(30,signal);active(signal);await renderer.movie(name);active(signal);
  },
  async caution(signal){
   active(signal);const plane=white();renderer.messageWindow.keyskip('off');
   const frame=renderer.imageFrame('sys_warning_bg',0);
   if(frame.width!==1600||frame.height!==900||frame.x!==0||frame.y!==0)throw new Error('Original caution geometry changed');
   const image=new ImageClass();prepared=image;image.src=renderer.url(frame.file);image.style.cssText='position:absolute;inset:0;width:1600px;height:900px;opacity:0';
   const cancel=()=>releaseImage(image);signal?.addEventListener('abort',cancel,{once:true});
   try{
    await image.decode();active(signal);if(overlay!==plane||prepared!==image)throw abortError();
    plane.append(image);
    await scheduler.wait(60,signal,ratio=>{image.style.opacity=String(ratio)});active(signal);
    renderer.messageWindow.keyskip('on');await scheduler.wait(200,signal);active(signal);
    await scheduler.wait(60,signal,ratio=>{image.style.opacity=String(1-ratio)});active(signal);
    renderer.messageWindow.keyskip('off');
   }finally{signal?.removeEventListener('abort',cancel);releaseImage(image)}
  },
  async returnTitle(signal){
   active(signal);const plane=white();plane.style.opacity='0';
   await scheduler.wait(30,signal,ratio=>{plane.style.opacity=String(ratio)});active(signal);
  },
  startTitleMusic(signal){
   if(renderer.audioState.get('bgm30')?.name==='bgm_amakano2p_op_inst'&&renderer.audio.has('bgm30'))return;
   cancelMusic();const own=new AbortController();musicJob=own;const generation=musicGeneration;
   const cancel=()=>own.abort();signal?.addEventListener('abort',cancel,{once:true});
   const work=async()=>{active(signal);await renderer.sound('bgm30','bgm_amakano2p_op_inst',true,{volume:0});active(signal);active(own.signal);await musicFade(0,80,60,own.signal)};
   work().catch(error=>{if(!own.signal.aborted)onError(error)}).finally(()=>{signal?.removeEventListener('abort',cancel);if(musicJob===own&&musicGeneration===generation)musicJob=null});
  },
  async fadeTitleMusic(frames,signal){cancelMusic();await musicFade(80,0,frames,signal);active(signal);},
 };
}
