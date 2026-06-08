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
**after any change to worker-side code (`geo2d.ts`, `manifold.ts`,
`solid.ts`, `generate.ts`, `worker.ts`) run `bun run build:worker` and
restart the dev server** — a running server won't pick the change up on its
own (HMR only sees the stale generated file). Don't try to solve this with a
bun macro — macro results are cached by the calling file's content and
dependency changes don't propagate.

## Architecture

Shared: `types.ts` (contracts between modules and the worker).

Geometry (no DOM — runs in the worker):
- `geo2d.ts` — areas, bounds, point-in-poly, RDP, dedup
- `manifold.ts` — manifold-3d WASM singleton (binary embedded as base64 by
  `scripts/build-worker.ts` — a Blob-URL worker cannot fetch assets and the
  dev server does not serve emitted ones; the emscripten glue's eager
  `new URL(..., import.meta.url)` is patched out at bundle time)
- `solid.ts` — blade-taper helpers (displace + chamfer wedge mesh)
- `generate.ts` — orchestration: CrossSection offsets/booleans, extrude,
  exact 3D booleans → triangles
- `worker.ts` — thin message wrapper around `generate()`

Main-thread-only geometry: `clipper2d.ts` keeps clipper-lib solely for
stroke expansion (open-path offsets), which CrossSection cannot do.

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
- Single loops fed to CrossSection must be CCW — the Positive fill rule
  silently discards CW input (symptom: empty `toPolygons()`).
- Every Manifold/CrossSection WASM object must be `delete()`d — the `Scope`
  helper in generate.ts tracks and disposes them per request.
- The blade taper is the one hand-built mesh: a chamfer wedge of plain quads
  between the edge loop and the same loop displaced outward (identical
  vertex counts). Its outer skirt sits WEDGE_SKIRT outside the wall —
  coincident faces make exact booleans emit degenerate triangles. Concave
  corners are pre-rounded by morphological closing with radius
  1.5×displacement + WEDGE_SKIRT, or the displaced loops self-cross.
- The boolean output still contains exactly-collapsed triangles along
  tangential contacts — `soupWithoutDegenerates` drops triangles with two
  exactly identical vertices and nothing else (area thresholds break shells).
- 3MF export welds vertices by the ROUNDED coordinate key, matching the
  written precision.

## Verification

No checked-in tests. Verify headless: a playwright-core script (Chromium from
`~/Library/Caches/ms-playwright/`) uploads a file, waits for the
"Model generated" status, downloads the STL — which is then validated in
Python with trimesh: every body `is_watertight`, body counts, bbox. Pure
geometry can be tested directly: `bun -e "import { generate } from
'./src/generate.ts'; ..."` with mock contours, no browser needed.
