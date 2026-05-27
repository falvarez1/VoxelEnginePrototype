// voxel_core.c
// Minimal freestanding WASM terrain core for Storm Canyon.
// Compiles with clang --target=wasm32-unknown-unknown-wasm without libc.

#define CHUNK_N 32
#define GRID_N (CHUNK_N + 1)
#define BASE_CELL_SIZE 1.0f
#define BASE_CHUNK_WORLD_SIZE ((float)CHUNK_N * BASE_CELL_SIZE)
#define MAX_LOD 3
#define MAX_VERTS 360000
#define MAX_INDICES 1080000
#define MAX_EDITS 512
#define INVALID_INDEX 0xffffffffu
#define VERTEX_STRIDE 16
#define DENSITY_SCALE 256.0f
#define DENSITY_STRIDE 2
#define LOD_TRANSITION_SAMPLE_COUNT 12
#define LOD_TRANSITION_MAX_CHUNK_CELLS 2048
#define LOD_TRANSITION_ALGORITHM_TRANSITION_PRISM_TETRA_TABLE 1
#define LOD_TRANSITION_SIDE_NEG_X 0
#define LOD_TRANSITION_SIDE_POS_X 1
#define LOD_TRANSITION_SIDE_NEG_Z 2
#define LOD_TRANSITION_SIDE_POS_Z 3
#define LOD_TRANSITION_MAX_LOCAL_VERTS 128
#define LOD_TRANSITION_MAX_LOCAL_INDICES 384
#define EDIT_SHAPE_SPHERE 0
#define EDIT_SHAPE_BOX 1
#define EDIT_SHAPE_CAPSULE 2
#define EDIT_TYPE_SUBTRACT 0
#define EDIT_TYPE_ADD 1
#define EDIT_TYPE_PAINT 2
#define EDIT_TYPE_SMOOTH 3
#define EDIT_TYPE_FLATTEN 4
#define MESHER_MARCHING_CUBES 1
#define WORLDGEN_TILE_RESOLUTION 17
#define WORLDGEN_TILE_SAMPLE_COUNT (WORLDGEN_TILE_RESOLUTION * WORLDGEN_TILE_RESOLUTION)
#define WORLDGEN_TILE_FIELD_COUNT 32
#define WORLDGEN_TILE_SIZE 256.0f
#define EROSION_TILE_SCHEMA_VERSION 1
#define EROSION_TILE_GENERATOR_VERSION 1
#define EROSION_TILE_RESOLUTION 17
#define EROSION_TILE_SAMPLE_COUNT (EROSION_TILE_RESOLUTION * EROSION_TILE_RESOLUTION)
#define EROSION_TILE_FIELD_COUNT 11
#define EROSION_TILE_SIZE 256.0f
#define MATERIAL_TILE_SCHEMA_VERSION 1
#define MATERIAL_TILE_GENERATOR_VERSION 1
#define MATERIAL_TILE_RESOLUTION 17
#define MATERIAL_TILE_SAMPLE_COUNT (MATERIAL_TILE_RESOLUTION * MATERIAL_TILE_RESOLUTION)
#define MATERIAL_TILE_FIELD_COUNT 12
#define MATERIAL_TILE_SIZE 256.0f
#define CAVE_GRAPH_TILE_SCHEMA_VERSION 1
#define CAVE_GRAPH_TILE_GENERATOR_VERSION 1
#define CAVE_GRAPH_TILE_SIZE 256.0f
#define CAVE_GRAPH_MAX_PASSAGES 96
#define CAVE_GRAPH_MAX_CHAMBERS 32
#define CAVE_GRAPH_PASSAGE_FIELD_COUNT 16
#define CAVE_GRAPH_CHAMBER_FIELD_COUNT 7
#define CAVE_GRAPH_KIND_TRUNK 0.0f
#define CAVE_GRAPH_KIND_BRANCH 1.0f
#define CAVE_GRAPH_KIND_SHAFT 2.0f
#define CAVE_GRAPH_HOOK_RIVER_CANYON 0.0f
#define CAVE_GRAPH_HOOK_WET_CAVERN 1.0f
#define CAVE_GRAPH_HOOK_COLD_ALPINE 2.0f
#define CAVE_GRAPH_HOOK_DRY_RIDGE 3.0f

static unsigned char g_vertices[MAX_VERTS * VERTEX_STRIDE]; // u16 local pos, u8 normal/ao/material+masks
static unsigned int g_indices[MAX_INDICES];
static unsigned int g_vertex_count = 0;
static unsigned int g_index_count = 0;
static unsigned int g_overflow = 0;
static float g_pack_origin_x = 0.0f;
static float g_pack_origin_y = 0.0f;
static float g_pack_origin_z = 0.0f;
static int g_lod = 0;
static float g_cell_size = BASE_CELL_SIZE;
static float g_chunk_world_size = BASE_CHUNK_WORLD_SIZE;
static float g_pack_scale = BASE_CHUNK_WORLD_SIZE;
static float g_bounds_min_x = 0.0f;
static float g_bounds_min_y = 0.0f;
static float g_bounds_min_z = 0.0f;
static float g_bounds_max_x = 0.0f;
static float g_bounds_max_y = 0.0f;
static float g_bounds_max_z = 0.0f;
static signed short g_density[GRID_N * GRID_N * GRID_N];
static signed short g_density_scratch[GRID_N * GRID_N * GRID_N];
static float g_density_gradient[GRID_N * GRID_N * GRID_N * 3];
static float g_lod_transition_positions[LOD_TRANSITION_SAMPLE_COUNT * 3];
static float g_lod_transition_densities[LOD_TRANSITION_SAMPLE_COUNT];
static float g_lod_transition_chunk_positions[LOD_TRANSITION_MAX_CHUNK_CELLS * LOD_TRANSITION_SAMPLE_COUNT * 3];
static float g_lod_transition_chunk_densities[LOD_TRANSITION_MAX_CHUNK_CELLS * LOD_TRANSITION_SAMPLE_COUNT];
static int g_lod_transition_chunk_sides[LOD_TRANSITION_MAX_CHUNK_CELLS];
static float g_worldgen_tile_fields[WORLDGEN_TILE_SAMPLE_COUNT * WORLDGEN_TILE_FIELD_COUNT];
static unsigned char g_worldgen_tile_biome_ids[WORLDGEN_TILE_SAMPLE_COUNT];
static unsigned char g_worldgen_tile_water_ids[WORLDGEN_TILE_SAMPLE_COUNT];
static unsigned short g_worldgen_tile_river_ids[WORLDGEN_TILE_SAMPLE_COUNT];
static float g_erosion_tile_fields[EROSION_TILE_SAMPLE_COUNT * EROSION_TILE_FIELD_COUNT];
static float g_material_tile_fields[MATERIAL_TILE_SAMPLE_COUNT * MATERIAL_TILE_FIELD_COUNT];
static unsigned char g_material_tile_ids[MATERIAL_TILE_SAMPLE_COUNT];
static float g_cave_graph_passages[CAVE_GRAPH_MAX_PASSAGES * CAVE_GRAPH_PASSAGE_FIELD_COUNT];
static float g_cave_graph_chambers[CAVE_GRAPH_MAX_CHAMBERS * CAVE_GRAPH_CHAMBER_FIELD_COUNT];
static int g_cave_graph_passage_count = 0;
static int g_cave_graph_chamber_count = 0;
static unsigned int g_edge_x[CHUNK_N * GRID_N * GRID_N];
static unsigned int g_edge_y[GRID_N * CHUNK_N * GRID_N];
static unsigned int g_edge_z[GRID_N * GRID_N * CHUNK_N];

static float g_edit_x[MAX_EDITS];
static float g_edit_y[MAX_EDITS];
static float g_edit_z[MAX_EDITS];
static float g_edit_r[MAX_EDITS];
static float g_edit_dx[MAX_EDITS];
static float g_edit_dy[MAX_EDITS];
static float g_edit_dz[MAX_EDITS];
static float g_edit_length[MAX_EDITS];
static int g_edit_type[MAX_EDITS]; // subtract/carve, add/build, or material paint
static int g_edit_shape[MAX_EDITS];
static int g_edit_material[MAX_EDITS];
static float g_edit_strength[MAX_EDITS];
static float g_edit_falloff[MAX_EDITS];
static int g_edit_count = 0;

static int clamp_lod(int lod) {
    if (lod < 0) return 0;
    if (lod > MAX_LOD) return MAX_LOD;
    return lod;
}

static void configure_lod(int lod) {
    g_lod = clamp_lod(lod);
    g_cell_size = BASE_CELL_SIZE * (float)(1 << g_lod);
    g_chunk_world_size = (float)CHUNK_N * g_cell_size;
}

static float chunk_origin(int c) {
    return (float)c * BASE_CHUNK_WORLD_SIZE;
}

static const int cube_corners[8][3] = {
    {0,0,0}, {1,0,0}, {1,1,0}, {0,1,0},
    {0,0,1}, {1,0,1}, {1,1,1}, {0,1,1}
};

static const int cube_edges[12][2] = {
    {0,1}, {1,2}, {2,3}, {3,0},
    {4,5}, {5,6}, {6,7}, {7,4},
    {0,4}, {1,5}, {2,6}, {3,7}
};

static const int cube_faces[6][4] = {
    {0,1,2,3},
    {4,5,6,7},
    {0,1,5,4},
    {3,2,6,7},
    {0,3,7,4},
    {1,2,6,5}
};

static const int cube_face_edges[6][4] = {
    {0,1,2,3},
    {4,5,6,7},
    {0,9,4,8},
    {2,10,6,11},
    {3,11,7,8},
    {1,10,5,9}
};

static inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline float absf2(float x) { return x < 0.0f ? -x : x; }
static inline float minf2(float a, float b) { return a < b ? a : b; }
static inline float maxf2(float a, float b) { return a > b ? a : b; }
static inline float mixf(float a, float b, float t) { return a + (b - a) * t; }
static inline float smooth(float t) { return t * t * (3.0f - 2.0f * t); }
static inline float smooth_minf(float a, float b, float k) {
    if (k <= 0.0001f) return minf2(a, b);
    float h = clampf(0.5f + 0.5f * (b - a) / k, 0.0f, 1.0f);
    return b + (a - b) * h - k * h * (1.0f - h);
}
static inline float smooth_maxf(float a, float b, float k) {
    return -smooth_minf(-a, -b, k);
}
static inline int fastfloor(float x) { int i = (int)x; return (x < (float)i) ? i - 1 : i; }
static inline int fastceil(float x) { return -fastfloor(-x); }
static inline float sqrtf2(float x) { return __builtin_sqrtf(x); }
static inline float len3(float x, float y, float z) { return sqrtf2(x * x + y * y + z * z); }

static void cross3(float ax, float ay, float az, float bx, float by, float bz, float *ox, float *oy, float *oz) {
    *ox = ay * bz - az * by;
    *oy = az * bx - ax * bz;
    *oz = ax * by - ay * bx;
}

static void normalized_dir(float x, float y, float z, float *ox, float *oy, float *oz) {
    float len = len3(x, y, z);
    if (len <= 0.0001f) {
        *ox = 0.0f;
        *oy = 0.0f;
        *oz = 1.0f;
        return;
    }
    *ox = x / len;
    *oy = y / len;
    *oz = z / len;
}

static unsigned int pack_unorm16(float x) {
    return (unsigned int)(clampf(x, 0.0f, 1.0f) * 65535.0f + 0.5f);
}

static unsigned char pack_unorm8(float x) {
    return (unsigned char)(clampf(x, 0.0f, 1.0f) * 255.0f + 0.5f);
}

static void write_u16(unsigned int offset, unsigned int value) {
    g_vertices[offset] = (unsigned char)(value & 0xffu);
    g_vertices[offset + 1u] = (unsigned char)((value >> 8u) & 0xffu);
}

static unsigned int read_vertex_u16(unsigned int offset) {
    return (unsigned int)g_vertices[offset] | ((unsigned int)g_vertices[offset + 1u] << 8u);
}

static signed short pack_density(float d) {
    float q = clampf(d * DENSITY_SCALE, -32767.0f, 32767.0f);
    return (signed short)(q < 0.0f ? q - 0.5f : q + 0.5f);
}

static float unpack_density(signed short q) {
    return (float)q / DENSITY_SCALE;
}

static unsigned int hash_u32(unsigned int x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

static unsigned int hash2i(int x, int y) {
    unsigned int h = (unsigned int)x * 0x8da6b343u ^ (unsigned int)y * 0xd8163841u;
    return hash_u32(h);
}

static unsigned int hash3i(int x, int y, int z) {
    unsigned int h = (unsigned int)x * 0x8da6b343u ^ (unsigned int)y * 0xd8163841u ^ (unsigned int)z * 0xcb1ab31fu;
    return hash_u32(h);
}

static float hash01(unsigned int h) {
    return (float)(h & 0x00ffffffu) / 16777215.0f;
}

static float value_noise2(float x, float y) {
    int ix = fastfloor(x);
    int iy = fastfloor(y);
    float fx = x - (float)ix;
    float fy = y - (float)iy;
    float sx = smooth(fx);
    float sy = smooth(fy);
    float a = hash01(hash2i(ix, iy));
    float b = hash01(hash2i(ix + 1, iy));
    float c = hash01(hash2i(ix, iy + 1));
    float d = hash01(hash2i(ix + 1, iy + 1));
    return mixf(mixf(a, b, sx), mixf(c, d, sx), sy);
}

static float value_noise3(float x, float y, float z) {
    int ix = fastfloor(x);
    int iy = fastfloor(y);
    int iz = fastfloor(z);
    float fx = x - (float)ix;
    float fy = y - (float)iy;
    float fz = z - (float)iz;
    float sx = smooth(fx);
    float sy = smooth(fy);
    float sz = smooth(fz);
    float c000 = hash01(hash3i(ix, iy, iz));
    float c100 = hash01(hash3i(ix + 1, iy, iz));
    float c010 = hash01(hash3i(ix, iy + 1, iz));
    float c110 = hash01(hash3i(ix + 1, iy + 1, iz));
    float c001 = hash01(hash3i(ix, iy, iz + 1));
    float c101 = hash01(hash3i(ix + 1, iy, iz + 1));
    float c011 = hash01(hash3i(ix, iy + 1, iz + 1));
    float c111 = hash01(hash3i(ix + 1, iy + 1, iz + 1));
    float x00 = mixf(c000, c100, sx);
    float x10 = mixf(c010, c110, sx);
    float x01 = mixf(c001, c101, sx);
    float x11 = mixf(c011, c111, sx);
    return mixf(mixf(x00, x10, sy), mixf(x01, x11, sy), sz);
}

static float fbm2(float x, float y) {
    float sum = 0.0f;
    float amp = 0.5f;
    float freq = 1.0f;
    float norm = 0.0f;
    for (int i = 0; i < 5; ++i) {
        sum += (value_noise2(x * freq, y * freq) * 2.0f - 1.0f) * amp;
        norm += amp;
        amp *= 0.5f;
        freq *= 2.02f;
    }
    return sum / norm;
}

static float ridge2(float x, float y) {
    float n = value_noise2(x, y) * 2.0f - 1.0f;
    float r = 1.0f - absf2(n);
    return r * r;
}

// Fast domain-warped value-noise detail used by the SDF terrain height. This keeps
// generation cheap enough for browser workers while breaking up overly smooth hills.
static float surface_detail_noise(float x, float z) {
    float wx = (value_noise2(x * 0.010f + 123.4f, z * 0.010f - 57.8f) * 2.0f - 1.0f) * 18.0f;
    float wz = (value_noise2(x * 0.010f - 88.2f, z * 0.010f + 19.6f) * 2.0f - 1.0f) * 18.0f;
    float detail = value_noise2((x + wx) * 0.110f, (z + wz) * 0.110f) * 2.0f - 1.0f;
    float crag = ridge2((x + wx) * 0.055f + 17.0f, (z + wz) * 0.055f - 11.0f);
    return detail * 1.15f + crag * 1.45f;
}

static float macro_continent(float x, float z) {
    return fbm2(x * 0.0018f + 19.0f, z * 0.0018f - 4.0f);
}

static float macro_moisture(float x, float z) {
    float storm_track = fbm2(x * 0.0015f - 61.0f, z * 0.0015f + 27.0f);
    float basin = ridge2(x * 0.0030f + 12.0f, z * 0.0030f - 45.0f);
    float rain_shadow = ridge2(x * 0.0022f - 18.0f, z * 0.0022f + 9.0f);
    return clampf(0.52f + storm_track * 0.24f + basin * 0.18f - rain_shadow * 0.12f, 0.0f, 1.0f);
}

static float macro_temperature(float x, float z) {
    float latitude = clampf(absf2(z) * 0.00016f, 0.0f, 0.32f);
    float weather = fbm2(x * 0.0012f + 44.0f, z * 0.0012f - 73.0f);
    float foehn = value_noise2(x * 0.0025f - 33.0f, z * 0.0025f + 16.0f) * 2.0f - 1.0f;
    return clampf(0.58f - latitude + weather * 0.18f + foehn * 0.08f, 0.0f, 1.0f);
}

static float river_center(float z) {
    float n1 = value_noise2(z * 0.010f, 17.3f) * 2.0f - 1.0f;
    float n2 = value_noise2(z * 0.027f + 81.2f, 9.7f) * 2.0f - 1.0f;
    return n1 * 42.0f + n2 * 12.0f;
}

static float terrain_height(float x, float z) {
    float continent = macro_continent(x, z);
    float moisture = macro_moisture(x, z);
    float temperature = macro_temperature(x, z);
    float alpine_lift = clampf((1.0f - temperature) * 0.50f + continent * 0.35f + 0.20f, 0.0f, 1.0f);
    float base = 20.0f + 12.0f * fbm2(x * 0.012f, z * 0.012f) + (moisture - 0.5f) * 4.0f;
    float hills = (8.0f + alpine_lift * 4.0f) * fbm2(x * 0.035f + 5.2f, z * 0.035f - 8.1f);
    float ridge = ridge2(x * 0.010f - 14.0f, z * 0.010f + 6.0f);
    float ridge_mask = clampf((continent + 0.25f) * 1.25f, 0.0f, 1.0f);
    float h = base + hills + ridge * ridge_mask * (36.0f + alpine_lift * 18.0f);

    // Carve a broad cinematic river canyon through the terrain.
    float rc = river_center(z);
    float dist = absf2(x - rc);
    float valley_width = 34.0f + 10.0f * value_noise2(z * 0.018f, 41.0f);
    float canyon = clampf(1.0f - dist / valley_width, 0.0f, 1.0f);
    canyon = smooth(canyon);
    float riverbed = 5.0f + 1.25f * fbm2(x * 0.030f + 77.0f, z * 0.030f);
    h = mixf(h, riverbed, canyon * 0.84f);

    // Add terraces/strata-like ledges near the canyon plus subtle domain-warped
    // surface breakup. Higher-frequency material detail is generated in WGSL.
    float terrace = value_noise2(x * 0.065f, z * 0.065f) * 2.0f - 1.0f;
    h += terrace * canyon * 2.5f;
    float shoulder = smooth(clampf((dist - 16.0f) / 96.0f, 0.0f, 1.0f)) * (1.0f - smooth(clampf((dist - 172.0f) / 260.0f, 0.0f, 1.0f)));
    float side_fold = ridge2((x - rc) * 0.020f + z * 0.005f, z * 0.012f - rc * 0.003f);
    float basin_roll = fbm2((x - rc) * 0.018f + 29.0f, z * 0.018f - 12.0f);
    h += (side_fold * (7.5f + alpine_lift * 5.5f) + basin_roll * 4.0f) * shoulder;

    float exposed = clampf((continent + 0.1f) * 0.8f + ridge_mask * 0.45f, 0.0f, 1.0f);
    h += surface_detail_noise(x, z) * exposed * (1.0f - canyon * 0.55f);
    return h;
}

static float drainage_mask_from_height(float x, float z, float h) {
    float rc = river_center(z);
    float river_dist = absf2(x - rc);
    float valley_width = 46.0f + 18.0f * value_noise2(z * 0.014f + 11.0f, 41.0f);
    float river = smooth(clampf(1.0f - river_dist / 20.0f, 0.0f, 1.0f));
    float valley = smooth(clampf(1.0f - river_dist / valley_width, 0.0f, 1.0f));
    float tributary_warp = (value_noise2(x * 0.006f - 19.0f, z * 0.006f + 34.0f) * 2.0f - 1.0f) * 26.0f;
    float tributary = ridge2((x + tributary_warp) * 0.018f + 33.0f, z * 0.018f - 12.0f);
    float lowland = clampf(1.0f - (h - 10.0f) / 34.0f, 0.0f, 1.0f);
    float moisture = macro_moisture(x, z);
    return clampf(river * 0.82f + valley * lowland * 0.46f + tributary * lowland * (0.22f + moisture * 0.18f) + moisture * lowland * 0.18f, 0.0f, 1.0f);
}

static float erosion_mask_from_height(float x, float z, float h, float ny) {
    float continent = macro_continent(x, z);
    float moisture = macro_moisture(x, z);
    float ridge = ridge2(x * 0.010f - 14.0f, z * 0.010f + 6.0f);
    float ridge_mask = clampf((continent + 0.25f) * 1.25f, 0.0f, 1.0f);
    float steep = clampf(1.0f - ny, 0.0f, 1.0f);
    float exposure = clampf((h - 22.0f) / 45.0f, 0.0f, 1.0f);
    float frost_fracture = ridge2(x * 0.040f + 8.0f, z * 0.040f - 5.0f);
    float wind = value_noise2(x * 0.014f - 23.0f, z * 0.014f + 31.0f) * 2.0f - 1.0f;
    float rain_cut = moisture * ridge2(x * 0.026f - 7.0f, z * 0.026f + 39.0f) * 0.16f;
    return clampf(steep * 0.54f + ridge_mask * ridge * 0.24f + exposure * 0.20f + frost_fracture * 0.12f + rain_cut + wind * 0.06f, 0.0f, 1.0f);
}

static float vegetation_mask_from_fields(float x, float z, float h, float ny, float drainage, float erosion) {
    float rc = river_center(z);
    float river_dist = absf2(x - rc);
    float flat = clampf((ny - 0.44f) / 0.50f, 0.0f, 1.0f);
    float temperature = macro_temperature(x, z);
    float moisture = macro_moisture(x, z);
    float temperate = clampf((1.0f - (h - 42.0f) / 30.0f) * 0.70f + temperature * 0.30f, 0.0f, 1.0f);
    float forest_patch = smooth(value_noise2(x * 0.010f + 61.0f, z * 0.010f - 14.0f));
    float river_bank_penalty = smooth(clampf((river_dist - 12.0f) / 28.0f, 0.0f, 1.0f));
    float erosion_penalty = 1.0f - smooth(clampf((erosion - 0.48f) / 0.36f, 0.0f, 1.0f));
    return clampf((temperate * 0.30f + moisture * 0.20f + drainage * 0.22f + forest_patch * 0.28f) * flat * river_bank_penalty * erosion_penalty, 0.0f, 1.0f);
}

static float biome_mask_from_fields(float x, float z, float h, float ny, float drainage, float erosion, float vegetation) {
    float continent = macro_continent(x, z);
    float moisture = macro_moisture(x, z);
    float temperature = macro_temperature(x, z);
    float ridge_mask = clampf((continent + 0.25f) * 1.25f, 0.0f, 1.0f);
    float highland = clampf((h - 24.0f) / 42.0f, 0.0f, 1.0f);
    float variation = value_noise2(x * 0.0045f - 31.0f, z * 0.0045f + 17.0f) * 2.0f - 1.0f;
    float climate = clampf((1.0f - temperature) * 0.28f + moisture * 0.18f, 0.0f, 1.0f);
    (void)ny;
    (void)drainage;
    return clampf(highland * 0.34f + ridge_mask * 0.22f + erosion * 0.16f + vegetation * 0.18f + climate * 0.18f + variation * 0.10f, 0.0f, 1.0f);
}

static float biome_mask_from_height(float x, float z, float h) {
    float drainage = drainage_mask_from_height(x, z, h);
    float erosion = erosion_mask_from_height(x, z, h, 0.8f);
    float vegetation = vegetation_mask_from_fields(x, z, h, 0.8f, drainage, erosion);
    return biome_mask_from_fields(x, z, h, 0.8f, drainage, erosion, vegetation);
}

static float wetness_mask_from_fields(float x, float y, float z, float ny, float h, float drainage) {
    float rc = river_center(z);
    float river_dist = absf2(x - rc);
    float valley_width = 42.0f + 14.0f * value_noise2(z * 0.018f, 41.0f);
    float river = smooth(clampf(1.0f - river_dist / 18.0f, 0.0f, 1.0f));
    float valley = smooth(clampf(1.0f - river_dist / valley_width, 0.0f, 1.0f));
    float lowland = clampf(1.0f - (y - 7.0f) / 13.0f, 0.0f, 1.0f);
    float seep = smooth(value_noise2(x * 0.022f + 73.0f, z * 0.022f - 29.0f));
    float flat = clampf((ny - 0.28f) / 0.72f, 0.0f, 1.0f);
    float moisture = macro_moisture(x, z);
    (void)h;
    return clampf((river * 0.68f + valley * lowland * 0.30f + valley * seep * 0.14f + drainage * 0.26f + moisture * lowland * 0.24f) * flat, 0.0f, 1.0f);
}

static float wetness_mask_from_height(float x, float y, float z, float ny, float h) {
    float drainage = drainage_mask_from_height(x, z, h);
    return wetness_mask_from_fields(x, y, z, ny, h, drainage);
}

static float snow_mask_from_fields(float x, float y, float z, float ny, float h, float erosion) {
    float temperature = macro_temperature(x, z);
    float elevation = clampf((y - (39.0f + temperature * 10.0f)) / 24.0f, 0.0f, 1.0f);
    float slope = clampf((ny - 0.18f) / 0.72f, 0.0f, 1.0f);
    float wind = value_noise2(x * 0.018f + 7.0f, z * 0.018f - 12.0f) * 2.0f - 1.0f;
    float drift = smooth(clampf(elevation + wind * 0.20f - (1.0f - slope) * 0.24f - erosion * 0.16f, 0.0f, 1.0f));
    (void)h;
    return clampf(drift, 0.0f, 1.0f);
}

static float snow_mask_from_height(float x, float y, float z, float ny, float h) {
    float erosion = erosion_mask_from_height(x, z, h, ny);
    return snow_mask_from_fields(x, y, z, ny, h, erosion);
}

static float material_for(float x, float y, float z, float ny, float h, float wetness, float snow, float erosion);
static float cave_distance(float x, float y, float z);

static float terrain_normal_y(float x, float z) {
    float step = 8.0f;
    float h_l = terrain_height(x - step, z);
    float h_r = terrain_height(x + step, z);
    float h_d = terrain_height(x, z - step);
    float h_u = terrain_height(x, z + step);
    float nx = h_l - h_r;
    float ny = step * 2.0f;
    float nz = h_d - h_u;
    float len = len3(nx, ny, nz);
    return len <= 0.0001f ? 1.0f : ny / len;
}

static void flow_direction(float x, float z, float *ox, float *oz) {
    float step = 8.0f;
    float dx = terrain_height(x - step, z) - terrain_height(x + step, z);
    float dz = terrain_height(x, z - step) - terrain_height(x, z + step);
    float len = sqrtf2(dx * dx + dz * dz);
    if (len <= 0.0001f) {
        *ox = 0.0f;
        *oz = 0.0f;
        return;
    }
    *ox = dx / len;
    *oz = dz / len;
}

static float flow_accumulation_estimate(float x, float z, float h, float ny, float drainage, float wetness) {
    static const float dirs[8][2] = {
        {-1.0f, 0.0f}, {1.0f, 0.0f}, {0.0f, -1.0f}, {0.0f, 1.0f},
        {-1.0f, -1.0f}, {1.0f, -1.0f}, {-1.0f, 1.0f}, {1.0f, 1.0f},
    };
    static const float radii[4] = {24.0f, 48.0f, 96.0f, 160.0f};
    float local = drainage * 0.36f + wetness * 0.18f + (1.0f - ny) * 0.12f;
    float incoming = 0.0f;
    float weight_sum = 0.0f;
    for (int ring = 0; ring < 4; ++ring) {
        float radius = radii[ring];
        float ring_weight = radius == 24.0f ? 0.88f : (radius == 48.0f ? 0.64f : (radius == 96.0f ? 0.42f : 0.26f));
        for (int i = 0; i < 8; ++i) {
            float dx = dirs[i][0];
            float dz = dirs[i][1];
            float len = sqrtf2(dx * dx + dz * dz);
            float sx = x + (dx / len) * radius;
            float sz = z + (dz / len) * radius;
            float source_h = terrain_height(sx, sz);
            float source_ny = terrain_normal_y(sx, sz);
            float source_drainage = drainage_mask_from_height(sx, sz, source_h);
            float source_flow_x, source_flow_z;
            flow_direction(sx, sz, &source_flow_x, &source_flow_z);
            float to_sample_x = (x - sx) / radius;
            float to_sample_z = (z - sz) / radius;
            float alignment = clampf((source_flow_x * to_sample_x + source_flow_z * to_sample_z - 0.18f) / 0.82f, 0.0f, 1.0f);
            float downhill = clampf((source_h - h + radius * 0.025f) / (10.0f + radius * 0.12f), 0.0f, 1.0f);
            float trunk_bias = clampf((64.0f - absf2(sx - river_center(sz))) / 64.0f, 0.0f, 1.0f);
            float source_water = source_drainage * 0.62f + macro_moisture(sx, sz) * 0.22f + (1.0f - source_ny) * 0.16f;
            incoming += (alignment * downhill * source_water + trunk_bias * source_drainage * 0.16f) * ring_weight;
            weight_sum += ring_weight;
        }
    }
    float neighborhood = weight_sum > 0.0f ? incoming / weight_sum : 0.0f;
    return clampf(local + neighborhood * 0.92f, 0.0f, 1.0f);
}

static int drainage_basin_id(float x, float z) {
    int longitudinal = fastfloor((z + 8192.0f) / 512.0f);
    int lateral = fastfloor((river_center(z) + x + 4096.0f) / 128.0f);
    int id = (longitudinal * 257 + lateral * 97) & 0xffff;
    return id == 0 ? 1 : id;
}

static int stream_order_for(float x, float z, float h, float drainage, float flow_accumulation) {
    float main_river = clampf((18.0f - absf2(x - river_center(z))) / 18.0f, 0.0f, 1.0f)
        * clampf((18.0f - h) / 18.0f, 0.0f, 1.0f);
    if (main_river > 0.48f) return 4;
    if (flow_accumulation > 0.88f && drainage > 0.58f) return 3;
    if (flow_accumulation > 0.70f && drainage > 0.50f) return 2;
    if (flow_accumulation > 0.50f && drainage > 0.44f) return 1;
    return 0;
}

static float channel_width_for(int stream_order, float flow_accumulation, float drainage) {
    if (stream_order <= 0) return 0.0f;
    float order = (float)stream_order;
    return 1.5f + order * order * 1.35f + flow_accumulation * 8.0f + drainage * 3.0f;
}

static float stream_power_for(int stream_order, float flow_accumulation, float drainage, float ny) {
    if (stream_order <= 0) return 0.0f;
    return clampf(flow_accumulation * 0.48f + drainage * 0.22f + (1.0f - ny) * 0.20f + (float)stream_order * 0.10f, 0.0f, 1.0f);
}

static void normalize_biome_weights(float weights[6]) {
    float total = weights[0] + weights[1] + weights[2] + weights[3] + weights[4] + weights[5];
    if (total < 0.0001f) total = 0.0001f;
    for (int i = 0; i < 6; ++i) weights[i] = weights[i] / total;
}

static void biome_weights_from_fields(float h, float ny, float moisture, float temperature, float drainage, float erosion, float vegetation, float weights[6]) {
    float river_valley = clampf((drainage - 0.52f) / 0.34f, 0.0f, 1.0f) * clampf((18.0f - h) / 18.0f, 0.0f, 1.0f);
    float alpine_snow = clampf((h - 38.0f) / 28.0f, 0.0f, 1.0f) * clampf((0.56f - temperature) / 0.34f, 0.0f, 1.0f);
    float exposed_ridge = clampf((erosion - 0.34f) / 0.48f, 0.0f, 1.0f) * 0.65f + clampf((0.58f - ny) / 0.44f, 0.0f, 1.0f) * 0.35f;
    float forest_edge = clampf((vegetation - 0.22f) / 0.48f, 0.0f, 1.0f) * clampf((moisture - 0.34f) / 0.42f, 0.0f, 1.0f);
    float dry_slope = clampf((0.46f - moisture) / 0.38f, 0.0f, 1.0f) * clampf((0.42f - drainage) / 0.42f, 0.0f, 1.0f) * clampf((h - 14.0f) / 30.0f, 0.0f, 1.0f);
    float occupied = maxf2(river_valley, maxf2(alpine_snow, maxf2(exposed_ridge, maxf2(forest_edge, dry_slope))));
    weights[0] = maxf2(0.12f, 1.0f - occupied);
    weights[1] = river_valley;
    weights[2] = alpine_snow;
    weights[3] = exposed_ridge;
    weights[4] = forest_edge;
    weights[5] = dry_slope;
    normalize_biome_weights(weights);
}

static void normalize_material_weights(float weights[4]) {
    float total = weights[0] + weights[1] + weights[2] + weights[3];
    if (total < 0.0001f) total = 0.0001f;
    for (int i = 0; i < 4; ++i) weights[i] = weights[i] / total;
}

static void material_weights_from_fields(float material, float ny, float wetness, float snow, float drainage, float erosion, float vegetation, float weights[4]) {
    int material_id = (int)(material + 0.5f);
    if (material_id < 0) material_id = 0;
    if (material_id > 3) material_id = 3;
    float steep_rock = clampf((0.66f - ny) / 0.48f, 0.0f, 1.0f);
    float rock = (material_id == 1 ? 0.72f : 0.08f) + erosion * 0.46f + steep_rock * 0.34f;
    float snow_weight = (material_id == 2 ? 0.76f : 0.04f) + snow * 0.74f + clampf((ny - 0.35f) / 0.65f, 0.0f, 1.0f) * snow * 0.20f;
    float mud = (material_id == 3 ? 0.76f : 0.04f) + wetness * 0.48f + drainage * 0.22f;
    float grass = (material_id == 0 ? 0.72f : 0.08f) + vegetation * 0.42f + clampf(ny - 0.28f, 0.0f, 1.0f) * (1.0f - snow * 0.55f) * 0.20f;
    weights[0] = grass * (1.0f - snow * 0.42f) * (1.0f - steep_rock * 0.30f);
    weights[1] = rock * (1.0f - wetness * 0.18f);
    weights[2] = snow_weight * (1.0f - drainage * 0.16f);
    weights[3] = mud * (1.0f - snow * 0.28f);
    normalize_material_weights(weights);
}

static int dominant_biome_id(float weights[6]) {
    int best = 0;
    for (int i = 1; i < 6; ++i) {
        if (weights[i] > weights[best]) best = i;
    }
    return best;
}

static int water_id_for(float x, float z, float h, float drainage) {
    float dist = absf2(x - river_center(z));
    if (dist < 10.0f && h < 12.0f) return 1;
    if (drainage > 0.74f && h < 10.5f) return 2;
    return 0;
}

static int network_water_id_for(float x, float z, float h, float drainage, int stream_order, float channel_width) {
    if (stream_order >= 3 || channel_width >= 12.0f) return 1;
    if (stream_order > 0 && h < 20.0f) return 1;
    return water_id_for(x, z, h, drainage);
}

static unsigned short river_network_id_for(float x, float z, int water_id, float flow_accumulation, int basin_id, int stream_order) {
    if (water_id == 0 && stream_order <= 0 && flow_accumulation < 0.72f) return 0;
    int channel = fastfloor((river_center(z) + x + 4096.0f) / 48.0f);
    int id = (basin_id * 131 + channel * 17 + stream_order * 4099) & 0xffff;
    return (unsigned short)(id == 0 ? 1 : id);
}

static void write_worldgen_tile_sample(int ix, int iz, float origin_x, float origin_z) {
    float stride = WORLDGEN_TILE_SIZE / (float)(WORLDGEN_TILE_RESOLUTION - 1);
    float x = origin_x + (float)ix * stride;
    float z = origin_z + (float)iz * stride;
    float h = terrain_height(x, z);
    float ny = terrain_normal_y(x, z);
    float continent = macro_continent(x, z);
    float moisture = macro_moisture(x, z);
    float temperature = macro_temperature(x, z);
    float drainage = drainage_mask_from_height(x, z, h);
    float erosion = erosion_mask_from_height(x, z, h, ny);
    float vegetation = vegetation_mask_from_fields(x, z, h, ny, drainage, erosion);
    float biome = biome_mask_from_fields(x, z, h, ny, drainage, erosion, vegetation);
    float wetness = wetness_mask_from_fields(x, h, z, ny, h, drainage);
    float snow = snow_mask_from_fields(x, h, z, ny, h, erosion);
    float material = material_for(x, h, z, ny, h, wetness, snow, erosion);
    float flow_x, flow_z;
    float weights[6];
    float material_weights[4];
    flow_direction(x, z, &flow_x, &flow_z);
    float flow_accumulation = flow_accumulation_estimate(x, z, h, ny, drainage, wetness);
    int basin_id = drainage_basin_id(x, z);
    int stream_order = stream_order_for(x, z, h, drainage, flow_accumulation);
    float channel_width = channel_width_for(stream_order, flow_accumulation, drainage);
    float stream_power = stream_power_for(stream_order, flow_accumulation, drainage, ny);
    biome_weights_from_fields(h, ny, moisture, temperature, drainage, erosion, vegetation, weights);
    material_weights_from_fields(material, ny, wetness, snow, drainage, erosion, vegetation, material_weights);
    float surface_cave_distance = cave_distance(x, h - 8.0f, z);
    float cave_influence = clampf((20.0f - absf2(surface_cave_distance)) / 20.0f, 0.0f, 1.0f);

    int sample = ix + WORLDGEN_TILE_RESOLUTION * iz;
    int base = sample * WORLDGEN_TILE_FIELD_COUNT;
    g_worldgen_tile_fields[base + 0] = h;
    g_worldgen_tile_fields[base + 1] = continent;
    g_worldgen_tile_fields[base + 2] = moisture;
    g_worldgen_tile_fields[base + 3] = temperature;
    g_worldgen_tile_fields[base + 4] = drainage;
    g_worldgen_tile_fields[base + 5] = erosion;
    g_worldgen_tile_fields[base + 6] = vegetation;
    g_worldgen_tile_fields[base + 7] = biome;
    g_worldgen_tile_fields[base + 8] = wetness;
    g_worldgen_tile_fields[base + 9] = snow;
    g_worldgen_tile_fields[base + 10] = ny;
    g_worldgen_tile_fields[base + 11] = river_center(z);
    g_worldgen_tile_fields[base + 12] = material;
    g_worldgen_tile_fields[base + 13] = flow_x;
    g_worldgen_tile_fields[base + 14] = flow_z;
    g_worldgen_tile_fields[base + 15] = flow_accumulation;
    for (int i = 0; i < 6; ++i) g_worldgen_tile_fields[base + 16 + i] = weights[i];
    for (int i = 0; i < 4; ++i) g_worldgen_tile_fields[base + 22 + i] = material_weights[i];
    g_worldgen_tile_fields[base + 26] = surface_cave_distance;
    g_worldgen_tile_fields[base + 27] = cave_influence;
    g_worldgen_tile_fields[base + 28] = (float)basin_id;
    g_worldgen_tile_fields[base + 29] = (float)stream_order;
    g_worldgen_tile_fields[base + 30] = channel_width;
    g_worldgen_tile_fields[base + 31] = stream_power;

    int water_id = network_water_id_for(x, z, h, drainage, stream_order, channel_width);
    g_worldgen_tile_biome_ids[sample] = (unsigned char)dominant_biome_id(weights);
    g_worldgen_tile_water_ids[sample] = (unsigned char)water_id;
    g_worldgen_tile_river_ids[sample] = river_network_id_for(x, z, water_id, flow_accumulation, basin_id, stream_order);
}

int generate_worldgen_tile(int tile_x, int tile_z) {
    float origin_x = (float)tile_x * WORLDGEN_TILE_SIZE;
    float origin_z = (float)tile_z * WORLDGEN_TILE_SIZE;
    for (int iz = 0; iz < WORLDGEN_TILE_RESOLUTION; ++iz) {
        for (int ix = 0; ix < WORLDGEN_TILE_RESOLUTION; ++ix) {
            write_worldgen_tile_sample(ix, iz, origin_x, origin_z);
        }
    }
    return WORLDGEN_TILE_SAMPLE_COUNT;
}

static float erosion_tile_local_relief(float x, float z, float h) {
    float min_h = h;
    float max_h = h;
    const float offsets[8][2] = {
        {-24.0f, 0.0f}, {24.0f, 0.0f}, {0.0f, -24.0f}, {0.0f, 24.0f},
        {-17.0f, -17.0f}, {17.0f, -17.0f}, {-17.0f, 17.0f}, {17.0f, 17.0f}
    };
    for (int i = 0; i < 8; ++i) {
        float sh = terrain_height(x + offsets[i][0], z + offsets[i][1]);
        min_h = minf2(min_h, sh);
        max_h = maxf2(max_h, sh);
    }
    return clampf((max_h - min_h) / 42.0f, 0.0f, 1.0f);
}

static float erosion_tile_stream_power(float x, float z, float h, float ny, float drainage, float wetness) {
    float moisture = macro_moisture(x, z);
    float slope = clampf(1.0f - ny, 0.0f, 1.0f);
    float river_influence = clampf((42.0f - absf2(x - river_center(z))) / 42.0f, 0.0f, 1.0f)
        * clampf((22.0f - h) / 22.0f, 0.0f, 1.0f);
    return clampf(drainage * 0.42f + wetness * 0.18f + moisture * 0.12f + slope * 0.22f + river_influence * 0.06f, 0.0f, 1.0f);
}

static void write_erosion_tile_sample(int ix, int iz, float origin_x, float origin_z) {
    float stride = EROSION_TILE_SIZE / (float)(EROSION_TILE_RESOLUTION - 1);
    float x = origin_x + (float)ix * stride;
    float z = origin_z + (float)iz * stride;
    float h = terrain_height(x, z);
    float ny = terrain_normal_y(x, z);
    float slope = clampf(1.0f - ny, 0.0f, 1.0f);
    float drainage = drainage_mask_from_height(x, z, h);
    float wetness = wetness_mask_from_fields(x, h, z, ny, h, drainage);
    float heuristic_erosion = erosion_mask_from_height(x, z, h, ny);
    float relief = erosion_tile_local_relief(x, z, h);
    float vegetation = vegetation_mask_from_fields(x, z, h, ny, drainage, heuristic_erosion);
    float stream_power = erosion_tile_stream_power(x, z, h, ny, drainage, wetness);
    float thermal_erosion = clampf(slope * 0.62f + relief * 0.30f + heuristic_erosion * 0.18f, 0.0f, 1.0f);
    float hydraulic_erosion = clampf(stream_power * 0.58f + drainage * wetness * 0.34f + relief * drainage * 0.16f, 0.0f, 1.0f);
    float sediment_load = clampf(thermal_erosion * 0.42f + hydraulic_erosion * 0.50f + stream_power * 0.22f, 0.0f, 1.0f);
    float deposition = clampf((1.0f - slope) * drainage * 0.42f + wetness * 0.30f + (1.0f - stream_power) * sediment_load * 0.36f, 0.0f, 1.0f);
    float bedrock_exposure = clampf(thermal_erosion * 0.48f + hydraulic_erosion * 0.34f + slope * 0.28f - deposition * 0.30f, 0.0f, 1.0f);
    float soil_depth = clampf(deposition * 0.58f + vegetation * 0.30f + (1.0f - bedrock_exposure) * 0.24f, 0.0f, 1.0f);
    float vegetation_retention = clampf(vegetation * 0.54f + soil_depth * 0.36f - stream_power * 0.16f - thermal_erosion * 0.12f, 0.0f, 1.0f);
    int sample = ix + EROSION_TILE_RESOLUTION * iz;
    int base = sample * EROSION_TILE_FIELD_COUNT;
    g_erosion_tile_fields[base + 0] = h;
    g_erosion_tile_fields[base + 1] = slope;
    g_erosion_tile_fields[base + 2] = drainage;
    g_erosion_tile_fields[base + 3] = stream_power;
    g_erosion_tile_fields[base + 4] = thermal_erosion;
    g_erosion_tile_fields[base + 5] = hydraulic_erosion;
    g_erosion_tile_fields[base + 6] = deposition;
    g_erosion_tile_fields[base + 7] = sediment_load;
    g_erosion_tile_fields[base + 8] = bedrock_exposure;
    g_erosion_tile_fields[base + 9] = soil_depth;
    g_erosion_tile_fields[base + 10] = vegetation_retention;
}

int generate_erosion_tile(int tile_x, int tile_z) {
    float origin_x = (float)tile_x * EROSION_TILE_SIZE;
    float origin_z = (float)tile_z * EROSION_TILE_SIZE;
    for (int iz = 0; iz < EROSION_TILE_RESOLUTION; ++iz) {
        for (int ix = 0; ix < EROSION_TILE_RESOLUTION; ++ix) {
            write_erosion_tile_sample(ix, iz, origin_x, origin_z);
        }
    }
    return EROSION_TILE_SAMPLE_COUNT;
}

static float smoothstepf(float edge0, float edge1, float value) {
    float t = clampf((value - edge0) / maxf2(edge1 - edge0, 0.0001f), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

static int dominant_material_id(float weights[4], float *top, float *second) {
    int best = 0;
    int runner_up = 1;
    for (int i = 1; i < 4; ++i) {
        if (weights[i] > weights[best]) {
            runner_up = best;
            best = i;
        } else if (i != best && weights[i] > weights[runner_up]) {
            runner_up = i;
        }
    }
    if (top) *top = weights[best];
    if (second) *second = weights[runner_up];
    return best;
}

static void write_material_tile_sample(int ix, int iz, float origin_x, float origin_z) {
    float stride = MATERIAL_TILE_SIZE / (float)(MATERIAL_TILE_RESOLUTION - 1);
    float x = origin_x + (float)ix * stride;
    float z = origin_z + (float)iz * stride;
    float h = terrain_height(x, z);
    float ny = terrain_normal_y(x, z);
    float slope = clampf(1.0f - ny, 0.0f, 1.0f);
    float moisture = macro_moisture(x, z);
    float drainage = drainage_mask_from_height(x, z, h);
    float heuristic_erosion = erosion_mask_from_height(x, z, h, ny);
    float vegetation = vegetation_mask_from_fields(x, z, h, ny, drainage, heuristic_erosion);
    float wetness_mask = wetness_mask_from_fields(x, h, z, ny, h, drainage);
    float snow = snow_mask_from_fields(x, h, z, ny, h, heuristic_erosion);
    float material = material_for(x, h, z, ny, h, wetness_mask, snow, heuristic_erosion);
    float base_weights[4];
    material_weights_from_fields(material, ny, wetness_mask, snow, drainage, heuristic_erosion, vegetation, base_weights);

    float relief = erosion_tile_local_relief(x, z, h);
    float stream_power = erosion_tile_stream_power(x, z, h, ny, drainage, wetness_mask);
    float thermal_erosion = clampf(slope * 0.62f + relief * 0.30f + heuristic_erosion * 0.18f, 0.0f, 1.0f);
    float hydraulic_erosion = clampf(stream_power * 0.58f + drainage * wetness_mask * 0.34f + relief * drainage * 0.16f, 0.0f, 1.0f);
    float sediment_load = clampf(thermal_erosion * 0.42f + hydraulic_erosion * 0.50f + stream_power * 0.22f, 0.0f, 1.0f);
    float deposition = clampf((1.0f - slope) * drainage * 0.42f + wetness_mask * 0.30f + (1.0f - stream_power) * sediment_load * 0.36f, 0.0f, 1.0f);
    float bedrock_exposure = clampf(thermal_erosion * 0.48f + hydraulic_erosion * 0.34f + slope * 0.28f - deposition * 0.30f, 0.0f, 1.0f);
    float soil_depth = clampf(deposition * 0.58f + vegetation * 0.30f + (1.0f - bedrock_exposure) * 0.24f, 0.0f, 1.0f);
    float vegetation_retention = clampf(vegetation * 0.54f + soil_depth * 0.36f - stream_power * 0.16f - thermal_erosion * 0.12f, 0.0f, 1.0f);

    float flow_accumulation = flow_accumulation_estimate(x, z, h, ny, drainage, wetness_mask);
    int stream_order = stream_order_for(x, z, h, drainage, flow_accumulation);
    float channel_width = channel_width_for(stream_order, flow_accumulation, drainage);
    int water_id = network_water_id_for(x, z, h, drainage, stream_order, channel_width);
    float world_stream_power = stream_power_for(stream_order, flow_accumulation, drainage, ny);
    float river_distance = absf2(x - river_center(z));
    float half_channel = maxf2(2.0f, channel_width * 0.5f);
    float shoreline_width = maxf2(8.0f, channel_width * 0.75f + 8.0f);
    float bank_distance = absf2(river_distance - half_channel);
    float stream_active = (stream_order > 0 || water_id > 0 || channel_width > 2.5f) ? 1.0f : 0.0f;
    float channel_edge = stream_active > 0.5f ? 1.0f - smoothstepf(0.0f, shoreline_width, bank_distance) : 0.0f;
    float water_margin = water_id > 0
        ? 1.0f
        : smoothstepf(0.08f, 0.72f, drainage) * smoothstepf(0.10f, 0.68f, wetness_mask);
    float shoreline = clampf(maxf2(channel_edge * 0.55f, water_margin * smoothstepf(0.55f, 0.95f, world_stream_power)), 0.0f, 1.0f);

    float surface_cave_distance = cave_distance(x, h - 8.0f, z);
    float cave_at_surface = cave_distance(x, h - 6.0f, z);
    float cave_influence = clampf((20.0f - absf2(surface_cave_distance)) / 20.0f, 0.0f, 1.0f);
    float cave_surface = clampf(maxf2(
        maxf2(cave_influence, 1.0f - minf2(absf2(surface_cave_distance) / 52.0f, 1.0f)),
        1.0f - minf2(absf2(cave_at_surface) / 38.0f, 1.0f)
    ), 0.0f, 1.0f);

    float wetness = clampf(wetness_mask * 0.56f + drainage * 0.20f + deposition * 0.12f + shoreline * 0.22f, 0.0f, 1.0f);
    float roughness = clampf(
        slope * 0.38f
        + bedrock_exposure * 0.23f
        + thermal_erosion * 0.14f
        + hydraulic_erosion * 0.10f
        + heuristic_erosion * 0.10f
        + cave_surface * 0.12f,
        0.0f, 1.0f
    );
    float fertility = clampf(
        vegetation * 0.34f
        + soil_depth * 0.26f
        + vegetation_retention * 0.24f
        + moisture * 0.10f
        + wetness * 0.08f
        - bedrock_exposure * 0.18f
        - slope * 0.08f,
        0.0f, 1.0f
    );
    float stability = clampf(
        1.02f
        - hydraulic_erosion * 0.24f
        - thermal_erosion * 0.18f
        - sediment_load * 0.10f
        - stream_power * 0.20f
        - slope * 0.16f
        - cave_surface * 0.16f
        + soil_depth * 0.08f,
        0.0f, 1.0f
    );

    float weights[4];
    weights[0] = base_weights[0] + fertility * 0.13f + vegetation_retention * 0.07f - slope * 0.05f;
    weights[1] = base_weights[1] + bedrock_exposure * 0.16f + slope * 0.12f + cave_surface * 0.18f;
    weights[2] = base_weights[2] + snow * 0.16f + smoothstepf(90.0f, 170.0f, h) * 0.06f - wetness * 0.03f;
    weights[3] = base_weights[3] + wetness * 0.12f + shoreline * 0.18f + deposition * 0.07f;
    for (int i = 0; i < 4; ++i) weights[i] = maxf2(0.0f, weights[i]);
    normalize_material_weights(weights);
    float top = 0.0f;
    float second = 0.0f;
    int material_id = dominant_material_id(weights, &top, &second);
    float route_cost = clampf(
        roughness * 0.28f
        + (1.0f - stability) * 0.24f
        + weights[3] * 0.16f
        + weights[2] * 0.11f
        + shoreline * 0.12f
        + cave_surface * 0.09f
        + stream_power * 0.12f
        - fertility * 0.05f,
        0.0f, 1.0f
    );
    float blend_confidence = clampf(0.42f + (top - second) * 1.45f + stability * 0.10f - cave_surface * 0.08f, 0.0f, 1.0f);

    int sample = ix + MATERIAL_TILE_RESOLUTION * iz;
    int base = sample * MATERIAL_TILE_FIELD_COUNT;
    g_material_tile_fields[base + 0] = weights[0];
    g_material_tile_fields[base + 1] = weights[1];
    g_material_tile_fields[base + 2] = weights[2];
    g_material_tile_fields[base + 3] = weights[3];
    g_material_tile_fields[base + 4] = wetness;
    g_material_tile_fields[base + 5] = roughness;
    g_material_tile_fields[base + 6] = fertility;
    g_material_tile_fields[base + 7] = stability;
    g_material_tile_fields[base + 8] = shoreline;
    g_material_tile_fields[base + 9] = cave_surface;
    g_material_tile_fields[base + 10] = route_cost;
    g_material_tile_fields[base + 11] = blend_confidence;
    g_material_tile_ids[sample] = (unsigned char)material_id;
}

int generate_material_tile(int tile_x, int tile_z) {
    float origin_x = (float)tile_x * MATERIAL_TILE_SIZE;
    float origin_z = (float)tile_z * MATERIAL_TILE_SIZE;
    for (int iz = 0; iz < MATERIAL_TILE_RESOLUTION; ++iz) {
        for (int ix = 0; ix < MATERIAL_TILE_RESOLUTION; ++ix) {
            write_material_tile_sample(ix, iz, origin_x, origin_z);
        }
    }
    return MATERIAL_TILE_SAMPLE_COUNT;
}

static float capsule_sdf_local(float px, float py, float pz, float dx, float dy, float dz, float length, float radius) {
    float nx, ny, nz;
    normalized_dir(dx, dy, dz, &nx, &ny, &nz);
    float half_len = maxf2(length, 0.0f) * 0.5f;
    float h = clampf(px * nx + py * ny + pz * nz, -half_len, half_len);
    float qx = px - nx * h;
    float qy = py - ny * h;
    float qz = pz - nz * h;
    return len3(qx, qy, qz) - radius;
}

static float cave_trunk_distance(float x, float y, float z) {
    float cx = river_center(z + 95.0f) + (value_noise2(z * 0.018f, 101.1f) * 2.0f - 1.0f) * 14.0f;
    float cy = 1.5f + (value_noise2(z * 0.020f + 13.0f, 52.2f) * 2.0f - 1.0f) * 8.0f;
    float radius = 5.0f + 3.0f * value_noise2(z * 0.033f + 7.0f, 33.7f);
    float dx = x - cx;
    float dy = y - cy;
    float tube = sqrtf2(dx * dx + dy * dy) - radius;

    float chamber_noise = value_noise3(x * 0.030f + 5.0f, y * 0.030f - 8.0f, z * 0.030f + 2.0f);
    float chamber = 1.0f - chamber_noise;
    float widen = clampf((chamber - 0.62f) * 3.0f, 0.0f, 1.0f) * 5.0f;
    return tube - widen;
}

static float cave_branch_distance(float x, float y, float z, int branch_cell) {
    float cell = (float)branch_cell;
    float branch_z = cell * 128.0f + (value_noise2(cell * 0.73f, 12.0f) * 2.0f - 1.0f) * 18.0f;
    float side = value_noise2(cell * 1.17f + 5.0f, 23.0f) > 0.5f ? 1.0f : -1.0f;
    float branch_cx = river_center(branch_z + 95.0f) + (value_noise2(branch_z * 0.018f, 101.1f) * 2.0f - 1.0f) * 14.0f;
    float branch_cy = 0.5f + (value_noise2(branch_z * 0.020f + 13.0f, 52.2f) * 2.0f - 1.0f) * 7.0f;
    float branch_radius = 2.8f + 1.6f * value_noise2(cell * 0.41f - 8.0f, 19.0f);

    float center_x = branch_cx + side * 38.0f;
    float branch = capsule_sdf_local(
        x - center_x,
        y - branch_cy,
        z - branch_z,
        side,
        0.04f,
        0.16f,
        96.0f,
        branch_radius
    );

    float end_x = branch_cx + side * 86.0f;
    float end_y = branch_cy + 1.5f;
    float chamber_radius = 5.5f + 3.0f * value_noise2(cell * 0.29f, 31.0f);
    float chamber = len3(x - end_x, (y - end_y) * 0.75f, z - branch_z) - chamber_radius;
    float cave = smooth_minf(branch, chamber, 6.0f);

    if (value_noise2(cell * 0.19f, 55.0f) > 0.55f) {
        float shaft = capsule_sdf_local(
            x - end_x,
            y - (end_y + 9.0f),
            z - branch_z,
            0.10f,
            1.0f,
            0.05f,
            28.0f,
            2.2f
        );
        cave = smooth_minf(cave, shaft, 3.5f);
    }

    return cave;
}

static float cave_distance(float x, float y, float z) {
    float cave = cave_trunk_distance(x, y, z);
    int branch_cell = fastfloor((z + 64.0f) / 128.0f);
    for (int offset = -1; offset <= 1; ++offset) {
        cave = smooth_minf(cave, cave_branch_distance(x, y, z, branch_cell + offset), 6.0f);
    }
    return cave;
}

static float cave_graph_biome_hook(float x, float y, float z) {
    float moisture = macro_moisture(x, z);
    float temperature = macro_temperature(x, z);
    float height = terrain_height(x, z);
    if (absf2(x - river_center(z)) < 28.0f && y < 8.0f) return CAVE_GRAPH_HOOK_RIVER_CANYON;
    if (moisture > 0.58f && y < height - 10.0f) return CAVE_GRAPH_HOOK_WET_CAVERN;
    if (temperature < 0.46f || height > 48.0f) return CAVE_GRAPH_HOOK_COLD_ALPINE;
    return CAVE_GRAPH_HOOK_DRY_RIDGE;
}

static void cave_graph_trunk_point(float z, float *x, float *y, float *radius) {
    *x = river_center(z + 95.0f) + (value_noise2(z * 0.018f, 101.1f) * 2.0f - 1.0f) * 14.0f;
    *y = 1.5f + (value_noise2(z * 0.020f + 13.0f, 52.2f) * 2.0f - 1.0f) * 8.0f;
    *radius = 5.0f + 3.0f * value_noise2(z * 0.033f + 7.0f, 33.7f);
}

static int cave_graph_segment_intersects_tile(
    float ax,
    float az,
    float bx,
    float bz,
    float min_x,
    float max_x,
    float min_z,
    float max_z,
    float margin
) {
    float sx0 = minf2(ax, bx) - margin;
    float sx1 = maxf2(ax, bx) + margin;
    float sz0 = minf2(az, bz) - margin;
    float sz1 = maxf2(az, bz) + margin;
    return sx1 >= min_x && sx0 <= max_x && sz1 >= min_z && sz0 <= max_z;
}

static int cave_graph_point_intersects_tile(
    float x,
    float z,
    float radius,
    float min_x,
    float max_x,
    float min_z,
    float max_z
) {
    return x + radius >= min_x && x - radius <= max_x && z + radius >= min_z && z - radius <= max_z;
}

static void cave_graph_write_passage(
    float kind,
    float id_value,
    float branch_cell,
    float start_x,
    float start_y,
    float start_z,
    float end_x,
    float end_y,
    float end_z,
    float center_x,
    float center_y,
    float center_z,
    float radius,
    float length,
    float chamber_cell,
    float biome_hook
) {
    if (g_cave_graph_passage_count >= CAVE_GRAPH_MAX_PASSAGES) return;
    int base = g_cave_graph_passage_count * CAVE_GRAPH_PASSAGE_FIELD_COUNT;
    g_cave_graph_passages[base + 0] = kind;
    g_cave_graph_passages[base + 1] = id_value;
    g_cave_graph_passages[base + 2] = branch_cell;
    g_cave_graph_passages[base + 3] = start_x;
    g_cave_graph_passages[base + 4] = start_y;
    g_cave_graph_passages[base + 5] = start_z;
    g_cave_graph_passages[base + 6] = end_x;
    g_cave_graph_passages[base + 7] = end_y;
    g_cave_graph_passages[base + 8] = end_z;
    g_cave_graph_passages[base + 9] = center_x;
    g_cave_graph_passages[base + 10] = center_y;
    g_cave_graph_passages[base + 11] = center_z;
    g_cave_graph_passages[base + 12] = radius;
    g_cave_graph_passages[base + 13] = length;
    g_cave_graph_passages[base + 14] = chamber_cell;
    g_cave_graph_passages[base + 15] = biome_hook;
    g_cave_graph_passage_count++;
}

static void cave_graph_write_chamber(
    float branch_cell,
    float center_x,
    float center_y,
    float center_z,
    float radius,
    float has_shaft,
    float biome_hook
) {
    if (g_cave_graph_chamber_count >= CAVE_GRAPH_MAX_CHAMBERS) return;
    int base = g_cave_graph_chamber_count * CAVE_GRAPH_CHAMBER_FIELD_COUNT;
    g_cave_graph_chambers[base + 0] = branch_cell;
    g_cave_graph_chambers[base + 1] = center_x;
    g_cave_graph_chambers[base + 2] = center_y;
    g_cave_graph_chambers[base + 3] = center_z;
    g_cave_graph_chambers[base + 4] = radius;
    g_cave_graph_chambers[base + 5] = has_shaft;
    g_cave_graph_chambers[base + 6] = biome_hook;
    g_cave_graph_chamber_count++;
}

static void cave_graph_branch_metadata(
    int branch_cell,
    float *branch_z,
    float *side,
    float *branch_cx,
    float *branch_cy,
    float *branch_radius,
    float *branch_center_x,
    float *branch_center_y,
    float *branch_center_z,
    float *branch_start_x,
    float *branch_start_y,
    float *branch_start_z,
    float *branch_end_x,
    float *branch_end_y,
    float *branch_end_z,
    float *end_x,
    float *end_y,
    float *end_z,
    float *chamber_radius,
    float *has_shaft,
    float *shaft_center_x,
    float *shaft_center_y,
    float *shaft_center_z,
    float *shaft_start_x,
    float *shaft_start_y,
    float *shaft_start_z,
    float *shaft_end_x,
    float *shaft_end_y,
    float *shaft_end_z
) {
    float cell = (float)branch_cell;
    *branch_z = cell * 128.0f + (value_noise2(cell * 0.73f, 12.0f) * 2.0f - 1.0f) * 18.0f;
    *side = value_noise2(cell * 1.17f + 5.0f, 23.0f) > 0.5f ? 1.0f : -1.0f;
    *branch_cx = river_center(*branch_z + 95.0f) + (value_noise2(*branch_z * 0.018f, 101.1f) * 2.0f - 1.0f) * 14.0f;
    *branch_cy = 0.5f + (value_noise2(*branch_z * 0.020f + 13.0f, 52.2f) * 2.0f - 1.0f) * 7.0f;
    *branch_radius = 2.8f + 1.6f * value_noise2(cell * 0.41f - 8.0f, 19.0f);
    *branch_center_x = *branch_cx + *side * 38.0f;
    *branch_center_y = *branch_cy;
    *branch_center_z = *branch_z;

    float dir_x, dir_y, dir_z;
    normalized_dir(*side, 0.04f, 0.16f, &dir_x, &dir_y, &dir_z);
    *branch_start_x = *branch_center_x - dir_x * 48.0f;
    *branch_start_y = *branch_center_y - dir_y * 48.0f;
    *branch_start_z = *branch_center_z - dir_z * 48.0f;
    *branch_end_x = *branch_center_x + dir_x * 48.0f;
    *branch_end_y = *branch_center_y + dir_y * 48.0f;
    *branch_end_z = *branch_center_z + dir_z * 48.0f;

    *end_x = *branch_cx + *side * 86.0f;
    *end_y = *branch_cy + 1.5f;
    *end_z = *branch_z;
    *chamber_radius = 5.5f + 3.0f * value_noise2(cell * 0.29f, 31.0f);
    *has_shaft = value_noise2(cell * 0.19f, 55.0f) > 0.55f ? 1.0f : 0.0f;
    *shaft_center_x = *end_x;
    *shaft_center_y = *end_y + 9.0f;
    *shaft_center_z = *end_z;

    float shaft_dir_x, shaft_dir_y, shaft_dir_z;
    normalized_dir(0.10f, 1.0f, 0.05f, &shaft_dir_x, &shaft_dir_y, &shaft_dir_z);
    *shaft_start_x = *shaft_center_x - shaft_dir_x * 14.0f;
    *shaft_start_y = *shaft_center_y - shaft_dir_y * 14.0f;
    *shaft_start_z = *shaft_center_z - shaft_dir_z * 14.0f;
    *shaft_end_x = *shaft_center_x + shaft_dir_x * 14.0f;
    *shaft_end_y = *shaft_center_y + shaft_dir_y * 14.0f;
    *shaft_end_z = *shaft_center_z + shaft_dir_z * 14.0f;
}

int generate_cave_graph_tile(int tile_x, int tile_z) {
    float origin_x = (float)tile_x * CAVE_GRAPH_TILE_SIZE;
    float origin_z = (float)tile_z * CAVE_GRAPH_TILE_SIZE;
    float min_x = origin_x;
    float max_x = origin_x + CAVE_GRAPH_TILE_SIZE;
    float min_z = origin_z;
    float max_z = origin_z + CAVE_GRAPH_TILE_SIZE;
    float margin = 48.0f;
    g_cave_graph_passage_count = 0;
    g_cave_graph_chamber_count = 0;

    float trunk_start_z = (float)fastfloor((min_z - margin) / 64.0f) * 64.0f;
    float trunk_end_z = max_z + margin;
    for (float z = trunk_start_z; z <= trunk_end_z; z += 64.0f) {
        float ax, ay, ar;
        float bx, by, br;
        cave_graph_trunk_point(z, &ax, &ay, &ar);
        cave_graph_trunk_point(z + 64.0f, &bx, &by, &br);
        if (!cave_graph_segment_intersects_tile(ax, z, bx, z + 64.0f, min_x, max_x, min_z, max_z, 12.0f)) continue;
        float center_x = (ax + bx) * 0.5f;
        float center_y = (ay + by) * 0.5f;
        float center_z = z + 32.0f;
        cave_graph_write_passage(
            CAVE_GRAPH_KIND_TRUNK,
            (float)fastfloor(z / 64.0f),
            -1.0f,
            ax, ay, z,
            bx, by, z + 64.0f,
            center_x, center_y, center_z,
            (ar + br) * 0.5f,
            64.0f,
            -1.0f,
            cave_graph_biome_hook(center_x, center_y, center_z)
        );
    }

    int branch_start_cell = fastfloor((min_z - 192.0f) / 128.0f) - 1;
    int branch_end_cell = fastceil((max_z + 192.0f) / 128.0f) + 1;
    for (int cell = branch_start_cell; cell <= branch_end_cell; ++cell) {
        float branch_z, side, branch_cx, branch_cy, branch_radius;
        float branch_center_x, branch_center_y, branch_center_z;
        float branch_start_x, branch_start_y, branch_start_z;
        float branch_end_x, branch_end_y, branch_end_z;
        float end_x, end_y, end_z, chamber_radius, has_shaft;
        float shaft_center_x, shaft_center_y, shaft_center_z;
        float shaft_start_x, shaft_start_y, shaft_start_z;
        float shaft_end_x, shaft_end_y, shaft_end_z;
        cave_graph_branch_metadata(
            cell,
            &branch_z, &side, &branch_cx, &branch_cy, &branch_radius,
            &branch_center_x, &branch_center_y, &branch_center_z,
            &branch_start_x, &branch_start_y, &branch_start_z,
            &branch_end_x, &branch_end_y, &branch_end_z,
            &end_x, &end_y, &end_z, &chamber_radius, &has_shaft,
            &shaft_center_x, &shaft_center_y, &shaft_center_z,
            &shaft_start_x, &shaft_start_y, &shaft_start_z,
            &shaft_end_x, &shaft_end_y, &shaft_end_z
        );
        if (cave_graph_segment_intersects_tile(branch_start_x, branch_start_z, branch_end_x, branch_end_z, min_x, max_x, min_z, max_z, branch_radius + 8.0f)) {
            cave_graph_write_passage(
                CAVE_GRAPH_KIND_BRANCH,
                (float)cell,
                (float)cell,
                branch_start_x, branch_start_y, branch_start_z,
                branch_end_x, branch_end_y, branch_end_z,
                branch_center_x, branch_center_y, branch_center_z,
                branch_radius,
                96.0f,
                (float)cell,
                cave_graph_biome_hook(branch_center_x, branch_center_y, branch_center_z)
            );
        }
        if (cave_graph_point_intersects_tile(end_x, end_z, chamber_radius + 8.0f, min_x, max_x, min_z, max_z)) {
            cave_graph_write_chamber(
                (float)cell,
                end_x, end_y, end_z,
                chamber_radius,
                has_shaft,
                cave_graph_biome_hook(end_x, end_y, end_z)
            );
        }
        if (has_shaft > 0.5f && cave_graph_segment_intersects_tile(shaft_start_x, shaft_start_z, shaft_end_x, shaft_end_z, min_x, max_x, min_z, max_z, 8.0f)) {
            cave_graph_write_passage(
                CAVE_GRAPH_KIND_SHAFT,
                (float)cell,
                (float)cell,
                shaft_start_x, shaft_start_y, shaft_start_z,
                shaft_end_x, shaft_end_y, shaft_end_z,
                shaft_center_x, shaft_center_y, shaft_center_z,
                2.2f,
                28.0f,
                (float)cell,
                cave_graph_biome_hook(shaft_center_x, shaft_center_y, shaft_center_z)
            );
        }
    }
    return g_cave_graph_passage_count;
}

static float box_sdf(float x, float y, float z, float radius) {
    float qx = absf2(x) - radius;
    float qy = absf2(y) - radius;
    float qz = absf2(z) - radius;
    float ox = maxf2(qx, 0.0f);
    float oy = maxf2(qy, 0.0f);
    float oz = maxf2(qz, 0.0f);
    float outside = len3(ox, oy, oz);
    float inside = minf2(maxf2(qx, maxf2(qy, qz)), 0.0f);
    return outside + inside;
}

static float edit_sdf_values(
    int shape,
    float px,
    float py,
    float pz,
    float radius,
    float dx,
    float dy,
    float dz,
    float length
) {
    if (shape == EDIT_SHAPE_BOX) {
        return box_sdf(px, py, pz, radius);
    }
    if (shape == EDIT_SHAPE_CAPSULE) {
        return capsule_sdf_local(px, py, pz, dx, dy, dz, length, radius);
    }
    return len3(px, py, pz) - radius;
}

static float edit_sdf_at(int i, float x, float y, float z) {
    return edit_sdf_values(
        g_edit_shape[i],
        x - g_edit_x[i],
        y - g_edit_y[i],
        z - g_edit_z[i],
        g_edit_r[i],
        g_edit_dx[i],
        g_edit_dy[i],
        g_edit_dz[i],
        g_edit_length[i]
    );
}

static float sample_base_density(float x, float y, float z) {
    float h = terrain_height(x, z);
    float d = y - h; // negative below terrain, positive air

    // Caves only matter underground and near canyon/mountain geology.
    float cave = cave_distance(x, y, z);
    d = maxf2(d, -cave);

    // Smaller cellular pockets add visual complexity, but avoid Swiss-cheese everywhere.
    float pocket = value_noise3(x * 0.055f, y * 0.055f, z * 0.055f);
    if (pocket > 0.76f && y < h - 4.0f) {
        float p = (pocket - 0.76f) * 20.0f;
        d = maxf2(d, p - 2.5f);
    }
    return d;
}

float sample_density(float x, float y, float z) {
    float d = sample_base_density(x, y, z);

    // Runtime sparse edit overlay. Grid-only smooth, flatten, and paint edits are skipped here.
    for (int i = 0; i < g_edit_count; ++i) {
        if (g_edit_type[i] != EDIT_TYPE_SUBTRACT && g_edit_type[i] != EDIT_TYPE_ADD) continue;
        float sdf = edit_sdf_at(i, x, y, z);
        float falloff = g_edit_falloff[i];
        if (g_edit_type[i] == EDIT_TYPE_ADD) {
            d = falloff > 0.0001f ? smooth_minf(d, sdf, falloff) : minf2(d, sdf);
        } else if (g_edit_type[i] == EDIT_TYPE_SUBTRACT) {
            d = falloff > 0.0001f ? smooth_maxf(d, -sdf, falloff) : maxf2(d, -sdf);
        }
    }
    return d;
}

static int grid_index(int x, int y, int z) {
    return x + GRID_N * (y + GRID_N * z);
}

static int edge_x_index(int x, int y, int z) {
    return x + CHUNK_N * (y + GRID_N * z);
}

static int edge_y_index(int x, int y, int z) {
    return x + GRID_N * (y + CHUNK_N * z);
}

static int edge_z_index(int x, int y, int z) {
    return x + GRID_N * (y + GRID_N * z);
}

static void clear_edge_caches(void) {
    for (int i = 0; i < CHUNK_N * GRID_N * GRID_N; ++i) g_edge_x[i] = INVALID_INDEX;
    for (int i = 0; i < GRID_N * CHUNK_N * GRID_N; ++i) g_edge_y[i] = INVALID_INDEX;
    for (int i = 0; i < GRID_N * GRID_N * CHUNK_N; ++i) g_edge_z[i] = INVALID_INDEX;
}

static int apply_edit_to_density(
    int cx,
    int cy,
    int cz,
    float x,
    float y,
    float z,
    float radius,
    int edit_type,
    int shape,
    float dx,
    float dy,
    float dz,
    float length,
    float falloff
);

static int apply_smooth_to_density(
    int cx,
    int cy,
    int cz,
    float x,
    float y,
    float z,
    float radius,
    int shape,
    float dx,
    float dy,
    float dz,
    float length,
    float strength
);

static int apply_flatten_to_density(
    int cx,
    int cy,
    int cz,
    float x,
    float y,
    float z,
    float radius,
    int shape,
    float dx,
    float dy,
    float dz,
    float length,
    float strength
);

static float material_for(float x, float y, float z, float ny, float h, float wetness, float snow, float erosion) {
    float rc = river_center(z);
    float river_dist = absf2(x - rc);
    if ((y < 8.8f && river_dist < 10.5f) || (wetness > 0.74f && y < 11.5f && river_dist < 22.0f)) return 3.0f; // wet sand/mud
    if (ny < 0.52f || erosion > 0.74f || y < h - 2.0f) return 1.0f;    // rock/cave
    if ((y > 52.0f && ny > 0.38f) || (snow > 0.64f && ny > 0.34f)) return 2.0f; // snow
    if (y > 42.0f && ny < 0.75f) return 1.0f;        // alpine rock
    return 0.0f;                                      // grass/soil
}

static float material_override_for(float x, float y, float z, float fallback) {
    float material = fallback;
    for (int i = 0; i < g_edit_count; ++i) {
        if (g_edit_type[i] != EDIT_TYPE_PAINT) continue;
        if (edit_sdf_at(i, x, y, z) <= 0.0f) {
            material = (float)g_edit_material[i];
        }
    }
    return material;
}

static unsigned int add_vertex(float x, float y, float z, float n[3]) {
    if (g_vertex_count >= MAX_VERTS) {
        g_overflow = 1;
        return INVALID_INDEX;
    }
    float h = terrain_height(x, z);
    float drainage = drainage_mask_from_height(x, z, h);
    float erosion = erosion_mask_from_height(x, z, h, n[1]);
    float vegetation = vegetation_mask_from_fields(x, z, h, n[1], drainage, erosion);
    float biome = biome_mask_from_fields(x, z, h, n[1], drainage, erosion, vegetation);
    float wetness = wetness_mask_from_fields(x, y, z, n[1], h, drainage);
    float snow = snow_mask_from_fields(x, y, z, n[1], h, erosion);
    float mat = material_for(x, y, z, n[1], h, wetness, snow, erosion);
    mat = material_override_for(x, y, z, mat);
    float ao = clampf(0.42f + 0.58f * (n[1] * 0.5f + 0.5f), 0.22f, 1.0f);
    unsigned int base = g_vertex_count * VERTEX_STRIDE;
    write_u16(base + 0u, pack_unorm16((x - g_pack_origin_x) / g_pack_scale));
    write_u16(base + 2u, pack_unorm16((y - g_pack_origin_y) / g_pack_scale));
    write_u16(base + 4u, pack_unorm16((z - g_pack_origin_z) / g_pack_scale));
    write_u16(base + 6u, 0u);
    g_vertices[base + 8u] = pack_unorm8(n[0] * 0.5f + 0.5f);
    g_vertices[base + 9u] = pack_unorm8(n[1] * 0.5f + 0.5f);
    g_vertices[base + 10u] = pack_unorm8(n[2] * 0.5f + 0.5f);
    g_vertices[base + 11u] = pack_unorm8(ao);
    g_vertices[base + 12u] = (unsigned char)clampf(mat, 0.0f, 255.0f);
    g_vertices[base + 13u] = pack_unorm8(biome);
    g_vertices[base + 14u] = pack_unorm8(wetness);
    g_vertices[base + 15u] = pack_unorm8(snow);
    g_bounds_min_x = minf2(g_bounds_min_x, x);
    g_bounds_min_y = minf2(g_bounds_min_y, y);
    g_bounds_min_z = minf2(g_bounds_min_z, z);
    g_bounds_max_x = maxf2(g_bounds_max_x, x);
    g_bounds_max_y = maxf2(g_bounds_max_y, y);
    g_bounds_max_z = maxf2(g_bounds_max_z, z);
    return g_vertex_count++;
}

static void add_triangle_indices(unsigned int ia, unsigned int ib, unsigned int ic) {
    if (ia == INVALID_INDEX || ib == INVALID_INDEX || ic == INVALID_INDEX) {
        g_overflow = 1;
        return;
    }
    if (ia == ib || ib == ic || ic == ia) return;
    if (g_index_count + 3u > MAX_INDICES) {
        g_overflow = 1;
        return;
    }
    unsigned int ao = ia * VERTEX_STRIDE;
    unsigned int bo = ib * VERTEX_STRIDE;
    unsigned int co = ic * VERTEX_STRIDE;
    long long ax = (long long)read_vertex_u16(ao + 0u);
    long long ay = (long long)read_vertex_u16(ao + 2u);
    long long az = (long long)read_vertex_u16(ao + 4u);
    long long bx = (long long)read_vertex_u16(bo + 0u);
    long long by = (long long)read_vertex_u16(bo + 2u);
    long long bz = (long long)read_vertex_u16(bo + 4u);
    long long cx = (long long)read_vertex_u16(co + 0u);
    long long cy = (long long)read_vertex_u16(co + 2u);
    long long cz = (long long)read_vertex_u16(co + 4u);
    long long abx = bx - ax;
    long long aby = by - ay;
    long long abz = bz - az;
    long long acx = cx - ax;
    long long acy = cy - ay;
    long long acz = cz - az;
    long long cross_x = aby * acz - abz * acy;
    long long cross_y = abz * acx - abx * acz;
    long long cross_z = abx * acy - aby * acx;
    if (cross_x == 0 && cross_y == 0 && cross_z == 0) return;
    g_indices[g_index_count++] = ia;
    g_indices[g_index_count++] = ib;
    g_indices[g_index_count++] = ic;
}

static void reset_lod_transition_output(void) {
    g_vertex_count = 0;
    g_index_count = 0;
    g_overflow = 0;
    clear_edge_caches();
    g_pack_origin_x = 0.0f;
    g_pack_origin_y = 0.0f;
    g_pack_origin_z = 0.0f;
    g_pack_scale = 1.0f;
    g_bounds_min_x = 0.0f;
    g_bounds_min_y = 0.0f;
    g_bounds_min_z = 0.0f;
    g_bounds_max_x = 0.0f;
    g_bounds_max_y = 0.0f;
    g_bounds_max_z = 0.0f;
}

static int lod_transition_seam_neighbor_node_index(int side, int index) {
    if (index < 0 || index > 3) return 4;
    if (side == LOD_TRANSITION_SIDE_NEG_X) {
        const int nodes[4] = {5, 9, 7, 11};
        return nodes[index];
    }
    if (side == LOD_TRANSITION_SIDE_POS_X) {
        const int nodes[4] = {4, 8, 6, 10};
        return nodes[index];
    }
    if (side == LOD_TRANSITION_SIDE_NEG_Z) {
        const int nodes[4] = {8, 9, 10, 11};
        return nodes[index];
    }
    const int nodes[4] = {4, 5, 6, 7};
    return nodes[index];
}

static int lod_transition_local_vertex(
    float local_pos[LOD_TRANSITION_MAX_LOCAL_VERTS][3],
    float local_normal[LOD_TRANSITION_MAX_LOCAL_VERTS][3],
    int *local_vertex_count,
    float p[3]
) {
    for (int i = 0; i < *local_vertex_count; ++i) {
        if (
            absf2(local_pos[i][0] - p[0]) <= 0.00001f &&
            absf2(local_pos[i][1] - p[1]) <= 0.00001f &&
            absf2(local_pos[i][2] - p[2]) <= 0.00001f
        ) {
            return i;
        }
    }
    if (*local_vertex_count >= LOD_TRANSITION_MAX_LOCAL_VERTS) {
        g_overflow = 1;
        return -1;
    }
    int index = *local_vertex_count;
    local_pos[index][0] = p[0];
    local_pos[index][1] = p[1];
    local_pos[index][2] = p[2];
    local_normal[index][0] = 0.0f;
    local_normal[index][1] = 0.0f;
    local_normal[index][2] = 0.0f;
    *local_vertex_count = index + 1;
    return index;
}

static void lod_transition_interpolate_node_edge(int a, int b, float out[3]) {
    float va = g_lod_transition_densities[a];
    float vb = g_lod_transition_densities[b];
    float t = 0.5f;
    float denom = va - vb;
    if (denom > 0.00001f || denom < -0.00001f) {
        t = clampf(va / denom, 0.0f, 1.0f);
    }
    int ao = a * 3;
    int bo = b * 3;
    out[0] = mixf(g_lod_transition_positions[ao + 0], g_lod_transition_positions[bo + 0], t);
    out[1] = mixf(g_lod_transition_positions[ao + 1], g_lod_transition_positions[bo + 1], t);
    out[2] = mixf(g_lod_transition_positions[ao + 2], g_lod_transition_positions[bo + 2], t);
}

static void lod_transition_emit_local_triangle(
    float local_pos[LOD_TRANSITION_MAX_LOCAL_VERTS][3],
    float local_normal[LOD_TRANSITION_MAX_LOCAL_VERTS][3],
    unsigned int local_indices[LOD_TRANSITION_MAX_LOCAL_INDICES],
    int *local_vertex_count,
    int *local_index_count,
    float a[3],
    float b[3],
    float c[3]
) {
    int ia = lod_transition_local_vertex(local_pos, local_normal, local_vertex_count, a);
    int ib = lod_transition_local_vertex(local_pos, local_normal, local_vertex_count, b);
    int ic = lod_transition_local_vertex(local_pos, local_normal, local_vertex_count, c);
    if (ia < 0 || ib < 0 || ic < 0) return;
    if (ia == ib || ib == ic || ic == ia) return;

    float abx = b[0] - a[0];
    float aby = b[1] - a[1];
    float abz = b[2] - a[2];
    float acx = c[0] - a[0];
    float acy = c[1] - a[1];
    float acz = c[2] - a[2];
    float nx;
    float ny;
    float nz;
    cross3(abx, aby, abz, acx, acy, acz, &nx, &ny, &nz);
    float area_sq = nx * nx + ny * ny + nz * nz;
    if (area_sq <= 0.00000001f) return;
    if (*local_index_count + 3 > LOD_TRANSITION_MAX_LOCAL_INDICES) {
        g_overflow = 1;
        return;
    }

    local_normal[ia][0] += nx;
    local_normal[ia][1] += ny;
    local_normal[ia][2] += nz;
    local_normal[ib][0] += nx;
    local_normal[ib][1] += ny;
    local_normal[ib][2] += nz;
    local_normal[ic][0] += nx;
    local_normal[ic][1] += ny;
    local_normal[ic][2] += nz;
    local_indices[(*local_index_count)++] = (unsigned int)ia;
    local_indices[(*local_index_count)++] = (unsigned int)ib;
    local_indices[(*local_index_count)++] = (unsigned int)ic;
}

static void lod_transition_emit_tetra(
    const int tetra[4],
    float local_pos[LOD_TRANSITION_MAX_LOCAL_VERTS][3],
    float local_normal[LOD_TRANSITION_MAX_LOCAL_VERTS][3],
    unsigned int local_indices[LOD_TRANSITION_MAX_LOCAL_INDICES],
    int *local_vertex_count,
    int *local_index_count
) {
    int solid[4];
    int empty[4];
    int solid_count = 0;
    int empty_count = 0;
    for (int i = 0; i < 4; ++i) {
        int node = tetra[i];
        if (g_lod_transition_densities[node] < 0.0f) {
            solid[solid_count++] = node;
        } else {
            empty[empty_count++] = node;
        }
    }
    if (solid_count == 0 || solid_count == 4) return;

    float p0[3];
    float p1[3];
    float p2[3];
    float p3[3];
    if (solid_count == 1) {
        int s = solid[0];
        lod_transition_interpolate_node_edge(s, empty[0], p0);
        lod_transition_interpolate_node_edge(s, empty[1], p1);
        lod_transition_interpolate_node_edge(s, empty[2], p2);
        lod_transition_emit_local_triangle(local_pos, local_normal, local_indices, local_vertex_count, local_index_count, p0, p1, p2);
    } else if (solid_count == 3) {
        int e = empty[0];
        lod_transition_interpolate_node_edge(e, solid[0], p0);
        lod_transition_interpolate_node_edge(e, solid[2], p1);
        lod_transition_interpolate_node_edge(e, solid[1], p2);
        lod_transition_emit_local_triangle(local_pos, local_normal, local_indices, local_vertex_count, local_index_count, p0, p1, p2);
    } else {
        int s0 = solid[0];
        int s1 = solid[1];
        int e0 = empty[0];
        int e1 = empty[1];
        lod_transition_interpolate_node_edge(s0, e0, p0);
        lod_transition_interpolate_node_edge(s1, e0, p1);
        lod_transition_interpolate_node_edge(s0, e1, p2);
        lod_transition_interpolate_node_edge(s1, e1, p3);
        lod_transition_emit_local_triangle(local_pos, local_normal, local_indices, local_vertex_count, local_index_count, p0, p1, p2);
        lod_transition_emit_local_triangle(local_pos, local_normal, local_indices, local_vertex_count, local_index_count, p2, p1, p3);
    }
}

static int lod_transition_side_is_valid(int side) {
    return side == LOD_TRANSITION_SIDE_NEG_X
        || side == LOD_TRANSITION_SIDE_POS_X
        || side == LOD_TRANSITION_SIDE_NEG_Z
        || side == LOD_TRANSITION_SIDE_POS_Z;
}

static void lod_transition_compute_pack_frame_from_positions(const float *positions, int sample_count) {
    if (sample_count <= 0) {
        g_pack_origin_x = 0.0f;
        g_pack_origin_y = 0.0f;
        g_pack_origin_z = 0.0f;
        g_pack_scale = 1.0f;
        g_bounds_min_x = 0.0f;
        g_bounds_min_y = 0.0f;
        g_bounds_min_z = 0.0f;
        g_bounds_max_x = 0.0f;
        g_bounds_max_y = 0.0f;
        g_bounds_max_z = 0.0f;
        return;
    }
    float min_x = positions[0];
    float min_y = positions[1];
    float min_z = positions[2];
    float max_x = min_x;
    float max_y = min_y;
    float max_z = min_z;
    for (int i = 1; i < sample_count; ++i) {
        int o = i * 3;
        float x = positions[o + 0];
        float y = positions[o + 1];
        float z = positions[o + 2];
        min_x = minf2(min_x, x);
        min_y = minf2(min_y, y);
        min_z = minf2(min_z, z);
        max_x = maxf2(max_x, x);
        max_y = maxf2(max_y, y);
        max_z = maxf2(max_z, z);
    }
    float extent = maxf2(max_x - min_x, maxf2(max_y - min_y, max_z - min_z));
    g_pack_origin_x = min_x;
    g_pack_origin_y = min_y;
    g_pack_origin_z = min_z;
    g_pack_scale = maxf2(extent, 1.0f);
    g_bounds_min_x = min_x + g_pack_scale;
    g_bounds_min_y = min_y + g_pack_scale;
    g_bounds_min_z = min_z + g_pack_scale;
    g_bounds_max_x = min_x;
    g_bounds_max_y = min_y;
    g_bounds_max_z = min_z;
}

static void emit_lod_transition_cell_into_current_mesh(int side) {
    if (!lod_transition_side_is_valid(side)) return;

    float local_pos[LOD_TRANSITION_MAX_LOCAL_VERTS][3];
    float local_normal[LOD_TRANSITION_MAX_LOCAL_VERTS][3];
    unsigned int local_indices[LOD_TRANSITION_MAX_LOCAL_INDICES];
    int local_vertex_count = 0;
    int local_index_count = 0;

    int seam[4];
    for (int i = 0; i < 4; ++i) seam[i] = lod_transition_seam_neighbor_node_index(side, i);
    const int hexahedra[2][8] = {
        {0, 1, 2, 3, seam[0], seam[1], seam[2], seam[3]},
        {4, 5, 6, 7, 8, 9, 10, 11}
    };
    const int hex_tetrahedra[6][4] = {
        {0, 1, 3, 7},
        {0, 3, 2, 7},
        {0, 2, 6, 7},
        {0, 6, 4, 7},
        {0, 4, 5, 7},
        {0, 5, 1, 7}
    };

    for (int h = 0; h < 2; ++h) {
        for (int t = 0; t < 6; ++t) {
            int tetra[4];
            for (int i = 0; i < 4; ++i) tetra[i] = hexahedra[h][hex_tetrahedra[t][i]];
            lod_transition_emit_tetra(tetra, local_pos, local_normal, local_indices, &local_vertex_count, &local_index_count);
        }
    }
    if (local_vertex_count <= 0 || local_index_count <= 0) return;

    unsigned int final_indices[LOD_TRANSITION_MAX_LOCAL_VERTS];
    for (int i = 0; i < local_vertex_count; ++i) {
        float nx;
        float ny;
        float nz;
        normalized_dir(local_normal[i][0], local_normal[i][1], local_normal[i][2], &nx, &ny, &nz);
        if (len3(local_normal[i][0], local_normal[i][1], local_normal[i][2]) <= 0.0001f) {
            nx = 0.0f;
            ny = 1.0f;
            nz = 0.0f;
        }
        float normal[3] = {nx, ny, nz};
        final_indices[i] = add_vertex(local_pos[i][0], local_pos[i][1], local_pos[i][2], normal);
    }
    for (int i = 0; i < local_index_count; i += 3) {
        add_triangle_indices(final_indices[local_indices[i]], final_indices[local_indices[i + 1]], final_indices[local_indices[i + 2]]);
    }
}

int generate_lod_transition_cell_mesh(int side) {
    reset_lod_transition_output();
    if (!lod_transition_side_is_valid(side)) return 0;
    lod_transition_compute_pack_frame_from_positions(g_lod_transition_positions, LOD_TRANSITION_SAMPLE_COUNT);
    emit_lod_transition_cell_into_current_mesh(side);
    return (int)g_vertex_count;
}

int generate_lod_transition_chunk_mesh(int cell_count) {
    reset_lod_transition_output();
    if (cell_count <= 0 || cell_count > LOD_TRANSITION_MAX_CHUNK_CELLS) return 0;

    int total_samples = cell_count * LOD_TRANSITION_SAMPLE_COUNT;
    lod_transition_compute_pack_frame_from_positions(g_lod_transition_chunk_positions, total_samples);

    for (int cell = 0; cell < cell_count; ++cell) {
        int pos_offset = cell * LOD_TRANSITION_SAMPLE_COUNT * 3;
        int den_offset = cell * LOD_TRANSITION_SAMPLE_COUNT;
        for (int i = 0; i < LOD_TRANSITION_SAMPLE_COUNT * 3; ++i) {
            g_lod_transition_positions[i] = g_lod_transition_chunk_positions[pos_offset + i];
        }
        for (int i = 0; i < LOD_TRANSITION_SAMPLE_COUNT; ++i) {
            g_lod_transition_densities[i] = g_lod_transition_chunk_densities[den_offset + i];
        }
        emit_lod_transition_cell_into_current_mesh(g_lod_transition_chunk_sides[cell]);
    }
    return (int)g_vertex_count;
}

static void interp(float p0[3], float p1[3], float v0, float v1, float out[3]) {
    float t = 0.5f;
    float denom = v0 - v1;
    if (denom > 0.00001f || denom < -0.00001f) t = clampf(v0 / denom, 0.0f, 1.0f);
    out[0] = mixf(p0[0], p1[0], t);
    out[1] = mixf(p0[1], p1[1], t);
    out[2] = mixf(p0[2], p1[2], t);
}

static void cached_grid_gradient(int x, int y, int z, float out[3]) {
    int base = grid_index(x, y, z) * 3;
    out[0] = g_density_gradient[base + 0];
    out[1] = g_density_gradient[base + 1];
    out[2] = g_density_gradient[base + 2];
}

static void build_density_gradient_grid(void) {
    for (int z = 0; z < GRID_N; ++z) {
        int zm = z > 0 ? z - 1 : z;
        int zp = z < GRID_N - 1 ? z + 1 : z;
        float zdenom = (float)(zp - zm) * g_cell_size;
        if (zdenom <= 0.0f) zdenom = 1.0f;
        for (int y = 0; y < GRID_N; ++y) {
            int ym = y > 0 ? y - 1 : y;
            int yp = y < GRID_N - 1 ? y + 1 : y;
            float ydenom = (float)(yp - ym) * g_cell_size;
            if (ydenom <= 0.0f) ydenom = 1.0f;
            for (int x = 0; x < GRID_N; ++x) {
                int xm = x > 0 ? x - 1 : x;
                int xp = x < GRID_N - 1 ? x + 1 : x;
                float xdenom = (float)(xp - xm) * g_cell_size;
                if (xdenom <= 0.0f) xdenom = 1.0f;
                float dx = (unpack_density(g_density[grid_index(xp, y, z)]) - unpack_density(g_density[grid_index(xm, y, z)])) / xdenom;
                float dy = (unpack_density(g_density[grid_index(x, yp, z)]) - unpack_density(g_density[grid_index(x, ym, z)])) / ydenom;
                float dz = (unpack_density(g_density[grid_index(x, y, zp)]) - unpack_density(g_density[grid_index(x, y, zm)])) / zdenom;
                float len = len3(dx, dy, dz);
                float n[3];
                if (len <= 0.0001f) {
                    n[0] = 0.0f; n[1] = 1.0f; n[2] = 0.0f;
                } else {
                    n[0] = dx / len; n[1] = dy / len; n[2] = dz / len;
                }
                int base = grid_index(x, y, z) * 3;
                g_density_gradient[base + 0] = n[0];
                g_density_gradient[base + 1] = n[1];
                g_density_gradient[base + 2] = n[2];
            }
        }
    }
}

static unsigned int *axis_edge_slot(int cell_x, int cell_y, int cell_z, int c0, int c1) {
    int gx0 = cell_x + cube_corners[c0][0];
    int gy0 = cell_y + cube_corners[c0][1];
    int gz0 = cell_z + cube_corners[c0][2];
    int gx1 = cell_x + cube_corners[c1][0];
    int gy1 = cell_y + cube_corners[c1][1];
    int gz1 = cell_z + cube_corners[c1][2];
    int dx = gx1 - gx0; if (dx < 0) dx = -dx;
    int dy = gy1 - gy0; if (dy < 0) dy = -dy;
    int dz = gz1 - gz0; if (dz < 0) dz = -dz;
    if (dx + dy + dz != 1) return 0;

    int x = gx0 < gx1 ? gx0 : gx1;
    int y = gy0 < gy1 ? gy0 : gy1;
    int z = gz0 < gz1 ? gz0 : gz1;
    if (dx == 1) return &g_edge_x[edge_x_index(x, y, z)];
    if (dy == 1) return &g_edge_y[edge_y_index(x, y, z)];
    return &g_edge_z[edge_z_index(x, y, z)];
}

static unsigned int vertex_for_edge(
    int cell_x,
    int cell_y,
    int cell_z,
    float cp[8][3],
    float cv[8],
    int c0,
    int c1
) {
    unsigned int *slot = axis_edge_slot(cell_x, cell_y, cell_z, c0, c1);
    if (!slot) return INVALID_INDEX;
    if (*slot != INVALID_INDEX) return *slot;

    float q[3];
    interp(cp[c0], cp[c1], cv[c0], cv[c1], q);
    float denom = cv[c0] - cv[c1];
    float t = 0.5f;
    if (denom > 0.00001f || denom < -0.00001f) t = clampf(cv[c0] / denom, 0.0f, 1.0f);
    float g0[3], g1[3], n[3];
    cached_grid_gradient(cell_x + cube_corners[c0][0], cell_y + cube_corners[c0][1], cell_z + cube_corners[c0][2], g0);
    cached_grid_gradient(cell_x + cube_corners[c1][0], cell_y + cube_corners[c1][1], cell_z + cube_corners[c1][2], g1);
    float nx = mixf(g0[0], g1[0], t);
    float ny = mixf(g0[1], g1[1], t);
    float nz = mixf(g0[2], g1[2], t);
    normalized_dir(nx, ny, nz, &n[0], &n[1], &n[2]);
    *slot = add_vertex(q[0], q[1], q[2], n);
    return *slot;
}

static void cube_gradient(float cv[8], float out[3]) {
    float nx = (cv[1] + cv[2] + cv[5] + cv[6]) - (cv[0] + cv[3] + cv[4] + cv[7]);
    float ny = (cv[2] + cv[3] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[4] + cv[5]);
    float nz = (cv[4] + cv[5] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[2] + cv[3]);
    normalized_dir(nx, ny, nz, &out[0], &out[1], &out[2]);
}

static void basis_from_normal(float n[3], float u[3], float v[3]) {
    float ax = absf2(n[1]) < 0.85f ? 0.0f : 1.0f;
    float ay = absf2(n[1]) < 0.85f ? 1.0f : 0.0f;
    float az = 0.0f;
    float ux, uy, uz;
    cross3(ax, ay, az, n[0], n[1], n[2], &ux, &uy, &uz);
    normalized_dir(ux, uy, uz, &u[0], &u[1], &u[2]);
    cross3(n[0], n[1], n[2], u[0], u[1], u[2], &v[0], &v[1], &v[2]);
}

static int angle_half(float x, float y) {
    return (y > 0.0f || (y == 0.0f && x >= 0.0f)) ? 0 : 1;
}

static int angle_before(float ax, float ay, float bx, float by) {
    int ah = angle_half(ax, ay);
    int bh = angle_half(bx, by);
    if (ah != bh) return ah < bh;
    return (ax * by - ay * bx) > 0.0f;
}

static void sort_edge_polygon(unsigned int ids[12], float p[12][3], int count, float center[3], float n[3]) {
    float u[3], v[3];
    float projected[12][2];
    basis_from_normal(n, u, v);
    for (int i = 0; i < count; ++i) {
        float dx = p[i][0] - center[0];
        float dy = p[i][1] - center[1];
        float dz = p[i][2] - center[2];
        projected[i][0] = dx * u[0] + dy * u[1] + dz * u[2];
        projected[i][1] = dx * v[0] + dy * v[1] + dz * v[2];
    }
    for (int i = 1; i < count; ++i) {
        unsigned int id = ids[i];
        float pos[3] = { p[i][0], p[i][1], p[i][2] };
        float px = projected[i][0];
        float py = projected[i][1];
        int j = i - 1;
        while (j >= 0 && angle_before(px, py, projected[j][0], projected[j][1])) {
            ids[j + 1] = ids[j];
            p[j + 1][0] = p[j][0]; p[j + 1][1] = p[j][1]; p[j + 1][2] = p[j][2];
            projected[j + 1][0] = projected[j][0]; projected[j + 1][1] = projected[j][1];
            --j;
        }
        ids[j + 1] = id;
        p[j + 1][0] = pos[0]; p[j + 1][1] = pos[1]; p[j + 1][2] = pos[2];
        projected[j + 1][0] = px; projected[j + 1][1] = py;
    }
}

static void add_edge_link(int adj[12][2], int adj_count[12], int a, int b) {
    if (a == b) return;
    for (int i = 0; i < adj_count[a]; ++i) {
        if (adj[a][i] == b) return;
    }
    if (adj_count[a] < 2) {
        adj[a][adj_count[a]++] = b;
    } else {
        g_overflow = 1;
    }
    for (int i = 0; i < adj_count[b]; ++i) {
        if (adj[b][i] == a) return;
    }
    if (adj_count[b] < 2) {
        adj[b][adj_count[b]++] = a;
    } else {
        g_overflow = 1;
    }
}

static void add_face_links(float cv[8], int active_edges[12], int adj[12][2], int adj_count[12]) {
    for (int f = 0; f < 6; ++f) {
        int crossings[4];
        int crossing_count = 0;
        for (int i = 0; i < 4; ++i) {
            int edge = cube_face_edges[f][i];
            if (active_edges[edge]) crossings[crossing_count++] = edge;
        }
        if (crossing_count == 2) {
            add_edge_link(adj, adj_count, crossings[0], crossings[1]);
        } else if (crossing_count == 4) {
            float center = 0.25f * (
                cv[cube_faces[f][0]] + cv[cube_faces[f][1]] +
                cv[cube_faces[f][2]] + cv[cube_faces[f][3]]
            );
            int center_inside = center < 0.0f;
            for (int i = 0; i < 4; ++i) {
                int corner_inside = cv[cube_faces[f][i]] < 0.0f;
                if (corner_inside != center_inside) {
                    add_edge_link(adj, adj_count, cube_face_edges[f][(i + 3) & 3], cube_face_edges[f][i]);
                }
            }
        }
    }
}

static int triangulate_loop(unsigned int edge_ids[12], int loop_edges[12], int loop_count) {
    if (loop_count < 3) return 0;
    for (int i = 1; i < loop_count - 1; ++i) {
        add_triangle_indices(edge_ids[loop_edges[0]], edge_ids[loop_edges[i]], edge_ids[loop_edges[i + 1]]);
    }
    return loop_count - 2;
}

static void polygonise_cube(int cell_x, int cell_y, int cell_z, float cp[8][3], float cv[8]) {
    unsigned int ids[12];
    float p[12][3];
    int active_edges[12];
    int adj[12][2];
    int adj_count[12];
    int visited[12];
    int count = 0;
    float center[3] = {0.0f, 0.0f, 0.0f};
    for (int e = 0; e < 12; ++e) {
        active_edges[e] = 0;
        adj[e][0] = INVALID_INDEX;
        adj[e][1] = INVALID_INDEX;
        adj_count[e] = 0;
        visited[e] = 0;
    }

    for (int e = 0; e < 12; ++e) {
        int c0 = cube_edges[e][0];
        int c1 = cube_edges[e][1];
        int s0 = cv[c0] < 0.0f;
        int s1 = cv[c1] < 0.0f;
        if (s0 == s1) continue;

        interp(cp[c0], cp[c1], cv[c0], cv[c1], p[e]);
        ids[e] = vertex_for_edge(cell_x, cell_y, cell_z, cp, cv, c0, c1);
        active_edges[e] = 1;
        center[0] += p[e][0];
        center[1] += p[e][1];
        center[2] += p[e][2];
        ++count;
    }

    if (count < 3) return;
    center[0] /= (float)count;
    center[1] /= (float)count;
    center[2] /= (float)count;

    float n[3];
    cube_gradient(cv, n);
    add_face_links(cv, active_edges, adj, adj_count);

    int loops[12][12];
    int loop_counts[12];
    int loop_count_total = 0;
    int all_loops_closed = 1;
    for (int e = 0; e < 12; ++e) {
        if (!active_edges[e] || visited[e] || adj_count[e] == 0) continue;
        int loop_edges[12];
        int loop_count = 0;
        int start = e;
        int prev = -1;
        int current = e;
        int closed = 0;
        for (int steps = 0; steps < 12; ++steps) {
            visited[current] = 1;
            loop_edges[loop_count++] = current;
            int next = -1;
            if (adj_count[current] == 1) {
                next = adj[current][0];
            } else {
                next = adj[current][0] != prev ? adj[current][0] : adj[current][1];
            }
            if (next == start) {
                closed = 1;
                break;
            }
            if (next < 0 || visited[next]) {
                break;
            }
            prev = current;
            current = next;
        }
        if (!closed) {
            all_loops_closed = 0;
        }
        if (loop_count >= 3 && loop_count_total < 12) {
            for (int i = 0; i < loop_count; ++i) {
                loops[loop_count_total][i] = loop_edges[i];
            }
            loop_counts[loop_count_total] = loop_count;
            ++loop_count_total;
        } else {
            all_loops_closed = 0;
        }
    }

    if (all_loops_closed && loop_count_total > 0) {
        int emitted = 0;
        for (int i = 0; i < loop_count_total; ++i) {
            emitted += triangulate_loop(ids, loops[i], loop_counts[i]);
        }
        if (emitted > 0) return;
    }

    {
        unsigned int fallback_ids[12];
        float fallback_p[12][3];
        int cursor = 0;
        for (int e = 0; e < 12; ++e) {
            if (!active_edges[e]) continue;
            fallback_ids[cursor] = ids[e];
            fallback_p[cursor][0] = p[e][0];
            fallback_p[cursor][1] = p[e][1];
            fallback_p[cursor][2] = p[e][2];
            ++cursor;
        }
        sort_edge_polygon(fallback_ids, fallback_p, cursor, center, n);
        for (int i = 1; i < cursor - 1; ++i) {
            add_triangle_indices(fallback_ids[0], fallback_ids[i], fallback_ids[i + 1]);
        }
    }
}

static void sample_density_grid(int cx, int cy, int cz) {
    float base_x = chunk_origin(cx);
    float base_y = chunk_origin(cy);
    float base_z = chunk_origin(cz);
    for (int z = 0; z < GRID_N; ++z) {
        for (int y = 0; y < GRID_N; ++y) {
            for (int x = 0; x < GRID_N; ++x) {
                float wx = base_x + (float)x * g_cell_size;
                float wy = base_y + (float)y * g_cell_size;
                float wz = base_z + (float)z * g_cell_size;
                g_density[grid_index(x, y, z)] = pack_density(sample_base_density(wx, wy, wz));
            }
        }
    }

    for (int i = 0; i < g_edit_count; ++i) {
        if (g_edit_type[i] == EDIT_TYPE_ADD || g_edit_type[i] == EDIT_TYPE_SUBTRACT) {
            apply_edit_to_density(
                cx,
                cy,
                cz,
                g_edit_x[i],
                g_edit_y[i],
                g_edit_z[i],
                g_edit_r[i],
                g_edit_type[i],
                g_edit_shape[i],
                g_edit_dx[i],
                g_edit_dy[i],
                g_edit_dz[i],
                g_edit_length[i],
                g_edit_falloff[i]
            );
        } else if (g_edit_type[i] == EDIT_TYPE_SMOOTH) {
            apply_smooth_to_density(
                cx,
                cy,
                cz,
                g_edit_x[i],
                g_edit_y[i],
                g_edit_z[i],
                g_edit_r[i],
                g_edit_shape[i],
                g_edit_dx[i],
                g_edit_dy[i],
                g_edit_dz[i],
                g_edit_length[i],
                g_edit_strength[i]
            );
        } else if (g_edit_type[i] == EDIT_TYPE_FLATTEN) {
            apply_flatten_to_density(
                cx,
                cy,
                cz,
                g_edit_x[i],
                g_edit_y[i],
                g_edit_z[i],
                g_edit_r[i],
                g_edit_shape[i],
                g_edit_dx[i],
                g_edit_dy[i],
                g_edit_dz[i],
                g_edit_length[i],
                g_edit_strength[i]
            );
        }
    }
}

static int polygonize_density_grid(int cx, int cy, int cz) {
    g_vertex_count = 0;
    g_index_count = 0;
    g_overflow = 0;
    clear_edge_caches();

    float base_x = chunk_origin(cx);
    float base_y = chunk_origin(cy);
    float base_z = chunk_origin(cz);
    g_pack_origin_x = base_x;
    g_pack_origin_y = base_y;
    g_pack_origin_z = base_z;
    g_pack_scale = g_chunk_world_size;
    g_bounds_min_x = base_x + g_chunk_world_size;
    g_bounds_min_y = base_y + g_chunk_world_size;
    g_bounds_min_z = base_z + g_chunk_world_size;
    g_bounds_max_x = base_x;
    g_bounds_max_y = base_y;
    g_bounds_max_z = base_z;
    build_density_gradient_grid();

    for (int z = 0; z < CHUNK_N; ++z) {
        for (int y = 0; y < CHUNK_N; ++y) {
            for (int x = 0; x < CHUNK_N; ++x) {
                float cp[8][3];
                float cv[8];
                int solid = 0;
                for (int c = 0; c < 8; ++c) {
                    int gx = x + cube_corners[c][0];
                    int gy = y + cube_corners[c][1];
                    int gz = z + cube_corners[c][2];
                    cp[c][0] = base_x + (float)gx * g_cell_size;
                    cp[c][1] = base_y + (float)gy * g_cell_size;
                    cp[c][2] = base_z + (float)gz * g_cell_size;
                    cv[c] = unpack_density(g_density[grid_index(gx, gy, gz)]);
                    solid += (cv[c] < 0.0f) ? 1 : 0;
                }
                if (solid == 0 || solid == 8) continue;
                polygonise_cube(x, y, z, cp, cv);
            }
        }
    }
    return (int)g_vertex_count;
}

int generate_chunk(int cx, int cy, int cz, int lod) {
    configure_lod(lod);
    sample_density_grid(cx, cy, cz);
    return polygonize_density_grid(cx, cy, cz);
}

int mesh_cached_chunk(int cx, int cy, int cz, int lod) {
    configure_lod(lod);
    return polygonize_density_grid(cx, cy, cz);
}

static int apply_edit_to_density(
    int cx,
    int cy,
    int cz,
    float x,
    float y,
    float z,
    float radius,
    int edit_type,
    int shape,
    float dx,
    float dy,
    float dz,
    float length,
    float falloff
) {
    float base_x = chunk_origin(cx);
    float base_y = chunk_origin(cy);
    float base_z = chunk_origin(cz);
    float clamped_falloff = clampf(falloff, 0.0f, radius);
    int changed = 0;
    for (int gz = 0; gz < GRID_N; ++gz) {
        for (int gy = 0; gy < GRID_N; ++gy) {
            for (int gx = 0; gx < GRID_N; ++gx) {
                float wx = base_x + (float)gx * g_cell_size;
                float wy = base_y + (float)gy * g_cell_size;
                float wz = base_z + (float)gz * g_cell_size;
                float sdf = edit_sdf_values(shape, wx - x, wy - y, wz - z, radius, dx, dy, dz, length);
                int index = grid_index(gx, gy, gz);
                float d = unpack_density(g_density[index]);
                float next;
                if (clamped_falloff > 0.0001f) {
                    next = edit_type == EDIT_TYPE_ADD
                        ? smooth_minf(d, sdf, clamped_falloff)
                        : smooth_maxf(d, -sdf, clamped_falloff);
                } else {
                    next = edit_type == EDIT_TYPE_ADD ? minf2(d, sdf) : maxf2(d, -sdf);
                }
                if ((edit_type == EDIT_TYPE_ADD && next < d) || (edit_type == EDIT_TYPE_SUBTRACT && next > d)) {
                    g_density[index] = pack_density(next);
                    changed++;
                }
            }
        }
    }
    return changed;
}

static int density_scratch_index_clamped(int x, int y, int z) {
    int cx = x < 0 ? 0 : (x >= GRID_N ? GRID_N - 1 : x);
    int cy = y < 0 ? 0 : (y >= GRID_N ? GRID_N - 1 : y);
    int cz = z < 0 ? 0 : (z >= GRID_N ? GRID_N - 1 : z);
    return grid_index(cx, cy, cz);
}

static float smooth_brush_weight(float sdf, float radius, float strength) {
    if (sdf > 0.0f) return 0.0f;
    float normalized = clampf(-sdf / maxf2(radius, 0.0001f), 0.0f, 1.0f);
    float eased = normalized * normalized * (3.0f - 2.0f * normalized);
    return clampf(strength, 0.0f, 1.0f) * eased;
}

static int apply_smooth_to_density(
    int cx,
    int cy,
    int cz,
    float x,
    float y,
    float z,
    float radius,
    int shape,
    float dx,
    float dy,
    float dz,
    float length,
    float strength
) {
    float base_x = chunk_origin(cx);
    float base_y = chunk_origin(cy);
    float base_z = chunk_origin(cz);
    int changed = 0;
    for (int i = 0; i < GRID_N * GRID_N * GRID_N; ++i) {
        g_density_scratch[i] = g_density[i];
    }
    for (int gz = 0; gz < GRID_N; ++gz) {
        for (int gy = 0; gy < GRID_N; ++gy) {
            for (int gx = 0; gx < GRID_N; ++gx) {
                float wx = base_x + (float)gx * g_cell_size;
                float wy = base_y + (float)gy * g_cell_size;
                float wz = base_z + (float)gz * g_cell_size;
                float sdf = edit_sdf_values(shape, wx - x, wy - y, wz - z, radius, dx, dy, dz, length);
                float weight = smooth_brush_weight(sdf, radius, strength);
                if (weight <= 0.0f) continue;

                int index = grid_index(gx, gy, gz);
                float center = unpack_density(g_density_scratch[index]);
                float neighbor_sum =
                    center +
                    unpack_density(g_density_scratch[density_scratch_index_clamped(gx - 1, gy, gz)]) +
                    unpack_density(g_density_scratch[density_scratch_index_clamped(gx + 1, gy, gz)]) +
                    unpack_density(g_density_scratch[density_scratch_index_clamped(gx, gy - 1, gz)]) +
                    unpack_density(g_density_scratch[density_scratch_index_clamped(gx, gy + 1, gz)]) +
                    unpack_density(g_density_scratch[density_scratch_index_clamped(gx, gy, gz - 1)]) +
                    unpack_density(g_density_scratch[density_scratch_index_clamped(gx, gy, gz + 1)]);
                float averaged = neighbor_sum / 7.0f;
                signed short next = pack_density(center + (averaged - center) * weight);
                if (next != g_density[index]) {
                    g_density[index] = next;
                    changed++;
                }
            }
        }
    }
    return changed;
}

static int apply_flatten_to_density(
    int cx,
    int cy,
    int cz,
    float x,
    float y,
    float z,
    float radius,
    int shape,
    float dx,
    float dy,
    float dz,
    float length,
    float strength
) {
    float base_x = chunk_origin(cx);
    float base_y = chunk_origin(cy);
    float base_z = chunk_origin(cz);
    float clamped_strength = clampf(strength, 0.0f, 1.0f);
    int changed = 0;
    for (int gz = 0; gz < GRID_N; ++gz) {
        for (int gy = 0; gy < GRID_N; ++gy) {
            for (int gx = 0; gx < GRID_N; ++gx) {
                float wx = base_x + (float)gx * g_cell_size;
                float wy = base_y + (float)gy * g_cell_size;
                float wz = base_z + (float)gz * g_cell_size;
                float sdf = edit_sdf_values(shape, wx - x, wy - y, wz - z, radius, dx, dy, dz, length);
                float weight = smooth_brush_weight(sdf, radius, clamped_strength);
                if (weight <= 0.0f) continue;

                int index = grid_index(gx, gy, gz);
                float d = unpack_density(g_density[index]);
                float plane = wy - y;
                signed short next = pack_density(d + (plane - d) * weight);
                if (next != g_density[index]) {
                    g_density[index] = next;
                    changed++;
                }
            }
        }
    }
    return changed;
}

int apply_subtract_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
}

int apply_add_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
}

int apply_subtract_box_to_density(int cx, int cy, int cz, float x, float y, float z, float radius) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
}

int apply_add_box_to_density(int cx, int cy, int cz, float x, float y, float z, float radius) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
}

int apply_subtract_capsule_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0.0f);
}

int apply_add_capsule_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0.0f);
}

int apply_subtract_sphere_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, falloff);
}

int apply_add_sphere_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, falloff);
}

int apply_subtract_box_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, falloff);
}

int apply_add_box_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float falloff) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, falloff);
}

int apply_subtract_capsule_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, falloff);
}

int apply_add_capsule_to_density_falloff(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff) {
    return apply_edit_to_density(cx, cy, cz, x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, falloff);
}

int apply_smooth_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float strength) {
    return apply_smooth_to_density(cx, cy, cz, x, y, z, radius, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, strength);
}

int apply_smooth_box_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float strength) {
    return apply_smooth_to_density(cx, cy, cz, x, y, z, radius, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, strength);
}

int apply_smooth_capsule_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length, float strength) {
    return apply_smooth_to_density(cx, cy, cz, x, y, z, radius, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, strength);
}

int apply_flatten_sphere_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float strength) {
    return apply_flatten_to_density(cx, cy, cz, x, y, z, radius, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, strength);
}

int apply_flatten_box_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float strength) {
    return apply_flatten_to_density(cx, cy, cz, x, y, z, radius, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, strength);
}

int apply_flatten_capsule_to_density(int cx, int cy, int cz, float x, float y, float z, float radius, float dx, float dy, float dz, float length, float strength) {
    return apply_flatten_to_density(cx, cy, cz, x, y, z, radius, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, strength);
}

void clear_edits(void) {
    g_edit_count = 0;
}

static int clamp_material_id(int material) {
    if (material < 0) return 0;
    if (material > 255) return 255;
    return material;
}

static int add_edit(float x, float y, float z, float radius, int edit_type, int shape, float dx, float dy, float dz, float length, int material, float strength, float falloff) {
    if (g_edit_count >= MAX_EDITS) return 0;
    g_edit_x[g_edit_count] = x;
    g_edit_y[g_edit_count] = y;
    g_edit_z[g_edit_count] = z;
    g_edit_r[g_edit_count] = radius;
    normalized_dir(dx, dy, dz, &g_edit_dx[g_edit_count], &g_edit_dy[g_edit_count], &g_edit_dz[g_edit_count]);
    g_edit_length[g_edit_count] = maxf2(length, 0.0f);
    g_edit_type[g_edit_count] = edit_type;
    g_edit_shape[g_edit_count] = shape;
    g_edit_material[g_edit_count] = clamp_material_id(material);
    g_edit_strength[g_edit_count] = clampf(strength, 0.0f, 1.0f);
    g_edit_falloff[g_edit_count] = clampf(falloff, 0.0f, radius);
    g_edit_count++;
    return 1;
}

int add_subtract_sphere(float x, float y, float z, float radius) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, 0.0f);
}

int add_add_sphere(float x, float y, float z, float radius) {
    return add_edit(x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, 0.0f);
}

int add_subtract_box(float x, float y, float z, float radius) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, 0.0f);
}

int add_add_box(float x, float y, float z, float radius) {
    return add_edit(x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, 0.0f);
}

int add_subtract_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0, 0.0f, 0.0f);
}

int add_add_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length) {
    return add_edit(x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0, 0.0f, 0.0f);
}

int add_subtract_sphere_falloff(float x, float y, float z, float radius, float falloff) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, falloff);
}

int add_add_sphere_falloff(float x, float y, float z, float radius, float falloff) {
    return add_edit(x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, falloff);
}

int add_subtract_box_falloff(float x, float y, float z, float radius, float falloff) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, falloff);
}

int add_add_box_falloff(float x, float y, float z, float radius, float falloff) {
    return add_edit(x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0, 0.0f, falloff);
}

int add_subtract_capsule_falloff(float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SUBTRACT, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0, 0.0f, falloff);
}

int add_add_capsule_falloff(float x, float y, float z, float radius, float dx, float dy, float dz, float length, float falloff) {
    return add_edit(x, y, z, radius, EDIT_TYPE_ADD, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0, 0.0f, falloff);
}

int add_paint_sphere(float x, float y, float z, float radius, int material) {
    return add_edit(x, y, z, radius, EDIT_TYPE_PAINT, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, material, 0.0f, 0.0f);
}

int add_paint_box(float x, float y, float z, float radius, int material) {
    return add_edit(x, y, z, radius, EDIT_TYPE_PAINT, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, material, 0.0f, 0.0f);
}

int add_paint_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length, int material) {
    return add_edit(x, y, z, radius, EDIT_TYPE_PAINT, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, material, 0.0f, 0.0f);
}

int add_smooth_sphere(float x, float y, float z, float radius, float strength) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SMOOTH, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0, strength, 0.0f);
}

int add_smooth_box(float x, float y, float z, float radius, float strength) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SMOOTH, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0, strength, 0.0f);
}

int add_smooth_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length, float strength) {
    return add_edit(x, y, z, radius, EDIT_TYPE_SMOOTH, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0, strength, 0.0f);
}

int add_flatten_sphere(float x, float y, float z, float radius, float strength) {
    return add_edit(x, y, z, radius, EDIT_TYPE_FLATTEN, EDIT_SHAPE_SPHERE, 0.0f, 0.0f, 1.0f, 0.0f, 0, strength, 0.0f);
}

int add_flatten_box(float x, float y, float z, float radius, float strength) {
    return add_edit(x, y, z, radius, EDIT_TYPE_FLATTEN, EDIT_SHAPE_BOX, 0.0f, 0.0f, 1.0f, 0.0f, 0, strength, 0.0f);
}

int add_flatten_capsule(float x, float y, float z, float radius, float dx, float dy, float dz, float length, float strength) {
    return add_edit(x, y, z, radius, EDIT_TYPE_FLATTEN, EDIT_SHAPE_CAPSULE, dx, dy, dz, length, 0, strength, 0.0f);
}

unsigned int get_vertex_ptr(void) { return (unsigned int)&g_vertices[0]; }
unsigned int get_index_ptr(void) { return (unsigned int)&g_indices[0]; }
unsigned int get_density_ptr(void) { return (unsigned int)&g_density[0]; }
unsigned int get_lod_transition_position_ptr(void) { return (unsigned int)&g_lod_transition_positions[0]; }
unsigned int get_lod_transition_density_ptr(void) { return (unsigned int)&g_lod_transition_densities[0]; }
unsigned int get_lod_transition_chunk_position_ptr(void) { return (unsigned int)&g_lod_transition_chunk_positions[0]; }
unsigned int get_lod_transition_chunk_density_ptr(void) { return (unsigned int)&g_lod_transition_chunk_densities[0]; }
unsigned int get_lod_transition_chunk_sides_ptr(void) { return (unsigned int)&g_lod_transition_chunk_sides[0]; }
int get_lod_transition_max_chunk_cells(void) { return LOD_TRANSITION_MAX_CHUNK_CELLS; }
float get_pack_origin_x(void) { return g_pack_origin_x; }
float get_pack_origin_y(void) { return g_pack_origin_y; }
float get_pack_origin_z(void) { return g_pack_origin_z; }
float get_pack_scale(void) { return g_pack_scale; }
unsigned int get_vertex_count(void) { return g_vertex_count; }
unsigned int get_index_count(void) { return g_index_count; }
unsigned int get_density_count(void) { return GRID_N * GRID_N * GRID_N; }
int get_lod_transition_sample_count(void) { return LOD_TRANSITION_SAMPLE_COUNT; }
int get_lod_transition_algorithm_id(void) { return LOD_TRANSITION_ALGORITHM_TRANSITION_PRISM_TETRA_TABLE; }
unsigned int get_overflow(void) { return g_overflow; }
int get_vertex_stride(void) { return VERTEX_STRIDE; }
int get_density_stride(void) { return DENSITY_STRIDE; }
float get_density_scale(void) { return DENSITY_SCALE; }
int get_mesher_id(void) { return MESHER_MARCHING_CUBES; }
void set_chunk_lod(int lod) { configure_lod(lod); }
int get_chunk_lod(void) { return g_lod; }
float get_base_chunk_world_size(void) { return BASE_CHUNK_WORLD_SIZE; }
float get_chunk_world_size(void) { return g_chunk_world_size; }
float get_cell_size(void) { return g_cell_size; }
int get_chunk_n(void) { return CHUNK_N; }
float get_bounds_min_x(void) { return g_bounds_min_x; }
float get_bounds_min_y(void) { return g_bounds_min_y; }
float get_bounds_min_z(void) { return g_bounds_min_z; }
float get_bounds_max_x(void) { return g_bounds_max_x; }
float get_bounds_max_y(void) { return g_bounds_max_y; }
float get_bounds_max_z(void) { return g_bounds_max_z; }
unsigned int get_worldgen_tile_field_ptr(void) { return (unsigned int)&g_worldgen_tile_fields[0]; }
unsigned int get_worldgen_tile_biome_id_ptr(void) { return (unsigned int)&g_worldgen_tile_biome_ids[0]; }
unsigned int get_worldgen_tile_water_id_ptr(void) { return (unsigned int)&g_worldgen_tile_water_ids[0]; }
unsigned int get_worldgen_tile_river_id_ptr(void) { return (unsigned int)&g_worldgen_tile_river_ids[0]; }
int get_worldgen_tile_resolution(void) { return WORLDGEN_TILE_RESOLUTION; }
int get_worldgen_tile_sample_count(void) { return WORLDGEN_TILE_SAMPLE_COUNT; }
int get_worldgen_tile_field_count(void) { return WORLDGEN_TILE_FIELD_COUNT; }
float get_worldgen_tile_size(void) { return WORLDGEN_TILE_SIZE; }
unsigned int get_erosion_tile_field_ptr(void) { return (unsigned int)&g_erosion_tile_fields[0]; }
int get_erosion_tile_resolution(void) { return EROSION_TILE_RESOLUTION; }
int get_erosion_tile_sample_count(void) { return EROSION_TILE_SAMPLE_COUNT; }
int get_erosion_tile_field_count(void) { return EROSION_TILE_FIELD_COUNT; }
int get_erosion_tile_schema_version(void) { return EROSION_TILE_SCHEMA_VERSION; }
int get_erosion_tile_generator_version(void) { return EROSION_TILE_GENERATOR_VERSION; }
float get_erosion_tile_size(void) { return EROSION_TILE_SIZE; }
unsigned int get_material_tile_field_ptr(void) { return (unsigned int)&g_material_tile_fields[0]; }
unsigned int get_material_tile_id_ptr(void) { return (unsigned int)&g_material_tile_ids[0]; }
int get_material_tile_resolution(void) { return MATERIAL_TILE_RESOLUTION; }
int get_material_tile_sample_count(void) { return MATERIAL_TILE_SAMPLE_COUNT; }
int get_material_tile_field_count(void) { return MATERIAL_TILE_FIELD_COUNT; }
int get_material_tile_schema_version(void) { return MATERIAL_TILE_SCHEMA_VERSION; }
int get_material_tile_generator_version(void) { return MATERIAL_TILE_GENERATOR_VERSION; }
float get_material_tile_size(void) { return MATERIAL_TILE_SIZE; }
unsigned int get_cave_graph_passage_ptr(void) { return (unsigned int)&g_cave_graph_passages[0]; }
unsigned int get_cave_graph_chamber_ptr(void) { return (unsigned int)&g_cave_graph_chambers[0]; }
int get_cave_graph_passage_count(void) { return g_cave_graph_passage_count; }
int get_cave_graph_chamber_count(void) { return g_cave_graph_chamber_count; }
int get_cave_graph_max_passages(void) { return CAVE_GRAPH_MAX_PASSAGES; }
int get_cave_graph_max_chambers(void) { return CAVE_GRAPH_MAX_CHAMBERS; }
int get_cave_graph_passage_field_count(void) { return CAVE_GRAPH_PASSAGE_FIELD_COUNT; }
int get_cave_graph_chamber_field_count(void) { return CAVE_GRAPH_CHAMBER_FIELD_COUNT; }
int get_cave_graph_tile_schema_version(void) { return CAVE_GRAPH_TILE_SCHEMA_VERSION; }
int get_cave_graph_tile_generator_version(void) { return CAVE_GRAPH_TILE_GENERATOR_VERSION; }
float get_cave_graph_tile_size(void) { return CAVE_GRAPH_TILE_SIZE; }
float get_terrain_height(float x, float z) { return terrain_height(x, z); }
float get_river_center(float z) { return river_center(z); }
float get_macro_continent(float x, float z) { return macro_continent(x, z); }
float get_moisture_mask(float x, float z) { return macro_moisture(x, z); }
float get_temperature_mask(float x, float z) { return macro_temperature(x, z); }
float get_cave_distance(float x, float y, float z) { return cave_distance(x, y, z); }
float get_biome_mask(float x, float z) { return biome_mask_from_height(x, z, terrain_height(x, z)); }
float get_wetness_mask(float x, float y, float z, float ny) { return wetness_mask_from_height(x, y, z, ny, terrain_height(x, z)); }
float get_snow_mask(float x, float y, float z, float ny) { return snow_mask_from_height(x, y, z, ny, terrain_height(x, z)); }
float get_drainage_mask(float x, float z) { return drainage_mask_from_height(x, z, terrain_height(x, z)); }
float get_erosion_mask(float x, float z, float ny) { return erosion_mask_from_height(x, z, terrain_height(x, z), ny); }
float get_vegetation_mask(float x, float z) {
    float h = terrain_height(x, z);
    float drainage = drainage_mask_from_height(x, z, h);
    float erosion = erosion_mask_from_height(x, z, h, 0.8f);
    return vegetation_mask_from_fields(x, z, h, 0.8f, drainage, erosion);
}
