export const DOCUMENT_VERSION = 1;

export const ELEMENT_TYPES = [
  'scene',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'shot',
  'general',
];

export const ELEMENT_LABELS = {
  scene: 'Scene heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General text',
};

export const ELEMENT_HINTS = {
  scene: 'INT. LOCATION — DAY',
  action: 'What happens?',
  character: 'CHARACTER',
  dialogue: 'What do they say?',
  parenthetical: '(quietly)',
  transition: 'CUT TO:',
  shot: 'CLOSE ON —',
  general: 'Write…',
};

export const NEXT_ELEMENT = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  dialogue: 'dialogue',
  parenthetical: 'dialogue',
  transition: 'scene',
  shot: 'action',
  general: 'general',
};

export const EMPTY_ENTER_ELEMENT = {
  scene: 'action',
  action: 'character',
  character: 'action',
  dialogue: 'action',
  parenthetical: 'dialogue',
  transition: 'scene',
  shot: 'action',
  general: 'action',
};

export const UPPERCASE_ELEMENTS = new Set(['scene', 'character', 'transition', 'shot']);
export const BEAT_COLORS = ['plum', 'sage', 'brass', 'clay'];

const SCENE_PATTERN = /^(INT\.|EXT\.|EST\.|INT\.?\/EXT\.|I\/E\.)/i;
const TRANSITION_PATTERN = /^(FADE IN|FADE OUT|FADE TO BLACK|CUT TO BLACK|SMASH CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|WIPE TO|CUT TO)\s*[:.]?$/i;
const VALID_INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR']);

export function makeId(prefix = 'block') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createBlock(type = 'action', text = '', html = undefined) {
  return { id: makeId(), type: ELEMENT_TYPES.includes(type) ? type : 'action', text, ...(html ? { html } : {}) };
}

export function createBeat(act = 1, title = '', text = '', color = undefined) {
  const resolvedAct = [1, 2, 3].includes(Number(act)) ? Number(act) : 1;
  return {
    id: makeId('beat'),
    act: resolvedAct,
    title: String(title).slice(0, 120),
    text: String(text).slice(0, 4000),
    color: BEAT_COLORS.includes(color) ? color : BEAT_COLORS[Math.max(0, resolvedAct - 1)],
  };
}

export function createDocument(mode = 'screenplay') {
  const resolvedMode = mode === 'free' ? 'free' : 'screenplay';
  return {
    app: 'ludere',
    version: DOCUMENT_VERSION,
    title: '',
    mode: resolvedMode,
    titlePage: { enabled: false, author: '', source: '', contact: '', draft: '' },
    blocks: [createBlock(resolvedMode === 'free' ? 'general' : 'scene')],
    board: [],
    savedAt: new Date().toISOString(),
  };
}

export function isSceneHeading(text) {
  return SCENE_PATTERN.test(String(text).trim());
}

export function isTransition(text) {
  const value = String(text).trim();
  if (!value) return false;
  return TRANSITION_PATTERN.test(value)
    || (value === value.toUpperCase() && /[A-Z]/.test(value) && /\bTO:$/.test(value) && value.length <= 34);
}

export function isCharacterCue(text) {
  const value = String(text).trim();
  if (!value || value.length > 32 || value !== value.toUpperCase() || !/[A-Z]/.test(value)) return false;
  if (isSceneHeading(value) || isTransition(value) || /[.!?]$/.test(value)) return false;
  return /^[A-Z][A-Z0-9 .'#\-]*(\([^()]+\))?$/.test(value);
}

export function inferLiveType(text, currentType) {
  const value = String(text).trim();
  if (currentType === 'dialogue' && /^\(/.test(value)) return 'parenthetical';
  if (['action', 'general', 'dialogue'].includes(currentType)) {
    if (isSceneHeading(value)) return 'scene';
    if (TRANSITION_PATTERN.test(value)) return 'transition';
  }
  return currentType;
}

export function inferCommittedType(text, currentType) {
  const value = String(text).trim();
  if (!value) return currentType;
  if (['action', 'general', 'dialogue'].includes(currentType) && isTransition(value)) return 'transition';
  if (['action', 'general'].includes(currentType) && isCharacterCue(value)) return 'character';
  return inferLiveType(value, currentType);
}

export function cycleElement(type, direction = 1) {
  const index = Math.max(0, ELEMENT_TYPES.indexOf(type));
  return ELEMENT_TYPES[(index + direction + ELEMENT_TYPES.length) % ELEMENT_TYPES.length];
}

export function parsePlainScript(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let previousBlank = true;
  const previousType = () => blocks.at(-1)?.type;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      previousBlank = true;
      continue;
    }

    let type = 'action';
    let text = line;
    if (/^\.[^.]/.test(line)) {
      type = 'scene';
      text = line.slice(1).trim();
    } else if (/^>\s*/.test(line) && !line.includes('<')) {
      type = 'transition';
      text = line.replace(/^>\s*/, '');
    } else if (isSceneHeading(line)) {
      type = 'scene';
    } else if (isTransition(line)) {
      type = 'transition';
    } else if (/^\(/.test(line) && !previousBlank && ['character', 'dialogue', 'parenthetical'].includes(previousType())) {
      type = 'parenthetical';
    } else if (
      isCharacterCue(line)
      && lines[index + 1]?.trim()
      && !isCharacterCue(lines[index + 1].trim())
      && !['character', 'parenthetical'].includes(previousType())
    ) {
      type = 'character';
    } else if (!previousBlank && ['character', 'parenthetical', 'dialogue'].includes(previousType())) {
      type = 'dialogue';
    }
    blocks.push(createBlock(type, text));
    previousBlank = false;
  }

  return blocks.length ? blocks : [createBlock('action')];
}

export function stripInlineHTML(html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

export function sanitizeInlineHTML(html = '') {
  if (typeof DOMParser === 'undefined') {
    return String(html)
      .replace(/<(?!\/?(?:b|strong|i|em|u|br)\b)[^>]*>/gi, '')
      .replace(/<(b|strong|i|em|u)\b[^>]*>/gi, '<$1>');
  }
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) child.remove();
      else if (child.nodeType === Node.ELEMENT_NODE) {
        if (!VALID_INLINE_TAGS.has(child.tagName)) {
          clean(child);
          child.replaceWith(...child.childNodes);
        }
        else {
          for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
          clean(child);
        }
      }
    }
  };
  clean(root);
  return root.innerHTML;
}

export function validateDocument(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.blocks)) return null;
  if (value.app != null && value.app !== 'ludere') return null;
  if (value.version != null && Number(value.version) !== DOCUMENT_VERSION) return null;
  const blockIds = new Set();
  const blocks = value.blocks
    .filter((block) => block && typeof block.text === 'string')
    .map((block) => {
      let id = typeof block.id === 'string' && block.id ? block.id.slice(0, 200) : makeId();
      if (blockIds.has(id)) id = makeId();
      blockIds.add(id);
      const text = block.text.slice(0, 100_000);
      const html = typeof block.html === 'string' && block.html
        ? sanitizeInlineHTML(block.html).slice(0, 300_000)
        : '';
      return {
        id,
        type: ELEMENT_TYPES.includes(block.type) ? block.type : 'action',
        text,
        ...(html && stripInlineHTML(html) === text ? { html } : {}),
      };
    });
  if (!blocks.length) blocks.push(createBlock(value.mode === 'free' ? 'general' : 'scene'));
  const titlePage = value.titlePage && typeof value.titlePage === 'object' ? value.titlePage : {};
  const beatIds = new Set();
  const board = Array.isArray(value.board)
    ? value.board.filter((beat) => beat && typeof beat.text === 'string').map((beat) => {
        let id = typeof beat.id === 'string' && beat.id ? beat.id.slice(0, 200) : makeId('beat');
        if (beatIds.has(id)) id = makeId('beat');
        beatIds.add(id);
        const act = [1, 2, 3].includes(Number(beat.act)) ? Number(beat.act) : 1;
        return {
          id,
          act,
          title: typeof beat.title === 'string' ? beat.title.slice(0, 120) : '',
          text: beat.text.slice(0, 4000),
          color: BEAT_COLORS.includes(beat.color) ? beat.color : BEAT_COLORS[act - 1],
        };
      })
    : [];
  return {
    app: 'ludere',
    version: DOCUMENT_VERSION,
    title: typeof value.title === 'string' ? value.title.slice(0, 120) : '',
    mode: value.mode === 'free' ? 'free' : 'screenplay',
    titlePage: {
      enabled: Boolean(titlePage.enabled),
      author: String(titlePage.author || '').slice(0, 120),
      source: String(titlePage.source || '').slice(0, 180),
      contact: String(titlePage.contact || '').slice(0, 500),
      draft: String(titlePage.draft || '').slice(0, 120),
    },
    blocks,
    board,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString(),
  };
}

export function importScenesToBoard(document) {
  const existing = new Set(document.board.map((beat) => beat.title.trim().toUpperCase()));
  const scenes = document.blocks.filter((block) => (
    block.type === 'scene'
    && block.text.trim()
    && !existing.has(block.text.trim().toUpperCase())
  ));
  const perAct = Math.max(1, Math.ceil(scenes.length / 3));
  const beats = scenes.map((scene, index) => createBeat(
    Math.min(3, Math.floor(index / perAct) + 1),
    scene.text.trim(),
  ));
  document.board.push(...beats);
  return beats;
}

export function documentStats(document) {
  const blockTypes = Object.fromEntries(ELEMENT_TYPES.map((type) => [type, 0]));
  const characters = new Set();
  let words = 0;
  for (const block of document.blocks) {
    blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
    if (block.type === 'character') {
      const name = block.text.trim().replace(/\s*\([^)]*\)$/, '');
      if (name) characters.add(name);
    }
    if (block.text.trim()) words += block.text.trim().split(/\s+/).length;
  }
  return {
    blocks: document.blocks.length,
    scenes: blockTypes.scene || 0,
    beats: document.board.length,
    words,
    estimatedPages: estimatePages(document),
    blockTypes,
    characters: [...characters].sort((left, right) => left.localeCompare(right)),
    beatsByAct: Object.fromEntries([1, 2, 3].map((act) => [act, document.board.filter((beat) => beat.act === act).length])),
  };
}

function escapeXML(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escapeHTML(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayText(block) {
  return UPPERCASE_ELEMENTS.has(block.type) ? block.text.toUpperCase() : block.text;
}

export function exportFinalDraft(document) {
  const typeNames = {
    scene: 'Scene Heading', action: 'Action', character: 'Character', dialogue: 'Dialogue',
    parenthetical: 'Parenthetical', transition: 'Transition', shot: 'Shot', general: 'General',
  };
  const paragraphs = document.blocks.map((block) => {
    const texts = inlineSegments(block).map((segment) => {
      const style = [segment.bold && 'Bold', segment.italic && 'Italic', segment.underline && 'Underline'].filter(Boolean).join('+');
      const value = UPPERCASE_ELEMENTS.has(block.type) ? segment.text.toUpperCase() : segment.text;
      return `<Text${style ? ` Style="${style}"` : ''}>${escapeXML(value)}</Text>`;
    }).join('');
    return `    <Paragraph Type="${typeNames[block.type] || 'Action'}">${texts || '<Text></Text>'}</Paragraph>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<FinalDraft DocumentType="Script" Template="No" Version="1">\n  <Content>\n${paragraphs}\n  </Content>\n  <TitlePage><Content><Paragraph Type="Title"><Text>${escapeXML(document.title || 'Untitled')}</Text></Paragraph></Content></TitlePage>\n</FinalDraft>\n`;
}

export function importFinalDraft(source) {
  if (typeof DOMParser === 'undefined') {
    const content = String(source).match(/<Content\b[^>]*>([\s\S]*?)<\/Content>/i)?.[1] || String(source);
    const blocks = [...content.matchAll(/<Paragraph\b[^>]*Type="([^"]+)"[^>]*>([\s\S]*?)<\/Paragraph>/gi)]
      .map((match) => ({ typeName: match[1], segments: parseFinalDraftTextXML(match[2]) }));
    return finalDraftBlocks(blocks);
  }
  const xml = new DOMParser().parseFromString(String(source), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('That Final Draft file is not valid XML.');
  const content = [...xml.documentElement.children].find((element) => element.localName === 'Content');
  return finalDraftBlocks([...(content?.children || [])].filter((element) => element.localName === 'Paragraph').map((paragraph) => ({
    typeName: paragraph.getAttribute('Type') || 'Action',
    segments: [...paragraph.querySelectorAll('Text')].map((node) => ({
      text: node.textContent || '',
      style: node.getAttribute('Style') || '',
    })),
  })));
}

function finalDraftBlocks(items) {
  const map = {
    'scene heading': 'scene', action: 'action', character: 'character', dialogue: 'dialogue',
    parenthetical: 'parenthetical', transition: 'transition', shot: 'shot', general: 'general',
  };
  const blocks = items.map((item) => {
    const segments = item.segments || [{ text: item.text || '', style: '' }];
    const text = segments.map((segment) => segment.text).join('');
    const html = segments.map((segment) => {
      const styles = String(segment.style).toLowerCase().split('+');
      let value = escapeHTML(segment.text);
      if (styles.includes('underline')) value = `<u>${value}</u>`;
      if (styles.includes('italic')) value = `<i>${value}</i>`;
      if (styles.includes('bold')) value = `<b>${value}</b>`;
      return value;
    }).join('');
    return createBlock(map[item.typeName.toLowerCase()] || 'general', text, html !== escapeHTML(text) ? html : undefined);
  });
  return blocks.length ? blocks : [createBlock('scene')];
}

function parseFinalDraftTextXML(paragraphXML) {
  return [...String(paragraphXML).matchAll(/<Text\b([^>]*)>([\s\S]*?)<\/Text>/gi)].map((match) => ({
    text: stripInlineHTML(match[2]),
    style: match[1].match(/\bStyle="([^"]*)"/i)?.[1] || '',
  }));
}

function inlineSegments(block) {
  if (!block.html) return [{ text: block.text, bold: false, italic: false, underline: false }];
  const tokens = sanitizeInlineHTML(block.html).match(/<\/?(?:b|strong|i|em|u|br)\s*\/?>|[^<]+/gi) || [];
  const state = { bold: 0, italic: 0, underline: 0 };
  const segments = [];
  const keyFor = (tag) => tag === 'b' || tag === 'strong' ? 'bold' : tag === 'i' || tag === 'em' ? 'italic' : 'underline';
  const append = (text) => {
    if (!text) return;
    const style = { bold: state.bold > 0, italic: state.italic > 0, underline: state.underline > 0 };
    const previous = segments.at(-1);
    if (previous && previous.bold === style.bold && previous.italic === style.italic && previous.underline === style.underline) previous.text += text;
    else segments.push({ text, ...style });
  };
  for (const token of tokens) {
    if (token.startsWith('<')) {
      const closing = token.startsWith('</');
      const tag = token.replace(/[</>\s]/g, '').toLowerCase();
      if (tag === 'br') {
        append('\n');
        continue;
      }
      const key = keyFor(tag);
      state[key] = Math.max(0, state[key] + (closing ? -1 : 1));
      continue;
    }
    append(stripInlineHTML(token));
  }
  return segments.length ? segments : [{ text: block.text, bold: false, italic: false, underline: false }];
}

function wrap(text, width) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

export function exportPlainText(document) {
  const layout = {
    scene: [0, 61], action: [0, 61], general: [0, 61], shot: [0, 61],
    character: [22, 38], dialogue: [10, 35], parenthetical: [16, 30], transition: [0, 61],
  };
  const lines = [];
  document.blocks.forEach((block, index) => {
    const [indent, width] = layout[block.type] || layout.action;
    const wrapped = wrap(displayText(block), width);
    if (index && (block.type === 'scene' || !['dialogue', 'parenthetical'].includes(block.type))) lines.push('');
    for (const line of wrapped) {
      if (block.type === 'transition') lines.push(line.padStart(61));
      else lines.push(`${' '.repeat(indent)}${line}`);
    }
  });
  return `${lines.join('\n').trimEnd()}\n`;
}

export function exportPrintableHTML(document) {
  const blocks = document.blocks.map((block) => {
    const safe = block.html ? sanitizeInlineHTML(block.html) : escapeHTML(block.text);
    return `<div class="${block.type}">${UPPERCASE_ELEMENTS.has(block.type) ? safe.toUpperCase() : safe}</div>`;
  }).join('\n');
  const title = escapeHTML(document.title || 'Untitled');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>@page{size:letter;margin:0}*{box-sizing:border-box}body{margin:0;background:white;color:black;font:12pt/1 Courier New,Courier,monospace}.page{width:8.5in;min-height:11in;padding:1in 1in 1in 1.5in;margin:0 auto}.page>div{white-space:pre-wrap;overflow-wrap:anywhere;margin:.17in 0 0}.scene,.character,.transition,.shot{text-transform:uppercase}.scene{width:6in;margin-top:.3in}.action,.general,.shot{width:6in}.character{margin-left:2in;width:4in}.dialogue{margin-left:1in;width:3.5in;margin-top:0}.parenthetical{margin-left:1.5in;width:2.7in;margin-top:0}.transition{text-align:right;width:6in}@media print{.page{page-break-after:always}}</style></head><body><main class="page">${blocks}</main></body></html>`;
}

export function estimatePages(document) {
  const charactersPerLine = { scene: 61, action: 61, general: 61, shot: 61, transition: 61, character: 33, dialogue: 35, parenthetical: 28 };
  let lines = 0;
  document.blocks.forEach((block, index) => {
    lines += Math.max(1, Math.ceil((block.text.length || 1) / (charactersPerLine[block.type] || 61)));
    if (index) lines += 1;
    if (block.type === 'scene' && index) lines += 1;
  });
  return Math.max(1, Math.ceil(lines / 55));
}
