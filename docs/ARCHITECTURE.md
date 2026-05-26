# Architecture

Storm Canyon is a deliberately small implementation of the recommended browser voxel engine architecture:

```text
Browser host
  ├─ input / canvas / UI
  ├─ prototype game state
  ├─ WebGPU renderer
  ├─ settings / profiling panels
  ├─ chunk streamer
  └─ worker pool
        └─ WebAssembly terrain core
              ├─ SDF terrain function
              ├─ cave and river carving
              ├─ carve/build/smooth/flatten/material-paint edit overlay
              ├─ material classification
              └─ mesh extraction
```

## Current prototype path

```text
Camera movement
  ↓
Chunk streamer computes desired chunk set
  ↓
Cached chunk mesh reused, or
  ↓
Worker receives chunk job
  ↓
Worker verifies the synced edit-log version
  ↓
Worker calls WASM `generate_chunk(cx, cy, cz, lod)`
  ↓
WASM samples the SDF field on a 33³ grid
  ↓
WASM polygonizes cells with a Marching Cubes cube-edge polygonizer
  ↓
WASM reuses standard 12-edge cube crossings and writes indexed mesh buffers
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
- Deterministic macro continent, moisture, and temperature fields shared with the TypeScript far-terrain mirror.
- River canyon carving.
- Cave SDF subtraction with a canyon-following trunk, deterministic side branches, branch-end chambers, and optional shafts.
- Runtime carve/build/smooth/flatten/material-paint edit shapes: sphere, axis-aligned box, and oriented capsule.
- Density sampling.
- Marching Cubes-style mesh extraction.
- Shared vertex emission for repeated crossings on the standard 12 cube edges.
- Native 12-sample LOD transition-prism cell meshing for all four horizontal seam sides, using the same packed vertex/index buffers as chunk meshing as an ABI stepping stone toward full Transvoxel chunks.
- SDF gradient normals derived from the cached density grid.
- Material ID classification.
- Enriched biome, wetness, and snow mask generation for packed material payloads, including macro climate, drainage, erosion, and vegetation-suitability signals.
- Native `256m` worldgen tile buffer generation for elevation, macro climate, drainage, erosion, vegetation, local gradient flow, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, biome-blend weights, material IDs, normalized grass/rock/snow/mud material weights, terrain-surface cave distance/influence, biome IDs, water IDs, and river-network IDs.
- Native `256m` erosion tile buffer generation for height, slope, drainage, stream power, thermal erosion, hydraulic erosion, deposition, sediment load, bedrock exposure, soil depth, and vegetation retention.
- Native `256m` material-field tile buffer generation for normalized grass/rock/snow/mud weights, wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, blend-confidence, and dominant material IDs.
- Browser-side `256m` cave graph tiles and matching native WASM cave graph tile buffers for deterministic trunk, branch, chamber, and shaft metadata, including stable IDs and biome hooks for probes, export diagnostics, and regression parity checks.
- Vertex AO approximation.

The exported ABI is intentionally simple:

```c
int generate_chunk(int cx, int cy, int cz, int lod);
int generate_lod_transition_cell_mesh(int side);
unsigned int get_vertex_ptr(void);
unsigned int get_index_ptr(void);
unsigned int get_lod_transition_position_ptr(void);
unsigned int get_lod_transition_density_ptr(void);
unsigned int get_vertex_count(void);
unsigned int get_index_count(void);
int get_lod_transition_sample_count(void);
int get_lod_transition_algorithm_id(void);
int add_subtract_sphere(float x, float y, float z, float radius);
int add_add_sphere(float x, float y, float z, float radius);
int add_subtract_box(float x, float y, float z, float radius);
int add_add_box(float x, float y, float z, float radius);
int add_subtract_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length);
int add_add_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length);
int add_subtract_sphere_falloff(float x, float y, float z, float radius, float falloff);
int add_add_sphere_falloff(float x, float y, float z, float radius, float falloff);
int add_subtract_box_falloff(float x, float y, float z, float radius, float falloff);
int add_add_box_falloff(float x, float y, float z, float radius, float falloff);
int add_subtract_capsule_falloff(float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff);
int add_add_capsule_falloff(float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff);
int add_paint_sphere(float x, float y, float z, float radius, int material);
int add_smooth_sphere(float x, float y, float z, float radius, float strength);
int add_flatten_sphere(float x, float y, float z, float radius, float strength);
int apply_subtract_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius);
int apply_add_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius);
int apply_subtract_box_to_density(int cx, int cy, int cz, float x, float y, float z, float radius);
int apply_add_box_to_density(int cx, int cy, int cz, float x, float y, float z, float radius);
int apply_subtract_capsule_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length);
int apply_add_capsule_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length);
int apply_subtract_sphere_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff);
int apply_add_sphere_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff);
int apply_subtract_box_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff);
int apply_add_box_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff);
int apply_subtract_capsule_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff);
int apply_add_capsule_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff);
int apply_smooth_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float strength);
int apply_flatten_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float strength);
void clear_edits(void);
float sample_density(float x, float y, float z);
float get_terrain_height(float x, float z);
float get_river_center(float z);
float get_macro_continent(float x, float z);
float get_moisture_mask(float x, float z);
float get_temperature_mask(float x, float z);
float get_cave_distance(float x, float y, float z);
float get_biome_mask(float x, float z);
float get_wetness_mask(float x, float y, float z, float ny);
float get_snow_mask(float x, float y, float z, float ny);
float get_drainage_mask(float x, float z);
float get_erosion_mask(float x, float z, float ny);
float get_vegetation_mask(float x, float z);
int generate_worldgen_tile(int tile_x, int tile_z);
unsigned int get_worldgen_tile_field_ptr(void);
unsigned int get_worldgen_tile_biome_id_ptr(void);
unsigned int get_worldgen_tile_water_id_ptr(void);
unsigned int get_worldgen_tile_river_id_ptr(void);
int get_worldgen_tile_resolution(void);
int get_worldgen_tile_sample_count(void);
int get_worldgen_tile_field_count(void);
float get_worldgen_tile_size(void);
int generate_erosion_tile(int tile_x, int tile_z);
unsigned int get_erosion_tile_field_ptr(void);
int get_erosion_tile_resolution(void);
int get_erosion_tile_sample_count(void);
int get_erosion_tile_field_count(void);
int get_erosion_tile_schema_version(void);
int get_erosion_tile_generator_version(void);
float get_erosion_tile_size(void);
int generate_material_tile(int tile_x, int tile_z);
unsigned int get_material_tile_field_ptr(void);
unsigned int get_material_tile_id_ptr(void);
int get_material_tile_resolution(void);
int get_material_tile_sample_count(void);
int get_material_tile_field_count(void);
int get_material_tile_schema_version(void);
int get_material_tile_generator_version(void);
float get_material_tile_size(void);
int generate_cave_graph_tile(int tile_x, int tile_z);
unsigned int get_cave_graph_passage_ptr(void);
unsigned int get_cave_graph_chamber_ptr(void);
int get_cave_graph_passage_count(void);
int get_cave_graph_chamber_count(void);
int get_cave_graph_max_passages(void);
int get_cave_graph_max_chambers(void);
int get_cave_graph_passage_field_count(void);
int get_cave_graph_chamber_field_count(void);
int get_cave_graph_tile_schema_version(void);
int get_cave_graph_tile_generator_version(void);
float get_cave_graph_tile_size(void);
int get_mesher_id(void); // 1 = Marching Cubes cube-edge mesher
```

## JavaScript responsibilities

The host owns:

- WebGPU initialization.
- Camera/input.
- Worker lifecycle.
- Chunk priority queue.
- Runtime worldgen tile cache for camera/brush probes, with bounded `256m` tiles carrying elevation, macro climate, drainage, erosion, vegetation, local gradient flow, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, biome-blend weights, material IDs, normalized material weights, cave proximity, biome IDs, river-network IDs, water classification, prioritized native replacement scheduling, and bounded IndexedDB persistence.
- Runtime erosion tile cache for camera/brush probes, with bounded `256m` tiles carrying height, slope, drainage, stream power, thermal erosion, hydraulic erosion, deposition, sediment load, bedrock exposure, soil depth, vegetation retention, camera-neighborhood prewarm telemetry, prioritized native worker replacement, native tile adoption telemetry, bounded IndexedDB persistence, schema/generator invalidation, retention pruning, and nested Export Worldgen payloads.
- Runtime material-field tile cache for camera/brush probes, with bounded `256m` tiles carrying normalized grass/rock/snow/mud weights plus wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, and blend-confidence fields composed from the worldgen, erosion, and cave graph caches. It returns TypeScript fallback tiles immediately, queues prioritized native WASM material-tile replacements for idle terrain workers, adopts returned native buffers, persists adopted native material tiles through a bounded IndexedDB store, and reports worker/persistence telemetry while production material ownership remains future work.
- Runtime cave graph tile cache for camera/brush probes, with `256m` tiles carrying passage IDs, passage kinds, branch-end chambers, optional shafts, biome hooks, nearest-feature distances, bounded IndexedDB persistence, schema/generator invalidation, retention pruning, and exportable cache telemetry. The native core exposes the same graph as fixed-field passage/chamber arrays that idle terrain workers can adopt into the live cache.
- Versioned undo/redo edit operation log.
- LRU compressed chunk mesh cache.
- Shared typed-array pool for decoded/restored chunk payloads.
- Worker-local scratch arena telemetry for temporary staging and transferable/shared-result output allocations.
- SharedArrayBuffer per-worker batched generate job pages, cached-density remesh payload pages, and result arenas when cross-origin isolation is available.
- WebGPU buffer upload/destruction.
- Meshlet-like terrain cluster metadata generation, GPU-resident cluster-bound buffers, CPU-frustum range batching, WebGPU compute Hi-Z culling for range-level indexed-indirect arguments, and CPU-visible cluster draw submission filtering.
- Render passes.
- HTML performance/settings overlays.
- URL-driven settings/camera/action automation, panel visibility toggles, console/window report targets, and backend report capture under `output/automation/`.
- Capability-oriented auto/low/balanced/high/ultra quality presets that adjust stream radius and visual cost knobs while preserving individual controls; Auto mode also tracks rolling frame time to upshift/downshift tier after warmup and cooldown windows.
- Runtime profiling estimates for frame time, upload rate, renderer upload-ring staging, worker state, and GPU buffer memory.
- Runtime terrain debug views for normals, material IDs, combined material mask bytes, individual biome/wetness/snow mask channels, AO, chunk ID coloring, cached density slices, named density-slice capture sets with import/export/diff heatmaps, live camera/brush worldgen, erosion-tile, material-field, cave-distance, and cave-graph probes, worldgen, erosion, material, and cave-graph tile-cache telemetry, live brush-preview markers, and conservative dirty edit-region markers.
- Scriptable density-capture regression checks for exported slice JSON.
- Screenshot-linked diagnostic export that embeds the current canvas image beside settings, camera, renderer/streamer stats, adaptive-quality state, recent quality captures, region state, worldgen probes, and density-slice/diff context.
- Query-string automation can emit the same runtime state surfaces without clicking browser controls, including state, diagnostic, quality, worldgen, benchmark, edit, density, region, and reset actions, with `STORM_CANYON_AUTOMATION` console JSON and optional backend files.
- Camera-centered worldgen-tile export that serializes the current `3x3` tile neighborhood with export schema, tile schema/generator versions, worldgen tiles, nested erosion tiles, nested material-field tiles, and nested cave graph tiles for regression triage.
- Exportable quality-capture JSON for the active preset tier, frame-time samples, renderer/streamer pressure, worldgen probes, capability state, browser worker benchmark trends, and recent auto-quality adjustments.
- Runtime capability reporting for WebGPU limits, cross-origin isolation, SharedArrayBuffer readiness, worker buffer mode, and device-loss state.
- Deterministic benchmark scenes for WASM generation, cached-density remeshing, and edit remeshing, runnable from Node and through a dedicated browser worker capture path.
- Deterministic mesh-quality regression captures for Marching Cubes topology, boundary/non-manifold counts, and packed mesh hashes.
- Deterministic mixed-LOD selection, transition-face/worklist metadata, TypeScript aggregate transition-mesh construction from cached density payloads, idle-worker native transition-cell aggregation, and native transition-cell smoke validation until full native Transvoxel chunks replace the bridge.
- Deterministic worldgen tile regression captures for worldgen field hashes, biome/water/river-network ID hashes, erosion field hashes/summaries, TypeScript/native material-field hashes/summaries, cave graph hashes, and per-field summaries.
- IndexedDB multi-region slot management.
- Live region slot browser for inspecting saved slot metadata, changing the active slot, and running per-slot load/diff/export/clear maintenance actions without relying only on the settings action strip.
- Multi-slot region bundle import/export using `.scvb` envelopes that contain existing `.scvr` snapshots plus slot metadata.
- Prototype worldgen-classified expedition progression persisted locally and embedded in region snapshots, including survey beacons, edit contracts, route checkpoints, clearable hazards, traversal distance, and derived inventory/score/rank telemetry.

## Renderer

The prototype uses five WebGPU render pipelines:

1. Fullscreen procedural sky pipeline.
2. Terrain mesh pipeline.
3. Opaque depth-writing water pipeline.
4. Batched instanced vegetation pipeline.
5. Instanced survey-site, route-checkpoint, hazard, and field-contract marker pipeline for the prototype game layer and optional editor/debug markers.

The shared scene uniform includes a `visual` vec4 for exposure, atmosphere strength, sky enablement, and cinematic-lighting enablement. The settings panel exposes those high-value controls without turning every shader constant into UI state. Debug views still bypass the cinematic tone/fog path so normals, material IDs, material masks, AO, and chunk IDs remain diagnostic rather than color-graded.

The first visual-quality foundation slice is mostly renderer-side. The sky pass draws before terrain, the terrain/water/vegetation shaders share warm/cool lighting and atmosphere conventions, the far-vista heightfield applies valley softening, peak-biased snow caps, serrated far ridges, renderer-only vertical shaping, and CPU-baked directional horizon AO/cavity shading to rendered far-vista vertices, and the water ribbon blends from the physical SDF river near the camera into the scenic far-vista river in the distance. The latest reference-alignment pass raises the far-vista mesh density to `12/24/48m` rings out to about `5.8km`, uses a higher pulled-back SDF-near valley-overlook camera, advances the settings key to `stormCanyon.engineSettings.v20`, retunes exposure/atmosphere/material-detail/fog/water/low-sun defaults, and keeps near SDF terrain visible from the high overlook by adding a bounded stream set around the camera's ground look target. It also reduces procedural material-noise intensity, cools snow preservation, restores greener terrain in the low-sun grade, keeps renderer-only alpine snow peak-biased, smooths the SDF/scenic river height blend, makes water opaque and depth-writing, lowers the presentation ponds so they do not produce foreground water walls, opens near-river vegetation, keeps game markers opt-in, and strengthens localized low-sun landform/forest contrast. Near vegetation and rocks still come from worker chunk patches, while renderer-generated far scenery fills mid/distant slopes without changing chunk payloads and backs off when near SDF is enabled. The native SDF edit contract, physical terrain-height function, material-mask lane, erosion tile ABI, cave graph ABI, and edit semantics remain unchanged by this latest visual pass. The renderer-only pass fixes the earlier high-camera SDF streaming miss, but still needs the follow-on visual-quality pipeline for real shadow maps/AO, terrain-integrated water, richer materials, and broader scenery/impostor assets.

Near terrain chunks now carry CPU-side bounding spheres that still reject fully offscreen chunks before any per-cluster work. Visible chunk clusters are grouped into contiguous CPU-frustum-visible ranges before optional GPU Hi-Z culling.

Uploaded terrain chunks also generate deterministic meshlet-like cluster bounds by partitioning their index buffers into fixed-size batches. The renderer keeps a CPU copy for overlay stats and uploads the same bounds into a per-chunk GPU storage buffer. Each frame it builds contiguous visible cluster ranges from the CPU frustum pass, uploads conservative range bounds plus initialized indirect arguments into per-chunk range buffers, and, when the previous-frame Hi-Z pyramid is stable, runs the existing compute culler over those range bounds. The compute pass preserves each range's `firstIndex`/`indexCount` and zeroes only occluded range-level `drawIndexedIndirect` argument records. When Hi-Z is not stable, such as during camera movement or first-frame warmup, the render pass uses the same contiguous ranges as direct indexed draws. This reduces active-Hi-Z command pressure compared with one indirect call per cluster while keeping conservative occlusion. Full GPU-owned visible-cluster compaction, multi-draw submission, and larger GPU draw arenas remain future work.

The main depth attachment is `depth32float` so it can be sampled after rendering. Once the render pass ends, a compute path copies that depth buffer into an `r32float` mip 0 and downsamples farthest depth through the remaining Hi-Z levels. The next terrain range-cull pass uses the previous pyramid only when the view-projection matrix is stable, which avoids camera-motion artifacts while still proving the occlusion path and telemetry. A small GPU counter buffer reports tested and culled range-batch counts through asynchronous readback for the overlay and quality captures; legacy cluster-named fields remain in exported captures for compatibility.

Vegetation uses worker-generated patch instances for near terrain, and the renderer retains immutable CPU-side instance arrays per patch with instance-derived bounds spheres. The same instance format now carries pine, shrub, and rock scenery kinds: pine, shrub, and rock mesh parts live in one low-poly vertex buffer, and the vertex shader collapses inactive variant parts per instance kind so the renderer keeps one visible-instance draw. Each frame, CPU frustum culling selects visible patches, distance-LOD filtering removes far shrubs, rocks, and small pines, and deterministic renderer-side far scenery is added when the scenic far vista is active. The surviving instances are packed into one visible vegetation/scenery GPU vertex buffer, and all visible scenery renders with a single instanced draw. The overlay keeps visible/culled patch counts, rendered instance counts, instance LOD-cull counts, and vegetation batch-draw counts stable so later GPU culling, impostor, or scenery-expansion work can measure against the same telemetry.

The scenic far-vista path is deliberately renderer-owned. It now softens the visible river valley, applies height exaggeration, serrated renderer-side far ridges, and peak-biased renderer-only snow caps for the reference overlook, and lets a meandering scenic river mesh follow that scenic valley floor instead of a fixed physical water level. When near SDF rendering is enabled, the far-forest patch backs away from the foreground so worker-generated near vegetation remains readable. The latest pass stayed in this renderer/default layer; physical terrain fields and deterministic mesh/worldgen baselines only need refreshing when a later slice intentionally changes `src/terrain_math.ts` or `native/voxel_core.c`.

The terrain shader has runtime debug modes for normal vectors, material IDs, packed biome/wetness/snow material masks, individual biome/wetness/snow scalar masks, ambient occlusion, and chunk ID coloring. The three mask bytes now also encode macro climate, heuristic drainage accumulation, erosion exposure, and vegetation suitability while keeping the current render stride. Material-paint edits override the near-terrain material ID byte during remesh, so the material-ID debug view can inspect painted surfaces without widening the packed vertex format. The settings panel exposes material swatches that switch directly into paint mode, hard/soft falloff presets, detail/path/terrace/tunnel brush presets, locally persisted named brush presets for save/apply/delete workflows, opt-in brush preview, a procedural paint-material picker that samples the terrain material under the current brush placement point before switching into paint mode, a live brush inspector for current core/falloff influence, surface/cave coverage, normalized material weights, biome blend weights, material-field channels, and terrain mask fields, a Region Diff panel for the latest active-vs-saved chunk/edit/branch comparison and bounded samples, and a branch-aware edit-history panel for the active edit log, redo stack, and archived divergent branches. That history panel is read-only for individual operations and shows operation IDs, applied/redo/branch state, brush type/shape, radius, coordinates, falloff, strength, material context, branch base edit, branch length, and branch age; the panel actions can switch the newest compatible branch into the active edit log or clear archived branches without changing worker edit replay semantics. A separate density panel can inspect configurable `x`, `y`, or `z` slices from cached `33³` SDF sample payloads near the camera, either following the camera or using an explicit slice index. The same panel persists bounded named capture sets in local storage, browses captures and sets independently, imports/exports the set library as JSON, and compares the current slice against a saved diagnostic snapshot with changed-cell, mean-delta, max-delta telemetry, and a red/blue diff heatmap. Camera and brush-target worldgen probes are served by a bounded TypeScript worldgen tile cache for 2D fields and include macro climate, drainage, erosion, vegetation, material classification, biome/water IDs, local gradient flow, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, river-network IDs, biome-blend weights, normalized material weights, terrain-surface cave distance/influence, tile cache stats, and signed cave distance so near-surface and underground diagnostics stay visible in overlay, the brush inspector, Diagnostic export, and Quality export data. The same probes include the initial erosion tile cache's thermal erosion, hydraulic erosion, deposition, sediment load, bedrock exposure, soil depth, vegetation-retention fields, the material-field cache's roughness, fertility, stability, shoreline, cave-surface, route-cost, and blend-confidence fields, and erosion/material tile cache stats so material/erosion promotion can be inspected without committing to production simulation yet. The same probes also include nearest deterministic cave graph passage/chamber IDs, passage kind, approximate feature distance, biome hook, cave graph tile key, and cave graph cache/persistence stats from a TypeScript tile cache backed by bounded IndexedDB storage in browser runtime. The Export Diagnostic action builds on that state by embedding the current canvas PNG, runtime metadata, adaptive-quality state, and recent quality captures into a single JSON artifact for visual or engine regression review. Export Quality creates a smaller performance-focused snapshot without the screenshot payload. Browser-worker benchmark history is also portable: the settings panel can export/import/clear recent captures, quality and diagnostic exports embed them, and `scripts/benchmark-review.mjs` can compare benchmark-history, quality, or diagnostic JSON in CI with configurable regression thresholds. Legacy single-capture and single-library JSON are still accepted. The marker pass can render survey beacons, route checkpoints, clearable hazards, and edit-driven field contracts for the prototype game layer, but the setting is off by default for reference captures; contract and hazard completion are still derived from active edit-log operations near marked sites, so flatten, paint, carve, and build tools are exercised by gameplay without introducing a separate gameplay-edit path. The overlay also reports traversal distance plus derived inventory, score, and rank so the prototype game has a small expedition loop instead of only isolated markers. The brush preview marker is opt-in, and the Dirty Regions debug view still adds recent edit operations as conservative dirty-region bounds, including non-spherical brush shapes. These are early versions of the required engine inspection tools for validating mesh data, material classification, streaming boundaries, sample fields, erosion fields, material fields, cave fields, brush placement, edit propagation, and runtime quality pressure.

`scripts/density-capture-diff.mjs` consumes the same exported density-slice JSON and compares selected captures by SDF meters. It can enforce changed-cell, mean-delta, and max-delta thresholds for local regression checks or CI runs without opening the browser.

`scripts/visual-regression.mjs` consumes captured PNG screenshots and compares image-level metrics, compact downsampled perceptual signatures, and compressed full-resolution luma perceptual fields against `docs/visual-quality-baseline.json`. In compare mode it can also write a JSON report, an HTML review page, expected/actual signature previews, a signature-diff heatmap, and a full-resolution luma diff heatmap under `output/playwright/visual-reports/`. `scripts/visual-capture.mjs` wraps Playwright screenshot capture for the default desktop and mobile viewports, optionally starts Vite, writes PNGs under `output/playwright/visual-capture/`, and feeds those screenshots into the baseline/report flow. The current baseline tracks the reference-view screenshot composition through dimensions, luminance, color-family fractions, sampled color diversity, nonblack coverage, signature color deltas, compact-signature luma SSIM, full-resolution luma deltas, changed-pixel fraction, full-resolution luma SSIM, and block-SSIM tail statistics. This is intentionally a stronger local guardrail for blank, washed-out, structurally wrong, or locally drifted visual captures; deeper production graphics validation can still add richer perceptual/color metrics later.

The graphics-focused follow-on plan in `docs/plans/visual-quality-pipeline-plan.md` should preserve these renderer diagnostics, Export Diagnostic artifacts, Export Quality captures, and settings hooks. A small renderer-only visual slice has started early for reference-image alignment; the current pass uses `stormCanyon.engineSettings.v20`, a higher pulled-back default overlook camera, a ground-focus SDF stream anchor, peak-biased renderer-only snow caps, far-vista directional horizon AO/cavity shading, more open near-river vegetation, localized low-sun haze, opaque scenic river water, and lowered foreground review ponds. Those ponds and far-vista deformations are presentation scaffolds, not production terrain-integrated lake simulation. The larger graphics plan remains sequenced after the core engine roadmap, so current renderer changes should favor stable data contracts and profiling over large visual rewrites until the meshing, streaming, persistence, culling, and prototype-game foundations are complete.

Renderer-created GPU buffers are populated through bounded mapped upload-ring pages before the render pass. Chunk, far-terrain, water, vegetation, and marker payloads copy into staging pages, then a flush submits `copyBufferToBuffer` work into final vertex/index/storage buffers. Buffer destruction for ring-created destinations is routed back through the ring, which defers destruction until any pending copy has been submitted so edit rebuilds and chunk replacement cannot destroy a destination before queue submission. Pages are remapped asynchronously for reuse, and oversized or temporarily unavailable uploads fall back to the older mapped-at-creation path. The overlay reports staging page count, staging megabytes, pending bytes, last flushed bytes, and fallback counts so later visual and batching work can see upload pressure directly.

The browser build path is Vite-backed and keeps the same public asset contract for `public/voxel_core.wasm`. The Node static server now serves production `dist/` builds by default, with an explicit `SERVE_SOURCE=1` escape hatch for source-level debugging. Both Vite dev/preview and the static server expose `/__storm/automation-report` plus `/__storm/automation-report/latest` so browser-driven validation can write and retrieve structured reports without scraping the UI.

Both the Vite dev server and the production static server send COOP/COEP headers for cross-origin isolation. When SharedArrayBuffer is available, each worker receives a shared generate-job page that stores a bounded batch of procedural chunk descriptors, a larger shared `33³` `Int16Array` density page for cached-density remeshing, and a bounded result arena sized for the native chunk output limits. The streamer writes chunk coordinates, version, edit-version, priority, and optional result-slot ownership into the batched job page for procedural generation, and copies cached density samples into the remesh page before sending a tiny wake message for remesh jobs. Batched generate jobs use non-overlapping result-arena slots so a worker can post multiple chunk results before becoming idle without overwriting earlier shared views. Renderer uploads consume completed shared views immediately, and cache entries can pin borrowable shared result slots until eviction or invalidation calls the slot release callback. Oversized results, exhausted slots, stale messages, and failed cache insertions fall back to transferable buffers or owned cache copies. The overlay reports shared job/remesh/result page counts plus generated job/batch, remesh dispatch, max-batch, zero-copy renderer totals, cache-borrowed bytes, and copy fallback bytes so the transport and lifetime mode are visible during tuning.

The host modules have been moved to checked TypeScript entrypoints. `src/engine_contracts.ts` defines the shared contracts for chunk jobs, worker messages, engine settings, renderer settings, streamer stats, renderer stats, and profiling data. New systems should depend on those contracts instead of inventing ad hoc message shapes.

Near terrain chunks currently preserve a `32m` world footprint while using `32³` cells and a `33³` density grid. The host keeps a versioned carve/build/smooth/flatten/material-paint edit log with a redo stack and sends `syncEdits` messages so every worker replays the same active sphere, box, or capsule operations into its WASM instance before accepting jobs for that edit version. Carve/build/smooth/flatten edits modify density; material-paint edits skip density mutation and override vertex material IDs during polygonization. Brush radius, shape, capsule length, carve/build falloff, brush strength, camera-forward placement distance, and paint material are persisted settings; missing shape metadata from older saves is treated as a sphere and missing falloff is treated as hard-edged zero falloff for compatibility.

Evicted near-terrain meshes can be restored from an LRU compressed chunk cache without rerunning WASM. The cache stores the same packed chunk-local vertex payload that workers transfer to the renderer, along with bounds and origin/scale metadata. This is a bridge toward production compressed density/sample storage and GPU page arenas, not a replacement for them.

WASM also exports the sampled density grid as `33³` signed 16-bit SDF values. Workers copy that density payload into chunk results, and the host cache stores it alongside the render mesh so future work can remesh, persist, or edit chunks without immediately regenerating the full procedural field.

The native core separates density sampling from polygonization. `generate_chunk` samples the procedural SDF into the quantized density grid, applies density-changing edits in edit-log order, then meshes it; `mesh_cached_chunk` polygonizes the current density grid directly. Runtime carve/build/smooth/flatten rebuilds route through cached-density remeshing when the streamer has cached samples for a dirty chunk, then fall back to procedural generation when it does not. Cached-density edit application uses the same sphere, box, and capsule SDF helpers as full procedural regeneration. Carve/build falloff uses smooth SDF subtraction/union for generated chunks and cached-density remeshes while preserving the older hard min/max exports for compatibility. Smooth edits copy the current `33³` density grid to a scratch page, blend affected samples toward their 6-neighbor average with the persisted strength setting, and then remesh. Flatten edits blend affected samples toward the brush-center horizontal plane with the same strength control; capsule flattening currently provides the path/terrace-cut primitive. Material-paint edits use the same brush shapes for influence bounds, but workers do not apply them to the density grid; the replayed WASM edit log is consulted by vertex classification so cached-density remeshes can repaint surfaces without changing SDF samples.

`scripts/benchmark.mjs` exercises the same ABI across deterministic origin-canyon, river-bend, and mountain-stack scenes. It measures full generation, cached-density remeshing, sphere carve/build remeshing, box carve remeshing, capsule build remeshing, smooth remeshing, and flatten remeshing, and fails on empty benchmark meshes, topology mismatches, or WASM buffer overflows. The browser `Worker Bench` action runs the same scene family in a temporary module worker, stores recent captures in local storage, compares the latest capture against the previous one, and embeds the trend in Export Diagnostic and Export Quality artifacts. This gives Auto quality and later visual work browser-side worker-throughput evidence without interrupting the live streaming worker pool.

`scripts/mesh-regression.mjs` captures deterministic Marching Cubes outputs for procedural chunks, cached carve/build/falloff/smooth/flatten edit remeshes, and synthetic density fields. It records vertex/index counts, boundary and non-manifold edge counts, duplicate and degenerate triangle counts, density hashes, and packed vertex/index hashes in `docs/mesh-quality-baseline.json`. Normal `npm test` compares the current WASM output against that baseline; `npm run mesh:regression -- --update` is the explicit review point for intentional mesher changes. The current baseline has zero invalid, duplicate, non-manifold, or packed-degenerate triangles.

`scripts/lod-selection-regression.mjs` transpiles the pure `src/terrain_lod.ts` selector and captures deterministic target counts, LOD 0/1/2+ distribution, base-cell coverage, explicit transition-face schedule samples, transition face/cell counts, per-base-cell transition worklist samples, transition sample/case summaries, transition sample coordinate/value samples, table-driven transition-prism mesh summaries, transition mesh vertex/index/cell hashes, transition-edge counts, skirted coarse-chunk counts, first-request ordering, and representative seam-mask requests in `docs/lod-selection-baseline.json`. It is part of `npm test`, and `npm run lod:regression -- --update` is the explicit review point for intentional mixed-LOD selector, transition-schedule/worklist/case/mesh, or seam-mask changes. The transition mesh uses a deterministic tetrahedral case table over a transition prism as a closer native/runtime integration target; runtime can now render an aggregate transition mesh from cached near-chunk density samples, queue the same sampled cells through the native WASM transition-cell ABI on an idle worker, and swap in the returned native-packed aggregate mesh. The native WASM smoke test validates the matching packed transition-cell ABI on all four horizontal seam sides. Temporary seam skirts remain the crack-hiding fallback until full native Transvoxel transition chunks replace them.

`scripts/worldgen-tile-regression.mjs` transpiles `src/terrain_math.ts`, `src/worldgen_tiles.ts`, `src/erosion_tiles.ts`, and `src/cave_tiles.ts` in memory with the repo TypeScript dependency, loads the current `public/voxel_core.wasm`, verifies that the worldgen, erosion, and cave graph worker-native tile queues dispatch by priority and record reprioritization/adoption telemetry, verifies erosion persistence load/adopt/save/invalidation/prune telemetry through a fake provider, verifies the cave graph cache can probe and export a camera-centered neighborhood, then captures deterministic `3x3` tile neighborhoods for origin-canyon, river-bend, and alpine-ridge scenes from the TypeScript worldgen cache, native worldgen tile-buffer ABI, TypeScript erosion tile cache, native erosion tile-buffer ABI, TypeScript cave graph cache, and native cave graph tile-buffer ABI. It records tile field hashes, biome/water/river-network ID hashes, TypeScript/native erosion tile hashes and per-field summaries, worldgen per-field min/max/mean summaries, cave graph passage/chamber hashes, native cave graph passage/chamber hashes, and TypeScript/native cave graph parity counts in `docs/worldgen-tile-baseline.json`. Normal `npm test` compares the current worldgen, erosion, and cave graph tile output against that baseline; `npm run worldgen:regression -- --update` is the explicit review point for intentional worldgen, erosion tile, or cave graph tile changes.

The prototype region store uses IndexedDB to persist the active edit log, redo stack, capped edit-branch archive, edit version, next edit ID, next branch ID, cached chunk payloads, and game progress for survey beacons, edit contracts, route checkpoints, hazards, and traversal distance. The settings panel exposes four managed slots (`Region A` through `Region D`) backed by per-region chunk records, while still allowing the legacy default slot to load old saves. Slot display names can be renamed from the panel; names are persisted locally and mirrored into saved IndexedDB metadata when the slot has a saved record. The live region browser lists every managed slot, shows whether it is empty or saved, reports saved chunk/edit counts, compression footprint, and raw/LZSS/delta-varint payload counts, summarizes aggregate saved-slot storage, filters by text or saved-only state, refreshes metadata, exposes bundle import/export, can switch the active slot directly, and exposes row-level load/diff/export/inspect/compare/verify/clear actions for saved-slot maintenance. Its payload inspector scans IndexedDB chunk records without decoding full mesh arrays, then reports largest or filtered chunks plus per-payload raw/encoded byte counts and codecs for vertices, indices, density, and vegetation. After one slot is inspected, the Compare action scans a second saved slot the same way and reports common/missing chunks, encoded/raw byte deltas, codec changes, and largest changed persisted chunks without decoding full mesh arrays. The Verify action decodes the inspected slot's persisted vertex, index, density, and vegetation payloads, validates typed-array alignment, computes encoded and decoded payload hashes, and reports failed or largest decoded chunks. Browser-state controls persist locally, including filter state, saved-only mode, payload filter text, named retention policy selection, custom maximum saved-slot and encoded-megabyte limits, and dry-run cleanup summaries. A small local maintenance ledger records recent save/load/import/export/inspect/compare/verify/duplicate/prune/retention actions so cleanup choices are reviewable without changing the IndexedDB snapshot schema, and the browser can export a JSON maintenance report with current slot metadata, the active retention plan, the current full metadata-only payload inspection, payload comparison, payload hash audit, codec counts, and recent history. Applying a policy clears the oldest managed saved slots while preferring non-active slots when possible. A direct prune-oldest action remains available from both the browser and settings panel. Loading a saved region restores the cache, edit state including archived branches, and saved game progress, clears live GPU chunk state, then lets the streamer repopulate visible chunks from the restored cache and regenerate any uncached empty chunks. Active-vs-saved and active-vs-file diffs compare chunk fingerprints, edit IDs, edit signatures, and branch signatures; the exported diff object includes matching-vs-changed common edit counts plus bounded samples for active-only, saved-only, and changed same-ID operations and branch metadata. The same snapshot can be encoded into a portable `.scvr` region file: a compact binary envelope with a JSON metadata header followed by encoded vertex, index, density, and vegetation payloads. A multi-slot `.scvb` bundle wraps multiple `.scvr` payloads with slot keys, names, save times, chunk/edit counts, game progress, and per-entry compression metadata for export-all/import-all workflows. Direct imports still validate and restore a file immediately, while preview imports decode into a pending snapshot, show active-vs-file diff telemetry including branch counts and sampled operation differences, and require an explicit apply or merge action before mutating the active world or selected slot.

`RegionStore` save, load, inspect, payload-hash verification, and clear paths each run inside a single IndexedDB transaction that spans the meta and chunk stores (plus the legacy chunks store on the load path when the legacy slot is in scope). The save path deletes prior chunk records, writes new chunks, and writes the meta record atomically; the load/inspect/verify paths read the meta record and chunk records consistently, eliminating the prior torn-state window where a concurrent save could leave readers observing meta and chunks from different points in time. A shared `captureRequestFailure` helper attaches a request-level `onerror` to each `IDBRequest` so the originating DOMException (for example `QuotaExceededError`, `ConstraintError`, or `InvalidStateError`) is preserved through the transaction abort path and surfaced to callers, instead of being flattened into a generic "IndexedDB transaction failed" wrapper. Sync errors thrown inside the success callback are caught and routed through a `safeAbortTransaction` helper that tolerates already-finished transactions.

Chunk payloads are compressed at persistence boundaries rather than inside the live chunk cache. `src/chunk_codec.ts` delta-encodes the `33³` signed `i16` SDF samples and writes them as varints when that is smaller than the raw payload. The same module applies a small byte-LZSS codec to packed vertices, indices, and vegetation payloads when it beats raw bytes. IndexedDB region records and version 3 `.scvr` files store codec metadata per payload, while loaders still accept legacy raw records, version 1 raw `.scvr` files, and version 2 density-compressed `.scvr` files.

Region metadata stores raw and encoded byte counts for the current saved payloads. The overlay reports selected-slot chunk/edit counts, last save time, and compression ratio after save/load/export/import operations, while the region browser keeps the same metadata visible across all managed slots and summarizes aggregate encoded/raw storage. A `Diff Save` action loads the selected slot, fingerprints saved chunk payloads against the active cache, compares edit-log IDs and edit signatures, compares branch signatures, surfaces bounded operation/branch samples in the overlay and diagnostic export, then releases the decoded saved payloads back to the shared pool. The payload `Compare` action stays metadata-only by comparing two inspected saved-slot payload maps directly from IndexedDB records. The payload `Verify` action decodes the inspected persisted payloads without mutating live cache state and records encoded/decoded hashes for regression triage. Import previews use the active-vs-file diff shape for decoded file comparisons. Applying a preview replaces the active world and selected slot; merging a preview reuses imported chunk payloads when edit histories match, otherwise it merges imported edit operations and branch metadata and forces cache regeneration for consistency. Duplicate-slot, prune-oldest, dry-run retention, apply-retention, and import-all workflows all route through the same IndexedDB compression/clear paths, then release temporary decoded arrays to the shared pool when they decode snapshots.

Decoded region payloads and evicted cache entries share a typed-array pool in `src/typed_array_pool.ts`. Cache clear/eviction returns vertex, index, density, and vegetation arrays to the pool, and later IndexedDB or `.scvr` decodes acquire matching arrays when possible. Worker-local temporary staging lives in `src/worker_scratch.ts`; vegetation staging reuses an arena, cached-density remesh inputs can travel through per-worker shared pages, and chunk outputs can travel through per-worker shared result arenas with a main-thread copy-out before renderer/cache ownership. The worker reports arena reuse plus remaining fallback transfer allocation totals. The overlay reports pool arrays, retained megabytes, shared job/remesh/result pages, worker scratch arenas, and reuse/allocation counts so load/import and worker churn are visible during profiling.

The current mesher uses a Marching Cubes cube-edge polygonizer. It finds crossings only on the standard 12 cube edges, stores those crossings in the chunk-local `x`, `y`, and `z` edge caches, links face contours across each active cube, uses a center-value decider for ambiguous four-crossing faces, and triangulates closed contour loops. Before polygonization, the native core builds a normalized gradient cache from the same `33³` quantized density grid; edge vertices interpolate those endpoint gradients for normals, material classification, wetness/snow masks, and AO instead of resampling the full SDF six times per vertex. If a cell produces malformed/open contour walks, it falls back to the older sorted edge fan instead of silently dropping the surface. Triangle emission filters any face that collapses after chunk-local 16-bit position packing, so the regression baseline stays free of packed degenerate triangles. The WASM `lod` parameter now configures native cell size and packed chunk scale, with base-grid chunk coordinates kept stable for mixed-LOD rings; worker stats carry `lod`, `cellSize`, `chunkWorldSize`, and a coarse-edge `lodSeamMask`; cache/editor sphere tests respect stored chunk frames; and the overlay reports loaded LOD buckets plus transition faces/cells, transition-edge/skirt-triangle counts, and runtime transition-mesh emitted/missing cell counts. `src/terrain_lod.ts` owns the deterministic request planner, LOD-ring thresholds, aligned coarse block selection, explicit transition-face schedule, per-base-cell transition worklist, deterministic transition sample/case metadata, a deterministic table-driven transition-prism mesh, base-cell coverage, coarse-to-fine seam masks, and plan summaries, so target distribution, transition scheduling/worklist generation, transition case generation, transition mesh generation, and seam classification can be regression-tested independently from streaming and rendering. The settings panel has an experimental LOD rings toggle that keeps the inner radius at LOD 0 while replacing fully outer near-terrain chunks with aligned LOD 1 and, at larger radii, LOD 2 chunks. Coarse blocks are downgraded when they would cross into a finer inner ring, and the streamer classifies coarse-to-fine x/z borders. Runtime now samples cached density payloads on both sides of those borders, builds a single aggregate packed transition mesh, submits it through the normal terrain renderer, and queues an idle worker to regenerate the sampled cells with the native 12-sample transition-prism ABI before swapping in the native-packed aggregate mesh. Conservative vertical skirts on coarse chunk edges remain a temporary crack-hiding fallback. This removes tetra diagonal topology and cuts the origin smoke-test mesh from the previous marching-tetra count to roughly `4.0k` triangles. A full production mesher should still promote the native transition-cell ABI and runtime aggregate bridge into full native Transvoxel transition chunks and remove the skirted contract.

The logical terrain vertex payload is:

```text
position.xyz            f32 x 3
normal.xyz + AO         unorm8 x 4
material ID             u8
biome/wetness/snow      u8 x 3, enriched with macro climate/drainage/erosion/vegetation signals
```

This is the packed vertex format written by WASM, transferred by workers, cached by the streamer, and uploaded to WebGPU:

```text
local position             unorm16x4
normal.xyz + AO            unorm8x4
material ID + masks        uint8x4
origin.xyz + scale         f32x4 instance attribute
```

The four material bytes are `material ID`, `biome`, `wetness`, and `snow`; slope is still derived from the packed normal. Near terrain writes these bytes in WASM and far terrain mirrors the same enriched masks in TypeScript before packing. The WASM ABI also exposes `get_macro_continent`, `get_moisture_mask`, `get_temperature_mask`, and `get_cave_distance` probes so tooling can validate deterministic worldgen fields directly. The biome byte now blends highland, macro climate, erosion, and vegetation suitability; wetness includes macro moisture plus drainage accumulation; snow accounts for macro temperature, wind, and erosion exposure. Runtime material painting intentionally targets only the first material-ID byte for near-terrain chunks, leaving the three procedural mask bytes as stable visual hooks for the later graphics pass. This gives the later visual-quality pass stable engine-facing hooks without expanding the vertex stride.

The current cave system is still procedural SDF geometry, with an initial metadata graph layered over it. It keeps the original canyon-following trunk and unions deterministic side passages every 128m, branch-end chambers, and gated vertical shafts using smooth SDF blends. The TypeScript mirror exposes the same signed distance for live worldgen probes, while the native export lets smoke and mesh-regression checks detect intentional cave-field changes. `src/cave_tiles.ts` mirrors the deterministic trunk/branch/chamber/shaft formulas into `256m` cave graph tiles with stable passage and chamber IDs, passage kinds, approximate nearest-feature distances, biome hooks, cache stats, worker-native queue/adoption telemetry, and nested Export Worldgen payloads. `src/cave_tile_store.ts` persists those graph tiles in a bounded IndexedDB store with schema/generator validation and oldest-record pruning. The native core now also exposes `generate_cave_graph_tile` plus fixed-field passage/chamber buffers, schema/generator getters, and tile-size/count metadata so Node smoke, worldgen regression, and idle browser workers can compare or adopt native graph counts against TypeScript fallback graph counts. Production work still needs stronger streaming ownership, invalidation, and richer gameplay/material hooks before the visual-quality pass depends on it for cave-specific shading.

`src/worldgen_tiles.ts` is the first browser-side shape of cached worldgen tiles. It derives bounded `256m` tiles from the same TypeScript worldgen functions used by far terrain, stores `17x17` samples for elevation, macro climate, drainage, erosion, vegetation suitability, local gradient-flow direction, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, biome/wetness/snow masks, normal-y, river center, material ID, normalized grass/rock/snow/mud material weights, terrain-surface cave distance/influence, dominant biome ID, normalized biome-blend weights, river-network ID, and river/lake classification, and exposes LRU-style cache stats in overlay/export data. The native core exposes a single-tile WASM buffer with the same 32 scalar field slots plus biome, water, and river-network ID arrays; this is smoke-tested as the ABI foundation for production tile baking, material-field promotion, drainage-network diagnostics, and cave-proximity diagnostics. At runtime, the frame loop asks `WorldgenTileCache` to prewarm the camera-centered `3x3` tile neighborhood when the camera enters a new worldgen tile. `WorldgenTileCache` keeps TypeScript fallback tiles available immediately, asks `src/worldgen_tile_store.ts` to asynchronously load previously adopted native tiles from a dedicated IndexedDB store, queues native `generateWorldgenTile` replacement work by explicit priority, reprioritizes queued work for live samples and export captures, drops stale low-priority prewarm requests outside the current camera tile neighborhood, lets the streamer pump that queue only when terrain workers are idle, adopts returned native field/ID arrays into the live cache, and persists adopted native tiles back to IndexedDB. Compatible persisted tiles are treated as already-native data and remove redundant queued replacement work before dispatch. The worldgen tile store invalidates incompatible records through schema version, generator version, tile-size, resolution, and field-count checks, and prunes oldest records beyond its retention cap through the saved-at index. In parallel, `ErosionTileCache` prewarms the same camera-centered `3x3` neighborhood, derives deterministic thermal/hydraulic erosion, deposition, sediment, bedrock, soil, and vegetation-retention fields from terrain, drainage, wetness, slope, and local relief, asks `src/erosion_tile_store.ts` for schema/generator-compatible persisted native erosion tiles, queues prioritized native erosion tile replacements for idle terrain workers when needed, adopts returned native field buffers into the live cache, persists adopted native erosion tiles back to bounded IndexedDB storage, invalidates incompatible records, prunes oldest retained records, reports cache/queue/adoption/persistence stats in the overlay, feeds live probes, exports nested erosion tiles, and is covered by the worldgen regression baseline for TypeScript, native, and persistence behavior. `MaterialTileCache` composes worldgen, erosion, and cave graph probes into immediate TypeScript material-field tiles for normalized material weights plus wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, and blend-confidence channels; it prewarms with the camera neighborhood, queues prioritized native material-field tile replacements for idle terrain workers, adopts returned native field/ID buffers, persists adopted native material tiles through `src/material_tile_store.ts`, feeds live probes and brush telemetry, exports nested material-field tiles, and is covered by the same regression baseline for TypeScript, native, worker adoption, and persistence behavior. `CaveGraphTileCache` also prewarms the same neighborhood, generates deterministic graph metadata immediately, saves graph tiles through `src/cave_tile_store.ts`, adopts schema/generator-compatible persisted records when available, queues prioritized native cave graph replacements for idle terrain workers, adopts returned passage/chamber buffers into the live cache, persists adopted graph tiles, and exports nested cave graph tiles with passage/chamber metadata alongside worldgen tile captures. The overlay and worldgen export data report prefetch centers/touched tiles, worker requests/responses/pending/queued/rejected/adopted/native bytes, queue best priority, queue drops, queue reprioritizations, persisted tile count, load/hit/miss/pending/save/failure/invalidated/pruned counts, retained record counts, loaded persisted bytes, erosion tile cache/native/persistence stats, material-field cache/native/persistence stats, and cave graph cache/persistence stats. The settings panel can export the current camera-centered `3x3` tile neighborhood as JSON with export schema, tile schema/generator versions, field arrays, IDs, nested erosion tiles, nested material-field tiles, nested cave graph tiles, tile stats, settings, and live probes for worldgen regression triage. This is still diagnostic and preview infrastructure; production worldgen tiles still need hydraulic drainage simulation, production hydraulic/thermal erosion, production material-field ownership, richer biome/river/cave IDs, broader region/world invalidation ownership, production cave graph ownership, and integration with final region/world save semantics.

Cache entries already use the packed layout and carry quantized density samples. Persistence now compresses this payload at save/export time, saved-slot diffing can compare active cache state against persisted records, saved-vs-saved payload comparison can compare persisted storage footprints without decoding full mesh arrays, and payload verification can decode/hash persisted records for targeted regression triage. The remaining production step is stronger runtime/page compression, larger multi-region management workflows, cache-ownership hardening, and richer material weights around this render vertex payload:

```text
position       u16x3 chunk-local
normal         packed octahedral
material IDs   u8/u16 palette indices
weights/AO     u8 normalized
```

## Production target

The production version should evolve toward:

- Rust/WASM core.
- Compressed mesh cache, portable region files, then broader compressed `32³` cell / `33³` sample chunk storage.
- Quantized `int16` SDF storage.
- Production mixed-LOD transition chunks and Transvoxel LOD seams. The deterministic selector, LOD 1/2 outer rings, explicit transition-face schedule, per-base-cell transition worklist, transition sample/case metadata, table-driven transition-prism mesh generator, native transition-cell ABI, idle-worker native aggregate transition mesh, TypeScript fallback mesh, plan telemetry, regression baseline, and coarse-edge seam skirts are available, but full native Transvoxel transition chunks are still pending.
- Meshlet/cluster partitioning.
- CPU-frustum range batching plus conservative previous-frame Hi-Z terrain range-batch occlusion. Multi-draw indirect submission via the Chromium `chromium-experimental-multi-draw-indirect` feature is now used when the adapter exposes it; the per-slot replay loop remains as a fallback. Fully GPU-owned draw compaction, standards-track multi-draw submission, and larger GPU arenas are still pending.
- Indirect draw buffers.
- Far heightfield clipmaps. The prototype now includes concentric camera-centered far heightfield clipmap rings as the first step; volumetric terrain LOD transitions remain future work.
- More advanced material and biome systems built from the current macro continent/moisture/temperature probes, runtime worldgen tile cache, drainage, erosion, vegetation-suitability fields, and cave-distance/cave-graph hooks.
- A post-core visual-quality pipeline pass for procedural sky, atmosphere, lighting, water, vegetation, and optional shadows as described in `docs/plans/visual-quality-pipeline-plan.md`.
- SharedArrayBuffer worker queues when cross-origin isolation is available. The prototype now batches procedural generate jobs per worker, writes normal generated results into reusable shared result slots, and lets cache entries borrow those slots with explicit eviction release callbacks.
