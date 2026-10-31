import { loadImage, createCanvas } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(path.join(root, 'local-app/app-icon.svg'));
const image = await loadImage(svg);
const icons = path.join(root, 'app/static/icons');
const pngs = new Map();
for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024]) {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, 0, 0, size, size);
  pngs.set(size, canvas.toBuffer('image/png'));
}
function ico(sizes) {
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(pngs.get(size).length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += pngs.get(size).length;
  });
  return Buffer.concat([header, ...sizes.map(size => pngs.get(size))]);
}
const icnsEntries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, size]) => {
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(8 + pngs.get(size).length, 4);
  return Buffer.concat([header, pngs.get(size)]);
});
const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + icnsEntries.reduce((sum, entry) => sum + entry.length, 0), 4);
await Promise.all([
  writeFile(path.join(icons, 'app-icon.svg'), svg),
  writeFile(path.join(icons, 'favicon.ico'), ico([16, 32, 48])),
  writeFile(path.join(icons, 'favicon-32.png'), pngs.get(32)),
  writeFile(path.join(icons, 'apple-touch-icon.png'), pngs.get(180)),
  writeFile(path.join(icons, 'app-icon-192.png'), pngs.get(192)),
  writeFile(path.join(icons, 'app-icon.png'), pngs.get(512)),
  writeFile(path.join(icons, 'app-icon.ico'), ico([16, 32, 48, 256])),
  writeFile(path.join(icons, 'app-icon.icns'), Buffer.concat([icns, ...icnsEntries])),
]);
console.log('APDF favicon and desktop icons generated from local-app/app-icon.svg.');
