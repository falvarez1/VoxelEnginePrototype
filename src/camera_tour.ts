export interface Waypoint {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  timeMs: number;
  fov?: number;
}

export interface Tour {
  name: string;
  waypoints: Waypoint[];
  easing?: 'linear' | 'smooth';
}

export interface TourSample {
  timeMs: number;
  segmentIndex: number;
  segmentT: number;
  frameMs: number;
  drawCalls: number;
  terrainTriangles: number;
  farTerrainTriangles: number;
  uploadMB: number;
  estimatedGpuMB: number;
  visibleTerrainChunks: number;
  visibleTerrainClusters: number;
  vegetationInstances: number;
  workerQueued: number;
  workerPending: number;
  cameraPos: [number, number, number];
  cameraYaw: number;
  cameraPitch: number;
}

export interface SegmentSummary {
  segmentIndex: number;
  samples: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  avgDrawCalls: number;
  avgTerrainTriangles: number;
  avgUploadMB: number;
}

export interface TourSummary {
  avgFrameMs: number;
  minFrameMs: number;
  maxFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  avgFps: number;
  avgDrawCalls: number;
  avgTerrainTriangles: number;
  avgUploadMB: number;
  peakUploadMB: number;
  avgEstimatedGpuMB: number;
  peakEstimatedGpuMB: number;
  avgVisibleTerrainClusters: number;
  avgVegetationInstances: number;
  avgWorkerPending: number;
  peakWorkerQueued: number;
}

export interface BenchmarkResult {
  type: 'storm-canyon-camera-tour-benchmark';
  version: 1;
  tour: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  sampleCount: number;
  samples: TourSample[];
  perSegment: SegmentSummary[];
  summary: TourSummary;
  context: {
    capabilities: Record<string, unknown>;
    settings: Record<string, unknown>;
    userAgent: string;
  };
}

export interface CameraLike {
  position: Float32Array;
  yaw: number;
  pitch: number;
  fovDegrees: number;
}

export interface TourSampleSource {
  frameMs: number;
  drawCalls: number;
  terrainTriangles: number;
  farTerrainTriangles: number;
  uploadMB: number;
  estimatedGpuMB: number;
  visibleTerrainChunks: number;
  visibleTerrainClusters: number;
  vegetationInstances: number;
  workerQueued: number;
  workerPending: number;
}

const STORAGE_KEY = 'stormCanyon.tours.v1';
const MAX_SAMPLES = 8192;

interface PersistedTours {
  scratch: Tour;
  saved: Record<string, Tour>;
}

function emptyScratch(): Tour {
  return { name: '@scratch', waypoints: [], easing: 'smooth' };
}

function loadPersisted(): PersistedTours {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scratch: emptyScratch(), saved: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedTours>;
    const scratch = sanitizeTour(parsed.scratch, '@scratch');
    const saved: Record<string, Tour> = {};
    if (parsed.saved && typeof parsed.saved === 'object') {
      for (const [name, tour] of Object.entries(parsed.saved)) {
        if (typeof name === 'string' && name.length > 0) saved[name] = sanitizeTour(tour, name);
      }
    }
    return { scratch, saved };
  } catch {
    return { scratch: emptyScratch(), saved: {} };
  }
}

function sanitizeTour(raw: unknown, fallbackName: string): Tour {
  if (!raw || typeof raw !== 'object') return { name: fallbackName, waypoints: [], easing: 'smooth' };
  const obj = raw as Partial<Tour>;
  const waypoints = Array.isArray(obj.waypoints) ? obj.waypoints.map(sanitizeWaypoint).filter((w): w is Waypoint => w !== null) : [];
  const easing = obj.easing === 'linear' ? 'linear' : 'smooth';
  return { name: typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : fallbackName, waypoints, easing };
}

function sanitizeWaypoint(raw: unknown): Waypoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<Waypoint>;
  if (!Array.isArray(obj.position) || obj.position.length < 3) return null;
  const [x, y, z] = obj.position;
  if (![x, y, z].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const yaw = Number(obj.yaw);
  const pitch = Number(obj.pitch);
  const timeMs = Number(obj.timeMs);
  if (![yaw, pitch, timeMs].every(Number.isFinite)) return null;
  const result: Waypoint = { position: [x, y, z], yaw, pitch, timeMs };
  if (typeof obj.fov === 'number' && Number.isFinite(obj.fov)) result.fov = obj.fov;
  return result;
}

function savePersisted(state: PersistedTours): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage might be disabled
  }
}

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function shortestAngleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.max(0, Math.min(sortedValues.length - 1, Math.round(p * (sortedValues.length - 1))));
  return sortedValues[idx];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export type TourState = 'idle' | 'playing' | 'paused' | 'done';

export class CameraTour {
  private state: TourState = 'idle';
  private tour: Tour | null = null;
  private startNow = 0;
  private pauseStarted = 0;
  private accumulatedPause = 0;
  private startWallMs = 0;
  private samples: TourSample[] = [];
  private originalFov = 0;
  private overrideFov = false;
  private lastResult: BenchmarkResult | null = null;
  private persisted = loadPersisted();

  isActive(): boolean {
    return this.state === 'playing' || this.state === 'paused';
  }

  getState(): TourState {
    return this.state;
  }

  getLastResult(): BenchmarkResult | null {
    return this.lastResult;
  }

  getScratch(): Tour {
    return { ...this.persisted.scratch, waypoints: this.persisted.scratch.waypoints.map(w => ({ ...w, position: [...w.position] })) };
  }

  listSaved(): string[] {
    return Object.keys(this.persisted.saved).sort();
  }

  getSaved(name: string): Tour | null {
    const tour = this.persisted.saved[name];
    return tour ? { ...tour, waypoints: tour.waypoints.map(w => ({ ...w, position: [...w.position] })) } : null;
  }

  addWaypoint(camera: CameraLike, opts: { spacingMs?: number; timeMs?: number; fov?: boolean } = {}): Waypoint {
    const spacing = opts.spacingMs ?? 1500;
    const previous = this.persisted.scratch.waypoints[this.persisted.scratch.waypoints.length - 1];
    const timeMs = opts.timeMs !== undefined ? opts.timeMs : (previous ? previous.timeMs + spacing : 0);
    const waypoint: Waypoint = {
      position: [camera.position[0], camera.position[1], camera.position[2]],
      yaw: camera.yaw,
      pitch: camera.pitch,
      timeMs,
    };
    if (opts.fov) waypoint.fov = camera.fovDegrees;
    this.persisted.scratch.waypoints.push(waypoint);
    savePersisted(this.persisted);
    return waypoint;
  }

  removeWaypoint(index: number): Waypoint | null {
    if (index < 0 || index >= this.persisted.scratch.waypoints.length) return null;
    const [removed] = this.persisted.scratch.waypoints.splice(index, 1);
    savePersisted(this.persisted);
    return removed;
  }

  clearScratch(): number {
    const count = this.persisted.scratch.waypoints.length;
    this.persisted.scratch.waypoints = [];
    savePersisted(this.persisted);
    return count;
  }

  setWaypointTime(index: number, timeMs: number): boolean {
    const wp = this.persisted.scratch.waypoints[index];
    if (!wp || !Number.isFinite(timeMs)) return false;
    wp.timeMs = timeMs;
    savePersisted(this.persisted);
    return true;
  }

  setEasing(easing: 'linear' | 'smooth'): void {
    this.persisted.scratch.easing = easing;
    savePersisted(this.persisted);
  }

  saveScratch(name: string): Tour {
    if (this.persisted.scratch.waypoints.length < 2) {
      throw new Error(`Cannot save tour "${name}": need at least 2 waypoints, got ${this.persisted.scratch.waypoints.length}`);
    }
    const tour: Tour = {
      name,
      waypoints: this.persisted.scratch.waypoints.map(w => ({ ...w, position: [...w.position] })),
      easing: this.persisted.scratch.easing ?? 'smooth',
    };
    this.persisted.saved[name] = tour;
    savePersisted(this.persisted);
    return tour;
  }

  loadIntoScratch(name: string): Tour {
    const tour = this.persisted.saved[name];
    if (!tour) throw new Error(`No saved tour named "${name}"`);
    this.persisted.scratch = {
      name: '@scratch',
      waypoints: tour.waypoints.map(w => ({ ...w, position: [...w.position] })),
      easing: tour.easing ?? 'smooth',
    };
    savePersisted(this.persisted);
    return this.getScratch();
  }

  deleteSaved(name: string): boolean {
    if (!(name in this.persisted.saved)) return false;
    delete this.persisted.saved[name];
    savePersisted(this.persisted);
    return true;
  }

  start(tourOrName: Tour | string, camera: CameraLike): Tour {
    const tour = typeof tourOrName === 'string'
      ? (tourOrName === '@scratch' ? this.getScratch() : this.getSaved(tourOrName) ?? (() => { throw new Error(`No tour named "${tourOrName}"`); })())
      : tourOrName;
    if (tour.waypoints.length < 2) throw new Error(`Tour "${tour.name}" needs at least 2 waypoints, has ${tour.waypoints.length}`);
    const sorted = [...tour.waypoints].sort((a, b) => a.timeMs - b.timeMs);
    sorted[0].timeMs = 0;
    const playTour: Tour = { ...tour, waypoints: sorted };
    this.tour = playTour;
    this.state = 'playing';
    this.startNow = performance.now();
    this.startWallMs = Date.now();
    this.accumulatedPause = 0;
    this.samples = [];
    this.originalFov = camera.fovDegrees;
    this.overrideFov = playTour.waypoints.some(w => w.fov !== undefined);
    this.applyWaypoint(playTour.waypoints[0], camera);
    return playTour;
  }

  pause(): boolean {
    if (this.state !== 'playing') return false;
    this.state = 'paused';
    this.pauseStarted = performance.now();
    return true;
  }

  resume(): boolean {
    if (this.state !== 'paused') return false;
    this.accumulatedPause += performance.now() - this.pauseStarted;
    this.state = 'playing';
    return true;
  }

  stop(
    camera: CameraLike,
    contextSettings: Record<string, unknown>,
    contextCapabilities: Record<string, unknown>,
  ): BenchmarkResult | null {
    if (!this.tour || (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'done')) {
      return this.lastResult;
    }
    const tour = this.tour;
    const endNow = performance.now();
    const elapsed = this.state === 'done'
      ? (this.samples.length > 0 ? this.samples[this.samples.length - 1].timeMs : 0)
      : (endNow - this.startNow - this.accumulatedPause);
    this.state = 'done';
    if (this.overrideFov) camera.fovDegrees = this.originalFov;
    const result = this.buildResult(tour, this.startWallMs, this.startWallMs + elapsed, elapsed, contextSettings, contextCapabilities);
    this.lastResult = result;
    return result;
  }

  tick(camera: CameraLike, source: TourSampleSource): boolean {
    if (this.state !== 'playing' || !this.tour) return false;
    const tour = this.tour;
    const now = performance.now();
    const elapsed = now - this.startNow - this.accumulatedPause;
    const totalMs = tour.waypoints[tour.waypoints.length - 1].timeMs;

    if (elapsed >= totalMs) {
      this.applyWaypoint(tour.waypoints[tour.waypoints.length - 1], camera);
      this.recordSample(totalMs, Math.max(0, tour.waypoints.length - 2), 1, camera, source);
      this.state = 'done';
      return false;
    }

    let segIdx = 0;
    while (segIdx < tour.waypoints.length - 2 && tour.waypoints[segIdx + 1].timeMs <= elapsed) {
      segIdx++;
    }
    const w0 = tour.waypoints[segIdx];
    const w1 = tour.waypoints[segIdx + 1];
    const segDur = Math.max(1, w1.timeMs - w0.timeMs);
    const tLinear = Math.max(0, Math.min(1, (elapsed - w0.timeMs) / segDur));
    const t = (tour.easing ?? 'smooth') === 'smooth' ? smoothstep(tLinear) : tLinear;

    const lerp = (a: number, b: number): number => a + (b - a) * t;
    camera.position[0] = lerp(w0.position[0], w1.position[0]);
    camera.position[1] = lerp(w0.position[1], w1.position[1]);
    camera.position[2] = lerp(w0.position[2], w1.position[2]);

    const yawDelta = shortestAngleDelta(w0.yaw, w1.yaw);
    camera.yaw = w0.yaw + yawDelta * t;
    camera.pitch = lerp(w0.pitch, w1.pitch);

    if (w0.fov !== undefined && w1.fov !== undefined) camera.fovDegrees = lerp(w0.fov, w1.fov);
    else if (w0.fov !== undefined) camera.fovDegrees = w0.fov;
    else if (w1.fov !== undefined) camera.fovDegrees = w1.fov;

    this.recordSample(elapsed, segIdx, tLinear, camera, source);
    return true;
  }

  private applyWaypoint(wp: Waypoint, camera: CameraLike): void {
    camera.position[0] = wp.position[0];
    camera.position[1] = wp.position[1];
    camera.position[2] = wp.position[2];
    camera.yaw = wp.yaw;
    camera.pitch = wp.pitch;
    if (wp.fov !== undefined) camera.fovDegrees = wp.fov;
  }

  private recordSample(elapsed: number, segmentIndex: number, segmentT: number, camera: CameraLike, source: TourSampleSource): void {
    if (this.samples.length >= MAX_SAMPLES) return;
    this.samples.push({
      timeMs: elapsed,
      segmentIndex,
      segmentT,
      frameMs: source.frameMs,
      drawCalls: source.drawCalls,
      terrainTriangles: source.terrainTriangles,
      farTerrainTriangles: source.farTerrainTriangles,
      uploadMB: source.uploadMB,
      estimatedGpuMB: source.estimatedGpuMB,
      visibleTerrainChunks: source.visibleTerrainChunks,
      visibleTerrainClusters: source.visibleTerrainClusters,
      vegetationInstances: source.vegetationInstances,
      workerQueued: source.workerQueued,
      workerPending: source.workerPending,
      cameraPos: [camera.position[0], camera.position[1], camera.position[2]],
      cameraYaw: camera.yaw,
      cameraPitch: camera.pitch,
    });
  }

  private buildResult(
    tour: Tour,
    startedAt: number,
    endedAt: number,
    durationMs: number,
    settings: Record<string, unknown>,
    capabilities: Record<string, unknown>,
  ): BenchmarkResult {
    const frameMs = this.samples.map(s => s.frameMs).filter(v => Number.isFinite(v) && v > 0);
    const sortedFrameMs = [...frameMs].sort((a, b) => a - b);
    const segmentMap = new Map<number, TourSample[]>();
    for (const sample of this.samples) {
      const bucket = segmentMap.get(sample.segmentIndex);
      if (bucket) bucket.push(sample);
      else segmentMap.set(sample.segmentIndex, [sample]);
    }
    const perSegment: SegmentSummary[] = Array.from(segmentMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([segmentIndex, segSamples]) => {
        const segFrameMs = segSamples.map(s => s.frameMs).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
        return {
          segmentIndex,
          samples: segSamples.length,
          avgFrameMs: average(segFrameMs),
          p95FrameMs: percentile(segFrameMs, 0.95),
          maxFrameMs: segFrameMs[segFrameMs.length - 1] ?? 0,
          avgDrawCalls: average(segSamples.map(s => s.drawCalls)),
          avgTerrainTriangles: average(segSamples.map(s => s.terrainTriangles)),
          avgUploadMB: average(segSamples.map(s => s.uploadMB)),
        };
      });
    const summary: TourSummary = {
      avgFrameMs: average(frameMs),
      minFrameMs: sortedFrameMs[0] ?? 0,
      maxFrameMs: sortedFrameMs[sortedFrameMs.length - 1] ?? 0,
      p50FrameMs: percentile(sortedFrameMs, 0.5),
      p95FrameMs: percentile(sortedFrameMs, 0.95),
      p99FrameMs: percentile(sortedFrameMs, 0.99),
      avgFps: average(frameMs) > 0 ? 1000 / average(frameMs) : 0,
      avgDrawCalls: average(this.samples.map(s => s.drawCalls)),
      avgTerrainTriangles: average(this.samples.map(s => s.terrainTriangles)),
      avgUploadMB: average(this.samples.map(s => s.uploadMB)),
      peakUploadMB: this.samples.reduce((m, s) => Math.max(m, s.uploadMB), 0),
      avgEstimatedGpuMB: average(this.samples.map(s => s.estimatedGpuMB)),
      peakEstimatedGpuMB: this.samples.reduce((m, s) => Math.max(m, s.estimatedGpuMB), 0),
      avgVisibleTerrainClusters: average(this.samples.map(s => s.visibleTerrainClusters)),
      avgVegetationInstances: average(this.samples.map(s => s.vegetationInstances)),
      avgWorkerPending: average(this.samples.map(s => s.workerPending)),
      peakWorkerQueued: this.samples.reduce((m, s) => Math.max(m, s.workerQueued), 0),
    };
    return {
      type: 'storm-canyon-camera-tour-benchmark',
      version: 1,
      tour: tour.name,
      startedAt,
      endedAt,
      durationMs,
      sampleCount: this.samples.length,
      samples: this.samples.slice(),
      perSegment,
      summary,
      context: {
        capabilities,
        settings,
        userAgent: navigator.userAgent,
      },
    };
  }
}
