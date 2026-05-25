import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const port = Number(process.env.PORT || 5173);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.ts', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const sourceMode = process.env.SERVE_SOURCE === '1';
  const requested = decoded === '/'
    ? '/index.html'
    : decoded === '/voxel_core.wasm'
      ? sourceMode ? '/public/voxel_core.wasm' : '/voxel_core.wasm'
      : decoded;
  const base = sourceMode ? root : distRoot;
  const full = path.resolve(base, `.${requested}`);
  if (!full.startsWith(base)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  try {
    const full = safePath(req.url || '/');
    if (!full) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const st = await stat(full);
    const filePath = st.isDirectory() ? path.join(full, 'index.html') : full;
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': mime.get(path.extname(filePath)) || 'application/octet-stream',
      // These are included for future SharedArrayBuffer/WASM-thread experiments.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  const mode = process.env.SERVE_SOURCE === '1' ? 'source' : 'dist';
  console.log(`Storm Canyon ${mode} server running at http://localhost:${port}`);
});
