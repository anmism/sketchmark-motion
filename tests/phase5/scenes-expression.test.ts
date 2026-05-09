import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame } from "../../packages/engine/src";
import { compileNumericExpression } from "../../packages/parser/src";
import { compileMotionMark, parseMotionMark } from "../../packages/parser/src";

test("parses scenes and gives elements scene metadata", () => {
  const ast = parseMotionMark(`= Setup | 0s - 5s =

rect r1 w:10 h:10 fill:#fff
  x: 1
`);
  assert.equal(ast.scenes.length, 1);
  assert.equal(ast.elements[0]?.sceneName, "Setup");
});

test("elements without explicit lifetime inherit scene bounds", () => {
  const scene = compileMotionMark(`= Setup | 0s - 5s =

rect r1 w:10 h:10 fill:#fff
  x: 1
`);
  assert.deepEqual(scene.elements[0]?.lifetime, { start: 0, end: 5000 });
});

test("explicit lifetime crosses scene boundaries", () => {
  const scene = compileMotionMark(`= Setup | 0s - 5s =

rect r1 w:10 h:10 fill:#fff | 2s - 8s
  x: 1
`);
  assert.deepEqual(scene.elements[0]?.lifetime, { start: 2000, end: 8000 });
});

test("persist resolves to the finite document duration", () => {
  const scene = compileMotionMark(`rect grid w:10 h:10 fill:#fff | persist
  x: 0

rect r1 w:10 h:10 fill:#fff | 0s - 3s
  x: 1
`);
  assert.deepEqual(scene.elements[0]?.lifetime, { start: 0, end: 3000 });
});

test("compiles f(t) expression properties and evaluates local element time", () => {
  const scene = compileMotionMark(`rect ball w:40 h:40 fill:#e74c5c | 2s - 4s
  x: f(t) = 200 + 50 * t
  y: f(t) = 800 - 50 * sin(45deg) * t
`);
  const frame = resolveFrame(scene, 3000);
  assert.equal(frame.elements[0]?.props.x, 250);
  assert.ok(Math.abs(Number(frame.elements[0]?.props.y) - 764.6446609406726) < 0.0001);
});

test("numeric expressions support math functions and easing wrappers", () => {
  const expression = compileNumericExpression("max(10, pow(2, 3)) + ease-out(t / 2) * 100");
  assert.equal(expression({ t: 0 }), 10);
  assert.ok(expression({ t: 1 }) > 90);
});

test("expressions can reference other element properties", () => {
  const scene = compileMotionMark(`circle ball r:5 fill:#fff | 0s - 2s
  x: 10 -> 30 over 2s linear
  y: 20

text label "v" fill:#fff
  x: f(t) = ball.x + 30
  y: f(t) = ball.y - 10
`);

  const frame = resolveFrame(scene, 1000);
  const label = frame.elements.find((element) => element.id === "label");
  assert.equal(label?.props.x, 50);
  assert.equal(label?.props.y, 10);
});

test("@group parent transforms compose into children", () => {
  const scene = compileMotionMark(`@group rig | persist
  x: 100
  y: 40
  scale: 2

rect child parent:rig w:10 h:10 fill:#fff
  x: 5
  y: 6
`);

  const frame = resolveFrame(scene, 0);
  const child = frame.elements.find((element) => element.id === "child");
  assert.equal(child?.props.x, 110);
  assert.equal(child?.props.y, 52);
  assert.equal(child?.props.scale, 2);
});

test("use imports can provide @motion and @draw marks", () => {
  const imports: Record<string, string> = {
    "./marks.mmark": `@motion fade(dur=1s)
  opacity: 0 -> 1 over $dur ease-out

@draw pin(color=#fff)
  circle head r:4 fill:$color
`
  };

  const scene = compileMotionMark(
    `use "./marks.mmark"

pin target color:#e74c5c | 0s - 1s

rect box w:10 h:10 fill:#fff | 0s - 1s
  fade(1s)
`,
    { resolveImport: (importPath) => imports[importPath] }
  );

  assert.equal(scene.elements.some((element) => element.id === "target-head"), true);
  assert.equal(scene.elements.find((element) => element.id === "box")?.animated.opacity?.type, "keyframes");
});

test("@camera acts as an inverse root group", () => {
  const scene = compileMotionMark(`@camera
  x: 20
  y: 5

circle dot r:2 fill:#fff
  x: 30
  y: 15
`);

  const frame = resolveFrame(scene, 0);
  const dot = frame.elements.find((element) => element.id === "dot");
  assert.equal(dot?.props.x, 10);
  assert.equal(dot?.props.y, 10);
});
