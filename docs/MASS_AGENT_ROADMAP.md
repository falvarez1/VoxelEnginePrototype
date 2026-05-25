# Mass Agent Simulation Roadmap

This roadmap starts after the current core engine roadmap, WebGPU performance work, Rust production core, editor hardening, and follow-on visual-quality foundations are complete. It is intentionally not a replacement for the terrain, streaming, rendering, or worldgen tracks.

The goal is to support very large populations of lightweight autonomous agents, such as insects, creatures, crowds, or background characters, without turning each one into a high-overhead JavaScript object.

## Entry criteria

Do not start this track until these engine foundations are stable:

- GPU-owned terrain visibility, draw compaction, and production terrain draw batching are complete.
- Renderer upload/resource arenas are in place and tuned from browser traces.
- Worker/cache ownership rules are explicit, with SharedArrayBuffer paths extended toward zero-copy where feasible.
- Native Transvoxel or equivalent production LOD transitions are complete enough that terrain visibility cost is bounded.
- Rust/WASM production core work has settled the native ABI, memory arenas, and benchmark workflow.
- The quality/diagnostic export path reports frame time, worker pressure, GPU memory, draw/dispatch counts, agent counts, and visible-agent counts.
- Visual/readiness work has stable impostor, vegetation, material, and water expectations so mass agents can integrate without masking renderer regressions.

## Design position

Use ECS ideas, but do not put millions of agents into a traditional object-oriented ECS on the main thread.

The mass path should be a custom data-oriented agent layer:

```text
AgentWorld
  AgentPool[]
    AgentPage[]
      position: Float32Array or GPU storage buffer
      velocity: Float32Array or GPU storage buffer
      state: Uint8Array
      behavior: Uint8Array
      target: Uint32Array
      seed: Uint32Array
      flags: Uint32Array
      lod: Uint8Array
  SpatialGrid
  BehaviorLodScheduler
  GpuAgentBuffers
  VisibleAgentBatches
```

The normal entity layer should own high-level concepts such as colonies, squads, selected agents, hero characters, authored encounters, mission entities, and debug handles. The mass layer should own the hot buffers.

## Open-source references

- Flecs: primary architectural reference for archetype/page storage, relationship modeling, profiling, and large-entity simulation. It is MIT licensed and maps well to C/WASM or future native builds.
- bitECS: useful browser/TypeScript reference for numeric entity IDs, structure-of-arrays component stores, and TypedArray-friendly design. Treat as a conceptual reference unless MPL-2.0 dependency and modification obligations are explicitly accepted.
- Bevy ECS: future Rust reference for high-level game entities, schedules, and parallel systems. Do not use it as the storage model for every lightweight mass agent.
- EnTT: useful C++ reference for sparse-set tradeoffs, pay-for-what-you-use design, and non-intrusive ECS APIs, but less directly aligned with the browser TypeScript/WASM stack.

## Phase A - Agent telemetry and budgets

Define the performance envelope before adding the system.

- Add explicit budgets for total agents, simulated agents, visible agents, GPU-dispatched agents, CPU-updated agents, and promoted high-fidelity agents.
- Extend quality captures with agent counters and per-pass timing.
- Add deterministic benchmark scenes for empty world, dense colony, crowd corridor, far-field swarm, and edit-disturbed terrain.
- Add regression gates for agent spawn/despawn, spatial partition updates, behavior LOD changes, and visible batch generation.
- Define target tiers:
  - Low: tens of thousands of visible or simulated lightweight agents.
  - Balanced: hundreds of thousands of low-fidelity agents plus thousands of near agents.
  - High/Ultra: million-scale low-fidelity agents with aggressive LOD and impostors.

Exit criteria:

- The engine can report agent cost separately from terrain, vegetation, water, and UI cost.
- Benchmarks fail on meaningful regressions in update, cull, upload, or draw/dispatch cost.

## Phase B - Paged SoA agent storage

Build the CPU-side data model without rendering pressure.

- Implement `AgentWorld` with fixed-size pages grouped by species, behavior class, and render archetype.
- Store hot fields in typed arrays with stable page-local indices.
- Use opaque agent handles with generation counters for debug/UI references.
- Add free lists and bulk allocation APIs for spawning/despawning thousands of agents at a time.
- Add page-level dirty ranges for worker/GPU synchronization.
- Keep sparse high-level metadata outside hot loops.

Exit criteria:

- Creating, destroying, and iterating hundreds of thousands of agents produces no per-agent object churn.
- Page compaction and free-list behavior are deterministic and benchmarked.

## Phase C - Spatial partition and terrain coupling

Make agent work local.

- Add a world-space spatial hash or grid aligned with terrain/worldgen tiles.
- Maintain page-level and cell-level occupancy summaries.
- Add terrain sampling hooks that use existing height, material, wetness, slope, cave, and water fields without per-agent expensive probes.
- Add flow fields for common movement goals such as colony trails, avoidance zones, route corridors, water edges, and hazard fields.
- Add edit invalidation so terrain edits refresh only affected cells/fields.

Exit criteria:

- Agents update against local neighborhood data, not global scans.
- Terrain edits can invalidate and repair agent fields without rebuilding the full population.

## Phase D - Behavior LOD scheduler

Support millions by reducing fidelity with distance, visibility, importance, and gameplay relevance.

- Define behavior tiers:
  - Tier 0: selected, interacted, or hero agents with rich behavior.
  - Tier 1: nearby visible agents with steering, collision, and animation state.
  - Tier 2: mid-distance agents following local flow fields and coarse avoidance.
  - Tier 3: far-field density or page-level aggregate motion.
  - Tier 4: dormant/persistent population records.
- Add promotion/demotion rules with hysteresis so agents do not churn between tiers every frame.
- Budget updates per frame and spread low-priority work across frames.
- Add deterministic seeds so downgraded agents can be reconstructed or promoted without visible discontinuity.

Exit criteria:

- Population count can rise independently from high-fidelity simulation count.
- Nearby behavior remains stable while far-field behavior is amortized or aggregated.

## Phase E - GPU simulation and culling

Move the mass hot path onto WebGPU where it is profitable.

- Mirror agent pages into GPU storage buffers.
- Add compute passes for simple movement integration, flow-field following, page bounds, visibility classification, and compacted visible instance generation.
- Keep CPU simulation for complex agents and GPU simulation for cheap mass behavior.
- Add readback only for summaries, selected agents, and debug captures.
- Integrate visible agent batches with existing GPU-owned draw compaction and renderer resource arenas.
- Add fallback paths for browsers/devices with limited WebGPU compute or storage-buffer limits.

Exit criteria:

- Simple agents can update and produce visible draw batches without per-agent CPU round trips.
- GPU-visible agent counts, culled counts, dispatch counts, and buffer pressure are visible in the overlay and exports.

## Phase F - Rendering at scale

Render populations without per-agent draw calls.

- Use instanced impostors, sprite sheets, low-poly meshes, or compact skinned/vertex-animated variants based on agent type and LOD.
- Batch by render archetype, material, species, animation set, and visibility tier.
- Add GPU-generated instance buffers and indirect draw records where WebGPU support allows.
- Use far-field density rendering for distant swarms/crowds instead of individual geometry.
- Add optional debug views for agent cells, page bounds, behavior LOD, flow fields, and promotion zones.

Exit criteria:

- Rendering cost scales with visible batches and representation tier, not total population.
- Distant populations remain visually plausible without fully simulating or drawing every individual.

## Phase G - High-level ECS integration

Integrate mass agents with gameplay without losing the hot-path layout.

- Add high-level ECS entities for colonies, factions, squads, selected agents, hero characters, scripted encounters, and persistent world events.
- Store handles or page ranges that reference the mass-agent layer rather than duplicating hot component data.
- Add authoring hooks for spawn volumes, behavior presets, goal fields, and population budgets.
- Add persistence for aggregate populations first, then promoted individual agents.
- Add network/replay-friendly deterministic state snapshots if multiplayer or replay becomes a goal.

Exit criteria:

- Gameplay code can reason about agent groups and selected individuals without iterating every lightweight agent in JavaScript.
- Save/load can persist large populations compactly.

## Phase H - Production hardening

Make the system observable and controllable.

- Add agent-specific benchmark baselines and CI artifact review.
- Add stress scenes for million-agent spawn, sustained simulation, terrain edit disturbance, camera flythrough, and save/load.
- Add browser capability tiers for storage-buffer limits, compute support, worker/SAB availability, and device memory hints.
- Add safety caps so Auto quality can reduce active simulation, visible density, update frequency, and far-field representation.
- Add diagnostics for agent leaks, page fragmentation, stale handles, GPU/CPU divergence, and readback stalls.

Exit criteria:

- The engine can degrade gracefully instead of failing when a device cannot support the requested population.
- Agent performance regressions are visible in the same benchmark/review workflow as terrain and rendering regressions.

## Non-goals

- Do not model voxels, triangles, vegetation instances, or every terrain chunk as ECS entities.
- Do not require every background agent to have pathfinding, animation, physics, and full AI every frame.
- Do not make the JavaScript main thread responsible for per-agent updates at million scale.
- Do not introduce an ECS framework that takes ownership of the renderer, terrain streamer, or worker scheduling.
- Do not copy code from MPL-2.0 or other non-MIT/Apache sources into the repo without an explicit license decision.

## First implementation slice

When this track starts, the first slice should be deliberately narrow:

1. Add `AgentWorld` with paged typed-array storage.
2. Add deterministic spawn/despawn and iteration benchmarks.
3. Add a simple spatial grid.
4. Add a WebGPU instanced point/impostor renderer for visible agents.
5. Add overlay/export telemetry.
6. Add a single behavior: flow-field following with deterministic noise.

That slice proves the storage, telemetry, rendering, and budget model before richer behavior, ECS integration, or GPU simulation are added.
