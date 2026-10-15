#!/usr/bin/env node
// Dependency-free static server. Import performs fail-closed staging BEFORE listen.
import { createServer } from 'node:http';
import path from 'node:path';
import { ALLOWLIST, readPublicAsset } from './stage-public.mjs';

const routes = new Set(ALLOWLIST.map(rel => '/' + rel));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function unsafe(value) {
  return /[\\\u0000]/.test(value) || value.split('/').some(part => part === '.' || part === '..');
}
const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  function deny(status) { res.writeHead(status); res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); deny(405); return; }
  const raw = (req.url || '').split('?')[0];
  if (!raw.startsWith('/') || unsafe(raw)) { deny(400); return; }
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { deny(400); return; }
  if (unsafe(decoded) || decoded.includes('%')) { deny(400); return; }
  const route = decoded === '/' ? '/index.html' : decoded;
  if (!routes.has(route)) { deny(404); return; }
  try {
    // Re-check every component/realpath on each request; never serve a linked file.
    const body = readPublicAsset(route.slice(1));
    res.writeHead(200, { 'Content-Type': types[path.extname(route)] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { deny(403); }
});
server.on('error', error => {
  console.error(`[serve] ${error.code || 'ERROR'}: ${error.message}`);
  process.exit(1); // Concrete failure; no alternate port, wildcard host or subprocess.
});
server.listen(5199, '127.0.0.1', () => {
  console.log(`[serve] listening http://127.0.0.1:5199 pid=${process.pid}`);
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
}
