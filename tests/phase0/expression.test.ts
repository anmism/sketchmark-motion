import assert from "node:assert/strict";
import test from "node:test";
import { compileArithmeticExpression } from "../../packages/parser/src";

test("compiles arithmetic with precedence", () => {
  assert.equal(compileArithmeticExpression("100 + 50 * 2")(), 200);
});

test("supports parentheses, unary operators, and exponentiation", () => {
  assert.equal(compileArithmeticExpression("-(2 + 3)^2")(), -25);
});

