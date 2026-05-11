import { resolveFrame, type FrameState } from "../../engine/src";
import {
  projectPoint,
  transformLocalPoints3DToWorld,
  transformVerticesToWorld,
  type Point3D,
  type GroupTransform3D,
  type PerspectiveParams,
  type ProjectedPoint,
  type Transform3DParams
} from "../../engine/src/transform3d";
import { compileNumericExpression, type NumericFn } from "../../parser/src/expression";
import { renderStaticFrameToCommands, type DrawCommand, type RenderEffects, type StrokeControls } from "../../renderer/src";
import type { AnchorPoint, FxMaskIR, MaskIR, SceneIR, XtMaskIR } from "../../schema/src";
import { resolveAssetPath } from "./assets";
import type { ExportSettings } from "./settings";

type SkiaCanvasModule = typeof import("skia-canvas");
type RenderableImage = CanvasImageSource;

// Cache for compiled mask expressions
const fxMaskCache = new Map<string, NumericFn>();

function getCompiledFxExpr(expr: string): NumericFn {
  let fn = fxMaskCache.get(expr);
  if (!fn) {
    fn = compileNumericExpression(expr);
    fxMaskCache.set(expr, fn);
  }
  return fn;
}

function resolveFontFamily(font: string): string {
  return `${font}, "Segoe UI", Arial, sans-serif`;
}

function measureTextWithSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  letterSpacing: number
): number {
  if (letterSpacing === 0) {
    return ctx.measureText(text).width;
  }
  let width = 0;
  for (const char of text) {
    width += ctx.measureText(char).width + letterSpacing;
  }
  return width > 0 ? width - letterSpacing : 0;
}

type CanvasPaint = string | ReturnType<CanvasRenderingContext2D["createLinearGradient"]>;

function resolvePaint(
  ctx: CanvasRenderingContext2D,
  paint: string,
  scaleX: number,
  scaleY: number,
  originX = 0,
  originY = 0
): CanvasPaint {
  const parsed = parseGradientPaint(paint);
  if (!parsed) return paint;

  const gradient =
    parsed.kind === "linear"
      ? ctx.createLinearGradient(
          originX + parsed.x1 * scaleX,
          originY + parsed.y1 * scaleY,
          originX + parsed.x2 * scaleX,
          originY + parsed.y2 * scaleY
        )
      : ctx.createRadialGradient(
          originX + parsed.x0 * scaleX,
          originY + parsed.y0 * scaleY,
          parsed.r0 * Math.min(scaleX, scaleY),
          originX + parsed.x1 * scaleX,
          originY + parsed.y1 * scaleY,
          parsed.r1 * Math.min(scaleX, scaleY)
        );

  for (const stop of parsed.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }

  return gradient;
}

function hasRenderablePaint(paint: string | undefined | null): paint is string {
  return typeof paint === "string" && paint.trim() !== "" && paint.trim().toLowerCase() !== "none";
}

function hasRenderableFill(fill: string | undefined | null): fill is string {
  return hasRenderablePaint(fill);
}

function strokeOrFillPaint(stroke: string | undefined, fill: string | undefined, fallback = "#000"): string {
  return hasRenderablePaint(stroke) ? stroke : hasRenderableFill(fill) ? fill : fallback;
}

type ParsedGradientPaint =
  | {
      kind: "linear";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stops: GradientStop[];
    }
  | {
      kind: "radial";
      x0: number;
      y0: number;
      r0: number;
      x1: number;
      y1: number;
      r1: number;
      stops: GradientStop[];
    };

interface GradientStop {
  color: string;
  offset: number;
}

function parseGradientPaint(value: string): ParsedGradientPaint | null {
  const match = /^(linear-gradient|radial-gradient|linear|radial)\s*\((.*)\)$/.exec(value.trim());
  if (!match) return null;

  const rawName = match[1]!;
  const kind = rawName.startsWith("linear") ? "linear" : "radial";
  const args = splitGradientArgs(match[2]!);
  const numericCount = kind === "linear" ? 4 : 6;
  if (args.length < numericCount + 2) {
    throw new Error(`${rawName} expects ${numericCount} coordinates followed by color, offset stop pairs`);
  }

  const coordinateArgs = args.slice(0, numericCount);
  const numbers = coordinateArgs.map((part) => parseGradientNumber(part));
  if (numbers.some((part) => !Number.isFinite(part))) {
    throw new Error(`${rawName} gradient coordinates must be finite numbers in '${value}' (got: ${coordinateArgs.join(", ")})`);
  }

  const stopArgs = args.slice(numericCount);
  if (stopArgs.length % 2 !== 0) {
    throw new Error(`${rawName} gradient stops must be color, offset pairs`);
  }

  const stops: GradientStop[] = [];
  for (let index = 0; index < stopArgs.length; index += 2) {
    const color = stopArgs[index]!;
    const offset = parseGradientNumber(stopArgs[index + 1]!);
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
      throw new Error(`${rawName} gradient stop offsets must be numbers from 0 to 1`);
    }
    stops.push({ color, offset });
  }

  if (stops.length === 0) {
    throw new Error(`${rawName} gradient expects at least one color stop`);
  }

  return kind === "linear"
    ? { kind, x1: numbers[0]!, y1: numbers[1]!, x2: numbers[2]!, y2: numbers[3]!, stops }
    : {
        kind,
        x0: numbers[0]!,
        y0: numbers[1]!,
        r0: numbers[2]!,
        x1: numbers[3]!,
        y1: numbers[4]!,
        r1: numbers[5]!,
        stops
      };
}

function splitGradientArgs(input: string): string[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseGradientNumber(value: string): number {
  const normalized = value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return Number.NaN;
  return Number(normalized);
}

// Image cache for loaded images
const imageCache = new Map<string, RenderableImage | null>();

export async function preloadImages(scene: SceneIR, basePath: string): Promise<void> {
  const { loadImage } = loadNodeModule<SkiaCanvasModule>("skia-canvas");
  const srcs = new Set<string>();
  for (const element of scene.elements) {
    if (element.type === "image") {
      const src = element.static.src;
      if (typeof src === "string" && src) {
        srcs.add(src);
      }
    }
  }

  await Promise.all(
    Array.from(srcs).map(async (src) => {
      if (imageCache.has(src)) return;
      try {
        const resolvedPath = await resolveAssetPath(src, basePath, "image");
        if (resolvedPath) {
          const img = await loadImage(resolvedPath);
          imageCache.set(src, img as unknown as RenderableImage);
        } else {
          imageCache.set(src, null);
        }
      } catch {
        imageCache.set(src, null);
      }
    })
  );
}

export interface BrowserImagePreloadOptions {
  assetBaseUrl?: string | ((src: string) => string);
  crossOrigin?: "" | "anonymous" | "use-credentials";
  imageLoader?: (src: string) => Promise<RenderableImage | null> | RenderableImage | null;
}

export async function preloadBrowserImages(scene: SceneIR, options: BrowserImagePreloadOptions = {}): Promise<void> {
  const srcs = new Set<string>();
  for (const element of scene.elements) {
    if (element.type === "image") {
      const src = element.static.src;
      if (typeof src === "string" && src) {
        srcs.add(src);
      }
    }
  }

  await Promise.all(
    Array.from(srcs).map(async (src) => {
      if (imageCache.has(src)) return;
      try {
        const image = options.imageLoader
          ? await options.imageLoader(src)
          : await loadBrowserImage(resolveBrowserAssetUrl(src, options.assetBaseUrl), options.crossOrigin);
        imageCache.set(src, image);
      } catch {
        imageCache.set(src, null);
      }
    })
  );
}

export function setImageCacheEntry(src: string, image: RenderableImage | null): void {
  imageCache.set(src, image);
}

export function clearImageCache(): void {
  imageCache.clear();
}

function getImage(src: string): RenderableImage | null {
  return imageCache.get(src) ?? null;
}

function resolveBrowserAssetUrl(src: string, assetBaseUrl: BrowserImagePreloadOptions["assetBaseUrl"]): string {
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("/")) {
    return src;
  }
  if (typeof assetBaseUrl === "function") {
    return assetBaseUrl(src);
  }
  if (typeof assetBaseUrl === "string" && assetBaseUrl.length > 0) {
    return new URL(src, assetBaseUrl.endsWith("/") ? assetBaseUrl : `${assetBaseUrl}/`).toString();
  }
  return src;
}

function loadBrowserImage(src: string, crossOrigin: BrowserImagePreloadOptions["crossOrigin"]): Promise<RenderableImage | null> {
  if (typeof Image === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const image = new Image();
    if (crossOrigin !== undefined) {
      image.crossOrigin = crossOrigin;
    }
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export interface RawFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RenderedCanvasFrame {
  width: number;
  height: number;
}

export interface RenderFrameToCanvasSettings extends Partial<ExportSettings> {
  resizeCanvas?: boolean;
}

// Check if a circle command is a simple particle (can be batched)
function isSimpleCircleParticle(command: DrawCommand & { op: "circle" }): boolean {
  return (
    /__p\d+$/.test(command.id) &&
    !command.mask &&
    !command.effects &&
    command.strokeWidth === 0 &&
    hasRenderableFill(command.fill) &&
    command.anchor === "center" &&
    command.rotation === 0 &&
    command.z === 0 &&
    command.rotateX === 0 &&
    command.rotateY === 0 &&
    command.rotateZ === 0 &&
    command.scaleX === 1 &&
    command.scaleY === 1 &&
    command.draw >= 1
  );
}

// Check if a rect command is a simple particle (can be batched)
function isSimpleRectParticle(command: DrawCommand & { op: "rect" }): boolean {
  return (
    /__p\d+$/.test(command.id) &&
    !command.mask &&
    !command.effects &&
    command.strokeWidth === 0 &&
    hasRenderableFill(command.fill) &&
    command.anchor === "center" &&
    command.rotation === 0 &&
    command.z === 0 &&
    command.rotateX === 0 &&
    command.rotateY === 0 &&
    command.rotateZ === 0 &&
    command.scaleX === 1 &&
    command.scaleY === 1 &&
    command.draw >= 1 &&
    (command.cornerRadius === 0 || (Array.isArray(command.cornerRadius) && command.cornerRadius.every(r => r === 0)))
  );
}

// Batch render simple circle particles for performance
function renderCircleParticleBatch(
  ctx: CanvasRenderingContext2D,
  particles: Array<DrawCommand & { op: "circle" }>,
  scaleX: number,
  scaleY: number
): void {
  // Group by fill color and opacity (rounded to reduce groups)
  const byColorOpacity = new Map<string, Array<DrawCommand & { op: "circle" }>>();
  for (const p of particles) {
    const opacityKey = Math.round(p.opacity * 100) / 100;
    const key = `${p.fill}|${opacityKey}`;
    const group = byColorOpacity.get(key);
    if (group) group.push(p);
    else byColorOpacity.set(key, [p]);
  }

  for (const [key, group] of byColorOpacity) {
    const [fill, opacityStr] = key.split("|");
    const opacity = Number(opacityStr);
    if (opacity <= 0) continue;

    ctx.globalAlpha = opacity;
    ctx.fillStyle = fill!;
    ctx.beginPath();
    for (const p of group) {
      const cx = p.x * scaleX;
      const cy = p.y * scaleY;
      const r = p.r * Math.min(scaleX, scaleY) * p.scale;
      if (r > 0) {
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Batch render simple rect particles for performance
function renderRectParticleBatch(
  ctx: CanvasRenderingContext2D,
  particles: Array<DrawCommand & { op: "rect" }>,
  scaleX: number,
  scaleY: number
): void {
  // Group by fill color and opacity
  const byColorOpacity = new Map<string, Array<DrawCommand & { op: "rect" }>>();
  for (const p of particles) {
    const opacityKey = Math.round(p.opacity * 100) / 100;
    const key = `${p.fill}|${opacityKey}`;
    const group = byColorOpacity.get(key);
    if (group) group.push(p);
    else byColorOpacity.set(key, [p]);
  }

  for (const [key, group] of byColorOpacity) {
    const [fill, opacityStr] = key.split("|");
    const opacity = Number(opacityStr);
    if (opacity <= 0) continue;

    ctx.globalAlpha = opacity;
    ctx.fillStyle = fill!;
    for (const p of group) {
      const w = p.width * scaleX * p.scale;
      const h = p.height * scaleY * p.scale;
      const rx = p.x * scaleX - w / 2;
      const ry = p.y * scaleY - h / 2;
      if (w > 0 && h > 0) {
        ctx.fillRect(rx, ry, w, h);
      }
    }
  }
  ctx.globalAlpha = 1;
}

export function renderFrameToCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  scene: SceneIR,
  tMs: number,
  settings: RenderFrameToCanvasSettings = {}
): RenderedCanvasFrame {
  const width = settings.width ?? scene.canvas.width;
  const height = settings.height ?? scene.canvas.height;
  if (settings.resizeCanvas !== false && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not acquire a 2D canvas context");
  }

  return renderFrameToContext(ctx as CanvasRenderingContext2D, scene, tMs, settings);
}

export function renderFrameToContext(
  ctx: CanvasRenderingContext2D,
  scene: SceneIR,
  tMs: number,
  settings: Partial<ExportSettings> = {}
): RenderedCanvasFrame {
  const debugCamera = scene.canvas.debug?.includes("camera");
  // Always skip camera parent transform - apply camera as canvas transform instead
  const frame = resolveFrame(scene, tMs, { skipCameraTransform: true });
  const width = settings?.width ?? frame.canvas.width;
  const height = settings?.height ?? frame.canvas.height;
  const scaleX = width / frame.canvas.width;
  const scaleY = height / frame.canvas.height;
  const perspective = getPerspectiveParams(frame.canvas, scaleX, scaleY);
  const commands = renderStaticFrameToCommands(frame);

  // Get camera transform values (un-invert the stored inverted values)
  const cam = frame.elements.find((el) => el.id === "__camera");
  const camX = cam ? -(typeof cam.props.x === "number" ? cam.props.x : 0) : 0;
  const camY = cam ? -(typeof cam.props.y === "number" ? cam.props.y : 0) : 0;
  const camScale = cam && typeof cam.props.scale === "number" ? 1 / cam.props.scale : 1;
  const camRotation = cam ? -(typeof cam.props.rotation === "number" ? cam.props.rotation : 0) : 0;

  // Collect simple particles for batched rendering
  let circleBatch: Array<DrawCommand & { op: "circle" }> = [];
  let rectBatch: Array<DrawCommand & { op: "rect" }> = [];

  // Helper to flush all batches
  const flushBatches = () => {
    if (circleBatch.length > 0) {
      renderCircleParticleBatch(ctx, circleBatch, scaleX, scaleY);
      circleBatch = [];
    }
    if (rectBatch.length > 0) {
      renderRectParticleBatch(ctx, rectBatch, scaleX, scaleY);
      rectBatch = [];
    }
  };

  for (const command of commands) {
    if (command.op === "clear") {
      ctx.fillStyle = command.color;
      ctx.fillRect(0, 0, width, height);
      // Apply camera transform after clearing (unless debug mode)
      if (!debugCamera && cam) {
        ctx.translate(width / 2, height / 2);
        ctx.scale(camScale, camScale);
        ctx.rotate(camRotation);
        ctx.translate(-width / 2 - camX * scaleX, -height / 2 - camY * scaleY);
      }
    } else if (command.op === "rect") {
      // Batch simple rect particles for performance
      if (isSimpleRectParticle(command)) {
        rectBatch.push(command);
        continue;
      }
      // Flush batches before complex rect
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      if (isProjectedCommand(command)) {
        renderProjectedRect(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const drawX = command.x * scaleX;
      const drawY = command.y * scaleY;
      const drawW = command.width * scaleX;
      const drawH = command.height * scaleY;
      const offset = anchorOffset(command.anchor, drawW, drawH);
      const rx = drawX + offset.x;
      const ry = drawY + offset.y;
      applyTransform(ctx, drawX, drawY, command.rotation, command.scale);
      const drawWindow = getDrawWindow(command);
      const cr = scaleCornerRadius(command.cornerRadius, Math.min(scaleX, scaleY));
      applyStrokeStyle(ctx, command);
      if (isFullDrawWindow(drawWindow)) {
        if (hasRenderableFill(command.fill)) {
          ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY, drawX, drawY);
          if (cr) {
            ctx.beginPath();
            ctx.roundRect(rx, ry, drawW, drawH, cr);
            ctx.fill();
          } else {
            ctx.fillRect(rx, ry, drawW, drawH);
          }
        }
        if (command.stroke && command.strokeWidth > 0) {
          ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY, drawX, drawY);
          ctx.lineWidth = command.strokeWidth * Math.min(scaleX, scaleY);
          applyStrokePattern(ctx, command, Math.min(scaleX, scaleY));
          if (cr) {
            ctx.beginPath();
            ctx.roundRect(rx, ry, drawW, drawH, cr);
            ctx.stroke();
          } else {
            ctx.strokeRect(rx, ry, drawW, drawH);
          }
        }
      } else if (drawWindow.end > drawWindow.start) {
        ctx.strokeStyle = resolvePaint(ctx, strokeOrFillPaint(command.stroke, command.fill), scaleX, scaleY, drawX, drawY);
        ctx.lineWidth = (command.strokeWidth || 2) * Math.min(scaleX, scaleY);
        applyStrokePattern(ctx, command, Math.min(scaleX, scaleY));
        ctx.beginPath();
        traceRectWindow(ctx, rx, ry, drawW, drawH, drawWindow.start, drawWindow.end);
        ctx.stroke();
      }
      ctx.restore();
    } else if (command.op === "circle") {
      // Batch simple particles for performance
      if (isSimpleCircleParticle(command)) {
        circleBatch.push(command);
        continue;
      }
      // Flush batches before complex circle
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      applyStrokeStyle(ctx, command);
      if (isProjectedCommand(command)) {
        renderProjectedCircle(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const drawX = command.x * scaleX;
      const drawY = command.y * scaleY;
      const r = command.r * Math.min(scaleX, scaleY);
      const offset = anchorOffset(command.anchor, r * 2, r * 2);
      const cx = drawX + offset.x + r;
      const cy = drawY + offset.y + r;
      applyTransform(ctx, drawX, drawY, command.rotation, command.scale);
      const drawWindow = getDrawWindow(command);
      if (drawWindow.end > drawWindow.start) {
        const startAngle = -Math.PI / 2 + drawWindow.start * Math.PI * 2;
        const endAngle = -Math.PI / 2 + drawWindow.end * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, endAngle);
        if (isFullDrawWindow(drawWindow) && hasRenderableFill(command.fill)) {
          ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
          ctx.fill();
        }
        if (command.stroke && command.strokeWidth > 0) {
          ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
          ctx.lineWidth = command.strokeWidth * Math.min(scaleX, scaleY);
          applyStrokePattern(ctx, command, Math.min(scaleX, scaleY));
          ctx.stroke();
        } else if (!isFullDrawWindow(drawWindow)) {
          ctx.strokeStyle = resolvePaint(ctx, strokeOrFillPaint(command.stroke, command.fill), scaleX, scaleY);
          ctx.lineWidth = 2;
          applyStrokePattern(ctx, command, Math.min(scaleX, scaleY));
          ctx.stroke();
        } else if (hasRenderableFill(command.fill)) {
          ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (command.op === "ellipse") {
      // Flush batches before ellipse
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      applyStrokeStyle(ctx, command);
      if (isProjectedCommand(command)) {
        renderProjectedEllipse(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const drawX = command.x * scaleX;
      const drawY = command.y * scaleY;
      const rx = command.rx * scaleX;
      const ry = command.ry * scaleY;
      const offset = anchorOffset(command.anchor, rx * 2, ry * 2);
      const cx = drawX + offset.x + rx;
      const cy = drawY + offset.y + ry;
      applyTransform(ctx, drawX, drawY, command.rotation, command.scale);
      const drawWindow = getDrawWindow(command);
      if (drawWindow.end > drawWindow.start) {
        const startAngle = -Math.PI / 2 + drawWindow.start * Math.PI * 2;
        const endAngle = -Math.PI / 2 + drawWindow.end * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, startAngle, endAngle);
        if (isFullDrawWindow(drawWindow) && hasRenderableFill(command.fill)) {
          ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
          ctx.fill();
        }
        if (command.stroke && command.strokeWidth > 0) {
          ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
          ctx.lineWidth = command.strokeWidth * Math.min(scaleX, scaleY);
          applyStrokePattern(ctx, command, Math.min(scaleX, scaleY));
          ctx.stroke();
        } else if (!isFullDrawWindow(drawWindow)) {
          ctx.strokeStyle = resolvePaint(ctx, strokeOrFillPaint(command.stroke, command.fill), scaleX, scaleY);
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (hasRenderableFill(command.fill)) {
          ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (command.op === "line") {
      // Flush batches before line
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      if (isProjectedCommand(command)) {
        renderProjectedLine(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const x1 = command.x1 * scaleX + 0.5;
      const y1 = command.y1 * scaleY + 0.5;
      const x2 = command.x2 * scaleX + 0.5;
      const y2 = command.y2 * scaleY + 0.5;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      applyTransform(ctx, midX, midY, command.rotation, command.scale);
      const drawWindow = getStrokeWindow(command);
      if (drawWindow.end > drawWindow.start) {
        const start = lerpPoint(x1, y1, x2, y2, drawWindow.start);
        const end = lerpPoint(x1, y1, x2, y2, drawWindow.end);
        ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
        ctx.lineWidth = command.strokeWidth * Math.min(scaleX, scaleY);
        ctx.lineCap = (command.strokeCap as CanvasLineCap) || "round";
        applyStrokeStyle(ctx, command);
        applyStrokePattern(ctx, command, Math.min(scaleX, scaleY));
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.restore();
    } else if (command.op === "line3d") {
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      renderLine3D(ctx, command, perspective, scaleX, scaleY);
      ctx.restore();
    } else if (command.op === "text") {
      // Flush batches before text
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      if (isProjectedCommand(command)) {
        renderProjectedText(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const drawX = command.x * scaleX;
      const drawY = command.y * scaleY;
      const fontSize = command.size * Math.min(scaleX, scaleY);
      const fontWeight = command.weight || "normal";
      ctx.font = `${fontWeight} ${fontSize}px ${resolveFontFamily(command.font)}`;

      const fullContent = command.content;
      const drawProgress = Math.max(0, Math.min(1, command.draw));
      const charCount = Math.floor(fullContent.length * drawProgress);
      const content = fullContent.substring(0, charCount);
      const lines = content.split("\n");
      const lineHeightPx = fontSize * command.lineHeight;
      const letterSpacing = command.letterSpacing * Math.min(scaleX, scaleY);

      // Calculate total text dimensions from full content for consistent anchor
      const fullLines = fullContent.split("\n");
      let maxLineWidth = 0;
      for (const line of fullLines) {
        const lineWidth = measureTextWithSpacing(ctx, line, letterSpacing);
        if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
      }
      const textW = maxLineWidth;
      const textH = lineHeightPx * fullLines.length;

      const offset = anchorOffset(command.anchor, textW, textH);
      applyTransform(ctx, drawX, drawY, command.rotation, command.scale);

      ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
      if (command.stroke && command.strokeWidth > 0) {
        ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
        ctx.lineWidth = command.strokeWidth * Math.min(scaleX, scaleY);
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineY = drawY + offset.y + fontSize * 0.8 + i * lineHeightPx;
        let lineX = drawX + offset.x;

        // Apply alignment
        if (command.align === "center") {
          const lineWidth = measureTextWithSpacing(ctx, line, letterSpacing);
          lineX = drawX + offset.x + (textW - lineWidth) / 2;
        } else if (command.align === "right") {
          const lineWidth = measureTextWithSpacing(ctx, line, letterSpacing);
          lineX = drawX + offset.x + (textW - lineWidth);
        }

        if (letterSpacing !== 0) {
          // Draw characters individually with spacing
          let charX = lineX;
          for (const char of line) {
            if (command.stroke && command.strokeWidth > 0) {
              ctx.strokeText(char, charX, lineY);
            }
            ctx.fillText(char, charX, lineY);
            charX += ctx.measureText(char).width + letterSpacing;
          }
        } else {
          if (command.stroke && command.strokeWidth > 0) {
            ctx.strokeText(line, lineX, lineY);
          }
          ctx.fillText(line, lineX, lineY);
        }
      }
      ctx.restore();
    } else if (command.op === "path") {
      // Flush batches before path
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      applyStrokeStyle(ctx, command);
      if (isProjectedCommand(command)) {
        renderProjectedPath(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const drawX = command.x * scaleX;
      const drawY = command.y * scaleY;
      applyTransform(ctx, drawX, drawY, command.rotation, command.scale);
      ctx.translate(drawX, drawY);
      ctx.scale(scaleX, scaleY);
      traceSvgPath(ctx, command.d);
      const drawWindow = getDrawWindow(command);
      if (isFullDrawWindow(drawWindow)) {
        if (hasRenderableFill(command.fill)) {
          ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
          ctx.fill();
        }
        if (command.stroke && command.strokeWidth > 0) {
          ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
          ctx.lineWidth = command.strokeWidth;
          applyStrokePattern(ctx, command, 1);
          ctx.stroke();
        }
      } else if (drawWindow.end > drawWindow.start && command.stroke && command.strokeWidth > 0) {
        const pathLen = getPathLength(command.points, command.d);
        ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
        ctx.lineWidth = command.strokeWidth;
        ctx.setLineDash([pathLen * (drawWindow.end - drawWindow.start), pathLen]);
        ctx.lineDashOffset = -pathLen * drawWindow.start;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      ctx.restore();
    } else if (command.op === "poly3d" || command.op === "path3d") {
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      applyStrokeStyle(ctx, command);
      renderPoly3D(ctx, command, perspective, scaleX, scaleY);
      ctx.restore();
    } else if (command.op === "image") {
      // Flush batches before image
      flushBatches();
      ctx.save();
      ctx.globalAlpha = command.opacity;
      ctx.globalCompositeOperation = command.comp as GlobalCompositeOperation;
      applyMask(ctx, command.mask, scaleX, scaleY, tMs / 1000);
      applyEffects(ctx, command.effects, scaleX, scaleY);
      if (isProjectedCommand(command)) {
        renderProjectedImage(ctx, command, perspective, scaleX, scaleY);
        ctx.restore();
        continue;
      }
      const drawX = command.x * scaleX;
      const drawY = command.y * scaleY;
      const fullW = command.width * scaleX;
      const drawH = command.height * scaleY;
      const offset = anchorOffset(command.anchor, fullW, drawH);
      const ix = drawX + offset.x;
      const iy = drawY + offset.y;
      applyTransform(ctx, drawX, drawY, command.rotation, command.scale);
      const drawProgress = Math.max(0, Math.min(1, command.draw));
      const drawW = fullW * drawProgress;
      const img = getImage(command.src);
      if (img) {
        drawFittedImage(ctx, img, command.fit, ix, iy, drawW, drawH, fullW, drawH);
      } else {
        // Placeholder for missing images
        ctx.fillStyle = "#333";
        ctx.fillRect(ix, iy, drawW, drawH);
        if (drawProgress >= 1) {
          ctx.strokeStyle = "#666";
          ctx.lineWidth = 1;
          ctx.strokeRect(ix, iy, fullW, drawH);
        }
      }
      ctx.restore();
    }
  }

  // Flush any remaining particle batches
  flushBatches();

  // Reset transform before debug overlay
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (debugCamera) {
    drawCameraDebug(ctx, frame, scaleX, scaleY);
  }

  return { width, height };
}

export function renderFrameToRgba(scene: SceneIR, tMs: number, settings?: Partial<ExportSettings>): RawFrame {
  const { Canvas } = loadNodeModule<SkiaCanvasModule>("skia-canvas");
  const width = settings?.width ?? scene.canvas.width;
  const height = settings?.height ?? scene.canvas.height;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  renderFrameToContext(ctx, scene, tMs, settings);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8Array(imageData.data.buffer) };
}

function loadNodeModule<T>(name: string): T {
  try {
    const nodeRequire = eval("require") as NodeRequire;
    return nodeRequire(name) as T;
  } catch {
    throw new Error(`Cannot load Node module '${name}' outside a CommonJS runtime`);
  }
}

function anchorOffset(anchor: AnchorPoint, w: number, h: number): { x: number; y: number } {
  switch (anchor) {
    case "top-left": return { x: 0, y: 0 };
    case "top-center": return { x: -w / 2, y: 0 };
    case "top-right": return { x: -w, y: 0 };
    case "center-left": return { x: 0, y: -h / 2 };
    case "center": return { x: -w / 2, y: -h / 2 };
    case "center-right": return { x: -w, y: -h / 2 };
    case "bottom-left": return { x: 0, y: -h };
    case "bottom-center": return { x: -w / 2, y: -h };
    case "bottom-right": return { x: -w, y: -h };
    default: return { x: -w / 2, y: -h / 2 };
  }
}

function applyTransform(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  rotation: number,
  scale: number
): void {
  if (rotation === 0 && scale === 1) return;
  ctx.translate(anchorX, anchorY);
  if (rotation !== 0) ctx.rotate(rotation);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-anchorX, -anchorY);
}

type RenderCommand = Exclude<DrawCommand, { op: "clear" }>;
type RectCommand = Extract<DrawCommand, { op: "rect" }>;
type CircleCommand = Extract<DrawCommand, { op: "circle" }>;
type EllipseCommand = Extract<DrawCommand, { op: "ellipse" }>;
type LineCommand = Extract<DrawCommand, { op: "line" }>;
type Line3DCommand = Extract<DrawCommand, { op: "line3d" }>;
type TextCommand = Extract<DrawCommand, { op: "text" }>;
type PathCommand = Extract<DrawCommand, { op: "path" }>;
type Poly3DCommand = Extract<DrawCommand, { op: "poly3d" | "path3d" }>;
type ImageCommand = Extract<DrawCommand, { op: "image" }>;

function getPerspectiveParams(
  canvas: SceneIR["canvas"],
  scaleX: number,
  scaleY: number
): PerspectiveParams {
  const minScale = Math.min(scaleX, scaleY);
  const defaultPerspective = Math.max(canvas.width, canvas.height) * 1.5;
  return {
    perspective: (canvas.perspective ?? defaultPerspective) * minScale,
    vanishX: (canvas.vanishX ?? canvas.width / 2) * scaleX,
    vanishY: (canvas.vanishY ?? canvas.height / 2) * scaleY
  };
}

function isProjectedCommand(command: RenderCommand): boolean {
  return (
    command.z !== 0 ||
    command.rotateX !== 0 ||
    command.rotateY !== 0 ||
    command.rotateZ !== 0 ||
    command.scaleX !== 1 ||
    command.scaleY !== 1 ||
    command._3dMat !== undefined
  );
}

function commandTransform3D(command: RenderCommand, scaleX: number, scaleY: number): Transform3DParams {
  const minScale = Math.min(scaleX, scaleY);
  return {
    z: command.z * minScale,
    rotateX: command.rotateX,
    rotateY: command.rotateY,
    rotateZ: command.rotation + command.rotateZ,
    rotateOrder: command.rotateOrder,
    scaleX: command.scale * command.scaleX,
    scaleY: command.scale * command.scaleY
  };
}

function commandGroupTransform(command: RenderCommand, scaleX: number, scaleY: number): GroupTransform3D | undefined {
  if (!command._3dMat) return undefined;
  const minScale = Math.min(scaleX, scaleY);
  return {
    mat: command._3dMat,
    ...(command._3dParentMat ? { parentMat: command._3dParentMat } : {}),
    offsetX: (command._3dOffsetX ?? 0) * scaleX,
    offsetY: (command._3dOffsetY ?? 0) * scaleY,
    offsetZ: (command._3dOffsetZ ?? 0) * minScale,
    scaleX: command.scale * command.scaleX,
    scaleY: command.scale * command.scaleY,
    z: command.z * minScale
  };
}

function projectCommandVertices(
  command: RenderCommand,
  vertices: Array<{ x: number; y: number }>,
  origin: { x: number; y: number },
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number,
  originOffset: { x: number; y: number } = { x: 0, y: 0 },
  closed = true
): ProjectedPoint[] {
  const world = transformVerticesToWorld(
    vertices,
    origin,
    commandTransform3D(command, scaleX, scaleY),
    commandGroupTransform(command, scaleX, scaleY),
    originOffset
  );
  return clipWorldPointsNear(world, perspective, closed).map((point) => projectPoint(point, perspective));
}

function projectCommandLocalPoints3D(
  command: RenderCommand,
  points: Point3D[],
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number,
  closed: boolean
): ProjectedPoint[] {
  const origin = { x: numericCommandX(command) * scaleX, y: numericCommandY(command) * scaleY };
  const minScale = Math.min(scaleX, scaleY);
  const scaled = points.map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
    z: point.z * minScale
  }));
  const world = transformLocalPoints3DToWorld(
    scaled,
    origin,
    commandTransform3D(command, scaleX, scaleY),
    commandGroupTransform(command, scaleX, scaleY)
  );
  return clipWorldPointsNear(world, perspective, closed).map((point) => projectPoint(point, perspective));
}

interface Bounds2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function boundsFromVertices(vertices: Array<{ x: number; y: number }>): Bounds2D {
  if (vertices.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
  }
  return { minX, maxX, minY, maxY };
}

function originOffsetForBounds(command: RenderCommand, bounds: Bounds2D, origin: { x: number; y: number }): { x: number; y: number } {
  if (command.origin === "center") return { x: 0, y: 0 };
  const point = pointForAnchor(command.origin, bounds);
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function pointForAnchor(anchor: AnchorPoint, bounds: Bounds2D): { x: number; y: number } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  switch (anchor) {
    case "top-left": return { x: bounds.minX, y: bounds.minY };
    case "top-center": return { x: cx, y: bounds.minY };
    case "top-right": return { x: bounds.maxX, y: bounds.minY };
    case "center-left": return { x: bounds.minX, y: cy };
    case "center": return { x: originFallbackX(bounds), y: originFallbackY(bounds) };
    case "center-right": return { x: bounds.maxX, y: cy };
    case "bottom-left": return { x: bounds.minX, y: bounds.maxY };
    case "bottom-center": return { x: cx, y: bounds.maxY };
    case "bottom-right": return { x: bounds.maxX, y: bounds.maxY };
  }
}

function originFallbackX(bounds: Bounds2D): number {
  return (bounds.minX + bounds.maxX) / 2;
}

function originFallbackY(bounds: Bounds2D): number {
  return (bounds.minY + bounds.maxY) / 2;
}

function renderProjectedRect(
  ctx: CanvasRenderingContext2D,
  command: RectCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const drawX = command.x * scaleX;
  const drawY = command.y * scaleY;
  const drawW = command.width * scaleX;
  const drawH = command.height * scaleY;
  const offset = anchorOffset(command.anchor, drawW, drawH);
  const rx = drawX + offset.x;
  const ry = drawY + offset.y;
  const vertices = [
    { x: rx, y: ry },
    { x: rx + drawW, y: ry },
    { x: rx + drawW, y: ry + drawH },
    { x: rx, y: ry + drawH }
  ];
  const origin = { x: drawX, y: drawY };
  const points = projectCommandVertices(
    command,
    vertices,
    origin,
    perspective,
    scaleX,
    scaleY,
    originOffsetForBounds(command, boundsFromVertices(vertices), origin),
    true
  );
  if (points.length < 3) return;
  const drawWindow = getDrawWindow(command);
  const lineScale = Math.min(scaleX, scaleY) * averageProjectionScale(points);

  if (isFullDrawWindow(drawWindow)) {
    if (hasRenderableFill(command.fill)) {
      ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY, drawX, drawY);
      traceProjectedPolyline(ctx, points, true);
      ctx.fill();
    }
    if (command.stroke && command.strokeWidth > 0) {
      ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY, drawX, drawY);
      ctx.lineWidth = command.strokeWidth * lineScale;
      applyStrokePattern(ctx, command, lineScale);
      traceProjectedPolyline(ctx, points, true);
      ctx.stroke();
    }
  } else if (drawWindow.end > drawWindow.start) {
    ctx.strokeStyle = resolvePaint(ctx, strokeOrFillPaint(command.stroke, command.fill), scaleX, scaleY, drawX, drawY);
    ctx.lineWidth = (command.strokeWidth || 2) * lineScale;
    applyStrokePattern(ctx, command, lineScale);
    traceProjectedWindow(ctx, points, true, drawWindow.start, drawWindow.end);
    ctx.stroke();
  }
}

function renderProjectedCircle(
  ctx: CanvasRenderingContext2D,
  command: CircleCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const drawX = command.x * scaleX;
  const drawY = command.y * scaleY;
  const r = command.r * Math.min(scaleX, scaleY);
  const offset = anchorOffset(command.anchor, r * 2, r * 2);
  const cx = drawX + offset.x + r;
  const cy = drawY + offset.y + r;
  renderProjectedEllipseLike(ctx, command, perspective, scaleX, scaleY, drawX, drawY, cx, cy, r, r);
}

function renderProjectedEllipse(
  ctx: CanvasRenderingContext2D,
  command: EllipseCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const drawX = command.x * scaleX;
  const drawY = command.y * scaleY;
  const rx = command.rx * scaleX;
  const ry = command.ry * scaleY;
  const offset = anchorOffset(command.anchor, rx * 2, ry * 2);
  const cx = drawX + offset.x + rx;
  const cy = drawY + offset.y + ry;
  renderProjectedEllipseLike(ctx, command, perspective, scaleX, scaleY, drawX, drawY, cx, cy, rx, ry);
}

function renderProjectedEllipseLike(
  ctx: CanvasRenderingContext2D,
  command: CircleCommand | EllipseCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number,
  originX: number,
  originY: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  const drawWindow = getDrawWindow(command);
  if (drawWindow.end <= drawWindow.start || rx <= 0 || ry <= 0) return;

  const full = isFullDrawWindow(drawWindow);
  const startAngle = -Math.PI / 2 + drawWindow.start * Math.PI * 2;
  const endAngle = -Math.PI / 2 + drawWindow.end * Math.PI * 2;
  const vertices = sampleEllipseVertices(cx, cy, rx, ry, startAngle, endAngle, full ? 64 : 48);
  const origin = { x: originX, y: originY };
  const points = projectCommandVertices(
    command,
    vertices,
    origin,
    perspective,
    scaleX,
    scaleY,
    originOffsetForBounds(command, boundsFromVertices(vertices), origin),
    full
  );
  if (points.length < 2 || (full && points.length < 3)) return;
  const lineScale = Math.min(scaleX, scaleY) * averageProjectionScale(points);

  if (full && hasRenderableFill(command.fill)) {
    ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
    traceProjectedPolyline(ctx, points, true);
    ctx.fill();
  }
  if (command.stroke && command.strokeWidth > 0) {
    ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
    ctx.lineWidth = command.strokeWidth * lineScale;
    applyStrokePattern(ctx, command, lineScale);
    traceProjectedPolyline(ctx, points, full);
    ctx.stroke();
  } else if (!full) {
    ctx.strokeStyle = resolvePaint(ctx, strokeOrFillPaint(command.stroke, command.fill), scaleX, scaleY);
    ctx.lineWidth = 2 * lineScale;
    applyStrokePattern(ctx, command, lineScale);
    traceProjectedPolyline(ctx, points, false);
    ctx.stroke();
  } else if (hasRenderableFill(command.fill)) {
    ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
    traceProjectedPolyline(ctx, points, true);
    ctx.fill();
  }
}

function renderProjectedLine(
  ctx: CanvasRenderingContext2D,
  command: LineCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const x1 = command.x1 * scaleX + 0.5;
  const y1 = command.y1 * scaleY + 0.5;
  const x2 = command.x2 * scaleX + 0.5;
  const y2 = command.y2 * scaleY + 0.5;
  const drawWindow = getStrokeWindow(command);
  if (drawWindow.end <= drawWindow.start) return;

  const start = lerpPoint(x1, y1, x2, y2, drawWindow.start);
  const end = lerpPoint(x1, y1, x2, y2, drawWindow.end);
  const origin = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const vertices = [start, end];
  const points = projectCommandVertices(
    command,
    vertices,
    origin,
    perspective,
    scaleX,
    scaleY,
    originOffsetForBounds(command, boundsFromVertices(vertices), origin),
    false
  );
  if (points.length < 2) return;
  const lineScale = Math.min(scaleX, scaleY) * averageProjectionScale(points);

  ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
  ctx.lineWidth = command.strokeWidth * lineScale;
  ctx.lineCap = (command.strokeCap as CanvasLineCap) || "round";
  applyStrokeStyle(ctx, command);
  applyStrokePattern(ctx, command, lineScale);
  traceProjectedPolyline(ctx, points, false);
  ctx.stroke();
}

function renderLine3D(
  ctx: CanvasRenderingContext2D,
  command: Line3DCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const localPoints = numberTriplesToPoints(command.points);
  if (localPoints.length < 2) return;

  const drawWindow = getStrokeWindow(command);
  if (drawWindow.end <= drawWindow.start) return;

  const clippedPoints = projectCommandLocalPoints3D(command, localPoints, perspective, scaleX, scaleY, false);
  if (clippedPoints.length < 2) return;

  const lineScale = Math.min(scaleX, scaleY) * averageProjectionScale(clippedPoints);
  ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
  ctx.lineWidth = command.strokeWidth * lineScale;
  ctx.lineCap = (command.strokeCap as CanvasLineCap) || "round";
  applyStrokeStyle(ctx, command);
  applyStrokePattern(ctx, command, lineScale);
  traceProjectedWindow(ctx, clippedPoints, false, drawWindow.start, drawWindow.end);
  ctx.stroke();
}

function renderPoly3D(
  ctx: CanvasRenderingContext2D,
  command: Poly3DCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const localPoints = numberTriplesToPoints(command.points);
  if (localPoints.length < 2) return;

  const drawWindow = getDrawWindow(command);
  if (drawWindow.end <= drawWindow.start) return;

  const closed = command.closed;
  const projected = projectCommandLocalPoints3D(command, localPoints, perspective, scaleX, scaleY, closed);
  if (projected.length < 2 || (closed && projected.length < 3)) return;

  const lineScale = Math.min(scaleX, scaleY) * averageProjectionScale(projected);
  if (isFullDrawWindow(drawWindow)) {
    if (closed && hasRenderableFill(command.fill)) {
      ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
      traceProjectedPolyline(ctx, projected, true);
      ctx.fill();
    }
    if (command.stroke && command.strokeWidth > 0) {
      ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
      ctx.lineWidth = command.strokeWidth * lineScale;
      applyStrokePattern(ctx, command, lineScale);
      traceProjectedPolyline(ctx, projected, closed);
      ctx.stroke();
    }
  } else if (command.stroke && command.strokeWidth > 0) {
    ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
    ctx.lineWidth = command.strokeWidth * lineScale;
    applyStrokePattern(ctx, command, lineScale);
    traceProjectedWindow(ctx, projected, closed, drawWindow.start, drawWindow.end);
    ctx.stroke();
  }
}

interface TextLayout {
  fontSize: number;
  letterSpacing: number;
  lineHeightPx: number;
  textW: number;
  textH: number;
  lines: string[];
  offset: { x: number; y: number };
}

function renderProjectedText(
  ctx: CanvasRenderingContext2D,
  command: TextCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const drawX = command.x * scaleX;
  const drawY = command.y * scaleY;
  const layout = prepareTextLayout(ctx, command, scaleX, scaleY);
  if (layout.textW <= 0 || layout.textH <= 0) return;

  const x = drawX + layout.offset.x;
  const y = drawY + layout.offset.y;
  const vertices = [
    { x, y },
    { x: x + layout.textW, y },
    { x: x + layout.textW, y: y + layout.textH },
    { x, y: y + layout.textH }
  ];
  const origin = { x: drawX, y: drawY };
  const points = projectCommandVertices(
    command,
    vertices,
    origin,
    perspective,
    scaleX,
    scaleY,
    originOffsetForBounds(command, boundsFromVertices(vertices), origin),
    true
  );
  if (points.length !== 4) return;

  if (!applyAffineProjection(ctx, layout.textW, layout.textH, points[0]!, points[1]!, points[3]!)) {
    return;
  }

  ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
  if (command.stroke && command.strokeWidth > 0) {
    ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
    ctx.lineWidth = command.strokeWidth * Math.min(scaleX, scaleY) * averageProjectionScale(points);
  }

  drawTextLines(ctx, command, layout, 0, 0);
}

function renderProjectedPath(
  ctx: CanvasRenderingContext2D,
  command: PathCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const drawX = command.x * scaleX;
  const drawY = command.y * scaleY;
  const localPoints = command.points && command.points.length >= 2
    ? numberPairsToPoints(command.points)
    : approximateSvgPathPoints(command.d);
  if (localPoints.length === 0) return;

  const vertices = localPoints.map((point) => ({
    x: drawX + point.x * scaleX,
    y: drawY + point.y * scaleY
  }));
  const origin = { x: drawX, y: drawY };
  const closed = hasRenderableFill(command.fill) || /[Zz]\s*$/.test(command.d.trim());
  const projected = projectCommandVertices(
    command,
    vertices,
    origin,
    perspective,
    scaleX,
    scaleY,
    originOffsetForBounds(command, boundsFromVertices(vertices), origin),
    closed
  );
  if (projected.length < 2 || (closed && projected.length < 3)) return;
  const drawWindow = getDrawWindow(command);
  const lineScale = Math.min(scaleX, scaleY) * averageProjectionScale(projected);

  if (isFullDrawWindow(drawWindow)) {
    if (hasRenderableFill(command.fill)) {
      ctx.fillStyle = resolvePaint(ctx, command.fill, scaleX, scaleY);
      traceProjectedPolyline(ctx, projected, closed);
      ctx.fill();
    }
    if (command.stroke && command.strokeWidth > 0) {
      ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
      ctx.lineWidth = command.strokeWidth * lineScale;
      applyStrokePattern(ctx, command, lineScale);
      traceProjectedPolyline(ctx, projected, closed);
      ctx.stroke();
    }
  } else if (drawWindow.end > drawWindow.start && command.stroke && command.strokeWidth > 0) {
    ctx.strokeStyle = resolvePaint(ctx, command.stroke, scaleX, scaleY);
    ctx.lineWidth = command.strokeWidth * lineScale;
    applyStrokePattern(ctx, command, lineScale);
    traceProjectedWindow(ctx, projected, closed, drawWindow.start, drawWindow.end);
    ctx.stroke();
  }
}

function renderProjectedImage(
  ctx: CanvasRenderingContext2D,
  command: ImageCommand,
  perspective: PerspectiveParams,
  scaleX: number,
  scaleY: number
): void {
  const drawX = command.x * scaleX;
  const drawY = command.y * scaleY;
  const fullW = command.width * scaleX;
  const drawH = command.height * scaleY;
  const offset = anchorOffset(command.anchor, fullW, drawH);
  const ix = drawX + offset.x;
  const iy = drawY + offset.y;
  const drawProgress = Math.max(0, Math.min(1, command.draw));
  const drawW = fullW * drawProgress;
  if (drawW <= 0 || drawH <= 0) return;

  const vertices = [
    { x: ix, y: iy },
    { x: ix + drawW, y: iy },
    { x: ix + drawW, y: iy + drawH },
    { x: ix, y: iy + drawH }
  ];
  const origin = { x: drawX, y: drawY };
  const points = projectCommandVertices(
    command,
    vertices,
    origin,
    perspective,
    scaleX,
    scaleY,
    originOffsetForBounds(command, boundsFromVertices(vertices), origin),
    true
  );
  if (points.length !== 4) return;

  if (!applyAffineProjection(ctx, drawW, drawH, points[0]!, points[1]!, points[3]!)) {
    return;
  }

  const img = getImage(command.src);
  if (img) {
    drawFittedImage(ctx, img, command.fit, 0, 0, drawW, drawH, fullW, drawH);
  } else {
    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, drawW, drawH);
    if (drawProgress >= 1) {
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, fullW, drawH);
    }
  }
}

function drawFittedImage(
  ctx: CanvasRenderingContext2D,
  img: RenderableImage,
  fit: ImageCommand["fit"],
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  clipW: number,
  clipH: number
): void {
  if (fit === "fill") {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }

  const source = fittedImageSource(img, fit, clipW, clipH);
  if (!source) {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }

  const visibleRatio = clipW > 0 ? Math.max(0, Math.min(1, dw / clipW)) : 1;
  const sourceW = source.sw * visibleRatio;
  const destW = source.dw * visibleRatio;
  if (sourceW <= 0 || destW <= 0 || source.dh <= 0) return;

  ctx.drawImage(img, source.sx, source.sy, sourceW, source.sh, dx + source.dx, dy + source.dy, destW, source.dh);
}

function fittedImageSource(
  img: RenderableImage,
  fit: ImageCommand["fit"],
  boxW: number,
  boxH: number
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } | null {
  const intrinsicW = imageIntrinsicWidth(img);
  const intrinsicH = imageIntrinsicHeight(img);
  if (intrinsicW <= 0 || intrinsicH <= 0 || boxW <= 0 || boxH <= 0) return null;

  if (fit === "contain") {
    const scale = Math.min(boxW / intrinsicW, boxH / intrinsicH);
    const dw = intrinsicW * scale;
    const dh = intrinsicH * scale;
    return {
      sx: 0,
      sy: 0,
      sw: intrinsicW,
      sh: intrinsicH,
      dx: (boxW - dw) / 2,
      dy: (boxH - dh) / 2,
      dw,
      dh
    };
  }

  const scale = Math.max(boxW / intrinsicW, boxH / intrinsicH);
  const sw = boxW / scale;
  const sh = boxH / scale;
  return {
    sx: (intrinsicW - sw) / 2,
    sy: (intrinsicH - sh) / 2,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: boxW,
    dh: boxH
  };
}

function imageIntrinsicWidth(img: RenderableImage): number {
  const candidate = img as { naturalWidth?: number; videoWidth?: number; width?: number };
  return Number(candidate.naturalWidth ?? candidate.videoWidth ?? candidate.width ?? 0);
}

function imageIntrinsicHeight(img: RenderableImage): number {
  const candidate = img as { naturalHeight?: number; videoHeight?: number; height?: number };
  return Number(candidate.naturalHeight ?? candidate.videoHeight ?? candidate.height ?? 0);
}

function prepareTextLayout(
  ctx: CanvasRenderingContext2D,
  command: TextCommand,
  scaleX: number,
  scaleY: number
): TextLayout {
  const fontSize = command.size * Math.min(scaleX, scaleY);
  const fontWeight = command.weight || "normal";
  ctx.font = `${fontWeight} ${fontSize}px ${resolveFontFamily(command.font)}`;

  const fullContent = command.content;
  const drawProgress = Math.max(0, Math.min(1, command.draw));
  const charCount = Math.floor(fullContent.length * drawProgress);
  const content = fullContent.substring(0, charCount);
  const lines = content.split("\n");
  const fullLines = fullContent.split("\n");
  const lineHeightPx = fontSize * command.lineHeight;
  const letterSpacing = command.letterSpacing * Math.min(scaleX, scaleY);

  let maxLineWidth = 0;
  for (const line of fullLines) {
    const lineWidth = measureTextWithSpacing(ctx, line, letterSpacing);
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;
  }

  const textW = maxLineWidth;
  const textH = lineHeightPx * fullLines.length;
  return {
    fontSize,
    letterSpacing,
    lineHeightPx,
    textW,
    textH,
    lines,
    offset: anchorOffset(command.anchor, textW, textH)
  };
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  command: TextCommand,
  layout: TextLayout,
  originX: number,
  originY: number
): void {
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]!;
    const lineY = originY + layout.fontSize * 0.8 + i * layout.lineHeightPx;
    let lineX = originX;

    if (command.align === "center") {
      const lineWidth = measureTextWithSpacing(ctx, line, layout.letterSpacing);
      lineX = originX + (layout.textW - lineWidth) / 2;
    } else if (command.align === "right") {
      const lineWidth = measureTextWithSpacing(ctx, line, layout.letterSpacing);
      lineX = originX + (layout.textW - lineWidth);
    }

    if (layout.letterSpacing !== 0) {
      let charX = lineX;
      for (const char of line) {
        if (command.stroke && command.strokeWidth > 0) {
          ctx.strokeText(char, charX, lineY);
        }
        ctx.fillText(char, charX, lineY);
        charX += ctx.measureText(char).width + layout.letterSpacing;
      }
    } else {
      if (command.stroke && command.strokeWidth > 0) {
        ctx.strokeText(line, lineX, lineY);
      }
      ctx.fillText(line, lineX, lineY);
    }
  }
}

function sampleEllipseVertices(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  segments: number
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const count = Math.max(2, Math.ceil(segments));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const angle = startAngle + (endAngle - startAngle) * t;
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  }
  return points;
}

function traceProjectedPolyline(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  closed: boolean
): void {
  ctx.beginPath();
  if (points.length === 0) return;
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  if (closed) ctx.closePath();
}

function traceProjectedWindow(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  closed: boolean,
  start: number,
  end: number
): void {
  const segments = projectedSegments(points, closed);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  ctx.beginPath();
  if (total <= 0) return;

  const startDistance = total * clamp01(start);
  const endDistance = total * clamp01(end);
  let walked = 0;
  let hasMove = false;

  for (const segment of segments) {
    const segStart = walked;
    const segEnd = walked + segment.length;
    walked = segEnd;
    if (segEnd < startDistance || segStart > endDistance) continue;

    const localStart = segment.length <= 0 ? 0 : clamp01((startDistance - segStart) / segment.length);
    const localEnd = segment.length <= 0 ? 0 : clamp01((endDistance - segStart) / segment.length);
    const from = interpolateProjected(segment.from, segment.to, localStart);
    const to = interpolateProjected(segment.from, segment.to, localEnd);

    if (!hasMove) {
      ctx.moveTo(from.x, from.y);
      hasMove = true;
    } else {
      ctx.lineTo(from.x, from.y);
    }
    ctx.lineTo(to.x, to.y);
  }
}

function projectedSegments(points: ProjectedPoint[], closed: boolean): Array<{ from: ProjectedPoint; to: ProjectedPoint; length: number }> {
  const segments: Array<{ from: ProjectedPoint; to: ProjectedPoint; length: number }> = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    segments.push({ from, to, length: distance(from.x, from.y, to.x, to.y) });
  }
  if (closed && points.length > 1) {
    const from = points[points.length - 1]!;
    const to = points[0]!;
    segments.push({ from, to, length: distance(from.x, from.y, to.x, to.y) });
  }
  return segments;
}

function interpolateProjected(from: ProjectedPoint, to: ProjectedPoint, t: number): ProjectedPoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    scale: from.scale + (to.scale - from.scale) * t
  };
}

function averageProjectionScale(points: ProjectedPoint[]): number {
  const values = points.map((point) => Math.abs(point.scale)).filter((value) => Number.isFinite(value));
  if (values.length === 0) return 1;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.max(0.001, Math.min(1000, average));
}

function applyAffineProjection(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  topLeft: ProjectedPoint,
  topRight: ProjectedPoint,
  bottomLeft: ProjectedPoint
): boolean {
  if (Math.abs(width) <= 0.001 || Math.abs(height) <= 0.001) return false;
  const a = (topRight.x - topLeft.x) / width;
  const b = (topRight.y - topLeft.y) / width;
  const c = (bottomLeft.x - topLeft.x) / height;
  const d = (bottomLeft.y - topLeft.y) / height;
  if (![a, b, c, d, topLeft.x, topLeft.y].every(Number.isFinite)) return false;
  ctx.transform(a, b, c, d, topLeft.x, topLeft.y);
  return true;
}

function numberPairsToPoints(points: number[]): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length - 1; i += 2) {
    result.push({ x: points[i]!, y: points[i + 1]! });
  }
  return result;
}

function numberTriplesToPoints(points: number[]): Point3D[] {
  const result: Point3D[] = [];
  for (let i = 0; i < points.length - 2; i += 3) {
    result.push({ x: points[i]!, y: points[i + 1]!, z: points[i + 2]! });
  }
  return result;
}

function numericCommandX(command: RenderCommand): number {
  return "x" in command && typeof command.x === "number" ? command.x : 0;
}

function numericCommandY(command: RenderCommand): number {
  return "y" in command && typeof command.y === "number" ? command.y : 0;
}

function clipWorldPointsNear(points: Point3D[], perspective: PerspectiveParams, closed: boolean): Point3D[] {
  if (points.length === 0 || !Number.isFinite(perspective.perspective) || perspective.perspective <= 0) {
    return points;
  }

  const nearZ = perspective.perspective - Math.max(1, perspective.perspective * 0.01);
  if (closed) return clipWorldPolygonNear(points, nearZ);
  return clipWorldPolylineNear(points, nearZ);
}

function clipWorldPolygonNear(points: Point3D[], nearZ: number): Point3D[] {
  if (points.length < 3) return points.filter((point) => point.z < nearZ);
  const output: Point3D[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const previous = points[(index + points.length - 1) % points.length]!;
    const currentInside = current.z < nearZ;
    const previousInside = previous.z < nearZ;

    if (currentInside !== previousInside) {
      output.push(intersectNearZ(previous, current, nearZ));
    }
    if (currentInside) {
      output.push(current);
    }
  }

  return output;
}

function clipWorldPolylineNear(points: Point3D[], nearZ: number): Point3D[] {
  if (points.length < 2) return points.filter((point) => point.z < nearZ);
  const output: Point3D[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const previousInside = previous.z < nearZ;
    const currentInside = current.z < nearZ;

    if (previousInside && output.length === 0) output.push(previous);
    if (previousInside !== currentInside) output.push(intersectNearZ(previous, current, nearZ));
    if (currentInside) output.push(current);
  }

  return output;
}

function intersectNearZ(a: Point3D, b: Point3D, nearZ: number): Point3D {
  const t = (nearZ - a.z) / (b.z - a.z || 1);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: nearZ
  };
}

interface DrawWindow {
  start: number;
  end: number;
}

function getDrawWindow(command: StrokeControls & { draw: number }): DrawWindow {
  if (command.drawStart !== undefined || command.drawEnd !== undefined) {
    return normalizeDrawWindow(command.drawStart ?? 0, command.drawEnd ?? 1);
  }
  return normalizeDrawWindow(0, command.draw);
}

function getStrokeWindow(command: StrokeControls): DrawWindow {
  return normalizeDrawWindow(command.drawStart ?? 0, command.drawEnd ?? 1);
}

function normalizeDrawWindow(start: number, end: number): DrawWindow {
  return {
    start: clamp01(start),
    end: clamp01(end)
  };
}

function isFullDrawWindow(window: DrawWindow): boolean {
  return window.start <= 0 && window.end >= 1;
}

function applyStrokePattern(ctx: CanvasRenderingContext2D, controls: StrokeControls, scale: number): void {
  if (controls.dashArray && controls.dashArray.length > 0) {
    ctx.setLineDash(controls.dashArray.map((value) => value * scale));
  }
  if (controls.dashOffset !== undefined) {
    ctx.lineDashOffset = controls.dashOffset * scale;
  }
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, controls: StrokeControls): void {
  if (controls.strokeCap) {
    ctx.lineCap = controls.strokeCap as CanvasLineCap;
  }
  if (controls.strokeJoin) {
    ctx.lineJoin = controls.strokeJoin as CanvasLineJoin;
  }
}

function scaleCornerRadius(
  value: number | number[],
  scale: number
): number | number[] | undefined {
  if (typeof value === "number") {
    return value > 0 ? value * scale : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    const scaled = value.map((v) => v * scale);
    return scaled.some((v) => v > 0) ? scaled : undefined;
  }
  return undefined;
}

function applyEffects(
  ctx: CanvasRenderingContext2D,
  effects: RenderEffects | undefined,
  scaleX: number,
  scaleY: number
): void {
  if (!effects) return;

  const minScale = Math.min(scaleX, scaleY);
  const filter = buildFilterString(effects, minScale);
  if (filter !== "none") {
    ctx.filter = filter;
  }

  if (effects.shadow) {
    ctx.shadowOffsetX = effects.shadow.offsetX * scaleX;
    ctx.shadowOffsetY = effects.shadow.offsetY * scaleY;
    ctx.shadowBlur = Math.max(0, effects.shadow.blur) * minScale;
    ctx.shadowColor = effects.shadow.color;
  }
}

function buildFilterString(effects: RenderEffects, scale: number): string {
  const parts: string[] = [];
  if (effects.blur !== 0) parts.push(`blur(${Math.max(0, effects.blur) * scale}px)`);
  if (effects.brightness !== 1) parts.push(`brightness(${Math.max(0, effects.brightness)})`);
  if (effects.contrast !== 1) parts.push(`contrast(${Math.max(0, effects.contrast)})`);
  if (effects.saturate !== 1) parts.push(`saturate(${Math.max(0, effects.saturate)})`);
  if (effects.hueRotate !== 0) parts.push(`hue-rotate(${effects.hueRotate}deg)`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

function traceRectWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  start: number,
  end: number
): void {
  const perimeter = 2 * (w + h);
  if (perimeter <= 0) return;

  const startDistance = perimeter * start;
  const endDistance = perimeter * end;
  const startPoint = pointOnRectPerimeter(x, y, w, h, startDistance);
  ctx.moveTo(startPoint.x, startPoint.y);

  for (const distance of [w, w + h, 2 * w + h, perimeter]) {
    if (distance > startDistance && distance < endDistance) {
      const point = pointOnRectPerimeter(x, y, w, h, distance);
      ctx.lineTo(point.x, point.y);
    }
  }

  const endPoint = pointOnRectPerimeter(x, y, w, h, endDistance);
  ctx.lineTo(endPoint.x, endPoint.y);
}

function pointOnRectPerimeter(x: number, y: number, w: number, h: number, distance: number): { x: number; y: number } {
  const perimeter = 2 * (w + h);
  const d = ((distance % perimeter) + perimeter) % perimeter;

  if (d <= w) return { x: x + d, y };
  if (d <= w + h) return { x: x + w, y: y + (d - w) };
  if (d <= 2 * w + h) return { x: x + w - (d - w - h), y: y + h };
  return { x, y: y + h - (d - 2 * w - h) };
}

function lerpPoint(x1: number, y1: number, x2: number, y2: number, t: number): { x: number; y: number } {
  return {
    x: x1 + (x2 - x1) * t,
    y: y1 + (y2 - y1) * t
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function applyMask(
  ctx: CanvasRenderingContext2D,
  mask: MaskIR | null,
  scaleX: number,
  scaleY: number,
  tSeconds: number = 0
): void {
  if (!mask) return;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;

  if (mask.type === "rect") {
    const mx = mask.x * scaleX;
    const my = mask.y * scaleY;
    const mw = mask.w * scaleX;
    const mh = mask.h * scaleY;
    if (mask.invert) {
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.rect(mx, my, mw, mh);
      ctx.clip("evenodd");
    } else {
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.clip();
    }
  } else if (mask.type === "circle") {
    const cx = mask.cx * scaleX;
    const cy = mask.cy * scaleY;
    const r = mask.r * Math.min(scaleX, scaleY);
    if (mask.invert) {
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.clip("evenodd");
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
    }
  } else if (mask.type === "path") {
    ctx.save();
    ctx.scale(scaleX, scaleY);
    if (mask.invert) {
      ctx.beginPath();
      ctx.rect(0, 0, cw / scaleX, ch / scaleY);
      traceSvgPath(ctx, mask.d);
      ctx.clip("evenodd");
    } else {
      traceSvgPath(ctx, mask.d);
      ctx.clip();
    }
    ctx.restore();
    ctx.scale(scaleX, scaleY);
  } else if (mask.type === "points") {
    const pts = mask.points;
    if (pts.length >= 4) {
      ctx.beginPath();
      if (mask.invert) {
        ctx.rect(0, 0, cw, ch);
      }
      ctx.moveTo(pts[0]! * scaleX, pts[1]! * scaleY);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i]! * scaleX, pts[i + 1]! * scaleY);
      }
      if (mask.closed !== false) {
        ctx.closePath();
      }
      ctx.clip(mask.invert ? "evenodd" : "nonzero");
    }
  } else if (mask.type === "fx") {
    const pts = evaluateFxMask(mask, tSeconds);
    ctx.beginPath();
    if (mask.invert) {
      ctx.rect(0, 0, cw, ch);
    }
    ctx.moveTo(pts[0]! * scaleX, pts[1]! * scaleY);
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo(pts[i]! * scaleX, pts[i + 1]! * scaleY);
    }
    ctx.closePath();
    ctx.clip(mask.invert ? "evenodd" : "nonzero");
  } else if (mask.type === "xt") {
    const pts = evaluateXtMask(mask, tSeconds);
    ctx.beginPath();
    if (mask.invert) {
      ctx.rect(0, 0, cw, ch);
    }
    ctx.moveTo(pts[0]! * scaleX, pts[1]! * scaleY);
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo(pts[i]! * scaleX, pts[i + 1]! * scaleY);
    }
    if (mask.closed !== false) {
      ctx.closePath();
    }
    ctx.clip(mask.invert ? "evenodd" : "nonzero");
  } else if (mask.type === "text") {
    console.warn("Text masks are not fully supported in Node.js export");
  }
}

function evaluateFxMask(mask: FxMaskIR, t: number): number[] {
  const fn = getCompiledFxExpr(mask.expr);
  const points: number[] = [];
  points.push(mask.xMin, mask.yBase);
  for (let i = 0; i <= mask.steps; i++) {
    const x = mask.xMin + (mask.xMax - mask.xMin) * (i / mask.steps);
    const y = fn({ x, t });
    points.push(x, y);
  }
  points.push(mask.xMax, mask.yBase);
  return points;
}

function evaluateXtMask(mask: XtMaskIR, time: number): number[] {
  const fnX = getCompiledFxExpr(mask.xExpr);
  const fnY = getCompiledFxExpr(mask.yExpr);
  const points: number[] = [];
  for (let i = 0; i <= mask.steps; i++) {
    const t = mask.tMin + (mask.tMax - mask.tMin) * (i / mask.steps);
    const x = fnX({ t, time });
    const y = fnY({ t, time });
    points.push(x, y);
  }
  return points;
}

type CanvasCtx = CanvasRenderingContext2D;

function getPathLength(points: number[] | null, d: string): number {
  if (Array.isArray(points) && points.length >= 4) {
    let len = 0;
    for (let i = 2; i < points.length; i += 2) {
      const dx = points[i]! - points[i - 2]!;
      const dy = points[i + 1]! - points[i - 1]!;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len || 1000;
  }
  return approximateSvgPathLength(d) || 1000;
}

function approximateSvgPathPoints(d: string): Array<{ x: number; y: number }> {
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  const points: Array<{ x: number; y: number }> = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicControl: { x: number; y: number } | null = null;
  let lastQuadraticControl: { x: number; y: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const args = (match[2] ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);

    switch (cmd) {
      case "M":
        if (hasArgs(args, 2)) {
          cx = args[0]!;
          cy = args[1]!;
          sx = cx;
          sy = cy;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "m":
        if (hasArgs(args, 2)) {
          cx += args[0]!;
          cy += args[1]!;
          sx = cx;
          sy = cy;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "L":
        if (hasArgs(args, 2)) {
          cx = args[0]!;
          cy = args[1]!;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "l":
        if (hasArgs(args, 2)) {
          cx += args[0]!;
          cy += args[1]!;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "H":
        if (hasArgs(args, 1)) {
          cx = args[0]!;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "h":
        if (hasArgs(args, 1)) {
          cx += args[0]!;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "V":
        if (hasArgs(args, 1)) {
          cy = args[0]!;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "v":
        if (hasArgs(args, 1)) {
          cy += args[0]!;
          pushPathPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "C":
      case "c": {
        if (!hasArgs(args, 6)) break;
        const relative = cmd === "c";
        const x1 = relative ? cx + args[0]! : args[0]!;
        const y1 = relative ? cy + args[1]! : args[1]!;
        const x2 = relative ? cx + args[2]! : args[2]!;
        const y2 = relative ? cy + args[3]! : args[3]!;
        const x = relative ? cx + args[4]! : args[4]!;
        const y = relative ? cy + args[5]! : args[5]!;
        addCubicPathPoints(points, cx, cy, x1, y1, x2, y2, x, y);
        cx = x;
        cy = y;
        lastCubicControl = { x: x2, y: y2 };
        lastQuadraticControl = null;
        break;
      }
      case "S":
      case "s": {
        if (!hasArgs(args, 4)) break;
        const reflected: { x: number; y: number } = lastCubicControl
          ? { x: 2 * cx - lastCubicControl.x, y: 2 * cy - lastCubicControl.y }
          : { x: cx, y: cy };
        const relative = cmd === "s";
        const x2 = relative ? cx + args[0]! : args[0]!;
        const y2 = relative ? cy + args[1]! : args[1]!;
        const x = relative ? cx + args[2]! : args[2]!;
        const y = relative ? cy + args[3]! : args[3]!;
        addCubicPathPoints(points, cx, cy, reflected.x, reflected.y, x2, y2, x, y);
        cx = x;
        cy = y;
        lastCubicControl = { x: x2, y: y2 };
        lastQuadraticControl = null;
        break;
      }
      case "Q":
      case "q": {
        if (!hasArgs(args, 4)) break;
        const relative = cmd === "q";
        const x1 = relative ? cx + args[0]! : args[0]!;
        const y1 = relative ? cy + args[1]! : args[1]!;
        const x = relative ? cx + args[2]! : args[2]!;
        const y = relative ? cy + args[3]! : args[3]!;
        addQuadraticPathPoints(points, cx, cy, x1, y1, x, y);
        cx = x;
        cy = y;
        lastCubicControl = null;
        lastQuadraticControl = { x: x1, y: y1 };
        break;
      }
      case "T":
      case "t": {
        if (!hasArgs(args, 2)) break;
        const reflected: { x: number; y: number } = lastQuadraticControl
          ? { x: 2 * cx - lastQuadraticControl.x, y: 2 * cy - lastQuadraticControl.y }
          : { x: cx, y: cy };
        const relative = cmd === "t";
        const x = relative ? cx + args[0]! : args[0]!;
        const y = relative ? cy + args[1]! : args[1]!;
        addQuadraticPathPoints(points, cx, cy, reflected.x, reflected.y, x, y);
        cx = x;
        cy = y;
        lastCubicControl = null;
        lastQuadraticControl = reflected;
        break;
      }
      case "A":
      case "a": {
        if (!hasArgs(args, 7)) break;
        const relative = cmd === "a";
        const [rxArg, ryArg, xAxisRotation, largeArcFlag, sweepFlag, dxArg, dyArg] = args as [number, number, number, number, number, number, number];
        const x = relative ? cx + dxArg : dxArg;
        const y = relative ? cy + dyArg : dyArg;
        addArcPathPoints(points, cx, cy, rxArg, ryArg, xAxisRotation, !!largeArcFlag, !!sweepFlag, x, y);
        cx = x;
        cy = y;
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "Z":
      case "z":
        cx = sx;
        cy = sy;
        pushPathPoint(points, cx, cy);
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
    }
  }

  return points;
}

function addArcPathPoints(
  points: Array<{ x: number; y: number }>,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): void {
  if (rx === 0 || ry === 0) {
    pushPathPoint(points, x2, y2);
    return;
  }

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
  sq = Math.sqrt(sq) * (largeArc === sweep ? -1 : 1);

  const cxp = (sq * rx * y1p) / ry;
  const cyp = (-sq * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

  if (!sweep && dTheta > 0) {
    dTheta -= Math.PI * 2;
  } else if (sweep && dTheta < 0) {
    dTheta += Math.PI * 2;
  }

  const segments = Math.max(8, Math.ceil(Math.abs(dTheta) / (Math.PI / 16)));
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = theta1 + dTheta * t;
    const px = cx + cosPhi * rx * Math.cos(angle) - sinPhi * ry * Math.sin(angle);
    const py = cy + sinPhi * rx * Math.cos(angle) + cosPhi * ry * Math.sin(angle);
    pushPathPoint(points, px, py);
  }
}

function pushPathPoint(points: Array<{ x: number; y: number }>, x: number, y: number): void {
  const last = points[points.length - 1];
  if (!last || last.x !== x || last.y !== y) {
    points.push({ x, y });
  }
}

function addCubicPathPoints(
  points: Array<{ x: number; y: number }>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): void {
  for (let index = 1; index <= 32; index++) {
    const t = index / 32;
    pushPathPoint(points, cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
  }
}

function addQuadraticPathPoints(
  points: Array<{ x: number; y: number }>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  for (let index = 1; index <= 24; index++) {
    const t = index / 24;
    pushPathPoint(points, quadraticAt(x0, x1, x2, t), quadraticAt(y0, y1, y2, t));
  }
}

function approximateSvgPathLength(d: string): number {
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let len = 0;
  let lastCubicControl: { x: number; y: number } | null = null;
  let lastQuadraticControl: { x: number; y: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const args = (match[2] ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);

    switch (cmd) {
      case "M":
        if (hasArgs(args, 2)) {
          cx = args[0]!;
          cy = args[1]!;
          sx = cx;
          sy = cy;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "m":
        if (hasArgs(args, 2)) {
          cx += args[0]!;
          cy += args[1]!;
          sx = cx;
          sy = cy;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "L":
        if (hasArgs(args, 2)) {
          len += distance(cx, cy, args[0]!, args[1]!);
          cx = args[0]!;
          cy = args[1]!;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "l":
        if (hasArgs(args, 2)) {
          const x = cx + args[0]!;
          const y = cy + args[1]!;
          len += distance(cx, cy, x, y);
          cx = x;
          cy = y;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "H":
        if (hasArgs(args, 1)) {
          len += Math.abs(args[0]! - cx);
          cx = args[0]!;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "h":
        if (hasArgs(args, 1)) {
          len += Math.abs(args[0]!);
          cx += args[0]!;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "V":
        if (hasArgs(args, 1)) {
          len += Math.abs(args[0]! - cy);
          cy = args[0]!;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "v":
        if (hasArgs(args, 1)) {
          len += Math.abs(args[0]!);
          cy += args[0]!;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      case "C":
        if (hasArgs(args, 6)) {
          len += approximateCubicLength(cx, cy, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!);
          cx = args[4]!;
          cy = args[5]!;
          lastCubicControl = { x: args[2]!, y: args[3]! };
          lastQuadraticControl = null;
        }
        break;
      case "c":
        if (hasArgs(args, 6)) {
          const x1 = cx + args[0]!;
          const y1 = cy + args[1]!;
          const x2 = cx + args[2]!;
          const y2 = cy + args[3]!;
          const x = cx + args[4]!;
          const y = cy + args[5]!;
          len += approximateCubicLength(cx, cy, x1, y1, x2, y2, x, y);
          cx = x;
          cy = y;
          lastCubicControl = { x: x2, y: y2 };
          lastQuadraticControl = null;
        }
        break;
      case "S":
        if (hasArgs(args, 4)) {
          const reflected = lastCubicControl
            ? { x: 2 * cx - lastCubicControl.x, y: 2 * cy - lastCubicControl.y }
            : { x: cx, y: cy };
          len += approximateCubicLength(cx, cy, reflected.x, reflected.y, args[0]!, args[1]!, args[2]!, args[3]!);
          lastCubicControl = { x: args[0]!, y: args[1]! };
          lastQuadraticControl = null;
          cx = args[2]!;
          cy = args[3]!;
        }
        break;
      case "s":
        if (hasArgs(args, 4)) {
          const reflected = lastCubicControl
            ? { x: 2 * cx - lastCubicControl.x, y: 2 * cy - lastCubicControl.y }
            : { x: cx, y: cy };
          const x2 = cx + args[0]!;
          const y2 = cy + args[1]!;
          const x = cx + args[2]!;
          const y = cy + args[3]!;
          len += approximateCubicLength(cx, cy, reflected.x, reflected.y, x2, y2, x, y);
          lastCubicControl = { x: x2, y: y2 };
          lastQuadraticControl = null;
          cx = x;
          cy = y;
        }
        break;
      case "Q":
        if (hasArgs(args, 4)) {
          len += approximateQuadraticLength(cx, cy, args[0]!, args[1]!, args[2]!, args[3]!);
          cx = args[2]!;
          cy = args[3]!;
          lastCubicControl = null;
          lastQuadraticControl = { x: args[0]!, y: args[1]! };
        }
        break;
      case "q":
        if (hasArgs(args, 4)) {
          const x1 = cx + args[0]!;
          const y1 = cy + args[1]!;
          const x = cx + args[2]!;
          const y = cy + args[3]!;
          len += approximateQuadraticLength(cx, cy, x1, y1, x, y);
          cx = x;
          cy = y;
          lastCubicControl = null;
          lastQuadraticControl = { x: x1, y: y1 };
        }
        break;
      case "T":
        if (hasArgs(args, 2)) {
          const reflected: { x: number; y: number } = lastQuadraticControl
            ? { x: 2 * cx - lastQuadraticControl.x, y: 2 * cy - lastQuadraticControl.y }
            : { x: cx, y: cy };
          len += approximateQuadraticLength(cx, cy, reflected.x, reflected.y, args[0]!, args[1]!);
          lastCubicControl = null;
          lastQuadraticControl = reflected;
          cx = args[0]!;
          cy = args[1]!;
        }
        break;
      case "t":
        if (hasArgs(args, 2)) {
          const reflected: { x: number; y: number } = lastQuadraticControl
            ? { x: 2 * cx - lastQuadraticControl.x, y: 2 * cy - lastQuadraticControl.y }
            : { x: cx, y: cy };
          const x = cx + args[0]!;
          const y = cy + args[1]!;
          len += approximateQuadraticLength(cx, cy, reflected.x, reflected.y, x, y);
          lastCubicControl = null;
          lastQuadraticControl = reflected;
          cx = x;
          cy = y;
        }
        break;
      case "A":
      case "a": {
        if (!hasArgs(args, 7)) break;
        const relative = cmd === "a";
        const [rxArg, ryArg, xAxisRotation, largeArcFlag, sweepFlag, dxArg, dyArg] = args as [number, number, number, number, number, number, number];
        const x = relative ? cx + dxArg : dxArg;
        const y = relative ? cy + dyArg : dyArg;
        len += approximateArcLength(cx, cy, rxArg, ryArg, xAxisRotation, !!largeArcFlag, !!sweepFlag, x, y);
        cx = x;
        cy = y;
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "Z":
      case "z":
        len += distance(cx, cy, sx, sy);
        cx = sx;
        cy = sy;
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
    }
  }

  return len;
}

function hasArgs(args: number[], count: number): boolean {
  return args.length >= count && args.slice(0, count).every(Number.isFinite);
}

function approximateCubicLength(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): number {
  let len = 0;
  let px = x0;
  let py = y0;
  for (let index = 1; index <= 24; index += 1) {
    const t = index / 24;
    const x = cubicAt(x0, x1, x2, x3, t);
    const y = cubicAt(y0, y1, y2, y3, t);
    len += distance(px, py, x, y);
    px = x;
    py = y;
  }
  return len;
}

function approximateQuadraticLength(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  let len = 0;
  let px = x0;
  let py = y0;
  for (let index = 1; index <= 16; index += 1) {
    const t = index / 16;
    const x = quadraticAt(x0, x1, x2, t);
    const y = quadraticAt(y0, y1, y2, t);
    len += distance(px, py, x, y);
    px = x;
    py = y;
  }
  return len;
}

function approximateArcLength(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): number {
  if (rx === 0 || ry === 0) {
    return distance(x1, y1, x2, y2);
  }

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
  sq = Math.sqrt(sq) * (largeArc === sweep ? -1 : 1);

  const cxp = (sq * rx * y1p) / ry;
  const cyp = (-sq * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

  if (!sweep && dTheta > 0) {
    dTheta -= Math.PI * 2;
  } else if (sweep && dTheta < 0) {
    dTheta += Math.PI * 2;
  }

  let len = 0;
  let px = x1;
  let py = y1;
  const segments = Math.max(8, Math.ceil(Math.abs(dTheta) / (Math.PI / 16)));
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = theta1 + dTheta * t;
    const x = cx + cosPhi * rx * Math.cos(angle) - sinPhi * ry * Math.sin(angle);
    const y = cy + sinPhi * rx * Math.cos(angle) + cosPhi * ry * Math.sin(angle);
    len += distance(px, py, x, y);
    px = x;
    py = y;
  }
  return len;
}

function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

function quadraticAt(a: number, b: number, c: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * a + 2 * mt * t * b + t * t * c;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function traceSvgPath(ctx: CanvasCtx, d: string): void {
  ctx.beginPath();
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicControl: { x: number; y: number } | null = null;
  let lastQuadraticControl: { x: number; y: number } | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const args = (match[2] ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);

    switch (cmd) {
      case "M":
        cx = args[0]!; cy = args[1]!; sx = cx; sy = cy; ctx.moveTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "m":
        cx += args[0]!; cy += args[1]!; sx = cx; sy = cy; ctx.moveTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "L":
        cx = args[0]!; cy = args[1]!; ctx.lineTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "l":
        cx += args[0]!; cy += args[1]!; ctx.lineTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "H":
        cx = args[0]!; ctx.lineTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "h":
        cx += args[0]!; ctx.lineTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "V":
        cy = args[0]!; ctx.lineTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "v":
        cy += args[0]!; ctx.lineTo(cx, cy);
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "C":
        ctx.bezierCurveTo(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!);
        lastCubicControl = { x: args[2]!, y: args[3]! };
        lastQuadraticControl = null;
        cx = args[4]!; cy = args[5]!;
        break;
      case "c":
        {
          const x2 = cx + args[2]!;
          const y2 = cy + args[3]!;
          const x = cx + args[4]!;
          const y = cy + args[5]!;
          ctx.bezierCurveTo(cx + args[0]!, cy + args[1]!, x2, y2, x, y);
          lastCubicControl = { x: x2, y: y2 };
          lastQuadraticControl = null;
          cx = x; cy = y;
        }
        break;
      case "S":
        {
          const reflected = lastCubicControl
            ? { x: 2 * cx - lastCubicControl.x, y: 2 * cy - lastCubicControl.y }
            : { x: cx, y: cy };
          ctx.bezierCurveTo(reflected.x, reflected.y, args[0]!, args[1]!, args[2]!, args[3]!);
          lastCubicControl = { x: args[0]!, y: args[1]! };
          lastQuadraticControl = null;
          cx = args[2]!; cy = args[3]!;
        }
        break;
      case "s":
        {
          const reflected = lastCubicControl
            ? { x: 2 * cx - lastCubicControl.x, y: 2 * cy - lastCubicControl.y }
            : { x: cx, y: cy };
          const x2 = cx + args[0]!;
          const y2 = cy + args[1]!;
          const x = cx + args[2]!;
          const y = cy + args[3]!;
          ctx.bezierCurveTo(reflected.x, reflected.y, x2, y2, x, y);
          lastCubicControl = { x: x2, y: y2 };
          lastQuadraticControl = null;
          cx = x; cy = y;
        }
        break;
      case "Q":
        ctx.quadraticCurveTo(args[0]!, args[1]!, args[2]!, args[3]!);
        lastCubicControl = null;
        lastQuadraticControl = { x: args[0]!, y: args[1]! };
        cx = args[2]!; cy = args[3]!;
        break;
      case "q":
        {
          const x1 = cx + args[0]!;
          const y1 = cy + args[1]!;
          const x = cx + args[2]!;
          const y = cy + args[3]!;
          ctx.quadraticCurveTo(x1, y1, x, y);
          lastCubicControl = null;
          lastQuadraticControl = { x: x1, y: y1 };
          cx = x; cy = y;
        }
        break;
      case "T":
        {
          const reflected: { x: number; y: number } = lastQuadraticControl
            ? { x: 2 * cx - lastQuadraticControl.x, y: 2 * cy - lastQuadraticControl.y }
            : { x: cx, y: cy };
          ctx.quadraticCurveTo(reflected.x, reflected.y, args[0]!, args[1]!);
          lastCubicControl = null;
          lastQuadraticControl = reflected;
          cx = args[0]!; cy = args[1]!;
        }
        break;
      case "t":
        {
          const reflected: { x: number; y: number } = lastQuadraticControl
            ? { x: 2 * cx - lastQuadraticControl.x, y: 2 * cy - lastQuadraticControl.y }
            : { x: cx, y: cy };
          const x = cx + args[0]!;
          const y = cy + args[1]!;
          ctx.quadraticCurveTo(reflected.x, reflected.y, x, y);
          lastCubicControl = null;
          lastQuadraticControl = reflected;
          cx = x; cy = y;
        }
        break;
      case "A":
        if (hasArgs(args, 7)) {
          const [rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x, y] = args as [number, number, number, number, number, number, number];
          drawSvgArc(ctx, cx, cy, rx, ry, xAxisRotation, !!largeArcFlag, !!sweepFlag, x, y);
          cx = x; cy = y;
        }
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "a":
        if (hasArgs(args, 7)) {
          const [rx, ry, xAxisRotation, largeArcFlag, sweepFlag, dx, dy] = args as [number, number, number, number, number, number, number];
          const x = cx + dx;
          const y = cy + dy;
          drawSvgArc(ctx, cx, cy, rx, ry, xAxisRotation, !!largeArcFlag, !!sweepFlag, x, y);
          cx = x; cy = y;
        }
        lastCubicControl = null; lastQuadraticControl = null;
        break;
      case "Z": case "z":
        ctx.closePath();
        cx = sx; cy = sy;
        lastCubicControl = null; lastQuadraticControl = null;
        break;
    }
  }
}

function drawSvgArc(
  ctx: CanvasCtx,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): void {
  if (rx === 0 || ry === 0) {
    ctx.lineTo(x2, y2);
    return;
  }

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
  sq = Math.sqrt(sq) * (largeArc === sweep ? -1 : 1);

  const cxp = (sq * rx * y1p) / ry;
  const cyp = (-sq * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

  if (!sweep && dTheta > 0) {
    dTheta -= Math.PI * 2;
  } else if (sweep && dTheta < 0) {
    dTheta += Math.PI * 2;
  }

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);

  let angle = theta1;

  for (let i = 0; i < segments; i++) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const nextAngle = angle + delta;
    const cosNA = Math.cos(nextAngle);
    const sinNA = Math.sin(nextAngle);

    const ep1x = cosA - t * sinA;
    const ep1y = sinA + t * cosA;
    const ep2x = cosNA + t * sinNA;
    const ep2y = sinNA - t * cosNA;
    const epx = cosNA;
    const epy = sinNA;

    const cp1x = cx + cosPhi * rx * ep1x - sinPhi * ry * ep1y;
    const cp1y = cy + sinPhi * rx * ep1x + cosPhi * ry * ep1y;
    const cp2x = cx + cosPhi * rx * ep2x - sinPhi * ry * ep2y;
    const cp2y = cy + sinPhi * rx * ep2x + cosPhi * ry * ep2y;
    const px = cx + cosPhi * rx * epx - sinPhi * ry * epy;
    const py = cy + sinPhi * rx * epx + cosPhi * ry * epy;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, px, py);
    angle = nextAngle;
  }
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
  return sign * Math.acos(Math.max(-1, Math.min(1, dot / len)));
}

function drawCameraDebug(
  ctx: CanvasCtx,
  frame: FrameState,
  scaleX: number,
  scaleY: number
): void {
  const cam = frame.elements.find((el) => el.id === "__camera");
  if (!cam) return;

  // Camera props are inverted — negate/reciprocal to get real camera position
  const camX = -(typeof cam.props.x === "number" ? cam.props.x : 0);
  const camY = -(typeof cam.props.y === "number" ? cam.props.y : 0);
  const camScale = typeof cam.props.scale === "number" ? 1 / cam.props.scale : 1;
  const camRotation = -(typeof cam.props.rotation === "number" ? cam.props.rotation : 0);

  // Viewport size in world space (zoomed out = larger viewport)
  const viewW = frame.canvas.width / camScale;
  const viewH = frame.canvas.height / camScale;

  // Viewport center is at camera position, default camera looks at canvas center
  const centerX = frame.canvas.width / 2 + camX;
  const centerY = frame.canvas.height / 2 + camY;

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(0, 255, 255, 0.9)";
  ctx.lineWidth = 2;

  const cx = centerX * scaleX;
  const cy = centerY * scaleY;
  const dw = viewW * scaleX;
  const dh = viewH * scaleY;

  ctx.translate(cx, cy);
  if (camRotation !== 0) {
    ctx.rotate(camRotation);
  }
  ctx.strokeRect(-dw / 2, -dh / 2, dw, dh);

  // Crosshair at center
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();

  ctx.restore();

  // Label
  ctx.save();
  ctx.fillStyle = "rgba(0, 255, 255, 0.9)";
  const fontSize = Math.max(12, 14 * Math.min(scaleX, scaleY));
  ctx.font = `bold ${fontSize}px sans-serif`;
  const labelX = (centerX - viewW / 2) * scaleX + 6;
  const labelY = (centerY - viewH / 2) * scaleY - 6;
  ctx.fillText("camera", labelX, labelY);
  ctx.restore();
}
