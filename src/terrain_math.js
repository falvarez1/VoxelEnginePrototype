function hashU32(x) {
  x >>>= 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
function hash2i(x, y) {
  return hashU32((Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841)) >>> 0);
}
function hash01(h) { return (h & 0x00ffffff) / 16777215; }
function smooth(t) { return t * t * (3 - 2 * t); }
function mix(a, b, t) { return a + (b - a) * t; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

export function valueNoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = smooth(fx), sy = smooth(fy);
  const a = hash01(hash2i(ix, iy));
  const b = hash01(hash2i(ix + 1, iy));
  const c = hash01(hash2i(ix, iy + 1));
  const d = hash01(hash2i(ix + 1, iy + 1));
  return mix(mix(a, b, sx), mix(c, d, sx), sy);
}

export function fbm2(x, y, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise2(x * freq, y * freq) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / Math.max(norm, 0.0001);
}

export function ridge2(x, y) {
  const n = valueNoise2(x, y) * 2 - 1;
  const r = 1 - Math.abs(n);
  return r * r;
}

export function riverCenter(z) {
  const n1 = valueNoise2(z * 0.010, 17.3) * 2 - 1;
  const n2 = valueNoise2(z * 0.027 + 81.2, 9.7) * 2 - 1;
  return n1 * 42 + n2 * 12;
}

// JavaScript mirror of native/voxel_core.c terrain_height().
// The far-terrain vista uses this lower-cost heightfield while near terrain remains SDF/WASM.
export function terrainHeight(x, z) {
  const continent = fbm2(x * 0.0025 + 19.0, z * 0.0025 - 4.0);
  const base = 22.0 + 12.0 * fbm2(x * 0.012, z * 0.012);
  const hills = 10.0 * fbm2(x * 0.035 + 5.2, z * 0.035 - 8.1);
  const ridge = ridge2(x * 0.010 - 14.0, z * 0.010 + 6.0);
  const ridgeMask = clamp((continent + 0.25) * 1.25, 0.0, 1.0);
  let h = base + hills + ridge * ridgeMask * 42.0;

  const rc = riverCenter(z);
  const dist = Math.abs(x - rc);
  const valleyWidth = 40.0 + 12.0 * valueNoise2(z * 0.018, 41.0);
  let canyon = clamp(1.0 - dist / valleyWidth, 0.0, 1.0);
  canyon = smooth(canyon);
  const riverbed = 5.5 + 1.5 * fbm2(x * 0.030 + 77.0, z * 0.030);
  h = mix(h, riverbed, canyon * 0.92);

  const terrace = valueNoise2(x * 0.065, z * 0.065) * 2.0 - 1.0;
  h += terrace * canyon * 2.5;
  return h;
}

export function terrainNormal(x, z, sampleStep = 8.0) {
  const hL = terrainHeight(x - sampleStep, z);
  const hR = terrainHeight(x + sampleStep, z);
  const hD = terrainHeight(x, z - sampleStep);
  const hU = terrainHeight(x, z + sampleStep);
  const nx = hL - hR;
  const ny = sampleStep * 2.0;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function terrainMaterial(x, y, z, normalY = 1.0) {
  const h = terrainHeight(x, z);
  const rc = riverCenter(z);
  const riverDist = Math.abs(x - rc);
  if (y < 7.8 && riverDist < 14.0) return 3.0;
  if (normalY < 0.52 || y < h - 2.0) return 1.0;
  if (y > 52.0 && normalY > 0.38) return 2.0;
  if (y > 42.0 && normalY < 0.75) return 1.0;
  return 0.0;
}

export function rand01(ix, iz, salt = 0) {
  return hash01(hash2i((ix * 73856093 + salt) | 0, (iz * 19349663 - salt) | 0));
}
