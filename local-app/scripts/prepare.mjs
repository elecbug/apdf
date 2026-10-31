import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import nunjucks from 'nunjucks';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const local = path.join(root, 'local-app');
const output = path.join(local, 'public');
const cache = path.join(local, '.cache');
const pyodide = path.join(root, 'node_modules/pyodide');
const version = JSON.parse(await readFile(path.join(pyodide, 'package.json'))).version;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });

async function download(url, name, expected) {
  const destination = path.join(cache, name);
  let bytes;
  try { bytes = await readFile(destination); } catch { /* Fetch this asset once. */ }
  if (!bytes || (expected && digest(bytes) !== expected)) {
    console.log(`Preparing ${name}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Cannot download ${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (expected && digest(bytes) !== expected) throw new Error(`Integrity check failed: ${name}`);
    await writeFile(destination, bytes);
  }
  return bytes;
}

const runtime = path.join(output, 'vendor/pyodide');
await mkdir(runtime, { recursive: true });
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await cp(path.join(pyodide, file), path.join(runtime, file));
}
const lock = JSON.parse(await readFile(path.join(pyodide, 'pyodide-lock.json')));
const packages = new Set();
async function preparePackage(name) {
  if (packages.has(name)) return;
  packages.add(name);
  const info = lock.packages[name];
  if (!info) throw new Error(`Missing browser Python package: ${name}`);
  for (const dependency of info.depends) await preparePackage(dependency);
  const bytes = await download(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${info.file_name}`, info.file_name, info.sha256);
  await writeFile(path.join(runtime, info.file_name), bytes);
}
await preparePackage('pillow');

const archive = {};
const pythonPackages = [['pypdf', '5.1.0'], ['reportlab', '4.2.5'], ['chardet', '5.2.0']];
for (const [name, pinnedVersion] of pythonPackages) {
  const metadata = JSON.parse(await download(`https://pypi.org/pypi/${name}/${pinnedVersion}/json`, `${name}-${pinnedVersion}.json`));
  const wheel = metadata.urls.find(item => item.filename.endsWith('none-any.whl'));
  if (!wheel) throw new Error(`No pure Python wheel available: ${name}`);
  const bytes = await download(wheel.url, wheel.filename, wheel.digests.sha256);
  for (const [file, content] of Object.entries(unzipSync(bytes))) {
    if (file.startsWith('/') || file.split('/').includes('..')) throw new Error(`Invalid wheel path: ${file}`);
    if (!file.endsWith('/')) archive[file] = content;
  }
}
async function addPython(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.py')) {
      const file = `${directory}/${entry.name}`;
      archive[file] = new Uint8Array(await readFile(path.join(root, file)));
    }
  }
}
await addPython('app/services/pdf');
archive['app/__init__.py'] = strToU8('');
archive['app/services/__init__.py'] = strToU8('');
archive['app/config.py'] = strToU8('from pathlib import Path\nFONTS_DIR = Path("/apdf/fonts")\n');
archive['app/static/pen-brush-presets.json'] = new Uint8Array(await readFile(path.join(root, 'app/static/pen-brush-presets.json')));
archive['local_bridge.py'] = new Uint8Array(await readFile(path.join(local, 'engine/bridge.py')));
const fontCommit = '16680f8688ffcd467d2eb2146a9ce0343404581d';
const fontBase = `https://raw.githubusercontent.com/google/fonts/${fontCommit}/ofl/nanumgothic`;
archive['fonts/NanumGothic-Regular.ttf'] = new Uint8Array(await download(`${fontBase}/NanumGothic-Regular.ttf`, 'NanumGothic-Regular.ttf', '76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31'));
archive['licenses/NanumGothic-OFL.txt'] = new Uint8Array(await download(`${fontBase}/OFL.txt`, 'NanumGothic-OFL.txt'));
await mkdir(path.join(output, 'engine'), { recursive: true });
await writeFile(path.join(output, 'engine/app.zip'), zipSync(archive, { level: 6 }));

await cp(path.join(root, 'app/static'), path.join(output, 'static'), { recursive: true });
const sharedCss = await readFile(path.join(output, 'static/style.css'), 'utf8');
await writeFile(path.join(output, 'static/style.css'), sharedCss.replaceAll('/static/', './'));
const pdfjs = path.join(root, 'node_modules/pdfjs-dist');
await mkdir(path.join(output, 'vendor/pdfjs'), { recursive: true });
for (const file of ['build/pdf.mjs', 'build/pdf.worker.mjs']) {
  await cp(path.join(pdfjs, file), path.join(output, 'vendor/pdfjs', path.basename(file)));
}
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(pdfjs, directory), path.join(output, 'vendor/pdfjs', directory), { recursive: true });
}
await cp(path.join(pdfjs, 'LICENSE'), path.join(output, 'vendor/pdfjs/LICENSE'));
await mkdir(path.join(output, 'licenses'), { recursive: true });
for (const name of ['react', 'react-dom']) {
  await cp(path.join(root, 'node_modules', name, 'LICENSE'), path.join(output, 'licenses', `${name}-LICENSE.txt`));
}
await writeFile(path.join(output, 'licenses/Pyodide-LICENSE.txt'), await download(`https://raw.githubusercontent.com/pyodide/pyodide/${version}/LICENSE`, `pyodide-${version}-LICENSE.txt`));
await writeFile(path.join(output, 'licenses/Python-LICENSE.txt'), await download(`https://raw.githubusercontent.com/python/cpython/v${lock.info.python}/LICENSE`, `python-${lock.info.python}-LICENSE.txt`));

nunjucks.installJinjaCompat();
const templates = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(root, 'app/templates')), { autoescape: true });
templates.addFilter('tojson', value => new nunjucks.runtime.SafeString(JSON.stringify(value).replaceAll('<', '\\u003c')));
const pen_brushes = JSON.parse(await readFile(path.join(root, 'app/static/pen-brush-presets.json')));
const editMarkup = templates.renderString(`{% include "partials/edit/edit_hero.html" %}<section class="edit-workspace">{% include "partials/edit/preview_pane.html" %}{% include "partials/edit/control_pane.html" %}</section>`, { pen_brushes }).replaceAll('"/static/', '"./static/');
const assembleMarkup = `<section class="composer">${templates.render('partials/assemble/source_pane.html').replace('Ready. Drag PDFs onto Sources to upload.', 'Ready. Drag PDFs here to add them locally.')}</section><details class="card help"><summary>Local storage</summary><ul><li>PDF files are kept in this browser on this device.</li><li>Order and page ranges are restored after reload when browser storage is available.</li><li>Clear Sources removes the stored source PDFs.</li><li>Build and downloads run entirely on this device.</li></ul></details>`;
await mkdir(path.join(local, 'src/generated'), { recursive: true });
await writeFile(path.join(local, 'src/generated/workspaces.js'), `// Generated from the shared APDF templates.\nexport const editMarkup = ${JSON.stringify(editMarkup)};\nexport const assembleMarkup = ${JSON.stringify(assembleMarkup)};\n`);
await cp(path.join(local, 'app-icon.svg'), path.join(output, 'app-icon.svg'));
await writeFile(path.join(output, 'manifest.webmanifest'), JSON.stringify({
  id: './', name: 'APDF Local', short_name: 'APDF Local', description: 'Private, offline PDF assembly and editing.',
  start_url: './', scope: './', display: 'standalone', background_color: '#f5f6f8', theme_color: '#2d63c8',
  icons: [{ src: './app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }, { src: './static/icons/app-icon-192.png', sizes: '192x192', type: 'image/png' }, { src: './static/icons/app-icon.png', sizes: '512x512', type: 'image/png' }],
}, null, 2));
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), `APDF Local bundles React (MIT), Pyodide (MPL-2.0), Python (PSF), PDF.js (Apache-2.0), Pillow (HPND), pypdf (BSD-3-Clause), ReportLab (BSD), chardet (LGPL-2.1), and Nanum Gothic (SIL OFL-1.1). License files are retained in licenses/, engine/app.zip, the Pillow wheel, and vendor/pdfjs/LICENSE. Pyodide source: https://github.com/pyodide/pyodide/tree/${version}. Dependencies are pinned in package-lock.json and local-app/scripts/prepare.mjs.\n`);
console.log(`Local assets prepared (Pyodide ${version}; all runtime dependencies are bundled).`);
