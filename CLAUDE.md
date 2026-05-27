# CLAUDE.md

Claude-specific notes. The shared agent quick-reference is `AGENTS.md`;
read that first. This file holds Claude-side conventions and a few
session lessons.

## Session conventions you should default to

- **Run `npm run typecheck` and `npm test` after non-trivial edits.**
  Both are fast and catch most regressions.
- **Use the in-app console (`src/console.ts` + `src/console_commands.ts`)
  to think about how a user would diagnose your change.** When you add
  new state, consider whether it deserves a console command surface.
  The pattern is: add a getter to `ConsoleDeps` in `src/console_commands.ts`,
  wire it in `src/main.ts`, register a command that reads it.
- **For perf-relevant changes, capture a tour benchmark as evidence.**
  The user can record a baseline tour in their browser, you ship the
  change, the user records a candidate tour, then runs
  `npm run tour:review -- baseline.json candidate.json` to see the
  delta. The review script's exit code is the signal.
- **When you need to refresh a regression baseline, do it explicitly**
  (`npm run mesh:regression -- --update`, `npm run lod:regression -- --update`,
  `npm run worldgen:regression -- --update`). Mention in the commit
  message *why* the values shifted.

## Tooling that exists in this environment

- WASM rebuild works: `npm run build:wasm` finds the dotnet
  Emscripten clang at
  `/c/Program Files/dotnet/packs/Microsoft.NET.Runtime.Emscripten.*.Sdk.win-x64/*/tools/bin/clang.exe`.
- `npm test` runs without a browser — uses Node-loaded WASM and TS
  transpilation in memory.
- `npx playwright --version` reports 1.60 but **Playwright isn't
  installed locally**; `npm run visual:capture` and `npm run visual:regression`
  will fail unless the user installs it. Don't rely on visual baselines
  from this session.
- There is an **in-progress `git am` session** with a stale patch
  referencing files that no longer exist (`src/main.js`, etc.). Leave
  it alone unless explicitly asked to abort.

## Lessons from prior sessions that you should remember

### Code review

- For `/code-review` at `max` effort: 5 angles × 8 candidates × 1-vote
  verify works well even on small diffs. The agents catch subtle bugs
  the line-by-line scan misses (e.g. IndexedDB error-context loss,
  diagnostic regression-only issues that don't fail tests).
- Always cross-check verifier verdicts against the actual code; agents
  occasionally over-flag refuted patterns as bugs.

### IndexedDB

- The `captureRequestFailure(sink)` helper in `src/region_store.ts` is
  the established pattern for preserving the originating DOMException
  through a transaction abort. Use it for any new IDB code instead of
  inventing a new error-propagation scheme.
- Multi-store reads should be one transaction. Two read transactions
  create a torn-state window.
- Saves are atomic via the cursor-streaming `replaceRegionRecords`
  pattern: open a cursor on the index, delete each key, then put new
  records and the meta record, all inside one readwrite transaction.

### Settings & console

- `setSettings(next, key)` re-applies the settings panel UI only for
  `key === 'all'` or `key === 'qualityPreset'`. The console's deps
  wiring routes through `'all'` (preserving `'qualityPreset'` for the
  FSM-reset branch). Don't change this without thinking through every
  setter site.
- Tab completion includes built-ins (`help`, `clear`) and user-defined
  aliases. Adding a new command type with its own dispatcher should
  also feed into that completion set.
- Recursion depth is capped at 16 in `EngineConsole.execute` to stop
  alias cycles.

### Renderer

- Multi-draw indirect is feature-gated on `chromium-experimental-multi-draw-indirect`.
  Per-slot indirect-draw replay remains the fallback. Don't assume
  the feature is present.
- The LOD seam-skirt geometry has been removed in favor of the native
  chunk-level transition mesh ABI. Don't reintroduce skirts without a
  documented streaming gap.
- The terrain arena renderer is recent; respect its boundary (vertices,
  indices, origins, clusters, source/compact indirect arenas) instead
  of allocating fresh GPU buffers per chunk.

### WASM / native

- `EROSION_TILE_GENERATOR_VERSION = 2`: erosion tiles now run a real
  hydraulic + thermal simulation. If you change simulation parameters
  or step count, bump the version so persisted IDB tiles invalidate,
  and refresh `docs/worldgen-tile-baseline.json` via
  `npm run worldgen:regression -- --update`.
- The chunk-level Transvoxel transition ABI (`generate_lod_transition_chunk_mesh`)
  uses preloaded chunk-level positions/densities/per-cell-sides buffers
  and emits one packed mesh against a unified pack frame. The runtime
  worker uses it directly; per-cell ABI still exists for regression
  cross-checking.
- The new chunk-ABI regression in `scripts/lod-selection-regression.mjs`
  asserts the chunk path never emits more triangles than the per-cell
  loop. Small per-scene triangle deltas (degenerate-after-packing) are
  expected and captured in the baseline.

## Commands you'll use

```
npm run typecheck                # tsc
npm test                         # full regression suite
npm run build:wasm               # rebuild public/voxel_core.wasm
npm run mesh:regression          # or -- --update to refresh
npm run worldgen:regression      # or -- --update
npm run lod:regression           # or -- --update
npm run visual:regression        # needs Playwright browsers
npm run visual:capture           # needs Playwright browsers
npm run benchmark                # WASM perf benchmarks
npm run benchmark:review         # diff two benchmark artifacts
npm run tour:capture             # build + serve + drive Chrome + save baseline JSON
npm run tour:review              # diff two camera-tour benchmark artifacts
```

For interactive driving from a CLI, drive the dev server with the URL
automation surface (`?auto=state&...`) or, once the user has it open
in a browser, the in-app console via Playwright/CDP:

```js
__stormCanyonConsole.execute('tour run smoke');
```

## When you should stop and ask

- **Visual changes.** You can't validate the rendered output. Surface
  the change behind a setting flag (the seam-skirt removal used this
  pattern), or ship as a follow-up commit after the user validates.
- **Hard-to-reverse operations** (force-push, history rewriting, branch
  deletion, IndexedDB schema changes that invalidate user data without
  a recovery path). Confirm first.
- **Anything that affects the in-progress `git am` session.** Leave
  it alone unless explicitly asked.
- **Slice 5-style "production-grade simulation" work** where the value
  depends on visual tuning. Ship the framework, surface a flag, let
  the user tune.
