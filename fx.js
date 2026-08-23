/* fx.js — Forge effect engine.
 *
 * Standalone WebGL post-processing: an effect *library* (types) plus *instances* that
 * carry their own params, animation and downsample. It has no idea what a layer is —
 * comp.js runs a chain over a layer's pixels and again over the finished composite.
 *
 * Every shader preserves the source alpha. That matters now that effects run per layer:
 * an opaque output would turn a transparent logo into a black rectangle.
 */
window.ForgeFX = (function(){
  "use strict";

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {preserveDrawingBuffer:true, antialias:false, alpha:true, premultipliedAlpha:false})
          || canvas.getContext('experimental-webgl', {alpha:true});

  const VERT = `attribute vec2 aPos; varying vec2 vUv; void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }`;
  const COPY_FRAG = `precision highp float; varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor=texture2D(uTex,vUv); }`;

  const BLOOM = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uThreshold, uIntensity, uRadius;
    void main(){
      vec4 base = texture2D(uTex, vUv);
      vec2 texel = (1.0/uResolution)*uRadius;
      vec3 bloom = vec3(0.0); float total = 0.0;
      for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){
        vec4 s = texture2D(uTex, vUv+vec2(float(x),float(y))*texel);
        float lum = dot(s.rgb, vec3(0.299,0.587,0.114));
        bloom += s.rgb*s.a*smoothstep(uThreshold,1.0,lum); total += 1.0;
      }}
      gl_FragColor = vec4(base.rgb + (bloom/total)*uIntensity, base.a);
    }`;
  const HALFTONE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uScale, uAngle, uContrast;
    void main(){
      vec2 pixel = vUv*uResolution;
      float c=cos(uAngle), s=sin(uAngle);
      mat2 rot=mat2(c,-s,s,c), inv=mat2(c,s,-s,c);
      vec2 p = rot*pixel;
      vec2 cellRot = (floor(p/uScale)+0.5)*uScale;
      vec4 src = texture2D(uTex, clamp((inv*cellRot)/uResolution,0.0,1.0));
      float lum = clamp((dot(src.rgb,vec3(0.299,0.587,0.114))-0.5)*uContrast+0.5,0.0,1.0);
      float radius = (1.0-lum)*uScale*0.62;
      float d = 1.0 - smoothstep(radius-1.0, radius+1.0, length(p-cellRot));
      gl_FragColor = vec4(mix(vec3(1.0),vec3(0.0),d), src.a);
    }`;
  const DITHER = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uLevels, uScale;
    float bayer(vec2 pos){
      float x=mod(floor(pos.x),4.0), y=mod(floor(pos.y),4.0);
      float i=y*4.0+x;
      if(i<0.5)return 0.0/16.0; else if(i<1.5)return 8.0/16.0; else if(i<2.5)return 2.0/16.0;
      else if(i<3.5)return 10.0/16.0; else if(i<4.5)return 12.0/16.0; else if(i<5.5)return 4.0/16.0;
      else if(i<6.5)return 14.0/16.0; else if(i<7.5)return 6.0/16.0; else if(i<8.5)return 3.0/16.0;
      else if(i<9.5)return 11.0/16.0; else if(i<10.5)return 1.0/16.0; else if(i<11.5)return 9.0/16.0;
      else if(i<12.5)return 15.0/16.0; else if(i<13.5)return 7.0/16.0; else if(i<14.5)return 13.0/16.0;
      return 5.0/16.0;
    }
    void main(){
      vec4 src = texture2D(uTex, vUv);
      float t = bayer(vUv*uResolution/uScale) - 0.5;
      gl_FragColor = vec4(clamp(floor(src.rgb*uLevels + t + 0.5)/uLevels,0.0,1.0), src.a);
    }`;
  const GRAIN = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uIntensity, uScale, uTheta;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
      vec2 u=f*f*(3.0-2.0*f);
      return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
    }
    void main(){
      vec4 src = texture2D(uTex, vUv);
      vec2 pixel = vUv*uResolution/uScale;
      vec2 spin = vec2(cos(uTheta),sin(uTheta))*9.0;
      float g = (noise(pixel+spin)+noise(pixel*1.7-spin+31.7))*0.5-0.5;
      gl_FragColor = vec4(clamp(src.rgb+g*uIntensity,0.0,1.0), src.a);
    }`;
  const CHROMATIC = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uAmount, uFalloff;
    void main(){
      vec2 dir = vUv-0.5;
      vec2 off = dir*uAmount*0.02*pow(length(dir)*2.0,uFalloff);
      vec4 a = texture2D(uTex, clamp(vUv+off,0.0,1.0));
      vec4 b = texture2D(uTex, vUv);
      vec4 c = texture2D(uTex, clamp(vUv-off,0.0,1.0));
      gl_FragColor = vec4(a.r, b.g, c.b, max(b.a, max(a.a,c.a)));
    }`;
  const PIXELATE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution; uniform float uSize;
    void main(){
      vec2 cells = max(uResolution/max(uSize,1.0), vec2(1.0));
      gl_FragColor = texture2D(uTex, clamp((floor(vUv*cells)+0.5)/cells,0.0,1.0));
    }`;
  const VIGNETTE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uAmount, uRadius, uSoftness;
    void main(){
      vec4 src = texture2D(uTex, vUv);
      vec2 d = (vUv-0.5)*vec2(uResolution.x/uResolution.y,1.0);
      float v = smoothstep(uRadius, uRadius-max(uSoftness,0.001), length(d));
      gl_FragColor = vec4(src.rgb*mix(1.0,v,uAmount), src.a);
    }`;
  const SCANLINES = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uCount, uIntensity, uSpeed, uTheta;
    void main(){
      vec4 src = texture2D(uTex, vUv);
      float line = sin((vUv.y + uTheta*uSpeed*0.16)*uCount*6.2831853);
      gl_FragColor = vec4(src.rgb*(1.0-uIntensity*(0.5+0.5*line)), src.a);
    }`;
  const OUTLINE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uThickness, uThreshold, uMix;
    float lum(vec2 uv){ vec4 c=texture2D(uTex,clamp(uv,0.0,1.0)); return dot(c.rgb,vec3(0.299,0.587,0.114))*c.a; }
    void main(){
      vec4 base = texture2D(uTex, vUv);
      vec2 t = (1.0/uResolution)*uThickness;
      float gx = lum(vUv+vec2(-t.x,-t.y))*-1.0 + lum(vUv+vec2(t.x,-t.y))
               + lum(vUv+vec2(-t.x,0.0))*-2.0 + lum(vUv+vec2(t.x,0.0))*2.0
               + lum(vUv+vec2(-t.x,t.y))*-1.0 + lum(vUv+vec2(t.x,t.y));
      float gy = lum(vUv+vec2(-t.x,-t.y))*-1.0 + lum(vUv+vec2(-t.x,t.y))
               + lum(vUv+vec2(0.0,-t.y))*-2.0 + lum(vUv+vec2(0.0,t.y))*2.0
               + lum(vUv+vec2(t.x,-t.y))*-1.0 + lum(vUv+vec2(t.x,t.y));
      float edge = smoothstep(uThreshold, uThreshold+0.12, length(vec2(gx,gy)));
      gl_FragColor = vec4(mix(base.rgb, vec3(edge), uMix), max(base.a, edge*uMix));
    }`;
  const GRADE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uExposure, uContrast, uSaturation, uTemperature;
    void main(){
      vec4 src = texture2D(uTex, vUv);
      vec3 c = src.rgb*uExposure;
      c = (c-0.5)*uContrast+0.5;
      c = mix(vec3(dot(c,vec3(0.299,0.587,0.114))), c, uSaturation);
      c.r += uTemperature*0.08; c.b -= uTemperature*0.08;
      gl_FragColor = vec4(clamp(c,0.0,1.0), src.a);
    }`;
  const RIPPLE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uAmplitude, uFrequency, uSpeed, uTheta;
    void main(){
      vec2 d = vUv-0.5;
      float wave = sin(length(d)*uFrequency - uTheta*uSpeed)*uAmplitude*0.01;
      gl_FragColor = texture2D(uTex, clamp(vUv + normalize(d+1e-6)*wave, 0.0, 1.0));
    }`;
  const ASCII = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform sampler2D uAtlas; uniform float uCell, uChars, uColor, uContrast;
    void main(){
      vec2 cells = max(uResolution/max(uCell,3.0), vec2(1.0));
      vec2 idx = floor(vUv*cells), cuv = fract(vUv*cells);
      vec4 src = texture2D(uTex, clamp((idx+0.5)/cells,0.0,1.0));
      float l = clamp((dot(src.rgb,vec3(0.299,0.587,0.114))-0.5)*uContrast+0.5,0.0,1.0);
      float ci = floor(l*(uChars-0.001));
      float glyph = texture2D(uAtlas, vec2((ci+cuv.x)/uChars, cuv.y)).r;
      gl_FragColor = vec4(mix(vec3(glyph), src.rgb*glyph, uColor), src.a*glyph);
    }`;
  const CONTOUR = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uLevels, uThickness, uFade, uIntensity;
    float band(vec2 uv){ vec4 c=texture2D(uTex,clamp(uv,0.0,1.0)); return floor(dot(c.rgb,vec3(0.299,0.587,0.114))*c.a*uLevels); }
    void main(){
      vec4 base = texture2D(uTex, vUv);
      vec2 t = (1.0/uResolution)*uThickness;
      float b = band(vUv);
      float e = abs(band(vUv+vec2(t.x,0.0))-b) + abs(band(vUv+vec2(0.0,t.y))-b);
      float line = step(0.5, e);
      gl_FragColor = vec4(base.rgb*uFade + line*uIntensity, max(base.a, line));
    }`;
  const BLOBS = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uSize, uSpeed, uStrength, uGlow, uTheta;
    void main(){
      vec2 p = (vUv-0.5)*vec2(uResolution.x/uResolution.y,1.0);
      float f = 0.0;
      for(int i=0;i<6;i++){
        float fi=float(i);
        vec2 c = vec2(sin(uTheta*uSpeed+fi*1.7)*0.34, cos(uTheta*uSpeed*0.8+fi*2.3)*0.30);
        vec2 d = p-c; f += (uSize*uSize)/(dot(d,d)+0.0004);
      }
      float m = smoothstep(1.0,1.7,f);
      vec4 src = texture2D(uTex, clamp(vUv - normalize(p+1e-6)*m*uStrength*0.06, 0.0, 1.0));
      gl_FragColor = vec4(clamp(src.rgb + m*uGlow*0.35, 0.0, 1.0), src.a);
    }`;
  const GRID = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uCells, uSpeed, uThickness, uWarp, uIntensity, uTheta;
    void main(){
      vec2 g = vUv*uCells + vec2(uTheta*uSpeed*0.16, uTheta*uSpeed*0.09);
      vec2 cell = floor(g);
      float r = fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);
      vec2 off = vec2(sin(uTheta*uSpeed+r*6.2831853), cos(uTheta*uSpeed*0.7+r*6.2831853))*uWarp*0.008;
      vec4 src = texture2D(uTex, clamp(vUv+off,0.0,1.0));
      vec2 f = abs(fract(g)-0.5);
      float line = 1.0 - smoothstep(0.0, max(uThickness,0.001)*0.06, min(f.x,f.y));
      gl_FragColor = vec4(clamp(src.rgb + line*uIntensity, 0.0, 1.0), max(src.a, line*uIntensity));
    }`;

  /* ---- new effect set (original implementations) ----
     Effects, not code, are what's shared with common shader references — these are written
     from scratch to fit Forge's per-layer, alpha-preserving, oscillator-driven model. The
     post-processing ones default to a gentle built-in motion so they look alive on drop. */

  // Gaussian blur — separable would be faster, but a single-pass sampled kernel keeps the
  // one-shader-per-effect model. uAngle lets the blur sweep direction animate.
  const BLUR = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uRadius, uAngle;
    void main(){
      vec2 texel = (1.0/uResolution) * uRadius;
      float c = cos(uAngle), s = sin(uAngle);
      mat2 rot = mat2(c,-s,s,c);
      vec4 sum = vec4(0.0); float wsum = 0.0;
      for(int x=-4;x<=4;x++){
        for(int y=-4;y<=4;y++){
          vec2 o = rot * vec2(float(x),float(y));
          float w = exp(-(float(x*x+y*y))/8.0);
          sum += texture2D(uTex, vUv + o*texel) * w; wsum += w;
        }
      }
      gl_FragColor = sum/wsum;
    }`;

  // Sobel edge detection in color — distinct from Outline (which keys on luminance/alpha and
  // draws a mask). This keeps per-channel edges, so colored edges survive.
  const EDGE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uThickness, uIntensity, uMix;
    vec3 samp(vec2 uv){ return texture2D(uTex, clamp(uv,0.0,1.0)).rgb; }
    void main(){
      vec2 t = (1.0/uResolution)*uThickness;
      vec3 gx = samp(vUv+vec2(-t.x,-t.y))*-1.0 + samp(vUv+vec2(t.x,-t.y))
              + samp(vUv+vec2(-t.x,0.0))*-2.0 + samp(vUv+vec2(t.x,0.0))*2.0
              + samp(vUv+vec2(-t.x,t.y))*-1.0 + samp(vUv+vec2(t.x,t.y));
      vec3 gy = samp(vUv+vec2(-t.x,-t.y))*-1.0 + samp(vUv+vec2(-t.x,t.y))
              + samp(vUv+vec2(0.0,-t.y))*-2.0 + samp(vUv+vec2(0.0,t.y))*2.0
              + samp(vUv+vec2(t.x,-t.y))*-1.0 + samp(vUv+vec2(t.x,t.y));
      vec3 edge = sqrt(gx*gx + gy*gy) * uIntensity;
      vec4 base = texture2D(uTex, vUv);
      gl_FragColor = vec4(mix(base.rgb, edge, uMix), base.a);
    }`;

  // RGB shift — channels slide apart along an angle that rotates over the loop.
  const RGBSHIFT = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uAmount, uAngle, uTheta;
    void main(){
      float a = uAngle + uTheta;
      vec2 dir = vec2(cos(a), sin(a)) * uAmount * 0.01;
      float r = texture2D(uTex, clamp(vUv+dir,0.0,1.0)).r;
      vec4 g = texture2D(uTex, vUv);
      float b = texture2D(uTex, clamp(vUv-dir,0.0,1.0)).b;
      gl_FragColor = vec4(r, g.g, b, g.a);
    }`;

  // Bad TV — rolling scanline distortion + horizontal jitter + noise, all time-driven.
  const BADTV = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uDistortion, uRoll, uNoise, uTheta;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    void main(){
      float roll = fract(vUv.y + uTheta*uRoll*0.05);
      float jitter = (hash(vec2(floor(roll*80.0), floor(uTheta*8.0)))-0.5) * uDistortion * 0.05;
      vec2 uv = vec2(vUv.x + jitter, vUv.y);
      vec4 src = texture2D(uTex, clamp(uv,0.0,1.0));
      float n = (hash(vUv*uResolution*0.5 + uTheta*13.0)-0.5) * uNoise;
      gl_FragColor = vec4(clamp(src.rgb + n, 0.0, 1.0), src.a);
    }`;

  // Lens — barrel/pincushion distortion with a subtle animated breathing on the strength.
  const LENS = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uStrength, uZoom;
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      vec2 uv = c * (1.0 + uStrength * r2) / uZoom + 0.5;
      if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor = vec4(0.0); return; }
      gl_FragColor = texture2D(uTex, uv);
    }`;

  // Pixel sort — a lightweight approximation: within horizontal bands, pixels brighter than a
  // threshold get pulled along the row, giving the smeared "sort" look. Band offset animates.
  const PIXSORT = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uThreshold, uLength, uTheta;
    void main(){
      vec4 src = texture2D(uTex, vUv);
      float lum = dot(src.rgb, vec3(0.299,0.587,0.114));
      if(lum < uThreshold){ gl_FragColor = src; return; }
      float shift = (uLength/uResolution.x) * (0.5 + 0.5*sin(uTheta + vUv.y*20.0));
      vec4 pulled = texture2D(uTex, vec2(clamp(vUv.x - shift, 0.0, 1.0), vUv.y));
      gl_FragColor = vec4(mix(src.rgb, pulled.rgb, step(uThreshold, lum)), src.a);
    }`;

  // Classic 2D value noise overlay — animated, blends over the layer.
  const NOISEFX = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uScale, uContrast, uMix, uTheta;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
      vec2 u=f*f*(3.0-2.0*f);
      return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
    }
    void main(){
      vec4 src = texture2D(uTex, vUv);
      vec2 p = vUv*uScale + vec2(uTheta*0.3, uTheta*0.2);
      float n = vnoise(p)*0.6 + vnoise(p*2.0)*0.3 + vnoise(p*4.0)*0.1;
      n = clamp((n-0.5)*uContrast + 0.5, 0.0, 1.0);
      gl_FragColor = vec4(mix(src.rgb, vec3(n), uMix), src.a);
    }`;

  // Rain — animated streaks running down the layer, refracting what's behind them.
  const RAIN = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uDensity, uSpeed, uRefract, uTheta;
    float hash(float x){ return fract(sin(x*127.1)*43758.5453); }
    void main(){
      float cols = uDensity;
      float col = floor(vUv.x * cols);
      float speed = 0.4 + hash(col)*0.9;
      float y = fract(vUv.y + uTheta*uSpeed*0.1*speed + hash(col)*10.0);
      float drop = smoothstep(0.0, 0.06, y) * smoothstep(0.5, 0.0, y);
      vec2 uv = vUv + vec2(0.0, drop*uRefract*0.02);
      vec4 src = texture2D(uTex, clamp(uv,0.0,1.0));
      gl_FragColor = vec4(src.rgb + drop*0.12, src.a);
    }`;

  // Geometric tile — kaleidoscope-ish mirrored tiling with an animated rotation.
  const TILE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uTiles, uRotate, uTheta;
    void main(){
      vec2 uv = vUv * uTiles;
      uv = abs(fract(uv) - 0.5);            // mirror within each tile
      float a = uRotate + uTheta*0.2;
      float c = cos(a), s = sin(a);
      uv = mat2(c,-s,s,c) * (uv-0.25) + 0.5;
      gl_FragColor = texture2D(uTex, clamp(uv,0.0,1.0));
    }`;

  // Fire — animated flame gradient rising from the bottom, blended over the layer.
  const FIRE = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uHeight, uIntensity, uMix, uTheta;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
    }
    void main(){
      vec4 src = texture2D(uTex, vUv);
      vec2 p = vec2(vUv.x*6.0, vUv.y*4.0 - uTheta*1.2);
      float n = vnoise(p)*0.6 + vnoise(p*2.0)*0.4;
      float flame = pow(1.0-vUv.y, 1.5) * uHeight + n*0.5;
      float f = smoothstep(0.35, 0.9, flame) * uIntensity;
      vec3 fire = vec3(f*1.5, f*f*0.7, f*f*f*0.2); // hot bottom -> cool top
      gl_FragColor = vec4(clamp(src.rgb + fire*uMix, 0.0, 1.0), src.a);
    }`;

  // Animated gradient — a full generative mesh-gradient wash. Ignores the layer's own pixels
  // (it's a source, not a filter), so it works dropped on a solid layer or blended over one.
  // Four color stops that drift; the whole thing eases through the loop seamlessly.
  const GRADIENT = `
    precision highp float; varying vec2 vUv;
    uniform sampler2D uTex; uniform vec2 uResolution;
    uniform float uSpeed, uScale, uMix, uAngle, uTheta;
    uniform vec3 uColorA, uColorB, uColorC, uColorD;
    void main(){
      float t = uTheta * uSpeed;
      float c = cos(uAngle), s = sin(uAngle);
      vec2 uv = mat2(c,-s,s,c) * (vUv-0.5) + 0.5;
      // four moving radial fields, normalized into weights
      vec2 pa = vec2(0.3+0.2*sin(t*0.7), 0.3+0.2*cos(t*0.9));
      vec2 pb = vec2(0.7+0.2*sin(t*1.1+2.0), 0.35+0.2*cos(t*0.6+1.0));
      vec2 pc = vec2(0.35+0.2*sin(t*0.8+4.0), 0.7+0.2*cos(t*1.2+3.0));
      vec2 pd = vec2(0.7+0.2*sin(t*0.5+1.5), 0.7+0.2*cos(t*0.9+5.0));
      float wa = 1.0/(distance(uv,pa)*uScale+0.15);
      float wb = 1.0/(distance(uv,pb)*uScale+0.15);
      float wc = 1.0/(distance(uv,pc)*uScale+0.15);
      float wd = 1.0/(distance(uv,pd)*uScale+0.15);
      float sum = wa+wb+wc+wd;
      vec3 grad = (uColorA*wa + uColorB*wb + uColorC*wc + uColorD*wd)/sum;
      vec4 src = texture2D(uTex, vUv);
      gl_FragColor = vec4(mix(src.rgb, grad, uMix), max(src.a, uMix));
    }`;

  const LIBRARY = [
    {id:'bloom', label:'Bloom', group:'Light', frag:BLOOM, cost:14,
      params:[{key:'threshold',min:0,max:1,step:0.01,default:0.55},
              {key:'intensity',min:0,max:2,step:0.01,default:0.9},
              {key:'radius',min:0.5,max:5,step:0.1,default:2.0}]},
    {id:'grade', label:'Color grade', group:'Light', frag:GRADE, cost:3,
      params:[{key:'exposure',min:0.2,max:2.5,step:0.01,default:1.0},
              {key:'contrast',min:0.3,max:2.5,step:0.01,default:1.0},
              {key:'saturation',min:0,max:2.5,step:0.01,default:1.0},
              {key:'temperature',min:-1,max:1,step:0.01,default:0}]},
    {id:'vignette', label:'Vignette', group:'Light', frag:VIGNETTE, cost:3,
      params:[{key:'amount',min:0,max:1,step:0.01,default:0.6},
              {key:'radius',min:0.2,max:1.2,step:0.01,default:0.75},
              {key:'softness',min:0.05,max:0.8,step:0.01,default:0.35}]},
    {id:'chromatic', label:'Chromatic', group:'Light', frag:CHROMATIC, cost:4,
      params:[{key:'amount',min:0,max:5,step:0.05,default:1.2},
              {key:'falloff',min:0.5,max:4,step:0.1,default:1.6}]},

    {id:'halftone', label:'Halftone', group:'Texture', frag:HALFTONE, cost:8,
      params:[{key:'scale',min:4,max:40,step:1,default:10,pixelSpace:true},
              {key:'angle',min:0,max:90,step:1,default:15,degrees:true},
              {key:'contrast',min:0.5,max:3,step:0.05,default:1.2}]},
    {id:'dither', label:'Dither', group:'Texture', frag:DITHER, cost:5,
      params:[{key:'levels',min:2,max:16,step:1,default:4},
              {key:'scale',min:1,max:8,step:1,default:2,pixelSpace:true}]},
    {id:'grain', label:'Grain', group:'Texture', frag:GRAIN, cost:6, animated:true,
      params:[{key:'intensity',min:0,max:0.5,step:0.005,default:0.06},
              {key:'scale',min:1,max:20,step:0.5,default:3,pixelSpace:true}]},
    {id:'ascii', label:'ASCII', group:'Texture', frag:ASCII, cost:7, atlas:true,
      params:[{key:'cell',min:4,max:40,step:1,default:10,pixelSpace:true},
              {key:'contrast',min:0.5,max:3,step:0.05,default:1.3},
              {key:'color',min:0,max:1,step:0.01,default:0}]},
    {id:'pixelate', label:'Pixelate', group:'Texture', frag:PIXELATE, cost:3,
      params:[{key:'size',min:1,max:60,step:1,default:8,pixelSpace:true}]},

    {id:'outline', label:'Outline', group:'Structure', frag:OUTLINE, cost:10,
      params:[{key:'thickness',min:0.5,max:5,step:0.1,default:1.4},
              {key:'threshold',min:0,max:1,step:0.01,default:0.18},
              {key:'mix',min:0,max:1,step:0.01,default:1.0}]},
    {id:'contour', label:'Contour', group:'Structure', frag:CONTOUR, cost:9,
      params:[{key:'levels',min:2,max:40,step:1,default:12},
              {key:'thickness',min:0.5,max:4,step:0.1,default:1.2},
              {key:'fade',min:0,max:1,step:0.01,default:0.35},
              {key:'intensity',min:0,max:2,step:0.01,default:0.9}]},
    {id:'grid', label:'Animated grid', group:'Structure', frag:GRID, cost:6, animated:true,
      params:[{key:'cells',min:2,max:60,step:1,default:16},
              {key:'speed',min:0,max:4,step:0.05,default:0.7},
              {key:'thickness',min:0.2,max:4,step:0.1,default:1.0},
              {key:'warp',min:0,max:4,step:0.05,default:0.8},
              {key:'intensity',min:0,max:1.5,step:0.01,default:0.35}]},
    {id:'scanlines', label:'Scanlines', group:'Structure', frag:SCANLINES, cost:3, animated:true,
      params:[{key:'count',min:20,max:400,step:5,default:160},
              {key:'intensity',min:0,max:1,step:0.01,default:0.25},
              {key:'speed',min:0,max:4,step:0.05,default:0.6}]},

    {id:'ripple', label:'Ripple', group:'Distortion', frag:RIPPLE, cost:5, animated:true,
      params:[{key:'amplitude',min:0,max:6,step:0.05,default:1.2},
              {key:'frequency',min:2,max:80,step:1,default:26},
              {key:'speed',min:0,max:5,step:0.05,default:1.2}]},
    {id:'blobs', label:'Blobs', group:'Distortion', frag:BLOBS, cost:12, animated:true,
      params:[{key:'size',min:0.05,max:0.6,step:0.01,default:0.22},
              {key:'speed',min:0,max:4,step:0.05,default:1.0},
              {key:'strength',min:0,max:3,step:0.05,default:1.0},
              {key:'glow',min:0,max:1,step:0.01,default:0.15}]},
    {id:'lens', label:'Lens', group:'Distortion', frag:LENS, cost:4,
      params:[{key:'strength',min:-1.5,max:1.5,step:0.01,default:0.4},
              {key:'zoom',min:0.5,max:1.5,step:0.01,default:1.0}]},

    {id:'blur', label:'Blur', group:'Light', frag:BLUR, cost:16,
      params:[{key:'radius',min:0.5,max:6,step:0.1,default:2.0},
              {key:'angle',min:0,max:6.28,step:0.01,default:0,degrees:false}]},
    {id:'edge', label:'Edge detect', group:'Structure', frag:EDGE, cost:10,
      params:[{key:'thickness',min:0.5,max:4,step:0.1,default:1.2},
              {key:'intensity',min:0.2,max:4,step:0.05,default:1.4},
              {key:'mix',min:0,max:1,step:0.01,default:1.0}]},
    {id:'rgbshift', label:'RGB shift', group:'Light', frag:RGBSHIFT, cost:4, animated:true,
      params:[{key:'amount',min:0,max:5,step:0.05,default:1.4},
              {key:'angle',min:0,max:6.28,step:0.01,default:0}]},
    {id:'badtv', label:'Bad TV', group:'Distortion', frag:BADTV, cost:6, animated:true,
      params:[{key:'distortion',min:0,max:3,step:0.05,default:1.0},
              {key:'roll',min:0,max:4,step:0.05,default:1.0},
              {key:'noise',min:0,max:0.5,step:0.005,default:0.08}]},
    {id:'pixsort', label:'Pixel sort', group:'Texture', frag:PIXSORT, cost:7, animated:true,
      params:[{key:'threshold',min:0,max:1,step:0.01,default:0.6},
              {key:'length',min:0,max:300,step:5,default:80}]},

    {id:'noisefx', label:'Noise', group:'Texture', frag:NOISEFX, cost:6, animated:true,
      params:[{key:'scale',min:2,max:60,step:1,default:14},
              {key:'contrast',min:0.5,max:4,step:0.05,default:1.4},
              {key:'mix',min:0,max:1,step:0.01,default:0.4}]},
    {id:'rain', label:'Rain', group:'Distortion', frag:RAIN, cost:7, animated:true,
      params:[{key:'density',min:10,max:120,step:2,default:50},
              {key:'speed',min:0,max:5,step:0.05,default:1.5},
              {key:'refract',min:0,max:3,step:0.05,default:1.0}]},
    {id:'tile', label:'Geometric tile', group:'Structure', frag:TILE, cost:5, animated:true,
      params:[{key:'tiles',min:1,max:16,step:1,default:4},
              {key:'rotate',min:0,max:6.28,step:0.01,default:0}]},
    {id:'fire', label:'Fire', group:'Texture', frag:FIRE, cost:8, animated:true,
      params:[{key:'height',min:0.2,max:2,step:0.05,default:0.9},
              {key:'intensity',min:0.2,max:3,step:0.05,default:1.3},
              {key:'mix',min:0,max:1,step:0.01,default:0.7}]},

    {id:'gradient', label:'Gradient', group:'Generative', frag:GRADIENT, cost:5, animated:true,
      params:[{key:'speed',min:0,max:3,step:0.05,default:1.0},
              {key:'scale',min:0.5,max:5,step:0.05,default:1.6},
              {key:'angle',min:0,max:6.28,step:0.01,default:0},
              {key:'mix',min:0,max:1,step:0.01,default:1.0}],
      colors:[{key:'colorA',default:[0.11,0.44,0.88]},   // brand blue
              {key:'colorB',default:[0.90,0.14,0.49]},   // brand pink
              {key:'colorC',default:[1.00,0.54,0.24]},   // brand orange
              {key:'colorD',default:[0.18,0.83,0.75]}]}  // brand cyan
  ];

  const WAVES = [
    {id:'sine', label:'Sine', fn: t => Math.sin(t)},
    {id:'triangle', label:'Triangle', fn: t => 2/Math.PI*Math.asin(Math.sin(t))},
    {id:'saw', label:'Saw', fn: t => 2*(t/(2*Math.PI) - Math.floor(t/(2*Math.PI)+0.5))},
    {id:'pulse', label:'Pulse', fn: t => Math.sin(t) >= 0 ? 1 : -1},
    {id:'noise', label:'Noise', fn: t => {
      const x = t/(2*Math.PI)*8, i = Math.floor(x), f = x-i;
      const h = n => { const s = Math.sin(n*127.1)*43758.5453; return 2*(s-Math.floor(s))-1; };
      const u = f*f*(3-2*f);
      return h(i)*(1-u) + h(i+1)*u;
    }}
  ];

  function typeById(id){ return LIBRARY.find(t => t.id === id); }
  function waveFn(id){ const w = WAVES.find(x => x.id === id); return w ? w.fn : WAVES[0].fn; }

  let uid = 1;
  function makeInstance(typeId){
    const type = typeById(typeId);
    if(!type) return null;
    const params = {}, anim = {};
    type.params.forEach(p => {
      params[p.key] = p.default;
      anim[p.key] = {on:false, amount:0.4, speed:1, wave:'sine', phase:0};
    });
    const inst = {uid: uid++, typeId, enabled:true, downsample:1, params, anim};
    if(type.colors){
      inst.colors = {};
      type.colors.forEach(ck => { inst.colors[ck.key] = ck.default.slice(); });
    }
    return inst;
  }
  function resetInstance(inst){
    const type = typeById(inst.typeId);
    if(!type) return;
    type.params.forEach(p => {
      inst.params[p.key] = p.default;
      inst.anim[p.key] = {on:false, amount:0.4, speed:1, wave:'sine', phase:0};
    });
    if(type.colors && inst.colors){
      type.colors.forEach(ck => { inst.colors[ck.key] = ck.default.slice(); });
    }
    inst.downsample = 1;
  }

  // A param's value right now: its (possibly keyframed) base, plus its oscillator.
  function paramValue(inst, spec, theta, baseOverride){
    let v = baseOverride != null ? baseOverride
          : (inst.params[spec.key] != null ? inst.params[spec.key] : spec.default);
    const a = inst.anim && inst.anim[spec.key];
    if(a && a.on && a.amount > 0){
      const osc = waveFn(a.wave)(theta*(a.speed||1) + (a.phase||0));
      v += osc * a.amount * (spec.max - spec.min) * 0.5;
      v = Math.max(spec.min, Math.min(spec.max, v));
    }
    return v;
  }

  /* ---------------- GL plumbing ---------------- */

  let vertShader, copyProgram, quadBuf, sourceTex, W=0, H=0, atlas=null, ready=false;
  const targets = new Map();

  function compile(src, type){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error('Forge shader:', gl.getShaderInfoLog(sh));
    return sh;
  }
  function buildProgram(fragSrc){
    const prog = gl.createProgram();
    gl.attachShader(prog, vertShader);
    gl.attachShader(prog, compile(fragSrc, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('Forge link:', gl.getProgramInfoLog(prog));
    return prog;
  }
  function createTexture(w,h){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if(w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }
  function createFBO(w,h){
    const tex = createTexture(w,h), fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {fbo, tex};
  }
  function drawQuad(program){
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Glyph atlas for ASCII: one row of characters, sparse -> dense, built on a canvas so
  // there's no asset to ship and the ramp stays editable here in code.
  const RAMP = " .:-=+*#%@";
  function buildAtlas(){
    const cell = 32, n = RAMP.length;
    const c = document.createElement('canvas');
    c.width = cell*n; c.height = cell;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0,0,c.width,c.height);
    g.fillStyle = '#fff';
    g.font = '600 ' + Math.round(cell*0.82) + 'px JetBrains Mono, ui-monospace, monospace';
    g.textAlign='center'; g.textBaseline='middle';
    for(let i=0;i<n;i++) g.fillText(RAMP[i], i*cell+cell/2, cell/2+1);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return {tex, count:n};
  }

  function init(){
    if(!gl || ready) return ready;
    vertShader = compile(VERT, gl.VERTEX_SHADER);
    copyProgram = buildProgram(COPY_FRAG);
    atlas = buildAtlas();
    LIBRARY.forEach(t => {
      t.program = buildProgram(t.frag);
      t.uniforms = {
        uTex: gl.getUniformLocation(t.program,'uTex'),
        uResolution: gl.getUniformLocation(t.program,'uResolution')
      };
      t.params.forEach(p => {
        t.uniforms[p.key] = gl.getUniformLocation(t.program, 'u'+p.key[0].toUpperCase()+p.key.slice(1));
      });
      if(t.animated) t.uniforms.uTheta = gl.getUniformLocation(t.program,'uTheta');
      if(t.atlas){
        t.uniforms.uAtlas = gl.getUniformLocation(t.program,'uAtlas');
        t.uniforms.uChars = gl.getUniformLocation(t.program,'uChars');
      }
      if(t.colors) t.colors.forEach(ck => {
        t.uniforms[ck.key] = gl.getUniformLocation(t.program, 'u'+ck.key[0].toUpperCase()+ck.key.slice(1));
      });
    });
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    sourceTex = createTexture(0,0);
    ready = true;
    return true;
  }

  function resize(w,h){
    if(!ready) return;
    canvas.width = w; canvas.height = h;
    targets.clear();
    W = w; H = h;
  }

  function getTargets(ds){
    const key = String(ds);
    let pair = targets.get(key);
    if(!pair){
      const w = Math.max(1, Math.round(W*ds)), h = Math.max(1, Math.round(H*ds));
      pair = {ping:createFBO(w,h), pong:createFBO(w,h), w, h};
      targets.set(key, pair);
    }
    return pair;
  }

  const DOWNSAMPLE_STEPS = [1, 0.75, 0.5, 0.25];

  function hasActive(stack){ return ready && stack && stack.some(i => i.enabled); }

  /* Run a chain over sourceCanvas. Returns the GL canvas holding the result (draw it with
   * drawImage), or null if nothing ran. `resolve` lets comp.js supply a keyframed base
   * value for a param before the oscillator is applied on top. */
  function run(sourceCanvas, stack, opts){
    if(!hasActive(stack)) return null;
    opts = opts || {};
    const theta = opts.theta || 0, pixelScale = opts.pixelScale || 1, resolve = opts.resolve;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.disable(gl.BLEND);
    let srcTex = sourceTex, alt = false;

    stack.filter(i => i.enabled).forEach(inst => {
      const type = typeById(inst.typeId);
      if(!type || !type.program) return;
      const ds = inst.downsample || 1;
      const pair = getTargets(ds);
      const target = alt ? pair.pong : pair.ping;

      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0,0,pair.w,pair.h);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(type.program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(type.uniforms.uTex, 0);
      gl.uniform2f(type.uniforms.uResolution, pair.w, pair.h);
      type.params.forEach(p => {
        const base = resolve ? resolve(inst, p) : null;
        let v = paramValue(inst, p, theta, base);
        if(p.degrees) v = v*Math.PI/180;
        if(p.pixelSpace) v = v*pixelScale*ds;
        gl.uniform1f(type.uniforms[p.key], v);
      });
      if(type.animated) gl.uniform1f(type.uniforms.uTheta, theta);
      if(type.colors) type.colors.forEach(ck => {
        const c = (inst.colors && inst.colors[ck.key]) || ck.default;
        gl.uniform3f(type.uniforms[ck.key], c[0], c[1], c[2]);
      });
      if(type.atlas && atlas){
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
        gl.uniform1i(type.uniforms.uAtlas, 1);
        gl.uniform1f(type.uniforms.uChars, atlas.count);
        gl.activeTexture(gl.TEXTURE0);
      }
      drawQuad(type.program);
      srcTex = target.tex; alt = !alt;
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,W,H);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(copyProgram);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(gl.getUniformLocation(copyProgram,'uTex'), 0);
    drawQuad(copyProgram);
    return canvas;
  }

  function costOf(stacks){
    let score = 0;
    stacks.forEach(stack => (stack||[]).forEach(inst => {
      if(!inst.enabled) return;
      const t = typeById(inst.typeId);
      if(!t) return;
      const ds = inst.downsample || 1;
      score += t.cost*ds*ds;
    }));
    return Math.min(100, Math.round(score*2.2));
  }

  return {
    LIBRARY, WAVES, DOWNSAMPLE_STEPS,
    init, resize, run, hasActive, costOf,
    typeById, waveFn, makeInstance, resetInstance, paramValue,
    get supported(){ return !!gl; }
  };
})();
