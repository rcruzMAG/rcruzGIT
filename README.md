# Single-file web apps

## Halation Lab — Film Halation & Stock Simulation Editor (`halation.html`)

A real-time, WebGL-powered photo editor for film-style glow. Open `halation.html`
in any modern browser — no build step, no dependencies, everything stays local.

- **Physically inspired halation** — bright light passes through the emulsion,
  reflects off the film base, and re-exposes the deepest (red-sensitive) layer,
  producing the classic red-orange halo. Tune strength, threshold, radius, and
  hue (deep red → orange) independently. A built-in illustrated explainer shows
  the film cross-section and why CineStill 800T glows the way it does.
- **Bloom** — separate neutral lens/emulsion scatter veil with its own strength,
  threshold, and radius.
- **20 famous film stocks** — Kodak Portra 400/160, Ektar 100, Gold 200,
  Kodachrome 64, Ektachrome E100, Tri-X 400, T-Max 3200, Vision3 500T,
  CineStill 800T, Fuji Velvia 50, Provia 100F, Astia 100F, Superia 400,
  Pro 400H, Eterna 250D, Ilford HP5 Plus, Pan F 50, Agfa Vista 200, and
  Polaroid 600 — each with its own color response, contrast curve, fade, and
  matched grain. Adjustable filter intensity, grain amount/size, vignette,
  exposure.
- **Workflow** — import via button, drag & drop, or clipboard paste; hold-to-compare
  against the original (or hold <kbd>C</kbd>); "glow layer only" inspection view;
  full-resolution PNG export. Ships with a procedural night-street scene full of
  light sources so you can play immediately.

## Render Brief — Architectural Prompt Maker (`index.html`)

A single-file web app for composing world-class, presentation-ready architectural
render prompts. Add style and model reference images, click through the curated
options, and copy a refined prompt straight into your AI image tool.

## Use it

Open `index.html` in any modern browser. No build step, no dependencies.

## Features

- **Reference images** — drop or upload images as **style** (mood, lighting, material
  language) or **model/subject** (massing, form, proportions) references. Previews stay
  local in your browser; attach the actual files to your image tool alongside the prompt.
- **Guided selectors** based on a world-class visualization brief:
  - Project type, location, target client, design positioning/mood, design concept
  - Scene description and composition focus (exterior hero, interior, masterplan aerial, hospitality)
  - Camera height/angle, lens, image format
  - Lighting condition and material palette
  - Landscape/public realm, people & lifestyle, color grading
- **Live prompt** — a tight, copy-paste-ready brief that updates as you choose, with a
  built-in negative prompt.
- **Copy** to clipboard, with a **Select all** fallback for sandboxed contexts (e.g.
  Claude artifacts) where clipboard access may be blocked.

## Notes

Everything runs client-side. Selecting project type, location, client and concept
produces the strongest brief; all other options refine it.
