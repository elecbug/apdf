const DATABASE = 'apdf-local-v1';
const PREFERENCES = 'apdf-local-source-plan-v1';

export function createSourceStore(engine) {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sources', { keyPath: 'source_id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Browser storage is unavailable. Allow site storage to assemble PDFs.'));
      request.onblocked = () => reject(new Error('Close other APDF Local windows and retry.'));
    });
    return database;
  }
  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sources', mode);
      let result;
      const request = action(tx.objectStore('sources'));
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error(tx.error?.message || 'Could not save local PDFs. Check browser storage space.'));
    });
  }
  return {
    async list() { return (await transaction('readonly', store => store.getAll())).sort((a, b) => a.added - b.added); },
    async add(files) {
      // Validate the whole batch before committing any file.
      const sources = [];
      for (const file of files) {
        const pages = await engine.count(file);
        if (pages < 1) throw new Error(`${file.name} has no pages.`);
        sources.push({ source_id: crypto.randomUUID().toUpperCase(), name: file.name, pages, added: Date.now() + sources.length, file });
      }
      await transaction('readwrite', store => { for (const source of sources) store.add(source); });
      return sources;
    },
    remove(id) { return transaction('readwrite', store => store.delete(id)); },
    clear() { return transaction('readwrite', store => store.clear()); },
  };
}

export function createPlanStorage(storage = localStorage) {
  return {
    save(sources) {
      try { storage.setItem(PREFERENCES, JSON.stringify(sources.map(({ source_id, start, end }) => ({ source_id, start, end })))); } catch { /* Work without persistence. */ }
    },
    apply(sources) {
      try {
        const plan = JSON.parse(storage.getItem(PREFERENCES));
        if (!Array.isArray(plan)) return sources;
        const remaining = new Map(sources.map(source => [source.source_id, source]));
        const ordered = [];
        for (const item of plan) {
          const source = remaining.get(item?.source_id);
          if (!source) continue;
          const clamp = value => Math.min(source.pages, Math.max(1, Number.isInteger(value) ? value : 1));
          const start = clamp(item.start);
          ordered.push({ ...source, start, end: Math.max(start, clamp(item.end)) });
          remaining.delete(item.source_id);
        }
        return [...ordered, ...remaining.values()];
      } catch { return sources; }
    },
    clear() { try { storage.removeItem(PREFERENCES); } catch { /* No persistent plan. */ } },
  };
}

export function createLocalApi(store, engine) {
  const metadata = ({ file, ...source }) => source;
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url === '/compose' && method === 'POST') {
      const { plan } = JSON.parse(options.body);
      const sources = await store.list();
      const ids = new Set(plan.map(item => item.source_id));
      return { file: await engine.compose(sources.filter(source => ids.has(source.source_id)), plan) };
    }
    const match = /^\/api\/clients\/[^/]+\/sources(?:\/([^/]+))?$/.exec(url);
    if (!match) throw new Error('Unsupported local action.');
    if (method === 'GET' && !match[1]) return { sources: (await store.list()).map(metadata) };
    if (method === 'POST' && !match[1]) return { sources: (await store.add(options.body.getAll('files'))).map(metadata) };
    if (method === 'DELETE') {
      if (match[1]) await store.remove(decodeURIComponent(match[1]));
      else await store.clear();
      return { ok: true };
    }
    throw new Error('Unsupported local action.');
  };
}
