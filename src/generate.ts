// generation orchestration: contours + params -> triangles and UI data
// (pure code, no DOM — runs in the worker)
import type { Contour, GenResult, LineMode, Params, Pt } from './types';
import { boundsAll, ccw, dedup, perimeter, pointInPoly, rdp, signedArea } from './geo2d';
import { diffRegions, offsetPoly, simplifyPoly, unionContours } from './clipper2d';
import { cutterPositions, displace, regionPrism } from './solid';

const EPS = 0.03; // contour simplification tolerance [mm]
const GAP = 0.05; // forbidden-zone inflation for flange clipping [mm]

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

/** Cutting line of the given object per choice: outer / inner / line center */
function cuttingContourFor(contours: Contour[], basisIdx: number, mode: LineMode): Pt[] {
  const basis = contours[basisIdx]!;
  const inner = innerContourOf(contours, basisIdx);
  if (!inner) return simplifyPoly(basis.pts);
  switch (mode) {
    case 'inner': return simplifyPoly(inner.pts);
    case 'center': {
      // stroke width ~ 2*(A_out - A_in) / (P_out + P_in); center = basis inset by w/2
      const w = 2 * (basis.area - inner.area) / (perimeter(basis.pts) + perimeter(inner.pts));
      return offsetPoly(simplifyPoly(basis.pts), -w / 2);
    }
    default: return simplifyPoly(basis.pts);
  }
}

/**
 * Flange of object i clipped against forbidden zones: walls+interiors of
 * other objects and previously placed flanges. Zones are inflated by GAP so
 * a clipped flange boundary never coincides with a zone boundary
 * (coincidence -> degenerate geometry). The flange interior reaches to the
 * middle of the wall — a volumetric overlap instead of a coincident face,
 * so the slicer merges the two bodies and the mesh stays manifold.
 */
function clippedFlangeLoops(cut: Pt[], flangeOuter: Pt[], wall: number,
                            otherWalls: Pt[][], placed: Pt[][]): Pt[][] {
  const flangeInner = rdp(offsetPoly(cut, wall / 2), EPS);
  const subject = [ccw(flangeOuter), [...ccw(flangeInner)].reverse()]; // ring (hole CW)
  const forbidden = [...otherWalls.map(w => offsetPoly(w, GAP)), ...placed];
  return diffRegions(subject, forbidden)
    .map(l => rdp(dedup(l), EPS))
    .filter(l => l.length >= 3 && Math.abs(signedArea(l)) > 1); // drop slivers < 1 mm2
}

export function generate(raw: Contour[], p: Params): GenResult {
  if (!raw.length) throw new Error('No contours.');
  if (!(p.targetW > 0 && p.wall > 0 && p.height > 0)) throw new Error('Invalid parameters.');

  const contours = p.unionAll && raw.length > 1 ? unionContours(raw) : raw;
  const topIdx = topLevelObjects(contours);
  const allMode = p.allObjects && topIdx.length > 1;
  const selectedIdx = Math.min(Math.max(0, p.selectedIdx), contours.length - 1);
  const basisList = allMode ? topIdx : [selectedIdx];

  // cutting lines -> scale the whole set to the target width, center at origin
  let cuts = basisList.map(i => cuttingContourFor(contours, i, p.lineMode));
  const b0 = boundsAll(cuts);
  const s = p.targetW / b0.w;
  const xf = (pt: Pt): Pt => ({ x: (pt.x - (b0.minx + b0.maxx) / 2) * s, y: (pt.y - (b0.miny + b0.maxy) / 2) * s });
  cuts = cuts.map(c => rdp(c.map(xf), EPS));
  const displayContours = contours.map(c => c.pts.map(xf));

  const flangeT = p.flangeW > 0 ? Math.min(p.flangeT, p.height) : 0;

  // blade taper: the outer wall slopes from full thickness to `edge` over the
  // last `taperH` mm before the cutting edge; the wall loop is the edge loop
  // displaced outward so both share vertices and loft 1:1 (watertight)
  const edgeT = Math.min(p.edge, p.wall);
  const freeH = p.height - flangeT;
  const taperH = edgeT < p.wall - 1e-6 ? Math.max(0, Math.min(p.taperH, freeH)) : 0;
  const edgeOuters = cuts.map(c => {
    if (taperH <= 0) return ccw(dedup(rdp(offsetPoly(c, p.wall), EPS)));
    // round concave corners (morphological closing) with a radius safely above
    // the displacement, otherwise the displaced wall loop would self-cross there
    const closeR = 1.5 * (p.wall - edgeT);
    const closed = offsetPoly(offsetPoly(offsetPoly(c, edgeT), closeR), -closeR);
    return ccw(dedup(rdp(closed, EPS)));
  });
  const wallOuters = taperH > 0 ? edgeOuters.map(l => displace(l, p.wall - edgeT)) : edgeOuters;
  const flangeOuters = p.flangeW > 0 ? cuts.map(c => rdp(offsetPoly(c, p.wall + p.flangeW), EPS)) : null;

  const chunks: number[][] = [];
  let flangeLoops: Pt[][] | null = null;
  if (cuts.length === 1) {
    // single object: the whole cutter as one watertight body
    chunks.push(cutterPositions(cuts[0]!, wallOuters[0]!, edgeOuters[0]!,
      flangeOuters?.[0] ?? null, p.height, flangeT, p.flangeAt, taperH));
    flangeLoops = flangeOuters ? [flangeOuters[0]!] : null;
  } else {
    // multiple objects: wall without flange + neighbour-clipped flange as a separate prism
    flangeLoops = flangeOuters ? [] : null;
    const placed: Pt[][] = []; // flange regions already claimed
    cuts.forEach((c, i) => {
      chunks.push(cutterPositions(c, wallOuters[i]!, edgeOuters[i]!, null, p.height, 0, p.flangeAt, taperH));
      if (!flangeOuters) return;
      const otherWalls = wallOuters.filter((_, j) => j !== i);
      const loops = clippedFlangeLoops(c, flangeOuters[i]!, p.wall, otherWalls, placed);
      if (!loops.length) return;
      const [z1, z2] = p.flangeAt === 'bottom' ? [0, flangeT] : [p.height - flangeT, p.height];
      chunks.push(regionPrism(loops, z1, z2));
      placed.push(...loops.filter(l => signedArea(l) > 0).map(l => offsetPoly(l, GAP)));
      flangeLoops!.push(...loops);
    });
  }

  const positions = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { positions.set(c, off); off += c.length; }

  const hasInner = allMode
    ? topIdx.some(i => innerContourOf(contours, i) !== null)
    : contours.length >= 2 && innerContourOf(contours, selectedIdx) !== null;
  const bc = boundsAll(cuts);
  const bb = boundsAll(flangeOuters ?? wallOuters);

  return {
    positions, cuts, wallOuters, flangeOuters, flangeLoops, displayContours,
    contourCount: contours.length, topCount: topIdx.length, basisCount: basisList.length,
    allMode, hasInner, selectedIdx,
    cutSize: { w: bc.w, h: bc.h }, totalSize: { w: bb.w, h: bb.h },
  };
}
