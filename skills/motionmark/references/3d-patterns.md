# 3D Patterns

Longer 3D examples live here so the core 3D reference can stay small.

## Spinning Cube With Views

```mmark
---
canvas: 600x400
bg: #0f172a
fps: 60
perspective: 560
vanish: 300 200
---

@group cube sort:depth | 0s - 6s
  x: 300
  y: 200
  rotateX: -16deg
  rotateY: 0deg -> 360deg over 6s linear

@view front parent:cube | 0s - 6s
  at: 0 0 45
  normal: 0 0 1
rect frontFace w:90 h:90 fill:#3b82f6 parent:front | 0s - 6s

@view right parent:cube | 0s - 6s
  at: 45 0 0
  normal: 1 0 0
rect rightFace w:90 h:90 fill:#22d3ee parent:right | 0s - 6s

@view top parent:cube | 0s - 6s
  at: 0 -45 0
  normal: 0 -1 0
  up: 0 0 -1
rect topFace w:90 h:90 fill:#a855f7 parent:top | 0s - 6s
```

## Built-In Cuboid

```mmark
---
canvas: 600x400
bg: #111827
fps: 60
perspective: 620
vanish: 300 200
---

cuboid crate w:120 h:80 d:90 fill:#38bdf8 stroke:#ffffff22 strokeWidth:1 | 0s - 6s
  x: 300
  y: 200
  rotateX: -18deg
  rotateY: 0deg -> 360deg over 6s linear
  frontFill: #3b82f6
  rightFill: #0891b2
  topFill: #a855f7
```

## Card Flip

```mmark
---
canvas: 600x400
bg: #111827
fps: 60
perspective: 620
vanish: 300 200
---

@group card | 0s - 4s
  x: 300
  y: 200
  rotateY: 0deg -> 180deg -> 0deg over 4s ease-in-out

rect front w:160 h:220 fill:#3b82f6 cornerRadius:12 parent:card | 0s - 4s
  z: 2
text frontText "FRONT" font:Roboto size:26 fill:#fff weight:bold parent:card | 0s - 4s
  z: 3

rect back w:160 h:220 fill:#ef4444 cornerRadius:12 parent:card | 0s - 4s
  z: -2
  rotateY: 180deg
text backText "BACK" font:Roboto size:26 fill:#fff weight:bold parent:card | 0s - 4s
  z: -3
  rotateY: 180deg
```

## Gyroscope Rings

```mmark
---
canvas: 600x400
bg: #0f0f23
fps: 60
perspective: 560
vanish: 300 200
---

@group ringX | 0s - 10s
  x: 300
  y: 200
  rotateX: 0deg -> 360deg over 3s linear
circle xRing r:80 stroke:#06b6d4 strokeWidth:7 fill:transparent parent:ringX | 0s - 10s

@group ringY | 0s - 10s
  x: 300
  y: 200
  rotateY: 0deg -> 360deg over 4s linear
circle yRing r:80 stroke:#8b5cf6 strokeWidth:7 fill:transparent parent:ringY | 0s - 10s

@group ringZ | 0s - 10s
  x: 300
  y: 200
  rotateZ: 0deg -> 360deg over 5s linear
circle zRing r:80 stroke:#f59e0b strokeWidth:7 fill:transparent parent:ringZ | 0s - 10s

circle core r:24 fill:#ec4899 | 0s - 10s
  x: 300
  y: 200
```

## Pyramid With Pivoted Faces

```mmark
---
canvas: 600x400
bg: #1a1a2e
fps: 60
perspective: 560
vanish: 300 200
---

@group pyramid | 0s - 8s
  x: 300
  y: 210
  rotateX: -15deg
  rotateY: 0deg -> 360deg over 6s linear

path front fill:#ef4444 parent:pyramid | 0s - 8s
  d: "M-55,55 L55,55 L0,-55 Z"
  z: 55
  origin: bottom
  rotateX: 30deg

path right fill:#22c55e parent:pyramid | 0s - 8s
  d: "M-55,55 L55,55 L0,-55 Z"
  x: 55
  origin: bottom
  rotateOrder: yz
  rotateY: 90deg
  rotateZ: -30deg
```

## DNA-Style Helix

```mmark
---
canvas: 600x500
bg: #1e1b4b
fps: 60
perspective: 720
vanish: 300 250
---

@group helix | 0s - 10s
  x: 300
  y: 250
  rotateY: 0deg -> 360deg over 5s linear

circle left1 r:10 fill:#f472b6 parent:helix | 0s - 10s
  x: 45
  y: -120
  z: 0
circle right1 r:10 fill:#60a5fa parent:helix | 0s - 10s
  x: -45
  y: -120
  z: 0
line3d bond1 stroke:#a78bfa strokeWidth:3 parent:helix | 0s - 10s
  from: (45,-120,0)
  to: (-45,-120,0)

circle left2 r:10 fill:#f472b6 parent:helix | 0s - 10s
  x: 0
  y: -70
  z: 45
circle right2 r:10 fill:#60a5fa parent:helix | 0s - 10s
  x: 0
  y: -70
  z: -45
line3d bond2 stroke:#a78bfa strokeWidth:3 parent:helix | 0s - 10s
  from: (0,-70,45)
  to: (0,-70,-45)
```

For production helixes, generate repeated node/bond pairs with a script or repeated template pattern rather than hand-writing dozens of nodes.
