let wasm = null;
let exports = null;

async function init() {
  if (wasm) return;
  const url = new URL('../public/voxel_core.wasm', import.meta.url);
  const bytes = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`Failed to load WASM: ${r.status}`);
    return r.arrayBuffer();
  });
  wasm = await WebAssembly.instantiate(bytes, {});
  exports = wasm.instance.exports;
}

function rand01(x, y, salt = 0) {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(salt | 0, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h & 0x00ffffff) / 16777215;
}

function generateVegetation(cx, cy, cz) {
  if (cy !== 0) return new Float32Array(0);
  const chunkSize = exports.get_chunk_world_size();
  const baseX = cx * chunkSize;
  const baseZ = cz * chunkSize;
  const values = [];
  for (let i = 0; i < 32; i++) {
    const rx = rand01(cx, cz, i * 17 + 3);
    const rz = rand01(cx, cz, i * 31 + 9);
    const x = baseX + rx * chunkSize;
    const z = baseZ + rz * chunkSize;
    const h = exports.get_terrain_height(x, z);
    const rc = exports.get_river_center(z);
    const riverDistance = Math.abs(x - rc);
    if (h < 8 || h > 48 || riverDistance < 18) continue;
    const densityRoll = rand01(cx + i, cz - i, 123);
    const type = densityRoll > 0.55 ? 1 : 0; // 0 grass/shrub, 1 pine
    const scale = type === 1 ? 4.0 + rand01(cx, cz, 200 + i) * 7.0 : 0.8 + rand01(cx, cz, 300 + i) * 1.5;
    values.push(x, h - 0.15, z, scale, type, rand01(cx, cz, 400 + i) * 100.0, 0, 0);
  }
  return new Float32Array(values);
}

function keyFromJob(job) { return `${job.cx},${job.cy},${job.cz},${job.lod ?? 0}`; }

async function generate(job) {
  await init();
  const t0 = performance.now();
  exports.generate_chunk(job.cx, job.cy, job.cz, job.lod ?? 0);
  const vertexCount = exports.get_vertex_count();
  const indexCount = exports.get_index_count();
  const vertexPtr = exports.get_vertex_ptr();
  const indexPtr = exports.get_index_ptr();
  const overflow = exports.get_overflow();
  const mem = exports.memory.buffer;
  const vertices = new Float32Array(mem, vertexPtr, vertexCount * 8).slice();
  const indices = new Uint32Array(mem, indexPtr, indexCount).slice();
  const vegetation = generateVegetation(job.cx, job.cy, job.cz);
  const t1 = performance.now();
  postMessage({
    type: 'chunk',
    key: keyFromJob(job),
    cx: job.cx, cy: job.cy, cz: job.cz, lod: job.lod ?? 0,
    version: job.version ?? 1,
    vertices,
    indices,
    vegetation,
    stats: { vertexCount, indexCount, overflow, ms: t1 - t0 },
  }, [vertices.buffer, indices.buffer, vegetation.buffer]);
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await init();
      postMessage({ type: 'ready' });
    } else if (msg.type === 'generate') {
      await generate(msg);
    } else if (msg.type === 'edit') {
      await init();
      exports.add_subtract_sphere(msg.x, msg.y, msg.z, msg.radius);
      postMessage({ type: 'editAck' });
    } else if (msg.type === 'clearEdits') {
      await init();
      exports.clear_edits();
      postMessage({ type: 'editAck' });
    }
  } catch (error) {
    postMessage({ type: 'error', message: error?.message ?? String(error), stack: error?.stack ?? '' });
  }
};
