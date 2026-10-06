import {galleryCatalog,validateExtraUnlockAll} from './extra-mode-catalog.js';

const require = (value, message) => { if (!value) throw new Error(message); };
const identity = value => {
  require(typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\r\n\0]/.test(value), 'Invalid CG registration request');
  return value.toLowerCase();
};

// This is the port's own persistent representation. It does not read or claim
// byte compatibility with the original native savegen.dat bitset.
export class CGRegistrationStore {
  constructor(storage, {cgLists, catalogSHA256, automaticPrefixes, shouldRegisterImage=()=>true}) {
    require(/^[a-f0-9]{64}$/.test(catalogSHA256), 'Invalid original CG catalog identity');
    require(JSON.stringify(automaticPrefixes) === '["E","e","H","h","D","d"]', 'Original automatic CG registration prefixes changed');
    require(typeof shouldRegisterImage==='function','Invalid automatic CG registration policy');
    this.shouldRegisterImage=shouldRegisterImage;
    this.storage=storage;this.cgLists=cgLists;this.catalogSHA256=catalogSHA256;this.automaticPrefixes=new Set(automaticPrefixes);this.key='amakano2plus-cg-registration-v1';
    const groups=cgLists['cglist.dat']?.groups;
    require(Array.isArray(groups)&&groups.length===98,'Original master CG list unavailable');
    this.groups=new Map();this.variants=new Map();
    for(const group of groups){
      const key=identity(group.name);require(!this.groups.has(key),'Duplicate original CG group');this.groups.set(key,group);
      require(Array.isArray(group.variants)&&group.variants.length,'Empty original CG group');
      for(const request of group.variants){const id=identity(request);require(!this.variants.has(id),'Duplicate original CG variant');this.variants.set(id,request)}
    }
    require(this.variants.size===2389,'Original master CG variant count changed');
  }
  read(){
    const raw=this.storage.getItem(this.key);
    if(raw===null)return {registered:[],unlistedRequests:[]};
    let data;try{data=JSON.parse(raw)}catch{throw new Error('CG鉴赏进度内容已损坏')}
    require(data?.version===1&&data.game==='Amakano 2+'&&data.catalogSHA256===this.catalogSHA256&&Array.isArray(data.registered)&&Array.isArray(data.unlistedRequests),'CG鉴赏进度版本或原版清单不兼容');
    require(data.registered.every(name=>this.variants.has(identity(name)))&&new Set(data.registered).size===data.registered.length,'CG鉴赏进度含无效差分');
    require(data.registered.every(name=>name===identity(name)),'CG鉴赏进度名称格式无效');
    for(const request of data.unlistedRequests)identity(request);
    return {registered:[...data.registered],unlistedRequests:[...data.unlistedRequests]};
  }
  write(data){this.storage.setItem(this.key,JSON.stringify({version:1,game:'Amakano 2+',catalogSHA256:this.catalogSHA256,...data}))}
  register(command,request){
    require(command==='cgflag'||command==='cgreg','Invalid CG registration command');
    const id=identity(request),data=this.read(),registered=new Set(data.registered);
    let additions;
    if(command==='cgflag'){
      const group=this.groups.get(id);require(group,`原版CG清单中没有登记组：${request}`);additions=group.variants.map(identity);
    }else additions=this.variants.has(id)?[id]:[];
    for(const name of additions)registered.add(name);
    if(!additions.length&&!data.unlistedRequests.includes(request))data.unlistedRequests.push(request);
    data.registered=[...this.variants.keys()].filter(name=>registered.has(name));
    this.write(data);return {command,request,registered:additions.length,listed:additions.length>0};
  }
  registerImage(request){
    // Observe only a successfully installed original image request. Keep
    // comma slot zeros/empties exactly; never derive aliases from filenames.
    const enabled=this.shouldRegisterImage();require(typeof enabled==='boolean','Invalid automatic CG registration policy result');
    if(!enabled||!this.automaticPrefixes.has(request?.[0]))return null;
    return this.register('cgreg',request);
  }
  migrateObservedSave(names){
    require(Array.isArray(names),'Invalid saved CG registrations');
    const requests=names.map(request=>({request,id:identity(request)})),data=this.read(),registered=new Set(data.registered);
    for(const {request,id} of requests){
      const additions=this.groups.has(id)?this.groups.get(id).variants.map(identity):this.variants.has(id)?[id]:[];
      for(const name of additions)registered.add(name);
      if(!additions.length&&!data.unlistedRequests.includes(request))data.unlistedRequests.push(request);
    }
    data.registered=[...this.variants.keys()].filter(name=>registered.has(name));this.write(data);
  }
  gallery(numbers,{unlockAll=false}={}){
    validateExtraUnlockAll(unlockAll);
    const registered=new Set(this.read().registered),groups=galleryCatalog(this.cgLists,numbers);
    const counts=[24,23,23,28];let group=0,start=0;
    return groups.map((entry,index)=>{
      while(index>=start+counts[group])start+=counts[group++];
      const variants=unlockAll?[...entry.variants]:entry.variants.filter(request=>registered.has(identity(request)));
      return {...entry,group,ordinal:index-start+1,page:Math.floor((index-start)/12),slot:(index-start)%12,variants,unlocked:variants.length>0};
    });
  }
}
