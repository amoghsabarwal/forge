/* comp.js — Forge composition model and renderer.
 *
 * The core idea, and the thing that separates this from the old editor: a composition is
 * an ordered list of independent layers. Each layer owns its own content, transform and
 * effect stack. Nothing is applied globally unless the user puts it in the composition
 * stack. Adding a layer never touches any other layer.
 *
 * Render order per frame:
 *   for each visible layer, bottom to top:
 *     draw content into a scratch canvas at composition size, with its transform
 *     run that layer's effect chain over the scratch canvas (GPU)
 *     composite the result onto the stage with the layer's opacity + blend mode
 *   run the composition effect chain over the finished stage
 */
window.ForgeComp = (function(){
  "use strict";

  const BLEND_MODES = ['normal','multiply','screen','overlay','soft-light','difference','lighten','darken'];
  const FRAME_PRESETS = [
    {id:'16:9', w:1280, h:720}, {id:'4:3', w:1000, h:750}, {id:'1:1', w:900, h:900},
    {id:'4:5', w:800, h:1000}, {id:'9:16', w:620, h:1102}
  ];

  // Animatable layer properties. `path` is what a keyframe track is keyed on.
  const TRANSFORM_PROPS = [
    {key:'x',        label:'position x', min:-2000, max:2000, step:1,    unit:'px'},
    {key:'y',        label:'position y', min:-2000, max:2000, step:1,    unit:'px'},
    {key:'scale',    label:'scale',      min:0.05,  max:5,    step:0.01, unit:'×'},
    {key:'rotation', label:'rotation',   min:-180,  max:180,  step:1,    unit:'°'},
    {key:'opacity',  label:'opacity',    min:0,     max:1,    step:0.01, unit:''}
  ];

  const state = {
    frame: FRAME_PRESETS[0],
    duration: 6,
    fpsCap: 60,
    layers: [],          // bottom .. top (index 0 renders first)
    compFx: [],          // composition-wide effect stack
    selection: {type:'composition', layerId:null, fxUid:null},
    exportResMult: 1
  };

  let nextLayerId = 1;
  const listeners = [];
  function onChange(fn){ listeners.push(fn); }
  function emit(what){ listeners.forEach(fn => { try{ fn(what); }catch(e){ console.error(e); } }); }

  /* ---------------- layers ---------------- */

  function makeLayer(kind, name){
    return {
      id: nextLayerId++,
      kind,                       // 'image' | 'text' | 'solid'
      name: name || kind,
      visible: true,
      locked: false,
      solo: false,
      transform: {x:0, y:0, scale:1, rotation:0, opacity:1},
      blend: 'normal',
      fx: [],                     // this layer's own effects — never inherited
      keys: {},                   // propPath -> [{t, v}]
      img: null,                  // image layers
      text: {content:'Forge', size:96, color:'#f2efea', weight:'700', font:'Inter'},
      solid: {color:'#101010'}
    };
  }

  function addImageLayer(img, name){
    const layer = makeLayer('image', name || 'Image');
    layer.img = img;
    state.layers.push(layer);
    select('layer', layer.id);
    emit('layers');
    return layer;
  }
  function addTextLayer(){
    const layer = makeLayer('text', 'Text');
    state.layers.push(layer);
    select('layer', layer.id);
    emit('layers');
    return layer;
  }
  function addSolidLayer(){
    const layer = makeLayer('solid', 'Background');
    state.layers.unshift(layer); // backgrounds belong at the bottom
    select('layer', layer.id);
    emit('layers');
    return layer;
  }
  function layerById(id){ return state.layers.find(l => l.id === id); }
  function layerIndex(id){ return state.layers.findIndex(l => l.id === id); }

  function removeLayer(id){
    const i = layerIndex(id);
    if(i < 0) return null;
    const [removed] = state.layers.splice(i,1);
    if(state.selection.layerId === id) select('composition');
    emit('layers');
    return {layer:removed, index:i};
  }
  function restoreLayer(layer, index){
    state.layers.splice(Math.min(index, state.layers.length), 0, layer);
    emit('layers');
  }
  function duplicateLayer(id){
    const src = layerById(id);
    if(!src) return;
    const copy = JSON.parse(JSON.stringify({...src, img:null}));
    copy.id = nextLayerId++;
    copy.name = src.name + ' copy';
    copy.img = src.img;             // share the decoded bitmap, don't re-decode
    copy.fx = src.fx.map(f => Object.assign(JSON.parse(JSON.stringify(f)), {uid: ForgeFX.makeInstance(f.typeId).uid}));
    state.layers.splice(layerIndex(id)+1, 0, copy);
    select('layer', copy.id);
    emit('layers');
  }
  function moveLayer(id, delta){
    const i = layerIndex(id), j = i + delta;
    if(i < 0 || j < 0 || j >= state.layers.length) return;
    [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
    emit('layers');
  }
  function reorderLayer(fromIdx, toIdx){
    if(fromIdx === toIdx) return;
    const [moved] = state.layers.splice(fromIdx,1);
    state.layers.splice(toIdx, 0, moved);
    emit('layers');
  }

  function select(type, layerId, fxUid){
    state.selection = {type, layerId: layerId||null, fxUid: fxUid||null};
    emit('selection');
  }
  function selectedLayer(){ return state.selection.layerId ? layerById(state.selection.layerId) : null; }

  function soloActive(){ return state.layers.some(l => l.solo); }
  function layerRenders(layer){
    if(!layer.visible) return false;
    if(soloActive() && !layer.solo) return false;
    return true;
  }

  /* ---------------- keyframes ---------------- */

  function keyList(layer, path){ return layer.keys[path]; }
  function hasKeys(layer, path){ const k = layer.keys[path]; return !!(k && k.length); }

  function setKey(layer, path, t, v){
    const list = layer.keys[path] || (layer.keys[path] = []);
    const at = list.find(k => Math.abs(k.t - t) < 0.001);
    if(at) at.v = v;
    else { list.push({t, v}); list.sort((a,b) => a.t - b.t); }
    emit('keys');
  }
  function removeKey(layer, path, t){
    const list = layer.keys[path];
    if(!list) return;
    const i = list.findIndex(k => Math.abs(k.t - t) < 0.001);
    if(i >= 0) list.splice(i,1);
    if(list.length === 0) delete layer.keys[path];
    emit('keys');
  }
  function clearKeys(layer, path){ delete layer.keys[path]; emit('keys'); }

  function smoothstep(t){ return t*t*(3-2*t); }

  // Value of an animated property at time t. No keys -> the static value the user set.
  function valueAt(layer, path, staticValue, t){
    const list = layer.keys[path];
    if(!list || list.length === 0) return staticValue;
    if(list.length === 1) return list[0].v;
    if(t <= list[0].t) return list[0].v;
    if(t >= list[list.length-1].t) return list[list.length-1].v;
    for(let i=0;i<list.length-1;i++){
      const a = list[i], b = list[i+1];
      if(t >= a.t && t <= b.t){
        const span = b.t - a.t;
        const local = span > 0 ? (t - a.t)/span : 0;
        return a.v + (b.v - a.v)*smoothstep(local); // eased, so motion doesn't look robotic
      }
    }
    return staticValue;
  }

  function transformAt(layer, t){
    const tr = layer.transform;
    return {
      x:        valueAt(layer, 'transform.x', tr.x, t),
      y:        valueAt(layer, 'transform.y', tr.y, t),
      scale:    valueAt(layer, 'transform.scale', tr.scale, t),
      rotation: valueAt(layer, 'transform.rotation', tr.rotation, t),
      opacity:  valueAt(layer, 'transform.opacity', tr.opacity, t)
    };
  }
  function fxPath(inst, key){ return 'fx.' + inst.uid + '.' + key; }

  /* ---------------- canvases ---------------- */

  const stage = document.createElement('canvas');   // composite target
  const sctx = stage.getContext('2d');
  const scratch = document.createElement('canvas'); // one layer at a time
  const cctx = scratch.getContext('2d');
  let view = null, vctx = null;                     // the visible canvas, set by ui.js

  function attachView(canvasEl){
    view = canvasEl;
    vctx = view.getContext('2d');
    applyFrameSize();
  }

  function applyFrameSize(){
    const w = state.frame.w, h = state.frame.h;
    stage.width = w; stage.height = h;
    scratch.width = w; scratch.height = h;
    if(view){ view.width = w; view.height = h; }
    if(ForgeFX.supported) ForgeFX.resize(w, h);
    emit('frame');
  }

  function setFrame(preset){ state.frame = preset; applyFrameSize(); }

  /* ---------------- drawing ---------------- */

  function drawLayerContent(layer, t){
    const W = scratch.width, H = scratch.height;
    cctx.clearRect(0,0,W,H);
    const tr = transformAt(layer, t);

    if(layer.kind === 'solid'){
      cctx.fillStyle = layer.solid.color;
      cctx.fillRect(0,0,W,H);
      return tr;
    }

    cctx.save();
    cctx.translate(W/2 + tr.x, H/2 + tr.y);
    cctx.rotate(tr.rotation*Math.PI/180);
    cctx.scale(tr.scale, tr.scale);

    if(layer.kind === 'image' && layer.img){
      const iw = layer.img.naturalWidth, ih = layer.img.naturalHeight;
      const fit = Math.min(W/iw, H/ih);
      cctx.drawImage(layer.img, -iw*fit/2, -ih*fit/2, iw*fit, ih*fit);
    } else if(layer.kind === 'text'){
      const tx = layer.text;
      cctx.font = tx.weight + ' ' + tx.size + 'px ' + tx.font + ', Inter, sans-serif';
      cctx.fillStyle = tx.color;
      cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
      cctx.fillText(tx.content, 0, 0);
    }
    cctx.restore();
    return tr;
  }

  // Bounding box of a layer's content in composition pixels — used for selection handles.
  function layerBounds(layer, t){
    const W = stage.width, H = stage.height;
    const tr = transformAt(layer, t);
    if(layer.kind === 'solid') return {x:0, y:0, w:W, h:H, rotation:0};
    let cw = W*0.5, ch = H*0.5;
    if(layer.kind === 'image' && layer.img){
      const iw = layer.img.naturalWidth, ih = layer.img.naturalHeight;
      const fit = Math.min(W/iw, H/ih);
      cw = iw*fit; ch = ih*fit;
    } else if(layer.kind === 'text'){
      cctx.font = layer.text.weight + ' ' + layer.text.size + 'px ' + layer.text.font + ', Inter, sans-serif';
      cw = cctx.measureText(layer.text.content).width;
      ch = layer.text.size*1.2;
    }
    cw *= tr.scale; ch *= tr.scale;
    return {x: W/2 + tr.x - cw/2, y: H/2 + tr.y - ch/2, w:cw, h:ch, rotation:tr.rotation};
  }

  function renderFrame(t, targetCtx, targetCanvas, resMult){
    const W = stage.width, H = stage.height;
    const theta = (t/Math.max(0.001, state.duration))*Math.PI*2;
    const pixelScale = (resMult || 1);

    sctx.clearRect(0,0,W,H);

    state.layers.forEach(layer => {
      if(!layerRenders(layer)) return;
      const tr = drawLayerContent(layer, t);

      // this layer's own chain — keyframed base value first, oscillator on top
      let source = scratch;
      if(ForgeFX.hasActive(layer.fx)){
        const out = ForgeFX.run(scratch, layer.fx, {
          theta, pixelScale,
          resolve: (inst, spec) => valueAt(layer, fxPath(inst, spec.key), inst.params[spec.key], t)
        });
        if(out) source = out;
      }

      sctx.save();
      sctx.globalAlpha = Math.max(0, Math.min(1, tr.opacity));
      sctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
      sctx.drawImage(source, 0, 0, W, H);
      sctx.restore();
    });

    // composition stack — explicit, never implicit
    let finalSource = stage;
    if(ForgeFX.hasActive(state.compFx)){
      const out = ForgeFX.run(stage, state.compFx, {
        theta, pixelScale,
        resolve: (inst, spec) => inst.params[spec.key]
      });
      if(out) finalSource = out;
    }

    const ctx = targetCtx || vctx;
    const cv = targetCanvas || view;
    if(!ctx || !cv) return;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(finalSource, 0, 0, cv.width, cv.height);
  }

  /* ---------------- transport ---------------- */

  let playing = false, playStart = 0, playFrom = 0, time = 0, lastDraw = 0, exporting = false;
  let frameMs = 16.7;

  function currentTime(){ return time; }
  function isPlaying(){ return playing; }
  function setTime(t){
    time = Math.max(0, Math.min(state.duration, t));
    if(playing){ playStart = performance.now(); playFrom = time; }
    emit('time');
  }
  function play(){
    playing = true; playStart = performance.now(); playFrom = time;
    emit('transport');
  }
  function pause(){ playing = false; emit('transport'); }
  function togglePlay(){ playing ? pause() : play(); }

  function tick(now){
    requestAnimationFrame(tick);
    if(!view) return;

    if(playing){
      const elapsed = (now - playStart)/1000 + playFrom;
      time = elapsed % state.duration;
      emit('time-quiet');
    }
    if(!exporting && state.fpsCap > 0){
      if(now - lastDraw < 1000/state.fpsCap - 1.5) return;
    }
    const t0 = performance.now();
    lastDraw = now;
    renderFrame(time);
    frameMs = frameMs*0.9 + (performance.now()-t0)*0.1;
  }

  function perf(){ return {frameMs, cost: ForgeFX.costOf([state.compFx].concat(state.layers.map(l => l.fx)))}; }

  /* ---------------- export ---------------- */

  function exportVideo(opts, onStatus){
    opts = opts || {};
    if(typeof MediaRecorder === 'undefined'){ onStatus && onStatus('error','Recording is not supported in this browser.'); return; }
    const mult = state.exportResMult;
    const outW = state.frame.w*mult, outH = state.frame.h*mult;

    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const octx = out.getContext('2d');

    if(typeof out.captureStream !== 'function'){ onStatus && onStatus('error','Recording is not supported in this browser.'); return; }

    let mime = 'video/webm;codecs=vp9';
    if(!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
    if(!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

    let recorder;
    try{
      recorder = new MediaRecorder(out.captureStream(30), {mimeType:mime, videoBitsPerSecond:14000000});
    } catch(err){ onStatus && onStatus('error','Could not start recording.'); return; }

    const chunks = [];
    const wasPlaying = playing, resumeAt = time;
    exporting = true; playing = false;
    onStatus && onStatus('start');

    recorder.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      exporting = false;
      time = resumeAt; playing = wasPlaying;
      if(playing){ playStart = performance.now(); playFrom = time; }
      const blob = new Blob(chunks, {type:'video/webm'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'forge-composition.webm';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onStatus && onStatus('done');
      emit('transport');
    };

    // Render the loop frame by frame at a fixed step rather than trusting wall-clock, so
    // the exported file has even timing even if a frame takes longer than its slot.
    const fps = 30, total = Math.max(1, Math.round(state.duration*fps));
    let frame = 0;
    recorder.start();
    function step(){
      if(frame > total){
        if(recorder.state !== 'inactive') recorder.stop();
        return;
      }
      renderFrame((frame/fps) % state.duration, octx, out, mult);
      onStatus && onStatus('progress', Math.round(frame/total*100));
      frame++;
      setTimeout(step, 1000/fps);
    }
    step();
  }

  /* ---------------- persistence (settings only; images stay in the browser) ---------------- */

  const KEY = 'forge:composition:v1';
  function serialize(){
    return {
      frameId: state.frame.id,
      duration: state.duration,
      fpsCap: state.fpsCap,
      exportResMult: state.exportResMult,
      compFx: state.compFx,
      layers: state.layers.map(l => ({
        kind:l.kind, name:l.name, visible:l.visible, locked:l.locked,
        transform:l.transform, blend:l.blend, fx:l.fx, keys:l.keys,
        text:l.text, solid:l.solid
      }))
    };
  }
  let lastSaved = '';
  function save(){
    try{
      const json = JSON.stringify(serialize());
      if(json !== lastSaved){ localStorage.setItem(KEY, json); lastSaved = json; }
    } catch(e){ /* storage unavailable */ }
  }
  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return false;
      const s = JSON.parse(raw);
      const f = FRAME_PRESETS.find(p => p.id === s.frameId);
      if(f) state.frame = f;
      if(typeof s.duration === 'number') state.duration = s.duration;
      if(typeof s.fpsCap === 'number') state.fpsCap = s.fpsCap;
      if(typeof s.exportResMult === 'number') state.exportResMult = s.exportResMult;
      if(Array.isArray(s.compFx)) state.compFx = s.compFx;
      if(Array.isArray(s.layers)){
        state.layers = s.layers.map(sl => {
          const l = makeLayer(sl.kind, sl.name);
          Object.assign(l, {
            visible:sl.visible !== false, locked:!!sl.locked,
            transform:Object.assign(l.transform, sl.transform||{}),
            blend:sl.blend||'normal', fx:sl.fx||[], keys:sl.keys||{},
            text:Object.assign(l.text, sl.text||{}), solid:Object.assign(l.solid, sl.solid||{})
          });
          return l; // image layers come back without pixels — the user re-adds those
        });
      }
      return true;
    } catch(e){ return false; }
  }

  function start(){
    ForgeFX.init();
    requestAnimationFrame(tick);
    setInterval(save, 2000);
    window.addEventListener('beforeunload', save);
  }

  return {
    state, BLEND_MODES, FRAME_PRESETS, TRANSFORM_PROPS,
    onChange, emit,
    addImageLayer, addTextLayer, addSolidLayer,
    layerById, layerIndex, removeLayer, restoreLayer, duplicateLayer, moveLayer, reorderLayer,
    select, selectedLayer, layerRenders,
    setKey, removeKey, clearKeys, keyList, hasKeys, valueAt, transformAt, fxPath,
    attachView, applyFrameSize, setFrame, layerBounds, renderFrame,
    currentTime, setTime, play, pause, togglePlay, isPlaying, perf,
    exportVideo, load, start,
    get stageSize(){ return {w:stage.width, h:stage.height}; }
  };
})();
