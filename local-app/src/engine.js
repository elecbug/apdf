export function createLocalEngine(onProgress = () => {}) {
  const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let sequence = 0;
  let resolveReady;
  let rejectReady;
  let failure;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  function fail(error) {
    failure = error;
    rejectReady(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') return onProgress(data.message);
    if (data.type === 'ready') return resolveReady();
    if (data.type === 'fatal') return fail(new Error(data.error));
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = event => fail(new Error(event.message || 'The local PDF engine stopped. Reload to retry.'));
  worker.postMessage({ command: 'init', baseUrl: new URL('./', document.baseURI).href });

  async function call(command, payload, inputs) {
    await ready;
    if (failure) throw failure;
    const files = await Promise.all(inputs.map(async ({ name, file }) => ({ name, buffer: await file.arrayBuffer() })));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, command, payload, files }, files.map(file => file.buffer));
    });
  }
  function output(result) {
    return new File([result.buffer], result.filename, { type: 'application/pdf' });
  }
  return {
    ready,
    async count(file) { return (await call('count', {}, [{ name: 'target.pdf', file }])).pages; },
    async edit(file, operation, items = []) {
      const attachments = {};
      const files = [{ name: 'target.pdf', file }];
      items.forEach((item, index) => {
        const extension = item.file.name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
        const name = `attachment-${index}.${extension}`;
        attachments[item.id] = name;
        files.push({ name, file: item.file });
      });
      return output(await call('edit', { operations: [operation], attachments }, files));
    },
    async compose(items, plan) {
      const sources = {};
      const files = items.map((item, index) => {
        const name = `source-${index}.pdf`;
        sources[item.source_id] = name;
        return { name, file: item.file };
      });
      return output(await call('compose', { sources, plan }, files));
    },
    destroy() { fail(new Error('PDF engine closed.')); worker.terminate(); },
  };
}
