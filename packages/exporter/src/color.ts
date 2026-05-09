export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function lerpColor(from: RgbaColor, to: RgbaColor, t: number): RgbaColor {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
    a: Math.round(from.a + (to.a - from.a) * t)
  };
}

export function colorToHex(color: RgbaColor): string {
  const r = color.r.toString(16).padStart(2, "0");
  const g = color.g.toString(16).padStart(2, "0");
  const b = color.b.toString(16).padStart(2, "0");
  if (color.a === 255) {
    return `#${r}${g}${b}`;
  }
  const a = color.a.toString(16).padStart(2, "0");
  return `#${r}${g}${b}${a}`;
}

export function parseColor(input: string): RgbaColor {
  const color = input.trim();
  if (color === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (color.startsWith("#")) {
    return parseHexColor(color);
  }

  throw new Error(`Unsupported color '${input}'`);
}

function parseHexColor(color: string): RgbaColor {
  const hex = color.slice(1);
  if (![3, 4, 6, 8].includes(hex.length)) {
    throw new Error(`Unsupported hex color '${color}'`);
  }

  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((part) => part + part)
          .join("")
      : hex;

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
    a: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) : 255
  };
}

