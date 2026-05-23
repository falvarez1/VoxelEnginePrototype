// voxel_core.c
// Minimal freestanding WASM terrain core for Storm Canyon.
// Compiles with clang --target=wasm32-unknown-unknown-wasm without libc.

#define CHUNK_N 16
#define GRID_N (CHUNK_N + 1)
#define CELL_SIZE 2.0f
#define CHUNK_WORLD_SIZE ((float)CHUNK_N * CELL_SIZE)
#define MAX_VERTS 180000
#define MAX_INDICES 540000
#define MAX_EDITS 128

static float g_vertices[MAX_VERTS * 8]; // pos.xyz, normal.xyz, material, ao
static unsigned int g_indices[MAX_INDICES];
static unsigned int g_vertex_count = 0;
static unsigned int g_index_count = 0;
static unsigned int g_overflow = 0;
static float g_density[GRID_N * GRID_N * GRID_N];

static float g_edit_x[MAX_EDITS];
static float g_edit_y[MAX_EDITS];
static float g_edit_z[MAX_EDITS];
static float g_edit_r[MAX_EDITS];
static int g_edit_count = 0;

static inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline float absf2(float x) { return x < 0.0f ? -x : x; }
static inline float minf2(float a, float b) { return a < b ? a : b; }
static inline float maxf2(float a, float b) { return a > b ? a : b; }
static inline float mixf(float a, float b, float t) { return a + (b - a) * t; }
static inline float smooth(float t) { return t * t * (3.0f - 2.0f * t); }
static inline int fastfloor(float x) { int i = (int)x; return (x < (float)i) ? i - 1 : i; }
static inline float sqrtf2(float x) { return __builtin_sqrtf(x); }

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

static float river_center(float z) {
    float n1 = value_noise2(z * 0.010f, 17.3f) * 2.0f - 1.0f;
    float n2 = value_noise2(z * 0.027f + 81.2f, 9.7f) * 2.0f - 1.0f;
    return n1 * 42.0f + n2 * 12.0f;
}

static float terrain_height(float x, float z) {
    float continent = fbm2(x * 0.0025f + 19.0f, z * 0.0025f - 4.0f);
    float base = 22.0f + 12.0f * fbm2(x * 0.012f, z * 0.012f);
    float hills = 10.0f * fbm2(x * 0.035f + 5.2f, z * 0.035f - 8.1f);
    float ridge = ridge2(x * 0.010f - 14.0f, z * 0.010f + 6.0f);
    float ridge_mask = clampf((continent + 0.25f) * 1.25f, 0.0f, 1.0f);
    float h = base + hills + ridge * ridge_mask * 42.0f;

    // Carve a broad cinematic river canyon through the terrain.
    float rc = river_center(z);
    float dist = absf2(x - rc);
    float valley_width = 40.0f + 12.0f * value_noise2(z * 0.018f, 41.0f);
    float canyon = clampf(1.0f - dist / valley_width, 0.0f, 1.0f);
    canyon = smooth(canyon);
    float riverbed = 5.5f + 1.5f * fbm2(x * 0.030f + 77.0f, z * 0.030f);
    h = mixf(h, riverbed, canyon * 0.92f);

    // Add terraces/strata-like ledges near the canyon.
    float terrace = value_noise2(x * 0.065f, z * 0.065f) * 2.0f - 1.0f;
    h += terrace * canyon * 2.5f;
    return h;
}

static float cave_distance(float x, float y, float z) {
    // A continuous cave/tunnel following the canyon, with chambers and warped radius.
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

float sample_density(float x, float y, float z) {
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

    // Runtime destructive edits: carve air spheres into the solid field.
    for (int i = 0; i < g_edit_count; ++i) {
        float dx = x - g_edit_x[i];
        float dy = y - g_edit_y[i];
        float dz = z - g_edit_z[i];
        float dist = sqrtf2(dx * dx + dy * dy + dz * dz);
        float carve = g_edit_r[i] - dist;
        d = maxf2(d, carve);
    }
    return d;
}

static int grid_index(int x, int y, int z) {
    return x + GRID_N * (y + GRID_N * z);
}

static void gradient(float x, float y, float z, float out[3]) {
    float e = 0.85f;
    float dx = sample_density(x + e, y, z) - sample_density(x - e, y, z);
    float dy = sample_density(x, y + e, z) - sample_density(x, y - e, z);
    float dz = sample_density(x, y, z + e) - sample_density(x, y, z - e);
    float len = sqrtf2(dx * dx + dy * dy + dz * dz);
    if (len < 0.0001f) {
        out[0] = 0.0f; out[1] = 1.0f; out[2] = 0.0f;
    } else {
        out[0] = dx / len; out[1] = dy / len; out[2] = dz / len;
    }
}

static float material_for(float x, float y, float z, float ny) {
    float h = terrain_height(x, z);
    float rc = river_center(z);
    float river_dist = absf2(x - rc);
    if (y < 7.8f && river_dist < 14.0f) return 3.0f; // wet sand/mud
    if (ny < 0.52f || y < h - 2.0f) return 1.0f;    // rock/cave
    if (y > 52.0f && ny > 0.38f) return 2.0f;        // snow
    if (y > 42.0f && ny < 0.75f) return 1.0f;        // alpine rock
    return 0.0f;                                      // grass/soil
}

static unsigned int add_vertex(float x, float y, float z) {
    if (g_vertex_count >= MAX_VERTS) {
        g_overflow = 1;
        return 0;
    }
    float n[3];
    gradient(x, y, z, n);
    float mat = material_for(x, y, z, n[1]);
    float ao = clampf(0.42f + 0.58f * (n[1] * 0.5f + 0.5f), 0.22f, 1.0f);
    unsigned int base = g_vertex_count * 8u;
    g_vertices[base + 0u] = x;
    g_vertices[base + 1u] = y;
    g_vertices[base + 2u] = z;
    g_vertices[base + 3u] = n[0];
    g_vertices[base + 4u] = n[1];
    g_vertices[base + 5u] = n[2];
    g_vertices[base + 6u] = mat;
    g_vertices[base + 7u] = ao;
    return g_vertex_count++;
}

static void add_triangle(float ax, float ay, float az, float bx, float by, float bz, float cx, float cy, float cz) {
    if (g_index_count + 3u >= MAX_INDICES || g_vertex_count + 3u >= MAX_VERTS) {
        g_overflow = 1;
        return;
    }
    unsigned int ia = add_vertex(ax, ay, az);
    unsigned int ib = add_vertex(bx, by, bz);
    unsigned int ic = add_vertex(cx, cy, cz);
    g_indices[g_index_count++] = ia;
    g_indices[g_index_count++] = ib;
    g_indices[g_index_count++] = ic;
}

static void interp(float p0[3], float p1[3], float v0, float v1, float out[3]) {
    float denom = v0 - v1;
    float t = 0.5f;
    if (denom > 0.00001f || denom < -0.00001f) {
        t = clampf(v0 / (v0 - v1), 0.0f, 1.0f);
    }
    out[0] = mixf(p0[0], p1[0], t);
    out[1] = mixf(p0[1], p1[1], t);
    out[2] = mixf(p0[2], p1[2], t);
}

static void polygonise_tet(float p[4][3], float val[4]) {
    int inside[4];
    int in_count = 0;
    int in_idx[4];
    int out_idx[4];
    int oi = 0, ii = 0;
    for (int i = 0; i < 4; ++i) {
        inside[i] = val[i] < 0.0f;
        if (inside[i]) in_idx[ii++] = i; else out_idx[oi++] = i;
        in_count += inside[i] ? 1 : 0;
    }
    if (in_count == 0 || in_count == 4) return;

    if (in_count == 1 || in_count == 3) {
        int a;
        int b[3];
        if (in_count == 1) {
            a = in_idx[0]; b[0] = out_idx[0]; b[1] = out_idx[1]; b[2] = out_idx[2];
        } else {
            a = out_idx[0]; b[0] = in_idx[0]; b[1] = in_idx[1]; b[2] = in_idx[2];
        }
        float q0[3], q1[3], q2[3];
        interp(p[a], p[b[0]], val[a], val[b[0]], q0);
        interp(p[a], p[b[1]], val[a], val[b[1]], q1);
        interp(p[a], p[b[2]], val[a], val[b[2]], q2);
        if (in_count == 1) add_triangle(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]);
        else add_triangle(q0[0], q0[1], q0[2], q2[0], q2[1], q2[2], q1[0], q1[1], q1[2]);
        return;
    }

    // Two inside, two outside -> quad split into two triangles.
    int a = in_idx[0], b = in_idx[1], c = out_idx[0], d = out_idx[1];
    float q0[3], q1[3], q2[3], q3[3];
    interp(p[a], p[c], val[a], val[c], q0);
    interp(p[a], p[d], val[a], val[d], q1);
    interp(p[b], p[c], val[b], val[c], q2);
    interp(p[b], p[d], val[b], val[d], q3);
    add_triangle(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]);
    add_triangle(q2[0], q2[1], q2[2], q1[0], q1[1], q1[2], q3[0], q3[1], q3[2]);
}

int generate_chunk(int cx, int cy, int cz, int lod) {
    (void)lod;
    g_vertex_count = 0;
    g_index_count = 0;
    g_overflow = 0;

    float base_x = (float)cx * CHUNK_WORLD_SIZE;
    float base_y = (float)cy * CHUNK_WORLD_SIZE;
    float base_z = (float)cz * CHUNK_WORLD_SIZE;

    for (int z = 0; z < GRID_N; ++z) {
        for (int y = 0; y < GRID_N; ++y) {
            for (int x = 0; x < GRID_N; ++x) {
                float wx = base_x + (float)x * CELL_SIZE;
                float wy = base_y + (float)y * CELL_SIZE;
                float wz = base_z + (float)z * CELL_SIZE;
                g_density[grid_index(x, y, z)] = sample_density(wx, wy, wz);
            }
        }
    }

    static const int cube_corners[8][3] = {
        {0,0,0}, {1,0,0}, {1,1,0}, {0,1,0},
        {0,0,1}, {1,0,1}, {1,1,1}, {0,1,1}
    };
    static const int tets[6][4] = {
        {0,5,1,6}, {0,1,2,6}, {0,2,3,6},
        {0,3,7,6}, {0,7,4,6}, {0,4,5,6}
    };

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
                    cp[c][0] = base_x + (float)gx * CELL_SIZE;
                    cp[c][1] = base_y + (float)gy * CELL_SIZE;
                    cp[c][2] = base_z + (float)gz * CELL_SIZE;
                    cv[c] = g_density[grid_index(gx, gy, gz)];
                    solid += (cv[c] < 0.0f) ? 1 : 0;
                }
                if (solid == 0 || solid == 8) continue;
                for (int t = 0; t < 6; ++t) {
                    float tp[4][3];
                    float tv[4];
                    for (int k = 0; k < 4; ++k) {
                        int ci = tets[t][k];
                        tp[k][0] = cp[ci][0]; tp[k][1] = cp[ci][1]; tp[k][2] = cp[ci][2];
                        tv[k] = cv[ci];
                    }
                    polygonise_tet(tp, tv);
                }
            }
        }
    }
    return (int)g_vertex_count;
}

void clear_edits(void) {
    g_edit_count = 0;
}

int add_subtract_sphere(float x, float y, float z, float radius) {
    if (g_edit_count >= MAX_EDITS) return 0;
    g_edit_x[g_edit_count] = x;
    g_edit_y[g_edit_count] = y;
    g_edit_z[g_edit_count] = z;
    g_edit_r[g_edit_count] = radius;
    g_edit_count++;
    return 1;
}

unsigned int get_vertex_ptr(void) { return (unsigned int)&g_vertices[0]; }
unsigned int get_index_ptr(void) { return (unsigned int)&g_indices[0]; }
unsigned int get_vertex_count(void) { return g_vertex_count; }
unsigned int get_index_count(void) { return g_index_count; }
unsigned int get_overflow(void) { return g_overflow; }
float get_chunk_world_size(void) { return CHUNK_WORLD_SIZE; }
float get_cell_size(void) { return CELL_SIZE; }
int get_chunk_n(void) { return CHUNK_N; }
float get_terrain_height(float x, float z) { return terrain_height(x, z); }
float get_river_center(float z) { return river_center(z); }
