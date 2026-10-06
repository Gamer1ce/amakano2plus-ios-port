import {MediaLifecycle} from './media-lifecycle.js';
import {portMoviePlaybackOwner,beginPortMediaPlaybackIntent,currentPortMediaPlaybackIntent,portMediaPlaybackIntentAllowsPlay} from './port-movie-lifecycle.js';

export class PortMovieMediaLifecycle extends MediaLifecycle{
 blocked(channel,element){
  if(typeof channel!=='string'||!element)throw new Error('Invalid blocked media notification');
  if(!this.current(channel,element))return false;
  this.suspended.set(channel,element);
  this.report();
  return true;
 }
 clear(){
  this.portResumeJob?.cancel();this.portResumeJob=null;this.resuming=null;
  super.clear();
  if(!this.hidden)for(const resolve of this.waiters.splice(0))resolve();
 }
 resume(){
  this.hidden=false;if(this.resuming)return this.resuming;
  let cancel,finish;const canceled=new Promise(resolve=>cancel=()=>{job.canceled=true;resolve('canceled')});
  const done=new Promise(resolve=>finish=resolve),job={cancel,done,canceled:false};
  this.portResumeJob=job;this.resuming=done;
  const work=async()=>{
   this.prune();
   await Promise.all([...this.suspended].map(async([channel,element])=>{
    if(!this.current(channel,element)){this.suspended.delete(channel);return}
    if(this.hidden)return;
    let playback;
    const movie=portMoviePlaybackOwner(element);
    const pauseCanceled=()=>{try{element.pause()}catch{}return 'canceled'};
    if(movie)playback=movie.retry({isPlaybackCurrent:()=>!job.canceled&&!this.hidden&&this.current(channel,element)}).then(result=>result.status);
    else{
     const intent=beginPortMediaPlaybackIntent(element,()=>!job.canceled&&!this.hidden&&this.current(channel,element)),currentIntent=()=>currentPortMediaPlaybackIntent(element,intent);
     try{playback=Promise.resolve(element.paused?element.play():undefined).then(()=>{
      intent.status='playing';
      if(!currentIntent())return portMediaPlaybackIntentAllowsPlay(element)?'superseded':pauseCanceled();
      if(job.canceled||!this.current(channel,element))return pauseCanceled();
      return 'playing';
     },()=>{intent.status='blocked';if(!currentIntent())return portMediaPlaybackIntentAllowsPlay(element)?'superseded':pauseCanceled();if(job.canceled||!this.current(channel,element))return pauseCanceled();return 'blocked'})}catch{intent.status='blocked';playback=Promise.resolve('blocked')}
    }
    const result=await Promise.race([playback,canceled]);
    if(this.portResumeJob!==job)return;
    if(this.suspended.get(channel)!==element)return;
    if(!this.current(channel,element)){this.suspended.delete(channel);return}
    if(this.hidden){element.pause();return}
    if(result==='playing')this.suspended.delete(channel);
   }));
  };
  work().finally(()=>{
   if(this.portResumeJob===job){this.portResumeJob=null;this.resuming=null;this.report();if(!this.hidden)for(const resolve of this.waiters.splice(0))resolve()}
   finish();
  }).catch(()=>{finish()});
  return done;
 }
}
