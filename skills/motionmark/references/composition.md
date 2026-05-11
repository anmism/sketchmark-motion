# Composition

## Groups

```mmark
@group card | 0s - 4s
  x: 320
  y: 180
  scale: 0.9 -> 1 over 0.5s ease-out

rect bg w:180 h:96 fill:#1e293b cornerRadius:12 parent:card | 0s - 4s
  x: 0
  y: 0
```

Children use `parent:groupId`. Child x/y are relative to parent.

## Scenes

```mmark
= Intro | 0s - 3s =
text title "Welcome" font:Roboto size:48 fill:#ffffff
  x: 320
  y: 180
```

Elements without lifetimes inherit the active scene lifetime. Prefer explicit lifetimes.

## Camera

```mmark
@camera
  x: 0 -> 120 over 5s ease-in-out
  y: 0 -> -40 over 5s ease-in-out
  scale: 1 -> 1.25 over 5s ease-out
```

Camera applies inverted transform to all elements without explicit parents.

## Masks

```mmark
rect panel w:300 h:180 fill:#38bdf8 | 0s - 4s
  x: 320
  y: 180
  mask: circle(320, 180, 80)
```

Types: `rect(x,y,w,h)`, `circle(cx,cy,r)`, `path("M ...")`, `points [(x,y),...] closed`, `text("TEXT", x, y, size, "font")`. Add `invert` to invert.

Blend modes (via `comp:`): `source-over`, `lighter`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `difference`, `exclusion`.

## Motion Path

```mmark
rect comet w:34 h:14 fill:#22d3ee | 0s - 6s
  motionPath: "M 80 280 C 180 80, 420 80, 540 260"
  motionProgress: 0 -> 1 over 4.5s ease-in-out
  motionRotate: auto
```

`motionPath`, `motionRotate` are static. Animate `motionProgress` (0 to 1).

## Repeat

```mmark
circle dot r:7 fill:#fb7185 | 0s - 4s
  repeat: 10
  repeatOffset: x:28 opacity:-0.07 delay:0.06s
```

## @motion (Reusable Animations)

```mmark
@motion fade-in(dur=0.5s, ease=ease-out)
  opacity: 0 -> 1 over $dur $ease

@motion slide-y(from, to, dur=0.7s)
  y: $from -> $to over $dur ease-out

text title "Hello" font:Roboto size:48 fill:#ffffff | 0s - 4s
  x: 320
  fade-in(dur:0.8s)
  slide-y(from:220, to:180)
```

## @draw (Reusable Components)

```mmark
@draw badge(label, color=#1d4ed8)
  rect bg w:180 h:52 fill:$color cornerRadius:10
  text txt content:$label font:Roboto size:18 fill:#ffffff

badge b1 label:"Ready" color:#0f766e | 0s - 3s
```

## Audio

```mmark
audio "bg.mp3" | 0s - end volume:0.3 fade-in:1000 fade-out:1000 loop:true
```
