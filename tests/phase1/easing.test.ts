import assert from "node:assert/strict";
import test from "node:test";
import { getEasingFunction } from "../../packages/engine/src";

test("linear easing returns unchanged progress", () => {
  assert.equal(getEasingFunction("linear")(0.5), 0.5);
});

test("ease-out moves faster than linear in the first half", () => {
  const eased = getEasingFunction("ease-out")(0.5);
  assert.ok(eased > 0.5);
  assert.ok(eased < 1);
});

test("cubic-bezier easing can be parsed by name", () => {
  const eased = getEasingFunction("cubic-bezier(0, 0, 1, 1)")(0.25);
  assert.ok(Math.abs(eased - 0.25) < 0.0001);
});

