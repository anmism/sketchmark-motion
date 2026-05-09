# Composition Features

Use this file for multi-part animations, reusable structures, scene organization, masks, camera motion, imports, audio, motion paths, and clone repetition.

## Contents

- Camera
- Groups
- Scenes
- Masks
- Compositing
- Motion paths
- Repeat clones
- Audio
- Imports
- `@draw`
- `@system`

## Camera

`@camera` creates an implicit group named `__camera`. Elements without an explicit `parent` are parented to it. Camera `x`, `y`, `scale`, and `rotation` are inverted so they behave like pan, zoom, and rotation of the viewer.

```mmark
@camera
  x: 0 -> 180 over 5s ease-in-out
  y: 0 -> -60 over 5s ease-in-out
  scale: 1 -> 1.35 over 5s ease-out
  rotation: 0 -> 4deg over 5s ease-in-out
```

Use camera motion after the scene itself works. It is best for zoom reveals, map pans, cinematic follows, and gentle parallax.

## Groups

Groups are non-rendering transform parents. Children use `parent:groupId`; their positions are relative to the group origin.

```mmark
@group card | 0s - 4s
  x: 200 -> 440 over 3s ease-in-out
  y: 180
  scale: 0.9 -> 1 over 0.5s ease-out

rect cardBg w:160 h:96 fill:#1e293b cornerRadius:12 parent:card | 0s - 4s
  x: 0
  y: 0

text label "Grouped" font:Roboto size:18 fill:#e2e8f0 parent:card | 0s - 4s
  x: 0
  y: 8
```

Group properties: `x`, `y`, `z`, `scale`, `scaleX`, `scaleY`, `rotation`, `rotateX`, `rotateY`, `rotateZ`, `rotateOrder`, `opacity`, `parent`, `sort`, `zIndex`.

## Scenes

Scenes organize timelines. Elements without explicit lifetimes inherit the active scene lifetime.

```mmark
= Intro | 0s - 3s =

text title "Welcome" font:Roboto size:48 fill:#fff
  x: 320
  y: 180
  opacity: 0 -> 1 over 0.5s

= Main | 3s - 8s =

circle ball r:20 fill:#e74c5c
  x: 100 -> 500 over 4s ease-in-out
  y: 180
```

Use scenes for longer educational videos, explainers, or staged product demos.

## Masks

Masks clip an element. Add `invert` to hide inside the mask instead of outside.

```mmark
rect panel w:300 h:200 fill:#38bdf8 | 0s - 4s
  x: 320
  y: 180
  mask: circle(320, 180, 80)

image photo "image.jpg" w:420 h:260 | 0s - 5s
  x: 320
  y: 180
  mask: path("M 180,80 C 320,10 460,80 460,220 C 320,330 180,220 180,80 Z")
```

Available masks:

- `rect(x, y, w, h)`
- `circle(cx, cy, r)`
- `path("SVG path d")`
- `points [(x1,y1), (x2,y2), ...] closed`
- `fx("expr", xMin, xMax, yBase, steps)`
- `xt("xExpr", "yExpr", tMin, tMax, steps)`
- `text("content", x, y, size, "font")`

Use `fx` masks for waves and liquid reveals. Use `text` masks for typography reveals.

## Compositing

Set `comp` to change blend mode.

```mmark
circle glow r:80 fill:#38bdf8 comp:lighter | 0s - 4s
  x: 280
  y: 180

rect overlay w:260 h:180 fill:#ff00ff44 comp:screen | 0s - 4s
  x: 350
  y: 180
```

Useful modes: `source-over`, `lighter`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `difference`, `exclusion`.

## Motion Paths

`motionPath` offsets an element along an SVG path. Animate `motionProgress`.

```mmark
path route d:"M 80 280 C 180 80, 420 80, 540 260" stroke:#334155 strokeWidth:3 fill:none | 0s - 6s
  dashArray: [12, 10]

rect comet w:34 h:14 fill:#22d3ee anchor:center | 0s - 6s
  motionPath: "M 80 280 C 180 80, 420 80, 540 260"
  motionProgress: 0 -> 1 over 4.5s ease-in-out
  motionRotate: auto
  shadow: 0 0 22 #22d3ee
```

Use `x`/`y` as offsets from the sampled path point.

## Repeat Clones

`repeat` expands an element into compile-time clones. `repeatOffset` applies additive offsets per clone index; `delay` shifts animations.

```mmark
circle dot r:7 fill:#fb7185 | 0s - 4s
  repeat: 10
  repeatOffset: x:28 opacity:-0.07 delay:0.06s
  x: 180
  y: 180
  scale: 0 -> 1 over 0.35s spring(140, 10)
  opacity: 1 -> 0 over 1.2s ease-out
```

Common repeat offsets: `x`, `y`, `z`, `opacity`, `scale`, `scaleX`, `scaleY`, `rotation`, `rotateX`, `rotateY`, `rotateZ`, `delay`.

## Audio

```mmark
audio "bg-music.mp3" | 0s - end volume:0.3 fade-in:2000 fade-out:1000 loop:true
audio "whoosh.wav" | 1.5s - 2.5s volume:0.8
audio "click.mp3" | 3s - 3.5s pan:-0.5 trim:100
```

Audio files resolve relative to the `.mmark` file. Use lower music volume (`0.2` to `0.4`) under voiceovers.

## Imports

```mmark
use "shared-motions.mmark"

text title "Hello" font:Roboto size:48 fill:#fff | 0s - 3s
  x: 320
  y: 180
  fadeIn(duration:0.8s)
```

Imports are best for shared `@motion`, `@draw`, and `@emitter` definitions.

## Draw Marks

`@draw` defines reusable element structures. A call expands the body and prefixes child ids with the instance id.

```mmark
@draw callout(label, color=#0f766e)
  rect body w:220 h:72 fill:$color cornerRadius:14
    x: 0
    y: 0
  text text content:$label font:Roboto size:20 fill:#fff weight:bold
    x: 0
    y: 6

callout note1 label:"Important" color:#1d4ed8 | 0s - 4s
```

Use `@draw` for badges, repeated chart markers, icons made from primitives, and UI components.

## System Constraints

`@system` validates output against a design system.

```mmark
@system
  palette: #0f172a, #38bdf8, #e2e8f0, #ef4444
  fonts: Roboto, Inter
  durations: 300ms, 500ms, 1s
  easing: linear, ease-out, ease-in-out
```

Validated areas:

- `palette`: canvas background, static `fill`, and static `stroke`.
- `fonts`: text `font`.
- `durations`: positive keyframe times.
- `easing`: keyframe/tween easing names.

## Composition Tips

- Build local element motion first, then add camera movement.
- Use groups to keep related coordinate systems small and readable.
- Use scenes for authoring clarity, not as a substitute for explicit timing when overlap matters.
- Prefer `@draw` for repeated structures and `@motion` for repeated animation behavior.
- Keep masks static unless using `fx`/`xt` expressions intentionally.
