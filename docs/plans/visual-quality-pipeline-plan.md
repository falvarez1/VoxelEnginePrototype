# Visual Quality Pipeline Implementation Plan

Date: 2026-05-24

## Goal

Improve the Storm Canyon voxel prototype from the current functional low-poly renderer into a cinematic low-poly alpine renderer matching the supplied references: richer terrain material breakup, warmer directional lighting, deeper foreground contrast, atmospheric distance haze, better water, denser natural scene dressing, and a sky that contributes to the mood instead of a flat clear color.

## Relationship To The Core Roadmap

This is the follow-on graphics track for after the core engine roadmap in `docs/ROADMAP.md` is complete. It should start from the production-facing engine foundations established by that roadmap: stable meshing, streaming, persistence, debug tooling, performance instrumentation, GPU culling/indirect groundwork, and the prototype game loop.

This plan must stay aligned with the current architecture docs:

- It should not replace Transvoxel, GPU culling, Rust/WASM core, or editor/game hardening work in the core roadmap.
- It should preserve the settings panel, brush material swatches, built-in preset palette, locally persisted named brush presets, live brush inspector for falloff/influence coverage plus material/biome/mask weights, Region Diff panel, branch-aware edit-history panel and persisted branch archive, signature-aware active-vs-saved edit/branch diff telemetry, adaptive quality presets with frame-time feedback, Export Quality captures, portable browser worker benchmark captures/trends and `benchmark:review` artifact gates, Export Worldgen tile captures, carve/build/smooth/flatten/material-paint modes, sphere/box/capsule/radius/distance/falloff/strength brush controls, runtime debug views including combined Material Masks plus individual Biome/Wetness/Snow mask views, deterministic macro continent/moisture/temperature, cave-distance, and cave-graph probes, runtime worldgen tile-cache telemetry including prioritized queued worker/native tile adoption, stale queue drops, reprioritization counters, and IndexedDB persistence, invalidation, and prune counters, worker-adopted native erosion tile telemetry/probes/exports for thermal erosion, hydraulic erosion, deposition, sediment, bedrock, soil, vegetation retention, and IndexedDB persistence, invalidation, and prune counters, worker-adopted native material-field cache probes/exports for wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, blend-confidence, normalized material weights, dominant material IDs, and IndexedDB persistence, invalidation, and prune counters, cave graph tile telemetry for passage/chamber/shaft counts, nearest-feature IDs, worker-backed native tile adoption, queue reprioritization, IndexedDB persistence, invalidation, and prune counters, named density capture/diff-heatmap tooling, scripted density-capture, LOD-selection, worldgen-tile, erosion-tile, material-field, cave-graph, and mesh-quality regression checks, screenshot-linked diagnostic export, region browser filtering, aggregate storage summary, named/custom retention policies with dry-run cleanup reports, local maintenance history, codec payload counts, searchable metadata-only payload inspection, saved-vs-saved payload comparison, decode/hash payload verification, JSON maintenance-report export with inspected/comparison/audit payload metadata, row-level load/diff/export/inspect/compare/verify/clear actions, save/diff/import-preview/`.scvb` bundle telemetry, worker memory/shared batched-generate/remesh/result page telemetry, renderer upload-ring telemetry, near-terrain cluster culling/submission telemetry, Hi-Z depth-pyramid and occlusion telemetry, benchmark harness, and browser verification gates.
- Any implementation deviations should be reflected back into `README.md`, `docs/ARCHITECTURE.md`, `docs/PERFORMANCE.md`, `docs/ROADMAP.md`, and this plan before the graphics track is considered complete.

This plan keeps the current architecture intact:

- Browser-first WebGPU renderer in `src/renderer.ts`.
- Procedural WGSL material and lighting.
- WASM-generated near terrain chunks.
- TypeScript-generated far heightfield clipmap-ring vista.
- Shared macro continent, moisture, temperature, and signed cave-distance fields mirrored between `native/voxel_core.c` and `src/terrain_math.ts`.
- Runtime `256m` worldgen tiles in `src/worldgen_tiles.ts` and a matching native WASM tile-buffer ABI carrying elevation, macro climate, drainage, erosion, vegetation, local gradient flow, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, normalized biome-blend weights, material IDs, normalized grass/rock/snow/mud material weights, terrain-surface cave distance/influence, biome IDs, river-network IDs, and water classification as diagnostic scaffolding for production worldgen tiles. The runtime path currently prewarms the camera-centered `3x3` tile neighborhood, returns TypeScript fallback tiles immediately, loads schema/generator-compatible adopted native tiles from `src/worldgen_tile_store.ts`, queues prioritized native tile replacements for idle terrain workers, reprioritizes live samples and Export Worldgen captures, drops stale low-priority prewarm work, adopts returned native arrays into the live cache, persists adopted native tiles to bounded IndexedDB storage, invalidates incompatible records, prunes oldest retained records, and surfaces prefetch/worker/native/queue/persistence counters through overlay/export telemetry. `src/erosion_tiles.ts` adds an initial deterministic `256m` erosion tile cache for the same neighborhood, with height, slope, drainage, stream power, thermal erosion, hydraulic erosion, deposition, sediment load, bedrock exposure, soil depth, and vegetation retention fields surfaced through probes, overlay telemetry, Export Worldgen JSON, and the worldgen regression baseline. The native WASM core exposes matching erosion tile field buffers, idle terrain workers can adopt native erosion tiles into the live cache, and `src/erosion_tile_store.ts` persists adopted native erosion tiles with schema/generator validation, invalidation, bounded retention, and prune telemetry; production hydraulic/thermal erosion simulation still belongs to the core roadmap. `src/material_tiles.ts` adds an initial material-field cache that composes worldgen, erosion, and cave graph probes into normalized material weights plus wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, and blend-confidence fields for probes, overlay telemetry, brush inspection, nested Export Worldgen JSON, and regression summaries. The native WASM core now exposes matching material tile field and dominant-ID buffers, idle terrain workers can adopt native material tiles into the live cache, and `src/material_tile_store.ts` persists adopted native material tiles with schema/generator validation, invalidation, bounded retention, and prune telemetry; production material ownership and shader-grade blending still belong to the core roadmap. `src/cave_tiles.ts` mirrors the deterministic cave formulas into `256m` cave graph tiles with stable passage/chamber IDs, passage kinds, branch-end chamber metadata, optional shafts, biome hooks, nearest-feature probes, and nested Export Worldgen payloads; browser runtime persists those graph tiles through `src/cave_tile_store.ts` with schema/generator validation and bounded retention. The native WASM core exposes matching fixed-field cave graph passage/chamber buffers for regression parity and worker-backed adoption through the idle terrain worker pool. Export Worldgen JSON snapshots include export schema plus tile schema/generator versions for camera-centered tile neighborhoods, nested erosion tiles, nested material-field tiles, and nested cave graph tiles, and `npm run worldgen:regression` baseline checks cover TypeScript worldgen, native worldgen, TypeScript erosion, native erosion, TypeScript material fields, native material fields, TypeScript cave graph, and native cave graph outputs plus worldgen/erosion/material/cave graph queue-priority behavior and erosion/material persistence telemetry.
- Experimental nested LOD-scale-aware near-terrain rings, a deterministic `src/terrain_lod.ts` selector with selector/seam/transition-schedule/cell-worklist/sample-case/table-mesh regression coverage, native chunk sampling/packing metadata, an explicit transition-face schedule with per-base-cell transition worklists, deterministic transition sample/case metadata, a native 12-sample transition-cell ABI, idle-worker native aggregate transition meshing, a TypeScript runtime fallback table-driven transition-prism mesh built from cached density samples, and temporary coarse-edge seam skirts as fallback groundwork for real Transvoxel transition mesh generation; full native Transvoxel transition mesh chunks remain in the core roadmap.
- Worker-generated vegetation patches rendered through the current CPU patch-culling, instance distance-LOD filtering, and single visible-instance batch draw path.
- Current Hi-Z depth-pyramid generation and conservative terrain range-batch occlusion as an engine culling/debug foundation, not a replacement for the later visual shadow work.
- Existing debug views and settings panel.
- Existing SDF edit operation contracts, including non-spherical brush metadata, carve/build falloff, smooth and flatten strength, material-paint IDs, brush/falloff presets, procedural paint-material picking, plus the persisted brush placement-distance setting used by preview, the live brush inspector, and diagnostics.

The plan deliberately avoids a Three.js rewrite, texture-heavy art pipeline, or large new dependency. The first implementation should be shader and data-pipeline driven.

## Reference Images

- `docs/plans/reference1.png`
- `docs/plans/reference2.png`
- `docs/plans/reference3.png`
- Latest supplied conversation reference: cinematic low-poly alpine valley with golden low sun, compact debug overlay, collapsed settings button, dense conifers, winding reflective water, blue-grey atmosphere, distant snow ridges, and no editor gizmo dominating the view.

## Current Implementation Status

Status as of 2026-05-25:

- Phase 1 is partially implemented: `EngineSettings`/`RendererSettings` now include `exposure`, `atmosphereStrength`, `skyEnabled`, and `cinematicLighting`; sanitization migrates old saved settings; quality presets set the new visual controls; the settings panel exposes compact visual controls plus opt-in game markers; and the engine-settings storage key is now `stormCanyon.engineSettings.v20` so the current higher pulled-back wide-overlook reference defaults are applied instead of stale saved visual defaults.
- Phase 2 is partially implemented: `src/renderer.ts` has a fullscreen procedural sky pipeline rendered before terrain with a shared `Scene.visual` uniform.
- Phase 3 is partially implemented: terrain, water, and vegetation shaders now use first-pass cinematic tone, warm/cool lighting, and atmosphere helpers while debug views remain diagnostic.
- Phase 4 is partially implemented for water only: the water ribbon now blends from the physical SDF river near the camera into the renderer-only scenic far-vista river sooner, uses smoother multi-column tessellation, has tuned color/glints/fresnel, and now renders as an opaque depth-writing pass to avoid far-vista bleed-through. The latest pass smooths the SDF/scenic river height blend, lowers foreground review ponds so they read without forming water walls, and keeps those ponds presentation-only; true terrain-integrated lake basins, depth-aware water, real reflections, shoreline foam driven by terrain depth, and production river/lake simulation remain pending.
- Phase 5 and Phase 6 are partially implemented: near vegetation is smaller/less carpet-like, a deterministic renderer-side far-forest layer fills scenic slopes, the far-forest layer backs away when near SDF rendering is enabled, vegetation shading has more color/light variation, terrain shading includes a procedural low-sun forest-shadow approximation, the existing vegetation batch now carries pine/shrub/rock scene-dressing variants, and the default first view uses a higher pulled-back wide SDF-near valley-overlook camera plus renderer-only far-vista valley softening, serrated far ridges, peak-biased renderer-only alpine snow thresholds, far-vista CPU-baked directional horizon AO/cavity shading, smoothed river/review pond presentation, more open near-river conifer spacing with high LOD reach, and denser `12/24/48m` far-vista rings out to about `5.8km`. The latest pass adds a bounded ground-focus SDF stream anchor so high-overlook captures no longer lose all near SDF terrain, then retunes snow/grass/water color preservation for the golden reference. It remains renderer/default focused without changing the mirrored physical terrain-height function.
- Phase 7 is partially implemented: low-poly shrub and rock scenery now reuse the vegetation patch, culling, instance-distance-LOD, and single visible-batch draw path. The shader selects pine/shrub/rock mesh parts per instance kind without changing worker message contracts. Dedicated grass-tuft, deadwood, impostor, and split scenery-material pipelines remain pending.
- Core worldgen now exposes an initial worker-adopted native material-field tile cache that composes TypeScript fallback fields from worldgen, erosion, and cave graph probes and can replace those fallback tiles with native WASM material buffers for normalized material weights plus wetness, roughness, fertility, stability, shoreline, cave-surface, route-cost, blend-confidence, and dominant material IDs. It is available to live probes, brush-inspector telemetry, overlay stats, Export Worldgen JSON, IndexedDB persistence telemetry, and deterministic worldgen regression baselines. Shader-grade production material blending remains pending core/graphics work.
- UI composition was adjusted for visual review: settings start collapsed, the overlay is compact, the center crosshair is hidden, the idle region browser stays hidden, near SDF rendering is enabled by default for the reference view, brush preview is opt-in, and prototype expedition markers for surveys, route checkpoints, hazards, and field contracts are opt-in through the settings panel.
- Phase 9 now has metric, compact perceptual-signature, full-resolution perceptual, capture, and review-artifact guardrails: `scripts/visual-regression.mjs` compares captured PNG screenshot metrics, downsampled RGB signatures, and compressed full-resolution luma fields against `docs/visual-quality-baseline.json`; compare mode can write JSON/HTML reports plus signature preview/diff PNGs and full-resolution luma diff heatmaps. `scripts/visual-capture.mjs` drives Playwright screenshots for `1920x1080`, `1680x945`, and `390x844` baselines.
- Browser validation now has a query-string automation surface for visual work: URL settings/camera overrides, action-driven state/diagnostic/quality/worldgen reports, console/window/backend report targets, backend report files under `output/automation/`, and panel visibility toggles for clean capture composition.
- The full visual plan is not complete. The latest reference-gap pass is closer to the supplied alpine reference and specifically addresses the high-camera streaming failure that produced `SDF tris: 0k` captures by keeping a bounded SDF set around the ground look target. It also keeps default near SDF terrain enabled, retunes the higher pulled-back wide valley-overlook camera, denser far vista, hybrid physical/scenic river water, lowered foreground review ponds, peak-biased renderer-only alpine snow thresholds, far-vista directional horizon AO/cavity shading, localized sky haze/cloud hooks, procedural low-sun shadow streaks, stronger low-sun contrast, more open near-river vegetation, lightweight rock/shrub scene dressing, opt-in game markers, stronger water visibility, and refreshed visual baselines. It still looks materially below the reference because it lacks real shadow maps/AO, richer material art direction, cave-surface shading, water depth/foam, terrain-integrated lake basins, broader scenery assets/impostors, and production-quality screenshots.

Implementation alignment note: this first visual slice was started early in response to the latest reference-image feedback. The newest pass is renderer/default focused and should not be treated as completion of the follow-on graphics track or as a replacement for the remaining core roadmap in `docs/ROADMAP.md`.

## Target Visual Direction

The target is "cinematic low-poly alpine":

- Low-poly silhouettes and faceted terrain remain visible.
- Sunlight is directional, warm, and readable across the landscape.
- Shadows and ambient terms create strong landform depth without requiring shadow maps in the first pass.
- Distance fades through blue-grey atmospheric haze.
- Snow has wind-drift variation, icy shadow tones, and exposed rock patches.
- Rock has strata, cracks, lichen, and slope-aware color shifts.
- Grass has macro patches, darker hollows, and dry/wet transitions.
- Water reads as reflective alpine river/lake water with fresnel, subtle waves, glints, depth color, and edge foam.
- Forests look less evenly stamped and gain scale/color variation.
- The sky includes gradient, horizon haze, cloud suggestion, sun disk, and sun bloom.

## Non-Goals For The First Implementation

- Full physically based rendering.
- Texture streaming.
- Cascaded shadow maps.
- Screen-space ambient occlusion.
- Volumetric clouds.
- GPU culling or indirect draw refactors.
- Replacing or retopologizing the core Marching Cubes face-contour terrain generation path.
- Asset authoring for unique tree/rock meshes.

Those can follow after the shader-only and procedural-data improvements are verified.

## Current Renderer Baseline

The renderer currently has:

- Terrain pipeline using packed chunk-local positions, packed normals, AO, material ID, and enriched biome/wetness/snow mask bytes.
- Water pipeline using a generated river ribbon.
- Vegetation pipeline using a small instanced tree mesh.
- Beacon marker pipeline.
- One render pass with a fullscreen procedural sky pass before terrain.
- Shared `Scene` uniform:
  - `viewProj`
  - `camera`
  - `sun`
  - `params`
  - `visual`
- Debug views selected through `scene.sun.w`, including the packed material-mask view.
- Individual biome, wetness, and snow mask debug views expose the packed channels separately for diagnosing near/far material-field mismatches before shader polish.
- `scene.params` currently used for time, fog density, material detail, and water opacity.
- Near terrain writes the material-mask lane in WASM, and the far heightfield mirrors it in TypeScript before packing. The current three-byte lane already folds in macro climate, heuristic drainage accumulation, erosion exposure, and vegetation suitability, and should be treated as the baseline data hook for this graphics pass.
- The live overlay, Export Diagnostic, and Export Quality artifacts include camera and brush-target worldgen probes for macro climate, drainage, erosion, vegetation, biome, wetness, snow, direct cave distance, cached cave proximity, material classification, biome/water IDs, local gradient flow, multi-scale flow accumulation, drainage basin ID, stream order, channel width, stream power, biome-blend weights, material weights, river-network IDs, tile-cache stats, worker/native tile adoption stats, worldgen tile persistence stats, worker-adopted erosion tile thermal/hydraulic/deposition/sediment/bedrock/soil/retention stats, erosion tile persistence stats, material-field wetness/roughness/fertility/stability/shoreline/cave-surface/route-cost/blend-confidence stats, and cave graph nearest passage/chamber IDs, distances, biome hooks, cache stats, and persistence stats.
- Near-terrain material painting is now an edit-log material-ID override. The graphics pass should preserve painted material ID semantics and keep the Material IDs debug view useful while improving shader appearance.
- Carve/build falloff plus smooth and flatten density edits are part of the core edit-log contract. The graphics pass should not reinterpret soft sculpting, smoothing, or flatten/path cuts as visual post effects or bypass their mesh/density regression coverage.
- The current cave system is engine SDF geometry: a trunk, deterministic side branches, branch-end chambers, and optional shafts, with an initial IndexedDB-backed cave graph tile metadata layer for stable passage/chamber IDs and biome hooks. Cave surfaces should be shaded from generated mesh/material data and cave-distance/worldgen/cave-graph diagnostics, not faked as decals or disconnected shader-only voids.
- Export Diagnostic can capture the current canvas PNG plus runtime metadata and worldgen probes into one JSON artifact, and Export Quality can capture the current preset tier, frame-time samples, renderer/streamer pressure, worldgen probes, capability state, browser worker benchmark trends, and recent auto-quality adjustments. Use these as baseline visual-debug artifacts until a dedicated screenshot comparison harness exists.

The visual upgrade should build on those constraints instead of changing the renderer ownership model.

## Implementation Strategy

Use four layers of improvement:

1. **Atmosphere and sky pass**
   Add a procedural fullscreen sky before terrain.

2. **Lighting and tone pipeline**
   Centralize cinematic light/fog/tone helpers across terrain, water, and vegetation shaders.

3. **Material and water detail**
   Improve procedural material models and water response using existing mesh attributes.

4. **Scene dressing**
   Improve vegetation distribution, color variation, and small ground detail using instancing and shader noise.

Each layer should remain independently shippable and testable.

## Phase 1 - Renderer Uniforms And Pipeline Foundation

### Objectives

- Prepare renderer settings for richer visuals without bloating the current uniform buffer.
- Add predictable tuning values for atmosphere and post-lighting behavior.
- Keep debug views and existing controls stable.

### File Changes

- `src/engine_contracts.ts`
  - Extend `EngineSettings` and `RendererSettings` only for values that need user control.
  - Candidate fields:
    - `exposure`
    - `atmosphereStrength`
    - `skyEnabled`
    - `cinematicLighting`
  - Avoid adding controls for every shader constant. Most visual constants should remain curated defaults.

- `src/main.ts`
  - Add sanitized defaults for new visual settings.
  - Tune defaults toward the reference look:
    - `fogDensity`: around `1.15` to `1.35`
    - `materialDetail`: around `1.25` to `1.55`
    - `waterOpacity`: around `0.72` to `0.85`
    - `sunAzimuth`: warm side/back light, likely `235` to `285` for golden scenes or `35` to `65` for clear alpine scenes
    - `sunElevation`: `22` to `38` for cinematic shadows; keep setting range available

- `src/settings_panel.ts`
  - Add only high-value controls:
    - Sky toggle
    - Exposure
    - Atmosphere
  - Keep the panel compact.
  - Preserve the existing quality preset selector; future visual settings should either respect the presets or explicitly document why they are independent.

- `src/renderer.ts`
  - Expand the uniform data carefully. Current uniform size is `16 * 4 + 4 * 4 * 3`, enough for `viewProj` plus three vec4s. If adding one more vec4, update buffer size and all WGSL `Scene` structs consistently.
  - Recommended layout:

```wgsl
struct Scene {
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  sun: vec4<f32>,      // xyz direction, w debug view
  params: vec4<f32>,   // time, fog density, material detail, water opacity
  visual: vec4<f32>,   // exposure, atmosphere strength, sky enabled, cinematic enabled
};
```

### Acceptance Criteria

- App still starts with old saved settings.
- Existing settings sanitize correctly when local storage lacks new fields.
- Existing terrain debug views still work.
- TypeScript compile passes.

## Phase 2 - Procedural Sky And Atmosphere Pass

### Objectives

- Replace the flat clear color with a real sky contribution.
- Match the references' visible sun/haze mood without adding textures.
- Render sky before terrain with depth disabled.

### File Changes

- `src/renderer.ts`
  - Add `SKY_SHADER`.
  - Add `skyPipeline`.
  - Add a small fullscreen triangle vertex shader.
  - Render sky at the start of the main render pass.
  - Change color clear to black or a neutral fallback because sky owns background color.

### Shader Design

`SKY_SHADER` should:

- Generate a fullscreen triangle from `@builtin(vertex_index)`.
- Reconstruct a view ray approximation from normalized screen coordinates.
- Use camera and sun direction to produce:
  - Zenith blue.
  - Horizon desaturation.
  - Warm sun-side scattering.
  - Sun disk.
  - Soft sun bloom.
  - Procedural high-altitude cloud wisps.
- Apply the same tone mapping and gamma helpers planned for terrain.

Recommended functions:

```wgsl
fn saturate(x: f32) -> f32
fn tonemap_reinhard(color: vec3<f32>, exposure: f32) -> vec3<f32>
fn gamma_out(color: vec3<f32>) -> vec3<f32>
fn sky_color(ray: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32>
```

### Rendering Order

Use this order:

1. Sky fullscreen pass.
2. Far terrain.
3. Near terrain chunks.
4. Beacon markers.
5. Vegetation.
6. Water.

Water currently renders opaque/depth-writing after terrain and vegetation so the reference view avoids far-vista bleed-through. If later water work reintroduces translucency, the pass order and depth-write policy need to be revisited with screenshots.

### Acceptance Criteria

- Horizon no longer shows a flat single-color clear.
- Sun position tracks `sunAzimuth` and `sunElevation`.
- Sky toggle can fall back to current clear color if added.
- No depth conflicts because sky writes no depth.

## Phase 3 - Shared Lighting, Fog, Tone Mapping

### Objectives

- Make terrain, water, vegetation, and sky feel like one scene.
- Improve contrast without blowing out snow and water.
- Add atmospheric depth similar to the references.

### File Changes

- `src/renderer.ts`
  - Update `TERRAIN_SHADER`, `WATER_SHADER`, and `VEGETATION_SHADER`.

### Lighting Model

Use a curated non-PBR model:

- Warm directional sun:
  - `sunColor = vec3(1.0, 0.78, 0.48)` at low sun.
  - Shift toward neutral white as sun elevation rises.
- Cool sky ambient:
  - More blue in shadows.
  - Stronger on upward-facing normals.
- Ground bounce:
  - Low-intensity warm/green term on upward terrain and tree undersides.
- Slope self-shadow:
  - Use normal, AO, and noise-based cavity approximation.
- Rim/horizon scatter:
  - Low-intensity term based on view direction and sun direction.

Recommended terrain light formula:

```wgsl
let ndl = max(dot(n, sunDir), 0.0);
let halfLambert = ndl * 0.85 + 0.15;
let skyAmbient = mix(shadowBlue, skyBlue, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
let occlusion = input.ao * slopeOcclusion * cavityOcclusion;
let color = albedo * (skyAmbient + sunColor * direct * occlusion + bounce);
```

### Fog Model

Replace single linear-ish distance fog with height-aware atmospheric fog:

- Distance haze:
  - `1.0 - exp(-distance * density)`
- Horizon boost:
  - More fog when view ray is close to horizontal.
- Height cooling:
  - Valleys retain slightly warmer mist, distant high terrain becomes blue-grey.
- Sun-side warmth:
  - Fog shifts warm when looking near sun.

Recommended helper:

```wgsl
fn apply_atmosphere(color: vec3<f32>, world: vec3<f32>, camera: vec3<f32>, sunDir: vec3<f32>, fogDensity: f32) -> vec3<f32>
```

### Tone Mapping

Add a small tone mapping function to all visible shaders:

```wgsl
fn tone_map(color: vec3<f32>, exposure: f32) -> vec3<f32> {
  let exposed = color * exposure;
  return exposed / (exposed + vec3<f32>(1.0));
}
```

Then gamma:

```wgsl
return pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
```

### Acceptance Criteria

- Terrain has stronger landform readability at the same camera angle.
- Distant mountains fade into haze, not just grey overlay.
- Snow keeps highlight detail.
- Debug views bypass tone/fog where appropriate or remain clearly diagnostic.

## Phase 4 - Terrain Material Upgrade

### Objectives

- Make the existing four material IDs look much richer.
- Keep all detail procedural and stable in world space.
- Preserve low-poly readability.

### File Changes

- `src/renderer.ts`
  - Expand `material_color()`.
  - Add helpers for macro masks, strata, patches, and snow breakup, using the existing continent/moisture/temperature fields as the first world-space anchors.
  - Consume the existing enriched biome/wetness/snow mask bytes before adding any wider material payload.
  - Treat material-paint overrides as authoritative material IDs for near terrain; shader improvements should enrich those IDs rather than remap or discard them.
  - Preserve falloff-sculpted and flattened/path-cut terrain as real remeshed geometry; visual upgrades may enrich its material response but must not replace it with decals or shader-only height tricks.
  - Use cave-distance diagnostics, material ID `1`, and the initial worker-adopted cave graph passage/chamber IDs as cave/rock hooks, while leaving production cave-graph ownership and streaming to the core roadmap.
- `src/terrain_math.ts`
  - Optional: tune `terrainMaterial()` thresholds if shader-only improvements are insufficient.
- `native/voxel_core.c`
  - Optional: mirror threshold changes in WASM material classification and mask generation.

### Material IDs

Current IDs:

- `0`: grass/soil
- `1`: rock/cave
- `2`: snow
- `3`: dirt/mud/riverbank

### Grass

Add:

- Macro patch variation from warped fBm.
- Fine blade-like variation from high-frequency noise.
- Slope and valley wetness darkening.
- Dry grass/yellow-green on sun-facing ridges.
- Dirt reveal on steep or eroded slopes.

Target albedo range:

- Deep grass: `vec3(0.08, 0.18, 0.07)`
- Fresh grass: `vec3(0.28, 0.48, 0.16)`
- Dry grass: `vec3(0.44, 0.40, 0.18)`
- Soil mix: `vec3(0.28, 0.22, 0.14)`

### Rock

Add:

- Height-based strata lines.
- Crack darkening.
- Grey/brown slope variation.
- Lichen/green tint on shallow upward rock.
- Snow dusting near high elevations.

Target albedo range:

- Dark rock: `vec3(0.20, 0.20, 0.19)`
- Warm rock: `vec3(0.42, 0.35, 0.27)`
- Cold rock: `vec3(0.36, 0.39, 0.40)`

### Snow

Add:

- Wind drift mask.
- Icy blue shadows.
- Exposed rock mask on steep slopes.
- Fine sparkle/glint only under strong sun.
- Snow thickness variation near threshold altitude.

Target albedo range:

- Shadow snow: `vec3(0.62, 0.72, 0.82)`
- Clean snow: `vec3(0.92, 0.97, 1.00)`
- Packed snow: `vec3(0.78, 0.86, 0.92)`

### Dirt And Riverbank

Add:

- Wet mud near low altitude and river center.
- Pebble/gravel flecks.
- Sand/soil transition along water edges.
- Dark undercut banks.

Target albedo range:

- Wet mud: `vec3(0.16, 0.13, 0.09)`
- River gravel: `vec3(0.46, 0.40, 0.30)`
- Dry dirt: `vec3(0.36, 0.27, 0.16)`

### Acceptance Criteria

- Terrain does not read as one uniform green material.
- Painted rock/snow/mud/grass IDs remain visually distinguishable and inspectable in the Material IDs debug view.
- Flattened and capsule path-cut surfaces shade from the same remeshed terrain/material data as other sculpted edits.
- Snow and rock patches break up at mountain scale.
- Riverbanks are more visually distinct.
- Material Masks debug view still shows biome, wetness, and snow channels distinctly enough to diagnose near/far mismatches, and the individual Biome/Wetness/Snow views remain readable after shader changes.
- Macro climate-driven material variation remains consistent across near WASM terrain and far TypeScript heightfield terrain.
- No visible screen-space swimming because all noise is world-space.

## Phase 5 - Water Rendering Upgrade

### Objectives

- Make river/lake water read as alpine water instead of a flat transparent strip.
- Add edge foam and sun glints with minimal geometry changes.

### File Changes

- `src/renderer.ts`
  - Update `WATER_SHADER`.
  - Tune `updateWater()` geometry and attributes.

### Geometry/Data Improvements

Current water vertices use:

- position
- normal
- material
- AO as `edge`

Improve the water ribbon:

- Use `edge` as distance-to-bank foam mask:
  - Center vertices should have lower edge value.
  - Bank vertices should have high edge value.
- Add centerline subdivisions if needed to allow better width/wave variation.
- Consider three vertices across the river instead of two:
  - left bank
  - center
  - right bank
  This permits center depth color and bank foam without adding a new vertex format.

### Shader Improvements

Add:

- Procedural wave normal approximation from two or three sine/noise bands.
- Fresnel:
  - More sky color at grazing angles.
  - More teal/deep water looking downward.
- Sun glint:
  - Specular term from reflected light/view vector.
  - Clamp and tone map to avoid huge white patches.
- Bank foam:
  - Use edge mask plus procedural noise.
  - Mix toward pale blue-white.
- Flow variation:
  - Use world z and time to move foam/noise downstream.
- Shared atmospheric fog and tone mapping.

### Acceptance Criteria

- Water has visible depth/color variation.
- River edges show intermittent foam or wet-bank highlight.
- Sun glints appear only at plausible angles.
- Water remains stable when camera moves.

## Phase 6 - Vegetation Aesthetic Upgrade

### Objectives

- Reduce stamped-looking trees.
- Improve forest massing and lighting.
- Keep the existing instanced pipeline.

### File Changes

- `src/renderer.ts`
  - Update `makeTreeMesh()`.
  - Update `VEGETATION_SHADER`.
- `src/worker.ts`
  - Tune `generateVegetation()`.

### Mesh Improvements

Current pines are two conical layers plus crossed trunk quads.

Enhance with:

- Three canopy tiers for pines.
- Slightly wider lower canopy.
- Offset tier heights to avoid perfect cones.
- Optional small shrub/bush mesh using same vertex format and `kind`.
- Stronger trunk visibility for foreground trees.

Keep vertex count low because this mesh is instanced heavily.

### Instance Data

Current instance data stride is eight floats:

```text
base.xyz, scale, kind, seed, unused, unused
```

Use existing unused values before expanding format:

- `unused0`: color variation or biome shade.
- `unused1`: canopy aspect/wind stiffness.

If shader location changes are needed, update the vertex buffer layout and worker generation together.

### Distribution Improvements

In `generateVegetation()`:

- Increase samples per chunk from `32` to a target range of `48` to `80`, subject to frame budget.
- Use clustered forest masks instead of independent random placement.
- Reduce trees on exposed steep slopes.
- Reduce trees near water, snow, and rock.
- Add small shrubs at lower scale where full trees are filtered out.
- Use altitude bands:
  - Low/wet valley: shrubs and sparse trees.
  - Mid slopes: dense forest.
  - High alpine: sparse small pines.
  - Snowline: no vegetation or rare shrubs.

### Shader Improvements

Add:

- Per-instance green variation.
- Darker inner canopy.
- Warm sun-facing canopy.
- Blue ambient shadow side.
- Distance fog consistent with terrain.
- Wind only weighted by canopy height and instance stiffness.

### Acceptance Criteria

- Forests form natural clumps and clearings.
- Foreground trees have stronger silhouette and depth.
- Distant trees blend into haze rather than remaining flat dark triangles.
- Vegetation instance counts remain within acceptable frame budget.

## Phase 7 - Terrain Scene Dressing

### Objectives

- Add small-scale visual density seen in the references without building a full prop system.
- Make hillsides feel textured at distance.

### Recommended First Pass

Use shader-only detail:

- Dark grass fleck clusters.
- Pebble/rock speckling on steep slopes.
- Snow granularity.
- Wet riverbank streaks.

### Recommended Second Pass

Add a lightweight instanced ground-detail pipeline if shader detail is not enough:

- Reuse the vegetation instancing, patch bounds, CPU culling, and visible-batch draw architecture.
- Add low-poly rocks as a second mesh kind.
- Add short grass/shrub triangles as another kind.
- Keep one draw for the visible batch where possible, then split by mesh/material kind only when the scenery set requires it.

### File Changes For Second Pass

- `src/renderer.ts`
  - Rename vegetation concepts to `SceneryPatch` only if the expansion becomes larger than trees.
  - Add rock/shrub mesh variants within the same pipeline.
- `src/worker.ts`
  - Generate instance kind IDs for pine, shrub, rock.

### Acceptance Criteria

- Slopes show believable micro-variation from mid-distance.
- No major draw-call explosion.
- Scene dressing does not interfere with terrain editing or chunk removal.

## Phase 8 - Optional Shadow Mapping

### Objective

Add real sun shadows only after the shader-only visual pass is stable.

### Why This Is Deferred

Shadow mapping is the highest-risk visual feature because it affects:

- Additional render pass.
- New depth texture.
- Light view/projection matrix.
- Terrain and vegetation shadow caster draws.
- Shadow sampling in multiple fragment shaders.
- Bias tuning for low-poly terrain.
- Performance on integrated GPUs.

### Proposed Shadow Implementation

Start with one directional shadow map, not cascades:

- Resolution: `2048x2048`.
- Fit to a camera-centered orthographic box around visible near terrain.
- Render terrain and vegetation into shadow depth.
- Sample in terrain and vegetation shaders.
- Use PCF 2x2 or 3x3.
- Add slope-scaled bias.

Only move to cascades after the single shadow map looks useful.

### Acceptance Criteria

- Foreground trees cast readable shadows on terrain.
- Terrain self-shadowing improves depth.
- Shadow acne and peter-panning are acceptable.
- Performance remains playable at default radius.

## Phase 9 - Verification And Visual Regression Workflow

### Commands

Run after each implementation slice:

```powershell
npm run typecheck
npm run build
npm run visual:regression -- --image output/playwright/visual-capture/desktop-1680x945.png
npm run visual:capture
```

For local visual verification:

```powershell
npm run dev -- --port 5173
```

Then inspect the browser-driven screenshot and comparison artifacts at:

- `1920x1080`
- `1680x945`
- `390x844` if mobile layout changes are touched
- `output/playwright/visual-capture/`
- `output/playwright/visual-reports/`

The current metric/capture baselines can be refreshed after intentional visual changes with:

```powershell
npm run visual:capture -- --update
npm run visual:regression -- --image output/playwright/visual-capture/desktop-1680x945.png --update
```

### Browser Checks

Verify:

- App starts without WebGPU errors.
- Saved old settings do not break startup.
- Terrain, far vista, vegetation, water, survey beacons, route checkpoints, hazards, and field-contract markers render.
- Debug views still show normals/material/material masks/AO/chunk IDs.
- Export Diagnostic still produces a JSON artifact with an embedded PNG and current runtime/worldgen/erosion/density context.
- Export Quality still produces a JSON artifact with adaptive-quality state, browser worker benchmark trends, worldgen and erosion probes, and frame-time/renderer/streamer pressure.
- Settings sliders update visuals live.
- Water opacity still works.
- High stream radius remains usable.
- No obvious banding, clipping, or NaN shader artifacts.

### Visual Comparison Checklist

Compare against the reference direction:

- Does the sky have a gradient and sun/haze direction?
- Do distant mountains fade into atmosphere?
- Do snow/rock/grass materials have readable variation?
- Does the river pull the eye through the valley?
- Are foreground trees less flat?
- Is the scene still recognizably low-poly?
- Does the overlay remain readable against bright sky?

### Performance Checks

Use the overlay to monitor:

- FPS.
- Average frame time.
- Draw calls.
- Terrain triangles.
- Vegetation instances.
- GPU buffer estimate.

Initial budget:

- Default radius should remain interactive on a modern desktop.
- Shader upgrades should not cause obvious frame collapse before shadow maps.
- Vegetation density increases should be easy to tune down if needed.

## Rollout Order

Recommended implementation order:

1. Add `visual` uniform vec4 and safe default settings. Status: first pass complete.
2. Add sky pipeline and render pass ordering. Status: first pass complete.
3. Add shared tone mapping and atmosphere helpers to terrain. Status: first pass complete, still needs consolidation and tuning.
4. Upgrade terrain material colors and lighting. Status: first pass started, renderer-only peak snow caps, greener mid-elevation slopes, scenic valley softening, reduced default material-noise intensity, mirrored physical river-shoulder folds, and procedural shadow streaks added; deeper material direction remains.
5. Upgrade water shader and water ribbon edge data. Status: first pass started, water now blends from the physical near-SDF river to the scenic far-vista meander, renders opaque/depth-writing for reference captures, and includes lowered pond-like reference-view surfaces; depth/edge foam and production terrain-integrated lake shaping remain.
6. Upgrade vegetation shader and tree mesh. Status: shader/distribution first pass started, renderer-side far forest and pine/shrub/rock variants added, richer mesh variety and impostors remain.
7. Tune vegetation distribution. Status: first pass started, near-tree scale reduced and far-forest density now tuned for the SDF-near reference view, with procedural receiver-shadow streaks on terrain, low-poly shrub/rock variants in the existing vegetation batch, and reduced far-forest pressure when near SDF terrain is enabled.
8. Capture screenshots and tune constants. Status: latest multi-viewport artifacts are under `output/playwright/visual-capture/`; compare reports are under `output/playwright/visual-reports/`; aggregate metrics, compact perceptual signatures, and compressed full-resolution luma fields are stored in `docs/visual-quality-baseline.json`.
9. Decide whether shadow mapping is worth the added complexity.

This order gives visible improvement early while keeping each step reversible.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| WGSL struct mismatch across shaders | Runtime shader compile failure | Update all `Scene` structs in one patch and run browser check |
| Saved settings missing new fields | Startup bad defaults | Sanitize with fallbacks in `main.ts` |
| Shader cost too high | FPS drop | Keep first pass procedural but simple; avoid high-octave loops in water/vegetation |
| Over-fogging | Washed-out image | Keep fog density adjustable and tune defaults from screenshots |
| Vegetation density too high | Draw cost and visual clutter | Gate density through constants and overlay instance count |
| Sky pass depth issue | Terrain hidden or invalid depth | Sky writes no depth and renders before terrain |
| Tone mapping breaks debug views | Diagnostics less useful | Bypass tone/fog for debug modes |
| C/WASM and TS material or mask mismatch | Near/far terrain material seams | Mirror threshold and mask changes in both `terrain_math.ts` and `native/voxel_core.c` only when changing classification |

## Implementation Acceptance Criteria

The implementation is complete when:

- `docs/plans/visual-quality-pipeline-plan.md` is implemented or updated with deviations.
- `npm run typecheck` passes.
- `npm run build` passes.
- A browser run shows:
  - procedural sky
  - atmospheric distance haze
  - richer terrain materials
  - improved water
  - improved tree lighting/variation
- Debug views still work.
- Existing mesh-quality, LOD-selection, worldgen/erosion/material/cave tile, and density-capture comparisons still run through `npm run mesh:regression`, `npm run lod:regression`, `npm run worldgen:regression`, and `npm run density:diff` when a visual change intentionally or accidentally changes terrain selection, terrain geometry, or worldgen outputs.
- The default scene is materially closer to the supplied cinematic alpine references without requiring imported art assets.

## Future Enhancements After First Pass

- Cascaded shadow maps.
- GTAO-lite or horizon-based AO.
- Triplanar material textures.
- Far-terrain clipmap-ring seam blending and richer distance shading after the explicit LOD transition-face/cell worklist, native transition-cell ABI, and runtime transition-prism mesh bridge are promoted into real full native Transvoxel transition mesh generation.
- Dedicated scenery/prop instancing for rocks, grass tufts, and deadwood.
- Promote the current heuristic drainage-, erosion-, IndexedDB-backed worker-adopted native erosion/material-tile-, vegetation-, material-weight-, cave-proximity-, and cave-graph-aware data into native cached production material and erosion fields.
- Weather/time-of-day presets.
- Screenshot comparison harness for visual regression.
