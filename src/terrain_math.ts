function hashU32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
function hash2i(x: number, y: number): number {
  return hashU32((Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841)) >>> 0);
}
function hash3i(x: number, y: number, z: number): number {
  return hashU32((Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f)) >>> 0);
}
function hash01(h: number): number { return (h & 0x00ffffff) / 16777215; }
function smooth(t: number): number { return t * t * (3 - 2 * t); }
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(x: number, a: number, b: number): number { return Math.max(a, Math.min(b, x)); }
function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0.0001) return Math.min(a, b);
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return b + (a - b) * h - k * h * (1.0 - h);
}

export function valueNoise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = smooth(fx), sy = smooth(fy);
  const a = hash01(hash2i(ix, iy));
  const b = hash01(hash2i(ix + 1, iy));
  const c = hash01(hash2i(ix, iy + 1));
  const d = hash01(hash2i(ix + 1, iy + 1));
  return mix(mix(a, b, sx), mix(c, d, sx), sy);
}

export function valueNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = smooth(fx), sy = smooth(fy), sz = smooth(fz);
  const c000 = hash01(hash3i(ix, iy, iz));
  const c100 = hash01(hash3i(ix + 1, iy, iz));
  const c010 = hash01(hash3i(ix, iy + 1, iz));
  const c110 = hash01(hash3i(ix + 1, iy + 1, iz));
  const c001 = hash01(hash3i(ix, iy, iz + 1));
  const c101 = hash01(hash3i(ix + 1, iy, iz + 1));
  const c011 = hash01(hash3i(ix, iy + 1, iz + 1));
  const c111 = hash01(hash3i(ix + 1, iy + 1, iz + 1));
  const x00 = mix(c000, c100, sx);
  const x10 = mix(c010, c110, sx);
  const x01 = mix(c001, c101, sx);
  const x11 = mix(c011, c111, sx);
  return mix(mix(x00, x10, sy), mix(x01, x11, sy), sz);
}

export function fbm2(x: number, y: number, octaves = 5): number {
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

export function ridge2(x: number, y: number): number {
  const n = valueNoise2(x, y) * 2 - 1;
  const r = 1 - Math.abs(n);
  return r * r;
}

// Fast domain-warped value-noise detail. It is cheaper than full Perlin/simplex and
// gives the terrain enough small-scale breakup for grass, dirt, and snow materials.
export function surfaceDetailNoise(x: number, z: number): number {
  const wx = (valueNoise2(x * 0.010 + 123.4, z * 0.010 - 57.8) * 2 - 1) * 18.0;
  const wz = (valueNoise2(x * 0.010 - 88.2, z * 0.010 + 19.6) * 2 - 1) * 18.0;
  const detail = valueNoise2((x + wx) * 0.110, (z + wz) * 0.110) * 2 - 1;
  const crag = ridge2((x + wx) * 0.055 + 17.0, (z + wz) * 0.055 - 11.0);
  return detail * 1.15 + crag * 1.45;
}

export function macroContinent(x: number, z: number): number {
  return fbm2(x * 0.0018 + 19.0, z * 0.0018 - 4.0);
}

export function macroMoisture(x: number, z: number): number {
  const stormTrack = fbm2(x * 0.0015 - 61.0, z * 0.0015 + 27.0);
  const basin = ridge2(x * 0.0030 + 12.0, z * 0.0030 - 45.0);
  const rainShadow = ridge2(x * 0.0022 - 18.0, z * 0.0022 + 9.0);
  return clamp(0.52 + stormTrack * 0.24 + basin * 0.18 - rainShadow * 0.12, 0.0, 1.0);
}

export function macroTemperature(x: number, z: number): number {
  const latitude = clamp(Math.abs(z) * 0.00016, 0.0, 0.32);
  const weather = fbm2(x * 0.0012 + 44.0, z * 0.0012 - 73.0);
  const foehn = valueNoise2(x * 0.0025 - 33.0, z * 0.0025 + 16.0) * 2.0 - 1.0;
  return clamp(0.58 - latitude + weather * 0.18 + foehn * 0.08, 0.0, 1.0);
}

export function riverCenter(z: number): number {
  const n1 = valueNoise2(z * 0.010, 17.3) * 2 - 1;
  const n2 = valueNoise2(z * 0.027 + 81.2, 9.7) * 2 - 1;
  return n1 * 42 + n2 * 12;
}

// JavaScript mirror of native/voxel_core.c terrain_height().
// The far-terrain vista uses this lower-cost heightfield while near terrain remains SDF/WASM.
export function terrainHeight(x: number, z: number): number {
  const continent = macroContinent(x, z);
  const moisture = macroMoisture(x, z);
  const temperature = macroTemperature(x, z);
  const alpineLift = clamp((1.0 - temperature) * 0.50 + continent * 0.35 + 0.20, 0.0, 1.0);
  const base = 20.0 + 12.0 * fbm2(x * 0.012, z * 0.012) + (moisture - 0.5) * 4.0;
  const hills = (8.0 + alpineLift * 4.0) * fbm2(x * 0.035 + 5.2, z * 0.035 - 8.1);
  const ridge = ridge2(x * 0.010 - 14.0, z * 0.010 + 6.0);
  const ridgeMask = clamp((continent + 0.25) * 1.25, 0.0, 1.0);
  let h = base + hills + ridge * ridgeMask * (36.0 + alpineLift * 18.0);

  const rc = riverCenter(z);
  const dist = Math.abs(x - rc);
  const valleyWidth = 34.0 + 10.0 * valueNoise2(z * 0.018, 41.0);
  let canyon = clamp(1.0 - dist / valleyWidth, 0.0, 1.0);
  canyon = smooth(canyon);
  const riverbed = 5.0 + 1.25 * fbm2(x * 0.030 + 77.0, z * 0.030);
  h = mix(h, riverbed, canyon * 0.84);

  const terrace = valueNoise2(x * 0.065, z * 0.065) * 2.0 - 1.0;
  h += terrace * canyon * 2.5;
  const shoulder = smooth(clamp((dist - 16.0) / 96.0, 0.0, 1.0)) * (1.0 - smooth(clamp((dist - 172.0) / 260.0, 0.0, 1.0)));
  const sideFold = ridge2((x - rc) * 0.020 + z * 0.005, z * 0.012 - rc * 0.003);
  // 5 octaves (default) to match native fbm2 exactly — voxel_core.c's fbm2 is
  // hardcoded to 5, so passing 3 here diverged the JS mirror and seamed the near
  // (WASM) vs far (JS) terrain in the canyon-shoulder band (and perturbed the basin
  // carve below, which reads h via drainageMask).
  const basinRoll = fbm2((x - rc) * 0.018 + 29.0, z * 0.018 - 12.0);
  h += (sideFold * (7.5 + alpineLift * 5.5) + basinRoll * 4.0) * shoulder;

  const exposed = clamp((continent + 0.1) * 0.8 + ridgeMask * 0.45, 0.0, 1.0);
  h += surfaceDetailNoise(x, z) * exposed * (1.0 - canyon * 0.55);

  // Lake basins (Photon Upgrade 7): exact mirror of native terrain_height()'s basin
  // carve — smooth depressions in drainage-fed lowlands away from the river channel.
  // Must stay byte-identical to the C version or near/far terrain will seam.
  const lbDrain = drainageMask(x, z, h);
  const lbField = valueNoise2(x * 0.0045 + 51.0, z * 0.0045 - 23.0);
  const lbPockets = smooth(clamp((lbField - 0.52) / 0.22, 0.0, 1.0));
  const lbLow = clamp(1.0 - (h - 9.0) / 16.0, 0.0, 1.0);
  const lbBasin = smooth(lbPockets * lbDrain * lbLow * (1.0 - canyon));
  h -= lbBasin * 6.5;
  return h;
}

function capsuleSdfLocal(px: number, py: number, pz: number, dx: number, dy: number, dz: number, length: number, radius: number): number {
  const directionLength = Math.hypot(dx, dy, dz) || 1.0;
  const nx = dx / directionLength;
  const ny = dy / directionLength;
  const nz = dz / directionLength;
  const halfLength = Math.max(length, 0.0) * 0.5;
  const h = clamp(px * nx + py * ny + pz * nz, -halfLength, halfLength);
  return Math.hypot(px - nx * h, py - ny * h, pz - nz * h) - radius;
}

function caveTrunkDistance(x: number, y: number, z: number): number {
  const cx = riverCenter(z + 95.0) + (valueNoise2(z * 0.018, 101.1) * 2.0 - 1.0) * 14.0;
  const cy = 1.5 + (valueNoise2(z * 0.020 + 13.0, 52.2) * 2.0 - 1.0) * 8.0;
  const radius = 5.0 + 3.0 * valueNoise2(z * 0.033 + 7.0, 33.7);
  const tube = Math.hypot(x - cx, y - cy) - radius;
  const chamberNoise = valueNoise3(x * 0.030 + 5.0, y * 0.030 - 8.0, z * 0.030 + 2.0);
  const widen = clamp((1.0 - chamberNoise - 0.62) * 3.0, 0.0, 1.0) * 5.0;
  return tube - widen;
}

function caveBranchDistance(x: number, y: number, z: number, branchCell: number): number {
  const cell = branchCell;
  const branchZ = cell * 128.0 + (valueNoise2(cell * 0.73, 12.0) * 2.0 - 1.0) * 18.0;
  const side = valueNoise2(cell * 1.17 + 5.0, 23.0) > 0.5 ? 1.0 : -1.0;
  const branchCx = riverCenter(branchZ + 95.0) + (valueNoise2(branchZ * 0.018, 101.1) * 2.0 - 1.0) * 14.0;
  const branchCy = 0.5 + (valueNoise2(branchZ * 0.020 + 13.0, 52.2) * 2.0 - 1.0) * 7.0;
  const branchRadius = 2.8 + 1.6 * valueNoise2(cell * 0.41 - 8.0, 19.0);
  const branch = capsuleSdfLocal(
    x - (branchCx + side * 38.0),
    y - branchCy,
    z - branchZ,
    side,
    0.04,
    0.16,
    96.0,
    branchRadius,
  );
  const endX = branchCx + side * 86.0;
  const endY = branchCy + 1.5;
  const chamberRadius = 5.5 + 3.0 * valueNoise2(cell * 0.29, 31.0);
  const chamber = Math.hypot(x - endX, (y - endY) * 0.75, z - branchZ) - chamberRadius;
  let cave = smoothMin(branch, chamber, 6.0);
  if (valueNoise2(cell * 0.19, 55.0) > 0.55) {
    const shaft = capsuleSdfLocal(x - endX, y - (endY + 9.0), z - branchZ, 0.10, 1.0, 0.05, 28.0, 2.2);
    cave = smoothMin(cave, shaft, 3.5);
  }
  return cave;
}

export function caveDistance(x: number, y: number, z: number): number {
  let cave = caveTrunkDistance(x, y, z);
  const branchCell = Math.floor((z + 64.0) / 128.0);
  for (let offset = -1; offset <= 1; offset++) {
    cave = smoothMin(cave, caveBranchDistance(x, y, z, branchCell + offset), 6.0);
  }
  return cave;
}

export function terrainNormal(x: number, z: number, sampleStep = 8.0): [number, number, number] {
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

export function drainageMask(x: number, z: number, height = terrainHeight(x, z)): number {
  const rc = riverCenter(z);
  const riverDist = Math.abs(x - rc);
  const valleyWidth = 46.0 + 18.0 * valueNoise2(z * 0.014 + 11.0, 41.0);
  const river = smooth(clamp(1.0 - riverDist / 20.0, 0.0, 1.0));
  const valley = smooth(clamp(1.0 - riverDist / valleyWidth, 0.0, 1.0));
  const tributaryWarp = (valueNoise2(x * 0.006 - 19.0, z * 0.006 + 34.0) * 2.0 - 1.0) * 26.0;
  const tributary = ridge2((x + tributaryWarp) * 0.018 + 33.0, z * 0.018 - 12.0);
  const lowland = clamp(1.0 - (height - 10.0) / 34.0, 0.0, 1.0);
  const moisture = macroMoisture(x, z);
  return clamp(river * 0.82 + valley * lowland * 0.46 + tributary * lowland * (0.22 + moisture * 0.18) + moisture * lowland * 0.18, 0.0, 1.0);
}

export function erosionMask(x: number, z: number, height = terrainHeight(x, z), normalY = 1.0): number {
  const continent = macroContinent(x, z);
  const moisture = macroMoisture(x, z);
  const ridge = ridge2(x * 0.010 - 14.0, z * 0.010 + 6.0);
  const ridgeMask = clamp((continent + 0.25) * 1.25, 0.0, 1.0);
  const steep = clamp(1.0 - normalY, 0.0, 1.0);
  const exposure = clamp((height - 22.0) / 45.0, 0.0, 1.0);
  const frostFracture = ridge2(x * 0.040 + 8.0, z * 0.040 - 5.0);
  const wind = valueNoise2(x * 0.014 - 23.0, z * 0.014 + 31.0) * 2.0 - 1.0;
  const rainCut = moisture * ridge2(x * 0.026 - 7.0, z * 0.026 + 39.0) * 0.16;
  return clamp(steep * 0.54 + ridgeMask * ridge * 0.24 + exposure * 0.20 + frostFracture * 0.12 + rainCut + wind * 0.06, 0.0, 1.0);
}

export function vegetationMask(
  x: number,
  z: number,
  height = terrainHeight(x, z),
  normalY = 1.0,
  drainage = drainageMask(x, z, height),
  erosion = erosionMask(x, z, height, normalY),
): number {
  const rc = riverCenter(z);
  const riverDist = Math.abs(x - rc);
  const flat = clamp((normalY - 0.44) / 0.50, 0.0, 1.0);
  const temperature = macroTemperature(x, z);
  const moisture = macroMoisture(x, z);
  const temperate = clamp((1.0 - (height - 42.0) / 30.0) * 0.70 + temperature * 0.30, 0.0, 1.0);
  const forestPatch = smooth(valueNoise2(x * 0.010 + 61.0, z * 0.010 - 14.0));
  const riverBankPenalty = smooth(clamp((riverDist - 12.0) / 28.0, 0.0, 1.0));
  const erosionPenalty = 1.0 - smooth(clamp((erosion - 0.48) / 0.36, 0.0, 1.0));
  return clamp((temperate * 0.30 + moisture * 0.20 + drainage * 0.22 + forestPatch * 0.28) * flat * riverBankPenalty * erosionPenalty, 0.0, 1.0);
}

export function biomeMask(x: number, z: number, height = terrainHeight(x, z), normalY = 0.8): number {
  const continent = macroContinent(x, z);
  const moisture = macroMoisture(x, z);
  const temperature = macroTemperature(x, z);
  const ridge = ridge2(x * 0.010 - 14.0, z * 0.010 + 6.0);
  const ridgeMask = clamp((continent + 0.25) * 1.25, 0.0, 1.0);
  const highland = clamp((height - 24.0) / 42.0, 0.0, 1.0);
  const variation = valueNoise2(x * 0.0045 - 31.0, z * 0.0045 + 17.0) * 2.0 - 1.0;
  const drainage = drainageMask(x, z, height);
  const erosion = erosionMask(x, z, height, normalY);
  const vegetation = vegetationMask(x, z, height, normalY, drainage, erosion);
  const climate = clamp((1.0 - temperature) * 0.28 + moisture * 0.18, 0.0, 1.0);
  return clamp(highland * 0.34 + ridgeMask * 0.22 + erosion * 0.16 + vegetation * 0.18 + climate * 0.18 + variation * 0.10, 0.0, 1.0);
}

export function wetnessMask(x: number, y: number, z: number, normalY = 1.0, _height = terrainHeight(x, z)): number {
  const rc = riverCenter(z);
  const riverDist = Math.abs(x - rc);
  const valleyWidth = 42.0 + 14.0 * valueNoise2(z * 0.018, 41.0);
  const river = smooth(clamp(1.0 - riverDist / 18.0, 0.0, 1.0));
  const valley = smooth(clamp(1.0 - riverDist / valleyWidth, 0.0, 1.0));
  const lowland = clamp(1.0 - (y - 7.0) / 13.0, 0.0, 1.0);
  const seep = smooth(valueNoise2(x * 0.022 + 73.0, z * 0.022 - 29.0));
  const flat = clamp((normalY - 0.28) / 0.72, 0.0, 1.0);
  const drainage = drainageMask(x, z, _height);
  const moisture = macroMoisture(x, z);
  return clamp((river * 0.68 + valley * lowland * 0.30 + valley * seep * 0.14 + drainage * 0.26 + moisture * lowland * 0.24) * flat, 0.0, 1.0);
}

export function snowMask(x: number, y: number, z: number, normalY = 1.0, _height = terrainHeight(x, z)): number {
  const temperature = macroTemperature(x, z);
  const elevation = clamp((y - (39.0 + temperature * 10.0)) / 24.0, 0.0, 1.0);
  const slope = clamp((normalY - 0.18) / 0.72, 0.0, 1.0);
  const wind = valueNoise2(x * 0.018 + 7.0, z * 0.018 - 12.0) * 2.0 - 1.0;
  const erosion = erosionMask(x, z, _height, normalY);
  const drift = smooth(clamp(elevation + wind * 0.20 - (1.0 - slope) * 0.24 - erosion * 0.16, 0.0, 1.0));
  return clamp(drift, 0.0, 1.0);
}

export function terrainMaterial(x: number, y: number, z: number, normalY = 1.0): number {
  const h = terrainHeight(x, z);
  const rc = riverCenter(z);
  const riverDist = Math.abs(x - rc);
  const erosion = erosionMask(x, z, h, normalY);
  const wetness = wetnessMask(x, y, z, normalY, h);
  const snow = snowMask(x, y, z, normalY, h);
  if ((y < 8.8 && riverDist < 10.5) || (wetness > 0.74 && y < 11.5 && riverDist < 22.0)) return 3.0;
  if (normalY < 0.52 || erosion > 0.74 || y < h - 2.0) return 1.0;
  if ((y > 52.0 && normalY > 0.38) || (snow > 0.64 && normalY > 0.34)) return 2.0;
  if (y > 42.0 && normalY < 0.75) return 1.0;
  return 0.0;
}

export function rand01(ix: number, iz: number, salt = 0): number {
  return hash01(hash2i((ix * 73856093 + salt) | 0, (iz * 19349663 - salt) | 0));
}
