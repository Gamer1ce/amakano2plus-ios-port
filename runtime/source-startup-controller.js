import {originalFlowStartEventGate,originalFlow2Entry,originalLogoPlan,originalCautionChildExit,originalDateEventPlan} from './startup-flow.js';

export const SOURCE_STARTUP_POLICY=Object.freeze({
 sourceReviewSHA256:'4f7a875157b70e60d9381b4e3590dbcf517bd36fbf308eafeae831a5716ce2fa',
 localTime:'browser local SYSTEMTIME field mapping; one sample per date check',
 random:'explicit integer-range provider; browser provider is a port policy',
 initialFlags:'existing globals; no invented process reset of513/732/735',
 movieCompletion:'real Renderer.movie completion; KCS skip/failure semantics remain separate',
 fullGameAccepted:false,
});
export function sourceLocalTime(date=new Date()){
 if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new Error('Invalid browser local date');
 return {year:date.getFullYear(),month:date.getMonth()+1,day:date.getDate(),weekday:date.getDay(),hour:date.getHours(),minute:date.getMinutes(),second:date.getSeconds()};
}
// Uniform inclusive range. This explicit browser policy does not emulate the
// original CRT generator, its seed, or its sequence across other engine tasks.
export function browserRangeInteger(min,max,cryptoSource=globalThis.crypto){
 if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min>max||max-min+1>0x100000000)throw new Error('Invalid random integer range');
 const count=max-min+1,limit=Math.floor(0x100000000/count)*count;
 if(typeof cryptoSource?.getRandomValues!=='function')throw new Error('Explicit crypto random provider required');
 const word=new Uint32Array(1);
 for(let attempts=0;attempts<1024;attempts++){
  cryptoSource.getRandomValues(word);if(word[0]<limit)return min+word[0]%count;
 }
 throw new Error('Random provider repeatedly rejected');
}

// Own only the FES child/parent handoff. The scenario is the real ScriptVM,
// which yields dialogue/choices normally and is advanced by the actual app.
export class SourceStartupController{
 constructor({vm,presentation,commitState,launchScene,showProfile,showTitle,onPhase=()=>{},randomInteger=browserRangeInteger,localTime=sourceLocalTime}){
  for(const [name,value]of Object.entries({commitState,launchScene,showProfile,showTitle,onPhase,randomInteger,localTime}))if(typeof value!=='function')throw new Error('Missing startup callback '+name);
  if(!vm?.state||!presentation)throw new Error('Actual startup VM and presentation required');
  Object.assign(this,{vm,presentation,commitState,launchScene,showProfile,showTitle,onPhase,randomInteger,localTime});
  this.phase='idle';this.generation=0;this.job=null;this.currentScene=null;
 }
 get blocksActions(){return ['logo','caution','checking-date','return-title'].includes(this.phase)}
 phaseIs(value){this.phase=value;this.onPhase(value);}
 #newJob(){this.job?.abort();const job=new AbortController();this.job=job;const generation=++this.generation;return {signal:job.signal,assert:()=>{if(job.signal.aborted||this.job!==job||this.generation!==generation)throw new Error('Startup operation superseded')}};}
 #apply(plan){Object.assign(this.vm.state.numbers,plan.numbers);Object.assign(this.vm.state.strings,plan.strings??{});this.commitState(this.vm.state);}
 cancel(){this.job?.abort();this.job=null;this.generation++;this.currentScene=null;this.presentation.cancel();this.phaseIs('cancelled');}
 async start(){
  if(this.phase!=='idle')throw new Error('Startup already entered');
  const job=this.#newJob();
  try{
   this.#apply({numbers:originalFlowStartEventGate(this.vm.state.numbers)});
   if(originalFlow2Entry(this.vm.state.numbers)==='logo'){
    this.phaseIs('logo');
    const plan=originalLogoPlan(this.vm.state.numbers,this.randomInteger(0,3));this.#apply(plan);
    await this.presentation.logo(plan.strings[500],job.signal);job.assert();
    this.phaseIs('caution');await this.presentation.caution(job.signal);job.assert();
    const completion=originalCautionChildExit(this.vm.state.numbers,0);this.#apply(completion);
    if(completion.action==='profile-wizard'){
     this.phaseIs('profile');this.presentation.startTitleMusic(job.signal);this.showProfile();return;
    }
   }else{
    // Original return-title topmask fade30 precedes the date check.
    this.phaseIs('return-title');await this.presentation.returnTitle(job.signal);job.assert();
   }
   await this.#dateCheck(job);
  }catch(error){if(this.job?.signal!==job.signal||job.signal.aborted)throw error;this.presentation.cancel();this.phaseIs('failed');throw error;}
 }
 async profileCompleted(){
  if(this.phase!=='profile')return false;
  if((this.vm.state.numbers[849]??0)===0)throw new Error('Profile completion849 was not committed');
  const job=this.#newJob();try{await this.#dateCheck(job);return true}catch(error){if(this.job?.signal===job.signal&&!job.signal.aborted){this.presentation.cancel();this.phaseIs('failed')}throw error;}
 }
 beginStory(){
  if(this.blocksActions||this.phase==='profile')throw new Error('Startup has not completed');
  this.#newJob();this.currentScene=null;this.vm.state.numbers[513]=1;this.commitState(this.vm.state);this.phaseIs('story');
 }
 adoptScenario(mode){if(!['story','replay'].includes(mode))throw new Error('Invalid startup scenario mode');this.#newJob();this.currentScene=null;this.phaseIs(mode==='story'?'story':'extra');}
 async afterVMEvent(event){
  if(event?.type!=='end'||event.reason==='replay-boundary'||!['date','story'].includes(this.phase))return false;
  if(this.vm.state.executionMode==='replay')return false;
  const job=this.#newJob();this.currentScene=null;this.vm.state.numbers[513]=1;this.commitState(this.vm.state);
  try{this.phaseIs('return-title');await this.presentation.returnTitle(job.signal);job.assert();await this.#dateCheck(job);return true}catch(error){if(this.job?.signal===job.signal&&!job.signal.aborted){this.presentation.cancel();this.phaseIs('failed')}throw error;}
 }
 async #dateCheck(job){
  job.assert();this.phaseIs('checking-date');
  const gate=this.vm.state.numbers[734]??0,checksClock=gate===0||gate===1;
  const plan=originalDateEventPlan({numbers:this.vm.state.numbers,strings:this.vm.state.strings,
   localTime:checksClock?this.localTime():undefined,
   randomHeroine:checksClock&&(this.vm.state.numbers[725]??0)===0?this.randomInteger(1,4):undefined});
  this.#apply(plan);
  if(plan.action==='title'){
   this.presentation.startTitleMusic(job.signal);this.phaseIs('title');this.showTitle();return;
  }
  await this.presentation.fadeTitleMusic(plan.fade.frames,job.signal);job.assert();
  this.vm.state.numbers[513]=1;this.commitState(this.vm.state);
  this.presentation.clear();this.currentScene=plan.scene;this.phaseIs('date');
  // No synthetic completion and no all-text consumer here: the app's normal
  // start/advance/choice path runs the exact original OPEV scene.
  await this.launchScene(plan.scene,{numbers:{...this.vm.state.numbers},strings:{...this.vm.state.strings}});
 }
}
