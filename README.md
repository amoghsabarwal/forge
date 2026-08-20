# Forge

A browser-based procedural tool for turning a body of design work into an animated, exportable reel — no build step, no install, just open `index.html`.

Two modes, switchable from the top bar:

- **Shaders** — compose many images into a Wall, Globe, or Tunnel, then fly a camera through it with scripted holds on each piece (not ambient spin — an actual reel with beats). Add a logo, title text, a color/gradient/image background, and a Bloom / Halftone / Dither / Grain effects pass on top of the whole scene. Export as a looping WebM, at up to 3× the preview resolution.
- **Particles** — turn a single image into a field of thousands of independently-animating colored points — each one moves on its own phase, not in lockstep. Tune density, color quantization, jitter/pulse/scatter, and export the loop.

## Running it

No build tooling, no dependencies to install.

- Open `index.html` directly in a browser, or
- Serve the folder locally (e.g. `npx serve .`) and visit it, or
- Turn on GitHub Pages for this repo (Settings → Pages → deploy from `main`) and it runs at the Pages URL.

Requires a browser with WebGL support. Everything runs client-side — no images or exports ever leave the browser.

## Structure

```
index.html      shell — mode switcher, loads everything else
styles.css      shared design system + both modes' styles
shell.js        mode switching (Shaders ⇄ Particles)
composer.js     Shaders mode — layouts, camera, effects pass, export
particles.js    Particles mode — particle generation, motion, export
```

Each mode is a self-contained script — they don't share rendering code, only the visual design system in `styles.css`. `window.FORGE_MODE` is the only thing the shell shares with them, so each mode's render loop can idle when it isn't the active tab.

## Status

Working prototype, built iteratively. A few things worth knowing before you rely on it:

- **No project save/load.** State resets on reload — export before you refresh.
- **The effects pass in Shaders mode is real-time, not offline-rendered.** Stacking several effects at a 3× export multiplier will drop frames rather than corrupt the export — it'll just look choppier, not broken.
- **Focus points fix cropping, not camera framing.** In Shaders mode, a per-image focus point changes what part of the photo gets cropped into its card, but the flythrough camera still centers on the card's position, not the subject inside it.
- **Density and color changes in Particles mode require regenerating the whole particle set** from the source image — those sliders are debounced so dragging doesn't stutter, but there's a brief rebuild pause after release, unlike the motion sliders which are instant.

## License

Not yet decided — add one before making this public if that matters to you (MIT is the usual default for something like this; leave it unlicensed if you'd rather keep it closed for now).
