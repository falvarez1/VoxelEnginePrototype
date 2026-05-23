# VoxelEnginePrototype

A working browser-first voxel terrain prototype using **WebAssembly for terrain generation/meshing** and **WebGPU for rendering**.

This repo is intentionally dependency-light: it runs as a static web app, includes a prebuilt `public/voxel_core.wasm`, and uses a tiny Node static server only to serve correct WASM MIME and cross-origin isolation headers.

## What it demonstrates

- Chunked procedural terrain streamed around a flying camera.
- A freestanding WASM terrain core compiled from `native/voxel_core.c`.
- Signed-distance-field terrain with caves, canyon walls, and destructive edit spheres.
- Marching-tetrahedra surface extraction in WASM.
- WebGPU rasterized triangle terrain meshes.
- Worker-based chunk generation and meshing.
- Larger render distance: 7-chunk default SDF field, altitude-aware expansion up to 11 chunks, plus upper mountain chunk coverage.
- Chunk eviction and dirty remeshing after edits.
- Procedural river mesh with animated water.
- Deterministic vegetation patches rendered with instancing.
- Live performance/debug overlay.

The prototype is deliberately small enough to inspect, modify, and replace piece by piece with the production architecture described in `docs/ARCHITECTURE.md`.

## Run it

Requirements:

- Node.js 20+
- A browser with WebGPU enabled, such as current Chrome or Edge desktop.

```bash
npm start
```

Open:

```text
http://localhost:5173
```

Controls:

| Input | Action |
|---|---|
| Click canvas | Capture mouse |
| Mouse | Look around |
| W/A/S/D | Fly |
| Space / Ctrl | Up / down |
| Shift | Fast movement |
| Alt | Slow movement |
| [ / ] or - / = | Decrease / increase render distance at runtime |
| E | Carve an SDF sphere in front of the camera |
| R | Reset terrain edits |

## Rebuild the WASM module

The repo includes the compiled WASM file, so rebuilding is optional.

If you have Clang/LLD with `wasm32-unknown-unknown-wasm` support:

```bash
npm run build:wasm
```

The build script emits:

```text
public/voxel_core.wasm
```

## Why the prototype core is C, not Rust

The production recommendation remains **Rust → WebAssembly** for the core engine. This first prototype uses freestanding C because it compiles to bare WASM with the minimal toolchain available in this environment and keeps the repo self-contained with no package downloads or Rust installation required.

The architecture boundaries are intentionally the same ones the Rust version should keep:

- WASM owns SDF evaluation, chunk meshing, edit application, and procedural classification.
- JavaScript owns WebGPU device/context setup, input, resource upload, and UI.
- Workers own generation/meshing jobs and transfer finished typed arrays back to the renderer.

## Repository layout

```text
.
├── index.html
├── native/
│   └── voxel_core.c          # WASM terrain/SDF/meshing core
├── public/
│   └── voxel_core.wasm       # Prebuilt WASM binary
├── scripts/
│   ├── build-wasm.sh         # Clang WASM build
│   ├── serve.mjs             # Static dev server with WASM MIME + COOP/COEP
│   └── push-to-github.sh     # Helper for publishing this repo
├── src/
│   ├── main.js               # Camera, chunk streaming, worker orchestration
│   ├── renderer.js           # WebGPU pipelines and rendering
│   ├── worker.js             # WASM worker job loop
│   ├── math.js
│   ├── terrain_math.js
│   └── style.css
└── docs/
    ├── ARCHITECTURE.md
    ├── ROADMAP.md
    └── PERFORMANCE.md
```

## Current limitations

This is a prototype, not the final engine:

- Meshing uses marching tetrahedra instead of production Transvoxel/Marching Cubes.
- Chunks are drawn with one draw call per chunk, not yet GPU-driven indirect draws.
- No shadow maps, Hi-Z occlusion, meshlets, or terrain clipmaps yet.
- Vegetation is simple instanced cone geometry.
- Editing uses global carve spheres and coarse dirty chunk invalidation.
- The terrain function is intentionally compact and procedural, not a full erosion/drainage simulation.

Those are the planned next steps, not architectural dead ends.

## Recommended next milestone

Replace the meshing core with:

1. `32³` SDF chunks with `33³` samples.
2. Marching Cubes first.
3. Transvoxel LOD seams next.
4. GPU-side frustum/occlusion culling with compacted indirect draw calls.
5. Rust/WASM rewrite of the C core once the browser-facing architecture stabilizes.
