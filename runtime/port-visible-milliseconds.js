// iPad/browser port policy: advance the shared animation clock only while visible.
// This is an explicit host lifecycle policy, not original Windows pause behavior.
export const PORT_VISIBLE_CLOCK_POLICY='port-visible-milliseconds-v1';
const states=new WeakMap();
const require=(ok,message)=>{if(!ok)throw new Error('Port visible clock: '+message)};
const checked=value=>{require(Number.isFinite(value)&&value>=0&&value<=0xffffffff,'unsigned32 source milliseconds required');return Math.floor(value)};

export class PortVisibleMilliseconds {
 constructor({millisecondSource,visibilityTarget,pageTarget,isHidden}){
  require(typeof millisecondSource==='function'&&typeof isHidden==='function','explicit host source/visibility required');
  for(const target of [visibilityTarget,pageTarget])require(target&&typeof target.addEventListener==='function'&&typeof target.removeEventListener==='function','explicit lifecycle targets required');
  const hidden=isHidden();require(typeof hidden==='boolean','boolean visibility required');
  const raw=checked(millisecondSource()),s={millisecondSource,isHidden,raw,value:raw,hidden,pageHeld:false,disposed:false,events:[],listeners:[]};states.set(this,s);
  const listen=(target,name,callback)=>{target.addEventListener(name,callback);s.listeners.push([target,name,callback])};
  listen(visibilityTarget,'visibilitychange',()=>this.#sample('visibilitychange'));
  listen(pageTarget,'pagehide',()=>{this.#sample('pagehide-before');s.pageHeld=true;this.#sample('pagehide')});
  listen(pageTarget,'pageshow',()=>{this.#sample('pageshow-before');s.pageHeld=false;this.#sample('pageshow')});
 }
 #sample(reason){
  const s=states.get(this);require(!s.disposed,'disposed source');
  const raw=checked(s.millisecondSource()),hidden=s.isHidden();require(typeof hidden==='boolean','boolean visibility required');
  require(raw>=s.raw,'host milliseconds moved backward or wrapped');
  // Charge the interval to the state before the transition. The event time
  // closes the visible interval; pageshow closes the held interval.
  const wasPaused=s.hidden||s.pageHeld;
  if(!wasPaused)s.value+=raw-s.raw;
  require(s.value<=0xffffffff,'logical milliseconds wrapped');
  s.raw=raw;s.hidden=hidden;
  if(reason!=='read'){
   s.events.push(Object.freeze({reason,rawMilliseconds:raw,logicalMilliseconds:s.value,paused:s.hidden||s.pageHeld,policy:PORT_VISIBLE_CLOCK_POLICY}));
   if(s.events.length>64)s.events.shift();
  }
  return s.value;
 }
 read(){return this.#sample('read')}
 lifecycleEvents(){return states.get(this).events.slice()}
 dispose(){const s=states.get(this);if(s.disposed)return;for(const [target,name,callback] of s.listeners)target.removeEventListener(name,callback);s.listeners.length=0;s.disposed=true}
}
