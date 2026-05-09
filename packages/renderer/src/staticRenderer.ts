import type { AnchorPoint, MaskIR, StaticValue } from "../../schema/src";
import type { FrameState } from "../../engine/src";

export interface ShadowEffect {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
}

export interface RenderEffects {
  blur: number;
  brightness: number;
  contrast: number;
  saturate: number;
  hueRotate: number;
  shadow: ShadowEffect | null;
}

export interface StrokeControls {
  drawStart?: number;
  drawEnd?: number;
  dashArray?: number[];
  dashOffset?: number;
  strokeCap?: string;
  strokeJoin?: string;
}

export interface TransformControls {
  z: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  rotateOrder?: string;
  scaleX: number;
  scaleY: number;
  _3dMat?: number[];
  _3dParentMat?: number[];
  _3dOffsetX?: number;
  _3dOffsetY?: number;
  _3dOffsetZ?: number;
}

export interface GroupTransform3DProps {
  _3dMat?: number[];
  _3dParentMat?: number[];
  _3dOffsetX?: number;
  _3dOffsetY?: number;
  _3dOffsetZ?: number;
}

export type DrawCommand =
  | {
      op: "clear";
      color: string;
      width: number;
      height: number;
    }
  | ({
      op: "rect";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      cornerRadius: number | number[];
      fill: string;
      stroke: string;
      strokeWidth: number;
      draw: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "circle";
      id: string;
      x: number;
      y: number;
      r: number;
      fill: string;
      stroke: string;
      strokeWidth: number;
      draw: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "ellipse";
      id: string;
      x: number;
      y: number;
      rx: number;
      ry: number;
      fill: string;
      stroke: string;
      strokeWidth: number;
      draw: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "line";
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      strokeWidth: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "line3d";
      id: string;
      x: number;
      y: number;
      points: number[];
      stroke: string;
      strokeWidth: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "text";
      id: string;
      x: number;
      y: number;
      content: string;
      font: string;
      size: number;
      weight: string;
      fill: string;
      stroke: string;
      strokeWidth: number;
      letterSpacing: number;
      lineHeight: number;
      align: string;
      draw: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & GroupTransform3DProps)
  | ({
      op: "path";
      id: string;
      x: number;
      y: number;
      d: string;
      fill: string;
      stroke: string;
      strokeWidth: number;
      draw: number;
      points: number[] | null;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "poly3d" | "path3d";
      id: string;
      x: number;
      y: number;
      d: string;
      fill: string;
      stroke: string;
      strokeWidth: number;
      draw: number;
      points: number[];
      closed: boolean;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & StrokeControls & GroupTransform3DProps)
  | ({
      op: "image";
      id: string;
      src: string;
      x: number;
      y: number;
      width: number;
      height: number;
      draw: number;
      opacity: number;
      comp: string;
      anchor: AnchorPoint;
      origin: AnchorPoint;
      mask: MaskIR | null;
      rotation: number;
      scale: number;
      z: number;
      rotateX: number;
      rotateY: number;
      rotateZ: number;
      rotateOrder?: string;
      scaleX: number;
      scaleY: number;
      effects?: RenderEffects;
    } & GroupTransform3DProps)
  ;

export function renderStaticFrameToCommands(frame: FrameState): DrawCommand[] {
  const commands: DrawCommand[] = [
    {
      op: "clear",
      color: frame.canvas.bg,
      width: frame.canvas.width,
      height: frame.canvas.height
    }
  ];

  for (const element of frame.elements) {
    if (element.type === "rect") {
      commands.push({
        op: "rect",
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        width: numeric(element.props.w, 0),
        height: numeric(element.props.h, 0),
        cornerRadius: cornerRadiusValue(element.props.cornerRadius),
        fill: stringValue(element.props.fill, stringValue(element.props.gradient, "#000")),
        stroke: stringValue(element.props.stroke, ""),
        strokeWidth: numeric(element.props.strokeWidth, 0),
        draw: numeric(element.props.draw, 1),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "circle") {
      commands.push({
        op: "circle",
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        r: numeric(element.props.r, 0),
        fill: stringValue(element.props.fill, stringValue(element.props.gradient, "")),
        stroke: stringValue(element.props.stroke, ""),
        strokeWidth: numeric(element.props.strokeWidth, 0),
        draw: numeric(element.props.draw, 1),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "ellipse") {
      commands.push({
        op: "ellipse",
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        rx: numeric(element.props.rx, 0),
        ry: numeric(element.props.ry, 0),
        fill: stringValue(element.props.fill, stringValue(element.props.gradient, "")),
        stroke: stringValue(element.props.stroke, ""),
        strokeWidth: numeric(element.props.strokeWidth, 0),
        draw: numeric(element.props.draw, 1),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "line") {
      const ox = numeric(element.props.x, 0);
      const oy = numeric(element.props.y, 0);
      let lx1: number, ly1: number, lx2: number, ly2: number;
      const from = element.props.from;
      const to = element.props.to;
      if (Array.isArray(from) && Array.isArray(to)) {
        lx1 = (from[0] as number) + ox;
        ly1 = (from[1] as number) + oy;
        lx2 = (to[0] as number) + ox;
        ly2 = (to[1] as number) + oy;
      } else {
        lx1 = numeric(element.props.x1, 0) + ox;
        ly1 = numeric(element.props.y1, 0) + oy;
        lx2 = numeric(element.props.x2, 0) + ox;
        ly2 = numeric(element.props.y2, 0) + oy;
      }
      const shouldUseDrawWindow = element.props.drawStart !== undefined || element.props.drawEnd !== undefined;
      const drawProgress = shouldUseDrawWindow ? 1 : Math.max(0, Math.min(1, numeric(element.props.draw, 1)));
      commands.push({
        op: "line",
        id: element.id,
        x1: lx1,
        y1: ly1,
        x2: lx1 + (lx2 - lx1) * drawProgress,
        y2: ly1 + (ly2 - ly1) * drawProgress,
        stroke: stringValue(element.props.stroke, stringValue(element.props.gradient, stringValue(element.props.fill, "#000"))),
        strokeWidth: numeric(element.props.strokeWidth, numeric(element.props.width, 1)),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "line3d") {
      const from = vector3Value(element.props.from);
      const to = vector3Value(element.props.to);
      commands.push({
        op: "line3d",
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        points: [...from, ...to],
        stroke: stringValue(element.props.stroke, stringValue(element.props.gradient, stringValue(element.props.fill, "#000"))),
        strokeWidth: numeric(element.props.strokeWidth, numeric(element.props.width, 1)),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "text") {
      commands.push({
        op: "text",
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        content: stringValue(element.props.content, ""),
        font: stringValue(element.props.font, "sans"),
        size: numeric(element.props.size, 16),
        weight: weightValue(element.props.weight, "normal"),
        fill: stringValue(element.props.fill, stringValue(element.props.gradient, "#000")),
        stroke: stringValue(element.props.stroke, ""),
        strokeWidth: numeric(element.props.strokeWidth, 0),
        letterSpacing: numeric(element.props.letterSpacing, 0),
        lineHeight: numeric(element.props.lineHeight, 1.2),
        align: stringValue(element.props.align, "left"),
        draw: numeric(element.props.draw, 1),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "path") {
      const fill = stringValue(element.props.fill, stringValue(element.props.gradient, ""));
      const closedProp = element.props.closed;
      const closed = closedProp === true || (closedProp !== false && !!fill);
      const pointsArr = Array.isArray(element.props.points) ? element.props.points as number[] : null;
      const d = stringValue(element.props.d, "") || pointsToPathD(element.props.points, closed);
      commands.push({
        op: "path",
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        d,
        fill: fill || "",
        stroke: stringValue(element.props.stroke, ""),
        strokeWidth: numeric(element.props.strokeWidth, 0),
        draw: numeric(element.props.draw, 1),
        points: pointsArr,
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "poly3d" || element.type === "path3d") {
      const points = numericArray(element.props.points);
      commands.push({
        op: element.type,
        id: element.id,
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        d: stringValue(element.props.d, ""),
        fill: stringValue(element.props.fill, stringValue(element.props.gradient, "")),
        stroke: stringValue(element.props.stroke, ""),
        strokeWidth: numeric(element.props.strokeWidth, 0),
        draw: numeric(element.props.draw, 1),
        points,
        closed: closedValue(element.props.closed, element.type === "poly3d" || isClosedPath3D(element.props.d)),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...strokeControls(element.props),
        ...effectControls(element.props)
      });
    } else if (element.type === "image") {
      commands.push({
        op: "image",
        id: element.id,
        src: stringValue(element.props.src, ""),
        x: numeric(element.props.x, 0),
        y: numeric(element.props.y, 0),
        width: numeric(element.props.w, 0),
        height: numeric(element.props.h, 0),
        draw: numeric(element.props.draw, 1),
        opacity: numeric(element.props.opacity, 1),
        comp: element.comp,
        anchor: element.anchor,
        origin: element.origin,
        mask: element.mask,
        rotation: numeric(element.props.rotation, 0),
        scale: numeric(element.props.scale, 1),
        ...transformControls(element.props),
        ...effectControls(element.props)
      });
    }
  }

  return commands;
}

function numeric(value: StaticValue | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function stringValue(value: StaticValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function vector3Value(value: StaticValue | undefined): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return [0, 0, 0];
  const [x, y, z] = value;
  return [
    typeof x === "number" ? x : 0,
    typeof y === "number" ? y : 0,
    typeof z === "number" ? z : 0
  ];
}

function numericArray(value: StaticValue | undefined): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function closedValue(value: StaticValue | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "closed") return true;
    if (normalized === "false" || normalized === "open") return false;
  }
  return fallback;
}

function isClosedPath3D(value: StaticValue | undefined): boolean {
  return typeof value === "string" && /[Zz]\s*$/.test(value.trim());
}

function weightValue(value: StaticValue | undefined, fallback: string): string {
  if (typeof value === "number") return String(Math.round(value));
  if (typeof value === "string") return value;
  return fallback;
}

function strokeControls(props: Record<string, StaticValue>): StrokeControls {
  const controls: StrokeControls = {};
  if (props.drawStart !== undefined && typeof props.drawStart === "number") controls.drawStart = props.drawStart;
  if (props.drawEnd !== undefined && typeof props.drawEnd === "number") controls.drawEnd = props.drawEnd;
  if (props.dashOffset !== undefined && typeof props.dashOffset === "number") controls.dashOffset = props.dashOffset;
  if (Array.isArray(props.dashArray)) {
    const dashArray = props.dashArray.filter((item): item is number => typeof item === "number");
    if (dashArray.length > 0) controls.dashArray = dashArray;
  }
  if (typeof props.strokeCap === "string") controls.strokeCap = props.strokeCap;
  if (typeof props.strokeJoin === "string") controls.strokeJoin = props.strokeJoin;
  return controls;
}

function transformControls(props: Record<string, StaticValue>): TransformControls {
  const controls: TransformControls = {
    z: numeric(props.z, 0),
    rotateX: normalize3dAngle(numeric(props.rotateX, 0)),
    rotateY: normalize3dAngle(numeric(props.rotateY, 0)),
    rotateZ: normalize3dAngle(numeric(props.rotateZ, 0)),
    scaleX: numeric(props.scaleX, 1),
    scaleY: numeric(props.scaleY, 1)
  };
  if (typeof props.rotateOrder === "string") controls.rotateOrder = props.rotateOrder;
  if (Array.isArray(props._3dMat)) {
    controls._3dMat = props._3dMat as number[];
    if (Array.isArray(props._3dParentMat)) controls._3dParentMat = props._3dParentMat as number[];
    controls._3dOffsetX = numeric(props._3dOffsetX, 0);
    controls._3dOffsetY = numeric(props._3dOffsetY, 0);
    controls._3dOffsetZ = numeric(props._3dOffsetZ, 0);
  }
  return controls;
}

function normalize3dAngle(value: number): number {
  return Math.abs(value) > Math.PI * 2 ? (value * Math.PI) / 180 : value;
}

function cornerRadiusValue(value: StaticValue | undefined): number | number[] {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) {
    const nums = value.filter((item): item is number => typeof item === "number");
    if (nums.length > 0) return nums;
  }
  return 0;
}

function effectControls(props: Record<string, StaticValue>): { effects?: RenderEffects } {
  const effects: RenderEffects = {
    blur: numeric(props.blur, 0),
    brightness: numeric(props.brightness, 1),
    contrast: numeric(props.contrast, 1),
    saturate: numeric(props.saturate, 1),
    hueRotate: numeric(props.hueRotate, 0),
    shadow: shadowEffect(props.shadow)
  };

  const hasEffect =
    effects.blur !== 0 ||
    effects.brightness !== 1 ||
    effects.contrast !== 1 ||
    effects.saturate !== 1 ||
    effects.hueRotate !== 0 ||
    effects.shadow !== null;

  return hasEffect ? { effects } : {};
}

function shadowEffect(value: StaticValue | undefined): ShadowEffect | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [offsetX, offsetY, blur, color] = value;
  if (typeof offsetX !== "number" || typeof offsetY !== "number" || typeof blur !== "number" || typeof color !== "string") {
    return null;
  }
  return { offsetX, offsetY, blur, color };
}


function pointsToPathD(value: StaticValue | undefined, closed: boolean): string {
  if (!Array.isArray(value) || value.length < 4) return "";
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += 2) {
    const x = value[i];
    const y = value[i + 1];
    if (typeof x !== "number" || typeof y !== "number") break;
    parts.push(i === 0 ? `M${x},${y}` : `L${x},${y}`);
  }
  if (closed) parts.push("Z");
  return parts.join(" ");
}
