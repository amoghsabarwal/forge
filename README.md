# Forge

**A browser-based composition and motion-design editor**, built by [Studio Deadzolt](https://deadzolt.studio).

Forge turns your own images into a layered, animated composition — think Photoshop's layers crossed with After Effects' effect stacks and keyframes, but lightweight and running entirely in a browser tab. Nothing you upload leaves your machine.

**[Try it live →](https://forge.deadzolt.studio)**

## What it actually does

You bring in images, text, and solid backgrounds as independent layers. Each layer gets its own position, scale, rotation, opacity, blend mode, and its own stack of visual effects — bloom, dither, ASCII, chromatic aberration, animated grids, and eleven others. Nothing is shared between layers unless you explicitly add it to the separate, composition-wide effect stack.

Then you animate it. Any property — a layer's position, an effect's intensity, anything with a slider — can be keyframed on a timeline, driven by a looping oscillator, or both at once. Scrub the timeline, hit play, and when it looks right, export it as a video.

That's the whole product: **compose → animate → export**, done visually, in the browser.

## Why it exists

Studio Deadzolt needed a fast way to turn still work — logos, photography, brand assets — into motion for reels and case studies, without opening a desktop app or hiring it out. Forge is that tool, built for our own use and shared because it's useful beyond us.

## The rule everything else follows

**Nothing happens implicitly.** Add a layer and it arrives clean — it never inherits effects from whatever you were just working on. Add an effect and it only touches the layer you added it to, unless you explicitly add it to the composition stack instead. You should always be able to answer: *what am I editing, and what does this affect?*

```
COMPOSITION
  Text          ← its own effects, its own keyframes
  Logo          ← clean, inherits nothing
  Image
    ├ Contour
    └ Bloom
  Background
+ Composition effects   ← applied last, to the finished composite
```

## Features

- **Layers** — image, text, and solid layers with independent transforms and blend modes. Drag to reorder, rename, hide, lock, solo, duplicate.
- **Direct manipulation** — select a layer and drag, scale, or rotate it right on the canvas.
- **15 effects** across Light, Texture, Structure, and Distortion — Bloom, Color grade, Vignette, Chromatic, Halftone, Dither, Grain, ASCII, Pixelate, Outline, Contour, Animated grid, Scanlines, Ripple, Blobs. Every stack is ordered, non-destructive, and reorderable.
- **Keyframe animation** — set a value at the playhead with one click; motion eases between keys instead of moving linearly.
- **Oscillators** — drive any parameter with a continuous waveform (sine, triangle, saw, pulse, noise) instead of, or on top of, keyframes.
- **Video export** — rendered frame-by-frame for even timing, up to 3× resolution, as a looping WebM.
- **Runs entirely client-side** — no uploads, no accounts, no server.

## Performance controls

- **Per-effect downsample** (Full / 75% / 50% / 25%) — halving resolution is 75% fewer pixels to shade, and soft effects like bloom usually look identical at half size.
- **Preview frame-rate cap** (24 / 30 / 60 / Max) — export always renders at full rate regardless of this setting.
- A live readout shows an estimated GPU cost score and measured frame time as you build.

## Keyboard shortcuts

Work anywhere except while typing in a field.

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `Delete` / `Backspace` | Remove the selected layer (undoable) |
| `Cmd/Ctrl + D` | Duplicate the selected layer |
| `H` | Hide / show the selected layer |
| `L` | Lock / unlock the selected layer |
| `F` | Fit the canvas to the screen |
| Arrow keys | Nudge the selected layer (hold Shift for 10px) |

## Running it locally

No build step, no dependencies.

- Open `index.html` directly in a browser, or
- Serve the folder locally (`npx serve .`) and visit it, or
- Fork this repo and turn on GitHub Pages (Settings → Pages → deploy from `main`).

Requires a browser with WebGL. Best tested in Chrome.

## Project structure

```
index.html      landing page
editor.html     editor shell — toolbar, scene panel, canvas, inspector, timeline
editor.css      editor styles
fx.js           effect engine — the effect library, instances, oscillators, WebGL chain runner
comp.js         composition model — layers, keyframes, render pipeline, export
ui.js           panel logic, canvas interaction, timeline
```

`fx.js` has no concept of a layer; `comp.js` runs an effect chain over one layer's pixels, then again over the finished composite. Every effect preserves source alpha, which is what lets them run per layer without turning a transparent logo into a black rectangle.

## Status

Working prototype, actively evolving.

- **Settings persist; images don't.** Layers, transforms, effects, and keyframes are saved to `localStorage` and restored on your next visit. Image pixels aren't — re-add the file and everything else snaps back into place.
- **No object tracking yet.** Attaching an effect to a tracked subject in the frame is a real computer-vision feature, not a toggle, and it hasn't been built.
- **No video layers yet.** Images, text, and solids only, for now.
- **The effects pass is real-time, not offline-rendered.** A heavy stack at 3× export resolution may drop frames rather than corrupt the file. Per-effect downsampling is the fix.

## Credits

Built by [Studio Deadzolt](https://deadzolt.studio).
