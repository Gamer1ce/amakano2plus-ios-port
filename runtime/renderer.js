import {restoreTransactionFromOptions,assertRestoreActive,restoreTransactionIsActive,ownRestoreResource,discardRestoreImage,bindPreparedRestoreMedia,assertPreparedRestoreMedia,transferPreparedRestoreMedia,releasePreparedRestoreMedia} from './restore-transaction.js';
import {argumentsOf,numericArgument} from './expressions.js';

// Read-only original KCS/native710/comma-loader proof binds these four names.
// This prototype is explicitly opt-in and never supplies an alias or fake image.
const NATIVE_OPTIONAL_FACE_ABSENCES=new Set(['fareix02b_0b','fareix02a_0c','fachit02_000000001','fasara02_000g']);
const sameStrings=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((value,index)=>value===b[index]);
const GROUPS=['bg','cg','pl','mpl','fg','eg','fw'];
const DEPTH={bg:0,cg:1000,pl:2000,mpl:3000,fg:4000,eg:5000,fw:6000};
export function compositeNames(values){return values.slice(1).flatMap((value,index)=>value&&value!=='0'?[`${values[0].toLowerCase()}_${'0'.repeat(index)}${value.toLowerCase()}`]:[])}
export function layerIds(source,state) {
  const ids=[];
  for(const part of source.replace(/^\[|\]$/g,'').split(',')) {
    const range=/^(\d+)-(\d+)$/.exec(part);
    if(range){const from=Number(range[1]),to=Number(range[2]);if(to<from||to-from>100)throw new Error(`Invalid bank range ${source}`);for(let id=from;id<=to;id++)ids.push(String(id));}
    else{const id=numericArgument(part,state);if(!Number.isInteger(id)||id<0||id>999)throw new Error(`Invalid bank selector ${source}`);ids.push(String(id));}
  }
  return ids;
}
// Original core1001ad50: only U+FF01..U+FF5E width fold, no NFKC/case/space aliases.
export function sourceM2TimelineLabel(value){
  if(typeof value!=='string')throw new Error('Invalid source m2intmot label');
  return value.replace(/[\uFF01-\uFF5E]/g,character=>String.fromCharCode(character.charCodeAt(0)-0xFEE0));
}
export class Renderer {
  static sourceRestoreTransactionVersion=1;
  constructor({root,assets,profiles,vram={},voiceMetadata={formatVersion:1,timeUnit:'milliseconds',voices:{}},loading=()=>{},onCommand=()=>{},nativeOptionalFaceLayers=false,sourceM2IntMotionReplay=false}) {
    if(typeof sourceM2IntMotionReplay!=='boolean')throw new Error('Invalid source m2intmot replay option');
    this.sourceM2IntMotionReplay=sourceM2IntMotionReplay;
    if(typeof nativeOptionalFaceLayers!=='boolean')throw new Error('Invalid native optional face compatibility option');
    this.nativeOptionalFaceLayers=nativeOptionalFaceLayers;this.compatibilityEvents=[];
    if(voiceMetadata?.formatVersion!==1||voiceMetadata.timeUnit!=='milliseconds'||!voiceMetadata.voices||Array.isArray(voiceMetadata.voices)||typeof voiceMetadata.voices!=='object')throw new Error('Invalid voice metadata format');
    this.root=root;this.assets=assets;this.profiles=profiles;this.vram=vram;this.voiceMetadata=voiceMetadata;this.loading=loading;this.onCommand=onCommand;
    this.layers=new Map();this.audio=new Map();this.audioState=new Map();this.soundAnimations=new Map();this.warnings=new Set();this.animations=new Set();
    this.settings={bgm:.35,voice:.8,se:.8,movie:.8,muted:false};
    EmotePlayer.createRenderCanvas(1600,900);
    this.warn('图层与角色坐标尚未与 Windows 原版画面对照校准');
  }
  url(file){return new URL(file.split('/').map(encodeURIComponent).join('/'),this.root).href}
  defaults(group,id){
    const name=group+String(id).padStart(2,'0'),config=(group==='pl'?this.vram.plane:group==='mpl'?this.vram.mpl:this.vram.image)?.[name]??{};
    return {group,id:String(id),x:config.pos?.x??0,y:config.pos?.y??0,sx:1,sy:1,opacity:1,visible:config.disp!==0,rotation:0,priority:DEPTH[group]+Number(id),baseX:config.base?.x??0,baseY:config.base?.y??0,shiftX:config.shift_x??0,shiftY:config.shift_y??0,planeId:config.pl??0};
  }
  bank(group,id){id=String(id);const key=`${group}:${id}`;if(!this.layers.has(key))this.layers.set(key,this.defaults(group,id));return this.layers.get(key)}
  initialize(layer){this.clear(layer);const {shiftX,shiftY}=layer;Object.assign(layer,this.defaults(layer.group,layer.id),{shiftX,shiftY});this.place(layer)}
  geometry(layer,value={}){
    const plane=this.bank('pl',layer.planeId),f=layer.frame;
    return {left:plane.x+(layer.shiftX+(value.x??layer.x)+(f.x-layer.baseX)*layer.sx-plane.baseX)*plane.sx,top:plane.y+(layer.shiftY+(value.y??layer.y)+(f.y-layer.baseY)*layer.sy-plane.baseY)*plane.sy,sx:layer.sx*plane.sx,sy:layer.sy*plane.sy,opacity:(value.opacity??layer.opacity)*plane.opacity,visible:layer.visible&&plane.visible};
  }
  place(layer){
    if(layer.group==='pl')for(const image of this.layers.values())if(image.group!=='pl'&&String(image.planeId)===layer.id)this.place(image);
    if(!layer.element)return;
    const el=layer.element;
    el.style.opacity=String(layer.opacity);el.style.display=layer.visible?'':'none';el.style.zIndex=String(layer.priority);
    el.style.filter=[layer.blur?`blur(${layer.blur}px)`:'',layer.mode==='sepia'?'sepia(1)':layer.mode==='gray'?'grayscale(1)':''].filter(Boolean).join(' ');
    if(layer.player){
      // The bank origin has not been compared with a Windows reference capture.
      const scale=layer.sx*.65;layer.player.scale=scale;
      layer.player.setCoord(layer.x-(this.vram.mpl?.[layer.group+layer.id.padStart(2,'0')]?.pos?.x??0),45-450-(layer.player.charaBounds.top??-1000)*scale);
      el.style.transform=`rotate(${layer.rotation}deg)`;
      this.warn('角色坐标使用预览布局，原引擎坐标待校准');return;
    }
    const f=layer.frame,g=this.geometry(layer);
    el.style.opacity=String(g.opacity);el.style.display=g.visible?'':'none';
    el.style.width=f.width+'px';el.style.height=f.height+'px';
    el.style.left=g.left+'px';el.style.top=g.top+'px';
    el.style.transformOrigin='0 0';el.style.transform=`scale(${g.sx},${g.sy}) rotate(${layer.rotation}deg)`;
  }
  applySourceM2Timeline(layer,requested){
    const canonical=sourceM2TimelineLabel(requested),player=layer.player;
    if(!player||!canonical)throw new Error('Source m2intmot requires an active character and nonempty label');
    // EXE484680 always stops old before Play(request,PARALLEL1); core map miss
    // starts nothing but source task metadata still retains the original request.
    player.mainTimelineLabel='';player.mainTimelineLabel=canonical;
    layer.sourceM2TimelineRequest=requested;layer.sourceM2TimelineCanonical=canonical;
    if(!player.mainTimelineLabels.some(label=>sourceM2TimelineLabel(label)===canonical))this.warn(`动作未找到 ${requested}`);
  }
  clear(layer){delete layer.sourceM2TimelineRequest;delete layer.sourceM2TimelineCanonical;this.stop(layer);if(layer.player){layer.player.destroy();layer.player=null}layer.element?.remove();layer.element=null;layer.asset=null;layer.color=null;layer.composite=null;layer.compositeRequest=null;layer.compositeMissing=null}
  stop(layer){for(const animation of [...layer.animations??[]])animation.cancel(true);layer.animations=[];}
  cancelCharacterPosition(layer){if(layer.player)for(const animation of [...layer.animations??[]])if(animation.keys?.includes('x'))animation.cancel();}
  reset(){for(const layer of this.layers.values())this.clear(layer);this.layers.clear();this.stopAudio();document.getElementById('dialogue').hidden=false;}
  stopSound(channel){this.soundAnimations.get(channel)?.cancel();const audio=this.audio.get(channel);if(audio){audio.pause();audio.removeAttribute?.('src');audio.load?.()}this.audio.delete(channel);this.audioState.delete(channel)}
  stopAudio(){for(const channel of this.audio.keys())this.stopSound(channel)}
  warn(message){this.warnings.add(message);document.body.dataset.compatibilityWarnings=String(this.warnings.size)}
  imageFrame(name,frameId){
    const asset=this.assets[name.toLowerCase()];if(!asset||asset.kind!=='image')throw new Error(`尚未转换图片资源：${name}`);
    // CatSystem scene loads select HG3 ID 0, independent of file storage order.
    const id=frameId===undefined?0:frameId,frame=asset.frames.find(f=>String(f.id)===String(id));
    if(!frame)throw new Error(`未找到图片差分：${name}:${id}`);return frame;
  }
  async image(layer,name,frameId,...rest){
    const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
    const frame=this.imageFrame(name,frameId),element=new Image(),owner=ownRestoreResource(transaction,()=>discardRestoreImage(element));
    try{
      element.src=this.url(frame.file);await element.decode();assertRestoreActive(transaction);
      if(transaction&&this.layers.get(layer.group+':'+layer.id)!==layer)throw new Error('Superseded restore image bank');
      this.clear(layer);layer.asset=name.toLowerCase();layer.frame=frame;layer.baseX=frame.baseX??0;layer.baseY=frame.baseY??0;layer.element=element;
      document.getElementById('layers').append(element);this.place(layer);owner.transfer();
    }catch(error){assertRestoreActive(transaction);throw error}finally{owner.release()}
  }
  fullyTransparentImage(image,frame){
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width!==frame.width||height!==frame.height)throw new Error(`透明差分图像尺寸不正确：${frame.file}`);
    const canvas=document.createElement('canvas');
    try{
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)throw new Error('无法创建 2D 像素检查');
      context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,width,height).data;
      if(pixels.length!==width*height*4)throw new Error('RGBA 像素长度不正确');
      for(let alpha=3;alpha<pixels.length;alpha+=4)if(pixels[alpha]!==0)return false;
      return true;
    }catch(error){throw new Error(`无法校验透明差分像素：${frame.file}：${error?.message??String(error)}`,{cause:error});}
    finally{canvas.width=0;canvas.height=0;}
  }
  compositePlan(layer,values,frameId){
    if(!Array.isArray(values)||values.length<2||values.length>31||values.some(value=>typeof value!=='string')||!values[0])throw new Error('Invalid composite request');
    const request=values.map(value=>value.toLowerCase()),requestedNames=compositeNames(request);
    if(!requestedNames.length)throw new Error(`图片组合没有有效差分：${request.join(',')}`);
    const names=[],frames=[],missing=[];
    // Keep original slot indices: an absent difference must never compact the
    // zero prefix of later slots or become a neighboring resource alias.
    for(let slot=0;slot<request.length-1;slot++){
      const selector=request[slot+1];if(!selector||selector==='0')continue;
      const name=`${request[0]}_${'0'.repeat(slot)}${selector}`;
      if(!Object.hasOwn(this.assets,name)&&this.nativeOptionalFaceLayers&&layer.group==='fw'&&NATIVE_OPTIONAL_FACE_ABSENCES.has(name)){
        missing.push({name,slot});continue;
      }
      const frame=this.imageFrame(name,frameId);
      // Present metadata is not permission to omit a layer. Invalid geometry
      // is a strict failure, just like a failed image decode or RGBA check.
      if(!frame||typeof frame.file!=='string'||!frame.file||!['width','height','totalWidth','totalHeight'].every(key=>Number.isSafeInteger(frame[key])&&frame[key]>0)||!['x','y'].every(key=>Number.isFinite(frame[key]))||['baseX','baseY'].some(key=>frame[key]!==undefined&&!Number.isFinite(frame[key])))throw new Error(`Invalid composite frame metadata: ${name}`);
      names.push(name);frames.push(frame);
    }
    if(!names.length)throw new Error(`图片组合没有可加载差分：${request.join(',')}`);
    return {request,requestedNames,names,frames,missing,asset:request.join(',')};
  }
  async prepareComposite(layer,values,frameId,...rest){
    const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);const owners=[];
    try{
    const plan=this.compositePlan(layer,values,frameId),{frames,asset}=plan;
    const images=await Promise.all(frames.map(async frame=>{const image=new Image();if(transaction)owners.push(ownRestoreResource(transaction,()=>discardRestoreImage(image)));image.src=this.url(frame.file);await image.decode();assertRestoreActive(transaction);return image}));assertRestoreActive(transaction);
    const totalWidth=frames[0].totalWidth,totalHeight=frames[0].totalHeight;
    // Old completely empty HG3 overlays can retain a different PSD canvas
    // after a patch replaces the base. Read real alpha only for mismatches;
    // a transparent flag alone is not proof that an overlay contributes zero.
    for(let index=1;index<frames.length;index++){
      const frame=frames[index];
      if((frame.totalWidth!==totalWidth||frame.totalHeight!==totalHeight)&&!this.fullyTransparentImage(images[index],frame))throw new Error(`图片组合画布尺寸不一致：${asset}`);
    }
    const element=document.createElement('div');element.style.position='absolute';element.style.pointerEvents='none';
    images.forEach((image,index)=>{const frame=frames[index];image.style.cssText=`position:absolute;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px`;element.append(image)});
    if(transaction)owners.push(ownRestoreResource(transaction,()=>element.remove()));
    return bindPreparedRestoreMedia({...plan,element,totalWidth,totalHeight},transaction,owners);
    }catch(error){for(const owner of owners)owner.release();assertRestoreActive(transaction);throw error}
  }
  commitComposite(layer,prepared){
    assertPreparedRestoreMedia(prepared);
    const {request,names,frames,missing,asset,element,totalWidth,totalHeight}=prepared;
    this.clear(layer);layer.asset=asset;layer.composite=[...names];layer.compositeRequest=[...request];layer.compositeMissing=missing.map(item=>item.name);
    layer.frame={id:frames[0].id,width:totalWidth,height:totalHeight,totalWidth,totalHeight,x:0,y:0};layer.baseX=frames[0].baseX??0;layer.baseY=frames[0].baseY??0;layer.element=element;
    document.getElementById('layers').append(element);this.place(layer);
    transferPreparedRestoreMedia(prepared);
    // Emit only after all present-resource checks and the successful commit.
    for(const {name,slot} of missing){
      const event=Object.freeze({type:'native-optional-layer-absent',name,where:`${layer.group}:${layer.id}`,request:asset,slot});
      this.compatibilityEvents.push(event);this.warn(`${event.type}: ${name} (${event.where}; slot=${slot}; request=${asset})`);
    }
  }
  async composite(layer,values,frameId){
    this.commitComposite(layer,await this.prepareComposite(layer,values,frameId));
  }
  color(layer,value){
    const rgba=value.replace(/^\$/,'');if(!/^[\da-f]{8}$/i.test(rgba))throw new Error(`Invalid color ${value}`);
    this.clear(layer);layer.color=value;layer.element=document.createElement('div');layer.element.style.position='absolute';
    layer.element.style.backgroundColor='#'+rgba.slice(2)+rgba.slice(0,2);
    layer.frame={width:1600,height:900,totalWidth:1600,totalHeight:900,x:0,y:0};document.getElementById('layers').append(layer.element);this.place(layer);
  }
  async character(layer,values,...rest){
    const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
    const [name,variant,...digits]=values,profile=this.profiles[name.toLowerCase()]?.variants[variant];
    if(!profile)throw new Error(`未知角色配置：${name}/${variant}`);
    const asset=this.assets[profile.model];if(!asset||asset.kind!=='emote')throw new Error(`尚未转换角色资源：${profile.model}`);
    if(layer.asset!==profile.model){
      this.loading('正在加载角色…');
      const controller=transaction?new AbortController():null,requestOwner=transaction?ownRestoreResource(transaction,()=>controller.abort()):null;
      try {
        const response=await fetch(this.url(asset.file),...(controller?[{signal:controller.signal}]:[]));assertRestoreActive(transaction);if(!response.ok)throw new Error(`角色读取失败 ${response.status}`);
        const blob=await response.blob();assertRestoreActive(transaction);
        const decompressed=blob.stream().pipeThrough(new DecompressionStream('gzip'));
        const bytes=new Uint8Array(await new Response(decompressed).arrayBuffer());assertRestoreActive(transaction);
        if(transaction){
          if(this.layers.get(layer.group+':'+layer.id)!==layer)throw new Error('Superseded restore character bank');
          const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;canvas.style.left='0';canvas.style.top='0';let player;
          const owner=ownRestoreResource(transaction,()=>{player?.destroy();canvas.remove();canvas.width=canvas.height=0});
          try{player=new EmotePlayer(canvas);player.loadData(bytes);assertRestoreActive(transaction);this.clear(layer);document.getElementById('layers').append(canvas);layer.element=canvas;layer.player=player;layer.asset=profile.model;owner.transfer()}finally{owner.release()}
        }else{
          this.clear(layer);const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;canvas.style.left='0';canvas.style.top='0';
          document.getElementById('layers').append(canvas);layer.element=canvas;layer.player=new EmotePlayer(canvas);layer.player.loadData(bytes);layer.asset=profile.model;
        }
      }catch(error){assertRestoreActive(transaction);throw error}finally{requestOwner?.release();this.loading('')}

    }
    assertRestoreActive(transaction);layer.profile=name.toLowerCase();layer.variant=variant;
    const player=layer.player;
    for(let i=0;i<digits.length;i++) {
      const variables=profile.dif?.patterns[`${i+1}:${digits[i]}`];
      if(variables)for(const [key,value] of Object.entries(variables))player.setVariable(key,value);
    }
    const timeline=profile.motions['0']??'待機';if(player.mainTimelineLabels.includes(timeline))player.mainTimelineLabel=timeline;
    delete layer.sourceM2TimelineRequest;delete layer.sourceM2TimelineCanonical;
    this.place(layer);
  }
  setSettings(settings){
    for(const key of ['bgm','voice','se','movie'])if(settings[key]!==undefined){const value=Number(settings[key]);if(!Number.isFinite(value)||value<0||value>1)throw new Error(`Invalid ${key} volume`);this.settings[key]=value;}
    if(settings.muted!==undefined)this.settings.muted=!!settings.muted;
    for(const [channel,audio] of this.audio)this.applyVolume(channel,audio);
  }
  applyVolume(channel,audio){const kind=channel.startsWith('voice')?'voice':channel.startsWith('bgm')?'bgm':channel==='movie'?'movie':'se';audio.muted=this.settings.muted;audio.volume=(this.audioState.get(channel)?.volume??1)*this.settings[kind]}
  soundBank(command,id,state){const bank=this.numeric(id,state);if(!Number.isInteger(bank)||bank<0||bank>999)throw new Error(`Invalid sound bank ${id}`);return (command==='pcm'?'voice':command)+bank}
  unusedSoundBank(command){const prefix=command==='pcm'?'voice':command;for(let id=0;id<64;id++){const channel=prefix+id,audio=this.audio.get(channel);if(!audio||audio.ended||audio.paused)return channel}throw new Error(`Too many simultaneous ${command} sounds`)}
  fadeSound(channel,from,to,duration,stop=false){
    this.soundAnimations.get(channel)?.cancel();const audio=this.audio.get(channel);if(!audio)return;
    let timer,resolve,cancelled=false;const finished=new Promise(done=>resolve=done),start=performance.now();
    const job={finished,cancel:()=>{if(cancelled)return;cancelled=true;clearTimeout(timer);if(this.soundAnimations.get(channel)===job)this.soundAnimations.delete(channel);resolve()}};
    this.soundAnimations.set(channel,job);
    const tick=()=>{if(cancelled)return;const ratio=duration<=0?1:Math.min(1,(performance.now()-start)/duration);const state=this.audioState.get(channel);if(!state){job.cancel();return}state.volume=ratio===1?to:from+(to-from)*ratio;this.applyVolume(channel,audio);if(ratio<1)timer=setTimeout(tick,16);else{job.cancel();if(stop)this.stopSound(channel)}};
    tick();return finished;
  }
  waitSound(audio){
    if(!audio||audio.ended||audio.paused)return Promise.resolve();
    return new Promise((resolve,reject)=>{const clean=()=>{for(const event of ['ended','pause','error'])audio.removeEventListener(event,listeners[event])};const listeners={ended:()=>{clean();resolve()},pause:()=>{clean();resolve()},error:()=>{clean();reject(new Error('Sound playback failed while waiting'))}};for(const [event,listener] of Object.entries(listeners))audio.addEventListener(event,listener,{once:true})});
  }
  waitTag(label,fallbackFrames,state){
    // The original tag file belongs to a voice clip; when several banks have
    // that label, CatSystem selects the lowest numbered bank.
    const channels=[...this.audio.keys()].filter(channel=>channel.startsWith('voice')).sort((a,b)=>Number(a.slice(5)||0)-Number(b.slice(5)||0));
    for(const channel of channels){
      const name=this.audioState.get(channel)?.name,time=this.voiceMetadata.voices[name]?.tags?.[label];
      if(time===undefined)continue;
      if(!Number.isFinite(time)||time<0)throw new Error(`Invalid voice tag ${name}/${label}`);
      const audio=this.audio.get(channel),target=time/1000;
      if(audio.paused||audio.ended||audio.currentTime>=target)return Promise.resolve();
      return new Promise((resolve,reject)=>{
        let timer;const clean=()=>{clearTimeout(timer);for(const event of ['timeupdate','ended','pause','error'])audio.removeEventListener(event,listeners[event])};
        const finish=()=>{clean();resolve()},poll=()=>{if(audio.currentTime>=target||audio.ended||audio.paused)finish();else timer=setTimeout(poll,16)};
        const listeners={timeupdate:()=>{if(audio.currentTime>=target)finish()},ended:finish,pause:finish,error:()=>{clean();reject(new Error(`Voice playback failed at tag ${label}`))}};
        for(const [event,listener] of Object.entries(listeners))audio.addEventListener(event,listener);poll();
      });
    }
    return new Promise(resolve=>setTimeout(resolve,this.frames(fallbackFrames??0,state)));
  }
  async sound(channel,name,loop=false,{time=0,paused=false,volume=this.audioState.get(channel)?.volume??1}={},...rest){
    const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
    const asset=this.assets[name.toLowerCase()];if(!asset||asset.kind!=='audio')throw new Error(`尚未转换声音资源：${name}`);
    this.stopSound(channel);const audio=new Audio(this.url(asset.file));audio.loop=loop;
    const owner=ownRestoreResource(transaction,()=>{if(this.audio.get(channel)===audio)this.stopSound(channel);else{audio.pause();audio.removeAttribute?.('src');audio.load?.()}});
    try{
    this.audio.set(channel,audio);this.audioState.set(channel,{name:name.toLowerCase(),volume});this.applyVolume(channel,audio);
    if(time>0){const seek=()=>{if(transaction&&(!restoreTransactionIsActive(transaction)||this.audio.get(channel)!==audio))return;audio.currentTime=Number.isFinite(audio.duration)?Math.min(time,audio.duration):time};if(audio.readyState>=1)seek();else audio.addEventListener('loadedmetadata',seek,{once:true})}
    audio.addEventListener('error',()=>{if(!transaction||restoreTransactionIsActive(transaction)&&this.audio.get(channel)===audio)this.warn(`声音读取失败：${name}`)},{once:true});
    audio.addEventListener('ended',()=>{if(this.audio.get(channel)===audio)this.stopSound(channel)},{once:true});
    if(!paused)try{await audio.play();assertRestoreActive(transaction)}catch(error){if(transaction&&!restoreTransactionIsActive(transaction)){audio.pause();assertRestoreActive(transaction)}this.warn(`声音播放受限：${error.message}`)}
    assertRestoreActive(transaction);owner.transfer();
    }finally{owner.release()}
  }
  numeric(value,state,current=0){return numericArgument(value,state,current)}
  frames(value,state){return Math.max(0,this.numeric(value,state))*1000/60}
  animate(layer,from,to,duration,{asynchronous=false,origin=from,resetOnStop=false}={}){
    const keys=Object.keys(to);
    // Plane banks have no DOM element: update their parameters and propagate
    // through place(), rather than trying to animate a nonexistent element.
    // Different properties can move/fade together; a replacement of the same
    // property cancels only that motion and starts at its current state.
    for(const animation of [...layer.animations??[]])if(animation.keys?.some(key=>keys.includes(key)))animation.cancel();
    Object.assign(layer,from);this.place(layer);
    // The existing character layout supports x translation and opacity.
    // Move commands also carry y: retain it only when its target is unchanged.
    // Other character transforms still need original-coordinate calibration.
    if(layer.player&&keys.some(key=>key!=='opacity'&&key!=='x'&&(key!=='y'||to[key]!==from[key]))){Object.assign(layer,to);this.place(layer);this.warn('动态角色位移和缩放仍使用预览终点布局');return;}
    if(duration<=0&&!asynchronous){Object.assign(layer,to);this.place(layer);return;}
    let frame,resolve,settled=false,cancelled=false;
    const finished=new Promise(done=>resolve=done),started=performance.now();
    const animation={keys,from:{...origin},to:{...to},duration,started,asynchronous,resetOnStop,finished,
      cancel:(restoreOrigin=false)=>{
        if(cancelled)return;cancelled=true;if(frame!==undefined)cancelAnimationFrame(frame);
        if(restoreOrigin&&asynchronous&&resetOnStop){Object.assign(layer,origin);this.place(layer);}
        this.animations.delete(finished);layer.animations=layer.animations.filter(item=>item!==animation);
        if(!settled){settled=true;resolve();}
      }
    };
    layer.animations??=[];layer.animations.push(animation);
    if(!asynchronous)this.animations.add(finished);
    const tick=now=>{
      if(cancelled)return;
      const ratio=duration<=0?1:Math.min(1,Math.max(0,(now-started)/duration));
      for(const key of keys)layer[key]=ratio===1?to[key]:from[key]+(to[key]-from[key])*ratio;
      this.place(layer);
      if(ratio<1)frame=requestAnimationFrame(tick);
      else{
        frame=undefined;settled=true;resolve();this.animations.delete(finished);
        // The documented m2 position stop returns to its origin. Completed
        // fades/scales must keep their resulting alpha/size when stopped.
        if(!asynchronous||!resetOnStop)layer.animations=layer.animations.filter(item=>item!==animation);
      }
    };
    tick(started);return finished;
  }
  async movie(name){
    const asset=this.assets[name.toLowerCase()];if(!asset||!['video','movie'].includes(asset.kind))throw new Error(`尚未转换影片资源：${name}`);
    const video=document.createElement('video');video.src=this.url(asset.file);video.playsInline=true;video.controls=true;video.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:10000;background:black';
    this.audio.set('movie',video);this.audioState.set('movie',{name:name.toLowerCase(),volume:1});this.applyVolume('movie',video);document.getElementById('layers').append(video);
    try{await new Promise((resolve,reject)=>{video.addEventListener('ended',resolve,{once:true});video.addEventListener('error',()=>reject(new Error(`影片播放失败：${name}`)),{once:true});video.play().catch(reject)})}
    finally{video.pause();video.remove();this.audio.delete('movie');this.audioState.delete('movie')}
  }
  async command(cmd,args,state,commandLocation){
    const parts=argumentsOf(args),number=(value,current=0)=>this.numeric(value,state,current);
    if(GROUPS.includes(cmd)){
      if(!parts.length){for(const layer of this.layers.values())if(layer.group===cmd)this.initialize(layer);return;}
      if(['stop','tone','mode','attr_def','quake'].includes(parts[0])){
        for(const layer of this.layers.values())if(layer.group===cmd){if(parts[0]==='stop')this.stop(layer);if(parts[0]==='mode'){layer.mode=parts[1];this.place(layer)}}
        if(parts[0]!=='stop')this.warn(`${cmd} ${parts[0]} 原引擎效果未完全还原`);return;
      }
      // A resource without a bank selector uses bank zero in original map scripts.
      const implicit=!/^(?:\[|#|\d)/.test(parts[0]);
      const ids=implicit?['0']:layerIds(parts[0],state),operation=implicit?parts[0]:parts[1],offset=implicit?0:1;
      for(const id of ids){
        const layer=this.bank(cmd,id),p=parts.slice(offset+1);
        if(!operation){this.initialize(layer);continue;}
        if(operation==='stop'){this.stop(layer);continue;}
        if(operation==='scale'){layer.sx=number(p[0],layer.sx*100)/100;layer.sy=number(p[1]??p[0],layer.sy*100)/100;this.place(layer);continue;}
        if(operation==='pos'){this.cancelCharacterPosition(layer);layer.x=number(p[0],layer.x);layer.y=number(p[1],layer.y);this.place(layer);continue;}
        if(operation==='base'){layer.baseX=number(p[0]);layer.baseY=number(p[1]);this.place(layer);continue;}
        if(operation==='blend'){layer.opacity=Math.max(0,Math.min(1,number(p[0],layer.opacity*255)/255));this.place(layer);continue;}
        if(operation==='disp'){layer.visible=!!number(p[0],1);this.place(layer);continue;}
        if(operation==='pri'){layer.priority=number(p[0]);this.place(layer);continue;}
        if(operation==='blur'){layer.blur=number(p[0]);this.place(layer);continue;}
        if(operation==='rot'){layer.rotation=number(p[2]??p[0],layer.rotation);this.place(layer);this.warn('旋转使用二维图层角度');continue;}
        if(operation==='mode'){layer.mode=p[0];this.place(layer);continue;}
        if(operation==='fade'||operation==='m2fade'){this.animate(layer,{opacity:Math.max(0,Math.min(1,number(p[1],layer.opacity*255)/255))},{opacity:Math.max(0,Math.min(1,number(p[2],layer.opacity*255)/255))},this.frames(p[0],state),{asynchronous:operation.startsWith('m2')});continue;}
        if(/^(?:m2)?(?:move|amove[123])$/.test(operation)){this.animate(layer,{x:layer.x,y:layer.y},{x:number(p[1],layer.x),y:number(p[2],layer.y)},this.frames(p[0],state),{asynchronous:operation.startsWith('m2'),resetOnStop:operation.startsWith('m2')});if(operation.includes('amove'))this.warn('缓动位移使用线性插值');continue;}
        if(/^(?:mscale|m2scale|(?:m2)?ascale[123])$/.test(operation)){if(cmd!=='pl')throw new Error(`缩放运动只能用于 pl：${cmd} ${args}`);this.animate(layer,{sx:layer.sx,sy:layer.sy},{sx:number(p[1],100)/100,sy:number(p[2],100)/100},this.frames(p[0],state),{asynchronous:operation.startsWith('m2')});if(operation.includes('ascale'))this.warn('缓动缩放使用线性插值');continue;}
        if(operation==='m2intmot'){const timeline=this.profiles[layer.profile]?.variants[layer.variant]?.motions[p[0]]??p[0];if(this.sourceM2IntMotionReplay&&layer.player&&typeof timeline==='string'&&timeline){this.applySourceM2Timeline(layer,timeline);}else if(layer.player?.mainTimelineLabels.includes(timeline)){layer.player.mainTimelineLabel=timeline;}else this.warn(`动作未找到 ${p[0]}`);continue;}
        if(operation==='m2variable'){if(!layer.player)throw new Error('E-mote variable without a character');layer.player.setVariable(p[0],number(p[1]));continue;}
        if(['arc','mcarc','mcspline','quake','bmode','m2enable_lip','m2enable_blink','m2att','m2wind','m2color','m2grayscale'].includes(operation)){this.warn(`${cmd} ${operation} 未还原`);continue;}
        const [token,frame]=operation.split(':'),values=token.split(',');
        if(/^\$[\da-f]{8}$/i.test(token))this.color(layer,token);
        else if(this.profiles[values[0].toLowerCase()])await this.character(layer,values);
        else if(values.length>1)await this.composite(layer,values,frame);
        else if(this.assets[values[0].toLowerCase()]?.kind==='image')await this.image(layer,values[0],frame);
        else throw new Error(`资源或图层操作尚未实现：${cmd} ${args}`);
        if(p[0]!==undefined||p[1]!==undefined)this.cancelCharacterPosition(layer);
        if(p[0]!==undefined)layer.x=number(p[0],layer.x);if(p[1]!==undefined)layer.y=number(p[1],layer.y);if(p[3]!==undefined)layer.planeId=number(p[3],layer.planeId);if(p[4]!==undefined)this.warn('图像反转、旋转或遮罩参数尚未还原');this.place(layer);
      }return;
    }
    if(['pcm','bgm','se'].includes(cmd)){
      const explicit=/^(?:\d+|#\d+)$/.test(parts[0]??''),channel=explicit?this.soundBank(cmd,parts[0],state):this.unusedSoundBank(cmd),offset=explicit?1:0,operation=parts[offset],p=parts.slice(offset+1);
      if(!operation){this.stopSound(channel);return;}
      if(operation==='end'){const current=this.audioState.get(channel)?.volume??1;this.fadeSound(channel,current,0,this.frames(p[0]??30,state),true);return;}
      if(operation==='vol'){this.soundAnimations.get(channel)?.cancel();const volume=Math.max(0,Math.min(1,number(p[0])/100));const data=this.audioState.get(channel)??{volume:1};data.volume=volume;this.audioState.set(channel,data);const audio=this.audio.get(channel);if(audio)this.applyVolume(channel,audio);return;}
      if(operation==='fade'){if(p.length<2)throw new Error(`Invalid sound fade ${args}`);const hasFrames=p.length>=3;this.fadeSound(channel,Math.max(0,Math.min(1,number(p[hasFrames?1:0])/100)),Math.max(0,Math.min(1,number(p[hasFrames?2:1])/100)),this.frames(hasFrames?p[0]:30,state));return;}
      if(operation==='pause'){this.audio.get(channel)?.pause();return;}
      if(operation==='replay'){const audio=this.audio.get(channel);if(audio)try{await audio.play()}catch(error){this.warn(`声音播放受限：${error.message}`)}return;}
      if(operation==='pos'){this.warn(`${cmd} 三维音源位置尚未还原`);return;}
      const loop=operation==='loop',name=loop?p[0]:operation,pan=number(p[loop?1:0]??0),delay=p[loop?2:1];
      if(pan)this.warn(`${cmd} 立体声声像尚未还原`);if(delay!==undefined)await new Promise(resolve=>setTimeout(resolve,this.frames(delay,state)));
      return this.sound(channel,name,cmd==='bgm'||loop);
    }
    if(cmd==='movie')return this.sourceMoviePolicy===true?this.movie(parts[0],{sourceMoviePolicyState:state,sourceMovieCommandLocation:commandLocation}):this.movie(parts[0]);
    if(cmd==='frameon'||cmd==='frameoff'){document.getElementById('dialogue').hidden=cmd==='frameoff';return;}
    if(cmd==='forcemesdel'){document.getElementById('dialogue').hidden=parts[0]==='1';return;}
    if(cmd==='rdraw'||cmd==='rwipe'){const duration=this.frames(parts[cmd==='rwipe'?1:0]??15,state);const animation=document.getElementById('layers').animate([{opacity:.5},{opacity:1}],{duration});const finished=animation.finished.catch(()=>{}).finally(()=>this.animations.delete(finished));this.animations.add(finished);if(cmd==='rwipe')this.warn('擦拭效果使用淡入替代');return;}
    if(cmd==='wait'){
      if(!parts.length||parts[0]==='-1'){await Promise.all([...this.animations]);return;}
      if(parts[0]==='se'||parts[0]==='pcm'){const prefix=parts[0]==='pcm'?'voice':'se';const channels=parts[1]===undefined?[...this.audio.keys()].filter(channel=>channel.startsWith(prefix)):[this.soundBank(parts[0],parts[1],state)];await Promise.all(channels.map(channel=>this.waitSound(this.audio.get(channel))));return;}
      if(parts[0]==='tag'){if(!parts[1])throw new Error('wait tag requires a label');await this.waitTag(parts[1],parts[2],state);return;}
      await new Promise(resolve=>setTimeout(resolve,this.frames(parts[0],state)));return;
    }
    if(['initialize_header','drawdef','wipedef','sysbtn','keyskip','auto','end_of_kaisou'].includes(cmd)){this.onCommand(cmd,args);return;}
    if(['view','cam','particle','particle2','particle3','epl','rpflip','rfmos','place'].includes(cmd)){this.warn(`${cmd} 未还原`);return;}
    throw new Error(`剧情指令尚未实现：${cmd} ${args}`);
  }
  savedMotions(layer){return (layer.animations??[]).filter(job=>job.keys).map(job=>({origin:{...job.from},to:{...job.to},remaining:Math.max(0,job.duration-(performance.now()-job.started)),asynchronous:job.asynchronous,resetOnStop:job.resetOnStop}))}
  snapshot(){return {version:2,layers:[...this.layers.values()].map(l=>({group:l.group,id:l.id,x:l.x,y:l.y,sx:l.sx,sy:l.sy,opacity:l.opacity,visible:l.visible,rotation:l.rotation,priority:l.priority,blur:l.blur,mode:l.mode,baseX:l.baseX,baseY:l.baseY,shiftX:l.shiftX,shiftY:l.shiftY,planeId:l.planeId,color:l.color,asset:l.asset,composite:l.composite? [...l.composite]:l.composite,compositeRequest:l.compositeRequest? [...l.compositeRequest]:l.compositeRequest,compositeMissing:l.compositeMissing? [...l.compositeMissing]:l.compositeMissing,frameId:l.frame?.id,profile:l.profile,variant:l.variant,emote:!!l.player,timeline:this.sourceM2IntMotionReplay&&l.sourceM2TimelineCanonical===l.player?.mainTimelineLabel?(l.sourceM2TimelineRequest??l.player?.mainTimelineLabel):l.player?.mainTimelineLabel,variables:l.player?.variableList?.map(v=>({label:v.label,value:l.player.getVariable(v.label)})),motions:this.savedMotions(l)})),audio:[...this.audio.entries()].filter(([channel])=>channel!=='movie').map(([channel,audio])=>({channel,...this.audioState.get(channel),time:audio.currentTime,paused:audio.paused,loop:audio.loop})),dialogueVisible:!document.getElementById('dialogue').hidden}}
  validateSave(saved){
    const data=Array.isArray(saved)?{version:2,layers:saved,audio:[],dialogueVisible:true}:saved;
    if(data?.version!==2||!Array.isArray(data.layers)||!Array.isArray(data.audio)||data.layers.length>1000||data.audio.length>100)throw new Error('Invalid renderer save');
    for(const layer of data.layers){
      if(!GROUPS.includes(layer.group)||!/^\d+$/.test(String(layer.id)))throw new Error('Invalid saved bank');
      if(this.sourceM2IntMotionReplay&&layer.emote&&layer.timeline!==undefined&&typeof layer.timeline!=='string')throw new Error('Invalid saved source timeline');
      for(const key of ['x','y','sx','sy','opacity'])if(!Number.isFinite(layer[key]))throw new Error(`Invalid saved ${key}`);
      for(const key of ['baseX','baseY','shiftX','shiftY','planeId','rotation','priority','blur'])if(layer[key]!==undefined&&!Number.isFinite(layer[key]))throw new Error(`Invalid saved ${key}`);
      if(layer.motions!==undefined){
        if(!Array.isArray(layer.motions)||layer.motions.length>5)throw new Error('Invalid saved motions');
        const used=new Set();
        for(const motion of layer.motions){
          if(!motion?.origin||!motion?.to||!Number.isFinite(motion.remaining)||motion.remaining<0||typeof motion.asynchronous!=='boolean'||typeof motion.resetOnStop!=='boolean')throw new Error('Invalid saved motion');
          const keys=Object.keys(motion.to);
          if(!keys.length||keys.length!==Object.keys(motion.origin).length)throw new Error('Invalid saved motion properties');
          for(const key of keys){if(!['x','y','sx','sy','opacity'].includes(key)||used.has(key)||!Number.isFinite(motion.to[key])||!Number.isFinite(motion.origin[key])||(motion.resetOnStop&&(!motion.asynchronous||!['x','y'].includes(key))))throw new Error('Invalid saved motion properties');used.add(key);}
        }
      }
      if(!layer.composite&&(layer.compositeRequest!=null||layer.compositeMissing!=null))throw new Error('Orphan saved composite references');
      if(layer.composite&&(layer.color||layer.emote))throw new Error('Conflicting saved composite content');
      if(layer.color){if(!/^\$[\da-f]{8}$/i.test(layer.color))throw new Error('Invalid saved color');}
      else if(layer.composite){
        if(!Array.isArray(layer.composite)||!layer.composite.length||layer.composite.length>30||typeof layer.asset!=='string'||!layer.asset.includes(','))throw new Error('Invalid saved composite');
        const plan=this.compositePlan(layer,layer.asset.split(','),layer.frameId);
        if(!sameStrings(layer.composite,plan.names))throw new Error('Invalid saved composite drawn references');
        if(layer.compositeRequest!==undefined&&layer.compositeRequest!==null&&!sameStrings(layer.compositeRequest,plan.request))throw new Error('Invalid saved composite original request');
        if(layer.compositeMissing!==undefined&&layer.compositeMissing!==null&&!sameStrings(layer.compositeMissing,plan.missing.map(item=>item.name)))throw new Error('Invalid saved composite missing references');
        if(plan.missing.length&&(!sameStrings(layer.compositeRequest,plan.request)||!sameStrings(layer.compositeMissing,plan.missing.map(item=>item.name))))throw new Error('Missing saved composite original references');
      }
      else if(!layer.emote&&layer.asset)this.imageFrame(layer.asset,layer.frameId??layer.frame?.id);
      else if(layer.emote&&this.assets[layer.asset]?.kind!=='emote')throw new Error(`Missing saved model ${layer.asset}`);
    }
    for(const sound of data.audio)if(!/^(?:voice\d*|bgm\d+|se\d+)$/.test(sound.channel)||this.assets[sound.name]?.kind!=='audio'||!Number.isFinite(sound.time)||sound.time<0||!Number.isFinite(sound.volume)||sound.volume<0||sound.volume>1)throw new Error('Invalid saved sound');
    return data;
  }
  async restore(saved,...rest){
    const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);
    const data=this.validateSave(saved,...rest),preparedComposites=new Map();
    try{
      for(const layer of data.layers)if(layer.composite){const prepared=await this.prepareComposite(layer,layer.asset.split(','),layer.frameId,...rest);assertRestoreActive(transaction);preparedComposites.set(layer,prepared)}
      assertRestoreActive(transaction);if(transaction)transaction.resetFromRestore();else this.reset();assertRestoreActive(transaction);
      for(const saved of data.layers){
        assertRestoreActive(transaction);const layer=this.bank(saved.group,saved.id);Object.assign(layer,saved,{asset:null,element:null,player:null});
        if(saved.color)this.color(layer,saved.color);
        else if(saved.composite)this.commitComposite(layer,preparedComposites.get(saved));
        else if(!saved.emote&&saved.asset){await this.image(layer,saved.asset,saved.frameId??saved.frame?.id,...rest);assertRestoreActive(transaction)}
        else if(saved.emote){const profile=saved.profile?{name:saved.profile,variant:saved.variant}:Object.entries(this.profiles).flatMap(([name,p])=>Object.entries(p.variants).map(([variant,v])=>({name,variant,...v}))).find(v=>v.model===saved.asset);if(!profile)throw new Error('Missing saved model profile');await this.character(layer,[profile.name,profile.variant],...rest);assertRestoreActive(transaction);for(const variable of saved.variables??[])layer.player.setVariable(variable.label,variable.value);if(saved.timeline){if(this.sourceM2IntMotionReplay)this.applySourceM2Timeline(layer,saved.timeline);else layer.player.mainTimelineLabel=saved.timeline}}
        assertRestoreActive(transaction);for(const key of ['baseX','baseY','shiftX','shiftY','planeId'])if(saved[key]!==undefined)layer[key]=saved[key];this.place(layer);
      }
      for(const saved of data.layers)for(const motion of saved.motions??[]){assertRestoreActive(transaction);const layer=this.bank(saved.group,saved.id),from=Object.fromEntries(Object.keys(motion.to).map(key=>[key,layer[key]]));this.animate(layer,from,motion.to,motion.remaining,{asynchronous:motion.asynchronous,origin:motion.origin,resetOnStop:motion.resetOnStop})}
      for(const audio of data.audio){assertRestoreActive(transaction);await this.sound(audio.channel==='voice'?'voice0':audio.channel,audio.name,audio.loop,audio,...rest);assertRestoreActive(transaction)}
      assertRestoreActive(transaction);document.getElementById('dialogue').hidden=!data.dialogueVisible;
    }finally{for(const prepared of preparedComposites.values())releasePreparedRestoreMedia(prepared)}
  }}
