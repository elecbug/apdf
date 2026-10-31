import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const local = fileURLToPath(new URL('../', import.meta.url));
const entries = {};
async function add(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await add(filename, name);
    else entries[name] = new Uint8Array(await readFile(filename));
  }
}
await add(path.join(local, 'dist'), 'apdf-local/app');
entries['apdf-local/serve.mjs'] = new Uint8Array(await readFile(path.join(local, 'scripts/serve.mjs')));
entries['apdf-local/start.mjs'] = strToU8("import {startServer} from './serve.mjs';\nimport {fileURLToPath} from 'node:url';\nstartServer(fileURLToPath(new URL('./app/', import.meta.url)), Number(process.env.APDF_LOCAL_PORT || 4173));\n");
entries['apdf-local/README.txt'] = strToU8([
  'APDF Local', '',
  '1. Install Node.js 22.12 or newer.',
  '2. Extract this entire folder.',
  '3. In this folder, run: node start.mjs',
  '4. Open http://127.0.0.1:4173 in a modern browser.', '',
  'No Python, Docker, npm install, internet connection, or account is required to run this bundle. The server only serves app files. Your PDFs are processed inside your browser and never uploaded.', '',
  'After Ready for offline use appears, the app can be reloaded offline. Supported browsers offer an Install app action. Keep the same address, port and browser profile for access to stored sources and the offline cache.', '',
  'Sources persist in IndexedDB until Clear Sources or browser site data is cleared. Edit history stays in memory; download your work before closing the editor. Large PDFs are limited by available device memory.', '',
  'To use another port: set APDF_LOCAL_PORT before starting (for example APDF_LOCAL_PORT=4174 node start.mjs on macOS/Linux).', '',
].join('\n'));
await mkdir(path.join(local, 'releases'), { recursive: true });
const bytes = zipSync(entries, { level: 6 });
await writeFile(path.join(local, 'releases/apdf-local.zip'), bytes);
console.log(`Portable app: local-app/releases/apdf-local.zip (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
