export type AssetKind = "image" | "audio";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function isRemoteAsset(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

export async function resolveAssetPath(
  src: string,
  basePath: string,
  kind: AssetKind,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<string | undefined> {
  const path = loadNodeModule<typeof import("path")>("path");
  const fs = loadNodeModule<typeof import("fs")>("fs");

  if (!isRemoteAsset(src)) {
    const resolved = path.isAbsolute(src) ? src : path.resolve(basePath, src);
    return fs.existsSync(resolved) ? resolved : undefined;
  }

  return downloadRemoteAsset(src, kind, options);
}

async function downloadRemoteAsset(
  src: string,
  kind: AssetKind,
  options: { maxBytes?: number; timeoutMs?: number }
): Promise<string | undefined> {
  if (typeof fetch === "undefined") {
    return undefined;
  }

  const crypto = loadNodeModule<typeof import("crypto")>("crypto");
  const fs = loadNodeModule<typeof import("fs")>("fs");
  const os = loadNodeModule<typeof import("os")>("os");
  const path = loadNodeModule<typeof import("path")>("path");

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hash = crypto.createHash("sha256").update(src).digest("hex");
  const cacheDir = path.join(os.tmpdir(), "motionmark-assets");
  fs.mkdirSync(cacheDir, { recursive: true });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(src, { signal: controller.signal });
    if (!response.ok) return undefined;

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxBytes) return undefined;

    const contentType = response.headers.get("content-type") || "";
    const ext = inferExtension(src, contentType, kind);
    const cachedPath = path.join(cacheDir, `${hash}${ext}`);
    if (fs.existsSync(cachedPath)) return cachedPath;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) return undefined;

    fs.writeFileSync(cachedPath, Buffer.from(arrayBuffer));
    return cachedPath;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function inferExtension(src: string, contentType: string, kind: AssetKind): string {
  const path = loadNodeModule<typeof import("path")>("path");

  try {
    const ext = path.extname(new URL(src).pathname).toLowerCase();
    if (ext) return ext;
  } catch {
    // Fall through to content-type based inference.
  }

  const normalized = contentType.toLowerCase().split(";")[0]?.trim();
  const byMime: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/aac": ".aac",
    "audio/mp4": ".m4a",
    "audio/webm": ".webm"
  };

  return byMime[normalized || ""] ?? (kind === "image" ? ".img" : ".audio");
}

function loadNodeModule<T>(name: string): T {
  try {
    const nodeRequire = eval("require") as NodeRequire;
    return nodeRequire(name) as T;
  } catch {
    throw new Error(`Cannot load Node module '${name}' outside a CommonJS runtime`);
  }
}
