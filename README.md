# VoxelEnginePrototype

A working browser-first voxel terrain prototype using **WebAssembly for terrain generation/meshing** and **WebGPU for rendering**.

The app now uses Vite for the browser development/build path, includes a prebuilt `public/voxel_core.wasm`, and keeps a tiny Node static server for serving production `dist/` builds with correct WASM MIME and cross-origin isolation headers.

## What it demonstrates

- Chunked procedural terrain streamed around a flying camera.
- A freestanding WASM terrain core compiled from `native/voxel_core.c`.
- `32m` near-terrain chunks sampled at `32³` cells / `33³` density points.
- Signed-distance-field terrain with canyon walls, a deterministic cave trunk with side branches, branch-end chambers, optional shafts, and carve/build brush falloff plus smooth/flatten/material-paint brushes using sphere, box, or camera-oriented capsule SDF shapes.
- Deterministic macro continent, moisture, and temperature fields mirrored between TypeScript far terrain and the native WASM core.
- Runtime cached `256m` worldgen tiles with `17x17` elevation, macro climate, drainage, erosion, vegetation, gradient flow, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, biome-blend weights, material ID, normalized grass/rock/snow/mud material weights, cave proximity, river-network ID, and water-classification samples for live probes and future production tile work. The cache prewarms the camera-centered `3x3` tile neighborhood, generates TypeScript fallback tiles immediately, asynchronously loads generator-version-compatible native tiles from bounded IndexedDB storage, queues prioritized native replacement requests for idle terrain workers, drops stale low-priority prewarm work, adopts returned native WASM tile buffers, persists adopted native tiles back to IndexedDB, prunes old stored records, and reports prefetch/worker-queue/persistence telemetry in overlay/export data.
- Initial deterministic erosion tiles with `256m` cache entries and `17x17` samples for height, slope, drainage, stream power, thermal erosion, hydraulic erosion, deposition, sediment load, bedrock exposure, soil depth, and vegetation retention. The runtime cache returns immediate TypeScript fallback tiles, prewarms the same camera-centered `3x3` neighborhood, queues native WASM erosion tile replacement work for idle terrain workers, adopts returned native buffers, reports overlay telemetry, feeds live worldgen probes, nests into Export Worldgen JSON, and is covered by the deterministic worldgen tile regression baseline for both TypeScript and native output.
- Initial deterministic material-field tiles with `256m` cache entries and `17x17` samples that compose worldgen, erosion, and cave graph probes into normalized grass/rock/snow/mud weights plus wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, and blend-confidence fields. The cache prewarms with the camera neighborhood, feeds overlay/probe/brush-inspector telemetry, nests into Export Worldgen JSON, queues idle-worker native WASM material-tile replacements, adopts returned native buffers, persists adopted native material tiles through bounded IndexedDB storage, and is covered by the worldgen tile regression baseline for both TypeScript and native output. Production material ownership and shader-grade blending remain roadmap work.
- Initial deterministic browser-side cave graph tiles with `256m` cache entries for trunk, branch, chamber, and shaft metadata, stable passage/chamber IDs, biome hooks, nearest-feature probes, bounded IndexedDB persistence, schema/generator invalidation, prune telemetry, overlay telemetry, and nested Export Worldgen JSON output. The native WASM core now exposes matching cave graph tile buffers for regression and worker-backed adoption through idle terrain workers; stronger production streaming ownership is still a roadmap item.
- Marching Cubes-style cube-edge surface extraction with face-contour loop triangulation in WASM.
- Shared vertex indices for repeated crossings on the standard 12 cube edges in the current mesher.
- Mesh-quality regression captures for procedural, edited, and synthetic density fields, with packed degenerate triangles filtered at emission.
- Experimental nested LOD-aware near-terrain rings with a deterministic selector in `src/terrain_lod.ts`: the WASM `lod` parameter changes cell size/chunk scale, worker stats preserve `lod`/cell/chunk-size metadata, the settings panel can toggle coarse LOD 1/LOD 2 outer near-terrain rings, coarse-to-fine transition edges carry seam masks through the worker/cache contract, the selector emits an explicit transition-face schedule, per-base-cell transition worklist, deterministic transition sample/case metadata, and a regression-covered table-driven transition-prism mesh generator. Runtime now builds an aggregate transition mesh from cached near-chunk density samples when LOD rings are enabled, submits it through the terrain renderer, and reports emitted/missing transition cells beside the existing plan telemetry. The native WASM core also exposes a deterministic 12-sample transition-prism tetra-table cell mesher ABI that emits the same packed vertex/index buffers as chunk meshing and is covered by smoke validation for all four horizontal seam sides; the browser runtime now queues sampled transition cells to an idle terrain worker and swaps in the returned native-packed aggregate mesh over the TypeScript fallback when available. Conservative coarse-edge seam skirts remain as a fallback until full native Transvoxel transition chunks replace them.
- Density-grid-derived terrain normals so meshed vertices reuse cached `33³` SDF samples instead of resampling the terrain function.
- Chunk-local quantized terrain GPU vertices for positions, normals, material IDs, AO, and enriched biome/wetness/snow mask bytes.
- Meshlet-like terrain cluster bounds generated for each uploaded chunk, packed into renderer-owned GPU terrain arenas with shared vertex/index/origin streams, shared cluster records, and shared indexed-indirect draw records. A WebGPU compute pass now owns near-terrain frustum selection and optional previous-frame Hi-Z occlusion, compacting visible cluster draw records into one terrain indirect arena before the render pass.
- GPU Hi-Z depth-pyramid generation after the main render pass, with conservative previous-frame terrain cluster occlusion tests plus mip-count, memory, visible-cluster, and occluded-cluster telemetry.
- Renderer-side GPU upload ring pages for far terrain, water, vegetation, and marker buffer creation, with mapped-buffer fallback telemetry; near terrain uploads now target stable large GPU arenas instead of creating per-chunk buffers.
- Packed worker-to-renderer chunk mesh transfers.
- Direct packed terrain vertex output from the WASM meshing core.
- Quantized `i16` density samples exported from WASM and carried with chunk cache entries.
- Shared typed-array pool for restored/imported chunk payloads, with reuse telemetry in the runtime overlay.
- Worker-side scratch arena telemetry for reusable temporary buffers plus transferable/shared-result output pressure.
- SharedArrayBuffer per-worker batched generate job pages, cached-density remesh payload pages, and reusable result arenas when cross-origin isolation is available; workers process multiple generated chunks per wake, write chunk results into non-overlapping shared result slots for batched jobs, and the main thread copies them before renderer/cache ownership.
- Compressed region payloads for IndexedDB slots and portable `.scvr` files: delta-varint density plus byte-LZSS packed vertices, indices, and vegetation where smaller, with legacy raw imports still accepted.
- Region persistence telemetry in the overlay, including saved slot chunk/edit metadata and raw-vs-encoded compression ratios.
- Active-vs-saved region diff telemetry for the selected slot, including chunk coverage, changed cached payloads, signature-aware edit-log differences, sampled active-only/saved-only/changed operations, and edit-branch differences.
- Renameable region slots, persisted locally and mirrored into saved IndexedDB metadata.
- Live region browser showing every managed slot's active selection, saved chunk/edit counts, last-save state, compression footprint, codec payload counts, aggregate storage summary, filtering/saved-only controls, refresh, named retention policies with custom max-slot/max-MB dry-run reports, recent maintenance history, searchable metadata-only payload inspection, saved-vs-saved payload comparison, decode/hash payload verification, JSON maintenance-report export with inspected/comparison/audit payload metadata, bundle import/export, and per-slot load/diff/export/inspect/compare/verify/clear maintenance actions.
- Bulk region-slot management with duplicate-slot, retention-policy pruning, export-all, and import-all bundle workflows using compact `.scvb` files built from existing `.scvr` snapshots.
- `.scvr` import preview with active-vs-file diff telemetry plus explicit apply or merge actions.
- WASM cached-density remeshing entrypoint for polygonizing existing `33³` samples without resampling the procedural field.
- Streamer-driven sphere/box/capsule carve/build/smooth/flatten/material-paint rebuilds from cached density samples when dirty chunks have cached density payloads.
- IndexedDB multi-region slot save/load plus portable `.scvr` region import/export with layout compatibility checks for edit logs and cached chunk payloads.
- WebGPU rasterized triangle terrain meshes.
- First visual-quality foundation slice: a procedural sky pass with sun haze/cloud puffs, cinematic lighting/tone/atmosphere controls, a softened scenic valley floor, denser `12/24/48m` far-vista rings out to about `5.8km`, hybrid SDF-near/scenic-far river water, peak-biased alpine snow caps, procedural forest-shadow streaks, a renderer-side far-forest layer that backs off when SDF terrain is enabled, lightweight shrub/rock scenery variants inside the existing vegetation batch, a higher wide valley-overlook camera, compact overlay styling, collapsed settings by default, hidden center crosshair for visual captures, near SDF enabled by default, opt-in game markers, and opt-in brush preview markers. The latest reference-gap pass advances the saved settings key to `stormCanyon.engineSettings.v20`, retunes the default camera and visual defaults for the supplied golden alpine view, streams a bounded SDF focus set around the camera's ground look target, adds far-vista directional horizon AO/cavity shading, cools snow, restores greener terrain, makes the water pass opaque and depth-writing, smooths the near-SDF/scenic river height blend, lowers presentation ponds, opens near-river vegetation, and strengthens low-angle haze plus terrain contrast. This fixes the previous high-camera `SDF tris: 0k` composition failure and improves landform readability, but it is still only a foundation slice; the current view remains below the supplied reference until real shadow maps/AO, terrain-integrated lakes, richer materials, broader scenery assets/impostors, and production water/sky work land.
- Worker-based chunk generation and meshing.
- Adjustable render distance: 7-chunk default SDF field, runtime/URL control up to a 20-chunk radius, altitude-aware expansion, upper mountain chunk coverage, and a 5.8km camera-centered far heightfield clipmap-ring vista for high-altitude flight.
- Procedural material detail: packed biome/wetness/snow bytes now fold in macro climate, drainage, erosion, and vegetation suitability signals; fast domain-warped value noise in WGSL creates grass, dirt/mud, rock strata, and snow variation without image texture assets.
- Material painting is a first-class runtime edit mode: paint operations replay through the worker/WASM edit log, override near-terrain vertex material IDs during remesh, persist in region edit logs, and do not mutate density samples.
- Carve/build falloff is a first-class density edit option: soft SDF blends replay in edit-log order against generated or cached `33³` density grids, persist in region edit logs, and keep hard-edged legacy edits compatible.
- Smooth is a first-class density edit mode: smooth operations replay in edit-log order, run against generated or cached `33³` density grids, and expose a persisted brush-strength control.
- Flatten is a first-class density edit mode: flatten operations blend affected samples toward the brush-center horizontal plane, support sphere/box/capsule shapes, and use capsule flattening as the current path/terrace-cut primitive.
- Chunk eviction and dirty remeshing after edits.
- Versioned undo/redo edit operation log synced to workers before meshing, with a branch-aware settings-panel edit-history summary showing recent applied edits, redoable edits, archived divergent branches, and branch-switch/clear actions.
- LRU compressed chunk mesh cache for revisiting evicted terrain.
- Procedural river mesh with animated water.
- Deterministic vegetation/scenery patches retained by patch, CPU-frustum-culled, distance-LOD-filtered at the instance level for shrubs, rocks, and small pines, and rendered through one visible-instance batch draw with patch/instance/LOD-cull telemetry.
- Live performance/debug overlay with frame time, worker queues, upload history, renderer upload-ring telemetry, and estimated GPU buffer memory. The settings panel can hide the stats overlay, settings panel, density panel, and region browser independently for cleaner review captures.
- Capability-oriented quality presets for auto/low/balanced/high/ultra runtime tuning; Auto now uses rolling frame-time feedback to shift quality tiers while keeping individual engine controls editable.
- Runtime terrain debug views for normals, material IDs, combined material masks, individual biome/wetness/snow masks, AO, chunk ID coloring, configurable cached density slices, named density-slice capture sets with JSON import/export, numeric diff telemetry, and a diff heatmap, plus live camera/brush worldgen, erosion-tile, cave-distance, and cave-graph probes, worldgen/erosion/cave-graph tile-cache telemetry, a settings-panel brush inspector for current influence/falloff coverage and material/biome/mask weights, a settings-panel Region Diff summary for active-vs-saved chunk/edit/branch comparisons, material swatches, built-in detail/path/terrace/tunnel/falloff brush presets, locally persisted named brush presets, optional distance-aware live brush-preview markers, conservative dirty edit-region markers, and procedural paint-material picking.
- Scriptable density-capture regression checks for comparing exported slice JSON in local or CI workflows.
- Scriptable mesh-quality regression checks for comparing Marching Cubes topology metrics and packed vertex/index hashes.
- Scriptable visual-regression screenshot metrics, compact perceptual signatures, compressed full-resolution luma perceptual fields, full-resolution diff heatmaps, and a browser-driven multi-viewport visual capture wrapper, with JSON baselines in `docs/visual-quality-baseline.json`.
- Screenshot-linked diagnostic export that embeds the current canvas PNG with settings, camera, renderer/streamer stats, region state, worldgen probes, density-slice/diff context, and recent adaptive-quality captures.
- Exportable quality-capture JSON snapshots for current preset tier, frame-time samples, renderer/streamer pressure, worldgen probes, capability state, recent auto-quality adjustments, and portable browser worker benchmark trend captures.
- Exportable worldgen-tile JSON snapshots for the current camera-centered `3x3` tile neighborhood, including export schema, tile schema/generator versions, field arrays, biome/water/river-network IDs, tile stats, nested erosion tiles, nested material-field tiles, nested cave-graph tiles, settings, and live probes.
- Query-string automation controls can apply settings/camera overrides, run runtime actions, emit `STORM_CANYON_AUTOMATION` console JSON, mirror the latest report on `window.__stormCanyonAutomationLatest`, and POST reports to `output/automation/latest.json` through Vite dev/preview or `npm run serve`.
- Bounded IndexedDB persistence for adopted native worldgen, erosion, and cave graph tiles, with schema/generator invalidation, oldest-record pruning, and overlay/export telemetry for persisted adoption.
- Runtime capability reporting for WebGPU limits, cross-origin isolation, SharedArrayBuffer readiness, and worker buffer mode.
- Deterministic WASM benchmark scenes for generation, cached remeshing, and edit remeshing, available from Node and from a dedicated browser worker capture path, with portable benchmark-history import/export and a CI-friendly artifact review script.
- Prototype game loop with in-world worldgen-classified survey beacons, route checkpoints, clearable terrain hazards, edit-driven field contracts for flatten/paint/carve/build objectives, biome/material coverage telemetry, traversal distance, derived inventory/score/rank state, region-save integration, and optional WebGPU marker rendering via the settings panel.
- Vite + checked TypeScript host tooling for the incremental production refactor.

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

To serve a production build through the tiny static server:

```bash
npm run build
npm run serve
```

To start directly at the maximum SDF radius:

```text
http://localhost:5173?radius=20
```

To force the experimental mixed-LOD rings for a browser check:

```text
http://localhost:5173?radius=9&lod=1
```

To automate a browser validation run without clicking the UI, use `set.<EngineSettingsKey>` overrides, optional `camera=x,y,z,yaw,pitch,fov`, and `auto` actions. This example hides the UI panels, waits 30 frames, emits runtime state to the console and backend, and writes the latest report to `output/automation/latest.json`:

```text
http://localhost:5173?auto=state&autoTarget=console,backend&autoWait=30&set.overlayPanelVisible=0&set.settingsPanelVisible=0&set.densityPanelVisible=0&set.regionBrowserPanelVisible=0
```

Supported automation actions are `state`, `diagnostic`, `quality`, `worldgen`, `benchmark`, `reloadChunks`, `carve`, `captureDensity`, `diffDensity`, `saveRegion`, `loadRegion`, `diffRegion`, and `resetGame`. Use `autoEveryFrames` plus `autoRuns` for repeated reports, `autoScreenshot=1` to include a PNG in diagnostic reports, and `GET /__storm/automation-report/latest` to retrieve the latest backend report.

To run the deterministic WASM benchmark scenes:

```bash
npm run benchmark
```

To compare exported browser-worker benchmark histories, quality captures, or diagnostic captures:

```bash
npm run benchmark:review -- baseline-benchmarks.json candidate-benchmarks.json --report output/benchmark-review.json
```

To run the deterministic Marching Cubes mesh-quality regression gate:

```bash
npm run mesh:regression
```

To run the deterministic worldgen tile regression gate:

```bash
npm run worldgen:regression
```

To run the deterministic LOD selector/seam/transition-schedule regression gate:

```bash
npm run lod:regression
```

To compare a captured reference-view screenshot against the visual baseline and write a review report:

```bash
npm run visual:regression -- --image output/playwright/visual-capture/desktop-1680x945.png --report-dir output/playwright/visual-reports
```

To capture and compare the desktop/mobile visual baselines through Playwright:

```bash
npm run visual:capture
```

To intentionally refresh those visual baselines:

```bash
npm run visual:capture -- --update
```

To compare two exported density-slice capture JSON files:

```bash
npm run density:diff -- baseline-slices.json candidate-slices.json --max-mean=0.1 --max-max=1.0
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
| [ / ] or - / = | Decrease / increase render distance at runtime, capped at radius 20 |
| 0 | Jump to max radius 20 |
| 9 | Reset to default radius 7 |
| E | Apply the selected brush mode, shape, radius, falloff, material/strength, and placement distance in front of the camera |
| Ctrl+Z / Ctrl+Y | Undo / redo terrain edits |
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
- TypeScript owns WebGPU device/context setup, input, resource upload, and UI.
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
│   ├── benchmark.mjs         # Deterministic WASM generation/remesh timings
│   ├── benchmark-review.mjs  # Browser-worker benchmark artifact comparison
│   ├── lod-selection-regression.mjs
│   ├── mesh-regression.mjs   # Deterministic mesh topology/hash baseline gate
│   ├── worldgen-tile-regression.mjs
│   ├── visual-capture.mjs    # Browser screenshots and reports for visual baselines
│   ├── visual-regression.mjs # PNG metric/signature/full-res perceptual comparison
│   ├── density-capture-diff.mjs
│   ├── serve.mjs             # Production dist server with WASM MIME + COOP/COEP
│   └── push-to-github.sh     # Helper for publishing this repo
├── src/
│   ├── main.ts               # Camera, chunk streaming, worker orchestration
│   ├── renderer.ts           # WebGPU pipelines and rendering
│   ├── worker.ts             # WASM worker job loop
│   ├── chunk_codec.ts        # Region payload compression helpers
│   ├── profiler.ts           # Runtime profiling and memory estimates
│   ├── region_file.ts        # Binary .scvr region file encoder/decoder
│   ├── region_store.ts       # IndexedDB-backed region persistence
│   ├── typed_array_pool.ts   # Reused typed-array payload storage
│   ├── worker_scratch.ts     # Worker-local temporary array arenas and telemetry
│   ├── settings_panel.ts     # Live engine settings UI
│   ├── engine_contracts.ts   # Shared host/worker/renderer contracts
│   ├── math.ts
│   ├── terrain_math.ts
│   ├── worldgen_tiles.ts       # Runtime worldgen tile cache and export schema
│   ├── worldgen_tile_store.ts  # IndexedDB-backed native worldgen tile persistence
│   ├── erosion_tiles.ts        # Deterministic erosion-field tile cache
│   ├── erosion_tile_store.ts   # IndexedDB-backed native erosion tile persistence
│   ├── material_tile_store.ts  # IndexedDB-backed native material tile persistence
│   ├── cave_tiles.ts           # Runtime cave graph tile metadata cache
│   ├── cave_tile_store.ts      # IndexedDB-backed cave graph tile persistence
│   └── style.css
└── docs/
    ├── ARCHITECTURE.md
    ├── ROADMAP.md
    ├── PERFORMANCE.md
    ├── mesh-quality-baseline.json
    ├── lod-selection-baseline.json
    ├── visual-quality-baseline.json
    ├── worldgen-tile-baseline.json
    └── plans/
        └── visual-quality-pipeline-plan.md
```

## Current limitations

This is a prototype, not the final engine:

- The host is now TypeScript, but the implementation is still the prototype architecture rather than the final Rust/WASM production core.
- Meshing now uses a Marching Cubes cube-edge polygonizer with face-contour loops, a center-value ambiguous-face decider, packed degenerate-triangle filtering, and mesh-quality regression captures. The native ABI and runtime can stream experimental mixed near-terrain LOD rings using a separately tested deterministic selector, emit explicit transition-face schedules plus per-base-cell transition worklists, derive deterministic transition sample/case metadata, build a table-driven transition-prism mesh from cached density samples at runtime, and use an idle worker to regenerate those transition cells through the native packed transition-cell mesher. Full native Transvoxel transition chunks and removal of temporary seam skirts remain pending.
- Near terrain now packs chunk meshes into large GPU arenas and uses a GPU compute pass to compact frustum/Hi-Z-visible cluster draw records into a shared indexed-indirect arena. Core WebGPU still requires the CPU to replay indirect slots one at a time, so a lower-overhead draw-count/multi-draw terrain submission path remains pending.
- No shadow maps, production multi-draw meshlet pipeline, volumetric terrain clipmaps, or full native Transvoxel LOD transition chunks yet.
- Vegetation is simple instanced cone geometry.
- The prototype game is a lightweight persisted expedition layer: survey beacons prove biome/material coverage, route checkpoints prove traversal, clearable hazards and field contracts require flatten, paint, carve, and build edits near marked worldgen sites, and the overlay reports derived inventory, score, rank, and travel distance. It is not a full physics/survival loop yet.
- Editing uses a global carve/build/smooth/flatten/material-paint operation log with sphere, box, capsule, radius, carve/build falloff, material, strength, and placement-distance controls; the settings panel now shows material swatches, built-in detail/path/terrace/tunnel/falloff brush presets, locally persisted named brush presets that can be saved/applied/deleted, a live brush inspector for influence radius, falloff band, surface/cave coverage, normalized material weights, biome blend weights, and terrain mask fields, and a Region Diff panel for active-vs-saved chunk/edit/branch comparison samples. Undo/redo rebuilds visible chunks instead of locally inverting density edits, and divergent redo paths are archived as persisted edit-history branches that can be switched back into the active log.
- The terrain function is intentionally compact and procedural. It now has deterministic macro continent/moisture/temperature fields, heuristic drainage, erosion, vegetation-suitability masks, a deterministic branch/chamber cave SDF, an initial runtime worldgen tile cache with gradient flow, multi-scale drainage-network fields, biome-blend weights, normalized material weights, cave-proximity fields, river-network metadata, camera-neighborhood streaming prewarm, prioritized worker-backed native tile replacement, stale queued-prewarm pruning, and schema/generator-versioned IndexedDB persistence with bounded retention for adopted native tiles, plus initial deterministic erosion and material-field tile caches with worker-backed native WASM tile-buffer adoption and schema/generator-versioned IndexedDB persistence for adopted native tiles, and an initial IndexedDB-backed cave graph tile cache with passage/chamber IDs, biome hooks, schema/generator invalidation, retention pruning, and worker-backed native WASM cave graph tile-buffer adoption. It does not yet have production hydraulic/thermal erosion simulation, production river simulation, production material-field ownership, production world streaming ownership, broader production invalidation ownership, or serialized production cave graph ownership.
- Density samples are quantized and cached; carve/build/smooth/flatten rebuilds can use cached-density remeshing, and the region browser plus renameable slot save/load/import-preview/import/export/diff/prune/inspect/compare/verify persists, compares, decodes, and hashes cached chunks through IndexedDB, portable `.scvr` files, and multi-slot `.scvb` bundles.

Those are the planned next steps, not architectural dead ends.

## Recommended next milestone

Continue the core engine roadmap with:

1. Promote the native transition-cell ABI and runtime aggregate transition-prism mesh bridge into full native Transvoxel transition chunk generation, then remove the temporary seam-skirt contract.
2. Continue the new GPU-owned terrain arena from fixed indirect-slot replay toward a lower-overhead draw-count/multi-draw submission path, and tune terrain arena sizing from browser traces.
3. Move vegetation/scenery culling deeper onto the GPU and add richer impostor/LOD systems on top of the current patch culling, instance distance LOD, and single frame batch draw.
4. Expand the current runtime worldgen tile cache, IndexedDB-backed native worldgen/erosion/material/cave tile persistence, prioritized worker-backed native tile adoption, macro climate fields, heuristic drainage/flow metadata, vegetation suitability, biome-blend/material weights, native material-field tile buffers, deterministic branch/chamber cave SDF, and worker-adopted native cave graph tile buffers into production worldgen, erosion, material, and cave graph tiles with river-network simulation, hydraulic/thermal erosion simulation, production material-field ownership, production scheduling, streaming ownership, broader region/world invalidation ownership, serialized cave graph ownership, and biome/material-blending data.
5. Expand the current region browser policy, payload-comparison, and decode/hash verification workflow into richer saved-region investigations, plus stronger brush/editor tooling on top of the sphere/box/capsule brush operations, carve/build falloff, smooth mode, flatten/path mode, material paint mode, and configurable placement distance.
6. Broaden the SharedArrayBuffer path from the current batched generate queue/remesh pages/result slots into clearer zero-copy cache ownership, and tune upload-ring page sizing from browser traces.
7. Port the stable C core to Rust/WASM once the browser-facing architecture stabilizes.

After the core engine roadmap is complete, continue the graphics track in `docs/plans/visual-quality-pipeline-plan.md` for deeper material, water, vegetation, cave-surface, shadow, and visual-regression work. The current renderer-only visual slice is intentionally aligned with that plan but does not complete it; the supplied cinematic alpine reference still requires the follow-on graphics work after the remaining meshing, culling, worldgen, Rust-core, and editor/game foundations.
