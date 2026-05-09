import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame } from "../../packages/engine/src";
import { compileMotionMark, parseMotionMark } from "../../packages/parser/src";
import { renderStaticFrameToCommands } from "../../packages/renderer/src";

const source = `rect r1 w:200 h:100 fill:#e74c5c | 0s - 3s
  x: 100 -> 500 over 2s ease-out
  y: 200
  opacity: 0 -> 1 over 0.5s
`;

test("parses declarative tween animation", () => {
  const ast = parseMotionMark(source);
  const x = ast.elements[0]?.body.find((assignment) => assignment.kind === "property" && assignment.name === "x");
  const value = x?.kind === "property" ? x.value : undefined;
  assert.ok(typeof value === "object" && value !== null && "kind" in value);
  if (typeof value === "object" && value !== null && "kind" in value) {
    assert.equal(value.kind, "tween");
  }
});

test("compiles tween syntax into keyframe IR", () => {
  const scene = compileMotionMark(source);
  const x = scene.elements[0]?.animated.x;
  assert.equal(x?.type, "keyframes");
  if (x?.type === "keyframes") {
    assert.deepEqual(x.points, [
      { t: 0, value: 100, easing: "linear" },
      { t: 2000, value: 500, easing: "ease-out" }
    ]);
  }
});

test("resolves animated values at a scrubbed time", () => {
  const scene = compileMotionMark(source);
  const frame = resolveFrame(scene, 1000);
  const props = frame.elements[0]?.props;
  assert.equal(props?.y, 200);
  assert.ok(typeof props?.x === "number" && props.x > 300 && props.x < 500);
  assert.equal(props?.opacity, 1);
});

test("filters elements outside their lifetime", () => {
  const scene = compileMotionMark(source);
  assert.equal(resolveFrame(scene, 3500).elements.length, 0);
});

test("render commands receive evaluated animated values", () => {
  const scene = compileMotionMark(source, { canvas: { bg: "#0f0f1a" } });
  const commands = renderStaticFrameToCommands(resolveFrame(scene, 1000));
  const rect = commands[1];
  assert.ok(rect?.op === "rect");
  if (rect?.op === "rect") {
    assert.ok(rect.x > 300 && rect.x < 500);
    assert.equal(rect.opacity, 1);
  }
});

test("parses multi-step keyframe animation syntax", () => {
  const scene = compileMotionMark(`rect r1 w:10 h:10 fill:#fff | 0s - 2s
  y: 800 at 0s, 400 at 1s ease-out, 800 at 2s
`);
  const y = scene.elements[0]?.animated.y;
  assert.equal(y?.type, "keyframes");
  if (y?.type === "keyframes") {
    assert.deepEqual(y.points, [
      { t: 0, value: 800, easing: "linear" },
      { t: 1000, value: 400, easing: "ease-out" },
      { t: 2000, value: 800, easing: "linear" }
    ]);
  }
});

test("compiles color tween animations with header variables", () => {
  const scene = compileMotionMark(`---
$hot: #e74c5c
$cool: #4ecdc4
---

rect r1 w:10 h:10 | 0s - 1s
  fill: $hot -> $cool over 1s ease-in-out
line l1 from:(0,0) to:(10,0) strokeWidth:2 | 0s - 1s
  stroke: $cool -> $hot over 1s
`);

  assert.equal(scene.elements[0]?.animated.fill?.type, "color-keyframes");
  assert.equal(scene.elements[1]?.animated.stroke?.type, "color-keyframes");

  const startFrame = resolveFrame(scene, 0);
  assert.equal(startFrame.elements[0]?.props.fill, "#e74c5c");
  assert.equal(startFrame.elements[1]?.props.stroke, "#4ecdc4");
});

test("compiles color tween animations with motion parameters", () => {
  const scene = compileMotionMark(`@motion colorPulse(from=#e74c5c, to=#4ecdc4)
  fill: $from -> $to over 1s
  stroke: $to -> $from over 1s

rect r1 w:10 h:10 strokeWidth:2 | 0s - 1s
  colorPulse()
`);

  const element = scene.elements[0];
  assert.equal(element?.animated.fill?.type, "color-keyframes");
  assert.equal(element?.animated.stroke?.type, "color-keyframes");

  const endFrame = resolveFrame(scene, 1000);
  assert.equal(endFrame.elements[0]?.props.fill, "#4ecdc4");
  assert.equal(endFrame.elements[0]?.props.stroke, "#e74c5c");
});
