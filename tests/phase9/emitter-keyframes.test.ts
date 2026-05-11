import assert from "node:assert/strict";
import test from "node:test";
import { compileMotionMark } from "../../packages/parser/src";

test("samples emitter x/y keyframes at particle birth time", () => {
  const scene = compileMotionMark(`@emitter sparks | 3s - 6s
  template: circle r:2 fill:#fff
  spawn: 1/s
  lifetime: 0.5s
  x: 100 at 0s, 130 at 3s
  y: 600 at 0s, 300 at 3s
`);

  const particles = scene.elements.filter((element) => element.id.startsWith("sparks__p"));
  assert.equal(particles.length, 3);

  assert.deepEqual(
    particles.map((particle) => particle.lifetime.start),
    [3000, 4000, 5000]
  );
  assert.deepEqual(
    particles.map((particle) => particle.static.x),
    [100, 110, 120]
  );
  assert.deepEqual(
    particles.map((particle) => particle.static.y),
    [600, 500, 400]
  );
});

test("samples emitter x/y tweens at particle birth time", () => {
  const scene = compileMotionMark(`@emitter sparks | 0s - 3s
  template: circle r:2 fill:#fff
  spawn: 1/s
  lifetime: 0.5s
  x: 200 -> 260 over 3s
  y: 100 -> 160 over 3s
`);

  const particles = scene.elements.filter((element) => element.id.startsWith("sparks__p"));
  assert.deepEqual(
    particles.map((particle) => particle.static.x),
    [200, 220, 240]
  );
  assert.deepEqual(
    particles.map((particle) => particle.static.y),
    [100, 120, 140]
  );
});

test("samples emitter x/y expressions at particle birth time", () => {
  const scene = compileMotionMark(`@emitter orbit | 0s - 3s
  template: circle r:2 fill:#fff
  spawn: 1/s
  lifetime: 0.5s
  x: f(t) = 200 + 10 * t
  y: f(t) = 300 - 20 * t
`);

  const particles = scene.elements.filter((element) => element.id.startsWith("orbit__p"));
  assert.deepEqual(
    particles.map((particle) => particle.static.x),
    [200, 210, 220]
  );
  assert.deepEqual(
    particles.map((particle) => particle.static.y),
    [300, 280, 260]
  );
});

test("rejects emitter keyframes outside x/y", () => {
  assert.throws(
    () =>
      compileMotionMark(`@emitter sparks | 0s - 1s
  template: circle r:2 fill:#fff
  spawn: 1/s
  lifetime: 0.5s
  opacity: 1 at 0s, 0 at 1s
`),
    /@emitter keyframes are only supported for x and y/
  );
});
