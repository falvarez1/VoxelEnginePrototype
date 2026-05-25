import { defineConfig } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const automationRoot = path.resolve('output', 'automation');

function readNodeRequestBody(req, limitBytes = 64 * 1024 * 1024) {
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
  return { ok: true, path: path.relative(process.cwd(), reportPath).replace(/\\/g, '/'), latest: 'output/automation/latest.json' };
}

function automationReportMiddleware() {
  return async (req, res, next) => {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (reqUrl.pathname === '/__storm/automation-report' && req.method === 'POST') {
      try {
        const result = await writeAutomationReport(await readNodeRequestBody(req));
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    if (reqUrl.pathname === '/__storm/automation-report/latest' && req.method === 'GET') {
      try {
        const body = await readFile(path.join(automationRoot, 'latest.json'));
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(body);
      } catch {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ ok: false, error: 'No automation report has been written yet.' }));
      }
      return;
    }
    next();
  };
}

export default defineConfig({
  plugins: [
    {
      name: 'storm-canyon-automation-report',
      configureServer(server) {
        server.middlewares.use(automationReportMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(automationReportMiddleware());
      },
    },
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
