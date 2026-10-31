import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import protocol from '../protocol.cjs';

test('the desktop file protocol serves the complete app without a TCP server', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apdf-protocol-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<p>APDF Local</p>');
    await writeFile(path.join(directory, 'runtime.wasm'), new Uint8Array([0, 97, 115, 109]));
    const handle = protocol.createAssetHandler(directory);
    const request = (url, method = 'GET') => handle({ url, method });
    const page = await request('apdf://app/?view=edit');
    assert.equal(page.status, 200);
    assert.equal(await page.text(), '<p>APDF Local</p>');
    assert.equal((await request('apdf://app/runtime.wasm')).headers.get('content-type'), 'application/wasm');
    assert.equal(await (await request('apdf://app/', 'HEAD')).text(), '');
    for (const url of ['apdf://foreign/', 'apdf://user@app/', 'apdf://app:80/', 'https://app/']) assert.equal((await request(url)).status, 403);
    for (const url of ['apdf://app/..%2foutside', 'apdf://app/..%5coutside', 'apdf://app/%00']) assert.equal((await request(url)).status, 403);
    assert.equal((await request('apdf://app/missing')).status, 404);
    assert.equal((await request('apdf://app/edit/apply', 'POST')).status, 405);
    assert.equal((await request('apdf://app/%zz')).status, 404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('desktop connections are limited to bundled resources, app blobs and inline images', () => {
  for (const url of ['apdf://app/', 'apdf://app/vendor/pdf.mjs', 'blob:apdf://app/123', 'data:image/png;base64,AA==']) assert(protocol.isLocalResource(url), url);
  for (const url of ['https://example.com/', 'http://localhost:8000/', 'file:///etc/passwd', 'apdf://other/', 'blob:https://example.com/123', 'apdf://user@app/']) assert(!protocol.isLocalResource(url), url);
});
