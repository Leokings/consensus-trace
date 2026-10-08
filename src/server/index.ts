import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './http.js';
import { RunStore } from './store.js';
import { RunService } from './service.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dataPath = resolve(process.env.TRACE_DATA_DIR ?? resolve(root, '.local'));
const store = new RunStore(resolve(dataPath, 'runs.sqlite'));
const service = new RunService(store);
const port = Number(process.env.PORT ?? '3910');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const dev = process.argv.includes('--dev');
const vite = dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true, host: '127.0.0.1' }, appType: 'spa' }) : null;
const webRoot = resolve(root, 'dist/web');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((request, response) => {
  void (async () => {
    response.setHeader('referrer-policy', 'no-referrer');
    if (await api(request, response, service)) return;
    if (vite) { vite.middlewares(request, response); return; }
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const fullPath = resolve(webRoot, `.${path}`);
    if (fullPath !== webRoot && !fullPath.startsWith(`${webRoot}${sep}`)) { response.writeHead(403); response.end('Forbidden'); return; }
    try {
      const file = path === '/' ? resolve(webRoot, 'index.html') : fullPath;
      const bytes = await readFile(file);
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); response.end(bytes);
    } catch { response.writeHead(404); response.end('Not found. Run npm run build before npm start.'); }
  })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end('Unexpected local server error.'); });
});
server.listen(port, '127.0.0.1', () => console.log(`Consensus Trace: http://127.0.0.1:${port} · read-only · ${dev ? 'development' : 'production'}`));
async function shutdown() { server.close(); await vite?.close(); store.close(); process.exit(0); }
process.once('SIGINT', () => { void shutdown(); }); process.once('SIGTERM', () => { void shutdown(); });
