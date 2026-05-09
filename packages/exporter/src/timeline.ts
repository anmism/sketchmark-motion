import type { ExportSettings } from "./settings";

export function getFrameCount(settings: Pick<ExportSettings, "durationMs" | "fps">): number {
  const durationMs = settings.durationMs ?? 0;
  if (durationMs <= 0) return 1;
  return Math.max(1, Math.ceil((durationMs / 1000) * settings.fps));
}

export function getFrameTimestampMs(frameIndex: number, fps: number): number {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error("Frame index must be a non-negative integer");
  }
  return Math.round((frameIndex / fps) * 1000);
}

export function getFrameTimestampsMs(settings: Pick<ExportSettings, "durationMs" | "fps">): number[] {
  const total = getFrameCount(settings);
  return Array.from({ length: total }, (_, frame) => getFrameTimestampMs(frame, settings.fps));
}

