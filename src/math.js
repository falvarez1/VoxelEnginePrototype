export function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function vec3(x = 0, y = 0, z = 0) { return new Float32Array([x, y, z]); }
export function add(a, b) { return vec3(a[0] + b[0], a[1] + b[1], a[2] + b[2]); }
export function sub(a, b) { return vec3(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
export function scale(a, s) { return vec3(a[0] * s, a[1] * s, a[2] * s); }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
  return vec3(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
}
export function length(a) { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a) {
  const len = length(a) || 1;
  return vec3(a[0] / len, a[1] / len, a[2] / len);
}

export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Perspective(fovyRadians, aspect, near, far) {
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

export function mat4LookAt(eye, center, up) {
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

export function mat4Multiply(a, b) {
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
  constructor() {
    this.position = vec3(10, 38, -50);
    this.yaw = 0.35;
    this.pitch = -0.18;
    this.speed = 38;
    this.fastMultiplier = 3.0;
    this.slowMultiplier = 0.25;
  }

  forward() {
    const cp = Math.cos(this.pitch);
    return normalize(vec3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp));
  }

  right() {
    const f = this.forward();
    return normalize(cross(f, vec3(0, 1, 0)));
  }

  viewProjection(aspect) {
    const f = this.forward();
    const center = add(this.position, f);
    const view = mat4LookAt(this.position, center, vec3(0, 1, 0));
    const proj = mat4Perspective(70 * Math.PI / 180, aspect, 0.1, 5000.0);
    return mat4Multiply(proj, view);
  }
}
