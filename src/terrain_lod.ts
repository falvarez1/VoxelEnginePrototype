export const TERRAIN_LOD1_RING_INSET = 5;
export const TERRAIN_LOD2_RING_INSET = 2;
export const TERRAIN_LOD2_MIN_RADIUS = 10;
export const MAX_TERRAIN_LOD = 3;
export const TERRAIN_LOD_CHUNK_CELLS = 32;

export const LOD_SEAM_NEG_X = 1 << 0;
export const LOD_SEAM_POS_X = 1 << 1;
export const LOD_SEAM_NEG_Z = 1 << 2;
export const LOD_SEAM_POS_Z = 1 << 3;
export const LOD_SEAM_MASK_ALL = LOD_SEAM_NEG_X | LOD_SEAM_POS_X | LOD_SEAM_NEG_Z | LOD_SEAM_POS_Z;

export interface TerrainLodRequest {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  priority: number;
  lodSeamMask: number;
}

export type TerrainLodTransitionSide = 'negX' | 'posX' | 'negZ' | 'posZ';

export interface TerrainLodTransitionFace {
  key: string;
  sourceKey: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  side: TerrainLodTransitionSide;
  seamMaskBit: number;
  span: number;
  neighborMinLod: number;
  neighborMaxLod: number;
  neighborBaseCells: number;
  priority: number;
}

export interface TerrainLodTransitionCell {
  key: string;
  faceKey: string;
  sourceKey: string;
  neighborKey: string;
  cx: number;
  cy: number;
  cz: number;
  lod: number;
  side: TerrainLodTransitionSide;
  span: number;
  localU: number;
  localV: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  neighborLod: number;
  priority: number;
}

export type TerrainLodTransitionSampleRole = 'coarseFace' | 'neighborCell';

export interface TerrainLodTransitionSamplePoint {
  key: string;
  cellKey: string;
  chunkKey: string;
  role: TerrainLodTransitionSampleRole;
  corner: number;
  gx: number;
  gy: number;
  gz: number;
}

export interface TerrainLodTransitionSample extends TerrainLodTransitionSamplePoint {
  density: number | null;
  solid: boolean;
}

export type TerrainLodTransitionDensityProvider = (point: TerrainLodTransitionSamplePoint) => number | null | undefined;

export interface TerrainLodTransitionCellCase {
  key: string;
  cellKey: string;
  faceKey: string;
  sourceKey: string;
  neighborKey: string;
  side: TerrainLodTransitionSide;
  lod: number;
  neighborLod: number;
  span: number;
  coarseFaceCase: number;
  neighborCellCase: number;
  combinedCase: number;
  sampleCount: number;
  samplesPresent: number;
  missingSamples: number;
  coarseSolidCorners: number;
  neighborSolidCorners: number;
  minDensity: number | null;
  maxDensity: number | null;
  crossesSurface: boolean;
  samples: TerrainLodTransitionSample[];
}

export interface TerrainLodTransitionMeshVertex {
  key: string;
  cellKey: string;
  edgeKey: string;
  x: number;
  y: number;
  z: number;
}

export interface TerrainLodTransitionMeshCell {
  cellKey: string;
  combinedCase: number;
  vertexStart: number;
  vertexCount: number;
  triangleStart: number;
  triangleCount: number;
  skippedReason: 'none' | 'missing-samples' | 'uniform' | 'degenerate';
}

export interface TerrainLodTransitionMesh {
  algorithm: 'transition-prism-tetra-table-v1';
  cellCount: number;
  emittedCells: number;
  skippedCells: number;
  missingSampleCells: number;
  degenerateCells: number;
  vertices: TerrainLodTransitionMeshVertex[];
  indices: number[];
  cells: TerrainLodTransitionMeshCell[];
}

export interface TerrainLodPlanOptions {
  cameraChunkX: number;
  cameraChunkZ: number;
  radius: number;
  verticalChunks: readonly number[];
  lodEnabled: boolean;
  minStreamRadius: number;
}

export interface TerrainLodPlanSummary {
  targetChunks: number;
  lod0Chunks: number;
  lod1Chunks: number;
  lod2PlusChunks: number;
  transitionEdges: number;
  transitionFaces: number;
  transitionFaceBaseCells: number;
  transitionCells: number;
  skirtedChunks: number;
  coveredBaseCells: number;
  maxLod: number;
}

const LOD_TRANSITION_SIDES: ReadonlyArray<{
  side: TerrainLodTransitionSide;
  bit: number;
}> = [
  { side: 'negX', bit: LOD_SEAM_NEG_X },
  { side: 'posX', bit: LOD_SEAM_POS_X },
  { side: 'negZ', bit: LOD_SEAM_NEG_Z },
  { side: 'posZ', bit: LOD_SEAM_POS_Z },
];

export function terrainChunkKey(cx: number, cy: number, cz: number, lod = 0): string {
  return `${cx},${cy},${cz},${lod}`;
}

export function parseTerrainChunkKey(key: string): [number, number, number, number] {
  return key.split(',').map(Number) as [number, number, number, number];
}

export function clampTerrainLod(lod: number): number {
  return Math.max(0, Math.min(MAX_TERRAIN_LOD, lod | 0));
}

export function lodSpan(lod: number): number {
  return 1 << clampTerrainLod(lod);
}

export function alignChunkCoord(coord: number, lod: number): number {
  const span = lodSpan(lod);
  return Math.floor(coord / span) * span;
}

export function lodChunkIntersectsInnerRing(
  cx: number,
  cz: number,
  lod: number,
  cameraCx: number,
  cameraCz: number,
  innerRadius: number,
): boolean {
  const span = lodSpan(lod);
  for (let oz = 0; oz < span; oz++) {
    for (let ox = 0; ox < span; ox++) {
      if (Math.hypot(cx + ox - cameraCx, cz + oz - cameraCz) <= innerRadius + 0.35) return true;
    }
  }
  return false;
}

export function terrainLodForDistance(distance: number, radius: number): number {
  if (radius >= TERRAIN_LOD2_MIN_RADIUS && distance > radius - TERRAIN_LOD2_RING_INSET) return 2;
  if (distance > radius - TERRAIN_LOD1_RING_INSET) return 1;
  return 0;
}

export function terrainLodInnerRadius(lod: number, radius: number, minStreamRadius: number): number {
  if (lod >= 2) return Math.max(minStreamRadius, radius - TERRAIN_LOD2_RING_INSET);
  if (lod === 1) return Math.max(minStreamRadius, radius - TERRAIN_LOD1_RING_INSET);
  return radius;
}

export function chunkRangeDistance(cx: number, cz: number, lod: number, cameraCx: number, cameraCz: number): number {
  const span = lodSpan(lod);
  const px = cameraCx + 0.5;
  const pz = cameraCz + 0.5;
  const dx = px < cx ? cx - px : px > cx + span ? px - (cx + span) : 0;
  const dz = pz < cz ? cz - pz : pz > cz + span ? pz - (cz + span) : 0;
  return Math.hypot(dx, dz);
}

function coverageKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

export function countLodTransitionEdges(mask: number): number {
  let count = 0;
  const active = mask & LOD_SEAM_MASK_ALL;
  if (active & LOD_SEAM_NEG_X) count++;
  if (active & LOD_SEAM_POS_X) count++;
  if (active & LOD_SEAM_NEG_Z) count++;
  if (active & LOD_SEAM_POS_Z) count++;
  return count;
}

export function applyTerrainLodSeamMasks(requests: Map<string, TerrainLodRequest>): void {
  const coverage = new Map<string, TerrainLodRequest>();
  for (const request of requests.values()) {
    const span = lodSpan(request.lod);
    for (let oy = 0; oy < span; oy++) {
      for (let oz = 0; oz < span; oz++) {
        for (let ox = 0; ox < span; ox++) {
          coverage.set(coverageKey(request.cx + ox, request.cy + oy, request.cz + oz), request);
        }
      }
    }
  }

  for (const request of requests.values()) {
    const lod = clampTerrainLod(request.lod);
    const span = lodSpan(lod);
    let mask = 0;
    if (lod > 0) {
      const checkNeighbor = (side: number, nx: number, ny: number, nz: number): void => {
        const neighbor = coverage.get(coverageKey(nx, ny, nz));
        if (neighbor && neighbor.key !== request.key && clampTerrainLod(neighbor.lod) < lod) mask |= side;
      };
      for (let oy = 0; oy < span; oy++) {
        for (let oz = 0; oz < span; oz++) {
          checkNeighbor(LOD_SEAM_NEG_X, request.cx - 1, request.cy + oy, request.cz + oz);
          checkNeighbor(LOD_SEAM_POS_X, request.cx + span, request.cy + oy, request.cz + oz);
        }
        for (let ox = 0; ox < span; ox++) {
          checkNeighbor(LOD_SEAM_NEG_Z, request.cx + ox, request.cy + oy, request.cz - 1);
          checkNeighbor(LOD_SEAM_POS_Z, request.cx + ox, request.cy + oy, request.cz + span);
        }
      }
    }
    request.lodSeamMask = mask;
  }
}

function buildBaseCoverage(requests: readonly TerrainLodRequest[]): Map<string, TerrainLodRequest> {
  const coverage = new Map<string, TerrainLodRequest>();
  for (const request of requests) {
    const span = lodSpan(request.lod);
    for (let oy = 0; oy < span; oy++) {
      for (let oz = 0; oz < span; oz++) {
        for (let ox = 0; ox < span; ox++) {
          coverage.set(coverageKey(request.cx + ox, request.cy + oy, request.cz + oz), request);
        }
      }
    }
  }
  return coverage;
}

export function buildTerrainLodTransitionPlan(requests: readonly TerrainLodRequest[]): TerrainLodTransitionFace[] {
  const coverage = buildBaseCoverage(requests);
  const transitions: TerrainLodTransitionFace[] = [];
  for (const request of requests) {
    const lod = clampTerrainLod(request.lod);
    const activeMask = request.lodSeamMask & LOD_SEAM_MASK_ALL;
    if (lod <= 0 || activeMask === 0) continue;
    const span = lodSpan(lod);
    for (const side of LOD_TRANSITION_SIDES) {
      if ((activeMask & side.bit) === 0) continue;
      let neighborBaseCells = 0;
      let neighborMinLod = Number.POSITIVE_INFINITY;
      let neighborMaxLod = 0;
      const visitNeighbor = (nx: number, ny: number, nz: number): void => {
        const neighbor = coverage.get(coverageKey(nx, ny, nz));
        if (!neighbor || neighbor.key === request.key) return;
        const neighborLod = clampTerrainLod(neighbor.lod);
        if (neighborLod >= lod) return;
        neighborBaseCells++;
        neighborMinLod = Math.min(neighborMinLod, neighborLod);
        neighborMaxLod = Math.max(neighborMaxLod, neighborLod);
      };
      if (side.side === 'negX' || side.side === 'posX') {
        const nx = side.side === 'negX' ? request.cx - 1 : request.cx + span;
        for (let oy = 0; oy < span; oy++) {
          for (let oz = 0; oz < span; oz++) visitNeighbor(nx, request.cy + oy, request.cz + oz);
        }
      } else {
        const nz = side.side === 'negZ' ? request.cz - 1 : request.cz + span;
        for (let oy = 0; oy < span; oy++) {
          for (let ox = 0; ox < span; ox++) visitNeighbor(request.cx + ox, request.cy + oy, nz);
        }
      }
      transitions.push({
        key: `${request.key}:${side.side}`,
        sourceKey: request.key,
        cx: request.cx,
        cy: request.cy,
        cz: request.cz,
        lod,
        side: side.side,
        seamMaskBit: side.bit,
        span,
        neighborMinLod: Number.isFinite(neighborMinLod) ? neighborMinLod : 0,
        neighborMaxLod,
        neighborBaseCells,
        priority: request.priority + transitions.length * 0.001,
      });
    }
  }
  return transitions.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

export function buildTerrainLodTransitionCells(requests: readonly TerrainLodRequest[]): TerrainLodTransitionCell[] {
  const coverage = buildBaseCoverage(requests);
  const cells: TerrainLodTransitionCell[] = [];
  const addCell = (
    transition: TerrainLodTransitionFace,
    neighbor: TerrainLodRequest | undefined,
    localU: number,
    localV: number,
    baseX: number,
    baseY: number,
    baseZ: number,
  ): void => {
    if (!neighbor || neighbor.key === transition.sourceKey) return;
    const neighborLod = clampTerrainLod(neighbor.lod);
    if (neighborLod >= transition.lod) return;
    cells.push({
      key: `${transition.key}:${baseX},${baseY},${baseZ}`,
      faceKey: transition.key,
      sourceKey: transition.sourceKey,
      neighborKey: neighbor.key,
      cx: transition.cx,
      cy: transition.cy,
      cz: transition.cz,
      lod: transition.lod,
      side: transition.side,
      span: transition.span,
      localU,
      localV,
      baseX,
      baseY,
      baseZ,
      neighborLod,
      priority: transition.priority + cells.length * 0.000001,
    });
  };

  for (const transition of buildTerrainLodTransitionPlan(requests)) {
    const span = transition.span;
    if (transition.side === 'negX' || transition.side === 'posX') {
      const baseX = transition.side === 'negX' ? transition.cx - 1 : transition.cx + span;
      for (let oy = 0; oy < span; oy++) {
        for (let oz = 0; oz < span; oz++) {
          const baseY = transition.cy + oy;
          const baseZ = transition.cz + oz;
          addCell(
            transition,
            coverage.get(coverageKey(baseX, baseY, baseZ)),
            oz,
            oy,
            baseX,
            baseY,
            baseZ,
          );
        }
      }
    } else {
      const baseZ = transition.side === 'negZ' ? transition.cz - 1 : transition.cz + span;
      for (let oy = 0; oy < span; oy++) {
        for (let ox = 0; ox < span; ox++) {
          const baseX = transition.cx + ox;
          const baseY = transition.cy + oy;
          addCell(
            transition,
            coverage.get(coverageKey(baseX, baseY, baseZ)),
            ox,
            oy,
            baseX,
            baseY,
            baseZ,
          );
        }
      }
    }
  }

  return cells.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

function clampGridIndex(value: number): number {
  return Math.max(0, Math.min(TERRAIN_LOD_CHUNK_CELLS, Math.round(value)));
}

function sampleRangeForBaseChunk(localBaseOffset: number, span: number): [number, number] {
  const clampedSpan = Math.max(1, span | 0);
  const start = clampGridIndex(localBaseOffset * TERRAIN_LOD_CHUNK_CELLS / clampedSpan);
  const end = clampGridIndex((localBaseOffset + 1) * TERRAIN_LOD_CHUNK_CELLS / clampedSpan);
  return start <= end ? [start, end] : [end, start];
}

function transitionSamplePoint(
  cell: TerrainLodTransitionCell,
  chunkKey: string,
  role: TerrainLodTransitionSampleRole,
  corner: number,
  gx: number,
  gy: number,
  gz: number,
): TerrainLodTransitionSamplePoint {
  return {
    key: `${cell.key}:${role}:${corner}`,
    cellKey: cell.key,
    chunkKey,
    role,
    corner,
    gx,
    gy,
    gz,
  };
}

function buildCoarseFaceSamplePoints(cell: TerrainLodTransitionCell): TerrainLodTransitionSamplePoint[] {
  const [u0, u1] = sampleRangeForBaseChunk(cell.localU, cell.span);
  const [v0, v1] = sampleRangeForBaseChunk(cell.localV, cell.span);
  const face = cell.side === 'negX' || cell.side === 'negZ' ? 0 : TERRAIN_LOD_CHUNK_CELLS;
  if (cell.side === 'negX' || cell.side === 'posX') {
    return [
      transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 0, face, v0, u0),
      transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 1, face, v0, u1),
      transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 2, face, v1, u0),
      transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 3, face, v1, u1),
    ];
  }
  return [
    transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 0, u0, v0, face),
    transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 1, u1, v0, face),
    transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 2, u0, v1, face),
    transitionSamplePoint(cell, cell.sourceKey, 'coarseFace', 3, u1, v1, face),
  ];
}

function buildNeighborCellSamplePoints(cell: TerrainLodTransitionCell): TerrainLodTransitionSamplePoint[] {
  const [neighborCx, neighborCy, neighborCz, neighborLod] = parseTerrainChunkKey(cell.neighborKey);
  const neighborSpan = lodSpan(neighborLod);
  const [x0, x1] = sampleRangeForBaseChunk(cell.baseX - neighborCx, neighborSpan);
  const [y0, y1] = sampleRangeForBaseChunk(cell.baseY - neighborCy, neighborSpan);
  const [z0, z1] = sampleRangeForBaseChunk(cell.baseZ - neighborCz, neighborSpan);
  return [
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 0, x0, y0, z0),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 1, x1, y0, z0),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 2, x0, y1, z0),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 3, x1, y1, z0),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 4, x0, y0, z1),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 5, x1, y0, z1),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 6, x0, y1, z1),
    transitionSamplePoint(cell, cell.neighborKey, 'neighborCell', 7, x1, y1, z1),
  ];
}

export function sampleTerrainLodTransitionCellCase(
  cell: TerrainLodTransitionCell,
  provider: TerrainLodTransitionDensityProvider,
): TerrainLodTransitionCellCase {
  const coarsePoints = buildCoarseFaceSamplePoints(cell);
  const neighborPoints = buildNeighborCellSamplePoints(cell);
  let coarseFaceCase = 0;
  let neighborCellCase = 0;
  let coarseSolidCorners = 0;
  let neighborSolidCorners = 0;
  let samplesPresent = 0;
  let minDensity = Number.POSITIVE_INFINITY;
  let maxDensity = Number.NEGATIVE_INFINITY;
  const samples: TerrainLodTransitionSample[] = [];
  const addSample = (point: TerrainLodTransitionSamplePoint, index: number): void => {
    const rawDensity = provider(point);
    const density = Number.isFinite(rawDensity as number) ? Number(rawDensity) : null;
    const solid = density !== null && density < 0;
    if (density !== null) {
      samplesPresent++;
      minDensity = Math.min(minDensity, density);
      maxDensity = Math.max(maxDensity, density);
    }
    if (solid) {
      if (point.role === 'coarseFace') {
        coarseFaceCase |= 1 << index;
        coarseSolidCorners++;
      } else {
        neighborCellCase |= 1 << index;
        neighborSolidCorners++;
      }
    }
    samples.push({ ...point, density, solid });
  };

  coarsePoints.forEach(addSample);
  neighborPoints.forEach(addSample);
  const sampleCount = samples.length;
  return {
    key: `${cell.key}:case`,
    cellKey: cell.key,
    faceKey: cell.faceKey,
    sourceKey: cell.sourceKey,
    neighborKey: cell.neighborKey,
    side: cell.side,
    lod: cell.lod,
    neighborLod: cell.neighborLod,
    span: cell.span,
    coarseFaceCase,
    neighborCellCase,
    combinedCase: (coarseFaceCase << 8) | neighborCellCase,
    sampleCount,
    samplesPresent,
    missingSamples: sampleCount - samplesPresent,
    coarseSolidCorners,
    neighborSolidCorners,
    minDensity: Number.isFinite(minDensity) ? minDensity : null,
    maxDensity: Number.isFinite(maxDensity) ? maxDensity : null,
    crossesSurface: Number.isFinite(minDensity) && Number.isFinite(maxDensity) && minDensity < 0 && maxDensity >= 0,
    samples,
  };
}

export function buildTerrainLodTransitionCases(
  requests: readonly TerrainLodRequest[],
  provider: TerrainLodTransitionDensityProvider,
): TerrainLodTransitionCellCase[] {
  return buildTerrainLodTransitionCells(requests).map(cell => sampleTerrainLodTransitionCellCase(cell, provider));
}

function sampleWorldPosition(point: TerrainLodTransitionSamplePoint): [number, number, number] {
  const [cx, cy, cz, lod] = parseTerrainChunkKey(point.chunkKey);
  const cellSize = lodSpan(lod);
  return [
    cx * TERRAIN_LOD_CHUNK_CELLS + point.gx * cellSize,
    cy * TERRAIN_LOD_CHUNK_CELLS + point.gy * cellSize,
    cz * TERRAIN_LOD_CHUNK_CELLS + point.gz * cellSize,
  ];
}

export function sampleTerrainLodTransitionGeometryPosition(
  point: TerrainLodTransitionSamplePoint,
  side: TerrainLodTransitionSide,
): [number, number, number] {
  const position = sampleWorldPosition(point);
  if (point.role !== 'coarseFace') return position;
  const [, , , lod] = parseTerrainChunkKey(point.chunkKey);
  const offset = Math.max(0.5, lodSpan(lod) * 0.5);
  if (side === 'negX') position[0] += offset;
  else if (side === 'posX') position[0] -= offset;
  else if (side === 'negZ') position[2] += offset;
  else position[2] -= offset;
  return position;
}

function transitionSampleByRoleAndCorner(
  transitionCase: TerrainLodTransitionCellCase,
  role: TerrainLodTransitionSampleRole,
  corner: number,
): TerrainLodTransitionSample | null {
  return transitionCase.samples.find(sample => sample.role === role && sample.corner === corner) ?? null;
}

function interpolateTransitionEdge(
  transitionCase: TerrainLodTransitionCellCase,
  role: TerrainLodTransitionSampleRole,
  aCorner: number,
  bCorner: number,
): TerrainLodTransitionMeshVertex | null {
  const a = transitionSampleByRoleAndCorner(transitionCase, role, aCorner);
  const b = transitionSampleByRoleAndCorner(transitionCase, role, bCorner);
  if (!a || !b || a.density === null || b.density === null || a.solid === b.solid) return null;
  const ap = sampleWorldPosition(a);
  const bp = sampleWorldPosition(b);
  const denominator = a.density - b.density;
  const t = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, a.density / denominator));
  return {
    key: `${transitionCase.cellKey}:${role}:${aCorner}-${bCorner}`,
    cellKey: transitionCase.cellKey,
    edgeKey: `${role}:${aCorner}-${bCorner}`,
    x: ap[0] + (bp[0] - ap[0]) * t,
    y: ap[1] + (bp[1] - ap[1]) * t,
    z: ap[2] + (bp[2] - ap[2]) * t,
  };
}

function transitionVertexDedupeKey(vertex: TerrainLodTransitionMeshVertex): string {
  return `${vertex.x.toFixed(5)},${vertex.y.toFixed(5)},${vertex.z.toFixed(5)}`;
}

interface TransitionMeshNode {
  id: string;
  cellKey: string;
  density: number;
  solid: boolean;
  x: number;
  y: number;
  z: number;
}

const HEX_TETRAHEDRA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
] as const;

const TETRA_EDGE_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
] as const;

function tetraEdgeIndex(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const index = TETRA_EDGE_CORNERS.findIndex(edge => edge[0] === lo && edge[1] === hi);
  if (index < 0) throw new Error(`Invalid tetra edge ${a}-${b}`);
  return index;
}

function buildTetraCaseTriangleTable(): ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> {
  const table: Array<Array<[number, number, number]>> = [];
  for (let mask = 0; mask < 16; mask++) {
    const solid: number[] = [];
    const empty: number[] = [];
    for (let i = 0; i < 4; i++) ((mask & (1 << i)) !== 0 ? solid : empty).push(i);
    const triangles: Array<[number, number, number]> = [];
    if (solid.length === 1) {
      const s = solid[0];
      triangles.push([
        tetraEdgeIndex(s, empty[0]),
        tetraEdgeIndex(s, empty[1]),
        tetraEdgeIndex(s, empty[2]),
      ]);
    } else if (solid.length === 3) {
      const e = empty[0];
      triangles.push([
        tetraEdgeIndex(e, solid[0]),
        tetraEdgeIndex(e, solid[2]),
        tetraEdgeIndex(e, solid[1]),
      ]);
    } else if (solid.length === 2) {
      const [s0, s1] = solid;
      const [e0, e1] = empty;
      triangles.push(
        [tetraEdgeIndex(s0, e0), tetraEdgeIndex(s1, e0), tetraEdgeIndex(s0, e1)],
        [tetraEdgeIndex(s0, e1), tetraEdgeIndex(s1, e0), tetraEdgeIndex(s1, e1)],
      );
    }
    table[mask] = triangles;
  }
  return table;
}

const TETRA_CASE_TRIANGLES = buildTetraCaseTriangleTable();

function transitionSeamNeighborNodeIndices(side: TerrainLodTransitionSide): number[] {
  if (side === 'negX') return [5, 9, 7, 11];
  if (side === 'posX') return [4, 8, 6, 10];
  if (side === 'negZ') return [8, 9, 10, 11];
  return [4, 5, 6, 7];
}

function buildTransitionMeshNodes(transitionCase: TerrainLodTransitionCellCase): TransitionMeshNode[] | null {
  const nodes: TransitionMeshNode[] = [];
  for (let i = 0; i < 4; i++) {
    const sample = transitionSampleByRoleAndCorner(transitionCase, 'coarseFace', i);
    if (!sample || sample.density === null) return null;
    const [x, y, z] = sampleTerrainLodTransitionGeometryPosition(sample, transitionCase.side);
    nodes.push({ id: `c${i}`, cellKey: transitionCase.cellKey, density: sample.density, solid: sample.solid, x, y, z });
  }
  for (let i = 0; i < 8; i++) {
    const sample = transitionSampleByRoleAndCorner(transitionCase, 'neighborCell', i);
    if (!sample || sample.density === null) return null;
    const [x, y, z] = sampleTerrainLodTransitionGeometryPosition(sample, transitionCase.side);
    nodes.push({ id: `n${i}`, cellKey: transitionCase.cellKey, density: sample.density, solid: sample.solid, x, y, z });
  }
  return nodes;
}

function interpolateTransitionMeshNodeEdge(
  a: TransitionMeshNode,
  b: TransitionMeshNode,
): TerrainLodTransitionMeshVertex | null {
  if (a.solid === b.solid) return null;
  const denominator = a.density - b.density;
  const t = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, a.density / denominator));
  return {
    key: `${a.cellKey}:table:${a.id}-${b.id}`,
    cellKey: a.cellKey,
    edgeKey: `table:${a.id}-${b.id}`,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function triangleAreaSq(
  a: TerrainLodTransitionMeshVertex,
  b: TerrainLodTransitionMeshVertex,
  c: TerrainLodTransitionMeshVertex,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return cx * cx + cy * cy + cz * cz;
}

function emitTransitionTetraTableMesh(
  transitionCase: TerrainLodTransitionCellCase,
): { vertices: TerrainLodTransitionMeshVertex[]; indices: number[] } | null {
  const nodes = buildTransitionMeshNodes(transitionCase);
  if (!nodes) return null;

  const vertices: TerrainLodTransitionMeshVertex[] = [];
  const indices: number[] = [];
  const vertexByPosition = new Map<string, number>();
  const emitVertex = (vertex: TerrainLodTransitionMeshVertex): number => {
    const key = transitionVertexDedupeKey(vertex);
    const existing = vertexByPosition.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertexByPosition.set(key, index);
    vertices.push(vertex);
    return index;
  };

  const hexahedra: number[][] = [
    [0, 1, 2, 3, ...transitionSeamNeighborNodeIndices(transitionCase.side)],
    [4, 5, 6, 7, 8, 9, 10, 11],
  ];

  for (let hexIndex = 0; hexIndex < hexahedra.length; hexIndex++) {
    const hexahedron = hexahedra[hexIndex];
    for (let tetIndex = 0; tetIndex < HEX_TETRAHEDRA.length; tetIndex++) {
      const tetra = HEX_TETRAHEDRA[tetIndex].map(index => hexahedron[index]);
      let mask = 0;
      for (let i = 0; i < 4; i++) {
        if (nodes[tetra[i]].solid) mask |= 1 << i;
      }
      const triangles = TETRA_CASE_TRIANGLES[mask];
      if (triangles.length === 0) continue;
      for (const triangle of triangles) {
        const localVertices: TerrainLodTransitionMeshVertex[] = [];
        for (const edgeIndex of triangle) {
          const [aLocal, bLocal] = TETRA_EDGE_CORNERS[edgeIndex];
          const a = nodes[tetra[aLocal]];
          const b = nodes[tetra[bLocal]];
          const vertex = interpolateTransitionMeshNodeEdge(a, b);
          if (!vertex) break;
          vertex.edgeKey = `table:h${hexIndex}:t${tetIndex}:${vertex.edgeKey}`;
          localVertices.push(vertex);
        }
        if (localVertices.length !== 3) continue;
        if (triangleAreaSq(localVertices[0], localVertices[1], localVertices[2]) <= 1e-8) continue;
        indices.push(
          emitVertex(localVertices[0]),
          emitVertex(localVertices[1]),
          emitVertex(localVertices[2]),
        );
      }
    }
  }

  return { vertices, indices };
}

export function buildTerrainLodTransitionMesh(cases: readonly TerrainLodTransitionCellCase[]): TerrainLodTransitionMesh {
  const vertices: TerrainLodTransitionMeshVertex[] = [];
  const indices: number[] = [];
  const cells: TerrainLodTransitionMeshCell[] = [];
  let emittedCells = 0;
  let missingSampleCells = 0;
  let degenerateCells = 0;

  for (const transitionCase of cases) {
    const vertexStart = vertices.length;
    const triangleStart = indices.length / 3;
    if (transitionCase.missingSamples > 0) {
      missingSampleCells++;
      cells.push({
        cellKey: transitionCase.cellKey,
        combinedCase: transitionCase.combinedCase,
        vertexStart,
        vertexCount: 0,
        triangleStart,
        triangleCount: 0,
        skippedReason: 'missing-samples',
      });
      continue;
    }
    if (!transitionCase.crossesSurface) {
      cells.push({
        cellKey: transitionCase.cellKey,
        combinedCase: transitionCase.combinedCase,
        vertexStart,
        vertexCount: 0,
        triangleStart,
        triangleCount: 0,
        skippedReason: 'uniform',
      });
      continue;
    }

    const cellMesh = emitTransitionTetraTableMesh(transitionCase);
    if (!cellMesh || cellMesh.indices.length < 3) {
      degenerateCells++;
      cells.push({
        cellKey: transitionCase.cellKey,
        combinedCase: transitionCase.combinedCase,
        vertexStart,
        vertexCount: 0,
        triangleStart,
        triangleCount: 0,
        skippedReason: 'degenerate',
      });
      continue;
    }

    for (const vertex of cellMesh.vertices) vertices.push(vertex);
    for (const index of cellMesh.indices) indices.push(vertexStart + index);
    const triangleCount = cellMesh.indices.length / 3;
    emittedCells++;
    cells.push({
      cellKey: transitionCase.cellKey,
      combinedCase: transitionCase.combinedCase,
      vertexStart,
      vertexCount: cellMesh.vertices.length,
      triangleStart,
      triangleCount,
      skippedReason: 'none',
    });
  }

  return {
    algorithm: 'transition-prism-tetra-table-v1',
    cellCount: cases.length,
    emittedCells,
    skippedCells: cases.length - emittedCells,
    missingSampleCells,
    degenerateCells,
    vertices,
    indices,
    cells,
  };
}

export function planTerrainLodRequests(options: TerrainLodPlanOptions): TerrainLodRequest[] {
  const requests = new Map<string, TerrainLodRequest>();
  const radius = Math.max(0, options.radius | 0);
  const lodEnabled = options.lodEnabled && radius >= options.minStreamRadius + TERRAIN_LOD1_RING_INSET + 1;
  const addRequest = (cx: number, cy: number, cz: number, lod: number, priority: number): void => {
    const clampedLod = clampTerrainLod(lod);
    const key = terrainChunkKey(cx, cy, cz, clampedLod);
    if (!requests.has(key)) requests.set(key, { key, cx, cy, cz, lod: clampedLod, priority, lodSeamMask: 0 });
  };

  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.hypot(dx, dz);
      if (dist > radius + 0.35) continue;
      for (const cy of options.verticalChunks) {
        const baseCx = options.cameraChunkX + dx;
        const baseCz = options.cameraChunkZ + dz;
        let lod = lodEnabled ? terrainLodForDistance(dist, radius) : 0;
        let cx = baseCx;
        let lodCy = cy;
        let cz = baseCz;
        while (lod > 0) {
          cx = alignChunkCoord(baseCx, lod);
          lodCy = alignChunkCoord(cy, lod);
          cz = alignChunkCoord(baseCz, lod);
          if (!lodChunkIntersectsInnerRing(cx, cz, lod, options.cameraChunkX, options.cameraChunkZ, terrainLodInnerRadius(lod, radius, options.minStreamRadius))) break;
          lod--;
        }
        if (lod <= 0) {
          lod = 0;
          cx = baseCx;
          lodCy = cy;
          cz = baseCz;
        }
        addRequest(cx, lodCy, cz, lod, dist + Math.abs(cy) * 0.35 + lod * 0.2);
      }
    }
  }

  applyTerrainLodSeamMasks(requests);
  return [...requests.values()].sort((a, b) => a.priority - b.priority);
}

export function summarizeTerrainLodPlan(requests: readonly TerrainLodRequest[]): TerrainLodPlanSummary {
  const covered = new Set<string>();
  const summary: TerrainLodPlanSummary = {
    targetChunks: requests.length,
    lod0Chunks: 0,
    lod1Chunks: 0,
    lod2PlusChunks: 0,
    transitionEdges: 0,
    transitionFaces: 0,
    transitionFaceBaseCells: 0,
    transitionCells: 0,
    skirtedChunks: 0,
    coveredBaseCells: 0,
    maxLod: 0,
  };

  for (const request of requests) {
    const lod = clampTerrainLod(request.lod);
    if (lod <= 0) summary.lod0Chunks++;
    else if (lod === 1) summary.lod1Chunks++;
    else summary.lod2PlusChunks++;
    summary.maxLod = Math.max(summary.maxLod, lod);
    const transitionEdges = countLodTransitionEdges(request.lodSeamMask);
    summary.transitionEdges += transitionEdges;
    if (transitionEdges > 0) summary.skirtedChunks++;
    const span = lodSpan(lod);
    for (let oy = 0; oy < span; oy++) {
      for (let oz = 0; oz < span; oz++) {
        for (let ox = 0; ox < span; ox++) {
          covered.add(coverageKey(request.cx + ox, request.cy + oy, request.cz + oz));
        }
      }
    }
  }
  const transitionPlan = buildTerrainLodTransitionPlan(requests);
  summary.transitionFaces = transitionPlan.length;
  summary.transitionFaceBaseCells = transitionPlan.reduce((sum, transition) => sum + transition.neighborBaseCells, 0);
  summary.transitionCells = buildTerrainLodTransitionCells(requests).length;
  summary.coveredBaseCells = covered.size;
  return summary;
}
