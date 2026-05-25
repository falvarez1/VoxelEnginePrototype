import type { EngineSettings } from './engine_contracts';

type SettingKey = keyof EngineSettings;
type SettingValue = EngineSettings[SettingKey];
type SettingAction =
  | 'carve'
  | 'undoEdit'
  | 'redoEdit'
  | 'switchEditBranch'
  | 'clearEdits'
  | 'clearEditBranches'
  | 'reloadChunks'
  | 'pickPaintMaterial'
  | 'paintMaterialGrass'
  | 'paintMaterialRock'
  | 'paintMaterialSnow'
  | 'paintMaterialMud'
  | 'brushPresetDetail'
  | 'brushPresetPath'
  | 'brushPresetTerrace'
  | 'brushPresetTunnel'
  | 'saveBrushPreset'
  | 'clearBrushPresets'
  | 'falloffPresetHard'
  | 'falloffPresetSoft'
  | 'saveRegion'
  | 'loadRegion'
  | 'diffRegion'
  | 'renameRegion'
  | 'duplicateRegion'
  | 'pruneOldestRegion'
  | 'dryRunRegionRetention'
  | 'applyRegionRetention'
  | 'exportRegionMaintenanceReport'
  | 'exportRegionBundle'
  | 'importRegionBundle'
  | 'previewRegionImport'
  | 'applyRegionImportPreview'
  | 'mergeRegionImportPreview'
  | 'resetGameProgress'
  | 'exportRegion'
  | 'importRegion'
  | 'clearSavedRegion'
  | 'captureDensitySlice'
  | 'previousDensityCapture'
  | 'nextDensityCapture'
  | 'previousDensitySet'
  | 'nextDensitySet'
  | 'newDensitySet'
  | 'renameDensitySet'
  | 'importDensityCaptures'
  | 'diffDensitySlice'
  | 'runWorkerBenchmark'
  | 'exportWorkerBenchmarks'
  | 'importWorkerBenchmarks'
  | 'clearWorkerBenchmarks'
  | 'exportDiagnosticCapture'
  | 'exportQualityCapture'
  | 'exportWorldgenTiles'
  | 'exportDensityCaptures'
  | 'clearDensityCaptures'
  | 'resetSettings';

interface BaseSettingDefinition {
  key: SettingKey;
  label: string;
}

interface RangeSettingDefinition extends BaseSettingDefinition {
  type: 'range';
  min: number;
  max: number;
  step: number;
  suffix?: string;
  scale?: number;
  precision?: number;
}

interface ToggleSettingDefinition extends BaseSettingDefinition {
  type: 'toggle';
}

interface SelectSettingDefinition extends BaseSettingDefinition {
  type: 'select';
  options: Array<{ label: string; value: SettingValue }>;
}

type SettingDefinition = RangeSettingDefinition | ToggleSettingDefinition | SelectSettingDefinition;

interface SettingGroup {
  title: string;
  items: SettingDefinition[];
}

interface RangeControl {
  input: HTMLInputElement;
  output: HTMLOutputElement;
}

interface ToggleControl {
  input: HTMLInputElement;
}

interface SelectControl {
  input: HTMLSelectElement;
}

interface BrushMaterialSwatch {
  material: number;
  button: HTMLButtonElement;
}

type BrushPresetPanelAction = 'apply' | 'delete';

interface SettingsPanelOptions {
  root: HTMLElement;
  initialSettings: EngineSettings;
  onChange?: (settings: EngineSettings, changedKey: SettingKey | 'all') => void;
  onAction?: (action: SettingAction) => void;
  onBrushPresetAction?: (action: BrushPresetPanelAction, id: string) => void;
}

export interface EditHistoryPanelItem {
  id: number;
  label: string;
  detail: string;
  state: 'active' | 'redo' | 'branch';
}

export interface EditHistoryPanelState {
  editCount: number;
  redoCount: number;
  branchCount: number;
  maxEdits: number;
  items: EditHistoryPanelItem[];
}

export type BrushInspectorTone =
  | 'core'
  | 'falloff'
  | 'grass'
  | 'rock'
  | 'snow'
  | 'mud'
  | 'biome'
  | 'water'
  | 'cave'
  | 'mask';

export interface BrushInspectorBar {
  group: string;
  label: string;
  value: number;
  valueLabel: string;
  tone?: BrushInspectorTone;
}

export interface BrushInspectorPanelState {
  summary: string;
  detail: string;
  bars: BrushInspectorBar[];
}

export interface RegionDiffPanelItem {
  label: string;
  detail: string;
  state: 'changed' | 'active' | 'saved' | 'branch-active' | 'branch-saved';
}

export interface RegionDiffPanelState {
  status: 'empty' | 'missing' | 'compared';
  summary: string;
  detail: string;
  items: RegionDiffPanelItem[];
}

export interface BrushPresetPanelItem {
  id: string;
  name: string;
  detail: string;
  active: boolean;
}

export interface BrushPresetPanelState {
  count: number;
  maxPresets: number;
  items: BrushPresetPanelItem[];
}

export interface SettingsPanel {
  setValue(key: SettingKey, value: unknown, shouldNotify?: boolean): void;
  setSettings(nextSettings: Partial<EngineSettings>, shouldNotify?: boolean): void;
  setSelectOptions(key: SettingKey, options: Array<{ label: string; value: SettingValue }>): void;
  setBrushInspector(state: BrushInspectorPanelState): void;
  setRegionDiff(state: RegionDiffPanelState): void;
  setBrushPresets(state: BrushPresetPanelState): void;
  setEditHistory(history: EditHistoryPanelState): void;
  getSettings(): EngineSettings;
}

const GROUPS: SettingGroup[] = [
  {
    title: 'Terrain',
    items: [
      { key: 'streamRadius', label: 'Stream radius', type: 'range', min: 3, max: 20, step: 1, suffix: ' chunks' },
      { key: 'streamingEnabled', label: 'Streaming', type: 'toggle' },
      { key: 'terrainLodEnabled', label: 'LOD rings', type: 'toggle' },
      { key: 'nearTerrainEnabled', label: 'Near SDF', type: 'toggle' },
      { key: 'farTerrainEnabled', label: 'Far vista', type: 'toggle' },
      { key: 'materialDetail', label: 'Material detail', type: 'range', min: 0, max: 1.8, step: 0.05, suffix: 'x', precision: 2 },
    ],
  },
  {
    title: 'Visuals',
    items: [
      {
        key: 'qualityPreset',
        label: 'Quality preset',
        type: 'select',
        options: [
          { label: 'Auto', value: 4 },
          { label: 'Low', value: 0 },
          { label: 'Balanced', value: 1 },
          { label: 'High', value: 2 },
          { label: 'Ultra', value: 3 },
        ],
      },
      { key: 'waterEnabled', label: 'Water', type: 'toggle' },
      { key: 'vegetationEnabled', label: 'Vegetation', type: 'toggle' },
      { key: 'gameMarkersEnabled', label: 'Game markers', type: 'toggle' },
      { key: 'skyEnabled', label: 'Sky', type: 'toggle' },
      { key: 'cinematicLighting', label: 'Cinematic light', type: 'toggle' },
      { key: 'exposure', label: 'Exposure', type: 'range', min: 0.55, max: 1.8, step: 0.05, suffix: 'x', precision: 2 },
      { key: 'atmosphereStrength', label: 'Atmosphere', type: 'range', min: 0, max: 2, step: 0.05, suffix: 'x', precision: 2 },
      { key: 'fogDensity', label: 'Fog density', type: 'range', min: 0, max: 2.2, step: 0.05, suffix: 'x', precision: 2 },
      { key: 'waterOpacity', label: 'Water opacity', type: 'range', min: 0.15, max: 1, step: 0.01, suffix: '%', scale: 100, precision: 0 },
      { key: 'animationSpeed', label: 'Animation', type: 'range', min: 0, max: 2, step: 0.05, suffix: 'x', precision: 2 },
    ],
  },
  {
    title: 'Camera',
    items: [
      { key: 'cameraSpeed', label: 'Move speed', type: 'range', min: 8, max: 150, step: 1, suffix: ' m/s' },
      { key: 'fastMultiplier', label: 'Fast boost', type: 'range', min: 1, max: 6, step: 0.1, suffix: 'x', precision: 1 },
      { key: 'fov', label: 'FOV', type: 'range', min: 45, max: 95, step: 1, suffix: ' deg' },
      { key: 'editRadius', label: 'Brush radius', type: 'range', min: 2, max: 22, step: 0.5, suffix: ' m', precision: 1 },
      { key: 'brushDistance', label: 'Brush distance', type: 'range', min: 8, max: 96, step: 1, suffix: ' m' },
      {
        key: 'brushMode',
        label: 'Brush mode',
        type: 'select',
        options: [
          { label: 'Carve', value: 0 },
          { label: 'Build', value: 1 },
          { label: 'Paint', value: 2 },
          { label: 'Smooth', value: 3 },
          { label: 'Flatten', value: 4 },
        ],
      },
      {
        key: 'brushShape',
        label: 'Brush shape',
        type: 'select',
        options: [
          { label: 'Sphere', value: 0 },
          { label: 'Box', value: 1 },
          { label: 'Capsule', value: 2 },
        ],
      },
      { key: 'brushLength', label: 'Capsule length', type: 'range', min: 2, max: 64, step: 1, suffix: ' m' },
      { key: 'brushFalloff', label: 'Brush falloff', type: 'range', min: 0, max: 8, step: 0.25, suffix: ' m', precision: 2 },
      { key: 'brushPreviewEnabled', label: 'Brush preview', type: 'toggle' },
      { key: 'brushStrength', label: 'Brush strength', type: 'range', min: 0.05, max: 1, step: 0.05, suffix: 'x', precision: 2 },
      {
        key: 'paintMaterial',
        label: 'Paint material',
        type: 'select',
        options: [
          { label: 'Rock', value: 1 },
          { label: 'Grass', value: 0 },
          { label: 'Snow', value: 2 },
          { label: 'Mud', value: 3 },
        ],
      },
    ],
  },
  {
    title: 'Light',
    items: [
      { key: 'sunAzimuth', label: 'Sun azimuth', type: 'range', min: 0, max: 360, step: 1, suffix: ' deg' },
      { key: 'sunElevation', label: 'Sun elevation', type: 'range', min: 5, max: 85, step: 1, suffix: ' deg' },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      {
        key: 'debugView',
        label: 'Debug view',
        type: 'select',
        options: [
          { label: 'Off', value: 0 },
          { label: 'Normals', value: 1 },
          { label: 'Materials', value: 2 },
          { label: 'AO', value: 3 },
          { label: 'Chunk IDs', value: 4 },
          { label: 'Density Slice', value: 5 },
          { label: 'Dirty Regions', value: 6 },
          { label: 'Material Masks', value: 7 },
          { label: 'Biome Mask', value: 8 },
          { label: 'Wetness Mask', value: 9 },
          { label: 'Snow Mask', value: 10 },
        ],
      },
      {
        key: 'densitySliceAxis',
        label: 'Slice axis',
        type: 'select',
        options: [
          { label: 'Y', value: 1 },
          { label: 'X', value: 0 },
          { label: 'Z', value: 2 },
        ],
      },
      { key: 'densitySliceIndex', label: 'Slice index', type: 'range', min: 0, max: 32, step: 1 },
      { key: 'densitySliceFollowCamera', label: 'Follow camera', type: 'toggle' },
    ],
  },
  {
    title: 'Persistence',
    items: [
      {
        key: 'regionSlot',
        label: 'Region slot',
        type: 'select',
        options: [
          { label: 'Region A', value: 0 },
          { label: 'Region B', value: 1 },
          { label: 'Region C', value: 2 },
          { label: 'Region D', value: 3 },
        ],
      },
    ],
  },
];

const PANEL_BRUSH_MODE_PAINT = 2;
const PANEL_PAINT_MATERIAL_GRASS = 0;
const PANEL_PAINT_MATERIAL_ROCK = 1;
const PANEL_PAINT_MATERIAL_SNOW = 2;
const PANEL_PAINT_MATERIAL_MUD = 3;

function clampNumber(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function coerceValue(def: SettingDefinition, raw: unknown): SettingValue {
  if (def.type === 'toggle') return Boolean(raw);
  if (def.type === 'select') {
    const match = def.options.find(option => String(option.value) === String(raw));
    return match?.value ?? def.options[0]?.value;
  }
  const value = clampNumber(raw, def.min, def.max);
  return def.step >= 1 ? Math.round(value) : value;
}

function formatValue(def: SettingDefinition, value: SettingValue): string {
  if (def.type === 'toggle') return '';
  if (def.type === 'select') return def.options.find(option => option.value === value)?.label ?? '';
  const scale = def.scale ?? 1;
  const precision = def.precision ?? 0;
  return `${(Number(value) * scale).toFixed(precision)}${def.suffix ?? ''}`;
}

function findSettingDefinition(key: SettingKey): SettingDefinition | undefined {
  return GROUPS.flatMap(group => group.items).find(item => item.key === key);
}

export function createSettingsPanel({ root, initialSettings, onChange, onAction, onBrushPresetAction }: SettingsPanelOptions): SettingsPanel {
  const settings: EngineSettings = { ...initialSettings };
  const controls = new Map<SettingKey, RangeControl | ToggleControl | SelectControl>();
  const brushMaterialSwatches: BrushMaterialSwatch[] = [];

  root.textContent = '';
  root.className = 'settings-root';
  root.addEventListener('pointerdown', (event) => event.stopPropagation());
  root.addEventListener('click', (event) => event.stopPropagation());

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'settings-toggle';
  toggle.textContent = 'Settings';
  toggle.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('section');
  panel.className = 'settings-panel';
  panel.setAttribute('aria-label', 'Engine settings');

  const header = document.createElement('div');
  header.className = 'settings-header';
  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Engine Settings';
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'settings-collapse';
  collapse.textContent = 'Hide';
  header.append(title, collapse);
  panel.append(header);

  function notify(key: SettingKey): void {
    onChange?.({ ...settings }, key);
  }

  function updateBrushPaletteActive(): void {
    const isPaintMode = Number(settings.brushMode) === PANEL_BRUSH_MODE_PAINT;
    const activeMaterial = Number(settings.paintMaterial);
    for (const swatch of brushMaterialSwatches) {
      const active = isPaintMode && activeMaterial === swatch.material;
      swatch.button.classList.toggle('brush-swatch-active', active);
      swatch.button.setAttribute('aria-pressed', String(active));
    }
  }

  function setValue(key: SettingKey, value: unknown, shouldNotify = true): void {
    const def = findSettingDefinition(key);
    if (!def) return;
    const next = coerceValue(def, value);
    settings[key] = next as never;
    const control = controls.get(key);
    if (control) {
      if (def.type === 'toggle' && control.input instanceof HTMLInputElement) control.input.checked = Boolean(next);
      else if (def.type === 'select' && control.input instanceof HTMLSelectElement) control.input.value = String(next);
      else {
        control.input.value = String(next);
        if ('output' in control) control.output.textContent = formatValue(def, next);
      }
    }
    if (key === 'paintMaterial' || key === 'brushMode') updateBrushPaletteActive();
    if (shouldNotify) notify(key);
  }

  function addRange(parent: HTMLElement, def: RangeSettingDefinition): void {
    const row = document.createElement('label');
    row.className = 'setting-row setting-row-range';

    const meta = document.createElement('span');
    meta.className = 'setting-meta';
    const name = document.createElement('span');
    name.textContent = def.label;
    const output = document.createElement('output');
    output.textContent = formatValue(def, settings[def.key]);
    meta.append(name, output);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(coerceValue(def, settings[def.key]));
    input.addEventListener('input', () => setValue(def.key, input.value));

    row.append(meta, input);
    parent.append(row);
    controls.set(def.key, { input, output });
  }

  function addToggle(parent: HTMLElement, def: ToggleSettingDefinition): void {
    const row = document.createElement('label');
    row.className = 'setting-row setting-row-toggle';
    const name = document.createElement('span');
    name.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(settings[def.key]);
    const switchTrack = document.createElement('span');
    switchTrack.className = 'setting-switch';
    input.addEventListener('change', () => setValue(def.key, input.checked));
    row.append(name, input, switchTrack);
    parent.append(row);
    controls.set(def.key, { input });
  }

  function addSelect(parent: HTMLElement, def: SelectSettingDefinition): void {
    const row = document.createElement('label');
    row.className = 'setting-row setting-row-select';
    const name = document.createElement('span');
    name.textContent = def.label;
    const input = document.createElement('select');
    for (const optionDef of def.options) {
      const option = document.createElement('option');
      option.value = String(optionDef.value);
      option.textContent = optionDef.label;
      input.append(option);
    }
    input.value = String(coerceValue(def, settings[def.key]));
    input.addEventListener('change', () => setValue(def.key, input.value));
    row.append(name, input);
    parent.append(row);
    controls.set(def.key, { input });
  }

  function setSelectOptions(key: SettingKey, options: Array<{ label: string; value: SettingValue }>): void {
    const control = controls.get(key);
    if (!control || !(control.input instanceof HTMLSelectElement)) return;
    control.input.textContent = '';
    for (const optionDef of options) {
      const option = document.createElement('option');
      option.value = String(optionDef.value);
      option.textContent = optionDef.label;
      control.input.append(option);
    }
    control.input.value = String(settings[key]);
  }

  for (const group of GROUPS) {
    const section = document.createElement('div');
    section.className = 'settings-group';
    const groupTitle = document.createElement('div');
    groupTitle.className = 'settings-group-title';
    groupTitle.textContent = group.title;
    section.append(groupTitle);

    for (const item of group.items) {
      if (item.type === 'toggle') addToggle(section, item);
      else if (item.type === 'select') addSelect(section, item);
      else addRange(section, item);
    }
    panel.append(section);
  }

  const brushPaletteSection = document.createElement('div');
  brushPaletteSection.className = 'settings-group brush-palette';
  const brushPaletteTitle = document.createElement('div');
  brushPaletteTitle.className = 'settings-group-title';
  brushPaletteTitle.textContent = 'Brush Palette';
  const materialRow = document.createElement('div');
  materialRow.className = 'brush-palette-row brush-palette-materials';
  const materialDefs: Array<[SettingAction, string, number, string]> = [
    ['paintMaterialGrass', 'Grass', PANEL_PAINT_MATERIAL_GRASS, 'grass'],
    ['paintMaterialRock', 'Rock', PANEL_PAINT_MATERIAL_ROCK, 'rock'],
    ['paintMaterialSnow', 'Snow', PANEL_PAINT_MATERIAL_SNOW, 'snow'],
    ['paintMaterialMud', 'Mud', PANEL_PAINT_MATERIAL_MUD, 'mud'],
  ];
  for (const [action, label, material, tone] of materialDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `brush-swatch brush-swatch-${tone}`;
    button.title = `Paint ${label}`;
    button.setAttribute('aria-label', `Paint ${label}`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => onAction?.(action));
    materialRow.append(button);
    brushMaterialSwatches.push({ material, button });
  }
  const presetRow = document.createElement('div');
  presetRow.className = 'brush-palette-row brush-palette-presets';
  const presetDefs: Array<[SettingAction, string]> = [
    ['brushPresetDetail', 'Detail'],
    ['brushPresetPath', 'Path'],
    ['brushPresetTerrace', 'Terrace'],
    ['brushPresetTunnel', 'Tunnel'],
    ['falloffPresetHard', 'Hard'],
    ['falloffPresetSoft', 'Soft'],
  ];
  for (const [action, label] of presetDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => onAction?.(action));
    presetRow.append(button);
  }
  const presetManageRow = document.createElement('div');
  presetManageRow.className = 'brush-palette-row brush-palette-manage';
  const savePresetButton = document.createElement('button');
  savePresetButton.type = 'button';
  savePresetButton.textContent = 'Save Brush';
  savePresetButton.addEventListener('click', () => onAction?.('saveBrushPreset'));
  const clearPresetButton = document.createElement('button');
  clearPresetButton.type = 'button';
  clearPresetButton.textContent = 'Clear Saved';
  clearPresetButton.addEventListener('click', () => onAction?.('clearBrushPresets'));
  presetManageRow.append(savePresetButton, clearPresetButton);
  const customPresetSummary = document.createElement('div');
  customPresetSummary.className = 'brush-preset-summary';
  const customPresetList = document.createElement('ol');
  customPresetList.className = 'brush-preset-list';
  brushPaletteSection.append(brushPaletteTitle, materialRow, presetRow, presetManageRow, customPresetSummary, customPresetList);
  panel.append(brushPaletteSection);
  updateBrushPaletteActive();
  let lastBrushPresetKey = '';

  function setBrushPresets(state: BrushPresetPanelState): void {
    const maxPresets = Math.max(0, Math.trunc(state.maxPresets));
    const count = Math.max(0, Math.trunc(state.count));
    const items = state.items.slice(0, maxPresets);
    const key = [
      count,
      maxPresets,
      ...items.map(item => `${item.id}:${item.name}:${item.detail}:${item.active ? 1 : 0}`),
    ].join('|');
    if (key === lastBrushPresetKey) return;
    lastBrushPresetKey = key;

    customPresetSummary.textContent = `${count}/${maxPresets} saved brushes`;
    customPresetList.textContent = '';
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'brush-preset-empty';
      empty.textContent = 'No saved brushes';
      customPresetList.append(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('li');
      row.className = item.active ? 'brush-preset-item brush-preset-item-active' : 'brush-preset-item';
      const label = document.createElement('span');
      label.className = 'brush-preset-label';
      label.textContent = item.name;
      const detail = document.createElement('span');
      detail.className = 'brush-preset-detail';
      detail.textContent = item.detail;
      const actions = document.createElement('span');
      actions.className = 'brush-preset-actions';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = 'Apply';
      apply.addEventListener('click', () => onBrushPresetAction?.('apply', item.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => onBrushPresetAction?.('delete', item.id));
      actions.append(apply, remove);
      row.append(label, detail, actions);
      customPresetList.append(row);
    }
  }

  const brushInspectorSection = document.createElement('div');
  brushInspectorSection.className = 'settings-group brush-inspector';
  const brushInspectorTitle = document.createElement('div');
  brushInspectorTitle.className = 'settings-group-title';
  brushInspectorTitle.textContent = 'Brush Inspector';
  const brushInspectorSummary = document.createElement('div');
  brushInspectorSummary.className = 'brush-inspector-summary';
  const brushInspectorDetail = document.createElement('div');
  brushInspectorDetail.className = 'brush-inspector-detail';
  const brushInspectorBars = document.createElement('div');
  brushInspectorBars.className = 'brush-inspector-bars';
  brushInspectorSection.append(brushInspectorTitle, brushInspectorSummary, brushInspectorDetail, brushInspectorBars);
  panel.append(brushInspectorSection);
  let lastBrushInspectorKey = '';

  function setBrushInspector(state: BrushInspectorPanelState): void {
    const bars = state.bars.slice(0, 24).map(bar => ({
      ...bar,
      value: clampNumber(bar.value, 0, 1),
    }));
    const key = [
      state.summary,
      state.detail,
      ...bars.map(bar => `${bar.group}:${bar.label}:${bar.value.toFixed(3)}:${bar.valueLabel}:${bar.tone ?? ''}`),
    ].join('|');
    if (key === lastBrushInspectorKey) return;
    lastBrushInspectorKey = key;

    brushInspectorSummary.textContent = state.summary;
    brushInspectorDetail.textContent = state.detail;
    brushInspectorBars.textContent = '';

    let currentGroup = '';
    for (const bar of bars) {
      if (bar.group !== currentGroup) {
        currentGroup = bar.group;
        const group = document.createElement('div');
        group.className = 'brush-inspector-bar-group';
        group.textContent = currentGroup;
        brushInspectorBars.append(group);
      }

      const row = document.createElement('div');
      row.className = `brush-inspector-bar brush-inspector-bar-${bar.tone ?? 'mask'}`;
      const label = document.createElement('span');
      label.className = 'brush-inspector-label';
      label.textContent = bar.label;
      const track = document.createElement('span');
      track.className = 'brush-inspector-track';
      const fill = document.createElement('span');
      fill.className = 'brush-inspector-fill';
      fill.style.width = `${(bar.value * 100).toFixed(1)}%`;
      track.append(fill);
      const value = document.createElement('span');
      value.className = 'brush-inspector-value';
      value.textContent = bar.valueLabel;
      row.append(label, track, value);
      brushInspectorBars.append(row);
    }
  }

  const regionDiffSection = document.createElement('div');
  regionDiffSection.className = 'settings-group region-diff';
  const regionDiffTitle = document.createElement('div');
  regionDiffTitle.className = 'settings-group-title';
  regionDiffTitle.textContent = 'Region Diff';
  const regionDiffSummary = document.createElement('div');
  regionDiffSummary.className = 'region-diff-summary';
  const regionDiffDetail = document.createElement('div');
  regionDiffDetail.className = 'region-diff-detail';
  const regionDiffList = document.createElement('ol');
  regionDiffList.className = 'region-diff-list';
  regionDiffSection.append(regionDiffTitle, regionDiffSummary, regionDiffDetail, regionDiffList);
  panel.append(regionDiffSection);
  let lastRegionDiffKey = '';

  function setRegionDiff(state: RegionDiffPanelState): void {
    const items = state.items.slice(0, 10);
    const key = [
      state.status,
      state.summary,
      state.detail,
      ...items.map(item => `${item.state}:${item.label}:${item.detail}`),
    ].join('|');
    if (key === lastRegionDiffKey) return;
    lastRegionDiffKey = key;

    regionDiffSection.classList.toggle('region-diff-missing', state.status === 'missing');
    regionDiffSection.classList.toggle('region-diff-empty', state.status === 'empty');
    regionDiffSummary.textContent = state.summary;
    regionDiffDetail.textContent = state.detail;
    regionDiffList.textContent = '';

    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'region-diff-empty-row';
      empty.textContent = state.status === 'empty' ? 'No diff captured yet' : 'No sampled edit or branch differences';
      regionDiffList.append(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('li');
      row.className = `region-diff-item region-diff-item-${item.state}`;
      const label = document.createElement('span');
      label.className = 'region-diff-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'region-diff-item-detail';
      detail.textContent = item.detail;
      row.append(label, detail);
      regionDiffList.append(row);
    }
  }

  const editHistorySection = document.createElement('div');
  editHistorySection.className = 'settings-group edit-history';
  const editHistoryTitle = document.createElement('div');
  editHistoryTitle.className = 'settings-group-title';
  editHistoryTitle.textContent = 'Edit History';
  const editHistorySummary = document.createElement('div');
  editHistorySummary.className = 'edit-history-summary';
  const editHistoryList = document.createElement('ol');
  editHistoryList.className = 'edit-history-list';
  editHistorySection.append(editHistoryTitle, editHistorySummary, editHistoryList);
  panel.append(editHistorySection);
  let lastEditHistoryKey = '';

  function setEditHistory(history: EditHistoryPanelState): void {
    const maxEdits = Math.max(0, Math.trunc(history.maxEdits));
    const editCount = Math.max(0, Math.trunc(history.editCount));
    const redoCount = Math.max(0, Math.trunc(history.redoCount));
    const branchCount = Math.max(0, Math.trunc(history.branchCount));
    const items = history.items.slice(0, 12);
    const key = [
      editCount,
      redoCount,
      branchCount,
      maxEdits,
      ...items.map(item => `${item.id}:${item.state}:${item.label}:${item.detail}`),
    ].join('|');
    if (key === lastEditHistoryKey) return;
    lastEditHistoryKey = key;

    editHistorySummary.textContent = `${editCount}/${maxEdits} applied | ${redoCount} redo | ${branchCount} branches`;
    editHistoryList.textContent = '';
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'edit-history-empty';
      empty.textContent = 'No edits yet';
      editHistoryList.append(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('li');
      row.className = `edit-history-item edit-history-item-${item.state}`;
      const label = document.createElement('span');
      label.className = 'edit-history-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'edit-history-detail';
      detail.textContent = item.detail;
      const state = document.createElement('span');
      state.className = 'edit-history-state';
      state.textContent = item.state === 'branch' ? 'Branch' : item.state === 'redo' ? 'Redo' : 'Applied';
      row.append(label, detail, state);
      editHistoryList.append(row);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const actionDefs: Array<[SettingAction, string]> = [
    ['carve', 'Brush'],
    ['undoEdit', 'Undo'],
    ['redoEdit', 'Redo'],
    ['switchEditBranch', 'Switch Branch'],
    ['clearEdits', 'Clear Edits'],
    ['clearEditBranches', 'Clear Branches'],
    ['reloadChunks', 'Rebuild'],
    ['pickPaintMaterial', 'Pick Material'],
    ['brushPresetDetail', 'Detail Brush'],
    ['brushPresetPath', 'Path Brush'],
    ['falloffPresetHard', 'Hard Edge'],
    ['falloffPresetSoft', 'Soft Edge'],
    ['saveRegion', 'Save'],
    ['loadRegion', 'Load'],
    ['diffRegion', 'Diff Save'],
    ['renameRegion', 'Rename Slot'],
    ['duplicateRegion', 'Duplicate Slot'],
    ['pruneOldestRegion', 'Prune Oldest'],
    ['dryRunRegionRetention', 'Preview Retention'],
    ['applyRegionRetention', 'Apply Retention'],
    ['exportRegionMaintenanceReport', 'Export Report'],
    ['exportRegionBundle', 'Export All'],
    ['importRegionBundle', 'Import All'],
    ['previewRegionImport', 'Preview Import'],
    ['applyRegionImportPreview', 'Apply Preview'],
    ['mergeRegionImportPreview', 'Merge Preview'],
    ['resetGameProgress', 'Reset Game'],
    ['exportRegion', 'Export'],
    ['importRegion', 'Import'],
    ['clearSavedRegion', 'Clear Save'],
    ['captureDensitySlice', 'Capture Slice'],
    ['previousDensityCapture', 'Prev Slice'],
    ['nextDensityCapture', 'Next Slice'],
    ['previousDensitySet', 'Prev Set'],
    ['nextDensitySet', 'Next Set'],
    ['newDensitySet', 'New Set'],
    ['renameDensitySet', 'Rename Set'],
    ['importDensityCaptures', 'Import Slices'],
    ['diffDensitySlice', 'Diff Slice'],
    ['runWorkerBenchmark', 'Worker Bench'],
    ['exportWorkerBenchmarks', 'Export Bench'],
    ['importWorkerBenchmarks', 'Import Bench'],
    ['clearWorkerBenchmarks', 'Clear Bench'],
    ['exportDiagnosticCapture', 'Export Diagnostic'],
    ['exportQualityCapture', 'Export Quality'],
    ['exportWorldgenTiles', 'Export Worldgen'],
    ['exportDensityCaptures', 'Export Slices'],
    ['clearDensityCaptures', 'Clear Slices'],
    ['resetSettings', 'Defaults'],
  ];
  for (const [action, label] of actionDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => onAction?.(action));
    actions.append(button);
  }
  panel.append(actions);

  function setCollapsed(collapsed: boolean): void {
    root.classList.toggle('settings-root-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    collapse.textContent = collapsed ? 'Show' : 'Hide';
  }

  toggle.addEventListener('click', () => setCollapsed(!root.classList.contains('settings-root-collapsed')));
  collapse.addEventListener('click', () => setCollapsed(true));

  root.append(toggle, panel);
  setCollapsed(true);

  return {
    setValue,
    setSettings(nextSettings: Partial<EngineSettings>, shouldNotify = false) {
      for (const key of Object.keys(nextSettings) as SettingKey[]) setValue(key, nextSettings[key], false);
      if (shouldNotify) onChange?.({ ...settings }, 'all');
    },
    setSelectOptions,
    setBrushInspector,
    setRegionDiff,
    setBrushPresets,
    setEditHistory,
    getSettings(): EngineSettings {
      return { ...settings };
    },
  };
}
