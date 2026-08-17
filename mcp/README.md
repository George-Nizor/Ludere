# Ludere MCP

Ludere includes a dependency-free local stdio MCP server. It operates on explicit portable
`.ludere`/`.json` project files and imports/exports through the same validation, screenplay
inference, Final Draft, plain-text, printable-HTML, and beat-board logic as the browser editor.
No document content leaves the machine.

## Start and configure

From the Ludere directory:

```bash
npm run mcp
```

The checked-in [Cursor configuration](../.cursor/mcp.json) runs `node mcp/index.mjs` with Ludere as
its working directory. Other MCP clients should use the same command and stdio transport. Node 20+
is required; there are no MCP runtime packages to install.

## Tools

| Tool | Operation |
| --- | --- |
| `ludere_create_document` | Create a blank screenplay or free-writing project. |
| `ludere_open_document` | Return the complete validated project and its SHA-256 edit token. |
| `ludere_inspect_document` | Summarize metadata, types, scenes, characters, beats, words, and pages. |
| `ludere_validate_document` | Diagnose an inline value or project file without writing. |
| `ludere_save_document` | Validate and atomically save a complete inline document. |
| `ludere_update_metadata` | Patch title and title-page fields. |
| `ludere_add_blocks` | Insert typed or inferred screenplay elements. |
| `ludere_update_blocks` | Patch text, type, or supported inline formatting by block ID. |
| `ludere_reorder_blocks` | Move a stable group of block IDs by index or anchor. |
| `ludere_delete_blocks` | Delete block IDs while preserving the non-empty editor invariant. |
| `ludere_search_document` | Search blocks, beats, and metadata with type/act filters. |
| `ludere_add_beats` | Insert three-act beat-board cards. |
| `ludere_update_beats` | Patch act, title, text, or colour by beat ID. |
| `ludere_reorder_beats` | Reorder a stable group of beat IDs. |
| `ludere_delete_beats` | Delete beat IDs. |
| `ludere_import_scenes_to_board` | Add missing scene headings using the editor’s act distribution. |
| `ludere_import_document` | Import Ludere JSON, Final Draft, or plain/Fountain-like text. |
| `ludere_export_document` | Export Ludere JSON, Final Draft, text, or printable HTML. |

Every tool advertises a closed JSON input schema, an output schema, and conservative read-only /
destructive / idempotent annotations. Successful and failed calls both return a stable
`structuredContent` object mirrored as JSON in the text content. Tool failures use
`{ ok: false, tool, error: { code, message, details? } }` with `isError: true`.

## File safety and concurrency

- Every source and destination path must be absolute. The server never chooses a user document
  directory and never creates parent directories implicitly.
- New projects, imports, saves, and exports refuse an existing destination unless
  `overwrite: true` is explicit. Exports cannot target their source project.
- In-place edits use a same-directory temporary file and atomic replacement. They check that the
  source did not change between read and publication.
- `open` and `inspect` return `documentHash`. Supplying it as `expectedHash` prevents an edit based
  on stale state from replacing a newer UI or MCP save.
- Inputs are limited to regular files of at most 16 MiB. Future schema versions, duplicate IDs,
  lossy oversized fields, invalid JSON, and unsupported destination extensions fail closed.
- Inline markup is limited to bold, strong, italic, emphasis, underline, and line breaks. Markup
  whose visible text disagrees with canonical block text is rejected or removed during validation.

## Browser autosave boundary

The browser stores its live recovery copy in origin-scoped `localStorage`; a stdio process cannot
safely coordinate or mutate that UI-only store. MCP persistence therefore writes the exact same
versioned document JSON as a portable `.ludere` file. Opening that file in Ludere makes it the live
document and the browser then resumes its normal autosave lifecycle. Theme, view, undo history, and
focus-sprint timing are intentionally UI-only.

## Verification

```bash
npm test
npm run build
```

The suite covers protocol negotiation, tool schemas, real newline-framed stdin/stdout, notification
silence, malformed requests, unknown methods/tools, path and overwrite failures, optimistic
concurrency, all script and board mutations, every import/export format, and complete file E2E.
