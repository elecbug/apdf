import { cp, mkdir, readFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const app = path.join(root, 'desktop/.build/app');
const icons = path.join(root, 'desktop/.build/icons');
try { await access(path.join(root, 'node_modules/electron/dist')); }
catch { execFileSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], { stdio: 'inherit' }); }
await mkdir(app, { recursive: true });
await mkdir(icons, { recursive: true });
for (const file of ['main.cjs', 'protocol.cjs']) await cp(path.join(root, 'desktop', file), path.join(app, file));
await cp(path.join(root, 'local-app/dist'), path.join(app, 'web'), { recursive: true, force: true });
for (const extension of ['png', 'ico', 'icns']) await cp(path.join(root, 'app/static/icons', `app-icon.${extension}`), path.join(icons, `icon.${extension}`));
await cp(path.join(icons, 'icon.png'), path.join(app, 'icon.png'));
const source = JSON.parse(await readFile(path.join(root, 'package.json')));
await writeFile(path.join(app, 'package.json'), JSON.stringify({
  name: 'apdf-local-desktop', productName: 'APDF Local', version: source.version,
  description: 'Offline PDF editor and assembler. All processing stays on this device.',
  author: 'APDF contributors', license: 'UNLICENSED', private: true, main: 'main.cjs',
}, null, 2));
console.log('Desktop app prepared: runtime, PDF engine, fonts and all app assets are bundled.');
