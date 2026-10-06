// Source-backed empty-only adapter. No particle renderer, handle or camera matrix is created.
const TARGETS=new Set(['particle','particle2','particle3','epl']);
export function sourceNeutralResetPlan(cmd,args){
  if(!TARGETS.has(cmd))return null;
  if(typeof args!=='string')throw new Error('Invalid source neutral reset arguments');
  const text=args.trim().replace(/\s+/g,' ');
  if(cmd==='epl'){
    if(text==='')return {command:cmd,operation:'empty-reset',slots:[0,1,2,3,4,5,6,7]};
    if(text==='[0-5]')return {command:cmd,operation:'empty-reset',slots:[0,1,2,3,4,5]};
  }else{
    if(cmd==='particle'&&text==='stop')return {command:cmd,operation:'empty-stop',slots:[0,1,2,3]};
    const slot=/^([0-2]) stop$/.exec(text);
    if(slot)return {command:cmd,operation:'empty-stop',slots:[Number(slot[1])]};
  }
  throw new Error(`Unsupported source neutral reset: ${cmd} ${args}`);
}
export function withSourceNeutralResets(BaseRenderer){
  return class SourceNeutralResetRenderer extends BaseRenderer{
    constructor(options){
      const enabled=options?.sourceNeutralResets??false;
      if(typeof enabled!=='boolean')throw new Error('Invalid source neutral reset option');
      super(options);this.sourceNeutralResets=enabled;this.sourceNeutralResetEvents=[];
    }
    assertSourceNeutralEmpty(){
      if(!(this.layers instanceof Map))throw new Error('Source neutral reset requires the original layer map');
      for(const layer of this.layers.values())if(!layer||TARGETS.has(layer.group))
        throw new Error('Source neutral reset cannot accept a nonempty or foreign effect subsystem');
    }
    async command(cmd,args,state,...rest){
      if(!this.sourceNeutralResets||!TARGETS.has(cmd))return super.command(cmd,args,state,...rest);
      const plan=sourceNeutralResetPlan(cmd,args);
      this.assertSourceNeutralEmpty();
      this.sourceNeutralResetEvents.push({kind:'source-neutral-empty-reset',...plan,scope:'empty-subsystem-only'});
    }
  };
}
