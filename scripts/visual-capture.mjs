import { existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_PORT = 5192;
const DEFAULT_OUT_DIR = 'output/playwright/visual-capture';
const DEFAULT_BASELINE = 'docs/visual-quality-baseline.json';
const DEFAULT_REPORT_DIR = 'output/playwright/visual-reports';
const DEFAULT_WAIT_MS = 9000;
const DEFAULT_SERVER_TIMEOUT_MS = 30000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 90000;
const DEFAULT_CHANNEL = process.platform === 'win32' ? 'chrome' : '';
const DEFAULT_CASES = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080, file: 'desktop-1920x1080.png' },
  { name: 'desktop-1680x945', width: 1680, height: 945, file: 'desktop-1680x945.png' },
  { name: 'mobile-390x844', width: 390, height: 844, file: 'mobile-390x844.png' },
];

function usage(exitCode = 0) {
  const text = `
Usage:
  node scripts/visual-capture.mjs
  node scripts/visual-capture.mjs --update
  node scripts/visual-capture.mjs --case desktop-1680x945
  node scripts/visual-capture.mjs --url http://127.0.0.1:5173 --no-server

Options:
  --case <name>       Capture only one named case. Can be repeated.
  --out-dir <path>    Screenshot output directory. Defaults to ${DEFAULT_OUT_DIR}.
  --baseline <path>   Visual baseline JSON. Defaults to ${DEFAULT_BASELINE}.
  --report-dir <path> Visual comparison report directory. Defaults to ${DEFAULT_REPORT_DIR}.
  --port <port>       Vite dev-server port when starting a server. Defaults to ${DEFAULT_PORT}.
  --url <url>         Existing app URL. Defaults to http://127.0.0.1:<port>.
  --no-server         Do not start Vite; use --url or the default URL.
  --update            Update baseline cases after capture instead of comparing.
  --wait <ms>         Wait after page load before screenshot. Defaults to ${DEFAULT_WAIT_MS}.
  --channel <name>    Playwright Chromium channel, such as chrome or msedge. Defaults to ${DEFAULT_CHANNEL || 'bundled Chromium'}.
  --list              List built-in capture cases.
`;
  console.log(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    baseline: DEFAULT_BASELINE,
    reportDir: DEFAULT_REPORT_DIR,
    outDir: DEFAULT_OUT_DIR,
    port: DEFAULT_PORT,
    url: '',
    noServer: false,
    update: false,
    waitMs: DEFAULT_WAIT_MS,
    channel: DEFAULT_CHANNEL,
    cases: [],
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--baseline') args.baseline = argv[++i] ?? '';
    else if (arg === '--report-dir') args.reportDir = argv[++i] ?? '';
    else if (arg === '--out-dir') args.outDir = argv[++i] ?? '';
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--url') args.url = argv[++i] ?? '';
    else if (arg === '--no-server') args.noServer = true;
    else if (arg === '--update') args.update = true;
    else if (arg === '--wait') args.waitMs = Number(argv[++i]);
    else if (arg === '--channel') args.channel = argv[++i] ?? '';
    else if (arg === '--case') args.cases.push(argv[++i] ?? '');
    else if (arg === '--list') args.list = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.baseline) throw new Error('--baseline requires a path');
  if (!args.reportDir) throw new Error('--report-dir requires a path');
  if (!args.outDir) throw new Error('--out-dir requires a path');
  if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) throw new Error('--port must be a valid port');
  if (!Number.isFinite(args.waitMs) || args.waitMs < 0) throw new Error('--wait must be a non-negative number');
  return args;
}

function commandName(command) {
  return command;
}

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0;
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? 'pipe',
    shell: options.shell ?? (process.platform === 'win32'),
  });
  let stdout = '';
  let stderr = '';
  let timeout = null;
  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
  }
  child.stdout?.on('data', chunk => {
    stdout += chunk.toString();
    if (options.echo) process.stdout.write(chunk);
  });
  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
    if (options.echo) process.stderr.write(chunk);
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stdout}${stderr}`));
    });
  });
}

function requestOk(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await requestOk(url)) return;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startViteServer(port) {
  const viteCli = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
  });
  child.stdout?.on('data', chunk => process.stdout.write(chunk));
  child.stderr?.on('data', chunk => process.stderr.write(chunk));
  child.on('exit', code => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`visual capture dev server exited with code ${code}\n`);
    }
  });
  return child;
}

function selectCases(names) {
  if (names.length === 0) return DEFAULT_CASES;
  const byName = new Map(DEFAULT_CASES.map(item => [item.name, item]));
  return names.map(name => {
    const item = byName.get(name);
    if (!item) throw new Error(`Unknown visual capture case "${name}". Use --list to see cases.`);
    return item;
  });
}

async function captureCase(appUrl, outDir, item, args) {
  const outPath = path.join(outDir, item.file);
  const npx = commandName('npx');
  const cliArgs = [
    '--yes',
    'playwright',
    'screenshot',
    '--browser',
    'chromium',
    '--viewport-size',
    `${item.width},${item.height}`,
    '--wait-for-timeout',
    String(Math.trunc(args.waitMs)),
    '--timeout',
    String(DEFAULT_CAPTURE_TIMEOUT_MS),
  ];
  if (args.channel) cliArgs.push('--channel', args.channel);
  cliArgs.push(appUrl, outPath);
  await run(npx, cliArgs, { timeoutMs: DEFAULT_CAPTURE_TIMEOUT_MS + args.waitMs + 15000, echo: true });
  if (!existsSync(outPath)) throw new Error(`Expected screenshot was not created: ${outPath}`);
  return outPath;
}

async function checkCase(imagePath, item, args) {
  const node = process.execPath;
  const regressionArgs = [
    'scripts/visual-regression.mjs',
    '--baseline',
    args.baseline,
    '--name',
    item.name,
    '--image',
    imagePath,
  ];
  if (args.update) regressionArgs.push('--update');
  else regressionArgs.push('--report-dir', args.reportDir);
  await run(node, regressionArgs, { timeoutMs: 30000, echo: true, shell: false });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const item of DEFAULT_CASES) console.log(`${item.name}\t${item.width}x${item.height}\t${item.file}`);
    return;
  }

  const cases = selectCases(args.cases);
  const appUrl = args.url || `http://127.0.0.1:${args.port}`;
  mkdirSync(args.outDir, { recursive: true });

  let server = null;
  try {
    if (!args.noServer) {
      server = startViteServer(args.port);
      await waitForServer(appUrl, DEFAULT_SERVER_TIMEOUT_MS);
    }

    for (const item of cases) {
      console.log(`Capturing ${item.name} (${item.width}x${item.height})`);
      const screenshot = await captureCase(appUrl, args.outDir, item, args);
      await checkCase(screenshot, item, args);
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (server.exitCode === null) server.kill('SIGKILL');
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
