/* landing-bg.js — the animated mesh gradient behind the landing page.
 *
 * This is the same idea as Forge's own "Gradient" effect (see fx.js) — four moving color
 * fields blended by inverse-distance weight — reimplemented standalone so the landing page
 * doesn't have to load the whole editor engine just to paint its background. Same math,
 * same brand colors, no dependency on fx.js/comp.js.
 *
 * Falls back to the static hero.jpg (already set via CSS on .landing) if WebGL isn't
 * available — the canvas simply never draws and the CSS background shows through.
 */
(function(){
  "use strict";
  const canvas = document.getElementById('bgCanvas');
  if(!canvas) return;
  const gl = canvas.getContext('webgl', {antialias:false, alpha:false, powerPreference:'low-power'})
          || canvas.getContext('experimental-webgl');
  if(!gl) return; // CSS background-image on .landing (hero.jpg) is the fallback

  const VERT = `
    attribute vec2 aPos; varying vec2 vUv;
    void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;
  const FRAG = `
    precision highp float; varying vec2 vUv;
    uniform vec2 uResolution; uniform float uTheta;
    uniform vec3 uColorA, uColorB, uColorC, uColorD;

    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

    void main(){
      // correct for aspect ratio so the fields stay circular, not stretched
      vec2 uv = vUv; uv.x *= uResolution.x/uResolution.y;
      float asp = uResolution.x/uResolution.y;
      float t = uTheta * 0.16;
      vec2 pa = vec2(0.28+0.26*sin(t*0.7), 0.28+0.26*cos(t*0.9)) * vec2(asp,1.0);
      vec2 pb = vec2(0.72+0.26*sin(t*1.1+2.0), 0.32+0.26*cos(t*0.6+1.0)) * vec2(asp,1.0);
      vec2 pc = vec2(0.32+0.26*sin(t*0.8+4.0), 0.72+0.26*cos(t*1.2+3.0)) * vec2(asp,1.0);
      vec2 pd = vec2(0.72+0.26*sin(t*0.5+1.5), 0.72+0.26*cos(t*0.9+5.0)) * vec2(asp,1.0);
      // Sharper falloff (higher power) than a plain inverse-distance blend — colors stay
      // vivid near each point instead of averaging toward mud everywhere in between, which
      // is what made the first version read as dull/flat rather than a bold mesh gradient.
      float wa = 1.0/pow(distance(uv,pa)*1.6+0.12, 1.6);
      float wb = 1.0/pow(distance(uv,pb)*1.6+0.12, 1.6);
      float wc = 1.0/pow(distance(uv,pc)*1.6+0.12, 1.6);
      float wd = 1.0/pow(distance(uv,pd)*1.6+0.12, 1.6);
      float sum = wa+wb+wc+wd;
      vec3 grad = (uColorA*wa + uColorB*wb + uColorC*wc + uColorD*wd)/sum;
      // Push saturation up a touch further — the raw blend still averages toward the
      // midpoint of the palette; boosting relative to luminance keeps it feeling vivid
      // instead of washed out, without needing to touch the source color values.
      float lum = dot(grad, vec3(0.299,0.587,0.114));
      grad = mix(vec3(lum), grad, 1.28);
      // Subtle animated film grain — the difference between a flat gradient and one that
      // reads as premium/tactile rather than plasticky, per the same reasoning used for
      // Forge's own Grain effect in the editor.
      float grain = (hash(gl_FragCoord.xy + uTheta*37.0) - 0.5) * 0.035;
      gl_FragColor = vec4(clamp(grad + grain, 0.0, 1.0), 1.0);
    }`;

  function compile(src, type){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ console.error('landing-bg shader:', gl.getShaderInfoLog(sh)); return null; }
    return sh;
  }
  const vs = compile(VERT, gl.VERTEX_SHADER), fs = compile(FRAG, gl.FRAGMENT_SHADER);
  if(!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){ console.error('landing-bg link:', gl.getProgramInfoLog(prog)); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'uResolution');
  const uTheta = gl.getUniformLocation(prog, 'uTheta');
  const uA = gl.getUniformLocation(prog, 'uColorA');
  const uB = gl.getUniformLocation(prog, 'uColorB');
  const uC = gl.getUniformLocation(prog, 'uColorC');
  const uD = gl.getUniformLocation(prog, 'uColorD');
  // same brand colors used everywhere else: blue / pink / orange / cyan
  // Same brand family as the editor, pushed to fuller saturation for a hero background —
  // a UI accent color and a "fill the whole screen, make it pop" hero color have different
  // jobs; these are chosen for the latter.
  gl.uniform3f(uA, 0.02, 0.42, 1.00);   // electric blue
  gl.uniform3f(uB, 1.00, 0.08, 0.55);   // hot pink/magenta
  gl.uniform3f(uC, 1.00, 0.47, 0.08);   // saturated orange
  gl.uniform3f(uD, 0.02, 0.92, 0.78);   // vivid cyan

  function resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth*dpr), h = Math.round(canvas.clientHeight*dpr);
    if(canvas.width !== w || canvas.height !== h){
      canvas.width = w; canvas.height = h;
      gl.viewport(0,0,w,h);
      gl.uniform2f(uRes, w, h);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // Respect reduced-motion: render one still frame instead of animating.
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let start = performance.now();
  function frame(now){
    resize();
    const theta = reduceMotion ? 0 : (now - start)/1000;
    gl.uniform1f(uTheta, theta);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if(!reduceMotion) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
