import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEAT_COLORS,
  createDocument,
  cycleElement,
  documentStats,
  estimatePages,
  exportFinalDraft,
  exportPlainText,
  importFinalDraft,
  importScenesToBoard,
  inferCommittedType,
  inferLiveType,
  parsePlainScript,
  validateDocument,
} from '../core.mjs';

test('recognizes live screenplay syntax and committed character cues', () => {
  assert.equal(inferLiveType('INT. KITCHEN — NIGHT', 'action'), 'scene');
  assert.equal(inferLiveType('(under her breath)', 'dialogue'), 'parenthetical');
  assert.equal(inferCommittedType('CUT TO:', 'action'), 'transition');
  assert.equal(inferCommittedType('MAYA', 'action'), 'character');
  assert.equal(inferCommittedType('This is ordinary action.', 'action'), 'action');
});

test('cycles all eight screenplay elements in either direction', () => {
  assert.equal(cycleElement('scene', 1), 'action');
  assert.equal(cycleElement('scene', -1), 'general');
  assert.equal(cycleElement('general', 1), 'scene');
});

test('infers screenplay structure from pasted plain text', () => {
  const blocks = parsePlainScript('INT. KITCHEN - NIGHT\n\nMAYA\nWe need to go.\n\nCUT TO:');
  assert.deepEqual(blocks.map(({ type }) => type), ['scene', 'character', 'dialogue', 'transition']);
});

test('validates documents without accepting arbitrary block types', () => {
  const result = validateDocument({ title: 'Test', blocks: [{ type: 'script', text: 'Hello' }] });
  assert.equal(result.title, 'Test');
  assert.equal(result.blocks[0].type, 'action');
});

test('round-trips the structural subset of Final Draft XML', () => {
  const document = createDocument();
  document.blocks = parsePlainScript('EXT. ROAD - DAY\n\nJUNE\nRun.');
  const parsed = importFinalDraft(exportFinalDraft(document));
  assert.deepEqual(parsed.map(({ type, text }) => ({ type, text })), document.blocks.map(({ type, text }) => ({ type, text: ['scene', 'character'].includes(type) ? text.toUpperCase() : text })));
});

test('preserves bold, italic, and underline runs through Final Draft', () => {
  const document = createDocument();
  document.blocks = [{ id: 'styled', type: 'dialogue', text: 'Very important.', html: '<b>Very</b> <i><u>important</u></i>.' }];
  const xml = exportFinalDraft(document);
  assert.match(xml, /Style="Bold"/);
  assert.match(xml, /Style="Italic\+Underline"/);
  const [block] = importFinalDraft(xml);
  assert.equal(block.text, 'Very important.');
  assert.equal(block.html, '<b>Very</b> <i><u>important</u></i>.');
});

test('preserves inline line breaks through Final Draft instead of treating br as underline', () => {
  const document = createDocument();
  document.blocks = [{ id: 'line-break', type: 'dialogue', text: 'First\nSecond', html: '<b>First</b><br>Second' }];
  const [block] = importFinalDraft(exportFinalDraft(document));
  assert.equal(block.text, 'First\nSecond');
  assert.equal(block.html, '<b>First</b>\nSecond');
});

test('plain text export uses screenplay indentation and page estimation', () => {
  const document = createDocument();
  document.blocks = parsePlainScript('INT. ROOM - DAY\n\nELI\nHello there.');
  const output = exportPlainText(document);
  assert.match(output, /^INT\. ROOM - DAY/m);
  assert.match(output, /^ {22}ELI/m);
  assert.match(output, /^ {10}Hello there\./m);
  assert.equal(estimatePages(document), 1);
});

test('validation rejects future documents and repairs unsafe duplicate identity', () => {
  assert.equal(validateDocument({ app: 'other', version: 1, blocks: [] }), null);
  assert.equal(validateDocument({ app: 'ludere', version: 2, blocks: [] }), null);
  const result = validateDocument({
    app: 'ludere',
    version: 1,
    blocks: [
      { id: 'same', type: 'dialogue', text: 'Canonical', html: '<b>Different</b>' },
      { id: 'same', type: 'unknown', text: 'Second' },
    ],
    board: [
      { id: 'beat', act: 2, title: 'One', text: '', color: 'unknown' },
      { id: 'beat', act: 2, title: 'Two', text: '', color: 'sage' },
    ],
  });
  assert.notEqual(result.blocks[0].id, result.blocks[1].id);
  assert.equal(result.blocks[0].html, undefined);
  assert.equal(result.blocks[1].type, 'action');
  assert.notEqual(result.board[0].id, result.board[1].id);
  assert.equal(result.board[0].color, BEAT_COLORS[1]);
});

test('scene-to-board import is shared and idempotent by heading', () => {
  const document = createDocument();
  document.blocks = parsePlainScript('INT. ONE - DAY\n\nAction.\n\nEXT. TWO - NIGHT');
  const first = importScenesToBoard(document);
  const second = importScenesToBoard(document);
  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.deepEqual(first.map((beat) => beat.act), [1, 2]);
  assert.equal(documentStats(document).beats, 2);
  assert.equal(documentStats(document).scenes, 2);
});
