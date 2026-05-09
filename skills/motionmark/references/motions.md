# Custom @motion Definitions

Define reusable animation patterns with `@motion`.

## Syntax

```mmark
@motion name(param1, param2=default, ...)
  property: animation using $param1, $param2
  property: animation
```

## Basic Examples

### Fade In/Out

```mmark
@motion fade-in(dur=0.5s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion fade-out(dur=0.5s, ease=ease-in)
  opacity: 1 -> 0 over $dur $ease
```

### Slide Animations

```mmark
@motion slide-up(from, to, dur=0.7s, ease=ease-out)
  y: $from -> $to over $dur $ease

@motion slide-down(from, to, dur=0.7s, ease=ease-out)
  y: $from -> $to over $dur $ease

@motion slide-left(from, to, dur=0.7s, ease=ease-out)
  x: $from -> $to over $dur $ease

@motion slide-right(from, to, dur=0.7s, ease=ease-out)
  x: $from -> $to over $dur $ease
```

### Scale Animations

```mmark
@motion scale-in(dur=0.5s, ease=ease-out)
  scale: 0 -> 1 over $dur $ease

@motion scale-out(dur=0.5s, ease=ease-in)
  scale: 1 -> 0 over $dur $ease

@motion pop-in(dur=0.4s)
  scale: 0 -> 1.2 -> 1 over $dur ease-out
  opacity: 0 -> 1 over 0.2s ease-out
```

### Continuous Effects

```mmark
@motion pulse(dur=0.8s, ease=ease-in-out)
  scale: 1 -> 1.1 -> 1 over $dur $ease

@motion drift-x(speed)
  x: f(t) = x + $speed * t
```

## Physics Motions

### Projectile Motion

```mmark
@motion projectile(vx, vy, g, x0, y0)
  x: f(t) = $x0 + $vx * t
  y: f(t) = $y0 - ($vy * t - 0.5 * $g * t^2)
```

Usage:
```mmark
circle ball r:15 fill:#e74c5c | 0s - 5s
  projectile(vx: 100, vy: 200, g: 300, x0: 50, y0: 300)
```

### Simple Harmonic Motion

```mmark
@motion oscillate(cx, cy, ax, ay, freq)
  x: f(t) = $cx + $ax * sin(t * $freq)
  y: f(t) = $cy + $ay * cos(t * $freq)
```

### Orbit

```mmark
@motion orbit(cx, cy, radius, speed)
  x: f(t) = $cx + $radius * cos(t * $speed)
  y: f(t) = $cy + $radius * sin(t * $speed)
```

Usage:
```mmark
circle planet r:10 fill:#3b82f6 | 0s - 10s
  orbit(cx: 320, cy: 180, radius: 100, speed: 2)
```

## Using Motions

Apply motions to elements by calling them under the element:

```mmark
@motion fade-in(dur=0.5s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion slide-up(from, to, dur=0.7s, ease=ease-out)
  y: $from -> $to over $dur $ease

text title "Hello World" font:Roboto size:48 fill:#fff | 0s - 4s
  x: 320
  fade-in()
  slide-up(from: 220, to: 180)
```

### Multiple Motions

Apply multiple motions to one element:

```mmark
rect card w:200 h:120 fill:#1e293b | 0.5s - 4s
  x: 320
  fade-in(0.4s)
  slide-up(from: 250, to: 200, dur: 0.6s)
  pop-in(0.5s)
```

### Override Parameters

```mmark
text fast "Quick fade" font:Roboto size:24 fill:#fff | 0s - 3s
  x: 320
  y: 180
  fade-in(dur: 0.2s)

text slow "Slow fade" font:Roboto size:24 fill:#fff | 0s - 3s
  x: 320
  y: 220
  fade-in(dur: 1.5s, ease: linear)
```

## Standard Library

These motions are available by default:

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

## Tips

1. Define motions at the top of your file after the header
2. Use descriptive names: `bounce-in`, `slide-from-left`, `orbit-clockwise`
3. Provide sensible defaults for optional parameters
4. Motion parameters can reference global variables: `@motion move(speed=$defaultSpeed)`
5. Combine simple motions rather than creating complex all-in-one motions
