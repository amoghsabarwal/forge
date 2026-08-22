(function(){
  'use strict';
  // Forge has one editor surface. Layouts, layers, effects and interaction live inside it.
  window.FORGE_MODE = 'editor';
  // Compatibility hook used by the layer renderer after media updates.
  window.syncCanvas = window.syncCanvas || function(){};
})();
