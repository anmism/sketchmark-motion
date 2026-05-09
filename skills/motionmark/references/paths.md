# Path Creation Methods

MotionMark paths support four creation methods. Choose based on your data source and shape type.

## Decision Guide

| Method | Use When |
|--------|----------|
| `d:"..."` | You have SVG path data from Figma/Illustrator/design tools |
| `[(x,y), ...]` | You have exact coordinates for polygons/shapes |
| `fx:"..."` | Drawing graphs/waves where y depends on x |
| `xt/yt:"..."` | Drawing shapes that loop back (circles, spirals, hearts) |

**Quick test:** Can you draw it left-to-right without going backwards on x?
- Yes: use `fx`
- No: use `xt` + `yt`

## Method 1: SVG d Syntax

For paths exported from design tools or hand-crafted SVG.

```mmark
# Arrow
path arrow d:"M 10 50 L 90 50 L 70 30 M 90 50 L 70 70" stroke:#fff strokeWidth:2

# Triangle
path tri d:"M 0 100 L 50 0 L 100 100 Z" fill:#e74c5c

# Bezier curve
path curve d:"M 0 100 Q 50 0 100 100" stroke:#4ecdc4 strokeWidth:3
```

SVG commands: `M` (move), `L` (line), `H` (horizontal), `V` (vertical), `C` (cubic bezier), `Q` (quadratic bezier), `Z` (close)

## Method 2: Points Array

For polygons with known coordinates.

```mmark
# Triangle
path triangle [(100,200), (150,100), (200,200)] fill:#e74c5c closed:true

# Open polyline
path line [(0,0), (50,100), (100,50), (150,100)] stroke:#fff strokeWidth:2

# Star points
path star [(320,100), (340,160), (400,160), (355,200), (370,260), (320,225), (270,260), (285,200), (240,160), (300,160)] fill:#fbbf24 closed:true
```

## Method 3: Function fx (Y = f(X))

For mathematical functions and graphs.

```mmark
# Sine wave
path sine fx:"200 - 50 * sin(x * 0.05)" xRange:"0-400" steps:50 stroke:#60a5fa strokeWidth:2

# Parabola
path para fx:"300 - 0.01 * (x - 200)^2" xRange:"0-400" steps:40 stroke:#4ade80 strokeWidth:2

# Exponential
path exp fx:"300 - 50 * (1.02^x - 1)" xRange:"0-200" steps:40 stroke:#f59e0b strokeWidth:2

# Combining functions
path complex fx:"200 - 30 * sin(x * 0.03) - 20 * cos(x * 0.07)" xRange:"0-500" steps:80 stroke:#ec4899 strokeWidth:2
```

Parameters:
- `fx:"expression"` - y as function of x
- `xRange:"start-end"` - x domain
- `steps:N` - number of points (more = smoother)

## Method 4: Parametric xt/yt

For shapes that can't be expressed as y=f(x).

```mmark
# Circle
path circle xt:"320 + 80 * cos(t)" yt:"180 + 80 * sin(t)" tRange:"0-6.28" steps:60 stroke:#4ade80 strokeWidth:2

# Ellipse
path ellipse xt:"320 + 100 * cos(t)" yt:"180 + 50 * sin(t)" tRange:"0-6.28" steps:60 stroke:#60a5fa strokeWidth:2

# Spiral
path spiral xt:"320 + t * 5 * cos(t)" yt:"180 + t * 5 * sin(t)" tRange:"0-20" steps:100 stroke:#f59e0b strokeWidth:2

# Heart
path heart xt:"320 + 40 * sin(t)^3" yt:"200 - 32 * cos(t) + 12 * cos(2*t) + 6 * cos(3*t) + 2 * cos(4*t)" tRange:"0-6.28" steps:60 fill:#ec4899

# Lissajous figure
path lissa xt:"320 + 80 * sin(3 * t)" yt:"180 + 80 * sin(2 * t)" tRange:"0-6.28" steps:100 stroke:#a855f7 strokeWidth:2

# Star (5-pointed)
path star5 xt:"320 + (30 + 20 * cos(5 * t)) * cos(t)" yt:"180 + (30 + 20 * cos(5 * t)) * sin(t)" tRange:"0-6.28" steps:100 stroke:#fbbf24 strokeWidth:2
```

Parameters:
- `xt:"expression"` - x as function of t
- `yt:"expression"` - y as function of t  
- `tRange:"start-end"` - parameter domain
- `steps:N` - number of points

## Available Math Functions

For both `fx` and `xt/yt`:

- `sin(x)`, `cos(x)`, `tan(x)`
- `sqrt(x)`, `abs(x)`
- `min(a,b)`, `max(a,b)`
- `pow(base, exp)` or `^`

Constants:
- Use `3.14159` for pi
- Use `6.28318` for 2*pi

## Animating Paths

### Draw Animation

Reveal path progressively:

```mmark
path curve fx:"200 - 50 * sin(x * 0.05)" xRange:"0-400" steps:50 stroke:#60a5fa strokeWidth:2 | 0s - 3s
  draw: 0 -> 1 over 2s ease-out
```

### Position Animation

Move the entire path:

```mmark
path shape d:"M 0 0 L 50 50 L 0 100 Z" fill:#e74c5c | 0s - 3s
  x: 100 -> 400 over 2s ease-out
  y: 200
```

### Rotation

Rotate around anchor:

```mmark
path arrow d:"M 0 20 L 40 20 L 30 10 M 40 20 L 30 30" stroke:#fff strokeWidth:2 | 0s - 5s
  x: 320
  y: 180
  rotation: f(t) = t * 2
```

## Tips

1. For smooth curves, use more steps (60-100)
2. For angular shapes, fewer steps are fine (20-40)
3. `closed:true` connects last point to first
4. Stroke-only paths are great for draw animations
5. Fill works best with closed paths
