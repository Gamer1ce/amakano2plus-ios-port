import {restoreTransactionFromOptions,assertRestoreActive,ownRestoreResource,discardRestoreImage,bindPreparedRestoreMedia,assertPreparedRestoreMedia,transferPreparedRestoreMedia} from './restore-transaction.js';
import {Renderer as ExtraRenderer} from './extra-mode-renderer.js';
import {argumentsOf,numericArgument} from './expressions.js';
import {MESSAGE_WINDOW_SOURCE} from './message-window-data.js';

const sameFrame=(frame,expected)=>['id','file','width','height','totalWidth','totalHeight','x','y','baseX','baseY'].every(key=>frame?.[key]===expected[key]);
// Port presentation: source HG3 plate sits behind actors; source coordinates and text remain exact.
export const MESSAGE_BACKGROUND_PORT_LAYOUT=Object.freeze({priority:2500,opacity:.55});
// Exact source-used hard letterbox assets, corrected only in the port paint order.
export const MESSAGE_SCENE_BORDER_PORT_LAYOUT=Object.freeze({assets:Object.freeze(['bgeffect01','bgeffect03']),sourceGroup:'eg',firstBank:0,lastBank:5,sourceBasePriority:5000,paintBasePriority:2400,frameId:0});
const messageSceneBorderAssets=new Set(MESSAGE_SCENE_BORDER_PORT_LAYOUT.assets);
export function messageScenePaintPriority(layer){
  const priority=Number(layer.priority),id=Number(layer.id),layout=MESSAGE_SCENE_BORDER_PORT_LAYOUT;
  return layer.group===layout.sourceGroup&&messageSceneBorderAssets.has(layer.asset)&&!layer.player&&!layer.color&&!layer.composite&&Number(layer.frame?.id)===layout.frameId&&Number.isSafeInteger(id)&&id>=layout.firstBank&&id<=layout.lastBank&&priority===layout.sourceBasePriority+id?layout.paintBasePriority+id:priority;
}
const defaultState=()=>({version:1,theme:'default',keyskip:'on',controls:Array(17).fill(true),frameOff:false});
export function validateMessageWindowState(value){
  if(value===undefined)return defaultState();
  if(value?.version!==1||typeof value.theme!=='string'||!Object.hasOwn(MESSAGE_WINDOW_SOURCE.definitions,value.theme)||!['on','off','ctrl'].includes(value.keyskip)||!Array.isArray(value.controls)||value.controls.length!==17||value.controls.some(item=>typeof item!=='boolean')||typeof value.frameOff!=='boolean')throw new Error('Invalid saved message-window state');
  return {version:1,theme:value.theme,keyskip:value.keyskip,controls:[...value.controls],frameOff:value.frameOff};
}
export class NativeMessageWindow {
  constructor(renderer,{onSystemState=()=>{},visibilityObserverFactory=callback=>new MutationObserver(callback)}={}){if(typeof visibilityObserverFactory!=='function')throw new Error('Invalid message visibility observer factory');this.renderer=renderer;this.state=defaultState();this.prepared=new Map();this.pending=new Map();this.onSystemState=onSystemState;this.visibilityObserverFactory=visibilityObserverFactory;this.visibilityObserver=null;this.fade=null;this.backgroundFade=null;this.themeSerial=0;}
  enabled(code){return this.state.controls[code]===true;}
  publish(){document.body.dataset.messageWindowTheme=this.state.theme;document.body.dataset.keyskip=this.state.keyskip;this.onSystemState(this.snapshot());}
  async prepareTheme(theme,...rest){
    const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
    const definition=MESSAGE_WINDOW_SOURCE.definitions[theme];if(!definition)throw new Error(`Unsupported message window ${theme}`);
    if(this.prepared.has(theme))return this.prepared.get(theme);
    if(this.pending.has(theme)){const prepared=await this.pending.get(theme);assertRestoreActive(transaction);return prepared;}
    let pending;pending=(async()=>{
      let owner;try{
      const frames=Object.fromEntries([1,10,11,50].map(id=>{const frame=this.renderer.imageFrame(definition.image,id);if(!sameFrame(frame,definition.frames[id]))throw new Error(`Original message-window metadata mismatch ${theme}:${id}`);return [id,frame];}));
      const image=new Image();if(transaction)owner=ownRestoreResource(transaction,()=>{discardRestoreImage(image);if(this.pending.get(theme)===pending)this.pending.delete(theme);if(this.prepared.get(theme)?.image===image)this.prepared.delete(theme)});image.src=this.renderer.url(frames[1].file);await image.decode();assertRestoreActive(transaction);
      if(image.naturalWidth!==frames[1].width||image.naturalHeight!==frames[1].height)throw new Error(`Message-window image dimensions mismatch ${theme}`);
      const prepared=bindPreparedRestoreMedia({definition,frames,image},transaction,owner?[owner]:[]);this.prepared.set(theme,prepared);return prepared;
      }catch(error){owner?.release();assertRestoreActive(transaction);throw error}
    })();this.pending.set(theme,pending);
    try{return await pending;}finally{if(this.pending.get(theme)===pending)this.pending.delete(theme);}
  }
  clearText(){const speaker=document.getElementById('speaker'),text=document.getElementById('text');speaker.textContent='';text.textContent='';text.scrollTop=0;}
  syncBackgroundVisibility(){const window=document.getElementById('dialogue');if(this.background&&window)this.background.hidden=window.hidden;}
  presentationLayers(){const element=this.background,window=document.getElementById('dialogue');return element&&!element.hidden&&window&&!window.hidden?[{element,group:'message-presentation',id:'background',priority:MESSAGE_BACKGROUND_PORT_LAYOUT.priority,presentationCompositeOperation:'source-atop'}]:[];}
  installTheme(prepared){
    assertPreparedRestoreMedia(prepared);
    const {definition,frames,image}=prepared,window=document.getElementById('dialogue'),speaker=document.getElementById('speaker'),text=document.getElementById('text'),indicator=document.getElementById('indicator');
    const layers=document.getElementById('layers');if(!window||!speaker||!text||!indicator||!layers)throw new Error('Missing message-window DOM');
    if(!this.visibilityObserver){this.visibilityObserver=this.visibilityObserverFactory(()=>this.syncBackgroundVisibility());if(typeof this.visibilityObserver?.observe!=='function')throw new Error('Invalid message visibility observer');this.visibilityObserver.observe(window,{attributes:true,attributeFilter:['hidden']});}
    this.background?.remove();this.background=image;image.id='message-window-background';image.alt='';image.setAttribute('aria-hidden','true');image.style.cssText=`position:absolute;left:${MESSAGE_WINDOW_SOURCE.portOrigin.x+frames[1].x}px;top:${MESSAGE_WINDOW_SOURCE.portOrigin.y+frames[1].y}px;width:${frames[1].width}px;height:${frames[1].height}px;pointer-events:none;z-index:${MESSAGE_BACKGROUND_PORT_LAYOUT.priority};opacity:${MESSAGE_BACKGROUND_PORT_LAYOUT.opacity}`;
    layers.append(image);this.syncBackgroundVisibility();
    // The crop/rectangles come from original FES HG3 IDs. The fixed origin and
    // browser text layout are a port layout, pending original Windows captures.
    window.style.cssText=`position:absolute;left:${MESSAGE_WINDOW_SOURCE.portOrigin.x}px;top:${MESSAGE_WINDOW_SOURCE.portOrigin.y}px;width:${definition.canvasWidth}px;height:${definition.canvasHeight}px;right:auto;bottom:auto;min-height:0;padding:0;background:none;border:0;border-radius:0;box-shadow:none;pointer-events:none`;
    const rectangle=(element,frame)=>{element.style.cssText=`position:absolute;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;margin:0;min-height:0;z-index:1;overflow:hidden;white-space:pre-wrap`};
    rectangle(speaker,frames[11]);speaker.style.fontSize='33px';speaker.style.fontWeight='400';speaker.style.color='#fff';speaker.style.textShadow='-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000';
    rectangle(text,frames[10]);text.style.overflowY='auto';text.style.pointerEvents='auto';text.tabIndex=0;text.style.paddingTop='13px';text.style.paddingRight='60px';text.style.fontSize='29px';text.style.lineHeight='1.45';text.style.letterSpacing='0';text.style.color='#fff';text.style.textShadow='-1px -1px 0 #353547,1px -1px 0 #353547,-1px 1px 0 #353547,1px 1px 0 #353547';
    indicator.style.cssText=`position:absolute;left:${frames[50].x}px;top:${frames[50].y}px;right:auto;bottom:auto;width:${frames[50].width}px;height:${frames[50].height}px;z-index:1;color:#fff`;
    transferPreparedRestoreMedia(prepared);
  }
  async initialize(){const prepared=await this.prepareTheme('default');this.installTheme(prepared);this.publish();}
  async view(args,state){
    const parts=argumentsOf(args);if(parts.length>2)throw new Error('Unsupported history-window view definition');
    const type=numericArgument(parts[0]??'0',state);if(![0,1].includes(type))throw new Error('Invalid message-window transition type');
    const theme=(parts[1]??'default').toLowerCase();if(!Object.hasOwn(MESSAGE_WINDOW_SOURCE.definitions,theme))throw new Error(`Unsupported message window ${theme}`);
    const serial=++this.themeSerial,prepared=await this.prepareTheme(theme);if(serial!==this.themeSerial)return;
    const hadFrameFade=!!this.fade;this.cancelFade();if(hadFrameFade)document.getElementById('dialogue').hidden=this.state.frameOff;this.installTheme(prepared);this.state.theme=theme;state.strings??={};state.strings[801]=theme;
    if(type===0)this.renderer.warn('消息窗口主题已切换；原版 view 交叉淡化尚未校准');this.publish();
  }
  system(args,state){
    const parts=argumentsOf(args);if(parts.length>2)throw new Error('Invalid system-button arguments');
    if(!parts.length)this.state.controls.fill(true);
    else{const code=numericArgument(parts[0],state);if(!Number.isSafeInteger(code)||code<0||code>=17)throw new Error('Invalid native message-system control');const value=numericArgument(parts[1]??'1',state);this.state.controls[code]=value!==0;}
    this.publish();
  }
  keyskip(args){const parts=argumentsOf(args);if(parts.length>1||!['on','off','ctrl'].includes(parts[0]??'on'))throw new Error('Invalid keyskip mode');this.state.keyskip=parts[0]??'on';this.publish();}
  cancelFade(){if(this.fade){this.fade.cancel();this.fade=null;}if(this.backgroundFade){this.backgroundFade.cancel();this.backgroundFade=null;}document.getElementById('dialogue').style.opacity='';if(this.background)this.background.style.opacity=String(MESSAGE_BACKGROUND_PORT_LAYOUT.opacity);this.syncBackgroundVisibility();}
  frame(command,args,state){
    const parts=argumentsOf(args);if(parts.length&&parts[0]!=='fade'||parts.length>2)throw new Error('Invalid message-window frame command');
    const window=document.getElementById('dialogue'),hide=command==='frameoff';
    const duration=parts.length?this.renderer.frames(parts[1]??'30',state):0;if(!Number.isFinite(duration)||duration<0)throw new Error('Invalid message-window fade duration');
    this.cancelFade();this.state.frameOff=hide;
    if(!parts.length){window.hidden=hide;this.syncBackgroundVisibility();return;}
    if(!duration){window.hidden=hide;this.syncBackgroundVisibility();return;}
    window.hidden=false;this.syncBackgroundVisibility();const animation=window.animate(hide?[{opacity:1},{opacity:0}]:[{opacity:0},{opacity:1}],{duration,easing:'linear'});this.fade=animation;
    const opacity=MESSAGE_BACKGROUND_PORT_LAYOUT.opacity,backgroundAnimation=this.background?.animate(hide?[{opacity},{opacity:0}]:[{opacity:0},{opacity}],{duration,easing:'linear'});this.backgroundFade=backgroundAnimation??null;
    let completed=false;
    const finished=Promise.all([animation.finished,...(backgroundAnimation?[backgroundAnimation.finished]:[])]).then(()=>{completed=true;},error=>{if(error?.name!=='AbortError')throw error;}).finally(()=>{
      this.renderer.animations.delete(finished);
      if(this.fade===animation){this.fade=null;this.backgroundFade=null;if(completed)window.hidden=hide;window.style.opacity='';this.syncBackgroundVisibility();}
    });this.renderer.animations.add(finished);
  }
  onMessage(){document.getElementById('text').scrollTop=0;if(this.state.frameOff){this.cancelFade();this.state.frameOff=false;document.getElementById('dialogue').hidden=false;}this.syncBackgroundVisibility();}
  reset(){++this.themeSerial;this.cancelFade();this.state=defaultState();const prepared=this.prepared.get('default');if(prepared)this.installTheme(prepared);document.getElementById('dialogue').hidden=false;this.syncBackgroundVisibility();this.publish();}
  snapshot(){return {...this.state,controls:[...this.state.controls]};}
  async restore(value,...rest){const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);const state=validateMessageWindowState(value),prepared=await this.prepareTheme(state.theme,...rest);assertRestoreActive(transaction);this.cancelFade();this.installTheme(prepared);this.state=state;this.publish();assertRestoreActive(transaction);}
}
export class Renderer extends ExtraRenderer {
  constructor(options){super(options);this.messageWindow=new NativeMessageWindow(this,{onSystemState:options.onSystemState});}
  scenePaintPriority(layer){return messageScenePaintPriority(layer);}
  scenePresentationLayers(){return this.messageWindow?.presentationLayers()??[];}
  place(layer){super.place(layer);if(layer.element)layer.element.style.zIndex=String(this.scenePaintPriority(layer));}
  initializeMessageWindow(){return this.messageWindow.initialize();}
  async command(cmd,args,state,...rest){
    if(cmd==='initialize_header')this.messageWindow.clearText();
    if(cmd==='view')return this.messageWindow.view(args,state);
    if(cmd==='sysbtn')return this.messageWindow.system(args,state);
    if(cmd==='keyskip')return this.messageWindow.keyskip(args);
    if(cmd==='frameon'||cmd==='frameoff')return this.messageWindow.frame(cmd,args,state);
    return super.command(cmd,args,state,...rest);
  }
  reset(){this.messageWindow?.reset();return super.reset();}
  snapshot(){return {...super.snapshot(),messageWindow:this.messageWindow.snapshot()};}
  validateSave(saved){const data=super.validateSave(saved);validateMessageWindowState(data.messageWindow);return data;}
  async restore(saved,...rest){const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);const data=this.validateSave(saved,...rest),message=validateMessageWindowState(data.messageWindow);await this.messageWindow.prepareTheme(message.theme,...rest);assertRestoreActive(transaction);await super.restore(data,...rest);assertRestoreActive(transaction);await this.messageWindow.restore(message,...rest);assertRestoreActive(transaction);}
}

export function bindMessageTextAdvance(text,advance){
  if(!text||typeof advance!=='function')throw new Error('Invalid message-text input binding');
  let gesture=null;
  const moved=event=>{if(gesture&&(Math.abs(event.clientX-gesture.x)>8||Math.abs(event.clientY-gesture.y)>8||text.scrollTop!==gesture.scrollTop))gesture.moved=true;};
  const down=event=>{gesture=event.button===0&&event.isPrimary!==false?{x:event.clientX,y:event.clientY,scrollTop:text.scrollTop,moved:false}:null;};
  const cancel=()=>{if(gesture)gesture.moved=true;};
  const scroll=()=>{if(gesture&&text.scrollTop!==gesture.scrollTop)gesture.moved=true;};
  const click=()=>{const blocked=gesture?.moved===true;gesture=null;if(!blocked)return advance();};
  for(const [type,handler]of [['pointerdown',down],['pointermove',moved],['pointerup',moved],['pointercancel',cancel],['scroll',scroll],['click',click]])text.addEventListener(type,handler);
  return ()=>{for(const [type,handler]of [['pointerdown',down],['pointermove',moved],['pointerup',moved],['pointercancel',cancel],['scroll',scroll],['click',click]])text.removeEventListener(type,handler);gesture=null;};
}
