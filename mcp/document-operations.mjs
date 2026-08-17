import {
  BEAT_COLORS,
  ELEMENT_TYPES,
  createBeat,
  createBlock,
  documentStats,
  importScenesToBoard,
  inferCommittedType,
  sanitizeInlineHTML,
  stripInlineHTML,
  validateDocument,
} from '../core.mjs';
import { invariant } from './errors.mjs';

function cloneDocument(value) {
  const document = validateDocument(value);
  invariant(document, 'INVALID_DOCUMENT', 'The document cannot be edited safely.');
  return document;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function uniqueIdentifiers(ids, label) {
  const unique = [...new Set(ids)];
  invariant(unique.length === ids.length, 'DUPLICATE_ID', `${label} contains duplicate identifiers.`);
  return unique;
}

function requireItemsById(items, ids, label) {
  const unique = uniqueIdentifiers(ids, label);
  const byId = new Map(items.map((item) => [item.id, item]));
  const missing = unique.filter((id) => !byId.has(id));
  invariant(!missing.length, 'ID_NOT_FOUND', `${label} references identifiers that do not exist.`, { missing });
  return unique;
}

function insertionIndex(items, position = {}, moving = new Set()) {
  const locators = ['atIndex', 'beforeId', 'afterId'].filter((key) => position[key] !== undefined);
  invariant(locators.length <= 1, 'AMBIGUOUS_POSITION', 'Use only one of atIndex, beforeId, or afterId.');
  if (position.atIndex !== undefined) {
    invariant(position.atIndex >= 0 && position.atIndex <= items.length, 'INDEX_OUT_OF_RANGE', 'atIndex is outside the destination list.', { atIndex: position.atIndex, length: items.length });
    return position.atIndex;
  }
  const targetId = position.beforeId ?? position.afterId;
  if (targetId !== undefined) {
    invariant(!moving.has(targetId), 'INVALID_POSITION', 'A moved item cannot also be its own position anchor.', { id: targetId });
    const index = items.findIndex((item) => item.id === targetId);
    invariant(index >= 0, 'ID_NOT_FOUND', 'The position anchor does not exist.', { id: targetId });
    return index + (position.afterId !== undefined ? 1 : 0);
  }
  return items.length;
}

function normalizedBlock(specification, mode, inferType = false) {
  let text = specification.text ?? '';
  let html;
  if (own(specification, 'html')) {
    html = sanitizeInlineHTML(specification.html || '');
    const htmlText = stripInlineHTML(html);
    if (!own(specification, 'text')) text = htmlText;
    else invariant(htmlText === text, 'HTML_TEXT_MISMATCH', 'Block html must represent the same canonical text as text.');
  }
  let type = mode === 'free' ? 'general' : (specification.type || 'action');
  if (inferType && mode !== 'free') type = inferCommittedType(text, type);
  return createBlock(type, text, html || undefined);
}

export function summarizeDocument(document) {
  const stats = documentStats(document);
  return {
    app: document.app,
    version: document.version,
    title: document.title,
    mode: document.mode,
    savedAt: document.savedAt,
    titlePageEnabled: document.titlePage.enabled,
    ...stats,
    scenes: document.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.type === 'scene')
      .map(({ block, index }, sceneIndex) => ({ id: block.id, blockIndex: index, sceneNumber: sceneIndex + 1, heading: block.text })),
  };
}

export function updateMetadata(value, patch) {
  const document = cloneDocument(value);
  if (own(patch, 'title')) document.title = patch.title;
  if (patch.titlePage) document.titlePage = { ...document.titlePage, ...patch.titlePage };
  return cloneDocument(document);
}

export function addBlocks(value, specifications, position = {}, inferType = false) {
  const document = cloneDocument(value);
  const blocks = specifications.map((specification) => normalizedBlock(specification, document.mode, inferType));
  const index = insertionIndex(document.blocks, position);
  document.blocks.splice(index, 0, ...blocks);
  return { document: cloneDocument(document), blocks, atIndex: index };
}

export function updateBlocks(value, updates, inferType = false) {
  const document = cloneDocument(value);
  const ids = requireItemsById(document.blocks, updates.map((update) => update.id), 'updates');
  const updatesById = new Map(updates.map((update) => [update.id, update]));
  for (const id of ids) {
    const block = document.blocks.find((entry) => entry.id === id);
    const update = updatesById.get(id);
    if (own(update, 'text')) {
      block.text = update.text;
      if (!own(update, 'html')) delete block.html;
    }
    if (own(update, 'html')) {
      const html = sanitizeInlineHTML(update.html || '');
      const htmlText = stripInlineHTML(html);
      if (!own(update, 'text')) block.text = htmlText;
      else invariant(htmlText === block.text, 'HTML_TEXT_MISMATCH', 'Block html must represent the same canonical text as text.', { id });
      if (html) block.html = html;
      else delete block.html;
    }
    if (update.clearFormatting) delete block.html;
    if (document.mode === 'free') block.type = 'general';
    else if (own(update, 'type')) block.type = update.type;
    if ((inferType || update.inferType) && document.mode !== 'free') {
      block.type = inferCommittedType(block.text, block.type);
    }
  }
  return { document: cloneDocument(document), blocks: ids.map((id) => document.blocks.find((block) => block.id === id)) };
}

export function reorderBlocks(value, blockIds, position) {
  const document = cloneDocument(value);
  const ids = requireItemsById(document.blocks, blockIds, 'blockIds');
  const moving = new Set(ids);
  const byId = new Map(document.blocks.map((block) => [block.id, block]));
  const remainder = document.blocks.filter((block) => !moving.has(block.id));
  const index = insertionIndex(remainder, position, moving);
  remainder.splice(index, 0, ...ids.map((id) => byId.get(id)));
  document.blocks = remainder;
  return { document: cloneDocument(document), blockIds: ids, atIndex: index };
}

export function deleteBlocks(value, blockIds) {
  const document = cloneDocument(value);
  const ids = requireItemsById(document.blocks, blockIds, 'blockIds');
  const deleting = new Set(ids);
  document.blocks = document.blocks.filter((block) => !deleting.has(block.id));
  let replacementBlock = null;
  if (!document.blocks.length) {
    replacementBlock = createBlock(document.mode === 'free' ? 'general' : 'scene');
    document.blocks.push(replacementBlock);
  }
  return { document: cloneDocument(document), deletedBlockIds: ids, replacementBlock };
}

export function addBeats(value, specifications, position = {}) {
  const document = cloneDocument(value);
  const beats = specifications.map((specification) => createBeat(
    specification.act,
    specification.title || '',
    specification.text || '',
    specification.color,
  ));
  const index = insertionIndex(document.board, position);
  document.board.splice(index, 0, ...beats);
  return { document: cloneDocument(document), beats, atIndex: index };
}

export function updateBeats(value, updates) {
  const document = cloneDocument(value);
  const ids = requireItemsById(document.board, updates.map((update) => update.id), 'updates');
  const updatesById = new Map(updates.map((update) => [update.id, update]));
  for (const id of ids) {
    const beat = document.board.find((entry) => entry.id === id);
    const update = updatesById.get(id);
    if (own(update, 'act')) beat.act = update.act;
    if (own(update, 'title')) beat.title = update.title;
    if (own(update, 'text')) beat.text = update.text;
    if (own(update, 'color')) beat.color = update.color;
  }
  return { document: cloneDocument(document), beats: ids.map((id) => document.board.find((beat) => beat.id === id)) };
}

export function reorderBeats(value, beatIds, position) {
  const document = cloneDocument(value);
  const ids = requireItemsById(document.board, beatIds, 'beatIds');
  const moving = new Set(ids);
  const byId = new Map(document.board.map((beat) => [beat.id, beat]));
  const remainder = document.board.filter((beat) => !moving.has(beat.id));
  const index = insertionIndex(remainder, position, moving);
  remainder.splice(index, 0, ...ids.map((id) => byId.get(id)));
  document.board = remainder;
  return { document: cloneDocument(document), beatIds: ids, atIndex: index };
}

export function deleteBeats(value, beatIds) {
  const document = cloneDocument(value);
  const ids = requireItemsById(document.board, beatIds, 'beatIds');
  const deleting = new Set(ids);
  document.board = document.board.filter((beat) => !deleting.has(beat.id));
  return { document: cloneDocument(document), deletedBeatIds: ids };
}

export function addSceneBeats(value) {
  const document = cloneDocument(value);
  const beats = importScenesToBoard(document);
  return { document: cloneDocument(document), beats };
}

function snippet(text, matchAt, queryLength) {
  const start = Math.max(0, matchAt - 48);
  const end = Math.min(text.length, matchAt + queryLength + 72);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function searchDocument(value, {
  query,
  caseSensitive = false,
  fields = ['blocks', 'beats', 'metadata'],
  types = ELEMENT_TYPES,
  acts = [1, 2, 3],
  limit = 100,
}) {
  const document = cloneDocument(value);
  // Locale-neutral folding keeps search results stable across machines. This is intentionally a
  // literal search rather than locale-aware collation or full Unicode case folding.
  const needle = caseSensitive ? query : query.toLowerCase();
  const locate = (text) => (caseSensitive ? text : text.toLowerCase()).indexOf(needle);
  const results = [];
  let totalMatches = 0;
  const append = (result) => {
    totalMatches += 1;
    if (results.length < limit) results.push(result);
  };
  if (fields.includes('blocks')) {
    document.blocks.forEach((block, index) => {
      if (!types.includes(block.type)) return;
      const matchAt = locate(block.text);
      if (matchAt >= 0) append({ kind: 'block', id: block.id, index, type: block.type, matchAt, snippet: snippet(block.text, matchAt, query.length) });
    });
  }
  if (fields.includes('beats')) {
    document.board.forEach((beat, index) => {
      if (!acts.includes(beat.act)) return;
      for (const field of ['title', 'text']) {
        const matchAt = locate(beat[field]);
        if (matchAt >= 0) append({ kind: 'beat', id: beat.id, index, act: beat.act, field, matchAt, snippet: snippet(beat[field], matchAt, query.length) });
      }
    });
  }
  if (fields.includes('metadata')) {
    for (const [field, text] of [
      ['title', document.title],
      ['titlePage.author', document.titlePage.author],
      ['titlePage.source', document.titlePage.source],
      ['titlePage.contact', document.titlePage.contact],
      ['titlePage.draft', document.titlePage.draft],
    ]) {
      const matchAt = locate(text);
      if (matchAt >= 0) append({ kind: 'metadata', field, matchAt, snippet: snippet(text, matchAt, query.length) });
    }
  }
  return { query, caseSensitive, totalMatches, truncated: totalMatches > results.length, results };
}

export { BEAT_COLORS, ELEMENT_TYPES };
