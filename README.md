![Ludere banner](docs/images/ludere-banner.png)

# Ludere

Ludere is a local screenplay editor with a scene rail and a three-act beat board. The page follows
Letter-sized screenplay margins in Courier; the surrounding app stays out of the way.

Current version: **0.1.0**.

## Open it

Instrumenta can build and launch Ludere from the sibling workspace. For direct development:

```bash
npm run dev
```

Ludere is a static application with no runtime framework dependency. `npm run build` copies the
packageable files to `dist/`.

## Writing behavior

Enter follows the current screenplay element:

```text
scene heading → action
character → dialogue
parenthetical → dialogue
```

Empty action and dialogue lines switch to the next likely element. Ludere also recognises `INT.`,
`EXT.`, common transitions, uppercase character cues, and dialogue parentheticals while typing or
pasting multiple lines.

Useful controls:

- Tab and Shift+Tab cycle through the eight screenplay elements.
- Ctrl/Cmd+1–8 selects an element directly.
- Ctrl/Cmd+B, I, and U apply inline emphasis.
- Existing character names appear as cue suggestions.
- The scene rail jumps through headings.
- Undo keeps 200 steps.
- Focus sprints count forward and leave the document alone when they end.

The beat board imports scene headings, adds free beats, colours them, and moves them between acts.

## Files and exports

Ludere saves portable `.ludere` JSON and opens `.ludere`, JSON, and Final Draft `.fdx`. It exports:

- Final Draft `.fdx`;
- industry-indented plain text;
- standalone printable HTML;
- print/PDF through the browser.

Optional title-page fields cover author, source line, contact, and draft/date.

Browser autosave and recovery stay in local storage. There is no account or telemetry. Your
screenplay has avoided acquiring a customer-success manager.

## MCP control

`npm run mcp` starts the dependency-free local stdio server. Its 18 tools can:

- create, open, inspect, validate, and search portable projects;
- edit, reorder, or delete screenplay blocks and story beats by stable ID;
- maintain title-page data;
- import plain/Fountain-like text or Final Draft;
- export Ludere JSON, FDX, text, or printable HTML.

Paths are explicit and absolute. New destinations refuse overwrite. In-place edits are atomic.
Optional SHA-256 document tokens reject stale writes.

The MCP server uses the same versioned document shape as the browser. It does not reach into
origin-scoped autosave, undo history, theme, view state, or focus timers.

See [the MCP guide](mcp/README.md) for the tool contracts and examples.

## Instrumenta integration

[`instrumenta/product.json`](instrumenta/product.json) declares the optional `web-static` adapter.
Instrumenta serves the built app on Ludere's registered loopback origin and opens it inside a
sandboxed Electron window. Ludere remains an independent repository and can run without the launcher.

## Verify a change

```bash
npm test
npm run build
```

The tests cover element inference, keyboard cycling, paste parsing, document validation, page
estimation, local recovery, Final Draft interchange, plain-text layout, and MCP workflows.

## Repository map

```text
index.html       application shell
app.js           browser interaction
core.mjs         screenplay and document rules
styles.css       page and interface styling
mcp/             local stdio server
tests/           domain and protocol coverage
scripts/         static build
instrumenta/     launcher manifest
```

Ludere is MIT licensed.
