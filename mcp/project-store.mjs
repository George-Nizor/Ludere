import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  BEAT_COLORS,
  DOCUMENT_VERSION,
  ELEMENT_TYPES,
  sanitizeInlineHTML,
  stripInlineHTML,
  validateDocument,
} from '../core.mjs';
import { LudereMcpError, invariant } from './errors.mjs';

export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const PROJECT_EXTENSIONS = ['.ludere', '.json'];

function missing(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT';
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function absoluteFilePath(value, label, extensions = undefined) {
  invariant(typeof value === 'string' && value.length > 0, 'INVALID_PATH', `${label} must be a non-empty path.`);
  invariant(!value.includes('\0'), 'INVALID_PATH', `${label} contains a null byte.`);
  invariant(path.isAbsolute(value), 'PATH_NOT_ABSOLUTE', `${label} must be absolute so MCP writes never depend on its working directory.`, { path: value });
  const resolved = path.resolve(value);
  if (extensions) {
    const extension = path.extname(resolved).toLowerCase();
    invariant(extensions.includes(extension), 'INVALID_EXTENSION', `${label} must use ${extensions.join(' or ')}.`, { path: resolved, extension });
  }
  return resolved;
}

async function regularFileInfo(filePath, label) {
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    if (missing(error)) throw new LudereMcpError('FILE_NOT_FOUND', `${label} does not exist.`, { path: filePath });
    throw error;
  }
  invariant(info.isFile(), 'NOT_A_FILE', `${label} is not a regular file.`, { path: filePath });
  invariant(info.size <= MAX_INPUT_BYTES, 'FILE_TOO_LARGE', `${label} exceeds the 16 MiB safety limit.`, { path: filePath, bytes: info.size });
  return info;
}

export async function readTextFile(value, { label = 'Source file', extensions } = {}) {
  const filePath = absoluteFilePath(value, label, extensions);
  await regularFileInfo(filePath, label);
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new LudereMcpError('READ_FAILED', `${label} could not be read.`, { path: filePath, cause: error.message });
  }
  return { filePath, source, hash: sha256(source) };
}

export function documentJSON(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function diagnoseDocument(value) {
  const errors = [];
  const warnings = [];
  const issue = (target, code, message, at = undefined) => target.push({ code, message, ...(at ? { path: at } : {}) });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issue(errors, 'INVALID_ROOT', 'The document root must be an object.');
    return { valid: false, errors, warnings, normalized: null };
  }
  if (value.app == null) issue(warnings, 'MISSING_APP', 'The app marker is missing and will be restored.', 'app');
  else if (value.app !== 'ludere') issue(errors, 'WRONG_APP', 'The app marker is not "ludere".', 'app');
  if (value.version == null) issue(warnings, 'MISSING_VERSION', 'The schema version is missing and will be restored.', 'version');
  else if (Number(value.version) !== DOCUMENT_VERSION) issue(errors, 'UNSUPPORTED_VERSION', `Only Ludere document version ${DOCUMENT_VERSION} is supported.`, 'version');
  if (!Array.isArray(value.blocks)) {
    issue(errors, 'INVALID_BLOCKS', 'blocks must be an array.', 'blocks');
  } else {
    const ids = new Set();
    value.blocks.forEach((block, index) => {
      const at = `blocks[${index}]`;
      if (!block || typeof block !== 'object' || typeof block.text !== 'string') {
        issue(errors, 'INVALID_BLOCK', 'Every block must be an object with string text.', at);
        return;
      }
      if (typeof block.id !== 'string' || !block.id) issue(warnings, 'MISSING_BLOCK_ID', 'A block ID will be generated.', `${at}.id`);
      else if (block.id.length > 200) issue(errors, 'BLOCK_ID_TOO_LONG', 'Block ID exceeds 200 characters.', `${at}.id`);
      else if (ids.has(block.id)) issue(errors, 'DUPLICATE_BLOCK_ID', 'Block IDs must be unique.', `${at}.id`);
      else ids.add(block.id);
      if (!ELEMENT_TYPES.includes(block.type)) issue(warnings, 'UNKNOWN_BLOCK_TYPE', 'The block type will normalize to action.', `${at}.type`);
      if (block.text.length > 100_000) issue(errors, 'BLOCK_TEXT_TOO_LONG', 'Block text exceeds 100,000 characters.', `${at}.text`);
      if (typeof block.html === 'string' && block.html) {
        if (block.html.length > 300_000) issue(errors, 'BLOCK_HTML_TOO_LONG', 'Block HTML exceeds 300,000 characters.', `${at}.html`);
        const sanitized = sanitizeInlineHTML(block.html).slice(0, 300_000);
        if (sanitized !== block.html) issue(warnings, 'HTML_SANITIZED', 'Unsupported inline HTML or attributes will be removed.', `${at}.html`);
        if (stripInlineHTML(sanitized) !== block.text.slice(0, 100_000)) issue(warnings, 'HTML_TEXT_MISMATCH', 'Inline formatting does not represent the canonical text and will be removed.', `${at}.html`);
      } else if (block.html != null && typeof block.html !== 'string') issue(warnings, 'INVALID_BLOCK_HTML', 'Non-string block HTML will be removed.', `${at}.html`);
    });
    if (!value.blocks.length) issue(warnings, 'EMPTY_BLOCKS', 'A blank first block will be inserted.', 'blocks');
  }
  if (value.board != null && !Array.isArray(value.board)) {
    issue(errors, 'INVALID_BOARD', 'board must be an array when present.', 'board');
  } else if (Array.isArray(value.board)) {
    const ids = new Set();
    value.board.forEach((beat, index) => {
      const at = `board[${index}]`;
      if (!beat || typeof beat !== 'object' || typeof beat.text !== 'string') {
        issue(errors, 'INVALID_BEAT', 'Every beat must be an object with string text.', at);
        return;
      }
      if (typeof beat.id !== 'string' || !beat.id) issue(warnings, 'MISSING_BEAT_ID', 'A beat ID will be generated.', `${at}.id`);
      else if (beat.id.length > 200) issue(errors, 'BEAT_ID_TOO_LONG', 'Beat ID exceeds 200 characters.', `${at}.id`);
      else if (ids.has(beat.id)) issue(errors, 'DUPLICATE_BEAT_ID', 'Beat IDs must be unique.', `${at}.id`);
      else ids.add(beat.id);
      if (![1, 2, 3].includes(Number(beat.act))) issue(warnings, 'INVALID_BEAT_ACT', 'The beat act will normalize to 1.', `${at}.act`);
      if (beat.title != null && typeof beat.title !== 'string') issue(warnings, 'INVALID_BEAT_TITLE', 'Non-string beat title will normalize to blank.', `${at}.title`);
      else if (typeof beat.title === 'string' && beat.title.length > 120) issue(errors, 'BEAT_TITLE_TOO_LONG', 'Beat title exceeds 120 characters.', `${at}.title`);
      if (beat.text.length > 4000) issue(errors, 'BEAT_TEXT_TOO_LONG', 'Beat text exceeds 4,000 characters.', `${at}.text`);
      if (beat.color != null && !BEAT_COLORS.includes(beat.color)) issue(warnings, 'INVALID_BEAT_COLOR', 'The beat colour will normalize to its act default.', `${at}.color`);
    });
  }
  if (value.title != null && typeof value.title !== 'string') issue(warnings, 'INVALID_TITLE', 'Non-string title will normalize to blank.', 'title');
  else if (typeof value.title === 'string' && value.title.length > 120) issue(errors, 'TITLE_TOO_LONG', 'Title exceeds 120 characters.', 'title');
  if (value.mode != null && !['screenplay', 'free'].includes(value.mode)) issue(warnings, 'INVALID_MODE', 'Unknown mode will normalize to screenplay.', 'mode');
  if (value.titlePage != null && (!value.titlePage || typeof value.titlePage !== 'object' || Array.isArray(value.titlePage))) {
    issue(warnings, 'INVALID_TITLE_PAGE', 'titlePage must be an object and will normalize to blank fields.', 'titlePage');
  } else if (value.titlePage) {
    const limits = { author: 120, source: 180, contact: 500, draft: 120 };
    if (value.titlePage.enabled != null && typeof value.titlePage.enabled !== 'boolean') {
      issue(warnings, 'INVALID_TITLE_PAGE_ENABLED', 'titlePage.enabled will normalize to a boolean.', 'titlePage.enabled');
    }
    for (const [field, limit] of Object.entries(limits)) {
      const entry = value.titlePage[field];
      if (entry != null && typeof entry !== 'string') issue(warnings, 'INVALID_TITLE_PAGE_FIELD', `${field} will normalize to text.`, `titlePage.${field}`);
      else if (typeof entry === 'string' && entry.length > limit) issue(errors, 'TITLE_PAGE_FIELD_TOO_LONG', `${field} exceeds ${limit} characters.`, `titlePage.${field}`);
    }
  }
  if (value.savedAt != null && (typeof value.savedAt !== 'string' || Number.isNaN(Date.parse(value.savedAt)))) {
    issue(warnings, 'INVALID_SAVED_AT', 'savedAt is not an ISO date string and will be refreshed on the next write.', 'savedAt');
  }
  const normalized = validateDocument(value);
  if (!normalized && !errors.length) issue(errors, 'INVALID_DOCUMENT', 'The document cannot be normalized safely.');
  return { valid: errors.length === 0 && Boolean(normalized), errors, warnings, normalized };
}

export async function loadDocumentFile(value) {
  const loaded = await readTextFile(value, { label: 'Project path', extensions: PROJECT_EXTENSIONS });
  let parsed;
  try {
    parsed = JSON.parse(loaded.source);
  } catch (error) {
    throw new LudereMcpError('INVALID_JSON', 'The project is not valid JSON.', { path: loaded.filePath, cause: error.message });
  }
  const diagnostics = diagnoseDocument(parsed);
  invariant(diagnostics.valid, 'INVALID_DOCUMENT', 'The file is not a safely editable Ludere document.', {
    path: loaded.filePath,
    errors: diagnostics.errors,
  });
  return { ...loaded, document: diagnostics.normalized, rawDocument: parsed, diagnostics };
}

async function destinationState(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function assertParentDirectory(filePath) {
  const parent = path.dirname(filePath);
  let info;
  try {
    info = await stat(parent);
  } catch (error) {
    if (missing(error)) throw new LudereMcpError('PARENT_NOT_FOUND', 'The destination directory does not exist.', { path: parent });
    throw error;
  }
  invariant(info.isDirectory(), 'INVALID_PARENT', 'The destination parent is not a directory.', { path: parent });
}

async function replaceFromTemp(tempPath, destinationPath, destinationExists) {
  try {
    await rename(tempPath, destinationPath);
    return;
  } catch (error) {
    if (!destinationExists || !['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
  }

  // libuv normally replaces atomically. The backup path is a Windows/filesystem fallback that
  // still guarantees recovery if the second rename fails.
  const backupPath = `${destinationPath}.ludere-backup-${process.pid}-${randomUUID()}`;
  await rename(destinationPath, backupPath);
  try {
    await rename(tempPath, destinationPath);
  } catch (error) {
    try { await rename(backupPath, destinationPath); } catch {}
    throw error;
  }
  // Publication succeeded. A cleanup failure must not be reported as a failed write (which could
  // prompt a dangerous retry); the uncommon orphan remains recoverable and identifiable.
  try { await unlink(backupPath); } catch {}
}

async function assertCurrentHash(filePath, expectedHash) {
  let current;
  try {
    current = await readFile(filePath);
  } catch (error) {
    if (missing(error)) {
      throw new LudereMcpError('CONCURRENT_MODIFICATION', 'The project disappeared before it could be saved.', { path: filePath });
    }
    throw error;
  }
  invariant(sha256(current) === expectedHash, 'CONCURRENT_MODIFICATION', 'The project changed after it was opened; reopen it before applying this edit.', { path: filePath });
}

export async function writeTextFile(value, content, {
  label = 'Destination path',
  extensions,
  overwrite = false,
  expectedCurrentHash = undefined,
} = {}) {
  const filePath = absoluteFilePath(value, label, extensions);
  await assertParentDirectory(filePath);
  const existing = await destinationState(filePath);
  invariant(!existing || existing.isFile() || existing.isSymbolicLink(), 'INVALID_DESTINATION', 'The destination exists but is not a file.', { path: filePath });
  invariant(!existing || overwrite, 'FILE_EXISTS', 'The destination already exists; set overwrite=true only after confirming replacement is intended.', { path: filePath });

  if (expectedCurrentHash !== undefined) {
    invariant(existing, 'CONCURRENT_MODIFICATION', 'The project disappeared before it could be saved.', { path: filePath });
    await assertCurrentHash(filePath, expectedCurrentHash);
  }

  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Recheck after the potentially expensive temporary write, immediately before publication.
    if (expectedCurrentHash !== undefined) await assertCurrentHash(filePath, expectedCurrentHash);
    if (overwrite) await replaceFromTemp(tempPath, filePath, Boolean(existing));
    else {
      // A same-directory hard link publishes the already-synced inode atomically while preserving
      // no-overwrite semantics. This avoids exposing a partially copied destination.
      await link(tempPath, filePath);
      await unlink(tempPath);
    }
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await unlink(tempPath); } catch {}
    if (error?.code === 'EEXIST') throw new LudereMcpError('FILE_EXISTS', 'The destination was created by another process; nothing was overwritten.', { path: filePath });
    if (error instanceof LudereMcpError) throw error;
    throw new LudereMcpError('WRITE_FAILED', 'The destination could not be written safely.', { path: filePath, cause: error.message });
  }
  return { filePath, hash: sha256(content), bytes: Buffer.byteLength(content) };
}

export async function saveDocumentFile(value, document, options = {}) {
  const normalized = validateDocument(document);
  invariant(normalized, 'INVALID_DOCUMENT', 'The value is not a supported Ludere document.');
  normalized.savedAt = new Date().toISOString();
  const saved = await writeTextFile(value, documentJSON(normalized), {
    label: 'Project path',
    extensions: PROJECT_EXTENSIONS,
    ...options,
  });
  return { ...saved, document: normalized };
}
