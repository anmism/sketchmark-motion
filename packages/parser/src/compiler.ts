import type { AnchorPoint, AudioTrackIR, ColorKeyframeIR, ElementIR, KeyframeIR, MaskIR, SceneIR, StaticValue } from "../../schema/src";
import { validateSceneIR } from "../../schema/src";
import { compileNumericExpression } from "./expression";
import type {
  AnimationAST,
  AnimationScalarAST,
  AudioTrackAST,
  CameraAST,
  DocumentAST,
  DrawCallAST,
  DrawDefinitionAST,
  ElementAST,
  ElementBodyItemAST,
  EmitterDefinitionAST,
  EmitterOverLifeAST,
  EmitterRandomAST,
  LifetimeAST,
  MotionArgumentAST,
  MotionDefinitionAST,
  MotionParamAST,
  PropertyAssignmentAST,
  PropertyValueAST,
  SystemAST
} from "./ast";
import { parseMotionMark } from "./parser";

export interface CompileOptions {
  canvas?: Partial<SceneIR["canvas"]>;
  defaultDurationMs?: number;
  resolveImport?: (importPath: string) => string | undefined;
}

interface CompiledElementDraft {
  element: Omit<ElementIR, "lifetime">;
  lifetime: LifetimeAST;
}

type MotionBindings = Map<string, StaticValue>;

export function compileMotionMark(source: string, options: CompileOptions = {}): SceneIR {
  return compileAST(parseMotionMark(source), options);
}

export function compileAST(ast: DocumentAST, options: CompileOptions = {}): SceneIR {
  const imported = resolveImportedAsts(ast, options);
  const allSystems = [...imported.flatMap((item) => item.systems), ...ast.systems];
  const allMotions = [...imported.flatMap((item) => item.motions), ...ast.motions];
  const allDraws = [...imported.flatMap((item) => item.draws), ...ast.draws];
  const allEmitters = [...imported.flatMap((item) => item.emitters), ...ast.emitters];

  const motions = new Map(allMotions.map((motion) => [motion.name, motion]));
  const draws = new Map(allDraws.map((draw) => [draw.name, draw]));
  const expandedDrawElements = expandDrawCalls(ast.drawCalls, draws, ast.header.variables);
  const expandedEmitterElements = expandEmitters(allEmitters, ast.header.variables);
  const cameraElement = buildCameraElement(ast.cameras);
  const cameraId = cameraElement?.id;
  const sourceElements = [
    ...(cameraElement ? [cameraElement] : []),
    ...[...ast.elements, ...expandedDrawElements, ...expandedEmitterElements].map((element) => applyCameraParent(element, cameraId))
  ].sort(
    (left, right) => left.loc.line - right.loc.line || left.loc.column - right.loc.column
  );
  const drafts = expand3DShapeDrafts(expandRepeatDrafts(sourceElements.map((element) => compileElementDraft(element, motions, ast.header.variables))));

  validateSystemConstraints(allSystems, drafts, options.canvas?.bg ?? ast.header.bg);

  const finiteDuration = Math.max(0, ...drafts.map((draft) => (draft.lifetime.endMs === "end" ? 0 : draft.lifetime.endMs)));
  const fallbackEnd = finiteDuration || options.defaultDurationMs || 30000;

  const elements: ElementIR[] = drafts.map((draft) => ({
    ...draft.element,
    lifetime: {
      start: draft.lifetime.startMs,
      end: draft.lifetime.endMs === "end" ? fallbackEnd : draft.lifetime.endMs
    }
  }));

  const audioTracks = compileAudioTracks(ast.audioTracks, fallbackEnd, ast.header.variables);
  const duration = Math.max(
    0,
    ...elements.map((element) => element.lifetime.end),
    ...audioTracks.map((track) => track.lifetime.end)
  );
  const scene: SceneIR = {
    version: 1,
    canvas: compileCanvas(ast, options),
    duration,
    elements,
    audioTracks
  };

  const validation = validateSceneIR(scene);
  if (!validation.ok) {
    const details = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Compiler produced invalid Scene IR: ${details}`);
  }

  return scene;
}

function resolveImportedAsts(ast: DocumentAST, options: CompileOptions): DocumentAST[] {
  const imported: DocumentAST[] = [];
  if (options.resolveImport) {
    for (const imp of ast.imports) {
      const source = options.resolveImport(imp.path);
      if (source) {
        imported.push(parseMotionMark(source));
      }
    }
  }

  return imported;
}

function compileCanvas(ast: DocumentAST, options: CompileOptions): SceneIR["canvas"] {
  const width = options.canvas?.width ?? ast.header.canvas?.width ?? 1920;
  const height = options.canvas?.height ?? ast.header.canvas?.height ?? 1080;
  const perspective = options.canvas?.perspective ?? ast.header.perspective;
  const vanishX = options.canvas?.vanishX ?? ast.header.vanishX;
  const vanishY = options.canvas?.vanishY ?? ast.header.vanishY;

  return {
    width,
    height,
    bg: options.canvas?.bg ?? ast.header.bg ?? "transparent",
    fps: options.canvas?.fps ?? ast.header.fps ?? 60,
    ...(perspective !== undefined ? { perspective } : {}),
    ...(vanishX !== undefined ? { vanishX } : {}),
    ...(vanishY !== undefined ? { vanishY } : {}),
    ...(ast.header.debug ? { debug: ast.header.debug } : {})
  };
}

function compileElementDraft(
  element: ElementAST,
  motions: Map<string, MotionDefinitionAST>,
  variables: Record<string, StaticValue>
): CompiledElementDraft {
  const staticProps: Record<string, StaticValue> = resolveStaticRecord(element.props, variables);
  const animated: ElementIR["animated"] = {};
  let comp = "source-over";
  let anchor: AnchorPoint = "center";
  let origin: AnchorPoint = "center";
  let mask: MaskIR | null = null;
  let parent: string | null = extractParent(staticProps);
  const body = expandMotionCalls(element.body, motions, variables);

  if (typeof staticProps.anchor === "string") {
    const anchorPoint = canonicalAnchorPoint(staticProps.anchor);
    if (anchorPoint) anchor = anchorPoint;
    delete staticProps.anchor;
  }
  if (typeof staticProps.origin === "string") {
    const originPoint = canonicalAnchorPoint(staticProps.origin);
    if (originPoint) origin = originPoint;
    delete staticProps.origin;
  }

  for (const assignment of body) {
    if (assignment.name === "comp" && !isAnimation(assignment.value)) {
      comp = String(assignment.value);
    } else if (assignment.name === "anchor" && !isAnimation(assignment.value)) {
      const val = canonicalAnchorPoint(String(assignment.value));
      if (val) anchor = val;
    } else if (assignment.name === "origin" && !isAnimation(assignment.value)) {
      const val = canonicalAnchorPoint(String(assignment.value));
      if (val) origin = val;
    } else if (assignment.name === "mask" && !isAnimation(assignment.value)) {
      mask = parseMask(String(assignment.value));
    } else if (assignment.name === "parent" && !isAnimation(assignment.value)) {
      parent = String(assignment.value);
    } else if (isAnimation(assignment.value)) {
      if (assignment.value.kind === "expression") {
        animated[assignment.name] = {
          type: "expression",
          fn: assignment.value.source
        };
      } else if (isColorAnimation(assignment.value)) {
        animated[assignment.name] = {
          type: "color-keyframes",
          points: compileColorAnimationPoints(assignment.value)
        };
      } else {
        animated[assignment.name] = {
          type: "keyframes",
          points: compileAnimationPoints(assignment.value)
        };
      }
    } else {
      staticProps[assignment.name] = assignment.value;
    }
  }

  const zIndex = extractZIndex(staticProps, element.id);

  if (element.type === "path") {
    generatePathPoints(staticProps);
  }
  normalize3DPrimitiveProperties(element.id, element.type, staticProps, animated);

  normalizeViewProperties(element.id, element.type, staticProps, animated);
  validatePrimitiveProperties(element.id, staticProps, animated);

  const animatedDuration = maxAnimatedDuration(animated);
  const lifetime = element.lifetime ?? element.sceneLifetime ?? { startMs: 0, endMs: animatedDuration };

  return {
    element: {
      id: element.id,
      type: element.type,
      static: staticProps,
      animated,
      comp,
      anchor,
      origin,
      mask,
      zIndex,
      parent
    },
    lifetime
  };
}

function normalizeViewProperties(
  elementId: string,
  elementType: ElementAST["type"],
  staticProps: Record<string, StaticValue>,
  animated: ElementIR["animated"]
): void {
  if (elementType !== "view") return;

  for (const propName of ["at", "normal", "up"] as const) {
    if (animated[propName] !== undefined) {
      throw new Error(`${elementId}: ${propName} must be static on @view`);
    }
  }

  if (staticProps.at !== undefined) {
    const at = requireVector3(staticProps.at, elementId, "at");
    staticProps.x = at.x;
    staticProps.y = at.y;
    staticProps.z = at.z;
    delete staticProps.at;
  }

  const normal = normalizeVector3(requireVector3(staticProps.normal, elementId, "normal", { x: 0, y: 0, z: 1 }), elementId, "normal");
  const up = normalizeVector3(requireVector3(staticProps.up, elementId, "up", { x: 0, y: -1, z: 0 }), elementId, "up");
  delete staticProps.normal;
  delete staticProps.up;

  staticProps._viewMat = viewBasisMatrix(normal, up) as unknown as StaticValue;
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

function requireVector3(value: StaticValue | undefined, elementId: string, propName: string, fallback?: Vector3): Vector3 {
  if (value === undefined) {
    if (fallback) return fallback;
    throw new Error(`${elementId}: ${propName} expects a 3D vector as 'x y z'`);
  }
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${elementId}: ${propName} expects a 3D vector as 'x y z'`);
  }

  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`${elementId}: ${propName} vector components must be finite numbers`);
  }

  return { x, y, z };
}

function normalizeVector3(vector: Vector3, elementId: string, propName: string): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= 1e-9) {
    throw new Error(`${elementId}: ${propName} vector cannot be zero`);
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function viewBasisMatrix(normal: Vector3, upHint: Vector3): number[] {
  let right = cross(normal, upHint);
  if (vectorLength(right) <= 1e-9) {
    const fallbackUp = Math.abs(normal.y) < 0.99 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
    right = cross(normal, fallbackUp);
  }

  right = normalizeVector(right);
  const down = normalizeVector(cross(normal, right));

  return [
    right.x, down.x, normal.x,
    right.y, down.y, normal.y,
    right.z, down.z, normal.z
  ];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function normalizeVector(vector: Vector3): Vector3 {
  const length = vectorLength(vector);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function vectorLength(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize3DPrimitiveProperties(
  elementId: string,
  elementType: ElementAST["type"],
  staticProps: Record<string, StaticValue>,
  animated: ElementIR["animated"]
): void {
  if (elementType !== "line3d" && elementType !== "poly3d" && elementType !== "path3d") return;

  if (elementType === "line3d") {
    for (const propName of ["from", "to"] as const) {
      if (animated[propName] !== undefined) {
        throw new Error(`${elementId}: ${propName} must be static on line3d`);
      }
    }
    requireVector3(staticProps.from, elementId, "from");
    requireVector3(staticProps.to, elementId, "to");
    return;
  }

  if (animated.points !== undefined) {
    throw new Error(`${elementId}: points must be static on ${elementType}`);
  }

  if (elementType === "path3d" && staticProps.points === undefined && typeof staticProps.d === "string") {
    staticProps.points = approximatePath3DPoints(staticProps.d) as unknown as StaticValue;
  }

  const points = staticProps.points;
  if (!Array.isArray(points) || points.length < 6 || points.length % 3 !== 0) {
    throw new Error(`${elementId}: ${elementType} expects points as 3D tuples, e.g. [(0,0,0), (40,0,0), (0,40,10)]`);
  }

  for (const point of points) {
    if (typeof point !== "number" || !Number.isFinite(point)) {
      throw new Error(`${elementId}: ${elementType} points must contain finite numbers`);
    }
  }

  if (elementType === "path3d" && typeof staticProps.d !== "string") {
    staticProps.d = "";
  }
}

interface PathPoint3D extends Vector3 {}

function approximatePath3DPoints(d: string): number[] {
  const commands = d.match(/[MLCQZmlcqz]|-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const points: PathPoint3D[] = [];
  let index = 0;
  let command = "";
  let current: PathPoint3D = { x: 0, y: 0, z: 0 };
  let start: PathPoint3D = { x: 0, y: 0, z: 0 };

  const isCommand = (value: string) => /^[MLCQZmlcqz]$/.test(value);
  const readPoint = (relative: boolean): PathPoint3D | null => {
    if (index + 2 >= commands.length) return null;
    const x = Number(commands[index++]);
    const y = Number(commands[index++]);
    const z = Number(commands[index++]);
    if (![x, y, z].every(Number.isFinite)) return null;
    return relative ? { x: current.x + x, y: current.y + y, z: current.z + z } : { x, y, z };
  };
  const push = (point: PathPoint3D) => {
    const last = points[points.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y || last.z !== point.z) {
      points.push(point);
    }
  };

  while (index < commands.length) {
    if (isCommand(commands[index]!)) {
      command = commands[index++]!;
    }
    if (!command) break;

    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === "Z") {
      current = { ...start };
      push(current);
      command = "";
      continue;
    }

    if (upper === "M" || upper === "L") {
      const point = readPoint(relative);
      if (!point) break;
      current = point;
      if (upper === "M") start = { ...point };
      push(current);
      command = upper === "M" ? (relative ? "l" : "L") : command;
      continue;
    }

    if (upper === "Q") {
      const control = readPoint(relative);
      const end = readPoint(relative);
      if (!control || !end) break;
      const from = current;
      for (let step = 1; step <= 16; step += 1) {
        const t = step / 16;
        push(quadraticPoint3D(from, control, end, t));
      }
      current = end;
      continue;
    }

    if (upper === "C") {
      const c1 = readPoint(relative);
      const c2 = readPoint(relative);
      const end = readPoint(relative);
      if (!c1 || !c2 || !end) break;
      const from = current;
      for (let step = 1; step <= 24; step += 1) {
        const t = step / 24;
        push(cubicPoint3D(from, c1, c2, end, t));
      }
      current = end;
      continue;
    }

    break;
  }

  return points.flatMap((point) => [point.x, point.y, point.z]);
}

function quadraticPoint3D(a: PathPoint3D, b: PathPoint3D, c: PathPoint3D, t: number): PathPoint3D {
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * b.x + t * t * c.x,
    y: mt * mt * a.y + 2 * mt * t * b.y + t * t * c.y,
    z: mt * mt * a.z + 2 * mt * t * b.z + t * t * c.z
  };
}

function cubicPoint3D(a: PathPoint3D, b: PathPoint3D, c: PathPoint3D, d: PathPoint3D, t: number): PathPoint3D {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * b.x + 3 * mt * t * t * c.x + t * t * t * d.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * b.y + 3 * mt * t * t * c.y + t * t * t * d.y,
    z: mt * mt * mt * a.z + 3 * mt * mt * t * b.z + 3 * mt * t * t * c.z + t * t * t * d.z
  };
}

function validatePrimitiveProperties(
  elementId: string,
  staticProps: Record<string, StaticValue>,
  animated: ElementIR["animated"]
): void {
  const hasProperty = (name: string) => staticProps[name] !== undefined || animated[name] !== undefined;

  if (hasProperty("draw") && (hasProperty("drawStart") || hasProperty("drawEnd"))) {
    throw new Error(`${elementId}: draw cannot be combined with drawStart or drawEnd`);
  }

  for (const propName of ["drawStart", "drawEnd"] as const) {
    validateNumericPrimitive(elementId, propName, staticProps, animated, 0, 1);
  }

  validateNumericPrimitive(elementId, "dashOffset", staticProps, animated);
  validateNumericPrimitive(elementId, "blur", staticProps, animated, 0);
  validateNumericPrimitive(elementId, "brightness", staticProps, animated, 0);
  validateNumericPrimitive(elementId, "contrast", staticProps, animated, 0);
  validateNumericPrimitive(elementId, "saturate", staticProps, animated, 0);
  validateNumericPrimitive(elementId, "hueRotate", staticProps, animated);
  validateNumericPrimitive(elementId, "motionProgress", staticProps, animated, 0, 1);
  validateNumericPrimitive(elementId, "repeat", staticProps, animated, 1);
  validateNumericPrimitive(elementId, "z", staticProps, animated);
  validateNumericPrimitive(elementId, "zIndex", staticProps, animated);
  validateNumericPrimitive(elementId, "depthBias", staticProps, animated);
  validateNumericPrimitive(elementId, "rotateX", staticProps, animated);
  validateNumericPrimitive(elementId, "rotateY", staticProps, animated);
  validateNumericPrimitive(elementId, "rotateZ", staticProps, animated);
  validateRotateOrder(elementId, staticProps.rotateOrder, animated.rotateOrder);
  validateNumericPrimitive(elementId, "scaleX", staticProps, animated);
  validateNumericPrimitive(elementId, "scaleY", staticProps, animated);
  const repeatValue = staticProps.repeat;
  if (repeatValue !== undefined && (typeof repeatValue !== "number" || !Number.isInteger(repeatValue) || repeatValue < 1)) {
    throw new Error(`${elementId}: repeat must be a positive integer`);
  }

  const start = staticProps.drawStart;
  const end = staticProps.drawEnd;
  if (typeof start === "number" && typeof end === "number" && end < start) {
    throw new Error(`${elementId}: drawEnd must be greater than or equal to drawStart`);
  }

  validateDashArray(elementId, staticProps.dashArray);
  validateShadow(elementId, staticProps.shadow);
  validateMotionPath(elementId, staticProps.motionPath);
  validateSortMode(elementId, staticProps.sort, animated.sort);
  validateBillboard(elementId, staticProps.billboard, animated.billboard);
  validateRepeatOffset(elementId, staticProps.repeatOffset);

  if (animated.dashArray) {
    throw new Error(`${elementId}: dashArray must be a static array`);
  }

  if (animated.shadow) {
    throw new Error(`${elementId}: shadow must be a static value in the form offsetX offsetY blur color`);
  }

  if (animated.repeat || animated.repeatOffset) {
    throw new Error(`${elementId}: repeat and repeatOffset must be static values`);
  }
}

function validateNumericPrimitive(
  elementId: string,
  propName: string,
  staticProps: Record<string, StaticValue>,
  animated: ElementIR["animated"],
  min?: number,
  max?: number
): void {
  const staticValue = staticProps[propName];
  if (staticValue !== undefined) {
    validateNumericValue(elementId, propName, staticValue, min, max);
  }

  const animatedValue = animated[propName];
  if (!animatedValue || animatedValue.type === "expression") return;

  if (animatedValue.type !== "keyframes") {
    throw new Error(`${elementId}: ${propName} must be numeric`);
  }

  for (const point of animatedValue.points) {
    validateNumericValue(elementId, propName, point.value, min, max);
  }
}

function validateNumericValue(
  elementId: string,
  propName: string,
  value: StaticValue,
  min?: number,
  max?: number
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${elementId}: ${propName} must be a finite number`);
  }

  if (min !== undefined && value < min) {
    throw new Error(`${elementId}: ${propName} must be greater than or equal to ${min}`);
  }

  if (max !== undefined && value > max) {
    throw new Error(`${elementId}: ${propName} must be less than or equal to ${max}`);
  }
}

function validateSortMode(elementId: string, staticValue: StaticValue | undefined, animatedValue: ElementIR["animated"][string]): void {
  if (animatedValue) {
    throw new Error(`${elementId}: sort must be static`);
  }
  if (staticValue === undefined) return;
  if (typeof staticValue !== "string" || !["depth", "manual", "layer"].includes(staticValue)) {
    throw new Error(`${elementId}: sort must be one of depth, manual, or layer`);
  }
}

function validateBillboard(elementId: string, staticValue: StaticValue | undefined, animatedValue: ElementIR["animated"][string]): void {
  if (animatedValue) {
    throw new Error(`${elementId}: billboard must be static`);
  }
  if (staticValue === undefined) return;
  if (typeof staticValue !== "string" || !["none", "screen", "y"].includes(staticValue)) {
    throw new Error(`${elementId}: billboard must be one of none, screen, or y`);
  }
}

function validateDashArray(elementId: string, value: StaticValue | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${elementId}: dashArray must be a non-empty array of positive numbers`);
  }

  if (!value.every((item) => typeof item === "number" && Number.isFinite(item) && item > 0)) {
    throw new Error(`${elementId}: dashArray must contain only positive finite numbers`);
  }
}

function validateShadow(elementId: string, value: StaticValue | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${elementId}: shadow must be offsetX offsetY blur color`);
  }

  const [offsetX, offsetY, blur, color] = value;
  if (
    typeof offsetX !== "number" ||
    typeof offsetY !== "number" ||
    typeof blur !== "number" ||
    typeof color !== "string" ||
    !Number.isFinite(offsetX) ||
    !Number.isFinite(offsetY) ||
    !Number.isFinite(blur) ||
    blur < 0
  ) {
    throw new Error(`${elementId}: shadow must be offsetX offsetY nonNegativeBlur color`);
  }
}

function validateMotionPath(elementId: string, value: StaticValue | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${elementId}: motionPath must be an SVG path string`);
  }
}

function validateRepeatOffset(elementId: string, value: StaticValue | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${elementId}: repeatOffset must be a property offset string`);
  }
}

function expand3DShapeDrafts(drafts: CompiledElementDraft[]): CompiledElementDraft[] {
  const expanded: CompiledElementDraft[] = [];

  for (const draft of drafts) {
    if (draft.element.type === "plane") {
      expanded.push(...expandPlaneDraft(draft));
    } else if (draft.element.type === "cuboid") {
      expanded.push(...expandCuboidDraft(draft));
    } else if (draft.element.type === "sphere") {
      expanded.push(...expandSphereDraft(draft));
    } else if (draft.element.type === "cylinder") {
      expanded.push(...expandCylinderDraft(draft));
    } else if (draft.element.type === "cone") {
      expanded.push(...expandConeDraft(draft));
    } else if (draft.element.type === "pyramid") {
      expanded.push(...expandPyramidDraft(draft));
    } else if (draft.element.type === "prism") {
      expanded.push(...expandPrismDraft(draft));
    } else if (draft.element.type === "torus") {
      expanded.push(...expandTorusDraft(draft));
    } else {
      expanded.push(draft);
    }
  }

  return expanded;
}

function expandCuboidDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const width = numericShapeProp(props, ["w", "width"], 80);
  const height = numericShapeProp(props, ["h", "height"], 80);
  const depth = numericShapeProp(props, ["d", "depth"], 80);
  const halfW = width / 2;
  const halfH = height / 2;
  const halfD = depth / 2;
  const faceDefs = [
    { name: "front", points: [[-halfW, -halfH, halfD], [halfW, -halfH, halfD], [halfW, halfH, halfD], [-halfW, halfH, halfD]] },
    { name: "back", points: [[halfW, -halfH, -halfD], [-halfW, -halfH, -halfD], [-halfW, halfH, -halfD], [halfW, halfH, -halfD]] },
    { name: "right", points: [[halfW, -halfH, halfD], [halfW, -halfH, -halfD], [halfW, halfH, -halfD], [halfW, halfH, halfD]] },
    { name: "left", points: [[-halfW, -halfH, -halfD], [-halfW, -halfH, halfD], [-halfW, halfH, halfD], [-halfW, halfH, -halfD]] },
    { name: "top", points: [[-halfW, -halfH, -halfD], [halfW, -halfH, -halfD], [halfW, -halfH, halfD], [-halfW, -halfH, halfD]] },
    { name: "bottom", points: [[-halfW, halfH, halfD], [halfW, halfH, halfD], [halfW, halfH, -halfD], [-halfW, halfH, -halfD]] }
  ] as const;

  return [
    shapeGroupDraft(draft),
    ...faceDefs.map((face, index) =>
      shapeFaceDraft(draft, face.name, flattenPoints(face.points), {
        fill: faceMaterial(props, face.name, "fill", shadeColor(stringShapeProp(props.fill, "#38bdf8"), cuboidShade(face.name), face.name)),
        stroke: faceMaterial(props, face.name, "stroke", stringShapeProp(props.stroke, "#ffffff22")),
        strokeWidth: faceMaterial(props, face.name, "strokeWidth", numericStaticValue(props.strokeWidth, 1)),
        opacity: faceMaterial(props, face.name, "opacity", numericStaticValue(props.opacity, 1)),
        zIndex: numericStaticValue(props.zIndex, draft.element.zIndex)
      })
    )
  ];
}

function expandPlaneDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const width = numericShapeProp(props, ["w", "width"], 120);
  const height = numericShapeProp(props, ["h", "height"], 80);
  const halfW = width / 2;
  const halfH = height / 2;
  const fill = stringShapeProp(props.fill, "#38bdf8");

  return [
    shapeGroupDraft(draft),
    shapeFaceDraft(
      draft,
      "face",
      flattenPoints([[-halfW, -halfH, 0], [halfW, -halfH, 0], [halfW, halfH, 0], [-halfW, halfH, 0]]),
      shapeMaterial(draft, "face", fill)
    )
  ];
}

function expandSphereDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const radius = numericShapeProp(props, ["r", "radius"], 70);
  const segments = clampInteger(numericShapeProp(props, ["segments"], 12), 6, 32);
  const rings = clampInteger(numericShapeProp(props, ["rings"], 8), 4, 18);
  const fill = stringShapeProp(props.fill, "#38bdf8");
  const stroke = stringShapeProp(props.stroke, "#ffffff18");
  const strokeWidth = numericStaticValue(props.strokeWidth, 1);
  const opacity = numericStaticValue(props.opacity, 1);
  const faces: CompiledElementDraft[] = [shapeGroupDraft(draft)];
  let faceIndex = 0;

  const point = (ring: number, segment: number): [number, number, number] => {
    const theta = (Math.PI * ring) / rings;
    const phi = (Math.PI * 2 * segment) / segments;
    const sinTheta = Math.sin(theta);
    return [
      radius * sinTheta * Math.cos(phi),
      -radius * Math.cos(theta),
      radius * sinTheta * Math.sin(phi)
    ];
  };

  const addFace = (points: number[][]) => {
    const name = `face${faceIndex}`;
    const center = averagePoint(points);
    const normal = normalizeVector({ x: center[0] ?? 0, y: center[1] ?? 0, z: center[2] ?? 0 });
    const shade = 0.52 + Math.max(0, normal.x * -0.35 + normal.y * -0.5 + normal.z * 0.65) * 0.48;
    const band = sphereBandName(center[1] ?? 0, radius);
    faces.push(shapeFaceDraft(draft, name, flattenPoints(points), {
      fill: faceMaterial(props, name, "fill", faceMaterial(props, band, "fill", shadeColor(fill, shade, name))),
      stroke: faceMaterial(props, name, "stroke", stroke),
      strokeWidth: faceMaterial(props, name, "strokeWidth", strokeWidth),
      opacity: faceMaterial(props, name, "opacity", opacity),
      zIndex: numericStaticValue(props.zIndex, draft.element.zIndex)
    }));
    faceIndex += 1;
  };

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      if (ring === 0) {
        addFace([point(0, segment), point(1, segment), point(1, next)]);
      } else if (ring === rings - 1) {
        addFace([point(rings, segment), point(rings - 1, next), point(rings - 1, segment)]);
      } else {
        const a = point(ring, segment);
        const b = point(ring + 1, segment);
        const c = point(ring + 1, next);
        const d = point(ring, next);
        addFace([a, b, c]);
        addFace([a, c, d]);
      }
    }
  }

  return faces;
}

function expandCylinderDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const radius = numericShapeProp(props, ["r", "radius"], 50);
  const height = numericShapeProp(props, ["h", "height"], 100);
  const segments = clampInteger(numericShapeProp(props, ["segments"], 12), 3, 48);
  const halfH = height / 2;
  const fill = stringShapeProp(props.fill, "#38bdf8");
  const faces: CompiledElementDraft[] = [shapeGroupDraft(draft)];
  const ring = regularRing(segments, radius);

  faces.push(shapeFaceDraft(draft, "top", flattenPoints(ring.map(([x, z]) => [x, -halfH, z])), shapeMaterial(draft, "top", shadeColor(fill, 1.18, "top"))));
  faces.push(shapeFaceDraft(draft, "bottom", flattenPoints([...ring].reverse().map(([x, z]) => [x, halfH, z])), shapeMaterial(draft, "bottom", shadeColor(fill, 0.58, "bottom"))));

  for (let segment = 0; segment < segments; segment += 1) {
    const [x0, z0] = ring[segment]!;
    const [x1, z1] = ring[(segment + 1) % segments]!;
    faces.push(shapeFaceDraft(
      draft,
      `side${segment}`,
      flattenPoints([[x0, -halfH, z0], [x1, -halfH, z1], [x1, halfH, z1], [x0, halfH, z0]]),
      shapeMaterial(draft, `side${segment}`, shadeColor(fill, cylinderSideShade(segment, segments), `side${segment}`))
    ));
  }

  return faces;
}

function expandConeDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const radius = numericShapeProp(props, ["r", "radius"], 52);
  const height = numericShapeProp(props, ["h", "height"], 110);
  const segments = clampInteger(numericShapeProp(props, ["segments"], 12), 3, 48);
  const fill = stringShapeProp(props.fill, "#f97316");
  const apex: [number, number, number] = [0, -height / 2, 0];
  const baseY = height / 2;
  const ring = regularRing(segments, radius);
  const faces: CompiledElementDraft[] = [shapeGroupDraft(draft)];

  faces.push(shapeFaceDraft(draft, "base", flattenPoints([...ring].reverse().map(([x, z]) => [x, baseY, z])), shapeMaterial(draft, "base", shadeColor(fill, 0.58, "base"))));
  for (let segment = 0; segment < segments; segment += 1) {
    const [x0, z0] = ring[segment]!;
    const [x1, z1] = ring[(segment + 1) % segments]!;
    faces.push(shapeFaceDraft(
      draft,
      `side${segment}`,
      flattenPoints([apex, [x0, baseY, z0], [x1, baseY, z1]]),
      shapeMaterial(draft, `side${segment}`, shadeColor(fill, cylinderSideShade(segment, segments), `side${segment}`))
    ));
  }

  return faces;
}

function expandPyramidDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const radius = numericShapeProp(props, ["r", "radius"], numericShapeProp(props, ["w", "width"], 90) / 2);
  const height = numericShapeProp(props, ["h", "height"], 100);
  const sides = clampInteger(numericShapeProp(props, ["sides", "segments"], 4), 3, 24);
  const fill = stringShapeProp(props.fill, "#ef4444");
  const apex: [number, number, number] = [0, -height / 2, 0];
  const baseY = height / 2;
  const ring = regularRing(sides, radius, -Math.PI / 4);
  const faces: CompiledElementDraft[] = [shapeGroupDraft(draft)];

  faces.push(shapeFaceDraft(draft, "base", flattenPoints([...ring].reverse().map(([x, z]) => [x, baseY, z])), shapeMaterial(draft, "base", shadeColor(fill, 0.54, "base"))));
  for (let side = 0; side < sides; side += 1) {
    const [x0, z0] = ring[side]!;
    const [x1, z1] = ring[(side + 1) % sides]!;
    faces.push(shapeFaceDraft(
      draft,
      `side${side}`,
      flattenPoints([apex, [x0, baseY, z0], [x1, baseY, z1]]),
      shapeMaterial(draft, `side${side}`, shadeColor(fill, cylinderSideShade(side, sides), `side${side}`))
    ));
  }

  return faces;
}

function expandPrismDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const radius = numericShapeProp(props, ["r", "radius"], 50);
  const depth = numericShapeProp(props, ["d", "depth"], 90);
  const sides = clampInteger(numericShapeProp(props, ["sides", "segments"], 3), 3, 24);
  const fill = stringShapeProp(props.fill, "#14b8a6");
  const halfD = depth / 2;
  const ring = regularRing(sides, radius, -Math.PI / 2);
  const faces: CompiledElementDraft[] = [shapeGroupDraft(draft)];

  faces.push(shapeFaceDraft(draft, "front", flattenPoints(ring.map(([x, y]) => [x, y, halfD])), shapeMaterial(draft, "front", shadeColor(fill, 1.08, "front"))));
  faces.push(shapeFaceDraft(draft, "back", flattenPoints([...ring].reverse().map(([x, y]) => [x, y, -halfD])), shapeMaterial(draft, "back", shadeColor(fill, 0.56, "back"))));

  for (let side = 0; side < sides; side += 1) {
    const [x0, y0] = ring[side]!;
    const [x1, y1] = ring[(side + 1) % sides]!;
    faces.push(shapeFaceDraft(
      draft,
      `side${side}`,
      flattenPoints([[x0, y0, halfD], [x1, y1, halfD], [x1, y1, -halfD], [x0, y0, -halfD]]),
      shapeMaterial(draft, `side${side}`, shadeColor(fill, cylinderSideShade(side, sides), `side${side}`))
    ));
  }

  return faces;
}

function expandTorusDraft(draft: CompiledElementDraft): CompiledElementDraft[] {
  const props = draft.element.static;
  const majorRadius = numericShapeProp(props, ["major", "majorRadius", "r"], 58);
  const tubeRadius = numericShapeProp(props, ["tube", "tubeRadius", "minor", "minorRadius"], 14);
  const segments = clampInteger(numericShapeProp(props, ["segments"], 16), 6, 48);
  const tubeSegments = clampInteger(numericShapeProp(props, ["tubeSegments"], 6), 3, 24);
  const fill = stringShapeProp(props.fill, "#fb923c");
  const faces: CompiledElementDraft[] = [shapeGroupDraft(draft)];
  let faceIndex = 0;

  const point = (segment: number, tubeSegment: number): [number, number, number] => {
    const u = (Math.PI * 2 * segment) / segments;
    const v = (Math.PI * 2 * tubeSegment) / tubeSegments;
    const radius = majorRadius + tubeRadius * Math.cos(v);
    return [
      radius * Math.cos(u),
      tubeRadius * Math.sin(v),
      radius * Math.sin(u)
    ];
  };

  for (let segment = 0; segment < segments; segment += 1) {
    for (let tubeSegment = 0; tubeSegment < tubeSegments; tubeSegment += 1) {
      const a = point(segment, tubeSegment);
      const b = point(segment + 1, tubeSegment);
      const c = point(segment + 1, tubeSegment + 1);
      const d = point(segment, tubeSegment + 1);
      const name = `face${faceIndex}`;
      const center = averagePoint([a, b, c, d]);
      const shade = 0.6 + Math.max(0, (center[2] / (majorRadius + tubeRadius)) * 0.5 - (center[1] / tubeRadius) * 0.25) * 0.5;
      faces.push(shapeFaceDraft(draft, name, flattenPoints([a, b, c, d]), shapeMaterial(draft, name, shadeColor(fill, shade, name))));
      faceIndex += 1;
    }
  }

  return faces;
}

function shapeGroupDraft(draft: CompiledElementDraft): CompiledElementDraft {
  return {
    lifetime: draft.lifetime,
    element: {
      ...draft.element,
      type: "group",
      static: pickShapeGroupProps(draft.element.static),
      zIndex: draft.element.zIndex
    }
  };
}

function shapeMaterial(draft: CompiledElementDraft, faceName: string, fillFallback: string): Record<string, StaticValue> {
  const props = draft.element.static;
  return {
    fill: faceMaterial(props, faceName, "fill", fillFallback),
    stroke: faceMaterial(props, faceName, "stroke", stringShapeProp(props.stroke, "#ffffff18")),
    strokeWidth: faceMaterial(props, faceName, "strokeWidth", numericStaticValue(props.strokeWidth, 1)),
    opacity: faceMaterial(props, faceName, "opacity", numericStaticValue(props.opacity, 1)),
    zIndex: numericStaticValue(props.zIndex, draft.element.zIndex)
  };
}

function shapeFaceDraft(
  source: CompiledElementDraft,
  faceName: string,
  points: number[],
  material: Record<string, StaticValue>
): CompiledElementDraft {
  return {
    lifetime: { ...source.lifetime },
    element: {
      id: `${source.element.id}_${faceName}`,
      type: "poly3d",
      static: {
        points,
        closed: true,
        ...material,
        _solidId: source.element.id,
        _solidFace: faceName,
        _solidDepth: true,
        _solidDepthScale: 0.001
      },
      animated: {},
      comp: source.element.comp,
      anchor: "center",
      origin: "center",
      mask: null,
      zIndex: typeof material.zIndex === "number" ? material.zIndex : source.element.zIndex,
      parent: source.element.id
    }
  };
}

function pickShapeGroupProps(props: Record<string, StaticValue>): Record<string, StaticValue> {
  const groupProps: Record<string, StaticValue> = {};
  const shapeOnlyPrefixes = ["front", "back", "left", "right", "top", "bottom", "upper", "middle", "lower", "face", "side", "base"];
  const shapeOnlyNames = new Set(["w", "width", "h", "height", "d", "depth", "r", "radius", "segments", "rings", "sides", "major", "majorRadius", "tube", "tubeRadius", "minor", "minorRadius", "tubeSegments", "fill", "stroke", "strokeWidth", "opacity", "gradient"]);

  for (const [key, value] of Object.entries(props)) {
    if (shapeOnlyNames.has(key)) continue;
    if (shapeOnlyPrefixes.some((prefix) => key.startsWith(prefix) && /(?:Fill|Stroke|StrokeWidth|Opacity)$/.test(key))) continue;
    groupProps[key] = value;
  }

  return groupProps;
}

function regularRing(count: number, radius: number, offset = 0): [number, number][] {
  return Array.from({ length: count }, (_, index) => {
    const angle = offset + (Math.PI * 2 * index) / count;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

function cylinderSideShade(index: number, total: number): number {
  const angle = (Math.PI * 2 * index) / total;
  return 0.62 + (Math.cos(angle - Math.PI / 5) + 1) * 0.24;
}

function numericShapeProp(props: Record<string, StaticValue>, names: string[], fallback: number): number {
  for (const name of names) {
    const value = props[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function stringShapeProp(value: StaticValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numericStaticValue(value: StaticValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function faceMaterial(props: Record<string, StaticValue>, faceName: string, materialName: "fill" | "stroke" | "strokeWidth" | "opacity", fallback: StaticValue): StaticValue {
  const key = `${faceName}${materialName[0]!.toUpperCase()}${materialName.slice(1)}`;
  return props[key] ?? fallback;
}

function flattenPoints(points: readonly (readonly number[])[]): number[] {
  return points.flatMap((point) => [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0]);
}

function averagePoint(points: number[][]): [number, number, number] {
  const total = points.reduce(
    (acc, point) => [acc[0] + (point[0] ?? 0), acc[1] + (point[1] ?? 0), acc[2] + (point[2] ?? 0)] as [number, number, number],
    [0, 0, 0] as [number, number, number]
  );
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length];
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sphereBandName(y: number, radius: number): string {
  if (y < -radius * 0.45) return "top";
  if (y < -radius * 0.1) return "upper";
  if (y > radius * 0.45) return "bottom";
  if (y > radius * 0.1) return "lower";
  return "middle";
}

function cuboidShade(faceName: string): number {
  if (faceName === "top") return 1.18;
  if (faceName === "front") return 1.02;
  if (faceName === "right") return 0.86;
  if (faceName === "left") return 0.72;
  if (faceName === "back") return 0.55;
  return 0.62;
}

function shadeColor(color: string, shade: number, salt: string): string {
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  const jitter = ((hashShapeString(salt) % 17) - 8) / 100;
  const amount = Math.max(0, Math.min(1.4, shade + jitter));
  return `#${toHex(parsed.r * amount)}${toHex(parsed.g * amount)}${toHex(parsed.b * amount)}`;
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = match[1]!;
  if (value.length === 3) {
    return {
      r: parseInt(value[0]! + value[0]!, 16),
      g: parseInt(value[1]! + value[1]!, 16),
      b: parseInt(value[2]! + value[2]!, 16)
    };
  }
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function hashShapeString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function expandRepeatDrafts(drafts: CompiledElementDraft[]): CompiledElementDraft[] {
  const expanded: CompiledElementDraft[] = [];

  for (const draft of drafts) {
    const repeat = draft.element.static.repeat;
    const count = typeof repeat === "number" ? Math.max(1, Math.floor(repeat)) : 1;
    const offsets = parseRepeatOffset(draft.element.static.repeatOffset);

    if (count === 1) {
      expanded.push(stripRepeatProps(draft));
      continue;
    }

    for (let index = 0; index < count; index += 1) {
      expanded.push(applyRepeatIndex(draft, offsets, index));
    }
  }

  return expanded;
}

function stripRepeatProps(draft: CompiledElementDraft): CompiledElementDraft {
  const staticProps = { ...draft.element.static };
  delete staticProps.repeat;
  delete staticProps.repeatOffset;
  return {
    ...draft,
    element: {
      ...draft.element,
      static: staticProps
    }
  };
}

function applyRepeatIndex(
  draft: CompiledElementDraft,
  offsets: Record<string, number>,
  index: number
): CompiledElementDraft {
  const clone = cloneDraft(stripRepeatProps(draft));
  clone.element.id = index === 0 ? draft.element.id : `${draft.element.id}__repeat${index}`;

  const delay = (offsets.delay ?? 0) * index;
  for (const [name, value] of Object.entries(offsets)) {
    if (name === "delay") continue;
    applyPropertyOffset(clone.element.static, clone.element.animated, name, value * index);
  }

  if (delay !== 0) {
    delayAnimations(clone.element.animated, delay);
    if (typeof clone.lifetime.endMs === "number") {
      clone.lifetime = {
        ...clone.lifetime,
        endMs: clone.lifetime.endMs + delay
      };
    }
  }

  return clone;
}

function cloneDraft(draft: CompiledElementDraft): CompiledElementDraft {
  return {
    lifetime: { ...draft.lifetime },
    element: {
      ...draft.element,
      static: cloneStaticRecord(draft.element.static),
      animated: cloneAnimatedRecord(draft.element.animated)
    }
  };
}

function cloneStaticRecord(value: Record<string, StaticValue>): Record<string, StaticValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? [...item] : item])
  );
}

function cloneAnimatedRecord(animated: ElementIR["animated"]): ElementIR["animated"] {
  return Object.fromEntries(
    Object.entries(animated).map(([name, property]) => {
      if (property.type === "expression") return [name, { ...property }];
      return [name, { ...property, points: property.points.map((point) => ({ ...point })) }];
    })
  );
}

function applyPropertyOffset(
  staticProps: Record<string, StaticValue>,
  animated: ElementIR["animated"],
  name: string,
  offset: number
): void {
  const animatedProperty = animated[name];
  if (animatedProperty?.type === "keyframes") {
    animatedProperty.points = animatedProperty.points.map((point) => ({ ...point, value: point.value + offset }));
    return;
  }

  const staticValue = staticProps[name];
  if (typeof staticValue === "number") {
    staticProps[name] = staticValue + offset;
  } else if (staticValue === undefined) {
    staticProps[name] = repeatOffsetBase(name) + offset;
  }
}

function repeatOffsetBase(name: string): number {
  return name === "opacity" || name === "scale" || name === "scaleX" || name === "scaleY" ? 1 : 0;
}

function delayAnimations(animated: ElementIR["animated"], delayMs: number): void {
  for (const property of Object.values(animated)) {
    if (property.type === "keyframes") {
      property.points = property.points.map((point) => ({ ...point, t: point.t + delayMs }));
    } else if (property.type === "color-keyframes") {
      property.points = property.points.map((point) => ({ ...point, t: point.t + delayMs }));
    }
  }
}

function parseRepeatOffset(value: StaticValue | undefined): Record<string, number> {
  if (typeof value !== "string") return {};
  const offsets: Record<string, number> = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*([^\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    offsets[match[1]!] = parseCompilerNumber(match[2]!);
  }

  return offsets;
}

function generatePathPoints(props: Record<string, StaticValue>): void {
  const xt = props.xt;
  const yt = props.yt;
  const tRange = props.tRange;

  if (typeof xt === "string" && typeof yt === "string" && typeof tRange === "string") {
    generateParametricPath(props, xt, yt, tRange);
    return;
  }

  const fx = props.fx;
  const xRange = props.xRange;
  if (typeof fx !== "string" || typeof xRange !== "string") return;

  const rangeMatch = xRange.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
  if (!rangeMatch) {
    throw new Error(`Invalid xRange format '${xRange}', expected 'min-max' (e.g., '0-100')`);
  }

  const xMin = Number(rangeMatch[1]);
  const xMax = Number(rangeMatch[2]);
  const steps = typeof props.steps === "number" ? props.steps : 50;

  const fn = compileNumericExpression(fx);
  const points: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const x = xMin + (xMax - xMin) * (i / steps);
    const y = fn({ x });
    points.push(x, y);
  }

  props.points = points;
  delete props.fx;
  delete props.xRange;
  delete props.steps;
}

function generateParametricPath(
  props: Record<string, StaticValue>,
  xt: string,
  yt: string,
  tRange: string
): void {
  const rangeMatch = tRange.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
  if (!rangeMatch) {
    throw new Error(`Invalid tRange format '${tRange}', expected 'min-max' (e.g., '0-6.28')`);
  }

  const tMin = Number(rangeMatch[1]);
  const tMax = Number(rangeMatch[2]);
  const steps = typeof props.steps === "number" ? props.steps : 50;

  const fnX = compileNumericExpression(xt);
  const fnY = compileNumericExpression(yt);
  const points: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = tMin + (tMax - tMin) * (i / steps);
    const x = fnX({ t });
    const y = fnY({ t });
    points.push(x, y);
  }

  props.points = points;
  delete props.xt;
  delete props.yt;
  delete props.tRange;
  delete props.steps;
}

const anchorPoints = new Set([
  "center", "top-left", "top-center", "top-right",
  "center-left", "center-right",
  "bottom-left", "bottom-center", "bottom-right"
]);

const anchorAliases: Record<string, AnchorPoint> = {
  top: "top-center",
  left: "center-left",
  right: "center-right",
  bottom: "bottom-center"
};

function canonicalAnchorPoint(value: string): AnchorPoint | null {
  if (anchorPoints.has(value)) return value as AnchorPoint;
  return anchorAliases[value] ?? null;
}

function validateRotateOrder(
  elementId: string,
  value: StaticValue | undefined,
  animated: ElementIR["animated"][string] | undefined
): void {
  if (animated) {
    throw new Error(`${elementId}: rotateOrder must be static`);
  }
  if (value === undefined) return;
  if (typeof value !== "string" || !/^[xyzXYZ]{1,3}$/.test(value)) {
    throw new Error(`${elementId}: rotateOrder must contain 1 to 3 axis letters, e.g. zyx or yz`);
  }

  const axes = new Set(value.toLowerCase());
  if (axes.size !== value.length) {
    throw new Error(`${elementId}: rotateOrder cannot repeat an axis`);
  }
}

function extractParent(staticProps: Record<string, StaticValue>): string | null {
  const parent = staticProps.parent;
  if (parent === undefined) return null;
  delete staticProps.parent;
  return String(parent);
}

function extractZIndex(
  staticProps: Record<string, StaticValue>,
  elementId: string
): number {
  const value = staticProps.zIndex;
  if (value === undefined) return 0;
  delete staticProps.zIndex;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${elementId}: zIndex must be a finite number`);
  }
  return value;
}

function expandDrawCalls(
  calls: DrawCallAST[],
  draws: Map<string, DrawDefinitionAST>,
  variables: Record<string, StaticValue>
): ElementAST[] {
  const elements: ElementAST[] = [];

  for (const call of calls) {
    const draw = draws.get(call.name);
    if (!draw) {
      throw new Error(`Unknown @draw '${call.name}' at line ${call.loc.line}`);
    }

    const bindings = bindDrawArgs(draw, call.args, variables);
    elements.push(...draw.body.map((element) => instantiateDrawElement(call, element, bindings)));
  }

  return elements;
}

function instantiateDrawElement(call: DrawCallAST, element: ElementAST, bindings: MotionBindings): ElementAST {
  return {
    ...element,
    id: `${call.id}-${element.id}`,
    props: Object.fromEntries(Object.entries(element.props).map(([key, value]) => [key, substituteStatic(value, bindings)])),
    lifetime: call.lifetime ?? element.lifetime,
    sceneName: call.sceneName,
    sceneLifetime: call.sceneLifetime,
    body: element.body.map((item) => substituteElementBodyItem(item, bindings)),
    loc: call.loc
  };
}

function substituteElementBodyItem(item: ElementBodyItemAST, bindings: MotionBindings): ElementBodyItemAST {
  if (item.kind === "property") return substitutePropertyAssignment(item, bindings);
  return {
    ...item,
    args: item.args.map((arg) => ({
      ...arg,
      value: substituteStatic(arg.value, bindings)
    }))
  };
}

function bindDrawArgs(
  draw: DrawDefinitionAST,
  args: MotionArgumentAST[],
  variables: Record<string, StaticValue>
): MotionBindings {
  const bindings: MotionBindings = new Map();
  const named = new Map(args.filter((arg) => arg.name !== undefined).map((arg) => [arg.name!, resolveStaticValue(arg.value, variables)]));

  for (const param of draw.params) {
    const value =
      named.get(param.name) ??
      (param.defaultValue === undefined ? undefined : resolveStaticValue(param.defaultValue, variables));
    if (value === undefined) {
      throw new Error(`@draw '${draw.name}' expects '${param.name}' parameter`);
    }
    bindings.set(param.name, value);
  }

  for (const arg of args) {
    if (arg.name && !draw.params.some((param) => param.name === arg.name)) {
      throw new Error(`@draw '${draw.name}' does not accept '${arg.name}' parameter`);
    }
  }

  return bindings;
}

function expandEmitters(
  emitters: EmitterDefinitionAST[],
  variables: Record<string, StaticValue>
): ElementAST[] {
  const elements: ElementAST[] = [];

  for (const emitter of emitters) {
    elements.push(...expandSingleEmitter(emitter, variables));
  }

  return elements;
}

function expandSingleEmitter(
  emitter: EmitterDefinitionAST,
  variables: Record<string, StaticValue>
): ElementAST[] {
  const props = emitter.props;

  const spawnRate = resolveEmitterNumber(props.spawn, variables, "spawn");
  if (spawnRate <= 0) {
    throw new Error(`@emitter '${emitter.id}': spawn rate must be positive`);
  }

  const particleLifetimeMs = resolveEmitterNumber(props.lifetime, variables, "lifetime");
  if (particleLifetimeMs <= 0) {
    throw new Error(`@emitter '${emitter.id}': particle lifetime must be positive`);
  }

  const emitterLifetime = emitter.lifetime ?? emitter.sceneLifetime ?? { startMs: 0, endMs: 10000 };
  const emitterStartMs = emitterLifetime.startMs;
  const emitterEndMs = emitterLifetime.endMs === "end" ? 30000 : emitterLifetime.endMs;
  const emitterDurationMs = emitterEndMs - emitterStartMs;

  const particleCount = Math.ceil((spawnRate * emitterDurationMs) / 1000);
  const spawnIntervalMs = 1000 / spawnRate;

  const elements: ElementAST[] = [];
  const baseSeed = hashString(emitter.id);

  for (let i = 0; i < particleCount; i++) {
    const birthMs = emitterStartMs + i * spawnIntervalMs;
    const deathMs = birthMs + particleLifetimeMs;

    const particleSeed = baseSeed + i * 1337;
    const element = createParticleElement(emitter, i, birthMs, deathMs, particleSeed, variables, particleLifetimeMs);
    elements.push(element);
  }

  return elements;
}

type EmitterPropValue = StaticValue | EmitterRandomAST | EmitterOverLifeAST;

function createParticleElement(
  emitter: EmitterDefinitionAST,
  index: number,
  birthMs: number,
  deathMs: number,
  seed: number,
  variables: Record<string, StaticValue>,
  particleLifetimeMs: number
): ElementAST {
  const template = emitter.template;
  const props = { ...template.props };
  const eProps = emitter.props;

  // Get spawn position (can be from emitOn shape)
  const spawnPos = resolveEmitOnPosition(eProps.emitOn, seed, 1, variables);
  const baseX = spawnPos?.x ?? resolveEmitterRandomValue(eProps.x, seed, 1, variables) ?? 0;
  const baseY = spawnPos?.y ?? resolveEmitterRandomValue(eProps.y, seed, 2, variables) ?? 0;

  const vx = resolveEmitterRandomValue(eProps.vx, seed, 3, variables) ?? 0;
  const vy = resolveEmitterRandomValue(eProps.vy, seed, 4, variables) ?? 0;
  const gravity = resolveEmitterRandomValue(eProps.gravity, seed, 5, variables) ?? 0;
  const turbulence = resolveEmitterRandomValue(eProps.turbulence, seed, 6, variables) ?? 0;

  const body: ElementBodyItemAST[] = [...template.body];
  const lifetimeSec = particleLifetimeMs / 1000;

  if (turbulence === 0) {
    if (vx !== 0) {
      body.push(buildNumericKeyframesProperty("x", baseX, baseX + vx * lifetimeSec, particleLifetimeMs));
    } else {
      props.x = baseX;
    }
  } else {
    let xExpr = `${baseX}`;
    if (vx !== 0) xExpr += ` + ${vx} * t`;
    xExpr += ` + ${turbulence} * sin(t * 3 + ${seed % 100})`;
    body.push({
      kind: "property",
      name: "x",
      value: { kind: "expression", source: xExpr },
      loc: { line: 0, column: 0 }
    });
  }

  if (gravity === 0 && turbulence === 0) {
    if (vy !== 0) {
      body.push(buildNumericKeyframesProperty("y", baseY, baseY + vy * lifetimeSec, particleLifetimeMs));
    } else {
      props.y = baseY;
    }
  } else {
    let yExpr = `${baseY}`;
    if (vy !== 0) yExpr += ` + ${vy} * t`;
    if (gravity !== 0) yExpr += ` + ${gravity / 2} * t^2`;
    if (turbulence !== 0) yExpr += ` + ${turbulence * 0.5} * sin(t * 2.5 + ${(seed + 50) % 100})`;
    body.push({
      kind: "property",
      name: "y",
      value: { kind: "expression", source: yExpr },
      loc: { line: 0, column: 0 }
    });
  }

  // Handle opacity (static, random, or over-life)
  const opacityProp = eProps.opacity;
  if (isOverLife(opacityProp)) {
    body.push(buildNumericOverLifeProperty("opacity", opacityProp, particleLifetimeMs));
  } else {
    const opacity = resolveEmitterRandomValue(opacityProp, seed, 7, variables);
    if (opacity !== undefined) props.opacity = opacity;
  }

  // Handle scale (static, random, or over-life)
  const scaleProp = eProps.scale;
  if (isOverLife(scaleProp)) {
    body.push(buildNumericOverLifeProperty("scale", scaleProp, particleLifetimeMs));
  } else {
    const scale = resolveEmitterRandomValue(scaleProp, seed, 8, variables);
    if (scale !== undefined) props.scale = scale;
  }

  // Handle fill color over life
  const fillProp = eProps.fill;
  if (isOverLife(fillProp) && typeof fillProp.from === "string" && typeof fillProp.to === "string") {
    body.push(buildColorOverLifeProperty("fill", fillProp.from, fillProp.to, lifetimeSec));
  }

  return {
    kind: "element",
    type: template.type,
    id: `${emitter.id}__p${index}`,
    props,
    lifetime: { startMs: Math.round(birthMs), endMs: Math.round(deathMs) },
    body,
    loc: emitter.loc
  };
}

function isOverLife(value: EmitterPropValue | undefined): value is EmitterOverLifeAST {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "over-life";
}

function buildOverLifeExpr(prop: EmitterOverLifeAST, lifetimeSec: number): string {
  const from = Number(prop.from);
  const to = Number(prop.to);
  const delta = to - from;
  // Linear interpolation: from + (to - from) * (t / lifetime)
  return `${from} + ${delta} * (t / ${lifetimeSec})`;
}

function buildNumericOverLifeProperty(
  name: string,
  prop: EmitterOverLifeAST,
  durationMs: number
): ElementBodyItemAST {
  const from = Number(prop.from);
  const to = Number(prop.to);
  if (Number.isFinite(from) && Number.isFinite(to)) {
    return buildNumericKeyframesProperty(name, from, to, durationMs);
  }

  return {
    kind: "property",
    name,
    value: { kind: "expression", source: buildOverLifeExpr(prop, durationMs / 1000) },
    loc: { line: 0, column: 0 }
  };
}

function buildNumericKeyframesProperty(
  name: string,
  from: number,
  to: number,
  durationMs: number
): ElementBodyItemAST {
  return {
    kind: "property",
    name,
    value: {
      kind: "keyframes",
      points: [
        { t: 0, value: from, easing: "linear" },
        { t: durationMs, value: to, easing: "linear" }
      ]
    },
    loc: { line: 0, column: 0 }
  };
}

function buildColorOverLifeProperty(
  name: string,
  fromColor: string,
  toColor: string,
  lifetimeSec: number
): ElementBodyItemAST {
  // Create keyframe animation for color
  const durationMs = lifetimeSec * 1000;
  return {
    kind: "property",
    name,
    value: {
      kind: "keyframes",
      points: [
        { t: 0, value: fromColor, easing: "linear" },
        { t: durationMs, value: toColor, easing: "linear" }
      ]
    },
    loc: { line: 0, column: 0 }
  };
}

function resolveEmitOnPosition(
  value: EmitterPropValue | undefined,
  seed: number,
  offset: number,
  _variables: Record<string, StaticValue>
): { x: number; y: number } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;

  const rand = seededRandom(seed + offset * 9973);

  // Parse circle(cx, cy, r)
  const circleMatch = value.match(/^circle\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (circleMatch) {
    const cx = Number(circleMatch[1]);
    const cy = Number(circleMatch[2]);
    const r = Number(circleMatch[3]);
    const angle = rand * Math.PI * 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  // Parse line(x1, y1, x2, y2)
  const lineMatch = value.match(/^line\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (lineMatch) {
    const x1 = Number(lineMatch[1]);
    const y1 = Number(lineMatch[2]);
    const x2 = Number(lineMatch[3]);
    const y2 = Number(lineMatch[4]);
    return { x: x1 + rand * (x2 - x1), y: y1 + rand * (y2 - y1) };
  }

  // Parse path("M x y ...") - simplified, just use start point with random offset along path
  const pathMatch = value.match(/^path\s*\(\s*"([^"]+)"\s*\)$/);
  if (pathMatch) {
    const d = pathMatch[1]!;
    const moveMatch = d.match(/M\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
    if (moveMatch) {
      return { x: Number(moveMatch[1]), y: Number(moveMatch[2]) };
    }
  }

  return undefined;
}

function resolveEmitterNumber(
  value: EmitterPropValue | undefined,
  variables: Record<string, StaticValue>,
  name: string
): number {
  if (value === undefined) {
    throw new Error(`@emitter requires '${name}' property`);
  }
  if (typeof value === "object" && value !== null && "kind" in value && (value.kind === "random" || value.kind === "over-life")) {
    throw new Error(`@emitter '${name}' cannot be random or over-life`);
  }
  const resolved = resolveStaticValue(value as StaticValue, variables);
  if (typeof resolved === "string") {
    if (resolved.endsWith("/s")) {
      return Number(resolved.slice(0, -2));
    }
    if (resolved.endsWith("s") && !resolved.endsWith("ms")) {
      return Number(resolved.slice(0, -1)) * 1000;
    }
    if (resolved.endsWith("ms")) {
      return Number(resolved.slice(0, -2));
    }
    return Number(resolved);
  }
  if (typeof resolved === "number") {
    return resolved;
  }
  throw new Error(`@emitter '${name}' must be a number`);
}

function resolveEmitterRandomValue(
  value: EmitterPropValue | undefined,
  seed: number,
  offset: number,
  variables: Record<string, StaticValue>
): number | undefined {
  if (value === undefined) return undefined;

  // Skip over-life values - they're handled separately
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "over-life") {
    return undefined;
  }

  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "random") {
    const rand = seededRandom(seed + offset * 9973);
    return value.min + rand * (value.max - value.min);
  }

  const resolved = resolveStaticValue(value as StaticValue, variables);
  if (typeof resolved === "number") return resolved;
  if (typeof resolved === "string") return Number(resolved);
  return undefined;
}

function buildCameraElement(cameras: CameraAST[]): ElementAST | undefined {
  if (cameras.length === 0) return undefined;
  return {
    kind: "element",
    type: "group",
    id: "__camera",
    props: {},
    lifetime: { startMs: 0, endMs: "end" },
    body: cameras.flatMap((camera) => camera.body.map(invertCameraAssignment)),
    loc: cameras[0]!.loc
  };
}

function applyCameraParent(element: ElementAST, cameraId: string | undefined): ElementAST {
  if (!cameraId || element.id === cameraId || hasExplicitParent(element)) return element;
  return {
    ...element,
    props: {
      ...element.props,
      parent: cameraId
    }
  };
}

function hasExplicitParent(element: ElementAST): boolean {
  return element.props.parent !== undefined || element.body.some((item) => item.kind === "property" && item.name === "parent");
}

function invertCameraAssignment(assignment: PropertyAssignmentAST): PropertyAssignmentAST {
  if (assignment.name === "x" || assignment.name === "y" || assignment.name === "rotation") {
    return { ...assignment, value: mapNumericPropertyValue(assignment.value, (value) => -value, (source) => `-(${source})`) };
  }

  if (assignment.name === "scale") {
    return { ...assignment, value: mapNumericPropertyValue(assignment.value, (value) => 1 / value, (source) => `1 / (${source})`) };
  }

  return assignment;
}

function mapNumericPropertyValue(
  value: PropertyValueAST,
  mapNumber: (value: number) => number,
  mapExpression: (source: string) => string
): PropertyValueAST {
  if (typeof value === "number") return mapNumber(value);
  if (!isAnimation(value)) return value;

  if (value.kind === "expression") {
    return { ...value, source: mapExpression(value.source) };
  }

  if (value.kind === "tween") {
    return {
      ...value,
      values: value.values.map((item) => (typeof item === "number" ? mapNumber(item) : item))
    };
  }

  return {
    ...value,
    points: value.points.map((point) => ({
      ...point,
      value: typeof point.value === "number" ? mapNumber(point.value) : point.value
    }))
  };
}

function expandMotionCalls(
  body: ElementBodyItemAST[],
  motions: Map<string, MotionDefinitionAST>,
  variables: Record<string, StaticValue>
): PropertyAssignmentAST[] {
  const expanded: PropertyAssignmentAST[] = [];

  for (const item of body) {
    if (item.kind === "property") {
      expanded.push(resolvePropertyAssignment(item, variables));
      continue;
    }

    const motion = motions.get(item.name);
    if (!motion) {
      throw new Error(`Unknown @motion '${item.name}' at line ${item.loc.line}`);
    }

    const bindings = bindMotionArgs(motion, item.args, variables);
    expanded.push(
      ...motion.body.map((assignment) => resolvePropertyAssignment(substitutePropertyAssignment(assignment, bindings), variables))
    );
  }

  return expanded;
}

function bindMotionArgs(
  motion: MotionDefinitionAST,
  args: MotionArgumentAST[],
  variables: Record<string, StaticValue>
): MotionBindings {
  const bindings: MotionBindings = new Map();
  const positional = args.filter((arg) => arg.name === undefined);
  const named = new Map(args.filter((arg) => arg.name !== undefined).map((arg) => [arg.name!, resolveStaticValue(arg.value, variables)]));

  for (const [index, param] of motion.params.entries()) {
    const value =
      named.get(param.name) ??
      (positional[index] ? resolveStaticValue(positional[index].value, variables) : undefined) ??
      (param.defaultValue === undefined ? undefined : resolveStaticValue(param.defaultValue, variables));
    if (value === undefined) {
      throw new Error(`@motion '${motion.name}' expects '${param.name}' parameter`);
    }
    bindings.set(param.name, value);
  }

  for (const arg of args) {
    if (arg.name && !motion.params.some((param) => param.name === arg.name)) {
      throw new Error(`@motion '${motion.name}' does not accept '${arg.name}' parameter`);
    }
  }

  return bindings;
}

function resolvePropertyAssignment(assignment: PropertyAssignmentAST, variables: Record<string, StaticValue>): PropertyAssignmentAST {
  return {
    ...assignment,
    value: resolvePropertyValue(assignment.value, variables)
  };
}

function resolvePropertyValue(value: PropertyValueAST, variables: Record<string, StaticValue>): PropertyValueAST {
  if (isAnimation(value)) return resolveAnimation(value, variables);
  return resolveStaticValue(value, variables);
}

function resolveAnimation(animation: AnimationAST, variables: Record<string, StaticValue>): AnimationAST {
  if (animation.kind === "expression") {
    return {
      ...animation,
      source: replaceVariableRefs(animation.source, variables)
    };
  }

  if (animation.kind === "tween") {
    return {
      ...animation,
      values: animation.values.map((value) => resolveAnimationValue(value, variables)),
      durationMs: resolveAnimationNumber(animation.durationMs, variables, "tween duration"),
      easing: resolveEasing(animation.easing, variables)
    };
  }

  return {
    ...animation,
    points: animation.points.map((point) => ({
      ...point,
      t: resolveAnimationNumber(point.t, variables, "keyframe time"),
      value: resolveAnimationValue(point.value, variables),
      easing: resolveEasing(point.easing, variables)
    }))
  };
}

function resolveStaticRecord(
  props: Record<string, StaticValue>,
  variables: Record<string, StaticValue>
): Record<string, StaticValue> {
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, resolveStaticValue(value, variables)]));
}

function resolveStaticValue(value: StaticValue, variables: Record<string, StaticValue>): StaticValue {
  if (Array.isArray(value)) {
    return value.map((item) => resolveStaticArrayItem(item, variables));
  }

  if (typeof value === "string" && value.startsWith("$")) {
    const resolved = lookupVariable(value, variables, false);
    if (resolved !== undefined) return resolved;
    return value;
  }

  if (typeof value === "string" && isGradientValue(value)) {
    return replaceVariableRefs(value, variables);
  }

  return value;
}

function resolveStaticArrayItem(value: number | string, variables: Record<string, StaticValue>): number | string {
  if (typeof value !== "string" || !value.startsWith("$")) return value;
  const resolved = lookupVariable(value, variables, false);
  if (resolved === undefined) return value;
  if (typeof resolved !== "number" && typeof resolved !== "string") {
    throw new Error(`Expected '${value}' to resolve to a number or string inside an array`);
  }
  return resolved;
}

function resolveAnimationValue(value: AnimationScalarAST, variables: Record<string, StaticValue>): AnimationScalarAST {
  if (typeof value === "string" && value.startsWith("$")) {
    const resolved = lookupVariable(value, variables, false);
    if (resolved === undefined) return value;
    if (!isAnimationScalarValue(resolved)) {
      throw new Error(`Expected '${value}' to resolve to a number or color`);
    }
    return resolved;
  }

  return value;
}

function resolveAnimationNumber(
  value: AnimationScalarAST,
  variables: Record<string, StaticValue>,
  label: string
): number {
  const resolved = resolveAnimationValue(value, variables);
  if (typeof resolved !== "number") {
    throw new Error(`Expected '${value}' to resolve to a number in ${label}`);
  }
  return resolved;
}

function resolveEasing(easing: string, variables: Record<string, StaticValue>): string {
  if (!easing.startsWith("$")) return easing;
  const resolved = lookupVariable(easing, variables);
  if (typeof resolved !== "string") {
    throw new Error(`Expected '${easing}' to resolve to an easing name`);
  }
  return resolved;
}

function replaceVariableRefs(source: string, variables: Record<string, StaticValue>): string {
  return source.replace(/\$[A-Za-z_][A-Za-z0-9_-]*/g, (ref) => {
    const resolved = lookupVariable(ref, variables, false);
    return resolved !== undefined ? String(resolved) : ref;
  });
}

function lookupVariable(ref: string, variables: Record<string, StaticValue>, throwIfMissing = true): StaticValue | undefined {
  const name = ref.slice(1);
  const value = variables[name];
  if (value === undefined && throwIfMissing) {
    throw new Error(`Cannot resolve variable '${ref}'`);
  }
  return value;
}

function substitutePropertyAssignment(assignment: PropertyAssignmentAST, bindings: MotionBindings): PropertyAssignmentAST {
  return {
    ...assignment,
    value: substitutePropertyValue(assignment.value, bindings)
  };
}

function substitutePropertyValue(value: PropertyValueAST, bindings: MotionBindings): PropertyValueAST {
  if (isAnimation(value)) {
    return substituteAnimation(value, bindings);
  }

  return substituteStatic(value, bindings);
}

function substituteAnimation(animation: AnimationAST, bindings: MotionBindings): AnimationAST {
  if (animation.kind === "expression") {
    let source = animation.source;
    for (const [name, value] of bindings) {
      source = source.replaceAll(`$${name}`, String(value));
    }
    return { ...animation, source };
  }

  if (animation.kind === "tween") {
    return {
      ...animation,
      values: animation.values.map((value) => substituteAnimationValue(value, bindings)),
      durationMs: substituteAnimationNumber(animation.durationMs, bindings, "tween duration"),
      easing: substituteEasing(animation.easing, bindings)
    };
  }

  return {
    ...animation,
    points: animation.points.map((point) => ({
      ...point,
      t: substituteAnimationNumber(point.t, bindings, "keyframe time"),
      value: substituteAnimationValue(point.value, bindings),
      easing: substituteEasing(point.easing, bindings)
    }))
  };
}

function substituteStatic(value: StaticValue, bindings: MotionBindings): StaticValue {
  if (Array.isArray(value)) {
    return value.map((item) => substituteStaticArrayItem(item, bindings));
  }

  if (typeof value === "string" && value.startsWith("$")) {
    return lookupBinding(value, bindings);
  }
  return value;
}

function substituteStaticArrayItem(value: number | string, bindings: MotionBindings): number | string {
  if (typeof value !== "string" || !value.startsWith("$")) return value;
  const bound = lookupBinding(value, bindings);
  if (typeof bound !== "number" && typeof bound !== "string") {
    throw new Error(`Expected '${value}' to resolve to a number or string inside an array`);
  }
  return bound;
}

function substituteAnimationValue(value: AnimationScalarAST, bindings: MotionBindings): AnimationScalarAST {
  if (typeof value === "string" && value.startsWith("$")) {
    const bound = lookupBinding(value, bindings);
    if (!isAnimationScalarValue(bound)) {
      throw new Error(`Expected '${value}' to resolve to a number or color`);
    }
    return bound;
  }
  return value;
}

function substituteAnimationNumber(value: AnimationScalarAST, bindings: MotionBindings, label: string): number {
  const resolved = substituteAnimationValue(value, bindings);
  if (typeof resolved !== "number") {
    throw new Error(`Expected '${value}' to resolve to a number in ${label}`);
  }
  return resolved;
}

function substituteEasing(easing: string, bindings: MotionBindings): string {
  if (!easing.startsWith("$")) return easing;
  const bound = lookupBinding(easing, bindings);
  if (typeof bound !== "string") {
    throw new Error(`Expected '${easing}' to resolve to an easing name`);
  }
  return bound;
}

function lookupBinding(ref: string, bindings: MotionBindings): StaticValue {
  const name = ref.slice(1);
  const value = bindings.get(name);
  if (value === undefined) {
    throw new Error(`Cannot resolve motion parameter '${ref}'`);
  }
  return value;
}

function compileAnimationPoints(animation: Exclude<AnimationAST, { kind: "expression" }>): KeyframeIR[] {
  if (animation.kind === "keyframes") {
    return animation.points
      .map((point) => ({
        t: requireNumber(point.t, "keyframe time"),
        value: requireNumber(point.value, "keyframe value"),
        easing: point.easing
      }))
      .sort((left, right) => left.t - right.t);
  }

  const segmentCount = animation.values.length - 1;
  if (segmentCount <= 0) {
    throw new Error("Tween animation needs at least two values");
  }

  const durationMs = requireNumber(animation.durationMs, "tween duration");
  return animation.values.map((value, index) => ({
    t: Math.round((durationMs * index) / segmentCount),
    value: requireNumber(value, "tween value"),
    easing: index === 0 ? "linear" : animation.easing
  }));
}

function maxAnimatedDuration(animated: ElementIR["animated"]): number | "end" {
  let max = 0;
  for (const property of Object.values(animated)) {
    if (property.type === "expression") {
      return "end";
    }

    for (const point of property.points) {
      max = Math.max(max, point.t);
    }
  }
  return max;
}

function requireNumber(value: AnimationScalarAST, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`Unresolved parameter '${value}' in ${label}`);
  }
  return value;
}

function parseMask(value: string): MaskIR {
  const trimmed = value.trim();
  const invertSuffix = trimmed.endsWith(" invert");
  const maskValue = invertSuffix ? trimmed.slice(0, -7) : trimmed;
  const invert = invertSuffix ? true : undefined;

  // rect(x, y, w, h)
  const rectMatch = /^rect\s*\(([^)]*)\)$/.exec(maskValue);
  if (rectMatch) {
    const parts = rectMatch[1]!
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((part) => !Number.isNaN(part));
    if (parts.length !== 4) {
      throw new Error(`Rect mask expects four numeric values: '${value}'`);
    }
    return { type: "rect", x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]!, invert };
  }

  // circle(cx, cy, r)
  const circleMatch = /^circle\s*\(([^)]*)\)$/.exec(maskValue);
  if (circleMatch) {
    const parts = circleMatch[1]!
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((part) => !Number.isNaN(part));
    if (parts.length !== 3) {
      throw new Error(`Circle mask expects three numeric values (cx, cy, r): '${value}'`);
    }
    return { type: "circle", cx: parts[0]!, cy: parts[1]!, r: parts[2]!, invert };
  }

  // path("M 0,0 L 100,100...")
  const pathMatch = /^path\s*\(\s*"([^"]*)"\s*\)$/.exec(maskValue);
  if (pathMatch) {
    return { type: "path", d: pathMatch[1]!, invert };
  }

  // points [(x1,y1), (x2,y2), ...] or points [(x1,y1), (x2,y2), ...] closed
  const pointsMatch = /^points\s*\[([^\]]*)\](?:\s+(closed))?$/.exec(maskValue);
  if (pointsMatch) {
    const pointsStr = pointsMatch[1]!;
    const closed = pointsMatch[2] === "closed" ? true : undefined;
    const pointRegex = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
    const points: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = pointRegex.exec(pointsStr)) !== null) {
      points.push(Number(match[1]), Number(match[2]));
    }
    if (points.length < 4) {
      throw new Error(`Points mask requires at least 2 points: '${value}'`);
    }
    return { type: "points", points, closed, invert };
  }

  // fx("expression", xMin, xMax, yBase, steps) - function mask y = f(x), closed to yBase
  // If expression contains 't', it's animated (evaluated at runtime)
  const fxMatch = /^fx\s*\(\s*"([^"]*)"\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*(?:,\s*([^)]+))?\s*\)$/.exec(maskValue);
  if (fxMatch) {
    const expr = fxMatch[1]!;
    const xMin = Number(fxMatch[2]!.trim());
    const xMax = Number(fxMatch[3]!.trim());
    const yBase = Number(fxMatch[4]!.trim());
    const steps = fxMatch[5] ? Number(fxMatch[5].trim()) : 50;
    if (Number.isNaN(xMin) || Number.isNaN(xMax) || Number.isNaN(yBase) || Number.isNaN(steps)) {
      throw new Error(`fx mask expects numeric xMin, xMax, yBase, steps values: '${value}'`);
    }
    // Check if expression uses time variable 't'
    const usesTime = /\bt\b/.test(expr);
    if (usesTime) {
      // Store expression for runtime evaluation
      return { type: "fx", expr, xMin, xMax, yBase, steps, invert };
    }
    // Static: compute points at compile time
    const fn = compileNumericExpression(expr);
    const points: number[] = [];
    points.push(xMin, yBase);
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (xMax - xMin) * (i / steps);
      const y = fn({ x });
      points.push(x, y);
    }
    points.push(xMax, yBase);
    return { type: "points", points, closed: true, invert };
  }

  // xt("xExpr", "yExpr", tMin, tMax, steps) - parametric mask
  // If expressions contain 'time', it's animated (evaluated at runtime)
  const xtMatch = /^xt\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*([^,]+)\s*,\s*([^,]+)\s*(?:,\s*([^)]+))?\s*\)$/.exec(maskValue);
  if (xtMatch) {
    const xExpr = xtMatch[1]!;
    const yExpr = xtMatch[2]!;
    const tMin = Number(xtMatch[3]!.trim());
    const tMax = Number(xtMatch[4]!.trim());
    const steps = xtMatch[5] ? Number(xtMatch[5].trim()) : 50;
    if (Number.isNaN(tMin) || Number.isNaN(tMax) || Number.isNaN(steps)) {
      throw new Error(`xt mask expects numeric tMin, tMax, steps values: '${value}'`);
    }
    // Check if expressions use time variable 'time'
    const usesTime = /\btime\b/.test(xExpr) || /\btime\b/.test(yExpr);
    if (usesTime) {
      // Store expressions for runtime evaluation
      return { type: "xt", xExpr, yExpr, tMin, tMax, steps, closed: true, invert };
    }
    // Static: compute points at compile time
    const fnX = compileNumericExpression(xExpr);
    const fnY = compileNumericExpression(yExpr);
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = tMin + (tMax - tMin) * (i / steps);
      const x = fnX({ t });
      const y = fnY({ t });
      points.push(x, y);
    }
    return { type: "points", points, closed: true, invert };
  }

  // text("content", x, y, size) or text("content", x, y, size, "font")
  const textMatch = /^text\s*\(\s*"([^"]*)"\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,)]+)(?:\s*,\s*"([^"]*)")?\s*\)$/.exec(maskValue);
  if (textMatch) {
    const x = Number(textMatch[2]!.trim());
    const y = Number(textMatch[3]!.trim());
    const size = Number(textMatch[4]!.trim());
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(size)) {
      throw new Error(`Text mask expects numeric x, y, size values: '${value}'`);
    }
    return { type: "text", content: textMatch[1]!, x, y, size, font: textMatch[5], invert };
  }

  throw new Error(`Unsupported mask '${value}'. Expected rect, circle, path, points, fx, xt, or text`);
}

interface SystemRules {
  palette?: Set<string>;
  fonts?: Set<string>;
  durations?: Set<number>;
  easing?: Set<string>;
}

function validateSystemConstraints(systems: SystemAST[], drafts: CompiledElementDraft[], canvasBg?: string): void {
  if (systems.length === 0) return;
  const rules = mergeSystemRules(systems);

  if (rules.palette && canvasBg && canvasBg !== "transparent") {
    assertAllowedColor(rules.palette, canvasBg, "canvas background");
  }

  for (const draft of drafts) {
    const element = draft.element;
    if (rules.palette) {
      for (const propName of ["fill", "stroke"] as const) {
        const value = element.static[propName];
        if (typeof value === "string" && value.startsWith("#")) {
          assertAllowedColor(rules.palette, value, `${element.id}.${propName}`);
        }
      }
    }

    if (rules.fonts) {
      const font = element.static.font;
      if (typeof font === "string" && !rules.fonts.has(font)) {
        throw new Error(`@system fonts rejects ${element.id}.font '${font}'`);
      }
    }

    if (rules.durations || rules.easing) {
      for (const [propertyName, property] of Object.entries(element.animated)) {
        if (property.type !== "keyframes") continue;
        for (const point of property.points) {
          if (rules.durations && point.t > 0 && !rules.durations.has(point.t)) {
            throw new Error(`@system durations rejects ${element.id}.${propertyName} keyframe at ${point.t}ms`);
          }
          if (rules.easing && !(point.t === 0 && point.easing === "linear") && !rules.easing.has(point.easing)) {
            throw new Error(`@system easing rejects ${element.id}.${propertyName} easing '${point.easing}'`);
          }
        }
      }
    }
  }
}

function mergeSystemRules(systems: SystemAST[]): SystemRules {
  const rules: SystemRules = {};
  for (const system of systems) {
    if (system.props.palette) {
      rules.palette = new Set(parseList(system.props.palette).map((item) => item.toLowerCase()));
    }
    if (system.props.fonts) {
      rules.fonts = new Set(parseList(system.props.fonts).map((item) => item.split(/\s+/)[0]!).filter(Boolean));
    }
    if (system.props.durations) {
      rules.durations = new Set(parseList(system.props.durations).map(parseDurationTokenMs));
    }
    if (system.props.easing) {
      rules.easing = new Set(parseList(system.props.easing));
    }
  }
  return rules;
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDurationTokenMs(value: string): number {
  if (value.endsWith("ms")) return Math.round(Number(value.slice(0, -2)));
  if (value.endsWith("s")) return Math.round(Number(value.slice(0, -1)) * 1000);
  return Math.round(Number(value));
}

function parseCompilerNumber(value: string): number {
  if (value.endsWith("px")) return Number(value.slice(0, -2));
  if (value.endsWith("ms")) return Number(value.slice(0, -2));
  if (value.endsWith("s")) return Number(value.slice(0, -1)) * 1000;
  if (value.endsWith("deg")) return (Number(value.slice(0, -3)) * Math.PI) / 180;
  if (value.endsWith("rad")) return Number(value.slice(0, -3));
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`repeatOffset value '${value}' must be numeric`);
  }
  return parsed;
}

function assertAllowedColor(palette: Set<string>, value: string, label: string): void {
  if (!palette.has(value.toLowerCase())) {
    throw new Error(`@system palette rejects ${label} '${value}'`);
  }
}

function isAnimation(value: PropertyValueAST): value is AnimationAST {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value;
}

function isAnimationScalarValue(value: StaticValue): value is AnimationScalarAST {
  return typeof value === "number" || isColorValue(value);
}

function isColorValue(value: StaticValue): value is string {
  return typeof value === "string" && (value.startsWith("#") || value === "transparent");
}

function isGradientValue(value: string): boolean {
  return /^(linear|radial|linear-gradient|radial-gradient)\s*\(/.test(value.trim());
}

function isColorAnimation(animation: Exclude<AnimationAST, { kind: "expression" }>): boolean {
  if (animation.kind === "tween") {
    return animation.values.some(isColorValue);
  }
  return animation.points.some((point) => isColorValue(point.value));
}

function compileColorAnimationPoints(animation: Exclude<AnimationAST, { kind: "expression" }>): ColorKeyframeIR[] {
  if (animation.kind === "keyframes") {
    return animation.points
      .map((point) => ({
        t: requireNumber(point.t, "keyframe time"),
        value: requireColorString(point.value, "keyframe value"),
        easing: point.easing
      }))
      .sort((left, right) => left.t - right.t);
  }

  const segmentCount = animation.values.length - 1;
  if (segmentCount <= 0) {
    throw new Error("Tween animation needs at least two values");
  }

  const durationMs = requireNumber(animation.durationMs, "tween duration");
  return animation.values.map((value, index) => ({
    t: Math.round((durationMs * index) / segmentCount),
    value: requireColorString(value, "tween value"),
    easing: index === 0 ? "linear" : animation.easing
  }));
}

function requireColorString(value: AnimationScalarAST, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected color string in ${label}, got ${typeof value}`);
  }
  return value;
}

function compileAudioTracks(
  tracks: AudioTrackAST[],
  fallbackEnd: number,
  variables: Record<string, StaticValue>
): AudioTrackIR[] {
  return tracks.map((track, index) => {
    const props = resolveStaticRecord(track.props, variables);
    const lifetime = track.lifetime ?? track.sceneLifetime ?? { startMs: 0, endMs: "end" };

    const volume = typeof props.volume === "number" ? props.volume : 1;
    const pan = typeof props.pan === "number" ? props.pan : 0;
    const fadeIn = typeof props["fade-in"] === "number" ? props["fade-in"] : 0;
    const fadeOut = typeof props["fade-out"] === "number" ? props["fade-out"] : 0;
    const trim = typeof props.trim === "number" ? props.trim : 0;
    const loop = props.loop === true || props.loop === "true";

    return {
      id: track.id || `audio_${index}`,
      src: track.src,
      lifetime: {
        start: lifetime.startMs,
        end: lifetime.endMs === "end" ? fallbackEnd : lifetime.endMs
      },
      volume,
      pan,
      fadeIn,
      fadeOut,
      trim,
      loop
    };
  });
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999.9999) * 10000;
  return x - Math.floor(x);
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
