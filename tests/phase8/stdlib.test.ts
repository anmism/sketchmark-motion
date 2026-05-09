import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrame } from "../../packages/engine/src";
import { compileMotionMark } from "../../packages/parser/src";
import { basicMotionStdlib } from "../../packages/stdlib/src";

test("basic motion stdlib can be prepended to a document", () => {
  const scene = compileMotionMark(`${basicMotionStdlib}

rect title w:100 h:30 fill:#fff | 0s - 2s
  fade-in()
  slide-right(from: 0, to: 100, dur: 1s)
`);

  const frame = resolveFrame(scene, 500);
  assert.ok(typeof frame.elements[0]?.props.x === "number" && frame.elements[0].props.x > 0);
  assert.ok(typeof frame.elements[0]?.props.opacity === "number" && frame.elements[0].props.opacity > 0);
});

test("stdlib expression motion supports parameter substitution", () => {
  const scene = compileMotionMark(`${basicMotionStdlib}

rect dot w:10 h:10 fill:#fff | 0s - 2s
  drift-x(20)
`);

  assert.equal(resolveFrame(scene, 1000).elements[0]?.props.x, 20);
});

