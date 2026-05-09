import assert from "node:assert/strict";
import test from "node:test";
import { renderFrameToRgba } from "../../packages/exporter/src";
import { compileMotionMark } from "../../packages/parser/src";

test("compiles composition mode onto element IR", () => {
  const scene = compileMotionMark(`rect r1 w:1 h:1 fill:#fff
  x: 0
  y: 0
  comp: multiply
`);

  assert.equal(scene.elements[0]?.comp, "multiply");
  assert.equal(scene.elements[0]?.static.comp, undefined);
});

test("renders multiply blend mode in raw frame exporter", () => {
  const scene = compileMotionMark(
    `rect r1 w:1 h:1 fill:#ff0000 anchor:top-left
  x: 0
  y: 0
  comp: multiply
`,
    { canvas: { width: 1, height: 1, bg: "#808080", fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  assert.deepEqual(Array.from(frame.data), [128, 0, 0, 255]);
});

test("applies rectangular masks to rendered elements", () => {
  const scene = compileMotionMark(
    `rect r1 w:3 h:1 fill:#ffffff anchor:top-left
  x: 0
  y: 0
  mask: rect(1, 0, 1, 1)
`,
    { canvas: { width: 3, height: 1, bg: "#000000", fps: 1 } }
  );

  assert.deepEqual(scene.elements[0]?.mask, { type: "rect", x: 1, y: 0, w: 1, h: 1, invert: undefined });

  const frame = renderFrameToRgba(scene, 0);
  assert.deepEqual(Array.from(frame.data), [
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255
  ]);
});

test("supports inverted rectangular masks", () => {
  const scene = compileMotionMark(
    `rect r1 w:3 h:1 fill:#ffffff anchor:top-left
  x: 0
  y: 0
  mask: rect(1, 0, 1, 1) invert
`,
    { canvas: { width: 3, height: 1, bg: "#000000", fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  assert.deepEqual(Array.from(frame.data), [
    255, 255, 255, 255,
    0, 0, 0, 255,
    255, 255, 255, 255
  ]);
});

