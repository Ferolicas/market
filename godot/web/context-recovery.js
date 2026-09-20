/* Mini Market's Godot 4.7.2 WebGL resource recovery.
 * Owns GPU reconstruction only. Game state, input and economy remain in WASM.
 * WebGL handles keep their JS identity for Emscripten's native object tables.
 * CPU mirrors contain current resource contents, never a per-frame command log.
 */
(() => {
  const installed = new WeakMap();
  function install(gl, lifecycle) {
    if (installed.has(gl)) return installed.get(gl);
    const native = {}, records = new WeakMap(), live = new Set(), reverse = new WeakMap();
    const extensions = new Map(), state = new Map(), pixels = new Map();
    const buffers = new Map(), textures = new Map(), indexedBuffers = new Map(), samplerUnits = new Map();
    const defaultVao = {attributes:new Map(), element:null}, defaultFramebuffer = {commands:new Map()};
    let vao = defaultVao, framebuffer = null, readFramebuffer = null, renderbuffer = null, program = null;
    let activeTexture = gl.TEXTURE0, restoring = false, lost = false, timer = 0;
    const metrics = {lost:0,restored:0,bytes:0,resources:0,restoreMs:0,copies:{}};
    for(let proto=gl;proto;proto=Object.getPrototypeOf(proto)) {
      for(const name of Object.getOwnPropertyNames(proto)) {
        const descriptor=Object.getOwnPropertyDescriptor(proto,name);
        if(typeof descriptor?.value==='function' && !native[name]) native[name]=descriptor.value.bind(gl);
      }
    }
    const rec = handle => handle ? records.get(handle) : null;
    const actual = value => {const record=value&&typeof value==='object'?rec(value):null;return record?record.actual:value;};
    const call = (name,args) => {
      const result=native[name](...args.map(actual));
      if(restoring&&lifecycle.validate) {const error=native.getError();if(error!==gl.NO_ERROR)throw Error('WebGL restore '+name+' failed: 0x'+error.toString(16)+' ('+args.map(value=>ArrayBuffer.isView(value)?value.constructor.name+'['+value.length+']':String(value)).join(',')+')');}
      return result;
    };
    const clone = value => ArrayBuffer.isView(value) ? value.slice() : Array.isArray(value) ? value.slice() : value;
    const remember = (map,key,name,args) => {map.delete(key);map.set(key,{name,args:args.map(clone)});};
    const replay = command => call(command.name,command.args);
    const bind = (target, handle) => call('bindBuffer',[target,handle]);
    const bufferRecord = target => target===gl.ELEMENT_ARRAY_BUFFER ? rec(vao.element) : rec(buffers.get(target));
    const textureTarget = target => target>=gl.TEXTURE_CUBE_MAP_POSITIVE_X && target<=gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? gl.TEXTURE_CUBE_MAP : target;
    const textureKey = target => activeTexture+':'+textureTarget(target);
    const textureRecord = target => rec(textures.get(textureKey(target)));
    function replaceBytes(record,bytes) {
      metrics.bytes += bytes.byteLength - (record.bytes?.byteLength ?? 0);
      record.bytes=bytes;
    }
    function create(kind,args,creator='create'+kind) {
      const handle=call(creator,args);
      if(!handle) return handle;
      const record={kind,creator,handle,actual:handle,args,commands:new Map(),attributes:new Map(),shaders:new Set(),uniforms:new Map(),locations:new Map(),deleted:false,element:null};
      records.set(handle,record); reverse.set(handle,handle); live.add(record);
      metrics.resources=live.size;
      return handle;
    }
    function remove(handle) {
      const record=rec(handle);
      if(!record) return;
      record.deleted=true; record.actual=null; live.delete(record);
      if(record.bytes) {metrics.bytes-=record.bytes.byteLength;record.bytes=null;}
      // A linked program still owns its deleted/attached shader source.
      if(record.kind==='Texture')for(const command of record.commands.values())metrics.bytes-=command.args.find(ArrayBuffer.isView)?.byteLength??0;
      if(record.kind!=='Shader') record.commands.clear();
      metrics.resources=live.size;
    }
    function trackUniform(name,args) {
      const location=rec(args[0]);
      if(!location)return;
      const values=args.slice(),index=values.findIndex(ArrayBuffer.isView);
      if(index>=0) {
        const data=values[index],offset=values[index+1]??0,length=values[index+2]||data.length-offset;
        const previous=location.owner.uniforms.get(location.uniformName)?.args[index];
        const copy=previous?.constructor===data.constructor&&previous.length===length?previous:new data.constructor(length);
        copy.set(data.subarray(offset,offset+length));values[index]=copy;
        if(values.length>index+1)values[index+1]=0;
      }
      location.owner.uniforms.set(location.uniformName,{name,args:values});
    }
    function capturePixels(name,args) {
      const values=args.slice();
      const compressed=name.startsWith('compressed');
      const three=name.endsWith('3D');
      const sub=name.includes('Sub');
      const dataIndex=compressed ? (three ? (sub?9:7) : (sub?7:6)) : (three?(sub?10:9):8);
      const data=values[dataIndex];
      if(ArrayBuffer.isView(data)) {
        const offset=values[dataIndex+1] ?? 0;
        let length;
        if(compressed) length=values[dataIndex+2] ?? data.length-offset;
        else {
          const width=values[three?(sub?5:3):(sub?4:3)];
          const height=values[three?(sub?6:4):(sub?5:4)];
          const depth=three?values[sub?7:5]:1;
          const format=values[dataIndex-2], type=values[dataIndex-1];
          const packed=[0x8033,0x8034,0x8363,0x8368,0x8c3b,0x8c3e,0x84fa,0x8dad].includes(type);
          const channels=packed?1:([gl.RGBA,gl.RGBA_INTEGER].includes(format)?4:[gl.RGB,gl.RGB_INTEGER].includes(format)?3:[gl.RG,gl.RG_INTEGER,gl.LUMINANCE_ALPHA].includes(format)?2:1);
          const bpp=channels*data.BYTES_PER_ELEMENT;
          const alignment=pixels.get(gl.UNPACK_ALIGNMENT)??4;
          const row=Math.ceil((pixels.get(gl.UNPACK_ROW_LENGTH)||width)*bpp/alignment)*alignment;
          const imageHeight=pixels.get(gl.UNPACK_IMAGE_HEIGHT)||height;
          const bytes=(pixels.get(gl.UNPACK_SKIP_IMAGES)||0)*row*imageHeight+(pixels.get(gl.UNPACK_SKIP_ROWS)||0)*row+(pixels.get(gl.UNPACK_SKIP_PIXELS)||0)*bpp+(depth-1)*row*imageHeight+(height-1)*row+width*bpp;
          length=Math.ceil(bytes/data.BYTES_PER_ELEMENT);
        }
        values[dataIndex]=data.slice(offset,offset+length);
        if(values.length>dataIndex+1) values[dataIndex+1]=0;
        if(compressed && values.length>dataIndex+2) values[dataIndex+2]=values[dataIndex].length;
      } else if(typeof data==='number' && buffers.get(gl.PIXEL_UNPACK_BUFFER)) {
        throw Error('GPU recovery: pixel unpack buffer uploads require a CPU mirror adapter');
      }
      return {name,args:values,pixels:new Map(pixels)};
    }
    function textureUpload(name,args) {
      const record=textureRecord(args[0]);
      if(!record) return;
      const command=capturePixels(name,args);
      const dataIndex=command.args.findIndex(ArrayBuffer.isView);
      const key=name+':'+args.slice(0,dataIndex<0?args.length:dataIndex).join(',');
      const old=record.commands.get(key);
      metrics.bytes-=(old?.args.find(ArrayBuffer.isView)?.byteLength??0);
      metrics.bytes+=(command.args.find(ArrayBuffer.isView)?.byteLength??0);
      record.commands.delete(key);record.commands.set(key,command);
      record.target=textureTarget(args[0]);
    }
    const globalMethods=new Set(['blendColor','blendEquation','blendEquationSeparate','blendFunc','blendFuncSeparate','clearColor','clearDepth','clearStencil','colorMask','cullFace','depthFunc','depthMask','depthRange','frontFace','hint','lineWidth','polygonOffset','sampleCoverage','scissor','stencilFunc','stencilFuncSeparate','stencilMask','stencilMaskSeparate','stencilOp','stencilOpSeparate','viewport']);
    const recordCall=(name,args)=>{
      if(name.startsWith('copyTex')||name==='copyBufferSubData')metrics.copies[name]=(metrics.copies[name]??0)+1;
      if(name==='bindBuffer') { if(args[0]===gl.ELEMENT_ARRAY_BUFFER) vao.element=args[1]; else buffers.set(args[0],args[1]); }
      else if(name==='bindBufferBase'||name==='bindBufferRange') { remember(indexedBuffers,args[0]+':'+args[1],name,args);buffers.set(args[0],args[2]); }
      else if(name==='bufferData') {
        const record=bufferRecord(args[0]); if(!record)return;
        const data=args[1];
        if(typeof data==='number') {if(record.bytes?.length===data)record.bytes.fill(0);else replaceBytes(record,new Uint8Array(data));}
        else {
          const offset=(args[3]??0)*data.BYTES_PER_ELEMENT;
          const length=(args[4]||data.length-(args[3]??0))*data.BYTES_PER_ELEMENT;
          replaceBytes(record,new Uint8Array(data.buffer,data.byteOffset+offset,length).slice());
        }
        record.usage=args[2]; record.target=args[0];
      } else if(name==='bufferSubData') {
        const record=bufferRecord(args[0]);if(!record?.bytes)return;
        const data=args[2],offset=(args[3]??0)*data.BYTES_PER_ELEMENT;
        const length=(args[4]||data.length-(args[3]??0))*data.BYTES_PER_ELEMENT;
        record.bytes.set(new Uint8Array(data.buffer,data.byteOffset+offset,length),args[1]);
      } else if(name==='copyBufferSubData') {
        const from=bufferRecord(args[0]),to=bufferRecord(args[1]);
        if(from?.bytes&&to?.bytes) to.bytes.set(from.bytes.slice(args[2],args[2]+args[4]),args[3]);
      } else if(name==='readPixels'&&typeof args[6]==='number') {
        const record=bufferRecord(gl.PIXEL_PACK_BUFFER);
        if(record?.bytes)native.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,record.bytes);
      } else if(name==='bindVertexArray') vao=rec(args[0])??defaultVao;
      else if(name==='vertexAttribPointer'||name==='vertexAttribIPointer') {
        vao.attributes.set('pointer:'+args[0],{name,args:args.slice(),buffer:buffers.get(gl.ARRAY_BUFFER)});
      } else if(name==='enableVertexAttribArray'||name==='disableVertexAttribArray') remember(vao.attributes,'enabled:'+args[0],name,args);
      else if(name==='vertexAttribDivisor') remember(vao.attributes,'divisor:'+args[0],name,args);
      else if(name.startsWith('vertexAttrib')) remember(state,name+':'+args[0],name,args);
      else if(name==='activeTexture') activeTexture=args[0];
      else if(name==='bindTexture') {textures.set(textureKey(args[0]),args[1]);const record=rec(args[1]);if(record)record.target=args[0];}
      else if(/^(compressedTex(Image|SubImage)|tex(Image|SubImage))[23]D$/.test(name)) textureUpload(name,args);
      else if(name==='texStorage2D'||name==='texStorage3D') {const record=textureRecord(args[0]);if(record)remember(record.commands,'storage',name,args);}
      else if(name==='texParameteri'||name==='texParameterf') {const record=textureRecord(args[0]);if(record)remember(record.commands,'parameter:'+args[1],name,args);}
      else if(name==='generateMipmap') {const record=textureRecord(args[0]);if(record)remember(record.commands,'mipmap',name,args);}
      else if(name==='pixelStorei') pixels.set(args[0],args[1]);
      else if(name==='bindRenderbuffer') renderbuffer=args[1];
      else if(name==='renderbufferStorage'||name==='renderbufferStorageMultisample') {const record=rec(renderbuffer);if(record)remember(record.commands,'storage',name,args);}
      else if(name==='bindFramebuffer') {
        if(args[0]!==gl.READ_FRAMEBUFFER) framebuffer=args[1];
        if(args[0]!==gl.DRAW_FRAMEBUFFER) readFramebuffer=args[1];
      } else if(name.startsWith('framebuffer')) {
        const record=rec(args[0]===gl.READ_FRAMEBUFFER?readFramebuffer:framebuffer);
        if(record)remember(record.commands,'attachment:'+args[1],name,args);
      } else if(name==='drawBuffers'||name==='readBuffer') remember((rec(name==='readBuffer'?readFramebuffer:framebuffer)??defaultFramebuffer).commands,name,name,args);
      else if(name==='shaderSource'||name==='compileShader') {const record=rec(args[0]);if(record)remember(record.commands,name,name,args);}
      else if(name==='attachShader') rec(args[0])?.shaders.add(rec(args[1]));
      else if(name==='detachShader') rec(args[0])?.shaders.delete(rec(args[1]));
      else if(name==='bindAttribLocation'||name==='transformFeedbackVaryings') {const record=rec(args[0]);if(record)remember(record.commands,name+':'+args[1],name,args);}
      else if(name==='linkProgram') {const record=rec(args[0]);if(record)record.linked=true;}
      else if(name==='useProgram') program=args[0];
      else if(name==='uniformBlockBinding') {const record=rec(args[0]);if(record)remember(record.commands,'block:'+args[1],name,args);}
      else if(name.startsWith('uniform')) trackUniform(name,args);
      else if(name==='bindSampler') samplerUnits.set(args[0],args[1]);
      else if(name==='samplerParameteri'||name==='samplerParameterf') {const record=rec(args[0]);if(record)remember(record.commands,args[1],name,args);}
      else if(name==='enable'||name==='disable') remember(state,'enabled:'+args[0],name,args);
      else if(globalMethods.has(name)) remember(state,name+(name.endsWith('Separate')||name==='hint'?':'+args[0]:''),name,args);
    };
    const originalGetExtension=native.getExtension;
    gl.getExtension=name=>{
      if(extensions.has(name))return extensions.get(name).proxy;
      const value=originalGetExtension(name);if(!value)return null;
      const extension={value,proxy:null};
      extension.proxy=new Proxy(value,{get(_target,key){
        const item=extension.value[key];
        if(typeof item!=='function')return item;
        return (...args)=>{
          if(['polygonOffsetClampEXT','clipControlEXT','polygonModeWEBGL'].includes(key))state.set('extension:'+key,{extension,name:key,args:args.slice()});
          return extension.value[key](...args.map(actual));
        };
      }});
      extensions.set(name,extension);return extension.proxy;
    };
    for(const name of Object.keys(native)) {
      if(name==='getExtension'||name==='constructor')continue;
      gl[name]=(...args)=>{
        if(name.startsWith('create'))return create(name.slice(6),args);
        if(name==='fenceSync')return create('Sync',args,name);
        if(name==='getUniformLocation') {
          const result=call(name,args);if(!result)return result;
          const owner=rec(args[0]);
          const record={kind:'UniformLocation',handle:result,actual:result,owner,uniformName:args[1]};
          records.set(result,record);if(!owner.locations.has(args[1]))owner.locations.set(args[1],new Set());owner.locations.get(args[1]).add(record);reverse.set(result,result);return result;
        }
        const result=call(name,args);
        if(name.startsWith('delete'))remove(args[0]);
        else if(!restoring)recordCall(name,args);
        return result&&typeof result==='object'?(reverse.get(result)??result):result;
      };
    }
    function restore() {
      const started=performance.now(); restoring=true;
      for(const [name,extension] of extensions)extension.value=originalGetExtension(name);
      // Linked programs retain shaders even after the engine deletes them.
      const all=new Set(live);
      for(const record of live)for(const shader of record.shaders)if(shader)all.add(shader);
      for(const record of all) {
        record.actual=call(record.creator,record.args);
        if(record.actual) {record.actual.name=record.handle.name;reverse.set(record.actual,record.handle);}
      }
      for(const record of all) if(record.kind==='Shader')for(const command of record.commands.values())replay(command);
      for(const record of live) {
        if(record.kind==='Program') {
          for(const shader of record.shaders)if(shader)call('attachShader',[record.handle,shader.handle]);
          for(const command of record.commands.values())if(command.name!=='uniformBlockBinding')replay(command);
          if(record.linked)call('linkProgram',[record.handle]);
          for(const locations of record.locations.values())for(const location of locations) {
            location.actual=call('getUniformLocation',[record.handle,location.uniformName]);
            if(location.actual)reverse.set(location.actual,location.handle);
          }
          call('useProgram',[record.handle]);
          for(const command of record.commands.values())if(command.name==='uniformBlockBinding')replay(command);
          for(const command of record.uniforms.values())replay(command);
        } else if(record.kind==='Buffer'&&record.bytes) {
          bind(record.target,record.handle);call('bufferData',[record.target,record.bytes,record.usage]);
        } else if(record.kind==='Texture') {
          call('bindTexture',[record.target,record.handle]);
          for(const command of record.commands.values()) {
            if(command.pixels)for(const [key,value] of command.pixels)call('pixelStorei',[key,value]);
            replay(command);
          }
        } else if(record.kind==='Renderbuffer') {
          call('bindRenderbuffer',[gl.RENDERBUFFER,record.handle]);for(const command of record.commands.values())replay(command);
        } else if(record.kind==='Sampler')for(const command of record.commands.values())replay(command);
      }
      for(const record of all)if(record.kind==='Shader'&&record.deleted)call('deleteShader',[record.handle]);
      for(const record of [defaultVao,...live]) {
        if(record!==defaultVao&&record.kind!=='VertexArray')continue;
        call('bindVertexArray',[record.handle??null]);
        bind(gl.ELEMENT_ARRAY_BUFFER,record.element);
        for(const command of record.attributes.values()) {
          if(command.buffer!==undefined) {if(!actual(command.buffer))continue;bind(gl.ARRAY_BUFFER,command.buffer);}
          replay(command);
        }
      }
      for(const record of [defaultFramebuffer,...live]) {
        if(record!==defaultFramebuffer&&record.kind!=='Framebuffer')continue;
        call('bindFramebuffer',[gl.FRAMEBUFFER,record.handle??null]);
        for(const command of record.commands.values())replay(command);
      }
      for(const command of state.values()) {
        if(command.extension)command.extension.value[command.name](...command.args);else replay(command);
      }
      for(const [key,value] of pixels)call('pixelStorei',[key,value]);
      for(const command of indexedBuffers.values())replay(command);
      for(const [target,handle] of buffers)bind(target,handle);
      for(const [key,handle] of textures) {
        const [unit,target]=key.split(':').map(Number);call('activeTexture',[unit]);call('bindTexture',[target,handle]);
      }
      for(const [unit,handle] of samplerUnits)call('bindSampler',[unit,handle]);
      call('activeTexture',[activeTexture]);call('bindVertexArray',[vao.handle??null]);
      call('bindFramebuffer',[gl.DRAW_FRAMEBUFFER,framebuffer]);call('bindFramebuffer',[gl.READ_FRAMEBUFFER,readFramebuffer]);
      call('bindRenderbuffer',[gl.RENDERBUFFER,renderbuffer]);call('useProgram',[program]);
      const error=native.getError();
      if(error!==gl.NO_ERROR)throw Error('WebGL resource restoration failed: 0x'+error.toString(16));
      restoring=false;lost=false;metrics.restored++;metrics.restoreMs=performance.now()-started;
      lifecycle.resume();
      gl.canvas.dispatchEvent(new CustomEvent('marketwebglrestored',{detail:{...metrics}}));
    }
    const recovery=gl.getExtension('WEBGL_lose_context');
    gl.canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();lost=true;metrics.lost++;lifecycle.pause();
      timer=setTimeout(()=>recovery?.restoreContext(),750);
      gl.canvas.dispatchEvent(new CustomEvent('marketwebgllost'));
    },true);
    gl.canvas.addEventListener('webglcontextrestored',()=>{
      clearTimeout(timer);
      try {restore();}catch(error){restoring=false;console.error('WebGL resource recovery failed',error);}
    },true);
    const api={metrics,get lost(){return lost;}};
    installed.set(gl,api);return api;
  }
  globalThis.MarketWebGLRecovery={install,inspect:gl=>installed.get(gl)?.metrics};
})();
