---
name: motionmark
description: Create and edit MotionMark .mmark animation files. Compact DSL for 2D motion graphics, particles, groups, paths, and simple 3D scenes.
---

# MotionMark

Author valid `.mmark` files using the grammar below. Read references only when a feature needs them.

## References

- `references/elements.md` — element types, inline props, static props.
- `references/animation.md` — tween, keyframes, expressions, easing.
- `references/composition.md` — groups, scenes, camera, masks, @draw, @motion.
- `references/particles.md` — @emitter syntax and constraints.
- `references/paths.md` — SVG, point-list, function, parametric paths.
- `references/3d.md` — perspective, 3D solids, views.

## File Shape

```mmark
---
canvas: WIDTHxHEIGHT
bg: #hex6
fps: 60
$varName: value
---

type id inlineProp:value ... | startTime - endTime
  property: value
  property: from -> to over duration easing
```

## Minimal Example

```mmark
---
canvas: 640x360
bg: #0f172a
fps: 60
---

rect card w:220 h:120 fill:#111827 cornerRadius:12 | 0s - 4s
  x: 320
  y: 180
  opacity: 0 -> 1 over 0.5s ease-out

text title "Hello" font:Roboto size:28 fill:#e2e8f0 weight:bold | 0.2s - 4s
  x: 320
  y: 184
  opacity: 0 -> 1 over 0.4s ease-out
```

## @emitter (Particles) — STRICT syntax

The @emitter declaration line takes ONLY an id and a lifetime. All other properties go in the body. The template is a single inline line with NO nested children.

```mmark
@emitter sparks | 0s - 3s
  template: circle r:4 fill:#f97316
  spawn: 40/s
  lifetime: 0.8s
  x: 320
  y: 180
  vx: random(-160, 160)
  vy: random(-220, -80)
  gravity: 180
  opacity: 1 -> 0 over life
  scale: 1 -> 0.2 over life
  fill: #f97316 -> #fde047 over life
```

Emitter rules:
- Declaration: `@emitter id | start - end` — NOTHING else on this line.
- Body values ONLY: static numbers, `random(min, max)`, `N/s`, `Ns`, `#hex -> #hex over life`, `N -> N over life`, and `x`/`y` tween/keyframes/expression.
- NO animation forms except on `x`/`y`, NO nested bodies.
- Template is ONE line: `template: type prop:value prop:value`. No children below it.
- Emitters cannot be parented. Source position can move only with `x`/`y` tween/keyframes/expression, sampled at particle birth.
- `spawn` must be positive (e.g. `40/s`). `lifetime` must be positive with unit (e.g. `0.8s`).
- Particle lifetime must be shorter than emitter duration. Keep spawn rates under 80/s to avoid excess particles.

## Animation (Elements only)

```mmark
x: 100 -> 500 over 2s ease-out
scale: 1 -> 1.2 -> 1 over 0.8s ease-in-out
y: 280 at 0s, 90 at 0.5s ease-out, 280 at 1s ease-in
rotation: f(t) = t * 2
x: wiggle(2, 40, base:320, seed:1)
```

Easing: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(x1,y1,x2,y2)`, `spring(stiffness:160, damping:13)`.

These forms work in element/group/camera bodies. In @emitter, only `x`/`y` can use tween/keyframes/expression, sampled at particle birth.

Each property uses ONE form per line. Never combine forms:
- WRONG: `opacity: 0 -> 1 over 0.1s, 1 -> 0 over 0.3s` (two tweens comma-joined)
- RIGHT: `opacity: 0 -> 1 -> 0 over 0.4s ease-in-out` (multi-value tween)
- RIGHT: `opacity: 0 at 0s, 1 at 0.1s, 0 at 0.4s` (keyframes)

## Hard Rules

1. Every element MUST have a lifetime: `| 0s - 3s`, `| 1s - end`, or `| persist`.
2. Body lines use exactly 2-space indent.
3. Strings are always double-quoted: `"Hello"`, `d:"M 0 0 L 10 10"`.
4. Colors are 6-digit hex: `#ffffff`. Never 3-digit, never named colors.
5. Times always have units: `0.5s` or `300ms`. Never bare numbers for time.
6. IDs must be unique across the entire file.
7. `parent:id` must reference an already-declared group/view.
8. Never combine `draw` with `drawStart` or `drawEnd`.
9. Static-only props cannot be animated (see elements.md for list).
10. 2D `rotation` uses plain numbers (degrees implied): `rotation: 45`.
11. 3D rotations use `deg` suffix: `rotateX: -18deg`, `rotateY: 0deg -> 360deg over 6s linear`.
12. To delay animation start, use keyframes: `y: 100 at 0s, 100 at 2s, 500 at 4s ease-out`. There is no `delay` or `from Ns` syntax.
13. One animation form per property line. Never comma-join multiple tweens.

## NEVER Do

- Never put inline props on @emitter line. WRONG: `@emitter fire spawn:40/s | 0s-3s`. RIGHT: put spawn in body.
- Never put children under template. WRONG: `template: circle r:4\n  opacity: ...`. Template has no body.
- Never use animation forms on non-position props in @emitter body. Only `x`/`y` can use tween/keyframes/expression.
- Never use CSS, SVG tags, or HTML inside .mmark.
- Never use `deg` on 2D `rotation` property.
- Never animate static-only props: `parent`, `anchor`, `origin`, `mask`, `comp`, `motionPath`, `from`, `to`, `points`.
- Never use `random()` outside @emitter bodies.
- Never put `over life` animations outside @emitter bodies.
- Never use 3-digit hex colors like `#fff`.
- Never omit the lifetime `| start - end` on visible elements.
- Never use `rate:`, `life:`, or `element:` in emitters. Correct: `spawn: N/s`, `lifetime: Ns`, `template: type props`.
- Never comma-join tweens: WRONG `opacity: 0 -> 1 over 0.1s, 1 -> 0 over 0.3s`. Use multi-value tween or keyframes instead.
- Never use comments (`//` or `/* */`). The parser does not support comments.

## Validate Before Output

1. Header has `---` delimiters, valid `canvas`, `bg`, `fps`.
2. All IDs unique, all `parent:` refs exist.
3. Every visible element has a lifetime.
4. 2-space indent on all body lines.
5. @emitter: declaration has only id + lifetime; body has only allowed value types.
6. Strings, paths, and text content are double-quoted.
