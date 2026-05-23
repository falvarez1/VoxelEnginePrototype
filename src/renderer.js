import { riverCenter, terrainHeight, terrainMaterial, terrainNormal, valueNoise2 } from './terrain_math.js';

function roundUp4(n) { return (n + 3) & ~3; }

const FAR_TERRAIN_RADIUS = 1536;
const FAR_TERRAIN_STEP = 32;
const FAR_TERRAIN_HOLE_RADIUS = 175;
const FAR_TERRAIN_SNAP = 128;

function createBufferWithData(device, data, usage, label) {
  if (!data || data.byteLength === 0) return null;
  const buffer = device.createBuffer({
    label,
    size: roundUp4(data.byteLength),
    usage,
    mappedAtCreation: true,
  });
  const mapped = buffer.getMappedRange();
  if (data instanceof Float32Array) new Float32Array(mapped).set(data);
  else if (data instanceof Uint32Array) new Uint32Array(mapped).set(data);
  else if (data instanceof Uint16Array) new Uint16Array(mapped).set(data);
  else new Uint8Array(mapped).set(new Uint8Array(data.buffer ?? data));
  buffer.unmap();
  return buffer;
}

const TERRAIN_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) material: f32,
  @location(3) ao: f32,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) material: f32,
  @location(3) ao: f32,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.world = input.position;
  out.normal = normalize(input.normal);
  out.material = input.material;
  out.ao = input.ao;
  out.clip = scene.viewProj * vec4<f32>(input.position, 1.0);
  return out;
}

fn hash31(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(17.13, 71.7, 39.31))) * 43758.5453);
}

fn material_color(m: f32, world: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let id = i32(round(m));
  let noise = hash31(floor(world * 0.17));
  if (id == 1) {
    let strata = 0.08 * sin(world.y * 0.65 + world.x * 0.035);
    return vec3<f32>(0.37 + strata, 0.34 + strata * 0.5, 0.30 + strata * 0.25) + noise * 0.035;
  }
  if (id == 2) {
    return vec3<f32>(0.86, 0.90, 0.93) + noise * 0.04;
  }
  if (id == 3) {
    return vec3<f32>(0.42, 0.36, 0.26) + noise * 0.04;
  }
  let slope = clamp(n.y, 0.0, 1.0);
  return mix(vec3<f32>(0.20, 0.22, 0.14), vec3<f32>(0.26, 0.42, 0.18), slope) + noise * 0.035;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let sunDir = normalize(scene.sun.xyz);
  let diffuse = max(dot(n, sunDir), 0.0);
  let sky = 0.35 + 0.30 * clamp(n.y, 0.0, 1.0);
  let rim = pow(1.0 - max(dot(n, normalize(scene.camera.xyz - input.world)), 0.0), 2.0) * 0.08;
  var color = material_color(input.material, input.world, n);
  color *= (sky + diffuse * 0.95 + rim) * input.ao;

  let d = distance(scene.camera.xyz, input.world);
  let fog = clamp(1.0 - exp(-d * 0.00165), 0.0, 0.76);
  let fogColor = mix(vec3<f32>(0.63, 0.71, 0.80), vec3<f32>(0.88, 0.78, 0.62), max(scene.sun.y, 0.0) * 0.25);
  color = mix(color, fogColor, fog);
  return vec4<f32>(color, 1.0);
}
`;

const WATER_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;
struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) material: f32,
  @location(3) ao: f32,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) edge: f32,
};
@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var pos = input.position;
  let t = scene.params.x;
  pos.y += sin(pos.x * 0.18 + t * 1.5) * 0.10 + sin(pos.z * 0.14 - t * 1.15) * 0.08;
  var out: VertexOut;
  out.world = pos;
  out.edge = input.ao;
  out.clip = scene.viewProj * vec4<f32>(pos, 1.0);
  return out;
}
@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let sun = max(normalize(scene.sun.xyz).y, 0.0);
  let shimmer = 0.04 * sin(input.world.x * 0.9 + input.world.z * 0.35 + scene.params.x * 3.0);
  var color = vec3<f32>(0.08, 0.27, 0.35) + sun * vec3<f32>(0.05, 0.10, 0.12) + shimmer;
  let foam = smoothstep(0.72, 1.0, input.edge);
  color = mix(color, vec3<f32>(0.74, 0.86, 0.82), foam * 0.32);
  let d = distance(scene.camera.xyz, input.world);
  let fog = clamp(1.0 - exp(-d * 0.00165), 0.0, 0.72);
  color = mix(color, vec3<f32>(0.65, 0.72, 0.80), fog);
  return vec4<f32>(color, 0.68);
}
`;

const VEGETATION_SHADER = /* wgsl */`
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,
  params: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexIn {
  @location(0) local: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) part: f32,
  @location(3) base: vec3<f32>,
  @location(4) scale: f32,
  @location(5) kind: f32,
  @location(6) seed: f32,
};
struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) part: f32,
  @location(3) kind: f32,
};
@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  let wind = sin(scene.params.x * 1.8 + input.seed + input.base.x * 0.04) * 0.055 * input.local.y * input.scale;
  let p = vec3<f32>(input.local.x * input.scale + wind, input.local.y * input.scale, input.local.z * input.scale);
  let world = input.base + p;
  var out: VertexOut;
  out.world = world;
  out.normal = normalize(input.normal);
  out.part = input.part;
  out.kind = input.kind;
  out.clip = scene.viewProj * vec4<f32>(world, 1.0);
  return out;
}
@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let diffuse = max(dot(n, normalize(scene.sun.xyz)), 0.0);
  var color = vec3<f32>(0.12, 0.28, 0.09);
  if (input.part < 0.5) { color = vec3<f32>(0.20, 0.12, 0.06); }
  if (input.kind < 0.5 && input.part > 0.5) { color = vec3<f32>(0.22, 0.38, 0.12); }
  color *= 0.42 + diffuse * 0.70;
  let d = distance(scene.camera.xyz, input.world);
  let fog = clamp(1.0 - exp(-d * 0.00235), 0.0, 0.82);
  color = mix(color, vec3<f32>(0.64, 0.72, 0.80), fog);
  return vec4<f32>(color, 1.0);
}
`;

function makeTreeMesh() {
  const verts = [];
  const add = (p, n, part) => verts.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
  const sides = 8;
  const top = [0, 1.45, 0];
  const midTop = [0, 0.95, 0];
  for (let layer = 0; layer < 2; layer++) {
    const y = layer === 0 ? 0.20 : 0.58;
    const r = layer === 0 ? 0.46 : 0.34;
    const apex = layer === 0 ? top : midTop;
    for (let i = 0; i < sides; i++) {
      const a = i / sides * Math.PI * 2;
      const b = (i + 1) / sides * Math.PI * 2;
      const p0 = [Math.cos(a) * r, y, Math.sin(a) * r];
      const p1 = [Math.cos(b) * r, y, Math.sin(b) * r];
      const n = [Math.cos(a + Math.PI / sides), 0.55, Math.sin(a + Math.PI / sides)];
      add(apex, n, 1); add(p0, n, 1); add(p1, n, 1);
    }
  }
  // crossed trunk quads
  const trunk = [
    [[-0.08, 0, 0], [0.08, 0, 0], [0.08, 0.48, 0], [-0.08, 0.48, 0]],
    [[0, 0, -0.08], [0, 0, 0.08], [0, 0.48, 0.08], [0, 0.48, -0.08]],
  ];
  for (const q of trunk) {
    const n = [0, 0, 1];
    add(q[0], n, 0); add(q[1], n, 0); add(q[2], n, 0);
    add(q[0], n, 0); add(q[2], n, 0); add(q[3], n, 0);
  }
  return new Float32Array(verts);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.format = null;
    this.depthTexture = null;
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.chunks = new Map();
    this.vegetation = new Map();
    this.water = null;
    this.farTerrain = null;
    this.lastWaterCenter = { x: Infinity, z: Infinity };
    this.lastFarTerrainCenter = { x: Infinity, z: Infinity };
    this.stats = { drawCalls: 0, terrainTriangles: 0, farTerrainTriangles: 0, vegetationInstances: 0 };
  }

  async init() {
    if (!('gpu' in navigator)) {
      throw new Error('WebGPU is not available in this browser. Try current Chrome, Edge, Firefox Nightly, or Safari Technology Preview with WebGPU enabled.');
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found.');
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.uniformBuffer = this.device.createBuffer({
      label: 'scene uniforms',
      size: 16 * 4 + 4 * 4 * 3,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.uniformBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    const terrainModule = this.device.createShaderModule({ label: 'terrain shader', code: TERRAIN_SHADER });
    const waterModule = this.device.createShaderModule({ label: 'water shader', code: WATER_SHADER });
    const vegetationModule = this.device.createShaderModule({ label: 'vegetation shader', code: VEGETATION_SHADER });

    const terrainVertexLayout = {
      arrayStride: 8 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
        { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
        { shaderLocation: 3, offset: 7 * 4, format: 'float32' },
      ],
    };

    this.terrainPipeline = this.device.createRenderPipeline({
      label: 'terrain pipeline',
      layout: pipelineLayout,
      vertex: { module: terrainModule, entryPoint: 'vs_main', buffers: [terrainVertexLayout] },
      fragment: { module: terrainModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.waterPipeline = this.device.createRenderPipeline({
      label: 'water pipeline',
      layout: pipelineLayout,
      vertex: { module: waterModule, entryPoint: 'vs_main', buffers: [terrainVertexLayout] },
      fragment: {
        module: waterModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    const treeMesh = makeTreeMesh();
    this.treeVertexCount = treeMesh.length / 7;
    this.treeVertexBuffer = createBufferWithData(this.device, treeMesh, GPUBufferUsage.VERTEX, 'tree mesh');
    this.vegetationPipeline = this.device.createRenderPipeline({
      label: 'vegetation pipeline',
      layout: pipelineLayout,
      vertex: {
        module: vegetationModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 7 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
              { shaderLocation: 2, offset: 6 * 4, format: 'float32' },
            ],
          },
          {
            arrayStride: 8 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 3, offset: 0, format: 'float32x3' },
              { shaderLocation: 4, offset: 3 * 4, format: 'float32' },
              { shaderLocation: 5, offset: 4 * 4, format: 'float32' },
              { shaderLocation: 6, offset: 5 * 4, format: 'float32' },
            ],
          },
        ],
      },
      fragment: { module: vegetationModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.device) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height && this.depthTexture) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.depthTexture?.destroy?.();
    this.depthTexture = this.device.createTexture({
      label: 'depth texture',
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  createChunkMesh(key, vertices, indices, stats = {}) {
    this.removeChunk(key);
    if (!vertices || !indices || indices.length === 0) return;
    const vertexBuffer = createBufferWithData(this.device, vertices, GPUBufferUsage.VERTEX, `chunk ${key} vertices`);
    const indexBuffer = createBufferWithData(this.device, indices, GPUBufferUsage.INDEX, `chunk ${key} indices`);
    this.chunks.set(key, { vertexBuffer, indexBuffer, indexCount: indices.length, vertexCount: vertices.length / 8, stats });
  }

  removeChunk(key) {
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.vertexBuffer?.destroy?.();
      chunk.indexBuffer?.destroy?.();
      this.chunks.delete(key);
    }
    this.removeVegetationPatch(key);
  }

  createVegetationPatch(key, instances) {
    this.removeVegetationPatch(key);
    if (!instances || instances.length === 0) return;
    const instanceBuffer = createBufferWithData(this.device, instances, GPUBufferUsage.VERTEX, `vegetation ${key}`);
    this.vegetation.set(key, { instanceBuffer, instanceCount: instances.length / 8 });
  }

  removeVegetationPatch(key) {
    const patch = this.vegetation.get(key);
    if (patch) {
      patch.instanceBuffer?.destroy?.();
      this.vegetation.delete(key);
    }
  }

  updateWater(cameraPosition, force = false) {
    const dx = cameraPosition[0] - this.lastWaterCenter.x;
    const dz = cameraPosition[2] - this.lastWaterCenter.z;
    if (!force && Math.hypot(dx, dz) < 128 && this.water) return;
    this.lastWaterCenter = { x: cameraPosition[0], z: cameraPosition[2] };
    this.water?.vertexBuffer?.destroy?.();
    this.water?.indexBuffer?.destroy?.();

    const segments = 420;
    const length = 3200;
    const vertices = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const z = cameraPosition[2] + (t - 0.5) * length;
      const center = riverCenter(z);
      const width = 8.0 + valueNoise2(z * 0.018, 55.0) * 5.5;
      const y = 6.15;
      const edge = 1.0;
      vertices.push(center - width, y, z, 0, 1, 0, 5, edge);
      vertices.push(center + width, y, z, 0, 1, 0, 5, edge);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const vertexArray = new Float32Array(vertices);
    const indexArray = new Uint32Array(indices);
    this.water = {
      vertexBuffer: createBufferWithData(this.device, vertexArray, GPUBufferUsage.VERTEX, 'river vertices'),
      indexBuffer: createBufferWithData(this.device, indexArray, GPUBufferUsage.INDEX, 'river indices'),
      indexCount: indexArray.length,
    };
  }

  updateFarTerrain(cameraPosition, force = false) {
    const snappedX = Math.round(cameraPosition[0] / FAR_TERRAIN_SNAP) * FAR_TERRAIN_SNAP;
    const snappedZ = Math.round(cameraPosition[2] / FAR_TERRAIN_SNAP) * FAR_TERRAIN_SNAP;
    if (!force && this.farTerrain && snappedX === this.lastFarTerrainCenter.x && snappedZ === this.lastFarTerrainCenter.z) return;

    this.lastFarTerrainCenter = { x: snappedX, z: snappedZ };
    this.farTerrain?.vertexBuffer?.destroy?.();
    this.farTerrain?.indexBuffer?.destroy?.();

    const cells = Math.floor((FAR_TERRAIN_RADIUS * 2) / FAR_TERRAIN_STEP);
    const vertsPerSide = cells + 1;
    const vertices = [];
    const indices = [];

    for (let iz = 0; iz <= cells; iz++) {
      const z = snappedZ - FAR_TERRAIN_RADIUS + iz * FAR_TERRAIN_STEP;
      for (let ix = 0; ix <= cells; ix++) {
        const x = snappedX - FAR_TERRAIN_RADIUS + ix * FAR_TERRAIN_STEP;
        const y = terrainHeight(x, z) - 0.65;
        const n = terrainNormal(x, z, FAR_TERRAIN_STEP * 0.35);
        const mat = terrainMaterial(x, y, z, n[1]);
        const ao = 0.74 + Math.max(n[1], 0.0) * 0.20;
        vertices.push(x, y, z, n[0], n[1], n[2], mat, ao);
      }
    }

    for (let iz = 0; iz < cells; iz++) {
      for (let ix = 0; ix < cells; ix++) {
        const cx = snappedX - FAR_TERRAIN_RADIUS + (ix + 0.5) * FAR_TERRAIN_STEP;
        const cz = snappedZ - FAR_TERRAIN_RADIUS + (iz + 0.5) * FAR_TERRAIN_STEP;
        if (Math.hypot(cx - cameraPosition[0], cz - cameraPosition[2]) < FAR_TERRAIN_HOLE_RADIUS) continue;
        const a = iz * vertsPerSide + ix;
        const b = a + 1;
        const c = a + vertsPerSide;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const vertexArray = new Float32Array(vertices);
    const indexArray = new Uint32Array(indices);
    this.farTerrain = {
      vertexBuffer: createBufferWithData(this.device, vertexArray, GPUBufferUsage.VERTEX, 'far terrain vertices'),
      indexBuffer: createBufferWithData(this.device, indexArray, GPUBufferUsage.INDEX, 'far terrain indices'),
      indexCount: indexArray.length,
    };
  }

  writeUniforms(camera, viewProj, timeSeconds) {
    const sun = new Float32Array([0.42, 0.82, 0.38, 0]);
    const params = new Float32Array([timeSeconds, 0, 0, 0]);
    const data = new Float32Array(16 + 4 + 4 + 4);
    data.set(viewProj, 0);
    data.set([camera.position[0], camera.position[1], camera.position[2], 1], 16);
    data.set(sun, 20);
    data.set(params, 24);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(camera, viewProj, timeSeconds) {
    this.resize();
    this.writeUniforms(camera, viewProj, timeSeconds);
    this.updateFarTerrain(camera.position);
    this.updateWater(camera.position);

    let terrainTriangles = 0;
    let farTerrainTriangles = 0;
    let vegetationInstances = 0;
    let drawCalls = 0;

    const encoder = this.device.createCommandEncoder({ label: 'frame encoder' });
    const colorView = this.context.getCurrentTexture().createView();
    const depthView = this.depthTexture.createView();
    const pass = encoder.beginRenderPass({
      label: 'main render pass',
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0.58, g: 0.68, b: 0.78, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setBindGroup(0, this.uniformBindGroup);
    pass.setPipeline(this.terrainPipeline);
    if (this.farTerrain) {
      pass.setVertexBuffer(0, this.farTerrain.vertexBuffer);
      pass.setIndexBuffer(this.farTerrain.indexBuffer, 'uint32');
      pass.drawIndexed(this.farTerrain.indexCount);
      farTerrainTriangles += this.farTerrain.indexCount / 3;
      drawCalls++;
    }

    for (const chunk of this.chunks.values()) {
      pass.setVertexBuffer(0, chunk.vertexBuffer);
      pass.setIndexBuffer(chunk.indexBuffer, 'uint32');
      pass.drawIndexed(chunk.indexCount);
      terrainTriangles += chunk.indexCount / 3;
      drawCalls++;
    }

    pass.setPipeline(this.vegetationPipeline);
    pass.setVertexBuffer(0, this.treeVertexBuffer);
    for (const patch of this.vegetation.values()) {
      pass.setVertexBuffer(1, patch.instanceBuffer);
      pass.draw(this.treeVertexCount, patch.instanceCount);
      vegetationInstances += patch.instanceCount;
      drawCalls++;
    }

    if (this.water) {
      pass.setPipeline(this.waterPipeline);
      pass.setVertexBuffer(0, this.water.vertexBuffer);
      pass.setIndexBuffer(this.water.indexBuffer, 'uint32');
      pass.drawIndexed(this.water.indexCount);
      drawCalls++;
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.stats = { drawCalls, terrainTriangles, farTerrainTriangles, vegetationInstances };
    return this.stats;
  }
}
