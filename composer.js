
(function(){
  "use strict";

  const RING_CIRC = 2 * Math.PI * 13;
  const FRAME_PRESETS = [
    {id:'16:9', w:960, h:540}, {id:'4:3', w:840, h:630}, {id:'1:1', w:760, h:760},
    {id:'4:5', w:720, h:900}, {id:'9:16', w:540, h:960}
  ];
  const CARD_RATIOS = [
    {id:'1:1', v:1}, {id:'4:3', v:4/3}, {id:'3:4', v:0.75},
    {id:'4:5', v:0.8}, {id:'16:9', v:16/9}, {id:'9:16', v:9/16}
  ];
  const ANCHORS = ['tl','tc','tr','ml','mc','mr','bl','bc','br'];
  const RES_MULTS = [1, 2, 3];

  const state = {
    frame: FRAME_PRESETS[2],
    layout: 'wall',
    params: {
      wall:   { zoom:60, tilt:15, gap:15, padding:6, cornerRadius:4, edgeFade:20, cardRatio:0.8, direction:'alternate', motion:'waypoints', hold:60 },
      globe:  { zoom:60, gap:25, padding:6, cornerRadius:4, edgeFade:20, cardRatio:1,   direction:'left', motion:'waypoints', hold:60 },
      tunnel: { zoom:55, gap:20, padding:6, cornerRadius:4, edgeFade:20, cardRatio:1,   direction:'left', motion:'waypoints', hold:55, twist:35, ringSpacing:55 }
    },
    bg: { mode:'color', color:'#050505', gradFrom:'#1b140f', gradTo:'#050505', gradAngle:180, img:null },
    loopDuration: 12,
    logo: { enabled:false, img:null, size:16, opacity:100, rotation:0, blend:'source-over', anchor:'br' },
    text: { enabled:false, content:'Studio Deadzolt', size:5, color:'#f2efea', weight:'600', anchor:'bc' },
    exportResMult: 1
  };

  let images = []; // {id, img, url, name, aspect, tex, focus:{x,y}}
  let nextId = 1;

  /* ---------------- dom ---------------- */
  const outputCanvas = document.getElementById('outputCanvas');
  const octx = outputCanvas.getContext('2d');
  const viewport = document.getElementById('viewport');
  const dropzone = document.getElementById('dropzone');
  const mediaDrop = document.getElementById('mediaDrop');
  const mediaInput = document.getElementById('mediaInput');
  const mediaList = document.getElementById('mediaList');
  const mediaCount = document.getElementById('mediaCount');
  const inspector = document.getElementById('inspector');
  const playBtn = document.getElementById('playBtn');
  const exportBtn = document.getElementById('exportBtn');
  const loopTimeEl = document.getElementById('loopTime');
  const ringFg = document.getElementById('ringFg');
  const toastEl = document.getElementById('toast');

  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>toastEl.classList.remove('show'), 2600);
  }
  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function smoothstep(t){ t = THREE.MathUtils.clamp(t,0,1); return t*t*(3-2*t); }

  /* ================= three.js scene ================= */

  const glCanvas = document.createElement('canvas');
  let renderer, scene, camera, cardGroup;

  function initThree(){
    renderer = new THREE.WebGLRenderer({canvas: glCanvas, antialias:true, alpha:true, preserveDrawingBuffer:true});
    if(renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cardGroup = new THREE.Group();
    scene.add(cardGroup);
    applyBackground();
    setCanvasSize(state.frame.w, state.frame.h);
  }

  function setCanvasSize(w, h){
    glCanvas.width = w; glCanvas.height = h;
    outputCanvas.width = w; outputCanvas.height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fxResize(w, h);
  }

  function applyFrameSize(){ setCanvasSize(state.frame.w, state.frame.h); }

  function applyBackground(){
    const b = state.bg;
    if(b.mode === 'gradient'){
      const gc = document.createElement('canvas'); gc.width = 64; gc.height = 64;
      const gctx = gc.getContext('2d');
      const rad = THREE.MathUtils.degToRad(b.gradAngle);
      const cx=32, cy=32, len=45;
      const x0 = cx-Math.cos(rad)*len, y0 = cy-Math.sin(rad)*len;
      const x1 = cx+Math.cos(rad)*len, y1 = cy+Math.sin(rad)*len;
      const grad = gctx.createLinearGradient(x0,y0,x1,y1);
      grad.addColorStop(0, b.gradFrom); grad.addColorStop(1, b.gradTo);
      gctx.fillStyle = grad; gctx.fillRect(0,0,64,64);
      scene.background = new THREE.CanvasTexture(gc);
    } else if(b.mode === 'image' && b.img){
      const tex = new THREE.Texture(b.img);
      tex.needsUpdate = true;
      scene.background = tex;
    } else {
      scene.background = new THREE.Color(b.color);
    }
  }

  const sharedGeo = () => (sharedGeo._g || (sharedGeo._g = new THREE.PlaneGeometry(1,1)));

  const CARD_VERT = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const CARD_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uUvScale;
    uniform vec2 uUvOffset;
    uniform float uRadius;
    uniform float uFeather;
    uniform float uFocus;
    float roundedMask(vec2 uv, float radius, float feather){
      vec2 p = abs(uv - 0.5);
      vec2 corner = p - (vec2(0.5) - radius);
      float d = length(max(corner, 0.0)) - radius;
      return 1.0 - smoothstep(0.0, feather + 0.001, d);
    }
    void main(){
      vec2 uv = clamp(vUv * uUvScale + uUvOffset, 0.0, 1.0);
      vec4 tex = texture2D(uTex, uv);
      float mask = roundedMask(vUv, uRadius, uFeather);
      float lum = dot(tex.rgb, vec3(0.299,0.587,0.114));
      vec3 desat = mix(tex.rgb, vec3(lum), (1.0-uFocus)*0.6);
      vec3 dimmed = desat * mix(0.5, 1.0, uFocus);
      gl_FragColor = vec4(dimmed, mask);
    }
  `;

  function coverUV(imgAspect, cardAspect, focus){
    focus = focus || {x:0.5, y:0.5};
    if(imgAspect > cardAspect){
      const s = cardAspect / imgAspect;
      return {scale:[s,1], offset:[(1-s)*focus.x, 0]};
    } else {
      const s = imgAspect / cardAspect;
      return {scale:[1,s], offset:[0, (1-s)*(1-focus.y)]};
    }
  }

  function makeCardMaterial(item, cardAspect, radiusFrac, featherFrac){
    const cov = coverUV(item.aspect, cardAspect, item.focus);
    return new THREE.ShaderMaterial({
      uniforms:{
        uTex:{value:item.tex},
        uUvScale:{value:new THREE.Vector2(cov.scale[0], cov.scale[1])},
        uUvOffset:{value:new THREE.Vector2(cov.offset[0], cov.offset[1])},
        uRadius:{value:radiusFrac},
        uFeather:{value:featherFrac},
        uFocus:{value:1}
      },
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      transparent:true,
      side: THREE.DoubleSide,
      depthWrite:true
    });
  }

  /* ================= layout building ================= */

  function currentParams(){ return state.params[state.layout]; }

  function rebuildLayout(){
    while(cardGroup.children.length){
      const m = cardGroup.children.pop();
      if(m.material) m.material.dispose();
    }
    const N = images.length;
    if(N === 0){ waypoints = []; visitOrder = []; return; }

    const p = currentParams();
    const radiusFrac = p.cornerRadius / 100;
    const featherFrac = (p.edgeFade / 100) * 0.15;
    const cellW = 1;
    const cellH = cellW / p.cardRatio;
    const planeW = cellW * (1 - p.padding/100);
    const planeH = cellH * (1 - p.padding/100);

    if(state.layout === 'wall'){
      const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
      const rows = Math.max(1, Math.ceil(N / cols));
      const spacingX = cellW * (1 + p.gap/100);
      const spacingY = cellH * (1 + p.gap/100);
      images.forEach((item, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = (col - (cols-1)/2) * spacingX;
        const y = ((rows-1)/2 - row) * spacingY;
        const mesh = new THREE.Mesh(sharedGeo(), makeCardMaterial(item, p.cardRatio, radiusFrac, featherFrac));
        mesh.position.set(x, y, 0);
        mesh.scale.set(planeW, planeH, 1);
        cardGroup.add(mesh);
      });
    } else if(state.layout === 'globe'){
      const radius = 2.1 * (1 + (p.gap/100)*1.6) * Math.sqrt(Math.max(N,1)/10);
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      images.forEach((item, i) => {
        const yFrac = N > 1 ? 1 - (i/(N-1))*2 : 0;
        const r = Math.sqrt(Math.max(0, 1 - yFrac*yFrac));
        const th = goldenAngle * i;
        const dir = new THREE.Vector3(Math.cos(th)*r, yFrac, Math.sin(th)*r);
        const pos = dir.clone().multiplyScalar(radius);
        const mesh = new THREE.Mesh(sharedGeo(), makeCardMaterial(item, p.cardRatio, radiusFrac, featherFrac));
        mesh.position.copy(pos);
        mesh.lookAt(pos.clone().multiplyScalar(2));
        mesh.scale.set(planeW, planeH, 1);
        cardGroup.add(mesh);
      });
    } else { // tunnel
      const twistRad = THREE.MathUtils.degToRad(p.twist);
      const zSpacing = 0.35 + (p.ringSpacing/100) * 1.3;
      const radius = 1.3 * (1 + (p.gap/100));
      images.forEach((item, i) => {
        const angle = twistRad * i;
        const z = (i - (N-1)/2) * zSpacing;
        const pos = new THREE.Vector3(Math.cos(angle)*radius, Math.sin(angle)*radius, z);
        const mesh = new THREE.Mesh(sharedGeo(), makeCardMaterial(item, p.cardRatio, radiusFrac, featherFrac));
        mesh.position.copy(pos);
        mesh.lookAt(new THREE.Vector3(0, 0, z));
        mesh.scale.set(planeW, planeH, 1);
        cardGroup.add(mesh);
      });
    }
    computeWaypoints();
  }

  function updateShaderUniformsOnly(){
    const p = currentParams();
    const radiusFrac = p.cornerRadius / 100;
    const featherFrac = (p.edgeFade / 100) * 0.15;
    cardGroup.children.forEach(mesh => {
      mesh.material.uniforms.uRadius.value = radiusFrac;
      mesh.material.uniforms.uFeather.value = featherFrac;
    });
  }

  /* ================= flythrough waypoints ================= */

  let waypoints = [];   // {look: Vector3, pullDir: Vector3} per card, build order
  let visitOrder = [];  // indices into waypoints, camera visit order
  let segDistances = []; // geometric distance (or angle, for globe) between consecutive visited waypoints

  function computeWaypoints(){
    waypoints = cardGroup.children.map(mesh => {
      const look = mesh.position.clone();
      let pullDir;
      if(state.layout === 'wall') pullDir = new THREE.Vector3(0,0,1);
      else if(state.layout === 'globe') pullDir = (look.lengthSq()>1e-6 ? look.clone().normalize() : new THREE.Vector3(0,0,1));
      else { const radial = new THREE.Vector3(look.x, look.y, 0); pullDir = (radial.lengthSq()>1e-6 ? radial.normalize().negate() : new THREE.Vector3(1,0,0)); }
      return {look, pullDir};
    });
    if(state.layout === 'globe'){
      visitOrder = waypoints.map((_,i)=>i).sort((a,b) =>
        Math.atan2(waypoints[a].look.z, waypoints[a].look.x) - Math.atan2(waypoints[b].look.z, waypoints[b].look.x)
      );
    } else {
      visitOrder = waypoints.map((_,i)=>i); // wall: row-major; tunnel: build order along the spiral
    }
    // precompute the "distance" of each transit so segment TIME can later be weighted by it —
    // otherwise a short hop and a long hop take the same time and the long one whips past.
    segDistances = visitOrder.map((idx, k) => {
      if(visitOrder.length < 2) return 1;
      const nextIdx = visitOrder[(k+1) % visitOrder.length];
      const A = waypoints[idx].look, B = waypoints[nextIdx].look;
      if(state.layout === 'globe'){
        const dirA = _sA.copy(A).normalize(), dirB = _sB.copy(B).normalize();
        return Math.max(0.05, Math.acos(THREE.MathUtils.clamp(dirA.dot(dirB), -1, 1)));
      }
      return Math.max(0.05, A.distanceTo(B));
    });
  }

  // reusable scratch vectors so the render loop doesn't allocate ~10 Vector3s every frame
  // (per-frame allocation churn is a common, easy-to-miss cause of animation stutter)
  const _sA = new THREE.Vector3(), _sB = new THREE.Vector3(), _sRel = new THREE.Vector3();
  const _sDirA = new THREE.Vector3(), _sDirB = new THREE.Vector3(), _sCamDir = new THREE.Vector3();
  const _sCamA = new THREE.Vector3(), _sCamB = new THREE.Vector3(), _sLook = new THREE.Vector3();

  function slerpInto(out, a, b, t){
    const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
    if(dot > 0.9995) return out.copy(a).lerp(b, t).normalize();
    const theta = Math.acos(dot) * t;
    _sRel.copy(b).addScaledVector(a, -dot).normalize();
    return out.copy(a).multiplyScalar(Math.cos(theta)).addScaledVector(_sRel, Math.sin(theta));
  }

  function smootherstep(t){
    t = THREE.MathUtils.clamp(t, 0, 1);
    return t*t*t*(t*(t*6-15)+10);
  }

  function maybeSuggestDuration(){
    const N = images.length;
    if(N === 0) return;
    const suggested = Math.min(40, Math.max(6, Math.round(N*1.6*2)/2));
    if(state.loopDuration < N*1.1) state.loopDuration = suggested;
  }

  /* ================= effects post-pass (ported from Forge 2D) ================= */

  const fxCanvas = document.createElement('canvas');
  const fxgl = fxCanvas.getContext('webgl', {preserveDrawingBuffer:true, antialias:false, alpha:false})
            || fxCanvas.getContext('experimental-webgl');

  const FX_VERT = `attribute vec2 aPos; varying vec2 vUv; void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }`;
  const FX_COPY_FRAG = `precision highp float; varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor=texture2D(uTex,vUv); }`;
  const FX_BLOOM_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uThreshold; uniform float uIntensity; uniform float uRadius;
    void main(){
      vec4 base = texture2D(uTex, vUv);
      vec2 texel = (1.0/uResolution) * uRadius;
      vec3 bloom = vec3(0.0); float total = 0.0;
      for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){
        vec2 offset = vec2(float(x), float(y)) * texel;
        vec3 s = texture2D(uTex, vUv+offset).rgb;
        float lum = dot(s, vec3(0.299,0.587,0.114));
        bloom += s * smoothstep(uThreshold, 1.0, lum);
        total += 1.0;
      }}
      bloom /= total;
      gl_FragColor = vec4(base.rgb + bloom*uIntensity, base.a);
    }
  `;
  const FX_HALFTONE_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uScale; uniform float uAngle; uniform float uContrast;
    void main(){
      vec2 pixel = vUv * uResolution;
      float c = cos(uAngle), s = sin(uAngle);
      mat2 rot = mat2(c,-s,s,c); mat2 rotInv = mat2(c,s,-s,c);
      vec2 p = rot * pixel;
      vec2 cellRot = (floor(p/uScale)+0.5) * uScale;
      vec2 cellPixel = rotInv * cellRot;
      vec2 cellUv = clamp(cellPixel/uResolution, 0.0, 1.0);
      vec3 color = texture2D(uTex, cellUv).rgb;
      float lum = dot(color, vec3(0.299,0.587,0.114));
      lum = clamp((lum-0.5)*uContrast+0.5, 0.0, 1.0);
      float local = length(p - cellRot);
      float radius = (1.0-lum) * uScale * 0.62;
      float dot_ = 1.0 - smoothstep(radius-1.0, radius+1.0, local);
      gl_FragColor = vec4(mix(vec3(1.0), vec3(0.0), dot_), 1.0);
    }
  `;
  const FX_DITHER_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uLevels; uniform float uScale;
    float bayerValue(vec2 pos){
      float x = mod(floor(pos.x), 4.0); float y = mod(floor(pos.y), 4.0);
      float idx = y*4.0+x;
      if(idx<0.5) return 0.0/16.0; else if(idx<1.5) return 8.0/16.0;
      else if(idx<2.5) return 2.0/16.0; else if(idx<3.5) return 10.0/16.0;
      else if(idx<4.5) return 12.0/16.0; else if(idx<5.5) return 4.0/16.0;
      else if(idx<6.5) return 14.0/16.0; else if(idx<7.5) return 6.0/16.0;
      else if(idx<8.5) return 3.0/16.0; else if(idx<9.5) return 11.0/16.0;
      else if(idx<10.5) return 1.0/16.0; else if(idx<11.5) return 9.0/16.0;
      else if(idx<12.5) return 15.0/16.0; else if(idx<13.5) return 7.0/16.0;
      else if(idx<14.5) return 13.0/16.0; else return 5.0/16.0;
    }
    void main(){
      vec2 pixel = vUv * uResolution / uScale;
      vec3 color = texture2D(uTex, vUv).rgb;
      float threshold = bayerValue(pixel) - 0.5;
      vec3 result = floor(color*uLevels + threshold + 0.5) / uLevels;
      gl_FragColor = vec4(clamp(result,0.0,1.0), 1.0);
    }
  `;
  const FX_GRAIN_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uIntensity; uniform float uScale; uniform float uTheta;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
      vec2 u=f*f*(3.0-2.0*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    void main(){
      vec3 color = texture2D(uTex, vUv).rgb;
      vec2 pixel = vUv * uResolution / uScale;
      vec2 spin = vec2(cos(uTheta), sin(uTheta)) * 9.0;
      float n1 = noise(pixel+spin), n2 = noise(pixel*1.7-spin+31.7);
      float grain = (n1+n2)*0.5 - 0.5;
      gl_FragColor = vec4(clamp(color+grain*uIntensity, 0.0, 1.0), 1.0);
    }
  `;

  const FX_EFFECTS = [
    {id:'bloom', label:'Bloom', enabled:false, frag:FX_BLOOM_FRAG,
      params:[ {key:'threshold',min:0,max:1,step:0.01,default:0.55},
               {key:'intensity',min:0,max:2,step:0.01,default:0.9},
               {key:'radius',min:0.5,max:5,step:0.1,default:2.0} ]},
    {id:'halftone', label:'Halftone', enabled:false, frag:FX_HALFTONE_FRAG,
      params:[ {key:'scale',min:4,max:40,step:1,default:10,pixelSpace:true},
               {key:'angle',min:0,max:90,step:1,default:15,degrees:true},
               {key:'contrast',min:0.5,max:3,step:0.05,default:1.2} ]},
    {id:'dither', label:'Dither', enabled:false, frag:FX_DITHER_FRAG,
      params:[ {key:'levels',min:2,max:16,step:1,default:4},
               {key:'scale',min:1,max:8,step:1,default:2,pixelSpace:true} ]},
    {id:'grain', label:'Grain', enabled:false, frag:FX_GRAIN_FRAG,
      params:[ {key:'intensity',min:0,max:0.5,step:0.005,default:0.06},
               {key:'scale',min:1,max:20,step:0.5,default:3,pixelSpace:true} ]}
  ];

  let fxVertShader, fxCopyProgram, fxQuadBuf, fxSourceTex, fxPing, fxPong, fxW=0, fxH=0;

  function fxCompile(src, type){
    const sh = fxgl.createShader(type); fxgl.shaderSource(sh, src); fxgl.compileShader(sh);
    if(!fxgl.getShaderParameter(sh, fxgl.COMPILE_STATUS)) console.error(fxgl.getShaderInfoLog(sh));
    return sh;
  }
  function fxBuildProgram(fragSrc){
    const fs = fxCompile(fragSrc, fxgl.FRAGMENT_SHADER);
    const prog = fxgl.createProgram();
    fxgl.attachShader(prog, fxVertShader); fxgl.attachShader(prog, fs); fxgl.linkProgram(prog);
    if(!fxgl.getProgramParameter(prog, fxgl.LINK_STATUS)) console.error(fxgl.getProgramInfoLog(prog));
    return prog;
  }
  function fxCreateTexture(w,h){
    const tex = fxgl.createTexture();
    fxgl.bindTexture(fxgl.TEXTURE_2D, tex);
    fxgl.texParameteri(fxgl.TEXTURE_2D, fxgl.TEXTURE_WRAP_S, fxgl.CLAMP_TO_EDGE);
    fxgl.texParameteri(fxgl.TEXTURE_2D, fxgl.TEXTURE_WRAP_T, fxgl.CLAMP_TO_EDGE);
    fxgl.texParameteri(fxgl.TEXTURE_2D, fxgl.TEXTURE_MIN_FILTER, fxgl.LINEAR);
    fxgl.texParameteri(fxgl.TEXTURE_2D, fxgl.TEXTURE_MAG_FILTER, fxgl.LINEAR);
    if(w && h) fxgl.texImage2D(fxgl.TEXTURE_2D, 0, fxgl.RGBA, w, h, 0, fxgl.RGBA, fxgl.UNSIGNED_BYTE, null);
    return tex;
  }
  function fxCreateFBO(w,h){
    const tex = fxCreateTexture(w,h);
    const fbo = fxgl.createFramebuffer();
    fxgl.bindFramebuffer(fxgl.FRAMEBUFFER, fbo);
    fxgl.framebufferTexture2D(fxgl.FRAMEBUFFER, fxgl.COLOR_ATTACHMENT0, fxgl.TEXTURE_2D, tex, 0);
    fxgl.bindFramebuffer(fxgl.FRAMEBUFFER, null);
    return {fbo, tex};
  }
  function fxDrawQuad(program){
    const loc = fxgl.getAttribLocation(program, 'aPos');
    fxgl.bindBuffer(fxgl.ARRAY_BUFFER, fxQuadBuf);
    fxgl.enableVertexAttribArray(loc);
    fxgl.vertexAttribPointer(loc, 2, fxgl.FLOAT, false, 0, 0);
    fxgl.drawArrays(fxgl.TRIANGLES, 0, 3);
  }

  function initFx(){
    if(!fxgl) return;
    fxVertShader = fxCompile(FX_VERT, fxgl.VERTEX_SHADER);
    fxCopyProgram = fxBuildProgram(FX_COPY_FRAG);
    FX_EFFECTS.forEach(fx => {
      fx.program = fxBuildProgram(fx.frag);
      fx.uniforms = { uTex: fxgl.getUniformLocation(fx.program,'uTex'), uResolution: fxgl.getUniformLocation(fx.program,'uResolution') };
      fx.params.forEach(p => { fx.uniforms[p.key] = fxgl.getUniformLocation(fx.program, 'u'+p.key[0].toUpperCase()+p.key.slice(1)); p.value = p.default; });
      if(fx.id === 'grain') fx.uniforms.uTheta = fxgl.getUniformLocation(fx.program, 'uTheta');
    });
    fxQuadBuf = fxgl.createBuffer();
    fxgl.bindBuffer(fxgl.ARRAY_BUFFER, fxQuadBuf);
    fxgl.bufferData(fxgl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), fxgl.STATIC_DRAW);
    fxSourceTex = fxCreateTexture(0,0);
  }

  function fxResize(w,h){
    if(!fxgl) return;
    fxCanvas.width = w; fxCanvas.height = h;
    fxPing = fxCreateFBO(w,h);
    fxPong = fxCreateFBO(w,h);
    fxW = w; fxH = h;
  }

  function fxHasActive(){ return fxgl && FX_EFFECTS.some(f => f.enabled); }

  function fxRun(sourceCanvas, theta, pixelScaleMult){
    fxgl.pixelStorei(fxgl.UNPACK_FLIP_Y_WEBGL, true);
    fxgl.bindTexture(fxgl.TEXTURE_2D, fxSourceTex);
    fxgl.texImage2D(fxgl.TEXTURE_2D, 0, fxgl.RGBA, fxgl.RGBA, fxgl.UNSIGNED_BYTE, sourceCanvas);
    fxgl.pixelStorei(fxgl.UNPACK_FLIP_Y_WEBGL, false);

    fxgl.viewport(0,0,fxW,fxH);
    const active = FX_EFFECTS.filter(f => f.enabled);
    let srcTex = fxSourceTex, pingIsTarget = true;

    active.forEach((fx, i) => {
      const isLast = i === active.length-1;
      const target = isLast ? null : (pingIsTarget ? fxPing : fxPong);
      fxgl.bindFramebuffer(fxgl.FRAMEBUFFER, target ? target.fbo : null);
      fxgl.useProgram(fx.program);
      fxgl.activeTexture(fxgl.TEXTURE0); fxgl.bindTexture(fxgl.TEXTURE_2D, srcTex);
      fxgl.uniform1i(fx.uniforms.uTex, 0);
      fxgl.uniform2f(fx.uniforms.uResolution, fxW, fxH);
      fx.params.forEach(p => {
        let v = p.degrees ? (p.value*Math.PI/180) : p.value;
        if(p.pixelSpace) v = v * (pixelScaleMult||1);
        fxgl.uniform1f(fx.uniforms[p.key], v);
      });
      if(fx.id === 'grain') fxgl.uniform1f(fx.uniforms.uTheta, theta);
      fxDrawQuad(fx.program);
      if(!isLast){ srcTex = target.tex; pingIsTarget = !pingIsTarget; }
    });
  }

  /* ================= animation ================= */

  let isPlaying = false, sessionStart = 0, pausedElapsed = 0, exporting = false;

  function currentElapsed(now){ return isPlaying ? pausedElapsed + (now-sessionStart)/1000 : pausedElapsed; }

  function render(now){
    requestAnimationFrame(render);
    if(window.FORGE_MODE !== 'shaders') return;
    if(images.length === 0) return;

    const duration = Math.max(1, state.loopDuration);
    const elapsed = currentElapsed(now);
    const phase = ((elapsed % duration) + duration) % duration;
    const theta = (phase/duration) * Math.PI * 2;

    const p = currentParams();
    cardGroup.rotation.x = state.layout === 'wall' ? THREE.MathUtils.degToRad(p.tilt) : 0;

    let segIndex = -1, nextIndex = -1, localT = 0;

    if(p.motion === 'waypoints' && visitOrder.length > 0){
      cardGroup.rotation.y = 0;
      const segCount = visitOrder.length;
      const holdFrac = THREE.MathUtils.clamp(p.hold/100, 0, 0.9);
      const totalDist = segDistances.reduce((s,d)=>s+d, 0) || segCount;
      const holdEach = (duration*holdFrac) / segCount;
      const transitBudget = duration * (1-holdFrac);

      // walk the segments once to find which one 'phase' currently falls in — segments are
      // NOT equal-length: a long hop between waypoints gets proportionally more transit time
      // than a short hop, so the camera moves at a roughly consistent speed instead of
      // crawling on short hops and whipping across long ones.
      let acc = 0, segDur = 0, localPos = 0;
      for(let k=0; k<segCount; k++){
        const transitK = transitBudget * (segDistances[k]/totalDist);
        segDur = Math.max(0.0001, holdEach + transitK);
        if(phase < acc+segDur || k === segCount-1){ segIndex = k; localPos = phase - acc; break; }
        acc += segDur;
      }
      const transitK = Math.max(0.0001, segDur - holdEach);

      let settleT = 0;
      if(localPos < holdEach){
        const holdProgress = holdEach>0 ? localPos/holdEach : 1;
        const settleWindow = 0.35;
        settleT = holdProgress < settleWindow ? 1 - smootherstep(holdProgress/settleWindow) : 0;
        localT = 0;
      } else {
        localT = smootherstep((localPos-holdEach)/transitK);
      }

      const a = waypoints[visitOrder[segIndex]];
      nextIndex = visitOrder[(segIndex+1) % segCount];
      const b = waypoints[nextIndex];
      _sLook.copy(a.look).lerp(b.look, localT);

      if(state.layout === 'globe'){
        const camDist = THREE.MathUtils.lerp(5.5, 1.2, p.zoom/100) * (1 + 0.12*settleT);
        _sDirA.copy(a.look).normalize(); _sDirB.copy(b.look).normalize();
        slerpInto(_sCamDir, _sDirA, _sDirB, localT);
        const rPrime = a.look.length()*(1-localT) + b.look.length()*localT + camDist;
        camera.position.copy(_sCamDir.multiplyScalar(rPrime));
      } else {
        const camDist = THREE.MathUtils.lerp(state.layout==='tunnel'?1.7:4.2, state.layout==='tunnel'?0.35:1.1, p.zoom/100) * (1 + 0.12*settleT);
        _sCamA.copy(a.look).addScaledVector(a.pullDir, camDist);
        _sCamB.copy(b.look).addScaledVector(b.pullDir, camDist);
        camera.position.copy(_sCamA.lerp(_sCamB, localT));
      }
      camera.lookAt(_sLook);
    } else {
      camera.position.set(0, 0, THREE.MathUtils.lerp(11, 2.4, p.zoom/100));
      camera.lookAt(0,0,0);
      if(p.direction === 'alternate') cardGroup.rotation.y = THREE.MathUtils.degToRad(18) * Math.sin(theta);
      else cardGroup.rotation.y = (p.direction === 'left' ? -theta : theta);
    }

    // per-card focus dim/desaturate
    cardGroup.children.forEach((mesh, idx) => {
      let f = 1;
      if(p.motion === 'waypoints' && visitOrder.length > 0){
        if(idx === visitOrder[segIndex]) f = THREE.MathUtils.lerp(1, 0.3, localT);
        else if(idx === nextIndex) f = THREE.MathUtils.lerp(0.3, 1, localT);
        else f = 0.15;
      }
      mesh.material.uniforms.uFocus.value = f;
    });

    renderer.render(scene, camera);

    octx.clearRect(0,0,outputCanvas.width, outputCanvas.height);
    octx.drawImage(glCanvas, 0, 0);
    drawLogo();
    drawText();

    if(fxHasActive()){
      const pixelScaleMult = outputCanvas.width / state.frame.w;
      fxRun(outputCanvas, theta, pixelScaleMult);
      octx.clearRect(0,0,outputCanvas.width, outputCanvas.height);
      octx.drawImage(fxCanvas, 0, 0);
    }

    const progress = phase/duration;
    ringFg.style.strokeDashoffset = String(RING_CIRC * (1-progress));
    loopTimeEl.textContent = phase.toFixed(1) + 's / ' + duration.toFixed(1) + 's';
  }

  function drawLogo(){
    if(!state.logo.enabled || !state.logo.img) return;
    const W = outputCanvas.width, H = outputCanvas.height;
    const lw = W * (state.logo.size/100);
    const lh = lw * (state.logo.img.naturalHeight / state.logo.img.naturalWidth);
    const margin = Math.max(16, W*0.02);
    let x, y; const a = state.logo.anchor;
    if(a[0]==='t') y=margin; else if(a[0]==='m') y=(H-lh)/2; else y=H-lh-margin;
    if(a[1]==='l') x=margin; else if(a[1]==='c') x=(W-lw)/2; else x=W-lw-margin;
    octx.save();
    octx.globalAlpha = state.logo.opacity/100;
    octx.globalCompositeOperation = state.logo.blend;
    octx.translate(x+lw/2, y+lh/2);
    octx.rotate(THREE.MathUtils.degToRad(state.logo.rotation));
    octx.drawImage(state.logo.img, -lw/2, -lh/2, lw, lh);
    octx.restore();
  }

  function drawText(){
    if(!state.text.enabled || !state.text.content) return;
    const W = outputCanvas.width, H = outputCanvas.height;
    const fontPx = Math.round(W * (state.text.size/100));
    const margin = Math.max(20, W*0.035);
    let x, y, align, baseline; const a = state.text.anchor;
    if(a[0]==='t'){ y=margin; baseline='top'; } else if(a[0]==='m'){ y=H/2; baseline='middle'; } else { y=H-margin; baseline='bottom'; }
    if(a[1]==='l'){ x=margin; align='left'; } else if(a[1]==='c'){ x=W/2; align='center'; } else { x=W-margin; align='right'; }
    octx.save();
    octx.font = state.text.weight+' '+fontPx+'px Inter, sans-serif';
    octx.fillStyle = state.text.color;
    octx.textAlign = align; octx.textBaseline = baseline;
    octx.fillText(state.text.content, x, y);
    octx.restore();
  }

  /* ================= media handling ================= */

  function loadImages(files){
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if(list.length === 0){ toast('Please choose image files.'); return; }
    let pending = list.length;
    list.forEach(file => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        if(tex.encoding !== undefined) tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        images.push({id: nextId++, img, url, name:file.name, aspect: img.naturalWidth/img.naturalHeight, tex, focus:{x:0.5,y:0.5}});
        pending--; if(pending===0) onMediaChanged();
      };
      img.onerror = () => { pending--; if(pending===0) onMediaChanged(); };
      img.src = url;
    });
  }

  function onMediaChanged(){
    renderMediaList();
    rebuildLayout();
    if(images.length > 0){
      outputCanvas.classList.remove('hidden');
      dropzone.style.display = 'none';
      exportBtn.disabled = false;
      if(currentParams().motion === 'waypoints') maybeSuggestDuration();
      if(!isPlaying){ isPlaying = true; sessionStart = performance.now(); playBtn.textContent = '❚❚'; }
    } else {
      outputCanvas.classList.add('hidden');
      dropzone.style.display = 'flex';
      exportBtn.disabled = true;
    }
    buildInspector();
  }

  function renderMediaList(){
    mediaCount.textContent = '· ' + images.length;
    mediaList.innerHTML = '';
    images.forEach((item, idx) => {
      const row = el('div','media-item');
      row.dataset.idx = idx;

      const top = el('div','media-item-top');
      top.draggable = true;
      const thumb = document.createElement('img'); thumb.src = item.url;
      const name = el('span','name', item.name);
      const rm = el('button','rm','×');
      rm.addEventListener('click', () => { images.splice(idx,1); onMediaChanged(); });
      top.appendChild(thumb); top.appendChild(name); top.appendChild(rm);

      top.addEventListener('dragstart', e => { row.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(idx)); });
      top.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'),10);
        if(from === idx || isNaN(from)) return;
        const [moved] = images.splice(from,1);
        images.splice(idx,0,moved);
        onMediaChanged();
      });

      const focusRow = el('div','focus-row');
      focusRow.appendChild(el('span',null,'focus'));
      const fgrid = el('div','anchor-grid-sm');
      ANCHORS.forEach(a => {
        const fx = a[1]==='l'?0:a[1]==='c'?0.5:1;
        const fy = a[0]==='t'?0:a[0]==='m'?0.5:1;
        const isActive = Math.abs(item.focus.x-fx)<0.01 && Math.abs(item.focus.y-fy)<0.01;
        const cell = el('div','anchor-cell-sm'+(isActive?' active':''));
        cell.addEventListener('click', () => {
          item.focus = {x:fx, y:fy};
          rebuildLayout();
          renderMediaList();
        });
        fgrid.appendChild(cell);
      });
      focusRow.appendChild(fgrid);

      row.appendChild(top);
      row.appendChild(focusRow);
      mediaList.appendChild(row);
    });
  }

  mediaInput.addEventListener('change', e => { if(e.target.files.length) loadImages(e.target.files); });
  mediaDrop.addEventListener('click', () => mediaInput.click());
  ['dragenter','dragover'].forEach(evt => mediaDrop.addEventListener(evt, e=>{ e.preventDefault(); mediaDrop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => mediaDrop.addEventListener(evt, e=>{ e.preventDefault(); mediaDrop.classList.remove('drag'); }));
  mediaDrop.addEventListener('drop', e => { if(e.dataTransfer.files.length) loadImages(e.dataTransfer.files); });

  dropzone.addEventListener('click', () => mediaInput.click());
  ['dragenter','dragover'].forEach(evt => viewport.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => viewport.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); }));
  viewport.addEventListener('drop', e => { if(e.dataTransfer.files.length) loadImages(e.dataTransfer.files); });

  /* ================= inspector ================= */

  function formatNum(v, step){ return Number.isInteger(step) ? Math.round(v) : v.toFixed(1); }

  function anchorGrid(getVal, setVal){
    const grid = el('div','anchor-grid');
    ANCHORS.forEach(a => {
      const cell = el('div','anchor-cell'+(a===getVal()?' active':''));
      cell.addEventListener('click', () => {
        setVal(a);
        [...grid.children].forEach(c=>c.classList.remove('active'));
        cell.classList.add('active');
      });
      grid.appendChild(cell);
    });
    return grid;
  }

  function buildInspector(){
    inspector.innerHTML = '';

    // FRAME
    const frameGroup = el('div','group on');
    frameGroup.appendChild(el('div','group-name','FRAME'));
    const frameSeg = el('div','segmented');
    FRAME_PRESETS.forEach(f => {
      const b = el('button','seg-btn'+(f.id===state.frame.id?' active':''), f.id);
      b.addEventListener('click', () => {
        state.frame = f; applyFrameSize();
        [...frameSeg.children].forEach(c=>c.classList.remove('active'));
        b.classList.add('active');
      });
      frameSeg.appendChild(b);
    });
    frameGroup.appendChild(frameSeg);
    inspector.appendChild(frameGroup);

    // LAYOUT
    const layoutGroup = el('div','group on');
    layoutGroup.appendChild(el('div','group-name','LAYOUT'));
    const layoutSeg = el('div','segmented');
    ['wall','globe','tunnel'].forEach(id => {
      const b = el('button','seg-btn'+(id===state.layout?' active':''), id[0].toUpperCase()+id.slice(1));
      b.addEventListener('click', () => { state.layout = id; rebuildLayout(); buildInspector(); });
      layoutSeg.appendChild(b);
    });
    layoutGroup.appendChild(layoutSeg);
    inspector.appendChild(layoutGroup);

    // LAYOUT PARAMS
    const p = currentParams();
    const paramGroup = el('div','group on');
    paramGroup.appendChild(el('div','group-name', state.layout.toUpperCase()+' SETTINGS'));

    function slider(key, label, min, max, step, isStructural, suffix){
      const row = el('div','param-row');
      const lab = el('div','param-label');
      lab.appendChild(el('b',null,label));
      const span = el('span', null, formatNum(p[key], step)+(suffix||''));
      lab.appendChild(span);
      const input = document.createElement('input');
      input.type='range'; input.min=min; input.max=max; input.step=step; input.value=p[key];
      input.addEventListener('input', () => {
        p[key] = parseFloat(input.value);
        span.textContent = formatNum(p[key], step)+(suffix||'');
        if(isStructural) rebuildLayout(); else updateShaderUniformsOnly();
      });
      row.appendChild(lab); row.appendChild(input);
      paramGroup.appendChild(row);
    }

    slider('zoom','zoom',5,100,1,false,'%');
    if(state.layout === 'wall') slider('tilt','tilt',-45,45,1,false,'°');
    if(state.layout === 'tunnel'){ slider('twist','twist',0,90,1,true,'°'); slider('ringSpacing','spacing',0,100,1,true,'%'); }
    slider('gap','gap',0,100,1,true,'%');
    slider('padding','padding',0,40,1,true,'%');
    slider('cornerRadius','corner radius',0,50,1,false,'%');
    slider('edgeFade','edge fade',0,100,1,false,'%');

    const ratioRow = el('div','param-row');
    ratioRow.appendChild(el('div','param-label').appendChild(el('b',null,'card ratio')).parentNode);
    const ratioSeg = el('div','segmented');
    CARD_RATIOS.forEach(r => {
      const b = el('button','seg-btn'+(Math.abs(r.v-p.cardRatio)<0.001?' active':''), r.id);
      b.addEventListener('click', () => { p.cardRatio = r.v; [...ratioSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); rebuildLayout(); });
      ratioSeg.appendChild(b);
    });
    ratioRow.appendChild(ratioSeg);
    paramGroup.appendChild(ratioRow);

    const motionRow = el('div','param-row');
    motionRow.appendChild(el('div','param-label').appendChild(el('b',null,'motion')).parentNode);
    const motionSeg = el('div','segmented');
    [['continuous','Continuous'],['waypoints','Waypoints']].forEach(([id,label]) => {
      const b = el('button','seg-btn'+(id===p.motion?' active':''), label);
      b.addEventListener('click', () => { p.motion = id; if(id==='waypoints') maybeSuggestDuration(); buildInspector(); });
      motionSeg.appendChild(b);
    });
    motionRow.appendChild(motionSeg);
    paramGroup.appendChild(motionRow);

    if(p.motion === 'continuous'){
      const dirRow = el('div','param-row');
      dirRow.appendChild(el('div','param-label').appendChild(el('b',null,'direction')).parentNode);
      const dirSeg = el('div','segmented');
      ['left','right','alternate'].forEach(d => {
        const b = el('button','seg-btn'+(d===p.direction?' active':''), d[0].toUpperCase()+d.slice(1));
        b.addEventListener('click', () => { p.direction = d; [...dirSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
        dirSeg.appendChild(b);
      });
      dirRow.appendChild(dirSeg);
      paramGroup.appendChild(dirRow);
    } else {
      slider('hold','hold per image',20,85,1,false,'%');
    }
    inspector.appendChild(paramGroup);

    // BACKGROUND
    const bgGroup = el('div','group on');
    bgGroup.appendChild(el('div','group-name','BACKGROUND'));
    const bgSeg = el('div','segmented');
    const bgBody = el('div');
    bgBody.style.marginTop = '10px';
    function renderBgBody(){
      bgBody.innerHTML = '';
      if(state.bg.mode === 'color'){
        const row = el('div','color-row');
        const c = document.createElement('input'); c.type='color'; c.value=state.bg.color;
        const t = document.createElement('input'); t.type='text'; t.value=state.bg.color;
        c.addEventListener('input', () => { state.bg.color=c.value; t.value=c.value; applyBackground(); });
        t.addEventListener('change', () => { state.bg.color=t.value; c.value=t.value; applyBackground(); });
        row.appendChild(c); row.appendChild(t); bgBody.appendChild(row);
      } else if(state.bg.mode === 'gradient'){
        const row1 = el('div','color-row');
        const c1 = document.createElement('input'); c1.type='color'; c1.value=state.bg.gradFrom;
        const c2 = document.createElement('input'); c2.type='color'; c2.value=state.bg.gradTo;
        c1.addEventListener('input', () => { state.bg.gradFrom=c1.value; applyBackground(); });
        c2.addEventListener('input', () => { state.bg.gradTo=c2.value; applyBackground(); });
        row1.appendChild(c1); row1.appendChild(c2);
        bgBody.appendChild(row1);
        const angleRow = el('div','param-row'); angleRow.style.marginTop='8px';
        const lab = el('div','param-label'); lab.appendChild(el('b',null,'angle'));
        const span = el('span',null,state.bg.gradAngle+'°'); lab.appendChild(span);
        const input = document.createElement('input');
        input.type='range'; input.min=0; input.max=360; input.step=1; input.value=state.bg.gradAngle;
        input.addEventListener('input', () => { state.bg.gradAngle=parseFloat(input.value); span.textContent=state.bg.gradAngle+'°'; applyBackground(); });
        angleRow.appendChild(lab); angleRow.appendChild(input);
        bgBody.appendChild(angleRow);
      } else {
        const btn = el('button','btn btn-sm btn-block', state.bg.img ? 'Replace image' : 'Upload image');
        const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.hidden=true;
        btn.addEventListener('click', () => inp.click());
        inp.addEventListener('change', e => {
          const f = e.target.files[0]; if(!f) return;
          const url = URL.createObjectURL(f); const img = new Image();
          img.onload = () => { state.bg.img = img; applyBackground(); };
          img.src = url;
        });
        bgBody.appendChild(btn); bgBody.appendChild(inp);
      }
    }
    [['color','Color'],['gradient','Gradient'],['image','Image']].forEach(([id,label]) => {
      const b = el('button','seg-btn'+(id===state.bg.mode?' active':''), label);
      b.addEventListener('click', () => {
        state.bg.mode = id; applyBackground();
        [...bgSeg.children].forEach(c=>c.classList.remove('active'));
        b.classList.add('active');
        renderBgBody();
      });
      bgSeg.appendChild(b);
    });
    bgGroup.appendChild(bgSeg);
    bgGroup.appendChild(bgBody);
    renderBgBody();
    inspector.appendChild(bgGroup);

    // TIMING
    const timingGroup = el('div','group on');
    timingGroup.appendChild(el('div','group-name','TIMING'));
    const durRow = el('div','param-row');
    const durLabel = el('div','param-label');
    durLabel.appendChild(el('b',null,'loop duration'));
    const durVal = el('span',null, state.loopDuration.toFixed(1)+'s');
    durLabel.appendChild(durVal);
    durRow.appendChild(durLabel);
    const durSeg = el('div','segmented');
    [5,10,15,20,30].forEach(s => {
      const b = el('button','seg-btn'+(s===state.loopDuration?' active':''), s+'s');
      b.addEventListener('click', () => {
        state.loopDuration = s; durVal.textContent = s.toFixed(1)+'s'; durSlider.value = s;
        [...durSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active');
      });
      durSeg.appendChild(b);
    });
    durRow.appendChild(durSeg);
    const durSlider = document.createElement('input');
    durSlider.type='range'; durSlider.min=1; durSlider.max=40; durSlider.step=0.5; durSlider.value=state.loopDuration;
    durSlider.style.marginTop = '8px';
    durSlider.addEventListener('input', () => {
      state.loopDuration = parseFloat(durSlider.value); durVal.textContent = state.loopDuration.toFixed(1)+'s';
      [...durSeg.children].forEach(c=>c.classList.remove('active'));
    });
    durRow.appendChild(durSlider);
    timingGroup.appendChild(durRow);
    inspector.appendChild(timingGroup);

    // TEXT
    const textGroup = el('div','group'+(state.text.enabled?' on':''));
    const textHead = el('div','group-head');
    textHead.appendChild(el('span','group-name','TEXT'));
    const textSwitch = el('label','switch');
    const textCb = document.createElement('input'); textCb.type='checkbox'; textCb.checked = state.text.enabled;
    textCb.addEventListener('change', () => { state.text.enabled = textCb.checked; textGroup.classList.toggle('on', state.text.enabled); });
    textSwitch.appendChild(textCb); textSwitch.appendChild(el('span','track')); textSwitch.appendChild(el('span','thumb'));
    textHead.appendChild(textSwitch);
    textGroup.appendChild(textHead);

    const textArea = document.createElement('textarea');
    textArea.className = 'text-input'; textArea.value = state.text.content; textArea.rows = 2;
    textArea.addEventListener('input', () => { state.text.content = textArea.value; });
    textGroup.appendChild(textArea);

    const textSizeRow = el('div','param-row'); textSizeRow.style.marginTop='10px';
    const tsLab = el('div','param-label'); tsLab.appendChild(el('b',null,'size'));
    const tsSpan = el('span',null,state.text.size+'%'); tsLab.appendChild(tsSpan);
    const tsInput = document.createElement('input');
    tsInput.type='range'; tsInput.min=2; tsInput.max=15; tsInput.step=0.5; tsInput.value=state.text.size;
    tsInput.addEventListener('input', () => { state.text.size=parseFloat(tsInput.value); tsSpan.textContent=state.text.size+'%'; });
    textSizeRow.appendChild(tsLab); textSizeRow.appendChild(tsInput);
    textGroup.appendChild(textSizeRow);

    const textColorRow = el('div','color-row'); textColorRow.style.marginTop='8px';
    const tColor = document.createElement('input'); tColor.type='color'; tColor.value=state.text.color;
    tColor.addEventListener('input', () => { state.text.color = tColor.value; });
    textColorRow.appendChild(tColor);
    const weightSelect = document.createElement('select'); weightSelect.className='select-input'; weightSelect.style.width='auto'; weightSelect.style.flex='1';
    [['400','Regular'],['600','Semibold'],['700','Bold']].forEach(([v,l]) => {
      const opt = document.createElement('option'); opt.value=v; opt.textContent=l; if(v===state.text.weight) opt.selected=true;
      weightSelect.appendChild(opt);
    });
    weightSelect.addEventListener('change', () => { state.text.weight = weightSelect.value; });
    textColorRow.appendChild(weightSelect);
    textGroup.appendChild(textColorRow);

    const textPosRow = el('div','param-row'); textPosRow.style.marginTop='10px';
    textPosRow.appendChild(el('div','param-label').appendChild(el('b',null,'position')).parentNode);
    textPosRow.appendChild(anchorGrid(()=>state.text.anchor, v=>{state.text.anchor=v;}));
    textGroup.appendChild(textPosRow);

    inspector.appendChild(textGroup);

    // LOGO
    const logoGroup = el('div','group'+(state.logo.enabled?' on':''));
    const logoHead = el('div','group-head');
    logoHead.appendChild(el('span','group-name','LOGO'));
    const logoSwitch = el('label','switch');
    const logoCb = document.createElement('input'); logoCb.type='checkbox'; logoCb.checked = state.logo.enabled;
    logoCb.addEventListener('change', () => { state.logo.enabled = logoCb.checked; logoGroup.classList.toggle('on', state.logo.enabled); });
    logoSwitch.appendChild(logoCb); logoSwitch.appendChild(el('span','track')); logoSwitch.appendChild(el('span','thumb'));
    logoHead.appendChild(logoSwitch);
    logoGroup.appendChild(logoHead);

    const logoUploadBtn = el('button','btn btn-sm btn-block', state.logo.img ? 'Replace logo' : 'Upload logo');
    const logoFileInput = document.createElement('input');
    logoFileInput.type='file'; logoFileInput.accept='image/*'; logoFileInput.hidden=true;
    logoUploadBtn.addEventListener('click', () => logoFileInput.click());
    logoFileInput.addEventListener('change', e => {
      const f = e.target.files[0]; if(!f) return;
      const url = URL.createObjectURL(f); const img = new Image();
      img.onload = () => { state.logo.img = img; };
      img.src = url;
    });
    logoGroup.appendChild(logoUploadBtn); logoGroup.appendChild(logoFileInput);

    function logoSlider(key, label, min, max, step, suffix){
      const row = el('div','param-row');
      const lab = el('div','param-label'); lab.appendChild(el('b',null,label));
      const span = el('span',null,state.logo[key]+(suffix||'')); lab.appendChild(span);
      const input = document.createElement('input');
      input.type='range'; input.min=min; input.max=max; input.step=step; input.value=state.logo[key];
      input.addEventListener('input', () => { state.logo[key]=parseFloat(input.value); span.textContent=state.logo[key]+(suffix||''); });
      row.appendChild(lab); row.appendChild(input);
      logoGroup.appendChild(row);
    }
    logoSlider('size','size',4,50,1,'%');
    logoSlider('opacity','opacity',0,100,1,'%');
    logoSlider('rotation','rotation',-180,180,1,'°');

    const blendRow = el('div','param-row');
    blendRow.appendChild(el('div','param-label').appendChild(el('b',null,'blend')).parentNode);
    const blendSelect = document.createElement('select'); blendSelect.className='select-input';
    [['source-over','Normal'],['screen','Screen'],['multiply','Multiply'],['overlay','Overlay']].forEach(([v,label])=>{
      const opt = document.createElement('option'); opt.value=v; opt.textContent=label;
      if(v===state.logo.blend) opt.selected = true;
      blendSelect.appendChild(opt);
    });
    blendSelect.addEventListener('change', () => { state.logo.blend = blendSelect.value; });
    blendRow.appendChild(blendSelect);
    logoGroup.appendChild(blendRow);

    const posRow = el('div','param-row');
    posRow.appendChild(el('div','param-label').appendChild(el('b',null,'position')).parentNode);
    posRow.appendChild(anchorGrid(()=>state.logo.anchor, v=>{state.logo.anchor=v;}));
    logoGroup.appendChild(posRow);

    inspector.appendChild(logoGroup);

    // EFFECTS
    const fxGroup = el('div','group on');
    fxGroup.appendChild(el('div','group-name','EFFECTS'));
    FX_EFFECTS.forEach(fx => {
      const card = el('div','group'+(fx.enabled?' on':''));
      card.style.margin = '8px 0 0'; card.style.padding='10px';
      const head = el('div','group-head'); head.style.marginBottom = fx.enabled ? '8px' : '0';
      head.appendChild(el('span','group-name', fx.label));
      const sw = el('label','switch');
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = fx.enabled;
      cb.addEventListener('change', () => { fx.enabled = cb.checked; card.classList.toggle('on', fx.enabled); head.style.marginBottom = fx.enabled?'8px':'0'; body.style.display = fx.enabled?'block':'none'; });
      sw.appendChild(cb); sw.appendChild(el('span','track')); sw.appendChild(el('span','thumb'));
      head.appendChild(sw);
      card.appendChild(head);
      const body = el('div'); body.style.display = fx.enabled ? 'block' : 'none';
      fx.params.forEach(pm => {
        const row = el('div','param-row');
        const lab = el('div','param-label'); lab.appendChild(el('b',null,pm.key));
        const span = el('span',null, formatNum(pm.value, pm.step) + (pm.degrees?'°':''));
        lab.appendChild(span);
        const input = document.createElement('input');
        input.type='range'; input.min=pm.min; input.max=pm.max; input.step=pm.step; input.value=pm.value;
        input.addEventListener('input', () => { pm.value = parseFloat(input.value); span.textContent = formatNum(pm.value, pm.step)+(pm.degrees?'°':''); });
        row.appendChild(lab); row.appendChild(input);
        body.appendChild(row);
      });
      card.appendChild(body);
      fxGroup.appendChild(card);
    });
    inspector.appendChild(fxGroup);

    // EXPORT
    const exportGroup = el('div','group on');
    exportGroup.appendChild(el('div','group-name','EXPORT'));
    const resRow = el('div','param-row');
    resRow.appendChild(el('div','param-label').appendChild(el('b',null,'resolution')).parentNode);
    const resSeg = el('div','segmented');
    RES_MULTS.forEach(m => {
      const b = el('button','seg-btn'+(m===state.exportResMult?' active':''), m+'×');
      b.addEventListener('click', () => { state.exportResMult = m; [...resSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
      resSeg.appendChild(b);
    });
    resRow.appendChild(resSeg);
    exportGroup.appendChild(resRow);
    inspector.appendChild(exportGroup);
  }

  /* ================= transport ================= */

  playBtn.addEventListener('click', () => {
    if(images.length === 0) return;
    if(isPlaying){ pausedElapsed = currentElapsed(performance.now()); isPlaying = false; playBtn.textContent = '▶'; }
    else { sessionStart = performance.now(); isPlaying = true; playBtn.textContent = '❚❚'; }
  });

  exportBtn.addEventListener('click', () => {
    if(images.length === 0 || exporting) return;
    if(typeof outputCanvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined'){
      toast('Video export is not supported in this browser.');
      return;
    }
    exporting = true;
    const wasPlaying = isPlaying;
    const duration = Math.max(1, state.loopDuration);
    const mult = state.exportResMult;
    const baseW = state.frame.w, baseH = state.frame.h;

    if(mult !== 1) setCanvasSize(baseW*mult, baseH*mult);

    pausedElapsed = 0; sessionStart = performance.now(); isPlaying = true;

    let mimeType = 'video/webm;codecs=vp9';
    if(!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8';
    if(!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

    let recorder;
    try{
      const stream = outputCanvas.captureStream(30);
      recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 14000000});
    } catch(err){
      toast('Could not start recording in this browser.');
      exporting = false;
      if(mult !== 1) setCanvasSize(baseW, baseH);
      return;
    }

    const chunks = [];
    recorder.ondataavailable = e => { if(e.data && e.data.size>0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, {type:'video/webm'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'forge-composition.webm';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);

      if(mult !== 1) setCanvasSize(baseW, baseH);
      exporting = false;
      exportBtn.textContent = 'Export video';
      exportBtn.disabled = false;
      isPlaying = wasPlaying;
      if(!wasPlaying) pausedElapsed = currentElapsed(performance.now());
      playBtn.textContent = isPlaying ? '❚❚' : '▶';
      toast('Composition exported as WebM.');
    };

    exportBtn.textContent = 'Recording…';
    exportBtn.disabled = true;
    recorder.start();
    setTimeout(() => { if(recorder.state !== 'inactive') recorder.stop(); }, Math.round(duration*1000)+120);
  });

  /* ================= init ================= */

  initThree();
  initFx();
  buildInspector();
  requestAnimationFrame(render);

})();
