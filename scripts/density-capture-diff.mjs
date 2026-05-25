import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log(`Usage: node scripts/density-capture-diff.mjs <baseline.json> <candidate.json> [options]

Options:
  --set=<name|index>          Select a capture set by name or zero-based index.
  --capture=<index|selected|latest>
                              Select a capture within the set. Default: selected.
  --max-mean=<meters>         Fail if mean absolute SDF delta is above this value.
  --max-max=<meters>          Fail if max absolute SDF delta is above this value.
  --max-changed=<ratio>       Fail if changed-cell ratio is above this value, 0..1.
  --json                      Print machine-readable summary.
`);
}

function parseArgs(argv) {
  const files = [];
  const options = {
    set: undefined,
    capture: 'selected',
    maxMean: Number.POSITIVE_INFINITY,
    maxMax: Number.POSITIVE_INFINITY,
    maxChanged: Number.POSITIVE_INFINITY,
    json: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--set=')) {
      options.set = arg.slice('--set='.length);
    } else if (arg.startsWith('--capture=')) {
      options.capture = arg.slice('--capture='.length);
    } else if (arg.startsWith('--max-mean=')) {
      options.maxMean = numberOption(arg, '--max-mean=');
    } else if (arg.startsWith('--max-max=')) {
      options.maxMax = numberOption(arg, '--max-max=');
    } else if (arg.startsWith('--max-changed=')) {
      options.maxChanged = numberOption(arg, '--max-changed=');
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 2) {
    usage();
    throw new Error('Expected baseline and candidate JSON files.');
  }
  return { baselinePath: files[0], candidatePath: files[1], options };
}

function numberOption(arg, prefix) {
  const value = Number(arg.slice(prefix.length));
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid numeric option: ${arg}`);
  return value;
}

function readJson(filePath) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function normalizeLibrary(raw, label) {
  const sets = Array.isArray(raw?.sets)
    ? raw.sets
    : Array.isArray(raw?.captures)
      ? [{ name: raw.name ?? 'Default Set', captures: raw.captures, selectedIndex: raw.selectedIndex ?? 0 }]
      : [];
  if (sets.length === 0) throw new Error(`${label} has no density capture sets.`);
  return {
    sets: sets.map((set, index) => normalizeSet(set, `Set ${index + 1}`)),
    selectedSetIndex: clampIndex(Number(raw?.selectedSetIndex) || 0, sets.length),
  };
}

function normalizeSet(raw, fallbackName) {
  const captures = Array.isArray(raw?.captures) ? raw.captures.map(normalizeCapture) : [];
  return {
    name: String(raw?.name ?? fallbackName),
    captures,
    selectedIndex: captures.length > 0 ? clampIndex(Number(raw?.selectedIndex) || 0, captures.length) : -1,
  };
}

function normalizeCapture(raw) {
  const values = Array.isArray(raw?.values) ? raw.values.map(value => clampInt(Number(value) || 0, -32768, 32767)) : [];
  return {
    key: String(raw?.key ?? 'capture'),
    axis: raw?.axis === 'x' || raw?.axis === 'z' ? raw.axis : 'y',
    sliceIndex: Number(raw?.sliceIndex) || 0,
    size: Number(raw?.size) || Math.sqrt(values.length),
    scale: Number(raw?.scale) || 256,
    values,
    capturedAt: Number(raw?.capturedAt) || 0,
  };
}

function clampIndex(value, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, value | 0));
}

function clampInt(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value | 0));
}

function selectSet(library, selector, label) {
  if (selector === undefined) return library.sets[library.selectedSetIndex];
  const index = Number(selector);
  if (Number.isInteger(index)) {
    if (!library.sets[index]) throw new Error(`${label} has no density capture set at index ${index}.`);
    return library.sets[index];
  }
  const found = library.sets.find(set => set.name === selector);
  if (!found) throw new Error(`${label} has no density capture set named "${selector}".`);
  return found;
}

function selectCapture(set, selector, label) {
  if (set.captures.length === 0) throw new Error(`${label} set "${set.name}" has no captures.`);
  if (selector === 'latest') return set.captures[set.captures.length - 1];
  if (selector === 'selected') return set.captures[clampIndex(set.selectedIndex, set.captures.length)];
  const index = Number(selector);
  if (!Number.isInteger(index) || !set.captures[index]) {
    throw new Error(`${label} set "${set.name}" has no capture at index ${selector}.`);
  }
  return set.captures[index];
}

function compareCaptures(baseline, candidate) {
  if (baseline.axis !== candidate.axis || baseline.size !== candidate.size || baseline.values.length !== candidate.values.length) {
    throw new Error(`Incompatible captures: ${baseline.axis}/${baseline.size}/${baseline.values.length} vs ${candidate.axis}/${candidate.size}/${candidate.values.length}.`);
  }
  let changedCells = 0;
  let sumAbsMeters = 0;
  let maxAbsMeters = 0;
  for (let i = 0; i < baseline.values.length; i++) {
    const delta = Math.abs((candidate.values[i] / candidate.scale) - (baseline.values[i] / baseline.scale));
    if (delta > 0) changedCells++;
    sumAbsMeters += delta;
    maxAbsMeters = Math.max(maxAbsMeters, delta);
  }
  const cells = baseline.values.length;
  return {
    baselineKey: baseline.key,
    candidateKey: candidate.key,
    axis: baseline.axis,
    sliceIndex: baseline.sliceIndex,
    cells,
    changedCells,
    changedRatio: cells > 0 ? changedCells / cells : 0,
    meanAbsMeters: cells > 0 ? sumAbsMeters / cells : 0,
    maxAbsMeters,
  };
}

function enforceThresholds(summary, options) {
  const failures = [];
  if (summary.meanAbsMeters > options.maxMean) failures.push(`mean ${summary.meanAbsMeters.toFixed(4)}m > ${options.maxMean}m`);
  if (summary.maxAbsMeters > options.maxMax) failures.push(`max ${summary.maxAbsMeters.toFixed(4)}m > ${options.maxMax}m`);
  if (summary.changedRatio > options.maxChanged) failures.push(`changed ${(summary.changedRatio * 100).toFixed(2)}% > ${(options.maxChanged * 100).toFixed(2)}%`);
  return failures;
}

try {
  const { baselinePath, candidatePath, options } = parseArgs(process.argv.slice(2));
  const baselineLibrary = normalizeLibrary(readJson(baselinePath), 'baseline');
  const candidateLibrary = normalizeLibrary(readJson(candidatePath), 'candidate');
  const baselineSet = selectSet(baselineLibrary, options.set, 'baseline');
  const candidateSet = selectSet(candidateLibrary, options.set, 'candidate');
  const baseline = selectCapture(baselineSet, options.capture, 'baseline');
  const candidate = selectCapture(candidateSet, options.capture, 'candidate');
  const summary = compareCaptures(baseline, candidate);
  const failures = enforceThresholds(summary, options);
  const result = { ...summary, passed: failures.length === 0, failures };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Density capture diff ${result.passed ? 'passed' : 'failed'}: ${summary.changedCells}/${summary.cells} cells changed ` +
      `(${(summary.changedRatio * 100).toFixed(2)}%), mean ${summary.meanAbsMeters.toFixed(4)}m, max ${summary.maxAbsMeters.toFixed(4)}m.`,
    );
    for (const failure of failures) console.error(`- ${failure}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
