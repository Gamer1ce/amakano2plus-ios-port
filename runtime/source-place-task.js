// Source-used no-argument place sends subcommand2/value0 to the separate
// place.kcs task. Its receiver hides its own plane and sets its state to idle.
// This port owns that location overlay explicitly; it never resets scene layers.
import {argumentsOf} from './expressions.js';
export const SOURCE_PLACE_POLICY='port-owned-location-task-hide-v1';
const require=(value,message)=>{if(!value)throw new Error('Source place task: '+message)};
const owners=new WeakMap();
export function withSourcePlaceTask(BaseRenderer){
 return class SourcePlaceTaskRenderer extends BaseRenderer{
  constructor(options={},...rest){super(options,...rest);require(options.sourcePlaceTask===undefined||typeof options.sourcePlaceTask==='boolean','boolean option');const enabled=options.sourcePlaceTask===true,request=options.sourcePlaceRequestFrame??globalThis.requestAnimationFrame,cancel=options.sourcePlaceCancelFrame??globalThis.cancelAnimationFrame;if(enabled)require(typeof request==='function'&&typeof cancel==='function','frame scheduler');owners.set(this,{enabled,overlay:null,request,cancel,frame:null,generation:0,state:0})}
  hideSourcePlaceTask(){const own=owners.get(this);own.generation++;if(own.frame!==null){own.cancel(own.frame);own.frame=null}own.state=0;if(own.overlay)own.overlay.style.display='none'}
  // Explicit bridge for port UI owning the original location plane. Source
  // scenes never create this record by assuming that a PL bank is the place task.
  ownSourcePlaceOverlay(element,update){
   const own=owners.get(this);require(own.enabled,'disabled overlay bridge');require(element?.style&&typeof update==='function','owned overlay/update');
   this.hideSourcePlaceTask();own.overlay=element;own.state=1;const generation=own.generation;element.style.display='';
   const step=()=>{own.frame=null;if(own.generation!==generation||!own.state)return;update();if(own.generation===generation&&own.state)own.frame=own.request(step)};
   own.frame=own.request(step);return ()=>{if(own.generation===generation)this.hideSourcePlaceTask()};
  }
  async command(cmd,args,...rest){
   const own=owners.get(this);
   if(!own.enabled||cmd!=='place')return super.command(cmd,args,...rest);
   require(argumentsOf(args).length===0,'only the source-used no-argument form is supported');
   // Enter the same public cancellation protocol before consuming the command.
   await this.interruptSourceGlobalRestore?.();this.cancelPortMotionRestore?.();this.cancelSourceImageRestoreForNormalOperation?.();
   this.hideSourcePlaceTask();
  }
  reset(...rest){const own=owners.get(this);if(own){this.hideSourcePlaceTask();own.overlay?.remove?.();own.overlay=null}return super.reset(...rest)}
  snapshot(...rest){const data=super.snapshot(...rest),own=owners.get(this);if(!own.enabled)return data;require(own.state===0,'active port location overlay cannot be saved without its UI owner descriptor');return {...data,sourcePlaceTask:{version:1,policy:SOURCE_PLACE_POLICY,state:0}}}
  validateSave(saved,...rest){const data=super.validateSave(saved,...rest),own=owners.get(this),s=data.sourcePlaceTask;if(s!==undefined)require(own.enabled&&s?.version===1&&s.policy===SOURCE_PLACE_POLICY&&s.state===0&&Object.keys(s).length===3,'saved idle task');return data}
  async restore(saved,...rest){const data=this.validateSave(saved,...rest);const result=await super.restore(data,...rest);if(owners.get(this).enabled)this.hideSourcePlaceTask();return result}
  sourcePlaceDiagnostics(){const own=owners.get(this);return {enabled:own.enabled,policy:SOURCE_PLACE_POLICY,state:own.state,overlayOwned:!!own.overlay,scheduled:own.frame!==null}}
 };
}
