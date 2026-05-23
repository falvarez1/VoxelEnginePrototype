# Performance Notes

## Current prototype budgets

The prototype prioritizes clarity and proof of architecture over absolute throughput.

Default settings:

| Item | Current value |
|---|---:|
| Chunk cell resolution | `16³` |
| Density sample grid | `17³` |
| Cell size | `2m` |
| Chunk world size | `32m` |
| Stream radius | `3` horizontal chunks |
| Vertical layers | `-1, 0, 1` |
| Worker count | `min(4, hardwareConcurrency - 2)` |

On a modern desktop, the first load should progressively fill in terrain rather than blocking the main thread.

## Known hotspots

- Marching tetrahedra duplicates vertices and emits more triangles than Marching Cubes.
- SDF gradients resample the terrain function for every emitted vertex.
- Chunks are rendered as individual draw calls.
- Vegetation patches are separate draw calls.
- No GPU occlusion or indirect draw compaction yet.

## Immediate optimizations

1. Cache SDF gradients from the sample grid.
2. Switch from marching tetrahedra to Marching Cubes.
3. Share vertices along cell edges.
4. Quantize mesh vertices before upload.
5. Combine chunks into GPU pages/arenas.
6. Add CPU frustum culling, then WebGPU compute culling.
7. Batch indirect draw arguments into one buffer.
8. Add a far heightfield clipmap so volumetric chunks are only near-field.

## Production budgets

A realistic desktop production target:

| Budget | Target |
|---|---:|
| Frame | 16.67 ms |
| Main-thread JS | < 2 ms |
| Command encoding | < 1.5 ms |
| Terrain pass | 3–6 ms |
| Vegetation | 1–3 ms |
| Worker chunk generation | async |
| Worker chunk meshing | async |
| Typical upload | < 2 MB/frame |
| Spike upload cap | < 8 MB/frame |
