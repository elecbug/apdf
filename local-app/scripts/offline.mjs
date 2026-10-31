import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
async function walk(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) paths.push(...await walk(path.join(directory, entry.name), `${relative}/`));
    else if (entry.name !== 'sw.js') paths.push(relative);
  }
  return paths.sort();
}
const files = await walk(dist);
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(path.join(dist, file)));
const version = hash.digest('hex').slice(0, 16);
await writeFile(path.join(dist, 'sw.js'), `// Generated from every bundled asset; PDF documents are never cached here.
const PREFIX = 'apdf-local:' + new URL(self.registration.scope).pathname + ':';
const CACHE = PREFIX + ${JSON.stringify(version)};
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  for (let index = 0; index < FILES.length; index += 16) {
    await cache.addAll(FILES.slice(index, index + 16).map(file => new Request(new URL(file, self.registration.scope), { cache: 'reload' })));
  }
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = event.request.mode === 'navigate' ? new URL('index.html', self.registration.scope).href : url.href;
    const cached = await cache.match(key, { ignoreSearch: true });
    return cached || fetch(event.request);
  })());
});
`);
console.log(`Offline bundle ready: ${files.length} local assets, version ${version}.`);
