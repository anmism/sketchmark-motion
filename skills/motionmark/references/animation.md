# Animation

All animation props go in the element body (2-space indent). Only animatable props can be animated.

## Forms

### Tween (A to B)

```mmark
x: 100 -> 500 over 2s ease-out
fill: #ef4444 -> #22c55e over 2s linear
```

### Multi-value tween (A to B to C)

```mmark
scale: 1 -> 1.15 -> 1 over 0.8s ease-in-out
opacity: 0 -> 1 -> 0 over 1.5s ease-in-out
```

### Keyframes (value at time)

```mmark
y: 280 at 0s, 90 at 0.5s ease-out, 280 at 1s ease-in
x: 100 at 0s, 500 at 1s ease-out, 500 at 2s, 100 at 3s ease-in
```

### Expression

```mmark
x: f(t) = 320 + 80 * cos(t * 2)
y: f(t) = 180 + 60 * sin(t * 3)
rotation: f(t) = t * 45
```

Functions: `sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `pow`, `mod`. Constants: `pi`, `e`.

### Wiggle

```mmark
x: wiggle(frequency, amplitude, base:value, seed:N)
y: wiggle(3, 24, base:180, seed:2)
```

## Easing

`linear`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(x1,y1,x2,y2)`, `spring(stiffness:N, damping:N)`.

## Context Rules

| Context | Tween | Keyframes | Expression | Wiggle | over life |
|---------|-------|-----------|------------|--------|-----------|
| Element body | YES | YES | YES | YES | NO |
| @emitter body | x/y only | x/y only | x/y only | NO | YES |
| @camera body | YES | YES | YES | YES | NO |

NEVER use element animation forms on non-position @emitter props. Emitters only support static values, `random(min,max)`, `from -> to over life`, and `x`/`y` tween/keyframes/expression forms sampled at particle birth.
