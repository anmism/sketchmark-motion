import type { SceneIR } from "../../schema/src";

export type ExportSizePreset = "720p" | "1080p" | "4k";
export type ExportCodec = "h264" | "h265";

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  codec: ExportCodec;
  durationMs?: number;
  bitrate?: string;
}

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  tMs: number;
}

export interface ExportSettingsInput {
  size?: ExportSizePreset | { width: number; height: number };
  fps?: number;
  codec?: ExportCodec;
  durationMs?: number;
  bitrate?: string;
}

const sizePresets: Record<ExportSizePreset, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 }
};

export function normalizeExportSettings(scene: SceneIR, input: ExportSettingsInput = {}): ExportSettings {
  const size = input.size === undefined ? { width: scene.canvas.width, height: scene.canvas.height } : resolveSize(input.size);
  return {
    width: size.width,
    height: size.height,
    fps: input.fps ?? scene.canvas.fps,
    codec: input.codec ?? "h264",
    durationMs: input.durationMs ?? scene.duration,
    bitrate: input.bitrate
  };
}

function resolveSize(size: ExportSettingsInput["size"]): { width: number; height: number } {
  if (size === undefined) {
    throw new Error("Cannot resolve undefined export size");
  }

  if (typeof size === "string") {
    return sizePresets[size];
  }

  if (!Number.isInteger(size.width) || size.width <= 0 || !Number.isInteger(size.height) || size.height <= 0) {
    throw new Error("Export size must use positive integer width and height");
  }

  return size;
}

