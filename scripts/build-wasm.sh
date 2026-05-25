#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLANG="${CLANG:-}"
if [[ -z "$CLANG" ]]; then
  if command -v clang >/dev/null 2>&1; then
    CLANG="$(command -v clang)"
  else
    for candidate in \
      "/c/Program Files"/dotnet/packs/Microsoft.NET.Runtime.Emscripten.*.Sdk.win-x64/*/tools/bin/clang.exe \
      "/mnt/c/Program Files"/dotnet/packs/Microsoft.NET.Runtime.Emscripten.*.Sdk.win-x64/*/tools/bin/clang.exe; do
      if [[ -x "$candidate" ]]; then
        CLANG="$candidate"
        break
      fi
    done
  fi
fi

if [[ -z "$CLANG" ]]; then
  echo "clang not found. Install Clang/LLD with wasm32 support or set CLANG=/path/to/clang." >&2
  exit 1
fi

SOURCE="$ROOT/native/voxel_core.c"
OUTPUT="$ROOT/public/voxel_core.wasm"
CLANG_SOURCE="$SOURCE"
CLANG_OUTPUT="$OUTPUT"
if [[ "$CLANG" == *.exe ]] && command -v wslpath >/dev/null 2>&1; then
  CLANG_SOURCE="$(wslpath -w "$SOURCE")"
  CLANG_OUTPUT="$(wslpath -w "$OUTPUT")"
fi

"$CLANG" --target=wasm32-unknown-unknown-wasm \
  -O3 -ffreestanding -nostdlib \
  -Wl,--no-entry \
  -Wl,--export-memory \
  -Wl,--initial-memory=33554432 \
  -Wl,--max-memory=134217728 \
  -Wl,--export=generate_chunk \
  -Wl,--export=mesh_cached_chunk \
  -Wl,--export=generate_lod_transition_cell_mesh \
  -Wl,--export=apply_subtract_sphere_to_density \
  -Wl,--export=apply_add_sphere_to_density \
  -Wl,--export=apply_subtract_box_to_density \
  -Wl,--export=apply_add_box_to_density \
  -Wl,--export=apply_subtract_capsule_to_density \
  -Wl,--export=apply_add_capsule_to_density \
  -Wl,--export=apply_subtract_sphere_to_density_falloff \
  -Wl,--export=apply_add_sphere_to_density_falloff \
  -Wl,--export=apply_subtract_box_to_density_falloff \
  -Wl,--export=apply_add_box_to_density_falloff \
  -Wl,--export=apply_subtract_capsule_to_density_falloff \
  -Wl,--export=apply_add_capsule_to_density_falloff \
  -Wl,--export=apply_smooth_sphere_to_density \
  -Wl,--export=apply_smooth_box_to_density \
  -Wl,--export=apply_smooth_capsule_to_density \
  -Wl,--export=apply_flatten_sphere_to_density \
  -Wl,--export=apply_flatten_box_to_density \
  -Wl,--export=apply_flatten_capsule_to_density \
  -Wl,--export=get_vertex_ptr \
  -Wl,--export=get_index_ptr \
  -Wl,--export=get_density_ptr \
  -Wl,--export=get_lod_transition_position_ptr \
  -Wl,--export=get_lod_transition_density_ptr \
  -Wl,--export=get_vertex_count \
  -Wl,--export=get_index_count \
  -Wl,--export=get_density_count \
  -Wl,--export=get_lod_transition_sample_count \
  -Wl,--export=get_lod_transition_algorithm_id \
  -Wl,--export=get_overflow \
  -Wl,--export=get_vertex_stride \
  -Wl,--export=get_density_stride \
  -Wl,--export=get_density_scale \
  -Wl,--export=get_mesher_id \
  -Wl,--export=set_chunk_lod \
  -Wl,--export=get_chunk_lod \
  -Wl,--export=get_base_chunk_world_size \
  -Wl,--export=get_chunk_world_size \
  -Wl,--export=get_cell_size \
  -Wl,--export=get_chunk_n \
  -Wl,--export=get_bounds_min_x \
  -Wl,--export=get_bounds_min_y \
  -Wl,--export=get_bounds_min_z \
  -Wl,--export=get_bounds_max_x \
  -Wl,--export=get_bounds_max_y \
  -Wl,--export=get_bounds_max_z \
  -Wl,--export=generate_worldgen_tile \
  -Wl,--export=get_worldgen_tile_field_ptr \
  -Wl,--export=get_worldgen_tile_biome_id_ptr \
  -Wl,--export=get_worldgen_tile_water_id_ptr \
  -Wl,--export=get_worldgen_tile_river_id_ptr \
  -Wl,--export=get_worldgen_tile_resolution \
  -Wl,--export=get_worldgen_tile_sample_count \
  -Wl,--export=get_worldgen_tile_field_count \
  -Wl,--export=get_worldgen_tile_size \
  -Wl,--export=generate_erosion_tile \
  -Wl,--export=get_erosion_tile_field_ptr \
  -Wl,--export=get_erosion_tile_resolution \
  -Wl,--export=get_erosion_tile_sample_count \
  -Wl,--export=get_erosion_tile_field_count \
  -Wl,--export=get_erosion_tile_schema_version \
  -Wl,--export=get_erosion_tile_generator_version \
  -Wl,--export=get_erosion_tile_size \
  -Wl,--export=generate_material_tile \
  -Wl,--export=get_material_tile_field_ptr \
  -Wl,--export=get_material_tile_id_ptr \
  -Wl,--export=get_material_tile_resolution \
  -Wl,--export=get_material_tile_sample_count \
  -Wl,--export=get_material_tile_field_count \
  -Wl,--export=get_material_tile_schema_version \
  -Wl,--export=get_material_tile_generator_version \
  -Wl,--export=get_material_tile_size \
  -Wl,--export=generate_cave_graph_tile \
  -Wl,--export=get_cave_graph_passage_ptr \
  -Wl,--export=get_cave_graph_chamber_ptr \
  -Wl,--export=get_cave_graph_passage_count \
  -Wl,--export=get_cave_graph_chamber_count \
  -Wl,--export=get_cave_graph_max_passages \
  -Wl,--export=get_cave_graph_max_chambers \
  -Wl,--export=get_cave_graph_passage_field_count \
  -Wl,--export=get_cave_graph_chamber_field_count \
  -Wl,--export=get_cave_graph_tile_schema_version \
  -Wl,--export=get_cave_graph_tile_generator_version \
  -Wl,--export=get_cave_graph_tile_size \
  -Wl,--export=sample_density \
  -Wl,--export=get_terrain_height \
  -Wl,--export=get_river_center \
  -Wl,--export=get_macro_continent \
  -Wl,--export=get_moisture_mask \
  -Wl,--export=get_temperature_mask \
  -Wl,--export=get_cave_distance \
  -Wl,--export=get_biome_mask \
  -Wl,--export=get_wetness_mask \
  -Wl,--export=get_snow_mask \
  -Wl,--export=get_drainage_mask \
  -Wl,--export=get_erosion_mask \
  -Wl,--export=get_vegetation_mask \
  -Wl,--export=add_subtract_sphere \
  -Wl,--export=add_add_sphere \
  -Wl,--export=add_subtract_box \
  -Wl,--export=add_add_box \
  -Wl,--export=add_subtract_capsule \
  -Wl,--export=add_add_capsule \
  -Wl,--export=add_subtract_sphere_falloff \
  -Wl,--export=add_add_sphere_falloff \
  -Wl,--export=add_subtract_box_falloff \
  -Wl,--export=add_add_box_falloff \
  -Wl,--export=add_subtract_capsule_falloff \
  -Wl,--export=add_add_capsule_falloff \
  -Wl,--export=add_paint_sphere \
  -Wl,--export=add_paint_box \
  -Wl,--export=add_paint_capsule \
  -Wl,--export=add_smooth_sphere \
  -Wl,--export=add_smooth_box \
  -Wl,--export=add_smooth_capsule \
  -Wl,--export=add_flatten_sphere \
  -Wl,--export=add_flatten_box \
  -Wl,--export=add_flatten_capsule \
  -Wl,--export=clear_edits \
  -o "$CLANG_OUTPUT" \
  "$CLANG_SOURCE"
ls -lh "$OUTPUT"
