export type Vec3 = Float32Array;
export type Mat4 = Float32Array;

export function clamp(x: number, a: number, b: number): number { return Math.max(a, Math.min(b, x)); }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function vec3(x = 0, y = 0, z = 0): Vec3 { return new Float32Array([x, y, z]); }
export function add(a: Vec3, b: Vec3): Vec3 { return vec3(a[0] + b[0], a[1] + b[1], a[2] + b[2]); }
export function sub(a: Vec3, b: Vec3): Vec3 { return vec3(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
export function scale(a: Vec3, s: number): Vec3 { return vec3(a[0] * s, a[1] * s, a[2] * s); }
export function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
}
export function length(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a: Vec3): Vec3 {
  const len = length(a) || 1;
  return vec3(a[0] / len, a[1] / len, a[2] / len);
}

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Perspective(fovyRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovyRadians / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = normalize(sub(center, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const out = mat4Identity();
  out[0] = s[0]; out[4] = s[1]; out[8] = s[2];
  out[1] = u[0]; out[5] = u[1]; out[9] = u[2];
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2];
  out[12] = -dot(s, eye);
  out[13] = -dot(u, eye);
  out[14] = dot(f, eye);
  return out;
}

export function mat4Ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  // WebGPU clip space: z in [0, 1], right-handed view looking down -z.
  const out = new Float32Array(16);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -1 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -near / (far - near);
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export class FlyCamera {
  position: Vec3;
  yaw: number;
  pitch: number;
  speed: number;
  fastMultiplier: number;
  slowMultiplier: number;
  fovDegrees: number;

  constructor() {
    this.position = vec3(96, 390, -1320);
    this.yaw = 0.018;
    this.pitch = -0.335;
    this.speed = 38;
    this.fastMultiplier = 3.0;
    this.slowMultiplier = 0.25;
    this.fovDegrees = 54;
  }

  forward(): Vec3 {
    const cp = Math.cos(this.pitch);
    return normalize(vec3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp));
  }

  right(): Vec3 {
    const f = this.forward();
    return normalize(cross(f, vec3(0, 1, 0)));
  }

  viewProjection(aspect: number): Mat4 {
    const f = this.forward();
    const center = add(this.position, f);
    const view = mat4LookAt(this.position, center, vec3(0, 1, 0));
    const proj = mat4Perspective(this.fovDegrees * Math.PI / 180, aspect, 0.1, 5000.0);
    return mat4Multiply(proj, view);
  }

  // Camera-relative view-projection: the view is built with the eye at the
  // origin (rotation only, no translation), so geometry must be transformed as
  // (world - position). This keeps the large absolute world coordinates out of
  // the f32 matrix multiply, eliminating the precision "jitter" that otherwise
  // appears far from the origin when the camera moves. Uses the same proj as
  // viewProjection(), so it stays consistent with the absolute matrix used for
  // CPU-side frustum culling.
  viewProjectionRelative(aspect: number): Mat4 {
    const f = this.forward();
    const view = mat4LookAt(vec3(0, 0, 0), f, vec3(0, 1, 0));
    const proj = mat4Perspective(this.fovDegrees * Math.PI / 180, aspect, 0.1, 5000.0);
    return mat4Multiply(proj, view);
  }
}
