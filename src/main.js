import { FlyCamera, add, scale, vec3, normalize } from './math.js';
import { Renderer } from './renderer.js';

const CHUNK_WORLD_SIZE = 32; // must match native/voxel_core.c: 16 cells * 2m
const DEFAULT_STREAM_RADIUS = 7;
const MIN_STREAM_RADIUS = 3;
const MAX_STREAM_RADIUS = 11;
const ALTITUDE_BOOST_START = 96;
const ALTITUDE_BOOST_CHUNK_STEP = 64;
const VERTICAL_CHUNKS = [-1, 0, 1, 2];
const MAX_QUEUE = 2200;
const MAX_NEW_CHUNK_REQUESTS_PER_FRAME = 64;
const EVICT_HYSTERESIS_CHUNKS = 2.5;

function keyOf(cx, cy, cz, lod = 0) { return `${cx},${cy},${cz},${lod}`; }
function parseKey(key) { return key.split(',').map(Number); }
function chunkCoord(v) { return Math.floor(v / CHUNK_WORLD_SIZE); }
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v | 0)); }

class ChunkStreamer {
  constructor(renderer, overlay) {
    this.renderer = renderer;
    this.overlay = overlay;
    this.workerCount = Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 6) - 2));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.states = new Map();
    this.version = 1;
    this.baseStreamRadius = DEFAULT_STREAM_RADIUS;
    this.effectiveStreamRadius = DEFAULT_STREAM_RADIUS;
    this.currentTargetChunks = 0;
    this.lastStats = { generated: 0, discarded: 0, avgMeshMs: 0, uploadMB: 0, overflow: 0 };
    this.meshTimes = [];
  }

  async init() {
    const ready = [];
    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker('./src/worker.js', { type: 'module', name: `voxel-worker-${i}` });
      worker.onmessage = (ev) => this.onWorkerMessage(worker, ev.data);
      worker.onerror = (ev) => this.showError(`Worker error: ${ev.message}`);
      this.workers.push(worker);
      ready.push(new Promise((resolve) => {
        const listener = (ev) => {
          if (ev.data?.type === 'ready') {
            worker.removeEventListener('message', listener);
            this.idle.push(worker);
            resolve();
          }
        };
        worker.addEventListener('message', listener);
      }));
      worker.postMessage({ type: 'init' });
    }
    await Promise.all(ready);
  }

  showError(message) {
    console.error(message);
    this.overlay.textContent = message;
    this.overlay.classList.add('error');
  }

  streamRadiusForCamera(camera) {
    const altitudeBoost = Math.max(
      0,
      Math.floor((Math.max(0, camera.position[1]) - ALTITUDE_BOOST_START) / ALTITUDE_BOOST_CHUNK_STEP),
    );
    return clampInt(this.baseStreamRadius + altitudeBoost, MIN_STREAM_RADIUS, MAX_STREAM_RADIUS);
  }

  adjustStreamRadius(delta) {
    this.baseStreamRadius = clampInt(this.baseStreamRadius + delta, MIN_STREAM_RADIUS, MAX_STREAM_RADIUS);
  }

  requiredKeysForCamera(camera) {
    const cx0 = chunkCoord(camera.position[0]);
    const cz0 = chunkCoord(camera.position[2]);
    const radius = this.streamRadiusForCamera(camera);
    this.effectiveStreamRadius = radius;
    const keys = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > radius + 0.35) continue;
        for (const cy of VERTICAL_CHUNKS) {
          const cx = cx0 + dx;
          const cz = cz0 + dz;
          keys.push({ key: keyOf(cx, cy, cz), cx, cy, cz, lod: 0, priority: dist + Math.abs(cy) * 0.35 });
        }
      }
    }
    keys.sort((a, b) => a.priority - b.priority);
    this.currentTargetChunks = keys.length;
    return keys;
  }

  update(camera) {
    const required = this.requiredKeysForCamera(camera);
    let enqueuedThisFrame = 0;
    for (const item of required) {
      const state = this.states.get(item.key);
      if (!state && this.queue.length < MAX_QUEUE && enqueuedThisFrame < MAX_NEW_CHUNK_REQUESTS_PER_FRAME) {
        this.queue.push({ ...item, version: this.version });
        this.states.set(item.key, 'queued');
        enqueuedThisFrame++;
      }
    }

    // Evict chunks that are outside the streaming hysteresis ring.
    const radius = this.effectiveStreamRadius || this.streamRadiusForCamera(camera);
    const ccx = chunkCoord(camera.position[0]);
    const ccz = chunkCoord(camera.position[2]);
    const minCy = VERTICAL_CHUNKS[0];
    const maxCy = VERTICAL_CHUNKS[VERTICAL_CHUNKS.length - 1];
    for (const [key, state] of [...this.states.entries()]) {
      const [cx, cy, cz] = parseKey(key);
      const far = Math.hypot(cx - ccx, cz - ccz) > radius + EVICT_HYSTERESIS_CHUNKS || cy < minCy || cy > maxCy;
      if (far && state !== 'pending') {
        this.renderer.removeChunk(key);
        this.states.delete(key);
        const qIndex = this.queue.findIndex(q => q.key === key);
        if (qIndex >= 0) this.queue.splice(qIndex, 1);
      }
    }

    this.queue.sort((a, b) => a.priority - b.priority);
    this.dispatch();
  }

  dispatch() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      this.states.set(job.key, 'pending');
      worker.currentJob = job;
      worker.postMessage({ type: 'generate', ...job });
    }
  }

  onWorkerMessage(worker, msg) {
    if (msg.type === 'ready' || msg.type === 'editAck') return;
    if (msg.type === 'error') {
      this.showError(`${msg.message}\n${msg.stack ?? ''}`);
      this.idle.push(worker);
      this.dispatch();
      return;
    }
    if (msg.type !== 'chunk') return;

    this.idle.push(worker);
    if (msg.version !== this.version) {
      this.states.delete(msg.key);
      this.lastStats.discarded++;
      this.dispatch();
      return;
    }

    const uploadBytes = (msg.vertices?.byteLength || 0) + (msg.indices?.byteLength || 0) + (msg.vegetation?.byteLength || 0);
    this.lastStats.uploadMB = uploadBytes / (1024 * 1024);
    this.lastStats.generated++;
    this.lastStats.overflow += msg.stats?.overflow ? 1 : 0;
    this.meshTimes.push(msg.stats?.ms ?? 0);
    if (this.meshTimes.length > 80) this.meshTimes.shift();
    this.lastStats.avgMeshMs = this.meshTimes.reduce((a, b) => a + b, 0) / this.meshTimes.length;

    this.renderer.createChunkMesh(msg.key, msg.vertices, msg.indices, msg.stats);
    if (msg.vegetation && msg.vegetation.length > 0) this.renderer.createVegetationPatch(msg.key, msg.vegetation);
    this.states.set(msg.key, 'loaded');
    this.dispatch();
  }

  addEdit(position, radius) {
    this.version++;
    this.queue.length = 0;
    for (const worker of this.workers) {
      worker.postMessage({ type: 'edit', x: position[0], y: position[1], z: position[2], radius });
    }

    // Dirty all intersecting chunks and let the streamer rebuild them.
    for (const key of [...this.states.keys()]) {
      const [cx, cy, cz] = parseKey(key);
      const min = vec3(cx * CHUNK_WORLD_SIZE, cy * CHUNK_WORLD_SIZE, cz * CHUNK_WORLD_SIZE);
      const max = vec3(min[0] + CHUNK_WORLD_SIZE, min[1] + CHUNK_WORLD_SIZE, min[2] + CHUNK_WORLD_SIZE);
      const qx = Math.max(min[0], Math.min(position[0], max[0]));
      const qy = Math.max(min[1], Math.min(position[1], max[1]));
      const qz = Math.max(min[2], Math.min(position[2], max[2]));
      const d = Math.hypot(position[0] - qx, position[1] - qy, position[2] - qz);
      if (d < radius + 4) {
        this.renderer.removeChunk(key);
        this.states.delete(key);
      } else {
        // Pending chunks are stale after a global edit.
        if (this.states.get(key) === 'pending') this.states.delete(key);
      }
    }
  }

  clearEdits() {
    this.version++;
    this.queue.length = 0;
    for (const worker of this.workers) worker.postMessage({ type: 'clearEdits' });
    for (const key of [...this.states.keys()]) {
      this.renderer.removeChunk(key);
      this.states.delete(key);
    }
  }

  counts() {
    let queued = 0, pending = 0, loaded = 0;
    for (const state of this.states.values()) {
      if (state === 'queued') queued++;
      else if (state === 'pending') pending++;
      else if (state === 'loaded') loaded++;
    }
    return { queued, pending, loaded, workers: this.workerCount, idle: this.idle.length };
  }
}

function setupInput(canvas, camera, streamer) {
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'BracketRight' || e.code === 'Equal') {
      streamer.adjustStreamRadius(1);
      e.preventDefault();
    }
    if (e.code === 'BracketLeft' || e.code === 'Minus') {
      streamer.adjustStreamRadius(-1);
      e.preventDefault();
    }
    if (e.code === 'KeyE') {
      const target = add(camera.position, scale(camera.forward(), 34));
      streamer.addEdit(target, 9.0);
    }
    if (e.code === 'KeyR') streamer.clearEdits();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  canvas.addEventListener('click', () => canvas.requestPointerLock());
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    camera.yaw -= e.movementX * 0.0022;
    camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch - e.movementY * 0.0022));
  });

  return function updateCamera(dt) {
    const forward = camera.forward();
    const right = camera.right();
    let move = vec3(0, 0, 0);
    if (keys.has('KeyW')) move = add(move, forward);
    if (keys.has('KeyS')) move = add(move, scale(forward, -1));
    if (keys.has('KeyD')) move = add(move, right);
    if (keys.has('KeyA')) move = add(move, scale(right, -1));
    if (keys.has('Space')) move = add(move, vec3(0, 1, 0));
    if (keys.has('ControlLeft') || keys.has('ControlRight')) move = add(move, vec3(0, -1, 0));
    const len = Math.hypot(move[0], move[1], move[2]);
    if (len > 0.0001) {
      move = normalize(move);
      let speed = camera.speed;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed *= camera.fastMultiplier;
      if (keys.has('AltLeft') || keys.has('AltRight')) speed *= camera.slowMultiplier;
      camera.position = add(camera.position, scale(move, speed * dt));
    }
  };
}

function updateOverlay(el, fps, renderer, streamer, camera) {
  const counts = streamer.counts();
  const rstats = renderer.stats;
  el.innerHTML = `
    <b>Storm Canyon Voxel Prototype</b><br/>
    FPS: ${fps.toFixed(0)} | Draws: ${rstats.drawCalls} | SDF tris: ${(rstats.terrainTriangles / 1000).toFixed(0)}k | Far tris: ${((rstats.farTerrainTriangles ?? 0) / 1000).toFixed(0)}k<br/>
    Render radius: ${streamer.baseStreamRadius} base / ${streamer.effectiveStreamRadius} effective (${(streamer.effectiveStreamRadius * CHUNK_WORLD_SIZE).toFixed(0)}m) | Far vista: 1.5km | Target chunks: ${streamer.currentTargetChunks}<br/>
    Chunks loaded/queued/pending: ${counts.loaded}/${counts.queued}/${counts.pending} | Workers: ${counts.workers} (${counts.idle} idle)<br/>
    Vegetation instances: ${rstats.vegetationInstances} | Avg WASM mesh: ${streamer.lastStats.avgMeshMs.toFixed(1)} ms<br/>
    Last upload: ${streamer.lastStats.uploadMB.toFixed(2)} MB | Generated: ${streamer.lastStats.generated} | Stale discarded: ${streamer.lastStats.discarded}<br/>
    Camera: ${camera.position[0].toFixed(1)}, ${camera.position[1].toFixed(1)}, ${camera.position[2].toFixed(1)}<br/>
    <span>Click to capture mouse. WASD + Space/Ctrl fly. Shift fast. [ / ] or - / = changes render distance. E carves SDF terrain. R resets edits.</span>
  `;
}

async function main() {
  const canvas = document.querySelector('#gfx');
  const overlay = document.querySelector('#overlay');
  const camera = new FlyCamera();
  const renderer = new Renderer(canvas);
  await renderer.init();
  const streamer = new ChunkStreamer(renderer, overlay);
  await streamer.init();
  const updateCamera = setupInput(canvas, camera, streamer);

  let last = performance.now();
  let fps = 60;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps = fps * 0.92 + (1 / Math.max(dt, 0.0001)) * 0.08;
    updateCamera(dt);
    streamer.update(camera);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const viewProj = camera.viewProjection(aspect);
    renderer.render(camera, viewProj, now / 1000);
    updateOverlay(overlay, fps, renderer, streamer, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((error) => {
  console.error(error);
  const overlay = document.querySelector('#overlay');
  overlay.classList.add('error');
  overlay.textContent = error?.message ?? String(error);
});
