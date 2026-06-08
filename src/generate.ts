// generation orchestration on top of manifold-3d: contours + params ->
// triangles and UI data (no DOM — runs in the worker)
//
// 2D offsets/booleans use CrossSection, solids are extruded and combined
// with exact 3D booleans — the output is manifold (watertight) by guarantee.
// The only hand-built mesh is the blade-taper wedge (see solid.ts).
import type { Contour, GenResult, Params, Pt } from './types';
import { boundsAll, ccw, dedup, perimeter, pointInPoly, rdp, signedArea } from './geo2d';
import { getManifold } from './manifold';
import type { CrossSection, Manifold, ManifoldToplevel } from './manifold';
import { displace, wedgeMesh, WEDGE_SKIRT } from './solid';

const EPS = 0.03; // contour simplification tolerance [mm]
const SEG = 32;   // circular segments for round offset joins

/** Indices of contours not contained in any larger contour = standalone objects */
export function topLevelObjects(contours: Contour[]): number[] {
  return contours
    .map((_, i) => i)
    .filter(i => !contours.some((d, j) =>
      j !== i && d.area > contours[i]!.area && pointInPoly(contours[i]!.pts[0]!, d.pts)));
}

/** Largest contour inside the base one — the inner-perimeter candidate */
export function innerContourOf(contours: Contour[], basisIdx: number): Contour | null {
  const basis = contours[basisIdx]!;
  let best: Contour | null = null;
  for (let i = 0; i < contours.length; i++) {
    if (i === basisIdx) continue;
    const c = contours[i]!;
    if (c.area < basis.area && pointInPoly(c.pts[0]!, basis.pts) && (!best || c.area > best.area)) best = c;
  }
  return best;
}

/** WASM objects must be freed by hand; collect them and dispose at the end */
class Scope {
  private objs: { delete(): void }[] = [];
  t<T extends { delete(): void }>(o: T): T {
    this.objs.push(o);
    return o;
  }
  dispose(): void {
    for (const o of this.objs) {
      try { o.delete(); } catch { /* already deleted */ }
    }
  }
}

/**
 * Indexed mesh -> triangle soup, skipping exactly degenerate triangles
 * (collapsed to a segment). Exact booleans emit them along tangential
 * contacts; they carry no surface and would show up as loose crumbs in
 * slicers. The real shells are untouched — the solids are constructed so
 * no two faces ever coincide (see the wedge skirt in solid.ts).
 */
function soupWithoutDegenerates(numProp: number, vp: ArrayLike<number>, tv: ArrayLike<number>): Float32Array {
  const same = (a: number, b: number): boolean =>
    vp[a] === vp[b] && vp[a + 1] === vp[b + 1] && vp[a + 2] === vp[b + 2];
  const out = new Float32Array(tv.length * 3);
  let w = 0;
  for (let t = 0; t < tv.length; t += 3) {
    const a = tv[t]! * numProp, b = tv[t + 1]! * numProp, c = tv[t + 2]! * numProp;
    if (same(a, b) || same(b, c) || same(c, a)) continue; // collapsed triangle
    for (const v of [a, b, c]) {
      out[w++] = vp[v]!;
      out[w++] = vp[v + 1]!;
      out[w++] = vp[v + 2]!;
    }
  }
  return out.slice(0, w);
}

const toVecs = (l: Pt[]): [number, number][] => l.map(p => [p.x, p.y]);
const fromPolys = (polys: ArrayLike<number>[][]): Pt[][] =>
  Array.from(polys, pl => Array.from(pl, v => ({ x: v[0]!, y: v[1]! })));
const largestLoop = (loops: Pt[][]): Pt[] =>
  loops.reduce((a, b) => Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b);

export async function generate(raw: Contour[], p: Params): Promise<GenResult> {
  const wasm = await getManifold();
  const scope = new Scope();
  try {
    return build(wasm, scope, raw, p);
  } finally {
    scope.dispose();
  }
}

function build(wasm: ManifoldToplevel, S: Scope, raw: Contour[], p: Params): GenResult {
  if (!raw.length) throw new Error('No contours.');
  if (!(p.targetW > 0 && p.wall > 0 && p.height > 0)) throw new Error('Invalid parameters.');

  const { CrossSection } = wasm;
  // self-intersecting sampled loops are cleaned by the Positive fill rule
  const cs = (loops: Pt[][], fill: 'Positive' | 'NonZero' = 'Positive'): CrossSection =>
    S.t(new CrossSection(loops.map(toVecs), fill));
  const off = (c: CrossSection, d: number): CrossSection => S.t(c.offset(d, 'Round', 2, SEG));
  const sub = (a: CrossSection, b: CrossSection): CrossSection => S.t(a.subtract(b));

  // NonZero keeps holes of the merged shape (hole loops arrive CW)
  let contours = raw;
  if (p.unionAll && raw.length > 1) {
    contours = fromPolys(cs(raw.map(c => c.pts), 'NonZero').toPolygons())
      .map(pts => ({ pts, area: Math.abs(signedArea(pts)) }))
      .sort((a, b) => b.area - a.area);
    if (!contours.length) throw new Error('Union of contours failed.');
  }

  const topIdx = topLevelObjects(contours);
  const allMode = p.allObjects && topIdx.length > 1;
  const selectedIdx = Math.min(Math.max(0, p.selectedIdx), contours.length - 1);
  const basisList = allMode ? topIdx : [selectedIdx];

  // cutting line per object per choice: outer / inner / line center
  const cuttingContour = (idx: number): Pt[] => {
    const basis = contours[idx]!;
    const inner = innerContourOf(contours, idx);
    // single loops must be CCW — the Positive fill rule discards CW input
    if (!inner || p.lineMode === 'outer') return largestLoop(fromPolys(cs([ccw(basis.pts)]).toPolygons()));
    if (p.lineMode === 'inner') return largestLoop(fromPolys(cs([ccw(inner.pts)]).toPolygons()));
    // stroke width ~ 2*(A_out - A_in) / (P_out + P_in); center = basis inset by w/2
    const w = 2 * (basis.area - inner.area) / (perimeter(basis.pts) + perimeter(inner.pts));
    return largestLoop(fromPolys(off(cs([ccw(basis.pts)]), -w / 2).toPolygons()));
  };

  // cutting lines -> scale the whole set to the target width, center at origin
  let cuts = basisList.map(cuttingContour);
  const b0 = boundsAll(cuts);
  const s = p.targetW / b0.w;
  const xf = (pt: Pt): Pt => ({ x: (pt.x - (b0.minx + b0.maxx) / 2) * s, y: (pt.y - (b0.miny + b0.maxy) / 2) * s });
  cuts = cuts.map(c => rdp(c.map(xf), EPS));
  const displayContours = contours.map(c => c.pts.map(xf));

  const flangeT = p.flangeW > 0 ? Math.min(p.flangeT, p.height) : 0;

  // blade taper: the outer wall slopes from full thickness to `edge` over the
  // last `taperH` mm before the cutting edge (see solid.ts for the wedge)
  const edgeT = Math.min(p.edge, p.wall);
  const taperH = edgeT < p.wall - 1e-6 ? Math.max(0, Math.min(p.taperH, p.height - flangeT)) : 0;

  const cutCSs = cuts.map(c => cs([c]));
  const edgeLoops: Pt[][] = [];
  const wallLoops: Pt[][] = [];
  cuts.forEach((c, i) => {
    if (taperH > 0) {
      // round concave corners (closing) above the total displacement radius
      // (wall offset + wedge skirt), otherwise the displaced loops self-cross
      const closeR = 1.5 * (p.wall - edgeT) + WEDGE_SKIRT;
      const closed = off(off(off(cutCSs[i]!, edgeT), closeR), -closeR);
      const edge = ccw(dedup(rdp(largestLoop(fromPolys(closed.toPolygons())), EPS)));
      edgeLoops.push(edge);
      wallLoops.push(displace(edge, p.wall - edgeT));
    } else {
      const wall = ccw(dedup(rdp(largestLoop(fromPolys(off(cutCSs[i]!, p.wall).toPolygons())), EPS)));
      edgeLoops.push(wall);
      wallLoops.push(wall);
    }
  });

  // flange rings clipped against neighbours' walls+interiors (2D subtract);
  // overlapping flanges of different objects simply merge in the 3D union
  let flangeCSs: CrossSection[] | null = null;
  if (p.flangeW > 0) {
    const disks = wallLoops.map(w => cs([w]));
    flangeCSs = cuts.map((_, i) => {
      let ring = sub(off(cutCSs[i]!, p.wall + p.flangeW), off(cutCSs[i]!, p.wall / 2));
      for (let j = 0; j < cuts.length; j++) {
        if (j !== i) ring = sub(ring, disks[j]!);
      }
      return ring;
    });
  }

  // solids: extrude + exact booleans
  const { Manifold, Mesh } = wasm;
  const zFlange = p.flangeAt === 'bottom' ? 0 : p.height - flangeT;
  let sheet: Manifold | null = null;
  cuts.forEach((_, i) => {
    const wallRing = sub(cs([wallLoops[i]!]), cutCSs[i]!);
    let cutter = S.t(Manifold.extrude(wallRing, p.height));
    if (flangeCSs) {
      cutter = S.t(cutter.add(S.t(S.t(Manifold.extrude(flangeCSs[i]!, flangeT)).translate([0, 0, zFlange]))));
    }
    if (taperH > 0) {
      const wedge = S.t(new Manifold(new Mesh(wedgeMesh(wallLoops[i]!, edgeLoops[i]!, p.height, taperH, p.flangeAt))));
      cutter = S.t(cutter.subtract(wedge));
    }
    sheet = sheet ? S.t(sheet.add(cutter)) : cutter;
  });

  // exact booleans leave zero-volume crumb shells along coincident faces
  // (wedge/wall, flange/wall overlaps) — drop connected components with
  // ~zero enclosed volume and keep only the real cutters
  const mesh = sheet!.getMesh();
  const trimmed = soupWithoutDegenerates(mesh.numProp, mesh.vertProperties, mesh.triVerts);

  const flangeLoops = flangeCSs ? flangeCSs.flatMap(f => fromPolys(f.toPolygons())) : null;
  const hasInner = allMode
    ? topIdx.some(i => innerContourOf(contours, i) !== null)
    : contours.length >= 2 && innerContourOf(contours, selectedIdx) !== null;
  const bc = boundsAll(cuts);
  const bb = boundsAll(flangeLoops?.length ? flangeLoops : wallLoops);

  return {
    positions: trimmed, cuts, wallOuters: wallLoops, flangeOuters: flangeLoops, flangeLoops, displayContours,
    contourCount: contours.length, topCount: topIdx.length, basisCount: basisList.length,
    allMode, hasInner, selectedIdx,
    cutSize: { w: bc.w, h: bc.h }, totalSize: { w: bb.w, h: bb.h },
  };
}
