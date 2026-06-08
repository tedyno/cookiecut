// mesh helpers for the blade taper — the one solid Manifold cannot make
// directly (extrude only scales cross-sections, it cannot offset them)
import type { Pt } from './types';

/**
 * Displace a CCW loop outward along vertex normals (mitered, capped).
 * Keeps the vertex count, so the result pairs 1:1 with the source loop —
 * exact enough for sub-millimetre blade tapers. Concave corners must be
 * pre-rounded (morphological closing) or the result self-crosses.
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

/** Outward skirt of the chamfer wedge — keeps its faces clear of the wall */
export const WEDGE_SKIRT = 0.5;

export interface WedgeMesh {
  numProp: 3;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}

/**
 * The chamfer wedge subtracted from the cutter to create the blade taper:
 * the volume between the sloped face (wall loop at the apex level ->
 * edge loop at the cutting edge) and an outer skirt. All loops share the
 * vertex count (displace), so the whole wedge is plain quads — apex ring A,
 * inner edge ring B, outer ring C. C sits OUTSIDE the wall (the extra
 * subtracted volume is air) so the wedge faces never coincide with the
 * wall surface — coincident faces make exact booleans emit degenerate
 * zero-area triangles.
 */
export function wedgeMesh(wallLoop: Pt[], edgeLoop: Pt[], H: number, taperH: number,
                          flangeAt: 'bottom' | 'top'): WedgeMesh {
  const n = wallLoop.length;
  if (edgeLoop.length !== n) throw new Error('Taper loops must share the vertex count.');
  const bottom = flangeAt === 'bottom'; // flange bottom -> cutting edge on top
  const zApex = bottom ? H - taperH : taperH;
  const zEdge = bottom ? H : 0;
  const outer = displace(wallLoop, WEDGE_SKIRT); // skirt clear of the wall surface

  const vp = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    vp[i * 3] = wallLoop[i]!.x; vp[i * 3 + 1] = wallLoop[i]!.y; vp[i * 3 + 2] = zApex;          // A
    vp[(n + i) * 3] = edgeLoop[i]!.x; vp[(n + i) * 3 + 1] = edgeLoop[i]!.y; vp[(n + i) * 3 + 2] = zEdge; // B
    vp[(2 * n + i) * 3] = outer[i]!.x; vp[(2 * n + i) * 3 + 1] = outer[i]!.y; vp[(2 * n + i) * 3 + 2] = zEdge; // C
  }

  const tv = new Uint32Array(n * 18);
  let k = 0;
  const tri = (a: number, b: number, c: number) => {
    // mirror the winding when the cutting edge is below the apex
    if (bottom) { tv[k++] = a; tv[k++] = b; tv[k++] = c; }
    else { tv[k++] = a; tv[k++] = c; tv[k++] = b; }
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = i, aj = j, bi = n + i, bj = n + j, ci = 2 * n + i, cj = 2 * n + j;
    tri(ai, bj, aj); tri(ai, bi, bj); // sloped face, normals toward the cut
    tri(ai, aj, cj); tri(ai, cj, ci); // vertical outer face, normals out
    tri(bi, ci, cj); tri(bi, cj, bj); // edge-level ring, normals away from the solid
  }
  return { numProp: 3, vertProperties: vp, triVerts: tv };
}
