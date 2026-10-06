// Actual cs2.exe 500e60 RNG and491620 blink timeline, explicit source state.
// This API does not choose the Windows global seed/other-consumer ordering.
const rngStates=new WeakMap(),controllers=new WeakMap();
const require=(condition,message)=>{if(!condition)throw new Error(message)};
const u32=(value,label)=>{require(Number.isInteger(value)&&value>=0&&value<=0xffffffff,`Invalid original unsigned ${label}`);return value};
const f32=(value,label)=>{require(typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(Math.fround(value)),`Invalid original Float32 ${label}`);return Math.fround(value)};
const rngState=rng=>{const state=rngStates.get(rng);require(state,'Branded original blink RNG required');return state};
const controllerState=controller=>{const state=controllers.get(controller);require(state,'Branded original blink controller required');return state};

export function createSourceBlinkRNG({words,index}={}){
  require((words instanceof Uint32Array||Array.isArray(words))&&words.length===624,'Explicit original624-word RNG state required');
  require(Number.isInteger(index)&&index>=0&&index<=625,'Invalid original RNG index');
  const owned=new Uint32Array(624);for(let i=0;i<624;i++)owned[i]=u32(words[i],'RNG word');
  const rng=Object.freeze({});rngStates.set(rng,{words:owned,index});return rng;
}
export function createUnseededSourceBlinkRNG(){return createSourceBlinkRNG({words:new Uint32Array(624),index:625})}
export function isSourceBlinkRNG(rng){return rngStates.has(rng)}
export function copySourceBlinkRNGState(rng){const s=rngState(rng);return {words:Array.from(s.words),index:s.index}}
// Port-owned save continuation; this is not a Windows save decoder. Validation
// uses the same actual source state constructor before touching the shared RNG.
export function restoreSourceBlinkRNGState(rng,saved){const checked=rngState(createSourceBlinkRNG(saved)),state=rngState(rng);state.words.set(checked.words);state.index=checked.index}
export function sourceBlinkRandomU32(rng){
  const s=rngState(rng),words=s.words;
  if(s.index>=624){
    if(s.index===625){
      let seed=4357;
      for(let i=0;i<624;i++){
        const step=(Math.imul(seed,69069)+1)>>>0;
        words[i]=((seed&0xffff0000)|(step>>>16))>>>0;
        seed=(Math.imul(step,69069)+1)>>>0;
      }
    }
    const matrix=value=>(value&1)?0x9908b0df:0;
    for(let i=0;i<227;i++){
      const y=((words[i]&0x80000000)|(words[i+1]&0x7fffffff))>>>0;
      words[i]=((y>>>1)^matrix(y)^words[i+397])>>>0;
    }
    for(let i=227;i<623;i++){
      const y=((words[i]&0x80000000)|(words[i+1]&0x7fffffff))>>>0;
      words[i]=((y>>>1)^matrix(y)^words[i-227])>>>0;
    }
    const y=((words[623]&0x80000000)|(words[0]&0x7fffffff))>>>0;
    words[623]=((y>>>1)^matrix(y)^words[396])>>>0;s.index=0;
  }
  let value=words[s.index++];value^=value>>>11;
  value^=(value&0xff3a58ad)<<7;value^=(value&0xffffdf8c)<<15;value^=value>>>18;
  return value>>>0;
}

export function createSourceBlinkController(node,rng,{enabled,selected}={}){
  require(typeof enabled==='boolean'&&typeof selected==='boolean','Explicit original blink enabled/selected flags required');
  rngState(rng);require(node&&typeof node.variable==='string'&&node.variable.length>0,'Exact source blink variable required');
  const config={variable:node.variable,initialBase:f32(node.initialBase,'base'),begin:f32(node.begin,'begin'),end:f32(node.end,'end'),
    duration:u32(node.duration,'duration'),minimumDelay:u32(node.minimumDelay,'minimum delay'),maximumDelay:u32(node.maximumDelay,'maximum delay')};
  require(config.maximumDelay>=config.minimumDelay,'Unclosed descending source delay range');
  config.span=(config.maximumDelay-config.minimumDelay)||1;
  const controller=Object.freeze({});controllers.set(controller,{config:Object.freeze(config),rng,enabled,selected,start:0,end:0});return controller;
}
export function sourceBlinkControllerState(controller){const s=controllerState(controller);return {config:{...s.config},enabled:s.enabled,selected:s.selected,start:s.start,end:s.end}}
export function restoreSourceBlinkController(node,rng,saved){
  require(saved&&typeof saved==='object','Explicit saved source blink controller required');
  const controller=createSourceBlinkController(node,rng,{enabled:saved.enabled,selected:saved.selected}),state=controllerState(controller);
  require(JSON.stringify(saved.config)===JSON.stringify(state.config),'Saved source blink config differs');
  state.start=u32(saved.start,'saved blink start');state.end=u32(saved.end,'saved blink end');return controller;
}
export function setSourceBlinkControllerSelected(controller,selected){
  require(typeof selected==='boolean','Explicit original selection required');const s=controllerState(controller);s.selected=selected;s.start=s.end=0;
}
export function setSourceBlinkControllerEnabled(controller,enabled){
  require(typeof enabled==='boolean','Explicit original blink flag required');const s=controllerState(controller);s.enabled=enabled;
  if(enabled){s.start=s.end=0;return null}
  return s.selected?{variable:s.config.variable,value:s.config.initialBase,kind:'source-disabled-base'}:null;
}
export function sourceBlinkFrameAtTick(controller,tick){
  u32(tick,'shared tick');const s=controllerState(controller),c=s.config;
  if(!s.enabled||!s.selected)return null;
  if(s.start===s.end){s.start=(tick+c.minimumDelay+(sourceBlinkRandomU32(s.rng)%c.span))>>>0;s.end=(s.start+c.duration)>>>0}
  if(s.start>tick)return null;
  if(s.end<=tick){s.end=s.start;return {variable:c.variable,value:c.initialBase,kind:'source-ended-base'}}
  const elapsed=Math.fround((tick-s.start)>>>0),duration=Math.fround(c.duration);
  let ratio=Math.fround(elapsed/duration);ratio=Math.fround(ratio+ratio);
  let value;
  if(ratio<=1)value=Math.fround(Math.fround(Math.fround(c.end-c.begin)*ratio)+c.begin);
  else value=Math.fround(Math.fround(Math.fround(ratio-1)*Math.fround(c.begin-c.end))+c.end);
  require(Number.isFinite(value),'Source blink produced nonfinite scalar');
  return {variable:c.variable,value,kind:'source-active-scalar'};
}
