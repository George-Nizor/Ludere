import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDocument, exportFinalDraft, parsePlainScript } from '../core.mjs';
import { validateSchema } from '../mcp/schema.mjs';
import { LudereMcpServer, LATEST_PROTOCOL_VERSION } from '../mcp/server.mjs';
import { TOOL_CATALOG } from '../mcp/tools.mjs';

const toolCatalog = new Map(TOOL_CATALOG.map((tool) => [tool.name, tool]));

async function initialize(server, version = LATEST_PROTOCOL_VERSION) {
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(response.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  return response;
}

async function call(server, name, args, id = 2) {
  const response = await server.handleMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  assert.equal(response.result.content[0].text, JSON.stringify(response.result.structuredContent, null, 2));
  const descriptor = toolCatalog.get(name);
  if (descriptor) assert.doesNotThrow(() => validateSchema(response.result.structuredContent, descriptor.outputSchema, `${name} result`));
  return response.result;
}

function result(response) {
  assert.equal(response.isError, undefined, JSON.stringify(response.structuredContent));
  assert.equal(response.structuredContent.ok, true);
  return response.structuredContent;
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ludere-mcp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('MCP negotiates supported versions and publishes complete schemas and annotations', async () => {
  const server = new LudereMcpServer();
  const initialized = await initialize(server, 'unsupported-future-version');
  assert.match(initialized.result.instructions, /absolute \.ludere files locally/);
  const listed = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(listed.result.tools.length, 18);
  const names = listed.result.tools.map((tool) => tool.name);
  for (const expected of [
    'ludere_create_document', 'ludere_open_document', 'ludere_inspect_document',
    'ludere_add_blocks', 'ludere_update_blocks', 'ludere_reorder_blocks',
    'ludere_delete_blocks', 'ludere_search_document', 'ludere_update_metadata',
    'ludere_import_document', 'ludere_export_document', 'ludere_validate_document',
    'ludere_add_beats', 'ludere_update_beats', 'ludere_reorder_beats',
    'ludere_delete_beats', 'ludere_import_scenes_to_board', 'ludere_save_document',
  ]) assert.ok(names.includes(expected), expected);
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, 'object');
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
  }
});

test('MCP creates, edits, reorders, searches, and deletes screenplay blocks atomically', async (t) => {
  const directory = await temporaryDirectory(t);
  const projectPath = path.join(directory, 'workflow.ludere');
  const server = new LudereMcpServer();
  await initialize(server);

  const created = result(await call(server, 'ludere_create_document', { projectPath, title: 'Workflow' }));
  assert.equal(created.summary.blocks, 1);
  const initialId = created.summary.scenes[0].id;

  const added = result(await call(server, 'ludere_add_blocks', {
    projectPath,
    expectedHash: created.documentHash,
    afterId: initialId,
    inferTypes: true,
    blocks: [
      { type: 'action', text: 'INT. LAB - NIGHT' },
      { type: 'action', text: 'MAYA' },
      { type: 'dialogue', text: 'The signal is live.' },
      { type: 'action', text: 'CUT TO:' },
    ],
  }));
  assert.deepEqual(added.blocks.map((block) => block.type), ['scene', 'character', 'dialogue', 'transition']);

  const stale = await call(server, 'ludere_update_metadata', { projectPath, expectedHash: created.documentHash, title: 'Stale' });
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent.error.code, 'DOCUMENT_CHANGED');

  const updated = result(await call(server, 'ludere_update_blocks', {
    projectPath,
    expectedHash: added.documentHash,
    updates: [{ id: added.blocks[2].id, html: '<b>The signal</b> is live.', text: 'The signal is live.' }],
  }));
  assert.equal(updated.blocks[0].html, '<b>The signal</b> is live.');

  const reordered = result(await call(server, 'ludere_reorder_blocks', {
    projectPath,
    expectedHash: updated.documentHash,
    blockIds: [added.blocks[3].id],
    beforeId: added.blocks[0].id,
  }));
  assert.equal(reordered.atIndex, 1);

  const search = result(await call(server, 'ludere_search_document', { projectPath, query: 'signal' }));
  assert.equal(search.totalMatches, 1);
  assert.equal(search.results[0].id, added.blocks[2].id);

  const metadata = result(await call(server, 'ludere_update_metadata', {
    projectPath,
    expectedHash: reordered.documentHash,
    title: 'Revised Workflow',
    titlePage: { enabled: true, author: 'A. Writer' },
  }));
  assert.equal(metadata.summary.title, 'Revised Workflow');
  assert.equal(metadata.summary.titlePageEnabled, true);

  const deleted = result(await call(server, 'ludere_delete_blocks', {
    projectPath,
    expectedHash: metadata.documentHash,
    blockIds: [initialId],
  }));
  assert.deepEqual(deleted.deletedBlockIds, [initialId]);
  const opened = result(await call(server, 'ludere_open_document', { projectPath }));
  assert.equal(opened.document.titlePage.author, 'A. Writer');
  assert.equal(opened.document.blocks.some((block) => block.id === initialId), false);
  assert.equal(opened.document.blocks.find((block) => block.id === added.blocks[2].id).html, '<b>The signal</b> is live.');
  assert.equal((await readFile(projectPath, 'utf8')).endsWith('\n'), true);
});

test('MCP covers board add/update/reorder/delete and shared scene import', async (t) => {
  const directory = await temporaryDirectory(t);
  const projectPath = path.join(directory, 'board.ludere');
  const source = createDocument();
  source.title = 'Board';
  source.blocks = parsePlainScript('INT. ONE - DAY\n\nAction.\n\nEXT. TWO - NIGHT');
  await writeFile(projectPath, `${JSON.stringify(source, null, 2)}\n`);
  const server = new LudereMcpServer();
  await initialize(server);

  const imported = result(await call(server, 'ludere_import_scenes_to_board', { projectPath }));
  assert.equal(imported.beats.length, 2);
  const secondImport = result(await call(server, 'ludere_import_scenes_to_board', { projectPath, expectedHash: imported.documentHash }));
  assert.equal(secondImport.beats.length, 0);

  const added = result(await call(server, 'ludere_add_beats', {
    projectPath,
    expectedHash: secondImport.documentHash,
    beats: [{ act: 3, title: 'Climax', text: 'The choice.', color: 'clay' }],
    atIndex: 1,
  }));
  const climax = added.beats[0];
  const updated = result(await call(server, 'ludere_update_beats', {
    projectPath,
    expectedHash: added.documentHash,
    updates: [{ id: climax.id, act: 2, title: 'Midpoint', color: 'sage' }],
  }));
  assert.equal(updated.beats[0].act, 2);
  const reordered = result(await call(server, 'ludere_reorder_beats', {
    projectPath,
    expectedHash: updated.documentHash,
    beatIds: [climax.id],
    atIndex: 0,
  }));
  assert.equal(reordered.atIndex, 0);
  const deleted = result(await call(server, 'ludere_delete_beats', {
    projectPath,
    expectedHash: reordered.documentHash,
    beatIds: [climax.id],
  }));
  assert.deepEqual(deleted.deletedBeatIds, [climax.id]);
});

test('MCP imports plain text and FDX, exports every file format, and protects destinations', async (t) => {
  const directory = await temporaryDirectory(t);
  const plainPath = path.join(directory, 'incoming.fountain');
  const projectPath = path.join(directory, 'imported.ludere');
  await writeFile(plainPath, 'INT. KITCHEN - NIGHT\n\nMAYA\nWe have to leave.\n');
  const server = new LudereMcpServer();
  await initialize(server);

  const imported = result(await call(server, 'ludere_import_document', { sourcePath: plainPath, destinationPath: projectPath, format: 'auto' }));
  assert.equal(imported.format, 'plain');
  assert.deepEqual(imported.summary.blockTypes.scene, 1);
  for (const [format, extension] of [['fdx', '.fdx'], ['text', '.txt'], ['html', '.html'], ['ludere', '.json']]) {
    const outputPath = path.join(directory, `export${extension}`);
    const exported = result(await call(server, 'ludere_export_document', { projectPath, outputPath, format }));
    assert.equal(exported.outputPath, outputPath);
    assert.ok((await readFile(outputPath)).length > 10);
    const collision = await call(server, 'ludere_export_document', { projectPath, outputPath, format });
    assert.equal(collision.isError, true);
    assert.equal(collision.structuredContent.error.code, 'FILE_EXISTS');
  }

  const fdxPath = path.join(directory, 'styled.fdx');
  const fdxDocument = createDocument();
  fdxDocument.blocks = [{ id: 'styled', type: 'dialogue', text: 'Very important.', html: '<b>Very</b> <i>important</i>.' }];
  await writeFile(fdxPath, exportFinalDraft(fdxDocument));
  const fdxProject = path.join(directory, 'styled.ludere');
  const fdxImport = result(await call(server, 'ludere_import_document', { sourcePath: fdxPath, destinationPath: fdxProject }));
  assert.equal(fdxImport.summary.blockTypes.dialogue, 1);
  const opened = result(await call(server, 'ludere_open_document', { projectPath: fdxProject }));
  assert.equal(opened.document.blocks[0].html, '<b>Very</b> <i>important</i>.');
});

test('MCP validates inline/files, saves portable schema, and rejects unsafe paths and argument shapes', async (t) => {
  const directory = await temporaryDirectory(t);
  const server = new LudereMcpServer();
  await initialize(server);
  const invalid = { app: 'ludere', version: 99, blocks: [] };
  const validation = result(await call(server, 'ludere_validate_document', { document: invalid, includeNormalized: true }));
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0].code, 'UNSUPPORTED_VERSION');

  const projectPath = path.join(directory, 'saved.ludere');
  const document = createDocument('free');
  document.title = 'Notes';
  const saved = result(await call(server, 'ludere_save_document', { projectPath, document }));
  assert.equal(saved.summary.mode, 'free');
  const exists = await call(server, 'ludere_save_document', { projectPath, document });
  assert.equal(exists.isError, true);
  assert.equal(exists.structuredContent.error.code, 'FILE_EXISTS');
  assert.equal(JSON.parse(await readFile(projectPath, 'utf8')).title, 'Notes');

  const relative = await call(server, 'ludere_create_document', { projectPath: 'relative.ludere' });
  assert.equal(relative.isError, true);
  assert.equal(relative.structuredContent.error.code, 'PATH_NOT_ABSOLUTE');
  const badArgs = await call(server, 'ludere_add_blocks', { projectPath, blocks: [], surprise: true });
  assert.equal(badArgs.isError, true);
  assert.equal(badArgs.structuredContent.error.code, 'INVALID_ARGUMENTS');
});

test('MCP preserves edit invariants and diagnoses lossy normalization before saving', async (t) => {
  const directory = await temporaryDirectory(t);
  const projectPath = path.join(directory, 'invariants.ludere');
  const server = new LudereMcpServer();
  await initialize(server);

  const created = result(await call(server, 'ludere_create_document', { projectPath }));
  const onlyBlock = created.summary.scenes[0].id;
  const ambiguous = await call(server, 'ludere_reorder_blocks', {
    projectPath,
    expectedHash: created.documentHash,
    blockIds: [onlyBlock],
    atIndex: 0,
    beforeId: onlyBlock,
  });
  assert.equal(ambiguous.isError, true);
  assert.equal(ambiguous.structuredContent.error.code, 'AMBIGUOUS_POSITION');

  const mismatch = await call(server, 'ludere_update_blocks', {
    projectPath,
    expectedHash: created.documentHash,
    updates: [{ id: onlyBlock, text: 'Canonical', html: '<b>Different</b>' }],
  });
  assert.equal(mismatch.isError, true);
  assert.equal(mismatch.structuredContent.error.code, 'HTML_TEXT_MISMATCH');

  const deleted = result(await call(server, 'ludere_delete_blocks', {
    projectPath,
    expectedHash: created.documentHash,
    blockIds: [onlyBlock],
  }));
  assert.equal(deleted.summary.blocks, 1);
  assert.equal(deleted.replacementBlock.type, 'scene');
  assert.notEqual(deleted.replacementBlock.id, onlyBlock);

  const candidate = createDocument();
  candidate.title = 42;
  candidate.mode = 'future-mode';
  candidate.titlePage = { enabled: 'yes', author: 7 };
  candidate.blocks[0].html = { unsafe: true };
  const diagnosed = result(await call(server, 'ludere_validate_document', { document: candidate, includeNormalized: true }));
  assert.equal(diagnosed.valid, true);
  assert.deepEqual(
    diagnosed.warnings.map((warning) => warning.code),
    ['INVALID_BLOCK_HTML', 'INVALID_TITLE', 'INVALID_MODE', 'INVALID_TITLE_PAGE_ENABLED', 'INVALID_TITLE_PAGE_FIELD'],
  );
  assert.equal(diagnosed.normalized.title, '');
  assert.equal(diagnosed.normalized.mode, 'screenplay');
});
