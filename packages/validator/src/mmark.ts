import { compileMotionMark } from "../../parser/src";
import { validateSceneIR } from "../../schema/src";
import type { ValidationResult } from "../../schema/src";

export function validateMotionMark(source: string): ValidationResult {
  try {
    return validateSceneIR(compileMotionMark(source));
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
}

