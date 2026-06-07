# cookiecut

Client-only web app (bun + TypeScript + three.js): generates a cookie cutter
STL/3MF from SVG/PNG/JPG. Everything runs in the browser, geometry in a Web Worker.

## Commands

```sh
bun install
bun run dev           # build:worker + dev server (port via BUN_PORT)
bun run build         # static build into dist/
bun run build:worker  # rebundle just the worker into src/worker.gen.js
bunx tsc --noEmit     # typecheck (bun itself does not typecheck)
```

## Worker — BEWARE of stale builds

Bun's bundler cannot handle `new Worker(new URL(...))`. The worker is
therefore prebundled into `src/worker.gen.js` (gitignored) and inlined into
the app as a text import (`with { type: 'text' }`) → Blob URL. Consequence:
**after any change to worker-side code (`geo2d.ts`, `clipper2d.ts`,
`solid.ts`, `generate.ts`, `worker.ts`) run `bun run build:worker` and
restart the dev server** — a running server won't pick the change up on its
own (HMR only sees the stale generated file). Don't try to solve this with a
bun macro — macro results are cached by the calling file's content and
dependency changes don't propagate.

## Architecture

Shared: `types.ts` (contracts between modules and the worker).

Geometry (pure, no DOM — runs in the worker):
- `geo2d.ts` — areas, bounds, point-in-poly, RDP, dedup
- `clipper2d.ts` — wrapper over clipper-lib (offsets, booleans, stroke expansion)
- `solid.ts` — watertight solid construction (strips, cdt2d caps, prisms)
- `generate.ts` — orchestration: contours + params → triangles
- `worker.ts` — thin message wrapper around `generate()`

Main thread (DOM/canvas):
- `svg.ts`, `raster.ts` — contour extraction (SVG via `getPointAtLength`;
  raster via threshold + marching squares)
- `scene.ts` — three.js viewport (factory `createViewport`)
- `dims.ts` — parameter dimension annotations (factory `createDims`)
- `preview2d.ts` — 2D preview + hit-test for click contour selection
- `worker-client.ts` — worker communication; stale responses are dropped
  by request id
- `app.ts` — just wiring UI ↔ modules, state, event handlers

## Geometry invariants

- Units mm, Y axis up (SVG Y is flipped during extraction), Z = height.
- Loops keep clipper orientation: outer CCW (positive area), holes CW.
  `strip()` with the same formula gives CW holes an outward-facing normal.
- Horizontal caps must be triangulated **exclusively with cdt2d** (constrained
  Delaunay, `{exterior: false, delaunay: false}`) — earcut (THREE.ShapeUtils)
  does not guarantee boundary edges survive and the mesh ends up leaky.
- Always pipe clipper boolean output through SimplifyPolygons +
  CleanPolygons + a tiny-area filter + `rdp()` — slivers break triangulation.
- In multi-object mode flanges are clipped against neighbours' walls/interiors
  and previously placed flanges, with zones inflated by 0.05 mm — coincident
  faces of two bodies would become non-manifold after vertex merging.
- The blade taper lofts between the edge loop and the same loop displaced
  outward (identical vertex counts). Concave corners must be rounded first
  (morphological closing at 1.5x the displacement) or the displaced loop
  self-crosses and sheds non-manifold fragments.
- Never spread large arrays into `push(...)` — it overflows the call stack;
  use `append()` / `Float32Array.set`.

## Verification

No checked-in tests. Verify headless: a playwright-core script (Chromium from
`~/Library/Caches/ms-playwright/`) uploads a file, waits for the
"Model generated" status, downloads the STL — which is then validated in
Python with trimesh: every body `is_watertight`, body counts, bbox. Pure
geometry can be tested directly: `bun -e "import { generate } from
'./src/generate.ts'; ..."` with mock contours, no browser needed.
