import { compileMotionMark, type CompileOptions } from "../../parser/src";
import type { SceneIR } from "../../schema/src";
import {
  clearImageCache,
  preloadBrowserImages,
  renderFrameToCanvas,
  type BrowserImagePreloadOptions,
  type RenderedCanvasFrame
} from "../../exporter/src/rawFrame";

export {
  clearImageCache,
  preloadBrowserImages,
  renderFrameToCanvas,
  type BrowserImagePreloadOptions,
  type RenderedCanvasFrame
};

export type MotionMarkCanvas = HTMLCanvasElement | OffscreenCanvas;

interface CachedFrame {
  canvas: MotionMarkCanvas;
  bytes: number;
}

export interface MotionMarkRenderOptions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizeCanvas?: boolean;
}

export interface MotionMarkFrameCacheOptions {
  enabled?: boolean;
  maxFrames?: number;
  maxBytes?: number;
  fps?: number;
}

export type MotionMarkFrameCacheSetting = boolean | MotionMarkFrameCacheOptions;

interface ResolvedFrameCacheOptions {
  maxFrames: number;
  maxBytes: number;
  fps?: number;
}

export interface MotionMarkPlayerOptions extends BrowserImagePreloadOptions {
  source?: string;
  scene?: SceneIR;
  compile?: CompileOptions;
  render?: MotionMarkRenderOptions;
  frameCache?: MotionMarkFrameCacheSetting;
  autoplay?: boolean;
  loop?: boolean;
  maxFps?: number;
  initialTimeMs?: number;
  onError?: (error: Error) => void;
  onFrame?: (frame: RenderedCanvasFrame & { tMs: number }) => void;
  onScene?: (scene: SceneIR) => void;
}

export class MotionMarkPlayer {
  readonly canvas: MotionMarkCanvas;
  ready: Promise<void>;

  private options: MotionMarkPlayerOptions;
  private scene: SceneIR | null = null;
  private currentTimeMs = 0;
  private isPlaying = false;
  private rafId: number | null = null;
  private playStartedAt = 0;
  private playStartedTimeMs = 0;
  private lastDrawAt = 0;
  private frameCache = new Map<string, CachedFrame>();
  private frameCacheBytes = 0;

  constructor(canvas: MotionMarkCanvas, options: MotionMarkPlayerOptions = {}) {
    this.canvas = canvas;
    this.options = {
      loop: true,
      maxFps: 60,
      ...options
    };
    this.currentTimeMs = Math.max(0, options.initialTimeMs ?? 0);

    if (options.scene) {
      this.ready = this.setScene(options.scene, { autoplay: options.autoplay });
    } else if (options.source !== undefined) {
      this.ready = this.setSource(options.source, { autoplay: options.autoplay });
    } else {
      this.ready = Promise.resolve();
    }
  }

  getScene(): SceneIR | null {
    return this.scene;
  }

  getTimeMs(): number {
    return this.currentTimeMs;
  }

  getDurationMs(): number {
    return Math.max(1, this.scene?.duration ?? 1);
  }

  playing(): boolean {
    return this.isPlaying;
  }

  async setSource(source: string, options: { autoplay?: boolean } = {}): Promise<void> {
    try {
      const scene = compileMotionMark(source, this.options.compile);
      await this.setScene(scene, options);
    } catch (error) {
      this.reportError(error);
    }
  }

  async setScene(scene: SceneIR, options: { autoplay?: boolean } = {}): Promise<void> {
    try {
      this.clearFrameCache();
      this.scene = scene;
      this.currentTimeMs = Math.min(this.currentTimeMs, this.getDurationMs());
      await preloadBrowserImages(scene, {
        assetBaseUrl: this.options.assetBaseUrl,
        crossOrigin: this.options.crossOrigin,
        imageLoader: this.options.imageLoader
      });
      this.options.onScene?.(scene);
      this.render(this.currentTimeMs);
      if (options.autoplay) {
        this.play();
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  setOptions(options: Partial<MotionMarkPlayerOptions>): void {
    this.options = { ...this.options, ...options };
    this.clearFrameCache();
    if (this.scene) {
      this.render(this.currentTimeMs);
    }
  }

  render(tMs = this.currentTimeMs): RenderedCanvasFrame | null {
    if (!this.scene) return null;
    const duration = this.getDurationMs();
    const requestedTimeMs = clamp(tMs, 0, duration);
    const size = resolveRenderSize(this.scene, this.options.render);
    const cacheOptions = resolveFrameCacheOptions(this.options.frameCache);
    const cacheFps = cacheOptions
      ? Math.max(1, cacheOptions.fps ?? Math.min(this.scene.canvas.fps || 60, this.options.maxFps || 60))
      : 0;
    const frameIndex = cacheOptions ? Math.round((requestedTimeMs / 1000) * cacheFps) : -1;
    const renderTimeMs = cacheOptions ? clamp((frameIndex / cacheFps) * 1000, 0, duration) : requestedTimeMs;
    const cacheKey = cacheOptions ? `${size.width}x${size.height}@${cacheFps}:${frameIndex}` : null;

    this.currentTimeMs = renderTimeMs;

    if (cacheKey && this.drawCachedFrame(cacheKey, size)) {
      const frame = { width: size.width, height: size.height };
      this.options.onFrame?.({ ...frame, tMs: this.currentTimeMs });
      return frame;
    }

    const frame = renderFrameToCanvas(this.canvas, this.scene, this.currentTimeMs, {
      ...size,
      resizeCanvas: this.options.render?.resizeCanvas
    });
    if (cacheKey && cacheOptions) {
      this.storeRenderedFrame(cacheKey, size, cacheOptions);
    }
    this.options.onFrame?.({ ...frame, tMs: this.currentTimeMs });
    return frame;
  }

  play(): void {
    if (!this.scene || this.isPlaying) return;
    this.isPlaying = true;
    this.playStartedAt = now();
    this.playStartedTimeMs = this.currentTimeMs;
    this.lastDrawAt = 0;
    this.rafId = requestNextFrame(this.tick);
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.rafId !== null) {
      cancelNextFrame(this.rafId);
      this.rafId = null;
    }
  }

  seek(tMs: number): void {
    this.currentTimeMs = clamp(tMs, 0, this.getDurationMs());
    if (this.isPlaying) {
      this.playStartedAt = now();
      this.playStartedTimeMs = this.currentTimeMs;
    }
    this.render(this.currentTimeMs);
  }

  destroy(): void {
    this.pause();
    this.clearFrameCache();
    this.scene = null;
  }

  clearFrameCache(): void {
    for (const frame of this.frameCache.values()) {
      frame.canvas.width = 0;
      frame.canvas.height = 0;
    }
    this.frameCache.clear();
    this.frameCacheBytes = 0;
  }

  private drawCachedFrame(cacheKey: string, size: { width: number; height: number }): boolean {
    const cached = this.frameCache.get(cacheKey);
    if (!cached) return false;

    const ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return false;

    if (this.options.render?.resizeCanvas !== false && (this.canvas.width !== size.width || this.canvas.height !== size.height)) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }

    this.frameCache.delete(cacheKey);
    this.frameCache.set(cacheKey, cached);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(cached.canvas as CanvasImageSource, 0, 0, size.width, size.height);
    return true;
  }

  private storeRenderedFrame(
    cacheKey: string,
    size: { width: number; height: number },
    cacheOptions: ResolvedFrameCacheOptions
  ): void {
    const bytes = size.width * size.height * 4;
    if (bytes > cacheOptions.maxBytes) return;

    const cacheCanvas = createCacheCanvas(size.width, size.height);
    if (!cacheCanvas) return;

    const ctx = cacheCanvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;

    ctx.drawImage(this.canvas as CanvasImageSource, 0, 0, size.width, size.height);

    const previous = this.frameCache.get(cacheKey);
    if (previous) {
      this.frameCacheBytes -= previous.bytes;
      previous.canvas.width = 0;
      previous.canvas.height = 0;
      this.frameCache.delete(cacheKey);
    }

    this.frameCache.set(cacheKey, { canvas: cacheCanvas, bytes });
    this.frameCacheBytes += bytes;
    this.trimFrameCache(cacheOptions);
  }

  private trimFrameCache(cacheOptions: ResolvedFrameCacheOptions): void {
    while (
      this.frameCache.size > cacheOptions.maxFrames ||
      this.frameCacheBytes > cacheOptions.maxBytes
    ) {
      const oldestKey = this.frameCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.frameCache.get(oldestKey);
      if (oldest) {
        this.frameCacheBytes -= oldest.bytes;
        oldest.canvas.width = 0;
        oldest.canvas.height = 0;
      }
      this.frameCache.delete(oldestKey);
    }
  }

  private tick = (timestamp: number): void => {
    if (!this.isPlaying || !this.scene) return;

    const duration = this.getDurationMs();
    let nextTime = this.playStartedTimeMs + (timestamp - this.playStartedAt);
    if (nextTime > duration) {
      if (this.options.loop === false) {
        nextTime = duration;
        this.render(nextTime);
        this.pause();
        return;
      }
      nextTime = nextTime % duration;
      this.playStartedAt = timestamp;
      this.playStartedTimeMs = nextTime;
    }

    const fps = Math.max(1, Math.min(this.scene.canvas.fps || 60, this.options.maxFps || 60));
    if (timestamp - this.lastDrawAt >= 1000 / fps) {
      this.render(nextTime);
      this.lastDrawAt = timestamp;
    } else {
      this.currentTimeMs = nextTime;
    }

    this.rafId = requestNextFrame(this.tick);
  };

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (this.options.onError) {
      this.options.onError(normalized);
      return;
    }
    throw normalized;
  }
}

export function createMotionMarkPlayer(canvas: MotionMarkCanvas, options: MotionMarkPlayerOptions = {}): MotionMarkPlayer {
  return new MotionMarkPlayer(canvas, options);
}

export function compileMotionMarkScene(source: string, options?: CompileOptions): SceneIR {
  return compileMotionMark(source, options);
}

function resolveRenderSize(scene: SceneIR, options: MotionMarkRenderOptions = {}): { width: number; height: number } {
  const aspect = scene.canvas.width / scene.canvas.height;
  let width = options.width ?? (options.height ? Math.round(options.height * aspect) : scene.canvas.width);
  let height = options.height ?? (options.width ? Math.round(options.width / aspect) : scene.canvas.height);

  if (options.maxWidth && width > options.maxWidth) {
    const scale = options.maxWidth / width;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  if (options.maxHeight && height > options.maxHeight) {
    const scale = options.maxHeight / height;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function resolveFrameCacheOptions(options: MotionMarkFrameCacheSetting | undefined): ResolvedFrameCacheOptions | null {
  if (!options) return null;
  if (options === true) {
    return {
      maxFrames: 240,
      maxBytes: 512 * 1024 * 1024
    };
  }
  if (options.enabled === false) return null;

  return {
    maxFrames: Math.max(1, Math.floor(options.maxFrames ?? 240)),
    maxBytes: Math.max(1, Math.floor(options.maxBytes ?? 512 * 1024 * 1024)),
    ...(options.fps !== undefined ? { fps: Math.max(1, Math.floor(options.fps)) } : {})
  };
}

function createCacheCanvas(width: number, height: number): MotionMarkCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function requestNextFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame !== "undefined") {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(now()), 16) as unknown as number;
}

function cancelNextFrame(id: number): void {
  if (typeof cancelAnimationFrame !== "undefined") {
    cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}
