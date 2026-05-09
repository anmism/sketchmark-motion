import type { SceneIR } from "../../schema/src";
import { renderFrameToRgba, type RawFrame } from "./rawFrame";
import { normalizeExportSettings, type ExportProgress, type ExportSettingsInput } from "./settings";
import { getFrameCount, getFrameTimestampMs } from "./timeline";

export interface RenderSequenceOptions {
  onProgress?: (progress: ExportProgress) => void;
}

export function renderRawFrameSequence(
  scene: SceneIR,
  input: ExportSettingsInput = {},
  options: RenderSequenceOptions = {}
): RawFrame[] {
  const settings = normalizeExportSettings(scene, input);
  const totalFrames = getFrameCount(settings);
  const frames: RawFrame[] = [];

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const tMs = getFrameTimestampMs(frame, settings.fps);
    options.onProgress?.({ frame: frame + 1, totalFrames, tMs });
    frames.push(renderFrameToRgba(scene, tMs, settings));
  }

  return frames;
}

