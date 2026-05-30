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
  // When true, also allocate the canvas-sized G-buffer attachments used by the
  // deferred terrain path (renderGraph=deferred). Off for the default compat
  // path so normal sessions pay no extra GPU memory.
  deferred?: boolean;
  gbufferAlbedoFormat?: GPUTextureFormat;
  gbufferNormalFormat?: GPUTextureFormat;
  gbufferWorldFormat?: GPUTextureFormat;
  // Offscreen scene-colour target for the deferred post chain (bloom). Matches
  // the swapchain format so the sky/water/vegetation pipelines render into it
  // unchanged. Only allocated when deferred.
  sceneColorFormat?: GPUTextureFormat;
}

export class RenderTargets {
  private readonly device: GPUDevice;
  readonly depthFormat: GPUTextureFormat;
  readonly shadowFormat: GPUTextureFormat;
  readonly shadowSize: number;

  private depthTex: GPUTexture | null = null;
  private readonly shadowTex: GPUTexture;
  private readonly shadowView: GPUTextureView;
  // Deferred G-buffer attachments (canvas-sized, allocated only when deferred).
  readonly deferred: boolean;
  readonly gbufferAlbedoFormat: GPUTextureFormat;
  readonly gbufferNormalFormat: GPUTextureFormat;
  readonly gbufferWorldFormat: GPUTextureFormat;
  readonly sceneColorFormat: GPUTextureFormat;
  private gbufferAlbedoTex: GPUTexture | null = null;
  private gbufferNormalTex: GPUTexture | null = null;
  private gbufferWorldTex: GPUTexture | null = null;
  private sceneColorTex: GPUTexture | null = null;
  width = 0;
  height = 0;

  constructor(device: GPUDevice, config: RenderTargetsConfig) {
    this.device = device;
    this.depthFormat = config.depthFormat;
    this.shadowFormat = config.shadowFormat;
    this.shadowSize = config.shadowSize;
    this.deferred = config.deferred ?? false;
    this.gbufferAlbedoFormat = config.gbufferAlbedoFormat ?? 'rgba8unorm';
    this.gbufferNormalFormat = config.gbufferNormalFormat ?? 'rgba16float';
    this.gbufferWorldFormat = config.gbufferWorldFormat ?? 'rgba16float';
    this.sceneColorFormat = config.sceneColorFormat ?? 'rgba8unorm';
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
    if (this.deferred) {
      this.gbufferAlbedoTex?.destroy();
      this.gbufferNormalTex?.destroy();
      this.gbufferAlbedoTex = this.device.createTexture({
        label: 'gbuffer albedo',
        size: [width, height],
        format: this.gbufferAlbedoFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.gbufferNormalTex = this.device.createTexture({
        label: 'gbuffer normal',
        size: [width, height],
        format: this.gbufferNormalFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.gbufferWorldTex?.destroy();
      this.gbufferWorldTex = this.device.createTexture({
        label: 'gbuffer world',
        size: [width, height],
        format: this.gbufferWorldFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.sceneColorTex?.destroy();
      this.sceneColorTex = this.device.createTexture({
        label: 'scene color (deferred post)',
        size: [width, height],
        format: this.sceneColorFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    return true;
  }

  get depthTexture(): GPUTexture | null { return this.depthTex; }
  get shadowDepthTexture(): GPUTexture { return this.shadowTex; }
  get shadowDepthView(): GPUTextureView { return this.shadowView; }
  get gbufferAlbedoTexture(): GPUTexture | null { return this.gbufferAlbedoTex; }
  get gbufferNormalTexture(): GPUTexture | null { return this.gbufferNormalTex; }
  get gbufferWorldTexture(): GPUTexture | null { return this.gbufferWorldTex; }
  get sceneColorTexture(): GPUTexture | null { return this.sceneColorTex; }

  destroy(): void {
    this.depthTex?.destroy();
    this.depthTex = null;
    this.gbufferAlbedoTex?.destroy();
    this.gbufferAlbedoTex = null;
    this.gbufferNormalTex?.destroy();
    this.gbufferNormalTex = null;
    this.gbufferWorldTex?.destroy();
    this.gbufferWorldTex = null;
    this.sceneColorTex?.destroy();
    this.sceneColorTex = null;
    this.shadowTex.destroy();
  }
}
