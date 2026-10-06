// Adapter corrections for the upstream FreeMote WebGL wrapper.
// Keep the original files and their license notices intact.
Object.defineProperty(EmotePlayer.prototype,'globalAlpha',{
  get(){return this._globalA/255},set(value){this.setGlobalAlpha(value)}
});
EmotePlayer.prototype.destroy=function(){this.unloadData();EmotePlayer.releaseDevice()};
EmotePlayer.releaseDevice=function(){
  // The upstream wrapper has no device teardown method. Keep one device alive
  // while releasing each model with EmotePlayer_Finish; reuse its WebGL context.
  EmotePlayer.deviceRefCount=Math.max(0,EmotePlayer.deviceRefCount-1);
};
EmotePlayer.requireDevice=function(){if(!EmotePlayer.device)EmotePlayer.device=new EmoteDevice();EmotePlayer.deviceRefCount++};
