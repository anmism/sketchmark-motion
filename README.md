# MotionMark

**Markdown for Motion Graphics. Text-in, video-out.**

MotionMark is a domain-specific language (DSL) for creating motion graphics and animations using simple, readable text files. Write declarative code, preview and export in browser.

## Quick Start

### Requirements

- Node.js

### Installation

```sh
npm install
npm run build
```

### Preview

```sh
npm run preview
# or with a specific file
npm run preview examples/showcase/trig-graphs.mmark
```

Open http://localhost:5175 in your browser. Edit code on the left, see live preview on the right. Export to WebM/MP4 directly from the browser.

### Use the Canvas Player in React / Next.js

MotionMark also exposes the preview canvas as reusable browser UI via `motionmark/player`. It compiles DSL source and renders directly into a canvas, so React apps can own the surrounding UI.

```tsx
"use client";

import { useEffect, useRef } from "react";
import { createMotionMarkPlayer, type MotionMarkPlayer } from "@sketchmark/motion/player";

export function MotionMarkCanvas({ source }: { source: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<MotionMarkPlayer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const player = createMotionMarkPlayer(canvasRef.current, {
      source,
      autoplay: true,
      loop: true,
      render: { maxWidth: 900 },
      assetBaseUrl: "/motion-assets/",
      onError: console.error
    });

    playerRef.current = player;
    return () => player.destroy();
  }, [source]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "auto" }} />;
}
```

For lower-level control, import `compileMotionMarkScene`, `preloadBrowserImages`, and `renderFrameToCanvas` from `motionmark/player`.

## File Format

MotionMark files use the `.mmark` extension.

### Basic Structure

```mmark
---
canvas: 1920x1080
bg: #0f0f1a
fps: 60
$accent: #e74c5c
$teal: #4ecdc4
---

rect r1 w:200 h:100 fill:#e74c5c | 0s - 3s
  x: 100 -> 500 over 2s ease-out
  y: 200
  opacity: 0 -> 1 over 0.5s
```

## Syntax Reference

### Header Block

Define canvas settings and variables at the top of your file:

```mmark
---
canvas: 640x360
bg: #0f0f1a
fps: 24
perspective: 900
vanish: 320 180
$accent: #e74c5c
$teal: #4ecdc4
$speed: 80
---
```

| Property | Description | Example |
|----------|-------------|---------|
| `canvas` | Width x Height in pixels | `1920x1080`, `640x360` |
| `bg` | Background color (hex) | `#0f0f1a` |
| `fps` | Frames per second | `24`, `30`, `60` |
| `perspective` | 2.5D camera distance in pixels | `800`, `1200` |
| `vanish` | 2.5D vanishing point x y | `960 540` |
| `$name` | Variable declaration | `$accent: #e74c5c` |

### Elements

#### Rectangle

```mmark
rect id w:WIDTH h:HEIGHT fill:COLOR
  x: VALUE
  y: VALUE
```

#### Circle

```mmark
circle id r:RADIUS fill:COLOR
  x: VALUE
  y: VALUE
```

#### Ellipse

```mmark
ellipse id rx:RX ry:RY fill:COLOR
  x: VALUE
  y: VALUE
```

#### Text

```mmark
text id "Content" font:FONTNAME size:SIZE fill:COLOR
  x: VALUE
  y: VALUE
```

#### Line

```mmark
line id from:(X1,Y1) to:(X2,Y2) stroke:COLOR strokeWidth:WIDTH
```

#### Gradients

Use gradients anywhere a `fill` or `stroke` paint is accepted. Stops are written as `color, offset` pairs, where offsets run from `0` to `1`.

```mmark
rect panel w:240 h:120 | 0s - 3s
  fill: linear(0, 0, 240, 0, #e74c5c, 0, #4ecdc4, 1)

circle glow r:80 | 0s - 3s
  fill: radial(0, 0, 0, 0, 0, 80, #fbbf24, 0, #ef4444, 1)
```

#### Path

Paths support 4 creation methods:

**1. SVG d syntax** (from design tools, bezier curves)
```mmark
path arrow d:"M 10 50 L 90 50 L 70 30 M 90 50 L 70 70" stroke:#fff strokeWidth:2
```

**2. Points array** (manual coordinates, polygons)
```mmark
path triangle [(100,200), (150,100), (200,200)] fill:#e74c5c closed:true
```

**3. Function path fx** (graphs, waves — y depends on x)
```mmark
path sine fx:"200 - 50 * sin(x * 0.05)" xRange:"0-400" steps:50 stroke:#60a5fa strokeWidth:2
```

**4. Parametric path xt/yt** (circles, spirals, hearts)
```mmark
path circle xt:"200 + 80 * cos(t)" yt:"200 + 80 * sin(t)" tRange:"0-6.28" steps:60 stroke:#4ade80 strokeWidth:2
```

**When to use which:**

| Method | Use when |
|--------|----------|
| `d:"..."` | You have SVG path data from Figma/Illustrator |
| `[(x,y), ...]` | You have exact coordinates for a simple shape |
| `fx:"..."` | Drawing a graph/wave where y = f(x) |
| `xt/yt:"..."` | Drawing shapes that loop back (circles, spirals, hearts) |

**Quick test:** Can you draw it left-to-right without going backwards on x?
- Yes → use `fx`
- No → use `xt` + `yt`

#### Image

```mmark
image id "filename.png" w:WIDTH h:HEIGHT
  x: VALUE
  y: VALUE
```

### Element Lifetime

Control when elements appear and disappear:

```mmark
rect r1 w:200 h:100 fill:#e74c5c | 0s - 3s    # visible from 0s to 3s
rect r2 w:200 h:100 fill:#4ecdc4 | 2s - 5s    # visible from 2s to 5s
rect r3 w:200 h:100 fill:#fff | persist        # visible entire duration
```

### Animation

#### Declarative Animation (Recommended)

```mmark
rect r1 w:200 h:100 fill:#e74c5c | 0s - 3s
  x: 100 -> 500 over 2s ease-out           # animate from 100 to 500
  opacity: 0 -> 1 over 0.5s                 # fade in
  scale: 1 -> 1.2 -> 1 over 1s ease-in-out  # scale up then down
```

#### Multi-step Keyframes

```mmark
circle ball r:18 fill:#e74c5c | 0s - 4s
  y: 272 at 0s, 112 at 0.8s ease-out, 272 at 1.6s ease-in, 150 at 2.4s ease-out
```

#### Expression Mode (Advanced)

Use mathematical expressions with `f(t)` where `t` is time in seconds:

```mmark
circle ball r:14 fill:#e74c5c | 0.8s - 4s
  x: f(t) = 74 + 80 * t
  y: f(t) = 260 - (120 * t - 35 * t^2)
```

Available math functions: `sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `pow`

Use degrees with the `deg` suffix: `cos(45deg)`

### 2.5D Perspective

MotionMark supports CSS-style 3D-ish transforms on Canvas 2D. Set `perspective` in the header, then use `z`, `rotateX`, `rotateY`, `rotateZ`, `scaleX`, and `scaleY` on elements. All of these element properties can be animated with tweens, keyframes, or `f(t)` expressions.

```mmark
---
canvas: 960x540
bg: #0f172a
perspective: 900
vanish: 480 260
---

rect card w:220 h:140 fill:#3b82f6 cornerRadius:12 | 0s - 3s
  x: 480
  y: 270
  z: -80 -> 80 over 1s ease-out
  rotateY: -70 -> 0 over 0.8s ease-out
  rotateX: 8deg
  zIndex: 2
```

`z` is depth: positive values move closer to the viewer and negative values move farther away. `zIndex` is draw order: higher values render later, independent of depth.

Use `origin` to move the transform pivot for 2.5D rotations. The short aliases `top`, `right`, `bottom`, and `left` map to the centered edge anchors, so `origin: bottom` is the same as `origin: bottom-center`.

```mmark
path face fill:#e53e3e | 0s - 2s
  d: "M-50,50 L50,50 L0,-50 Z"
  x: 300
  y: 200
  origin: bottom
  rotateX: -55deg
```

When an element needs rotations in a different sequence, use `rotateOrder`. For example, side faces of a pyramid can use `rotateOrder: yz` so the face turns into depth with `rotateY` before folding inward with `rotateZ`.

For composed 3D-style shapes, prefer `@view`. A view is a non-rendering 3D plane: put normal 2D elements inside it with `parent:`, then orient the plane with `at`, `normal`, and optional `up`.

```mmark
@group cube | 0s - 8s
  x: 300
  y: 220
  rotateX: -18deg
  rotateY: 0deg -> 360deg over 8s linear

@view front parent:cube | 0s - 8s
  at: 0 0 45
  normal: 0 0 1

rect frontFace w:90 h:90 fill:#3b82f6 parent:front | 0s - 8s
```

`at` is the view center in parent 3D space. `normal` points out of the view plane. `up` defaults to `0 -1 0`, matching screen-up.

### 3D Primitives

For most 3D motion graphics, use the built-in 3D primitives instead of hand-authoring every face. These primitives compile into `poly3d` faces internally, so preview and export use the same renderer path. Generated faces can be styled with named face properties such as `frontFill`, `topFill`, `baseFill`, `side0Fill`, or `face12Fill`.

Low-level primitives:

```mmark
line3d edge stroke:#ffffff strokeWidth:2
  from: (0, 0, -40)
  to: (80, 20, 40)

poly3d tri fill:#ef4444
  points: [(0,0,0), (60,0,0), (30,60,20)]

path3d curve d:"M0,0,0 C40,-40,80 100,40,-80 140,0,0" fill:none stroke:#38bdf8 strokeWidth:5
```

Solid primitives:

```mmark
plane floor w:500 h:320 fill:#111827
  x: 480
  y: 320
  rotateX: 90deg
  faceFill: #0f172a

cuboid box w:120 h:80 d:90 fill:#38bdf8
  frontFill: #3b82f6
  topFill: #93c5fd

sphere planet r:70 segments:16 rings:9 fill:#34d399
  topFill: #bbf7d0
  middleFill: #34d399
  bottomFill: #065f46

cylinder can r:42 h:90 segments:16 fill:#38bdf8
  topFill: #bae6fd
  side0Fill: #7dd3fc

cone marker r:46 h:100 segments:16 fill:#f97316
  baseFill: #7c2d12

pyramid roof r:54 h:90 sides:4 fill:#ef4444
  baseFill: #475569
  side0Fill: #ef4444

prism wedge r:52 d:86 sides:3 fill:#14b8a6
  frontFill: #5eead4

torus ring major:52 tube:12 segments:18 tubeSegments:6 fill:#fb923c
  face0Fill: #fed7aa
```

| Primitive | Main properties | Customization |
|-----------|-----------------|---------------|
| `plane` | `w`, `h` | `faceFill`, `faceStroke`, `faceOpacity` |
| `cuboid` | `w`, `h`, `d` | `frontFill`, `backFill`, `leftFill`, `rightFill`, `topFill`, `bottomFill` |
| `sphere` | `r`, `segments`, `rings` | `topFill`, `upperFill`, `middleFill`, `lowerFill`, `bottomFill`, `faceNFill` |
| `cylinder` | `r`, `h`, `segments` | `topFill`, `bottomFill`, `sideNFill` |
| `cone` | `r`, `h`, `segments` | `baseFill`, `sideNFill` |
| `pyramid` | `r`, `h`, `sides` | `baseFill`, `sideNFill` |
| `prism` | `r`, `d`, `sides` | `frontFill`, `backFill`, `sideNFill` |
| `torus` | `major`, `tube`, `segments`, `tubeSegments` | `faceNFill` |

These shapes still support common transform properties like `x`, `y`, `z`, `rotateX`, `rotateY`, `rotateZ`, `scale`, `opacity`, `parent`, and animated keyframes.

### Easing Functions

| Easing | Description |
|--------|-------------|
| `linear` | Constant speed |
| `ease-in` | Slow start |
| `ease-out` | Slow end |
| `ease-in-out` | Slow start and end |
| `cubic-bezier(x1,y1,x2,y2)` | Custom bezier curve |

### Variables

Define in header, use with `$`:

```mmark
---
$accent: #e74c5c
$speed: 80
---

circle ball r:20 fill:$accent
  x: f(t) = 200 + $speed * t
```

### Scenes

Organize animations into logical sections:

```mmark
= Setup | 0s - 5s =

rect title w:400 h:80 fill:#4ecdc4
  x: 100
  y: 100

= Launch | 5s - 10s =

circle ball r:20 fill:#e74c5c | 5s - 10s
  x: f(t) = 200 + 50 * t
```

Elements without explicit lifetime inherit their scene's time bounds.

### Custom Motions (@motion)

Define reusable animation patterns:

```mmark
@motion fade-in(dur=0.4s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion slide-up(from, to, dur=0.7s, ease=ease-out)
  y: $from -> $to over $dur $ease

@motion projectile(vx, vy, g, x0, y0)
  x: f(t) = $x0 + $vx * t
  y: f(t) = $y0 - ($vy * t - 0.5 * $g * t^2)
```

Apply motions to elements:

```mmark
text title "Hello" font:Roboto size:48 fill:#fff | 0s - 4s
  x: 100
  fade-in()
  slide-up(from: 200, to: 150)

circle ball r:20 fill:#e74c5c | 2s - 8s
  projectile(vx: 160, vy: 330, g: 250, x0: 220, y0: 780)
```

### Standard Library Motions

```mmark
@motion fade-in(dur=0.5s, ease=ease-out)
@motion fade-out(dur=0.5s, ease=ease-in)
@motion slide-right(from, to, dur=1s, ease=ease-out)
@motion slide-left(from, to, dur=1s, ease=ease-out)
@motion slide-down(from, to, dur=1s, ease=ease-out)
@motion slide-up(from, to, dur=1s, ease=ease-out)
@motion scale-in(dur=0.5s, ease=ease-out)
@motion scale-out(dur=0.5s, ease=ease-in)
@motion pulse(dur=0.8s, ease=ease-in-out)
@motion drift-x(speed)
```

### Audio Tracks

Add independent audio elements to your animation timeline:

```mmark
audio "bg-music.mp3" | 0s - end volume:0.3 fade-in:2000 fade-out:1000
audio "whoosh.wav" | 1.5s - 2.5s volume:0.8
```

| Property | Description | Default |
|----------|-------------|---------|
| `volume` | Playback volume (0-1) | `1` |
| `pan` | Stereo pan (-1 left, 1 right) | `0` |
| `fade-in` | Fade-in duration in ms | `0` |
| `fade-out` | Fade-out duration in ms | `0` |
| `trim` | Skip this many ms from the start of the file | `0` |
| `loop` | Loop the audio (`true`/`false`) | `false` |

Audio files are resolved relative to the `.mmark` file's directory.

### Masking

Apply rectangular masks to elements:

```mmark
rect panel w:440 h:150 fill:#e74c5c | 0s - 4s
  x: 100
  y: 112
  mask: rect(100, 112, 0, 150)
```

## Examples

### Bouncing Ball

```mmark
---
canvas: 640x360
bg: #0f0f1a
fps: 24
$accent: #e74c5c
---

@motion fade-in(dur=0.3s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

text title "Bouncing Ball" font:Roboto size:28 fill:#ffffff | 0s - 4s
  x: 36
  y: 54
  fade-in()

line floor from:(40,304) to:(600,304) stroke:#ffffff55 strokeWidth:3 | persist

circle ball r:18 fill:$accent | 0s - 4s
  x: 80 -> 520 over 4s linear
  y: 272 at 0s, 112 at 0.8s ease-out, 272 at 1.6s ease-in, 150 at 2.4s ease-out, 272 at 3.2s ease-in
```

### Product Intro

```mmark
---
canvas: 640x360
bg: #111827
fps: 24
$accent: #e74c5c
$teal: #4ecdc4
---

@motion fade-in(dur=0.4s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion slide-up(from, to, dur=0.7s, ease=ease-out)
  y: $from -> $to over $dur $ease

rect logo w:72 h:72 fill:$accent | 0s - 4s
  x: 70
  y: 110
  opacity: 0 -> 1 over 0.4s

text brand "MotionMark" font:Roboto size:42 fill:#ffffff | 0.25s - 4s
  x: 170
  slide-up(from: 164, to: 142)
  fade-in(0.5s)

text tagline "Markdown for motion graphics" font:Roboto size:22 fill:#cbd5e1 | 0.8s - 4s
  x: 174
  slide-up(from: 216, to: 194, dur: 0.55s)
  fade-in(0.45s)
```

### Physics Simulation

```mmark
@motion projectile(vx, vy, g, x0, y0)
  x: f(t) = $x0 + $vx * t
  y: f(t) = $y0 - ($vy * t - 0.5 * $g * t^2)

circle ball r:20 fill:#e74c5c | 2s - 8s
  projectile(vx: 160, vy: 330, g: 250, x0: 220, y0: 780)
  opacity: 0 -> 1 over 0.2s
```

## Properties Reference

### Common Properties

| Property | Description | Animatable |
|----------|-------------|------------|
| `x` | Horizontal position | Yes |
| `y` | Vertical position | Yes |
| `opacity` | Transparency (0-1) | Yes |
| `scale` | Size multiplier | Yes |
| `scaleX` | Horizontal size multiplier | Yes |
| `scaleY` | Vertical size multiplier | Yes |
| `rotation` | Rotation (radians) | Yes |
| `rotateX` | 2.5D tilt forward/back | Yes |
| `rotateY` | 2.5D turn left/right | Yes |
| `rotateZ` | 2.5D spin around the screen axis | Yes |
| `rotateOrder` | Static rotation sequence such as `zyx` or `yz` | No |
| `z` | 2.5D depth, positive is closer | Yes |
| `zIndex` | Layer order, higher renders later | Yes |
| `depthBias` | Depth-sort bias for projected 3D elements | Yes |
| `sort` | Group sort mode: `depth`, `manual`, or `layer` | No |
| `billboard` | Keep element facing camera: `screen` or `y` | No |
| `origin` | Transform pivot: `center`, edge/corner anchors, or `top`/`right`/`bottom`/`left` aliases | No |
| `draw` | Draw progress (0-1) | Yes |

### Shape-specific Properties

| Element | Properties |
|---------|------------|
| `rect` | `w`, `h`, `fill`, `stroke`, `strokeWidth`, `cornerRadius` |
| `circle` | `r` (radius), `fill`, `stroke`, `strokeWidth` |
| `ellipse` | `rx`, `ry` (radii), `fill`, `stroke`, `strokeWidth` |
| `text` | `font`, `size`, `fill` |
| `line` | `from`, `to`, `stroke`, `strokeWidth`, `strokeCap` |
| `line3d` | `from`, `to`, `stroke`, `strokeWidth`, `strokeCap` |
| `path` | `d`, points, `fx`+`xRange`, `xt`+`yt`+`tRange`, `steps`, `fill`, `stroke`, `closed`, `strokeCap`, `strokeJoin` |
| `poly3d` | `points`, `fill`, `stroke`, `closed` |
| `path3d` | 3D `d` path, `fill`, `stroke`, `strokeCap`, `strokeJoin` |
| `plane` | `w`, `h`, `fill`, `stroke`, `faceFill` |
| `cuboid` | `w`, `h`, `d`, named face fills/strokes |
| `sphere` | `r`, `segments`, `rings`, band fills, `faceNFill` |
| `cylinder` | `r`, `h`, `segments`, caps and side face fills |
| `cone` | `r`, `h`, `segments`, `baseFill`, `sideNFill` |
| `pyramid` | `r`, `h`, `sides`, `baseFill`, `sideNFill` |
| `prism` | `r`, `d`, `sides`, `frontFill`, `backFill`, `sideNFill` |
| `torus` | `major`, `tube`, `segments`, `tubeSegments`, `faceNFill` |
| `image` | `w`, `h`, source path |

## Architecture

```
.mmark file (DSL)
       |
       v
   PARSER (DSL -> Scene IR)
       |
       v
   SCENE IR (JSON) ─── audioTracks[]
       |                     |
       v                     v
   ENGINE (IR + time)    Web Audio API
       |                     |
       v                     v
   CANVAS 2D ──────────> MediaRecorder / WebCodecs
       |
       v
   WebM / MP4 (browser export)
```

## Project Structure

```
motion-mark/
  packages/
    schema/     # IR JSON schema + TypeScript types
    parser/     # DSL tokenizer, AST, compiler
    engine/     # IR + time -> frame state
    renderer/   # Frame rendering
    player/     # Browser canvas player API
    exporter/   # Headless render -> MP4
    validator/  # DSL validation
    ai/         # NL -> DSL pipeline
  stdlib/
    motion/     # Standard @motion marks
  examples/     # Example .mmark files
  tests/        # Test suite
```

### Draw Animation

Reveal elements progressively with the `draw` property (0-1):

```mmark
line arrow x1:0 y1:100 x2:200 y2:100 stroke:#fff strokeWidth:2 | 0s - 3s
  draw: 0 -> 1 over 2s ease-out

circle ring r:50 fill:none stroke:#4ecdc4 strokeWidth:3 | 0s - 3s
  x: 300
  y: 100
  draw: 0 -> 1 over 1.5s ease-out

text title "Hello" font:Roboto size:32 fill:#fff | 0s - 3s
  x: 200
  y: 200
  draw: 0 -> 1 over 2s linear

path curve fx:"100 - 30 * sin(x * 0.05)" xRange:"0-300" steps:50 stroke:#e74c5c strokeWidth:2 | 0s - 3s
  draw: 0 -> 1 over 2s ease-out
```

| Element | Draw Effect |
|---------|-------------|
| `line` | Reveals from start to end |
| `circle` | Arc reveals 0° → 360° |
| `rect` | Outline draws clockwise |
| `text` | Typewriter (char by char) |
| `path` | Stroke reveals along curve |
| `image` | Wipe reveal left → right |

### Stroke Controls

Fine-grained control over stroke rendering with `drawStart`, `drawEnd`, `dashArray`, and `dashOffset`:

```mmark
circle spinner r:48 fill:none stroke:#60a5fa strokeWidth:6 | 0s - 6s
  x: 200
  y: 170
  drawStart: 0 -> 0.75 over 6s linear
  drawEnd: 0.25 -> 1 over 6s linear
  dashArray: [8, 6]
  dashOffset: 0 -> 120 over 6s linear

rect ants w:240 h:150 fill:none stroke:#34d399 strokeWidth:4 anchor:top-left | 0s - 6s
  x: 410
  y: 130
  dashArray: [14, 10]
  dashOffset: 0 -> 220 over 6s linear

path squiggle d:"M 120 380 C 210 300, 330 460, 420 380 S 630 300, 720 380" stroke:#f59e0b strokeWidth:6 fill:none | 0s - 6s
  drawStart: 0 -> 0.7 over 6s linear
  drawEnd: 0.3 -> 1 over 6s linear
```

| Property | Description | Animatable |
|----------|-------------|------------|
| `drawStart` | Start of visible stroke window (0-1) | Yes |
| `drawEnd` | End of visible stroke window (0-1) | Yes |
| `dashArray` | Dash pattern lengths `[dash, gap, ...]` | No |
| `dashOffset` | Offset into dash pattern | Yes |
| `strokeCap` | Line endpoint style: `butt`, `round`, `square` | No |
| `strokeJoin` | Corner join style: `miter`, `round`, `bevel` | No |

### Shape Styling

#### Corner Radius

Round the corners of rectangles with a single value or per-corner array:

```mmark
rect card w:200 h:120 fill:#1f2937 cornerRadius:12 | persist
rect pill w:200 h:60 fill:#4ecdc4 cornerRadius:30 | persist
rect mixed w:200 h:120 fill:#fff cornerRadius:[20, 0, 20, 0] | persist
```

Animatable — smoothly morph between sharp and rounded:

```mmark
rect morph w:100 h:100 fill:#e74c5c | 0s - 2s
  cornerRadius: 0 -> 50 over 2s ease-in-out
```

#### Stroke Cap & Join

Control how line endpoints and corners render:

```mmark
line beam x1:50 y1:100 x2:300 y2:100 stroke:#f59e0b strokeWidth:10 strokeCap:round | persist
path zigzag d:"M 50 200 L 150 250 L 250 200" stroke:#f472b6 strokeWidth:8 fill:none strokeJoin:round | persist
```

| Value | strokeCap | strokeJoin |
|-------|-----------|------------|
| `butt` | Flat end (default for paths) | — |
| `round` | Rounded end (default for lines) | Smooth arc corner |
| `square` | Extended flat end | — |
| `miter` | — | Sharp pointed corner (default) |
| `bevel` | — | Flat diagonal cut |

### Filters

Apply visual effects to any element:

```mmark
image photo "image.jpg" w:360 h:240 | 0s - 6s
  x: 220
  y: 245
  blur: 12 -> 0 over 1.2s ease-out
  saturate: 0 -> 1 over 1.6s ease-out
  contrast: 0.9 -> 1.15 over 2s ease-in-out
  brightness: 0.8 -> 1.1 over 2s ease-in-out
  hueRotate: 0 -> 25 over 6s linear
  shadow: 0 14 28 #00000066

text neon "NEON" font:Roboto size:56 fill:#22d3ee weight:bold | 0s - 6s
  x: 610
  y: 200
  shadow: 0 0 24 #22d3ee
  brightness: 1 -> 1.35 over 1.4s ease-in-out
```

| Property | Description | Default | Animatable |
|----------|-------------|---------|------------|
| `blur` | Gaussian blur in px | `0` | Yes |
| `brightness` | Brightness multiplier | `1` | Yes |
| `contrast` | Contrast multiplier | `1` | Yes |
| `saturate` | Saturation multiplier | `1` | Yes |
| `hueRotate` | Hue rotation in degrees | `0` | Yes |
| `shadow` | Drop shadow `offsetX offsetY blur color` | none | No |

### Dynamics (Wiggle + Spring)

#### Spring Easing

Use `spring()` as an easing function for physically-based animations:

```mmark
rect card w:220 h:120 fill:#1f2937 stroke:#22d3ee strokeWidth:2 | 0s - 6s
  x: 290 -> 400 over 1.2s spring(stiffness:180, damping:12)
  scale: 0.7 -> 1 over 1s spring(140, 11)
```

Spring parameters: `spring(stiffness, damping, mass, velocity)` — all optional with defaults `180, 12, 1, 0`.

#### Wiggle Expression

Deterministic noise for organic floating motion:

```mmark
circle float r:14 fill:#fb7185 | 0s - 6s
  x: wiggle(2, 44, base:180, seed:1)
  y: wiggle(3, 26, base:360, seed:2)
```

`wiggle(frequency, amplitude, base, seed)` — generates smooth pseudo-random motion around `base`.

### Motion Path

Animate elements along an SVG path with arc-length parameterization:

```mmark
path route d:"M 80 315 C 180 120, 360 120, 440 260 S 620 430, 720 210" stroke:#334155 strokeWidth:3 fill:none | 0s - 7s
  dashArray: [12, 10]
  dashOffset: 0 -> 160 over 7s linear

rect comet w:34 h:14 fill:#22d3ee anchor:center | 0s - 7s
  motionPath: "M 80 315 C 180 120, 360 120, 440 260 S 620 430, 720 210"
  motionProgress: 0 -> 1 over 5s ease-in-out
  motionRotate: auto
  shadow: 0 0 22 #22d3ee
```

| Property | Description | Animatable |
|----------|-------------|------------|
| `motionPath` | SVG path `d` string to follow | No |
| `motionProgress` | Position along path (0-1) | Yes |
| `motionRotate` | `auto` to orient along tangent | No |

### Repeat

Clone an element with staggered offsets:

```mmark
circle spark r:7 fill:#fb7185 | 1s - 7s
  repeat: 10
  repeatOffset: x:26 y:-10 opacity:-0.075 delay:0.06s
  x: 285
  y: 390
  scale: 0 -> 1 over 0.35s spring(stiffness:140, damping:10)
  opacity: 1 -> 0 over 1.2s ease-out
```

| Property | Description |
|----------|-------------|
| `repeat` | Number of clones |
| `repeatOffset` | Per-clone offset: `x`, `y`, `opacity`, `scale`, `rotation`, `delay` |

### Particle Emitter

Create natural-looking particle effects like rain, fire, snow, confetti, and more with the `@emitter` directive. Emitters spawn particles at compile time with physics-based motion.

```mmark
@emitter rain | 0s - 10s
  template: circle r:3 fill:#60a5fa
  spawn: 40/s
  lifetime: 2s
  x: random(0, 640)
  y: 0
  vx: random(-5, 5)
  vy: random(120, 200)
  gravity: 50
  opacity: random(0.4, 0.9)
```

#### Basic Properties

| Property | Description | Example |
|----------|-------------|---------|
| `template` | Shape to spawn (inline element) | `circle r:6 fill:#ff6b35` |
| `spawn` | Spawn rate | `30/s` |
| `lifetime` | How long each particle lives | `2s` |
| `x`, `y` | Spawn position | `320` or `random(100, 540)` |
| `vx`, `vy` | Velocity (px/s) | `random(-80, 80)` |
| `gravity` | Downward acceleration (px/s²) | `120` |
| `opacity` | Initial opacity | `random(0.5, 1)` |
| `scale` | Initial scale | `random(0.6, 1.2)` |

#### Over-Life Animations

Interpolate properties over a particle's lifetime:

```mmark
@emitter fire | 0s - 10s
  template: circle r:8 fill:#ff6b35
  spawn: 50/s
  lifetime: 0.8s
  emitOn: line(280, 300, 360, 300)
  vx: random(-20, 20)
  vy: random(-120, -80)
  turbulence: 15
  opacity: 1 -> 0 over life
  scale: 1 -> 0.2 over life
  fill: #ff6b35 -> #ffcc00 over life
```

| Syntax | Description |
|--------|-------------|
| `opacity: 1 -> 0 over life` | Fade out over particle lifetime |
| `scale: 1 -> 0.2 over life` | Shrink over lifetime |
| `fill: #ff6b35 -> #ffcc00 over life` | Color transition over lifetime |

#### Emit Shapes

Control where particles spawn with `emitOn`:

```mmark
@emitter ring | 0s - 10s
  template: circle r:4 fill:#a855f7
  spawn: 20/s
  lifetime: 1.5s
  emitOn: circle(320, 180, 60)
  opacity: 0.8 -> 0 over life
  scale: 1 -> 0.3 over life
```

| Shape | Description |
|-------|-------------|
| `emitOn: line(x1, y1, x2, y2)` | Random point along a line |
| `emitOn: circle(cx, cy, r)` | Random point on circle perimeter |

#### Turbulence

Add organic sine-wave displacement to particle paths:

```mmark
@emitter smoke | 0s - 12s
  template: circle r:20 fill:#64748b
  spawn: 8/s
  lifetime: 4s
  emitOn: line(305, 260, 335, 260)
  vx: random(-5, 5)
  vy: random(-40, -25)
  turbulence: 25
  opacity: 0.6 -> 0 over life
  scale: 0.5 -> 2 over life
```

#### Examples

| Effect | File | Key Features |
|--------|------|--------------|
| Rain | `29-emitter.mmark` | Downward velocity, gravity |
| Bubbles | `30-emitter-bubbles.mmark` | Upward velocity, gentle drift |
| Snow | `31-emitter-snow.mmark` | Slow fall, turbulence |
| Confetti | `32-emitter-confetti.mmark` | Multiple colors, random scale |
| Fire | `37-emitter-fire.mmark` | Over-life color/opacity, emitOn line |
| Smoke | `38-emitter-smoke.mmark` | Scale up, turbulence, fade |
| Ring | `39-emitter-ring.mmark` | emitOn circle |
| Explosion | `40-emitter-explosion.mmark` | Burst spawn, gravity, short life |

## Tips

1. **Z-order**: Elements are rendered in declaration order by default. Use `zIndex` when you need explicit layer order.

2. **Time is relative**: In expressions, `t` starts at 0 when the element appears, not global time.

3. **Use variables**: Define colors and values once in the header for easy theming.

4. **Compose motions**: Apply multiple @motion definitions to a single element.

5. **Start simple**: Begin with static elements, then add animation progressively.

## License

See LICENSE file for details.
