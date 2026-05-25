import fs from 'node:fs';
import ts from 'typescript';

const args = new Set(process.argv.slice(2));
const update = args.has('--update');
const jsonOutput = args.has('--json');

const baselineUrl = new URL('../docs/worldgen-tile-baseline.json', import.meta.url);
const terrainMathUrl = new URL('../src/terrain_math.ts', import.meta.url);
const worldgenTilesUrl = new URL('../src/worldgen_tiles.ts', import.meta.url);
const caveTilesUrl = new URL('../src/cave_tiles.ts', import.meta.url);
const erosionTilesUrl = new URL('../src/erosion_tiles.ts', import.meta.url);
const materialTilesUrl = new URL('../src/material_tiles.ts', import.meta.url);
const wasmUrl = new URL('../public/voxel_core.wasm', import.meta.url);

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

const SCENES = [
  { name: 'origin-canyon', x: 0, z: 0 },
  { name: 'river-bend', x: -96, z: 128 },
  { name: 'alpine-ridge', x: -224, z: -192 },
];

const CAVE_GRAPH_PASSAGE_FIELD_NAMES = [
  'kind',
  'idValue',
  'branchCell',
  'startX',
  'startY',
  'startZ',
  'endX',
  'endY',
  'endZ',
  'centerX',
  'centerY',
  'centerZ',
  'radius',
  'length',
  'chamberCell',
  'biomeHook',
];

const CAVE_GRAPH_CHAMBER_FIELD_NAMES = [
  'branchCell',
  'centerX',
  'centerY',
  'centerZ',
  'radius',
  'hasShaft',
  'biomeHook',
];

function usage() {
  console.log(`Usage: node scripts/worldgen-tile-regression.mjs [--update] [--json]

Compares deterministic worldgen tile summaries against docs/worldgen-tile-baseline.json.
Use --update after intentional worldgen tile field changes.
`);
}

if (args.has('--help') || args.has('-h')) {
  usage();
  process.exit(0);
}

for (const arg of args) {
  if (arg !== '--update' && arg !== '--json') throw new Error(`Unknown option: ${arg}`);
}

function readText(url) {
  return fs.readFileSync(url, 'utf8');
}

function transpileTs(source, fileName) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
    },
    fileName,
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0) {
    const message = errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n');
    throw new Error(`Failed to transpile ${fileName}:\n${message}`);
  }
  return result.outputText;
}

function moduleUrl(js) {
  return `data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`;
}

async function loadWorldgenModule() {
  const terrainJs = transpileTs(readText(terrainMathUrl), 'terrain_math.ts');
  const terrainModuleUrl = moduleUrl(terrainJs);
  const worldgenSource = readText(worldgenTilesUrl).replace("'./terrain_math.ts'", `'${terrainModuleUrl}'`);
  const worldgenJs = transpileTs(worldgenSource, 'worldgen_tiles.ts');
  return import(moduleUrl(worldgenJs));
}

async function loadCaveGraphModule() {
  const terrainJs = transpileTs(readText(terrainMathUrl), 'terrain_math.ts');
  const terrainModuleUrl = moduleUrl(terrainJs);
  const caveSource = readText(caveTilesUrl).replace("'./terrain_math.ts'", `'${terrainModuleUrl}'`);
  const caveJs = transpileTs(caveSource, 'cave_tiles.ts');
  return import(moduleUrl(caveJs));
}

async function loadErosionModule() {
  const terrainJs = transpileTs(readText(terrainMathUrl), 'terrain_math.ts');
  const terrainModuleUrl = moduleUrl(terrainJs);
  const erosionSource = readText(erosionTilesUrl).replace("'./terrain_math.ts'", `'${terrainModuleUrl}'`);
  const erosionJs = transpileTs(erosionSource, 'erosion_tiles.ts');
  return import(moduleUrl(erosionJs));
}

async function loadMaterialModule() {
  const materialJs = transpileTs(readText(materialTilesUrl), 'material_tiles.ts');
  return import(moduleUrl(materialJs));
}

function testWorldgenTileWorkerQueue(WorldgenTileCache) {
  let accepting = false;
  const dispatched = [];
  const cache = new WorldgenTileCache(64, (tileX, tileZ) => {
    if (!accepting) return false;
    dispatched.push(`${tileX},${tileZ}`);
    return true;
  });
  cache.exportTilesAround(0, 0, 1);
  accepting = true;
  cache.pumpWorkerQueue(1);
  if (dispatched[0] !== '0,0') {
    throw new Error(`Expected prioritized worldgen worker queue to dispatch center tile first, got ${dispatched[0] ?? 'none'}`);
  }

  accepting = false;
  const reprioritized = [];
  const reprioritizeCache = new WorldgenTileCache(64, (tileX, tileZ) => {
    if (!accepting) return false;
    reprioritized.push(`${tileX},${tileZ}`);
    return true;
  });
  reprioritizeCache.exportTilesAround(0, 0, 1);
  reprioritizeCache.sample(-256, -256);
  accepting = true;
  reprioritizeCache.pumpWorkerQueue(1);
  if (reprioritized[0] !== '-1,-1') {
    throw new Error(`Expected sample probe to reprioritize queued worldgen tile -1,-1, got ${reprioritized[0] ?? 'none'}`);
  }
  const stats = reprioritizeCache.stats();
  if (stats.workerQueueReprioritized < 1) {
    throw new Error('Expected worldgen tile queue reprioritization telemetry to increment after sample probe.');
  }
}

function testCaveGraphTileCache(CaveGraphTileCache) {
  const cache = new CaveGraphTileCache();
  cache.ensureTilesAround(0, 0, 1);
  const probe = cache.sample(0, 0, 0);
  if (!probe.nearestPassageId) throw new Error('Expected origin cave graph probe to find a nearest passage.');
  if (!Number.isFinite(probe.signedDistance)) throw new Error('Expected cave graph probe signed distance to be finite.');
  const exported = cache.exportTilesAround(0, 0, 1);
  if (exported.tiles.length !== 9) throw new Error(`Expected cave graph export to include 9 tiles, got ${exported.tiles.length}.`);
  const stats = cache.stats();
  if (stats.passages <= 0 || stats.chambers <= 0) throw new Error('Expected cave graph tile stats to include passages and chambers.');

  let accepting = false;
  const dispatched = [];
  const workerCache = new CaveGraphTileCache(64, (tileX, tileZ) => {
    if (!accepting) return false;
    dispatched.push(`${tileX},${tileZ}`);
    return true;
  });
  workerCache.exportTilesAround(0, 0, 1);
  accepting = true;
  workerCache.pumpWorkerQueue(1);
  if (dispatched[0] !== '0,0') {
    throw new Error(`Expected prioritized cave graph worker queue to dispatch center tile first, got ${dispatched[0] ?? 'none'}`);
  }
  const centerTile = exported.tiles.find(tile => tile.key === '0,0') ?? exported.tiles[0];
  if (!workerCache.adoptWorkerTile(centerTile)) throw new Error('Expected cave graph worker tile adoption to accept a valid serialized tile.');
  const adoptedStats = workerCache.stats();
  if (adoptedStats.nativeTiles !== 1 || adoptedStats.workerAdoptedTiles !== 1 || adoptedStats.workerResponses !== 1) {
    throw new Error('Expected cave graph native tile adoption telemetry to increment.');
  }

  accepting = false;
  const reprioritized = [];
  const reprioritizeCache = new CaveGraphTileCache(64, (tileX, tileZ) => {
    if (!accepting) return false;
    reprioritized.push(`${tileX},${tileZ}`);
    return true;
  });
  reprioritizeCache.exportTilesAround(0, 0, 1);
  reprioritizeCache.sample(-256, 0, -256);
  accepting = true;
  reprioritizeCache.pumpWorkerQueue(1);
  if (reprioritized[0] !== '-1,-1') {
    throw new Error(`Expected sample probe to reprioritize queued cave graph tile -1,-1, got ${reprioritized[0] ?? 'none'}`);
  }
  if (reprioritizeCache.stats().workerQueueReprioritized < 1) {
    throw new Error('Expected cave graph worker queue reprioritization telemetry to increment after sample probe.');
  }
}

async function flushMicrotasks(count = 3) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

async function testErosionTileCache(ErosionTileCache) {
  const cache = new ErosionTileCache();
  cache.ensureTilesAround(0, 0, 1);
  const probe = cache.sample(0, 0);
  for (const [name, value] of Object.entries(probe)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Expected finite erosion probe ${name}, got ${value}`);
  }
  for (const key of ['slope', 'drainage', 'streamPower', 'thermalErosion', 'hydraulicErosion', 'deposition', 'sedimentLoad', 'bedrockExposure', 'soilDepth', 'vegetationRetention']) {
    const value = probe[key];
    if (value < -0.0001 || value > 1.0001) throw new Error(`Expected erosion probe ${key} to be normalized, got ${value}`);
  }
  const exported = cache.exportTilesAround(0, 0, 1);
  if (exported.tiles.length !== 9) throw new Error(`Expected erosion export to include 9 tiles, got ${exported.tiles.length}.`);
  if (exported.fieldNames.length !== 11) throw new Error(`Expected 11 erosion fields, got ${exported.fieldNames.length}.`);
  const expectedFields = 17 * 17 * exported.fieldNames.length;
  for (const tile of exported.tiles) {
    if (tile.fields.length !== expectedFields) throw new Error(`Expected erosion tile ${tile.key} to have ${expectedFields} fields, got ${tile.fields.length}.`);
  }
  let accepting = false;
  const dispatched = [];
  const workerCache = new ErosionTileCache(64, (tileX, tileZ) => {
    if (!accepting) return false;
    dispatched.push(`${tileX},${tileZ}`);
    return true;
  });
  workerCache.exportTilesAround(0, 0, 1);
  accepting = true;
  workerCache.pumpWorkerQueue(1);
  if (dispatched[0] !== '0,0') {
    throw new Error(`Expected prioritized erosion worker queue to dispatch center tile first, got ${dispatched[0] ?? 'none'}`);
  }
  const centerTile = exported.tiles.find(tile => tile.key === '0,0');
  if (!centerTile || !workerCache.adoptWorkerTile(centerTile)) throw new Error('Expected erosion worker tile adoption to accept a valid serialized tile.');
  const adoptedStats = workerCache.stats();
  if (adoptedStats.nativeTiles !== 1 || adoptedStats.workerAdoptedTiles !== 1 || adoptedStats.workerResponses !== 1) {
    throw new Error('Expected erosion native tile adoption telemetry to increment.');
  }
  let savedTile = null;
  const saveCache = new ErosionTileCache();
  saveCache.setPersistenceProvider({
    async loadTile() {
      return { tile: null };
    },
    async saveTile(tile) {
      savedTile = tile;
      return { pruned: 2, records: 7 };
    },
  });
  saveCache.adoptWorkerTile(centerTile);
  await flushMicrotasks();
  const saveStats = saveCache.stats();
  if (!savedTile || saveStats.persistenceSaves !== 1 || saveStats.persistencePruned !== 2 || saveStats.persistenceRecords !== 7) {
    throw new Error('Expected erosion persistence save/prune telemetry after native tile adoption.');
  }
  const loadCache = new ErosionTileCache();
  loadCache.setPersistenceProvider({
    async loadTile() {
      return { tile: centerTile, records: 9 };
    },
    async saveTile() {
      return {};
    },
  });
  loadCache.sample(0, 0);
  await flushMicrotasks();
  const loadStats = loadCache.stats();
  if (loadStats.persistedTiles !== 1 || loadStats.persistenceLoads !== 1 || loadStats.persistenceHits !== 1 || loadStats.persistenceRecords !== 9) {
    throw new Error('Expected erosion persistence load/hit telemetry to adopt a stored tile.');
  }
  const invalidCache = new ErosionTileCache();
  invalidCache.setPersistenceProvider({
    async loadTile() {
      return { tile: null, invalidated: true, records: 8 };
    },
    async saveTile() {
      return {};
    },
  });
  invalidCache.sample(0, 0);
  await flushMicrotasks();
  const invalidStats = invalidCache.stats();
  if (invalidStats.persistenceInvalidated !== 1 || invalidStats.persistenceMisses !== 1 || invalidStats.persistenceRecords !== 8) {
    throw new Error('Expected erosion persistence invalidation telemetry to increment.');
  }
  const reprioritized = [];
  accepting = false;
  const reprioritizeCache = new ErosionTileCache(64, (tileX, tileZ) => {
    if (!accepting) return false;
    reprioritized.push(`${tileX},${tileZ}`);
    return true;
  });
  reprioritizeCache.exportTilesAround(0, 0, 1);
  reprioritizeCache.sample(-256, -256);
  accepting = true;
  reprioritizeCache.pumpWorkerQueue(1);
  if (reprioritized[0] !== '-1,-1') {
    throw new Error(`Expected sample probe to reprioritize queued erosion tile -1,-1, got ${reprioritized[0] ?? 'none'}`);
  }
  if (reprioritizeCache.stats().workerQueueReprioritized < 1) {
    throw new Error('Expected erosion worker queue reprioritization telemetry to increment after sample probe.');
  }
}

function createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache) {
  const worldgen = new WorldgenTileCache();
  const erosion = new ErosionTileCache();
  const cave = new CaveGraphTileCache();
  return new MaterialTileCache({
    worldgen: (x, z) => worldgen.sample(x, z),
    erosion: (x, z) => erosion.sample(x, z),
    cave: (x, y, z) => cave.sample(x, y, z),
  });
}

async function testMaterialTileCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache) {
  const cache = createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
  const touched = cache.ensureTilesAround(0, 0, 1);
  if (touched !== 9) throw new Error(`Expected material tile prewarm to touch 9 tiles, got ${touched}.`);
  const probe = cache.sample(0, 0);
  const weightSum = probe.weights.grass + probe.weights.rock + probe.weights.snow + probe.weights.mud;
  if (Math.abs(weightSum - 1) > 0.0001) throw new Error(`Expected material weights to normalize to 1, got ${weightSum}.`);
  if (probe.dominantMaterialId < 0 || probe.dominantMaterialId > 3) throw new Error(`Unexpected dominant material id ${probe.dominantMaterialId}.`);
  for (const key of ['wetness', 'roughness', 'fertility', 'stability', 'shoreline', 'caveSurface', 'routeCost', 'blendConfidence']) {
    const value = probe[key];
    if (!Number.isFinite(value) || value < -0.0001 || value > 1.0001) {
      throw new Error(`Expected normalized material field ${key}, got ${value}.`);
    }
  }
  const exported = cache.exportTilesAround(0, 0, 1);
  if (exported.tiles.length !== 9) throw new Error(`Expected material export to include 9 tiles, got ${exported.tiles.length}.`);
  if (exported.fieldNames.length !== 12) throw new Error(`Expected 12 material fields, got ${exported.fieldNames.length}.`);
  const expectedFields = 17 * 17 * exported.fieldNames.length;
  for (const tile of exported.tiles) {
    if (tile.fields.length !== expectedFields) throw new Error(`Expected material tile ${tile.key} to have ${expectedFields} fields, got ${tile.fields.length}.`);
    if (tile.dominantMaterialIds.length !== 17 * 17) throw new Error(`Expected material tile ${tile.key} to have 289 dominant IDs, got ${tile.dominantMaterialIds.length}.`);
  }

  let accepting = false;
  const dispatched = [];
  const workerCache = createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
  workerCache.setWorkerProvider((tileX, tileZ) => {
    if (!accepting) return false;
    dispatched.push(`${tileX},${tileZ}`);
    return true;
  });
  workerCache.exportTilesAround(0, 0, 1);
  accepting = true;
  workerCache.pumpWorkerQueue(1);
  if (dispatched[0] !== '0,0') {
    throw new Error(`Expected prioritized material worker queue to dispatch center tile first, got ${dispatched[0] ?? 'none'}`);
  }
  const centerTile = exported.tiles.find(tile => tile.key === '0,0');
  if (!centerTile || !workerCache.adoptWorkerTile(centerTile)) throw new Error('Expected material worker tile adoption to accept a valid serialized tile.');
  const adoptedStats = workerCache.stats();
  if (adoptedStats.nativeTiles !== 1 || adoptedStats.workerAdoptedTiles !== 1 || adoptedStats.workerResponses !== 1) {
    throw new Error('Expected material native tile adoption telemetry to increment.');
  }

  let savedTile = null;
  const saveCache = createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
  saveCache.setPersistenceProvider({
    async loadTile() {
      return { tile: null };
    },
    async saveTile(tile) {
      savedTile = tile;
      return { pruned: 1, records: 5 };
    },
  });
  saveCache.adoptWorkerTile(centerTile);
  await flushMicrotasks();
  const saveStats = saveCache.stats();
  if (!savedTile || saveStats.persistenceSaves !== 1 || saveStats.persistencePruned !== 1 || saveStats.persistenceRecords !== 5) {
    throw new Error('Expected material persistence save/prune telemetry after native tile adoption.');
  }

  const loadCache = createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
  loadCache.setPersistenceProvider({
    async loadTile() {
      return { tile: centerTile, records: 6 };
    },
    async saveTile() {
      return {};
    },
  });
  loadCache.sample(0, 0);
  await flushMicrotasks();
  const loadStats = loadCache.stats();
  if (loadStats.persistedTiles !== 1 || loadStats.persistenceLoads !== 1 || loadStats.persistenceHits !== 1 || loadStats.persistenceRecords !== 6) {
    throw new Error('Expected material persistence load/hit telemetry to adopt a stored tile.');
  }

  const reprioritized = [];
  accepting = false;
  const reprioritizeCache = createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
  reprioritizeCache.setWorkerProvider((tileX, tileZ) => {
    if (!accepting) return false;
    reprioritized.push(`${tileX},${tileZ}`);
    return true;
  });
  reprioritizeCache.exportTilesAround(0, 0, 1);
  reprioritizeCache.sample(-256, -256);
  accepting = true;
  reprioritizeCache.pumpWorkerQueue(1);
  if (reprioritized[0] !== '-1,-1') {
    throw new Error(`Expected sample probe to reprioritize queued material tile -1,-1, got ${reprioritized[0] ?? 'none'}`);
  }
  if (reprioritizeCache.stats().workerQueueReprioritized < 1) {
    throw new Error('Expected material worker queue reprioritization telemetry to increment after sample probe.');
  }
}

async function loadNativeCore() {
  const bytes = fs.readFileSync(wasmUrl);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const e = instance.exports;
  const required = [
    'memory',
    'generate_worldgen_tile',
    'get_worldgen_tile_field_ptr',
    'get_worldgen_tile_biome_id_ptr',
    'get_worldgen_tile_water_id_ptr',
    'get_worldgen_tile_river_id_ptr',
    'get_worldgen_tile_resolution',
    'get_worldgen_tile_sample_count',
    'get_worldgen_tile_field_count',
    'get_worldgen_tile_size',
    'generate_erosion_tile',
    'get_erosion_tile_field_ptr',
    'get_erosion_tile_resolution',
    'get_erosion_tile_sample_count',
    'get_erosion_tile_field_count',
    'get_erosion_tile_schema_version',
    'get_erosion_tile_generator_version',
    'get_erosion_tile_size',
    'generate_material_tile',
    'get_material_tile_field_ptr',
    'get_material_tile_id_ptr',
    'get_material_tile_resolution',
    'get_material_tile_sample_count',
    'get_material_tile_field_count',
    'get_material_tile_schema_version',
    'get_material_tile_generator_version',
    'get_material_tile_size',
    'generate_cave_graph_tile',
    'get_cave_graph_passage_ptr',
    'get_cave_graph_chamber_ptr',
    'get_cave_graph_passage_count',
    'get_cave_graph_chamber_count',
    'get_cave_graph_passage_field_count',
    'get_cave_graph_chamber_field_count',
    'get_cave_graph_tile_schema_version',
    'get_cave_graph_tile_generator_version',
    'get_cave_graph_tile_size',
  ];
  for (const name of required) {
    if (!(name in e)) throw new Error(`Missing native worldgen tile export: ${name}`);
  }
  return e;
}

function fnv1a64(bytes) {
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }
  return `0x${hash.toString(16).padStart(16, '0')}`;
}

function floatArrayHash(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, Number(values[i]) || 0, true);
  return fnv1a64(bytes);
}

function u8Hash(values) {
  return fnv1a64(Uint8Array.from(values.map(value => Math.max(0, Math.min(255, Number(value) | 0)))));
}

function u16Hash(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setUint16(i * 2, Math.max(0, Math.min(65535, Number(values[i]) | 0)), true);
  return fnv1a64(bytes);
}

function jsonHash(value) {
  return fnv1a64(Buffer.from(JSON.stringify(value), 'utf8'));
}

function fieldStats(fields, fieldNames) {
  const sampleCount = fields.length / fieldNames.length;
  return fieldNames.map((name, fieldIndex) => {
    if (sampleCount === 0) return { name, min: null, max: null, mean: null };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (let sample = 0; sample < sampleCount; sample++) {
      const value = Number(fields[sample * fieldNames.length + fieldIndex]) || 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    return {
      name,
      min: Number(min.toFixed(6)),
      max: Number(max.toFixed(6)),
      mean: Number((sum / Math.max(1, sampleCount)).toFixed(6)),
    };
  });
}

function summarizedFloatStats(fields, fieldNames) {
  return fieldStats(fields, fieldNames).map(field => ({
    ...field,
    min: field.min === null ? null : Number(field.min.toFixed ? field.min.toFixed(4) : field.min),
    max: field.max === null ? null : Number(field.max.toFixed ? field.max.toFixed(4) : field.max),
    mean: field.mean === null ? null : Number(field.mean.toFixed ? field.mean.toFixed(4) : field.mean),
  }));
}

function summarizeTile(tile, fieldNames) {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    fieldHash: floatArrayHash(tile.fields),
    biomeIdHash: u8Hash(tile.biomeIds),
    waterIdHash: u8Hash(tile.waterIds),
    riverNetworkIdHash: u16Hash(tile.riverNetworkIds),
    fields: fieldStats(tile.fields, fieldNames),
  };
}

function summarizeExport(scene, exported) {
  return {
    name: scene.name,
    exportSchemaVersion: exported.schemaVersion ?? null,
    tileSchemaVersion: exported.tileSchemaVersion ?? null,
    generatorVersion: exported.generatorVersion ?? null,
    center: exported.center,
    radiusTiles: exported.radiusTiles,
    tileSize: exported.tileSize,
    resolution: exported.resolution,
    fieldNames: [...exported.fieldNames],
    tileCount: exported.tiles.length,
    tiles: exported.tiles.map(tile => summarizeTile(tile, exported.fieldNames)),
  };
}

function summarizeErosionTile(tile, fieldNames) {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    fieldHash: floatArrayHash(tile.fields),
    fields: fieldStats(tile.fields, fieldNames),
  };
}

function summarizeErosionExport(scene, exported) {
  return {
    name: scene.name,
    exportSchemaVersion: exported.schemaVersion ?? null,
    tileSchemaVersion: exported.tileSchemaVersion ?? null,
    generatorVersion: exported.generatorVersion ?? null,
    center: exported.center,
    radiusTiles: exported.radiusTiles,
    tileSize: exported.tileSize,
    resolution: exported.resolution,
    fieldNames: [...exported.fieldNames],
    tileCount: exported.tiles.length,
    stats: {
      generatedTiles: exported.stats.generatedTiles,
      generatedSamples: exported.stats.generatedSamples,
    },
    tiles: exported.tiles.map(tile => summarizeErosionTile(tile, exported.fieldNames)),
  };
}

function summarizeMaterialTile(tile, fieldNames) {
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    fieldHash: floatArrayHash(tile.fields),
    dominantMaterialIdHash: u8Hash(tile.dominantMaterialIds),
    fields: fieldStats(tile.fields, fieldNames),
  };
}

function summarizeMaterialExport(scene, exported) {
  return {
    name: scene.name,
    exportSchemaVersion: exported.schemaVersion ?? null,
    tileSchemaVersion: exported.tileSchemaVersion ?? null,
    generatorVersion: exported.generatorVersion ?? null,
    center: exported.center,
    radiusTiles: exported.radiusTiles,
    tileSize: exported.tileSize,
    resolution: exported.resolution,
    fieldNames: [...exported.fieldNames],
    tileCount: exported.tiles.length,
    stats: {
      generatedTiles: exported.stats.generatedTiles,
      generatedSamples: exported.stats.generatedSamples,
    },
    tiles: exported.tiles.map(tile => summarizeMaterialTile(tile, exported.fieldNames)),
  };
}

function summarizeCaveGraphTile(tile) {
  const passageKinds = tile.passages.reduce((counts, passage) => {
    counts[passage.kind] = (counts[passage.kind] ?? 0) + 1;
    return counts;
  }, {});
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    passageCount: tile.passages.length,
    chamberCount: tile.chambers.length,
    shaftCount: tile.passages.filter(passage => passage.kind === 'shaft').length,
    passageKinds,
    passageHash: jsonHash(tile.passages),
    chamberHash: jsonHash(tile.chambers),
  };
}

function summarizeCaveGraphExport(scene, exported) {
  return {
    name: scene.name,
    exportSchemaVersion: exported.schemaVersion ?? null,
    tileSchemaVersion: exported.tileSchemaVersion ?? null,
    generatorVersion: exported.generatorVersion ?? null,
    center: exported.center,
    radiusTiles: exported.radiusTiles,
    tileSize: exported.tileSize,
    tileCount: exported.tiles.length,
    stats: {
      passages: exported.stats.passages,
      branches: exported.stats.branches,
      chambers: exported.stats.chambers,
      shafts: exported.stats.shafts,
    },
    tiles: exported.tiles.map(summarizeCaveGraphTile),
  };
}

function nativeExportForScene(e, scene, fieldNames, tileSchemaVersion, generatorVersion) {
  const tileSize = e.get_worldgen_tile_size();
  const resolution = e.get_worldgen_tile_resolution();
  const sampleCount = e.get_worldgen_tile_sample_count();
  const fieldCount = e.get_worldgen_tile_field_count();
  if (fieldCount !== fieldNames.length) throw new Error(`Native field count ${fieldCount} does not match TypeScript field names ${fieldNames.length}.`);
  const tileX = Math.floor(scene.x / tileSize);
  const tileZ = Math.floor(scene.z / tileSize);
  const radius = 1;
  const tiles = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = tileX + dx;
      const tz = tileZ + dz;
      const written = e.generate_worldgen_tile(tx, tz);
      if (written !== sampleCount) throw new Error(`Native worldgen tile ${tx},${tz} wrote ${written} samples, expected ${sampleCount}.`);
      tiles.push({
        key: `${tx},${tz}`,
        tileX: tx,
        tileZ: tz,
        originX: tx * tileSize,
        originZ: tz * tileSize,
        fields: Array.from(new Float32Array(e.memory.buffer, e.get_worldgen_tile_field_ptr(), sampleCount * fieldCount)),
        biomeIds: Array.from(new Uint8Array(e.memory.buffer, e.get_worldgen_tile_biome_id_ptr(), sampleCount)),
        waterIds: Array.from(new Uint8Array(e.memory.buffer, e.get_worldgen_tile_water_id_ptr(), sampleCount)),
        riverNetworkIds: Array.from(new Uint16Array(e.memory.buffer, e.get_worldgen_tile_river_id_ptr(), sampleCount)),
      });
    }
  }
  return {
    schemaVersion: 2,
    tileSchemaVersion,
    generatorVersion,
    center: { x: scene.x, z: scene.z, tileX, tileZ },
    radiusTiles: radius,
    tileSize,
    resolution,
    fieldNames,
    tiles,
  };
}

function nativeErosionExportForScene(e, scene, fieldNames) {
  const tileSize = e.get_erosion_tile_size();
  const resolution = e.get_erosion_tile_resolution();
  const sampleCount = e.get_erosion_tile_sample_count();
  const fieldCount = e.get_erosion_tile_field_count();
  if (fieldCount !== fieldNames.length) throw new Error(`Native erosion field count ${fieldCount} does not match TypeScript field names ${fieldNames.length}.`);
  const tileX = Math.floor(scene.x / tileSize);
  const tileZ = Math.floor(scene.z / tileSize);
  const radius = 1;
  const tiles = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = tileX + dx;
      const tz = tileZ + dz;
      const written = e.generate_erosion_tile(tx, tz);
      if (written !== sampleCount) throw new Error(`Native erosion tile ${tx},${tz} wrote ${written} samples, expected ${sampleCount}.`);
      tiles.push({
        key: `${tx},${tz}`,
        tileX: tx,
        tileZ: tz,
        originX: tx * tileSize,
        originZ: tz * tileSize,
        fields: Array.from(new Float32Array(e.memory.buffer, e.get_erosion_tile_field_ptr(), sampleCount * fieldCount)),
      });
    }
  }
  return {
    schemaVersion: 1,
    tileSchemaVersion: e.get_erosion_tile_schema_version(),
    generatorVersion: e.get_erosion_tile_generator_version(),
    center: { x: scene.x, z: scene.z, tileX, tileZ },
    radiusTiles: radius,
    tileSize,
    resolution,
    fieldNames,
    stats: {
      generatedTiles: tiles.length,
      generatedSamples: tiles.length * sampleCount,
    },
    tiles,
  };
}

function nativeMaterialExportForScene(e, scene, fieldNames) {
  const tileSize = e.get_material_tile_size();
  const resolution = e.get_material_tile_resolution();
  const sampleCount = e.get_material_tile_sample_count();
  const fieldCount = e.get_material_tile_field_count();
  if (fieldCount !== fieldNames.length) throw new Error(`Native material field count ${fieldCount} does not match TypeScript field names ${fieldNames.length}.`);
  const tileX = Math.floor(scene.x / tileSize);
  const tileZ = Math.floor(scene.z / tileSize);
  const radius = 1;
  const tiles = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = tileX + dx;
      const tz = tileZ + dz;
      const written = e.generate_material_tile(tx, tz);
      if (written !== sampleCount) throw new Error(`Native material tile ${tx},${tz} wrote ${written} samples, expected ${sampleCount}.`);
      tiles.push({
        key: `${tx},${tz}`,
        tileX: tx,
        tileZ: tz,
        originX: tx * tileSize,
        originZ: tz * tileSize,
        fields: Array.from(new Float32Array(e.memory.buffer, e.get_material_tile_field_ptr(), sampleCount * fieldCount)),
        dominantMaterialIds: Array.from(new Uint8Array(e.memory.buffer, e.get_material_tile_id_ptr(), sampleCount)),
      });
    }
  }
  return {
    schemaVersion: 1,
    tileSchemaVersion: e.get_material_tile_schema_version(),
    generatorVersion: e.get_material_tile_generator_version(),
    center: { x: scene.x, z: scene.z, tileX, tileZ },
    radiusTiles: radius,
    tileSize,
    resolution,
    fieldNames,
    stats: {
      generatedTiles: tiles.length,
      generatedSamples: tiles.length * sampleCount,
    },
    tiles,
  };
}

function nativeCaveGraphExportForScene(e, scene) {
  const tileSize = e.get_cave_graph_tile_size();
  const passageFieldCount = e.get_cave_graph_passage_field_count();
  const chamberFieldCount = e.get_cave_graph_chamber_field_count();
  if (passageFieldCount !== CAVE_GRAPH_PASSAGE_FIELD_NAMES.length) {
    throw new Error(`Native cave graph passage field count ${passageFieldCount} does not match expected ${CAVE_GRAPH_PASSAGE_FIELD_NAMES.length}.`);
  }
  if (chamberFieldCount !== CAVE_GRAPH_CHAMBER_FIELD_NAMES.length) {
    throw new Error(`Native cave graph chamber field count ${chamberFieldCount} does not match expected ${CAVE_GRAPH_CHAMBER_FIELD_NAMES.length}.`);
  }
  const tileX = Math.floor(scene.x / tileSize);
  const tileZ = Math.floor(scene.z / tileSize);
  const radius = 1;
  const tiles = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = tileX + dx;
      const tz = tileZ + dz;
      const written = e.generate_cave_graph_tile(tx, tz);
      const passageCount = e.get_cave_graph_passage_count();
      const chamberCount = e.get_cave_graph_chamber_count();
      if (written !== passageCount) {
        throw new Error(`Native cave graph tile ${tx},${tz} returned ${written} passages but reports ${passageCount}.`);
      }
      tiles.push({
        key: `${tx},${tz}`,
        tileX: tx,
        tileZ: tz,
        originX: tx * tileSize,
        originZ: tz * tileSize,
        passageFields: Array.from(new Float32Array(e.memory.buffer, e.get_cave_graph_passage_ptr(), passageCount * passageFieldCount)),
        chamberFields: Array.from(new Float32Array(e.memory.buffer, e.get_cave_graph_chamber_ptr(), chamberCount * chamberFieldCount)),
      });
    }
  }
  return {
    schemaVersion: 1,
    tileSchemaVersion: e.get_cave_graph_tile_schema_version(),
    generatorVersion: e.get_cave_graph_tile_generator_version(),
    center: { x: scene.x, z: scene.z, tileX, tileZ },
    radiusTiles: radius,
    tileSize,
    passageFieldNames: CAVE_GRAPH_PASSAGE_FIELD_NAMES,
    chamberFieldNames: CAVE_GRAPH_CHAMBER_FIELD_NAMES,
    tiles,
  };
}

function summarizeNativeCaveGraphTile(tile, passageFieldNames, chamberFieldNames) {
  let shaftCount = 0;
  const kindCounts = { trunk: 0, branch: 0, shaft: 0 };
  for (let offset = 0; offset < tile.passageFields.length; offset += passageFieldNames.length) {
    const kind = Math.round(tile.passageFields[offset]);
    if (kind === 0) kindCounts.trunk++;
    else if (kind === 1) kindCounts.branch++;
    else if (kind === 2) {
      kindCounts.shaft++;
      shaftCount++;
    }
  }
  return {
    key: tile.key,
    tileX: tile.tileX,
    tileZ: tile.tileZ,
    originX: tile.originX,
    originZ: tile.originZ,
    passageCount: tile.passageFields.length / passageFieldNames.length,
    chamberCount: tile.chamberFields.length / chamberFieldNames.length,
    shaftCount,
    passageKinds: kindCounts,
    passageHash: floatArrayHash(tile.passageFields),
    chamberHash: floatArrayHash(tile.chamberFields),
    passageFields: summarizedFloatStats(tile.passageFields, passageFieldNames),
    chamberFields: summarizedFloatStats(tile.chamberFields, chamberFieldNames),
  };
}

function summarizeNativeCaveGraphExport(scene, exported) {
  const tiles = exported.tiles.map(tile => summarizeNativeCaveGraphTile(tile, exported.passageFieldNames, exported.chamberFieldNames));
  const stats = tiles.reduce((acc, tile) => {
    acc.passages += tile.passageCount;
    acc.branches += tile.passageKinds.branch ?? 0;
    acc.chambers += tile.chamberCount;
    acc.shafts += tile.shaftCount;
    return acc;
  }, { passages: 0, branches: 0, chambers: 0, shafts: 0 });
  return {
    name: scene.name,
    exportSchemaVersion: exported.schemaVersion ?? null,
    tileSchemaVersion: exported.tileSchemaVersion ?? null,
    generatorVersion: exported.generatorVersion ?? null,
    center: exported.center,
    radiusTiles: exported.radiusTiles,
    tileSize: exported.tileSize,
    passageFieldNames: [...exported.passageFieldNames],
    chamberFieldNames: [...exported.chamberFieldNames],
    tileCount: tiles.length,
    stats,
    tiles,
  };
}

function validateCaveGraphParity(caveGraphScenes, nativeCaveGraphScenes) {
  for (let i = 0; i < caveGraphScenes.length; i++) {
    const expected = caveGraphScenes[i];
    const actual = nativeCaveGraphScenes[i];
    if (JSON.stringify(expected.center) !== JSON.stringify(actual.center)) {
      throw new Error(`Native cave graph scene center mismatch for ${expected.name}: ${JSON.stringify(actual.center)} vs ${JSON.stringify(expected.center)}`);
    }
    for (const key of ['passages', 'branches', 'chambers', 'shafts']) {
      if (expected.stats[key] !== actual.stats[key]) {
        throw new Error(`Native cave graph ${expected.name} ${key} mismatch: expected ${expected.stats[key]}, got ${actual.stats[key]}`);
      }
    }
  }
}

async function captureBaseline() {
  const { WorldgenTileCache, WORLDGEN_TILE_FIELD_NAMES, WORLDGEN_TILE_SCHEMA_VERSION, WORLDGEN_TILE_GENERATOR_VERSION } = await loadWorldgenModule();
  const { CaveGraphTileCache } = await loadCaveGraphModule();
  const { ErosionTileCache, EROSION_TILE_FIELD_NAMES } = await loadErosionModule();
  const { MaterialTileCache, MATERIAL_TILE_FIELD_NAMES } = await loadMaterialModule();
  testWorldgenTileWorkerQueue(WorldgenTileCache);
  testCaveGraphTileCache(CaveGraphTileCache);
  await testErosionTileCache(ErosionTileCache);
  await testMaterialTileCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
  const nativeCore = await loadNativeCore();
  const caveGraphScenes = SCENES.map(scene => {
    const cache = new CaveGraphTileCache();
    return summarizeCaveGraphExport(scene, cache.exportTilesAround(scene.x, scene.z, 1));
  });
  const nativeCaveGraphScenes = SCENES.map(scene => summarizeNativeCaveGraphExport(scene, nativeCaveGraphExportForScene(nativeCore, scene)));
  validateCaveGraphParity(caveGraphScenes, nativeCaveGraphScenes);
  const erosionScenes = SCENES.map(scene => {
    const cache = new ErosionTileCache();
    return summarizeErosionExport(scene, cache.exportTilesAround(scene.x, scene.z, 1));
  });
  const materialScenes = SCENES.map(scene => {
    const cache = createMaterialCache(WorldgenTileCache, ErosionTileCache, CaveGraphTileCache, MaterialTileCache);
    return summarizeMaterialExport(scene, cache.exportTilesAround(scene.x, scene.z, 1));
  });
  const nativeErosionScenes = SCENES.map(scene => summarizeErosionExport(scene, nativeErosionExportForScene(nativeCore, scene, [...EROSION_TILE_FIELD_NAMES])));
  const nativeMaterialScenes = SCENES.map(scene => summarizeMaterialExport(scene, nativeMaterialExportForScene(nativeCore, scene, [...MATERIAL_TILE_FIELD_NAMES])));
  return {
    version: 9,
    generatedAt: new Date().toISOString(),
    scenes: SCENES.map(scene => {
      const cache = new WorldgenTileCache();
      return summarizeExport(scene, cache.exportTilesAround(scene.x, scene.z, 1));
    }),
    nativeScenes: SCENES.map(scene => summarizeExport(scene, nativeExportForScene(nativeCore, scene, [...WORLDGEN_TILE_FIELD_NAMES], WORLDGEN_TILE_SCHEMA_VERSION, WORLDGEN_TILE_GENERATOR_VERSION))),
    erosionScenes,
    nativeErosionScenes,
    materialScenes,
    nativeMaterialScenes,
    caveGraphScenes,
    nativeCaveGraphScenes,
  };
}

function loadBaseline() {
  if (!fs.existsSync(baselineUrl)) throw new Error(`Missing baseline: ${baselineUrl.pathname}. Run npm run worldgen:regression -- --update after reviewing current output.`);
  return JSON.parse(fs.readFileSync(baselineUrl, 'utf8'));
}

function compareTile(path, baseline, candidate, diffs) {
  for (const key of ['key', 'tileX', 'tileZ', 'originX', 'originZ', 'fieldHash', 'biomeIdHash', 'waterIdHash', 'riverNetworkIdHash']) {
    if (baseline[key] !== candidate[key]) diffs.push(`${path}.${key}: expected ${baseline[key]}, got ${candidate[key]}`);
  }
  if (baseline.fields.length !== candidate.fields.length) {
    diffs.push(`${path}.fields.length: expected ${baseline.fields.length}, got ${candidate.fields.length}`);
    return;
  }
  for (let i = 0; i < baseline.fields.length; i++) {
    const expected = baseline.fields[i];
    const actual = candidate.fields[i];
    for (const key of ['name', 'min', 'max', 'mean']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.fields.${expected.name}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
}

function compareSceneSet(label, baselineScenes, candidateScenes, diffs) {
  if (!Array.isArray(baselineScenes) || !Array.isArray(candidateScenes) || baselineScenes.length !== candidateScenes.length) {
    diffs.push(`${label}.length: expected ${baselineScenes?.length}, got ${candidateScenes?.length}`);
    return;
  }
  for (let i = 0; i < baselineScenes.length; i++) {
    const expected = baselineScenes[i];
    const actual = candidateScenes[i];
    const path = `${label}.${expected.name ?? i}`;
    for (const key of ['name', 'exportSchemaVersion', 'tileSchemaVersion', 'generatorVersion', 'radiusTiles', 'tileSize', 'resolution', 'tileCount']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
    if (JSON.stringify(expected.center) !== JSON.stringify(actual.center)) {
      diffs.push(`${path}.center: expected ${JSON.stringify(expected.center)}, got ${JSON.stringify(actual.center)}`);
    }
    if (JSON.stringify(expected.fieldNames) !== JSON.stringify(actual.fieldNames)) {
      diffs.push(`${path}.fieldNames changed`);
    }
    if (expected.tiles.length !== actual.tiles.length) {
      diffs.push(`${path}.tiles.length: expected ${expected.tiles.length}, got ${actual.tiles.length}`);
      continue;
    }
    for (let tileIndex = 0; tileIndex < expected.tiles.length; tileIndex++) {
      compareTile(`${path}.tiles.${expected.tiles[tileIndex].key}`, expected.tiles[tileIndex], actual.tiles[tileIndex], diffs);
    }
  }
}

function compareErosionTile(path, baseline, candidate, diffs) {
  for (const key of ['key', 'tileX', 'tileZ', 'originX', 'originZ', 'fieldHash']) {
    if (baseline[key] !== candidate[key]) diffs.push(`${path}.${key}: expected ${baseline[key]}, got ${candidate[key]}`);
  }
  if (baseline.fields.length !== candidate.fields.length) {
    diffs.push(`${path}.fields.length: expected ${baseline.fields.length}, got ${candidate.fields.length}`);
    return;
  }
  for (let i = 0; i < baseline.fields.length; i++) {
    const expected = baseline.fields[i];
    const actual = candidate.fields[i];
    for (const key of ['name', 'min', 'max', 'mean']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.fields.${expected.name}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
}

function compareErosionSceneSet(label, baselineScenes, candidateScenes, diffs) {
  if (!Array.isArray(baselineScenes) || !Array.isArray(candidateScenes) || baselineScenes.length !== candidateScenes.length) {
    diffs.push(`${label}.length: expected ${baselineScenes?.length}, got ${candidateScenes?.length}`);
    return;
  }
  for (let i = 0; i < baselineScenes.length; i++) {
    const expected = baselineScenes[i];
    const actual = candidateScenes[i];
    const path = `${label}.${expected.name ?? i}`;
    for (const key of ['name', 'exportSchemaVersion', 'tileSchemaVersion', 'generatorVersion', 'radiusTiles', 'tileSize', 'resolution', 'tileCount']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
    if (JSON.stringify(expected.center) !== JSON.stringify(actual.center)) {
      diffs.push(`${path}.center: expected ${JSON.stringify(expected.center)}, got ${JSON.stringify(actual.center)}`);
    }
    if (JSON.stringify(expected.fieldNames) !== JSON.stringify(actual.fieldNames)) {
      diffs.push(`${path}.fieldNames changed`);
    }
    if (JSON.stringify(expected.stats) !== JSON.stringify(actual.stats)) {
      diffs.push(`${path}.stats: expected ${JSON.stringify(expected.stats)}, got ${JSON.stringify(actual.stats)}`);
    }
    if (expected.tiles.length !== actual.tiles.length) {
      diffs.push(`${path}.tiles.length: expected ${expected.tiles.length}, got ${actual.tiles.length}`);
      continue;
    }
    for (let tileIndex = 0; tileIndex < expected.tiles.length; tileIndex++) {
      compareErosionTile(`${path}.tiles.${expected.tiles[tileIndex].key}`, expected.tiles[tileIndex], actual.tiles[tileIndex], diffs);
    }
  }
}

function compareMaterialTile(path, baseline, candidate, diffs) {
  for (const key of ['key', 'tileX', 'tileZ', 'originX', 'originZ', 'fieldHash', 'dominantMaterialIdHash']) {
    if (baseline[key] !== candidate[key]) diffs.push(`${path}.${key}: expected ${baseline[key]}, got ${candidate[key]}`);
  }
  if (baseline.fields.length !== candidate.fields.length) {
    diffs.push(`${path}.fields.length: expected ${baseline.fields.length}, got ${candidate.fields.length}`);
    return;
  }
  for (let i = 0; i < baseline.fields.length; i++) {
    const expected = baseline.fields[i];
    const actual = candidate.fields[i];
    for (const key of ['name', 'min', 'max', 'mean']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.fields.${expected.name}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
}

function compareMaterialSceneSet(label, baselineScenes, candidateScenes, diffs) {
  if (!Array.isArray(baselineScenes) || !Array.isArray(candidateScenes) || baselineScenes.length !== candidateScenes.length) {
    diffs.push(`${label}.length: expected ${baselineScenes?.length}, got ${candidateScenes?.length}`);
    return;
  }
  for (let i = 0; i < baselineScenes.length; i++) {
    const expected = baselineScenes[i];
    const actual = candidateScenes[i];
    const path = `${label}.${expected.name ?? i}`;
    for (const key of ['name', 'exportSchemaVersion', 'tileSchemaVersion', 'generatorVersion', 'radiusTiles', 'tileSize', 'resolution', 'tileCount']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
    if (JSON.stringify(expected.center) !== JSON.stringify(actual.center)) {
      diffs.push(`${path}.center: expected ${JSON.stringify(expected.center)}, got ${JSON.stringify(actual.center)}`);
    }
    if (JSON.stringify(expected.fieldNames) !== JSON.stringify(actual.fieldNames)) {
      diffs.push(`${path}.fieldNames changed`);
    }
    if (JSON.stringify(expected.stats) !== JSON.stringify(actual.stats)) {
      diffs.push(`${path}.stats: expected ${JSON.stringify(expected.stats)}, got ${JSON.stringify(actual.stats)}`);
    }
    if (expected.tiles.length !== actual.tiles.length) {
      diffs.push(`${path}.tiles.length: expected ${expected.tiles.length}, got ${actual.tiles.length}`);
      continue;
    }
    for (let tileIndex = 0; tileIndex < expected.tiles.length; tileIndex++) {
      compareMaterialTile(`${path}.tiles.${expected.tiles[tileIndex].key}`, expected.tiles[tileIndex], actual.tiles[tileIndex], diffs);
    }
  }
}

function compareCaveGraphSceneSet(label, baselineScenes, candidateScenes, diffs) {
  if (!Array.isArray(baselineScenes) || !Array.isArray(candidateScenes) || baselineScenes.length !== candidateScenes.length) {
    diffs.push(`${label}.length: expected ${baselineScenes?.length}, got ${candidateScenes?.length}`);
    return;
  }
  for (let i = 0; i < baselineScenes.length; i++) {
    const expected = baselineScenes[i];
    const actual = candidateScenes[i];
    const path = `${label}.${expected.name ?? i}`;
    for (const key of ['name', 'exportSchemaVersion', 'tileSchemaVersion', 'generatorVersion', 'radiusTiles', 'tileSize', 'tileCount']) {
      if (expected[key] !== actual[key]) diffs.push(`${path}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
    if (JSON.stringify(expected.center) !== JSON.stringify(actual.center)) {
      diffs.push(`${path}.center: expected ${JSON.stringify(expected.center)}, got ${JSON.stringify(actual.center)}`);
    }
    if (JSON.stringify(expected.stats) !== JSON.stringify(actual.stats)) {
      diffs.push(`${path}.stats: expected ${JSON.stringify(expected.stats)}, got ${JSON.stringify(actual.stats)}`);
    }
    if (expected.tiles.length !== actual.tiles.length) {
      diffs.push(`${path}.tiles.length: expected ${expected.tiles.length}, got ${actual.tiles.length}`);
      continue;
    }
    for (let tileIndex = 0; tileIndex < expected.tiles.length; tileIndex++) {
      const expectedTile = expected.tiles[tileIndex];
      const actualTile = actual.tiles[tileIndex];
      const tilePath = `${path}.tiles.${expectedTile.key}`;
      for (const key of ['key', 'tileX', 'tileZ', 'originX', 'originZ', 'passageCount', 'chamberCount', 'shaftCount', 'passageHash', 'chamberHash']) {
        if (expectedTile[key] !== actualTile[key]) diffs.push(`${tilePath}.${key}: expected ${expectedTile[key]}, got ${actualTile[key]}`);
      }
      if (JSON.stringify(expectedTile.passageKinds) !== JSON.stringify(actualTile.passageKinds)) {
        diffs.push(`${tilePath}.passageKinds: expected ${JSON.stringify(expectedTile.passageKinds)}, got ${JSON.stringify(actualTile.passageKinds)}`);
      }
    }
  }
}

function compareBaseline(baseline, candidate) {
  const diffs = [];
  if (baseline.version !== candidate.version) diffs.push(`version: expected ${baseline.version}, got ${candidate.version}`);
  compareSceneSet('scenes', baseline.scenes, candidate.scenes, diffs);
  compareSceneSet('nativeScenes', baseline.nativeScenes, candidate.nativeScenes, diffs);
  compareErosionSceneSet('erosionScenes', baseline.erosionScenes, candidate.erosionScenes, diffs);
  compareErosionSceneSet('nativeErosionScenes', baseline.nativeErosionScenes, candidate.nativeErosionScenes, diffs);
  compareMaterialSceneSet('materialScenes', baseline.materialScenes, candidate.materialScenes, diffs);
  compareMaterialSceneSet('nativeMaterialScenes', baseline.nativeMaterialScenes, candidate.nativeMaterialScenes, diffs);
  compareCaveGraphSceneSet('caveGraphScenes', baseline.caveGraphScenes, candidate.caveGraphScenes, diffs);
  compareCaveGraphSceneSet('nativeCaveGraphScenes', baseline.nativeCaveGraphScenes, candidate.nativeCaveGraphScenes, diffs);
  return diffs;
}

const candidate = await captureBaseline();

if (update) {
  fs.writeFileSync(baselineUrl, `${JSON.stringify(candidate, null, 2)}\n`);
  if (!jsonOutput) {
    console.log(`Updated ${baselineUrl.pathname}`);
    for (const scene of candidate.scenes) {
      console.log(`${scene.name}: ${scene.tileCount} tiles, ${scene.fieldNames.length} fields, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.nativeScenes) {
      console.log(`native ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldNames.length} fields, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.erosionScenes) {
      console.log(`erosion ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldNames.length} fields, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.nativeErosionScenes) {
      console.log(`native erosion ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldNames.length} fields, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.materialScenes) {
      console.log(`material ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldNames.length} fields, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.nativeMaterialScenes) {
      console.log(`native material ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldNames.length} fields, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.caveGraphScenes) {
      console.log(`cave graph ${scene.name}: ${scene.tileCount} tiles, ${scene.stats.passages} passages, ${scene.stats.chambers} chambers, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
    for (const scene of candidate.nativeCaveGraphScenes) {
      console.log(`native cave graph ${scene.name}: ${scene.tileCount} tiles, ${scene.stats.passages} passages, ${scene.stats.chambers} chambers, center ${scene.center.tileX},${scene.center.tileZ}`);
    }
  } else {
    console.log(JSON.stringify(candidate, null, 2));
  }
  process.exit(0);
}

const baseline = loadBaseline();
const diffs = compareBaseline(baseline, candidate);
const summary = {
  passed: diffs.length === 0,
  scenes: candidate.scenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    fieldCount: scene.fieldNames.length,
    center: scene.center,
  })),
  nativeScenes: candidate.nativeScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    fieldCount: scene.fieldNames.length,
    center: scene.center,
  })),
  erosionScenes: candidate.erosionScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    fieldCount: scene.fieldNames.length,
    stats: scene.stats,
    center: scene.center,
  })),
  nativeErosionScenes: candidate.nativeErosionScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    fieldCount: scene.fieldNames.length,
    stats: scene.stats,
    center: scene.center,
  })),
  materialScenes: candidate.materialScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    fieldCount: scene.fieldNames.length,
    stats: scene.stats,
    center: scene.center,
  })),
  nativeMaterialScenes: candidate.nativeMaterialScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    fieldCount: scene.fieldNames.length,
    stats: scene.stats,
    center: scene.center,
  })),
  caveGraphScenes: candidate.caveGraphScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    stats: scene.stats,
    center: scene.center,
  })),
  nativeCaveGraphScenes: candidate.nativeCaveGraphScenes.map(scene => ({
    name: scene.name,
    exportSchemaVersion: scene.exportSchemaVersion,
    tileSchemaVersion: scene.tileSchemaVersion,
    generatorVersion: scene.generatorVersion,
    tileCount: scene.tileCount,
    stats: scene.stats,
    center: scene.center,
  })),
  diffs,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else if (diffs.length === 0) {
  console.log(`Worldgen tile regression passed: ${candidate.scenes.length} scenes.`);
  for (const scene of summary.scenes) {
    console.log(`- ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldCount} fields`);
  }
  for (const scene of summary.nativeScenes) {
    console.log(`- native ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldCount} fields`);
  }
  for (const scene of summary.erosionScenes) {
    console.log(`- erosion ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldCount} fields`);
  }
  for (const scene of summary.nativeErosionScenes) {
    console.log(`- native erosion ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldCount} fields`);
  }
  for (const scene of summary.materialScenes) {
    console.log(`- material ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldCount} fields`);
  }
  for (const scene of summary.nativeMaterialScenes) {
    console.log(`- native material ${scene.name}: ${scene.tileCount} tiles, ${scene.fieldCount} fields`);
  }
  for (const scene of summary.caveGraphScenes) {
    console.log(`- cave graph ${scene.name}: ${scene.tileCount} tiles, ${scene.stats.passages} passages, ${scene.stats.chambers} chambers`);
  }
  for (const scene of summary.nativeCaveGraphScenes) {
    console.log(`- native cave graph ${scene.name}: ${scene.tileCount} tiles, ${scene.stats.passages} passages, ${scene.stats.chambers} chambers`);
  }
} else {
  console.error(`Worldgen tile regression baseline changed:\n${diffs.join('\n')}`);
}
process.exit(diffs.length === 0 ? 0 : 1);
