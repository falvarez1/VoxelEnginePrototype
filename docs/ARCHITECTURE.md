# Architecture

Storm Canyon is a deliberately small implementation of the recommended browser voxel engine architecture:

```text
Browser host
  ├─ input / canvas / UI
  ├─ WebGPU renderer
  ├─ chunk streamer
  └─ worker pool
        └─ WebAssembly terrain core
              ├─ SDF terrain function
              ├─ cave and river carving
              ├─ edit overlay
              ├─ material classification
              └─ mesh extraction
```

## Current prototype path

```text
Camera movement
  ↓
Chunk streamer computes desired chunk set
  ↓
Worker receives chunk job
  ↓
Worker calls WASM `generate_chunk(cx, cy, cz, lod)`
  ↓
WASM samples the SDF field on a 17³ grid
  ↓
WASM polygonizes cells with marching tetrahedra
  ↓
Worker copies vertex/index arrays from WASM memory
  ↓
Main thread uploads buffers to WebGPU
  ↓
Renderer draws terrain, vegetation, and water
```

## WASM responsibilities

The current WASM core owns:

- Terrain height function.
- River canyon carving.
- Cave SDF subtraction.
- Runtime edit spheres.
- Density sampling.
- Mesh extraction.
- SDF gradient normals.
- Material ID classification.
- Vertex AO approximation.

The exported ABI is intentionally simple:

```c
int generate_chunk(int cx, int cy, int cz, int lod);
unsigned int get_vertex_ptr(void);
unsigned int get_index_ptr(void);
unsigned int get_vertex_count(void);
unsigned int get_index_count(void);
int add_subtract_sphere(float x, float y, float z, float radius);
void clear_edits(void);
float sample_density(float x, float y, float z);
```

## JavaScript responsibilities

The host owns:

- WebGPU initialization.
- Camera/input.
- Worker lifecycle.
- Chunk priority queue.
- WebGPU buffer upload/destruction.
- Render passes.
- HTML performance overlay.

## Renderer

The prototype uses three WebGPU pipelines:

1. Terrain mesh pipeline.
2. Alpha-blended water pipeline.
3. Instanced vegetation pipeline.

The terrain vertex format is:

```text
position.xyz  f32 x 3
normal.xyz    f32 x 3
material      f32
ambientAO     f32
```

This is intentionally easy to replace with a production compressed layout:

```text
position       u16x3 chunk-local
normal         packed octahedral
material IDs   u8/u16 palette indices
weights/AO     u8 normalized
```

## Production target

The production version should evolve toward:

- Rust/WASM core.
- `32³` cells / `33³` samples per chunk.
- Quantized `int16` SDF storage.
- Marching Cubes, then Transvoxel LOD seams.
- Meshlet/cluster partitioning.
- GPU frustum + Hi-Z culling.
- Indirect draw buffers.
- Far heightfield clipmaps. The prototype now includes a single camera-centered far heightfield vista mesh as the first step.
- More advanced material and biome systems.
- SharedArrayBuffer worker queues when cross-origin isolation is available.
