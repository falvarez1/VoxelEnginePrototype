#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_TOUR = 'baseline';
const DEFAULT_BASELINE_DIR = 'docs/tour-baselines';
const DEFAULT_PORT = 5193;
const DEFAULT_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/tour-capture.mjs [options]

Captures a deterministic camera-tour benchmark by serving the built
app, launching a browser pointed at the URL automation surface, and
saving the resulting storm-canyon-camera-tour-benchmark JSON.

Options:
  --tour <name>          Built-in or saved tour name. Default "${DEFAULT_TOUR}".
  --out <path>           Path for the captured benchmark JSON. Default ${DEFAULT_BASELINE_DIR}/<tour>.json.
  --port <n>             Static server port. Default ${DEFAULT_PORT}.
  --wait <ms>            Max wait time for the tour to complete. Default ${DEFAULT_WAIT_MS}.
  --browser <path>       Override path to a Chrome/Edge executable.
  --keep-server          Don't shut down the static server when finished.
  --skip-build           Skip "vite build". Use the existing dist/.
  --no-browser           Do not launch a browser; just serve and wait
                         (useful when you'll open the URL by hand).
  --extra <key=value>    Additional URL params (repeatable).
  --quiet                Reduce log noise.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    tour: DEFAULT_TOUR,
    out: '',
    port: DEFAULT_PORT,
    waitMs: DEFAULT_WAIT_MS,
    browser: '',
    keepServer: false,
    skipBuild: false,
    launchBrowser: true,
    extras: [],
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--tour') args.tour = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--wait') args.waitMs = Number(argv[++i]);
    else if (arg === '--browser') args.browser = argv[++i];
    else if (arg === '--keep-server') args.keepServer = true;
    else if (arg === '--skip-build') args.skipBuild = true;
    else if (arg === '--no-browser') args.launchBrowser = false;
    else if (arg === '--extra') args.extras.push(argv[++i]);
    else if (arg === '--quiet') args.quiet = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!args.out) {
    const safeName = args.tour.replace(/[^A-Za-z0-9._-]+/g, '-');
    args.out = path.join(DEFAULT_BASELINE_DIR, `${safeName}.json`);
  }
  return args;
}

function log(args, message) {
  if (!args.quiet) console.log(message);
}

function findBrowser(override) {
  if (override) return override;
  const candidates = [
    process.env.STORM_CANYON_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (candidate && existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return null;
}

async function buildIfNeeded(args) {
  if (args.skipBuild) {
    log(args, 'Skipping build (--skip-build).');
    return;
  }
  log(args, 'Running "vite build"...');
  await runProcess('npm', ['run', 'build'], { stdio: args.quiet ? 'ignore' : 'inherit' });
}

function runProcess(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { shell: process.platform === 'win32', ...opts });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${argv.join(' ')} exited with code ${code}`));
    });
  });
}

function startServer(args) {
  const child = spawn('node', ['scripts/serve.mjs'], {
    env: { ...process.env, PORT: String(args.port) },
    stdio: args.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
  });
  child.on('error', error => {
    console.error('Failed to start serve.mjs:', error);
    process.exit(2);
  });
  return child;
}

async function waitForServer(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get({ host: 'localhost', port, path: '/', timeout: 1000 }, res => {
          res.resume();
          res.on('end', resolve);
          res.on('error', reject);
          if (res.statusCode && res.statusCode >= 200) resolve();
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
      });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start on port ${port} within ${timeoutMs}ms`);
}

function pollLatestReport(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port, path: '/__storm/automation-report/latest', timeout: 2000 }, res => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(chunks)); }
          catch (error) { reject(error); }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error(`Unexpected status ${res.statusCode}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function waitForReport(args) {
  const deadline = Date.now() + args.waitMs;
  let lastSeen = 0;
  while (Date.now() < deadline) {
    try {
      const report = await pollLatestReport(args.port);
      if (report && Number(report.capturedAt) > lastSeen) {
        lastSeen = Number(report.capturedAt);
        const payload = report.payload ?? report;
        if (payload?.type === 'storm-canyon-camera-tour-benchmark') return payload;
        if (payload?.type === 'storm-canyon-tour-error') {
          throw new Error(`Tour error: ${payload.message}`);
        }
      }
    } catch (error) {
      if (!args.quiet) console.warn('poll error:', error instanceof Error ? error.message : error);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`No tour benchmark received within ${args.waitMs}ms`);
}

function buildAutomationUrl(args) {
  const url = new URL(`http://localhost:${args.port}/`);
  url.searchParams.set('automation', '1');
  url.searchParams.set('automation.actions', 'tour');
  url.searchParams.set('automation.target', 'backend');
  url.searchParams.set('tour', args.tour);
  url.searchParams.set('lod', '1');
  url.searchParams.set('overlayPanelVisible', '0');
  url.searchParams.set('settingsPanelVisible', '0');
  url.searchParams.set('regionBrowserPanelVisible', '0');
  url.searchParams.set('densityPanelVisible', '0');
  for (const extra of args.extras) {
    const eq = extra.indexOf('=');
    if (eq > 0) url.searchParams.set(extra.slice(0, eq), extra.slice(eq + 1));
  }
  return url.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = args.launchBrowser ? findBrowser(args.browser) : null;
  if (args.launchBrowser && !browser) {
    console.error('No Chrome/Edge executable found. Pass --browser <path> or set STORM_CANYON_BROWSER, or pass --no-browser to drive it manually.');
    process.exit(2);
  }
  await buildIfNeeded(args);
  // Wipe the previous latest.json so we don't pick up a stale capture.
  try { rmSync('output/automation/latest.json'); } catch { /* not present */ }
  const server = startServer(args);
  try {
    await waitForServer(args.port);
    const url = buildAutomationUrl(args);
    log(args, `Server up. URL: ${url}`);
    let browserChild = null;
    if (browser) {
      const userDataDir = path.join(os.tmpdir(), `storm-canyon-tour-${Date.now()}`);
      mkdirSync(userDataDir, { recursive: true });
      browserChild = spawn(browser, [
        `--user-data-dir=${userDataDir}`,
        '--no-default-browser-check',
        '--no-first-run',
        '--enable-features=Vulkan',
        '--enable-unsafe-webgpu',
        url,
      ], { stdio: 'ignore', detached: false });
      log(args, `Launched browser: ${browser} (user-data-dir ${userDataDir})`);
    } else {
      console.log(`Open this URL in a WebGPU-enabled browser:\n  ${url}`);
    }
    const benchmark = await waitForReport(args);
    log(args, `Captured benchmark: ${benchmark.sampleCount} samples over ${(benchmark.durationMs / 1000).toFixed(1)}s`);
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(benchmark, null, 2));
    log(args, `Saved to ${args.out}`);
    if (browserChild) {
      try { browserChild.kill(); } catch { /* ignore */ }
    }
    if (!args.quiet) {
      console.log(`Summary: avg ${benchmark.summary.avgFrameMs.toFixed(2)}ms, p95 ${benchmark.summary.p95FrameMs.toFixed(2)}ms, p99 ${benchmark.summary.p99FrameMs.toFixed(2)}ms, peak gpuMB ${benchmark.summary.peakEstimatedGpuMB.toFixed(1)}`);
    }
  } finally {
    if (!args.keepServer) {
      try { server.kill(); } catch { /* ignore */ }
    } else {
      log(args, `Static server still running on port ${args.port} (use Ctrl-C to stop).`);
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
