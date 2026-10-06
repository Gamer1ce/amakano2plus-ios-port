import {argumentsOf} from './expressions.js';

// Keep user/script pauses separate from the pauses used when the page is hidden.
export class MediaLifecycle {
  constructor({audio,hidden=false,onRecovery=()=>{}}){
    this.audio=audio;this.hidden=hidden;this.onRecovery=onRecovery;
    this.suspended=new Map();this.waiters=[];this.resuming=null;
  }
  current(channel,media){return this.audio.get(channel)===media&&!media.ended}
  prune(){for(const [channel,media] of this.suspended)if(!this.current(channel,media))this.suspended.delete(channel)}
  report(){this.prune();this.onRecovery(this.hidden?0:this.suspended.size)}
  clear(){this.suspended.clear();this.report()}
  suspend(){
    this.hidden=true;
    for(const [channel,media] of this.audio)if(!media.paused&&!media.ended){this.suspended.set(channel,media);media.pause()}
    this.report();
  }
  async resume(){
    this.hidden=false;
    if(this.resuming)return this.resuming;
    const work=async()=>{
      this.prune();
      await Promise.all([...this.suspended].map(async([channel,media])=>{
        if(!this.current(channel,media)){this.suspended.delete(channel);return}
        if(this.hidden)return;
        try{
          if(media.paused)await media.play();
          if(this.suspended.get(channel)!==media)return;
          if(!this.current(channel,media)){this.suspended.delete(channel);return}
          if(this.hidden){media.pause();return}
          this.suspended.delete(channel);
        }catch{
          // A browser may require a new gesture. Keep this exact clip retryable.
          if(!this.current(channel,media))this.suspended.delete(channel);
        }
      }));
    };
    // Invoke play() in the click handler's gesture, while still publishing a
    // shared job before play() can dispatch another lifecycle event.
    let finish;this.resuming=new Promise(resolve=>finish=resolve);
    try{await work()}finally{
      this.resuming=null;this.report();
      if(!this.hidden)for(const resolve of this.waiters.splice(0))resolve();
      finish();
    }
  }
  waitUntilVisible(){return !this.hidden&&!this.resuming?Promise.resolve():new Promise(resolve=>this.waiters.push(resolve))}
  beforeCommand(renderer,cmd,args,state){
    if(!['pcm','bgm','se'].includes(cmd))return;
    const parts=argumentsOf(args),explicit=/^(?:\d+|#\d+)$/.test(parts[0]??'');
    const channel=explicit?renderer.soundBank(cmd,parts[0],state):renderer.unusedSoundBank(cmd);
    const operation=parts[explicit?1:0];
    // Volume/fade/position changes keep the current clip's playback intent.
    if(!['vol','fade','pos'].includes(operation))this.suspended.delete(channel);
    this.report();
  }
  async command(renderer,cmd,args,state,commandLocation){
    await this.waitUntilVisible();
    this.beforeCommand(renderer,cmd,args,state);
    try{return await renderer.command(cmd,args,state,commandLocation)}finally{
      this.prune();if(this.hidden)this.suspend();else this.report();
    }
  }
  snapshot(saved){
    this.prune();
    return {...saved,audio:saved.audio.map(sound=>this.suspended.get(sound.channel)===this.audio.get(sound.channel)?{...sound,paused:false}:sound)};
  }
}
