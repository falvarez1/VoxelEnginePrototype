# AGENTS.md

Guidance for AI agents working in this repo. This file is the canonical
quick-reference; the per-area docs in `docs/` (ARCHITECTURE.md,
PERFORMANCE.md, ROADMAP.md, plans/visual-quality-pipeline-plan.md,
MASS_AGENT_ROADMAP.md) are the long form.

## What this project is

Storm Canyon is a browser-first WebGPU + WebAssembly voxel terrain
prototype. The runtime stack is:

- WebGPU renderer (`src/renderer.ts`).
- WebAssembly mesher / SDF core (`native/voxel_core.c` → `public/voxel_core.wasm`).
- Worker pool (`src/worker.ts`) running the WASM per chunk.
- TypeScript host (`src/main.ts`) for streaming, settings, UI panels,
  region persistence, the prototype expedition game loop, automation,
  the in-app developer console, and the camera-tour benchmark harness.

The repo is dependency-light: Vite for dev/build, TypeScript, the
`@webgpu/types` package, `@types/node`. WASM is built with whichever
freestanding clang the build script discovers (currently the dotnet
Emscripten SDK clang on this machine).

## How to verify a change works

Run these in order; they're cheap and catch most regressions:

```
npm run typecheck            # tsc -p tsconfig.json
npm run build:wasm           # rebuild public/voxel_core.wasm if native/ changed
npm test                     # smoke + mesh + worldgen + LOD selection regressions
```

For UI/feature changes you should also start the app and exercise the
path. From this CLI session you cannot run a browser, so document the
manual verification step in the commit message or PR description.

`npm test` runs four scripts:
- `scripts/smoke-test.mjs` — exercises the WASM ABI directly.
- `scripts/mesh-regression.mjs` — captures deterministic Marching Cubes
  topology + hashes against `docs/mesh-quality-baseline.json`.
- `scripts/worldgen-tile-regression.mjs` — TypeScript + native worldgen,
  erosion, material, and cave-graph tile output against
  `docs/worldgen-tile-baseline.json`.
- `scripts/lod-selection-regression.mjs` — LOD selector,
  transition-face schedule, transition mesh, native chunk vs per-cell
  ABI deltas against `docs/lod-selection-baseline.json`.

Refresh a baseline only when the change is intentional, with `-- --update`
on the matching `npm run <name>:regression` script.

## Working from the in-app developer console

The console is the **preferred** surface for runtime tweaks after the
engine has initialized. Toggle it with `` ` `` / `~` in the browser.
It's wired through `src/console.ts` + `src/console_commands.ts` and
shares its dispatcher with the settings panel — anything you can do
through URL automation you can do through the console interactively,
plus more.

Useful commands when investigating:
- `settings [filter]`, `set <key> <value>`, `get <key>`, `find <text>`,
  `assert <key> <expected>`.
- `actions [filter]`, `action <name>` — invoke any of the 56 settings
  actions (carve, undo/redo, save/load region, exports, brush/falloff
  presets, retention workflows, etc.).
- `camera`, `tp x y z`, `look yawDeg pitchDeg`, `radius <n>`, `seek <delta>`.
- Quick toggles: `lod / near / far / water / vegetation / sky /
  cinematic / markers / preview / follow / streaming`, `panel <name>`,
  `debug <name|index>`, `paint <material>`, `brush <field> <value>`,
  `quality <preset>`.
- Inspection: `stats`, `chunks`, `caps`, `streamer`, `pool`, `auto-quality`,
  `benchmarks`, `state`, `markers`, `panels`, `version`,
  `chunk-cache` / `worldgen-cache` / `erosion-cache` / `material-cache`
  / `cave-cache` / `caches`, `lod-plan`, `compression`, `sharing`,
  `probe [x z]`, `progress`, `edits [count]`, `branches`, `regions`,
  `presets`.
- Control: `pause`, `unpause`, `time <mult>`, `screenshot`,
  `flash <key>` (toggle a bool off-and-on to verify side effects),
  `sweep <key> <lo> <hi> <steps> [delayMs]` (step a numeric setting
  through a range to stress-test it), `crash <kind>` (intentionally
  trigger an error path).
- Workflow: `alias <name> <body>` / `aliases` / `unalias`,
  `history [count]`, `watch <intervalMs> <cmd>` / `unwatch [id|all]`,
  `watchers`, `loop <n> <cmd>`, `run <cmd>; <cmd>; ...`, `mark [label]`,
  `wait <ms>`, `help [name]`.
- Camera tours and benchmarks: `waypoint <add|list|remove|clear|time|easing|save|load|delete|tours>`,
  `tour <run|stop|pause|resume|status|summary|export>`.

`window.__stormCanyonConsole.execute('cmd')` lets Playwright or CDP
drive the same surface programmatically.

## Camera waypoints + deterministic tour benchmarks

When you want to know whether a change you made helps or hurts
perf, the recommended flow is:

1. Open the console in the browser.
2. Move the camera to a starting pose; `waypoint add` to capture it.
3. Repeat for a handful of poses you want to fly past (`waypoint add
   <spacingMs>` to control the per-segment duration; default is 1500ms
   between waypoints).
4. `waypoint save <name>` to persist the tour under a name in
   `localStorage` (`stormCanyon.tours.v1`).
5. `tour run <name>` — the camera flies the path on a time-based
   interpolator (frame rate doesn't affect the path).
6. When playback ends, the console prints an inline summary
   (avg / p95 / p99 frame time, draw calls, upload MB, etc.). Type
   `tour export` to download the benchmark JSON, or `tour summary`
   to re-print it.

The downloaded artifact is `storm-canyon-tour-<name>-<isoDate>.json`
with type `"storm-canyon-camera-tour-benchmark"`. Inside:

- `summary`: aggregate stats (avg/p50/p95/p99/min/max frame ms, avg
  fps, draw calls, terrain triangles, upload + GPU MB, visible
  clusters, vegetation instances, worker pending/queued).
- `perSegment`: same stats bucketed by waypoint-pair segment.
- `samples`: per-frame raw data (frame ms, position, etc.) capped at
  8192 entries.
- `context`: snapshot of `renderer.capabilities`, settings, and
  user agent.

A built-in baseline tour (`baseline-canyon-flyover`, also reachable as
`baseline`) lives in `src/tour_presets.ts`. The canonical captured
benchmark is at `docs/tour-baselines/baseline.json` — use that as the
"baseline" side of every comparison. Capture a fresh one with:

```
npm run tour:capture                          # uses the built-in baseline tour
npm run tour:capture -- --tour <name>         # any built-in or saved tour
npm run tour:capture -- --out path.json       # override output path
npm run tour:capture -- --skip-build          # use existing dist/
npm run tour:capture -- --no-browser          # serve only; you'll open the URL by hand
```

The capture script builds the app, starts `scripts/serve.mjs`,
launches Chrome (or whatever STORM_CANYON_BROWSER points at) with the
right URL automation params (`automation=1&automation.actions=tour&tour=<name>`),
polls `/__storm/automation-report/latest` until the
`storm-canyon-camera-tour-benchmark` payload arrives, and saves it.

To compare two tour artifacts (e.g., before and after a tweak):

```
npm run tour:review -- path/to/baseline.json path/to/candidate.json
```

This prints per-metric percent deltas and per-segment frame-time deltas.
It exits non-zero when configurable thresholds are exceeded:

- `--max-overall <pct>`: avg frame-time delta across avg/p50/p95
  (default 8%).
- `--max-metric <pct>`: any top-level summary metric (default 15%).
- `--max-tail <pct>`: p95/p99/max frame-time (default 25%, looser).

`--report <path>` writes the comparison JSON to disk; `--json` makes
the human summary machine-readable. Use that exit code as your
"did this regress?" signal.

### Tips for stable benchmarks

- **Disable auto-quality** before recording (`quality balanced` or
  `quality high` — anything but `auto`) so the FSM doesn't change
  tiers mid-tour.
- **Clear edits and pick a deterministic region slot** so the tour
  always sees the same world state.
- **Run a warmup pass** by playing the tour once before recording the
  one you'll commit — JIT warmup, worker scheduling, and tile-cache
  population all benefit from a discarded first run.
- **Keep tour duration moderate** (10-60s typical). Sample buffer
  caps at 8192 entries; at 16ms frames that's ~131s before truncation.
- **Match window size** between runs. The canvas size affects fragment
  cost.

## Architecture pointers

Read order if you're new:
1. `docs/ARCHITECTURE.md` — high-level layout and ABI.
2. `docs/PERFORMANCE.md` — current budgets, known hotspots, and the
   "Immediate optimizations" backlog.
3. `docs/ROADMAP.md` — phased plan (current Phase 1 is dense; Phases
   2-8 are forward work).
4. `docs/plans/visual-quality-pipeline-plan.md` — graphics follow-on.
5. `docs/MASS_AGENT_ROADMAP.md` — post-core mass agent track (gated
   on terrain/renderer/Rust core foundations).

Key modules:
- `src/main.ts` — bootstrap, frame loop, settings glue, every UI
  panel wiring, automation, console + tour wiring. Large file.
- `src/renderer.ts` — WebGPU renderer with terrain arena, Hi-Z,
  multi-draw indirect (Chromium feature-gated), sky/water/vegetation,
  debug views.
- `src/worker.ts` — chunk + tile + LOD-transition worker.
- `src/chunk_cache.ts` — LRU compressed chunk cache.
- `src/region_store.ts` — IndexedDB region persistence; all save/load/
  inspect/verify/clear paths are atomic single transactions and
  preserve the originating DOMException via `captureRequestFailure`.
- `src/worldgen_tiles.ts` / `erosion_tiles.ts` / `material_tiles.ts`
  / `cave_tiles.ts` — runtime tile caches, each backed by an IndexedDB
  store and a native WASM tile-buffer ABI. Erosion tiles now run an
  explicit grid-based hydraulic + thermal simulation in the native
  core (generator_version=2); TS tiles keep the heuristic as warm-start
  fallback.
- `src/terrain_lod.ts` — pure LOD plan + transition schedule + transition
  mesh selector, transpiled into the regression script.
- `src/console.ts` / `src/console_commands.ts` — developer console.
- `src/camera_tour.ts` — waypoint + tour + benchmark.
- `src/engine_contracts.ts` — shared TypeScript contracts between
  host + worker + renderer. New telemetry fields go here.

## Repo conventions

- **No emojis** unless the user explicitly asks for them.
- **No new .md docs** unless explicitly requested; update the existing
  doc surface (this file, `docs/ARCHITECTURE.md`, `docs/PERFORMANCE.md`,
  `docs/ROADMAP.md`) when behavior changes.
- **Default to no code comments.** Add one only when the WHY is
  non-obvious. Don't restate what well-named identifiers already say.
- **Bug fixes don't bring cleanup.** A focused bug fix doesn't refactor
  the surrounding file.
- **Commit messages**: short title (under ~70 chars), imperative voice
  ("Add ...", "Fix ...", "Promote ..."). Body explains the why and
  flags any backwards-compat concerns.
- **Don't push** unless asked. Don't `git am --abort` an existing
  in-progress am session; the user has manual housekeeping to do
  there.
- **Visual changes need browser eyes.** From the CLI you can refresh
  the mesh / LOD / worldgen baselines, but `docs/visual-quality-baseline.json`
  changes need an in-browser capture pass that you can't perform.

## Common gotchas observed in past sessions

- `{...flyCameraInstance}` drops prototype methods like `.forward()`.
  Use `Pick<>`-typed structural objects when you need to fake a
  camera for a single call site.
- The console toggle is `Backquote`. Shift+Backquote inside the
  console input is allowed through so the tilde can be typed.
- `setSettings(next, key)` only re-applies the settings panel UI when
  `key === 'all'` or `key === 'qualityPreset'`. External callers
  (console, automation) should pass `'all'` unless they need the
  quality preset FSM reset path.
- WebGPU canvas `toBlob` works in Chrome but you cannot rely on it
  capturing the most recent frame across all browsers; the diagnostic
  export uses it and that's our shared baseline.
- Floating-point parity between native C (`-O3`) and TypeScript
  iterative simulations is not guaranteed. Native erosion uses a real
  simulation; TS erosion keeps the heuristic as warm-start fallback
  rather than mirroring the simulation step-for-step.
- LOD seam-skirt geometry has been removed (the chunk transition mesh
  owns the seam). Don't reintroduce skirt code without a strong reason.
