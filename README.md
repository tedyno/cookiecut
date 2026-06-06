# cookiecut

Client-only web app: generates a printable cookie cutter STL from an SVG
silhouette. Everything runs in the browser; dependencies (three, clipper-lib,
cdt2d) are local npm packages bundled by bun — no CDN. Geometry generation
runs in a Web Worker so the UI never freezes during rebuilds (the worker is
prebundled via `bun run build:worker`; restart the dev server after changing
geometry code).

## Running

```sh
bun install
bun run dev        # dev server with hot reload, http://localhost:3000
bun run build      # static build into dist/
```

## Features

- drag & drop SVG (`path`, `rect`, `circle`, `ellipse`, `polygon`)
- drag & drop PNG/JPG/WebP: the image is vectorized (brightness threshold +
  marching squares + Chaikin smoothing); threshold, inversion, simplification
  and smoothing are tunable live and the contours retrace
- stroke-only shapes (`fill="none"` + `stroke`, typical for icons) are
  automatically expanded to outlines of the stroke width — an open line
  becomes a capsule, a closed one yields outer + inner contours
- multiple objects in one file: the default **cut all objects** mode generates
  a cutter for every standalone shape at once (layout preserved; cookie width
  then applies to the whole set); flanges are clipped against neighbouring
  walls/interiors and against each other so they never collide; with the mode
  off you pick a single contour by clicking in the 2D preview; optional
  **union** of all paths (for shapes composed of overlaps)
- cutting line choice when the selected contour contains another one
  (stroked outline): **outer perimeter / line center / inner perimeter**
- parameters: cookie width, wall thickness and height, flange overhang,
  thickness and position (bottom/top)
- 2D contour preview (blue = cutting line, red = outer wall side,
  green = flange edge, grey = other contours) + 3D preview with orbit camera
  and per-parameter dimension annotations
- binary STL export (units mm), watertight by construction — rings are
  triangulated with constrained Delaunay (cdt2d) so caps match the walls

## Print notes

- a 0.8 mm wall: with a 0.4 mm nozzle set the slicer to 2 perimeters
- the model is in mm; wall height = total height
