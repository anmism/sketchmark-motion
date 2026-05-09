import type { AudioTrackIR, ElementIR, SceneIR, StaticValue, ValidationIssue, ValidationResult } from "./types";

const elementTypes = new Set(["rect", "circle", "ellipse", "text", "line", "line3d", "path", "poly3d", "path3d", "plane", "cuboid", "sphere", "cylinder", "cone", "pyramid", "prism", "torus", "image", "group", "view"]);
const anchorPoints = new Set([
  "center", "top-left", "top-center", "top-right",
  "center-left", "center-right",
  "bottom-left", "bottom-center", "bottom-right"
]);

export function validateSceneIR(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return issue("$", "Scene IR must be an object");
  }

  if (value.version !== 1) {
    issues.push({ path: "$.version", message: "Expected schema version 1" });
  }

  validateCanvas(value.canvas, "$.canvas", issues);

  if (!isInteger(value.duration) || value.duration < 0) {
    issues.push({ path: "$.duration", message: "Duration must be a non-negative integer in milliseconds" });
  }

  if (!Array.isArray(value.elements)) {
    issues.push({ path: "$.elements", message: "Elements must be an array" });
  } else {
    value.elements.forEach((element, index) => validateElement(element, `$.elements[${index}]`, issues));
    validateUniqueIds(value.elements as unknown[], issues);
  }

  if (value.audioTracks !== undefined) {
    if (!Array.isArray(value.audioTracks)) {
      issues.push({ path: "$.audioTracks", message: "Audio tracks must be an array" });
    } else {
      value.audioTracks.forEach((track, index) => validateAudioTrack(track, `$.audioTracks[${index}]`, issues));
    }
  }

  return { ok: issues.length === 0, issues };
}

function validateCanvas(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Canvas must be an object" });
    return;
  }

  for (const key of ["width", "height", "fps"] as const) {
    if (!isInteger(value[key]) || (value[key] as number) <= 0) {
      issues.push({ path: `${path}.${key}`, message: `${key} must be a positive integer` });
    }
  }

  if (typeof value.bg !== "string" || value.bg.length === 0) {
    issues.push({ path: `${path}.bg`, message: "Background must be a non-empty string" });
  }

  for (const key of ["perspective", "vanishX", "vanishY"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
      issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number when provided` });
    }
  }

  if (typeof value.perspective === "number" && value.perspective <= 0) {
    issues.push({ path: `${path}.perspective`, message: "perspective must be greater than 0 when provided" });
  }
}

function validateElement(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Element must be an object" });
    return;
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    issues.push({ path: `${path}.id`, message: "Element id must be a non-empty string" });
  }

  if (typeof value.type !== "string" || !elementTypes.has(value.type)) {
    issues.push({ path: `${path}.type`, message: "Element type is not supported by the locked IR" });
  }

  validateLifetime(value.lifetime, `${path}.lifetime`, issues);
  validateStatic(value.static, `${path}.static`, issues);
  validateAnimated(value.animated, `${path}.animated`, issues);

  if (typeof value.comp !== "string" || value.comp.length === 0) {
    issues.push({ path: `${path}.comp`, message: "Composition mode must be a non-empty string" });
  }

  if (typeof value.anchor !== "string" || !anchorPoints.has(value.anchor)) {
    issues.push({ path: `${path}.anchor`, message: "Anchor must be a valid anchor point" });
  }

  if (typeof value.origin !== "string" || !anchorPoints.has(value.origin)) {
    issues.push({ path: `${path}.origin`, message: "Origin must be a valid anchor point" });
  }

  validateMask(value.mask, `${path}.mask`, issues);

  if (typeof value.zIndex !== "number" || !Number.isFinite(value.zIndex)) {
    issues.push({ path: `${path}.zIndex`, message: "zIndex must be a finite number" });
  }

  if (value.parent !== null && typeof value.parent !== "string") {
    issues.push({ path: `${path}.parent`, message: "parent must be null or an element id" });
  }
}

function validateMask(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === null) return;

  if (!isRecord(value)) {
    issues.push({ path, message: "Mask must be null or a mask object" });
    return;
  }

  const validTypes = ["rect", "circle", "path", "points", "text", "fx", "xt"];
  if (!validTypes.includes(value.type as string)) {
    issues.push({ path: `${path}.type`, message: `Mask type must be one of: ${validTypes.join(", ")}` });
    return;
  }

  if (value.type === "rect") {
    for (const key of ["x", "y", "w", "h"] as const) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number` });
      }
    }
  } else if (value.type === "circle") {
    for (const key of ["cx", "cy", "r"] as const) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number` });
      }
    }
  } else if (value.type === "path") {
    if (typeof value.d !== "string" || value.d.length === 0) {
      issues.push({ path: `${path}.d`, message: "d must be a non-empty string (SVG path)" });
    }
  } else if (value.type === "points") {
    if (!Array.isArray(value.points) || value.points.length < 4) {
      issues.push({ path: `${path}.points`, message: "points must be an array with at least 4 numbers (2 points)" });
    } else if (!value.points.every((p: unknown) => typeof p === "number" && Number.isFinite(p))) {
      issues.push({ path: `${path}.points`, message: "all points values must be finite numbers" });
    }
    if (value.closed !== undefined && typeof value.closed !== "boolean") {
      issues.push({ path: `${path}.closed`, message: "closed must be a boolean when provided" });
    }
  } else if (value.type === "text") {
    if (typeof value.content !== "string") {
      issues.push({ path: `${path}.content`, message: "content must be a string" });
    }
    for (const key of ["x", "y", "size"] as const) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number` });
      }
    }
    if (value.font !== undefined && typeof value.font !== "string") {
      issues.push({ path: `${path}.font`, message: "font must be a string when provided" });
    }
  } else if (value.type === "fx") {
    if (typeof value.expr !== "string" || value.expr.length === 0) {
      issues.push({ path: `${path}.expr`, message: "expr must be a non-empty string" });
    }
    for (const key of ["xMin", "xMax", "yBase", "steps"] as const) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number` });
      }
    }
  } else if (value.type === "xt") {
    if (typeof value.xExpr !== "string" || value.xExpr.length === 0) {
      issues.push({ path: `${path}.xExpr`, message: "xExpr must be a non-empty string" });
    }
    if (typeof value.yExpr !== "string" || value.yExpr.length === 0) {
      issues.push({ path: `${path}.yExpr`, message: "yExpr must be a non-empty string" });
    }
    for (const key of ["tMin", "tMax", "steps"] as const) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        issues.push({ path: `${path}.${key}`, message: `${key} must be a finite number` });
      }
    }
    if (value.closed !== undefined && typeof value.closed !== "boolean") {
      issues.push({ path: `${path}.closed`, message: "closed must be a boolean when provided" });
    }
  }

  if (value.invert !== undefined && typeof value.invert !== "boolean") {
    issues.push({ path: `${path}.invert`, message: "invert must be a boolean when provided" });
  }
}

function validateAudioTrack(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Audio track must be an object" });
    return;
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    issues.push({ path: `${path}.id`, message: "Audio track id must be a non-empty string" });
  }

  if (typeof value.src !== "string" || value.src.length === 0) {
    issues.push({ path: `${path}.src`, message: "Audio track src must be a non-empty string" });
  }

  validateLifetime(value.lifetime, `${path}.lifetime`, issues);

  if (typeof value.volume !== "number" && !isRecord(value.volume)) {
    issues.push({ path: `${path}.volume`, message: "Volume must be a number or animated property" });
  }

  if (typeof value.pan !== "number" && !isRecord(value.pan)) {
    issues.push({ path: `${path}.pan`, message: "Pan must be a number or animated property" });
  }
}

function validateLifetime(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Lifetime must be an object" });
    return;
  }

  if (!isInteger(value.start) || value.start < 0) {
    issues.push({ path: `${path}.start`, message: "Lifetime start must be a non-negative integer" });
  }

  if (!isInteger(value.end) || value.end < 0) {
    issues.push({ path: `${path}.end`, message: "Lifetime end must be a non-negative integer" });
  }

  if (isInteger(value.start) && isInteger(value.end) && value.end < value.start) {
    issues.push({ path, message: "Lifetime end must be greater than or equal to start" });
  }
}

function validateStatic(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Static properties must be an object" });
    return;
  }

  for (const [key, property] of Object.entries(value)) {
    if (!isStaticValue(property)) {
      issues.push({ path: `${path}.${key}`, message: "Static value must be a number, string, boolean, or scalar array" });
    }
  }
}

function validateAnimated(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "Animated properties must be an object" });
    return;
  }

  for (const [key, property] of Object.entries(value)) {
    if (!isRecord(property) || typeof property.type !== "string") {
      issues.push({ path: `${path}.${key}`, message: "Animated property must declare a type" });
      continue;
    }

    if (property.type === "expression") {
      if (typeof property.fn !== "string" || property.fn.length === 0) {
        issues.push({ path: `${path}.${key}.fn`, message: "Expression property must include fn source" });
      }
    } else if (property.type === "keyframes") {
      if (!Array.isArray(property.points) || property.points.length === 0) {
        issues.push({ path: `${path}.${key}.points`, message: "Keyframes property must include at least one point" });
      }
    } else if (property.type === "color-keyframes") {
      if (!Array.isArray(property.points) || property.points.length === 0) {
        issues.push({ path: `${path}.${key}.points`, message: "Color keyframes property must include at least one point" });
      }
    } else {
      issues.push({ path: `${path}.${key}.type`, message: "Unknown animated property type" });
    }
  }
}

function validateUniqueIds(elements: unknown[], issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  for (const element of elements) {
    if (!isElementLike(element)) continue;
    if (ids.has(element.id)) {
      issues.push({ path: "$.elements", message: `Duplicate element id '${element.id}'` });
    }
    ids.add(element.id);
  }
}

function isElementLike(value: unknown): value is ElementIR {
  return isRecord(value) && typeof value.id === "string";
}

function isStaticValue(value: unknown): value is StaticValue {
  return (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "number" || typeof item === "string"))
  );
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] };
}
