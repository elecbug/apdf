let engine;
let queue = Promise.resolve();
const progress = message => self.postMessage({ type: 'progress', message });

async function initialize(baseUrl) {
  const base = new URL(baseUrl);
  if (base.origin !== self.location.origin) throw new Error('The PDF runtime must be local.');
  // A missing bundled package must fail locally instead of falling back to a CDN.
  const localFetch = self.fetch.bind(self);
  self.fetch = (resource, options) => {
    const url = new URL(resource instanceof Request ? resource.url : resource, base);
    if (url.origin !== base.origin) throw new Error('External network access is disabled.');
    return localFetch(resource, options);
  };
  progress('Loading the local PDF engine…');
  const runtimeUrl = new URL('vendor/pyodide/', base).href;
  const { loadPyodide } = await import(/* @vite-ignore */ `${runtimeUrl}pyodide.mjs`);
  const python = await loadPyodide({ indexURL: runtimeUrl, packageBaseUrl: runtimeUrl });
  progress('Preparing image and font tools…');
  await python.loadPackage('pillow');
  const response = await fetch(new URL('engine/app.zip', base));
  if (!response.ok) throw new Error('The bundled PDF engine is missing. Rebuild APDF Local.');
  python.unpackArchive(new Uint8Array(await response.arrayBuffer()), 'zip', { extractDir: '/apdf' });
  await python.runPythonAsync('import sys\nsys.path.insert(0, "/apdf")\nimport local_bridge\nimport shutil');
  progress('PDF engine ready. All processing stays on this device.');
  return python;
}

async function run({ id, command, payload, files }) {
  const python = await engine;
  const directory = `/tmp/job-${id}`;
  python.FS.mkdir(directory);
  try {
    for (const { name, buffer } of files) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid local attachment name.');
      python.FS.writeFile(`${directory}/${name}`, new Uint8Array(buffer));
    }
    python.globals.set('_job_command', command);
    python.globals.set('_job_payload', JSON.stringify(payload));
    python.globals.set('_job_directory', directory);
    const result = JSON.parse(await python.runPythonAsync('local_bridge.run(_job_command, _job_payload, _job_directory)'));
    if (!result.ok) throw new Error(result.error || 'Local PDF operation failed.');
    if (command !== 'count') {
      const bytes = python.FS.readFile(`${directory}/output.pdf`);
      const buffer = bytes.slice().buffer;
      self.postMessage({ id, result: { ...result, buffer } }, [buffer]);
    } else self.postMessage({ id, result });
  } finally {
    await python.runPythonAsync('shutil.rmtree(_job_directory, ignore_errors=True)');
    for (const key of ['_job_command', '_job_payload', '_job_directory']) python.globals.delete(key);
  }
}

self.onmessage = ({ data }) => {
  if (data.command === 'init') {
    engine = initialize(data.baseUrl);
    engine.then(() => self.postMessage({ type: 'ready' })).catch(error => {
      self.postMessage({ type: 'fatal', error: String(error.message || error) });
    });
    return;
  }
  queue = queue.then(() => run(data)).catch(error => {
    console.error(error);
    self.postMessage({ id: data.id, error: String(error.message || error) });
  });
};
