import type { ElementType, StaticValue } from "../../schema/src";

export interface DocumentAST {
  header: HeaderAST;
  imports: ImportAST[];
  systems: SystemAST[];
  cameras: CameraAST[];
  scenes: SceneAST[];
  draws: DrawDefinitionAST[];
  motions: MotionDefinitionAST[];
  emitters: EmitterDefinitionAST[];
  elements: ElementAST[];
  drawCalls: DrawCallAST[];
  audioTracks: AudioTrackAST[];
}

export interface ImportAST {
  kind: "import";
  path: string;
  loc: SourceLocation;
}

export interface HeaderAST {
  canvas?: {
    width: number;
    height: number;
  };
  bg?: string;
  fps?: number;
  perspective?: number;
  vanishX?: number;
  vanishY?: number;
  debug?: string[];
  variables: Record<string, StaticValue>;
}

export interface SystemAST {
  kind: "system";
  props: Record<string, string>;
  loc: SourceLocation;
}

export interface SceneAST {
  kind: "scene";
  name: string;
  lifetime: LifetimeAST;
  loc: SourceLocation;
}

export interface CameraAST {
  kind: "camera";
  body: PropertyAssignmentAST[];
  loc: SourceLocation;
}

export interface ElementAST {
  kind: "element";
  type: ElementType;
  id: string;
  props: Record<string, StaticValue>;
  lifetime?: LifetimeAST;
  sceneName?: string;
  sceneLifetime?: LifetimeAST;
  body: ElementBodyItemAST[];
  loc: SourceLocation;
}

export interface LifetimeAST {
  startMs: number;
  endMs: number | "end";
}

export type ElementBodyItemAST = PropertyAssignmentAST | MotionCallAST;

export interface PropertyAssignmentAST {
  kind: "property";
  name: string;
  value: PropertyValueAST;
  loc: SourceLocation;
}

export interface MotionDefinitionAST {
  kind: "motion";
  name: string;
  params: MotionParamAST[];
  body: PropertyAssignmentAST[];
  loc: SourceLocation;
}

export interface DrawDefinitionAST {
  kind: "draw";
  name: string;
  params: MotionParamAST[];
  body: ElementAST[];
  loc: SourceLocation;
}

export interface EmitterDefinitionAST {
  kind: "emitter";
  id: string;
  lifetime?: LifetimeAST;
  sceneName?: string;
  sceneLifetime?: LifetimeAST;
  template: EmitterTemplateAST;
  props: Record<string, StaticValue | EmitterRandomAST | EmitterOverLifeAST>;
  loc: SourceLocation;
}

export interface EmitterTemplateAST {
  type: ElementType;
  props: Record<string, StaticValue>;
  body: ElementBodyItemAST[];
}

export interface EmitterRandomAST {
  kind: "random";
  min: number;
  max: number;
}

export interface EmitterOverLifeAST {
  kind: "over-life";
  from: number | string;
  to: number | string;
}

export interface DrawCallAST {
  kind: "draw-call";
  name: string;
  id: string;
  args: MotionArgumentAST[];
  lifetime?: LifetimeAST;
  sceneName?: string;
  sceneLifetime?: LifetimeAST;
  loc: SourceLocation;
}

export interface MotionParamAST {
  name: string;
  defaultValue?: StaticValue;
}

export interface MotionCallAST {
  kind: "motion-call";
  name: string;
  args: MotionArgumentAST[];
  loc: SourceLocation;
}

export interface MotionArgumentAST {
  name?: string;
  value: StaticValue;
}

export type PropertyValueAST = StaticValue | AnimationAST;

export type AnimationAST = TweenAnimationAST | KeyframeAnimationAST | ExpressionAnimationAST;

export type AnimationScalarAST = number | string;

export interface TweenAnimationAST {
  kind: "tween";
  values: AnimationScalarAST[];
  durationMs: AnimationScalarAST;
  easing: string;
}

export interface KeyframeAnimationAST {
  kind: "keyframes";
  points: AnimationPointAST[];
}

export interface AnimationPointAST {
  t: AnimationScalarAST;
  value: AnimationScalarAST;
  easing: string;
}

export interface ExpressionAnimationAST {
  kind: "expression";
  source: string;
}

export interface AudioTrackAST {
  kind: "audio";
  id: string;
  src: string;
  lifetime?: LifetimeAST;
  sceneName?: string;
  sceneLifetime?: LifetimeAST;
  props: Record<string, StaticValue>;
  loc: SourceLocation;
}

export interface SourceLocation {
  line: number;
  column: number;
}
