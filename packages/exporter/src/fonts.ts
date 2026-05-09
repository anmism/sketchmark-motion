import { FontLibrary } from "skia-canvas";
import * as fs from "fs";
import * as path from "path";

export interface FontRegistration {
  family: string;
  weight: string;
  style: string;
  path: string;
}

const registeredFonts = new Set<string>();

export function loadFontsFromDirectory(fontsDir: string): FontRegistration[] {
  const registered: FontRegistration[] = [];

  if (!fs.existsSync(fontsDir)) {
    return registered;
  }

  const files = fs.readdirSync(fontsDir);
  const fontFiles = files.filter((file) => /\.(ttf|otf|woff|woff2)$/i.test(file));

  for (const file of fontFiles) {
    const fontPath = path.join(fontsDir, file);
    const parsed = parseFontFilename(file);

    const key = `${parsed.family}:${parsed.weight}:${parsed.style}`;
    if (registeredFonts.has(key)) {
      continue;
    }

    try {
      FontLibrary.use(parsed.family, [fontPath]);
      registeredFonts.add(key);
      registered.push({ ...parsed, path: fontPath });
    } catch (error) {
      console.warn(`Failed to register font ${file}:`, error);
    }
  }

  return registered;
}

export function parseFontFilename(filename: string): { family: string; weight: string; style: string } {
  const name = filename.replace(/\.(ttf|otf|woff|woff2)$/i, "");

  const weightMap: Record<string, string> = {
    thin: "100",
    hairline: "100",
    extralight: "200",
    ultralight: "200",
    light: "300",
    regular: "400",
    normal: "400",
    medium: "500",
    semibold: "600",
    demibold: "600",
    bold: "700",
    extrabold: "800",
    ultrabold: "800",
    black: "900",
    heavy: "900"
  };

  const styleKeywords = ["italic", "oblique"];

  let weight = "400";
  let style = "normal";
  let family = name;

  // Check for pattern: FontName-WeightStyle (e.g., Poppins-BoldItalic)
  const dashMatch = name.match(/^(.+?)-([A-Za-z]+)$/);
  if (dashMatch) {
    family = dashMatch[1]!;
    const suffix = dashMatch[2]!.toLowerCase();

    // Check for style
    for (const s of styleKeywords) {
      if (suffix.includes(s)) {
        style = s;
      }
    }

    // Check for weight
    const suffixWithoutStyle = suffix.replace(/italic|oblique/gi, "");
    for (const [key, value] of Object.entries(weightMap)) {
      if (suffixWithoutStyle === key || suffixWithoutStyle.includes(key)) {
        weight = value;
        break;
      }
    }
  }

  // Also check for underscore pattern: Font_Name_Bold
  const underscoreMatch = name.match(/^(.+?)_([A-Za-z]+)$/);
  if (!dashMatch && underscoreMatch) {
    family = underscoreMatch[1]!.replace(/_/g, " ");
    const suffix = underscoreMatch[2]!.toLowerCase();

    for (const s of styleKeywords) {
      if (suffix.includes(s)) {
        style = s;
      }
    }

    const suffixWithoutStyle = suffix.replace(/italic|oblique/gi, "");
    for (const [key, value] of Object.entries(weightMap)) {
      if (suffixWithoutStyle === key || suffixWithoutStyle.includes(key)) {
        weight = value;
        break;
      }
    }
  }

  return { family, weight, style };
}

export function getRegisteredFontFamilies(): string[] {
  const families = new Set<string>();
  for (const key of registeredFonts) {
    const [family] = key.split(":");
    if (family) families.add(family);
  }
  return Array.from(families);
}

export function clearRegisteredFonts(): void {
  registeredFonts.clear();
}
