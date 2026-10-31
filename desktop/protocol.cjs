const path = require('node:path');
const fs = require('node:fs/promises');

const APP_URL = 'apdf://app/';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
};

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'apdf:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function isLocalResource(value) {
  if (isAppUrl(value)) return true;
  return value.startsWith('blob:apdf://app/') || value.startsWith('data:');
}

function createAssetHandler(directory) {
  const root = path.resolve(directory);
  return async request => {
    if (!isAppUrl(request.url)) return new Response('Unknown app origin', { status: 403 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    try {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname.includes('\0') || pathname.split(/[\\/]/).includes('..')) return new Response('Invalid path', { status: 403 });
      const filename = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) return new Response('Invalid path', { status: 403 });
      const info = await fs.stat(filename);
      if (!info.isFile()) return new Response('Not found', { status: 404 });
      const body = request.method === 'HEAD' ? null : new Uint8Array(await fs.readFile(filename));
      return new Response(body, { headers: {
        'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
        'Content-Length': String(info.size), 'X-Content-Type-Options': 'nosniff',
      } });
    } catch { return new Response('App file not found', { status: 404 }); }
  };
}

module.exports = { APP_URL, isAppUrl, isLocalResource, createAssetHandler };
