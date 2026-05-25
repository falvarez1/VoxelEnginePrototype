import http from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const automationRoot = path.join(root, 'output', 'automation');
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

function readRequestBody(req, limitBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function writeAutomationReport(bodyText) {
  const parsed = JSON.parse(bodyText);
  const capturedAt = Number(parsed.capturedAt) || Date.now();
  const stamp = new Date(capturedAt).toISOString().replace(/[:.]/g, '-');
  await mkdir(automationRoot, { recursive: true });
  await writeFile(path.join(automationRoot, 'latest.json'), JSON.stringify(parsed, null, 2));
  const reportPath = path.join(automationRoot, `report-${stamp}.json`);
  await writeFile(reportPath, JSON.stringify(parsed, null, 2));
  return { ok: true, path: path.relative(root, reportPath).replace(/\\/g, '/'), latest: 'output/automation/latest.json' };
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (reqUrl.pathname === '/__storm/automation-report' && req.method === 'POST') {
      try {
        const result = await writeAutomationReport(await readRequestBody(req));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    if (reqUrl.pathname === '/__storm/automation-report/latest' && req.method === 'GET') {
      try {
        const body = await readFile(path.join(automationRoot, 'latest.json'));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'No automation report has been written yet.' }));
      }
      return;
    }
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
