# Particle Emitters

Use `@emitter` for compile-time particle systems: rain, snow, fire, smoke, bubbles, sparks, confetti, trails, and bursts.

## Syntax

```mmark
@emitter name | 0s - 5s
  template: circle r:4 fill:#60a5fa
  spawn: 40/s
  lifetime: 2s
  x: random(0, 640)
  y: 0
  vx: random(-10, 10)
  vy: random(120, 200)
  gravity: 50
  turbulence: 8
  opacity: 1 -> 0 over life
  scale: 1 -> 0.4 over life
  fill: #60a5fa -> #ffffff over life
```

The compiler expands particles into normal elements with generated ids like `name__p0`.

## Required Properties

| Property | Value | Notes |
|---|---|---|
| `template` | inline element | Particle shape, for example `circle r:4 fill:#fff`. |
| `spawn` | `N/s` or number | Particles per second. |
| `lifetime` | duration | How long each particle lives. |

## Motion Properties

| Property | Value | Notes |
|---|---|---|
| `x`, `y` | number or `random(min,max)` | Spawn position if `emitOn` is absent. |
| `vx`, `vy` | number or `random(min,max)` | Velocity in px/sec. |
| `gravity` | number or `random(min,max)` | Downward acceleration in px/sec/sec. |
| `turbulence` | number or `random(min,max)` | Sine displacement amplitude. |
| `emitOn` | shape expression | Overrides `x`/`y` spawn location. |

`emitOn` shapes:

```mmark
emitOn: line(120, 300, 520, 300)
emitOn: circle(320, 180, 60)
emitOn: path("M 80 260 C 180 120, 460 120, 560 260")
```

Path emitters currently use the path start point.

## Over-Life Properties

```mmark
opacity: 1 -> 0 over life
scale: 1 -> 0.2 over life
fill: #f97316 -> #fde047 over life
```

Numeric over-life values compile to expressions. Color over-life `fill` compiles to color keyframes.

## Template Examples

```mmark
template: circle r:3 fill:#60a5fa
template: rect w:6 h:6 fill:#facc15
template: text "*" font:Roboto size:18 fill:#fff
template: path d:"M0,-6 L5,5 L-5,5 Z" fill:#f97316
```

Keep templates small; emitter count multiplies rendering cost.

## Recipes

### Rain

```mmark
@emitter rain | 0s - 8s
  template: line x1:0 y1:0 x2:0 y2:12 stroke:#60a5fa strokeWidth:2
  spawn: 70/s
  lifetime: 1.5s
  x: random(0, 640)
  y: -20
  vx: random(-20, 10)
  vy: random(260, 360)
  opacity: random(0.35, 0.75)
```

### Snow

```mmark
@emitter snow | 0s - 10s
  template: circle r:3 fill:#f8fafc
  spawn: 24/s
  lifetime: 5s
  x: random(0, 640)
  y: -10
  vx: random(-20, 20)
  vy: random(30, 70)
  turbulence: 24
  opacity: random(0.45, 0.9)
```

### Fire

```mmark
@emitter fire | 0s - 8s
  template: circle r:8 fill:#ff6b35
  spawn: 55/s
  lifetime: 0.8s
  emitOn: line(285, 300, 355, 300)
  vx: random(-22, 22)
  vy: random(-130, -70)
  turbulence: 16
  opacity: 1 -> 0 over life
  scale: 1 -> 0.15 over life
  fill: #ff6b35 -> #ffcc00 over life
```

### Smoke

```mmark
@emitter smoke | 0s - 8s
  template: circle r:18 fill:#64748b
  spawn: 10/s
  lifetime: 4s
  emitOn: line(305, 260, 335, 260)
  vx: random(-8, 8)
  vy: random(-46, -26)
  turbulence: 28
  opacity: 0.55 -> 0 over life
  scale: 0.6 -> 2.2 over life
```

### Confetti

```mmark
@emitter confetti | 0s - 3s
  template: rect w:8 h:4 fill:#facc15
  spawn: 90/s
  lifetime: 2.4s
  x: 320
  y: 80
  vx: random(-220, 220)
  vy: random(-130, -40)
  gravity: 180
  turbulence: 16
  opacity: 1 -> 0 over life
```

### Explosion

```mmark
@emitter explosion | 0.5s - 1s
  template: circle r:6 fill:#f97316
  spawn: 180/s
  lifetime: 0.8s
  x: 320
  y: 180
  vx: random(-260, 260)
  vy: random(-260, 260)
  gravity: 140
  opacity: 1 -> 0 over life
  scale: 1 -> 0.1 over life
  fill: #f97316 -> #fbbf24 over life
```

## Authoring Guidance

- Use short emitter lifetimes for bursts; otherwise particle counts grow quickly.
- Use `emitOn: line(...)` for fire, smoke, fountains, and rain curtains.
- Use `emitOn: circle(...)` for bursts, rings, fireflies, and orbiting dust.
- Prefer fewer, larger particles for smoke; more, smaller particles for rain or sparks.
- Fade opacity over life so particles do not pop off abruptly.
