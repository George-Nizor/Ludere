import path from 'node:path';
import {
  BEAT_COLORS,
  ELEMENT_TYPES,
  createBlock,
  createDocument,
  exportFinalDraft,
  exportPlainText,
  exportPrintableHTML,
  importFinalDraft,
  parsePlainScript,
} from '../core.mjs';
import {
  addBeats,
  addBlocks,
  addSceneBeats,
  deleteBeats,
  deleteBlocks,
  reorderBeats,
  reorderBlocks,
  searchDocument,
  summarizeDocument,
  updateBeats,
  updateBlocks,
  updateMetadata,
} from './document-operations.mjs';
import { LudereMcpError, invariant } from './errors.mjs';
import {
  PROJECT_EXTENSIONS,
  absoluteFilePath,
  diagnoseDocument,
  documentJSON,
  loadDocumentFile,
  readTextFile,
  saveDocumentFile,
  writeTextFile,
} from './project-store.mjs';

const projectPath = {
  type: 'string', minLength: 1,
  description: 'Absolute path to an existing .ludere or .json project file.',
};
const destinationProjectPath = {
  type: 'string', minLength: 1,
  description: 'Absolute destination path ending in .ludere or .json. Parent directories are never created implicitly.',
};
const expectedHash = {
  type: 'string', pattern: '^[a-f0-9]{64}$',
  description: 'Optional SHA-256 documentHash from open/inspect. A mismatch fails without writing.',
};
const titlePagePatch = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    author: { type: 'string', maxLength: 120 },
    source: { type: 'string', maxLength: 180 },
    contact: { type: 'string', maxLength: 500 },
    draft: { type: 'string', maxLength: 120 },
  },
  minProperties: 1,
  additionalProperties: false,
};
const positionProperties = {
  atIndex: { type: 'integer', minimum: 0, description: 'Insertion index after moved items are removed.' },
  beforeId: { type: 'string', minLength: 1, maxLength: 200 },
  afterId: { type: 'string', minLength: 1, maxLength: 200 },
};
const blockSpec = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ELEMENT_TYPES },
    text: { type: 'string', maxLength: 100_000 },
    html: { type: 'string', maxLength: 300_000, description: 'Optional inline b/strong/i/em/u/br markup; it must encode the same text.' },
  },
  additionalProperties: false,
};
const blockUpdate = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    type: { type: 'string', enum: ELEMENT_TYPES },
    text: { type: 'string', maxLength: 100_000 },
    html: { type: 'string', maxLength: 300_000 },
    clearFormatting: { type: 'boolean' },
    inferType: { type: 'boolean' },
  },
  required: ['id'],
  minProperties: 2,
  additionalProperties: false,
};
const beatSpec = {
  type: 'object',
  properties: {
    act: { type: 'integer', minimum: 1, maximum: 3 },
    title: { type: 'string', maxLength: 120 },
    text: { type: 'string', maxLength: 4000 },
    color: { type: 'string', enum: BEAT_COLORS },
  },
  required: ['act'],
  additionalProperties: false,
};
const beatUpdate = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    act: { type: 'integer', minimum: 1, maximum: 3 },
    title: { type: 'string', maxLength: 120 },
    text: { type: 'string', maxLength: 4000 },
    color: { type: 'string', enum: BEAT_COLORS },
  },
  required: ['id'],
  minProperties: 2,
  additionalProperties: false,
};

function objectSchema(properties, required = [], extras = {}) {
  return { type: 'object', properties, required, additionalProperties: false, ...extras };
}

function outputSchema(name, properties = {}, required = []) {
  const commonProperties = {
    projectPath: { type: 'string' },
    sourcePath: { type: 'string' },
    outputPath: { type: 'string' },
    documentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    outputHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    savedAt: { type: 'string' },
    format: { type: 'string' },
    document: { type: 'object' },
    summary: { type: 'object' },
    warnings: { type: 'array' },
    errors: { type: 'array' },
    valid: { type: 'boolean' },
    results: { type: 'array' },
    blocks: { type: 'array' },
    beats: { type: 'array' },
    blockIds: { type: 'array' },
    beatIds: { type: 'array' },
    deletedBlockIds: { type: 'array' },
    deletedBeatIds: { type: 'array' },
    normalized: { type: 'object' },
    atIndex: { type: 'integer', minimum: 0 },
    replacementBlock: { type: ['object', 'null'] },
    query: { type: 'string' },
    caseSensitive: { type: 'boolean' },
    totalMatches: { type: 'integer', minimum: 0 },
    truncated: { type: 'boolean' },
    bytes: { type: 'integer', minimum: 0 },
  };
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      tool: { type: 'string', const: name },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: {},
        },
        required: ['code', 'message'],
        additionalProperties: false,
      },
      ...commonProperties,
      ...properties,
    },
    required: ['ok', 'tool'],
    oneOf: [
      { properties: { ok: { const: true } }, required },
      { properties: { ok: { const: false } }, required: ['error'] },
    ],
    additionalProperties: false,
  };
}

function annotation({ readOnly = false, destructive = false, idempotent = false } = {}) {
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false };
}

function descriptor(name, title, description, inputSchema, handler, options = {}) {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema: outputSchema(name, options.outputProperties, options.outputRequired),
    annotations: annotation(options.annotations),
    handler,
  };
}

function assertExpectedHash(loaded, requested) {
  if (requested !== undefined) {
    invariant(loaded.hash === requested, 'DOCUMENT_CHANGED', 'The project hash does not match expectedHash; reopen it before applying edits.', {
      expectedHash: requested,
      actualHash: loaded.hash,
      projectPath: loaded.filePath,
    });
  }
}

async function mutate(args, transform) {
  const loaded = await loadDocumentFile(args.projectPath);
  assertExpectedHash(loaded, args.expectedHash);
  const outcome = transform(loaded.document);
  const saved = await saveDocumentFile(loaded.filePath, outcome.document, {
    overwrite: true,
    expectedCurrentHash: loaded.hash,
  });
  return {
    projectPath: saved.filePath,
    documentHash: saved.hash,
    savedAt: saved.document.savedAt,
    summary: summarizeDocument(saved.document),
    ...Object.fromEntries(Object.entries(outcome).filter(([key]) => key !== 'document')),
  };
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function titleFromPath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function importFormat(requested, sourcePath) {
  if (requested && requested !== 'auto') return requested;
  const extension = path.extname(sourcePath).toLowerCase();
  if (PROJECT_EXTENSIONS.includes(extension)) return 'ludere';
  if (extension === '.fdx') return 'fdx';
  if (['.txt', '.fountain'].includes(extension)) return 'plain';
  throw new LudereMcpError('UNKNOWN_IMPORT_FORMAT', 'Could not infer import format; set format explicitly.', { path: sourcePath, extension });
}

function freeTextBlocks(source) {
  const blocks = String(source).replace(/\r\n?/g, '\n').split('\n')
    .filter((line) => line.trim())
    .map((line) => createBlock('general', line.trim()));
  return blocks.length ? blocks : [createBlock('general')];
}

const tools = [
  descriptor(
    'ludere_create_document',
    'Create Ludere document',
    'Create a screenplay or free-writing .ludere project. Requires an explicit absolute destination and refuses replacement unless overwrite=true.',
    objectSchema({
      projectPath: destinationProjectPath,
      title: { type: 'string', maxLength: 120 },
      mode: { type: 'string', enum: ['screenplay', 'free'] },
      titlePage: titlePagePatch,
      overwrite: { type: 'boolean', description: 'Replace an existing destination only when explicitly true.' },
    }, ['projectPath']),
    async (args) => {
      const document = createDocument(args.mode);
      if (args.title !== undefined) document.title = args.title;
      if (args.titlePage) document.titlePage = { ...document.titlePage, ...args.titlePage };
      const saved = await saveDocumentFile(args.projectPath, document, { overwrite: args.overwrite === true });
      return { projectPath: saved.filePath, documentHash: saved.hash, savedAt: saved.document.savedAt, summary: summarizeDocument(saved.document) };
    },
    { annotations: { destructive: true }, outputRequired: ['projectPath', 'documentHash', 'summary'] },
  ),
  descriptor(
    'ludere_open_document',
    'Open Ludere document',
    'Read and strictly validate a portable Ludere project, returning its complete normalized document and a hash for optimistic edit protection.',
    objectSchema({ projectPath }, ['projectPath']),
    async ({ projectPath: requested }) => {
      const loaded = await loadDocumentFile(requested);
      return {
        projectPath: loaded.filePath,
        documentHash: loaded.hash,
        document: loaded.document,
        warnings: loaded.diagnostics.warnings,
      };
    },
    { annotations: { readOnly: true, idempotent: true }, outputRequired: ['projectPath', 'documentHash', 'document'] },
  ),
  descriptor(
    'ludere_inspect_document',
    'Inspect Ludere document',
    'Return a compact project summary: metadata, block/scene/beat/word/page counts, characters, act counts, and scene IDs.',
    objectSchema({ projectPath }, ['projectPath']),
    async ({ projectPath: requested }) => {
      const loaded = await loadDocumentFile(requested);
      return { projectPath: loaded.filePath, documentHash: loaded.hash, summary: summarizeDocument(loaded.document), warnings: loaded.diagnostics.warnings };
    },
    { annotations: { readOnly: true, idempotent: true }, outputRequired: ['projectPath', 'documentHash', 'summary'] },
  ),
  descriptor(
    'ludere_validate_document',
    'Validate Ludere document',
    'Validate either an absolute project path or an inline document without writing. Reports errors, normalization warnings, and optionally the normalized value.',
    objectSchema({
      projectPath,
      document: { type: 'object', description: 'Inline Ludere document to validate.' },
      includeNormalized: { type: 'boolean' },
    }, [], { oneOf: [{ required: ['projectPath'] }, { required: ['document'] }] }),
    async (args) => {
      let source;
      let documentHash;
      let resolvedPath;
      let parseError;
      if (args.projectPath) {
        const loaded = await readTextFile(args.projectPath, { label: 'Project path', extensions: PROJECT_EXTENSIONS });
        source = loaded.source;
        documentHash = loaded.hash;
        resolvedPath = loaded.filePath;
        try { source = JSON.parse(source); } catch (error) { parseError = error; }
      } else source = args.document;
      const diagnostics = parseError
        ? { valid: false, errors: [{ code: 'INVALID_JSON', message: parseError.message }], warnings: [], normalized: null }
        : diagnoseDocument(source);
      return {
        ...(resolvedPath ? { projectPath: resolvedPath, documentHash } : {}),
        valid: diagnostics.valid,
        errors: diagnostics.errors,
        warnings: diagnostics.warnings,
        ...(args.includeNormalized && diagnostics.normalized ? { normalized: diagnostics.normalized } : {}),
      };
    },
    { annotations: { readOnly: true, idempotent: true }, outputRequired: ['valid', 'errors', 'warnings'] },
  ),
  descriptor(
    'ludere_save_document',
    'Save complete Ludere document',
    'Validate and atomically persist an inline document using the exact portable/autosave-compatible schema. Existing files require overwrite=true.',
    objectSchema({
      projectPath: destinationProjectPath,
      document: { type: 'object' },
      overwrite: { type: 'boolean' },
      expectedHash,
    }, ['projectPath', 'document']),
    async (args) => {
      const diagnostics = diagnoseDocument(args.document);
      invariant(diagnostics.valid, 'INVALID_DOCUMENT', 'The inline document is not safe to save.', { errors: diagnostics.errors });
      if (args.expectedHash !== undefined) invariant(args.overwrite === true, 'INVALID_ARGUMENTS', 'expectedHash requires overwrite=true.');
      const saved = await saveDocumentFile(args.projectPath, diagnostics.normalized, {
        overwrite: args.overwrite === true,
        expectedCurrentHash: args.expectedHash,
      });
      return { projectPath: saved.filePath, documentHash: saved.hash, savedAt: saved.document.savedAt, summary: summarizeDocument(saved.document), warnings: diagnostics.warnings };
    },
    { annotations: { destructive: true }, outputRequired: ['projectPath', 'documentHash', 'summary'] },
  ),
  descriptor(
    'ludere_update_metadata',
    'Update Ludere metadata',
    'Atomically update the document title and/or optional title-page fields without changing script blocks or beats.',
    objectSchema({ projectPath, expectedHash, title: { type: 'string', maxLength: 120 }, titlePage: titlePagePatch }, ['projectPath'], {
      anyOf: [{ required: ['title'] }, { required: ['titlePage'] }],
    }),
    async (args) => mutate(args, (document) => ({ document: updateMetadata(document, args) })),
    { annotations: { destructive: true }, outputRequired: ['projectPath', 'documentHash', 'summary'] },
  ),
  descriptor(
    'ludere_add_blocks',
    'Add script blocks',
    'Insert screenplay elements at an index, before/after a block ID, or at the end. Optional committed-type inference uses the same rules as the editor.',
    objectSchema({
      projectPath, expectedHash,
      blocks: { type: 'array', items: blockSpec, minItems: 1, maxItems: 1000 },
      inferTypes: { type: 'boolean' },
      ...positionProperties,
    }, ['projectPath', 'blocks']),
    async (args) => mutate(args, (document) => addBlocks(document, args.blocks, args, args.inferTypes === true)),
    { outputRequired: ['projectPath', 'documentHash', 'blocks'], annotations: {} },
  ),
  descriptor(
    'ludere_update_blocks',
    'Update script blocks',
    'Patch text, inline formatting, type, or formatting state for existing block IDs. Text edits clear stale HTML unless replacement HTML is supplied.',
    objectSchema({
      projectPath, expectedHash,
      updates: { type: 'array', items: blockUpdate, minItems: 1, maxItems: 1000 },
      inferTypes: { type: 'boolean' },
    }, ['projectPath', 'updates']),
    async (args) => mutate(args, (document) => updateBlocks(document, args.updates, args.inferTypes === true)),
    { outputRequired: ['projectPath', 'documentHash', 'blocks'], annotations: { destructive: true } },
  ),
  descriptor(
    'ludere_reorder_blocks',
    'Reorder script blocks',
    'Move one or more existing block IDs as a stable group to an index or before/after another block. IDs not named keep their relative order.',
    objectSchema({
      projectPath, expectedHash,
      blockIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 5000, uniqueItems: true },
      ...positionProperties,
    }, ['projectPath', 'blockIds']),
    async (args) => mutate(args, (document) => reorderBlocks(document, args.blockIds, args)),
    { outputRequired: ['projectPath', 'documentHash', 'blockIds'], annotations: { destructive: true } },
  ),
  descriptor(
    'ludere_delete_blocks',
    'Delete script blocks',
    'Delete blocks by stable ID. Deleting every block preserves the editor invariant by inserting one blank scene/general block.',
    objectSchema({
      projectPath, expectedHash,
      blockIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 5000, uniqueItems: true },
    }, ['projectPath', 'blockIds']),
    async (args) => mutate(args, (document) => deleteBlocks(document, args.blockIds)),
    { outputRequired: ['projectPath', 'documentHash', 'deletedBlockIds'], annotations: { destructive: true } },
  ),
  descriptor(
    'ludere_search_document',
    'Search Ludere document',
    'Literal local search across script blocks, beat titles/text, and document/title-page metadata with type/act filters and stable IDs.',
    objectSchema({
      projectPath,
      query: { type: 'string', minLength: 1, maxLength: 1000 },
      caseSensitive: { type: 'boolean' },
      fields: { type: 'array', items: { type: 'string', enum: ['blocks', 'beats', 'metadata'] }, minItems: 1, uniqueItems: true },
      types: { type: 'array', items: { type: 'string', enum: ELEMENT_TYPES }, minItems: 1, uniqueItems: true },
      acts: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 3 }, minItems: 1, uniqueItems: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
    }, ['projectPath', 'query']),
    async (args) => {
      const loaded = await loadDocumentFile(args.projectPath);
      return { projectPath: loaded.filePath, documentHash: loaded.hash, ...searchDocument(loaded.document, args) };
    },
    { annotations: { readOnly: true, idempotent: true }, outputRequired: ['projectPath', 'documentHash', 'results'] },
  ),
  descriptor(
    'ludere_add_beats',
    'Add story beats',
    'Insert beat-board cards with act, title, text, and one of Ludere’s four supported colours.',
    objectSchema({
      projectPath, expectedHash,
      beats: { type: 'array', items: beatSpec, minItems: 1, maxItems: 1000 },
      ...positionProperties,
    }, ['projectPath', 'beats']),
    async (args) => mutate(args, (document) => addBeats(document, args.beats, args)),
    { outputRequired: ['projectPath', 'documentHash', 'beats'] },
  ),
  descriptor(
    'ludere_update_beats',
    'Update story beats',
    'Patch act, title, text, or colour for beat-board cards addressed by stable beat ID.',
    objectSchema({
      projectPath, expectedHash,
      updates: { type: 'array', items: beatUpdate, minItems: 1, maxItems: 1000 },
    }, ['projectPath', 'updates']),
    async (args) => mutate(args, (document) => updateBeats(document, args.updates)),
    { outputRequired: ['projectPath', 'documentHash', 'beats'], annotations: { destructive: true } },
  ),
  descriptor(
    'ludere_reorder_beats',
    'Reorder story beats',
    'Move beat IDs as a stable group while preserving every unnamed beat’s relative order. Act changes use ludere_update_beats.',
    objectSchema({
      projectPath, expectedHash,
      beatIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 5000, uniqueItems: true },
      ...positionProperties,
    }, ['projectPath', 'beatIds']),
    async (args) => mutate(args, (document) => reorderBeats(document, args.beatIds, args)),
    { outputRequired: ['projectPath', 'documentHash', 'beatIds'], annotations: { destructive: true } },
  ),
  descriptor(
    'ludere_delete_beats',
    'Delete story beats',
    'Delete beat-board cards by stable beat ID without changing screenplay blocks.',
    objectSchema({
      projectPath, expectedHash,
      beatIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 5000, uniqueItems: true },
    }, ['projectPath', 'beatIds']),
    async (args) => mutate(args, (document) => deleteBeats(document, args.beatIds)),
    { outputRequired: ['projectPath', 'documentHash', 'deletedBeatIds'], annotations: { destructive: true } },
  ),
  descriptor(
    'ludere_import_scenes_to_board',
    'Import scenes to beat board',
    'Add scene headings not already present on the beat board and distribute them across three acts using the editor’s shared behavior.',
    objectSchema({ projectPath, expectedHash }, ['projectPath']),
    async (args) => mutate(args, (document) => addSceneBeats(document)),
    { outputRequired: ['projectPath', 'documentHash', 'beats'] },
  ),
  descriptor(
    'ludere_import_document',
    'Import screenplay document',
    'Import portable Ludere JSON, Final Draft XML, Fountain-like/plain text, or free-writing text into a new portable project. Source files remain untouched.',
    objectSchema({
      sourcePath: { type: 'string', minLength: 1, description: 'Absolute existing source file path.' },
      destinationPath: destinationProjectPath,
      format: { type: 'string', enum: ['auto', 'ludere', 'fdx', 'plain'] },
      mode: { type: 'string', enum: ['screenplay', 'free'], description: 'Used only for plain-text imports.' },
      title: { type: 'string', maxLength: 120 },
      overwrite: { type: 'boolean' },
    }, ['sourcePath', 'destinationPath']),
    async (args) => {
      const loaded = await readTextFile(args.sourcePath, { label: 'Import source' });
      const destination = absoluteFilePath(args.destinationPath, 'Destination path', PROJECT_EXTENSIONS);
      invariant(!samePath(loaded.filePath, destination), 'SOURCE_DESTINATION_COLLISION', 'Import source and destination must be different files.');
      const format = importFormat(args.format, loaded.filePath);
      let document;
      if (format === 'ludere') {
        let parsed;
        try { parsed = JSON.parse(loaded.source); } catch (error) { throw new LudereMcpError('INVALID_JSON', 'The import source is not valid JSON.', { cause: error.message }); }
        const diagnostics = diagnoseDocument(parsed);
        invariant(diagnostics.valid, 'INVALID_DOCUMENT', 'The import source is not a safely editable Ludere document.', { errors: diagnostics.errors });
        document = diagnostics.normalized;
      } else {
        const mode = format === 'fdx' ? 'screenplay' : (args.mode || 'screenplay');
        document = createDocument(mode);
        try {
          document.blocks = format === 'fdx'
            ? importFinalDraft(loaded.source)
            : mode === 'free' ? freeTextBlocks(loaded.source) : parsePlainScript(loaded.source);
        } catch (error) {
          throw new LudereMcpError('IMPORT_FAILED', 'The source could not be imported.', { format, cause: error.message });
        }
        document.title = titleFromPath(loaded.filePath);
      }
      if (args.title !== undefined) document.title = args.title;
      const saved = await saveDocumentFile(destination, document, { overwrite: args.overwrite === true });
      return {
        sourcePath: loaded.filePath,
        sourceHash: loaded.hash,
        projectPath: saved.filePath,
        documentHash: saved.hash,
        format,
        summary: summarizeDocument(saved.document),
      };
    },
    { annotations: { destructive: true }, outputRequired: ['sourcePath', 'projectPath', 'documentHash', 'format', 'summary'] },
  ),
  descriptor(
    'ludere_export_document',
    'Export Ludere document',
    'Export a project as portable Ludere JSON, Final Draft .fdx, industry-indented plain text, or standalone printable HTML. Refuses overwrite by default.',
    objectSchema({
      projectPath,
      outputPath: { type: 'string', minLength: 1, description: 'Absolute explicit output file path.' },
      format: { type: 'string', enum: ['ludere', 'fdx', 'text', 'html'] },
      overwrite: { type: 'boolean' },
      expectedHash,
    }, ['projectPath', 'outputPath', 'format']),
    async (args) => {
      const loaded = await loadDocumentFile(args.projectPath);
      assertExpectedHash(loaded, args.expectedHash);
      const extensions = {
        ludere: PROJECT_EXTENSIONS,
        fdx: ['.fdx'],
        text: ['.txt'],
        html: ['.html', '.htm'],
      }[args.format];
      const outputPath = absoluteFilePath(args.outputPath, 'Output path', extensions);
      invariant(!samePath(loaded.filePath, outputPath), 'SOURCE_DESTINATION_COLLISION', 'Export output must not replace the open project.');
      const content = {
        ludere: () => documentJSON(loaded.document),
        fdx: () => exportFinalDraft(loaded.document),
        text: () => exportPlainText(loaded.document),
        html: () => exportPrintableHTML(loaded.document),
      }[args.format]();
      const saved = await writeTextFile(outputPath, content, { label: 'Output path', extensions, overwrite: args.overwrite === true });
      return {
        projectPath: loaded.filePath,
        documentHash: loaded.hash,
        outputPath: saved.filePath,
        outputHash: saved.hash,
        bytes: saved.bytes,
        format: args.format,
      };
    },
    { annotations: { destructive: true, idempotent: true }, outputRequired: ['projectPath', 'documentHash', 'outputPath', 'outputHash', 'format'] },
  ),
];

export const TOOL_CATALOG = tools.map(({ handler, ...tool }) => tool);
export const TOOL_HANDLERS = new Map(tools.map((tool) => [tool.name, tool]));
