import assert from "node:assert/strict";
import test from "node:test";
import { validateMotionMark } from "../../packages/validator/src";

test("standalone validator reports DSL errors", () => {
  const result = validateMotionMark(`rect r1 w:10 h:10 fill:#fff
  missing-motion()
`);
  assert.equal(result.ok, false);
  assert.ok(result.issues[0]?.message.includes("Unknown @motion"));
});

