// pure 2D polyline geometry — no dependencies, runs anywhere
import type { Box, Pt } from './types';

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function perimeter(pts: Pt[]): number {
  let l = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    l += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return l;
}

export function bounds(pts: Pt[]): Box {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
}

/** Combined bounding box of several contours */
export function boundsAll(contourList: Pt[][]): Box {
  const b = contourList.map(bounds).reduce((a, c) => ({
    minx: Math.min(a.minx, c.minx), miny: Math.min(a.miny, c.miny),
    maxx: Math.max(a.maxx, c.maxx), maxy: Math.max(a.maxy, c.maxy),
  } as Box));
  return { ...b, w: b.maxx - b.minx, h: b.maxy - b.miny };
}

export function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > pt.y) !== (b.y > pt.y) &&
        pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ensure CCW orientation (positive area) */
export const ccw = (pts: Pt[]): Pt[] => signedArea(pts) < 0 ? [...pts].reverse() : pts;

/** Remove consecutive duplicate points (incl. first/last duplicate) */
export function dedup(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p.x - last.x) > 1e-9 || Math.abs(p.y - last.y) > 1e-9) out.push(p);
  }
  const f = out[0]!, l = out[out.length - 1]!;
  if (out.length > 1 && Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop();
  return out;
}

/**
 * Douglas-Peucker simplification of a closed contour (eps in point units).
 * Besides the first point we also pin the point farthest from it so the
 * closed curve cannot collapse into a segment.
 */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 8) return pts;
  const closed = [...pts, pts[0]!];
  const keep = new Uint8Array(closed.length);
  keep[0] = keep[closed.length - 1] = 1;
  let far = 1, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i]!.x - pts[0]!.x) ** 2 + (pts[i]!.y - pts[0]!.y) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, closed.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const A = closed[a]!, B = closed[b]!;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1e-12;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = closed[i]!;
      const d = Math.abs(dx * (A.y - P.y) - (A.x - P.x) * dy) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out: Pt[] = [];
  for (let i = 0; i < closed.length - 1; i++) if (keep[i]) out.push(closed[i]!);
  return out.length >= 3 ? out : pts;
}
