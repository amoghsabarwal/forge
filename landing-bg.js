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
    void main(){
      // correct for aspect ratio so the fields stay circular, not stretched
      vec2 uv = vUv; uv.x *= uResolution.x/uResolution.y;
      float asp = uResolution.x/uResolution.y;
      float t = uTheta * 0.12;
      vec2 pa = vec2(0.3+0.22*sin(t*0.7), 0.3+0.22*cos(t*0.9)) * vec2(asp,1.0);
      vec2 pb = vec2(0.7+0.22*sin(t*1.1+2.0), 0.35+0.22*cos(t*0.6+1.0)) * vec2(asp,1.0);
      vec2 pc = vec2(0.35+0.22*sin(t*0.8+4.0), 0.7+0.22*cos(t*1.2+3.0)) * vec2(asp,1.0);
      vec2 pd = vec2(0.7+0.22*sin(t*0.5+1.5), 0.7+0.22*cos(t*0.9+5.0)) * vec2(asp,1.0);
      float wa = 1.0/(distance(uv,pa)*1.4+0.15);
      float wb = 1.0/(distance(uv,pb)*1.4+0.15);
      float wc = 1.0/(distance(uv,pc)*1.4+0.15);
      float wd = 1.0/(distance(uv,pd)*1.4+0.15);
      float sum = wa+wb+wc+wd;
      vec3 grad = (uColorA*wa + uColorB*wb + uColorC*wc + uColorD*wd)/sum;
      gl_FragColor = vec4(grad, 1.0);
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
  gl.uniform3f(uA, 0.11, 0.44, 0.88);
  gl.uniform3f(uB, 0.90, 0.14, 0.49);
  gl.uniform3f(uC, 1.00, 0.54, 0.24);
  gl.uniform3f(uD, 0.18, 0.83, 0.75);

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
