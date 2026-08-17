#!/usr/bin/env node
import { once } from 'node:events';
import { LudereMcpServer } from './server.mjs';

const MAX_REQUEST_CHARACTERS = 4 * 1024 * 1024;
const server = new LudereMcpServer();

try {
  let processing = Promise.resolve();
  let failure;
  const enqueue = (line) => {
    processing = processing.then(async () => {
      if (!line.trim()) return;
      const response = line.length > MAX_REQUEST_CHARACTERS
        ? JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request exceeds the 4 MiB stdio safety limit.' } })
        : await server.handleLine(line);
      if (response && !process.stdout.write(`${response}\n`)) await once(process.stdout, 'drain');
    }).catch((error) => {
      failure ||= error;
    });
  };
  // Read directly from stdin rather than using readline's async iterator. A
  // client may write a burst and close stdin before Node's readline iterator
  // yields its buffered lines; retaining our own buffer preserves every request.
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      enqueue(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
    }
  });
  await once(process.stdin, 'end');
  if (buffer) enqueue(buffer.replace(/\r$/, ''));
  await processing;
  if (failure) throw failure;
} catch (error) {
  process.stderr.write(`ludere-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
