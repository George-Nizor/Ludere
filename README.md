# Ludere

Ludere is Instrumenta's local-first screenplay writing and story-planning instrument. The script
page uses Courier with Letter-sized screenplay margins; the surrounding application uses a muted,
modern-classical identity derived from the same folded-page and proscenium mark used by its launcher
artwork.

Ludere is a standalone repository. It has no runtime dependency on Instrumenta; the suite launcher
discovers it through `instrumenta/product.json` when the repositories are checked out as siblings.

## Run it

Ludere has no runtime dependencies and no framework build requirement. Open `index.html` from a
static server, use the Instrumenta launcher, or run this optional development server with Node.js:

```bash
npm run dev
```

`npm run build` copies the static application to `dist/` for packaging. `npm test` verifies the
screenplay inference, element cycle, paste parser, document validation, Final Draft interchange,
plain-text layout, page estimate, and local MCP protocol/workflows.

## Local MCP automation

`npm run mcp` starts Ludere's dependency-free stdio server. Its 18 tools create/open/inspect and
validate portable projects; edit/reorder/delete screenplay blocks and story beats by stable ID;
search content and metadata; maintain title-page fields; import plain/Fountain-like text or Final
Draft; and export `.ludere`, `.fdx`, text, or printable HTML. All file paths are explicit and
absolute, new destinations refuse overwrite by default, in-place edits are atomic, and optional
SHA-256 edit tokens reject stale writes. See [the MCP guide](mcp/README.md) and the checked-in
[local client configuration](.cursor/mcp.json).

## Writing behavior

- Enter follows screenplay logic: scene heading → action, character → dialogue, parenthetical →
  dialogue. Empty action and dialogue lines switch to character and action respectively.
- `INT.`, `EXT.`, common transitions, uppercase character cues, and dialogue parentheticals are
  recognized automatically.
- Tab and Shift+Tab cycle eight elements. Ctrl/Cmd+1–8 select them directly. Ctrl/Cmd+B/I/U apply
  inline emphasis.
- Character names already used in the script are suggested while typing a new cue.
- Multiline pasted text is inferred using screenplay and Fountain-like conventions.
- The scene rail, estimated page count, local autosave/recovery, 200-step undo history, light/dark
  themes, and forward-only focus sprints are built in.
- Light/dark appearance has a dedicated sun/moon control. Formatting, appearance, focus, document,
  and scene-navigation controls expose their full names on hover while keeping the toolbar visual.
- The three-act beat board can import scene headings, accept new beats, recolor them, and drag them
  between acts.

## Repository structure

`index.html`, `app.js`, `styles.css`, and `core.mjs` are the browser application; `mcp/` contains the
dependency-free local server; `tests/` contains domain and protocol coverage; `scripts/build.mjs`
creates ignored `dist/`; and `instrumenta/product.json` declares the optional suite integration.

## Files and export

Ludere saves portable `.ludere` JSON, opens `.ludere`, JSON, and Final Draft `.fdx`, and exports
Final Draft, industry-indented plain text, standalone printable HTML, and print/PDF. Optional title
page fields include author, source line, contact, and draft/date.

All document processing and storage is local. There is no account, cloud dependency, telemetry, or
remote script processing. MCP writes portable files using the same versioned JSON shape as browser
autosave; it intentionally does not reach into origin-scoped browser `localStorage` or UI-only undo,
theme, view, and focus-sprint state.
