import type { AnchorPoint, AnimatedPropertyIR, ColorKeyframeIR, ElementIR, KeyframeIR, MaskIR, SceneIR, StaticValue } from "../../schema/src";
import { parseColor, lerpColor, colorToHex } from "../../exporter/src/color";
import { compileNumericExpression } from "../../parser/src";
import { getEasingFunction } from "./easing";
import { normalizeRotateOrder } from "./transform3d";

export interface FrameElement {
  id: string;
  type: ElementIR["type"];
  props: Record<string, StaticValue>;
  comp: string;
  anchor: AnchorPoint;
  origin: AnchorPoint;
  mask: MaskIR | null;
  zIndex: number;
  parent: string | null;
}

export interface FrameState {
  t: number;
  canvas: SceneIR["canvas"];
  elements: FrameElement[];
}

export interface ResolveFrameOptions {
  skipCameraTransform?: boolean;
}

const sortedKeyframeCache = new WeakMap<KeyframeIR[], KeyframeIR[]>();
const sortedColorKeyframeCache = new WeakMap<ColorKeyframeIR[], ColorKeyframeIR[]>();

export function resolveFrame(scene: SceneIR, tMs: number, options: ResolveFrameOptions = {}): FrameState {
  // Filter alive elements, with particle visibility culling for performance
  const aliveElements = scene.elements
    .filter((element) => isAlive(element, tMs) && isParticleVisible(element, tMs))
    .sort((left, right) => left.zIndex - right.zIndex);
  const resolvedElements = aliveElements.map((element) => resolveBaseElement(element, tMs));
  resolveExpressionProperties(aliveElements, resolvedElements, tMs);
  applyMotionPathProperties(resolvedElements);

  const elements = options.skipCameraTransform
    ? applyParentTransforms(resolvedElements.map((el) => (el.parent === "__camera" ? { ...el, parent: null } : el)))
    : applyParentTransforms(resolvedElements);

  return {
    t: tMs,
    canvas: scene.canvas,
    elements: sortByFrameZIndex(elements)
  };
}

function isAlive(element: ElementIR, tMs: number): boolean {
  return tMs >= element.lifetime.start && tMs <= element.lifetime.end;
}

// Check if a particle element is visible (has non-zero opacity)
// Used to skip processing of invisible particles for performance
function isParticleVisible(element: ElementIR, tMs: number): boolean {
  // Only apply to particle elements (those with __pN suffix pattern from emitters)
  if (!/__p\d+$/.test(element.id)) return true;

  // Check static opacity
  const staticOpacity = element.static.opacity;
  if (typeof staticOpacity === "number" && staticOpacity <= 0) return false;

  // Check if opacity animation ends at 0 and we're past 90% of lifetime
  const opacityAnim = element.animated.opacity;
  if (opacityAnim && opacityAnim.type === "keyframes") {
    const points = opacityAnim.points;
    if (points.length >= 2) {
      const lastPoint = points[points.length - 1]!;
      // If fading to 0 and we're at the end, skip
      if (lastPoint.value === 0) {
        const localT = tMs - element.lifetime.start;
        if (localT >= lastPoint.t) return false;
      }
    }
  }

  return true;
}

function resolveBaseElement(element: ElementIR, tMs: number): FrameElement {
  return {
    id: element.id,
    type: element.type,
    props: resolveBaseProps(element, tMs),
    comp: element.comp,
    anchor: element.anchor,
    origin: element.origin,
    mask: element.mask,
    zIndex: element.zIndex,
    parent: element.parent
  };
}

function resolveBaseProps(element: ElementIR, tMs: number): Record<string, StaticValue> {
  const props: Record<string, StaticValue> = { ...element.static };
  const localT = tMs - element.lifetime.start;

  for (const [name, property] of Object.entries(element.animated)) {
    if (property.type === "keyframes") {
      props[name] = evaluateAnimatedProperty(property, localT);
    } else if (property.type === "color-keyframes") {
      props[name] = evaluateColorKeyframes(property.points, localT);
    }
  }

  return props;
}

function resolveExpressionProperties(source: ElementIR[], resolved: FrameElement[], tMs: number): void {
  const pending = new Set<string>();
  for (const [elementIndex, element] of source.entries()) {
    for (const [propertyName, property] of Object.entries(element.animated)) {
      if (property.type === "expression") {
        pending.add(`${elementIndex}:${propertyName}`);
      }
    }
  }

  // Build scope once and update incrementally
  const scope = buildExpressionScope(resolved);

  let lastError: unknown;
  while (pending.size > 0) {
    let progress = 0;

    for (const key of [...pending]) {
      const [elementIndexText, propertyName] = key.split(":");
      const elementIndex = Number(elementIndexText);
      const element = source[elementIndex];
      const frameElement = resolved[elementIndex];
      const property = element?.animated[propertyName ?? ""];
      if (!element || !frameElement || !property || property.type !== "expression") {
        pending.delete(key);
        progress += 1;
        continue;
      }

      try {
        const localT = tMs - element.lifetime.start;
        const result = evaluateAnimatedProperty(property, localT, scope);
        frameElement.props[propertyName!] = result;
        // Update scope with newly resolved value for dependent expressions
        if (typeof result === "number" && Number.isFinite(result)) {
          scope[`${frameElement.id}.${propertyName}`] = result;
        }
        pending.delete(key);
        progress += 1;
      } catch (error) {
        lastError = error;
      }
    }

    if (progress === 0) {
      throw lastError instanceof Error ? lastError : new Error("Could not resolve expression dependencies");
    }
  }
}

function buildExpressionScope(elements: FrameElement[]): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const element of elements) {
    for (const [name, value] of Object.entries(element.props)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        scope[`${element.id}.${name}`] = value;
      }
    }
  }
  return scope;
}

function applyMotionPathProperties(elements: FrameElement[]): void {
  for (const element of elements) {
    const motionPath = element.props.motionPath;
    if (typeof motionPath !== "string" || motionPath.trim().length === 0) continue;

    const progress = numeric(element.props.motionProgress, 0);
    const sample = sampleSvgPath(motionPath, progress);
    if (!sample) continue;

    element.props.x = numeric(element.props.x, 0) + sample.x;
    element.props.y = numeric(element.props.y, 0) + sample.y;

    const rotate = element.props.motionRotate;
    if (rotate === "auto" || rotate === true) {
      element.props.rotation = numeric(element.props.rotation, 0) + sample.angle;
    }
  }
}

function applyParentTransforms(elements: FrameElement[]): FrameElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const resolved = new Map<string, FrameElement | null>();

  function resolveElement(element: FrameElement, stack: Set<string>): FrameElement | null {
    if (resolved.has(element.id)) return resolved.get(element.id)!;
    if (!element.parent) {
      resolved.set(element.id, element);
      return element;
    }

    if (stack.has(element.id)) {
      throw new Error(`Parent transform cycle involving '${element.id}'`);
    }

    const parent = byId.get(element.parent);
    if (!parent) {
      resolved.set(element.id, null);
      return null;
    }

    stack.add(element.id);
    const resolvedParent = resolveElement(parent, stack);
    stack.delete(element.id);

    if (!resolvedParent) {
      resolved.set(element.id, null);
      return null;
    }

    const composed = {
      ...element,
      props: composeParentProps(resolvedParent, element)
    };
    resolved.set(element.id, composed);
    return composed;
  }

  return elements
    .map((element) => resolveElement(element, new Set()))
    .filter((element): element is FrameElement => element !== null);
}

function composeParentProps(parentElement: FrameElement, childElement: FrameElement): Record<string, StaticValue> {
  const parent = parentElement.props;
  const child = childElement.props;
  const result: Record<string, StaticValue> = { ...child };
  const parentX = numeric(parent.x, 0);
  const parentY = numeric(parent.y, 0);
  const parentZ = numeric(parent.z, 0);
  const parentScale = numeric(parent.scale, 1);
  const childScale = numeric(child.scale, 1);
  const parentScaleX = numeric(parent.scaleX, 1);
  const parentScaleY = numeric(parent.scaleY, 1);
  const childScaleX = numeric(child.scaleX, 1);
  const childScaleY = numeric(child.scaleY, 1);
  const parentRotation = numeric(parent.rotation, 0);
  const parentRotateX = numeric(parent.rotateX, 0);
  const parentRotateY = numeric(parent.rotateY, 0);
  const parentRotateZ = numeric(parent.rotateZ, 0);
  const parentRotateOrder = stringValue(parent.rotateOrder, "zyx");
  const parentMatrix = parentWorldMatrix(parent, parentRotateX, parentRotateY, parentRotation + parentRotateZ, parentRotateOrder);

  let px = numeric(child.x, 0) * parentScale * parentScaleX;
  let py = numeric(child.y, 0) * parentScale * parentScaleY;
  let pz = numeric(child.z, 0) * parentScale;

  const combinedZ = parentRotation + parentRotateZ;

  // For 3D parents, rotate the child's position by the parent's world matrix.
  if (parentMatrix) {
    const rotatedPosition = applyMatrix3(parentMatrix, px, py, pz);
    const parentOffsetX = numeric(parent._3dOffsetX, 0);
    const parentOffsetY = numeric(parent._3dOffsetY, 0);
    const parentOffsetZ = numeric(parent._3dOffsetZ, 0);
    px = parentOffsetX + rotatedPosition.x;
    py = parentOffsetY + rotatedPosition.y;
    pz = parentOffsetZ + rotatedPosition.z;

    // For 3D groups: set the world position at the GROUP center,
    // and encode the child's 3D offset + rotation into a rotation matrix
    // that the renderer will use to compute actual vertex positions.
    // The child's world position is the group center (for correct perspective),
    // and _localMat encodes the full transform from local vertices to world offset.
    const childMatrix = childLocalMatrix(child);
    const rm = billboardMode(child) ? billboardMatrix(child) : multiplyMatrix3(parentMatrix, childMatrix);

    // Store world position at group center for correct perspective projection
    result.x = parentX;
    result.y = parentY;
    result.z = parentZ;
    // Store the 3D offset from group center to face center (already rotated)
    // and the full rotation matrix for vertex transformation
    result._3dOffsetX = px;
    result._3dOffsetY = py;
    result._3dOffsetZ = pz;
    if (!billboardMode(child)) {
      result._3dParentMat = parentMatrix as unknown as StaticValue;
    } else {
      delete result._3dParentMat;
    }
    result._3dMat = rm as unknown as StaticValue;
    result.rotation = 0;
    result.rotateX = 0;
    result.rotateY = 0;
    result.rotateZ = 0;
    result.scale = parentScale * childScale;
    result.scaleX = parentScaleX * childScaleX;
    result.scaleY = parentScaleY * childScaleY;
  } else {
    // 2D parent: use simple 2D rotation for position
    if (combinedZ !== 0) {
      const cos = Math.cos(combinedZ);
      const sin = Math.sin(combinedZ);
      const nx = px * cos - py * sin;
      const ny = px * sin + py * cos;
      px = nx; py = ny;
    }

    result.x = parentX + px;
    result.y = parentY + py;
    result.z = parentZ + pz;
    result.scale = parentScale * childScale;
    result.rotation = parentRotation + numeric(child.rotation, 0);
    result.rotateX = numeric(child.rotateX, 0);
    result.rotateY = numeric(child.rotateY, 0);
    result.rotateZ = parentRotateZ + numeric(child.rotateZ, 0);
    result.scaleX = parentScaleX * childScaleX;
    result.scaleY = parentScaleY * childScaleY;
  }

  // Transform line endpoints (x1,y1,x2,y2) with parent rotation and scale
  if (!parentMatrix && (child.x1 !== undefined || child.y1 !== undefined || child.x2 !== undefined || child.y2 !== undefined)) {
    const lx1 = numeric(child.x1, 0) * parentScale * parentScaleX;
    const ly1 = numeric(child.y1, 0) * parentScale * parentScaleY;
    const lx2 = numeric(child.x2, 0) * parentScale * parentScaleX;
    const ly2 = numeric(child.y2, 0) * parentScale * parentScaleY;
    const cosZ = Math.cos(combinedZ);
    const sinZ = Math.sin(combinedZ);
    result.x1 = lx1 * cosZ - ly1 * sinZ;
    result.y1 = lx1 * sinZ + ly1 * cosZ;
    result.x2 = lx2 * cosZ - ly2 * sinZ;
    result.y2 = lx2 * sinZ + ly2 * cosZ;
    result.rotation = numeric(child.rotation, 0);
    result.rotateZ = numeric(child.rotateZ, 0);
    result.scale = childScale;
    result.scaleX = childScaleX;
    result.scaleY = childScaleY;
  }

  if (typeof parent.opacity === "number") {
    result.opacity = numeric(child.opacity, 1) * parent.opacity;
  }

  const parentSort = sortMode(parent.sort);
  const inheritedSort = parentSort ?? sortMode(parent._sortMode);
  if (inheritedSort) {
    result._sortMode = inheritedSort;
    result._sortGroup = parentSort ? parentElement.id : stringValue(parent._sortGroup, parentElement.id);
  }

  return result;
}

// Compose two sets of Euler angles (XYZ order) via rotation matrix multiplication.
// Returns the resulting Euler angles that equal R_parent * R_child.
function composeRotationMatrices(
  prx: number, pry: number, prz: number,
  crx: number, cry: number, crz: number
): { rx: number; ry: number; rz: number } {
  // Build parent rotation matrix (apply Z, then Y, then X — matching rotate3D order)
  const m1 = eulerToMatrix(prx, pry, prz);
  const m2 = eulerToMatrix(crx, cry, crz);
  // Multiply: result = parent * child
  const r = multiplyMatrix3(m1, m2);
  return matrixToEuler(r);
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

function parentWorldMatrix(
  props: Record<string, StaticValue>,
  rx: number,
  ry: number,
  rz: number,
  order: string
): Mat3 | null {
  const inherited = matrixValue(props._3dMat);
  if (inherited) return inherited;

  const view = matrixValue(props._viewMat);
  const hasEuler3D = rx !== 0 || ry !== 0;
  const hasEuler = hasEuler3D || rz !== 0;

  if (view) {
    return hasEuler ? multiplyMatrix3(view, eulerToMatrix(rx, ry, rz, order)) : view;
  }

  // A pure Z rotation is still a normal 2D parent transform unless a view matrix
  // has moved the parent into 3D.
  return hasEuler3D ? eulerToMatrix(rx, ry, rz, order) : null;
}

function childLocalMatrix(props: Record<string, StaticValue>): Mat3 {
  const view = matrixValue(props._viewMat);
  const rx = numeric(props.rotateX, 0);
  const ry = numeric(props.rotateY, 0);
  const rz = numeric(props.rotation, 0) + numeric(props.rotateZ, 0);
  const hasEuler = rx !== 0 || ry !== 0 || rz !== 0;

  if (view) {
    return hasEuler ? multiplyMatrix3(view, eulerToMatrix(rx, ry, rz, stringValue(props.rotateOrder, "zyx"))) : view;
  }

  return hasEuler ? eulerToMatrix(rx, ry, rz, stringValue(props.rotateOrder, "zyx")) : identityMatrix3();
}

function billboardMode(props: Record<string, StaticValue>): string | null {
  const value = props.billboard;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "screen" || normalized === "y" ? normalized : null;
}

function billboardMatrix(props: Record<string, StaticValue>): Mat3 {
  const rz = numeric(props.rotation, 0) + numeric(props.rotateZ, 0);
  return rz !== 0 ? eulerToMatrix(0, 0, rz, stringValue(props.rotateOrder, "zyx")) : identityMatrix3();
}

function identityMatrix3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function matrixValue(value: StaticValue | undefined): Mat3 | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  if (!value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  return value as Mat3;
}

function eulerToMatrix(rx: number, ry: number, rz: number, order = "zyx"): Mat3 {
  let result: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const axis of normalizeRotateOrder(order)) {
    result = multiplyMatrix3(axisRotationMatrix(axis, rx, ry, rz), result);
  }
  return result;
}

function axisRotationMatrix(axis: string, rx: number, ry: number, rz: number): Mat3 {
  if (axis === "x") {
    const cos = Math.cos(rx);
    const sin = Math.sin(rx);
    return [1, 0, 0, 0, cos, -sin, 0, sin, cos];
  }
  if (axis === "y") {
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    return [cos, 0, sin, 0, 1, 0, -sin, 0, cos];
  }
  const cos = Math.cos(rz);
  const sin = Math.sin(rz);
  return [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
}

function multiplyMatrix3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0]*b[0] + a[1]*b[3] + a[2]*b[6],  a[0]*b[1] + a[1]*b[4] + a[2]*b[7],  a[0]*b[2] + a[1]*b[5] + a[2]*b[8],
    a[3]*b[0] + a[4]*b[3] + a[5]*b[6],  a[3]*b[1] + a[4]*b[4] + a[5]*b[7],  a[3]*b[2] + a[4]*b[5] + a[5]*b[8],
    a[6]*b[0] + a[7]*b[3] + a[8]*b[6],  a[6]*b[1] + a[7]*b[4] + a[8]*b[7],  a[6]*b[2] + a[7]*b[5] + a[8]*b[8]
  ];
}

function applyMatrix3(m: Mat3, x: number, y: number, z: number): { x: number; y: number; z: number } {
  return {
    x: m[0] * x + m[1] * y + m[2] * z,
    y: m[3] * x + m[4] * y + m[5] * z,
    z: m[6] * x + m[7] * y + m[8] * z
  };
}

function matrixToEuler(m: Mat3): { rx: number; ry: number; rz: number } {
  // Extract Euler XYZ from rotation matrix (matching eulerToMatrix convention)
  // m[2] = sy, so ry = asin(m[2])
  const sy = m[2]!;
  const ry = Math.asin(Math.max(-1, Math.min(1, sy)));
  let rx: number, rz: number;
  if (Math.abs(sy) < 0.9999) {
    // m[5] = -sx*cy, m[8] = cx*cy → rx = atan2(-m[5], m[8])
    rx = Math.atan2(-m[5]!, m[8]!);
    // m[1] = -cy*sz, m[0] = cy*cz → rz = atan2(-m[1], m[0])
    rz = Math.atan2(-m[1]!, m[0]!);
  } else {
    // Gimbal lock
    rx = Math.atan2(m[7]!, m[4]!);
    rz = 0;
  }
  return { rx, ry, rz };
}

function sortByFrameZIndex(elements: FrameElement[]): FrameElement[] {
  return elements
    .map((element, index) => ({
      element,
      index,
      zIndex: numeric(element.props.zIndex, element.zIndex),
      sortMode: sortMode(element.props._sortMode) ?? sortMode(element.props.sort) ?? "depth",
      sortGroup: stringValue(element.props._sortGroup, ""),
      // Compute average Z of transformed vertices for proper depth sorting
      depth3d: computeAverageZ(element)
    }))
    .sort((left, right) => {
      if (left.sortGroup && left.sortGroup === right.sortGroup) {
        if (left.sortMode === "manual" || right.sortMode === "manual") {
          return left.index - right.index;
        }
        if (left.sortMode === "layer" || right.sortMode === "layer") {
          if (left.zIndex !== right.zIndex) return left.zIndex - right.zIndex;
          return left.index - right.index;
        }
      }

      if (left.zIndex !== right.zIndex) return left.zIndex - right.zIndex;
      if (left.depth3d !== right.depth3d) return left.depth3d - right.depth3d;
      return left.index - right.index;
    })
    .map((item) => item.element);
}

function sortMode(value: StaticValue | undefined): "depth" | "manual" | "layer" | null {
  return value === "depth" || value === "manual" || value === "layer" ? value : null;
}

function computeAverageZ(element: FrameElement): number {
  const props = element.props;
  const mat = props._3dMat as number[] | undefined;
  const localMat = mat ?? localTransformMatrix(props) ?? identityMatrix3();

  const baseZ = numeric(props.z, 0) + numeric(props._3dOffsetZ, 0);
  const parentMat = mat ? (props._3dParentMat as number[] | undefined) : undefined;
  const pivot = originOffsetForElement(element);
  const pivotZ = parentMat ? parentMat[6]! * pivot.x + parentMat[7]! * pivot.y : 0;
  const scale = numeric(props.scale, 1);
  const scaleX = numeric(props.scaleX, 1);
  const scaleY = numeric(props.scaleY, 1);

  const vertices = getShapeVertices3D(element);
  if (vertices.length === 0) {
    return baseZ + numeric(props.depthBias, 0);
  }

  const solidDepthScale = props._solidDepth === true ? numeric(props._solidDepthScale, 0.001) : null;
  let totalZ = 0;
  let totalLocalZ = 0;
  for (const v of vertices) {
    const lx = (v.x - pivot.x) * scale * scaleX;
    const ly = (v.y - pivot.y) * scale * scaleY;
    const lz = v.z * scale;
    const rz = localMat[6]! * lx + localMat[7]! * ly + localMat[8]! * lz;
    const localZ = pivotZ + rz;
    totalLocalZ += localZ;
    totalZ += baseZ + localZ;
  }

  if (solidDepthScale !== null) {
    // Generated solids should sort against other objects by their object center,
    // while a tiny local term keeps their own faces ordered internally.
    return baseZ + (totalLocalZ / vertices.length) * solidDepthScale + numeric(props.depthBias, 0);
  }
  return totalZ / vertices.length + numeric(props.depthBias, 0);
}

function localTransformMatrix(props: Record<string, StaticValue>): Mat3 | null {
  const rx = numeric(props.rotateX, 0);
  const ry = numeric(props.rotateY, 0);
  const rz = numeric(props.rotation, 0) + numeric(props.rotateZ, 0);
  if (rx === 0 && ry === 0 && rz === 0) return null;
  return eulerToMatrix(rx, ry, rz, stringValue(props.rotateOrder, "zyx"));
}

function originOffsetForElement(element: FrameElement): { x: number; y: number } {
  if (element.origin === "center") return { x: 0, y: 0 };

  const vertices = getShapeVertices(element);
  const bounds = boundsFromVertices(vertices);
  return pointForAnchor(element.origin, bounds);
}

interface Bounds2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function boundsFromVertices(vertices: Array<{ x: number; y: number }>): Bounds2D {
  if (vertices.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
  }
  return { minX, maxX, minY, maxY };
}

function pointForAnchor(anchor: AnchorPoint, bounds: Bounds2D): { x: number; y: number } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  switch (anchor) {
    case "top-left": return { x: bounds.minX, y: bounds.minY };
    case "top-center": return { x: cx, y: bounds.minY };
    case "top-right": return { x: bounds.maxX, y: bounds.minY };
    case "center-left": return { x: bounds.minX, y: cy };
    case "center": return { x: 0, y: 0 };
    case "center-right": return { x: bounds.maxX, y: cy };
    case "bottom-left": return { x: bounds.minX, y: bounds.maxY };
    case "bottom-center": return { x: cx, y: bounds.maxY };
    case "bottom-right": return { x: bounds.maxX, y: bounds.maxY };
  }
}

function getShapeVertices(element: FrameElement): { x: number; y: number }[] {
  const props = element.props;
  const type = element.type;

  if (type === "rect") {
    const w = numeric(props.w, 0);
    const h = numeric(props.h, 0);
    const anchor = element.anchor;
    const off = anchorOffset(anchor, w, h);
    return [
      { x: off.x, y: off.y },
      { x: off.x + w, y: off.y },
      { x: off.x + w, y: off.y + h },
      { x: off.x, y: off.y + h }
    ];
  }
  if (type === "circle" || type === "ellipse") {
    const r = numeric(props.r, 0);
    const rx = numeric(props.rx, r);
    const ry = numeric(props.ry, r);
    return [
      { x: 0, y: -ry },
      { x: rx, y: 0 },
      { x: 0, y: ry },
      { x: -rx, y: 0 }
    ];
  }
  if (type === "path") {
    const d = props.d;
    if (typeof d === "string") {
      return parseSvgPathVertices(d);
    }
  }
  if (type === "line") {
    return [
      { x: numeric(props.x1, 0), y: numeric(props.y1, 0) },
      { x: numeric(props.x2, 0), y: numeric(props.y2, 0) }
    ];
  }
  return [{ x: 0, y: 0 }];
}

function getShapeVertices3D(element: FrameElement): { x: number; y: number; z: number }[] {
  const props = element.props;
  if (element.type === "line3d") {
    const from = vector3Value(props.from);
    const to = vector3Value(props.to);
    return [from, to];
  }

  if (element.type === "poly3d" || element.type === "path3d") {
    const points = numericArray(props.points);
    const vertices: { x: number; y: number; z: number }[] = [];
    for (let index = 0; index + 2 < points.length; index += 3) {
      vertices.push({ x: points[index]!, y: points[index + 1]!, z: points[index + 2]! });
    }
    if (vertices.length > 0) return vertices;
  }

  return getShapeVertices(element).map((point) => ({ ...point, z: 0 }));
}

function vector3Value(value: StaticValue | undefined): { x: number; y: number; z: number } {
  if (!Array.isArray(value) || value.length !== 3) return { x: 0, y: 0, z: 0 };
  const [x, y, z] = value;
  return {
    x: typeof x === "number" ? x : 0,
    y: typeof y === "number" ? y : 0,
    z: typeof z === "number" ? z : 0
  };
}

function numericArray(value: StaticValue | undefined): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function anchorOffset(anchor: string, w: number, h: number): { x: number; y: number } {
  switch (anchor) {
    case "top-left": return { x: 0, y: 0 };
    case "top": case "top-center": return { x: -w / 2, y: 0 };
    case "top-right": return { x: -w, y: 0 };
    case "left": case "center-left": return { x: 0, y: -h / 2 };
    case "center": return { x: -w / 2, y: -h / 2 };
    case "right": case "center-right": return { x: -w, y: -h / 2 };
    case "bottom-left": return { x: 0, y: -h };
    case "bottom": case "bottom-center": return { x: -w / 2, y: -h };
    case "bottom-right": return { x: -w, y: -h };
    default: return { x: -w / 2, y: -h / 2 };
  }
}

function parseSvgPathVertices(d: string): { x: number; y: number }[] {
  const vertices: { x: number; y: number }[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let cx = 0, cy = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const args = (match[2] ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
    switch (cmd) {
      case "M": case "L":
        if (args.length >= 2) { cx = args[0]!; cy = args[1]!; vertices.push({ x: cx, y: cy }); }
        break;
      case "m": case "l":
        if (args.length >= 2) { cx += args[0]!; cy += args[1]!; vertices.push({ x: cx, y: cy }); }
        break;
      case "H": if (args.length >= 1) { cx = args[0]!; vertices.push({ x: cx, y: cy }); } break;
      case "h": if (args.length >= 1) { cx += args[0]!; vertices.push({ x: cx, y: cy }); } break;
      case "V": if (args.length >= 1) { cy = args[0]!; vertices.push({ x: cx, y: cy }); } break;
      case "v": if (args.length >= 1) { cy += args[0]!; vertices.push({ x: cx, y: cy }); } break;
      case "C": if (args.length >= 6) { cx = args[4]!; cy = args[5]!; vertices.push({ x: cx, y: cy }); } break;
      case "c": if (args.length >= 6) { cx += args[4]!; cy += args[5]!; vertices.push({ x: cx, y: cy }); } break;
      case "S": case "Q": if (args.length >= 4) { cx = args[2]!; cy = args[3]!; vertices.push({ x: cx, y: cy }); } break;
      case "s": case "q": if (args.length >= 4) { cx += args[2]!; cy += args[3]!; vertices.push({ x: cx, y: cy }); } break;
      case "T": if (args.length >= 2) { cx = args[0]!; cy = args[1]!; vertices.push({ x: cx, y: cy }); } break;
      case "t": if (args.length >= 2) { cx += args[0]!; cy += args[1]!; vertices.push({ x: cx, y: cy }); } break;
    }
  }
  return vertices.length > 0 ? vertices : [{ x: 0, y: 0 }];
}

function numeric(value: StaticValue | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function stringValue(value: StaticValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

interface PathSample {
  x: number;
  y: number;
  angle: number;
}

interface PathPoint {
  x: number;
  y: number;
}

function sampleSvgPath(d: string, progress: number): PathSample | null {
  const points = approximateSvgPathPoints(d);
  if (points.length === 0) return null;
  if (points.length === 1) return { x: points[0]!.x, y: points[0]!.y, angle: 0 };

  const target = Math.max(0, Math.min(1, progress));
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!);
  }
  if (total <= 0) return { x: points[0]!.x, y: points[0]!.y, angle: 0 };

  let walked = 0;
  const targetDistance = total * target;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    const segmentLength = distance(left, right);
    if (walked + segmentLength >= targetDistance) {
      const segmentProgress = segmentLength <= 0 ? 0 : (targetDistance - walked) / segmentLength;
      return {
        x: left.x + (right.x - left.x) * segmentProgress,
        y: left.y + (right.y - left.y) * segmentProgress,
        angle: Math.atan2(right.y - left.y, right.x - left.x)
      };
    }
    walked += segmentLength;
  }

  const beforeLast = points[points.length - 2]!;
  const last = points[points.length - 1]!;
  return {
    x: last.x,
    y: last.y,
    angle: Math.atan2(last.y - beforeLast.y, last.x - beforeLast.x)
  };
}

function approximateSvgPathPoints(d: string): PathPoint[] {
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  const points: PathPoint[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicControl: PathPoint | null = null;
  let lastQuadraticControl: PathPoint | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const args = (match[2] ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);

    switch (cmd) {
      case "M":
        if (hasArgs(args, 2)) {
          cx = args[0]!;
          cy = args[1]!;
          sx = cx;
          sy = cy;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "m":
        if (hasArgs(args, 2)) {
          cx += args[0]!;
          cy += args[1]!;
          sx = cx;
          sy = cy;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "L":
        if (hasArgs(args, 2)) {
          cx = args[0]!;
          cy = args[1]!;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "l":
        if (hasArgs(args, 2)) {
          cx += args[0]!;
          cy += args[1]!;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "H":
        if (hasArgs(args, 1)) {
          cx = args[0]!;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "h":
        if (hasArgs(args, 1)) {
          cx += args[0]!;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "V":
        if (hasArgs(args, 1)) {
          cy = args[0]!;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "v":
        if (hasArgs(args, 1)) {
          cy += args[0]!;
          pushPoint(points, cx, cy);
        }
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      case "C":
      case "c": {
        if (!hasArgs(args, 6)) break;
        const relative = cmd === "c";
        const x1 = relative ? cx + args[0]! : args[0]!;
        const y1 = relative ? cy + args[1]! : args[1]!;
        const x2 = relative ? cx + args[2]! : args[2]!;
        const y2 = relative ? cy + args[3]! : args[3]!;
        const x = relative ? cx + args[4]! : args[4]!;
        const y = relative ? cy + args[5]! : args[5]!;
        addCubicPoints(points, cx, cy, x1, y1, x2, y2, x, y);
        cx = x;
        cy = y;
        lastCubicControl = { x: x2, y: y2 };
        lastQuadraticControl = null;
        break;
      }
      case "S":
      case "s": {
        if (!hasArgs(args, 4)) break;
        const reflected = lastCubicControl ? { x: 2 * cx - lastCubicControl.x, y: 2 * cy - lastCubicControl.y } : { x: cx, y: cy };
        const relative = cmd === "s";
        const x2 = relative ? cx + args[0]! : args[0]!;
        const y2 = relative ? cy + args[1]! : args[1]!;
        const x = relative ? cx + args[2]! : args[2]!;
        const y = relative ? cy + args[3]! : args[3]!;
        addCubicPoints(points, cx, cy, reflected.x, reflected.y, x2, y2, x, y);
        cx = x;
        cy = y;
        lastCubicControl = { x: x2, y: y2 };
        lastQuadraticControl = null;
        break;
      }
      case "Q":
      case "q": {
        if (!hasArgs(args, 4)) break;
        const relative = cmd === "q";
        const x1 = relative ? cx + args[0]! : args[0]!;
        const y1 = relative ? cy + args[1]! : args[1]!;
        const x = relative ? cx + args[2]! : args[2]!;
        const y = relative ? cy + args[3]! : args[3]!;
        addQuadraticPoints(points, cx, cy, x1, y1, x, y);
        cx = x;
        cy = y;
        lastQuadraticControl = { x: x1, y: y1 };
        lastCubicControl = null;
        break;
      }
      case "T":
      case "t": {
        if (!hasArgs(args, 2)) break;
        const reflected: PathPoint = lastQuadraticControl
          ? { x: 2 * cx - lastQuadraticControl.x, y: 2 * cy - lastQuadraticControl.y }
          : { x: cx, y: cy };
        const relative = cmd === "t";
        const x = relative ? cx + args[0]! : args[0]!;
        const y = relative ? cy + args[1]! : args[1]!;
        addQuadraticPoints(points, cx, cy, reflected.x, reflected.y, x, y);
        cx = x;
        cy = y;
        lastQuadraticControl = reflected;
        lastCubicControl = null;
        break;
      }
      case "Z":
      case "z":
        cx = sx;
        cy = sy;
        pushPoint(points, cx, cy);
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
    }
  }

  return points;
}

function pushPoint(points: PathPoint[], x: number, y: number): void {
  const last = points[points.length - 1];
  if (!last || last.x !== x || last.y !== y) {
    points.push({ x, y });
  }
}

function addCubicPoints(
  points: PathPoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): void {
  for (let index = 1; index <= 32; index += 1) {
    const t = index / 32;
    pushPoint(points, cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
  }
}

function addQuadraticPoints(
  points: PathPoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  for (let index = 1; index <= 24; index += 1) {
    const t = index / 24;
    pushPoint(points, quadraticAt(x0, x1, x2, t), quadraticAt(y0, y1, y2, t));
  }
}

function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

function quadraticAt(a: number, b: number, c: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * a + 2 * mt * t * b + t * t * c;
}

function hasArgs(args: number[], count: number): boolean {
  return args.length >= count && args.slice(0, count).every(Number.isFinite);
}

function distance(left: PathPoint, right: PathPoint): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function evaluateAnimatedProperty(
  property: AnimatedPropertyIR,
  localTMs: number,
  scope: Record<string, number> = {}
): number | string {
  if (property.type === "expression") {
    return compileNumericExpression(property.fn)({ ...scope, t: localTMs / 1000 });
  }

  if (property.type === "color-keyframes") {
    return evaluateColorKeyframes(property.points, localTMs);
  }

  return evaluateKeyframes(property.points, localTMs);
}

export function evaluateKeyframes(points: KeyframeIR[], localTMs: number): number {
  if (points.length === 0) {
    throw new Error("Cannot evaluate keyframes without points");
  }

  const sorted = getSortedKeyframes(points);
  if (localTMs <= sorted[0]!.t) return sorted[0]!.value;

  const last = sorted[sorted.length - 1]!;
  if (localTMs >= last.t) return last.value;

  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index]!;
    if (localTMs <= right.t) {
      const left = sorted[index - 1]!;
      const span = right.t - left.t;
      if (span <= 0) return right.value;

      const progress = (localTMs - left.t) / span;
      const eased = getEasingFunction(right.easing)(progress);
      return left.value + (right.value - left.value) * eased;
    }
  }

  return last.value;
}

export function evaluateColorKeyframes(points: ColorKeyframeIR[], localTMs: number): string {
  if (points.length === 0) {
    throw new Error("Cannot evaluate color keyframes without points");
  }

  const sorted = getSortedColorKeyframes(points);
  if (localTMs <= sorted[0]!.t) return sorted[0]!.value;

  const last = sorted[sorted.length - 1]!;
  if (localTMs >= last.t) return last.value;

  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index]!;
    if (localTMs <= right.t) {
      const left = sorted[index - 1]!;
      const span = right.t - left.t;
      if (span <= 0) return right.value;

      const progress = (localTMs - left.t) / span;
      const eased = getEasingFunction(right.easing)(progress);

      const fromColor = parseColor(left.value);
      const toColor = parseColor(right.value);
      return colorToHex(lerpColor(fromColor, toColor, eased));
    }
  }

  return last.value;
}

function getSortedKeyframes(points: KeyframeIR[]): KeyframeIR[] {
  let sorted = sortedKeyframeCache.get(points);
  if (!sorted) {
    sorted = [...points].sort((left, right) => left.t - right.t);
    sortedKeyframeCache.set(points, sorted);
  }
  return sorted;
}

function getSortedColorKeyframes(points: ColorKeyframeIR[]): ColorKeyframeIR[] {
  let sorted = sortedColorKeyframeCache.get(points);
  if (!sorted) {
    sorted = [...points].sort((left, right) => left.t - right.t);
    sortedColorKeyframeCache.set(points, sorted);
  }
  return sorted;
}
