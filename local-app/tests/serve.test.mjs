import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../scripts/serve.mjs';

test('local launcher serves static files and rejects uploads and traversal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'apdf-static-'));
  await writeFile(path.join(root, 'index.html'), '<p>APDF Local</p>');
  await writeFile(path.join(root, 'runtime.wasm'), new Uint8Array([0, 97, 115, 109]));
  const server = startServer(root, 0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await (await fetch(base + '/?view=edit')).text(), '<p>APDF Local</p>');
    const head = await fetch(base + '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(base + '/runtime.wasm')).headers.get('content-type'), 'application/wasm');
    for (const url of ['/edit/apply', '/compose', '/api/clients/local/sources']) {
      assert.equal((await fetch(base + url, { method: 'POST', body: 'PDF bytes' })).status, 405);
    }
    assert.equal((await fetch(base + '/..%2fprivate-file')).status, 403);
    assert.equal((await fetch(base + '/missing.pdf')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
