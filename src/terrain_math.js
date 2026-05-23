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
export function riverCenter(z) {
  const n1 = valueNoise2(z * 0.010, 17.3) * 2 - 1;
  const n2 = valueNoise2(z * 0.027 + 81.2, 9.7) * 2 - 1;
  return n1 * 42 + n2 * 12;
}
export function rand01(ix, iz, salt = 0) {
  return hash01(hash2i((ix * 73856093 + salt) | 0, (iz * 19349663 - salt) | 0));
}
