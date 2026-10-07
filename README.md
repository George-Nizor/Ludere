![Ludere banner](docs/images/ludere-banner.png)

<p align="center"><img src="docs/brand/ludere-animated.svg" alt="Ludere screenplay page" width="96" /></p>

# Ludere

Screenplay formatting that autosaves as you write.

Ludere is a local screenplay editor with a scene rail and a three-act beat board. The page uses
Letter-sized screenplay margins in Courier Prime. A new document is either a screenplay or a free
writing page, which drops the screenplay rules. The status line shows scenes (or words) and an
estimated page count. Ludere is one of the creative apps in the Instrumenta suite.

Current version: **0.2.0**.

![Ludere script view in the light theme](docs/images/ludere-script.png)

![Ludere beat board in the dark theme](docs/images/ludere-board.png)

## Open it

Instrumenta installs, updates and launches Ludere. To run it from a checkout you need Node.js 20 or
newer and nothing else; there are no dependencies to install.

```bash
npm run dev
```

The dev server listens on `http://127.0.0.1:4174`. Set `PORT` to change it. `npm run build` copies
the static app into `dist/`.

## Writing

Enter moves to the next likely element: scene heading to action, character to dialogue,
parenthetical to dialogue. On an empty line it switches instead, so an empty action line becomes a
character cue and an empty dialogue line becomes action. Ludere recognises `INT.` and `EXT.`
headings, common transitions, uppercase character cues and dialogue parentheticals as you type or
paste several lines.

Tab and Shift+Tab cycle the eight elements, and Ctrl/Cmd+1 to 8 picks one directly. Ctrl/Cmd+B, I
and U apply emphasis. Known character names are offered as cue suggestions, the scene rail jumps
between headings, and undo keeps 200 steps. Press `?` in the app for the built-in instructions.

A focus sprint runs for 5, 15, 30 or 60 minutes. While it runs, only the last line can be edited and
undo is off, so the draft only moves forward. When the timer ends, the draft unlocks.

The beat board imports scene headings as beats, adds free beats, cycles each beat through four
colours, and moves beats between acts by drag and drop.

## Files and where data lives

**Save and open.** Ludere saves portable `.ludere` files (JSON) and opens `.ludere`, `.json` and
Final Draft `.fdx`.

**Export.** Final Draft `.fdx`, indented plain text, standalone printable HTML, and print or PDF
through the browser. An optional title page carries author, source, contact and draft or date.

**Autosave.** The live draft and preferences (theme, view, sprint timer) are kept in the browser's
`localStorage` under `instrumenta.ludere.document.v1` and `instrumenta.ludere.preferences.v1`.
Storage is per origin, so the copy Instrumenta serves on `127.0.0.1:49322` and the dev server on
port 4174 keep separate drafts. Save a `.ludere` file when you want a copy outside the browser.
There is no account and no telemetry.

## MCP server and agent skill

`npm run mcp` starts a local stdio MCP server with 18 tools for creating, editing, searching,
importing and exporting `.ludere` projects. It works only on files at explicit absolute paths and
cannot reach the browser's autosave. [`mcp/README.md`](mcp/README.md) has the tool list, file safety
rules and client setup; [`.cursor/mcp.json`](.cursor/mcp.json) is a ready Cursor configuration. The
agent skill in
[`ai/skills/write-screenplays-with-ludere`](ai/skills/write-screenplays-with-ludere/SKILL.md)
describes how an agent should use those tools.

## Instrumenta and releases

[`instrumenta/product.json`](instrumenta/product.json) builds Ludere as `web-static`; the launcher
delivers it as `managed-web` and opens it on `127.0.0.1:49322` in a sandboxed window. A fresh
Instrumenta install starts from the copy bundled with the launcher and then updates from Ludere's
GitHub releases. Pushing a `v<version>` tag that matches `package.json` runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which calls Instrumenta's shared
web product release workflow. Ludere also runs on its own without the launcher.

[`docs/brand/README.md`](docs/brand/README.md) lists which brand files were copied from Instrumenta
and what stays Ludere's own.

## Verify a change

```bash
npm test
npm run build
```

The tests cover the screenplay rules, Final Draft and plain-text interchange, document validation,
and the MCP server over real stdio. CI runs both commands on Node.js 22.

## Repository map

```text
index.html, app.js   application shell and browser interaction
core.mjs             screenplay and document rules
styles.css           page and interface styling
mcp/                 local stdio MCP server
ai/skills/           agent skill for the MCP server
public/              icons, brand fonts, manifest assets
docs/                banner, screenshots, brand notes
tests/               core and MCP tests
scripts/build.mjs    static build
instrumenta/         launcher manifest
```

## Family

Ludere is part of [Instrumenta](https://github.com/George-Nizor/Instrumenta), a suite of local
learning and creative apps made by [Bonehead Labs](https://boneheadlabs.org)
([GitHub](https://github.com/Bonehead-Labs)). It follows the Instrumenta brand v2: a violet
screenplay page, drawn as a freestanding object. The interface type (Fraunces, Commissioner, Spline
Sans Mono) is SIL OFL 1.1, vendored in `public/fonts/brand` with its licences. Licence: MIT, see
[LICENSE](LICENSE).
