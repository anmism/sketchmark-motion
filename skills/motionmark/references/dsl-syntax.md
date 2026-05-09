# MotionMark Complete Syntax and Properties

This is the canonical one-file inventory for available `.mmark` syntax and properties. Use deeper references for recipes and long examples.

## Contents

- File structure and values
- Top-level syntax
- Elements
- Animation value forms
- Properties by feature
- Element-specific properties
- Easing and expressions
- Masks, gradients, audio, emitters
- Validation notes

## File Structure

```mmark
---
canvas: 640x360
bg: #0f172a
fps: 60
perspective: 620
vanish: 320 180
debug: camera
$accent: #38bdf8
$radius: 48
---

# Comments start with # unless the # is a hex color.

elementType id inlineProp:value inlineProp:value | lifetime
  property: staticValue
  property: start -> end over duration easing
```

The header is parsed when the file starts with `---`. Prefer including it for generated files.

## Values

| Form | Examples | Notes |
|---|---|---|
| number | `12`, `-4.5`, `100px` | `px` is parsed as a number. |
| time | `300ms`, `2s` | Stored in milliseconds. |
| angle | `45deg`, `0.785rad`, `0.785` | `deg`/`rad` are converted to radians. |
| color | `#fff`, `#ffffff`, `#ffffff80`, `transparent` | Hex colors support 3-8 digits. |
| string | `"Hello"`, `"image.png"` | Supports `\n`, `\t`, `\"`, and `\\`. |
| identifier | `none`, `round`, `source-over`, `$accent` | Used for keywords and variables. |
| array | `[12, 8]`, `[#fff, #000]` | Scalar arrays only. |
| point | `(x,y)`, `(x,y,z)` | Used by `from`, `to`, and point lists. |
| point list | `[(0,0), (40,20)]`, `[(0,0,0), (40,0,20)]` | 2D and 3D points cannot be mixed. |

Variables are declared in the header as `$name: value` and referenced as `$name`.

## Header Properties

| Property | Value | Notes |
|---|---|---|
| `canvas` | `WIDTHxHEIGHT` | Example: `1920x1080`. |
| `bg` | color/string | Background; default is `transparent`. |
| `fps` | number | Default is `60`. |
| `perspective` | positive number | Enables perspective projection. |
| `vanish` | `x y` or `x, y` | Vanishing point. |
| `debug` | comma-separated identifiers | Example: `debug: camera`. |
| `$name` | number/string/color | Header variable. |

## Top-Level Syntax

| Syntax | Purpose |
|---|---|
| `use "file.mmark"` | Import reusable definitions from another file. |
| `= Scene Name | 0s - 3s =` | Declare a scene; elements without explicit lifetimes inherit scene bounds. |
| `@system` | Restrict palette, fonts, durations, or easing. |
| `@camera` | Apply inverted camera pan/zoom/rotation to scene elements. |
| `@motion name(params...)` | Define reusable property animations. |
| `@draw name(params...)` | Define reusable element structures. |
| `@emitter id | lifetime` | Generate particles at compile time. |
| `audio "file.mp3" | lifetime props...` | Add audio tracks. |
| `elementType id props... | lifetime` | Declare an element. |

## Lifetimes

```mmark
rect box w:80 h:80 | 0s - 3s
rect late w:80 h:80 | 1500ms - 5s
rect forever w:80 h:80 | persist
rect untilEnd w:80 h:80 | 1s - end
```

If an element has no explicit lifetime, the compiler uses the current scene lifetime or the duration implied by its animations.

## Element Types

| Element | Syntax shape | Main purpose |
|---|---|---|
| `rect` | `rect id w:N h:N` | Rectangles, panels, bars, cards. |
| `circle` | `circle id r:N` | Circles, dots, rings. |
| `ellipse` | `ellipse id rx:N ry:N` | Ovals and elliptical rings. |
| `text` | `text id "content"` | Text and labels. |
| `line` | `line id x1:N y1:N x2:N y2:N` or `from:(x,y) to:(x,y)` | 2D segments. |
| `path` | `path id d:"SVG"` or `path id [(x,y), ...]` | SVG paths, generated math paths. |
| `image` | `image id "file.png" w:N h:N` | Bitmap images. |
| `group` / `@group` | `@group id` | Non-rendering transform parent. |
| `view` / `@view` | `@view id` | Non-rendering oriented 3D plane. |
| `line3d` | `line3d id` with `from`/`to` | 3D line segments. |
| `poly3d` | `poly3d id [(x,y,z), ...]` | 3D polygon faces. |
| `path3d` | `path3d id d:"M x,y,z ..."` | 3D curves/trails. |
| `plane` | `plane id w:N h:N` | Solid primitive: flat rectangle face. |
| `cuboid` | `cuboid id w:N h:N d:N` | Box solid. |
| `sphere` | `sphere id r:N` | Low-poly or smooth sphere. |
| `cylinder` | `cylinder id r:N h:N` | Cylinder solid. |
| `cone` | `cone id r:N h:N` | Cone solid. |
| `pyramid` | `pyramid id r:N h:N sides:N` | Pyramid solid. |
| `prism` | `prism id r:N d:N sides:N` | Prism solid. |
| `torus` | `torus id major:N tube:N` | Ring/donut solid. |

`@group` and `@view` are aliases for `group` and `view`.

## Animation Value Forms

### Static

```mmark
x: 320
fill: #38bdf8
```

### Tween

```mmark
x: 100 -> 500 over 2s ease-out
opacity: 0 -> 1 over 400ms
```

### Multi-Step Tween

```mmark
scale: 1 -> 1.2 -> 1 over 800ms ease-in-out
fill: #ef4444 -> #22c55e -> #ef4444 over 2s linear
```

### Keyframes

```mmark
y: 280 at 0s, 90 at 0.5s ease-out, 280 at 1s ease-in
```

### Expression

```mmark
x: f(t) = 320 + 90 * cos(t * 2)
y: f(t) = 180 + 90 * sin(t * 2)
```

`t` is local time in seconds from the element start.

### Wiggle Shortcut

```mmark
x: wiggle(2, 40, base:320, seed:1)
y: wiggle(freq:3, amp:24, base:180, seed:2)
```

`wiggle(freq, amp, base, seed)` compiles to an expression.

## Common Element Properties

| Property | Value | Animatable | Notes |
|---|---|---:|---|
| `x`, `y` | number | yes | Position. |
| `opacity` | number | yes | Usually `0` to `1`. |
| `rotation` | angle/number | yes | 2D rotation in radians after unit conversion. |
| `scale` | number | yes | Uniform scale. |
| `scaleX`, `scaleY` | number | yes | Axis scale. |
| `fill` | color/gradient/string | colors yes, gradients no | Fill paint. |
| `stroke` | color/gradient/string | colors yes, gradients no | Stroke paint. |
| `strokeWidth` | number | yes | Stroke width. |
| `gradient` | gradient string | no | Alias for fill on shapes/text/path, stroke on line. |
| `draw` | `0..1` | yes | Reveals shape/path/text/image; do not combine with `drawStart`/`drawEnd`. |
| `anchor` | anchor name | no | Layout anchor; default `center`. |
| `origin` | anchor name | no | Transform pivot; default `center`. |
| `parent` | element id | no | Parent group/view id. |
| `zIndex` | number | no | 2D draw order; higher draws later. |
| `comp` | blend mode | no | Also accepted in body; defaults to `source-over`. |
| `mask` | mask expression | no | See masks below. |
| `repeat` | positive integer | no | Compile-time clones. |
| `repeatOffset` | offset string | no | Example: `x:20 delay:0.06s`. |

Anchor names: `center`, `top-left`, `top-center`, `top-right`, `center-left`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`. Aliases: `top`, `bottom`, `left`, `right`.

Blend modes: `source-over`, `lighter`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`.

## Stroke Properties

| Property | Value | Animatable | Notes |
|---|---|---:|---|
| `drawStart` | `0..1` | yes | Start of visible stroke window. |
| `drawEnd` | `0..1` | yes | End of visible stroke window. |
| `dashArray` | number array | no | Example: `[12, 8]`. |
| `dashOffset` | number | yes | Marching dash offset. |
| `strokeCap` | `butt`, `round`, `square` | no | Canvas line cap. |
| `strokeJoin` | `miter`, `round`, `bevel` | no | Canvas line join. |

Stroke controls apply to `rect`, `circle`, `ellipse`, `line`, `line3d`, `path`, `poly3d`, and `path3d`.

## Effect Properties

| Property | Value | Animatable | Default |
|---|---|---:|---|
| `blur` | number >= 0 | yes | `0` |
| `brightness` | number >= 0 | yes | `1` |
| `contrast` | number >= 0 | yes | `1` |
| `saturate` | number >= 0 | yes | `1` |
| `hueRotate` | number/angle | yes | `0` |
| `shadow` | `offsetX offsetY blur color` | no | none |

## Motion Path Properties

| Property | Value | Animatable | Notes |
|---|---|---:|---|
| `motionPath` | SVG path string | no | May be written `motionPath: d:"M ..."` or `motionPath: "M ..."`. |
| `motionProgress` | `0..1` | yes | Position along the path. |
| `motionRotate` | `auto` or `true` | no | Adds tangent rotation. |

`x` and `y` are offsets added to the sampled path position.

## 3D Properties

| Property | Value | Animatable | Notes |
|---|---|---:|---|
| `z` | number | yes | Positive is closer with perspective. |
| `rotateX`, `rotateY`, `rotateZ` | angle/number | yes | 3D Euler rotations. |
| `rotateOrder` | axis string | no | 1-3 unique axes; default completes to `zyx`. |
| `depthBias` | number | yes | Sorting bias without moving geometry. |
| `sort` | `depth`, `manual`, `layer` | no | Usually on groups. |
| `billboard` | `none`, `screen`, `y` | no | Keep labels facing camera. |

`@view`-only static properties:

| Property | Value | Notes |
|---|---|---|
| `at` | `x y z` | View center; also sets `x`, `y`, `z`. |
| `normal` | `x y z` | Outward plane normal; default `0 0 1`. |
| `up` | `x y z` | Plane up direction; default `0 -1 0`. |

## Element-Specific Properties

| Element | Properties |
|---|---|
| `rect` | `w`, `h`, `cornerRadius` (`N` or `[tl,tr,br,bl]`) |
| `circle` | `r` |
| `ellipse` | `rx`, `ry` |
| `text` | inline content string, `content`, `font`, `size`, `weight`, `letterSpacing`, `lineHeight`, `align`, `stroke`, `strokeWidth` |
| `line` | `x1`, `y1`, `x2`, `y2`, or `from:(x,y)` and `to:(x,y)`; `width` aliases stroke width fallback |
| `line3d` | `from:(x,y,z)`, `to:(x,y,z)`; both static |
| `path` | `d`, `points`, `closed`, `fx`, `xRange`, `xt`, `yt`, `tRange`, `steps` |
| `poly3d` | 3D `points`, `closed`, fill/stroke properties |
| `path3d` | `d` with 3D `M/L/Q/C/Z`, or 3D `points`, `closed` |
| `image` | inline source string, `src`, `w`, `h` |
| `group` | transform, opacity, parent, sort, 3D properties; non-rendering |
| `view` | transform, parent, `at`, `normal`, `up`; non-rendering |

`path` generation:

```mmark
path p1 d:"M 0 0 L 100 50 Z"
path p2 [(0,0), (100,50), (0,100)] closed:true
path p3 fx:"200 - 50 * sin(x * 0.05)" xRange:"0-400" steps:80
path p4 xt:"200 + 80 * cos(t)" yt:"180 + 80 * sin(t)" tRange:"0-6.28" steps:80
```

## Solid 3D Primitive Properties

Solid primitives compile into a transform `group` plus generated `poly3d` faces.

| Primitive | Size properties | Segment limits/defaults | Face material overrides |
|---|---|---|---|
| `plane` | `w`/`width`, `h`/`height` | default `120x80` | `faceFill`, `faceStroke`, `faceStrokeWidth`, `faceOpacity` |
| `cuboid` | `w`/`width`, `h`/`height`, `d`/`depth` | default `80x80x80` | `front*`, `back*`, `right*`, `left*`, `top*`, `bottom*` |
| `sphere` | `r`/`radius`, `segments`, `rings` | `segments 6..32`, `rings 4..18` | `top*`, `upper*`, `middle*`, `lower*`, `bottom*`, `faceN*` |
| `cylinder` | `r`/`radius`, `h`/`height`, `segments` | `segments 3..48` | `top*`, `bottom*`, `sideN*` |
| `cone` | `r`/`radius`, `h`/`height`, `segments` | `segments 3..48` | `base*`, `sideN*` |
| `pyramid` | `r`/`radius`, `h`/`height`, `sides`/`segments` | `sides 3..24` | `base*`, `sideN*` |
| `prism` | `r`/`radius`, `d`/`depth`, `sides`/`segments` | `sides 3..24` | `front*`, `back*`, `sideN*` |
| `torus` | `major`/`majorRadius`/`r`, `tube`/`tubeRadius`/`minor`/`minorRadius`, `segments`, `tubeSegments` | `segments 6..48`, `tubeSegments 3..24` | `faceN*` |

For every `*` material override, use `Fill`, `Stroke`, `StrokeWidth`, or `Opacity`, for example `side0Fill`, `face8StrokeWidth`, `topOpacity`.

## Gradients

Gradients are valid in `fill`, `stroke`, or `gradient`.

```mmark
fill: linear(0, 0, 300, 0, #ef4444, 0, #22c55e, 1)
stroke: radial(150, 150, 0, 150, 150, 120, #fff, 0, #38bdf8, 1)
fill: linear-gradient(0, 0, 300, 0, #ef4444, 0, #22c55e, 1)
```

Gradient color stops use `color, offset` pairs. Offsets are `0..1`. Gradients are static.

## Masks

```mmark
mask: rect(x, y, w, h)
mask: circle(cx, cy, r)
mask: path("M 220,80 L 420,80 L 320,280 Z")
mask: points [(0,0), (80,0), (40,80)] closed
mask: fx("240 + 20 * sin(x * 0.04 + t * 3)", 0, 640, 360, 100)
mask: xt("320 + 50 * cos(t)", "180 + 50 * sin(t)", 0, 6.28, 60)
mask: text("MASK", 320, 180, 72, "Roboto")
mask: circle(320, 180, 80) invert
```

`fx` masks use `x`; animated `fx` masks may use `t`. `xt` masks use parameter `t`; animated `xt` masks may use `time`.

## Easing

| Easing | Syntax |
|---|---|
| linear | `linear` |
| ease in | `ease-in` |
| ease out | `ease-out` |
| ease in/out | `ease-in-out` |
| custom cubic | `cubic-bezier(x1,y1,x2,y2)` |
| spring | `spring(stiffness,damping,mass,velocity)` or named params |

Spring defaults: `stiffness:180`, `damping:12`, `mass:1`, `velocity:0`.

## Expression Functions

Expressions support variables and element property references that resolve to numbers.

Constants: `pi`, `PI`, `e`, `E`.

Operators: `+`, `-`, `*`, `/`, `^`, unary `+`, unary `-`.

Functions: `sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `pow`, `mod`, `wiggle`, `linear`, `ease-in`, `ease-out`, `ease-in-out`.

Expression numbers may use `deg` or `rad`.

## Reusable Motion

```mmark
@motion fade-in(dur=0.5s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

text title "Hello" font:Roboto size:48 fill:#fff | 0s - 3s
  x: 320
  y: 180
  fade-in(dur:0.8s)
```

Arguments can be positional or named with `name:value`.

## Reusable Draw Marks

```mmark
@draw badge(label, fill=#1e293b)
  rect bg w:180 h:56 fill:$fill cornerRadius:12
    x: 0
    y: 0
  text txt content:$label font:Roboto size:18 fill:#fff
    x: 0
    y: 4

badge item1 label:"Ready" fill:#0f766e | 0s - 3s
```

`@draw` expands its body elements. Instance ids are prefixed as `instanceId-childId`.

## System Constraints

```mmark
@system
  palette: #0f172a, #38bdf8, #ffffff
  fonts: Roboto, Inter
  durations: 300ms, 500ms, 1s
  easing: linear, ease-out, ease-in-out
```

The compiler rejects colors, fonts, animation keyframe durations, or easing names outside the declared sets.

## Audio Tracks

```mmark
audio "music.mp3" | 0s - end volume:0.3 fade-in:1000 fade-out:1000 loop:true
audio "click.wav" | 1.2s - 1.6s volume:0.9 pan:-0.4 trim:120
```

| Property | Default |
|---|---|
| `volume` | `1` |
| `pan` | `0` |
| `fade-in` | `0` |
| `fade-out` | `0` |
| `trim` | `0` |
| `loop` | `false` |

## Emitter Syntax

```mmark
@emitter sparks | 0s - 3s
  template: circle r:4 fill:#f97316
  spawn: 60/s
  lifetime: 0.8s
  emitOn: circle(320,180,20)
  vx: random(-180, 180)
  vy: random(-220, -80)
  gravity: 240
  turbulence: 12
  opacity: 1 -> 0 over life
  scale: 1 -> 0.2 over life
  fill: #f97316 -> #fde047 over life
```

Emitter properties: `template`, `spawn`, `lifetime`, `x`, `y`, `vx`, `vy`, `gravity`, `turbulence`, `emitOn`, `opacity`, `scale`, `fill`.

Emitter value forms:

- Static: `x: 320`
- Random: `x: random(0, 640)`
- Rate: `spawn: 40/s`
- Over life: `opacity: 1 -> 0 over life`
- Emit shape: `line(x1,y1,x2,y2)`, `circle(cx,cy,r)`, `path("M ...")`

## Static-Only Properties

Keep these static:

- `anchor`, `origin`, `parent`, `comp`, `mask`
- `gradient`, `dashArray`, `shadow`
- `repeat`, `repeatOffset`
- `motionPath`, `motionRotate`
- `rotateOrder`, `sort`, `billboard`
- `@view` `at`, `normal`, `up`
- `line3d` `from`, `to`
- `poly3d`/`path3d` `points`

## Important Validation Rules

- `draw` cannot be combined with `drawStart` or `drawEnd`.
- `drawStart` and `drawEnd` must be between `0` and `1`; `drawEnd >= drawStart` when both are static.
- `motionProgress` must be between `0` and `1`.
- `repeat` must be a positive integer.
- `dashArray` must contain positive numbers.
- `shadow` must be `offsetX offsetY nonNegativeBlur color`.
- `rotateOrder` must contain 1-3 unique axis letters from `x`, `y`, `z`.
- `sort` must be `depth`, `manual`, or `layer`.
- `billboard` must be `none`, `screen`, or `y`.
- `line3d` requires static 3D `from` and `to`.
- `poly3d` and `path3d` require static 3D points, directly or from `path3d d`.
