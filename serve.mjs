// Servidor local para conferir o site: node serve.mjs  (abre em http://localhost:4173)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!f.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) { if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }).end(); return; } f = path.join(f, 'index.html'); }
  if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': T['.html'] }); res.end(fs.readFileSync(path.join(DIST, '404.html'))); return; }
  res.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 4173, () => console.log('http://localhost:' + (process.env.PORT || 4173)));
