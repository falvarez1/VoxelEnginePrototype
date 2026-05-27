#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_OVERALL_REGRESSION_PCT = 8;
const DEFAULT_MAX_METRIC_REGRESSION_PCT = 15;
const DEFAULT_MAX_TAIL_REGRESSION_PCT = 25;

const TOP_METRICS = [
  'avgFrameMs',
  'p50FrameMs',
  'p95FrameMs',
  'p99FrameMs',
  'avgDrawCalls',
  'avgUploadMB',
  'avgEstimatedGpuMB',
  'avgWorkerPending',
];

const TAIL_METRICS = ['p95FrameMs', 'p99FrameMs', 'maxFrameMs'];

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/tour-review.mjs <baseline.json> <candidate.json> [options]

Compares two camera tour benchmark artifacts (storm-canyon-camera-tour-benchmark)
and reports per-metric and per-segment deltas. Fails when configurable regression
thresholds are exceeded so AI agents can read "did this tweak regress perf?"
straight out of CI without inspecting JSON by hand.

Options:
  --max-overall <pct>   Maximum average regression across key metrics. Default ${DEFAULT_MAX_OVERALL_REGRESSION_PCT}.
  --max-metric <pct>    Maximum top-level metric regression. Default ${DEFAULT_MAX_METRIC_REGRESSION_PCT}.
  --max-tail <pct>      Maximum p95/p99/max frame-time regression. Default ${DEFAULT_MAX_TAIL_REGRESSION_PCT}.
  --report <path>       Write a JSON comparison report.
  --json                Print machine-readable JSON instead of a text summary.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const files = [];
  const args = {
    maxOverall: DEFAULT_MAX_OVERALL_REGRESSION_PCT,
    maxMetric: DEFAULT_MAX_METRIC_REGRESSION_PCT,
    maxTail: DEFAULT_MAX_TAIL_REGRESSION_PCT,
    report: '',
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--max-overall') args.maxOverall = Number(argv[++i]);
    else if (arg === '--max-metric') args.maxMetric = Number(argv[++i]);
    else if (arg === '--max-tail') args.maxTail = Number(argv[++i]);
    else if (arg === '--report') args.report = argv[++i] ?? '';
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (files.length < 2) usage(1);
  args.baseline = files[0];
  args.candidate = files[1];
  return args;
}

function load(file) {
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed?.type !== 'storm-canyon-camera-tour-benchmark') {
    throw new Error(`${file}: not a storm-canyon-camera-tour-benchmark artifact`);
  }
  if (!parsed.summary || !parsed.perSegment) {
    throw new Error(`${file}: missing summary or perSegment`);
  }
  return parsed;
}

function pct(baseline, candidate) {
  if (!Number.isFinite(baseline) || baseline === 0) return Number.isFinite(candidate) && candidate !== 0 ? Infinity : 0;
  return ((candidate - baseline) / baseline) * 100;
}

function describeDelta(metric, baseline, candidate) {
  const delta = pct(baseline, candidate);
  const sign = delta > 0 ? '+' : '';
  return { metric, baseline, candidate, deltaPct: delta, formatted: `${sign}${delta.toFixed(2)}%` };
}

function compareSummary(baseline, candidate) {
  const rows = [];
  for (const metric of TOP_METRICS) {
    rows.push(describeDelta(metric, baseline.summary[metric] ?? 0, candidate.summary[metric] ?? 0));
  }
  return rows;
}

function compareSegments(baseline, candidate) {
  const map = new Map();
  for (const seg of baseline.perSegment) map.set(seg.segmentIndex, { baseline: seg });
  for (const seg of candidate.perSegment) {
    const entry = map.get(seg.segmentIndex) ?? {};
    entry.candidate = seg;
    map.set(seg.segmentIndex, entry);
  }
  const rows = [];
  for (const [segmentIndex, pair] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    if (!pair.baseline || !pair.candidate) continue;
    rows.push({
      segmentIndex,
      avgFrameMs: describeDelta('avgFrameMs', pair.baseline.avgFrameMs, pair.candidate.avgFrameMs),
      p95FrameMs: describeDelta('p95FrameMs', pair.baseline.p95FrameMs, pair.candidate.p95FrameMs),
      maxFrameMs: describeDelta('maxFrameMs', pair.baseline.maxFrameMs, pair.candidate.maxFrameMs),
      avgDrawCalls: describeDelta('avgDrawCalls', pair.baseline.avgDrawCalls, pair.candidate.avgDrawCalls),
    });
  }
  return rows;
}

const args = parseArgs(process.argv.slice(2));
const baseline = load(args.baseline);
const candidate = load(args.candidate);
if (baseline.tour !== candidate.tour) {
  console.warn(`warning: comparing different tours (${baseline.tour} vs ${candidate.tour})`);
}

const summaryRows = compareSummary(baseline, candidate);
const segmentRows = compareSegments(baseline, candidate);

const overallAvgDelta = summaryRows
  .filter(row => row.metric === 'avgFrameMs' || row.metric === 'p50FrameMs' || row.metric === 'p95FrameMs')
  .reduce((sum, row, _, arr) => sum + row.deltaPct / arr.length, 0);

const failures = [];
if (overallAvgDelta > args.maxOverall) {
  failures.push(`overall frame-time regression ${overallAvgDelta.toFixed(2)}% > ${args.maxOverall}% threshold`);
}
for (const row of summaryRows) {
  const limit = TAIL_METRICS.includes(row.metric) ? args.maxTail : args.maxMetric;
  if (row.deltaPct > limit) failures.push(`metric ${row.metric} regressed ${row.formatted} > ${limit}% threshold`);
}

const report = {
  type: 'storm-canyon-camera-tour-comparison',
  baseline: { file: path.resolve(args.baseline), tour: baseline.tour, startedAt: baseline.startedAt, sampleCount: baseline.sampleCount },
  candidate: { file: path.resolve(args.candidate), tour: candidate.tour, startedAt: candidate.startedAt, sampleCount: candidate.sampleCount },
  thresholds: { overall: args.maxOverall, metric: args.maxMetric, tail: args.maxTail },
  overallAvgDeltaPct: overallAvgDelta,
  summary: summaryRows,
  perSegment: segmentRows,
  failures,
  pass: failures.length === 0,
};

if (args.report) {
  mkdirSync(path.dirname(args.report), { recursive: true });
  writeFileSync(args.report, JSON.stringify(report, null, 2));
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Tour comparison: ${path.basename(args.baseline)} → ${path.basename(args.candidate)}`);
  console.log(`Tours: ${baseline.tour} (${baseline.sampleCount} samples) vs ${candidate.tour} (${candidate.sampleCount} samples)`);
  console.log(`Overall avg frame-time delta: ${overallAvgDelta > 0 ? '+' : ''}${overallAvgDelta.toFixed(2)}%`);
  console.log('Summary metrics:');
  for (const row of summaryRows) {
    const baseStr = typeof row.baseline === 'number' ? row.baseline.toFixed(3) : String(row.baseline);
    const candStr = typeof row.candidate === 'number' ? row.candidate.toFixed(3) : String(row.candidate);
    console.log(`  ${row.metric.padEnd(22)} ${baseStr.padStart(10)} -> ${candStr.padStart(10)}  ${row.formatted}`);
  }
  if (segmentRows.length > 0) {
    console.log('Per-segment frame-time deltas (avg / p95 / max):');
    for (const seg of segmentRows) {
      console.log(`  seg ${String(seg.segmentIndex).padStart(2)}  avg ${seg.avgFrameMs.formatted}  p95 ${seg.p95FrameMs.formatted}  max ${seg.maxFrameMs.formatted}`);
    }
  }
  if (failures.length === 0) {
    console.log('PASS: no thresholds exceeded.');
  } else {
    console.log('FAIL:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
}

if (failures.length > 0) process.exit(1);
