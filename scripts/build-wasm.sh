#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
clang --target=wasm32-unknown-unknown-wasm \
  -O3 -ffreestanding -nostdlib \
  -Wl,--no-entry \
  -Wl,--export-memory \
  -Wl,--initial-memory=33554432 \
  -Wl,--max-memory=134217728 \
  -Wl,--export=generate_chunk \
  -Wl,--export=get_vertex_ptr \
  -Wl,--export=get_index_ptr \
  -Wl,--export=get_vertex_count \
  -Wl,--export=get_index_count \
  -Wl,--export=get_overflow \
  -Wl,--export=get_chunk_world_size \
  -Wl,--export=get_cell_size \
  -Wl,--export=get_chunk_n \
  -Wl,--export=sample_density \
  -Wl,--export=get_terrain_height \
  -Wl,--export=get_river_center \
  -Wl,--export=add_subtract_sphere \
  -Wl,--export=clear_edits \
  -o "$ROOT/public/voxel_core.wasm" \
  "$ROOT/native/voxel_core.c"
ls -lh "$ROOT/public/voxel_core.wasm"
