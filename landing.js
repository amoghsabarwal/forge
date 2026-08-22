(function(){
  "use strict";

  const canvas = document.getElementById('emberCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const hero = canvas.closest('.hero');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLORS = ['#ff5a1f', '#ff7a38', '#ffb238', '#c93a12'];
  const COUNT = 70;
  let particles = [];
  let w = 0, h = 0, dpr = 1;

  function rand(a, b){ return a + Math.random() * (b - a); }

  function makeParticle(spawnAtBottom){
    return {
      x: rand(0, w),
      y: spawnAtBottom ? h + rand(0, 40) : rand(0, h),
      r: rand(0.6, 2.2),
      speed: rand(10, 34),      // px/sec upward
      drift: rand(-6, 6),       // px/sec sideways base
      sway: rand(0.6, 1.6),     // sway frequency
      swayAmp: rand(4, 16),
      phase: rand(0, Math.PI * 2),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: rand(0.85, 1),
      maxLife: 0,
    };
  }

  function resize(){
    const rect = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed(){
    particles = [];
    for(let i = 0; i < COUNT; i++){
      const p = makeParticle(false);
      p.maxLife = rand(6, 12);
      p.life = rand(0, p.maxLife);
      particles.push(p);
    }
  }

  function drawFrame(t, dt){
    ctx.clearRect(0, 0, w, h);
    for(const p of particles){
      if(!reduceMotion){
        p.life += dt;
        if(p.life > p.maxLife){
          Object.assign(p, makeParticle(true));
          p.maxLife = rand(6, 12);
          p.life = 0;
        }
        p.y -= p.speed * dt;
        p.x += (p.drift + Math.sin(t * p.sway + p.phase) * p.swayAmp * dt);
        if(p.y < -10){ p.y = h + rand(0, 20); p.x = rand(0, w); }
      }
      const lifeRatio = reduceMotion ? 0.6 : p.life / p.maxLife;
      const fadeIn = Math.min(lifeRatio / 0.15, 1);
      const fadeOut = Math.min((1 - lifeRatio) / 0.25, 1);
      const alpha = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.85;

      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  let lastT = null;
  function loop(now){
    const t = now / 1000;
    const dt = lastT === null ? 0 : Math.min(t - lastT, 0.05);
    lastT = t;
    drawFrame(t, dt);
    if(!reduceMotion) requestAnimationFrame(loop);
  }

  resize();
  seed();
  window.addEventListener('resize', () => { resize(); });

  if(reduceMotion){
    drawFrame(0, 0);
  } else {
    requestAnimationFrame(loop);
  }
})();
