// Isolated source-backed transition candidate: prepare old bitmap before real pump mutations.
import {expression,assign,splitIf,expand,messageText} from './expressions.js';
import {sourceCorrection,fesChoices} from './compatibility.js';
import {isCatalogSceneAbsent,KNOWN_NATIVE_CALL_ABSENT_TARGETS} from './scene-loader.js';

function replaySystemConfig(config) {
  if(config===undefined||config===null)return null;
  const result={sysflag:{boot:config.sysflag?.boot,kaisou:config.sysflag?.kaisou},sysstr:{boot:config.sysstr?.boot}};
  for(const value of [result.sysflag.boot,result.sysflag.kaisou,result.sysstr.boot]) {
    if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid replay system configuration');
  }
  return result;
}

export class ScriptVM {
  constructor({loadScene,helpers={},adapter=async()=>{},initial={},systemConfig,nativeCallAbsenceCompatibility=false,onNativePump=null,registerCG=async()=>{}}) {
    if(typeof registerCG!=='function')throw new Error('Invalid CG registration observer');
    if(onNativePump!==null&&typeof onNativePump!=='function')throw new Error('Invalid native pump observer');
    this.registerCG=registerCG;this.loadScene=loadScene;this.helpers=helpers;this.adapter=adapter;
    this.onNativePump=onNativePump;this.nativePumpPending=false;
    if(typeof nativeCallAbsenceCompatibility!=='boolean')throw new Error('Invalid native call absence policy');
    this.nativeCallAbsenceCompatibility=nativeCallAbsenceCompatibility;
    this.systemConfig=replaySystemConfig(systemConfig);
    this.initial=structuredClone(initial);this.reset();
    this.cache=new Map();this.busy=false;
  }
  reset(initial=this.initial,{mode}={}) {
    if(this.busy)throw new Error('Cannot reset while the scenario is running');
    const executionMode=mode??(this.systemConfig&&initial.numbers?.[this.systemConfig.sysflag.boot]===-2?'replay':'story');
    if(!['story','replay'].includes(executionMode))throw new Error('Invalid scenario execution mode');
    if(executionMode==='replay'&&!this.systemConfig)throw new Error('Missing replay system configuration');
    // Native boot mode is selected once when sscript starts. A later script
    // assignment to the boot flag must not change this execution's boundary.
    this.state={numbers:{...initial.numbers},strings:{10:'和仓',20:'贤一',...initial.strings},stack:[],name:'',message:'',choices:[],history:[],ended:false,unlockedCG:[],executionMode,replayBoundary:null};
    this.fault=null;
    this.compatibilityEvents=[];
  }
  async jump(id,call=false) {
    id=expand(id,this.state).replace(/\.cst$/i,'').toLowerCase();
    if(!/^[\w-]+$/.test(id))throw new Error(`Invalid scenario name ${id}`);
    if(!this.cache.has(id)) {
      let scene;
      try {scene=await this.loadScene(id)} catch(error) {
        const caller=this.state.stack.at(-1);
        if(this.nativeCallAbsenceCompatibility&&call&&caller&&KNOWN_NATIVE_CALL_ABSENT_TARGETS.includes(id)&&isCatalogSceneAbsent(error,id,this.loadScene)) {
          this.compatibilityEvents.push({kind:'native-call-load-failed',target:id,scene:caller.id,index:caller.index-1,
            action:'continue-caller',calleeExecuted:false,missingReferencePreserved:true,
            evidence:'kcs-loader-flow-review.json + kcs-call-dispatch-closure.json'});
          return false;
        }
        throw error;
      }
      if(!Array.isArray(scene?.lines))throw new Error(`Invalid scenario ${id}`);
      this.cache.set(id,scene);
    }
    if(!call)this.state.stack=[];
    if(this.state.stack.length>64)throw new Error('Scenario call depth exceeded');
    this.state.stack.push({id,index:0});
    this.state.ended=false;
    this.state.replayBoundary=null;
  }
  async start(id,{initial=this.initial,mode}={}) {this.reset(initial,{mode});await this.jump(id);return this.advance();}
  endEvent() {
    return this.state.replayBoundary===null?{type:'end'}:{type:'end',reason:'replay-boundary',replayId:this.state.replayBoundary};
  }
  async advance() {
    if(this.busy)return null;
    this.busy=true;this.nativePumpPending=true;
    try {
      if(this.fault)throw new Error(`Scenario stopped at ${this.fault.scene}:${this.fault.index}: ${this.fault.message}`);
      if(this.state.choices.length)throw new Error('Choose an option before continuing');
      this.state.name='';this.state.message='';
      for(let budget=0;budget<20000;budget++) {
        if(this.nativePumpPending){this.nativePumpPending=false;if(this.onNativePump)await this.onNativePump(this);}
        const frame=this.state.stack.at(-1);
        if(!frame){this.state.ended=true;return this.endEvent();}
        const scene=this.cache.get(frame.id)??await this.loadScene(frame.id);this.cache.set(frame.id,scene);
        const line=scene.lines[frame.index++];
        if(!line){this.state.stack.pop();this.nativePumpPending=true;continue;}
        if(line.type===0x2101){this.state.name=expand(line.text,this.state);continue;}
        if(line.type===0x2001){this.state.message+=messageText(line.text,this.state);continue;}
        if(line.type===0x201) {
          if(!this.state.message)continue;
          const event={type:'message',name:this.state.name,text:this.state.message,scene:frame.id,index:frame.index};
          this.state.history.push(event);if(this.state.history.length>500)this.state.history.shift();return event;
        }
        if(line.type!==0x3001)throw new Error(`Unsupported line type ${line.type}`);
        let event;
        try{event=await this.command(line.text,{scene:frame.id,index:frame.index-1})}catch(error){this.fault={scene:frame.id,index:frame.index-1,command:line.text,message:String(error?.message??error)};throw new Error(`${this.fault.scene}:${this.fault.index}: ${this.fault.message}`,{cause:error});}
        if(event)return event;
      }
      throw new Error('Scenario did not yield within 20000 instructions');
    } finally {this.busy=false;}
  }
  async choose(index) {
    if(this.busy)throw new Error('Scenario is busy');
    const option=this.state.choices[index];if(!Number.isInteger(index)||!option)throw new Error('Invalid choice');
    this.state.choices=[];
    if(option.kind==='fes')Object.assign(this.state.numbers,option.numbers);
    else await this.jump(option.scene);
    return this.advance();
  }
  snapshot(){if(this.busy||this.fault)throw new Error('Cannot save an unfinished scenario instruction');return structuredClone({version:2,systemConfig:this.systemConfig,state:this.state});}
  async validateSave(save) {
    if(![1,2].includes(save?.version)||!Array.isArray(save.state?.stack)||save.state.stack.length>65)throw new Error('Unsupported save');
    const state=structuredClone(save.state);
    if(save.version===1) {
      // Previous VM saves always continued across end_of_kaisou, even if the
      // saved numeric boot flag happened to be -2. Preserve that behavior.
      state.executionMode='story';state.replayBoundary=null;
    }else {
      if(!['story','replay'].includes(state.executionMode))throw new Error('Invalid saved execution mode');
      const config=replaySystemConfig(save.systemConfig);
      if(JSON.stringify(config)!==JSON.stringify(this.systemConfig))throw new Error('Saved replay system configuration mismatch');
      if(state.executionMode==='replay'&&!config)throw new Error('Missing saved replay system configuration');
      if(state.replayBoundary!==null&&(!Number.isSafeInteger(state.replayBoundary)||state.replayBoundary<0||!state.ended||state.executionMode!=='replay'||!Number.isSafeInteger(config.sysflag.kaisou+state.replayBoundary)))throw new Error('Invalid saved replay boundary');
    }
    for(const key of ['numbers','strings'])if(!state[key]||typeof state[key]!=='object'||Array.isArray(state[key]))throw new Error(`Invalid save ${key}`);
    if(Object.values(state.numbers).some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('Invalid saved numeric variable');
    if(Object.values(state.strings).some(value=>typeof value!=='string'))throw new Error('Invalid saved string variable');
    if(typeof state.name!=='string'||typeof state.message!=='string'||typeof state.ended!=='boolean'||!Array.isArray(state.history)||!Array.isArray(state.choices))throw new Error('Invalid saved dialogue');
    if(state.history.length>500||state.choices.length>100)throw new Error('Invalid saved event count');
    for(const entry of state.history)if(entry?.type!=='message'||typeof entry.name!=='string'||typeof entry.text!=='string')throw new Error('Invalid saved history');
    for(const option of state.choices)if(!Number.isInteger(option?.id)||typeof option.scene!=='string'||typeof option.text!=='string')throw new Error('Invalid saved choice');
    if(state.ended&&(state.stack.length||state.choices.length))throw new Error('Invalid ended save');
    for(const frame of state.stack) {
      if(typeof frame?.id!=='string'||!/^[\w-]+$/.test(frame.id))throw new Error('Invalid saved scenario');
      const scene=await this.loadScene(frame.id);
      if(!Number.isInteger(frame.index)||frame.index<0||frame.index>scene.lines.length)throw new Error('Invalid save position');
      this.cache.set(frame.id,scene);
    }
    for(const option of state.choices){const scene=await this.loadScene(option.scene.toLowerCase());if(!Array.isArray(scene?.lines))throw new Error('Invalid saved choice target');}
    if(state.choices.some(option=>option.kind==='fes')) {
      const frame=state.stack.at(-1),scene=frame&&this.cache.get(frame.id),source=scene?.lines[frame.index-1];
      const match=source?.type===0x3001&&/^fex sel (\S+)(?:\s+(.*))?$/.exec(source.text.trim());
      if(!match)throw new Error('Invalid saved FES selection position');
      const expected=fesChoices(match[1],match[2]?.split(/\s+/)??[],state,this.helpers,frame.id);
      if(JSON.stringify(state.choices)!==JSON.stringify(expected))throw new Error('Invalid saved FES options');
    }else if(state.choices.some(option=>option.kind!==undefined))throw new Error('Invalid saved choice kind');
    state.unlockedCG??=[];return state;
  }
  async restore(save) {
    if(this.busy)throw new Error('Scenario is busy');
    this.state=await this.validateSave(save);this.fault=null;
    if(this.state.ended)return this.endEvent();
    return {type:this.state.ended?'end':this.state.choices.length?'choice':'message',choices:this.state.choices,name:this.state.name,text:this.state.message};
  }
  compare(args,macros={}) {
    const match=/^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(args);
    if(!match)throw new Error(`Invalid strcmp ${args}`);
    const id=/^\d+$/.test(match[1])?match[1]:macros[match[1]];
    if(id===undefined)throw new Error(`Unknown strcmp target ${match[1]}`);
    const a=expand(match[2],this.state),b=expand(match[3]??'',this.state);
    this.state.numbers[id]=a===b?0:a<b?-1:1;
  }
  helper(id,section='start',depth=0) {
    id=expand(id,this.state).toLowerCase();
    const helper=this.helpers[id];if(!helper)throw new Error(`Missing FES helper ${id}`);
    const lines=helper.sections[section.toLowerCase()];if(!lines)throw new Error(`Missing FES section ${id}/${section}`);
    if(depth>64)throw new Error('FES call depth exceeded');
    const blocks=[];
    let active=true;
    const run=(line)=>{
      if(/^[#$]/.test(line)||line.startsWith('(')){assign(line,this.state,helper.macros);return;}
      const [cmd,...parts]=line.split(/\s+/),args=parts.join(' ');
      if(cmd==='if') {const [condition,body]=splitIf(line);const parsed=condition.replace(/\$(\d+|[A-Za-z_]\w*)\s*(==|!=)\s*([A-Za-z_]\w*)/g,(_,name,op,literal)=>{const key=/^\d+$/.test(name)?name:helper.macros[name];if(key===undefined)throw new Error(`Unknown FES variable ${name}`);return String(+(op==='=='?(this.state.strings[key]??'')===literal:(this.state.strings[key]??'')!==literal))});if(body){if(expression(parsed,this.state,helper.macros))return run(body);}else{const truth=active&&!!expression(parsed,this.state,helper.macros);blocks.push({parent:active,truth});active=truth;}return;}
      if(cmd==='strvar'){const match=/^(\S+)\s*(.*)$/.exec(args);const id=/^\d+$/.test(match[1])?match[1]:helper.macros[match[1]];if(id===undefined)throw new Error(`Unknown strvar ${line}`);this.state.strings[id]=expand(match[2],this.state);return;}
      if(cmd==='strcmp'){this.compare(args,helper.macros);return;}
      if(cmd==='call'){this.helper(id,args,depth+1);return;}
      if(cmd==='dbgstr')return;
      if(cmd==='exit'||cmd==='next')return 'stop';
      throw new Error(`Unsupported FES command ${id}: ${line}`);
    };
    for(const line of lines) {
      if(line==='else'){const block=blocks.at(-1);if(!block)throw new Error('FES else without if');active=block.parent&&!block.truth;continue;}
      if(line==='endif'){const block=blocks.pop();if(!block)throw new Error('FES endif without if');active=block.parent;continue;}
      if(!active){if(/^if\s*\(/.test(line)&&!splitIf(line)[1])blocks.push({parent:false,truth:false});continue;}
      if(run(line)==='stop')break;
    }
  }
  async command(source,location,applySourceCorrection=true) {
    let line=source.trim();if(!line)return;
    const correction=applySourceCorrection?sourceCorrection(line,location):null;
    if(correction){line=correction.replacement;this.compatibilityEvents.push(correction);}
    if(/^if\s*\(/.test(line)){const [condition,body]=splitIf(line);if(expression(condition,this.state))return this.command(body,location,false);return;}
    if(line.startsWith('#')||line.startsWith('(')){assign(line,this.state);return;}
    const match=/^(\S+)(?:\s+(.*))?$/.exec(line),cmd=match[1],raw=match[2]??'',args=expand(raw,this.state);
    // Set boundaries after actual source correction/nested-if execution.
    if(['next','wait','select','title','eyecatch','movie','ptsel','end','staffroll','fes','select2','fesds'].includes(cmd))this.nativePumpPending=true;
    if(cmd==='str'){const m=/^(\d+)\s*(.*)$/.exec(args);if(!m)throw new Error(`Invalid str: ${line}`);this.state.strings[m[1]]=m[2].trim();return;}
    if(cmd==='strcmp'){this.compare(raw);return;}
    if(cmd==='call'||cmd==='next'){await this.jump(args,cmd==='call');return;}
    if(cmd==='fesds'){const parts=raw.split(/\s+/);this.helper(parts[3]);return;}
    if(cmd==='fex') {
      // Native FES UI is replaced only for the two supplied, understood menus.
      // The app closes its choice dialog before choose() resumes the script.
      if(args==='end')return;
      const [operation,helper,...parts]=args.split(/\s+/);
      if(operation!=='sel')throw new Error(`Unsupported FES operation ${args}`);
      const frame=this.state.stack.at(-1);
      if(!frame)throw new Error('FES selection has no current scenario');
      const choices=fesChoices(helper,parts,this.state,this.helpers,frame.id);
      this.state.choices=choices;return {type:'choice',choices,scene:frame.id,index:location?.index};
    }
    if(cmd==='fselect') {
      const frame=this.state.stack.at(-1),scene=this.cache.get(frame.id),choices=[];
      while(frame.index<scene.lines.length) {
        const row=scene.lines[frame.index],choice=/^(\d+)\s+(\S+)\s+(.+)$/.exec(row.text.trim());
        if(row.type!==0x3001||!choice)break;
        frame.index++;choices.push({id:Number(choice[1]),scene:choice[2],text:expand(choice[3],this.state)});
      }
      if(!choices.length)throw new Error('Selection has no options');this.state.choices=choices;return {type:'choice',choices,scene:frame.id,index:location?.index};
    }
    if(cmd==='title'){this.state.stack=[];this.state.ended=true;return {type:'end'};}
    if(cmd==='end_of_kaisou') {
      if(!this.systemConfig)throw new Error('Missing replay system configuration');
      const id=expression(args,this.state),flag=this.systemConfig.sysflag.kaisou+id;
      if(!Number.isSafeInteger(id)||id<0||!Number.isSafeInteger(flag))throw new Error(`Invalid replay variable ${args}`);
      this.state.numbers[flag]=1;
      if(this.state.executionMode==='replay') {
        this.state.stack=[];this.state.choices=[];this.state.ended=true;this.state.replayBoundary=id;
        return this.endEvent();
      }
      return;
    }
    if(cmd==='cgflag'||cmd==='cgreg'){await this.registerCG(cmd,args);if(!this.state.unlockedCG.includes(args))this.state.unlockedCG.push(args);return;}
    await this.adapter(cmd,args,this.state,location??{scene:this.state.stack.at(-1)?.id,index:(this.state.stack.at(-1)?.index??1)-1});
  }
}
