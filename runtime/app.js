import {PortVisibleMilliseconds} from './port-visible-milliseconds.js';
import {withSharedSourceSnapshot} from './source-performance-restore-coordinator.js';
import {NativeCalculatorCurrent} from './native-calculator-current.js';
import {nativeStepQuakeOptions} from './native-step-quake-ledger-adapter.js';
import {NATIVE_ACCELERATED_SCALE_OPERATIONS,nativeAcceleratedScaleAdapters,nativeAcceleratedScaleFactory} from './native-accelerated-scale.js';
import {createCatalogSceneLoader} from './scene-loader.js';
import {ScriptVM} from './vm.js';
import {Renderer} from './integrated-renderer.js';
import {loadSourceCharacterResources} from './source-character-resources.js';
import {bindMessageTextAdvance} from './native-message-window.js';
import {PortOwnSaveFrameClock} from './source-save-clock-owner.js';
import {SourceStartupController} from './source-startup-controller.js';
import {createSourceStartupPresentation} from './source-startup-presentation.js';
import {CGRegistrationStore} from './extra-mode-registry.js';
import {createReplayCatalog,extraMenuEnabled,replayPage,replayLaunch,EXTRA_CHARACTERS} from './extra-mode-catalog.js';
import {SaveStore,GlobalFlagStore,readSettings,writeExtraUnlockAllSetting} from './storage.js';
import {SYSTEM_CONFIG,storyInitialNumbers,nativeStartupNumbers,replayInitialNumbers} from './system-config.js';
import {ROUTES} from './routes.js';
import {PortMovieMediaLifecycle as MediaLifecycle} from './port-movie-media-lifecycle.js';
import {consumeOriginalScene} from './diagnostic-source-driver.js';
import {PROFILE_HEROINES,NATIVE_DISPLAY_MODES,needsNativeProfile,createNativeProfileDraft,confirmNativeProfileName,confirmNativeProfileBirthday,selectNativeProfileHeroine,birthdayDays,persistNativeProfileCompletion,setNativeImagePreference,resetNativeImagePreferences,nativeProfileLaunchInitial,nativeProfileRestoreNumbers} from './native-profile.js';
const $=id=>document.getElementById(id);
const root=new URL('../game-data/converted/',location.href);
const visibleGameMilliseconds=new PortVisibleMilliseconds({millisecondSource:()=>performance.now(),isHidden:()=>document.hidden===true,visibilityTarget:document,pageTarget:window});
const additionalMotionOptions={nativeAdditionalMotionAdapters:[...nativeStepQuakeOptions.nativeAdditionalMotionAdapters,...nativeAcceleratedScaleAdapters()],nativeAdditionalMotionOperations:[...nativeStepQuakeOptions.nativeAdditionalMotionOperations,...NATIVE_ACCELERATED_SCALE_OPERATIONS],nativeAdditionalMotionFactory:request=>request.operation==='quake'?nativeStepQuakeOptions.nativeAdditionalMotionFactory(request):nativeAcceleratedScaleFactory(request),nativeAdditionalMotionBankSelector:nativeStepQuakeOptions.nativeAdditionalMotionBankSelector};
const loading=text=>{$('loading').textContent=text;$('loading').hidden=!text};
const panel=$('panel'),content=$('panel-content');
let vm,renderer,media,store,globalFlags,settings,manifest,assetReport,auto=false,timer,started=false,panelMode='',replayCatalog,cgRegistry,extraModeData,gallerySession,galleryBusy=false,profileDraft=null,frontendOperation=false,readSaveOperation=false,startupFlow,startupPresentation;
const resumeAudio=document.createElement('button');resumeAudio.id='resume-audio';resumeAudio.type='button';resumeAudio.hidden=true;resumeAudio.textContent='恢复声音';resumeAudio.title='浏览器暂停了播放，请轻点恢复语音、音乐或影片';$('toolbar').append(resumeAudio);
const mediaStatus=document.createElement('span');mediaStatus.id='media-status';mediaStatus.style.cssText='position:absolute;right:7px;top:100%;max-width:300px;font-size:13px;background:#10182c';mediaStatus.setAttribute('role','status');mediaStatus.setAttribute('aria-live','polite');$('toolbar').append(mediaStatus);
function applySourceSystemButtons(){const busy=document.body.dataset.busy==='true'||readSaveOperation||startupFlow?.blocksActions===true;for(const [id,code]of [['auto',1],['history',2],['menu',4],['settings',5],['save',6],['load',7]]){$(id).disabled=busy||!(renderer?.messageWindow?.enabled(code)??true);}}
function audioRecovery(count){resumeAudio.hidden=!count;resumeAudio.disabled=false;mediaStatus.textContent=count?'播放尚未恢复，请轻点“恢复声音”。':''}
resumeAudio.onclick=async()=>{resumeAudio.disabled=true;mediaStatus.textContent='正在恢复播放…';await media.resume()};
function setAuto(value){auto=value;clearTimeout(timer);$('auto').textContent=auto?'停止自动':'自动';$('auto').ariaPressed=String(auto)}
function show(title,mode='menu'){let required=profileDraft?.firstRun===true;if(!required&&globalFlags){try{required=needsNativeProfile(globalFlags.read())}catch{}}clearTimeout(timer);panel.style.cssText=mode==='gallery-view'?'position:fixed;top:auto;bottom:8px;left:50%;transform:translateX(-50%);max-height:155px;max-width:95vw;padding:8px 12px':'';panelMode=required?'profile-first':mode;$('close-panel').hidden=required||mode==='choice'||mode==='profile-first';content.replaceChildren();const heading=document.createElement('h1');heading.textContent=title;content.append(heading);if(!panel.open)panel.showModal()}
function paragraph(text){const p=document.createElement('p');p.textContent=text;content.append(p)}
function button(label,handler){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy||startupFlow?.blocksActions)return;return Promise.resolve().then(handler).catch(error)};if(label==='返回菜单'&&started&&!vm?.state.ended&&!vm?.fault&&!renderer.messageWindow.enabled(4))b.disabled=true;content.append(b);return b}
const run=async task=>{
  if(frontendOperation)throw new Error('页面操作正在进行');frontendOperation=true;
  document.body.dataset.busy='true';for(const button of $('toolbar').querySelectorAll('button:not(#resume-audio)'))button.disabled=true;$('advance').disabled=true;
  let event;try{event=await globalFlags.run(vm,task);display(event)}finally{for(const button of $('toolbar').querySelectorAll('button:not(#resume-audio)'))button.disabled=false;$('advance').disabled=false;frontendOperation=false;document.body.dataset.busy='false';applySourceSystemButtons()}
  await startupFlow?.afterVMEvent(event);return event;
};
function error(reason){
  setAuto(false);loading('');show('剧情运行已停止','error');paragraph(String(reason?.message??reason));
  paragraph('这是仍在开发的移植版本。缺失资源或未实现的原引擎行为会在这里明确显示。');
  if(vm?.fault)paragraph(`位置：${vm.fault.scene}，指令 ${vm.fault.index}\n${vm.fault.command}`);
  document.body.dataset.lastError=String(reason?.message??reason);button('查看兼容性记录',compatibility);if(vm)button('返回菜单',menu);else button('重新加载',()=>location.reload());
}
function schedule(){clearTimeout(timer);if(auto&&started&&!panel.open&&!vm.state.ended&&!vm.fault)timer=setTimeout(advance,Math.max(settings.autoDelay,vm.state.message.length*80))}
function display(event){
  if(!event)return;
  document.body.dataset.scene=vm.state.stack.at(-1)?.id??'';document.body.dataset.position=String(vm.state.stack.at(-1)?.index??0);
  if(event.type==='message'){if(typeof event.scene==='string'&&Number.isSafeInteger(event.index))renderer.messageWindow.onMessage();$('speaker').textContent=event.name;$('text').textContent=event.text;}
  if(event.type==='choice'){
    setAuto(false);show('请选择','choice');
    for(const [index,choice] of event.choices.entries())button(choice.text,async()=>{panel.close();await run(()=>vm.choose(index))});
  }
  if(event.type==='end'){setAuto(false);if(event.reason==='replay-boundary'){vm.state.numbers[900]=0;globalFlags.write(vm.state.numbers);media.clear();renderer.reset();started=false;replayMenu(vm.state.numbers[721]??0,vm.state.numbers[720]??0);return;}if(startupFlow&&['date','story'].includes(startupFlow.phase)&&vm.state.executionMode==='story')return;show('当前剧情已结束');button('返回菜单',menu)}
  schedule();
}
async function advance(){if(startupFlow?.blocksActions||!started||frontendOperation||readSaveOperation||galleryBusy||document.body.dataset.busy==='true'||vm.busy||vm.fault||panel.open)return;clearTimeout(timer);try{await run(()=>vm.advance())}catch(e){error(e)}}
function resume(){if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy)return;panel.close();display({type:vm.state.choices.length?'choice':'message',choices:vm.state.choices,name:vm.state.name,text:vm.state.message})}
function requireNativeProfile(){if(!globalFlags||needsNativeProfile(globalFlags.read()))throw new Error('请先完成首次姓名、生日与角色设置');}
async function begin(id){
  requireNativeProfile();
  if(gallerySession)await closeGallery('none');
  startupFlow?.beginStory();startupPresentation?.clear();const numbers=storyInitialNumbers(globalFlags.read());
  setAuto(false);panel.close();media.clear();renderer.reset();started=true;delete document.body.dataset.lastError;
  await run(()=>vm.start(id,{initial:nativeProfileLaunchInitial(settings,numbers),mode:'story'}));
}
function compatibility(){show('兼容性记录');paragraph(`剧本：${Object.keys(manifest?.scenes??{}).length} 个。已转换资源：${Object.keys(renderer?.assets??{}).length} 项。`);paragraph(assetReport?.completeAssets?'主资源转换已通过完整性检查；原引擎效果、剧情兼容和 iPad / iPhone 运行仍需验证。':'主资源转换和原引擎兼容尚未通过全部验证。');for(const warning of renderer?.warnings??[])paragraph(warning);for(const event of vm?.compatibilityEvents??[])if(event.kind==='native-call-load-failed')paragraph(`原版兼容处理：未载入子剧本 ${event.target}，继续调用处后续剧情。未执行该子剧本；位置 ${event.scene}:${event.index}。`);if(vm?.fault)paragraph(JSON.stringify(vm.fault,null,2));button('返回菜单',menu)}
function menu(){
  if(startupFlow?.blocksActions)return;
  if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy)return;
  if(started&&!vm.state.ended&&!vm.fault&&!renderer.messageWindow.enabled(4))return resume();
  if(needsNativeProfile(globalFlags.read()))return nativeProfile(true);
  if(gallerySession)return closeGallery('menu');
  setAuto(false);show('甜蜜女友2＋');paragraph('iPad / iPhone 移植版');
  if(!assetReport?.completeAssets)paragraph('游戏资源不完整，请重新安装完整游戏包。');
  if(started&&!vm.fault&&!vm.state.ended)button('返回剧情',resume);
  button('开始游戏',()=>begin('01_yu01'));
  button('选择故事',()=>{show('选择故事');paragraph('新开局会重置当前剧情进度。请先存档。');for(const [id,label] of ROUTES)if(manifest.scenes[id])button(label,()=>begin(id));button('返回菜单',menu)});
  if(store.entries().some(entry=>entry.data))button('继续存档',()=>slots('load'));
  const extras=extraMenuEnabled(globalFlags.read(),{unlockAll:settings.extraUnlockAll});const replay=button('场景回想',()=>replayMenu());replay.disabled=!extras;const gallery=button('CG鉴赏',()=>galleryMenu());gallery.disabled=!extras;if(!extras)paragraph('完成一条故事路线后开放回想与鉴赏。');
  button('设置',configuration);button('查看兼容性记录',compatibility);
}


async function diagnosticSource(scene){
  requireNativeProfile();
  if(gallerySession)await closeGallery('none');
  setAuto(false);panel.close();media.clear();renderer.reset();started=false;delete document.body.dataset.lastError;
  document.body.dataset.sourceConsumptionStatus='running';
  try {
    let result;
    await run(async()=>{
      const mode=scene==='01_yuep'?'story':'replay',numbers=mode==='story'?storyInitialNumbers(globalFlags.read()):replayInitialNumbers(globalFlags.read());
      result=await consumeOriginalScene(vm,{scene,mode,initial:nativeProfileLaunchInitial(settings,numbers),onMessage:event=>{$('speaker').textContent=event.name;$('text').textContent=event.text;document.body.dataset.sourceConsumptionMessages=String(vm.state.history.length);}});
      return null;
    });
    document.body.dataset.sourceConsumptionResult=JSON.stringify(result);document.body.dataset.sourceConsumptionStatus='completed';
    media.clear();renderer.reset();started=false;
    show('独立原文消费已结束','diagnostic-source');paragraph(`入口 ${scene}；对白 ${result.messages.length}；实际指令 ${result.commands.length}；原文产生通关标志 ${result.clearFlag}、回想1标志 ${result.replay1Flag}。`);paragraph('这是从独立尾声/结束段入口开始的诊断，未从游戏开局走完路线。');button('返回原型菜单',menu);
  }catch(failure){document.body.dataset.sourceConsumptionStatus='failed';throw failure;}
}

function thumbnailButton(label,frame,handler,enabled=true){
  const b=button(label,handler);b.disabled=!enabled;b.style.cssText='display:inline-flex;flex-direction:column;align-items:center;margin:5px;max-width:220px';
  const image=new Image();image.src=renderer.url(frame.file);image.alt='';image.onerror=()=>{if(b.isConnected)error(new Error('鉴赏缩略图载入失败：'+frame.file))};image.style.cssText='display:block;width:100%;height:auto;order:-1';b.append(image);return b;
}
function replayMenu(group,page){
  const numbers=globalFlags.read();if(!extraMenuEnabled(numbers,{unlockAll:settings.extraUnlockAll}))throw new Error('场景回想尚未开放');
  group=group??Math.max(0,Math.min(3,Math.trunc(numbers[721]??0)));page=page??Math.max(0,Math.min(1,Math.trunc(numbers[720]??0)));
  show('场景回想','replay');
  for(const [index,name] of EXTRA_CHARACTERS.entries())button(name,()=>replayMenu(index,0));
  for(const entry of replayPage(replayCatalog,numbers,group,page,{unlockAll:settings.extraUnlockAll}))thumbnailButton(`${entry.character} · 回想 ${entry.ordinal}${entry.unlocked?'':'（未解锁）'}`,entry.unlocked?entry.thumbnail:entry.lockedThumbnail,()=>beginReplay(entry.id),entry.unlocked);
  button('第一页',()=>replayMenu(group,0));button('第二页',()=>replayMenu(group,1));button('返回菜单',menu);
}
async function beginReplay(id){
  requireNativeProfile();
  startupFlow?.adoptScenario('replay');startupPresentation?.clear();const initial=nativeProfileLaunchInitial(settings,replayInitialNumbers(globalFlags.read()));const launch=replayLaunch(replayCatalog,initial.numbers,id,initial.strings,{unlockAll:settings.extraUnlockAll});
  setAuto(false);panel.close();media.clear();renderer.reset();started=true;delete document.body.dataset.lastError;
  await run(()=>vm.start(launch.id,{initial:launch.initial,mode:launch.mode}));
}
function galleryMenu(group=0,page=0){
  const numbers=globalFlags.read();if(!extraMenuEnabled(numbers,{unlockAll:settings.extraUnlockAll}))throw new Error('CG鉴赏尚未开放');
  show('CG鉴赏','gallery');for(const [index,name]of EXTRA_CHARACTERS.entries())button(name,()=>galleryMenu(index,0));
  const entries=cgRegistry.gallery(numbers,{unlockAll:settings.extraUnlockAll}).filter(entry=>entry.group===group&&entry.page===page);
  for(const entry of entries){const id=entry.unlocked?1000+100*entry.group+entry.ordinal-1:0,frame=renderer.imageFrame('ex_cgmode_thumbnail',id);thumbnailButton(`${EXTRA_CHARACTERS[group]} · CG ${entry.ordinal}${entry.unlocked?'':'（未解锁）'}`,frame,()=>openGallery(entry.index,group,page),entry.unlocked);}
  const pages=group===3?3:2;for(let index=0;index<pages;index++)button(`第${index+1}页`,()=>galleryMenu(group,index));button('返回菜单',menu);
}

async function galleryTask(task){
  if(galleryBusy)return;galleryBusy=true;const controls=[...document.querySelectorAll('#toolbar button,#advance,#panel-content button')].map(button=>({button,disabled:button.disabled}));for(const {button}of controls)button.disabled=true;document.body.dataset.galleryBusy='true';
  try{return await task()}finally{galleryBusy=false;delete document.body.dataset.galleryBusy;for(const {button,disabled}of controls)if(button.isConnected)button.disabled=disabled;}
}
async function openGallery(index,group,page){
  if(gallerySession||galleryBusy)return;
  const entry=cgRegistry.gallery(globalFlags.read(),{unlockAll:settings.extraUnlockAll})[index];if(!entry?.unlocked)throw new Error('此CG尚未登记');
  return galleryTask(async()=>{
    const session={entry,group,page,index:0,render:media.snapshot(renderer.snapshot()),storyStarted:started};gallerySession=session;
    setAuto(false);panel.close();media.clear();renderer.reset();started=false;
    try{await drawGallery()}catch(failure){
      try{media.clear();renderer.reset();await renderer.restore(session.render);started=session.storyStarted;gallerySession=null;}catch(restoreFailure){throw new AggregateError([failure,restoreFailure],'CG载入失败，恢复原剧情画面也失败')}
      throw failure;
    }
  });
}
async function drawGallery(){
  const session=gallerySession;if(!session)throw new Error('CG鉴赏没有当前图像');
  const specification=session.entry.variants[session.index];const state={numbers:{},strings:{}};
  await renderer.command('bg','0 $ff000000',state);await renderer.command('bg','0 disp 1',state);
  await renderer.command('cg',`0 ${specification}`,state);await renderer.command('cg',`0 scale ${session.entry.index===19?63:84} ${session.entry.index===19?63:84}`,state);await renderer.command('cg','0 pos 0 0',state);await renderer.command('cg','0 disp 1',state);
  document.getElementById('dialogue').hidden=true;
  show(`${EXTRA_CHARACTERS[session.group]} · CG ${session.entry.ordinal} · 差分 ${session.index+1}/${session.entry.variants.length}`,'gallery-view');
  button('上一差分',()=>galleryTask(async()=>{if(session.index===0)return finishGallery();const old=session.index;session.index--;try{await drawGallery()}catch(failure){session.index=old;throw failure;}}));
  button('下一差分',()=>galleryTask(async()=>{if(session.index+1===session.entry.variants.length)return finishGallery();const old=session.index;session.index++;try{await drawGallery()}catch(failure){session.index=old;throw failure;}}));
  button('返回CG鉴赏',closeGallery);
}
async function finishGallery(destination='gallery'){
  const session=gallerySession;if(!session)return;media.clear();renderer.reset();await renderer.restore(session.render);started=session.storyStarted;gallerySession=null;
  if(destination==='menu')menu();else if(destination==='gallery')galleryMenu(session.group,session.page);
}
async function closeGallery(destination='gallery'){return galleryTask(()=>finishGallery(destination))}

function slots(mode){
  if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy)return;
  requireNativeProfile();
  setAuto(false);if(mode==='save'&&(!started||vm.busy||vm.fault)){show('当前无法存档');paragraph('请在一段对白或选项出现后存档。');return;}
  show(mode==='save'?'选择存档位置':'选择读取的存档','slots');
  for(const {slot,data,error:problem} of store.entries()){
    const summary=problem?'损坏的存档':data?`${new Date(data.date).toLocaleString('zh-CN')} · ${data.script?.state?.stack?.at(-1)?.id??'结束'}\n${data.script?.state?.message?.slice(0,48)??''}`:'空';
    const b=button(`${slot+1}. ${summary}`,()=>mode==='save'?writeSave(slot):readSave(slot));b.className='save-slot';if(mode==='load'&&(!data||problem))b.disabled=true;
  }
  if(started&&!vm.fault&&!vm.state.ended)button('返回剧情',resume);
}
function writeSave(slot){if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy)return;store.write(slot,{script:vm.snapshot(),layers:media.snapshot(renderer.snapshot())});show('已存档');paragraph(`进度已保存在此设备的 ${slot+1} 号存档。`);button('返回剧情',resume)}
async function readSave(slot){
  if(readSaveOperation||frontendOperation||galleryBusy||vm?.busy)return;
  readSaveOperation=true;
  try{
  applySourceSystemButtons();$('advance').disabled=true;
  requireNativeProfile();
  if(gallerySession)await closeGallery('none');
  const data=store.read(slot);if(!data)throw new Error('此位置没有存档');
  // Validate both halves before mutating the running scene.
  const state=await vm.validateSave(data.script);renderer.validateSave(data.layers);
  cgRegistry.migrateObservedSave(state.unlockedCG);
  const script={...data.script,state:{...state,numbers:nativeProfileRestoreNumbers(globalFlags.mergeReplayUnlocks(state.numbers),globalFlags.read())}};
  setAuto(false);panel.close();media.clear();loading('正在恢复存档…');
  try{await run(async()=>{await renderer.restore(data.layers);const event=await vm.restore(script);startupFlow?.adoptScenario(vm.state.executionMode);started=true;return event});delete document.body.dataset.lastError}finally{loading('')}
  }finally{readSaveOperation=false;applySourceSystemButtons();$('advance').disabled=document.body.dataset.busy==='true';}
}
function configuration(){
  if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy)return;
  setAuto(false);show('设置');
  for(const [key,label] of [['bgm','音乐'],['voice','语音'],['se','音效'],['movie','影片']]){
    const row=document.createElement('label');row.className='setting-row';row.textContent=label;
    const input=document.createElement('input');input.type='range';input.min='0';input.max='100';input.value=String(settings[key]*100);input.ariaLabel=label+'音量';
    input.oninput=()=>{settings[key]=Number(input.value)/100;renderer.setSettings(settings);persistSettings()};row.append(input);content.append(row);
  }
  button(settings.muted?'恢复声音':'静音',()=>{settings.muted=!settings.muted;renderer.setSettings(settings);persistSettings();configuration()});
  const row=document.createElement('label');row.className='setting-row';row.textContent='自动阅读间隔';const delay=document.createElement('input');delay.type='range';delay.min='1000';delay.max='10000';delay.step='500';delay.value=String(settings.autoDelay);delay.oninput=()=>{settings.autoDelay=Number(delay.value);persistSettings()};row.append(delay);content.append(row);
  const unlockRow=document.createElement('label');unlockRow.className='setting-row';unlockRow.textContent='解锁全部回想与 CG';const unlock=document.createElement('input');unlock.id='unlock-all-extras';unlock.type='checkbox';unlock.setAttribute('role','switch');unlock.style.cssText='width:22px;height:22px';unlock.checked=settings.extraUnlockAll;unlock.ariaLabel='解锁全部回想与 CG';
  unlock.onchange=async()=>{if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy){unlock.checked=settings.extraUnlockAll;return;}unlock.disabled=true;try{settings=writeExtraUnlockAllSetting(localStorage,settings,unlock.checked);if(gallerySession)await closeGallery('none');configuration();}catch(reason){unlock.checked=settings.extraUnlockAll;error(reason)}finally{unlock.disabled=false}};unlockRow.append(unlock);content.append(unlockRow);paragraph('开启可查看全部场景回想和 CG；关闭后按游玩进度开放。');
  nativeImagePreferences();
  button('更改姓名、生日与陪伴角色',()=>nativeProfile(false));
  paragraph('主角姓名应用于下一次新开局；读档会恢复存档中的姓名。');
  button('返回菜单',menu);
}

function nativeProfile(firstRun=false){
  firstRun=firstRun||needsNativeProfile(globalFlags.read());
  profileDraft=createNativeProfileDraft(settings,{firstRun});profileNamePage();
}
function profilePage(title){show(title,profileDraft.firstRun?'profile-first':'profile-edit');if(profileDraft.firstRun)paragraph('首次启动请确认姓名、生日，以及想一起庆祝生日的角色。');}
function profileNamePage(){
  profilePage('主角姓名');const inputs={};
  for(const [key,label]of [['familyName','姓'],['firstName','名']]){const row=document.createElement('label');row.className='setting-row';row.textContent=label;const input=document.createElement('input');input.type='text';input.maxLength=20;input.value=profileDraft[key];input.ariaLabel=label;inputs[key]=input;row.append(input);content.append(row);}
  button('确认姓名',()=>{const proposed=confirmNativeProfileName(profileDraft,inputs.familyName.value,inputs.firstName.value);profilePage('确认姓名');paragraph(`主角姓名：${proposed.familyName} ${proposed.firstName}`);button('是，使用这个姓名',()=>{profileDraft=proposed;profileBirthdayPage();});button('否，重新输入',()=>{profileDraft={...profileDraft,familyName:inputs.familyName.value,firstName:inputs.firstName.value};profileNamePage();});});
  if(!profileDraft.firstRun)button('取消修改',()=>{profileDraft=null;configuration();});
}
function profileBirthdayPage(){
  profilePage('主角生日');const month=document.createElement('select'),day=document.createElement('select');month.ariaLabel='生日月份';day.ariaLabel='生日日期';
  for(let value=1;value<=12;value++){const option=document.createElement('option');option.value=String(value);option.textContent=`${value}月`;month.append(option);}month.value=String(profileDraft.month);
  const days=()=>{const previous=Number(day.value)||profileDraft.day;day.replaceChildren();for(let value=1;value<=birthdayDays(Number(month.value));value++){const option=document.createElement('option');option.value=String(value);option.textContent=`${value}日`;day.append(option);}day.value=String(Math.min(previous,birthdayDays(Number(month.value))));};days();month.onchange=days;content.append(month,day);
  button('确认生日',()=>{const selected=confirmNativeProfileBirthday(profileDraft,Number(month.value),Number(day.value),false);profilePage('确认生日');paragraph(`生日：${selected.month}月${selected.day}日`);button('是，使用这个生日',()=>{profileDraft=confirmNativeProfileBirthday(selected,selected.month,selected.day,true);profileHeroinePage();});button('否，重新选择',()=>{profileDraft=selected;profileBirthdayPage();});});
  if(!profileDraft.firstRun)button('取消修改',()=>{profileDraft=null;configuration();});
}
function profileHeroinePage(){
  const page=profileDraft;
  profilePage('想和谁一起庆祝生日？');paragraph('请选择陪伴生日的角色。');
  for(const heroine of PROFILE_HEROINES)button(heroine.name,async()=>{
    if(profileDraft!==page)return;
    const completed=selectNativeProfileHeroine(profileDraft,heroine.id),result=persistNativeProfileCompletion(localStorage,globalFlags,globalFlags.read(),settings,completed);
    settings=result.settings;for(const flag of [865,866,725,849])vm.state.numbers[flag]=result.numbers[flag];if(!started){vm.state.numbers[127]=result.numbers[127];vm.state.numbers[738]=result.numbers[738];Object.assign(vm.state.strings,result.strings);}profileDraft=null;if(startupFlow?.phase==='profile')await startupFlow.profileCompleted();else menu();
  });
  if(!profileDraft.firstRun)button('取消修改',()=>{profileDraft=null;configuration();});
}
function nativeImagePreference(flag,value){const next=setNativeImagePreference(globalFlags.read(),flag,value);globalFlags.write(next);vm.state.numbers[flag]=value;configuration();}
function nativeImagePreferences(){
  const numbers=globalFlags.read();
  for(const [flag,label]of [[530,'显示体毛'],[532,'爱心眼']]){const row=document.createElement('label');row.className='setting-row';row.textContent=label;const input=document.createElement('input');input.type='checkbox';input.checked=numbers[flag]===1;input.ariaLabel=label;input.onchange=()=>{try{nativeImagePreference(flag,input.checked?1:0)}catch(reason){error(reason)}};row.append(input);content.append(row);}
  paragraph('显示模式');for(const mode of NATIVE_DISPLAY_MODES){const selected=numbers[724]===mode.id;const b=thumbnailButton(mode.label+(selected?'（已选择）':''),renderer.imageFrame('sys_title_naked',mode.frame),()=>nativeImagePreference(724,mode.id));b.ariaPressed=String(selected);}
  button('恢复图像偏好默认',()=>{const next=resetNativeImagePreferences(globalFlags.read());globalFlags.write(next);vm.state.numbers[530]=0;vm.state.numbers[532]=1;configuration();});
}

function persistSettings(){try{localStorage.setItem('amakano2plus-settings-v1',JSON.stringify(settings))}catch(reason){error(reason)}}
function resize(){const scale=Math.min(innerWidth/1600,innerHeight/900);$('stage').style.transform=`translate(-50%,-50%) scale(${scale})`}
resize();addEventListener('resize',resize);
bindMessageTextAdvance($('text'),advance);
$('advance').onclick=advance;$('menu').onclick=()=>{if(renderer.messageWindow.enabled(4)&&vm&&!vm.busy)Promise.resolve().then(menu).catch(error)};$('save').onclick=()=>{try{slots('save')}catch(reason){error(reason)}};$('load').onclick=()=>{try{slots('load')}catch(reason){error(reason)}};
$('close-panel').onclick=()=>{if(gallerySession)closeGallery().catch(error);else panel.close()};panel.addEventListener('cancel',event=>{if(panelMode==='choice'||panelMode==='profile-first')event.preventDefault();if(gallerySession){event.preventDefault();closeGallery().catch(error)}});panel.addEventListener('close',schedule);
$('history').onclick=()=>{if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy||!renderer.messageWindow.enabled(2))return;setAuto(false);show('对白回看');for(const entry of vm?.state.history??[]){const div=document.createElement('div');div.className='entry';const name=document.createElement('strong');name.textContent=entry.name;div.append(name,document.createTextNode(entry.text));content.append(div)}};
$('auto').onclick=()=>{if(frontendOperation||readSaveOperation||galleryBusy||vm?.busy)return;setAuto(!auto);if(auto)advance()};$('settings').onclick=configuration;
addEventListener('keydown',event=>{if((event.key===' '||event.key==='Enter')&&!event.repeat&&!event.target.closest?.('button,input,textarea,dialog')){event.preventDefault();advance()}});
// This visibility mapping is a port lifecycle policy, separate from original Windows UI pause.
addEventListener('visibilitychange',()=>{startupPresentation?.setPaused(document.hidden);renderer?.setNativeTransitionPaused(document.hidden);if(document.hidden){setAuto(false);media?.suspend()}else media?.resume()});
try {
  const read=async file=>{const r=await fetch(new URL(file.split('/').map(encodeURIComponent).join('/'),root));if(!r.ok)throw new Error(`未找到游戏数据：${file}`);return r.json()};
  const [m,helpers,profiles,assets,vram,voiceMetadata]=await Promise.all(['manifest.json','helpers.json','profiles.json','assets.json','vram.json','voice-metadata.json'].map(read));manifest=m;
  try{assetReport=await read('asset-report.json')}catch{assetReport=null}
  const readRuntime=async file=>{const response=await fetch(new URL(file,location.href));if(!response.ok)throw new Error('未找到运行数据：'+file);return response.json()};
  const [nativeCharacterLayouts,nativeMasks]=await Promise.all(['character-layouts.json','native-masks.json'].map(readRuntime));
  const nativeTransitionClock=new PortOwnSaveFrameClock({fps:60,millisecondSource:()=>visibleGameMilliseconds.read()});
  const sourceCharacterResources=await loadSourceCharacterResources({contentRoot:new URL('../',location.href)});
  const extraResponse=await fetch(new URL('extra-mode-data.json',location.href));if(!extraResponse.ok)throw new Error('未找到原版鉴赏清单');extraModeData=await extraResponse.json();
  replayCatalog=createReplayCatalog(helpers,assets,manifest);cgRegistry=new CGRegistrationStore(localStorage,{...extraModeData,shouldRegisterImage:()=>!gallerySession});cgRegistry.read();
  store=new SaveStore(localStorage);globalFlags=new GlobalFlagStore(localStorage);const startupNumbers=nativeStartupNumbers(globalFlags.read());globalFlags.write(startupNumbers);settings=readSettings(localStorage);
  renderer=new Renderer({root,profiles,assets,vram,voiceMetadata,loading,cgRegistry,nativeCharacterTransforms:true,nativeCharacterLayouts,nativeMasks,nativeMaskRoot:new URL('../',location.href),nativeTransitionClock,nativeOptionalFaceLayers:true,nativeExplicitSEAbsenceCompatibility:true,sourceNeutralResets:true,sourceNeutralGlobalControls:true,sourceM2IntMotionReplay:true,sourceCaptureEffects:true,sourceBitmapSepia:true,portMplSepia:true,sourcePlaceTask:true,sourceUsedPlaneRotations:true,sourceUsedPlaneRotationPolicy:'port-used-plane-cardinal-world-pivot-2d-v1',sourcePlaneImageMasks:true,sourceBmode:true,sourceBmodePolicy:'opaque-source-mode-1-5-coverage-alpha-v1',nativePositionMotions:true,nativeFadeMotions:true,sourceNativePlaneDimensions:true,nativeCalculatorCurrent:new NativeCalculatorCurrent(),nativeCalculatorCommandEffects:true,nativeMotionClock:nativeTransitionClock,portNativeMotionOwner:true,nativeMotionSharedSnapshot:withSharedSourceSnapshot,nativeMotionOwnerOnError:error,portPlaneZProjection:true,...additionalMotionOptions,...sourceCharacterResources,sourceCharacterPerformance:true,sourceVoiceSlotAdapter:true,automaticSourceVoicePerformance:true,sourceSharedSoundCursor:true,sourceSharedSoundCursorPolicy:'port-own-load-reset-save-v1',sourceEmptyFlowAbsencePolicy:'source-empty-flow-preserve-initial-base',sourcePerformanceClock:nativeTransitionClock,sourceImageAnimations:true,sourceImageClock:nativeTransitionClock,portMovieLifecycle:true,sourceMoviePolicy:true,sourceMovieState:()=>vm?.state,onSourceMoviePolicySettled:()=>media.report(),onMediaBlocked:(channel,element)=>media.blocked(channel,element),onSystemState:applySourceSystemButtons,onCommand:(cmd,args)=>{if(cmd==='auto'&&args==='off')setAuto(false)}});renderer.setSettings(settings);await renderer.initializeMessageWindow();
  media=new MediaLifecycle({audio:renderer.audio,hidden:document.hidden,onRecovery:audioRecovery});
  vm=new ScriptVM({systemConfig:SYSTEM_CONFIG,helpers,initial:nativeProfileLaunchInitial(settings,startupNumbers),registerCG:(command,request)=>cgRegistry.register(command,request),loadScene:createCatalogSceneLoader(manifest,entry=>read('scenes/'+entry.file)),nativeCallAbsenceCompatibility:true,onNativePump:async current=>{await media.waitUntilVisible();return renderer.prepareNativePump(current)},adapter:(cmd,args,state,commandLocation)=>media.command(renderer,cmd,args,state,commandLocation)});
  startupPresentation=createSourceStartupPresentation(renderer,nativeTransitionClock,{hidden:document.hidden,onError:error});
  startupFlow=new SourceStartupController({vm,presentation:startupPresentation,commitState:state=>globalFlags.write(state.numbers),
    launchScene:async(scene,initial)=>{setAuto(false);panel.close();media.clear();renderer.reset();started=true;await run(()=>vm.start(scene,{initial,mode:'story'}));},
    showProfile:()=>nativeProfile(true),showTitle:()=>{startupPresentation.hide();started=false;menu();},
    onPhase:phase=>{document.body.dataset.sourceStartupPhase=phase;applySourceSystemButtons();}});
  loading('');document.body.dataset.ready='true';await startupFlow.start();
}catch(e){error(e)}
