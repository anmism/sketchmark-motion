# Particle Emitter

## Syntax

```mmark
@emitter id | startTime - endTime
  template: elementType inlineProps...
  spawn: N/s
  lifetime: duration
  prop: value
```

## Full Example

```mmark
@emitter sparks | 0s - 2s
  template: circle r:4 fill:#f97316
  spawn: 40/s
  lifetime: 0.8s
  x: 320
  y: 180
  vx: random(-160, 160)
  vy: random(-220, -80)
  gravity: 180
  turbulence: 12
  opacity: 1 -> 0 over life
  scale: 1 -> 0.2 over life
  fill: #f97316 -> #fde047 over life
```

## Required Props

`template`, `spawn`, `lifetime` - all three are mandatory.

## ONLY These Value Types Are Allowed

| Type | Example | Use for |
|------|---------|---------|
| Static number | `x: 320` | position, gravity, turbulence |
| Static color | `fill: #ff6b35` | initial color |
| Rate | `spawn: 40/s` | spawn rate only |
| Duration | `lifetime: 0.8s` | particle lifetime only |
| random(min, max) | `vx: random(-80, 80)` | randomized per particle |
| x/y keyframes | `y: 600 at 0s, -80 at 5s ease-in` | moving emitter source, sampled at particle birth |
| x/y tween | `x: 200 -> 300 over 2s ease-out` | moving emitter source, sampled at particle birth |
| x/y expression | `x: f(t) = 320 + 100 * sin(t)` | moving emitter source, sampled at particle birth |
| from -> to over life | `opacity: 1 -> 0 over life` | animate over particle lifetime |

## NOT Allowed Inside @emitter

- `value at 0s, value at 2s` on props other than `x`/`y` (keyframes) - PARSER ERROR
- `value -> value over 2s ease-out` on props other than `x`/`y` (tween with duration) - PARSER ERROR
- `f(t) = expression` on props other than `x`/`y` (expressions) - PARSER ERROR
- `wiggle(...)` - PARSER ERROR
- Any animation form from elements except `x`/`y` tween/keyframes/expression - PARSER ERROR

Emitter source position can move with `x`/`y` tweens, keyframes, or `f(t)` expressions. Times are relative to the emitter start, and each particle samples the emitter position at birth. Already-spawned particles continue with their own velocity, gravity, turbulence, and over-life animation.

## Template Types

```mmark
template: circle r:3 fill:#60a5fa
template: rect w:6 h:6 fill:#facc15
template: ellipse rx:18 ry:28 fill:#ff6b35
template: line from:(0,0) to:(0,12) stroke:#60a5fa strokeWidth:2
template: path d:"M0,-6 L5,5 L-5,5 Z" fill:#f97316
```

## Emitter Props

- Position: `x`, `y`
- Velocity: `vx`, `vy`
- Physics: `gravity`, `turbulence`
- Over-life: `opacity`, `scale`, `fill`
- Emit shape: `emitOn: line(x1,y1,x2,y2)`, `circle(cx,cy,r)`, `path("M ...")`

## Recipes

- Rain: line template, `spawn:70/s`, `vy:random(260,360)`, short lifetime.
- Snow: circle template, low `vy`, high `turbulence`.
- Fire: `emitOn:line(...)`, negative `vy`, fade opacity over life.
- Explosion: short emitter lifetime, high random `vx/vy`, short particle lifetime.
