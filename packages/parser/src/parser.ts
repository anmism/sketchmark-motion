import type { ElementType, StaticValue } from "../../schema/src";
import type {
  AnimationPointAST,
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
  EmitterTemplateAST,
  ImportAST,
  LifetimeAST,
  MotionArgumentAST,
  MotionDefinitionAST,
  MotionParamAST,
  PropertyAssignmentAST,
  PropertyValueAST,
  SceneAST,
  SourceLocation,
  SystemAST
} from "./ast";
import { type Token, tokenize } from "./tokenizer";

const supportedElementTypes = new Set<ElementType>(["rect", "circle", "ellipse", "line", "line3d", "text", "path", "poly3d", "path3d", "plane", "cuboid", "sphere", "cylinder", "cone", "pyramid", "prism", "torus", "image", "group", "view"]);
const vector3Properties = new Set(["at", "normal", "up"]);

export function parseMotionMark(source: string): DocumentAST {
  const { header, body } = parseHeader(source);
  return new MotionMarkParser(tokenize(body), header).parseDocument();
}

class MotionMarkParser {
  private index = 0;
  private currentScene: SceneAST | undefined;

  constructor(private readonly tokens: Token[], private readonly header: DocumentAST["header"]) {}

  parseDocument(): DocumentAST {
    const imports: ImportAST[] = [];
    const systems: SystemAST[] = [];
    const cameras: CameraAST[] = [];
    const scenes: SceneAST[] = [];
    const draws: DrawDefinitionAST[] = [];
    const motions: MotionDefinitionAST[] = [];
    const emitters: EmitterDefinitionAST[] = [];
    const elements: ElementAST[] = [];
    const drawCalls: DrawCallAST[] = [];
    const audioTracks: AudioTrackAST[] = [];

    while (!this.check("eof")) {
      this.skipNewlines();
      if (this.check("eof")) break;

      if (this.check("equal")) {
        this.currentScene = this.parseScene();
        scenes.push(this.currentScene);
      } else if (this.checkIdentifier("@system")) {
        systems.push(this.parseSystemDefinition());
      } else if (this.checkIdentifier("@camera")) {
        cameras.push(this.parseCameraDefinition());
      } else if (this.checkIdentifier("@draw")) {
        draws.push(this.parseDrawDefinition());
      } else if (this.checkIdentifier("@motion")) {
        motions.push(this.parseMotionDefinition());
      } else if (this.checkIdentifier("@emitter")) {
        emitters.push(this.parseEmitterDefinition());
      } else if (this.checkIdentifier("use")) {
        imports.push(this.parseImport());
      } else if (this.checkIdentifier("audio")) {
        audioTracks.push(this.parseAudioTrack());
      } else {
        const item = this.parseElementOrDrawCall();
        if (item.kind === "draw-call") drawCalls.push(item);
        else elements.push(item);
      }
    }

    return { header: this.header, imports, systems, cameras, scenes, draws, motions, emitters, elements, drawCalls, audioTracks };
  }

  private parseImport(): ImportAST {
    const start = this.consumeIdentifier("use", "Expected use statement");
    const pathToken = this.consume("string", "Expected import path after 'use'");
    this.consumeOptional("newline");
    return { kind: "import", path: pathToken.value, loc: loc(start) };
  }

  private parseAudioTrack(): AudioTrackAST {
    const start = this.consumeIdentifier("audio", "Expected audio element");
    const srcToken = this.consume("string", "Expected audio file path after 'audio'");
    const props: Record<string, StaticValue> = {};
    let lifetime: LifetimeAST | undefined;

    while (!this.check("newline") && !this.check("eof")) {
      if (this.match("pipe")) {
        lifetime = this.parseLifetime();
      } else {
        const [key, value] = this.parseInlineProperty();
        props[key] = value;
      }
    }

    this.consumeOptional("newline");

    const id = `audio_${srcToken.value.replace(/[^a-zA-Z0-9]/g, "_")}`;
    return {
      kind: "audio",
      id,
      src: srcToken.value,
      lifetime,
      sceneName: this.currentScene?.name,
      sceneLifetime: this.currentScene?.lifetime,
      props,
      loc: loc(start)
    };
  }

  private parseSystemDefinition(): SystemAST {
    const start = this.consumeIdentifier("@system", "Expected @system definition");
    this.consumeOptional("newline");
    this.consume("indent", "Expected indented @system body");

    const props: Record<string, string> = {};
    while (!this.check("dedent") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("dedent")) break;
      const key = this.consume("identifier", "Expected @system property name");
      this.consume("colon", `Expected ':' after '${key.value}'`);
      props[key.value] = this.collectUntilLineEnd();
      this.consumeOptional("newline");
    }
    this.consume("dedent", "Expected end of @system body");

    return { kind: "system", props, loc: loc(start) };
  }

  private parseCameraDefinition(): CameraAST {
    const start = this.consumeIdentifier("@camera", "Expected @camera definition");
    this.consumeOptional("newline");
    this.consume("indent", "Expected indented @camera body");

    const body: PropertyAssignmentAST[] = [];
    while (!this.check("dedent") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("dedent")) break;
      body.push(this.parseBodyProperty());
      this.consumeOptional("newline");
    }
    this.consume("dedent", "Expected end of @camera body");

    return { kind: "camera", body, loc: loc(start) };
  }

  private parseScene(): SceneAST {
    const start = this.consume("equal", "Expected scene declaration");
    const nameTokens: string[] = [];

    while (!this.check("pipe") && !this.check("newline") && !this.check("eof")) {
      nameTokens.push(this.advance().value);
    }

    const name = nameTokens.join(" ").trim();
    if (name.length === 0) {
      throw this.error(start, "Expected scene name");
    }

    this.consume("pipe", "Expected '|' in scene declaration");
    const lifetime = this.parseLifetime();
    this.consume("equal", "Expected '=' at end of scene declaration");
    this.consumeOptional("newline");

    return { kind: "scene", name, lifetime, loc: loc(start) };
  }

  private parseMotionDefinition(): MotionDefinitionAST {
    const start = this.consumeIdentifier("@motion", "Expected @motion definition");
    const name = this.consume("identifier", "Expected motion name");
    const params = this.parseMotionParams();
    this.consumeOptional("newline");
    this.consume("indent", "Expected indented @motion body");

    const body: PropertyAssignmentAST[] = [];
    while (!this.check("dedent") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("dedent")) break;
      body.push(this.parseBodyProperty());
      this.consumeOptional("newline");
    }
    this.consume("dedent", "Expected end of @motion body");

    return {
      kind: "motion",
      name: name.value,
      params,
      body,
      loc: loc(start)
    };
  }

  private parseDrawDefinition(): DrawDefinitionAST {
    const start = this.consumeIdentifier("@draw", "Expected @draw definition");
    const name = this.consume("identifier", "Expected draw mark name");
    const params = this.parseMotionParams();
    this.consumeOptional("newline");
    this.consume("indent", "Expected indented @draw body");

    const body: ElementAST[] = [];
    while (!this.check("dedent") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("dedent")) break;
      body.push(this.parseElementOnly());
    }
    this.consume("dedent", "Expected end of @draw body");

    return {
      kind: "draw",
      name: name.value,
      params,
      body,
      loc: loc(start)
    };
  }

  private parseMotionParams(): MotionParamAST[] {
    const params: MotionParamAST[] = [];
    this.consume("leftParen", "Expected '(' after motion name");

    while (!this.check("rightParen") && !this.check("eof")) {
      const name = this.consume("identifier", "Expected motion parameter name");
      const param: MotionParamAST = { name: normalizeParamName(name.value) };

      if (this.match("equal")) {
        param.defaultValue = this.parseValue();
      }

      params.push(param);
      if (!this.match("comma")) break;
    }

    this.consume("rightParen", "Expected ')' after motion parameters");
    return params;
  }

  private parseEmitterDefinition(): EmitterDefinitionAST {
    const start = this.consumeIdentifier("@emitter", "Expected @emitter definition");
    const idToken = this.consume("identifier", "Expected emitter id");
    let lifetime: LifetimeAST | undefined;

    if (this.match("pipe")) {
      lifetime = this.parseLifetime();
    }

    this.consumeOptional("newline");
    this.consume("indent", "Expected indented @emitter body");

    let template: EmitterTemplateAST | undefined;
    const props: Record<string, StaticValue | EmitterRandomAST | EmitterOverLifeAST> = {};

    while (!this.check("dedent") && !this.check("eof")) {
      this.skipNewlines();
      if (this.check("dedent")) break;

      const key = this.consume("identifier", "Expected emitter property name");
      this.consume("colon", `Expected ':' after '${key.value}'`);

      if (key.value === "template") {
        template = this.parseEmitterTemplate();
      } else {
        props[key.value] = this.parseEmitterValue();
      }
      this.consumeOptional("newline");
    }
    this.consume("dedent", "Expected end of @emitter body");

    if (!template) {
      throw this.error(start, "@emitter requires a template: property");
    }

    return {
      kind: "emitter",
      id: idToken.value,
      lifetime,
      sceneName: this.currentScene?.name,
      sceneLifetime: this.currentScene?.lifetime,
      template,
      props,
      loc: loc(start)
    };
  }

  private parseEmitterTemplate(): EmitterTemplateAST {
    const typeToken = this.consume("identifier", "Expected element type for template");
    if (!supportedElementTypes.has(typeToken.value as ElementType)) {
      throw this.error(typeToken, `Invalid element type '${typeToken.value}' for emitter template`);
    }

    const type = typeToken.value as ElementType;
    const props: Record<string, StaticValue> = {};

    if (type === "text" && this.check("string")) {
      props.content = this.advance().value;
    }

    if (type === "path" && this.check("leftBracket")) {
      props.points = this.parsePointList(2);
    }

    if ((type === "poly3d" || type === "path3d") && this.check("leftBracket")) {
      props.points = this.parsePointList(3);
    }

    if (type === "image" && this.check("string")) {
      props.src = this.advance().value;
    }

    while (!this.check("newline") && !this.check("eof")) {
      const [key, value] = this.parseInlineProperty();
      props[key] = value;
    }

    // Template is inline-only within @emitter, no nested body
    const body: ElementBodyItemAST[] = [];
    return { type, props, body };
  }

  private parseEmitterValue(): StaticValue | EmitterRandomAST | EmitterOverLifeAST {
    if (this.checkIdentifier("random")) {
      return this.parseEmitterRandom();
    }

    // Handle spawn rate format: N/s
    if (this.check("number") || this.check("color")) {
      const firstToken = this.advance();

      // Check for N/s format
      if (firstToken.type === "number" && this.match("slash")) {
        const unit = this.consume("identifier", "Expected unit after /");
        return `${firstToken.value}/${unit.value}`;
      }

      // Check for "from -> to over life" format
      if (this.check("arrow")) {
        this.advance(); // consume ->
        const toToken = this.advance();
        if (this.checkIdentifier("over") && this.peekIdentifier("life")) {
          this.advance(); // consume "over"
          this.advance(); // consume "life"
          return {
            kind: "over-life",
            from: firstToken.type === "number" ? Number(firstToken.value) : firstToken.value,
            to: toToken.type === "number" ? Number(toToken.value) : toToken.value
          };
        }
        // Not over life, return as string (shouldn't happen in emitter context)
        return `${firstToken.value} -> ${toToken.value}`;
      }

      // Plain number
      if (firstToken.type === "number") {
        return this.parseNumberWithUnit(firstToken.value);
      }
      return firstToken.value;
    }

    // Handle emitOn: path(...) or emitOn: circle(...)
    if (this.checkIdentifier("path") || this.checkIdentifier("circle") || this.checkIdentifier("line")) {
      return this.collectUntilLineEnd();
    }

    return this.parseValue();
  }

  private peekIdentifier(name: string): boolean {
    const next = this.tokens[this.index + 1];
    return next?.type === "identifier" && next.value === name;
  }

  private parseNumberWithUnit(value: string): number {
    if (value.endsWith("s") && !value.endsWith("ms")) {
      return Number(value.slice(0, -1)) * 1000;
    }
    if (value.endsWith("ms")) {
      return Number(value.slice(0, -2));
    }
    return Number(value);
  }

  private parseEmitterRandom(): EmitterRandomAST {
    this.consumeIdentifier("random", "Expected random()");
    this.consume("leftParen", "Expected '(' after random");
    const min = this.parseNumericValue();
    this.consume("comma", "Expected ',' in random(min, max)");
    const max = this.parseNumericValue();
    this.consume("rightParen", "Expected ')' after random arguments");
    return { kind: "random", min, max };
  }

  private parseNumericValue(): number {
    const token = this.advance();
    if (token.type === "number") {
      return Number(token.value);
    }
    if (token.type === "identifier") {
      const val = token.value;
      if (val.endsWith("s") && !val.endsWith("ms")) {
        return Number(val.slice(0, -1)) * 1000;
      }
      if (val.endsWith("ms")) {
        return Number(val.slice(0, -2));
      }
      return Number(val);
    }
    throw this.error(token, `Expected numeric value, got '${token.value}'`);
  }

  private parseElementOrDrawCall(): ElementAST | DrawCallAST {
    const typeToken = this.consume("identifier", "Expected element type");
    if (typeToken.value === "@group" || typeToken.value === "@view") {
      return this.parseElementAfterType(typeToken, typeToken.value.slice(1) as ElementType);
    }
    if (!supportedElementTypes.has(typeToken.value as ElementType)) {
      return this.parseDrawCallAfterName(typeToken);
    }

    return this.parseElementAfterType(typeToken, typeToken.value as ElementType);
  }

  private parseElementOnly(): ElementAST {
    const typeToken = this.consume("identifier", "Expected element type");
    if (typeToken.value === "@group" || typeToken.value === "@view") {
      return this.parseElementAfterType(typeToken, typeToken.value.slice(1) as ElementType);
    }
    if (!supportedElementTypes.has(typeToken.value as ElementType)) {
      throw this.error(typeToken, `Expected element type inside @draw body, got '${typeToken.value}'`);
    }

    return this.parseElementAfterType(typeToken, typeToken.value as ElementType);
  }

  private parseElementAfterType(typeToken: Token, type: ElementType): ElementAST {
    const idToken = this.consume("identifier", "Expected element id");
    const props: Record<string, StaticValue> = {};
    let lifetime: LifetimeAST | undefined;

    if (type === "text" && this.check("string")) {
      props.content = this.advance().value;
    }

    if (type === "path" && this.check("leftBracket")) {
      props.points = this.parsePointList(2);
    }

    if ((type === "poly3d" || type === "path3d") && this.check("leftBracket")) {
      props.points = this.parsePointList(3);
    }

    if (type === "image" && this.check("string")) {
      props.src = this.advance().value;
    }

    while (!this.check("newline") && !this.check("eof")) {
      if (this.match("pipe")) {
        lifetime = this.parseLifetime();
      } else {
        const [key, value] = this.parseInlineProperty();
        props[key] = value;
      }
    }

    this.consumeOptional("newline");
    const body: ElementBodyItemAST[] = [];

    if (this.match("indent")) {
      while (!this.check("dedent") && !this.check("eof")) {
        this.skipNewlines();
        if (this.check("dedent")) break;
        body.push(this.parseElementBodyItem());
        this.consumeOptional("newline");
      }
      this.consume("dedent", "Expected end of element body");
    }

    return {
      kind: "element",
      type,
      id: idToken.value,
      props,
      lifetime,
      sceneName: this.currentScene?.name,
      sceneLifetime: this.currentScene?.lifetime,
      body,
      loc: loc(typeToken)
    };
  }

  private parseDrawCallAfterName(name: Token): DrawCallAST {
    const idToken = this.consume("identifier", "Expected draw mark instance id");
    const args: MotionArgumentAST[] = [];
    let lifetime: LifetimeAST | undefined;

    while (!this.check("newline") && !this.check("eof")) {
      if (this.match("pipe")) {
        lifetime = this.parseLifetime();
      } else {
        const [key, value] = this.parseInlineProperty();
        args.push({ name: key, value });
      }
    }
    this.consumeOptional("newline");

    if (this.match("indent")) {
      throw this.error(this.previous(), "@draw calls do not accept indented bodies");
    }

    return {
      kind: "draw-call",
      name: name.value,
      id: idToken.value,
      args,
      lifetime,
      sceneName: this.currentScene?.name,
      sceneLifetime: this.currentScene?.lifetime,
      loc: loc(name)
    };
  }

  private parseElementBodyItem(): ElementBodyItemAST {
    const name = this.consume("identifier", "Expected property or motion name");
    if (this.match("colon")) {
      return this.parsePropertyAfterName(name);
    }

    return this.parseMotionCallAfterName(name);
  }

  private parseInlineProperty(): [string, StaticValue] {
    const key = this.consume("identifier", "Expected property name");
    this.consume("colon", `Expected ':' after '${key.value}'`);
    if (key.value === "shadow") {
      return [key.value, this.parseShadowValue()];
    }
    if (key.value === "motionPath") {
      return [key.value, this.parseMotionPathValue()];
    }
    if (key.value === "repeatOffset") {
      return [key.value, this.collectUntilInlineBoundary()];
    }
    if ((key.value === "from" || key.value === "to") && this.check("leftParen")) {
      return [key.value, this.parsePointValue()];
    }
    if (key.value === "points" && this.check("leftBracket") && this.peekNext().type === "leftParen") {
      return [key.value, this.parsePointList()];
    }
    if (vector3Properties.has(key.value)) {
      return [key.value, this.parseVector3Value()];
    }
    if (isPaintProperty(key.value) && this.isGradientCallStart()) {
      return [key.value, this.collectGradientCallString()];
    }
    return [key.value, this.parseValue()];
  }

  private parseBodyProperty(): PropertyAssignmentAST {
    const key = this.consume("identifier", "Expected property name");
    this.consume("colon", `Expected ':' after '${key.value}'`);
    return this.parsePropertyAfterName(key);
  }

  private parsePropertyAfterName(key: Token): PropertyAssignmentAST {
    if (key.value === "mask") {
      return { kind: "property", name: key.value, value: this.collectUntilLineEnd(), loc: loc(key) };
    }

    if (key.value === "shadow") {
      return { kind: "property", name: key.value, value: this.parseShadowValue(), loc: loc(key) };
    }

    if (key.value === "motionPath") {
      return { kind: "property", name: key.value, value: this.parseMotionPathValue(), loc: loc(key) };
    }

    if (key.value === "repeatOffset") {
      return { kind: "property", name: key.value, value: this.collectUntilLineEnd(), loc: loc(key) };
    }

    if ((key.value === "from" || key.value === "to") && this.check("leftParen")) {
      return { kind: "property", name: key.value, value: this.parsePointValue(), loc: loc(key) };
    }

    if (key.value === "points" && this.check("leftBracket") && this.peekNext().type === "leftParen") {
      return { kind: "property", name: key.value, value: this.parsePointList(), loc: loc(key) };
    }

    if (isPaintProperty(key.value) && this.isGradientCallStart()) {
      return { kind: "property", name: key.value, value: this.collectUntilLineEnd(), loc: loc(key) };
    }

    if (vector3Properties.has(key.value)) {
      return { kind: "property", name: key.value, value: this.parseVector3Value(), loc: loc(key) };
    }

    const value = this.parsePropertyValue();
    return { kind: "property", name: key.value, value, loc: loc(key) };
  }

  private parseMotionCallAfterName(name: Token) {
    const args: MotionArgumentAST[] = [];

    if (this.match("leftParen")) {
      while (!this.check("rightParen") && !this.check("eof")) {
        args.push(this.parseMotionArgument());
        if (!this.match("comma")) break;
      }
      this.consume("rightParen", "Expected ')' after motion arguments");
    }

    return {
      kind: "motion-call" as const,
      name: name.value,
      args,
      loc: loc(name)
    };
  }

  private parseMotionArgument(): MotionArgumentAST {
    if (this.check("identifier") && this.peekNext().type === "colon") {
      const name = this.advance().value;
      this.consume("colon", "Expected ':' after named argument");
      return { name: normalizeParamName(name), value: this.parseValue() };
    }

    return { value: this.parseValue() };
  }

  private parseLifetime(): LifetimeAST {
    if (this.matchKeyword("persist")) {
      return { startMs: 0, endMs: "end" };
    }

    const start = this.parseTimeMs();
    this.consume("dash", "Expected '-' in lifetime range");
    const end = this.parseLifetimeEnd();
    return { startMs: start, endMs: end };
  }

  private parseLifetimeEnd(): number | "end" {
    if (this.matchKeyword("end")) return "end";
    return this.parseTimeMs();
  }

  private parseTimeMs(): number {
    const token = this.consume("number", "Expected time value");
    return parseTimeTokenMs(token.value);
  }

  private parseDurationValue(): AnimationScalarAST {
    if (this.check("identifier") && this.peek().value.startsWith("$")) {
      return this.advance().value;
    }
    return this.parseTimeMs();
  }

  private parsePropertyValue(): PropertyValueAST {
    if (this.checkIdentifier("f") && this.peekNext().type === "leftParen") {
      return this.parseExpressionAnimation();
    }

    if (this.checkIdentifier("wiggle") && this.peekNext().type === "leftParen") {
      return this.parseWiggleAnimation();
    }

    const first = this.parseAnimationScalarOrValue();
    if (!isAnimatableScalar(first)) return first;

    const firstScalar = first as AnimationScalarAST;

    if (this.match("arrow")) {
      return this.parseTween(firstScalar);
    }

    if (this.matchKeyword("at")) {
      return this.parseKeyframes(firstScalar);
    }

    return first;
  }

  private parseExpressionAnimation(): PropertyValueAST {
    this.consumeIdentifier("f", "Expected f(t) expression");
    this.consume("leftParen", "Expected '(' in f(t)");
    this.consumeIdentifier("t", "Expected t in f(t)");
    this.consume("rightParen", "Expected ')' in f(t)");
    this.consume("equal", "Expected '=' before expression body");

    const expression = this.collectUntilLineEnd();
    if (expression.trim().length === 0) {
      throw this.error(this.previous(), "Expected expression body");
    }

    return { kind: "expression", source: expression };
  }

  private parseWiggleAnimation(): PropertyValueAST {
    this.consumeIdentifier("wiggle", "Expected wiggle expression");
    this.consume("leftParen", "Expected '(' after wiggle");

    const positional: StaticValue[] = [];
    const named = new Map<string, StaticValue>();

    while (!this.check("rightParen") && !this.check("eof")) {
      if (this.check("identifier") && this.peekNext().type === "colon") {
        const name = this.advance().value;
        this.consume("colon", "Expected ':' after wiggle named argument");
        named.set(normalizeParamName(name), this.parseValue());
      } else {
        positional.push(this.parseValue());
      }

      if (!this.match("comma")) break;
    }

    this.consume("rightParen", "Expected ')' after wiggle arguments");

    const freq = named.get("freq") ?? positional[0];
    const amp = named.get("amp") ?? positional[1];
    const base = named.get("base") ?? positional[2] ?? 0;
    const seed = named.get("seed") ?? positional[3] ?? 0;

    if (freq === undefined || amp === undefined) {
      throw this.error(this.previous(), "wiggle expects frequency and amplitude");
    }

    return {
      kind: "expression",
      source: `wiggle(t,${expressionScalar(freq)},${expressionScalar(amp)},${expressionScalar(base)},${expressionScalar(seed)})`
    };
  }

  private parseTween(firstValue: AnimationScalarAST): PropertyValueAST {
    const values = [firstValue, this.parseAnimationNumberLike()];

    while (this.match("arrow")) {
      values.push(this.parseAnimationNumberLike());
    }

    this.consumeKeyword("over", "Expected 'over' in tween animation");
    const durationMs = this.parseDurationValue();
    const easing = this.parseOptionalEasing();

    return {
      kind: "tween",
      values,
      durationMs,
      easing
    };
  }

  private parseKeyframes(firstValue: AnimationScalarAST): PropertyValueAST {
    const points: AnimationPointAST[] = [
      {
        value: firstValue,
        t: this.parseDurationValue(),
        easing: this.parseOptionalEasing()
      }
    ];

    while (this.match("comma")) {
      const value = this.parseAnimationNumberLike();
      this.consumeKeyword("at", "Expected 'at' in keyframe animation");
      points.push({
        value,
        t: this.parseDurationValue(),
        easing: this.parseOptionalEasing()
      });
    }

    return { kind: "keyframes", points };
  }

  private parseAnimationNumberLike(): AnimationScalarAST {
    const value = this.parseAnimationScalarOrValue();
    if (isAnimatableScalar(value)) {
      return value as AnimationScalarAST;
    }
    throw this.error(this.previous(), "Expected numeric or color animation value");
  }

  private parseAnimationScalarOrValue(): StaticValue {
    return this.parseValue();
  }

  private parseOptionalEasing(): string {
    if (this.check("identifier") && !this.isBoundaryKeyword(this.peek().value)) {
      const easing = this.advance().value;
      if (this.check("leftParen")) {
        return this.collectCallString(easing);
      }
      return easing;
    }
    return "linear";
  }

  private parseValue(): StaticValue {
    if (this.check("leftBracket")) return this.parseArrayValue();

    const token = this.advance();
    if (token.type === "number") return parseNumberToken(token.value);
    if (token.type === "color" || token.type === "string" || token.type === "identifier") return token.value;
    throw this.error(token, "Expected property value");
  }

  private parseArrayValue(): StaticValue {
    this.consume("leftBracket", "Expected '[' in array value");
    const values: Array<number | string> = [];

    while (!this.check("rightBracket") && !this.check("eof")) {
      const token = this.advance();
      if (token.type === "number") {
        values.push(parseNumberToken(token.value));
      } else if (token.type === "color" || token.type === "string" || token.type === "identifier") {
        values.push(token.value);
      } else {
        throw this.error(token, "Expected scalar array item");
      }

      if (!this.match("comma")) break;
    }

    this.consume("rightBracket", "Expected ']' to close array value");
    return values;
  }

  private parseShadowValue(): StaticValue {
    const offsetX = this.parseValue();
    const offsetY = this.parseValue();
    const blur = this.parseValue();
    const color = this.parseValue();

    if (typeof offsetX !== "number" || typeof offsetY !== "number" || typeof blur !== "number" || typeof color !== "string") {
      throw this.error(this.previous(), "Expected shadow as: offsetX offsetY blur color");
    }

    return [offsetX, offsetY, blur, color];
  }

  private parseMotionPathValue(): StaticValue {
    if (this.checkIdentifier("d") && this.peekNext().type === "colon") {
      this.advance();
      this.consume("colon", "Expected ':' after motionPath d");
    }

    const value = this.parseValue();
    if (typeof value !== "string") {
      throw this.error(this.previous(), "motionPath expects an SVG path string");
    }
    return value;
  }

  private parsePointValue(): StaticValue {
    this.consume("leftParen", "Expected '(' in point value");
    const x = this.parseValue();
    this.consume("comma", "Expected ',' in point value");
    const y = this.parseValue();
    let z: StaticValue | undefined;
    if (this.match("comma")) {
      z = this.parseValue();
    }
    this.consume("rightParen", "Expected ')' in point value");

    if (typeof x !== "number" || typeof y !== "number" || (z !== undefined && typeof z !== "number")) {
      throw this.error(this.previous(), "Point coordinates must be numeric");
    }

    return z === undefined ? [x, y] : [x, y, z];
  }

  private parseVector3Value(): StaticValue {
    const x = this.parseValue();
    const y = this.parseValue();
    const z = this.parseValue();

    if (!isVectorComponent(x) || !isVectorComponent(y) || !isVectorComponent(z)) {
      throw this.error(this.previous(), "Expected 3D vector as: x y z");
    }

    return [x, y, z];
  }

  private parsePointList(expectedDimensions?: 2 | 3): StaticValue {
    this.consume("leftBracket", "Expected '[' for point list");
    const points: number[] = [];
    let dimensions = expectedDimensions ?? 0;

    while (!this.check("rightBracket") && !this.check("eof")) {
      this.consume("leftParen", "Expected '(' in point");
      const x = this.parseValue();
      this.consume("comma", "Expected ',' in point");
      const y = this.parseValue();
      let z: StaticValue | undefined;
      if (this.match("comma")) {
        z = this.parseValue();
      }
      this.consume("rightParen", "Expected ')' in point");

      if (typeof x !== "number" || typeof y !== "number" || (z !== undefined && typeof z !== "number")) {
        throw this.error(this.previous(), "Point coordinates must be numeric");
      }
      const pointDimensions = z === undefined ? 2 : 3;
      if (dimensions === 0) dimensions = pointDimensions;
      if (pointDimensions !== dimensions) {
        throw this.error(this.previous(), "Point list cannot mix 2D and 3D points");
      }
      if (expectedDimensions !== undefined && pointDimensions !== expectedDimensions) {
        throw this.error(this.previous(), expectedDimensions === 3 ? "Expected 3D points as (x,y,z)" : "Expected 2D points as (x,y)");
      }

      points.push(x, y);
      if (z !== undefined) points.push(z);
      if (!this.match("comma")) break;
    }

    this.consume("rightBracket", "Expected ']' to close point list");
    return points;
  }

  private collectUntilLineEnd(): string {
    const parts: string[] = [];

    while (!this.check("newline") && !this.check("dedent") && !this.check("eof")) {
      const token = this.advance();
      // Preserve quotes around string tokens
      if (token.type === "string") {
        parts.push(`"${token.value}"`);
      } else {
        parts.push(token.value);
      }
    }

    return joinExpressionParts(parts);
  }

  private collectUntilInlineBoundary(): string {
    const parts: string[] = [];

    while (!this.check("newline") && !this.check("pipe") && !this.check("dedent") && !this.check("eof")) {
      const token = this.advance();
      if (token.type === "string") {
        parts.push(`"${token.value}"`);
      } else {
        parts.push(token.value);
      }
    }

    return joinExpressionParts(parts);
  }

  private collectGradientCallString(): string {
    const name = this.consume("identifier", "Expected gradient function name").value;
    return this.collectCallString(name);
  }

  private collectCallString(name: string): string {
    const parts = [name];
    let depth = 0;

    do {
      const token = this.advance();
      if (token.type === "leftParen") depth += 1;
      if (token.type === "rightParen") depth -= 1;
      parts.push(token.type === "string" ? `"${token.value}"` : token.value);
    } while (depth > 0 && !this.check("newline") && !this.check("dedent") && !this.check("eof"));

    if (depth !== 0) {
      throw this.error(this.previous(), `Expected ')' after ${name} easing`);
    }

    return joinExpressionParts(parts);
  }

  private isGradientCallStart(): boolean {
    if (!this.check("identifier") || this.peekNext().type !== "leftParen") return false;
    return isGradientFunctionName(this.peek().value);
  }

  private consumeKeyword(keyword: string, message: string): Token {
    const token = this.consume("identifier", message);
    if (token.value !== keyword) {
      throw this.error(token, message);
    }
    return token;
  }

  private matchKeyword(keyword: string): boolean {
    if (!this.checkIdentifier(keyword)) return false;
    this.advance();
    return true;
  }

  private consumeIdentifier(value: string, message: string): Token {
    const token = this.consume("identifier", message);
    if (token.value !== value) {
      throw this.error(token, message);
    }
    return token;
  }

  private checkIdentifier(value: string): boolean {
    return this.check("identifier") && this.peek().value === value;
  }

  private isBoundaryKeyword(value: string): boolean {
    return value === "at" || value === "over";
  }

  private skipNewlines(): void {
    while (this.match("newline")) {
      // Keep consuming.
    }
  }

  private consume(type: Token["type"], message: string): Token {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  private consumeOptional(type: Token["type"]): Token | undefined {
    return this.match(type) ? this.previous() : undefined;
  }

  private match(type: Token["type"]): boolean {
    if (!this.check(type)) return false;
    this.advance();
    return true;
  }

  private check(type: Token["type"]): boolean {
    return this.peek().type === type;
  }

  private advance(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peekNext(): Token {
    return this.tokens[this.index + 1] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.index - 1]!;
  }

  private error(token: Token, message: string): SyntaxError {
    return new SyntaxError(`${message} at line ${token.line}, column ${token.column}`);
  }
}

function parseNumberToken(value: string): number {
  if (value.endsWith("px")) return Number(value.slice(0, -2));
  if (value.endsWith("ms")) return Number(value.slice(0, -2));
  if (value.endsWith("s")) return Number(value.slice(0, -1)) * 1000;
  if (value.endsWith("deg")) return (Number(value.slice(0, -3)) * Math.PI) / 180;
  if (value.endsWith("rad")) return Number(value.slice(0, -3));
  return Number(value);
}

function parseHeader(source: string): { header: DocumentAST["header"]; body: string } {
  const normalized = source.replace(/\r\n?/g, "\n");
  const emptyHeader: DocumentAST["header"] = { variables: {} };

  if (!normalized.startsWith("---\n")) {
    return { header: emptyHeader, body: source };
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex === -1) {
    throw new SyntaxError("Unterminated header block");
  }

  return {
    header: parseHeaderLines(normalized.slice(4, endIndex)),
    body: normalized.slice(endIndex + "\n---".length).replace(/^\n/, "")
  };
}

function parseHeaderLines(source: string): DocumentAST["header"] {
  const header: DocumentAST["header"] = { variables: {} };

  for (const [lineIndex, rawLine] of source.split("\n").entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new SyntaxError(`Invalid header line ${lineIndex + 2}: expected key:value`);
    }

    const key = line.slice(0, separator).trim();
    const value = stripHeaderComment(line.slice(separator + 1).trim()).trim();

    if (key === "canvas") {
      const match = /^(\d+)x(\d+)$/.exec(value);
      if (!match) throw new SyntaxError(`Invalid canvas header '${value}'`);
      header.canvas = { width: Number(match[1]), height: Number(match[2]) };
    } else if (key === "bg") {
      header.bg = value;
    } else if (key === "fps") {
      header.fps = Number(value);
    } else if (key === "perspective") {
      const perspective = Number(value);
      if (!Number.isFinite(perspective) || perspective <= 0) {
        throw new SyntaxError(`Invalid perspective header '${value}'`);
      }
      header.perspective = perspective;
    } else if (key === "vanish") {
      const parts = value.split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
        throw new SyntaxError(`Invalid vanish header '${value}', expected: vanish: x y`);
      }
      header.vanishX = parts[0]!;
      header.vanishY = parts[1]!;
    } else if (key === "debug") {
      header.debug = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key.startsWith("$")) {
      header.variables[key.slice(1)] = parseHeaderValue(value);
    }
  }

  return header;
}

function stripHeaderComment(value: string): string {
  return value.replace(/\s+#.*$/, "");
}

function parseHeaderValue(value: string): StaticValue {
  if (/^-?\d+(?:\.\d+)?(?:px|ms|s|deg|rad)?$/.test(value)) return parseNumberToken(value);
  return value;
}

function parseTimeTokenMs(value: string): number {
  if (value.endsWith("ms")) return Math.round(Number(value.slice(0, -2)));
  if (value.endsWith("s")) return Math.round(Number(value.slice(0, -1)) * 1000);
  return Math.round(Number(value));
}

function normalizeParamName(name: string): string {
  return name.startsWith("$") ? name.slice(1) : name;
}

function isParamRef(value: StaticValue): value is string {
  return typeof value === "string" && value.startsWith("$");
}

function isColorValue(value: StaticValue): value is string {
  return typeof value === "string" && (value.startsWith("#") || value === "transparent");
}

function isAnimatableScalar(value: StaticValue): boolean {
  return typeof value === "number" || isParamRef(value) || isColorValue(value);
}

function isVectorComponent(value: StaticValue): value is number | string {
  return typeof value === "number" || (typeof value === "string" && value.length > 0);
}

function isPaintProperty(value: string): boolean {
  return value === "fill" || value === "stroke" || value === "gradient";
}

function isGradientFunctionName(value: string): boolean {
  return value === "linear" || value === "radial" || value === "linear-gradient" || value === "radial-gradient";
}

function expressionScalar(value: StaticValue): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.startsWith("$")) return value;
  throw new SyntaxError(`Expected numeric wiggle argument, got '${String(value)}'`);
}

function joinExpressionParts(parts: string[]): string {
  return parts
    .join(" ")
    .replace(/\s+\(/g, "(")
    .replace(/\s+([),])/g, "$1")
    .replace(/,\s+/g, ",")
    .replace(/([(])\s+/g, "$1")
    .replace(/\s+:\s+/g, ":")
    .replace(/\s+([+\-*/^])\s+/g, " $1 ");
}

function loc(token: Token): SourceLocation {
  return { line: token.line, column: token.column };
}
