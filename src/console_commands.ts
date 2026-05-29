import type { EngineConsole, ConsoleCommandContext } from './console.ts';
import type { EngineSettings, RuntimeProfile } from './engine_contracts.ts';
import type { BenchmarkResult, Tour, Waypoint, TourState } from './camera_tour.ts';

export const KNOWN_SETTINGS_ACTIONS = [
  'carve',
  'undoEdit',
  'redoEdit',
  'switchEditBranch',
  'clearEdits',
  'clearEditBranches',
  'reloadChunks',
  'pickPaintMaterial',
  'paintMaterialGrass',
  'paintMaterialRock',
  'paintMaterialSnow',
  'paintMaterialMud',
  'brushPresetDetail',
  'brushPresetPath',
  'brushPresetTerrace',
  'brushPresetTunnel',
  'saveBrushPreset',
  'clearBrushPresets',
  'falloffPresetHard',
  'falloffPresetSoft',
  'saveRegion',
  'loadRegion',
  'diffRegion',
  'renameRegion',
  'duplicateRegion',
  'pruneOldestRegion',
  'dryRunRegionRetention',
  'applyRegionRetention',
  'exportRegionMaintenanceReport',
  'exportRegionBundle',
  'importRegionBundle',
  'previewRegionImport',
  'applyRegionImportPreview',
  'mergeRegionImportPreview',
  'resetGameProgress',
  'exportRegion',
  'importRegion',
  'clearSavedRegion',
  'captureDensitySlice',
  'previousDensityCapture',
  'nextDensityCapture',
  'previousDensitySet',
  'nextDensitySet',
  'newDensitySet',
  'renameDensitySet',
  'importDensityCaptures',
  'diffDensitySlice',
  'runWorkerBenchmark',
  'exportWorkerBenchmarks',
  'importWorkerBenchmarks',
  'clearWorkerBenchmarks',
  'exportDiagnosticCapture',
  'exportQualityCapture',
  'exportWorldgenTiles',
  'exportDensityCaptures',
  'clearDensityCaptures',
  'resetSettings',
] as const;

export const DEBUG_VIEW_NAMES: Record<string, number> = {
  off: 0,
  shaded: 0,
  normal: 1,
  normals: 1,
  material: 2,
  materials: 2,
  materialid: 2,
  ao: 3,
  ambientocclusion: 3,
  chunkid: 4,
  chunkids: 4,
  density: 5,
  'density-slice': 5,
  densityslice: 5,
  dirty: 6,
  'dirty-regions': 6,
  dirtyregions: 6,
  materialmask: 7,
  'material-masks': 7,
  masks: 7,
  biome: 8,
  biomes: 8,
  wetness: 9,
  snow: 10,
  vegkind: 11,
  vegetation: 11,
  vegetationkind: 11,
};

export const PAINT_MATERIAL_NAMES: Record<string, number> = {
  grass: 0,
  rock: 1,
  snow: 2,
  dirt: 3,
  mud: 3,
  riverbank: 3,
};

export const BRUSH_MODE_NAMES: Record<string, number> = {
  carve: 0,
  subtract: 0,
  build: 1,
  add: 1,
  paint: 2,
  smooth: 3,
  flatten: 4,
};

export const BRUSH_SHAPE_NAMES: Record<string, number> = {
  sphere: 0,
  box: 1,
  capsule: 2,
};

export const QUALITY_PRESET_NAMES: Record<string, number> = {
  low: 0,
  balanced: 1,
  high: 2,
  ultra: 3,
  auto: 4,
};

export interface CameraLike {
  position: Float32Array;
  yaw: number;
  pitch: number;
  fovDegrees: number;
  speed: number;
  fastMultiplier: number;
  forward(): Float32Array;
}

export interface StreamerLike {
  counts(): { queued: number; pending: number; loaded: number; workers: number; idle: number };
  baseStreamRadius: number;
  effectiveStreamRadius: number;
  terrainLodEnabled: boolean;
  applyBrush(target: [number, number, number], brush: unknown): void;
  reloadChunks(): void;
  clearEdits(): void;
  undoEdit(): void;
  redoEdit(): void;
  showError(message: string): void;
  lastStats: Record<string, unknown>;
}

export interface RendererLike {
  capabilities: Record<string, unknown>;
  stats: Record<string, unknown>;
}

export interface ProfilerLike {
  last: RuntimeProfile;
  frameMsSamples: number[];
}

export interface GameLike {
  progress(): Record<string, unknown>;
  resetProgress(): void;
}

export interface WorldgenProbeFn {
  (x: number, z: number): Record<string, number | string>;
}

export interface ConsoleDeps {
  getSettings(): EngineSettings;
  setSettings(next: Partial<EngineSettings>, key: keyof EngineSettings | 'all'): void;
  defaultSettings: EngineSettings;
  parseSettingValue(key: keyof EngineSettings, value: string): EngineSettings[keyof EngineSettings] | null;
  dispatchAction(action: string): boolean;
  camera: CameraLike;
  streamer: StreamerLike;
  renderer: RendererLike;
  profiler: ProfilerLike;
  game: GameLike;
  worldgenProbe?: WorldgenProbeFn;
  reload(): void;
  editLogSnapshot?(): { active: unknown[]; redo: unknown[]; branches: unknown[]; activeVersion: number; nextEditId: number };
  brushPresetList?(): Array<{ id: string; label: string }>;
  applyBrushPreset?(id: string): boolean;
  deleteBrushPreset?(id: string): boolean;
  regionSlotList?(): Array<{ index: number; key: string; name: string; chunks?: number; edits?: number; savedAt?: number }>;
  tileCacheStats?(name: 'chunk' | 'worldgen' | 'erosion' | 'material' | 'cave'): Record<string, unknown> | null;
  poolStats?(): Record<string, unknown>;
  autoQualityState?(): Record<string, unknown>;
  benchmarkHistory?(): unknown[];
  screenshot?(filename?: string): Promise<void>;
  canvas?(): HTMLCanvasElement | null;
  tour?: {
    state(): TourState;
    addWaypoint(opts?: { spacingMs?: number; timeMs?: number; fov?: boolean }): Waypoint;
    listScratch(): Waypoint[];
    removeWaypoint(index: number): Waypoint | null;
    clearScratch(): number;
    setWaypointTime(index: number, timeMs: number): boolean;
    setEasing(easing: 'linear' | 'smooth'): void;
    saveScratch(name: string): Tour;
    loadIntoScratch(name: string): Tour;
    deleteSaved(name: string): boolean;
    listSaved(): string[];
    getSaved(name: string): Tour | null;
    start(target: Tour | string): Tour;
    stop(): BenchmarkResult | null;
    pause(): boolean;
    resume(): boolean;
    getLastResult(): BenchmarkResult | null;
    download(filename?: string): boolean;
  };
}

function describeNumber(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) return String(value);
  return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(decimals);
}

function formatJson(value: unknown, maxLines = 60): string {
  try {
    const text = JSON.stringify(value, (_, v) => {
      if (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)) return Number(v.toFixed(4));
      return v;
    }, 2);
    if (!text) return '';
    const lines = text.split('\n');
    if (lines.length > maxLines) {
      return `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length - maxLines} more lines)`;
    }
    return text;
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function requireArgs(args: string[], min: number, ctx: ConsoleCommandContext, usage: string): boolean {
  if (args.length < min) {
    ctx.error(`Usage: ${usage}`);
    return false;
  }
  return true;
}

function parseNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

function parseBoolean(token: string | undefined): boolean | null {
  if (token === undefined) return null;
  const lower = token.toLowerCase();
  if (lower === '1' || lower === 'on' || lower === 'true' || lower === 'yes') return true;
  if (lower === '0' || lower === 'off' || lower === 'false' || lower === 'no') return false;
  return null;
}

function settingKeys(deps: ConsoleDeps): Array<keyof EngineSettings> {
  return Object.keys(deps.defaultSettings) as Array<keyof EngineSettings>;
}

export function registerEngineConsoleCommands(console: EngineConsole, deps: ConsoleDeps): void {
  console.register({
    name: 'set',
    description: 'Set an engine setting. set <key> <value>',
    usage: '<key> <value>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 2, ctx, 'set <key> <value>')) return;
      const key = args[0] as keyof EngineSettings;
      if (!(key in deps.defaultSettings)) {
        ctx.error(`Unknown setting: ${args[0]}`);
        return;
      }
      const parsed = deps.parseSettingValue(key, args.slice(1).join(' '));
      if (parsed === null) {
        ctx.error(`Could not parse value for ${args[0]}: ${args.slice(1).join(' ')}`);
        return;
      }
      const next: Partial<EngineSettings> = { ...deps.getSettings(), [key]: parsed };
      deps.setSettings(next, key);
      ctx.log(`${args[0]} = ${JSON.stringify(parsed)}`);
    },
  });

  console.register({
    name: 'get',
    description: 'Read an engine setting. get <key>',
    usage: '<key>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'get <key>')) return;
      const settings = deps.getSettings() as unknown as Record<string, unknown>;
      const value = settings[args[0]];
      if (value === undefined) {
        ctx.error(`Unknown setting: ${args[0]}`);
        return;
      }
      ctx.log(`${args[0]} = ${JSON.stringify(value)}`);
    },
  });

  console.register({
    name: 'settings',
    description: 'List settings. Optional substring filter.',
    usage: '[filter]',
    handler: (args, ctx) => {
      const filter = args[0]?.toLowerCase() ?? '';
      const entries = settingKeys(deps)
        .filter(key => filter === '' || key.toLowerCase().includes(filter))
        .sort();
      const current = deps.getSettings() as unknown as Record<string, unknown>;
      if (entries.length === 0) {
        ctx.error(`No settings match "${filter}"`);
        return;
      }
      for (const key of entries) ctx.log(`  ${String(key).padEnd(28)} ${JSON.stringify(current[String(key)])}`);
    },
  });

  console.register({
    name: 'reset',
    description: 'Reset all engine settings to defaults.',
    aliases: ['resetsettings'],
    handler: () => deps.dispatchAction('resetSettings') ? 'Settings reset to defaults.' : 'reset failed',
  });

  console.register({
    name: 'action',
    description: 'Invoke a settings/UI action by name. Use "actions" for the catalog.',
    usage: '<name>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'action <name>')) return;
      const handled = deps.dispatchAction(args[0]);
      if (!handled) ctx.error(`Unknown action: ${args[0]}`);
      else ctx.log(`-> ${args[0]}`);
    },
  });

  console.register({
    name: 'actions',
    description: 'List known actions. Optional substring filter.',
    usage: '[filter]',
    handler: (args, ctx) => {
      const filter = args[0]?.toLowerCase() ?? '';
      const matches = KNOWN_SETTINGS_ACTIONS.filter(name => filter === '' || name.toLowerCase().includes(filter));
      if (matches.length === 0) ctx.error(`No actions match "${filter}"`);
      else for (const name of matches) ctx.log(`  ${name}`);
    },
  });

  console.register({
    name: 'camera',
    description: 'Print or set camera state.',
    usage: '[get|tp x y z|look yaw pitch|fov deg|speed n]',
    aliases: ['cam'],
    handler: (args, ctx) => {
      const sub = (args[0] ?? 'get').toLowerCase();
      if (sub === 'get' || args.length === 0) {
        const c = deps.camera;
        ctx.log(`pos: [${Array.from(c.position).map(v => describeNumber(v)).join(', ')}]`);
        ctx.log(`yaw: ${describeNumber(c.yaw)} rad (${describeNumber(c.yaw * 180 / Math.PI, 1)}°)`);
        ctx.log(`pitch: ${describeNumber(c.pitch)} rad (${describeNumber(c.pitch * 180 / Math.PI, 1)}°)`);
        ctx.log(`fov: ${describeNumber(c.fovDegrees, 1)}°`);
        ctx.log(`speed: ${describeNumber(c.speed, 1)} (fast x${describeNumber(c.fastMultiplier, 1)})`);
        return;
      }
      if (sub === 'tp' || sub === 'teleport') {
        if (!requireArgs(args, 4, ctx, 'camera tp <x> <y> <z>')) return;
        const x = parseNumber(args[1]);
        const y = parseNumber(args[2]);
        const z = parseNumber(args[3]);
        if (x === null || y === null || z === null) { ctx.error('camera tp expects three numbers'); return; }
        deps.camera.position[0] = x;
        deps.camera.position[1] = y;
        deps.camera.position[2] = z;
        ctx.log(`teleported to [${x}, ${y}, ${z}]`);
        return;
      }
      if (sub === 'look') {
        if (!requireArgs(args, 3, ctx, 'camera look <yawDeg> <pitchDeg>')) return;
        const yaw = parseNumber(args[1]);
        const pitch = parseNumber(args[2]);
        if (yaw === null || pitch === null) { ctx.error('camera look expects two numbers (degrees)'); return; }
        deps.camera.yaw = yaw * Math.PI / 180;
        deps.camera.pitch = Math.max(-1.45, Math.min(1.45, pitch * Math.PI / 180));
        ctx.log(`yaw=${describeNumber(yaw, 1)}°, pitch=${describeNumber(pitch, 1)}°`);
        return;
      }
      if (sub === 'fov') {
        const fov = parseNumber(args[1]);
        if (fov === null) { ctx.error('camera fov <deg>'); return; }
        deps.setSettings({ ...deps.getSettings(), fov }, 'fov');
        ctx.log(`fov=${fov}°`);
        return;
      }
      if (sub === 'speed') {
        const speed = parseNumber(args[1]);
        if (speed === null) { ctx.error('camera speed <n>'); return; }
        deps.setSettings({ ...deps.getSettings(), cameraSpeed: speed }, 'cameraSpeed');
        ctx.log(`speed=${speed}`);
        return;
      }
      ctx.error(`camera: unknown subcommand "${sub}"`);
    },
  });

  console.register({
    name: 'tp',
    description: 'Teleport camera to x y z.',
    usage: '<x> <y> <z>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 3, ctx, 'tp <x> <y> <z>')) return;
      const [x, y, z] = args.map(parseNumber);
      if (x === null || y === null || z === null) { ctx.error('tp expects three numbers'); return; }
      deps.camera.position[0] = x;
      deps.camera.position[1] = y;
      deps.camera.position[2] = z;
      ctx.log(`teleported to [${x}, ${y}, ${z}]`);
    },
  });

  console.register({
    name: 'radius',
    description: 'Set stream radius in chunks.',
    usage: '<n>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'radius <n>')) return;
      const n = parseNumber(args[0]);
      if (n === null) { ctx.error('radius expects a number'); return; }
      deps.setSettings({ ...deps.getSettings(), streamRadius: Math.round(n) }, 'streamRadius');
      ctx.log(`streamRadius=${Math.round(n)}`);
    },
  });

  console.register({
    name: 'slot',
    description: 'Switch to a region slot index (0-based).',
    usage: '<index>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'slot <index>')) return;
      const n = parseNumber(args[0]);
      if (n === null) { ctx.error('slot expects an index'); return; }
      deps.setSettings({ ...deps.getSettings(), regionSlot: Math.round(n) }, 'regionSlot');
      ctx.log(`regionSlot=${Math.round(n)}`);
    },
  });

  console.register({
    name: 'lod',
    description: 'Enable or disable LOD rings.',
    usage: '<on|off>',
    handler: (args, ctx) => {
      const v = parseBoolean(args[0]);
      if (v === null) { ctx.log(`terrainLodEnabled=${deps.getSettings().terrainLodEnabled}`); return; }
      deps.setSettings({ ...deps.getSettings(), terrainLodEnabled: v }, 'terrainLodEnabled');
      ctx.log(`terrainLodEnabled=${v}`);
    },
  });

  for (const toggle of [
    ['near', 'nearTerrainEnabled'],
    ['far', 'farTerrainEnabled'],
    ['water', 'waterEnabled'],
    ['vegetation', 'vegetationEnabled'],
    ['sky', 'skyEnabled'],
    ['cinematic', 'cinematicLighting'],
    ['shadows', 'shadowsEnabled'],
    ['markers', 'gameMarkersEnabled'],
    ['preview', 'brushPreviewEnabled'],
    ['follow', 'densitySliceFollowCamera'],
    ['streaming', 'streamingEnabled'],
  ] as const) {
    const [name, key] = toggle;
    console.register({
      name,
      description: `Toggle ${key}.`,
      usage: '<on|off>',
      handler: (args, ctx) => {
        const v = parseBoolean(args[0]);
        if (v === null) { ctx.log(`${key}=${(deps.getSettings() as unknown as Record<string, unknown>)[key]}`); return; }
        deps.setSettings({ ...deps.getSettings(), [key]: v }, key as keyof EngineSettings);
        ctx.log(`${key}=${v}`);
      },
    });
  }

  console.register({
    name: 'panel',
    description: 'Toggle a UI panel: overlay, settings, density, region.',
    usage: '<overlay|settings|density|region> <on|off>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'panel <name> [on|off]')) return;
      const lookup: Record<string, keyof EngineSettings> = {
        overlay: 'overlayPanelVisible',
        settings: 'settingsPanelVisible',
        density: 'densityPanelVisible',
        region: 'regionBrowserPanelVisible',
      };
      const key = lookup[args[0].toLowerCase()];
      if (!key) { ctx.error(`Unknown panel: ${args[0]}. One of: ${Object.keys(lookup).join(', ')}`); return; }
      const v = parseBoolean(args[1]);
      if (v === null) {
        ctx.log(`${key}=${(deps.getSettings() as unknown as Record<string, unknown>)[key]}`);
        return;
      }
      deps.setSettings({ ...deps.getSettings(), [key]: v }, key);
      ctx.log(`${key}=${v}`);
    },
  });

  console.register({
    name: 'debug',
    description: 'Set the terrain debug view by name or index.',
    usage: '<name|index>',
    handler: (args, ctx) => {
      if (args.length === 0) {
        ctx.log(`debugView=${deps.getSettings().debugView}`);
        ctx.log(`names: ${Object.keys(DEBUG_VIEW_NAMES).join(', ')}`);
        return;
      }
      const token = args[0].toLowerCase();
      const numeric = parseNumber(token);
      const idx = numeric !== null ? Math.round(numeric) : DEBUG_VIEW_NAMES[token];
      if (idx === undefined || !Number.isFinite(idx)) {
        ctx.error(`Unknown debug view: ${args[0]}`);
        return;
      }
      deps.setSettings({ ...deps.getSettings(), debugView: idx }, 'debugView');
      ctx.log(`debugView=${idx}`);
    },
  });

  console.register({
    name: 'paint',
    description: 'Switch to paint mode and choose material.',
    usage: '<grass|rock|snow|mud>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'paint <material>')) return;
      const mat = PAINT_MATERIAL_NAMES[args[0].toLowerCase()];
      if (mat === undefined) { ctx.error(`Unknown paint material: ${args[0]}`); return; }
      deps.setSettings({ ...deps.getSettings(), brushMode: BRUSH_MODE_NAMES.paint, paintMaterial: mat }, 'all');
      ctx.log(`paint material=${args[0]} (${mat})`);
    },
  });

  console.register({
    name: 'brush',
    description: 'Set brush mode/shape/radius.',
    usage: '<mode|shape|radius|distance|strength|falloff|length> <value>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 2, ctx, 'brush <field> <value>')) return;
      const field = args[0].toLowerCase();
      const settings = deps.getSettings();
      const next: Partial<EngineSettings> = { ...settings };
      if (field === 'mode') {
        const v = BRUSH_MODE_NAMES[args[1].toLowerCase()];
        if (v === undefined) { ctx.error(`Unknown brush mode: ${args[1]}`); return; }
        next.brushMode = v;
        deps.setSettings(next, 'brushMode');
      } else if (field === 'shape') {
        const v = BRUSH_SHAPE_NAMES[args[1].toLowerCase()];
        if (v === undefined) { ctx.error(`Unknown brush shape: ${args[1]}`); return; }
        next.brushShape = v;
        deps.setSettings(next, 'brushShape');
      } else if (field === 'radius') {
        const v = parseNumber(args[1]);
        if (v === null) { ctx.error('brush radius <n>'); return; }
        next.editRadius = v;
        deps.setSettings(next, 'editRadius');
      } else if (field === 'distance') {
        const v = parseNumber(args[1]);
        if (v === null) { ctx.error('brush distance <n>'); return; }
        next.brushDistance = v;
        deps.setSettings(next, 'brushDistance');
      } else if (field === 'strength') {
        const v = parseNumber(args[1]);
        if (v === null) { ctx.error('brush strength <n>'); return; }
        next.brushStrength = v;
        deps.setSettings(next, 'brushStrength');
      } else if (field === 'falloff') {
        const v = parseNumber(args[1]);
        if (v === null) { ctx.error('brush falloff <n>'); return; }
        next.brushFalloff = v;
        deps.setSettings(next, 'brushFalloff');
      } else if (field === 'length') {
        const v = parseNumber(args[1]);
        if (v === null) { ctx.error('brush length <n>'); return; }
        next.brushLength = v;
        deps.setSettings(next, 'brushLength');
      } else {
        ctx.error(`Unknown brush field: ${field}`);
        return;
      }
      ctx.log(`brush.${field}=${args[1]}`);
    },
  });

  console.register({
    name: 'quality',
    description: 'Set quality preset.',
    usage: '<auto|low|balanced|high|ultra>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'quality <preset>')) return;
      const v = QUALITY_PRESET_NAMES[args[0].toLowerCase()];
      if (v === undefined) { ctx.error(`Unknown quality preset: ${args[0]}`); return; }
      deps.setSettings({ ...deps.getSettings(), qualityPreset: v }, 'qualityPreset');
      ctx.log(`qualityPreset=${args[0]}`);
    },
  });

  console.register({
    name: 'undo',
    description: 'Undo last edit.',
    handler: () => { deps.streamer.undoEdit(); return 'undo'; },
  });

  console.register({
    name: 'redo',
    description: 'Redo last undone edit.',
    handler: () => { deps.streamer.redoEdit(); return 'redo'; },
  });

  console.register({
    name: 'edit',
    description: 'Edit log control.',
    usage: '<undo|redo|clear|clear-branches|switch-branch|reload>',
    handler: (args, ctx) => {
      const sub = (args[0] ?? '').toLowerCase();
      if (sub === 'undo') deps.streamer.undoEdit();
      else if (sub === 'redo') deps.streamer.redoEdit();
      else if (sub === 'clear') deps.streamer.clearEdits();
      else if (sub === 'clear-branches' || sub === 'clearbranches') deps.dispatchAction('clearEditBranches');
      else if (sub === 'switch-branch' || sub === 'switchbranch') deps.dispatchAction('switchEditBranch');
      else if (sub === 'reload') deps.streamer.reloadChunks();
      else { ctx.error('edit <undo|redo|clear|clear-branches|switch-branch|reload>'); return; }
      ctx.log(`edit ${sub}`);
    },
  });

  console.register({
    name: 'region',
    description: 'Region operations.',
    usage: '<save|load|diff|export|import|clear|rename|duplicate|prune|bundle-export|bundle-import>',
    handler: (args, ctx) => {
      const sub = (args[0] ?? '').toLowerCase();
      const map: Record<string, string> = {
        save: 'saveRegion',
        load: 'loadRegion',
        diff: 'diffRegion',
        export: 'exportRegion',
        import: 'importRegion',
        clear: 'clearSavedRegion',
        rename: 'renameRegion',
        duplicate: 'duplicateRegion',
        prune: 'pruneOldestRegion',
        'bundle-export': 'exportRegionBundle',
        'bundle-import': 'importRegionBundle',
        'preview-import': 'previewRegionImport',
        'apply-preview': 'applyRegionImportPreview',
        'merge-preview': 'mergeRegionImportPreview',
        'dry-run-retention': 'dryRunRegionRetention',
        'apply-retention': 'applyRegionRetention',
        'maintenance-report': 'exportRegionMaintenanceReport',
      };
      const action = map[sub];
      if (!action) { ctx.error(`region <${Object.keys(map).join('|')}>`); return; }
      if (!deps.dispatchAction(action)) ctx.error(`action failed: ${action}`);
      else ctx.log(`-> ${action}`);
    },
  });

  console.register({
    name: 'export',
    description: 'Export an artifact.',
    usage: '<diagnostic|quality|worldgen|region|bundle|density|benchmarks|maintenance>',
    handler: (args, ctx) => {
      const sub = (args[0] ?? '').toLowerCase();
      const map: Record<string, string> = {
        diagnostic: 'exportDiagnosticCapture',
        quality: 'exportQualityCapture',
        worldgen: 'exportWorldgenTiles',
        region: 'exportRegion',
        bundle: 'exportRegionBundle',
        density: 'exportDensityCaptures',
        benchmarks: 'exportWorkerBenchmarks',
        maintenance: 'exportRegionMaintenanceReport',
      };
      const action = map[sub];
      if (!action) { ctx.error(`export <${Object.keys(map).join('|')}>`); return; }
      if (!deps.dispatchAction(action)) ctx.error(`action failed: ${action}`);
      else ctx.log(`-> ${action}`);
    },
  });

  console.register({
    name: 'bench',
    description: 'Run the browser worker benchmark in a temporary worker.',
    aliases: ['benchmark'],
    handler: () => { deps.dispatchAction('runWorkerBenchmark'); return 'worker benchmark started'; },
  });

  console.register({
    name: 'stats',
    description: 'Print runtime profile + streamer counts.',
    handler: (_args, ctx) => {
      const counts = deps.streamer.counts();
      const profile = deps.profiler.last;
      ctx.log(`fps: ${describeNumber(1000 / Math.max(profile.avgFrameMs, 0.001), 1)} (avg frame ${describeNumber(profile.avgFrameMs, 2)} ms, last ${describeNumber(profile.frameMs, 2)} ms)`);
      ctx.log(`upload avg: ${describeNumber(profile.avgUploadMB)} MB | gpu est: ${describeNumber(profile.estimatedGpuMB)} MB`);
      ctx.log(`chunks: queued ${counts.queued} | pending ${counts.pending} | loaded ${counts.loaded} | workers ${counts.workers} (idle ${counts.idle})`);
      ctx.log(`stream radius: base ${deps.streamer.baseStreamRadius} | effective ${deps.streamer.effectiveStreamRadius} | lod ${deps.streamer.terrainLodEnabled ? 'on' : 'off'}`);
    },
  });

  console.register({
    name: 'chunks',
    description: 'Alias for stats.',
    handler: () => { void console.execute('stats'); },
  });

  console.register({
    name: 'caps',
    description: 'Print renderer capabilities and stats.',
    aliases: ['capabilities'],
    handler: (_args, ctx) => {
      ctx.log('capabilities:');
      ctx.log(formatJson(deps.renderer.capabilities));
      ctx.log('renderer stats:');
      ctx.log(formatJson(deps.renderer.stats, 80));
    },
  });

  console.register({
    name: 'streamer',
    description: 'Print streamer.lastStats JSON.',
    handler: (_args, ctx) => ctx.log(formatJson(deps.streamer.lastStats, 100)),
  });

  console.register({
    name: 'probe',
    description: 'Run worldgen probe at given x z or at camera position.',
    usage: '[x z]',
    handler: (args, ctx) => {
      if (!deps.worldgenProbe) { ctx.error('Worldgen probe is not available.'); return; }
      const x = args.length >= 2 ? parseNumber(args[0]) : deps.camera.position[0];
      const z = args.length >= 2 ? parseNumber(args[1]) : deps.camera.position[2];
      if (x === null || z === null) { ctx.error('probe expects two numbers or no args'); return; }
      const data = deps.worldgenProbe(x, z);
      ctx.log(`probe @ (${describeNumber(x)}, ${describeNumber(z)}):`);
      ctx.log(formatJson(data, 80));
    },
  });

  console.register({
    name: 'progress',
    description: 'Print game progress JSON.',
    handler: (_args, ctx) => ctx.log(formatJson(deps.game.progress(), 60)),
  });

  console.register({
    name: 'reset-game',
    description: 'Reset game progress (beacons, contracts, hazards, traversal).',
    aliases: ['resetgame'],
    handler: () => { deps.dispatchAction('resetGameProgress'); return 'game progress reset'; },
  });

  console.register({
    name: 'find',
    description: 'Search settings and actions matching substring.',
    usage: '<text>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'find <text>')) return;
      const needle = args[0].toLowerCase();
      const matchedSettings = settingKeys(deps).filter(k => String(k).toLowerCase().includes(needle));
      const matchedActions = KNOWN_SETTINGS_ACTIONS.filter(a => a.toLowerCase().includes(needle));
      if (matchedSettings.length === 0 && matchedActions.length === 0) { ctx.error(`No matches for "${args[0]}"`); return; }
      if (matchedSettings.length > 0) {
        ctx.log('settings:');
        for (const k of matchedSettings) ctx.log(`  ${String(k)}`);
      }
      if (matchedActions.length > 0) {
        ctx.log('actions:');
        for (const a of matchedActions) ctx.log(`  ${a}`);
      }
    },
  });

  console.register({
    name: 'reload',
    description: 'Reload the page (full app reset).',
    handler: () => deps.reload(),
  });

  console.register({
    name: 'echo',
    description: 'Print arguments back to the console.',
    handler: (args) => args.join(' '),
  });

  console.register({
    name: 'edits',
    description: 'Print recent edit log entries. edits [count] [-r=N redo] [-b=N branches]',
    usage: '[count]',
    handler: (args, ctx) => {
      if (!deps.editLogSnapshot) { ctx.error('Edit log snapshot is unavailable.'); return; }
      const count = parseNumber(args[0]) ?? 10;
      const snap = deps.editLogSnapshot();
      ctx.log(`activeVersion=${snap.activeVersion}, nextEditId=${snap.nextEditId}, active=${snap.active.length}, redo=${snap.redo.length}, branches=${snap.branches.length}`);
      const limit = Math.max(1, Math.round(count));
      const active = snap.active.slice(-limit).reverse();
      if (active.length > 0) {
        ctx.log('recent active edits:');
        for (const edit of active) ctx.log(`  ${formatJson(edit, 4)}`);
      }
    },
  });

  console.register({
    name: 'branches',
    description: 'List archived edit branches.',
    handler: (_args, ctx) => {
      if (!deps.editLogSnapshot) { ctx.error('Edit log snapshot is unavailable.'); return; }
      const snap = deps.editLogSnapshot();
      if (snap.branches.length === 0) { ctx.log('No archived branches.'); return; }
      for (const branch of snap.branches) ctx.log(`  ${formatJson(branch, 4)}`);
    },
  });

  console.register({
    name: 'regions',
    description: 'List managed region slots.',
    handler: (_args, ctx) => {
      if (!deps.regionSlotList) { ctx.error('Region slot list is unavailable.'); return; }
      const slots = deps.regionSlotList();
      if (slots.length === 0) { ctx.log('No region slots.'); return; }
      for (const slot of slots) {
        const saved = slot.savedAt ? new Date(slot.savedAt).toISOString() : '(empty)';
        ctx.log(`  [${slot.index}] ${slot.key} "${slot.name}" chunks=${slot.chunks ?? 0} edits=${slot.edits ?? 0} ${saved}`);
      }
    },
  });

  console.register({
    name: 'presets',
    description: 'Brush preset operations.',
    usage: '<list|apply|delete> [id]',
    handler: (args, ctx) => {
      const sub = (args[0] ?? 'list').toLowerCase();
      if (sub === 'list') {
        if (!deps.brushPresetList) { ctx.error('Preset list unavailable.'); return; }
        const list = deps.brushPresetList();
        if (list.length === 0) { ctx.log('No brush presets.'); return; }
        for (const preset of list) ctx.log(`  ${preset.id}  ${preset.label}`);
        return;
      }
      if (sub === 'apply') {
        if (!requireArgs(args, 2, ctx, 'presets apply <id>')) return;
        if (!deps.applyBrushPreset) { ctx.error('applyBrushPreset unavailable.'); return; }
        const ok = deps.applyBrushPreset(args[1]);
        ctx.log(ok ? `applied ${args[1]}` : `unknown preset: ${args[1]}`);
        return;
      }
      if (sub === 'delete') {
        if (!requireArgs(args, 2, ctx, 'presets delete <id>')) return;
        if (!deps.deleteBrushPreset) { ctx.error('deleteBrushPreset unavailable.'); return; }
        const ok = deps.deleteBrushPreset(args[1]);
        ctx.log(ok ? `deleted ${args[1]}` : `unknown preset: ${args[1]}`);
        return;
      }
      ctx.error('presets <list|apply|delete> [id]');
    },
  });

  for (const cacheName of ['chunk', 'worldgen', 'erosion', 'material', 'cave'] as const) {
    console.register({
      name: `${cacheName}-cache`,
      description: `Print ${cacheName} cache stats.`,
      handler: (_args, ctx) => {
        if (!deps.tileCacheStats) { ctx.error('Cache stats unavailable.'); return; }
        const stats = deps.tileCacheStats(cacheName);
        if (!stats) { ctx.error(`No stats for "${cacheName}" cache.`); return; }
        ctx.log(formatJson(stats, 120));
      },
    });
  }

  console.register({
    name: 'caches',
    description: 'Print stats for all tile caches at once.',
    handler: (_args, ctx) => {
      if (!deps.tileCacheStats) { ctx.error('Cache stats unavailable.'); return; }
      for (const name of ['chunk', 'worldgen', 'erosion', 'material', 'cave'] as const) {
        const stats = deps.tileCacheStats(name);
        if (!stats) continue;
        ctx.log(`-- ${name} cache --`);
        ctx.log(formatJson(stats, 40));
      }
    },
  });

  console.register({
    name: 'pool',
    description: 'Typed-array pool stats from streamer.lastStats.',
    handler: (_args, ctx) => {
      if (!deps.poolStats) {
        const stats = deps.streamer.lastStats;
        const pooled = {
          pooledArrays: stats.pooledArrays,
          pooledMB: stats.pooledMB,
          poolHits: stats.poolHits,
          poolMisses: stats.poolMisses,
          workerScratchMB: stats.workerScratchMB,
          workerScratchReuses: stats.workerScratchReuses,
        };
        ctx.log(formatJson(pooled));
        return;
      }
      ctx.log(formatJson(deps.poolStats(), 40));
    },
  });

  console.register({
    name: 'auto-quality',
    description: 'Print current auto-quality state.',
    aliases: ['autoq'],
    handler: (_args, ctx) => {
      if (!deps.autoQualityState) { ctx.error('Auto-quality state unavailable.'); return; }
      ctx.log(formatJson(deps.autoQualityState(), 40));
    },
  });

  console.register({
    name: 'benchmarks',
    description: 'List recent browser-worker benchmark captures.',
    aliases: ['bench-history'],
    handler: (_args, ctx) => {
      if (!deps.benchmarkHistory) { ctx.error('Benchmark history unavailable.'); return; }
      const list = deps.benchmarkHistory();
      if (list.length === 0) { ctx.log('No recorded benchmarks.'); return; }
      ctx.log(`${list.length} benchmark capture(s):`);
      ctx.log(formatJson(list.slice(0, 4), 80));
    },
  });

  console.register({
    name: 'state',
    description: 'Compact engine state snapshot: camera, settings, stats, profile.',
    handler: (_args, ctx) => {
      ctx.log('camera:');
      ctx.log(`  pos=[${Array.from(deps.camera.position).map(v => describeNumber(v)).join(', ')}] yaw=${describeNumber(deps.camera.yaw)} pitch=${describeNumber(deps.camera.pitch)} fov=${describeNumber(deps.camera.fovDegrees, 1)}`);
      const counts = deps.streamer.counts();
      ctx.log(`streamer: queued=${counts.queued} pending=${counts.pending} loaded=${counts.loaded} workers=${counts.workers} idle=${counts.idle}`);
      ctx.log(`profile: frame=${describeNumber(deps.profiler.last.avgFrameMs, 2)}ms uploadMB=${describeNumber(deps.profiler.last.avgUploadMB)} gpuMB=${describeNumber(deps.profiler.last.estimatedGpuMB)}`);
      ctx.log(`settings keys: ${Object.keys(deps.defaultSettings).length}`);
    },
  });

  console.register({
    name: 'pause',
    description: 'Pause animation (sets animationSpeed=0).',
    handler: () => {
      deps.setSettings({ ...deps.getSettings(), animationSpeed: 0 }, 'animationSpeed');
      return 'paused';
    },
  });

  console.register({
    name: 'unpause',
    description: 'Resume animation (sets animationSpeed=1).',
    aliases: ['resume'],
    handler: () => {
      deps.setSettings({ ...deps.getSettings(), animationSpeed: 1 }, 'animationSpeed');
      return 'resumed';
    },
  });

  console.register({
    name: 'time',
    description: 'Set animation speed multiplier.',
    usage: '<multiplier>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'time <multiplier>')) return;
      const v = parseNumber(args[0]);
      if (v === null) { ctx.error('time expects a number'); return; }
      deps.setSettings({ ...deps.getSettings(), animationSpeed: v }, 'animationSpeed');
      ctx.log(`animationSpeed=${v}`);
    },
  });

  console.register({
    name: 'screenshot',
    description: 'Save the canvas as a PNG via toBlob.',
    usage: '[filename]',
    handler: async (args, ctx) => {
      if (deps.screenshot) {
        await deps.screenshot(args[0]);
        return 'screenshot saved';
      }
      if (!deps.canvas) { ctx.error('Canvas access unavailable.'); return; }
      const canvas = deps.canvas();
      if (!canvas) { ctx.error('Canvas not found.'); return; }
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob returned null')); return; }
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = args[0] ?? `storm-canyon-${Date.now()}.png`;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 5000);
          resolve();
        }, 'image/png');
      });
      return 'screenshot saved';
    },
  });

  console.register({
    name: 'alias',
    description: 'Define a command alias. alias <name> <body...>',
    usage: '<name> <body...>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 2, ctx, 'alias <name> <body...>')) return;
      const name = args[0];
      const body = args.slice(1).join(' ');
      console.setAlias(name, body);
      ctx.log(`alias ${name} -> ${body}`);
    },
  });

  console.register({
    name: 'aliases',
    description: 'List defined aliases.',
    handler: (_args, ctx) => {
      const list = console.listAliases();
      if (list.length === 0) { ctx.log('No aliases defined.'); return; }
      for (const a of list) ctx.log(`  ${a.name} -> ${a.body}`);
    },
  });

  console.register({
    name: 'unalias',
    description: 'Remove a command alias.',
    usage: '<name>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'unalias <name>')) return;
      ctx.log(console.removeAlias(args[0]) ? `removed alias ${args[0]}` : `no such alias: ${args[0]}`);
    },
  });

  console.register({
    name: 'history',
    description: 'Print recent command history.',
    usage: '[count]',
    handler: (args, ctx) => {
      const limit = parseNumber(args[0]) ?? 20;
      const hist = console.getHistory(Math.max(1, Math.round(limit)));
      if (hist.length === 0) { ctx.log('No history.'); return; }
      hist.forEach((line, i) => ctx.log(`  ${i + 1}. ${line}`));
    },
  });

  console.register({
    name: 'watch',
    description: 'Run a command repeatedly. watch <intervalMs> <cmd...>',
    usage: '<intervalMs> <cmd...>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 2, ctx, 'watch <intervalMs> <cmd...>')) return;
      const interval = parseNumber(args[0]);
      if (interval === null) { ctx.error('watch expects an interval in ms as the first argument'); return; }
      const command = args.slice(1).join(' ');
      const id = console.startWatcher(command, interval);
      ctx.log(`watch[${id}] every ${Math.max(200, Math.round(interval))}ms: ${command}`);
    },
  });

  console.register({
    name: 'unwatch',
    description: 'Stop a watcher (or all of them).',
    usage: '[id|all]',
    handler: (args, ctx) => {
      if (args.length === 0 || args[0].toLowerCase() === 'all') {
        const n = console.stopAllWatchers();
        ctx.log(`stopped ${n} watcher(s)`);
        return;
      }
      const id = parseNumber(args[0]);
      if (id === null) { ctx.error('unwatch <id> or "unwatch all"'); return; }
      ctx.log(console.stopWatcher(Math.round(id)) ? `stopped watcher ${id}` : `no watcher with id ${id}`);
    },
  });

  console.register({
    name: 'watchers',
    description: 'List active watchers.',
    handler: (_args, ctx) => {
      const list = console.listWatchers();
      if (list.length === 0) { ctx.log('No watchers.'); return; }
      for (const w of list) ctx.log(`  [${w.id}] every ${w.intervalMs}ms: ${w.command}`);
    },
  });

  console.register({
    name: 'loop',
    description: 'Run a command N times. loop <n> <cmd...>',
    usage: '<n> <cmd...>',
    handler: async (args, ctx) => {
      if (!requireArgs(args, 2, ctx, 'loop <n> <cmd...>')) return;
      const n = parseNumber(args[0]);
      if (n === null || n <= 0) { ctx.error('loop expects a positive count'); return; }
      const command = args.slice(1).join(' ');
      const count = Math.min(1000, Math.max(1, Math.round(n)));
      for (let i = 0; i < count; i++) await console.execute(command);
      ctx.log(`loop done (${count} iterations)`);
    },
  });

  console.register({
    name: 'run',
    description: 'Run multiple commands separated by semicolons.',
    usage: '<cmd>; <cmd>; ...',
    handler: async (args) => { await console.execute(args.join(' ')); },
  });

  console.register({
    name: 'seek',
    description: 'Increment streamRadius by a delta (can be negative).',
    usage: '<delta>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'seek <delta>')) return;
      const delta = parseNumber(args[0]);
      if (delta === null) { ctx.error('seek expects a number'); return; }
      const next = Math.round(deps.getSettings().streamRadius + delta);
      deps.setSettings({ ...deps.getSettings(), streamRadius: next }, 'streamRadius');
      ctx.log(`streamRadius=${next}`);
    },
  });

  console.register({
    name: 'mark',
    description: 'Drop a labeled marker into the console output for visual scanning.',
    usage: '[label]',
    handler: (args) => `=== ${args.join(' ') || 'mark'} === @ ${new Date().toISOString()}`,
  });

  console.register({
    name: 'version',
    description: 'Print engine + browser context.',
    handler: (_args, ctx) => {
      ctx.log(`User agent: ${navigator.userAgent}`);
      ctx.log(`Cross-origin isolated: ${deps.renderer.capabilities.crossOriginIsolated} | SAB: ${deps.renderer.capabilities.sharedArrayBufferAvailable}`);
      ctx.log(`WebGPU max buffer: ${deps.renderer.capabilities.maxBufferSizeMB} MB | timestamps: ${deps.renderer.capabilities.timestampQuery} | multi-draw: ${deps.renderer.capabilities.multiDrawIndirect}`);
      ctx.log(`Worker buffer mode: ${deps.renderer.capabilities.workerBufferMode}`);
    },
  });

  console.register({
    name: 'wait',
    description: 'Sleep for the given number of milliseconds (capped at 60000).',
    usage: '<ms>',
    handler: async (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'wait <ms>')) return;
      const ms = parseNumber(args[0]);
      if (ms === null || ms < 0) { ctx.error('wait expects a non-negative number'); return; }
      const capped = Math.min(60000, Math.round(ms));
      await new Promise<void>(resolve => window.setTimeout(resolve, capped));
    },
  });

  console.register({
    name: 'assert',
    description: 'Assert that a setting equals an expected value. Logs PASS/FAIL.',
    usage: '<key> <expected>',
    handler: (args, ctx) => {
      if (!requireArgs(args, 2, ctx, 'assert <key> <expected>')) return;
      const key = args[0] as keyof EngineSettings;
      if (!(key in deps.defaultSettings)) { ctx.error(`Unknown setting: ${args[0]}`); return; }
      const expected = deps.parseSettingValue(key, args.slice(1).join(' '));
      const actual = (deps.getSettings() as unknown as Record<string, unknown>)[String(key)];
      const pass = expected !== null && JSON.stringify(expected) === JSON.stringify(actual);
      ctx.log(`${pass ? 'PASS' : 'FAIL'} ${args[0]} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
      if (!pass) throw new Error(`assert failed: ${args[0]}`);
    },
  });

  console.register({
    name: 'lod-plan',
    description: 'Print LOD plan summary from streamer stats.',
    handler: (_args, ctx) => {
      const s = deps.streamer.lastStats;
      const summary = {
        targetChunks: s.lodPlanTargetChunks,
        lod0: s.lodPlanLod0Chunks,
        lod1: s.lodPlanLod1Chunks,
        lod2Plus: s.lodPlanLod2PlusChunks,
        transitionFaces: s.lodPlanTransitionFaces,
        transitionEdges: s.lodPlanTransitionEdges,
        transitionFaceBaseCells: s.lodPlanTransitionFaceBaseCells,
        transitionCells: s.lodPlanTransitionCells,
        coveredBaseCells: s.lodPlanCoveredBaseCells,
        skirtedChunks: s.lodPlanSkirtedChunks,
        maxLod: s.lodPlanMaxLod,
        transitionMeshNative: s.lodTransitionMeshNative,
        transitionMeshCells: s.lodTransitionMeshCells,
        transitionMeshTriangles: s.lodTransitionMeshTriangles,
        transitionMeshEmittedCells: s.lodTransitionMeshEmittedCells,
        transitionMeshMissingCells: s.lodTransitionMeshMissingSampleCells,
        transitionMeshDegenerateCells: s.lodTransitionMeshDegenerateCells,
      };
      ctx.log(formatJson(summary, 40));
    },
  });

  console.register({
    name: 'compression',
    description: 'Print region compression telemetry.',
    handler: (_args, ctx) => {
      const s = deps.streamer.lastStats;
      const c = {
        rawMB: s.regionCompressionRawMB,
        encodedMB: s.regionCompressionEncodedMB,
        ratio: s.regionCompressionRatio,
        savedChunks: s.savedRegionChunks,
        loadedChunks: s.loadedRegionChunks,
        exportedChunks: s.exportedRegionChunks,
        importedChunks: s.importedRegionChunks,
      };
      ctx.log(formatJson(c, 20));
    },
  });

  console.register({
    name: 'sharing',
    description: 'Print SharedArrayBuffer worker telemetry (queues, remesh, result slots).',
    handler: (_args, ctx) => {
      const s = deps.streamer.lastStats;
      const block = {
        queuePages: s.sharedQueuePages,
        queueDispatches: s.sharedQueueDispatches,
        queueBatches: s.sharedQueueBatches,
        queueBatchMax: s.sharedQueueBatchMax,
        remeshPages: s.sharedRemeshPages,
        remeshDispatches: s.sharedRemeshDispatches,
        remeshFallbackDispatches: s.remeshFallbackDispatches,
        remeshFallbackBytes: s.remeshFallbackBytes,
        resultPages: s.sharedResultPages,
        resultChunks: s.sharedResultChunks,
        resultSlotCapacity: s.sharedResultSlotCapacity,
        resultSlotOccupied: s.sharedResultSlotOccupied,
        resultSlotExhaustions: s.sharedResultSlotExhaustions,
        resultSlotReleases: s.sharedResultSlotReleases,
        cacheBorrowedChunks: s.sharedResultCacheBorrowedChunks,
        cacheBorrowedBytes: s.sharedResultCacheBorrowedBytes,
        cacheCopyBytes: s.sharedResultCacheCopyBytes,
      };
      ctx.log(formatJson(block, 30));
    },
  });

  console.register({
    name: 'markers',
    description: 'Print active marker counts (game + edit/debug).',
    handler: (_args, ctx) => {
      const r = deps.renderer.stats as unknown as Record<string, number | undefined>;
      ctx.log(`gameMarkers=${r.gameMarkers ?? 0} debugMarkers=${r.debugMarkers ?? 0}`);
    },
  });

  console.register({
    name: 'panels',
    description: 'Print current visibility flags for all panels.',
    handler: (_args, ctx) => {
      const s = deps.getSettings();
      ctx.log(`overlay=${s.overlayPanelVisible} settings=${s.settingsPanelVisible} density=${s.densityPanelVisible} regionBrowser=${s.regionBrowserPanelVisible}`);
    },
  });

  console.register({
    name: 'flash',
    description: 'Briefly toggle a setting twice (off then back) to verify the renderer/streamer responds.',
    usage: '<key>',
    handler: async (args, ctx) => {
      if (!requireArgs(args, 1, ctx, 'flash <key>')) return;
      const key = args[0] as keyof EngineSettings;
      const settings = deps.getSettings() as unknown as Record<string, unknown>;
      const original = settings[String(key)];
      if (original === undefined) { ctx.error(`Unknown setting: ${args[0]}`); return; }
      if (typeof original !== 'boolean') { ctx.error(`flash currently only handles boolean settings, got ${typeof original}`); return; }
      deps.setSettings({ ...deps.getSettings(), [key]: !original }, key);
      await new Promise<void>(resolve => window.setTimeout(resolve, 200));
      deps.setSettings({ ...deps.getSettings(), [key]: original }, key);
      ctx.log(`flashed ${args[0]} (off and back on)`);
    },
  });

  console.register({
    name: 'sweep',
    description: 'Sweep a numeric setting from lo to hi in N steps with a delay. Restores original at end.',
    usage: '<key> <lo> <hi> <steps> [delayMs=120]',
    handler: async (args, ctx) => {
      if (!requireArgs(args, 4, ctx, 'sweep <key> <lo> <hi> <steps> [delayMs]')) return;
      const key = args[0] as keyof EngineSettings;
      const settings = deps.getSettings() as unknown as Record<string, unknown>;
      const original = settings[String(key)];
      if (original === undefined) { ctx.error(`Unknown setting: ${args[0]}`); return; }
      if (typeof original !== 'number') { ctx.error(`sweep requires a numeric setting, got ${typeof original}`); return; }
      const lo = parseNumber(args[1]);
      const hi = parseNumber(args[2]);
      const steps = parseNumber(args[3]);
      const delay = parseNumber(args[4]) ?? 120;
      if (lo === null || hi === null || steps === null || steps < 1) { ctx.error('Invalid sweep arguments'); return; }
      const n = Math.min(64, Math.round(steps));
      const span = hi - lo;
      for (let i = 0; i <= n; i++) {
        const t = n === 0 ? 0 : i / n;
        const value = lo + span * t;
        deps.setSettings({ ...deps.getSettings(), [key]: value }, key);
        ctx.log(`  ${args[0]}=${describeNumber(value, 3)}`);
        await new Promise<void>(resolve => window.setTimeout(resolve, Math.max(0, delay)));
      }
      deps.setSettings({ ...deps.getSettings(), [key]: original }, key);
      ctx.log(`sweep done; restored ${args[0]}=${original}`);
    },
  });

  console.register({
    name: 'crash',
    description: 'Intentionally trigger an error path. crash <unknown-action|throw|reject|setting>',
    usage: '<kind>',
    handler: async (args, ctx) => {
      const kind = args[0] ?? 'throw';
      if (kind === 'throw') throw new Error('crash test: synchronous throw');
      if (kind === 'reject') {
        await Promise.reject(new Error('crash test: rejected promise'));
        return;
      }
      if (kind === 'unknown-action') {
        const ok = deps.dispatchAction('this-action-does-not-exist');
        ctx.log(`dispatchAction returned: ${ok}`);
        return;
      }
      if (kind === 'setting') {
        const next: Partial<EngineSettings> = { ...deps.getSettings(), streamRadius: Number.NaN };
        deps.setSettings(next, 'streamRadius');
        ctx.log(`streamRadius after NaN write: ${deps.getSettings().streamRadius}`);
        return;
      }
      ctx.error(`crash kinds: throw, reject, unknown-action, setting`);
    },
  });

  console.register({
    name: 'waypoint',
    description: 'Manage scratch tour waypoints. waypoint <add|list|remove|clear|time|easing|save|load|delete|tours>',
    usage: '<sub> [...args]',
    aliases: ['wp'],
    handler: (args, ctx) => {
      if (!deps.tour) { ctx.error('Tour system unavailable.'); return; }
      const sub = (args[0] ?? 'list').toLowerCase();
      if (sub === 'add') {
        const spacing = parseNumber(args[1]);
        const wp = deps.tour.addWaypoint(spacing !== null ? { spacingMs: spacing } : undefined);
        ctx.log(`#${deps.tour.listScratch().length - 1} added @${wp.timeMs} ms: pos=[${wp.position.map(v => describeNumber(v, 1)).join(', ')}] yaw=${describeNumber(wp.yaw, 3)} pitch=${describeNumber(wp.pitch, 3)}`);
        return;
      }
      if (sub === 'list') {
        const list = deps.tour.listScratch();
        if (list.length === 0) { ctx.log('Scratch tour is empty. Use "waypoint add" to capture the current pose.'); return; }
        ctx.log(`Scratch tour: ${list.length} waypoint(s)`);
        list.forEach((wp, i) => ctx.log(`  #${i} @${wp.timeMs.toFixed(0)}ms pos=[${wp.position.map(v => describeNumber(v, 1)).join(', ')}] yaw=${describeNumber(wp.yaw, 3)} pitch=${describeNumber(wp.pitch, 3)}${wp.fov !== undefined ? ` fov=${describeNumber(wp.fov, 1)}` : ''}`));
        return;
      }
      if (sub === 'remove') {
        if (!requireArgs(args, 2, ctx, 'waypoint remove <index>')) return;
        const idx = parseNumber(args[1]);
        if (idx === null) { ctx.error('waypoint remove expects an index'); return; }
        const removed = deps.tour.removeWaypoint(Math.round(idx));
        ctx.log(removed ? `removed waypoint #${idx}` : `no waypoint at index ${idx}`);
        return;
      }
      if (sub === 'clear') {
        const n = deps.tour.clearScratch();
        ctx.log(`cleared ${n} waypoint(s)`);
        return;
      }
      if (sub === 'time') {
        if (!requireArgs(args, 3, ctx, 'waypoint time <index> <ms>')) return;
        const idx = parseNumber(args[1]);
        const ms = parseNumber(args[2]);
        if (idx === null || ms === null) { ctx.error('waypoint time expects index and ms'); return; }
        const ok = deps.tour.setWaypointTime(Math.round(idx), ms);
        ctx.log(ok ? `#${Math.round(idx)} timeMs=${ms}` : `no waypoint at index ${idx}`);
        return;
      }
      if (sub === 'easing') {
        if (!requireArgs(args, 2, ctx, 'waypoint easing <linear|smooth>')) return;
        const e = args[1].toLowerCase();
        if (e !== 'linear' && e !== 'smooth') { ctx.error('easing must be "linear" or "smooth"'); return; }
        deps.tour.setEasing(e);
        ctx.log(`easing=${e}`);
        return;
      }
      if (sub === 'save') {
        if (!requireArgs(args, 2, ctx, 'waypoint save <name>')) return;
        try {
          const tour = deps.tour.saveScratch(args[1]);
          ctx.log(`saved tour "${tour.name}" with ${tour.waypoints.length} waypoints`);
        } catch (error) {
          ctx.error(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (sub === 'load') {
        if (!requireArgs(args, 2, ctx, 'waypoint load <name>')) return;
        try {
          const tour = deps.tour.loadIntoScratch(args[1]);
          ctx.log(`loaded "${args[1]}" into scratch: ${tour.waypoints.length} waypoints`);
        } catch (error) {
          ctx.error(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (sub === 'delete') {
        if (!requireArgs(args, 2, ctx, 'waypoint delete <name>')) return;
        ctx.log(deps.tour.deleteSaved(args[1]) ? `deleted "${args[1]}"` : `no saved tour named "${args[1]}"`);
        return;
      }
      if (sub === 'tours') {
        const names = deps.tour.listSaved();
        if (names.length === 0) { ctx.log('No saved tours.'); return; }
        for (const name of names) {
          const tour = deps.tour.getSaved(name);
          ctx.log(`  ${name}: ${tour?.waypoints.length ?? 0} waypoints, ${tour?.easing ?? 'smooth'} easing`);
        }
        return;
      }
      ctx.error(`waypoint <add|list|remove|clear|time|easing|save|load|delete|tours>`);
    },
  });

  console.register({
    name: 'tour',
    description: 'Run/stop/inspect a camera tour and capture a deterministic benchmark.',
    usage: '<run|stop|pause|resume|status|summary|export> [name|@scratch]',
    handler: (args, ctx) => {
      if (!deps.tour) { ctx.error('Tour system unavailable.'); return; }
      const sub = (args[0] ?? 'status').toLowerCase();
      if (sub === 'run' || sub === 'start' || sub === 'play') {
        const target = args[1] ?? '@scratch';
        try {
          const tour = deps.tour.start(target);
          ctx.log(`Running "${tour.name}" (${tour.waypoints.length} waypoints, ~${(tour.waypoints[tour.waypoints.length - 1].timeMs / 1000).toFixed(1)}s)`);
        } catch (error) {
          ctx.error(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (sub === 'stop') {
        const result = deps.tour.stop();
        if (!result) { ctx.log('No tour running.'); return; }
        ctx.log(`Tour "${result.tour}" stopped: ${result.sampleCount} samples, avg ${describeNumber(result.summary.avgFrameMs, 2)} ms, p95 ${describeNumber(result.summary.p95FrameMs, 2)} ms`);
        return;
      }
      if (sub === 'pause') {
        ctx.log(deps.tour.pause() ? 'paused' : 'no tour to pause');
        return;
      }
      if (sub === 'resume') {
        ctx.log(deps.tour.resume() ? 'resumed' : 'no paused tour');
        return;
      }
      if (sub === 'status') {
        ctx.log(`tour state: ${deps.tour.state()}`);
        return;
      }
      if (sub === 'summary') {
        const result = deps.tour.getLastResult();
        if (!result) { ctx.error('No tour benchmark captured yet. Run a tour first.'); return; }
        ctx.log(`Tour "${result.tour}" — ${result.sampleCount} samples over ${describeNumber(result.durationMs / 1000, 2)} s`);
        ctx.log(`  avgFrame=${describeNumber(result.summary.avgFrameMs, 2)}ms (avgFps=${describeNumber(result.summary.avgFps, 1)})`);
        ctx.log(`  min/p50/p95/p99/max frame: ${describeNumber(result.summary.minFrameMs, 2)} / ${describeNumber(result.summary.p50FrameMs, 2)} / ${describeNumber(result.summary.p95FrameMs, 2)} / ${describeNumber(result.summary.p99FrameMs, 2)} / ${describeNumber(result.summary.maxFrameMs, 2)} ms`);
        ctx.log(`  drawCalls avg=${describeNumber(result.summary.avgDrawCalls, 1)} | terrainTris avg=${describeNumber(result.summary.avgTerrainTriangles, 0)}`);
        ctx.log(`  upload avg=${describeNumber(result.summary.avgUploadMB, 2)} MB (peak ${describeNumber(result.summary.peakUploadMB, 2)} MB) | gpuMB avg=${describeNumber(result.summary.avgEstimatedGpuMB, 1)} (peak ${describeNumber(result.summary.peakEstimatedGpuMB, 1)})`);
        ctx.log(`  clusters avg=${describeNumber(result.summary.avgVisibleTerrainClusters, 1)} | veg avg=${describeNumber(result.summary.avgVegetationInstances, 0)} | worker pending avg=${describeNumber(result.summary.avgWorkerPending, 1)} | queued peak=${result.summary.peakWorkerQueued}`);
        for (const seg of result.perSegment) {
          ctx.log(`  seg ${seg.segmentIndex}: ${seg.samples} samples, avg ${describeNumber(seg.avgFrameMs, 2)} ms (p95 ${describeNumber(seg.p95FrameMs, 2)}, max ${describeNumber(seg.maxFrameMs, 2)})`);
        }
        return;
      }
      if (sub === 'export' || sub === 'download') {
        const ok = deps.tour.download(args[1]);
        ctx.log(ok ? 'tour benchmark downloaded' : 'no tour benchmark available; run a tour first');
        return;
      }
      ctx.error('tour <run|stop|pause|resume|status|summary|export> [name]');
    },
  });

  console.register({
    name: 'close',
    description: 'Close the console.',
    aliases: ['quit', 'exit'],
    handler: () => console.close(),
  });
}
