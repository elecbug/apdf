import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanStorage, createLocalApi } from '../src/storage.js';

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test('restore page ranges and order while accepting new sources and ignoring deleted duplicates', () => {
  const storage = createPlanStorage(memory());
  storage.save([{ source_id: 'B', start: 2, end: 8 }, { source_id: 'B', start: 1, end: 1 }, { source_id: 'removed', start: 1, end: 1 }, { source_id: 'A', start: -1, end: 1 }]);
  assert.deepEqual(storage.apply([{ source_id: 'A', pages: 3 }, { source_id: 'B', pages: 4 }, { source_id: 'C', pages: 2 }]), [
    { source_id: 'B', pages: 4, start: 2, end: 4 }, { source_id: 'A', pages: 3, start: 1, end: 1 }, { source_id: 'C', pages: 2 },
  ]);
  storage.clear();
  const sources = [{ source_id: 'A', pages: 3 }];
  assert.deepEqual(storage.apply(sources), sources);
});
test('unavailable or corrupted preference storage does not prevent assembly', () => {
  const sources = [{ source_id: 'A', pages: 2 }];
  const broken = createPlanStorage({ getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } });
  broken.save(sources); broken.clear();
  assert.equal(broken.apply(sources), sources);
  assert.equal(createPlanStorage({ getItem: () => '{bad' }).apply(sources), sources);
});
test('local API excludes file bytes from metadata and passes only selected files to the engine', async () => {
  const sources = [{ source_id: 'A', name: 'a.pdf', pages: 2, file: new Blob(['a']) }, { source_id: 'B', name: 'b.pdf', pages: 1, file: new Blob(['b']) }];
  const plan = [{ source_id: 'B', start: 1, end: 1 }];
  const output = new Blob(['result']);
  const api = createLocalApi({ list: async () => sources }, { compose: async (items, actual) => {
    assert.deepEqual(items, [sources[1]]); assert.deepEqual(actual, plan); return output;
  } });
  const metadata = await api('/api/clients/local/sources');
  assert(!('file' in metadata.sources[0]));
  assert.equal((await api('/compose', { method: 'POST', body: JSON.stringify({ plan }) })).file, output);
  await assert.rejects(api('https://external.invalid/upload'), /Unsupported local action/);
});
