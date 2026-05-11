import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssetPath, isRemoteAsset } from "../../packages/exporter/src/assets";

test("detects remote assets", () => {
  assert.equal(isRemoteAsset("https://example.com/image.png"), true);
  assert.equal(isRemoteAsset("http://example.com/audio.mp3"), true);
  assert.equal(isRemoteAsset("image.png"), false);
  assert.equal(isRemoteAsset("data:image/png;base64,abc"), false);
});

test("resolves local asset paths relative to base path", async () => {
  const resolved = await resolveAssetPath("package.json", process.cwd(), "image");
  assert.ok(resolved?.endsWith("package.json"));
});
