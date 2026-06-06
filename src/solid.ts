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

/** Watertight prism over a region of loops in clipper orientation */
export function regionPrism(loops: Pt[][], z1: number, z2: number): number[] {
  const pos: number[] = [];
  for (const loop of loops) append(pos, strip(loop, z1, z2, true));
  append(pos, capAll(loops, z1, false)); // bottom
  append(pos, capAll(loops, z2, true));  // top
  return pos;
}

/**
 * Shell of a single cutter: inner (cutting) wall, bottom, outer wall,
 * flange step, flange side, top. One watertight body.
 * flangeOuter=null or T=0 -> wall only, no flange.
 */
export function cutterPositions(cutIn: Pt[], wallOuterIn: Pt[], flangeOuterIn: Pt[] | null,
                                H: number, T: number, flangeAt: FlangeAt): number[] {
  const cut = ccw(dedup(cutIn));
  const wallOuter = ccw(dedup(wallOuterIn));
  const flangeOuter = flangeOuterIn && T > 0 ? ccw(dedup(flangeOuterIn)) : null;

  const pos: number[] = [];
  append(pos, strip(cut, 0, H, false));                            // inner (cutting) wall
  if (flangeOuter && flangeAt === 'bottom') {
    const z1 = Math.min(H, T);                                     // flange top
    append(pos, annulus(flangeOuter, cut, 0, false));              // bottom
    append(pos, strip(flangeOuter, 0, z1, true));                  // flange side
    if (z1 < H) {
      append(pos, annulus(flangeOuter, wallOuter, z1, true));      // step above the flange
      append(pos, strip(wallOuter, z1, H, true));                  // outer wall above the flange
    }
    append(pos, annulus(z1 < H ? wallOuter : flangeOuter, cut, H, true)); // top
  } else if (flangeOuter) {
    const z1 = Math.max(0, H - T);                                 // flange bottom
    append(pos, annulus(z1 > 0 ? wallOuter : flangeOuter, cut, 0, false)); // bottom
    if (z1 > 0) {
      append(pos, strip(wallOuter, 0, z1, true));                  // outer wall below the flange
      append(pos, annulus(flangeOuter, wallOuter, z1, false));     // step below the flange
    }
    append(pos, strip(flangeOuter, z1, H, true));                  // flange side
    append(pos, annulus(flangeOuter, cut, H, true));               // top
  } else {
    append(pos, annulus(wallOuter, cut, 0, false));                // bottom
    append(pos, strip(wallOuter, 0, H, true));                     // outer wall
    append(pos, annulus(wallOuter, cut, H, true));                 // top
  }
  return pos;
}
