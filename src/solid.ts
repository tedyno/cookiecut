// watertight cookie-cutter solid construction as a triangle soup (xyz by 9)
//
// The shell is assembled by hand from vertical strips and horizontal caps —
// no 3D booleans. Caps are triangulated with constrained Delaunay (cdt2d):
// it guarantees boundary edges survive triangulation so caps line up with
// the strips exactly. (earcut/THREE.ShapeUtils does not guarantee this and
// the mesh ends up leaky.)
import cdt2d from 'cdt2d';
import type { FlangeAt, Pt } from './types';
import { ccw, dedup } from './geo2d';

/** Append an array without spreading — large arrays would overflow the call stack */
export function append(dst: number[], src: number[]): void {
  for (let i = 0; i < src.length; i++) dst.push(src[i]!);
}

/**
 * Vertical strip between z1 and z2 along a contour; outward = normal out.
 * For loops in clipper orientation (outer CCW, holes CW) the same formula
 * points CW hole normals into the hole, i.e. out of the solid — so
 * outward=true is always sufficient.
 */
function strip(contour: Pt[], z1: number, z2: number, outward: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i]!, q = contour[(i + 1) % contour.length]!;
    if (outward) {
      out.push(p.x, p.y, z1, q.x, q.y, z1, q.x, q.y, z2,
               p.x, p.y, z1, q.x, q.y, z2, p.x, p.y, z2);
    } else {
      out.push(p.x, p.y, z1, q.x, q.y, z2, q.x, q.y, z1,
               p.x, p.y, z1, p.x, p.y, z2, q.x, q.y, z2);
    }
  }
  return out;
}

/** Horizontal cap of a region made of arbitrary loops (incl. holes) at height z; up = +z normal */
function capAll(loops: Pt[][], z: number, up: boolean): number[] {
  const ptsAll: Pt[] = [];
  const edges: [number, number][] = [];
  for (const loop of loops) {
    const base = ptsAll.length;
    for (let i = 0; i < loop.length; i++) {
      ptsAll.push(loop[i]!);
      edges.push([base + i, base + (i + 1) % loop.length]);
    }
  }
  const tris = cdt2d(ptsAll.map(p => [p.x, p.y]), edges, { exterior: false, delaunay: false });
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    const A = ptsAll[a]!, B = ptsAll[b]!, C = ptsAll[c]!;
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (up ? cross < 0 : cross > 0) out.push(A.x, A.y, z, C.x, C.y, z, B.x, B.y, z);
    else out.push(A.x, A.y, z, B.x, B.y, z, C.x, C.y, z);
  }
  return out;
}

/** Annular cap outer/hole — a special case of capAll */
const annulus = (outer: Pt[], hole: Pt[], z: number, up: boolean): number[] =>
  capAll([outer, hole], z, up);

/**
 * Displace a CCW loop outward along vertex normals (mitered, capped).
 * Keeps the vertex count, so the result lofts 1:1 against the source —
 * exact enough for sub-millimetre blade tapers.
 */
export function displace(loop: Pt[], d: number): Pt[] {
  const n = loop.length;
  return loop.map((p, i) => {
    const prev = loop[(i - 1 + n) % n]!, next = loop[(i + 1) % n]!;
    const l1 = Math.hypot(p.x - prev.x, p.y - prev.y) || 1e-12;
    const l2 = Math.hypot(next.x - p.x, next.y - p.y) || 1e-12;
    // outward edge normals for a CCW loop
    const n1 = { x: (p.y - prev.y) / l1, y: -(p.x - prev.x) / l1 };
    const n2 = { x: (next.y - p.y) / l2, y: -(next.x - p.x) / l2 };
    let bx = n1.x + n2.x, by = n1.y + n2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) { bx = n1.x; by = n1.y; } else { bx /= bl; by /= bl; }
    // miter so the offset distance holds at corners, capped at 2.5x
    const s = d / Math.max(0.4, bx * n1.x + by * n1.y);
    return { x: p.x + bx * s, y: p.y + by * s };
  });
}

/** Sloped band between two loops with IDENTICAL vertex counts; outward normal */
function loft(a: Pt[], z1: number, b: Pt[], z2: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!, q = a[(i + 1) % a.length]!;
    const P = b[i]!, Q = b[(i + 1) % b.length]!;
    out.push(p.x, p.y, z1, q.x, q.y, z1, Q.x, Q.y, z2,
             p.x, p.y, z1, Q.x, Q.y, z2, P.x, P.y, z2);
  }
  return out;
}

/** Watertight prism over a region of loops in clipper orientation */
export function regionPrism(loops: Pt[][], z1: number, z2: number): number[] {
  const pos: number[] = [];
  for (const loop of loops) append(pos, strip(loop, z1, z2, true));
  append(pos, capAll(loops, z1, false)); // bottom
  append(pos, capAll(loops, z2, true));  // top
  return pos;
}

/**
 * Shell of a single cutter: inner (cutting) wall, bottom, outer wall with an
 * optional blade taper, flange step, flange side, top. One watertight body.
 *
 * The outer wall is full `wall` thickness up to the taper zone, then slopes
 * to `edgeOuter` at the cutting edge (the end away from the flange). The
 * inner wall stays vertical so the cut keeps its exact size.
 * `wallOuter` and `edgeOuter` must be pre-prepared (CCW, deduped) and share
 * the vertex count (edgeOuter displaced -> wallOuter); pass the same loop and
 * taperH=0 for a straight blade. flangeOuter=null or T=0 -> no flange.
 */
export function cutterPositions(cutIn: Pt[], wallOuter: Pt[], edgeOuter: Pt[],
                                flangeOuterIn: Pt[] | null,
                                H: number, T: number, flangeAt: FlangeAt,
                                taperH: number): number[] {
  const cut = ccw(dedup(cutIn));
  const flangeOuter = flangeOuterIn && T > 0 ? ccw(dedup(flangeOuterIn)) : null;
  const tapered = taperH > 1e-6;

  const pos: number[] = [];
  append(pos, strip(cut, 0, H, false));                            // inner (cutting) wall
  if (flangeAt === 'bottom') {
    // cutting edge at the top
    const z1 = flangeOuter ? Math.min(H, T) : 0;                   // flange top
    const zt = Math.max(z1, H - taperH);                           // taper start
    append(pos, annulus(flangeOuter ?? wallOuter, cut, 0, false)); // bottom
    if (flangeOuter) {
      append(pos, strip(flangeOuter, 0, z1, true));                // flange side
      if (z1 < H) append(pos, annulus(flangeOuter, wallOuter, z1, true)); // step above the flange
    }
    if (zt > z1 + 1e-6) append(pos, strip(wallOuter, z1, zt, true)); // straight outer wall
    if (tapered) append(pos, loft(wallOuter, zt, edgeOuter, H));   // blade taper
    append(pos, annulus(tapered ? edgeOuter : (z1 < H ? wallOuter : flangeOuter!), cut, H, true)); // top
  } else {
    // cutting edge at the bottom
    const z1 = flangeOuter ? Math.max(0, H - T) : H;               // flange bottom
    const zt = Math.min(z1, taperH);                               // taper end
    append(pos, annulus(tapered ? edgeOuter : (z1 > 0 ? wallOuter : flangeOuter!), cut, 0, false)); // bottom
    if (tapered) append(pos, loft(edgeOuter, 0, wallOuter, zt));   // blade taper
    if (z1 > zt + 1e-6) append(pos, strip(wallOuter, zt, z1, true)); // straight outer wall
    if (flangeOuter) {
      if (z1 > 0) append(pos, annulus(flangeOuter, wallOuter, z1, false)); // step below the flange
      append(pos, strip(flangeOuter, z1, H, true));                // flange side
      append(pos, annulus(flangeOuter, cut, H, true));             // top
    } else {
      append(pos, annulus(wallOuter, cut, H, true));               // top
    }
  }
  return pos;
}
