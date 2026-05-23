# Roadmap

## Phase 1 — Current prototype

Implemented:

- WASM terrain core.
- Worker-generated chunks.
- WebGPU mesh rendering.
- Water ribbon.
- Vegetation instancing.
- Runtime SDF carve edits.
- Performance overlay.

## Phase 2 — Better terrain chunks

- Move from `16³` to `32³` cells.
- Store `33³` density samples.
- Add compressed chunk cache.
- Add chunk-local arenas and pooled typed arrays.
- Add edit operation log.

## Phase 3 — Production meshing

- Replace marching tetrahedra with Marching Cubes.
- Add vertex sharing.
- Add quantized vertex layout.
- Add mesh clusters / meshlet-like metadata.
- Add Transvoxel transition chunks for LOD seams.

## Phase 4 — World generation

- Macro continent/elevation fields.
- Drainage and river networks.
- Cached erosion tiles.
- Biome blending.
- Wetness/snow/slope material masks.
- Cave graphs and chambers.

## Phase 5 — WebGPU performance

- CPU frustum culling.
- GPU frustum culling.
- Hi-Z depth pyramid.
- GPU occlusion culling.
- Indirect terrain draws.
- Indirect vegetation draws.
- Upload ring buffers.

## Phase 6 — Visual quality

- Triplanar material textures.
- Cascaded shadow maps.
- SSAO/GTAO-lite.
- Atmospheric fog.
- Better water and foam.
- Biome-specific vegetation assets.

## Phase 7 — Rust production core

- Port the stable C/WASM ABI to Rust.
- Use `wasm-bindgen` only at coarse boundaries.
- Use explicit arenas and SoA layouts.
- Add SIMD hot loops where profitable.
- Add native Rust benchmarks for generation and meshing.

## Phase 8 — Editor and hardening

- Brush UI.
- Material painting.
- Undo/redo.
- Save/load region files.
- Browser/device capability tiers.
- Automated benchmark scenes.
