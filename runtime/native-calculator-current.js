import {nativeRoundPosition} from './native-position-motion.js';
import {nativeScaleTarget} from './native-scale-motion.js';

const integer=value=>Number.isInteger(value)&&value>=-2147483648&&value<=2147483647;
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
export const NATIVE_CALCULATOR_CURRENT_SOURCE=Object.freeze({
 native212VA:'0x5847b0',native213VA:'0x5845f0',calculatorPointerOffset:0x6c,
 currentFieldOffset:0x14,setterVA:'0x66fd00',constructorVA:'0x66f810',
 atReadVA:'0x66fe73',addSubtractProofSHA256:'d65cd77d87f22f618226c766357692ac5c2399d45ada3457c4eaf72c6bb0037e',
 actualScenePrefixAccepted:false,nativeRasterAcceptance:false,
});

// This represents a SHARED calculator, not a layer's coordinates. Native209
// creates it with current=0; Native212 changes the integer; Native213 reads it.
// Its binding to ScriptTask ancestry remains the host's source-backed duty.
// Start unknown: merely enabling the renderer must not fabricate a fresh task.
export class NativeCalculatorCurrent {
 constructor(){this.value=undefined;this.reason='Native calculator owner/current lifecycle has not been supplied'}
 initializeNative209(){this.value=0;this.reason=undefined;return this.value}
 setCurrentInteger(value){if(!integer(value))throw new TypeError('Invalid native212 signed integer');this.value=value;this.reason=undefined;return value}
 setCurrentFromNative319(value){return this.setCurrentInteger(nativeRoundPosition(value))}
 invalidate(reason){if(typeof reason!=='string'||!reason)throw new TypeError('Invalid native calculator unknown reason');this.value=undefined;this.reason=reason}
 current(){if(!integer(this.value))throw new Error(this.reason??'Native Arc @ calculator context is not closed');return this.value}
 evaluateAtInteger(token){
  if(typeof token!=='string')throw new TypeError('Invalid native213 expression token');
  // Native213 removes precisely one trailing percent byte. Arc does not first
  // call native46, so this is not a percentage of a position or dimension.
  const expression=token.endsWith('%')?token.slice(0,-1):token;
  if(!/^@(?:[+-]\d+)?$/.test(expression))throw new Error('Native shared calculator grammar beyond @ signed offset is not closed');
  return nativeScaleTarget(expression,this.current());
 }
 snapshot(){return this.value===undefined?{version:1,current:null,reason:this.reason}:{version:1,current:this.current(),reason:null}}
 static restore(snapshot){
  if(!exact(snapshot,['version','current','reason'])||snapshot.version!==1||!(snapshot.current===null?typeof snapshot.reason==='string'&&snapshot.reason.length>0:integer(snapshot.current)&&snapshot.reason===null))throw new TypeError('Invalid saved native calculator current');
  const context=new NativeCalculatorCurrent();if(snapshot.current===null)context.invalidate(snapshot.reason);else context.setCurrentInteger(snapshot.current);return context;
 }
}
