export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Transform3DParams {
  z: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  rotateOrder?: string;
  scaleX: number;
  scaleY: number;
}

export interface PerspectiveParams {
  perspective: number;
  vanishX: number;
  vanishY: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
}

export function rotateX(point: Point3D, angle: number): Point3D {
  if (angle === 0) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cos - point.z * sin,
    z: point.y * sin + point.z * cos
  };
}

export function rotateY(point: Point3D, angle: number): Point3D {
  if (angle === 0) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos + point.z * sin,
    y: point.y,
    z: -point.x * sin + point.z * cos
  };
}

export function rotateZ(point: Point3D, angle: number): Point3D {
  if (angle === 0) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
    z: point.z
  };
}

export function rotate3D(point: Point3D, rx: number, ry: number, rz: number): Point3D {
  return rotate3DInOrder(point, rx, ry, rz);
}

export function rotate3DInOrder(point: Point3D, rx: number, ry: number, rz: number, order = "zyx"): Point3D {
  let result = point;
  for (const axis of normalizeRotateOrder(order)) {
    if (axis === "x") result = rotateX(result, rx);
    else if (axis === "y") result = rotateY(result, ry);
    else result = rotateZ(result, rz);
  }
  return result;
}

export function normalizeRotateOrder(order: string | undefined): string[] {
  const axes: string[] = [];
  const raw = typeof order === "string" && order.trim() ? order.trim().toLowerCase() : "zyx";
  for (const axis of raw) {
    if ((axis === "x" || axis === "y" || axis === "z") && !axes.includes(axis)) {
      axes.push(axis);
    }
  }
  for (const axis of "zyx") {
    if (!axes.includes(axis)) axes.push(axis);
  }
  return axes;
}

export function projectPoint(point: Point3D, perspective: PerspectiveParams): ProjectedPoint {
  if (!Number.isFinite(perspective.perspective) || perspective.perspective <= 0) {
    return { x: point.x, y: point.y, scale: 1 };
  }

  const denominator = Math.max(0.001, perspective.perspective - point.z);
  const scale = perspective.perspective / denominator;
  return {
    x: perspective.vanishX + (point.x - perspective.vanishX) * scale,
    y: perspective.vanishY + (point.y - perspective.vanishY) * scale,
    scale
  };
}

export interface GroupTransform3D {
  mat: number[];
  parentMat?: number[];
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scaleX: number;
  scaleY: number;
  z: number;
}

export function transformVertices(
  vertices: Array<{ x: number; y: number }>,
  origin: { x: number; y: number },
  transform: Transform3DParams,
  perspective: PerspectiveParams,
  groupTransform?: GroupTransform3D,
  originOffset: { x: number; y: number } = { x: 0, y: 0 }
): ProjectedPoint[] {
  return transformVerticesToWorld(vertices, origin, transform, groupTransform, originOffset)
    .map((point) => projectPoint(point, perspective));
}

export function transformVerticesToWorld(
  vertices: Array<{ x: number; y: number }>,
  origin: { x: number; y: number },
  transform: Transform3DParams,
  groupTransform?: GroupTransform3D,
  originOffset: { x: number; y: number } = { x: 0, y: 0 }
): Point3D[] {
  if (groupTransform) {
    const m = groupTransform.mat;
    const pm = groupTransform.parentMat;
    return vertices.map((vertex) => {
      const lx = (vertex.x - origin.x - originOffset.x) * groupTransform.scaleX;
      const ly = (vertex.y - origin.y - originOffset.y) * groupTransform.scaleY;
      // Apply rotation matrix: M * [lx, ly, 0]^T (column vector)
      // Matrix is row-major: [m00,m01,m02, m10,m11,m12, m20,m21,m22]
      const rx = m[0]! * lx + m[1]! * ly + m[2]! * 0;
      const ry = m[3]! * lx + m[4]! * ly + m[5]! * 0;
      const rz = m[6]! * lx + m[7]! * ly + m[8]! * 0;
      const pivotX = pm ? pm[0]! * originOffset.x + pm[1]! * originOffset.y : originOffset.x;
      const pivotY = pm ? pm[3]! * originOffset.x + pm[4]! * originOffset.y : originOffset.y;
      const pivotZ = pm ? pm[6]! * originOffset.x + pm[7]! * originOffset.y : 0;
      return {
        x: origin.x + groupTransform.offsetX + pivotX + rx,
        y: origin.y + groupTransform.offsetY + pivotY + ry,
        z: groupTransform.z + groupTransform.offsetZ + pivotZ + rz
      };
    });
  }
  return vertices.map((vertex) => {
    const local: Point3D = {
      x: (vertex.x - origin.x - originOffset.x) * transform.scaleX,
      y: (vertex.y - origin.y - originOffset.y) * transform.scaleY,
      z: 0
    };
    const rotated = rotate3DInOrder(local, transform.rotateX, transform.rotateY, transform.rotateZ, transform.rotateOrder);
    return {
      x: origin.x + originOffset.x + rotated.x,
      y: origin.y + originOffset.y + rotated.y,
      z: transform.z + rotated.z
    };
  });
}

export function transformLocalPoints3DToWorld(
  points: Point3D[],
  origin: { x: number; y: number },
  transform: Transform3DParams,
  groupTransform?: GroupTransform3D,
  originOffset: Point3D = { x: 0, y: 0, z: 0 }
): Point3D[] {
  if (groupTransform) {
    const m = groupTransform.mat;
    const pm = groupTransform.parentMat;
    return points.map((point) => {
      const lx = (point.x - originOffset.x) * groupTransform.scaleX;
      const ly = (point.y - originOffset.y) * groupTransform.scaleY;
      const lz = point.z - originOffset.z;
      const rx = m[0]! * lx + m[1]! * ly + m[2]! * lz;
      const ry = m[3]! * lx + m[4]! * ly + m[5]! * lz;
      const rz = m[6]! * lx + m[7]! * ly + m[8]! * lz;
      const pivotX = pm ? pm[0]! * originOffset.x + pm[1]! * originOffset.y + pm[2]! * originOffset.z : originOffset.x;
      const pivotY = pm ? pm[3]! * originOffset.x + pm[4]! * originOffset.y + pm[5]! * originOffset.z : originOffset.y;
      const pivotZ = pm ? pm[6]! * originOffset.x + pm[7]! * originOffset.y + pm[8]! * originOffset.z : originOffset.z;
      return {
        x: origin.x + groupTransform.offsetX + pivotX + rx,
        y: origin.y + groupTransform.offsetY + pivotY + ry,
        z: groupTransform.z + groupTransform.offsetZ + pivotZ + rz
      };
    });
  }

  return points.map((point) => {
    const local: Point3D = {
      x: (point.x - originOffset.x) * transform.scaleX,
      y: (point.y - originOffset.y) * transform.scaleY,
      z: point.z - originOffset.z
    };
    const rotated = rotate3DInOrder(local, transform.rotateX, transform.rotateY, transform.rotateZ, transform.rotateOrder);
    return {
      x: origin.x + originOffset.x + rotated.x,
      y: origin.y + originOffset.y + rotated.y,
      z: transform.z + originOffset.z + rotated.z
    };
  });
}
