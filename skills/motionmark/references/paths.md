# Paths

Four path forms. All require `fill:none` for stroke-only. Never mix `draw` with `drawStart`/`drawEnd`.

## SVG Data

```mmark
path curve d:"M 80 260 C 180 120, 460 120, 560 260" fill:none stroke:#38bdf8 strokeWidth:4 | 0s - 3s
  draw: 0 -> 1 over 2s ease-out
```

Commands: `M`, `L`, `H`, `V`, `Q`, `C`, `Z`. Always quote `d` value.

## Point List

```mmark
path tri [(100,220), (160,120), (220,220)] fill:#ef4444 closed:true | 0s - 3s
```

Use `closed:true` for filled polygons.

## Function Path (y from x)

```mmark
path wave fx:"200 - 50 * sin(x * 0.05)" xRange:"0-400" steps:80 fill:none stroke:#60a5fa strokeWidth:3 | 0s - 3s
```

## Parametric Path

```mmark
path orbit xt:"320 + 90 * cos(t)" yt:"180 + 60 * sin(t)" tRange:"0-6.28" steps:80 fill:none stroke:#fbbf24 strokeWidth:3 | 0s - 3s
```

Math: `sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `pow`, `^`, `pi`.

Rules: quote `fx`, `xt`, `yt`, and range values. More `steps` = smoother but slower.
