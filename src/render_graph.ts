// Render graph scaffolding (Photon-class Upgrade 1, first slice).
//
// This is intentionally NOT a rewrite of how the renderer draws. It is a thin
// declaration + instrumentation layer that the existing forward renderer wraps
// its passes with, so we get the building blocks the visual-quality plan calls
// for without changing a single pixel of output:
//
//   - every GPU pass has a stable debug name and kind,
//   - optional passes can be force-disabled from a query string,
//   - passes get a GPU timing scope via timestamp queries when the adapter
//     supports the `timestamp-query` feature (best-effort, async readback, never
//     stalls the frame), and
//   - a per-frame summary (names / enabled / ran / GPU ms) is exposed for the
//     overlay and automation reports.
//
// The compatibility graph models the passes the renderer already submits
// (terrain-cull compute, directional shadow, the single forward main pass, and
// the hi-z depth pyramid). Later slices can split the forward pass into the
// deferred/G-buffer graph behind a profile flag; the contract here stays the
// same.

export type RenderPassKind = 'cpu' | 'compute' | 'render';

export interface RenderPassReport {
  name: string;
  kind: RenderPassKind;
  optional: boolean;
  // Allowed to run (not force-disabled by a query-string override).
  enabled: boolean;
  // Actually executed this frame (enabled AND its runtime condition held).
  ran: boolean;
  // Last measured GPU time in milliseconds, or null when timing is unavailable
  // or not yet read back.
  gpuMs: number | null;
}

export interface FrameGraphSummary {
  mode: string;
  timingAvailable: boolean;
  passes: RenderPassReport[];
}

// A timestamp write descriptor usable for both render- and compute-pass
// descriptors (their `timestampWrites` shapes are structurally identical).
export interface PassTimestampWrites {
  querySet: GPUQuerySet;
  beginningOfPassWriteIndex?: number;
  endOfPassWriteIndex?: number;
}

export interface PassTimestampSpan {
  querySet: GPUQuerySet;
  beginIndex: number;
  endIndex: number;
}

interface PassState {
  name: string;
  kind: RenderPassKind;
  optional: boolean;
  beginIndex: number;
  endIndex: number;
  ran: boolean;
  gpuMs: number | null;
}

// Two timestamps (begin + end) per timed pass. The compatibility graph times at
// most four GPU passes; leave headroom for the deferred graph's extra stages.
const MAX_TIMED_PASSES = 12;
const TIMESTAMP_BYTES = 8;

export class FrameGraph {
  private readonly device: GPUDevice;
  private readonly overrides: Record<string, boolean>;
  private readonly passes = new Map<string, PassState>();
  private readonly order: string[] = [];

  // Reporting-only label for the active render-graph mode ('compat'|'deferred').
  mode = 'compat';
  private timingAvailable = false;
  private querySet: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private readbackBuffer: GPUBuffer | null = null;
  private readbackPending = false;
  // Set when resolve() records a copy into the readback buffer this frame, so the
  // post-submit readback() knows to map it. Mapping must happen AFTER submit, or
  // the buffer is "used in submit while pending map" and the frame is dropped.
  private copiedThisFrame = false;
  private frameTimestampCount = 0;
  // Snapshot of (name -> indices) taken at resolve time, so the async readback
  // interprets the right slots even though the next frame has already reset.
  private pendingMapping: { name: string; begin: number; end: number }[] = [];

  constructor(device: GPUDevice, timestampSupported: boolean, overrides: Record<string, boolean> = {}) {
    this.device = device;
    this.overrides = overrides;
    if (timestampSupported) {
      try {
        const capacity = MAX_TIMED_PASSES * 2;
        this.querySet = device.createQuerySet({ label: 'frame-graph timestamps', type: 'timestamp', count: capacity });
        this.resolveBuffer = device.createBuffer({
          label: 'frame-graph timestamp resolve',
          size: capacity * TIMESTAMP_BYTES,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        this.readbackBuffer = device.createBuffer({
          label: 'frame-graph timestamp readback',
          size: capacity * TIMESTAMP_BYTES,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        this.timingAvailable = true;
      } catch {
        // Any allocation failure leaves timing off; structural reporting still works.
        this.timingAvailable = false;
      }
    }
  }

  get gpuTimingAvailable(): boolean {
    return this.timingAvailable;
  }

  // Begin a frame: clear per-frame run/timing state. Declared passes persist so
  // the summary keeps a stable ordering across frames.
  beginFrame(): void {
    this.frameTimestampCount = 0;
    for (const pass of this.passes.values()) {
      pass.ran = false;
      pass.beginIndex = -1;
      pass.endIndex = -1;
    }
  }

  // Declare a pass in render order without running it (so it appears in the
  // summary even on frames where its runtime condition is false).
  declare(name: string, kind: RenderPassKind, optional: boolean): void {
    this.ensure(name, kind, optional);
  }

  // True when the pass is allowed to run. Required passes are always allowed;
  // optional passes honor a `pass.<name>` query override. Callers AND this with
  // their existing runtime condition.
  isEnabled(name: string): boolean {
    const override = this.overrides[name];
    return override === undefined ? true : override;
  }

  // Allocate a begin/end timestamp pair for a pass that is running this frame.
  // Returns the query set plus the two indices so a caller can split them across
  // sub-passes (e.g. the depth pyramid's first and last compute passes). Returns
  // null when timing is unavailable or the per-frame budget is exhausted; the
  // pass is still marked as having run.
  timedSpan(name: string, kind: RenderPassKind, optional: boolean): PassTimestampSpan | null {
    const pass = this.ensure(name, kind, optional);
    pass.ran = true;
    if (!this.timingAvailable || !this.querySet) return null;
    if (this.frameTimestampCount + 2 > MAX_TIMED_PASSES * 2) return null;
    pass.beginIndex = this.frameTimestampCount++;
    pass.endIndex = this.frameTimestampCount++;
    return { querySet: this.querySet, beginIndex: pass.beginIndex, endIndex: pass.endIndex };
  }

  // Convenience for a single pass that owns both timestamps. Returns a
  // `timestampWrites` descriptor (or undefined to omit the field entirely).
  timed(name: string, kind: RenderPassKind, optional: boolean): PassTimestampWrites | undefined {
    const span = this.timedSpan(name, kind, optional);
    if (!span) return undefined;
    return { querySet: span.querySet, beginningOfPassWriteIndex: span.beginIndex, endOfPassWriteIndex: span.endIndex };
  }

  // Mark a declared pass as having run when it has no GPU timing scope (e.g. the
  // CPU setup/update phase).
  markRan(name: string, kind: RenderPassKind, optional: boolean): void {
    this.ensure(name, kind, optional).ran = true;
  }

  // Record this frame's timestamp resolve + copy into the readback buffer. Must
  // be called on the frame encoder after all passes have ended and BEFORE submit.
  // The actual buffer map is deferred to readback() (post-submit), because a
  // buffer with a pending/active map cannot be used by a submit.
  resolve(encoder: GPUCommandEncoder): void {
    this.copiedThisFrame = false;
    if (!this.timingAvailable || !this.querySet || !this.resolveBuffer || !this.readbackBuffer) return;
    if (this.frameTimestampCount === 0 || this.readbackPending) return;
    const count = this.frameTimestampCount;
    encoder.resolveQuerySet(this.querySet, 0, count, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readbackBuffer, 0, count * TIMESTAMP_BYTES);
    this.pendingMapping = [];
    for (const pass of this.passes.values()) {
      if (pass.beginIndex >= 0 && pass.endIndex >= 0) {
        this.pendingMapping.push({ name: pass.name, begin: pass.beginIndex, end: pass.endIndex });
      }
    }
    this.copiedThisFrame = true;
  }

  // Map the readback buffer and pull out per-pass GPU times. Must be called AFTER
  // the frame encoder has been submitted (mirrors the hi-z occlusion readback).
  readback(): void {
    if (!this.copiedThisFrame || !this.readbackBuffer || this.readbackPending) return;
    this.copiedThisFrame = false;
    this.readbackPending = true;
    const readback = this.readbackBuffer;
    readback.mapAsync(GPUMapMode.READ)
      .then(() => {
        try {
          const samples = new BigUint64Array(readback.getMappedRange());
          for (const entry of this.pendingMapping) {
            const begin = samples[entry.begin];
            const end = samples[entry.end];
            // Timestamps are nanoseconds; ignore zero/disordered samples that some
            // drivers emit when a pass was empty or timing is quantized to zero.
            if (typeof begin === 'bigint' && typeof end === 'bigint' && end > begin) {
              const pass = this.passes.get(entry.name);
              if (pass) pass.gpuMs = Number(end - begin) / 1e6;
            }
          }
        } finally {
          readback.unmap();
          this.readbackPending = false;
        }
      })
      .catch(() => {
        this.readbackPending = false;
      });
  }

  summary(): FrameGraphSummary {
    return {
      mode: this.mode,
      timingAvailable: this.timingAvailable,
      passes: this.order.map(name => {
        const pass = this.passes.get(name)!;
        return {
          name: pass.name,
          kind: pass.kind,
          optional: pass.optional,
          enabled: this.isEnabled(name),
          ran: pass.ran,
          gpuMs: pass.gpuMs,
        };
      }),
    };
  }

  private ensure(name: string, kind: RenderPassKind, optional: boolean): PassState {
    let pass = this.passes.get(name);
    if (!pass) {
      pass = { name, kind, optional, beginIndex: -1, endIndex: -1, ran: false, gpuMs: null };
      this.passes.set(name, pass);
      this.order.push(name);
    }
    return pass;
  }
}
