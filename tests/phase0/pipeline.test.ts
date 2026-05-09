import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame } from "../../packages/engine/src";
import { compileMotionMark, parseMotionMark, tokenize } from "../../packages/parser/src";
import { renderStaticFrameToCommands } from "../../packages/renderer/src";
import { validateSceneIR } from "../../packages/schema/src";
import { validateMotionMark } from "../../packages/validator/src";

const source = `rect r1 w:200 h:100 fill:#e74c5c
  x: 100
  y: 200
`;

test("tokenizes the phase 0 DSL subset", () => {
  const tokens = tokenize(source);
  assert.equal(tokens[0]?.type, "identifier");
  assert.equal(tokens[0]?.value, "rect");
  assert.ok(tokens.some((token) => token.type === "indent"));
  assert.ok(tokens.some((token) => token.type === "dedent"));
});

test("parses static rect elements into an AST", () => {
  const ast = parseMotionMark(source);
  assert.equal(ast.elements.length, 1);
  assert.equal(ast.elements[0]?.id, "r1");
  assert.equal(ast.elements[0]?.props.w, 200);
  assert.equal(ast.elements[0]?.body[0]?.name, "x");
});

test("compiles static DSL to valid Scene IR", () => {
  const scene = compileMotionMark(source);
  assert.equal(scene.elements[0]?.static.x, 100);
  assert.equal(scene.elements[0]?.static.y, 200);
  assert.equal(validateSceneIR(scene).ok, true);
});

test("resolves and renders one static frame to deterministic draw commands", () => {
  const scene = compileMotionMark(source, { canvas: { bg: "#0f0f1a" } });
  const frame = resolveFrame(scene, 0);
  const commands = renderStaticFrameToCommands(frame);
  assert.deepEqual(commands[1], {
    op: "rect",
    id: "r1",
    x: 100,
    y: 200,
    width: 200,
    height: 100,
    cornerRadius: 0,
    fill: "#e74c5c",
    stroke: "",
    strokeWidth: 0,
    draw: 1,
    opacity: 1,
    comp: "source-over",
    anchor: "center",
    origin: "center",
    mask: null,
    rotation: 0,
    scale: 1,
    z: 0,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    scaleX: 1,
    scaleY: 1
  });
});

test("validates MotionMark source through parser and schema", () => {
  assert.equal(validateMotionMark(source).ok, true);
});
