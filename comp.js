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
      kind,                       // 'image' | 'text' | 'solid' | 'video'
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
      solid: {color:'#101010'},
      video: null,                // {el, duration, offset, loop} — video layers, see addVideoLayer
      _cache: null                // {sig, canvas, w, h} — internal, used by the static-layer render cache
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
  function addVideoLayer(videoEl, name){
    const layer = makeLayer('video', name || 'Video');
    layer.video = {el: videoEl, duration: videoEl.duration || 0, offset: 0, loop: true};
    state.layers.push(layer);
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
    // img, video, and _cache all hold live DOM objects (an Image/HTMLVideoElement/canvas) —
    // JSON.stringify can't serialize those, so they're stripped here and reattached after.
    const copy = JSON.parse(JSON.stringify({...src, img:null, video:null, _cache:null}));
    copy.id = nextLayerId++;
    copy.name = src.name + ' copy';
    copy.img = src.img;             // share the decoded bitmap, don't re-decode
    if(src.video && src.video.el){
      // a fresh <video> pointed at the same source, so the two layers can play and seek
      // independently instead of fighting over one element's currentTime
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.src = src.video.el.currentSrc || src.video.el.src;
      copy.video = {el, duration: src.video.duration, offset: src.video.offset, loop: src.video.loop};
    }
    copy._cache = null;
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
    } else if(layer.kind === 'video' && layer.video && layer.video.el && layer.video.el.videoWidth){
      const v = layer.video.el;
      const iw = v.videoWidth, ih = v.videoHeight;
      const fit = Math.min(W/iw, H/ih);
      cctx.drawImage(v, -iw*fit/2, -ih*fit/2, iw*fit, ih*fit);
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
    } else if(layer.kind === 'video' && layer.video && layer.video.el && layer.video.el.videoWidth){
      const v = layer.video.el;
      const fit = Math.min(W/v.videoWidth, H/v.videoHeight);
      cw = v.videoWidth*fit; ch = v.videoHeight*fit;
    } else if(layer.kind === 'text'){
      cctx.font = layer.text.weight + ' ' + layer.text.size + 'px ' + layer.text.font + ', Inter, sans-serif';
      cw = cctx.measureText(layer.text.content).width;
      ch = layer.text.size*1.2;
    }
    cw *= tr.scale; ch *= tr.scale;
    return {x: W/2 + tr.x - cw/2, y: H/2 + tr.y - ch/2, w:cw, h:ch, rotation:tr.rotation};
  }

  function fxStackIsAnimated(stack){
    return stack.some(inst => {
      if(!inst.enabled) return false;
      const type = ForgeFX.typeById(inst.typeId);
      if(type && type.animated) return true; // e.g. grain's film noise, scanline scroll
      return Object.values(inst.anim || {}).some(a => a.on && a.amount > 0);
    });
  }
  function layerIsAnimated(layer){
    if(layer.kind === 'video') return true; // video content itself changes every frame
    if(Object.keys(layer.keys).length) return true;
    return fxStackIsAnimated(layer.fx);
  }

  // Cheap fingerprint of everything that affects a static layer's pixels. Recomputing this
  // every frame (a small JSON.stringify) is orders of magnitude cheaper than the content
  // draw + GPU effect chain it lets us skip.
  function layerSignature(layer, t){
    return JSON.stringify({
      tr: transformAt(layer, t), blend: layer.blend,
      fx: layer.fx.map(i => ({t:i.typeId, e:i.enabled, d:i.downsample, p:i.params})),
      content: layer.kind === 'text' ? layer.text
             : layer.kind === 'solid' ? layer.solid
             : layer.kind === 'image' ? (layer.img ? layer.img.src : null)
             : layer.kind === 'video' ? 'video' // always treated as animated — see layerIsAnimated
             : null
    });
  }

  let lastFrameSignature = '';

  // Draws a layer's content and runs its effect chain, leaving the final per-layer result
  // sitting in `scratch` either way — so callers never need to know whether fx ran.
  function renderLayerToScratch(layer, t, theta, pixelScale){
    const tr = drawLayerContent(layer, t);
    if(ForgeFX.hasActive(layer.fx)){
      const out = ForgeFX.run(scratch, layer.fx, {
        theta, pixelScale,
        resolve: (inst, spec) => valueAt(layer, fxPath(inst, spec.key), inst.params[spec.key], t)
      });
      if(out){
        cctx.clearRect(0,0,scratch.width,scratch.height);
        cctx.drawImage(out, 0, 0);
      }
    }
    return tr;
  }

  function renderFrame(t, targetCtx, targetCanvas, resMult){
    const W = stage.width, H = stage.height;
    const theta = (t/Math.max(0.001, state.duration))*Math.PI*2;
    const pixelScale = (resMult || 1);
    const isLivePreview = !targetCtx; // export always passes explicit targets

    // Whole-composition fast path: preview only, nothing animated, nothing changed since
    // the pixels already on screen — there's genuinely nothing to do this frame.
    if(isLivePreview){
      const anyAnimated = state.layers.some(l => layerRenders(l) && layerIsAnimated(l)) || fxStackIsAnimated(state.compFx);
      if(!anyAnimated){
        const layerSigs = state.layers.filter(layerRenders).map(l => l.id + ':' + layerSignature(l, t)).join('|');
        const compSig = JSON.stringify(state.compFx.map(i => ({t:i.typeId, e:i.enabled, d:i.downsample, p:i.params})));
        const sig = layerSigs + '::' + compSig + '::' + W + 'x' + H;
        if(sig === lastFrameSignature) return false; // already showing this exact frame
        lastFrameSignature = sig;
      } else {
        lastFrameSignature = '';
      }
    }

    sctx.clearRect(0,0,W,H);

    state.layers.forEach(layer => {
      if(!layerRenders(layer)) return;
      const animated = layerIsAnimated(layer);

      let source, tr;
      if(!animated && isLivePreview){
        const sig = layerSignature(layer, t);
        if(layer._cache && layer._cache.sig === sig && layer._cache.w === W && layer._cache.h === H){
          source = layer._cache.canvas;
          tr = transformAt(layer, t); // cheap — no keys on a static layer, just reads the plain value
        } else {
          tr = renderLayerToScratch(layer, t, theta, pixelScale);
          const cache = layer._cache && layer._cache.w === W && layer._cache.h === H
            ? layer._cache
            : {canvas: document.createElement('canvas'), w:W, h:H};
          cache.canvas.width = W; cache.canvas.height = H;
          cache.canvas.getContext('2d').drawImage(scratch, 0, 0);
          cache.sig = sig;
          layer._cache = cache;
          source = layer._cache.canvas;
        }
      } else {
        tr = renderLayerToScratch(layer, t, theta, pixelScale);
        source = scratch;
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
    if(!ctx || !cv) return false;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.drawImage(finalSource, 0, 0, cv.width, cv.height);
    return true;
  }

  /* ---------------- transport ---------------- */

  let playing = false, playStart = 0, playFrom = 0, time = 0, lastDraw = 0, exporting = false;
  let frameMs = 16.7;

  function currentTime(){ return time; }
  function isPlaying(){ return playing; }

  // A video layer's own clock is independent of the composition's — this maps comp time
  // to a position inside the video, honoring its offset and (by default) looping it to
  // fill however long the composition runs.
  function videoTimeFor(layer, t){
    const v = layer.video;
    if(!v || !v.duration) return 0;
    const local = t + (v.offset || 0);
    return v.loop ? local % v.duration : Math.min(local, v.duration - 0.01);
  }
  function syncVideosLive(){
    state.layers.forEach(layer => {
      if(layer.kind !== 'video' || !layer.video || !layer.video.el) return;
      const v = layer.video, el = v.el;
      if(playing && layerRenders(layer)){
        const want = videoTimeFor(layer, time);
        if(el.paused) { el.currentTime = want; el.play().catch(()=>{}); }
        else if(Math.abs(el.currentTime - want) > 0.2) el.currentTime = want; // resync on drift
      } else if(!el.paused){
        el.pause();
      }
    });
  }
  // Export needs frame-accurate video: seek every video layer to its exact mapped time and
  // wait for the browser to actually land on that frame before the canvas is captured.
  function seekVideosTo(t){
    const jobs = state.layers
      .filter(l => l.kind === 'video' && l.video && l.video.el && l.video.duration)
      .map(l => new Promise(resolve => {
        const el = l.video.el, want = videoTimeFor(l, t);
        if(Math.abs(el.currentTime - want) < 0.008){ resolve(); return; }
        const done = () => { el.removeEventListener('seeked', done); resolve(); };
        el.addEventListener('seeked', done);
        el.currentTime = want;
        setTimeout(done, 250); // safety net — some browsers skip 'seeked' for tiny deltas
      }));
    return jobs.length ? Promise.all(jobs) : Promise.resolve();
  }

  function setTime(t){
    time = Math.max(0, Math.min(state.duration, t));
    if(playing){ playStart = performance.now(); playFrom = time; }
    state.layers.forEach(layer => {
      if(layer.kind === 'video' && layer.video && layer.video.el && !playing){
        layer.video.el.currentTime = videoTimeFor(layer, time);
      }
    });
    emit('time');
  }
  function play(){
    playing = true; playStart = performance.now(); playFrom = time;
    syncVideosLive();
    emit('transport');
  }
  function pause(){
    playing = false;
    state.layers.forEach(l => { if(l.kind==='video' && l.video && l.video.el) l.video.el.pause(); });
    emit('transport');
  }
  function togglePlay(){ playing ? pause() : play(); }

  function tick(now){
    requestAnimationFrame(tick);
    if(!view) return;

    if(playing){
      const elapsed = (now - playStart)/1000 + playFrom;
      time = elapsed % state.duration;
      syncVideosLive();
      emit('time-quiet');
    }
    if(!exporting && state.fpsCap > 0){
      if(now - lastDraw < 1000/state.fpsCap - 1.5) return;
    }
    const t0 = performance.now();
    lastDraw = now;
    const drew = renderFrame(time);
    if(drew !== false) frameMs = frameMs*0.9 + (performance.now()-t0)*0.1;
  }

  function perf(){ return {frameMs, cost: ForgeFX.costOf([state.compFx].concat(state.layers.map(l => l.fx)))}; }

  /* ---------------- export ---------------- */

  // Export controls: format ('mp4' | 'webm'), resolution multiplier, fps, and duration.
  // Honesty note: true H.264 MP4 out of MediaRecorder is only available in some browsers
  // (Safari, and Chrome with certain codecs). When MP4 is requested we try the browser's
  // MP4 codecs first and fall back to WebM, reporting to the caller which format actually
  // came out — rather than silently handing back a WebM with an .mp4 name.
  function supportedMp4Mime(){
    if(typeof MediaRecorder === 'undefined') return null;
    const candidates = ['video/mp4;codecs=h264', 'video/mp4;codecs=avc1', 'video/mp4'];
    return candidates.find(m => { try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || null;
  }
  function exportCapabilities(){
    return { mp4: !!supportedMp4Mime(), webm: typeof MediaRecorder !== 'undefined' };
  }

  function exportVideo(opts, onStatus){
    opts = opts || {};
    if(typeof MediaRecorder === 'undefined'){ onStatus && onStatus('error','Recording is not supported in this browser.'); return; }

    const mult = opts.resMult || state.exportResMult || 1;
    const fps = Math.max(1, Math.min(60, opts.fps || 30));
    const dur = Math.max(0.1, opts.duration || state.duration);
    const wantMp4 = opts.format === 'mp4';

    const outW = Math.round(state.frame.w*mult), outH = Math.round(state.frame.h*mult);
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const octx = out.getContext('2d');
    if(typeof out.captureStream !== 'function'){ onStatus && onStatus('error','Recording is not supported in this browser.'); return; }

    // pick a mime: honor MP4 if asked and available, else fall back to the best WebM
    let mime, actualFormat;
    if(wantMp4){
      mime = supportedMp4Mime();
      if(mime){ actualFormat = 'mp4'; }
    }
    if(!mime){
      mime = 'video/webm;codecs=vp9';
      if(!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
      if(!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
      actualFormat = 'webm';
    }

    let recorder;
    try{
      recorder = new MediaRecorder(out.captureStream(fps), {mimeType:mime, videoBitsPerSecond:14000000});
    } catch(err){ onStatus && onStatus('error','Could not start recording.'); return; }

    const chunks = [];
    const wasPlaying = playing, resumeAt = time;
    exporting = true; playing = false;
    state.layers.forEach(l => { if(l.kind==='video' && l.video && l.video.el) l.video.el.pause(); });
    onStatus && onStatus('start', {format: actualFormat, requestedMp4: wantMp4});

    recorder.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      exporting = false;
      time = resumeAt; playing = wasPlaying;
      if(playing){ playStart = performance.now(); playFrom = time; }
      const ext = actualFormat === 'mp4' ? 'mp4' : 'webm';
      const blob = new Blob(chunks, {type: actualFormat === 'mp4' ? 'video/mp4' : 'video/webm'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'forge-composition.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      // tell the UI what actually came out, so it can warn if MP4 fell back to WebM
      onStatus && onStatus('done', {format: actualFormat, fellBack: wantMp4 && actualFormat !== 'mp4'});
      emit('transport');
    };

    // Render the loop frame by frame at a fixed step rather than trusting wall-clock, so
    // the exported file has even timing even if a frame takes longer than its slot. When
    // video layers are present, each frame first seeks them to their exact mapped time and
    // waits for the browser to confirm it landed there — slower than the live preview, but
    // it's what makes the exported video frame-accurate instead of a blurry approximation.
    const hasVideo = state.layers.some(l => l.kind === 'video');
    const total = Math.max(1, Math.round(dur*fps));
    let frame = 0;
    recorder.start();
    async function step(){
      if(frame > total){
        if(recorder.state !== 'inactive') recorder.stop();
        return;
      }
      const t = (frame/fps) % state.duration;
      if(hasVideo) await seekVideosTo(t);
      renderFrame(t, octx, out, mult);
      onStatus && onStatus('progress', Math.round(frame/total*100));
      frame++;
      setTimeout(step, 1000/fps);
    }
    step();
  }

  /* ---------------- persistence ----------------
   * Two layers of storage:
   *   - an autosave slot ('last session'), written continuously but NOT loaded on boot —
   *     a fresh session starts clean, and the user is offered a one-click restore instead.
   *   - named projects, each self-contained (images embedded as data URLs) so they survive
   *     properly rather than coming back as empty image layers. These are what "Save" and
   *     the project browser operate on.
   */

  const AUTOSAVE_KEY = 'forge:autosave:v2';
  const PROJECTS_KEY = 'forge:projects:v2';
  const MAX_EMBED_BYTES = 8 * 1024 * 1024; // per-project ceiling on embedded image data

  // Turn an <img>/decoded bitmap into a data URL so it can live inside a saved project.
  function imageToDataURL(img){
    try{
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch(e){ return null; } // tainted canvas (cross-origin) — skip embedding
  }

  // Serialize the whole composition. `embedImages` controls whether image pixels are baked
  // in (true for named projects, false for the lightweight autosave slot).
  function serialize(embedImages){
    return {
      version: 2,
      frameId: state.frame.id,
      duration: state.duration,
      fpsCap: state.fpsCap,
      exportResMult: state.exportResMult,
      compFx: state.compFx,
      layers: state.layers.map(l => {
        const base = {
          kind:l.kind, name:l.name, visible:l.visible, locked:l.locked,
          transform:l.transform, blend:l.blend, fx:l.fx, keys:l.keys,
          text:l.text, solid:l.solid
        };
        if(embedImages && l.kind === 'image' && l.img) base.imageData = imageToDataURL(l.img);
        // video can't be embedded (too large) — it comes back needing the file re-added
        return base;
      })
    };
  }

  // Rebuild live state from a serialized object. Returns a promise because embedded images
  // decode asynchronously. `onImage` isn't needed — we await all decodes before finishing.
  function deserialize(s){
    const f = FRAME_PRESETS.find(p => p.id === s.frameId);
    if(f) state.frame = f;
    if(typeof s.duration === 'number') state.duration = s.duration;
    if(typeof s.fpsCap === 'number') state.fpsCap = s.fpsCap;
    if(typeof s.exportResMult === 'number') state.exportResMult = s.exportResMult;
    state.compFx = Array.isArray(s.compFx) ? s.compFx : [];

    const imageJobs = [];
    state.layers = (Array.isArray(s.layers) ? s.layers : []).map(sl => {
      const l = makeLayer(sl.kind, sl.name);
      Object.assign(l, {
        visible:sl.visible !== false, locked:!!sl.locked,
        transform:Object.assign(l.transform, sl.transform||{}),
        blend:sl.blend||'normal', fx:sl.fx||[], keys:sl.keys||{},
        text:Object.assign(l.text, sl.text||{}), solid:Object.assign(l.solid, sl.solid||{})
      });
      if(sl.kind === 'image' && sl.imageData){
        imageJobs.push(new Promise(res => {
          const img = new Image();
          img.onload = () => { l.img = img; res(); };
          img.onerror = () => res();
          img.src = sl.imageData;
        }));
      }
      return l;
    });

    applyFrameSize();
    select('composition');
    return Promise.all(imageJobs).then(() => { emit('layers'); emit('loaded'); });
  }

  // ---- autosave slot (silent, continuous, never auto-loaded) ----
  let lastSaved = '';
  function autosave(){
    try{
      const json = JSON.stringify(serialize(false));
      if(json !== lastSaved){ localStorage.setItem(AUTOSAVE_KEY, json); lastSaved = json; }
    } catch(e){ /* storage unavailable or full */ }
  }
  function hasAutosave(){
    try{ return !!localStorage.getItem(AUTOSAVE_KEY); } catch(e){ return false; }
  }
  function restoreAutosave(){
    try{
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if(!raw) return Promise.resolve(false);
      return deserialize(JSON.parse(raw)).then(() => true);
    } catch(e){ return Promise.resolve(false); }
  }

  // ---- named projects ----
  function readProjectIndex(){
    try{ return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || []; }
    catch(e){ return []; }
  }
  function writeProjectIndex(list){
    try{ localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); return true; }
    catch(e){ return false; }
  }
  function listProjects(){
    // newest first; index stores metadata only, the payload lives in its own key
    return readProjectIndex().sort((a,b) => b.updated - a.updated);
  }
  function projectThumbnail(){
    // small snapshot of the current stage for the project browser
    try{
      const t = document.createElement('canvas');
      const scale = 160 / Math.max(stage.width, stage.height);
      t.width = Math.round(stage.width*scale); t.height = Math.round(stage.height*scale);
      renderFrame(currentTime());
      t.getContext('2d').drawImage(stage, 0, 0, t.width, t.height);
      return t.toDataURL('image/jpeg', 0.6);
    } catch(e){ return null; }
  }
  function saveProject(name, existingId){
    const id = existingId || ('proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
    let payload;
    try{ payload = JSON.stringify(serialize(true)); }
    catch(e){ return {ok:false, error:'Could not serialize the project.'}; }

    if(payload.length > MAX_EMBED_BYTES){
      return {ok:false, error:'Project is too large to save in the browser (over 8MB of embedded images).'};
    }
    try{
      localStorage.setItem('forge:proj:' + id, payload);
    } catch(e){
      return {ok:false, error:'Browser storage is full — delete an old project and try again.'};
    }
    const index = readProjectIndex().filter(p => p.id !== id);
    index.push({ id, name: name || 'Untitled', updated: Date.now(), thumb: projectThumbnail() });
    if(!writeProjectIndex(index)){
      return {ok:false, error:'Browser storage is full — delete an old project and try again.'};
    }
    return {ok:true, id};
  }
  function loadProject(id){
    try{
      const raw = localStorage.getItem('forge:proj:' + id);
      if(!raw) return Promise.resolve(false);
      return deserialize(JSON.parse(raw)).then(() => true);
    } catch(e){ return Promise.resolve(false); }
  }
  function deleteProject(id){
    try{ localStorage.removeItem('forge:proj:' + id); } catch(e){}
    writeProjectIndex(readProjectIndex().filter(p => p.id !== id));
  }

  // ---- export/import a .forge file (a project as a downloadable file) ----
  function exportProjectFile(name){
    const data = serialize(true);
    data.name = name || 'forge-project';
    const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (name || 'forge-project') + '.forge';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function importProjectFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try{ deserialize(JSON.parse(reader.result)).then(() => resolve(true)); }
        catch(e){ reject(e); }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function newComposition(){
    state.layers = [];
    state.compFx = [];
    state.duration = 6;
    state.frame = FRAME_PRESETS[0];
    applyFrameSize();
    addSolidLayer();
    select('composition');
    time = 0;
    emit('layers'); emit('loaded');
  }

  function start(){
    ForgeFX.init();
    // attachView() already ran applyFrameSize() once, but ForgeFX.resize() silently no-ops
    // before ForgeFX.init() has set it up (this was the actual cause of "effects don't show
    // until I change the frame" — the fx canvas was stuck at its default 300×150 size).
    // Re-apply now that fx is actually ready, so the very first render is correctly sized.
    applyFrameSize();
    requestAnimationFrame(tick);
    setInterval(autosave, 2000);
    window.addEventListener('beforeunload', autosave);
  }

  return {
    state, BLEND_MODES, FRAME_PRESETS, TRANSFORM_PROPS,
    onChange, emit,
    addImageLayer, addTextLayer, addSolidLayer, addVideoLayer,
    layerById, layerIndex, removeLayer, restoreLayer, duplicateLayer, moveLayer, reorderLayer,
    select, selectedLayer, layerRenders,
    setKey, removeKey, clearKeys, keyList, hasKeys, valueAt, transformAt, fxPath,
    attachView, applyFrameSize, setFrame, layerBounds, renderFrame,
    currentTime, setTime, play, pause, togglePlay, isPlaying, perf,
    exportVideo, exportCapabilities, start,
    hasAutosave, restoreAutosave,
    listProjects, saveProject, loadProject, deleteProject,
    exportProjectFile, importProjectFile, newComposition,
    get stageSize(){ return {w:stage.width, h:stage.height}; }
  };
})();
