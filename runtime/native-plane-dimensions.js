import {sourcePlaneDimensionsData} from './native-plane-dimensions-data.js';
export {sourcePlaneDimensionsData};
const f=Math.fround;
const fail=message=>{throw new TypeError(message)};
const key=layer=>`${layer.group}:${layer.id}`;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(f(value));

// Source type2 SimplePlane msg4c returns rectangle START and END, not texture
// size or transformed screen bounds. The PL helper stores END in bank100/104.
export class SourcePlaneDimensions {
 constructor(){this.records=new Map()}
 initialize(layer){
  if(layer.group!=='pl')return;
  const name=`pl${String(layer.id).padStart(2,'0')}`,row=sourcePlaneDimensionsData.rows[name];
  if(!row||row.width<=0||row.height<=0){this.invalidate(layer,'Missing or nonpositive original XML plane dimensions');return}
  // native78 constructs a zero-origin rectangle even for atlas x/y != zero.
  this.records.set(key(layer),Object.freeze({taskType:2,originX:0,originY:0,width:f(row.width),height:f(row.height),endX:f(row.width),endY:f(row.height),origin:'sourceXML'}));
 }
 invalidate(layer,reason='Unclosed plane type or rectangle lifecycle'){if(layer.group==='pl')this.records.set(key(layer),Object.freeze({invalid:reason}))}
 invalidateAll(reason){for(let id=0;id<32;id++)this.invalidate({group:'pl',id:String(id)},reason)}
 clear(){this.records.clear()}
 dimensions(layer){
  if(layer.group!=='pl')fail('Native plane scale group is not closed');
  // Browser images, E-mote and replacements do not establish a native type2
  // rectangle. They must use the explicit update hook after source validation.
  const old=this.records.get(key(layer));
  if(old?.invalid)fail(old.invalid);
  // Base.clear leaves old frame metadata after source PL initialize. It is
  // not a live rectangle: only the already-proven XML reset with no remaining
  // resource may ignore it. Unknown or live replacement bases stay rejected.
  const cleanXMLReset=old?.origin==='sourceXML'&&!layer.element&&!layer.player&&layer.asset==null&&layer.color==null&&layer.composite==null&&layer.compositeRequest==null&&layer.compositeMissing==null;
  const resource=layer.element||layer.player||layer.asset!=null||layer.color!=null||layer.composite!=null||layer.compositeRequest!=null||layer.compositeMissing!=null;
  if((resource||layer.frame)&&old?.origin!=='sourceRectangleUpdate'&&!cleanXMLReset){this.invalidate(layer,'Mixed PL resource/reload dimension basis is not closed')}
  if(!this.records.has(key(layer)))this.initialize(layer);
  const record=this.records.get(key(layer));if(record.invalid)fail(record.invalid);
  return Object.freeze({x:record.endX,y:record.endY,z:1});
 }
 updateRectangle(layer,{taskType,originX=0,originY=0,width,height}={}){
  if(layer.group!=='pl'||taskType!==2){this.invalidate(layer,'Non-type2 PL rectangle dimension basis is not closed');fail('Non-type2 PL rectangle dimension basis is not closed')}
  if(![originX,originY,width,height].every(finite)||width<=0||height<=0)fail('Invalid native type2 rectangle');
  const x=f(originX),y=f(originY),w=f(width),h=f(height),endX=f(x+w),endY=f(y+h);
  if(!Number.isFinite(endX)||!Number.isFinite(endY)||endX<=0||endY<=0)fail('Nonpositive native plane rectangle END is not closed');
  this.records.set(key(layer),Object.freeze({taskType:2,originX:x,originY:y,width:w,height:h,endX,endY,origin:'sourceRectangleUpdate'}));
 }
 observeCommand(layer,operation){
  if(layer.group!=='pl')return;
  // These operations do not replace the raw rectangle. Reset goes through
  // initialize(); unsupported resource/type changes invalidate before load.
  if(operation===undefined||['stop','delay','move','m2move','amove1','amove2','amove3','m2amove1','m2amove2','m2amove3','arc','mcarc','mcspline','mscale','m2scale','pos','scale','pri','disp'].includes(operation))return;
  this.invalidate(layer,`Mixed PL ${operation} rectangle lifetime is not closed`);
 }
 snapshot(){return {version:1,sourceXMLSHA256:sourcePlaneDimensionsData.sourceXMLSHA256,entries:[...this.records].map(([bank,record])=>({bank,record:{...record}}))}}
 static restore(snapshot){
  if(!snapshot||Object.keys(snapshot).sort().join()!=='entries,sourceXMLSHA256,version'||snapshot.version!==1||snapshot.sourceXMLSHA256!==sourcePlaneDimensionsData.sourceXMLSHA256||!Array.isArray(snapshot.entries)||snapshot.entries.length>32)fail('Invalid source plane dimensions save');
  const result=new SourcePlaneDimensions();
  for(const item of snapshot.entries){
   if(!item||Object.keys(item).sort().join()!=='bank,record'||typeof item.bank!=='string'||!/^pl:(?:[0-9]|[12][0-9]|3[01])$/.test(item.bank)||result.records.has(item.bank))fail('Invalid source plane dimensions bank');
   const layer={group:'pl',id:item.bank.slice(3)},record=item.record;
   if(!record||typeof record!=='object')fail('Invalid source plane rectangle record');
   if(Object.keys(record).join()==='invalid'){
    if(typeof record.invalid!=='string'||record.invalid.length>256)fail('Invalid source plane dimensions rejection');result.invalidate(layer,record.invalid);continue;
   }
   if(Object.keys(record).sort().join()!=='endX,endY,height,origin,originX,originY,taskType,width'||!['sourceXML','sourceRectangleUpdate'].includes(record.origin))fail('Invalid source plane rectangle fields');
   if(record.origin==='sourceXML')result.initialize(layer);else result.updateRectangle(layer,record);
   const normalized=result.records.get(item.bank);if(Object.keys(normalized).some(field=>normalized[field]!==record[field]))fail('Non-normalized source plane rectangle');
  }
  return result;
 }
}
