import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_OVERALL_REGRESSION_PCT = 15;
const DEFAULT_MAX_METRIC_REGRESSION_PCT = 25;
const DEFAULT_MAX_SCENE_REGRESSION_PCT = 35;

const TOP_LEVEL_METRICS = [
  'avgGenerateMs',
  'avgCachedRemeshMs',
  'avgEditRemeshMs',
  'avgBuildRemeshMs',
  'avgBoxRemeshMs',
  'avgCapsuleRemeshMs',
  'avgSmoothRemeshMs',
  'avgFlattenRemeshMs',
];

const OVERALL_METRICS = [
  'avgGenerateMs',
  'avgCachedRemeshMs',
  'avgEditRemeshMs',
  'avgSmoothRemeshMs',
  'avgFlattenRemeshMs',
];

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/benchmark-review.mjs <baseline.json> <candidate.json> [options]

Compares Storm Canyon browser-worker benchmark artifacts, quality captures, or diagnostic captures.

Options:
  --max-overall <pct>  Maximum average regression across key metrics. Default ${DEFAULT_MAX_OVERALL_REGRESSION_PCT}.
  --max-metric <pct>   Maximum top-level metric regression. Default ${DEFAULT_MAX_METRIC_REGRESSION_PCT}.
  --max-scene <pct>    Maximum per-scene metric regression. Default ${DEFAULT_MAX_SCENE_REGRESSION_PCT}.
  --report <path>      Write a JSON comparison report.
  --json               Print machine-readable JSON instead of a text summary.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const files = [];
  const args = {
    maxOverall: DEFAULT_MAX_OVERALL_REGRESSION_PCT,
    maxMetric: DEFAULT_MAX_METRIC_REGRESSION_PCT,
    maxScene: DEFAULT_MAX_SCENE_REGRESSION_PCT,
    report: '',
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--max-overall') args.maxOverall = Number(argv[++i]);
    else if (arg === '--max-metric') args.maxMetric = Number(argv[++i]);
    else if (arg === '--max-scene') args.maxScene = Number(argv[++i]);
    else if (arg === '--report') args.report = argv[++i] ?? '';
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (files.length !== 2) throw new Error('Expected baseline and candidate JSON files.');
  for (const [name, value] of [['--max-overall', args.maxOverall], ['--max-metric', args.maxMetric], ['--max-scene', args.maxScene]]) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  }
  return { baselinePath: files[0], candidatePath: files[1], ...args };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function isBenchmarkSummary(value) {
  return Boolean(
    value
    && typeof value.avgGenerateMs === 'number'
    && typeof value.avgCachedRemeshMs === 'number'
    && typeof value.avgEditRemeshMs === 'number'
    && Array.isArray(value.scenes)
  );
}

function normalizeCapture(value, fallbackCapturedAt = 0) {
  if (!value || typeof value !== 'object') return null;
  if (isBenchmarkSummary(value)) {
    return {
      capturedAt: value.capturedAt ?? fallbackCapturedAt,
      benchmarkId: value.benchmarkId ?? 'benchmark-summary',
      result: value,
    };
  }
  if (isBenchmarkSummary(value.result)) {
    return {
      capturedAt: Number(value.capturedAt ?? value.result.capturedAt ?? fallbackCapturedAt) || 0,
      benchmarkId: String(value.benchmarkId ?? value.result.benchmarkId ?? 'benchmark-capture'),
      result: value.result,
      capabilities: value.capabilities ?? null,
      settings: value.settings ?? null,
    };
  }
  return null;
}

function extractBenchmarkCaptures(document, sourcePath) {
  const candidates = [
    document?.captures,
    document?.browserWorkerBenchmarks,
    document?.runtime?.browserWorkerBenchmarks,
    document?.capture?.browserWorkerBenchmark,
    document?.browserWorkerBenchmark,
    ...(Array.isArray(document?.recentCaptures)
      ? document.recentCaptures.map(capture => capture?.browserWorkerBenchmark)
      : []),
  ];
  const captures = [];
  for (const candidate of candidates) {
    for (const value of asArray(candidate)) {
      const capture = normalizeCapture(value, Number(document?.exportedAt ?? document?.capturedAt ?? 0) || 0);
      if (capture) captures.push(capture);
    }
  }
  const byId = new Map();
  for (const capture of captures) byId.set(capture.benchmarkId, capture);
  const normalized = [...byId.values()].sort((a, b) => b.capturedAt - a.capturedAt);
  if (normalized.length === 0) throw new Error(`No browser worker benchmark captures found in ${sourcePath}.`);
  return normalized;
}

function pctDelta(candidate, baseline) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline) || baseline <= 0) return 0;
  return ((candidate - baseline) / baseline) * 100;
}

function compareMetric(name, baseline, candidate) {
  const baselineValue = Number(baseline?.[name]);
  const candidateValue = Number(candidate?.[name]);
  return {
    name,
    baseline: Number.isFinite(baselineValue) ? baselineValue : 0,
    candidate: Number.isFinite(candidateValue) ? candidateValue : 0,
    deltaPct: pctDelta(candidateValue, baselineValue),
  };
}

function compareScenes(baseline, candidate) {
  const baselineScenes = new Map((baseline.scenes ?? []).map(scene => [scene.scene, scene]));
  const candidateScenes = new Map((candidate.scenes ?? []).map(scene => [scene.scene, scene]));
  const sceneNames = [...new Set([...baselineScenes.keys(), ...candidateScenes.keys()])].sort();
  return sceneNames.map(scene => {
    const baselineScene = baselineScenes.get(scene);
    const candidateScene = candidateScenes.get(scene);
    const metrics = TOP_LEVEL_METRICS
      .filter(name => baselineScene && candidateScene && name in baselineScene && name in candidateScene)
      .map(name => compareMetric(name, baselineScene, candidateScene));
    return {
      scene,
      status: baselineScene && candidateScene ? 'compared' : baselineScene ? 'missing-candidate' : 'missing-baseline',
      metrics,
      maxRegressionPct: Math.max(0, ...metrics.map(metric => metric.deltaPct)),
    };
  });
}

function summarizeComparison(args, baselineCapture, candidateCapture) {
  const topMetrics = TOP_LEVEL_METRICS
    .filter(name => name in baselineCapture.result && name in candidateCapture.result)
    .map(name => compareMetric(name, baselineCapture.result, candidateCapture.result));
  const overallMetrics = topMetrics.filter(metric => OVERALL_METRICS.includes(metric.name));
  const overallDeltaPct = overallMetrics.length > 0
    ? overallMetrics.reduce((total, metric) => total + metric.deltaPct, 0) / overallMetrics.length
    : 0;
  const scenes = compareScenes(baselineCapture.result, candidateCapture.result);
  const maxMetricRegressionPct = Math.max(0, ...topMetrics.map(metric => metric.deltaPct));
  const maxSceneRegressionPct = Math.max(0, ...scenes.map(scene => scene.maxRegressionPct));
  const missingScenes = scenes.filter(scene => scene.status !== 'compared').map(scene => scene.scene);
  const failures = [];
  if (overallDeltaPct > args.maxOverall) failures.push(`overall regression ${overallDeltaPct.toFixed(1)}% > ${args.maxOverall}%`);
  if (maxMetricRegressionPct > args.maxMetric) failures.push(`metric regression ${maxMetricRegressionPct.toFixed(1)}% > ${args.maxMetric}%`);
  if (maxSceneRegressionPct > args.maxScene) failures.push(`scene regression ${maxSceneRegressionPct.toFixed(1)}% > ${args.maxScene}%`);
  if (missingScenes.length > 0) failures.push(`scene set mismatch: ${missingScenes.join(', ')}`);
  return {
    type: 'storm-canyon-benchmark-review',
    version: 1,
    reviewedAt: new Date().toISOString(),
    status: failures.length === 0 ? 'pass' : 'fail',
    thresholds: {
      maxOverallRegressionPct: args.maxOverall,
      maxMetricRegressionPct: args.maxMetric,
      maxSceneRegressionPct: args.maxScene,
    },
    baseline: {
      source: args.baselinePath,
      capturedAt: baselineCapture.capturedAt,
      benchmarkId: baselineCapture.benchmarkId,
      chunks: baselineCapture.result.chunks,
    },
    candidate: {
      source: args.candidatePath,
      capturedAt: candidateCapture.capturedAt,
      benchmarkId: candidateCapture.benchmarkId,
      chunks: candidateCapture.result.chunks,
    },
    overallDeltaPct,
    maxMetricRegressionPct,
    maxSceneRegressionPct,
    metrics: topMetrics,
    scenes,
    failures,
  };
}

function formatSummary(report) {
  const lines = [
    `Benchmark review: ${report.status.toUpperCase()}`,
    `Baseline ${report.baseline.benchmarkId} -> candidate ${report.candidate.benchmarkId}`,
    `Overall delta: ${report.overallDeltaPct >= 0 ? '+' : ''}${report.overallDeltaPct.toFixed(1)}%`,
    `Max metric regression: ${report.maxMetricRegressionPct.toFixed(1)}%`,
    `Max scene regression: ${report.maxSceneRegressionPct.toFixed(1)}%`,
    'Top-level metrics:',
  ];
  for (const metric of report.metrics) {
    lines.push(`  ${metric.name}: ${metric.baseline.toFixed(2)} -> ${metric.candidate.toFixed(2)} ms (${metric.deltaPct >= 0 ? '+' : ''}${metric.deltaPct.toFixed(1)}%)`);
  }
  if (report.failures.length > 0) {
    lines.push('Failures:');
    for (const failure of report.failures) lines.push(`  - ${failure}`);
  }
  return lines.join('\n');
}

function writeReport(filePath, report) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baselineCaptures = extractBenchmarkCaptures(readJson(args.baselinePath), args.baselinePath);
  const candidateCaptures = extractBenchmarkCaptures(readJson(args.candidatePath), args.candidatePath);
  const report = summarizeComparison(args, baselineCaptures[0], candidateCaptures[0]);
  if (args.report) writeReport(args.report, report);
  console.log(args.json ? JSON.stringify(report, null, 2) : formatSummary(report));
  if (report.status !== 'pass') process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
