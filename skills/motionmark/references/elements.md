# Elements

## 2D Types

```mmark
rect id w:W h:H fill:#hex cornerRadius:N | 0s - 3s
circle id r:R fill:#hex | 0s - 3s
ellipse id rx:N ry:N fill:#hex | 0s - 3s
text id "content" font:Name size:N fill:#hex weight:bold | 0s - 3s
line id from:(x,y) to:(x,y) stroke:#hex strokeWidth:N | 0s - 3s
path id d:"M 0 0 L 100 100" fill:none stroke:#hex strokeWidth:N | 0s - 3s
image id "file.png" w:N h:N fit:cover | 0s - 3s
image remote "https://example.com/photo.jpg" w:N h:N fit:contain | 0s - 3s
```

## 3D Types

`plane`, `cuboid`, `sphere`, `cylinder`, `cone`, `pyramid`, `prism`, `torus` — see 3d.md.

## Inline Props (on element line)

Shape: `w`, `h`, `r`, `rx`, `ry`, `d` (3D depth for cuboid).
Text: `font`, `size`, `weight`, `align`, `letterSpacing`, `lineHeight`.
Style: `fill`, `stroke`, `strokeWidth`, `cornerRadius`, `strokeCap`, `strokeJoin`.
Layout: `parent`, `zIndex`, `anchor`, `origin`.
Blend: `comp`.

## Animatable Props (in body)

`x`, `y`, `z`, `opacity`, `rotation`, `scale`, `scaleX`, `scaleY`, `fill`, `stroke`, `strokeWidth`, `draw`, `drawStart`, `drawEnd`, `dashOffset`, `blur`, `brightness`, `contrast`, `saturate`, `hueRotate`, `motionProgress`, `rotateX`, `rotateY`, `rotateZ`, `depthBias`.

## Static-Only Props (in body, CANNOT animate)

`anchor`, `origin`, `parent`, `comp`, `mask`, `gradient`, `dashArray`, `shadow`, `repeat`, `repeatOffset`, `motionPath`, `motionRotate`, `rotateOrder`, `sort`, `billboard`, `at`, `normal`, `up`, `from`, `to`, `points`, `closed`.

## Gradients

Use on `fill`, `stroke`, or `gradient` property. Static only (cannot animate).

```mmark
fill: linear(x1, y1, x2, y2, #color1, stop1, #color2, stop2)
fill: radial(cx, cy, r1, cx, cy, r2, #color1, stop1, #color2, stop2)
```

Examples:
```mmark
rect sky w:800 h:500 fill:linear(0, 0, 0, 500, #0a0a1a, 0, #1e293b, 1) | 0s - 5s
circle glow r:80 fill:radial(0, 0, 0, 0, 0, 80, #ffffffcc, 0, #ffffff00, 1) | 0s - 5s
```

Multi-stop: `fill: linear(0, 0, 0, 400, #ff0000, 0, #f59e0b, 0.5, #0000ff, 1)`

Can also be set in body: `gradient: linear(...)` (overrides fill for the gradient layer). Can use on `bg:` in header too.

## Values

- Number: `12`, `-4.5`
- Time: `0.5s`, `300ms`
- Angle (3D only): `45deg`
- Color: `#ffffff`, `#ffffff80`, `transparent`
- String: `"quoted text"`
- Point: `(x,y)` or `(x,y,z)`
- Point list: `[(0,0), (40,20)]`

## Remote Assets

Image sources can be local paths or remote `http`/`https` URLs. Local paths are resolved relative to the `.mmark` file. Remote URLs work in browser preview/export when CORS allows the asset, and in Node export by downloading to a temporary cache.

## Image Fit

Images support `fit:fill`, `fit:contain`, and `fit:cover`.

- `fit:fill` stretches to `w`/`h` and is the default.
- `fit:contain` preserves aspect ratio and fits the whole image inside the box.
- `fit:cover` preserves aspect ratio and fills the box, cropping overflow from the center.
