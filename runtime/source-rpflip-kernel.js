// Transcribed only from this game's cs2.exe 5402d0/540920/540f70.
// Native SSE arithmetic is rounded at each scalar operation. The two original
// CRT trigonometric routines are represented by Math.sin/cos of the same F32
// argument; this is not a claim of bit-identical Windows CRT or GPU sampling.
const f=Math.fround;
const PI=f(3.1415927410125732),TAU=f(6.2831854820251465);
const require=(ok,message)=>{if(!ok)throw new Error('Source rpflip: '+message)};
const states=new WeakMap();
export function sourceDegreesToRadians(value){require(Number.isFinite(value),'finite degrees required');return f(f(f(value)*PI)/f(180))}
function rotateX(y,z,angle){const s=f(Math.sin(angle)),c=f(Math.cos(angle));return [f(f(z*s)+f(y*c)),f(f(z*c)-f(y*s))]}
function rotateZ(x,y,angle){const s=f(Math.sin(angle)),c=f(Math.cos(angle));return [f(f(x*c)+f(y*s)),f(f(y*c)-f(x*s))]}
function projected(x,y,z){
 const near=f(z-f(2000)),denominator=f(z-near),d=denominator===0?f(1):denominator;
 const factor=Math.max(0,f(f(2000)/d));
 return [f(x*factor),f(y*factor),f(z*f(1/65000)),f(f(1)/d)];
}
export function createSourceRpflipMesh({width,height,designWidth=1600,duration=58,direction=290,radius=256,angle=180,rangeTo=1000000}={}){
 require(Number.isSafeInteger(width)&&width>0&&width<=4096&&Number.isSafeInteger(height)&&height>0&&height<=4096,'bounded integer viewport required');
 require(designWidth===1600&&duration===58&&direction===290&&radius===256&&angle===180&&rangeTo===1000000,'only the three source-used specifications are supported');
 const orientation=sourceDegreesToRadians(direction),theta=sourceDegreesToRadians(angle),R=f(f(radius)*f(f(width)/f(designWidth)));
 const circumference=f(R*TAU),arcLength=f(f(theta/TAU)*circumference),depth=f(f(65000)-f(f(rangeTo)+f(1000)));
 const original=[],rotated=[];let minimum=f(100000),maximum=f(-100000);
 const push=(x,y,u,v)=>{
  // Original D3D XYZRHW vertices subtract 0.5; the browser backend compensates
  // that raster convention explicitly, without changing this source geometry.
  const X=f(f(x)-f(.5)),Y=f(f(y)-f(.5)),local=rotateZ(f(X-f(width/2)),f(Y-f(height/2)),orientation);
  minimum=Math.min(minimum,local[1]);maximum=Math.max(maximum,local[1]);
  const q=projected(0,0,depth);original.push(X,Y,q[2],q[3],f(u/width),f(v/height));rotated.push(local[0],local[1]);
 };
 for(let top=0;top<height;top+=32)for(let left=0;left<width;left+=32){const right=Math.min(left+32,width),bottom=Math.min(top+32,height);for(const [x,y] of [[left,top],[right,top],[left,bottom],[right,top],[right,bottom],[left,bottom]])push(x,y,x,y)}
 const back=rotateX(0,R,theta),directionVector=rotateX(1,0,theta);
 const value=Object.freeze({width,height,duration,vertexCount:original.length/6,triangleCount:original.length/18});
 states.set(value,{original:new Float32Array(original),rotated:new Float32Array(rotated),minimum,maximum,R,circumference,arcLength,depth,orientation,back:[back[0],f(back[1]-R)],directionVector});return value;
}
export function sampleSourceRpflipMesh(mesh,elapsed){
 const s=states.get(mesh);require(s,'owned mesh required');require(Number.isSafeInteger(elapsed)&&elapsed>=0&&elapsed<=0xffffffff,'uint32 elapsed required');
 const ratio=f(f(Math.min(elapsed,mesh.duration))/f(mesh.duration)),threshold=f(f(f(f(s.minimum-s.R)-s.maximum)*ratio)+s.maximum),vertices=s.original.slice();let curled=0,back=0;
 for(let n=0;n<mesh.vertexCount;n++){
  const X=s.rotated[n*2],Y=s.rotated[n*2+1];if(Y<threshold)continue;
  const diff=f(Y-threshold);let y,z;
  if(diff<s.arcLength){const a=f(f(f(diff/s.circumference)*PI)*f(2));[y,z]=rotateX(0,s.R,a);y=f(y+threshold);z=f(f(z-s.R)+s.depth);curled++}
  else{const d=f(diff-s.arcLength);y=f(f(f(s.directionVector[0]*d)+s.back[0])+threshold);z=f(f(f(s.directionVector[1]*d)+s.back[1])+s.depth);back++}
  const q=projected(X,y,z),xy=rotateZ(q[0],q[1],f(-s.orientation));const at=n*6;
  vertices[at]=f(xy[0]+f(mesh.width/2));vertices[at+1]=f(xy[1]+f(mesh.height/2));vertices[at+2]=q[2];vertices[at+3]=q[3];
 }
 return Object.freeze({elapsed:Math.min(elapsed,mesh.duration),finished:elapsed>=mesh.duration,threshold,curledVertices:curled,backVertices:back,vertices});
}
