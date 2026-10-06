// Browser raster adapter for source XYZRHW triangle geometry. GPU framebuffer
// filtering/precision remains a native WebKit validation requirement.
export function createSourceRpflipPainter(canvas,old,mesh){
 const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)throw new Error('Source rpflip requires WebGL');
 const resources=[];let disposed=false;
 const cleanup=()=>{if(disposed)return;disposed=true;for(const [kind,value] of resources.reverse())gl[kind](value)};
 try{
  const shader=(type,source)=>{const value=gl.createShader(type);if(!value)throw new Error('Source rpflip shader allocation failed');resources.push(['deleteShader',value]);gl.shaderSource(value,source);gl.compileShader(value);if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw new Error('Source rpflip shader: '+gl.getShaderInfoLog(value));return value};
  const vertex=shader(gl.VERTEX_SHADER,`attribute vec4 xyZRhw;attribute vec2 uv;uniform vec2 viewport;varying vec2 tex;void main(){vec2 p=(xyZRhw.xy+vec2(0.5))/viewport;gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);tex=uv;}`);
  const fragment=shader(gl.FRAGMENT_SHADER,`precision highp float;uniform sampler2D oldFrame;varying vec2 tex;void main(){gl_FragColor=texture2D(oldFrame,tex);}`);
  const program=gl.createProgram();if(!program)throw new Error('Source rpflip program allocation failed');resources.push(['deleteProgram',program]);gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Source rpflip link: '+gl.getProgramInfoLog(program));gl.useProgram(program);
  const buffer=gl.createBuffer();if(!buffer)throw new Error('Source rpflip buffer allocation failed');resources.push(['deleteBuffer',buffer]);const texture=gl.createTexture();if(!texture)throw new Error('Source rpflip texture allocation failed');resources.push(['deleteTexture',texture]);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  const pos=gl.getAttribLocation(program,'xyZRhw'),uv=gl.getAttribLocation(program,'uv');if(pos<0||uv<0)throw new Error('Source rpflip attributes unavailable');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,4,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,24,16);
  gl.uniform2f(gl.getUniformLocation(program,'viewport'),mesh.width,mesh.height);gl.uniform1i(gl.getUniformLocation(program,'oldFrame'),0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  // Native render preset inherits MIN/MAG, whose boot value is POINT. This
  // candidate freezes that observed default; runtime filter changes are out of scope.
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,old);
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.viewport(0,0,mesh.width,mesh.height);
  return Object.freeze({paint(frame){if(disposed)throw new Error('Disposed source rpflip painter');if(!(frame?.vertices instanceof Float32Array)||frame.vertices.length!==mesh.vertexCount*6)throw new Error('Invalid source rpflip frame');gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.bufferData(gl.ARRAY_BUFFER,frame.vertices,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,mesh.vertexCount);const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('Source rpflip GPU error '+error)},dispose:cleanup});
 }catch(error){cleanup();throw error}
}
