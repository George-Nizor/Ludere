import {
  ELEMENT_HINTS,
  ELEMENT_LABELS,
  ELEMENT_TYPES,
  EMPTY_ENTER_ELEMENT,
  NEXT_ELEMENT,
  UPPERCASE_ELEMENTS,
  BEAT_COLORS,
  createBlock,
  createBeat,
  createDocument,
  cycleElement,
  estimatePages,
  exportFinalDraft,
  exportPlainText,
  exportPrintableHTML,
  importFinalDraft,
  inferCommittedType,
  inferLiveType,
  importScenesToBoard,
  parsePlainScript,
  sanitizeInlineHTML,
  validateDocument,
} from './core.mjs';

const AUTOSAVE_KEY = 'instrumenta.ludere.document.v1';
const PREFS_KEY = 'instrumenta.ludere.preferences.v1';
const MAX_HISTORY = 200;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const editor = $('#editor');
const sceneList = $('#scene-list');
const elementMenu = $('#element-menu');
const documentMenu = $('#document-menu');
const titleInput = $('#document-title');
const fileInput = $('#file-input');
const suggestions = $('#character-suggestions');
const toastElement = $('#toast');

let script = restoreDocument();
let preferences = restorePreferences();
let activeBlockId = script.blocks[0]?.id || null;
let history = [];
let future = [];
let lastHistoryAt = 0;
let lastHistoryBlock = '';
let dirty = false;
let autosaveTimer = 0;
let toastTimer = 0;
let sprintTimer = 0;
let draggedBeatId = '';

function restoreDocument() {
  try {
    const restored = validateDocument(JSON.parse(localStorage.getItem(AUTOSAVE_KEY)));
    if (restored) return restored;
  } catch {}
  return createDocument('screenplay');
}

function restorePreferences() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}

function savePreferences() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}

function blockById(id) { return script.blocks.find((block) => block.id === id); }
function blockIndex(id) { return script.blocks.findIndex((block) => block.id === id); }
function blockElement(id) { return editor.querySelector(`[data-block-id="${CSS.escape(id)}"]`); }
function activeBlock() { return blockById(activeBlockId) || script.blocks[0]; }

function escapeHTML(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cloneScript() { return JSON.parse(JSON.stringify(script)); }

function caretRange(root) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return { start: root.textContent.length, end: root.textContent.length };
  const range = selection.getRangeAt(0);
  const beforeStart = range.cloneRange();
  beforeStart.selectNodeContents(root);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = range.cloneRange();
  beforeEnd.selectNodeContents(root);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
}

function setCaret(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node;
  while ((node = walker.nextNode())) {
    if (remaining <= node.data.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.data.length;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusBlock(id, offset = null, scroll = false) {
  const element = blockElement(id);
  if (!element) return;
  activeBlockId = id;
  element.focus({ preventScroll: !scroll });
  setCaret(element, offset == null ? element.textContent.length : offset);
  if (scroll) element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateFocusedBlock();
}

function snapshot() {
  const focused = document.activeElement?.closest?.('.block');
  return {
    script: cloneScript(),
    caret: focused ? { id: focused.dataset.blockId, offset: caretRange(focused).start } : null,
  };
}

function pushHistory(force = true) {
  if (sprintActive()) return;
  const now = Date.now();
  if (!force && now - lastHistoryAt < 900 && lastHistoryBlock === activeBlockId) return;
  history.push(snapshot());
  if (history.length > MAX_HISTORY) history.shift();
  future = [];
  lastHistoryAt = now;
  lastHistoryBlock = activeBlockId;
}

function applySnapshot(value) {
  script = validateDocument(value.script) || createDocument();
  titleInput.value = script.title;
  renderEditor();
  renderBoard();
  refreshDerived();
  markDirty();
  if (value.caret && blockById(value.caret.id)) focusBlock(value.caret.id, value.caret.offset, true);
}

function undo() {
  if (!history.length || sprintActive()) return;
  future.push(snapshot());
  applySnapshot(history.pop());
}

function redo() {
  if (!future.length || sprintActive()) return;
  history.push(snapshot());
  applySnapshot(future.pop());
}

function setSaveStatus(label, saving = false) {
  const status = $('#save-status');
  status.classList.toggle('saving', saving);
  $('span:last-child', status).textContent = label;
}

function markDirty() {
  dirty = true;
  setSaveStatus('Saving…', true);
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveAutosave, 320);
}

function saveAutosave() {
  script.savedAt = new Date().toISOString();
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(script));
    dirty = false;
    setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } catch {
    setSaveStatus('Autosave unavailable');
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('show');
  toastTimer = window.setTimeout(() => toastElement.classList.remove('show'), 2300);
}

function renderBlock(block) {
  const element = document.createElement('div');
  element.className = `block ${block.type}`;
  element.dataset.blockId = block.id;
  element.dataset.placeholder = script.mode === 'free' ? 'Write…' : ELEMENT_HINTS[block.type];
  element.dataset.typeLabel = ELEMENT_LABELS[block.type];
  element.contentEditable = 'true';
  element.spellcheck = !UPPERCASE_ELEMENTS.has(block.type);
  if (block.html) element.innerHTML = sanitizeInlineHTML(block.html);
  else element.textContent = block.text;
  return element;
}

function renderEditor() {
  editor.replaceChildren(...script.blocks.map(renderBlock));
  document.body.classList.toggle('free-mode', script.mode === 'free');
  $('#element-button').disabled = script.mode === 'free';
  applySprintLock();
  updateFocusedBlock();
}

function syncBlock(element) {
  const block = blockById(element.dataset.blockId);
  if (!block) return null;
  block.text = element.innerText.replace(/\r?\n$/, '');
  const safe = sanitizeInlineHTML(element.innerHTML);
  const plain = escapeHTML(block.text).replace(/\n/g, '<br>');
  block.html = safe && safe !== plain ? safe : undefined;
  const inferred = script.mode === 'free' ? 'general' : inferLiveType(block.text, block.type);
  if (inferred !== block.type) {
    block.type = inferred;
    syncBlockAppearance(element, block);
  }
  return block;
}

function syncBlockAppearance(element, block) {
  element.className = `block ${block.type}${block.id === activeBlockId ? ' focused' : ''}`;
  element.dataset.placeholder = script.mode === 'free' ? 'Write…' : ELEMENT_HINTS[block.type];
  element.dataset.typeLabel = ELEMENT_LABELS[block.type];
  element.spellcheck = !UPPERCASE_ELEMENTS.has(block.type);
  updateElementLabel(block);
}

function updateFocusedBlock() {
  $$('.block.focused', editor).forEach((element) => element.classList.remove('focused'));
  const block = activeBlock();
  const element = block && blockElement(block.id);
  if (element) element.classList.add('focused');
  if (block) updateElementLabel(block);
  updateActiveScene();
}

function setBlockType(block, type, restoreOffset = null) {
  if (!block || !ELEMENT_TYPES.includes(type) || script.mode === 'free') return;
  const element = blockElement(block.id);
  const offset = restoreOffset ?? (element ? caretRange(element).start : block.text.length);
  block.type = type;
  if (element) syncBlockAppearance(element, block);
  refreshDerived();
  markDirty();
  if (element) focusBlock(block.id, offset);
}

function updateElementLabel(block) {
  $('#element-label').textContent = ELEMENT_LABELS[block.type] || 'Element';
  $$('[data-type]', elementMenu).forEach((button) => button.classList.toggle('checked', button.dataset.type === block.type));
}

function handleEnter(element, block) {
  syncBlock(element);
  pushHistory();
  const range = caretRange(element);
  const index = blockIndex(block.id);
  if (!block.text && script.mode !== 'free') {
    block.type = EMPTY_ENTER_ELEMENT[block.type] || 'action';
    syncBlockAppearance(element, block);
    refreshDerived();
    markDirty();
    focusBlock(block.id, 0);
    return;
  }

  if (script.mode !== 'free') {
    block.type = inferCommittedType(block.text, block.type);
    syncBlockAppearance(element, block);
  }

  const before = block.text.slice(0, range.start);
  const after = block.text.slice(range.end);
  if (range.start === 0 && block.text) {
    const inserted = createBlock(block.type);
    script.blocks.splice(index, 0, inserted);
    editor.insertBefore(renderBlock(inserted), element);
    focusBlock(block.id, 0);
  } else if (range.start < block.text.length) {
    block.text = before;
    block.html = undefined;
    element.textContent = before;
    const inserted = createBlock(block.type, after);
    script.blocks.splice(index + 1, 0, inserted);
    element.after(renderBlock(inserted));
    focusBlock(inserted.id, 0);
  } else {
    const nextType = script.mode === 'free' ? 'general' : (NEXT_ELEMENT[block.type] || 'action');
    const inserted = createBlock(nextType);
    script.blocks.splice(index + 1, 0, inserted);
    element.after(renderBlock(inserted));
    focusBlock(inserted.id, 0);
  }
  afterStructureChange();
}

function mergeBackward(element, block) {
  const index = blockIndex(block.id);
  if (index <= 0 || sprintActive()) return;
  pushHistory();
  const previous = script.blocks[index - 1];
  const joinAt = previous.text.length;
  previous.text += block.text;
  previous.html = undefined;
  script.blocks.splice(index, 1);
  renderEditor();
  focusBlock(previous.id, joinAt);
  afterStructureChange();
}

function mergeForward(block) {
  const index = blockIndex(block.id);
  if (index < 0 || index >= script.blocks.length - 1 || sprintActive()) return;
  pushHistory();
  const next = script.blocks[index + 1];
  const joinAt = block.text.length;
  if (!block.text) block.type = next.type;
  block.text += next.text;
  block.html = undefined;
  script.blocks.splice(index + 1, 1);
  renderEditor();
  focusBlock(block.id, joinAt);
  afterStructureChange();
}

function pasteMultiline(event, element, block) {
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!text.includes('\n')) return false;
  event.preventDefault();
  pushHistory();
  const range = caretRange(element);
  const parsed = script.mode === 'free'
    ? text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim()).map((line) => createBlock('general', line.trim()))
    : parsePlainScript(text);
  const index = blockIndex(block.id);
  const before = block.text.slice(0, range.start);
  const after = block.text.slice(range.end);
  const replacement = parsed.map((entry) => ({ ...entry }));
  replacement[0].text = before + replacement[0].text;
  replacement.at(-1).text += after;
  script.blocks.splice(index, 1, ...replacement);
  renderEditor();
  focusBlock(replacement.at(-1).id, replacement.at(-1).text.length - after.length);
  afterStructureChange();
  return true;
}

function afterStructureChange() {
  if (!script.blocks.length) script.blocks.push(createBlock(script.mode === 'free' ? 'general' : 'scene'));
  applySprintLock();
  refreshDerived();
  markDirty();
}

editor.addEventListener('focusin', (event) => {
  const element = event.target.closest('.block');
  if (!element) return;
  if (sprintActive() && element !== editor.lastElementChild) {
    event.preventDefault();
    focusBlock(script.blocks.at(-1).id, script.blocks.at(-1).text.length, true);
    return;
  }
  activeBlockId = element.dataset.blockId;
  updateFocusedBlock();
  updateCharacterSuggestions(element);
});

editor.addEventListener('beforeinput', (event) => {
  const element = event.target.closest('.block');
  if (!element || event.inputType.startsWith('format')) return;
  pushHistory(false);
});

editor.addEventListener('input', (event) => {
  const element = event.target.closest('.block');
  if (!element) return;
  const block = syncBlock(element);
  refreshDerivedSoon();
  updateCharacterSuggestions(element, block);
  markDirty();
});

editor.addEventListener('paste', (event) => {
  const element = event.target.closest('.block');
  const block = element && blockById(element.dataset.blockId);
  if (!element || !block) return;
  if (pasteMultiline(event, element, block)) return;
  event.preventDefault();
  pushHistory();
  document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
});

editor.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const element = event.target.closest('.block');
  const block = element && blockById(element.dataset.blockId);
  if (!element || !block) return;
  if ((event.metaKey || event.ctrlKey) && /^Digit[1-8]$/.test(event.code) && script.mode !== 'free') {
    event.preventDefault();
    pushHistory();
    setBlockType(block, ELEMENT_TYPES[Number(event.code.slice(5)) - 1]);
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    if (script.mode === 'free') return;
    pushHistory();
    setBlockType(block, cycleElement(block.type, event.shiftKey ? -1 : 1));
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleEnter(element, block);
    return;
  }
  const range = caretRange(element);
  if (event.key === 'Backspace' && range.start === 0 && range.end === 0) {
    event.preventDefault();
    mergeBackward(element, block);
  } else if (event.key === 'Delete' && range.start === range.end && range.start === block.text.length) {
    event.preventDefault();
    mergeForward(block);
  }
});

function buildElementMenu() {
  const label = document.createElement('div');
  label.className = 'menu-label';
  label.textContent = 'Element · Tab cycles';
  elementMenu.append(label);
  ELEMENT_TYPES.forEach((type, index) => {
    const button = document.createElement('button');
    button.dataset.type = type;
    button.setAttribute('role', 'menuitem');
    button.innerHTML = `<span>${ELEMENT_LABELS[type]}</span><kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl '}${index + 1}</kbd>`;
    elementMenu.append(button);
  });
}

function toggleMenu(menu) {
  const shouldOpen = !menu.classList.contains('open');
  closeMenus();
  menu.classList.toggle('open', shouldOpen);
}

function closeMenus() {
  $$('.menu.open').forEach((menu) => menu.classList.remove('open'));
  $('#sprint-menu').classList.remove('open');
  suggestions.classList.remove('open');
  $('#element-button').setAttribute('aria-expanded', 'false');
}

$('#element-button').addEventListener('click', (event) => {
  event.stopPropagation();
  toggleMenu(elementMenu);
  event.currentTarget.setAttribute('aria-expanded', String(elementMenu.classList.contains('open')));
});
elementMenu.addEventListener('mousedown', (event) => event.preventDefault());
elementMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-type]');
  if (!button) return;
  pushHistory();
  setBlockType(activeBlock(), button.dataset.type);
  closeMenus();
});

$('#more-button').addEventListener('click', (event) => { event.stopPropagation(); toggleMenu(documentMenu); });
document.addEventListener('click', (event) => { if (!event.target.closest('.menu') && !event.target.closest('.menu-anchor')) closeMenus(); });

$$('.format-button').forEach((button) => button.addEventListener('mousedown', (event) => event.preventDefault()));
$$('.format-button').forEach((button) => button.addEventListener('click', () => {
  const block = activeBlock();
  const element = block && blockElement(block.id);
  if (!element) return;
  pushHistory();
  element.focus();
  document.execCommand(button.dataset.command);
  syncBlock(element);
  markDirty();
}));

function characterNames() {
  return [...new Set(script.blocks.filter((block) => block.type === 'character').map((block) => block.text.trim().replace(/\s*\([^)]*\)$/, '')).filter(Boolean))];
}

function updateCharacterSuggestions(element, block = blockById(element.dataset.blockId)) {
  if (!block || block.type !== 'character' || !block.text.trim()) {
    suggestions.classList.remove('open');
    return;
  }
  const query = block.text.trim().toUpperCase();
  const matches = characterNames().filter((name) => name.startsWith(query) && name !== query).slice(0, 6);
  if (!matches.length) {
    suggestions.classList.remove('open');
    return;
  }
  suggestions.replaceChildren(...matches.map((name) => {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      pushHistory();
      block.text = name;
      block.html = undefined;
      element.textContent = name;
      suggestions.classList.remove('open');
      focusBlock(block.id, name.length);
      markDirty();
    });
    return button;
  }));
  const rect = element.getBoundingClientRect();
  suggestions.style.left = `${Math.min(rect.left, innerWidth - 190)}px`;
  suggestions.style.top = `${Math.min(rect.bottom + 5, innerHeight - 210)}px`;
  suggestions.classList.add('open');
}

let derivedTimer = 0;
function refreshDerivedSoon() {
  clearTimeout(derivedTimer);
  derivedTimer = window.setTimeout(refreshDerived, 120);
}

function refreshDerived() {
  updateSceneNavigator();
  updateStats();
  document.title = `${script.title || 'Untitled'} — Ludere`;
}

function updateSceneNavigator() {
  const scenes = script.blocks.filter((block) => block.type === 'scene');
  $('#scene-count').textContent = String(scenes.length);
  if (!scenes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-scenes';
    empty.textContent = 'Scene headings will appear here.';
    sceneList.replaceChildren(empty);
    return;
  }
  sceneList.replaceChildren(...scenes.map((scene, index) => {
    const button = document.createElement('button');
    button.className = 'scene-item';
    button.dataset.sceneId = scene.id;
    button.innerHTML = `<span class="scene-number">${String(index + 1).padStart(2, '0')}</span><span class="scene-name"></span>`;
    $('.scene-name', button).textContent = scene.text || 'Untitled scene';
    button.addEventListener('click', () => focusBlock(scene.id, scene.text.length, true));
    return button;
  }));
  updateActiveScene();
}

function updateActiveScene() {
  const index = blockIndex(activeBlockId);
  let sceneId = '';
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (script.blocks[cursor]?.type === 'scene') { sceneId = script.blocks[cursor].id; break; }
  }
  $$('.scene-item', sceneList).forEach((item) => item.classList.toggle('active', item.dataset.sceneId === sceneId));
}

function updateStats() {
  const pages = estimatePages(script);
  if (script.mode === 'free') {
    const words = script.blocks.reduce((count, block) => count + (block.text.trim() ? block.text.trim().split(/\s+/).length : 0), 0);
    $('#document-stats').textContent = `${words} word${words === 1 ? '' : 's'} · ~${pages} page${pages === 1 ? '' : 's'}`;
  } else {
    const scenes = script.blocks.filter((block) => block.type === 'scene').length;
    $('#document-stats').textContent = `${scenes} scene${scenes === 1 ? '' : 's'} · ~${pages} page${pages === 1 ? '' : 's'}`;
  }
}

titleInput.addEventListener('input', () => {
  script.title = titleInput.value;
  refreshDerivedSoon();
  markDirty();
});
titleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); const first = script.blocks[0]; if (first) focusBlock(first.id, first.text.length, true); }
});

$('#rail-toggle').addEventListener('click', () => {
  preferences.railCollapsed = !document.body.classList.contains('rail-collapsed');
  document.body.classList.toggle('rail-collapsed', preferences.railCollapsed);
  savePreferences();
  syncControlLabels();
});

$('#theme-button').addEventListener('click', () => {
  preferences.dark = !preferences.dark;
  savePreferences();
  applyPreferences();
});

function switchView(view) {
  const board = view === 'board';
  $('#script-view').hidden = board;
  $('#board-view').hidden = !board;
  $('.scene-rail').hidden = board;
  $('.workspace').classList.toggle('write-view', !board);
  $$('.view-tab').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  preferences.view = view;
  savePreferences();
  if (board) renderBoard();
}
$$('.view-tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));

function renderBoard() {
  const acts = $('#acts');
  acts.replaceChildren(...[1, 2, 3].map((number) => {
    const act = document.createElement('section');
    act.className = 'act';
    act.dataset.act = String(number);
    const beats = script.board.filter((beat) => beat.act === number);
    act.innerHTML = `<div class="act-heading"><strong>Act ${['I', 'II', 'III'][number - 1]}</strong><span>${beats.length} beat${beats.length === 1 ? '' : 's'}</span></div><div class="beat-list"></div>`;
    const list = $('.beat-list', act);
    list.replaceChildren(...beats.map(renderBeat));
    act.addEventListener('dragover', (event) => { event.preventDefault(); act.classList.add('drag-over'); });
    act.addEventListener('dragleave', () => act.classList.remove('drag-over'));
    act.addEventListener('drop', (event) => {
      event.preventDefault();
      act.classList.remove('drag-over');
      const beat = script.board.find((entry) => entry.id === draggedBeatId);
      if (!beat) return;
      beat.act = number;
      draggedBeatId = '';
      renderBoard();
      markDirty();
    });
    return act;
  }));
}

function renderBeat(beat) {
  const card = document.createElement('article');
  card.className = 'beat';
  card.dataset.beatId = beat.id;
  card.dataset.color = beat.color;
  card.draggable = true;
  card.innerHTML = '<input class="beat-title" maxlength="120" placeholder="Beat title"><textarea class="beat-text" maxlength="4000" placeholder="What changes here?"></textarea><div class="beat-tools"><button data-beat-action="color" title="Change colour">●</button><button data-beat-action="delete" title="Delete beat">×</button></div>';
  $('.beat-title', card).value = beat.title;
  $('.beat-text', card).value = beat.text;
  $('.beat-title', card).addEventListener('input', (event) => { beat.title = event.target.value; markDirty(); });
  $('.beat-text', card).addEventListener('input', (event) => { beat.text = event.target.value; markDirty(); });
  card.addEventListener('dragstart', () => { draggedBeatId = beat.id; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => { draggedBeatId = ''; card.classList.remove('dragging'); });
  card.addEventListener('click', (event) => {
    const action = event.target.closest('[data-beat-action]')?.dataset.beatAction;
    if (action === 'delete') {
      script.board = script.board.filter((entry) => entry.id !== beat.id);
      renderBoard();
      markDirty();
    } else if (action === 'color') {
      beat.color = BEAT_COLORS[(BEAT_COLORS.indexOf(beat.color) + 1) % BEAT_COLORS.length];
      card.dataset.color = beat.color;
      markDirty();
    }
  });
  return card;
}

$('#add-beat-button').addEventListener('click', () => {
  const counts = [1, 2, 3].map((act) => script.board.filter((beat) => beat.act === act).length);
  const target = counts.indexOf(Math.min(...counts)) + 1;
  const beat = createBeat(target);
  script.board.push(beat);
  renderBoard();
  $(`[data-beat-id="${CSS.escape(beat.id)}"] .beat-title`)?.focus();
  markDirty();
});

$('#import-scenes-button').addEventListener('click', () => {
  const beats = importScenesToBoard(script);
  if (!beats.length) return toast('Every current scene is already on the board.');
  renderBoard();
  markDirty();
  toast(`${beats.length} scene${beats.length === 1 ? '' : 's'} added to the board.`);
});

function sprintActive() { return Number(preferences.sprintUntil || 0) > Date.now(); }

function startSprint(minutes) {
  preferences.sprintUntil = Date.now() + minutes * 60_000;
  savePreferences();
  closeMenus();
  history = [];
  future = [];
  applySprintLock();
  tickSprint();
  clearInterval(sprintTimer);
  sprintTimer = window.setInterval(tickSprint, 250);
  const last = script.blocks.at(-1);
  if (last) focusBlock(last.id, last.text.length, true);
  toast('Focus sprint started. Keep moving forward.');
}

function endSprint(showMessage = true) {
  preferences.sprintUntil = 0;
  savePreferences();
  clearInterval(sprintTimer);
  document.body.classList.remove('focus-mode');
  $('#sprint-button').classList.remove('active');
  $('#sprint-button').dataset.label = 'Focus sprint';
  $('#sprint-label').textContent = 'Focus';
  $$('.block', editor).forEach((block) => { block.contentEditable = 'true'; block.classList.remove('locked'); });
  if (showMessage) toast('Focus sprint complete. The draft is unlocked.');
}

function tickSprint() {
  const remaining = Number(preferences.sprintUntil || 0) - Date.now();
  if (remaining <= 0) return endSprint(true);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  $('#sprint-label').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function applySprintLock() {
  const active = sprintActive();
  document.body.classList.toggle('focus-mode', active);
  $('#sprint-button').classList.toggle('active', active);
  $('#sprint-button').dataset.label = active ? 'End focus sprint' : 'Focus sprint';
  $$('.block', editor).forEach((element, index, all) => {
    const locked = active && index !== all.length - 1;
    element.contentEditable = locked ? 'false' : 'true';
    element.classList.toggle('locked', locked);
  });
}

$('#sprint-button').addEventListener('click', (event) => {
  event.stopPropagation();
  if (sprintActive()) {
    if (confirm('End the focus sprint early and unlock the draft?')) endSprint(false);
    return;
  }
  const menu = $('#sprint-menu');
  const open = !menu.classList.contains('open');
  closeMenus();
  menu.classList.toggle('open', open);
});
$('#sprint-menu').addEventListener('click', (event) => {
  const minutes = Number(event.target.closest('[data-minutes]')?.dataset.minutes);
  if (minutes) startSprint(minutes);
});

function download(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug() { return (script.title || 'untitled').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'; }

function savePortable() {
  if (dirty) saveAutosave();
  download(`${slug()}.ludere`, 'application/json;charset=utf-8', `${JSON.stringify(script, null, 2)}\n`);
  toast('Portable Ludere file saved.');
}

function openPortable() { fileInput.click(); }
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const source = await file.text();
    let opened;
    if (file.name.toLowerCase().endsWith('.fdx')) {
      opened = createDocument();
      opened.title = file.name.replace(/\.fdx$/i, '');
      opened.blocks = importFinalDraft(source);
    } else {
      opened = validateDocument(JSON.parse(source));
      if (!opened) throw new Error('The file does not contain a valid Ludere document.');
    }
    pushHistory();
    script = opened;
    activeBlockId = script.blocks[0].id;
    titleInput.value = script.title;
    renderEditor();
    renderBoard();
    refreshDerived();
    markDirty();
    switchView('write');
    focusBlock(activeBlockId, 0, true);
    toast(`Opened ${file.name}`);
  } catch (error) {
    toast(error.message || 'That file could not be opened.');
  }
});

function buildPrintRoot() {
  const printRoot = $('#print-root');
  const pages = [];
  let current = [];
  let lines = 0;
  const widths = { scene: 61, action: 61, general: 61, shot: 61, transition: 61, character: 33, dialogue: 35, parenthetical: 28 };
  for (const block of script.blocks) {
    const blockLines = Math.max(1, Math.ceil((block.text.length || 1) / (widths[block.type] || 61))) + 1 + (block.type === 'scene' ? 1 : 0);
    if (current.length && lines + blockLines > 54) { pages.push(current); current = []; lines = 0; }
    current.push(block);
    lines += blockLines;
  }
  if (current.length) pages.push(current);
  const fragments = [];
  if (script.titlePage.enabled) {
    const page = document.createElement('section');
    page.className = 'print-page title-page';
    page.innerHTML = `<div class="title-page-main"><h1></h1><p>Written by</p><p class="author"></p><p class="source"></p></div><div></div><div class="title-page-bottom"><div class="contact"></div><div class="draft"></div></div>`;
    $('h1', page).textContent = script.title || 'Untitled';
    $('.author', page).textContent = script.titlePage.author;
    $('.source', page).textContent = script.titlePage.source;
    $('.contact', page).textContent = script.titlePage.contact;
    $('.draft', page).textContent = script.titlePage.draft;
    fragments.push(page);
  }
  pages.forEach((blocks) => {
    const page = document.createElement('section');
    page.className = 'print-page';
    blocks.forEach((block) => {
      const line = document.createElement('div');
      line.className = `print-block ${block.type}`;
      if (block.html) line.innerHTML = sanitizeInlineHTML(block.html);
      else line.textContent = block.text;
      page.append(line);
    });
    fragments.push(page);
  });
  printRoot.replaceChildren(...fragments);
}

function openTitlePage() {
  $('#title-enabled').checked = script.titlePage.enabled;
  $('#title-author').value = script.titlePage.author;
  $('#title-source').value = script.titlePage.source;
  $('#title-contact').value = script.titlePage.contact;
  $('#title-draft').value = script.titlePage.draft;
  $('#title-dialog').showModal();
}
$('#title-dialog').addEventListener('close', () => {
  script.titlePage = {
    enabled: $('#title-enabled').checked,
    author: $('#title-author').value,
    source: $('#title-source').value,
    contact: $('#title-contact').value,
    draft: $('#title-draft').value,
  };
  markDirty();
});

async function confirmAction(title, message) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}

async function newDocument() {
  if (await confirmAction('Start a new document?', 'The current draft remains in autosave until the new page is created. Save a .ludere file first if you want a portable archive.')) $('#mode-dialog').showModal();
}
$$('[data-mode]', $('#mode-dialog')).forEach((button) => button.addEventListener('click', () => {
  pushHistory();
  script = createDocument(button.dataset.mode);
  activeBlockId = script.blocks[0].id;
  titleInput.value = '';
  $('#mode-dialog').close();
  renderEditor();
  renderBoard();
  refreshDerived();
  switchView('write');
  markDirty();
  focusBlock(activeBlockId, 0, true);
}));

async function performAction(action) {
  closeMenus();
  if (action === 'new') await newDocument();
  else if (action === 'open') openPortable();
  else if (action === 'save') savePortable();
  else if (action === 'title-page') openTitlePage();
  else if (action === 'fdx') download(`${slug()}.fdx`, 'application/xml;charset=utf-8', exportFinalDraft(script));
  else if (action === 'text') download(`${slug()}.txt`, 'text/plain;charset=utf-8', exportPlainText(script));
  else if (action === 'html') download(`${slug()}.html`, 'text/html;charset=utf-8', exportPrintableHTML(script));
  else if (action === 'print') { buildPrintRoot(); window.print(); }
  else if (action === 'help') $('#help-dialog').showModal();
}
documentMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) performAction(action);
});

document.addEventListener('keydown', (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.code === 'KeyS') { event.preventDefault(); savePortable(); }
  else if (modifier && event.code === 'KeyN') { event.preventDefault(); newDocument(); }
  else if (modifier && event.code === 'KeyP') { event.preventDefault(); buildPrintRoot(); window.print(); }
  else if (modifier && event.code === 'KeyZ' && !event.altKey) { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if (modifier && event.code === 'KeyY' && !event.altKey) { event.preventDefault(); redo(); }
  else if (event.key === '?' && !event.target.closest('input,textarea,[contenteditable]')) $('#help-dialog').showModal();
  else if (event.key === 'Escape') closeMenus();
});

window.addEventListener('beforeunload', () => { if (dirty) saveAutosave(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveAutosave(); });

function applyPreferences() {
  const dark = Boolean(preferences.dark);
  document.documentElement.classList.toggle('dark', dark);
  document.body.classList.toggle('rail-collapsed', Boolean(preferences.railCollapsed));
  const themeButton = $('#theme-button');
  themeButton.dataset.label = dark ? 'Light mode' : 'Dark mode';
  themeButton.setAttribute('aria-label', dark ? 'Use light mode' : 'Use dark mode');
  themeButton.setAttribute('aria-pressed', String(dark));
  syncControlLabels();
}

function syncControlLabels() {
  const collapsed = document.body.classList.contains('rail-collapsed');
  const railButton = $('#rail-toggle');
  railButton.dataset.label = collapsed ? 'Show scenes' : 'Hide scenes';
  railButton.setAttribute('aria-label', collapsed ? 'Show scene navigator' : 'Hide scene navigator');
  railButton.setAttribute('aria-pressed', String(!collapsed));
}

function init() {
  buildElementMenu();
  applyPreferences();
  titleInput.value = script.title;
  renderEditor();
  renderBoard();
  refreshDerived();
  switchView(preferences.view === 'board' ? 'board' : 'write');
  if (sprintActive()) {
    tickSprint();
    sprintTimer = window.setInterval(tickSprint, 250);
  } else if (preferences.sprintUntil) endSprint(false);
  setSaveStatus(localStorage.getItem(AUTOSAVE_KEY) ? 'Recovered autosave' : 'Ready');
  if (!localStorage.getItem(AUTOSAVE_KEY)) window.setTimeout(() => $('#mode-dialog').showModal(), 180);
  else if (script.blocks[0]) focusBlock(script.blocks[0].id, script.blocks[0].text.length);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

init();

window.__ludere = {
  get script() { return script; },
  createDocument,
  parsePlainScript,
  exportFinalDraft: () => exportFinalDraft(script),
  exportPlainText: () => exportPlainText(script),
  setScript(value) { const valid = validateDocument(value); if (valid) { script = valid; renderEditor(); renderBoard(); refreshDerived(); } },
};
