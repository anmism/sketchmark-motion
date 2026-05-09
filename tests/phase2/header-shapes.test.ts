import assert from "node:assert/strict";
import test from "node:test";
import { renderFrameToRgba } from "../../packages/exporter/src";
import { resolveFrame } from "../../packages/engine/src";
import { compileMotionMark, parseMotionMark } from "../../packages/parser/src";
import { renderStaticFrameToCommands } from "../../packages/renderer/src";

test("parses header canvas values and variables", () => {
  const ast = parseMotionMark(`---
canvas: 320x180
bg: #101820
fps: 24
$accent: #e74c5c
$speed: 20
---

rect r1 w:10 h:10 fill:$accent
  x: f(t) = $speed * t
`);

  assert.deepEqual(ast.header.canvas, { width: 320, height: 180 });
  assert.equal(ast.header.bg, "#101820");
  assert.equal(ast.header.fps, 24);
  assert.equal(ast.header.variables.accent, "#e74c5c");
});

test("compiles header values and resolves variables", () => {
  const scene = compileMotionMark(`---
canvas: 320x180
bg: #101820
fps: 24
$accent: #e74c5c
$speed: 20
---

rect r1 w:10 h:10 fill:$accent | 0s - 2s
  x: f(t) = $speed * t
`);

  assert.deepEqual(scene.canvas, { width: 320, height: 180, bg: "#101820", fps: 24 });
  assert.equal(scene.elements[0]?.static.fill, "#e74c5c");
  assert.equal(resolveFrame(scene, 1000).elements[0]?.props.x, 20);
});

test("parses and compiles circle, line, and text elements", () => {
  const scene = compileMotionMark(`circle c1 r:5 fill:#ff0000
  x: 10
  y: 10

line l1 from:(0,0) to:(10,0) stroke:#00ff00 strokeWidth:2

text t1 "Hi" font:Roboto size:10 fill:#0000ff
  x: 0
  y: 20
`);

  assert.equal(scene.elements[0]?.type, "circle");
  assert.equal(scene.elements[1]?.type, "line");
  assert.deepEqual(scene.elements[1]?.static.from, [0, 0]);
  assert.equal(scene.elements[2]?.type, "text");
  assert.equal(scene.elements[2]?.static.content, "Hi");
});

test("renderer emits commands for circle, line, and text", () => {
  const scene = compileMotionMark(`circle c1 r:5 fill:#ff0000
  x: 10
  y: 10

line l1 from:(0,0) to:(10,0) stroke:#00ff00 strokeWidth:2

text t1 "Hi" font:Roboto size:10 fill:#0000ff
  x: 0
  y: 20
`);
  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.equal(commands[1]?.op, "circle");
  assert.equal(commands[2]?.op, "line");
  assert.equal(commands[3]?.op, "text");
});

test("parses images and transform properties", () => {
  const scene = compileMotionMark(`image logo "logo.png" x:10 y:20 w:40 h:30 rotation:45deg scale:2`);
  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  const image = commands[1];
  assert.equal(image?.op, "image");
  if (image?.op !== "image") return;
  assert.equal(image.src, "logo.png");
  assert.equal(image.width, 40);
  assert.equal(image.height, 30);
  assert.equal(image.scale, 2);
  assert.equal(Math.round(image.rotation * 1000), Math.round((Math.PI / 4) * 1000));
});

test("@system constrains palette, fonts, durations, and easing", () => {
  const valid = compileMotionMark(`@system
  palette: #101820, #e74c5c, #fff
  fonts: Inter 16/24/32
  durations: 1s
  easing: ease-out

text label "Hi" font:Inter size:16 fill:#fff

rect box w:20 h:20 fill:#e74c5c
  opacity: 0 -> 1 over 1s ease-out
`);
  assert.equal(valid.elements.length, 2);

  assert.throws(
    () =>
      compileMotionMark(`@system
  palette: #101820, #fff

rect box w:20 h:20 fill:#e74c5c
`),
    /@system palette/
  );
});

test("raw renderer paints circle and line pixels", () => {
  const scene = compileMotionMark(
    `circle c1 r:2 fill:#ff0000
  x: 2
  y: 2

line l1 from:(0,4) to:(4,4) stroke:#00ff00 strokeWidth:1
`,
    { canvas: { width: 5, height: 5, bg: "#000000", fps: 1 } }
  );
  const frame = renderFrameToRgba(scene, 0);
  const circlePixel = (2 * 5 + 2) * 4;
  const linePixel = (4 * 5 + 2) * 4;

  assert.deepEqual(Array.from(frame.data.slice(circlePixel, circlePixel + 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(frame.data.slice(linePixel, linePixel + 4)), [0, 255, 0, 255]);
});

test("parses and renders linear gradient fills", () => {
  const scene = compileMotionMark(
    `---
$left: #ff0000
$right: #0000ff
---

rect strip w:10 h:2 | 0s - 1s
  x: 0
  y: 0
  anchor: top-left
  fill: linear(0, 0, 10, 0, $left, 0, $right, 1)
`,
    { canvas: { width: 10, height: 2, bg: "#000000", fps: 1 } }
  );

  assert.equal(scene.elements[0]?.static.fill, "linear(0,0,10,0,#ff0000,0,#0000ff,1)");

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  const rect = commands[1];
  assert.ok(rect?.op === "rect");
  if (rect?.op !== "rect") return;
  assert.equal(rect.fill, "linear(0,0,10,0,#ff0000,0,#0000ff,1)");

  const frame = renderFrameToRgba(scene, 0);
  const leftPixel = 4;
  const rightPixel = (8 * 4);
  assert.ok(frame.data[leftPixel] > frame.data[leftPixel + 2]);
  assert.ok(frame.data[rightPixel + 2] > frame.data[rightPixel]);
});

test("supports gradient as a fill and stroke alias", () => {
  const scene = compileMotionMark(`rect panel w:10 h:2 gradient:linear(0,0,10,0,#ff0000,0,#0000ff,1)
line rule from:(0,0) to:(10,0) strokeWidth:1 gradient:linear(0,0,10,0,#ff0000,0,#0000ff,1)
`);
  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  const rect = commands[1];
  const line = commands[2];
  assert.ok(rect?.op === "rect");
  assert.ok(line?.op === "line");
  if (rect?.op === "rect") assert.equal(rect.fill, "linear(0,0,10,0,#ff0000,0,#0000ff,1)");
  if (line?.op === "line") assert.equal(line.stroke, "linear(0,0,10,0,#ff0000,0,#0000ff,1)");
});

test("inline gradient fill does not consume following properties", () => {
  const scene = compileMotionMark(`@group card
  x: 10
  y: 10

rect bg w:10 h:10 fill:linear(0,-5,0,5,#ff0000,0,#0000ff,1) cornerRadius:2 parent:card
  x: 0
  y: 0
`);
  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  const rect = commands.find((command) => command.op === "rect" && command.id === "bg");
  assert.ok(rect?.op === "rect");
  if (rect?.op !== "rect") return;
  assert.equal(rect.x, 10);
  assert.equal(rect.y, 10);
  assert.equal(rect.cornerRadius, 2);
  assert.equal(rect.fill, "linear(0,-5,0,5,#ff0000,0,#0000ff,1)");
});

test("rect gradient coordinates are relative to grouped element position", () => {
  const scene = compileMotionMark(
    `@group card
  x: 10
  y: 10

rect bg w:10 h:10 fill:linear(0,-5,0,5,#ff0000,0,#0000ff,1) parent:card
  x: 0
  y: 0
`,
    { canvas: { width: 20, height: 20, bg: "#000000", fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  const topPixel = (6 * 20 + 10) * 4;
  const bottomPixel = (14 * 20 + 10) * 4;
  assert.ok(frame.data[topPixel] > frame.data[topPixel + 2]);
  assert.ok(frame.data[bottomPixel + 2] > frame.data[bottomPixel]);
});

test("renders gradients with hidden whitespace in coordinate tokens", () => {
  const scene = compileMotionMark(`rect strip w:10 h:2 | 0s - 1s
  x: 0
  y: 0
  anchor: top-left
  fill: "linear(110\u200B,90,530,90,#ff0000,0,#0000ff,1)"
`, { canvas: { width: 10, height: 2, bg: "#000000", fps: 1 } });

  assert.doesNotThrow(() => renderFrameToRgba(scene, 0));
});
