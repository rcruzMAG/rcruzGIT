# Render Brief — Architectural Prompt Maker

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
