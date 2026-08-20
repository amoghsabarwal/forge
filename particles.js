
(function(){
  "use strict";

  const RING_CIRC = 2*Math.PI*13;
  const FRAME_PRESETS = [
    {id:'1:1', w:760, h:760}, {id:'4:5', w:720, h:900}, {id:'9:16', w:540, h:960}, {id:'16:9', w:960, h:540}
  ];

  const state = {
    frame: FRAME_PRESETS[0],
    density: 150,
    threshold: 0.08,
    hueShift: 0,
    saturation: 55,
    posterize: 5,
    brightness: 105,
    jitter: 6,
    pulse: 35,
    scatter: 18,
    depthSpread: 12,
    sizeBase: 3.2,
    sizeVariance: 2.4,
    orbit: 'slow',
    bg: '#000000',
    loopDuration: 6
  };

  let img = null;

  const outputCanvas = document.getElementById('outputCanvasP');
  const viewport = document.getElementById('viewportP');
  const dropzone = document.getElementById('dropzoneP');
  const fileInput = document.getElementById('fileInputP');
  const changeBtn = document.getElementById('changeBtnP');
  const inspector = document.getElementById('inspectorP');
  const playBtn = document.getElementById('playBtnP');
  const exportBtn = document.getElementById('exportBtnP');
  const loopTimeEl = document.getElementById('loopTimeP');
  const ringFg = document.getElementById('ringFgP');
  const particleCountEl = document.getElementById('particleCountP');
  const toastEl = document.getElementById('toastP');

  function toast(msg){
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(()=>toastEl.classList.remove('show'), 2600);
  }
  function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }

  /* ---------------- color helpers ---------------- */
  function rgbToHsl(r,g,b){
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h,s,l=(max+min)/2;
    if(max===min){ h=s=0; }
    else{
      const d=max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      if(max===r) h=(g-b)/d+(g<b?6:0);
      else if(max===g) h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h/=6;
    }
    return [h,s,l];
  }
  function hue2rgb(p,q,t){ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; }
  function hslToRgb(h,s,l){
    if(s===0) return [l,l,l];
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    return [hue2rgb(p,q,h+1/3), hue2rgb(p,q,h), hue2rgb(p,q,h-1/3)];
  }

  /* ---------------- three.js ---------------- */
  const canvas = outputCanvas;
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
  if(renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 6.4);

  let points = null;

  const VERT = `
    attribute vec3 aColor;
    attribute vec3 aScatter;
    attribute float aSeed;
    uniform float uTheta;
    uniform float uJitter;
    uniform float uPulse;
    uniform float uScatter;
    uniform float uSizeBase;
    uniform float uSizeVariance;
    varying vec3 vColor;
    void main(){
      vColor = aColor;
      float ph = uTheta + aSeed*6.2831853;
      vec3 jitterOff = vec3(cos(ph*2.0)*uJitter, sin(ph*2.3+1.7)*uJitter, cos(ph*1.6+3.1)*uJitter*0.6);
      float wobble = sin(uTheta + aSeed*6.2831853)*0.5 + 0.5;
      vec3 scattered = mix(position, aScatter, uScatter*wobble);
      float pulseAmt = 1.0 + sin(uTheta*1.0 + aSeed*3.0)*uPulse*0.012;
      vec3 pos = scattered * pulseAmt + jitterOff*0.02;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mv;
      float sizeJ = 0.55 + fract(aSeed*43758.5453)*0.9;
      gl_PointSize = (uSizeBase + uSizeVariance*sizeJ) * (6.4 / -mv.z);
    }
  `;
  const FRAG = `
    precision highp float;
    varying vec3 vColor;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if(d > 0.5) discard;
      float a = smoothstep(0.5, 0.1, d);
      gl_FragColor = vec4(vColor, a);
    }
  `;

  function buildParticles(){
    if(!img) return;
    if(points){ scene.remove(points); points.geometry.dispose(); points.material.dispose(); }

    const aspect = img.naturalWidth / img.naturalHeight;
    const sampleW = Math.round(state.density);
    const sampleH = Math.max(1, Math.round(sampleW / aspect));
    const c = document.createElement('canvas');
    c.width = sampleW; c.height = sampleH;
    const cctx = c.getContext('2d');
    cctx.drawImage(img, 0, 0, sampleW, sampleH);
    const data = cctx.getImageData(0, 0, sampleW, sampleH).data;

    const positions = [], scatters = [], colors = [], seeds = [];
    const worldW = aspect >= 1 ? 4.2 : 4.2*aspect;
    const worldH = aspect >= 1 ? 4.2/aspect : 4.2;

    for(let y=0; y<sampleH; y++){
      for(let x=0; x<sampleW; x++){
        const i = (y*sampleW+x)*4;
        const r=data[i]/255, g=data[i+1]/255, b=data[i+2]/255, a=data[i+3]/255;
        const lum = 0.299*r+0.587*g+0.114*b;
        if(a < 0.15 || lum < state.threshold) continue;

        const jx = (Math.random()-0.5)*0.85, jy = (Math.random()-0.5)*0.85;
        const px = ((x+0.5+jx)/sampleW - 0.5) * worldW;
        const py = -((y+0.5+jy)/sampleH - 0.5) * worldH;
        const pz = (Math.random()-0.5) * (state.depthSpread/100) * 2.2;
        positions.push(px, py, pz);

        const sr = 3.0;
        scatters.push(
          px + (Math.random()-0.5)*sr,
          py + (Math.random()-0.5)*sr,
          pz + (Math.random()-0.5)*sr*1.4
        );

        let [h,s,l] = rgbToHsl(r,g,b);
        h = (h + state.hueShift/360) % 1; if(h<0) h+=1;
        if(state.posterize > 0) h = Math.round(h*state.posterize)/state.posterize;
        s = THREE.MathUtils.lerp(s, 1.0, state.saturation/100);
        l = THREE.MathUtils.clamp(l * (state.brightness/100), 0.12, 0.88);
        const [cr,cg,cb] = hslToRgb(h,s,l);
        colors.push(cr,cg,cb);

        seeds.push(Math.random());
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aScatter', new THREE.Float32BufferAttribute(scatters, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms:{
        uTheta:{value:0}, uJitter:{value:state.jitter}, uPulse:{value:state.pulse},
        uScatter:{value:state.scatter/100}, uSizeBase:{value:state.sizeBase}, uSizeVariance:{value:state.sizeVariance}
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent:true, depthWrite:false, blending: THREE.AdditiveBlending
    });

    points = new THREE.Points(geo, mat);
    scene.add(points);
    particleCountEl.textContent = (positions.length/3).toLocaleString() + ' particles';
  }

  function debounce(fn, ms){
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
  }
  const buildParticlesSoon = debounce(buildParticles, 70);

  function updateUniformsOnly(){
    if(!points) return;
    const u = points.material.uniforms;
    u.uJitter.value = state.jitter; u.uPulse.value = state.pulse;
    u.uScatter.value = state.scatter/100; u.uSizeBase.value = state.sizeBase; u.uSizeVariance.value = state.sizeVariance;
  }

  function applyFrameSize(){
    const {w,h} = state.frame;
    outputCanvas.width = w; outputCanvas.height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
  }
  function applyBg(){ scene.background = new THREE.Color(state.bg); }

  /* ---------------- animation ---------------- */
  let isPlaying=false, sessionStart=0, pausedElapsed=0, exporting=false;
  function currentElapsed(now){ return isPlaying ? pausedElapsed+(now-sessionStart)/1000 : pausedElapsed; }

  const orbitSpeeds = {off:0, slow:0.06, medium:0.16};

  function render(now){
    requestAnimationFrame(render);
    if(window.FORGE_MODE !== 'particles') return;
    if(!points) return;
    const duration = Math.max(1, state.loopDuration);
    const elapsed = currentElapsed(now);
    const phase = ((elapsed % duration) + duration) % duration;
    const theta = (phase/duration) * Math.PI*2;

    points.material.uniforms.uTheta.value = theta;

    const orbitAmt = orbitSpeeds[state.orbit] || 0;
    camera.position.x = Math.sin(theta) * 6.4 * orbitAmt;
    camera.position.z = 6.4 * (1 - orbitAmt*0.15) + Math.cos(theta)*0.3*orbitAmt;
    camera.lookAt(0,0,0);

    renderer.render(scene, camera);

    const progress = phase/duration;
    ringFg.style.strokeDashoffset = String(RING_CIRC*(1-progress));
    loopTimeEl.textContent = phase.toFixed(1)+'s / '+duration.toFixed(1)+'s';
  }

  /* ---------------- image loading ---------------- */
  function loadFile(file){
    if(!file || !file.type.startsWith('image/')){ toast('Please choose an image file.'); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      img = image;
      buildParticles();
      outputCanvas.classList.remove('hidden');
      dropzone.style.display = 'none';
      changeBtn.hidden = false;
      exportBtn.disabled = false;
      pausedElapsed = 0; sessionStart = performance.now(); isPlaying = true;
      playBtn.textContent = '❚❚';
      URL.revokeObjectURL(url);
    };
    image.onerror = () => toast('Could not load that image.');
    image.src = url;
  }
  fileInput.addEventListener('change', e => { if(e.target.files[0]) loadFile(e.target.files[0]); });
  dropzone.addEventListener('click', () => fileInput.click());
  changeBtn.addEventListener('click', () => fileInput.click());
  ['dragenter','dragover'].forEach(evt => viewport.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => viewport.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); }));
  viewport.addEventListener('drop', e => { const f=e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) loadFile(f); });

  /* ---------------- inspector ---------------- */
  function buildInspector(){
    inspector.innerHTML = '';

    const genGroup = el('div','group');
    genGroup.appendChild(el('div','group-name','GENERATION'));
    function structSlider(parent, key, label, min, max, step, suffix){
      const row = el('div','param-row');
      const lab = el('div','param-label'); lab.appendChild(el('b',null,label));
      const span = el('span',null, state[key]+(suffix||'')); lab.appendChild(span);
      const input = document.createElement('input');
      input.type='range'; input.min=min; input.max=max; input.step=step; input.value=state[key];
      input.addEventListener('input', () => { state[key]=parseFloat(input.value); span.textContent=state[key]+(suffix||''); buildParticlesSoon(); });
      row.appendChild(lab); row.appendChild(input); parent.appendChild(row);
    }
    structSlider(genGroup, 'density', 'density', 40, 240, 5, 'px');
    structSlider(genGroup, 'threshold', 'threshold', 0, 0.6, 0.01, '');
    inspector.appendChild(genGroup);

    const colorGroup = el('div','group');
    colorGroup.appendChild(el('div','group-name','COLOR'));
    function liveSlider(parent, key, label, min, max, step, suffix){
      const row = el('div','param-row');
      const lab = el('div','param-label'); lab.appendChild(el('b',null,label));
      const span = el('span',null, state[key]+(suffix||'')); lab.appendChild(span);
      const input = document.createElement('input');
      input.type='range'; input.min=min; input.max=max; input.step=step; input.value=state[key];
      input.addEventListener('input', () => { state[key]=parseFloat(input.value); span.textContent=state[key]+(suffix||''); buildParticlesSoon(); });
      row.appendChild(lab); row.appendChild(input); parent.appendChild(row);
    }
    liveSlider(colorGroup, 'hueShift', 'hue shift', 0, 360, 1, '°');
    liveSlider(colorGroup, 'saturation', 'saturation', 0, 100, 1, '%');
    liveSlider(colorGroup, 'posterize', 'posterize', 0, 10, 1, '');
    liveSlider(colorGroup, 'brightness', 'brightness', 50, 160, 1, '%');
    inspector.appendChild(colorGroup);

    const motionGroup = el('div','group');
    motionGroup.appendChild(el('div','group-name','MOTION'));
    function motionSlider(parent, key, label, min, max, step, suffix){
      const row = el('div','param-row');
      const lab = el('div','param-label'); lab.appendChild(el('b',null,label));
      const span = el('span',null, state[key]+(suffix||'')); lab.appendChild(span);
      const input = document.createElement('input');
      input.type='range'; input.min=min; input.max=max; input.step=step; input.value=state[key];
      input.addEventListener('input', () => { state[key]=parseFloat(input.value); span.textContent=state[key]+(suffix||''); updateUniformsOnly(); });
      row.appendChild(lab); row.appendChild(input); parent.appendChild(row);
    }
    motionSlider(motionGroup, 'jitter', 'jitter', 0, 30, 1, '');
    motionSlider(motionGroup, 'pulse', 'pulse', 0, 100, 1, '%');
    motionSlider(motionGroup, 'scatter', 'scatter amount', 0, 100, 1, '%');
    inspector.appendChild(motionGroup);

    const depthGroup = el('div','group');
    depthGroup.appendChild(el('div','group-name','POINTS'));
    structSlider(depthGroup, 'depthSpread', 'depth spread', 0, 100, 1, '%');
    motionSlider(depthGroup, 'sizeBase', 'size', 0.5, 8, 0.1, 'px');
    motionSlider(depthGroup, 'sizeVariance', 'size variance', 0, 6, 0.1, 'px');
    inspector.appendChild(depthGroup);

    const camGroup = el('div','group');
    camGroup.appendChild(el('div','group-name','CAMERA'));
    const orbitRow = el('div','param-row');
    orbitRow.appendChild(el('div','param-label').appendChild(el('b',null,'orbit')).parentNode);
    const orbitSeg = el('div','segmented');
    [['off','Off'],['slow','Slow'],['medium','Medium']].forEach(([id,label]) => {
      const b = el('button','seg-btn'+(id===state.orbit?' active':''), label);
      b.addEventListener('click', () => { state.orbit=id; [...orbitSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
      orbitSeg.appendChild(b);
    });
    orbitRow.appendChild(orbitSeg);
    camGroup.appendChild(orbitRow);
    inspector.appendChild(camGroup);

    const bgGroup = el('div','group');
    bgGroup.appendChild(el('div','group-name','BACKGROUND'));
    const bgRow = el('div','color-row');
    const bgColor = document.createElement('input'); bgColor.type='color'; bgColor.value=state.bg;
    bgColor.addEventListener('input', () => { state.bg=bgColor.value; applyBg(); });
    bgRow.appendChild(bgColor);
    bgGroup.appendChild(bgRow);
    inspector.appendChild(bgGroup);

    const frameGroup = el('div','group');
    frameGroup.appendChild(el('div','group-name','FRAME'));
    const frameSeg = el('div','segmented');
    FRAME_PRESETS.forEach(f => {
      const b = el('button','seg-btn'+(f.id===state.frame.id?' active':''), f.id);
      b.addEventListener('click', () => { state.frame=f; applyFrameSize(); [...frameSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
      frameSeg.appendChild(b);
    });
    frameGroup.appendChild(frameSeg);
    inspector.appendChild(frameGroup);

    const timingGroup = el('div','group');
    timingGroup.appendChild(el('div','group-name','TIMING'));
    const durRow = el('div','param-row');
    const durLab = el('div','param-label'); durLab.appendChild(el('b',null,'loop duration'));
    const durVal = el('span',null,state.loopDuration.toFixed(1)+'s'); durLab.appendChild(durVal);
    durRow.appendChild(durLab);
    const durSeg = el('div','segmented');
    [3,6,10,15].forEach(s => {
      const b = el('button','seg-btn'+(s===state.loopDuration?' active':''), s+'s');
      b.addEventListener('click', () => { state.loopDuration=s; durVal.textContent=s.toFixed(1)+'s'; durSlider.value=s; [...durSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
      durSeg.appendChild(b);
    });
    durRow.appendChild(durSeg);
    const durSlider = document.createElement('input');
    durSlider.type='range'; durSlider.min=1; durSlider.max=20; durSlider.step=0.5; durSlider.value=state.loopDuration;
    durSlider.style.marginTop='8px';
    durSlider.addEventListener('input', () => { state.loopDuration=parseFloat(durSlider.value); durVal.textContent=state.loopDuration.toFixed(1)+'s'; [...durSeg.children].forEach(c=>c.classList.remove('active')); });
    durRow.appendChild(durSlider);
    timingGroup.appendChild(durRow);
    inspector.appendChild(timingGroup);
  }

  /* ---------------- transport ---------------- */
  playBtn.addEventListener('click', () => {
    if(!points) return;
    if(isPlaying){ pausedElapsed=currentElapsed(performance.now()); isPlaying=false; playBtn.textContent='▶'; }
    else { sessionStart=performance.now(); isPlaying=true; playBtn.textContent='❚❚'; }
  });

  exportBtn.addEventListener('click', () => {
    if(!points || exporting) return;
    if(typeof outputCanvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined'){
      toast('Video export is not supported in this browser.'); return;
    }
    exporting = true;
    const wasPlaying = isPlaying;
    const duration = Math.max(1, state.loopDuration);
    pausedElapsed = 0; sessionStart = performance.now(); isPlaying = true;

    let mimeType = 'video/webm;codecs=vp9';
    if(!MediaRecorder.isTypeSupported(mimeType)) mimeType='video/webm;codecs=vp8';
    if(!MediaRecorder.isTypeSupported(mimeType)) mimeType='video/webm';

    let recorder;
    try{
      const stream = outputCanvas.captureStream(30);
      recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 10000000});
    } catch(err){ toast('Could not start recording in this browser.'); exporting=false; return; }

    const chunks = [];
    recorder.ondataavailable = e => { if(e.data && e.data.size>0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, {type:'video/webm'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download='forge-particles.webm';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      exporting=false; exportBtn.textContent='Export video'; exportBtn.disabled=false;
      isPlaying=wasPlaying; if(!wasPlaying) pausedElapsed=currentElapsed(performance.now());
      playBtn.textContent = isPlaying?'❚❚':'▶';
      toast('Particle loop exported as WebM.');
    };
    exportBtn.textContent='Recording…'; exportBtn.disabled=true;
    recorder.start();
    setTimeout(() => { if(recorder.state!=='inactive') recorder.stop(); }, Math.round(duration*1000)+120);
  });

  /* ---------------- init ---------------- */
  applyFrameSize();
  applyBg();
  buildInspector();
  requestAnimationFrame(render);

})();
