// Browser playback and cancellation policy. Original KCS movie skip rules are
// separate. A blocked user gesture keeps the exact video available for retry.
const movieOwners=new WeakMap();
const playbackIntents=new WeakMap();
export function portMoviePlaybackOwner(video){return movieOwners.get(video)??null}
export function beginPortMediaPlaybackIntent(element,isValid=()=>true){const token={status:'pending',isValid};playbackIntents.set(element,token);return token}
export function currentPortMediaPlaybackIntent(element,token){return playbackIntents.get(element)===token}
export function portMediaPlaybackIntentAllowsPlay(element){const token=playbackIntents.get(element);return !!token&&['pending','playing'].includes(token.status)&&token.isValid()}
const asError=value=>value instanceof Error?value:new Error(String(value));
export function withPortMovieLifecycle(BaseRenderer){
 return class PortMovieRenderer extends BaseRenderer{
  static sourceMovieSkipOwnerVersion=1;
  constructor(options,...rest){
   super(options,...rest);
   this.portMovieLifecycle=options.portMovieLifecycle??false;
   if(typeof this.portMovieLifecycle!=='boolean')throw new Error('Invalid movie lifecycle opt-in');
   if(this.portMovieLifecycle&&typeof options.onMediaBlocked!=='function')throw new Error('Movie playback recovery callback required');
   this.portMovieBlocked=options.onMediaBlocked;
   this.portMovieJob=null;
  }
  movie(name,...rest){
   if(!this.portMovieLifecycle)return super.movie(name,...rest);
   if(typeof name!=='string'||!name)throw new Error('Invalid movie name');
   const key=name.toLowerCase(),asset=this.assets[key];
   if(!asset||!['video','movie'].includes(asset.kind)||typeof asset.file!=='string')throw new Error('尚未转换影片资源：'+name);
   this.portMovieJob?.cancel('Movie superseded by another movie');
   const video=document.createElement('video');
   video.playsInline=true;video.controls=this.sourceMoviePolicy!==true;
   video.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:10000;background:black';
   let settled=false,resolve,reject;
   const finished=new Promise((yes,no)=>{resolve=yes;reject=no});
   const job={video,finished,cancel:reason=>finish(true,new Error(reason)),completeSourceSkip:()=>{if(settled)return false;finish(false);return true;},retry:options=>retry(options)};
   const release=()=>{
    const errors=[];for(const action of [()=>video.removeEventListener('ended',ended),()=>video.removeEventListener('error',failed),()=>video.pause(),()=>video.removeAttribute('src'),()=>video.load(),()=>video.remove()])try{action()}catch(error){errors.push(asError(error))}
    if(this.audio.get('movie')===video){this.audio.delete('movie');this.audioState.delete('movie')}
    if(this.portMovieJob===job)this.portMovieJob=null;
    movieOwners.delete(video);return errors[0];
   };
   const finish=(hasError,error)=>{if(settled)return;settled=true;const cleanupError=release();hasError?reject(asError(error)):cleanupError?reject(cleanupError):resolve()};
   const ended=()=>finish(false),failed=()=>finish(true,new Error('影片播放失败：'+name));
   const retry=({isPlaybackCurrent=()=>true}={})=>{
    if(settled)return Promise.resolve({status:'canceled'});
    const intent=beginPortMediaPlaybackIntent(video,()=>!settled&&this.audio.get('movie')===video&&isPlaybackCurrent()),currentIntent=()=>currentPortMediaPlaybackIntent(video,intent);
    const pauseCanceled=()=>{try{video.pause()}catch{}return {status:'canceled'}};
    let attempt;try{attempt=Promise.resolve(video.play())}catch(error){attempt=Promise.reject(error)}
    const observed=attempt.then(()=>{
     intent.status='playing';
     if(!currentIntent())return portMediaPlaybackIntentAllowsPlay(video)?{status:'superseded'}:pauseCanceled();
     if(settled||this.audio.get('movie')!==video||!isPlaybackCurrent())return pauseCanceled();
     return {status:'playing'};
    },error=>{
     intent.status='blocked';
     if(!currentIntent())return portMediaPlaybackIntentAllowsPlay(video)?{status:'superseded'}:pauseCanceled();
     if(settled)return pauseCanceled();
     if(!isPlaybackCurrent())return pauseCanceled();
     if(error?.name==='NotAllowedError'){
      try{this.portMovieBlocked('movie',video);return {status:'blocked'}}catch(reason){finish(true,reason);return {status:'failed'}}
     }
     finish(true,error);return {status:'failed'};
    });
    // Renderer cancellation also completes a retry whose browser play promise
    // never settles. The late promise is observed and pauses its old video.
    return Promise.race([observed,finished.then(()=>({status:'ended'}),()=>({status:'canceled'}))]);
   };
   video.addEventListener('ended',ended);video.addEventListener('error',failed);
   this.portMovieJob=job;movieOwners.set(video,job);
   try{
    video.src=this.url(asset.file);
    this.audio.set('movie',video);this.audioState.set('movie',{name:key,volume:1});this.applyVolume('movie',video);
    document.getElementById('layers').append(video);
    // Calling play here retains the caller's current gesture. Rejection does
    // not discard a playable file merely because a fresh gesture is needed.
    retry();
   }catch(error){finish(true,error)}
   return finished;
  }
  stopSound(channel,...rest){
   if(channel==='movie')this.portMovieJob?.cancel('Movie canceled by stop');
   return super.stopSound(channel,...rest);
  }
  reset(...rest){
   this.portMovieJob?.cancel('Movie canceled by renderer reset');
   return super.reset(...rest);
  }
 };
}
