import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame } from "../../packages/engine/src";
import { renderFrameToRgba } from "../../packages/exporter/src";
import { compileMotionMark } from "../../packages/parser/src";
import { renderStaticFrameToCommands } from "../../packages/renderer/src";

test("compiles stroke controls and filter primitives into render commands", () => {
  const scene = compileMotionMark(`---
$glow: #f39c12
---

path snake d:"M 0 0 C 25 40, 75 -40, 100 0" stroke:#ffffff strokeWidth:2 | 0s - 1s
  drawStart: 0 -> 0.5 over 1s
  drawEnd: 0.25 -> 1 over 1s
  dashArray: [10, 5]
  dashOffset: 0 -> 20 over 1s
  blur: 0 -> 4 over 1s
  brightness: 1 -> 1.5 over 1s
  contrast: 1 -> 1.2 over 1s
  saturate: 1 -> 0 over 1s
  hueRotate: 0 -> 180 over 1s
  shadow: 0 0 10 $glow
`);

  const frame = resolveFrame(scene, 500);
  const commands = renderStaticFrameToCommands(frame);
  const path = commands[1];

  assert.equal(path?.op, "path");
  if (path?.op === "path") {
    assert.equal(path.drawStart, 0.25);
    assert.equal(path.drawEnd, 0.625);
    assert.deepEqual(path.dashArray, [10, 5]);
    assert.equal(path.dashOffset, 10);
    assert.deepEqual(path.effects, {
      blur: 2,
      brightness: 1.25,
      contrast: 1.1,
      saturate: 0.5,
      hueRotate: 90,
      shadow: {
        offsetX: 0,
        offsetY: 0,
        blur: 10,
        color: "#f39c12"
      }
    });
  }
});

test("rejects draw shorthand mixed with drawStart or drawEnd", () => {
  assert.throws(
    () => compileMotionMark(`line l1 x1:0 y1:0 x2:100 y2:0 stroke:#fff
  draw: 0 -> 1 over 1s
  drawStart: 0.2
`),
    /draw cannot be combined/
  );
});

test("validates dash arrays", () => {
  assert.throws(
    () => compileMotionMark(`line l1 x1:0 y1:0 x2:100 y2:0 stroke:#fff dashArray:[10, 0]`),
    /dashArray/
  );
});

test("drawStart and drawEnd trim line output in raw frames", () => {
  const scene = compileMotionMark(`line l1 x1:0 y1:1 x2:9 y2:1 stroke:#ffffff strokeWidth:1
  drawStart: 0.5
  drawEnd: 1
`, { canvas: { width: 10, height: 3, bg: "#000000", fps: 1 } });

  const frame = renderFrameToRgba(scene, 0);
  const pixel = (x: number, y: number) => Array.from(frame.data.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));

  assert.deepEqual(pixel(1, 1), [0, 0, 0, 255]);
  assert.ok(pixel(8, 1)[0]! > 100);
});

test("wiggle compiles to a deterministic expression", () => {
  const scene = compileMotionMark(`circle dot r:4 fill:#fff | 0s - 2s
  x: wiggle(2, 10, base:100, seed:7)
  y: wiggle(freq:3, amp:5, base:50, seed:8)
`);

  const first = resolveFrame(scene, 500).elements[0]?.props;
  const second = resolveFrame(scene, 500).elements[0]?.props;
  const later = resolveFrame(scene, 900).elements[0]?.props;

  assert.equal(first?.x, second?.x);
  assert.equal(first?.y, second?.y);
  assert.notEqual(first?.x, later?.x);
  assert.ok(typeof first?.x === "number" && first.x >= 90 && first.x <= 110);
  assert.ok(typeof first?.y === "number" && first.y >= 45 && first.y <= 55);
});

test("spring easing can overshoot and settle", () => {
  const scene = compileMotionMark(`rect card w:10 h:10 fill:#fff | 0s - 1s
  x: 0 -> 100 over 1s spring(stiffness:180, damping:12)
`);

  const mid = resolveFrame(scene, 200).elements[0]?.props.x;
  const end = resolveFrame(scene, 1000).elements[0]?.props.x;

  assert.ok(typeof mid === "number" && mid > 100);
  assert.ok(typeof end === "number" && end > 95 && end < 105);
});

test("motionPath resolves progress to position and auto rotation", () => {
  const scene = compileMotionMark(`circle car r:4 fill:#fff | 0s - 1s
  motionPath: "M 10 20 L 110 20"
  motionProgress: 0 -> 1 over 1s
  motionRotate: auto
`);

  const start = resolveFrame(scene, 0).elements[0]?.props;
  const middle = resolveFrame(scene, 500).elements[0]?.props;
  const end = resolveFrame(scene, 1000).elements[0]?.props;

  assert.equal(start?.x, 10);
  assert.equal(start?.y, 20);
  assert.equal(middle?.x, 60);
  assert.equal(end?.x, 110);
  assert.equal(end?.rotation, 0);
});

test("repeat expands clones with offsets and staggered keyframes", () => {
  const scene = compileMotionMark(`rect petal w:10 h:40 fill:#fff anchor:bottom-center | 0s - 1s
  repeat: 4
  repeatOffset: x:20 rotation:15deg opacity:-0.2 delay:0.1s
  scale: 0 -> 1 over 0.4s ease-out
`);

  assert.deepEqual(scene.elements.map((element) => element.id), [
    "petal",
    "petal__repeat1",
    "petal__repeat2",
    "petal__repeat3"
  ]);
  assert.equal(scene.elements[2]?.static.x, 40);
  assert.equal(scene.elements[2]?.static.opacity, 0.6);
  assert.equal(scene.elements[2]?.animated.scale?.type, "keyframes");
  if (scene.elements[2]?.animated.scale?.type === "keyframes") {
    assert.deepEqual(scene.elements[2].animated.scale.points.map((point) => point.t), [200, 600]);
  }
});
