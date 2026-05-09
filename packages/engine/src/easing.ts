export type EasingFunction = (t: number) => number;

export function getEasingFunction(name: string): EasingFunction {
  const normalized = name.trim();

  if (normalized.startsWith("cubic-bezier(") && normalized.endsWith(")")) {
    const values = normalized
      .slice("cubic-bezier(".length, -1)
      .split(",")
      .map((part) => Number(part.trim()));

    if (values.length === 4 && values.every((value) => Number.isFinite(value))) {
      return cubicBezier(values[0]!, values[1]!, values[2]!, values[3]!);
    }
  }

  if (normalized.startsWith("spring(") && normalized.endsWith(")")) {
    return spring(parseSpringOptions(normalized));
  }

  return easingFunctions[normalized] ?? easingFunctions.linear;
}

export const easingFunctions: Record<string, EasingFunction> = {
  linear: (t) => clamp01(t),
  "ease-in": (t) => cubicBezier(0.42, 0, 1, 1)(t),
  "ease-out": (t) => cubicBezier(0, 0, 0.58, 1)(t),
  "ease-in-out": (t) => cubicBezier(0.42, 0, 0.58, 1)(t)
};

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  return (t: number) => {
    const x = clamp01(t);
    const curveT = solveCurveX(x, x1, x2);
    return clamp01(sampleCurve(curveT, y1, y2));
  };
}

interface SpringOptions {
  stiffness: number;
  damping: number;
  mass: number;
  velocity: number;
}

function parseSpringOptions(source: string): SpringOptions {
  const body = source.slice("spring(".length, -1).trim();
  const options: SpringOptions = {
    stiffness: 180,
    damping: 12,
    mass: 1,
    velocity: 0
  };
  if (body.length === 0) return options;

  const positional: number[] = [];
  for (const part of body.split(",").map((item) => item.trim()).filter(Boolean)) {
    const named = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(-?(?:\d+|\d*\.\d+))$/.exec(part);
    if (named) {
      const key = named[1]!;
      const value = Number(named[2]);
      if (key === "stiffness" || key === "damping" || key === "mass" || key === "velocity") {
        options[key] = value;
      }
      continue;
    }

    const value = Number(part);
    if (Number.isFinite(value)) positional.push(value);
  }

  if (positional[0] !== undefined) options.stiffness = positional[0];
  if (positional[1] !== undefined) options.damping = positional[1];
  if (positional[2] !== undefined) options.mass = positional[2];
  if (positional[3] !== undefined) options.velocity = positional[3];

  options.stiffness = Math.max(0.0001, options.stiffness);
  options.damping = Math.max(0, options.damping);
  options.mass = Math.max(0.0001, options.mass);
  return options;
}

function spring(options: SpringOptions): EasingFunction {
  return (t: number) => {
    const time = Math.max(0, t);
    if (time === 0) return 0;

    const omega0 = Math.sqrt(options.stiffness / options.mass);
    const zeta = options.damping / (2 * Math.sqrt(options.stiffness * options.mass));

    if (zeta < 1) {
      const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
      const envelope = Math.exp(-zeta * omega0 * time);
      const position =
        1 -
        envelope *
          (Math.cos(omegaD * time) +
            ((zeta * omega0 - options.velocity) / omegaD) * Math.sin(omegaD * time));
      return position;
    }

    if (zeta === 1) {
      const envelope = Math.exp(-omega0 * time);
      return 1 - envelope * (1 + (omega0 - options.velocity) * time);
    }

    const sqrtTerm = Math.sqrt(zeta * zeta - 1);
    const rootA = -omega0 * (zeta - sqrtTerm);
    const rootB = -omega0 * (zeta + sqrtTerm);
    const coeffB = (options.velocity - rootA) / (rootB - rootA);
    const coeffA = 1 - coeffB;
    return 1 - coeffA * Math.exp(rootA * time) - coeffB * Math.exp(rootB * time);
  };
}

function solveCurveX(x: number, x1: number, x2: number): number {
  let t = x;

  for (let index = 0; index < 8; index += 1) {
    const estimate = sampleCurve(t, x1, x2) - x;
    if (Math.abs(estimate) < 1e-6) return t;

    const derivative = sampleDerivative(t, x1, x2);
    if (Math.abs(derivative) < 1e-6) break;
    t -= estimate / derivative;
  }

  let lower = 0;
  let upper = 1;
  t = x;

  while (lower < upper) {
    const estimate = sampleCurve(t, x1, x2);
    if (Math.abs(estimate - x) < 1e-6) return t;
    if (x > estimate) lower = t;
    else upper = t;
    t = (upper + lower) / 2;
  }

  return t;
}

function sampleCurve(t: number, p1: number, p2: number): number {
  const invT = 1 - t;
  return 3 * invT * invT * t * p1 + 3 * invT * t * t * p2 + t * t * t;
}

function sampleDerivative(t: number, p1: number, p2: number): number {
  return 3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
