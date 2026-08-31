/* ui.js — Forge editor interface.
 *
 * Three panels driven by one selection: left is the scene, centre is the canvas, right is
 * the inspector for whatever is selected, bottom is the timeline. The inspector never
 * shows every control at once — it shows the controls for the current selection only.
 */
(function(){
  "use strict";

  const C = window.ForgeComp, FX = window.ForgeFX;

  const $ = id => document.getElementById(id);
  const layersEl = $('layerList'), inspectorEl = $('inspector'),
        stageWrap = $('stageWrap'), stageCanvas = $('stage'), overlay = $('overlay'),
        timelineEl = $('timelineTracks'), rulerEl = $('timelineRuler'),
        playhead = $('playhead'), timeLabel = $('timeLabel'), perfEl = $('perfReadout'),
        toastEl = $('toast'), zoomLabel = $('zoomLabel');

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function toast(msg, action){
    toastEl.innerHTML = '';
    toastEl.appendChild(document.createTextNode(msg));
    if(action){
      const b = el('button','toast-action', action.label);
      b.addEventListener('click', () => { action.onClick(); toastEl.classList.remove('show'); });
      toastEl.appendChild(b);
    }
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), action ? 5000 : 2600);
  }
  function fmt(v, step){ return Number.isInteger(step) ? Math.round(v) : (+v).toFixed(2); }
  // effect color swatches store 0..1 rgb triples; <input type=color> speaks hex
  function rgbToHex(c){
    const h = n => Math.max(0,Math.min(255,Math.round(n*255))).toString(16).padStart(2,'0');
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  }
  function hexToRgb(hex){
    const n = parseInt(hex.slice(1),16);
    return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255];
  }

  /* ================= canvas view (zoom / fit) ================= */

  let zoom = 1, fitMode = true;

  function applyZoom(){
    const {w,h} = C.stageSize;
    if(fitMode){
      const box = stageWrap.getBoundingClientRect();
      const pad = 56;
      zoom = Math.min((box.width-pad)/w, (box.height-pad)/h, 1.6);
    }
    stageCanvas.style.width = (w*zoom)+'px';
    stageCanvas.style.height = (h*zoom)+'px';
    overlay.style.width = (w*zoom)+'px';
    overlay.style.height = (h*zoom)+'px';
    zoomLabel.textContent = Math.round(zoom*100)+'%';
    drawOverlay();
  }
  function setZoom(z, keepManual){
    fitMode = !keepManual ? fitMode : false;
    zoom = Math.max(0.1, Math.min(4, z));
    applyZoom();
  }

  /* ================= selection overlay (transform handles) ================= */

  const HANDLES = [
    {id:'nw', fx:0, fy:0}, {id:'ne', fx:1, fy:0},
    {id:'sw', fx:0, fy:1}, {id:'se', fx:1, fy:1}
  ];

  function drawOverlay(){
    overlay.innerHTML = '';
    const layer = C.selectedLayer();
    if(!layer || C.state.selection.type === 'composition') return;
    if(layer.kind === 'solid') return; // fills the frame; nothing meaningful to drag
    const b = C.layerBounds(layer, C.currentTime());

    const box = el('div','sel-box');
    box.style.left = (b.x*zoom)+'px';
    box.style.top = (b.y*zoom)+'px';
    box.style.width = (b.w*zoom)+'px';
    box.style.height = (b.h*zoom)+'px';
    box.style.transform = 'rotate('+b.rotation+'deg)';
    if(layer.locked) box.classList.add('locked');

    if(!layer.locked){
      HANDLES.forEach(h => {
        const dot = el('div','sel-handle sel-'+h.id);
        dot.style.left = (h.fx*100)+'%';
        dot.style.top = (h.fy*100)+'%';
        dot.dataset.handle = h.id;
        box.appendChild(dot);
      });
      const rot = el('div','sel-rotate');
      rot.dataset.handle = 'rotate';
      box.appendChild(rot);
    }
    overlay.appendChild(box);
  }

  // pointer interaction: click to select, drag to move, handles to scale/rotate
  let drag = null;

  function pointToStage(e){
    const r = stageCanvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)/zoom, y:(e.clientY-r.top)/zoom};
  }
  function hitLayer(p){
    const t = C.currentTime();
    for(let i=C.state.layers.length-1; i>=0; i--){
      const l = C.state.layers[i];
      if(!C.layerRenders(l) || l.locked || l.kind === 'solid') continue;
      const b = C.layerBounds(l, t);
      if(p.x >= b.x && p.x <= b.x+b.w && p.y >= b.y && p.y <= b.y+b.h) return l;
    }
    return null;
  }

  overlay.addEventListener('pointerdown', e => {
    const handle = e.target.dataset && e.target.dataset.handle;
    const p = pointToStage(e);
    const layer = handle ? C.selectedLayer() : hitLayer(p);
    if(!layer){ C.select('composition'); return; }
    if(!handle) C.select('layer', layer.id);
    if(layer.locked) return;

    const tr = C.transformAt(layer, C.currentTime());
    drag = {layer, handle: handle||'move', start:p, tr:{...tr}};
    overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  overlay.addEventListener('pointermove', e => {
    if(!drag) return;
    const p = pointToStage(e);
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    const l = drag.layer;

    if(drag.handle === 'move'){
      l.transform.x = drag.tr.x + dx;
      l.transform.y = drag.tr.y + dy;
    } else if(drag.handle === 'rotate'){
      const {w,h} = C.stageSize;
      const cx = w/2 + drag.tr.x, cy = h/2 + drag.tr.y;
      const a0 = Math.atan2(drag.start.y-cy, drag.start.x-cx);
      const a1 = Math.atan2(p.y-cy, p.x-cx);
      let deg = drag.tr.rotation + (a1-a0)*180/Math.PI;
      if(e.shiftKey) deg = Math.round(deg/15)*15;
      l.transform.rotation = Math.max(-180, Math.min(180, deg));
    } else {
      const b = C.layerBounds(l, C.currentTime());
      const base = Math.max(40, Math.max(b.w, b.h));
      const sign = (drag.handle === 'se' || drag.handle === 'ne') ? 1 : -1;
      l.transform.scale = Math.max(0.05, Math.min(5, drag.tr.scale + sign*(dx+dy)/base));
    }
    drawOverlay();
    refreshInspectorValues();
  });

  function endDrag(e){
    if(!drag) return;
    try{ overlay.releasePointerCapture(e.pointerId); }catch(_){}
    drag = null;
  }
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  /* ================= layers panel ================= */

  function buildLayers(){
    layersEl.innerHTML = '';
    // top of the panel = top of the stack, so reverse the render order for display
    [...C.state.layers].reverse().forEach(layer => {
      const realIdx = C.layerIndex(layer.id);
      const row = el('div','layer-row'+(C.state.selection.layerId === layer.id ? ' active':''));
      row.draggable = true;
      row.dataset.idx = realIdx;

      const vis = el('button','layer-icon'+(layer.visible?'':' off'), layer.visible ? '◉' : '○');
      vis.title = 'Show / hide';
      vis.addEventListener('click', e => { e.stopPropagation(); layer.visible = !layer.visible; buildLayers(); });
      row.appendChild(vis);

      const name = el('span','layer-name', layer.name);
      name.title = 'Double-click to rename';
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        const input = el('input','layer-rename');
        input.value = layer.name;
        name.replaceWith(input);
        input.focus(); input.select();
        const commit = () => { layer.name = input.value.trim() || layer.name; buildLayers(); };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', ev => {
          if(ev.key === 'Enter') commit();
          if(ev.key === 'Escape') buildLayers();
        });
      });
      row.appendChild(name);

      const badges = el('span','layer-badges');
      if(layer.fx.length) badges.appendChild(el('span','layer-badge', String(layer.fx.length)+' fx'));
      if(Object.keys(layer.keys).length) badges.appendChild(el('span','layer-badge key','◆'));
      row.appendChild(badges);

      const solo = el('button','layer-icon small'+(layer.solo?' on':''), 'S');
      solo.title = 'Solo';
      solo.addEventListener('click', e => { e.stopPropagation(); layer.solo = !layer.solo; buildLayers(); });
      row.appendChild(solo);

      const lock = el('button','layer-icon small'+(layer.locked?' on':''), layer.locked?'🔒':'🔓');
      lock.title = 'Lock';
      lock.addEventListener('click', e => { e.stopPropagation(); layer.locked = !layer.locked; buildLayers(); drawOverlay(); });
      row.appendChild(lock);

      row.addEventListener('click', () => C.select('layer', layer.id));

      row.addEventListener('dragstart', e => {
        row.classList.add('dragging');
        e.dataTransfer.setData('text/plain', String(realIdx));
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'),10);
        if(!isNaN(from)) C.reorderLayer(from, realIdx);
      });

      layersEl.appendChild(row);

      // effects belonging to this layer, nested so ownership is visible at a glance
      if(C.state.selection.layerId === layer.id && layer.fx.length){
        layer.fx.forEach(inst => {
          const type = FX.typeById(inst.typeId);
          if(!type) return;
          const fxRow = el('div','layer-fx-row'+(C.state.selection.fxUid === inst.uid ? ' active':''));
          fxRow.appendChild(el('span','layer-fx-tick','└'));
          fxRow.appendChild(el('span','layer-fx-name', type.label));
          if(!inst.enabled) fxRow.appendChild(el('span','layer-badge','off'));
          fxRow.addEventListener('click', e => { e.stopPropagation(); C.select('fx', layer.id, inst.uid); });
          layersEl.appendChild(fxRow);
        });
      }
    });

    const compRow = el('div','layer-row comp-row'+(C.state.selection.type === 'composition' ? ' active':''));
    compRow.appendChild(el('span','layer-icon','▣'));
    compRow.appendChild(el('span','layer-name','Composition'));
    if(C.state.compFx.length) compRow.appendChild(el('span','layer-badge', C.state.compFx.length+' fx'));
    compRow.addEventListener('click', () => C.select('composition'));
    layersEl.appendChild(compRow);
  }

  /* ================= inspector ================= */

  const liveValueRefreshers = [];

  function slider(parent, opts){
    const row = el('div','param-row');
    const lab = el('div','param-label');
    lab.appendChild(el('b', null, opts.label));
    const right = el('span','param-right');
    const val = el('span', null, fmt(opts.get(), opts.step) + (opts.unit||''));
    right.appendChild(val);
    if(opts.onKey){
      const kb = el('button','key-btn'+(opts.hasKey && opts.hasKey() ? ' on':''), '◆');
      kb.title = 'Add / remove a keyframe at the playhead';
      kb.addEventListener('click', () => { opts.onKey(); buildInspector(); buildTimeline(); });
      right.appendChild(kb);
    }
    if(opts.onAnim){
      const ab = el('button','anim-btn'+(opts.animOn && opts.animOn() ? ' on':''), '∿');
      ab.title = 'Animate with an oscillator';
      ab.addEventListener('click', () => { opts.onAnim(); buildInspector(); });
      right.appendChild(ab);
    }
    if(opts.onAudio){
      const audioReady = window.ForgeAudio && ForgeAudio.loaded;
      const ub = el('button','audio-btn'+(opts.audioOn && opts.audioOn() ? ' on':''), '♪');
      ub.title = audioReady ? 'React to the audio track' : 'Load an audio track first (♪ Audio in the toolbar)';
      if(!audioReady) ub.classList.add('dim');
      ub.addEventListener('click', () => {
        if(!audioReady){ toast('Load an audio track first — ♪ Audio in the toolbar.'); return; }
        opts.onAudio(); buildInspector();
      });
      right.appendChild(ub);
    }
    lab.appendChild(right);
    const input = document.createElement('input');
    input.type = 'range'; input.min = opts.min; input.max = opts.max; input.step = opts.step;
    input.value = opts.get();
    input.addEventListener('input', () => {
      opts.set(parseFloat(input.value));
      val.textContent = fmt(opts.get(), opts.step) + (opts.unit||'');
      if(opts.after) opts.after();
    });
    // commit one history entry when the drag ends, not per-pixel during it
    input.addEventListener('change', () => { C.commit(); });
    row.appendChild(lab); row.appendChild(input);
    parent.appendChild(row);
    liveValueRefreshers.push(() => {
      input.value = opts.get();
      val.textContent = fmt(opts.get(), opts.step) + (opts.unit||'');
    });
    return row;
  }

  function refreshInspectorValues(){ liveValueRefreshers.forEach(fn => fn()); }

  function group(title, actions){
    const g = el('div','group');
    const head = el('div','group-head');
    head.appendChild(el('span','group-name', title));
    if(actions) head.appendChild(actions);
    g.appendChild(head);
    inspectorEl.appendChild(g);
    return g;
  }

  function effectStackUI(container, stack, owner){
    // owner: the layer whose stack this is, or null for the composition stack
    if(!stack.length) container.appendChild(el('p','hint','No effects on this ' + (owner ? 'layer' : 'composition') + ' yet.'));

    stack.forEach((inst, idx) => {
      const type = FX.typeById(inst.typeId);
      if(!type) return;
      const card = el('div','fx-card'+(inst.enabled?' on':'')+(C.state.selection.fxUid === inst.uid ? ' sel':''));

      const head = el('div','group-head');
      const nm = el('span','fx-name');
      nm.appendChild(el('span','fx-index', String(idx+1)));
      nm.appendChild(document.createTextNode(type.label));
      head.appendChild(nm);

      const tools = el('span','fx-tools');
      function tool(label, title, fn, disabled){
        const b = el('button','icon-btn', label);
        b.title = title;
        if(disabled) b.disabled = true;
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        tools.appendChild(b);
      }
      tool('↑','Move up', () => { [stack[idx-1],stack[idx]]=[stack[idx],stack[idx-1]]; buildInspector(); C.commit(); }, idx===0);
      tool('↓','Move down', () => { [stack[idx+1],stack[idx]]=[stack[idx],stack[idx+1]]; buildInspector(); C.commit(); }, idx===stack.length-1);
      tool('⟲','Reset', () => { FX.resetInstance(inst); buildInspector(); C.commit(); });
      tool('⧉','Duplicate', () => {
        const copy = JSON.parse(JSON.stringify(inst));
        copy.uid = FX.makeInstance(inst.typeId).uid;
        stack.splice(idx+1,0,copy); buildInspector(); buildLayers(); C.commit();
      });
      tool('×','Remove', () => {
        stack.splice(idx,1);
        buildInspector(); buildLayers(); buildTimeline(); C.commit();
        toast(type.label + ' removed.', {label:'Undo', onClick: () => C.undo()});
      });
      head.appendChild(tools);

      const sw = el('label','switch');
      const cb = document.createElement('input');
      cb.type='checkbox'; cb.checked = inst.enabled;
      cb.addEventListener('change', () => { inst.enabled = cb.checked; card.classList.toggle('on', inst.enabled); body.style.display = inst.enabled?'block':'none'; buildLayers(); C.commit(); });
      sw.appendChild(cb); sw.appendChild(el('span','track')); sw.appendChild(el('span','thumb'));
      head.appendChild(sw);
      card.appendChild(head);

      const body = el('div');
      body.style.display = inst.enabled ? 'block' : 'none';

      type.params.forEach(spec => {
        const path = C.fxPath(inst, spec.key);
        const anim = inst.anim[spec.key] || (inst.anim[spec.key] = {on:false, amount:0.4, speed:1, wave:'sine', phase:0});
        const audio = (inst.audio && inst.audio[spec.key]) || ((inst.audio = inst.audio || {})[spec.key] = {on:false, amount:0.5, band:'bass'});
        slider(body, {
          label: spec.key, min: spec.min, max: spec.max, step: spec.step,
          unit: spec.degrees ? '°' : '',
          get: () => inst.params[spec.key],
          set: v => { inst.params[spec.key] = v; },
          hasKey: owner ? () => C.hasKeys(owner, path) : null,
          onKey: owner ? () => {
            const t = C.currentTime();
            const list = C.keyList(owner, path);
            const at = list && list.find(k => Math.abs(k.t-t) < 0.001);
            if(at) C.removeKey(owner, path, t); else C.setKey(owner, path, t, inst.params[spec.key]);
          } : null,
          animOn: () => anim.on,
          onAnim: () => { anim.on = !anim.on; },
          audioOn: () => audio.on,
          onAudio: () => { audio.on = !audio.on; if(audio.on) C.commit(); }
        });
        if(anim.on){
          const box = el('div','anim-box');
          const waveSel = document.createElement('select');
          waveSel.className = 'select-input anim-select';
          FX.WAVES.forEach(w => {
            const o = document.createElement('option');
            o.value = w.id; o.textContent = w.label;
            if(w.id === anim.wave) o.selected = true;
            waveSel.appendChild(o);
          });
          waveSel.addEventListener('change', () => { anim.wave = waveSel.value; });
          box.appendChild(waveSel);
          [['amount',0,1,0.01],['speed',0.25,8,0.25],['phase',0,6.28,0.01]].forEach(([k,mn,mx,st]) => {
            slider(box, {label:k, min:mn, max:mx, step:st, get:()=>anim[k], set:v=>{anim[k]=v;}});
          });
          body.appendChild(box);
        }
        if(audio.on){
          const abox = el('div','audio-box');
          const bandSel = document.createElement('select');
          bandSel.className = 'select-input anim-select';
          ForgeAudio.BANDS.forEach(bd => {
            const o = document.createElement('option');
            o.value = bd.id; o.textContent = bd.label;
            if(bd.id === audio.band) o.selected = true;
            bandSel.appendChild(o);
          });
          bandSel.addEventListener('change', () => { audio.band = bandSel.value; });
          abox.appendChild(bandSel);
          slider(abox, {label:'amount', min:-1, max:1, step:0.01, get:()=>audio.amount, set:v=>{audio.amount=v;}});
          body.appendChild(abox);
        }
      });

      // color swatches — only effects that declare `colors` (currently the gradient) get these
      if(type.colors){
        type.colors.forEach(ck => {
          const row = el('div','param-row');
          const lab = el('div','param-label');
          lab.appendChild(el('b',null,ck.key.replace('color','color ')));
          row.appendChild(lab);
          const picker = document.createElement('input');
          picker.type = 'color';
          picker.className = 'fx-color';
          const cur = (inst.colors && inst.colors[ck.key]) || ck.default;
          picker.value = rgbToHex(cur);
          picker.addEventListener('input', () => {
            if(!inst.colors) inst.colors = {};
            inst.colors[ck.key] = hexToRgb(picker.value);
          });
          row.appendChild(picker);
          body.appendChild(row);
        });
      }

      const dsRow = el('div','param-row');
      const dsLab = el('div','param-label');
      dsLab.appendChild(el('b',null,'render at'));
      dsRow.appendChild(dsLab);
      const dsSeg = el('div','segmented');
      FX.DOWNSAMPLE_STEPS.forEach(d => {
        const b = el('button','seg-btn'+(Math.abs(d-(inst.downsample||1))<0.001?' active':''), d===1?'Full':(d*100)+'%');
        b.addEventListener('click', () => {
          inst.downsample = d;
          [...dsSeg.children].forEach(c=>c.classList.remove('active'));
          b.classList.add('active');
        });
        dsSeg.appendChild(b);
      });
      dsRow.appendChild(dsSeg);
      body.appendChild(dsRow);

      card.appendChild(body);
      card.addEventListener('click', () => {
        if(owner) C.select('fx', owner.id, inst.uid);
      });
      container.appendChild(card);
    });

    const addWrap = el('div','param-row');
    const sel = document.createElement('select');
    sel.className = 'select-input';
    const ph = document.createElement('option');
    ph.value=''; ph.textContent = '+ Add effect…'; ph.selected = true;
    sel.appendChild(ph);
    const groups = {};
    FX.LIBRARY.forEach(t => { (groups[t.group] = groups[t.group] || []).push(t); });
    Object.keys(groups).forEach(gname => {
      const og = document.createElement('optgroup');
      og.label = gname;
      groups[gname].forEach(t => {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = t.label;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.addEventListener('change', () => {
      if(!sel.value) return;
      const inst = FX.makeInstance(sel.value);
      if(inst) stack.push(inst);
      buildInspector(); buildLayers(); C.commit();
    });
    addWrap.appendChild(sel);
    container.appendChild(addWrap);

    // copy / paste the whole stack — build one look, reuse it on another layer
    const cpRow = el('div','fx-clipboard-row');
    const copyBtn = el('button','icon-btn','Copy stack');
    copyBtn.disabled = !stack.length;
    copyBtn.addEventListener('click', () => {
      const n = C.copyEffects(stack);
      toast(n ? n + ' effect' + (n>1?'s':'') + ' copied.' : 'Nothing to copy.');
    });
    cpRow.appendChild(copyBtn);
    if(C.hasCopiedEffects()){
      const pasteBtn = el('button','icon-btn','Paste');
      pasteBtn.addEventListener('click', () => {
        const n = C.pasteEffects(stack, 'append');
        buildInspector(); buildLayers();
        toast(n + ' effect' + (n>1?'s':'') + ' pasted.');
      });
      cpRow.appendChild(pasteBtn);
    }
    container.appendChild(cpRow);
  }

  function buildInspector(){
    inspectorEl.innerHTML = '';
    liveValueRefreshers.length = 0;
    const sel = C.state.selection;

    if(sel.type === 'composition' || !C.selectedLayer()){
      const g = group('COMPOSITION');
      const frameRow = el('div','param-row');
      frameRow.appendChild(el('div','param-label').appendChild(el('b',null,'frame')).parentNode);
      const frameSeg = el('div','segmented');
      C.FRAME_PRESETS.forEach(f => {
        const b = el('button','seg-btn'+(f.id===C.state.frame.id?' active':''), f.id);
        b.addEventListener('click', () => { C.setFrame(f); buildInspector(); applyZoom(); });
        frameSeg.appendChild(b);
      });
      frameRow.appendChild(frameSeg);
      g.appendChild(frameRow);

      slider(g, {label:'duration', min:1, max:30, step:0.5, unit:'s',
        get:()=>C.state.duration, set:v=>{C.state.duration=v;}, after:buildTimeline});

      const fpsRow = el('div','param-row');
      fpsRow.appendChild(el('div','param-label').appendChild(el('b',null,'preview fps')).parentNode);
      const fpsSeg = el('div','segmented');
      [[24,'24'],[30,'30'],[60,'60'],[0,'Max']].forEach(([v,label]) => {
        const b = el('button','seg-btn'+(v===C.state.fpsCap?' active':''), label);
        b.addEventListener('click', () => {
          C.state.fpsCap = v;
          [...fpsSeg.children].forEach(c=>c.classList.remove('active'));
          b.classList.add('active');
        });
        fpsSeg.appendChild(b);
      });
      fpsRow.appendChild(fpsSeg);
      g.appendChild(fpsRow);

      const resRow = el('div','param-row');
      resRow.appendChild(el('div','param-label').appendChild(el('b',null,'export scale')).parentNode);
      const resSeg = el('div','segmented');
      [1,2,3].forEach(m => {
        const b = el('button','seg-btn'+(m===C.state.exportResMult?' active':''), m+'×');
        b.addEventListener('click', () => {
          C.state.exportResMult = m;
          [...resSeg.children].forEach(c=>c.classList.remove('active'));
          b.classList.add('active');
        });
        resSeg.appendChild(b);
      });
      resRow.appendChild(resSeg);
      g.appendChild(resRow);

      const fxG = group('COMPOSITION EFFECTS');
      fxG.appendChild(el('p','hint','These apply to the finished composite, after every layer.'));
      effectStackUI(fxG, C.state.compFx, null);
      return;
    }

    const layer = C.selectedLayer();

    if(sel.type === 'fx' && sel.fxUid){
      const inst = layer.fx.find(f => f.uid === sel.fxUid);
      const type = inst && FX.typeById(inst.typeId);
      if(inst && type){
        const back = el('button','icon-btn','← layer');
        back.addEventListener('click', () => C.select('layer', layer.id));
        const g = group(type.label.toUpperCase(), back);
        g.appendChild(el('p','hint','On layer: ' + layer.name));
        effectStackUI(g, [inst], layer);
        return;
      }
    }

    const tg = group(layer.name.toUpperCase());
    tg.appendChild(el('p','hint', layer.kind + ' layer'));

    C.TRANSFORM_PROPS.forEach(prop => {
      const path = 'transform.' + prop.key;
      slider(tg, {
        label: prop.label, min: prop.min, max: prop.max, step: prop.step, unit: prop.unit,
        get: () => layer.transform[prop.key],
        set: v => { layer.transform[prop.key] = v; },
        after: drawOverlay,
        hasKey: () => C.hasKeys(layer, path),
        onKey: () => {
          const t = C.currentTime();
          const list = C.keyList(layer, path);
          const at = list && list.find(k => Math.abs(k.t-t) < 0.001);
          if(at) C.removeKey(layer, path, t);
          else C.setKey(layer, path, t, layer.transform[prop.key]);
        }
      });
    });

    const blendRow = el('div','param-row');
    blendRow.appendChild(el('div','param-label').appendChild(el('b',null,'blend mode')).parentNode);
    const blendSel = document.createElement('select');
    blendSel.className = 'select-input';
    C.BLEND_MODES.forEach(m => {
      const o = document.createElement('option');
      o.value=m; o.textContent = m;
      if(m===layer.blend) o.selected = true;
      blendSel.appendChild(o);
    });
    blendSel.addEventListener('change', () => { layer.blend = blendSel.value; });
    blendRow.appendChild(blendSel);
    tg.appendChild(blendRow);

    if(layer.kind === 'text'){
      const txg = group('TEXT');
      const ta = document.createElement('textarea');
      ta.className='text-input'; ta.rows=2; ta.value = layer.text.content;
      ta.addEventListener('input', () => { layer.text.content = ta.value; });
      txg.appendChild(ta);
      slider(txg, {label:'size', min:8, max:400, step:1, unit:'px',
        get:()=>layer.text.size, set:v=>{layer.text.size=v;}, after:drawOverlay});
      const cRow = el('div','color-row');
      const ci = document.createElement('input');
      ci.type='color'; ci.value = layer.text.color;
      ci.addEventListener('input', () => { layer.text.color = ci.value; });
      cRow.appendChild(ci);
      const wSel = document.createElement('select');
      wSel.className='select-input';
      [['400','Regular'],['600','Semibold'],['700','Bold'],['800','Heavy']].forEach(([v,l]) => {
        const o=document.createElement('option'); o.value=v; o.textContent=l;
        if(v===layer.text.weight) o.selected=true;
        wSel.appendChild(o);
      });
      wSel.addEventListener('change', () => { layer.text.weight = wSel.value; });
      cRow.appendChild(wSel);
      txg.appendChild(cRow);
    }

    if(layer.kind === 'solid'){
      const sg = group('SOLID');
      const cRow = el('div','color-row');
      const ci = document.createElement('input');
      ci.type='color'; ci.value = layer.solid.color;
      ci.addEventListener('input', () => { layer.solid.color = ci.value; });
      cRow.appendChild(ci);
      sg.appendChild(cRow);
    }

    if(layer.kind === 'video' && layer.video){
      const vg = group('VIDEO');
      const dur = layer.video.duration || 0;
      vg.appendChild(el('p','hint', 'Source clip is ' + dur.toFixed(1) + 's.'
        + (dur < C.state.duration ? ' Shorter than the composition — it will loop.' : '')));
      slider(vg, {label:'start offset', min:0, max:Math.max(0.1,dur), step:0.1, unit:'s',
        get:()=>layer.video.offset, set:v=>{layer.video.offset=v;}});
      const loopRow = el('div','param-row');
      const loopLab = el('div','param-label'); loopLab.appendChild(el('b',null,'loop'));
      loopRow.appendChild(loopLab);
      const sw = el('label','switch');
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = layer.video.loop;
      cb.addEventListener('change', () => { layer.video.loop = cb.checked; });
      sw.appendChild(cb); sw.appendChild(el('span','track')); sw.appendChild(el('span','thumb'));
      loopRow.appendChild(sw);
      vg.appendChild(loopRow);
      vg.appendChild(el('p','hint','Exported video currently has no audio track.'));
    }

    const fxG = group('EFFECTS');
    fxG.appendChild(el('p','hint','Only affect ' + layer.name + '.'));
    effectStackUI(fxG, layer.fx, layer);
  }

  /* ================= timeline ================= */

  function trackRows(){
    const rows = [];
    C.state.layers.forEach(layer => {
      Object.keys(layer.keys).forEach(path => {
        let label = path.replace('transform.','');
        if(path.startsWith('fx.')){
          const uid = parseInt(path.split('.')[1],10);
          const inst = layer.fx.find(f => f.uid === uid);
          const type = inst && FX.typeById(inst.typeId);
          label = (type ? type.label : 'fx') + ' ' + path.split('.')[2];
        }
        rows.push({layer, path, label});
      });
    });
    return rows;
  }

  function buildTimeline(){
    rulerEl.innerHTML = '';
    const dur = C.state.duration;
    const marks = Math.min(12, Math.max(3, Math.round(dur)));
    for(let i=0;i<=marks;i++){
      const t = (i/marks)*dur;
      const tick = el('span','ruler-tick', t.toFixed(t < 10 ? 1 : 0)+'s');
      tick.style.left = (i/marks*100)+'%';
      rulerEl.appendChild(tick);
    }

    timelineEl.innerHTML = '';
    const rows = trackRows();
    if(!rows.length){
      timelineEl.appendChild(el('p','hint','No animated properties yet. Press ◆ next to any parameter to set a keyframe at the playhead.'));
      updatePlayhead();
      return;
    }
    rows.forEach(({layer, path, label}) => {
      const row = el('div','track-row');
      const nameCell = el('div','track-name');
      nameCell.appendChild(el('span','track-layer', layer.name));
      nameCell.appendChild(el('span','track-prop', label));
      nameCell.addEventListener('click', () => C.select('layer', layer.id));
      row.appendChild(nameCell);

      const lane = el('div','track-lane');
      const list = C.keyList(layer, path) || [];
      list.forEach(k => {
        const dot = el('button','key-dot');
        dot.style.left = (k.t/dur*100)+'%';
        dot.title = label + ' @ ' + k.t.toFixed(2) + 's — click to jump, double-click to delete';
        dot.addEventListener('click', e => { e.stopPropagation(); C.setTime(k.t); });
        dot.addEventListener('dblclick', e => {
          e.stopPropagation();
          C.removeKey(layer, path, k.t);
          buildTimeline(); buildInspector(); buildLayers();
        });
        lane.appendChild(dot);
      });
      lane.addEventListener('click', e => {
        const r = lane.getBoundingClientRect();
        C.setTime((e.clientX-r.left)/r.width*dur);
      });
      row.appendChild(lane);
      timelineEl.appendChild(row);
    });
    updatePlayhead();
  }

  function updatePlayhead(){
    const dur = Math.max(0.001, C.state.duration);
    const pct = C.currentTime()/dur*100;
    playhead.style.left = 'calc(var(--track-name-w) + ' + pct + '% * (1 - var(--track-name-w) / 100%))';
    playhead.style.left = '';
    const lane = timelineEl.querySelector('.track-lane') || rulerEl;
    const wrapRect = $('timelineBody').getBoundingClientRect();
    const laneRect = lane.getBoundingClientRect();
    const x = (laneRect.left - wrapRect.left) + laneRect.width*(C.currentTime()/dur);
    playhead.style.transform = 'translateX(' + x + 'px)';
    timeLabel.textContent = C.currentTime().toFixed(2) + ' / ' + dur.toFixed(2) + 's';
  }

  rulerEl.addEventListener('click', e => {
    const r = rulerEl.getBoundingClientRect();
    C.setTime((e.clientX-r.left)/r.width*C.state.duration);
  });

  /* ================= toolbar ================= */

  const imageInput = $('imageInput'), videoInput = $('videoInput');
  $('addImageBtn').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', e => {
    [...e.target.files].forEach(file => loadAssetFile(file));
    imageInput.value = '';
  });
  $('addVideoBtn').addEventListener('click', () => videoInput.click());
  videoInput.addEventListener('change', e => {
    [...e.target.files].forEach(file => loadAssetFile(file));
    videoInput.value = '';
  });
  $('addTextBtn').addEventListener('click', () => { C.addTextLayer(); C.commit(); });
  $('addSolidBtn').addEventListener('click', () => { C.addSolidLayer(); C.commit(); });

  // ---- undo / redo toolbar buttons ----
  $('undoBtn').addEventListener('click', () => { if(C.undo()) toast('Undo'); });
  $('redoBtn').addEventListener('click', () => { if(C.redo()) toast('Redo'); });

  // ---- audio track ----
  const audioInput = $('audioInput');
  const audioBtn = $('audioBtn');
  audioBtn.addEventListener('click', () => {
    if(!window.ForgeAudio || !ForgeAudio.supported){ toast('This browser has no Web Audio support.'); return; }
    if(ForgeAudio.loaded){
      // already have a track — offer to swap or remove
      openModal((panel, close) => {
        modalHeader(panel, 'Audio track');
        panel.appendChild(el('p','modal-text','Current track: ' + ForgeAudio.name + '. Effects can react to it via the ♪ button on any parameter.'));
        const row = el('div','modal-actions');
        const remove = el('button','btn','Remove track');
        remove.addEventListener('click', () => { ForgeAudio.clear(); updateAudioBtn(); close(); toast('Audio track removed.'); });
        const swap = el('button','btn','Replace…');
        swap.addEventListener('click', () => { close(); audioInput.click(); });
        const cancel = el('button','btn btn-primary','Done');
        cancel.addEventListener('click', close);
        row.appendChild(remove); row.appendChild(swap); row.appendChild(cancel);
        panel.appendChild(row);
      });
    } else {
      audioInput.click();
    }
  });
  audioInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if(file) ForgeAudio.load(file)
      .then(info => { updateAudioBtn(); toast('Loaded “' + info.name + '” — add a ♪ driver to any parameter.'); })
      .catch(() => toast('Could not load that audio file.'));
    audioInput.value = '';
  });
  function updateAudioBtn(){
    if(!audioBtn) return;
    const on = window.ForgeAudio && ForgeAudio.loaded;
    audioBtn.classList.toggle('active', !!on);
    audioBtn.textContent = on ? '♪ ' + (ForgeAudio.name.length > 10 ? ForgeAudio.name.slice(0,10)+'…' : ForgeAudio.name) : '♪ Audio';
  }

  function loadImageFile(file){
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // a new asset enters clean: its own layer, no effects, nothing inherited
      C.addImageLayer(img, file.name.replace(/\.[^.]+$/,''));
      C.commit();
    };
    img.onerror = () => toast('Could not load that image.');
    img.src = url;
  }

  function loadVideoFile(file){
    const url = URL.createObjectURL(file);
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.loop = false; // Forge drives looping itself
    el.addEventListener('loadedmetadata', () => {
      C.addVideoLayer(el, file.name.replace(/\.[^.]+$/,''));
      C.commit();
    }, {once:true});
    el.addEventListener('error', () => toast('Could not load that video.'), {once:true});
    el.src = url;
  }

  function loadAssetFile(file){
    if(file.type.startsWith('image/')) loadImageFile(file);
    else if(file.type.startsWith('video/')) loadVideoFile(file);
    else toast('That file is not an image or video.');
  }

  stageWrap.addEventListener('dragover', e => { e.preventDefault(); stageWrap.classList.add('drag'); });
  stageWrap.addEventListener('dragleave', () => stageWrap.classList.remove('drag'));
  stageWrap.addEventListener('drop', e => {
    e.preventDefault();
    stageWrap.classList.remove('drag');
    [...(e.dataTransfer.files||[])].forEach(loadAssetFile);
  });

  $('playBtn').addEventListener('click', () => C.togglePlay());
  $('toStartBtn').addEventListener('click', () => C.setTime(0));
  $('toEndBtn').addEventListener('click', () => C.setTime(C.state.duration));
  $('fitBtn').addEventListener('click', () => { fitMode = true; applyZoom(); });
  $('zoomInBtn').addEventListener('click', () => setZoom(zoom*1.2, true));
  $('zoomOutBtn').addEventListener('click', () => setZoom(zoom/1.2, true));

  /* ================= modal host ================= */

  const modalHost = $('modalHost');
  function openModal(build){
    modalHost.innerHTML = '';
    modalHost.hidden = false;
    const backdrop = el('div','modal-backdrop');
    const panel = el('div','modal');
    backdrop.appendChild(panel);
    modalHost.appendChild(backdrop);
    const close = () => { modalHost.hidden = true; modalHost.innerHTML = ''; };
    backdrop.addEventListener('click', e => { if(e.target === backdrop) close(); });
    build(panel, close);
    return close;
  }
  function modalHeader(panel, title){
    const head = el('div','modal-head');
    head.appendChild(el('h2','modal-title', title));
    panel.appendChild(head);
    return head;
  }

  /* ================= File: New / Save / Open ================= */

  $('newBtn').addEventListener('click', () => {
    openModal((panel, close) => {
      modalHeader(panel, 'New composition');
      panel.appendChild(el('p','modal-text','This clears the current canvas. Save first if you want to keep it.'));
      const row = el('div','modal-actions');
      const cancel = el('button','btn','Cancel');
      cancel.addEventListener('click', close);
      const go = el('button','btn btn-primary','New composition');
      go.addEventListener('click', () => { C.newComposition(); close(); toast('Started a new composition.'); });
      row.appendChild(cancel); row.appendChild(go);
      panel.appendChild(row);
    });
  });

  let currentProjectName = '';
  $('saveBtn').addEventListener('click', () => {
    openModal((panel, close) => {
      modalHeader(panel, 'Save project');
      const label = el('label','modal-label','Project name');
      panel.appendChild(label);
      const input = document.createElement('input');
      input.type='text'; input.className='modal-input'; input.value = currentProjectName || 'Untitled';
      panel.appendChild(input);
      input.focus(); input.select();

      panel.appendChild(el('p','modal-text','Saves into this browser. Use “Download .forge” to keep a file you can move between machines.'));

      const row = el('div','modal-actions');
      const dl = el('button','btn','Download .forge');
      dl.addEventListener('click', () => { C.exportProjectFile(input.value.trim() || 'forge-project'); toast('Downloaded .forge file.'); });
      const cancel = el('button','btn','Cancel');
      cancel.addEventListener('click', close);
      const go = el('button','btn btn-primary','Save');
      const doSave = () => {
        const name = input.value.trim() || 'Untitled';
        const res = C.saveProject(name);
        if(res.ok){ currentProjectName = name; close(); toast('Saved “' + name + '”.'); }
        else toast(res.error || 'Could not save.');
      };
      go.addEventListener('click', doSave);
      input.addEventListener('keydown', e => { if(e.key === 'Enter') doSave(); });
      row.appendChild(dl); row.appendChild(cancel); row.appendChild(go);
      panel.appendChild(row);
    });
  });

  const projectInput = $('projectInput');
  projectInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if(file) C.importProjectFile(file)
      .then(() => toast('Opened “' + file.name.replace(/\.forge$/,'') + '”.'))
      .catch(() => toast('That file could not be opened.'));
    projectInput.value = '';
  });

  $('openBtn').addEventListener('click', () => {
    openModal((panel, close) => {
      modalHeader(panel, 'Open project');
      const projects = C.listProjects();

      if(!projects.length){
        panel.appendChild(el('p','modal-text','No saved projects yet. Save one, or open a .forge file from your computer.'));
      } else {
        const grid = el('div','project-grid');
        projects.forEach(p => {
          const card = el('div','project-card');
          const thumb = el('div','project-thumb');
          if(p.thumb){ const im = document.createElement('img'); im.src = p.thumb; thumb.appendChild(im); }
          card.appendChild(thumb);
          const meta = el('div','project-meta');
          meta.appendChild(el('span','project-name', p.name));
          const when = new Date(p.updated);
          meta.appendChild(el('span','project-date', when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})));
          card.appendChild(meta);
          const del = el('button','project-del','×');
          del.title = 'Delete';
          del.addEventListener('click', ev => {
            ev.stopPropagation();
            C.deleteProject(p.id);
            card.remove();
            toast('Deleted “' + p.name + '”.');
          });
          card.appendChild(del);
          card.addEventListener('click', () => {
            C.loadProject(p.id).then(ok => {
              if(ok){ currentProjectName = p.name; close(); toast('Opened “' + p.name + '”.'); }
              else toast('Could not open that project.');
            });
          });
          grid.appendChild(card);
        });
        panel.appendChild(grid);
      }

      const row = el('div','modal-actions');
      const fromFile = el('button','btn','Open .forge file…');
      fromFile.addEventListener('click', () => { close(); projectInput.click(); });
      const cancel = el('button','btn','Close');
      cancel.addEventListener('click', close);
      row.appendChild(fromFile); row.appendChild(cancel);
      panel.appendChild(row);
    });
  });

  /* ================= Export dialog (format / resolution / fps / duration) ================= */

  const exportBtn = $('exportBtn');
  function runExport(opts){
    exportBtn.disabled = true;
    C.exportVideo(opts, (status, info) => {
      if(status === 'start'){ exportBtn.textContent = 'Rendering…'; }
      else if(status === 'progress'){ exportBtn.textContent = 'Rendering ' + info + '%'; }
      else if(status === 'done'){
        exportBtn.disabled = false; exportBtn.textContent = 'Export';
        if(info && info.fellBack) toast('Your browser can’t export MP4 — saved as WebM instead.');
        else toast('Exported as ' + (info && info.format ? info.format.toUpperCase() : 'video') + '.');
      }
      else if(status === 'error'){ exportBtn.disabled = false; exportBtn.textContent = 'Export'; toast(info || 'Export failed.'); }
    });
  }
  exportBtn.addEventListener('click', () => {
    const caps = C.exportCapabilities();
    openModal((panel, close) => {
      modalHeader(panel, 'Export video');

      const opts = { format: caps.mp4 ? 'mp4' : 'webm', resMult: C.state.exportResMult || 1, fps: 30, duration: C.state.duration };

      // format
      panel.appendChild(el('label','modal-label','Format'));
      const fmtSeg = el('div','segmented');
      [['mp4','MP4'],['webm','WebM']].forEach(([v,lbl]) => {
        const b = el('button','seg-btn'+(opts.format===v?' active':''), lbl);
        if(v === 'mp4' && !caps.mp4){ b.classList.add('disabled'); b.title = 'Your browser can’t record MP4 directly'; }
        b.addEventListener('click', () => {
          opts.format = v;
          [...fmtSeg.children].forEach(c=>c.classList.remove('active'));
          b.classList.add('active');
          mp4note.style.display = (v==='mp4' && !caps.mp4) ? 'block' : 'none';
        });
        fmtSeg.appendChild(b);
      });
      panel.appendChild(fmtSeg);
      const mp4note = el('p','modal-hint','Your browser can’t record MP4 directly — this will fall back to WebM.');
      mp4note.style.display = (opts.format==='mp4' && !caps.mp4) ? 'block' : 'none';
      panel.appendChild(mp4note);

      // resolution
      panel.appendChild(el('label','modal-label','Resolution'));
      const resSeg = el('div','segmented');
      [[1,'1× ('+C.state.frame.w+'×'+C.state.frame.h+')'],[2,'2×'],[3,'3×']].forEach(([m,lbl]) => {
        const b = el('button','seg-btn'+(opts.resMult===m?' active':''), lbl);
        b.addEventListener('click', () => { opts.resMult=m; [...resSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
        resSeg.appendChild(b);
      });
      panel.appendChild(resSeg);

      // fps
      panel.appendChild(el('label','modal-label','Frame rate'));
      const fpsSeg = el('div','segmented');
      [24,30,60].forEach(f => {
        const b = el('button','seg-btn'+(opts.fps===f?' active':''), f+' fps');
        b.addEventListener('click', () => { opts.fps=f; [...fpsSeg.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); });
        fpsSeg.appendChild(b);
      });
      panel.appendChild(fpsSeg);

      // duration
      const durLabel = el('label','modal-label','Duration: ' + opts.duration.toFixed(1) + 's');
      panel.appendChild(durLabel);
      const dur = document.createElement('input');
      dur.type='range'; dur.min=0.5; dur.max=Math.max(30, C.state.duration); dur.step=0.5; dur.value=opts.duration;
      dur.addEventListener('input', () => { opts.duration=parseFloat(dur.value); durLabel.textContent='Duration: '+opts.duration.toFixed(1)+'s'; });
      panel.appendChild(dur);

      const row = el('div','modal-actions');
      const cancel = el('button','btn','Cancel');
      cancel.addEventListener('click', close);
      const go = el('button','btn btn-primary','Export');
      go.addEventListener('click', () => { close(); runExport(opts); });
      row.appendChild(cancel); row.appendChild(go);
      panel.appendChild(row);
    });
  });

  /* ================= resizable right panel ================= */

  (function(){
    const handle = $('panelResize');
    if(!handle) return;
    const root = document.documentElement;
    // restore any saved width
    try{
      const saved = localStorage.getItem('forge:panelw');
      if(saved) root.style.setProperty('--panel-w', saved);
    } catch(e){}
    let dragging = false;
    handle.addEventListener('pointerdown', e => {
      dragging = true; handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if(!dragging) return;
      // panel is on the right, so its width grows as the pointer moves left
      const w = Math.max(220, Math.min(460, window.innerWidth - e.clientX));
      root.style.setProperty('--panel-w', w + 'px');
    });
    function end(e){
      if(!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      try{ localStorage.setItem('forge:panelw', getComputedStyle(root).getPropertyValue('--panel-w').trim()); }catch(_){}
      if(fitMode) applyZoom();
      try{ handle.releasePointerCapture(e.pointerId); }catch(_){}
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  })();

  /* ================= keyboard ================= */

  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const layer = C.selectedLayer();

    // undo / redo — Cmd/Ctrl+Z, and Shift+Cmd/Ctrl+Z (or Ctrl+Y) to redo
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z'){
      e.preventDefault();
      if(e.shiftKey){ if(C.redo()) toast('Redo'); }
      else { if(C.undo()) toast('Undo'); }
      return;
    }
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y'){ e.preventDefault(); if(C.redo()) toast('Redo'); return; }

    if(e.code === 'Space'){ e.preventDefault(); C.togglePlay(); return; }
    if((e.key === 'Delete' || e.key === 'Backspace') && layer){
      e.preventDefault();
      const rm = C.removeLayer(layer.id);
      if(rm){ C.commit(); toast('Layer removed.', {label:'Undo', onClick: () => C.undo()}); }
      return;
    }
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && layer){ e.preventDefault(); C.duplicateLayer(layer.id); C.commit(); return; }
    if(e.key.toLowerCase() === 'h' && layer){ layer.visible = !layer.visible; buildLayers(); C.commit(); return; }
    if(e.key.toLowerCase() === 'l' && layer){ layer.locked = !layer.locked; buildLayers(); drawOverlay(); C.commit(); return; }
    if(e.key.toLowerCase() === 'f'){ fitMode = true; applyZoom(); return; }
    if(layer && !layer.locked && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if(e.key === 'ArrowLeft') layer.transform.x -= step;
      if(e.key === 'ArrowRight') layer.transform.x += step;
      if(e.key === 'ArrowUp') layer.transform.y -= step;
      if(e.key === 'ArrowDown') layer.transform.y += step;
      drawOverlay(); refreshInspectorValues();
      clearTimeout(nudgeCommit); nudgeCommit = setTimeout(() => C.commit(), 400); // coalesce rapid nudges
    }
  });
  let nudgeCommit = null;

  /* ================= wiring ================= */

  C.onChange(what => {
    if(what === 'time-quiet'){ updatePlayhead(); drawOverlay(); return; }
    if(what === 'time'){ updatePlayhead(); drawOverlay(); refreshInspectorValues(); return; }
    if(what === 'transport'){ $('playBtn').textContent = C.isPlaying() ? '❚❚' : '▶'; return; }
    if(what === 'frame'){ applyZoom(); return; }
    if(what === 'keys'){ buildTimeline(); return; }
    if(what === 'history'){ updateHistoryButtons(); return; }
    if(what === 'loaded'){ buildLayers(); buildInspector(); buildTimeline(); applyZoom(); updateHistoryButtons(); return; }
    buildLayers(); buildInspector(); buildTimeline(); drawOverlay();
  });

  function updateHistoryButtons(){
    const u = $('undoBtn'), r = $('redoBtn');
    if(u) u.disabled = !C.canUndo();
    if(r) r.disabled = !C.canRedo();
  }

  window.addEventListener('resize', () => { if(fitMode) applyZoom(); updatePlayhead(); });

  setInterval(() => {
    const p = C.perf();
    perfEl.textContent = p.cost + ' · ' + Math.round(p.frameMs) + 'ms';
  }, 500);

  /* ================= boot ================= */

  if(!FX.supported){
    toast('This browser has no WebGL — effects are unavailable.');
  }
  C.attachView(stageCanvas);
  C.start();

  // Fresh session by default: start clean and OFFER to restore, rather than silently
  // reloading the previous session's work.
  C.addSolidLayer();
  C.select('composition');
  C.seedHistory();
  buildLayers(); buildInspector(); buildTimeline(); applyZoom();
  updateHistoryButtons();

  if(C.hasAutosave()){
    toast('You have an unsaved session from last time.', {label:'Restore', onClick: () => {
      C.restoreAutosave().then(ok => {
        if(ok){ buildLayers(); buildInspector(); buildTimeline(); applyZoom(); toast('Session restored.'); }
        else toast('Could not restore that session.');
      });
    }});
  } else if(!localStorage.getItem('forge:seenIntro')){
    // first-ever visit to the editor (no autosave means nothing has been built here yet) —
    // point to the guide once, then never again.
    try{ localStorage.setItem('forge:seenIntro', '1'); } catch(e){}
    setTimeout(() => {
      toast('New here? The guide covers the basics in a couple minutes.', {label:'Open Guide', onClick: () => {
        window.open('guide.html', '_blank');
      }});
    }, 900);
  }
})();
