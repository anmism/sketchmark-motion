#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const root = path.resolve(__dirname, "..");

function printHelp() {
  console.log(`Usage:
  npm run preview -- [input.mmark] [--port 5175]

Examples:
  npm run preview -- examples/projectile-motion.mmark
  npm run preview -- examples/gallery/01-bouncing-ball.mmark --port 5180
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const options = parseArgs(args);
  const build = loadBuild();
  const initial = loadInitialSource(options.file);
  const compileCache = { source: null, scene: null };
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, build, initial, compileCache);
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`MotionMark preview running at http://127.0.0.1:${options.port}/`);
    console.log(`Loaded: ${path.relative(root, initial.filePath)}`);
  });
}

function parseArgs(args) {
  let file;
  let port = Number(process.env.PORT || 5175);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      port = Number(args[index + 1]);
      index += 1;
    } else if (!arg.startsWith("--") && !file) {
      file = arg;
    } else if (!arg.startsWith("--") && file && Number.isFinite(Number(arg))) {
      port = Number(arg);
    } else {
      throw new Error(`Unexpected argument '${arg}'`);
    }
  }

  return { file, port };
}

function loadBuild() {
  try {
    const build = {
      ...require("../dist/packages/parser/src"),
      ...require("../dist/packages/exporter/src")
    };

    // Auto-load fonts from fonts/ directory
    const fontsDir = path.join(root, "fonts");
    if (fs.existsSync(fontsDir) && build.loadFontsFromDirectory) {
      const registered = build.loadFontsFromDirectory(fontsDir);
      if (registered.length > 0) {
        console.log(`Loaded ${registered.length} font(s) from fonts/`);
        for (const font of registered) {
          console.log(`  - ${font.family} (weight: ${font.weight}, style: ${font.style})`);
        }
      }
    }

    return build;
  } catch {
    throw new Error("Build output not found. Run `npm run build` before starting the preview server.");
  }
}

function loadInitialSource(file) {
  if (file) {
    const filePath = resolveInsideRoot(file);
    return {
      filePath,
      baseDir: path.dirname(filePath),
      source: fs.readFileSync(filePath, "utf8")
    };
  }
  return {
    filePath: path.join(root, "untitled.mmark"),
    baseDir: root,
    source: ""
  };
}

function resolveInsideRoot(file) {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root)) {
    throw new Error("Preview file must be inside the motion-mark folder");
  }
  return resolved;
}

async function handleRequest(request, response, build, initial, compileCache) {
  const url = new URL(request.url || "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/") {
    sendFile(response, path.join(__dirname, "preview.html"), "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/initial") {
    sendJson(response, 200, {
      ok: true,
      file: path.relative(root, initial.filePath),
      source: initial.source
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/preview-client.js") {
    sendFile(response, path.join(__dirname, "preview-client.js"), "text/javascript; charset=utf-8");
    return;
  }

  if (request.method === "GET" && url.pathname === "/motionmark-player.js") {
    sendJavaScript(response, createBrowserPlayerBundle());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/compile") {
    await handleCompileRequest(request, response, build, initial, compileCache);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/frame") {
    await handleFrameRequest(request, response, build, initial, compileCache);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/audio/")) {
    handleAudioRequest(url.pathname, url.searchParams, response, initial);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/image/")) {
    handleImageRequest(url.pathname, url.searchParams, response, initial);
    return;
  }

  sendText(response, 404, "Not found");
}

async function handleCompileRequest(request, response, build, initial, compileCache) {
  try {
    const body = await readBody(request, 2_000_000);
    const payload = JSON.parse(body);
    const source = String(payload.source || "");
    const baseDir = resolveBaseDir(payload.filePath, initial);
    const scene = compileSource(build, source, baseDir, compileCache);
    sendJson(response, 200, { ok: true, scene });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleFrameRequest(request, response, build, initial, compileCache) {
  try {
    const body = await readBody(request, 2_000_000);
    const payload = JSON.parse(body);
    const source = String(payload.source || "");
    const tMs = Math.max(0, Number(payload.tMs || 0));
    const maxWidth = Math.max(160, Number(payload.maxWidth || 720));
    const baseDir = resolveBaseDir(payload.filePath, initial);
    const scene = compileSource(build, source, baseDir, compileCache);
    if (build.preloadImages) {
      await build.preloadImages(scene, baseDir);
    }
    const previewSize = getPreviewSize(scene.canvas.width, scene.canvas.height, maxWidth);
    const frame = build.renderFrameToRgba(scene, tMs, previewSize);

    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-width": String(frame.width),
      "x-height": String(frame.height),
      "x-duration-ms": String(scene.duration),
      "x-rendered-t-ms": String(tMs)
    });
    response.end(Buffer.from(frame.data));
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function handleAudioRequest(pathname, searchParams, response, initial) {
  const encoded = pathname.slice("/audio/".length);
  const decoded = decodeURIComponent(encoded);
  const baseDir = resolveBaseDir(searchParams.get("file"), initial);
  const resolved = path.resolve(baseDir, decoded);

  if (!resolved.startsWith(root)) {
    sendText(response, 403, "Forbidden: audio file outside project");
    return;
  }

  if (!fs.existsSync(resolved)) {
    sendText(response, 404, "Audio file not found: " + decoded);
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeTypes = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm"
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  const stat = fs.statSync(resolved);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "cache-control": "public, max-age=3600"
  });
  fs.createReadStream(resolved).pipe(response);
}

function handleImageRequest(pathname, searchParams, response, initial) {
  const encoded = pathname.slice("/image/".length);
  const decoded = decodeURIComponent(encoded);
  const baseDir = resolveBaseDir(searchParams.get("file"), initial);
  const resolved = path.resolve(baseDir, decoded);

  if (!resolved.startsWith(root)) {
    sendText(response, 403, "Forbidden: image file outside project");
    return;
  }

  if (!fs.existsSync(resolved)) {
    sendText(response, 404, "Image file not found: " + decoded);
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp"
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  const stat = fs.statSync(resolved);
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "cache-control": "public, max-age=3600"
  });
  fs.createReadStream(resolved).pipe(response);
}

function resolveBaseDir(filePath, initial) {
  if (filePath) {
    const resolved = path.resolve(root, filePath);
    if (resolved.startsWith(root)) {
      return path.dirname(resolved);
    }
  }
  return initial.baseDir;
}

function compileSource(build, source, baseDir, compileCache) {
  const cacheKey = `${baseDir}::${source}`;
  if (compileCache.key === cacheKey && compileCache.scene) {
    return compileCache.scene;
  }

  const scene = build.compileMotionMark(source, { resolveImport: createImportResolver(baseDir) });
  compileCache.key = cacheKey;
  compileCache.scene = scene;
  return scene;
}

function createImportResolver(baseDir) {
  return (importPath) => {
    const resolved = path.resolve(baseDir, importPath);
    if (!resolved.startsWith(root)) {
      throw new Error(`Import '${importPath}' resolves outside the motion-mark folder`);
    }
    return fs.readFileSync(resolved, "utf8");
  };
}

function createBrowserPlayerBundle() {
  const distRoot = path.join(root, "dist");
  const entryId = "packages/player/src/index.js";
  const modules = new Map();

  function toModuleId(filePath) {
    return path.relative(distRoot, filePath).replace(/\\/g, "/");
  }

  function resolveModule(fromId, specifier) {
    if (!specifier.startsWith(".")) {
      throw new Error(`Cannot bundle external module '${specifier}' for preview player`);
    }

    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), specifier));
    const candidates = [
      base,
      `${base}.js`,
      path.posix.join(base, "index.js")
    ];

    for (const candidate of candidates) {
      const fullPath = path.join(distRoot, candidate);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return toModuleId(fullPath);
      }
    }

    throw new Error(`Cannot resolve '${specifier}' from '${fromId}'`);
  }

  function addModule(id) {
    if (modules.has(id)) return;

    const fullPath = path.join(distRoot, id);
    let code = fs.readFileSync(fullPath, "utf8");
    const deps = [];
    code = code.replace(/require\(("([^"]+)"|'([^']+)')\)/g, (match, quoted, doubleQuoted, singleQuoted) => {
      const specifier = doubleQuoted || singleQuoted;
      if (!specifier || !specifier.startsWith(".")) return match;
      const depId = resolveModule(id, specifier);
      deps.push(depId);
      return `require(${JSON.stringify(depId)})`;
    });

    modules.set(id, code);
    for (const dep of deps) addModule(dep);
  }

  addModule(entryId);

  const moduleEntries = Array.from(modules.entries())
    .map(([id, code]) => `${JSON.stringify(id)}: function(require, module, exports) {\n${code}\n}`)
    .join(",\n");

  return `(function() {
  var factories = {
${moduleEntries}
  };
  var cache = {};
  function require(id) {
    if (cache[id]) return cache[id].exports;
    var factory = factories[id];
    if (!factory) throw new Error("Preview player module not found: " + id);
    var module = { exports: {} };
    cache[id] = module;
    factory(require, module, module.exports);
    return module.exports;
  }
  window.motionmarkPlayer = require(${JSON.stringify(entryId)});
})();`;
}

function getPreviewSize(width, height, maxWidth) {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  };
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendFile(response, filePath, contentType) {
  try {
    const body = fs.readFileSync(filePath);
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
    response.end(body);
  } catch {
    sendText(response, 404, "File not found");
  }
}

function sendJavaScript(response, body) {
  response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

main();
