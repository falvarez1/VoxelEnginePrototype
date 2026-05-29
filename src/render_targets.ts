// Render-target registry (Photon-class Upgrade 1, resource side).
//
// Centralizes ownership of the renderer's GPU attachment textures so allocation
// happens through one place and one resize path, instead of being scattered
// across init() and resize(). Today that is the canvas-sized depth target and
// the fixed-size sun shadow depth map; the deferred path (Upgrade 3) will add
// its G-buffer attachments here without touching the draw code.
//
// The swapchain colour target stays owned by the GPUCanvasContext (its view is
// acquired per-frame via getCurrentTexture), and the hi-z depth pyramid stays
// with the renderer because it is a derived compute resource bound to specific
// pipelines, not a render-pass attachment.

export interface RenderTargetsConfig {
  depthFormat: GPUTextureFormat;
  shadowFormat: GPUTextureFormat;
  shadowSize: number;
}

export class RenderTargets {
  private readonly device: GPUDevice;
  readonly depthFormat: GPUTextureFormat;
  readonly shadowFormat: GPUTextureFormat;
  readonly shadowSize: number;

  private depthTex: GPUTexture | null = null;
  private readonly shadowTex: GPUTexture;
  private readonly shadowView: GPUTextureView;
  width = 0;
  height = 0;

  constructor(device: GPUDevice, config: RenderTargetsConfig) {
    this.device = device;
    this.depthFormat = config.depthFormat;
    this.shadowFormat = config.shadowFormat;
    this.shadowSize = config.shadowSize;
    // Sun shadow map: fixed resolution, allocated once (does not track canvas).
    this.shadowTex = device.createTexture({
      label: 'sun shadow depth',
      size: { width: this.shadowSize, height: this.shadowSize },
      format: this.shadowFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowView = this.shadowTex.createView();
  }

  // Allocate or replace the canvas-sized depth target. Returns true when the
  // target was (re)created (first call or a size change), so the caller can
  // rebuild anything derived from it (e.g. the hi-z depth pyramid).
  resizeDepth(width: number, height: number): boolean {
    if (this.depthTex && this.width === width && this.height === height) return false;
    this.width = width;
    this.height = height;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      label: 'depth texture',
      size: [width, height],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    return true;
  }

  get depthTexture(): GPUTexture | null { return this.depthTex; }
  get shadowDepthTexture(): GPUTexture { return this.shadowTex; }
  get shadowDepthView(): GPUTextureView { return this.shadowView; }

  destroy(): void {
    this.depthTex?.destroy();
    this.depthTex = null;
    this.shadowTex.destroy();
  }
}
