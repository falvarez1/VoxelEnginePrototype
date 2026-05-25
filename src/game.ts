import {
  drainageMask,
  erosionMask,
  macroMoisture,
  macroTemperature,
  riverCenter,
  snowMask,
  terrainHeight,
  terrainMaterial,
  terrainNormal,
  vegetationMask,
  wetnessMask,
} from './terrain_math.ts';
import { vec3 } from './math.ts';
import type { EditOperation, GameProgress } from './engine_contracts.ts';
import type { FlyCamera, Vec3 } from './math.ts';

export interface GameSnapshot {
  collected: number;
  total: number;
  nextDistance: number;
  nextSiteName: string | null;
  nextBiome: string | null;
  nextMaterial: string | null;
  collectedBiomes: string[];
  totalBiomes: number;
  completedContracts: number;
  totalContracts: number;
  nextContractName: string | null;
  nextContractAction: string | null;
  nextContractDistance: number;
  visitedCheckpoints: number;
  totalCheckpoints: number;
  nextCheckpointName: string | null;
  nextCheckpointDistance: number;
  clearedHazards: number;
  totalHazards: number;
  nextHazardName: string | null;
  nextHazardAction: string | null;
  nextHazardDistance: number;
  activeHazardName: string | null;
  activeHazardRisk: string | null;
  traversalMeters: number;
  inventorySamples: number;
  inventoryFieldKits: number;
  inventoryRouteFlags: number;
  score: number;
  rank: string;
  complete: boolean;
}

interface Beacon {
  id: number;
  name: string;
  biome: string;
  material: string;
  position: Vec3;
  collected: boolean;
}

interface ContractSpec {
  name: string;
  action: string;
  x?: number;
  z: number;
  riverOffset?: number;
  requiredEditType: EditOperation['type'];
  requiredMaterial?: number;
  markerRadius: number;
  completionRadius: number;
}

interface FieldContract {
  id: number;
  name: string;
  action: string;
  position: Vec3;
  requiredEditType: EditOperation['type'];
  requiredMaterial?: number;
  markerRadius: number;
  completionRadius: number;
  completed: boolean;
}

interface RouteCheckpointSpec {
  name: string;
  x: number;
  z: number;
  radius: number;
  reward: string;
}

interface RouteCheckpoint {
  id: number;
  name: string;
  reward: string;
  position: Vec3;
  radius: number;
  visited: boolean;
}

interface HazardSpec {
  name: string;
  action: string;
  risk: string;
  x?: number;
  z: number;
  riverOffset?: number;
  requiredEditType: EditOperation['type'];
  requiredMaterial?: number;
  markerRadius: number;
  completionRadius: number;
  exposureRadius: number;
}

interface HazardSite {
  id: number;
  name: string;
  action: string;
  risk: string;
  position: Vec3;
  requiredEditType: EditOperation['type'];
  requiredMaterial?: number;
  markerRadius: number;
  completionRadius: number;
  exposureRadius: number;
  cleared: boolean;
}

const BEACON_OFFSETS: Array<[number, number]> = [
  [96, -148],
  [-164, -84],
  [188, 82],
  [-84, 196],
  [292, -228],
  [-316, 238],
];

const FIELD_CONTRACT_SPECS: ContractSpec[] = [
  {
    name: 'River Ford Grade',
    action: 'Flatten a ford across the wet river shelf',
    z: -236,
    riverOffset: 24,
    requiredEditType: 'flattenDensity',
    markerRadius: 1.85,
    completionRadius: 34,
  },
  {
    name: 'Meadow Restoration Plot',
    action: 'Paint grass back over the worn meadow patch',
    x: -126,
    z: 116,
    requiredEditType: 'paintMaterial',
    requiredMaterial: 0,
    markerRadius: 1.65,
    completionRadius: 30,
  },
  {
    name: 'Ridge Access Cut',
    action: 'Carve a notch through the exposed ridge shoulder',
    x: 242,
    z: 182,
    requiredEditType: 'subtractSphere',
    markerRadius: 1.95,
    completionRadius: 36,
  },
  {
    name: 'Survey Cairn Build',
    action: 'Build a small marker cairn on the dry slope',
    x: -284,
    z: -212,
    requiredEditType: 'addSphere',
    markerRadius: 1.55,
    completionRadius: 28,
  },
];

const ROUTE_CHECKPOINT_SPECS: RouteCheckpointSpec[] = [
  { name: 'Low Water Crossing', x: -42, z: -318, radius: 26, reward: 'river route flag' },
  { name: 'Timber Saddle', x: 212, z: -42, radius: 28, reward: 'forest route flag' },
  { name: 'High Lake Overlook', x: -248, z: 326, radius: 32, reward: 'alpine route flag' },
];

const HAZARD_SPECS: HazardSpec[] = [
  {
    name: 'Rockslide Choke',
    action: 'Carve loose rock away from the blocked trail',
    risk: 'blocked trail',
    x: 168,
    z: -318,
    requiredEditType: 'subtractSphere',
    markerRadius: 2.15,
    completionRadius: 34,
    exposureRadius: 48,
  },
  {
    name: 'Bogged River Shelf',
    action: 'Build stable fill over the wet shelf',
    risk: 'slow crossing',
    z: 36,
    riverOffset: -34,
    requiredEditType: 'addSphere',
    markerRadius: 2.05,
    completionRadius: 32,
    exposureRadius: 46,
  },
  {
    name: 'Washed Meadow Scar',
    action: 'Paint grass over the eroded scar',
    risk: 'erosion spread',
    x: -224,
    z: -28,
    requiredEditType: 'paintMaterial',
    requiredMaterial: 0,
    markerRadius: 1.95,
    completionRadius: 30,
    exposureRadius: 42,
  },
];

const COLLECT_RADIUS = 15;
const CHECKPOINT_COLLECT_RADIUS = 18;
const GAME_PROGRESS_STORAGE_KEY = 'stormCanyon.gameProgress.v2';

function materialLabel(material: number): string {
  if (material === 1) return 'Rock';
  if (material === 2) return 'Snow';
  if (material === 3) return 'Mud';
  return 'Grass';
}

function classifySurveySite(x: number, z: number): { biome: string; material: string; height: number } {
  const height = terrainHeight(x, z);
  const normal = terrainNormal(x, z);
  const drainage = drainageMask(x, z, height);
  const erosion = erosionMask(x, z, height, normal[1]);
  const vegetation = vegetationMask(x, z, height, normal[1], drainage, erosion);
  const wetness = wetnessMask(x, height, z, normal[1], height);
  const snow = snowMask(x, height, z, normal[1], height);
  const riverDistance = Math.abs(x - riverCenter(z));
  const moisture = macroMoisture(x, z);
  const temperature = macroTemperature(x, z);
  let biome = 'Highland Meadow';
  if (riverDistance < 32 || wetness > 0.58 || drainage > 0.72) biome = 'Riverbank';
  else if (height > 52 || snow > 0.42 || temperature < 0.34) biome = 'Alpine Snowfield';
  else if (erosion > 0.62 || normal[1] < 0.56) biome = 'Exposed Ridge';
  else if (vegetation > 0.42 && moisture > 0.46) biome = 'Forest Edge';
  else if (moisture < 0.34) biome = 'Dry Slope';
  return { biome, material: materialLabel(Math.round(terrainMaterial(x, height, z, normal[1]))), height };
}

function sanitizeProgress(value: unknown): GameProgress | null {
  const raw = value as Partial<GameProgress> | null | undefined;
  if (!raw || !Array.isArray(raw.collectedBeaconIds)) return null;
  const collectIds = (items: unknown, max: number): number[] => Array.isArray(items)
    ? [...new Set(items
      .map(id => Math.trunc(Number(id)))
      .filter(id => Number.isInteger(id) && id >= 0 && id < max))]
    : [];
  const ids = collectIds(raw.collectedBeaconIds, BEACON_OFFSETS.length);
  const completedContractIds = collectIds(raw.completedContractIds, FIELD_CONTRACT_SPECS.length);
  const visitedCheckpointIds = collectIds(raw.visitedCheckpointIds, ROUTE_CHECKPOINT_SPECS.length);
  const clearedHazardIds = collectIds(raw.clearedHazardIds, HAZARD_SPECS.length);
  const traversalMeters = Math.max(0, Math.min(1000000, Number.isFinite(raw.traversalMeters) ? Number(raw.traversalMeters) : 0));
  return {
    version: 2,
    collectedBeaconIds: ids,
    completedContractIds,
    visitedCheckpointIds,
    clearedHazardIds,
    traversalMeters,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
  };
}

function legacySanitizeProgress(value: unknown): GameProgress | null {
  const raw = value as Partial<GameProgress> | null | undefined;
  if (!raw || !Array.isArray(raw.collectedBeaconIds)) return null;
  const ids = [...new Set(raw.collectedBeaconIds
    .map(id => Math.trunc(Number(id)))
    .filter(id => Number.isInteger(id) && id >= 0 && id < BEACON_OFFSETS.length))];
  const completedContractIds = Array.isArray(raw.completedContractIds)
    ? [...new Set(raw.completedContractIds
      .map(id => Math.trunc(Number(id)))
      .filter(id => Number.isInteger(id) && id >= 0 && id < FIELD_CONTRACT_SPECS.length))]
    : [];
  return {
    version: 1,
    collectedBeaconIds: ids,
    completedContractIds,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
  };
}

function loadStoredProgress(): GameProgress | null {
  try {
    const raw = localStorage.getItem(GAME_PROGRESS_STORAGE_KEY) ?? localStorage.getItem('stormCanyon.gameProgress.v1');
    return raw ? sanitizeProgress(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveStoredProgress(progress: GameProgress): void {
  try {
    localStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Progress is also stored in region snapshots; localStorage is a convenience.
  }
}

export class StormCanyonGame {
  private beacons: Beacon[] = [];
  private contracts: FieldContract[] = [];
  private checkpoints: RouteCheckpoint[] = [];
  private hazards: HazardSite[] = [];
  private traversalMeters = 0;
  private lastCameraPosition: Vec3 | null = null;
  private lastSavedTraversalBucket = 0;
  private dirty = true;

  constructor() {
    this.beacons = BEACON_OFFSETS.map(([x, z], id) => {
      const site = classifySurveySite(x, z);
      return {
        id,
        name: `Survey ${id + 1}`,
        biome: site.biome,
        material: site.material,
        position: vec3(x, site.height + 9 + (id % 2) * 3, z),
        collected: false,
      };
    });
    this.contracts = FIELD_CONTRACT_SPECS.map((spec, id) => {
      const x = spec.x ?? riverCenter(spec.z) + (spec.riverOffset ?? 0);
      const height = terrainHeight(x, spec.z);
      return {
        id,
        name: spec.name,
        action: spec.action,
        position: vec3(x, height + 10 + (id % 2) * 2, spec.z),
        requiredEditType: spec.requiredEditType,
        requiredMaterial: spec.requiredMaterial,
        markerRadius: spec.markerRadius,
        completionRadius: spec.completionRadius,
        completed: false,
      };
    });
    this.checkpoints = ROUTE_CHECKPOINT_SPECS.map((spec, id) => {
      const height = terrainHeight(spec.x, spec.z);
      return {
        id,
        name: spec.name,
        reward: spec.reward,
        position: vec3(spec.x, height + 8, spec.z),
        radius: spec.radius,
        visited: false,
      };
    });
    this.hazards = HAZARD_SPECS.map((spec, id) => {
      const x = spec.x ?? riverCenter(spec.z) + (spec.riverOffset ?? 0);
      const height = terrainHeight(x, spec.z);
      return {
        id,
        name: spec.name,
        action: spec.action,
        risk: spec.risk,
        position: vec3(x, height + 9, spec.z),
        requiredEditType: spec.requiredEditType,
        requiredMaterial: spec.requiredMaterial,
        markerRadius: spec.markerRadius,
        completionRadius: spec.completionRadius,
        exposureRadius: spec.exposureRadius,
        cleared: false,
      };
    });
    this.restoreProgress(loadStoredProgress(), false);
  }

  update(camera: FlyCamera, editLog: readonly EditOperation[] = []): boolean {
    let changed = false;
    changed = this.updateTraversal(camera) || changed;
    for (const beacon of this.beacons) {
      if (beacon.collected) continue;
      const dx = camera.position[0] - beacon.position[0];
      const dy = camera.position[1] - beacon.position[1];
      const dz = camera.position[2] - beacon.position[2];
      if (Math.hypot(dx, dy, dz) <= COLLECT_RADIUS) {
        beacon.collected = true;
        changed = true;
      }
    }
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.visited) continue;
      const dx = camera.position[0] - checkpoint.position[0];
      const dy = camera.position[1] - checkpoint.position[1];
      const dz = camera.position[2] - checkpoint.position[2];
      if (Math.hypot(dx, dy, dz) <= Math.max(CHECKPOINT_COLLECT_RADIUS, checkpoint.radius)) {
        checkpoint.visited = true;
        changed = true;
      }
    }
    for (const contract of this.contracts) {
      if (contract.completed) continue;
      if (editLog.some(edit => contractSatisfiedByEdit(contract, edit))) {
        contract.completed = true;
        changed = true;
      }
    }
    for (const hazard of this.hazards) {
      if (hazard.cleared) continue;
      if (editLog.some(edit => hazardClearedByEdit(hazard, edit))) {
        hazard.cleared = true;
        changed = true;
      }
    }
    this.dirty = this.dirty || changed;
    if (changed) saveStoredProgress(this.progress());
    return changed;
  }

  progress(): GameProgress {
    return {
      version: 2,
      collectedBeaconIds: this.beacons.filter(beacon => beacon.collected).map(beacon => beacon.id),
      completedContractIds: this.contracts.filter(contract => contract.completed).map(contract => contract.id),
      visitedCheckpointIds: this.checkpoints.filter(checkpoint => checkpoint.visited).map(checkpoint => checkpoint.id),
      clearedHazardIds: this.hazards.filter(hazard => hazard.cleared).map(hazard => hazard.id),
      traversalMeters: Math.round(this.traversalMeters),
      updatedAt: Date.now(),
    };
  }

  restoreProgress(progress: GameProgress | null | undefined, shouldPersist = true): void {
    const sanitized = sanitizeProgress(progress) ?? legacySanitizeProgress(progress);
    const collected = new Set(sanitized?.collectedBeaconIds ?? []);
    const completedContracts = new Set(sanitized?.completedContractIds ?? []);
    const visitedCheckpoints = new Set(sanitized?.visitedCheckpointIds ?? []);
    const clearedHazards = new Set(sanitized?.clearedHazardIds ?? []);
    for (const beacon of this.beacons) beacon.collected = collected.has(beacon.id);
    for (const contract of this.contracts) contract.completed = completedContracts.has(contract.id);
    for (const checkpoint of this.checkpoints) checkpoint.visited = visitedCheckpoints.has(checkpoint.id);
    for (const hazard of this.hazards) hazard.cleared = clearedHazards.has(hazard.id);
    this.traversalMeters = sanitized?.traversalMeters ?? 0;
    this.lastSavedTraversalBucket = Math.floor(this.traversalMeters / 100);
    this.lastCameraPosition = null;
    this.dirty = true;
    if (shouldPersist) saveStoredProgress(this.progress());
  }

  mergeProgress(progress: GameProgress | null | undefined): boolean {
    const sanitized = sanitizeProgress(progress);
    if (!sanitized) return false;
    let changed = false;
    const collected = new Set(sanitized.collectedBeaconIds);
    const completedContracts = new Set(sanitized.completedContractIds ?? []);
    const visitedCheckpoints = new Set(sanitized.visitedCheckpointIds ?? []);
    const clearedHazards = new Set(sanitized.clearedHazardIds ?? []);
    for (const beacon of this.beacons) {
      if (!beacon.collected && collected.has(beacon.id)) {
        beacon.collected = true;
        changed = true;
      }
    }
    for (const contract of this.contracts) {
      if (!contract.completed && completedContracts.has(contract.id)) {
        contract.completed = true;
        changed = true;
      }
    }
    for (const checkpoint of this.checkpoints) {
      if (!checkpoint.visited && visitedCheckpoints.has(checkpoint.id)) {
        checkpoint.visited = true;
        changed = true;
      }
    }
    for (const hazard of this.hazards) {
      if (!hazard.cleared && clearedHazards.has(hazard.id)) {
        hazard.cleared = true;
        changed = true;
      }
    }
    if ((sanitized.traversalMeters ?? 0) > this.traversalMeters) {
      this.traversalMeters = sanitized.traversalMeters ?? this.traversalMeters;
      this.lastSavedTraversalBucket = Math.floor(this.traversalMeters / 100);
      changed = true;
    }
    this.dirty = this.dirty || changed;
    if (changed) saveStoredProgress(this.progress());
    return changed;
  }

  resetProgress(): void {
    for (const beacon of this.beacons) beacon.collected = false;
    for (const contract of this.contracts) contract.completed = false;
    for (const checkpoint of this.checkpoints) checkpoint.visited = false;
    for (const hazard of this.hazards) hazard.cleared = false;
    this.traversalMeters = 0;
    this.lastSavedTraversalBucket = 0;
    this.lastCameraPosition = null;
    this.dirty = true;
    saveStoredProgress(this.progress());
  }

  consumeMarkerInstances(force = false): Float32Array | null {
    if (!force && !this.dirty) return null;
    this.dirty = false;
    const values: number[] = [];
    for (const beacon of this.beacons) {
      if (beacon.collected) continue;
      values.push(beacon.position[0], beacon.position[1], beacon.position[2], 1.4);
    }
    for (const contract of this.contracts) {
      if (contract.completed) continue;
      values.push(contract.position[0], contract.position[1], contract.position[2], contract.markerRadius);
    }
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.visited) continue;
      values.push(checkpoint.position[0], checkpoint.position[1], checkpoint.position[2], 1.25);
    }
    for (const hazard of this.hazards) {
      if (hazard.cleared) continue;
      values.push(hazard.position[0], hazard.position[1], hazard.position[2], hazard.markerRadius);
    }
    return new Float32Array(values);
  }

  snapshot(camera: FlyCamera): GameSnapshot {
    let nextDistance = Infinity;
    let nextBeacon: Beacon | null = null;
    let nextContractDistance = Infinity;
    let nextContract: FieldContract | null = null;
    let nextCheckpointDistance = Infinity;
    let nextCheckpoint: RouteCheckpoint | null = null;
    let nextHazardDistance = Infinity;
    let nextHazard: HazardSite | null = null;
    let activeHazard: HazardSite | null = null;
    let collected = 0;
    let completedContracts = 0;
    let visitedCheckpoints = 0;
    let clearedHazards = 0;
    const collectedBiomes = new Set<string>();
    const totalBiomes = new Set<string>();
    for (const beacon of this.beacons) {
      totalBiomes.add(beacon.biome);
      if (beacon.collected) {
        collected++;
        collectedBiomes.add(beacon.biome);
        continue;
      }
      const distance = Math.hypot(
        camera.position[0] - beacon.position[0],
        camera.position[1] - beacon.position[1],
        camera.position[2] - beacon.position[2],
      );
      if (distance < nextDistance) {
        nextDistance = distance;
        nextBeacon = beacon;
      }
    }
    for (const contract of this.contracts) {
      if (contract.completed) {
        completedContracts++;
        continue;
      }
      const distance = Math.hypot(
        camera.position[0] - contract.position[0],
        camera.position[1] - contract.position[1],
        camera.position[2] - contract.position[2],
      );
      if (distance < nextContractDistance) {
        nextContractDistance = distance;
        nextContract = contract;
      }
    }
    for (const checkpoint of this.checkpoints) {
      if (checkpoint.visited) {
        visitedCheckpoints++;
        continue;
      }
      const distance = Math.hypot(
        camera.position[0] - checkpoint.position[0],
        camera.position[1] - checkpoint.position[1],
        camera.position[2] - checkpoint.position[2],
      );
      if (distance < nextCheckpointDistance) {
        nextCheckpointDistance = distance;
        nextCheckpoint = checkpoint;
      }
    }
    for (const hazard of this.hazards) {
      if (hazard.cleared) {
        clearedHazards++;
        continue;
      }
      const distance = Math.hypot(
        camera.position[0] - hazard.position[0],
        camera.position[1] - hazard.position[1],
        camera.position[2] - hazard.position[2],
      );
      if (distance < nextHazardDistance) {
        nextHazardDistance = distance;
        nextHazard = hazard;
      }
      if (!activeHazard && distance <= hazard.exposureRadius) activeHazard = hazard;
    }
    const inventorySamples = collected;
    const inventoryFieldKits = 2 + completedContracts * 2 + clearedHazards;
    const inventoryRouteFlags = visitedCheckpoints;
    const score = Math.round(
      collected * 100
      + collectedBiomes.size * 125
      + completedContracts * 260
      + visitedCheckpoints * 180
      + clearedHazards * 320
      + Math.min(this.traversalMeters, 5000) * 0.04,
    );
    return {
      collected,
      total: this.beacons.length,
      nextDistance,
      nextSiteName: nextBeacon?.name ?? null,
      nextBiome: nextBeacon?.biome ?? null,
      nextMaterial: nextBeacon?.material ?? null,
      collectedBiomes: [...collectedBiomes].sort(),
      totalBiomes: totalBiomes.size,
      completedContracts,
      totalContracts: this.contracts.length,
      nextContractName: nextContract?.name ?? null,
      nextContractAction: nextContract?.action ?? null,
      nextContractDistance,
      visitedCheckpoints,
      totalCheckpoints: this.checkpoints.length,
      nextCheckpointName: nextCheckpoint?.name ?? null,
      nextCheckpointDistance,
      clearedHazards,
      totalHazards: this.hazards.length,
      nextHazardName: nextHazard?.name ?? null,
      nextHazardAction: nextHazard?.action ?? null,
      nextHazardDistance,
      activeHazardName: activeHazard?.name ?? null,
      activeHazardRisk: activeHazard?.risk ?? null,
      traversalMeters: Math.round(this.traversalMeters),
      inventorySamples,
      inventoryFieldKits,
      inventoryRouteFlags,
      score,
      rank: expeditionRank(score),
      complete: collected === this.beacons.length
        && completedContracts === this.contracts.length
        && visitedCheckpoints === this.checkpoints.length
        && clearedHazards === this.hazards.length,
    };
  }

  private updateTraversal(camera: FlyCamera): boolean {
    if (!this.lastCameraPosition) {
      this.lastCameraPosition = vec3(camera.position[0], camera.position[1], camera.position[2]);
      return false;
    }
    const dx = camera.position[0] - this.lastCameraPosition[0];
    const dy = camera.position[1] - this.lastCameraPosition[1];
    const dz = camera.position[2] - this.lastCameraPosition[2];
    this.lastCameraPosition[0] = camera.position[0];
    this.lastCameraPosition[1] = camera.position[1];
    this.lastCameraPosition[2] = camera.position[2];
    const distance = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(distance) || distance <= 0.01 || distance > 90) return false;
    this.traversalMeters += distance;
    const bucket = Math.floor(this.traversalMeters / 100);
    if (bucket <= this.lastSavedTraversalBucket) return false;
    this.lastSavedTraversalBucket = bucket;
    return true;
  }
}

function contractSatisfiedByEdit(contract: FieldContract, edit: EditOperation): boolean {
  if (edit.type !== contract.requiredEditType) return false;
  if (contract.requiredMaterial !== undefined && edit.material !== contract.requiredMaterial) return false;
  const dx = edit.x - contract.position[0];
  const dz = edit.z - contract.position[2];
  const influence = Math.max(0, edit.radius) + contract.completionRadius;
  return Math.hypot(dx, dz) <= influence;
}

function hazardClearedByEdit(hazard: HazardSite, edit: EditOperation): boolean {
  if (edit.type !== hazard.requiredEditType) return false;
  if (hazard.requiredMaterial !== undefined && edit.material !== hazard.requiredMaterial) return false;
  const dx = edit.x - hazard.position[0];
  const dz = edit.z - hazard.position[2];
  const influence = Math.max(0, edit.radius) + hazard.completionRadius;
  return Math.hypot(dx, dz) <= influence;
}

function expeditionRank(score: number): string {
  if (score >= 3600) return 'First Class Survey';
  if (score >= 2400) return 'Alpine Operator';
  if (score >= 1300) return 'Field Engineer';
  if (score >= 600) return 'Trail Scout';
  return 'Base Camp';
}
