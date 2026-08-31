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

- **Layers** — image, video, text, and solid layers with independent transforms and blend modes. Drag to reorder, rename, hide, lock, solo, duplicate.
- **Direct manipulation** — select a layer and drag, scale, or rotate it right on the canvas.
- **26 effects** across Light, Texture, Structure, Distortion, and Generative — including Bloom, Blur, Color grade, Vignette, Chromatic, RGB shift, Halftone, Dither, Grain, ASCII, Pixelate, Noise, Pixel sort, Fire, Outline, Edge detect, Contour, Animated grid, Scanlines, Geometric tile, Ripple, Blobs, Lens, Bad TV, Rain, and an animated Gradient. Every stack is ordered, non-destructive, and reorderable.
- **Keyframe animation** — set a value at the playhead with one click; motion eases between keys instead of moving linearly.
- **Oscillators** — drive any parameter with a continuous waveform (sine, triangle, saw, pulse, noise) instead of, or on top of, keyframes.
- **Video export** — MP4 or WebM, with resolution, frame-rate, and duration controls. Rendered frame-by-frame for even timing, up to 3× resolution. (MP4 depends on browser support; where it's unavailable Forge falls back to WebM and tells you.)
- **Runs entirely client-side** — no uploads, no accounts, no server.

## Video layers

Drop in a video the same way you'd drop in an image — it becomes its own layer with the same transform, blend mode, and effect stack as everything else. Two video-specific settings live in its inspector: a **start offset** into the source clip, and whether it **loops** to fill the composition if the clip is shorter than the timeline.

Playback is synced to the composition's own clock, not the video's — scrub the timeline and the video seeks with it; press play and it starts from wherever the playhead is. A drift check nudges it back in sync if the browser's playback clock wanders.

Export handles video differently than the live preview does, on purpose. Live playback shows whatever frame the video happens to have decoded — fast, and accurate enough to look at. Export instead seeks every video layer to its exact frame and *waits* for the browser to confirm it landed there before capturing — slower, but frame-accurate, so the exported file doesn't end up soft or a beat off from everything else in the composition.

**Exported video currently has no audio track.** The recorder captures the canvas, not the source clip's audio.

## Performance

The editor only does work when something is actually changing. Most layers in a real composition — a background, a logo, a title that isn't moving — never change from one frame to the next, so their rendered result is cached and reused instead of being redrawn and pushed back through the effect chain 60 times a second. A layer only forces a fresh render when it genuinely has something time-based going on: a keyframe, an oscillating effect parameter, or (always) a video. Edit anything about a static layer and its cache invalidates immediately, so this never costs you correctness — only the redundant work is skipped.

The same idea applies to the whole composition: if nothing anywhere is animated and nothing's changed since the last frame, the editor does nothing that frame. Add a keyframe, an oscillator, or a video layer and it goes back to rendering continuously.

On top of that:

- **Per-effect downsample** (Full / 75% / 50% / 25%) — halving resolution is 75% fewer pixels to shade, and soft effects like bloom usually look identical at half size.
- **Preview frame-rate cap** (24 / 30 / 60 / Max) — export always renders at full rate regardless of this setting.
- A live readout shows an estimated GPU cost score and measured frame time — the frame time reflects only frames that actually rendered, so it stays an honest number rather than getting diluted by skipped ones.

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

- **Projects save into the browser or as files.** Use Save to keep a named project in this browser (images embedded, so they come back intact), Open to browse and reload saved projects, or Download .forge to get a portable file you can move between machines. A fresh session always starts clean — if you have unsaved work from last time, Forge offers to restore it rather than loading it silently.
- **Dark and light themes.** Follows your OS preference by default; the ◐ button in the toolbar overrides it and remembers your choice. The accent color throughout the editor is blue rather than orange — one consistent interactive color, in the spirit of tools like Figma, though the palette itself is Forge's own.
- **Timeline scrubbing.** Press and drag across the ruler or any keyframe track to sweep the playhead; it pauses playback while you drag and resumes where you left off.
- **The landing page background is Forge's own Gradient effect, running live** — the same math as the in-editor effect, reimplemented standalone so the landing page doesn't have to load the editor engine just to paint its background. Falls back to a static image if WebGL isn't available.
- **No object tracking yet.** Attaching an effect to a tracked subject in the frame is a real computer-vision feature, not a toggle, and it hasn't been built.
- **The effects pass is real-time, not offline-rendered.** A heavy stack at 3× export resolution may drop frames rather than corrupt the file. Per-effect downsampling is the fix.

## Credits

Built by [Studio Deadzolt](https://deadzolt.studio).

The effect set draws inspiration from the [WebGL shader examples](https://webgl-shaders.com/) by Javier Gracia Carpio — the *effects* (edge detection, RGB shift, bad TV, and so on) informed what Forge offers, though every shader here is an original implementation written for Forge's per-layer, alpha-preserving pipeline.
