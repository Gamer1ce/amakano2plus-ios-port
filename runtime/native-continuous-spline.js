// Native320 count6 scalar coefficients and original mcSpline MOT arithmetic.
// This revision accepts the actual two 7000-frame control groups only.
const f=Math.fround,axes=['x','y','z'],times=[0,7000,14000,21000,28000,35000];
const fail=message=>{throw new TypeError(message)};
const exact=(v,keys)=>v&&Object.keys(v).sort().join()===keys.slice().sort().join();
const integer=v=>Number.isInteger(v)&&v>=-2147483648&&v<=2147483647;
function normalized(v){if(!exact(v,axes)||axes.some(a=>typeof v[a]!=='number'||!Number.isFinite(v[a])||f(v[a])!==v[a]))fail('Invalid source spline base XYZ');return {...v}}

function coefficients(values){
 const p=values.map((y,i)=>[times[i],f(y),0,0,0]),n=5;
 p[0][4]=f(p[1][0]-p[0][0]);p[1][3]=f(f(p[1][1]-p[0][1])/p[0][4]);
 for(let i=1;i<n;i++){
  p[i][4]=f(p[i+1][0]-p[i][0]);p[i][2]=f(f(p[i-1][4]+p[i][4])*f(2));
  p[i+1][3]=f(f(p[i+1][1]-p[i][1])/p[i][4]);p[i][3]=f(p[i+1][3]-p[i][3]);
 }
 p[0][2]=f(-p[0][4]);p[n][2]=f(-p[n-1][4]);
 p[0][3]=f(f(p[2][3]/f(p[3][0]-p[1][0]))-f(p[1][3]/f(p[2][0]-p[0][0])));
 p[n][3]=f(f(p[n-1][3]/f(p[n][0]-p[n-2][0]))-f(p[n-2][3]/f(p[n-1][0]-p[n-3][0])));
 // 0x57cd25/5e calls pow with double exponent2. Actual h=7000, then cvtsd2ss.
 p[0][3]=f(f(f(Math.pow(p[0][4],2))*p[0][3])/f(p[3][0]-p[1][0]));
 p[n][3]=f(-f(f(f(Math.pow(p[n-1][4],2))*p[n][3])/f(p[n][0]-p[n-3][0])));
 for(let i=1;i<=n;i++){
  const ratio=f(p[i-1][4]/p[i-1][2]);
  p[i][2]=f(p[i][2]-f(p[i-1][4]*ratio));p[i][3]=f(p[i][3]-f(p[i-1][3]*ratio));
 }
 p[n][3]=f(p[n][3]/p[n][2]);
 for(let i=n-1;i>=0;i--)p[i][3]=f(f(p[i][3]-f(p[i][4]*p[i+1][3]))/p[i][2]);
 p[n][2]=f(f(f(f(p[n][3]+p[n][3])+p[n-1][3])*p[n-1][4])+f(f(p[n][1]-p[n-1][1])/p[n-1][4]));
 for(let i=0;i<n;i++){
  const c=p[i][3],next=p[i+1][3],h=p[i][4];
  p[i][2]=f(f(f(p[i+1][1]-p[i][1])/h)-f(f(f(c+c)+next)*h));
  p[i][3]=f(c*f(3));p[i][4]=f(f(next-c)/h);
 }
 // Original 0x57d18b copies previous D to endpoint; endpoint C remains raw.
 p[n][4]=p[n-1][4];return p.map(row=>Object.freeze(row));
}

export function createNativeContinuousSpline(controlPoints,basePosition={x:0,y:0,z:0}){
 const base=normalized(basePosition);
 if(!Array.isArray(controlPoints)||controlPoints.length!==2)fail('Unclosed source spline point count');
 const control=controlPoints.map(v=>{
  if(!exact(v,['durationFrames','x','y','z'])||v.durationFrames!==7000||['x','y'].some(a=>!integer(v[a])||f(v[a])!==v[a])||v.z!==base.z)fail('Unclosed source spline control group');return Object.freeze({...v});
 });
 const records=Object.fromEntries(axes.map(axis=>[axis,Object.freeze(coefficients([0,...[0,1,0,1,0].map(i=>f(control[i][axis]-base[axis]))]))]));
 return Object.freeze({version:1,kind:'mcSpline',basePosition:Object.freeze(base),controlPoints:Object.freeze(control),records:Object.freeze(records)});
}

export function validateNativeContinuousSpline(plan){
 if(!exact(plan,['version','kind','basePosition','controlPoints','records'])||plan.version!==1||plan.kind!=='mcSpline'||!exact(plan.records,axes))fail('Invalid source spline plan');
 const rebuilt=createNativeContinuousSpline(plan.controlPoints,plan.basePosition);
 for(const axis of axes){
  if(!Array.isArray(plan.records[axis])||plan.records[axis].length!==6)fail('Invalid source spline record count');
  for(let i=0;i<6;i++)if(!Array.isArray(plan.records[axis][i])||plan.records[axis][i].length!==5||plan.records[axis][i].some((v,k)=>v!==rebuilt.records[axis][i][k]))fail('Invalid source spline coefficient');
 }
 return plan;
}
export function restoreNativeContinuousSpline(plan){validateNativeContinuousSpline(plan);return createNativeContinuousSpline(plan.controlPoints,plan.basePosition)}

export function sampleNativeContinuousSpline(plan,elapsedFrames,{stopRequested=false}={}){
 validateNativeContinuousSpline(plan);
 if(!Number.isInteger(elapsedFrames)||elapsedFrames<0||elapsedFrames>0xffffffff||typeof stopRequested!=='boolean')fail('Invalid source spline elapsed/stop');
 // mcSpline KCS264 >= knot4, signed remainder then add knot2. Units are source
 // Task frames (60/s), never milliseconds. Stop marks inactive and STILL samples.
 let time=elapsedFrames|0;if(time>=times[4])time=time%times[2]+times[2];time=f(time);
 let segment=0;while(segment<6&&!(time<times[segment]))segment++;
 if(segment>=6){segment=6;time=times[5]}if(segment>0)segment--;
 const dt=f(time-times[segment]),dt2=f(dt*dt),dt3=f(f(dt*dt)*dt),delta={};
 for(const axis of axes){const [,y,b,c,d]=plan.records[axis][segment];delta[axis]=f(f(f(y+f(b*dt))+f(c*dt2))+f(d*dt3))}
 return {delta,finished:stopRequested,roundWorkingPosition:false,sourceTime:time,segment};
}
