import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip' };
export function startServer(directory, port = 4173) {
  const root = path.resolve(directory);
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
      const info = await stat(filename);
      if (!info.isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': info.size });
      response.end(request.method === 'HEAD' ? undefined : await readFile(filename));
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('File not found. Run npm run build:local first.'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`APDF Local: http://127.0.0.1:${server.address().port}\nPDFs are processed in your browser. Press Ctrl+C to stop.`));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.APDF_LOCAL_PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('APDF_LOCAL_PORT must be a port number.');
  startServer(fileURLToPath(new URL('../dist/', import.meta.url)), port);
}
