import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame, projectPoint, rotate3DInOrder, rotateY, transformVertices } from "../../packages/engine/src";
import { renderFrameToRgba } from "../../packages/exporter/src";
import { compileMotionMark, parseMotionMark } from "../../packages/parser/src";
import { renderStaticFrameToCommands } from "../../packages/renderer/src";

test("parses and compiles 2.5D canvas and element properties", () => {
  const source = `---
canvas: 320x180
bg: #101820
perspective: 800
vanish: 120 80
---

rect card w:40 h:30 fill:#ff0000 zIndex:5 | 0s - 1s
  x: 160
  y: 90
  z: 100
  rotateY: 45
  scaleX: 1.5
`;

  const ast = parseMotionMark(source);
  assert.equal(ast.header.perspective, 800);
  assert.equal(ast.header.vanishX, 120);
  assert.equal(ast.header.vanishY, 80);

  const scene = compileMotionMark(source);
  assert.equal(scene.canvas.perspective, 800);
  assert.equal(scene.canvas.vanishX, 120);
  assert.equal(scene.canvas.vanishY, 80);
  assert.equal(scene.elements[0]?.zIndex, 5);
  assert.equal(scene.elements[0]?.static.z, 100);
  assert.equal(scene.elements[0]?.static.zIndex, undefined);

  const command = renderStaticFrameToCommands(resolveFrame(scene, 0))[1];
  assert.ok(command?.op === "rect");
  if (command?.op !== "rect") return;
  assert.equal(command.z, 100);
  assert.equal(Math.round(command.rotateY * 1000), Math.round((Math.PI / 4) * 1000));
  assert.equal(command.scaleX, 1.5);
});

test("2.5D transform math projects closer points larger", () => {
  const turned = rotateY({ x: 1, y: 0, z: 0 }, Math.PI / 2);
  assert.ok(Math.abs(turned.x) < 1e-10);
  assert.ok(Math.abs(turned.z + 1) < 1e-10);

  const near = projectPoint({ x: 60, y: 50, z: 50 }, { perspective: 100, vanishX: 50, vanishY: 50 });
  const flat = projectPoint({ x: 60, y: 50, z: 0 }, { perspective: 100, vanishX: 50, vanishY: 50 });
  assert.ok(near.scale > flat.scale);
  assert.ok(near.x > flat.x);
});

test("origin aliases compile to canonical transform origins", () => {
  const scene = compileMotionMark(`path face fill:#ff0000
  d: "M-50,50 L50,50 L0,-50 Z"
  origin: bottom
`);

  assert.equal(scene.elements[0]?.origin, "bottom-center");
});

test("2.5D origin pivots transforms around shape anchors", () => {
  const [pivot, tip] = transformVertices(
    [
      { x: 0, y: 50 },
      { x: 0, y: -50 }
    ],
    { x: 0, y: 0 },
    { z: 0, rotateX: Math.PI / 2, rotateY: 0, rotateZ: 0, scaleX: 1, scaleY: 1 },
    { perspective: 100, vanishX: 0, vanishY: 0 },
    undefined,
    { x: 0, y: 50 }
  );

  assert.ok(pivot);
  assert.ok(tip);
  assert.equal(Math.round(pivot.x), 0);
  assert.equal(Math.round(pivot.y), 50);
  assert.equal(pivot.scale, 1);
  assert.ok(tip.scale < pivot.scale);
});

test("rotateOrder can fold side faces after orienting their hinge axis", () => {
  const defaultOrder = rotate3DInOrder({ x: 0, y: -100, z: 0 }, 0, Math.PI / 2, -Math.PI / 6);
  const sideFaceOrder = rotate3DInOrder({ x: 0, y: -100, z: 0 }, 0, Math.PI / 2, -Math.PI / 6, "yz");

  assert.ok(Math.abs(defaultOrder.x) < 1e-10);
  assert.ok(Math.abs(sideFaceOrder.x + 50) < 1e-10);
  assert.ok(Math.abs(sideFaceOrder.y + 100 * Math.cos(Math.PI / 6)) < 1e-10);

  const scene = compileMotionMark(`path side fill:#38a169
  d: "M-50,50 L50,50 L0,-50 Z"
  origin: bottom
  rotateOrder: yz
  rotateY: 90deg
  rotateZ: -30deg
`);
  assert.equal(scene.elements[0]?.static.rotateOrder, "yz");

  const command = renderStaticFrameToCommands(resolveFrame(scene, 0))[1];
  assert.ok(command?.op === "path");
  if (command?.op !== "path") return;
  assert.equal(command.rotateOrder, "yz");
});

test("auto zIndex preserves 2D declaration order but allows 3D depth sorting", () => {
  const flat = compileMotionMark(`rect first w:10 h:10 fill:#ff0000
rect second w:10 h:10 fill:#0000ff
`);
  assert.deepEqual(flat.elements.map((element) => element.zIndex), [0, 0]);
  assert.deepEqual(resolveFrame(flat, 0).elements.map((element) => element.id), ["first", "second"]);

  const pyramid = compileMotionMark(`@group pyramid | 0s - 1s
  x: 300
  y: 200

path front fill:#e53e3e parent:pyramid | 0s - 1s
  d: "M-50,50 L50,50 L0,-50 Z"
  z: 50

path back fill:#3182ce parent:pyramid | 0s - 1s
  d: "M-50,50 L50,50 L0,-50 Z"
  z: -50
`);
  const ids = resolveFrame(pyramid, 0).elements.map((element) => element.id);
  assert.ok(ids.indexOf("back") < ids.indexOf("front"));
});

test("parent transforms compose depth, 3D rotation, and axis scale", () => {
  const scene = compileMotionMark(`@group stage
  x: 10
  y: 20
  z: 30
  rotateY: 0.2
  scaleX: 2

rect child w:10 h:10 fill:#fff parent:stage
  x: 5
  y: 0
  z: 7
  rotateY: 0.3
  scaleX: 1.5
`);

  const child = resolveFrame(scene, 0).elements.find((element) => element.id === "child");
  assert.ok(child);
  // 3D parent: child x/y/z are group center, offsets in _3dOffset*
  assert.equal(child?.props.x, 10);
  assert.equal(child?.props.y, 20);
  assert.equal(child?.props.z, 30);
  // Child offset is rotated by parent's rotateY(0.2)
  assert.ok(Math.abs((child?.props._3dOffsetX as number) - (10 * Math.cos(0.2) + 7 * Math.sin(0.2))) < 1e-10);
  assert.equal(child?.props._3dOffsetY, 0);
  assert.ok(Math.abs((child?.props._3dOffsetZ as number) - (-10 * Math.sin(0.2) + 7 * Math.cos(0.2))) < 1e-10);
  assert.equal(child?.props.scaleX, 3);
});

test("@view parses as a non-rendering 3D plane", () => {
  const source = `@view front | 0s - 1s
  at: 0 0 40
  normal: 0 0 1
  up: 0 -1 0

rect face w:20 h:20 fill:#3b82f6 parent:front | 0s - 1s
`;

  const ast = parseMotionMark(source);
  assert.equal(ast.elements[0]?.type, "view");
  const atProperty = ast.elements[0]?.body.find((item) => item.kind === "property" && item.name === "at");
  assert.ok(atProperty?.kind === "property");
  assert.deepEqual(atProperty.value, [0, 0, 40]);

  const scene = compileMotionMark(source);
  const view = scene.elements.find((element) => element.id === "front");
  assert.equal(view?.type, "view");
  assert.equal(view?.static.z, 40);
  assert.ok(Array.isArray(view?.static._viewMat));

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.deepEqual(commands.map((command) => command.op), ["clear", "rect"]);
});

test("@view normal and up orient child planes without Euler rotations", () => {
  const scene = compileMotionMark(`@view right | 0s - 1s
  at: 40 0 0
  normal: 1 0 0
  up: 0 -1 0

rect face w:20 h:20 fill:#0891b2 parent:right | 0s - 1s
`);

  const child = resolveFrame(scene, 0).elements.find((element) => element.id === "face");
  assert.ok(child);
  assert.equal(child?.props.x, 40);
  assert.deepEqual(
    (child?.props._3dMat as number[]).map((value) => Math.round(value * 1000) / 1000),
    [0, 0, 1, 0, 1, 0, -1, 0, 0]
  );
});

test("@group transforms compose through @view planes", () => {
  const scene = compileMotionMark(`@group cube | 0s - 1s
  x: 100
  y: 100
  rotateY: 90deg

@view front parent:cube | 0s - 1s
  at: 0 0 40
  normal: 0 0 1

rect face w:20 h:20 fill:#3b82f6 parent:front | 0s - 1s
`);

  const face = resolveFrame(scene, 0).elements.find((element) => element.id === "face");
  assert.ok(face);
  assert.equal(face?.props.x, 100);
  assert.equal(face?.props.y, 100);
  assert.ok(Math.abs((face?.props._3dOffsetX as number) - 40) < 1e-10);
  assert.ok(Math.abs(face?.props._3dOffsetZ as number) < 1e-10);
});

test("@view children still depth-sort by transformed vertices", () => {
  const scene = compileMotionMark(`@view back | 0s - 1s
  at: 0 0 -30
  normal: 0 0 -1

rect backFace w:20 h:20 fill:#1e3a8a parent:back | 0s - 1s

@view front | 0s - 1s
  at: 0 0 30
  normal: 0 0 1

rect frontFace w:20 h:20 fill:#3b82f6 parent:front | 0s - 1s
`);

  const ids = renderStaticFrameToCommands(resolveFrame(scene, 0))
    .filter((command) => command.op === "rect")
    .map((command) => command.id);
  assert.deepEqual(ids, ["backFace", "frontFace"]);
});

test("zIndex controls layer order while z controls projected depth", () => {
  const scene = compileMotionMark(
    `rect top w:10 h:10 fill:#ff0000 zIndex:2
  x: 5
  y: 5
  z: -10

rect bottom w:10 h:10 fill:#0000ff zIndex:1
  x: 5
  y: 5
  z: 10
`,
    { canvas: { width: 10, height: 10, bg: "#000000", fps: 1, perspective: 1000 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  const centerPixel = (5 * 10 + 5) * 4;
  assert.deepEqual(Array.from(frame.data.slice(centerPixel, centerPixel + 4)), [255, 0, 0, 255]);
});

test("raw exporter renders projected rotated rectangles", () => {
  const scene = compileMotionMark(
    `---
canvas: 80x80
bg: #000000
perspective: 100
vanish: 40 40
---

rect card w:30 h:30 fill:#ff0000
  x: 40
  y: 40
  rotateY: 45
`,
    { canvas: { fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  let redPixels = 0;
  for (let i = 0; i < frame.data.length; i += 4) {
    if (frame.data[i] === 255 && frame.data[i + 1] === 0 && frame.data[i + 2] === 0) {
      redPixels += 1;
    }
  }
  assert.ok(redPixels > 0);
});

test("raw exporter does not fill projected fill:none circles", () => {
  const scene = compileMotionMark(
    `---
canvas: 80x80
bg: #ffffff
perspective: 200
vanish: 40 40
---

@group ring | 0s - 1s
  x: 40
  y: 40
  rotateX: -18deg

@view plane parent:ring | 0s - 1s
  normal: 0 1 0
  up: 0 0 1

circle wire r:24 fill:none stroke:#0000ff strokeWidth:2 parent:plane | 0s - 1s
`,
    { canvas: { fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  const centerPixel = (40 * 80 + 40) * 4;
  assert.deepEqual(Array.from(frame.data.slice(centerPixel, centerPixel + 4)), [255, 255, 255, 255]);
});

test("line3d, poly3d, and path3d compile to render commands", () => {
  const scene = compileMotionMark(`line3d edge stroke:#ffffff strokeWidth:2 | 0s - 1s
  from: (0, 0, -20)
  to: (0, 30, 40)

poly3d tri fill:#ff0000 stroke:#ffffff strokeWidth:1 | 0s - 1s
  points: [(0,0,0), (20,0,0), (10,20,20)]

path3d ridge d:"M0,0,0 L20,0,20 L10,20,0 Z" fill:none stroke:#00ff00 strokeWidth:2 | 0s - 1s
`);

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.ok(commands.some((command) => command.op === "line3d" && command.id === "edge"));
  assert.ok(commands.some((command) => command.op === "poly3d" && command.id === "tri"));
  assert.ok(commands.some((command) => command.op === "path3d" && command.id === "ridge"));
});

test("cuboid expands to customizable poly3d faces", () => {
  const scene = compileMotionMark(`cuboid box w:80 h:60 d:40 fill:#38bdf8 stroke:#ffffff22 | 0s - 1s
  x: 100
  y: 100
  rotateY: 20deg
  frontFill: #ff0000
  topFill: #00ff00
`);

  assert.equal(scene.elements.find((element) => element.id === "box")?.type, "group");
  assert.equal(scene.elements.find((element) => element.id === "box_front")?.type, "poly3d");
  assert.equal(scene.elements.find((element) => element.id === "box_front")?.static.fill, "#ff0000");
  assert.equal(scene.elements.find((element) => element.id === "box_top")?.static.fill, "#00ff00");

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.equal(commands.filter((command) => command.op === "poly3d" && command.id.startsWith("box_")).length, 6);
});

test("plane expands to one customizable poly3d face", () => {
  const scene = compileMotionMark(`plane floor w:160 h:90 fill:#334155 stroke:#ffffff22 | 0s - 1s
  x: 100
  y: 100
  rotateX: 90deg
  faceFill: #ff0000
`);

  assert.equal(scene.elements.find((element) => element.id === "floor")?.type, "group");
  assert.equal(scene.elements.find((element) => element.id === "floor_face")?.type, "poly3d");
  assert.equal(scene.elements.find((element) => element.id === "floor_face")?.static.fill, "#ff0000");

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.equal(commands.filter((command) => command.op === "poly3d" && command.id.startsWith("floor_")).length, 1);
});

test("sphere expands to a generated triangular poly3d mesh", () => {
  const scene = compileMotionMark(`sphere orb r:40 segments:8 rings:5 fill:#22d3ee stroke:#ffffff18 | 0s - 1s
  x: 100
  y: 100
  rotateY: 45deg
  topFill: #ffffff
  face0Fill: #ff00ff
`);

  assert.equal(scene.elements.find((element) => element.id === "orb")?.type, "group");
  assert.equal(scene.elements.find((element) => element.id === "orb_face0")?.static.fill, "#ff00ff");
  assert.ok(scene.elements.some((element) => element.id === "orb_face8" && element.static.fill === "#ffffff"));

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.ok(commands.filter((command) => command.op === "poly3d" && command.id.startsWith("orb_face")).length > 40);
});

test("poly3d depth sorting uses point z even without Euler rotation", () => {
  const scene = compileMotionMark(`poly3d front fill:#ff0000 | 0s - 1s
  points: [(-10,-10,40), (10,-10,40), (0,10,40)]

poly3d back fill:#0000ff | 0s - 1s
  points: [(-10,-10,-40), (10,-10,-40), (0,10,-40)]
`);

  const ids = renderStaticFrameToCommands(resolveFrame(scene, 0))
    .filter((command) => command.op === "poly3d")
    .map((command) => (command.op === "poly3d" ? command.id : ""));
  assert.deepEqual(ids, ["back", "front"]);
});

test("generated solid faces sort atomically against other 3D objects", () => {
  const scene = compileMotionMark(`sphere orb r:40 segments:8 rings:5 fill:#22d3ee stroke:#ffffff18 | 0s - 1s

line3d through stroke:#ffffff strokeWidth:4 | 0s - 1s
  from: (-60,0,10)
  to: (60,0,10)
`);

  const face = scene.elements.find((element) => element.id === "orb_face0");
  assert.equal(face?.static._solidDepth, true);
  assert.equal(face?.static.zIndex, 0);

  const ids = renderStaticFrameToCommands(resolveFrame(scene, 0))
    .filter((command) => command.op === "poly3d" || command.op === "line3d")
    .map((command) => (command.op === "poly3d" || command.op === "line3d" ? command.id : ""));
  const sphereFacePositions = ids
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => id.startsWith("orb_face"))
    .map(({ index }) => index);

  assert.ok(sphereFacePositions.length > 40);
  const firstFace = Math.min(...sphereFacePositions);
  const lastFace = Math.max(...sphereFacePositions);
  assert.equal(lastFace - firstFace + 1, sphereFacePositions.length);

  const lineIndex = ids.indexOf("through");
  assert.ok(lineIndex < firstFace || lineIndex > lastFace);
});

test("basic 3D solids expand to customizable poly3d faces", () => {
  const scene = compileMotionMark(`cylinder can r:30 h:80 segments:8 fill:#38bdf8 | 0s - 1s
  side0Fill: #ff0000

cone marker r:30 h:80 segments:8 fill:#f97316 | 0s - 1s
  baseFill: #111111

pyramid roof r:40 h:70 sides:4 fill:#ef4444 | 0s - 1s
  side2Fill: #00ff00

prism wedge r:35 d:60 sides:3 fill:#14b8a6 | 0s - 1s
  frontFill: #ffffff

torus ring major:45 tube:10 segments:8 tubeSegments:4 fill:#fb923c | 0s - 1s
  face0Fill: #0000ff
`);

  assert.equal(scene.elements.find((element) => element.id === "can_side0")?.static.fill, "#ff0000");
  assert.equal(scene.elements.find((element) => element.id === "marker_base")?.static.fill, "#111111");
  assert.equal(scene.elements.find((element) => element.id === "roof_side2")?.static.fill, "#00ff00");
  assert.equal(scene.elements.find((element) => element.id === "wedge_front")?.static.fill, "#ffffff");
  assert.equal(scene.elements.find((element) => element.id === "ring_face0")?.static.fill, "#0000ff");

  const commands = renderStaticFrameToCommands(resolveFrame(scene, 0));
  assert.ok(commands.some((command) => command.op === "poly3d" && command.id === "can_top"));
  assert.ok(commands.some((command) => command.op === "poly3d" && command.id === "marker_side0"));
  assert.ok(commands.some((command) => command.op === "poly3d" && command.id === "roof_base"));
  assert.ok(commands.some((command) => command.op === "poly3d" && command.id === "wedge_side0"));
  assert.ok(commands.filter((command) => command.op === "poly3d" && command.id.startsWith("ring_face")).length >= 32);
});

test("depthBias and sort modes can override depth sorting", () => {
  const biased = compileMotionMark(`rect back w:10 h:10 fill:#0000ff | 0s - 1s
  z: -20
  depthBias: 100

rect front w:10 h:10 fill:#ff0000 | 0s - 1s
  z: 20
`);
  const biasedIds = renderStaticFrameToCommands(resolveFrame(biased, 0))
    .filter((command) => command.op === "rect")
    .map((command) => command.id);
  assert.deepEqual(biasedIds, ["front", "back"]);

  const manual = compileMotionMark(`@group stack sort:manual | 0s - 1s

rect declaredFirst w:10 h:10 fill:#0000ff parent:stack | 0s - 1s
  z: 100

rect declaredSecond w:10 h:10 fill:#ff0000 parent:stack | 0s - 1s
  z: -100
`);
  const manualIds = renderStaticFrameToCommands(resolveFrame(manual, 0))
    .filter((command) => command.op === "rect")
    .map((command) => command.id);
  assert.deepEqual(manualIds, ["declaredFirst", "declaredSecond"]);
});

test("billboard keeps a child plane facing screen inside a 3D parent", () => {
  const scene = compileMotionMark(`@group spin | 0s - 1s
  x: 100
  y: 100
  rotateY: 90deg

rect label w:20 h:20 fill:#ffffff parent:spin | 0s - 1s
  z: 40
  billboard: screen
`);

  const label = resolveFrame(scene, 0).elements.find((element) => element.id === "label");
  assert.ok(label);
  assert.deepEqual(label?.props._3dMat, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(label?.props._3dParentMat, undefined);
  assert.ok(Math.abs((label?.props._3dOffsetX as number) - 40) < 1e-10);
});

test("raw exporter clips 3D polygons at the near plane instead of dropping them", () => {
  const scene = compileMotionMark(
    `---
canvas: 80x80
bg: #000000
perspective: 50
vanish: 40 40
---

poly3d shard fill:#ff0000 | 0s - 1s
  x: 40
  y: 40
  points: [(-18,-18,0), (18,-18,0), (0,24,80)]
`,
    { canvas: { fps: 1 } }
  );

  const frame = renderFrameToRgba(scene, 0);
  let redPixels = 0;
  for (let i = 0; i < frame.data.length; i += 4) {
    if (frame.data[i] > 200 && frame.data[i + 1] < 80 && frame.data[i + 2] < 80) {
      redPixels += 1;
    }
  }
  assert.ok(redPixels > 0);
});
