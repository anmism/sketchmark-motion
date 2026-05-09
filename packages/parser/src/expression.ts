export type NumericFn = (scope?: Record<string, number>) => number;

type ExpressionToken =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^" }
  | { type: "leftParen" }
  | { type: "rightParen" }
  | { type: "comma" }
  | { type: "eof" };

type ExpressionNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; operator: "+" | "-"; value: ExpressionNode }
  | { type: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: ExpressionNode; right: ExpressionNode }
  | { type: "call"; name: string; args: ExpressionNode[] };

export function compileArithmeticExpression(source: string): () => number {
  const compiled = compileNumericExpression(source);
  return () => compiled({});
}

// Expression cache for performance optimization
const expressionCache = new Map<string, NumericFn>();

export function compileNumericExpression(source: string): NumericFn {
  // Check cache first
  const cached = expressionCache.get(source);
  if (cached) return cached;

  const parser = new NumericExpressionParser(tokenizeExpression(source));
  const ast = parser.parseExpression();
  parser.expectEnd();
  const fn: NumericFn = (scope: Record<string, number> = {}) => evaluate(ast, scope);

  // Cache the compiled function
  expressionCache.set(source, fn);
  return fn;
}

export function clearExpressionCache(): void {
  expressionCache.clear();
}

class NumericExpressionParser {
  private index = 0;

  constructor(private readonly tokens: ExpressionToken[]) {}

  parseExpression(): ExpressionNode {
    return this.parseAdditive();
  }

  expectEnd(): void {
    if (this.peek().type !== "eof") {
      throw new SyntaxError("Unexpected token after end of numeric expression");
    }
  }

  private parseAdditive(): ExpressionNode {
    let value = this.parseMultiplicative();
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      value = { type: "binary", operator, left: value, right };
    }
    return value;
  }

  private parseMultiplicative(): ExpressionNode {
    let value = this.parseUnary();
    while (this.matchOperator("*") || this.matchOperator("/")) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      value = { type: "binary", operator, left: value, right };
    }
    return value;
  }

  private parseUnary(): ExpressionNode {
    if (this.matchOperator("+")) return { type: "unary", operator: "+", value: this.parseUnary() };
    if (this.matchOperator("-")) return { type: "unary", operator: "-", value: this.parseUnary() };
    return this.parsePower();
  }

  private parsePower(): ExpressionNode {
    const left = this.parsePrimary();
    if (this.matchOperator("^")) {
      return { type: "binary", operator: "^", left, right: this.parseUnary() };
    }
    return left;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.advance();
    if (token.type === "number") return { type: "number", value: token.value };

    if (token.type === "identifier") {
      if (this.match("leftParen")) {
        const args: ExpressionNode[] = [];
        while (!this.check("rightParen") && !this.check("eof")) {
          args.push(this.parseExpression());
          if (!this.match("comma")) break;
        }
        this.consume("rightParen", "Expected ')' after function arguments");
        return { type: "call", name: token.value, args };
      }

      return { type: "variable", name: token.value };
    }

    if (token.type === "leftParen") {
      const value = this.parseExpression();
      this.consume("rightParen", "Expected ')' in numeric expression");
      return value;
    }

    throw new SyntaxError("Expected number, variable, function call, or parenthesized expression");
  }

  private matchOperator(operator: "+" | "-" | "*" | "/" | "^"): boolean {
    const token = this.peek();
    if (token.type !== "operator" || token.value !== operator) return false;
    this.index += 1;
    return true;
  }

  private consume(type: ExpressionToken["type"], message: string): ExpressionToken {
    if (this.check(type)) return this.advance();
    throw new SyntaxError(message);
  }

  private match(type: ExpressionToken["type"]): boolean {
    if (!this.check(type)) return false;
    this.index += 1;
    return true;
  }

  private check(type: ExpressionToken["type"]): boolean {
    return this.peek().type === type;
  }

  private advance(): ExpressionToken {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private peek(): ExpressionToken {
    return this.tokens[this.index] ?? { type: "eof" };
  }

  private previous(): Extract<ExpressionToken, { type: "operator" }> {
    return this.tokens[this.index - 1] as Extract<ExpressionToken, { type: "operator" }>;
  }
}

function evaluate(node: ExpressionNode, scope: Record<string, number>): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "variable":
      return resolveVariable(node.name, scope);
    case "unary": {
      const value = evaluate(node.value, scope);
      return node.operator === "-" ? -value : value;
    }
    case "binary":
      return evaluateBinary(node.operator, evaluate(node.left, scope), evaluate(node.right, scope));
    case "call":
      return evaluateCall(node.name, node.args.map((arg) => evaluate(arg, scope)));
  }
}

function evaluateBinary(operator: "+" | "-" | "*" | "/" | "^", left: number, right: number): number {
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "*") return left * right;
  if (operator === "/") return left / right;
  return left ** right;
}

function resolveVariable(name: string, scope: Record<string, number>): number {
  if (name === "pi" || name === "PI") return Math.PI;
  if (name === "e" || name === "E") return Math.E;

  const value = scope[name];
  if (value === undefined) {
    throw new Error(`Unknown expression variable '${name}'`);
  }
  return value;
}

function evaluateCall(name: string, args: number[]): number {
  const fn = functions[name];
  if (!fn) {
    throw new Error(`Unknown expression function '${name}'`);
  }
  return fn(args);
}

const functions: Record<string, (args: number[]) => number> = {
  sin: ([value]) => Math.sin(requireArg(value, "sin")),
  cos: ([value]) => Math.cos(requireArg(value, "cos")),
  tan: ([value]) => Math.tan(requireArg(value, "tan")),
  sqrt: ([value]) => Math.sqrt(requireArg(value, "sqrt")),
  abs: ([value]) => Math.abs(requireArg(value, "abs")),
  min: (args) => Math.min(...requireArgs(args, "min")),
  max: (args) => Math.max(...requireArgs(args, "max")),
  pow: ([base, exp]) => requireArg(base, "pow") ** requireArg(exp, "pow"),
  mod: ([left, right]) => requireArg(left, "mod") % requireArg(right, "mod"),
  wiggle: ([time, freq, amp, base = 0, seed = 0]) =>
    valueNoise(
      requireArg(time, "wiggle"),
      requireArg(freq, "wiggle"),
      requireArg(amp, "wiggle"),
      base,
      seed
    ),
  linear: ([value]) => clamp01(requireArg(value, "linear")),
  "ease-in": ([value]) => {
    const t = clamp01(requireArg(value, "ease-in"));
    return t * t * t;
  },
  "ease-out": ([value]) => {
    const t = clamp01(requireArg(value, "ease-out")) - 1;
    return t * t * t + 1;
  },
  "ease-in-out": ([value]) => {
    const t = clamp01(requireArg(value, "ease-in-out"));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }
};

function requireArg(value: number | undefined, name: string): number {
  if (value === undefined) {
    throw new Error(`${name} expects an argument`);
  }
  return value;
}

function requireArgs(args: number[], name: string): number[] {
  if (args.length === 0) {
    throw new Error(`${name} expects at least one argument`);
  }
  return args;
}

function valueNoise(time: number, frequency: number, amplitude: number, base: number, seed: number): number {
  const x = time * frequency + seed * 101.3;
  const left = Math.floor(x);
  const right = left + 1;
  const progress = x - left;
  const eased = progress * progress * (3 - 2 * progress);
  const noise = lerp(hashNoise(left, seed), hashNoise(right, seed), eased) * 2 - 1;
  return base + noise * amplitude;
}

function hashNoise(value: number, seed: number): number {
  const raw = Math.sin(value * 127.1 + seed * 311.7) * 43758.5453123;
  return raw - Math.floor(raw);
}

function lerp(left: number, right: number, t: number): number {
  return left + (right - left) * t;
}

function tokenizeExpression(source: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const numberMatch = /^\d+(?:\.\d+)?(?:deg|rad)?/.exec(source.slice(index));
    if (numberMatch) {
      tokens.push({ type: "number", value: parseExpressionNumber(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = /^[A-Za-z_$][A-Za-z0-9_$.-]*/.exec(source.slice(index));
    if (identifierMatch) {
      tokens.push({ type: "identifier", value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }

    if ("+-*/^".includes(char)) {
      tokens.push({ type: "operator", value: char as "+" | "-" | "*" | "/" | "^" });
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }

    throw new SyntaxError(`Unexpected expression character '${char}'`);
  }

  tokens.push({ type: "eof" });
  return tokens;
}

function parseExpressionNumber(value: string): number {
  if (value.endsWith("deg")) return (Number(value.slice(0, -3)) * Math.PI) / 180;
  if (value.endsWith("rad")) return Number(value.slice(0, -3));
  return Number(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
