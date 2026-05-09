import assert from "node:assert/strict";
import test from "node:test";
import { compileMotionMark } from "../../packages/parser/src";
import {
  getFrameCount,
  getFrameTimestampMs,
  normalizeExportSettings,
  renderFrameToRgba,
  renderRawFrameSequence
} from "../../packages/exporter/src";

test("normalizes export settings from scene defaults and presets", () => {
  const scene = compileMotionMark("rect r1 w:1 h:1 fill:#fff", {
    canvas: { width: 320, height: 180, fps: 24 }
  });

  assert.deepEqual(normalizeExportSettings(scene, { size: "720p", fps: 30 }), {
    width: 1280,
    height: 720,
    fps: 30,
    codec: "h264",
    durationMs: 0,
    bitrate: undefined
  });
});

test("calculates deterministic frame counts and timestamps", () => {
  assert.equal(getFrameCount({ durationMs: 2000, fps: 30 }), 60);
  assert.equal(getFrameTimestampMs(30, 30), 1000);
});

test("renders a headless raw RGBA frame for rect commands", () => {
  const scene = compileMotionMark(
    `rect r1 w:2 h:2 fill:#ff0000 anchor:top-left
  x: 1
  y: 1
`,
    { canvas: { width: 4, height: 4, bg: "#000000", fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  assert.equal(frame.width, 4);
  assert.equal(frame.height, 4);
  assert.equal(frame.data.length, 4 * 4 * 4);

  const redPixelIndex = (1 * 4 + 1) * 4;
  assert.deepEqual(Array.from(frame.data.slice(redPixelIndex, redPixelIndex + 4)), [255, 0, 0, 255]);

  const blackPixelIndex = 0;
  assert.deepEqual(Array.from(frame.data.slice(blackPixelIndex, blackPixelIndex + 4)), [0, 0, 0, 255]);
});

test("applies opacity while rasterizing raw frames", () => {
  const scene = compileMotionMark(
    `rect r1 w:1 h:1 fill:#ff0000 anchor:top-left
  x: 0
  y: 0
  opacity: 0.5
`,
    { canvas: { width: 1, height: 1, bg: "#000000", fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  // 255 * 0.5 = 127.5, which may floor to 127 or round to 128 depending on canvas implementation
  const [r, g, b, a] = Array.from(frame.data);
  assert.ok(r === 127 || r === 128, `expected red channel 127 or 128, got ${r}`);
  assert.deepEqual([g, b, a], [0, 0, 255]);
});

test("renders deterministic raw frame sequences with progress", () => {
  const scene = compileMotionMark("rect r1 w:1 h:1 fill:#fff | 0s - 1s");
  const progress: string[] = [];
  const frames = renderRawFrameSequence(scene, { fps: 2, durationMs: 1000, size: { width: 2, height: 2 } }, {
    onProgress: ({ frame, totalFrames, tMs }) => progress.push(`${frame}/${totalFrames}@${tMs}`)
  });

  assert.equal(frames.length, 2);
  assert.deepEqual(progress, ["1/2@0", "2/2@500"]);
});
