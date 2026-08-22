# Forge

A browser-based composition and motion-design editor. Build a layered composition from your own images, stack effects on individual layers, animate anything with keyframes, and export a looping video — no build step, no install, nothing leaves the browser.

## Running it

- Open `index.html` directly in a browser, or
- Serve the folder locally (e.g. `npx serve .`) and visit it, or
- Turn on GitHub Pages for this repo (Settings → Pages → deploy from `main`).

Requires a browser with WebGL. Chrome is the best-tested.

## The model

A composition is an ordered list of **independent layers**. Each layer owns its content, its transform, and its own effect stack.

The rule that governs everything: **nothing happens implicitly**. Adding a layer never modifies another layer. An image you drop in after building up a stack of effects arrives completely clean. Effects apply to the layer you put them on — the only way to affect the whole composite is to add a **composition effect**, which is a separate, explicitly labelled stack.

```
COMPOSITION
  Text          ← its own effects, its own keyframes
  Logo          ← clean, inherits nothing
  Image
    ├ Contour
    └ Bloom
  Background
+ Composition effects  ← applied last, to the finished composite
```

Layer order is render order; the top of the scene panel draws in front.

### Layers

Image, text, and solid layers. Each has position, scale, rotation, opacity, and a blend mode. Select a layer to get transform handles directly on the canvas — drag to move, corners to scale, the circle above to rotate (hold Shift to snap to 15°). Layers can be renamed, reordered by dragging, hidden, locked, soloed, and duplicated.

### Effects

Fifteen effect types, grouped by what they do:

- **Light** — Bloom, Color grade, Vignette, Chromatic
- **Texture** — Halftone, Dither, Grain, ASCII, Pixelate
- **Structure** — Outline, Contour, Animated grid, Scanlines
- **Distortion** — Ripple, Blobs

Every stack is ordered and non-destructive: reorder, toggle, duplicate, reset, or remove any instance without losing the others. The same effect can appear more than once with different settings. ASCII builds its glyph atlas on a canvas at runtime from a sparse→dense ramp, so there's no asset to load.

### Animation

Two independent ways to move a parameter, and they compose:

- **Keyframes (◆)** — set a value at the playhead. Between keys the value eases rather than moving linearly, so motion doesn't look robotic. Keyframed properties appear as tracks in the timeline; click a diamond to jump to it, double-click to delete it.
- **Oscillators (∿)** — drive a parameter continuously with a waveform (sine, triangle, saw, pulse, or smooth noise) with its own amount, speed, and phase. Phase derives from loop position, so an oscillated parameter returns to where it started and the exported loop still cuts together seamlessly.

Keyframes set the base value; the oscillator rides on top of it.

### Export

Rendered frame by frame at a fixed step rather than from wall-clock time, so timing stays even even when a frame takes longer than its slot. Exports at up to 3× the composition resolution as a looping WebM.

## Performance

- **Per-effect downsample** (Full / 75% / 50% / 25%). Halving the resolution is 75% fewer pixels to shade; soft effects like bloom and vignette usually look identical at 50%.
- **Preview frame-rate cap** (24 / 30 / 60 / Max). Export always records at full rate regardless.
- The readout in the toolbar shows an estimated GPU cost score and measured frame time.

## Keyboard shortcuts

Work anywhere except while typing in a field.

- **Space** — play / pause
- **Delete / Backspace** — remove the selected layer (with undo)
- **Cmd/Ctrl + D** — duplicate the selected layer
- **H** / **L** — hide / lock the selected layer
- **F** — fit the canvas to the screen
- **Arrow keys** — nudge the selected layer (Shift for 10px steps)

## Structure

```
index.html    landing page
editor.html   editor shell — the four panel regions
editor.css    editor styles
fx.js         effect engine: library, instances, oscillators, WebGL chain runner
comp.js       composition model: layers, keyframes, render pipeline, export
ui.js         panels, canvas interaction, timeline
```

`fx.js` has no concept of a layer — `comp.js` runs a chain over one layer's pixels, then again over the finished composite. Every shader preserves source alpha, which is what lets effects run per layer without turning a transparent logo into a black rectangle.

## Status

Working prototype. Known limits:

- **Style settings persist; images don't.** Layers, transforms, effects, and keyframes are saved to `localStorage` and restored on your next visit. Image pixels aren't (photo-sized blobs don't belong in `localStorage`), so image layers come back needing their file re-added.
- **No blob tracking yet.** Attaching effects to a tracked object is a real computer-vision problem and hasn't been built — it's the next major piece, not a setting that's switched off.
- **No video layers yet.** Images, text, and solids only.
- **The effects pass is real-time, not offline-rendered.** A heavy stack at 3× export will drop frames rather than corrupt the file — it looks choppier, not broken. Per-effect downsampling is the fix.

## License

Not yet decided.
