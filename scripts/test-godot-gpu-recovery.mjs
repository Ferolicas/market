// Resource-level integration tests against real WebGL2, not a mocked renderer.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/home/ferney_oliveros/.local/bin/google-chrome',args:['--no-sandbox','--enable-gpu','--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan']});
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.setContent('<canvas width="64" height="64"></canvas>');
  await page.addScriptTag({path:'godot/web/context-recovery.js'});
  const result=await page.evaluate(async()=>{
    const gl=document.querySelector('canvas').getContext('webgl2',{preserveDrawingBuffer:true});
    let restoreResolve;
    const recovery=MarketWebGLRecovery.install(gl,{validate:true,pause(){},resume(){restoreResolve();}});
    const vertex=gl.createShader(gl.VERTEX_SHADER),fragment=gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vertex,'#version 300 es\nlayout(location=0) in vec2 position;out vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}');
    gl.shaderSource(fragment,'#version 300 es\nprecision highp float;in vec2 uv;uniform sampler2D poster;uniform vec4 tint;out vec4 color;void main(){color=texture(poster,uv)*tint;}');
    gl.compileShader(vertex);gl.compileShader(fragment);
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vertex);gl.deleteShader(fragment);gl.useProgram(program);
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const heap=new Float32Array(1024*1024);heap.set([-1,-1,3,-1,-1,3],9);gl.bufferData(gl.ARRAY_BUFFER,heap,gl.STATIC_DRAW,9,6);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(0);
    const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,texture);
    const bytes=new Uint8Array(1024*1024);bytes.set([128,255,64,255,128,255,64,255,128,255,64,255,128,255,64,255],4096);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes,4096);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    const font=gl.createTexture();gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,font);
    bytes.fill(255,65536,65536+256*256*2);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE_ALPHA,256,256,0,gl.LUMINANCE_ALPHA,gl.UNSIGNED_BYTE,bytes,65536);
    gl.activeTexture(gl.TEXTURE3);
    gl.uniform1i(gl.getUniformLocation(program,'poster'),3);
    // Earlier locations must survive even when the same uniform is queried again.
    const tint=gl.getUniformLocation(program,'tint');gl.getUniformLocation(program,'tint');
    heap.set([1,.5,1,1],137);gl.uniform4fv(tint,heap,137,4);
    const sampler=gl.createSampler();gl.samplerParameteri(sampler,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.samplerParameteri(sampler,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.bindSampler(3,sampler);
    const target=gl.createTexture();gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,target);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,64,64);
    const depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,64,64);
    const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Real render target incomplete');
    gl.viewport(0,0,64,64);
    const draw=()=>{gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return Array.from(pixels);};
    const before=draw();if(gl.getError()!==gl.NO_ERROR)throw Error('Invalid GPU fixture'); const frames=[];
    const extension=gl.getExtension('WEBGL_lose_context');
    for(let round=0;round<3;round++) {
      await new Promise(resolve=>{restoreResolve=resolve;extension.loseContext();});
      frames.push({pixels:draw(),error:gl.getError()});
    }
    return {before,frames,metrics:recovery.metrics};
  });
  assert.ok(result.before.some(value=>value!==0),'Fixture must draw pixels before loss');
  for(const [round,frame]of result.frames.entries()){
    assert.equal(frame.error,0,'No WebGL errors after restoration');
    assert.deepEqual(frame.pixels,result.before,'Exact GPU pixels after restoration '+round);
  }
  assert.deepEqual(errors,[]);
  assert.equal(result.metrics.restored,3);
  assert.equal(result.metrics.bytes,256*256*2+40,'Retain uploaded RGBA/font/buffer slices, not the entire WASM heap');
  console.log('PASS: 3 actual GPU losses, exact restored pixels, deleted shaders, VAO, buffer offsets, texture offsets and uniforms',result.metrics);
} finally {await browser.close();}
