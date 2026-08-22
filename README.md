# Forge

A browser-based procedural tool for turning a body of design work into an animated, exportable reel — no build step, no install, just open `index.html`.

Two modes, switchable from the top bar:

- **Shaders** — compose many images into a Wall, Globe, or Tunnel, then fly a camera through it with scripted holds on each piece (not ambient spin — an actual reel with beats). Add a logo, title text, a color/gradient/image background, and a stack of post effects on top of the whole scene. Export as a looping WebM, at up to 3× the preview resolution.
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

- **Style settings autosave; images don't.** Layout, timing, effects, text/logo config, and particle style are saved to `localStorage` a couple of seconds after you change them and restored on your next visit. The images themselves are never persisted (nothing leaves the browser, and photo-sized blobs aren't a great fit for `localStorage`) — you'll need to re-add those after a reload.
- **The effects pass in Shaders mode is real-time, not offline-rendered.** Stacking several effects at a 3× export multiplier will drop frames rather than corrupt the export — it'll just look choppier, not broken.
- **Focus points fix cropping, not camera framing.** In Shaders mode, a per-image focus point changes what part of the photo gets cropped into its card, but the flythrough camera still centers on the card's position, not the subject inside it.
- **Density and color changes in Particles mode require regenerating the whole particle set** from the source image — those sliders are debounced so dragging doesn't stutter, but there's a brief rebuild pause after release, unlike the motion sliders which are instant.

## Effect stack

Effects are an ordered stack of instances rather than a fixed set of toggles: add the same effect twice with different settings, reorder it, duplicate it, or disable one without losing its values. Eleven effect types ship today — Bloom, Halftone, Dither, Grain, Chromatic, Pixelate, Vignette, Scanlines, Outline, Color grade, and Ripple.

Two things keep it fast:

- **Per-effect downsample.** Each instance renders at Full / 75% / 50% / 25%. Halving the resolution is 75% fewer pixels to shade, and anything soft (bloom, vignette, grain) usually looks identical at 50%.
- **Frame-rate cap.** 24 / 30 / 60 / Max. Ambient motion rarely needs 60fps, and halving the frame rate halves GPU work per second. Export always records at full rate regardless of this setting.

The readout next to EFFECT STACK shows an estimated cost score and the measured frame time, so the effect of both levers is visible while you build.

## Keyboard shortcuts

Work anywhere except while typing in a text field.

- **Space** — play / pause
- **E** — export
- **1 / 2 / 3** — switch layout to Wall / Globe / Tunnel (Shaders mode)
- **R** — reshuffle the particle field with fresh randomness (Particles mode)

## License

Not yet decided — add one before making this public if that matters to you (MIT is the usual default for something like this; leave it unlicensed if you'd rather keep it closed for now).
