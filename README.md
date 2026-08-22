# Forge

> **Design Interactive Motion for the Web.**
>
> Create with shaders, media, 3D, and interaction in a visual canvas editor. Ship production-ready components to the web.

Forge is a browser-based creative engine for designers and art directors. It combines a visual composition canvas with procedural effects, media, 3D scenes, animation and web interaction.

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

No build tooling is required for the current prototype.

- Open `index.html` directly in a browser, or
- Serve the folder locally (for example `npx serve .`), or
- Deploy the repository with GitHub Pages.

Requires a browser with WebGL support. The current prototype runs client-side.

## Structure

```text
index.html      landing page
editor.html     visual editor shell
styles.css      shared editor design system
landing.css     landing page styles
landing.js      landing page interaction
shell.js        editor bootstrap
composer.js     3D composition, camera, effects and export
```

## Composition

The current composition engine supports Wall, Globe and Tunnel layouts, scripted camera flythroughs, image focus points, logo overlays, title text, backgrounds and a procedural effect stack.

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
