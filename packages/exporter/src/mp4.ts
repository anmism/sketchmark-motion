import type { AudioTrackIR, SceneIR } from "../../schema/src";
import { renderFrameToRgba, preloadImages } from "./rawFrame";
import { resolveAssetPath } from "./assets";
import { normalizeExportSettings, type ExportSettingsInput, type ExportProgress } from "./settings";
import { getFrameCount, getFrameTimestampMs } from "./timeline";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

export interface ExportMp4Options extends ExportSettingsInput {
  onProgress?: (progress: ExportProgress) => void;
  basePath?: string;
  encoder?: "ffmpeg" | "wasm" | "auto";
}

export async function exportToMp4(
  scene: SceneIR,
  outputPath: string,
  options: ExportMp4Options = {}
): Promise<void> {
  const settings = normalizeExportSettings(scene, options);

  // Preload images
  const basePath = options.basePath || path.dirname(path.resolve(outputPath));
  await preloadImages(scene, basePath);

  const encoderChoice = options.encoder || "auto";

  if (encoderChoice === "ffmpeg" || encoderChoice === "auto") {
    const ffmpegAvailable = await checkFfmpeg();
    if (ffmpegAvailable) {
      return exportWithFfmpeg(scene, outputPath, settings, basePath, options.onProgress);
    }
    if (encoderChoice === "ffmpeg") {
      throw new Error("ffmpeg not found in PATH. Install ffmpeg or use encoder: 'wasm'");
    }
  }

  // Fall back to WASM encoder
  return exportWithWasm(scene, outputPath, settings, options.onProgress);
}

async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

async function resolveAudioTracks(scene: SceneIR, basePath: string): Promise<{ track: AudioTrackIR; resolvedPath: string }[]> {
  if (!scene.audioTracks || scene.audioTracks.length === 0) return [];
  const results: { track: AudioTrackIR; resolvedPath: string }[] = [];
  for (const track of scene.audioTracks) {
    const resolved = await resolveAssetPath(track.src, basePath, "audio");
    if (resolved) {
      results.push({ track, resolvedPath: resolved });
    }
  }
  return results;
}

function buildAudioFilterComplex(
  audioTracks: { track: AudioTrackIR; resolvedPath: string }[]
): { args: string[]; mapArgs: string[] } {
  if (audioTracks.length === 0) return { args: [], mapArgs: ["-map", "0:v"] };

  const inputArgs: string[] = [];
  const filters: string[] = [];

  for (let i = 0; i < audioTracks.length; i++) {
    const { track, resolvedPath } = audioTracks[i];
    const inputIdx = i + 1; // input 0 is the raw video pipe
    inputArgs.push("-i", resolvedPath);

    const filterParts: string[] = [];
    const startSec = track.lifetime.start / 1000;
    const endSec = track.lifetime.end / 1000;
    const durSec = endSec - startSec;

    // Trim audio to the needed duration
    if (track.trim > 0) {
      filterParts.push(`atrim=start=${track.trim / 1000}:duration=${durSec}`);
    } else {
      filterParts.push(`atrim=0:duration=${durSec}`);
    }
    filterParts.push("asetpts=PTS-STARTPTS");

    // Volume
    const vol = typeof track.volume === "number" ? track.volume : 1;
    if (vol !== 1) {
      filterParts.push(`volume=${vol}`);
    }

    // Fade in
    if (track.fadeIn > 0) {
      filterParts.push(`afade=t=in:st=0:d=${track.fadeIn / 1000}`);
    }

    // Fade out
    if (track.fadeOut > 0) {
      const fadeOutStart = durSec - track.fadeOut / 1000;
      if (fadeOutStart > 0) {
        filterParts.push(`afade=t=out:st=${fadeOutStart}:d=${track.fadeOut / 1000}`);
      }
    }

    // Delay to position in timeline
    if (startSec > 0) {
      const delayMs = Math.round(startSec * 1000);
      filterParts.push(`adelay=${delayMs}|${delayMs}`);
    }

    filters.push(`[${inputIdx}:a]${filterParts.join(",")}[a${i}]`);
  }

  // Mix all audio tracks together
  const mixInputs = audioTracks.map((_, i) => `[a${i}]`).join("");
  filters.push(`${mixInputs}amix=inputs=${audioTracks.length}:duration=longest:normalize=0[aout]`);

  const filterComplex = filters.join(";");
  const args = [...inputArgs, "-filter_complex", filterComplex];
  const mapArgs = ["-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k"];

  return { args, mapArgs };
}

async function exportWithFfmpeg(
  scene: SceneIR,
  outputPath: string,
  settings: { width: number; height: number; fps: number; durationMs?: number },
  basePath: string,
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  const { width, height, fps } = settings;
  const totalFrames = getFrameCount(settings);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const audioTracks = await resolveAudioTracks(scene, basePath);
  const { args: audioArgs, mapArgs } = buildAudioFilterComplex(audioTracks);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      "-y",
      "-f", "rawvideo",
      "-pixel_format", "rgba",
      "-video_size", `${width}x${height}`,
      "-framerate", String(fps),
      "-i", "pipe:0",
      ...audioArgs,
      ...mapArgs,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "medium",
      "-crf", "18",
      "-movflags", "+faststart",
      "-shortest",
      outputPath
    ];

    const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "ignore", "pipe"]
    });

    let stderrData = "";
    ffmpeg.stderr?.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`ffmpeg error: ${err.message}`));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderrData}`));
      }
    });

    // Render and pipe frames
    (async () => {
      try {
        for (let frame = 0; frame < totalFrames; frame++) {
          const tMs = getFrameTimestampMs(frame, fps);
          if (onProgress) onProgress({ frame: frame + 1, totalFrames, tMs });

          const raw = renderFrameToRgba(scene, tMs, settings);
          const written = ffmpeg.stdin?.write(Buffer.from(raw.data));

          // Handle backpressure
          if (!written) {
            await new Promise<void>((r) => ffmpeg.stdin?.once("drain", r));
          }
        }
        ffmpeg.stdin?.end();
      } catch (err) {
        ffmpeg.kill();
        reject(err);
      }
    })();
  });
}

async function exportWithWasm(
  scene: SceneIR,
  outputPath: string,
  settings: { width: number; height: number; fps: number; durationMs?: number },
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  const { width, height, fps } = settings;
  const totalFrames = getFrameCount(settings);

  let HME: any;
  try {
    HME = require("h264-mp4-encoder");
  } catch {
    throw new Error(
      "No encoder available.\nEither install ffmpeg, or: npm install h264-mp4-encoder"
    );
  }

  const encoder = await HME.createH264MP4Encoder();
  encoder.width = width;
  encoder.height = height;
  encoder.frameRate = fps;
  encoder.quantizationParameter = 18;
  encoder.initialize();

  for (let frame = 0; frame < totalFrames; frame++) {
    const tMs = getFrameTimestampMs(frame, fps);
    if (onProgress) onProgress({ frame: frame + 1, totalFrames, tMs });

    const raw = renderFrameToRgba(scene, tMs, settings);
    encoder.addFrameRgba(raw.data);
  }

  encoder.finalize();

  const mp4Data = encoder.FS.readFile(encoder.outputFilename);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, mp4Data);

  encoder.delete();
}
