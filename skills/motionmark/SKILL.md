---
name: motionmark
description: Author, edit, validate, and explain MotionMark .mmark animation DSL files. Use for generating motion graphics, educational animations, product intros, UI animations, data visualizations, physics/math motion, particle effects, reusable @motion/@draw marks, scene composition, masking, audio, camera motion, rendering/export workflows, and 2.5D/3D perspective scenes with planes, groups, views, line3d/poly3d/path3d, and solid primitives such as cuboid, sphere, cylinder, cone, pyramid, prism, and torus.
---

# MotionMark

Author valid, copy-pasteable MotionMark DSL (`.mmark`) that renders to animated video.

## Reference Map

**Primary source (read first):**

**Secondary references (read only if needed):**
- `references/dsl-syntax.md` - complete property inventory and validation rules.
- `references/composition.md` - scenes, groups, camera, masks, motion paths, audio, `@draw`, `@system`.
- `references/particles.md` - `@emitter` usage and recipes.
- `references/paths.md` - SVG paths, function paths, parametric paths.
- `references/motions.md` - reusable `@motion` definitions.
- `references/3d.md` - 3D properties, `@view`, solid primitives.
- `references/3d-patterns.md` - 3D example builds.
- `references/rendering.md` - CLI rendering and export.

## Feature Separation

- **Core 2D**: header, variables, rect/circle/ellipse/text/line/path/image, styling, transforms, and lifetimes.
- **Animation**: static values, tweens, multi-step tweens, keyframes, expressions, wiggle, easing, color animation, stroke draw controls.
- **Composition**: scenes, groups, camera, masks, blend modes, motion paths, repeated clones, imports, audio, and draw marks.
- **Reuse**: `@motion` for reusable property animation; `@draw` for reusable element structures; `use` imports for shared files.
- **Effects**: gradients, blur, brightness, contrast, saturation, hue rotation, shadow, dashes, rounded corners.
- **Particles**: `@emitter` for rain, snow, fire, smoke, sparks, confetti, and burst effects.
- **3D**: perspective header fields, z-depth, 3D rotations, `@view` planes, 3D primitives, solid primitives, depth sorting, and billboards.
- **Output**: render previews and export MP4 via the MotionMark CLI.

## Minimal Template

```mmark
---
canvas: 640x360
bg: #0f172a
fps: 60
$accent: #38bdf8
---

rect card w:220 h:120 fill:#111827 stroke:$accent strokeWidth:2 cornerRadius:12 | 0s - 4s
  x: 320
  y: 180
  opacity: 0 -> 1 over 0.5s ease-out
  scale: 0.9 -> 1 over 0.7s spring(stiffness:160, damping:13)

text label "MotionMark" font:Roboto size:28 fill:#e2e8f0 weight:bold | 0.2s - 4s
  x: 320
  y: 180
  opacity: 0 -> 1 over 0.4s ease-out
```

## Authoring Rules

- Start each real animation with a `---` header unless editing a file that intentionally omits one.
- Use variables for repeated colors, sizes, and timing values.
- Give every element a stable, unique id.
- Put animated/body properties on indented lines under the element.
- Keep inline props for fixed shape identity (`w`, `h`, `r`, `fill`, `stroke`, `font`, `size`, `parent`).
- Use `| start - end`, `| persist`, or scene lifetimes so visibility is explicit.
- Use `deg` for human-readable rotations; raw numeric rotations are radians.
- Use `parent:` to compose groups and 3D structures.
- Use `fill:none` or `fill:transparent` for stroked-only shapes.
- Keep gradient paints static; animate element transforms or flat colors instead.

## Validation Checklist

- Header delimiters are balanced.
- Canvas uses `WIDTHxHEIGHT`; `fps` is positive.
- Element ids are unique and referenced parents exist.
- Lifetimes use `s`, `ms`, `end`, or `persist` correctly.
- Indentation is consistent for property bodies.
- Strings use double quotes.
- Path and mask strings stay quoted when they contain spaces.
- `draw` is not mixed with `drawStart`/`drawEnd` on the same element.
- Static-only properties stay static: `dashArray`, `shadow`, `repeat`, `repeatOffset`, `rotateOrder`, `sort`, `billboard`, `@view at/normal/up`, `line3d from/to`, and 3D point lists.

## Pre-Output Checklist

Before returning `.mmark` code, verify:

1. Header has `---` delimiters with `canvas: WxH` and `fps: N`
2. Every element has a unique id
3. Every element has explicit lifetime: `| Xs - Ys` or `| persist`
4. Angles use `deg` suffix: `45deg` not `0.785`
5. Times use seconds: `0.5s` not `500ms`
6. Colors use 6-digit hex: `#38bdf8` not `#3bf`
7. Points use `from:(x,y) to:(x,y)` not `x1:N y1:N`
8. `draw` is NOT combined with `drawStart`/`drawEnd`
9. Static-only properties are NOT animated (see list below)
10. All `parent:` references exist
11. Strings use double quotes

## Static-Only Properties (NEVER animate)

```
anchor, origin, parent, comp, mask, gradient, dashArray, shadow,
repeat, repeatOffset, motionPath, motionRotate, rotateOrder, sort,
billboard, at, normal, up, from, to, points, closed
```

## Quality Bar

- Produce examples that can be pasted directly into `.mmark`.
- Prefer readable timing and staged entrances over many simultaneous changes.
- Use 24-30 fps minimum; use 60 fps for 3D, smooth motion, and particle-heavy scenes.
- Test physics expressions at representative times.
