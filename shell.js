(function(){
  "use strict";
  window.FORGE_MODE = 'shaders';

  const modeShaders = document.getElementById('modeShaders');
  const modeParticles = document.getElementById('modeParticles');
  const btns = document.querySelectorAll('.mode-btn');

  function retriggerFade(el){
    el.classList.remove('mode-container');
    void el.offsetWidth; // force reflow so the fade-in animation replays
    el.classList.add('mode-container');
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if(mode === window.FORGE_MODE) return;
      window.FORGE_MODE = mode;

      btns.forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });

      modeShaders.hidden = mode !== 'shaders';
      modeParticles.hidden = mode !== 'particles';
      retriggerFade(mode === 'shaders' ? modeShaders : modeParticles);
    });
  });
})();
