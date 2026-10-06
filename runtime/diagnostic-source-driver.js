// Diagnostic source consumption only. Flags are written solely by the supplied actual VM.
export async function consumeOriginalScene(vm,{scene,initial,mode,onMessage=()=>{},maxEvents=10000}={}) {
  if(!['01_yuep','01_yu08h_end'].includes(scene)||mode!==(scene==='01_yuep'?'story':'replay'))throw new Error('Invalid original diagnostic entry');
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>10000||typeof onMessage!=='function')throw new Error('Invalid source-consumption bound');
  if(vm.busy)throw new Error('Scenario VM is busy');
  const original=vm.command,commands=[],messages=[];
  vm.command=async function(text,location,...rest){
    const before={clear:this.state.numbers[999]??0,replay1:this.state.numbers[901]??0};
    const result=await original.call(this,text,location,...rest);
    commands.push({text,location:location?{...location}:null,before,after:{clear:this.state.numbers[999]??0,replay1:this.state.numbers[901]??0}});
    return result;
  };
  try {
    let event=await vm.start(scene,{initial,mode}),events=0;
    while(event?.type==='message') {
      if(++events>maxEvents)throw new Error('Original diagnostic source bound exhausted');
      messages.push({scene:event.scene,index:event.index,name:event.name,text:event.text});await onMessage(event,events);
      event=await vm.advance();
    }
    if(event?.type!=='end')throw new Error('Original diagnostic encountered an unconsumed choice or non-end boundary');
    return {schemaVersion:1,diagnosticOnly:true,scope:'Standalone original source entry consumption; not a route from game start.',scene,mode,event,messages,commands,clearFlag:vm.state.numbers[999]??0,replay1Flag:vm.state.numbers[901]??0,observedCGRequests:[...vm.state.unlockedCG],globalsInjected:false,sourceCommandsSkipped:false};
  } finally {vm.command=original;}
}
