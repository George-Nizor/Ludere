import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = fileURLToPath(new URL('../dist', import.meta.url));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'styles.css', 'app.js', 'core.mjs', 'manifest.webmanifest', 'service-worker.js', 'public']) {
  await cp(`${root}/${entry}`, `${output}/${entry}`, { recursive: true });
}
console.log(`Ludere build ready at ${output}`);
