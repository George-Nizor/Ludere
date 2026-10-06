# Brand v2 in Ludere

Aligned 2026-10-06 following `Instrumenta/brand/ALIGNMENT.md`. Source of everything below is the
Instrumenta checkout's `brand/` folder; regenerate there and re-copy, never edit the copies.

## Copied

| Here | From (`Instrumenta/brand/`) |
| --- | --- |
| `public/fonts/brand/` (woff2, `fonts.css`, `OFL-*.txt`) | `fonts/` |
| `public/brand/ludere*.svg` (full, 24, 16) | `icons/svg/` |
| `public/brand/instrumenta-icons.{js,css}` | `icons/` |
| `public/ludere-mark.png` (512), `public/favicon-32.png` | `icons/png/ludere-512.png`, `ludere-32.png` |
| `public/ludere-app-art.png` | `artwork/ludere-app-art.png` |

## Roles

- Accent `#B583EB`, deep `#5B3B7C`, secondary `#DFC3FF`, ink `#1A1223`, surface `#241930` (`tokens.json`, `ludere`).
  CSS variables `--accent` and `--accent-strong` (light: the deep shade, dark: the light tint, so filled
  buttons keep contrast). `--accent-text` is the text-safe accent for small labels.
- Fraunces (650, SOFT 100, WONK 1): the name, board and dialog headings. Commissioner (FLAR 40): all
  interface. Spline Sans Mono: scene numbers, beat counts, key hints.
- The logo is rendered inline by `InstrumentaIcons` and turns a page on hover; reduced motion stops it.
  The `<img>` in `index.html` is the fallback.

## Kept

The screenplay page and editor (Courier Prime), the print layout, the page's own light/dark paper, and
the beat colour names (`plum` is saved in documents, so it stays a data value that renders as the accent).

## Deferred

The README banner (`docs/images/ludere-banner.png`) is still v1; it goes with the README pass.
