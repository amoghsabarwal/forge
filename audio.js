/* audio.js — Forge audio analysis.
 *
 * One global audio track the whole composition can react to. Loads a file, runs it through
 * a Web Audio analyser, and every frame extracts a few normalized signals:
 *
 *   bass   low end (kick/sub)          — the usual "pulse to the beat" driver
 *   mids   body (snare, vocals)
 *   highs  air (hats, cymbals)
 *   level  overall loudness envelope
 *   beat   a short-lived spike on detected onsets (discrete hit, not continuous)
 *
 * Effect parameters read these through ForgeFX.setAudioSource — see fx.js paramValue.
 *
 * Scope, stated honestly: audio can't be embedded in a saved project or .forge file (audio
 * files are far too large for localStorage and would bloat a downloadable project), so the
 * track attaches per session — you re-add it when you reopen, same as video. And this drives
 * the *visuals* only; muxing the sound into the exported video is a separate, later feature.
 */
window.ForgeAudio = (function(){
  "use strict";

  let ctx = null, analyser = null, sourceNode = null, mediaEl = null;
  let freq = null, time = null;
  let loaded = false, playing = false;
  let url = null, fileName = '';

  // smoothed band values, so a param riding them doesn't jitter frame to frame
  const smooth = { bass:0, mids:0, highs:0, level:0, beat:0 };
  const SMOOTHING = 0.6;      // 0 = raw, 1 = frozen; higher = smoother/laggier
  let beatEnv = 0, bassHistory = [];

  const listeners = [];
  function onChange(fn){ listeners.push(fn); }
  function emit(){ listeners.forEach(fn => { try{ fn(); }catch(e){} }); }

  function ensureCtx(){
    if(!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return false;
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      freq = new Uint8Array(analyser.frequencyBinCount);
      time = new Uint8Array(analyser.frequencyBinCount);
    }
    return true;
  }

  function load(file){
    if(!ensureCtx()) return Promise.reject(new Error('Web Audio not supported'));
    return new Promise((resolve, reject) => {
      try{
        if(url){ URL.revokeObjectURL(url); }
        if(mediaEl){ mediaEl.pause(); }
        url = URL.createObjectURL(file);
        fileName = file.name.replace(/\.[^.]+$/,'');
        mediaEl = new Audio();
        mediaEl.src = url;
        mediaEl.loop = true;
        mediaEl.crossOrigin = 'anonymous';
        mediaEl.addEventListener('loadedmetadata', () => {
          try{
            sourceNode = ctx.createMediaElementSource(mediaEl);
            sourceNode.connect(analyser);
            analyser.connect(ctx.destination); // so you hear it while working
            loaded = true;
            emit();
            resolve({name:fileName, duration:mediaEl.duration});
          } catch(e){ reject(e); }
        }, {once:true});
        mediaEl.addEventListener('error', () => reject(new Error('Could not load audio')), {once:true});
      } catch(e){ reject(e); }
    });
  }

  function clear(){
    if(mediaEl){ mediaEl.pause(); mediaEl.src = ''; }
    if(url){ URL.revokeObjectURL(url); url = null; }
    loaded = false; playing = false; fileName = '';
    smooth.bass = smooth.mids = smooth.highs = smooth.level = smooth.beat = 0;
    emit();
  }

  // Bind audio playback to the composition transport, so play/scrub/seek move the track too.
  function syncTo(t, isPlaying){
    if(!loaded || !mediaEl) return;
    if(ctx && ctx.state === 'suspended') ctx.resume();
    if(isPlaying){
      if(mediaEl.paused){
        try{ mediaEl.currentTime = t % (mediaEl.duration || 1); }catch(e){}
        mediaEl.play().catch(()=>{});
      } else if(Math.abs(mediaEl.currentTime - t) > 0.3){
        try{ mediaEl.currentTime = t % (mediaEl.duration || 1); }catch(e){}
      }
      playing = true;
    } else {
      if(!mediaEl.paused) mediaEl.pause();
      try{ mediaEl.currentTime = t % (mediaEl.duration || 1); }catch(e){}
      playing = false;
    }
  }

  // Average a slice of the FFT bins into a 0..1 value.
  function bandAverage(lo, hi){
    let sum = 0;
    for(let i=lo;i<hi;i++) sum += freq[i];
    return (sum / Math.max(1,(hi-lo))) / 255;
  }

  // Called once per rendered frame by the app. Reads the analyser and updates the signals.
  function update(){
    if(!loaded || !analyser) return;
    analyser.getByteFrequencyData(freq);

    const bins = analyser.frequencyBinCount;
    // rough band splits across the spectrum (FFT bins are linear in frequency)
    const bass  = bandAverage(0, Math.floor(bins*0.08));
    const mids  = bandAverage(Math.floor(bins*0.08), Math.floor(bins*0.35));
    const highs = bandAverage(Math.floor(bins*0.35), bins);
    const level = bandAverage(0, bins);

    // beat detection: compare current bass to a running average; a strong jump = onset
    bassHistory.push(bass);
    if(bassHistory.length > 43) bassHistory.shift(); // ~0.7s at 60fps
    const avg = bassHistory.reduce((a,b)=>a+b,0) / bassHistory.length;
    if(bass > avg * 1.35 && bass > 0.25) beatEnv = 1;
    else beatEnv *= 0.86; // decay the beat spike

    const k = SMOOTHING;
    smooth.bass  = smooth.bass *k + bass *(1-k);
    smooth.mids  = smooth.mids *k + mids *(1-k);
    smooth.highs = smooth.highs*k + highs*(1-k);
    smooth.level = smooth.level*k + level*(1-k);
    smooth.beat  = Math.max(beatEnv, smooth.beat*0.8);
  }

  function level(band){ return smooth[band] || 0; }

  const BANDS = [
    {id:'bass', label:'Bass'}, {id:'mids', label:'Mids'}, {id:'highs', label:'Highs'},
    {id:'level', label:'Level'}, {id:'beat', label:'Beat'}
  ];

  return {
    BANDS, onChange,
    load, clear, syncTo, update, level,
    get loaded(){ return loaded; },
    get name(){ return fileName; },
    get supported(){ return !!(window.AudioContext || window.webkitAudioContext); }
  };
})();
