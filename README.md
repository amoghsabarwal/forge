# Forge

> **Design Interactive Motion for the Web.**
>
> Create with shaders, media, 3D, and interaction in a visual canvas editor. Ship production-ready components to the web.

Forge is a browser-based creative engine for designers and art directors. It combines a visual composition canvas with procedural effects, media, 3D scenes, animation and web interaction.

A browser-based composition and motion-design editor. Build a layered composition from your own images, stack effects on individual layers, animate anything with keyframes, and export a looping video — no build step, no install, nothing leaves the browser.

## Current editor direction

The editor is a single workspace rather than a collection of isolated modes:

- **Layers** — every uploaded asset is independent and editable.
- **Shaders & effects** — stack procedural treatments non-destructively.
- **3D** — Wall, Globe and Tunnel compositions with art-directed camera motion.
- **Media** — images, logos, type and other visual assets.
- **Animation** — loop timing, parameter animation and scripted camera beats.
- **Interaction** — the long-term output is interactive web motion, not just a video render.
- **Export / Ship** — production-ready web components are the destination.

A newly added asset should enter the scene clean. Existing effects must never implicitly affect it. Effects belong to the selected layer unless explicitly added as composition-level effects.

## Running it

- Open `index.html` directly in a browser, or
- Serve the folder locally (e.g. `npx serve .`) and visit it, or
- Turn on GitHub Pages for this repo (Settings → Pages → deploy from `main`).

No build tooling is required for the current prototype; the current prototype runs client-side and requires a browser with WebGL (Chrome is the best-tested).

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

## Structure

```text
index.html      landing page
editor.html     visual editor shell
styles.css      shared editor design system
landing.css     landing page styles
landing.js      landing page interaction
shell.js        editor bootstrap
composer.js     3D composition, camera, effects and export
fx.js           effect engine: library, instances, oscillators, WebGL chain runner
comp.js         composition model: layers, keyframes, render pipeline, export
ui.js           panels, canvas interaction, timeline
layer-engine.js layer / media list and runtime layer manager
```



The current composition engine supports Wall, Globe and Tunnel layouts, scripted camera flythroughs, image focus points, logo overlays, title text, backgrounds and a procedural effect stack.

Working prototype. Known limits:

- **Style settings persist; images don't.** Layers, transforms, effects, and keyframes are saved to `localStorage` and restored on your next visit. Image pixels aren't (photo-sized blobs don't belong in `localStorage`), so image layers come back needing their file re-added.
- **No blob tracking yet.** Attaching effects to a tracked object is a real computer-vision problem and hasn't been built — it's the next major piece, not a setting that's switched off.
- **No video layers yet.** Images, text, and solids only.
- **The effects pass is real-time, not offline-rendered.** A heavy stack at 3× export will drop frames rather than corrupt the file — it looks choppier, not broken. Per-effect downsampling is the fix.

The next architectural priority is converting the existing composition-level effect stack into a true layer-aware system so each asset can have its own transform and effect stack.

## Effects

The prototype currently includes procedural texture, light/color, structure and distortion effects, with per-parameter animation controls and performance controls such as effect downsampling and frame-rate limits.

## Product direction

Forge is not intended to be another flat image editor or video exporter. The product is a **visual development environment for interactive web motion**:

```text
Media + Shaders + 3D + Interaction
                ↓
          Visual Canvas
                ↓
        Animation / Logic
                ↓
      Production Web Component
```


## License

Not yet decided.
