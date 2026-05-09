import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame } from "../../packages/engine/src";
import { compileMotionMark, parseMotionMark } from "../../packages/parser/src";

const source = `@motion fade-in(dur, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion slide-right(from, to, dur=1s, ease=linear)
  x: $from -> $to over $dur $ease

rect r1 w:200 h:100 fill:#e74c5c | 0s - 3s
  y: 200
  fade-in(0.3s)
  slide-right(from: 100, to: 500, dur: 2s, ease: ease-out)
`;

test("parses @motion definitions and calls", () => {
  const ast = parseMotionMark(source);
  assert.equal(ast.motions.length, 2);
  assert.equal(ast.motions[0]?.name, "fade-in");
  assert.equal(ast.elements[0]?.body.some((item) => item.kind === "motion-call" && item.name === "fade-in"), true);
});

test("expands @motion calls into animated properties", () => {
  const scene = compileMotionMark(source);
  const element = scene.elements[0];
  const opacity = element?.animated.opacity;
  const x = element?.animated.x;

  assert.equal(opacity?.type, "keyframes");
  if (opacity?.type === "keyframes") {
    assert.deepEqual(opacity.points, [
      { t: 0, value: 0, easing: "linear" },
      { t: 300, value: 1, easing: "ease-out" }
    ]);
  }

  assert.equal(x?.type, "keyframes");
  if (x?.type === "keyframes") {
    assert.deepEqual(x.points, [
      { t: 0, value: 100, easing: "linear" },
      { t: 2000, value: 500, easing: "ease-out" }
    ]);
  }
});

test("supports named arguments and default parameter values", () => {
  const scene = compileMotionMark(`@motion slide-right(from, to, dur=1s, ease=linear)
  x: $from -> $to over $dur $ease

rect r1 w:10 h:10 fill:#fff | 0s - 1s
  slide-right(to: 500, from: 100)
`);
  const x = scene.elements[0]?.animated.x;
  assert.equal(x?.type, "keyframes");
  if (x?.type === "keyframes") {
    assert.deepEqual(x.points, [
      { t: 0, value: 100, easing: "linear" },
      { t: 1000, value: 500, easing: "linear" }
    ]);
  }
});

test("resolved frame includes @motion animation values", () => {
  const scene = compileMotionMark(source);
  const frame = resolveFrame(scene, 1000);
  const props = frame.elements[0]?.props;
  assert.ok(typeof props?.x === "number" && props.x > 300 && props.x < 500);
  assert.equal(props?.opacity, 1);
});

test("expands @draw calls into prefixed elements", () => {
  const scene = compileMotionMark(`@draw arrow(from, to, color=#fff, width=2)
  line shaft from:$from to:$to stroke:$color strokeWidth:$width
  circle dot r:4 fill:$color
    x: 10
    y: 0

arrow vector from:(0,0) to:(20,0) color:#e74c5c width:3 | 0s - 1s
`);

  assert.equal(scene.elements.length, 2);
  assert.equal(scene.elements[0]?.id, "vector-shaft");
  assert.equal(scene.elements[0]?.type, "line");
  assert.deepEqual(scene.elements[0]?.static.from, [0, 0]);
  assert.deepEqual(scene.elements[0]?.static.to, [20, 0]);
  assert.equal(scene.elements[0]?.static.stroke, "#e74c5c");
  assert.equal(scene.elements[1]?.id, "vector-dot");
  assert.equal(scene.elements[1]?.lifetime.end, 1000);
});
