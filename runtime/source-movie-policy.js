// Original main/movie KCS source515 mask and cancellation subtypes. The browser
// pointerup mapping below is an explicit port policy, not a Windows edge claim.
export const SOURCE_MOVIE_POLICY=Object.freeze({version:1,flagIndex:515,nativeMessage:-65533,primarySubtype:0,secondarySubtype:1,pointerMapping:'port-pointerup-primary-button0-to-subtype0-secondary-button2-to-subtype1',sourceReviewSHA256:'73073d99eb1a4839dfe81b3c9e3fa0ae10720399751976db5b8dcb58fb448d4d'});
const require=(ok,message)=>{if(!ok)throw new Error('Source movie policy: '+message)};
export function sourceMovieCancelWord(state){
 require(state?.numbers&&typeof state.numbers==='object','current VM numeric state required');
 // Original Native210 returns zero for an absent/out-of-bounds flag index.
 const value=state.numbers[SOURCE_MOVIE_POLICY.flagIndex]??0;
 require(Number.isInteger(value)&&value>=-0x80000000&&value<=0xffffffff,'source515 integer word required');
 return value>>>0;
}
export function sourceMovieCancelAllows(word,subtype){
 require(Number.isInteger(word)&&word>=0&&word<=0xffffffff,'uint32 cancellation word required');
 require(subtype===0||subtype===1,'native cancellation subtype0/1 required');
 return !!(word&(subtype===0?1:2));
}
export function sourceMoviePortPointerSubtype(event){
 if(event?.isPrimary===false||event?.defaultPrevented)return null;
 if(event?.button===0)return 0;
 if(event?.button===2)return 1;
 return null;
}
export function withSourceMoviePolicy(BaseRenderer){
 return class SourceMoviePolicyRenderer extends BaseRenderer{
  constructor(options,...rest){
   const enabled=options?.sourceMoviePolicy??false;require(typeof enabled==='boolean','boolean opt-in required');
   if(enabled){
    require(options.portMovieLifecycle===true&&BaseRenderer.sourceMovieSkipOwnerVersion===1,'explicit compatible movie completion owner required');
    require(typeof options.sourceMovieState==='function','shared VM state provider required');
    require(options.onSourceMoviePolicySettled===undefined||typeof options.onSourceMoviePolicySettled==='function','settled callback required');
   }
   super(options,...rest);this.sourceMoviePolicy=enabled;this.sourceMovieStateProvider=options?.sourceMovieState;
   this.sourceMoviePolicySettled=options?.onSourceMoviePolicySettled??(()=>{});
   this.sourceMoviePolicyJob=null;this.sourceMoviePolicyEvents=[];
  }
  sourceMoviePolicyEvent(event){this.sourceMoviePolicyEvents.push(Object.freeze(event));if(this.sourceMoviePolicyEvents.length>256)this.sourceMoviePolicyEvents.shift();}
  detachSourceMoviePolicy(record=this.sourceMoviePolicyJob){
   if(!record)return;record.video.removeEventListener('pointerup',record.pointer);record.video.removeEventListener('contextmenu',record.context);
   if(this.sourceMoviePolicyJob===record)this.sourceMoviePolicyJob=null;
  }
  movie(name,...rest){
   if(!this.sourceMoviePolicy)return super.movie(name,...rest);
   const options=rest[0],state=options&&Object.hasOwn(options,'sourceMoviePolicyState')?options.sourceMoviePolicyState:this.sourceMovieStateProvider();
   // Read the shared flag once at call entry, as the original movie task does.
   // Validation occurs before a new call can cancel the previous movie owner.
   const word=sourceMovieCancelWord(state),location=options?.sourceMovieCommandLocation;
   const finished=super.movie(name,...rest),job=this.portMovieJob;
   this.detachSourceMoviePolicy();
   const notify=(record,status)=>{
    this.detachSourceMoviePolicy(record);
    this.sourceMoviePolicyEvent({kind:'movie-policy-settled',name,word,status,completion:record?.skipped?'source-input-skip':'media-end-or-error',location});
    try{this.sourceMoviePolicySettled()}catch(error){this.warn('影片结束状态更新失败：'+String(error?.message??error));}
   };
   if(!job){Promise.resolve(finished).then(()=>notify(null,'fulfilled'),()=>notify(null,'rejected'));return finished;}
   require(typeof job.completeSourceSkip==='function'&&job.video.controls===false,'source owner or disabled seeking controls missing');
   const record={job,video:job.video,word,name,location,skipped:false};
   record.pointer=event=>{if(this.sourceMoviePolicyJob!==record||this.portMovieJob!==record.job)return;const subtype=sourceMoviePortPointerSubtype(event);if(subtype===null)return;const result=this.requestSourceMovieSkip(subtype);if(result.accepted)event.preventDefault?.();};
   record.context=event=>event.preventDefault?.();
   record.video.addEventListener('pointerup',record.pointer);record.video.addEventListener('contextmenu',record.context);this.sourceMoviePolicyJob=record;
   this.sourceMoviePolicyEvent({kind:'movie-policy-prepared',name,word,primaryAllowed:sourceMovieCancelAllows(word,0),secondaryAllowed:sourceMovieCancelAllows(word,1),location,pointerMapping:SOURCE_MOVIE_POLICY.pointerMapping});
   Promise.resolve(finished).then(()=>notify(record,'fulfilled'),()=>notify(record,'rejected'));
   return finished;
  }
  requestSourceMovieSkip(subtype){
   require(subtype===0||subtype===1,'native cancellation subtype0/1 required');
   const record=this.sourceMoviePolicyJob;
   if(!this.sourceMoviePolicy||!record||this.portMovieJob!==record.job||this.audio.get('movie')!==record.video)return {accepted:false,reason:'no-current-movie-owner'};
   if(!sourceMovieCancelAllows(record.word,subtype)){this.sourceMoviePolicyEvent({kind:'movie-policy-input-denied',subtype,word:record.word,name:record.name});return {accepted:false,reason:'source515-disabled'};}
   const accepted=record.job.completeSourceSkip();
   if(accepted){record.skipped=true;this.detachSourceMoviePolicy(record);this.sourceMoviePolicyEvent({kind:'movie-policy-source-skip',subtype,word:record.word,name:record.name,nativeMessage:SOURCE_MOVIE_POLICY.nativeMessage});}
   return {accepted,reason:accepted?'source-input-skip':'already-settled'};
  }
  stopSound(channel,...rest){if(channel==='movie')this.detachSourceMoviePolicy();return super.stopSound(channel,...rest);}
  reset(...rest){this.detachSourceMoviePolicy();return super.reset(...rest);}
 };
}
