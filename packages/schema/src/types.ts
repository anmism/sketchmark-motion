export type ElementType =
  | "rect"
  | "circle"
  | "ellipse"
  | "text"
  | "line"
  | "line3d"
  | "path"
  | "poly3d"
  | "path3d"
  | "plane"
  | "cuboid"
  | "sphere"
  | "cylinder"
  | "cone"
  | "pyramid"
  | "prism"
  | "torus"
  | "image"
  | "group"
  | "view";

export type AnchorPoint =
  | "center"
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface SceneIR {
  version: 1;
  canvas: CanvasIR;
  duration: number;
  elements: ElementIR[];
  audioTracks: AudioTrackIR[];
}

export interface AudioTrackIR {
  id: string;
  src: string;
  lifetime: LifetimeIR;
  volume: number | AnimatedPropertyIR;
  pan: number | AnimatedPropertyIR;
  fadeIn: number;
  fadeOut: number;
  trim: number;
  loop: boolean;
}

export interface CanvasIR {
  width: number;
  height: number;
  bg: string;
  fps: number;
  perspective?: number;
  vanishX?: number;
  vanishY?: number;
  debug?: string[];
}

export interface ElementIR {
  id: string;
  type: ElementType;
  lifetime: LifetimeIR;
  static: Record<string, StaticValue>;
  animated: Record<string, AnimatedPropertyIR>;
  comp: string;
  anchor: AnchorPoint;
  origin: AnchorPoint;
  mask: MaskIR | null;
  zIndex: number;
  parent: string | null;
}

export interface LifetimeIR {
  start: number;
  end: number;
}

export type StaticValue = number | string | boolean | Array<number | string>;

export interface RectMaskIR {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  invert?: boolean;
}

export interface CircleMaskIR {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  invert?: boolean;
}

export interface PathMaskIR {
  type: "path";
  d: string;
  invert?: boolean;
}

export interface PointsMaskIR {
  type: "points";
  points: number[];
  closed?: boolean;
  invert?: boolean;
}

export interface TextMaskIR {
  type: "text";
  content: string;
  x: number;
  y: number;
  size: number;
  font?: string;
  invert?: boolean;
}

export interface FxMaskIR {
  type: "fx";
  expr: string;
  xMin: number;
  xMax: number;
  yBase: number;
  steps: number;
  invert?: boolean;
}

export interface XtMaskIR {
  type: "xt";
  xExpr: string;
  yExpr: string;
  tMin: number;
  tMax: number;
  steps: number;
  closed?: boolean;
  invert?: boolean;
}

export type MaskIR = RectMaskIR | CircleMaskIR | PathMaskIR | PointsMaskIR | TextMaskIR | FxMaskIR | XtMaskIR;

export type AnimatedPropertyIR = ExpressionPropertyIR | KeyframesPropertyIR | ColorKeyframesPropertyIR;

export interface ExpressionPropertyIR {
  type: "expression";
  fn: string;
}

export interface KeyframesPropertyIR {
  type: "keyframes";
  points: KeyframeIR[];
}

export interface KeyframeIR {
  t: number;
  value: number;
  easing: string;
}

export interface ColorKeyframesPropertyIR {
  type: "color-keyframes";
  points: ColorKeyframeIR[];
}

export interface ColorKeyframeIR {
  t: number;
  value: string;
  easing: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
