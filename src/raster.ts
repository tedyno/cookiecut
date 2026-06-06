// raster vectorization (PNG/JPG): threshold -> binary grid -> marching
// squares -> closed contours; runs on the main thread (one-off, ~ms)
import type { Contour, Pt } from './types';
import { rdp, signedArea } from './geo2d';

export interface TraceOpts {
  threshold: number; // brightness threshold 1-254
  invert: boolean;   // true = light shapes on a dark background
  simplify: number;  // RDP tolerance in px — higher = straighter lines, less detail
  smooth: number;    // Chaikin smoothing iterations 0-3
}

// Chaikin corner cutting — turns pixel staircases into smooth curves
function chaikin(pts: Pt[], iters: number): Pt[] {
  for (let k = 0; k < iters; k++) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
      out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    pts = out;
  }
  return pts;
}

// marching squares table: case (tl<<3|tr<<2|br<<1|bl) -> segments from->to
// orientation is consistent so segments chain into closed loops
const TABLE: Record<number, [string, string][]> = {
  1: [['l', 'b']], 2: [['b', 'r']], 3: [['l', 'r']], 4: [['r', 't']],
  5: [['r', 't'], ['l', 'b']], 6: [['b', 't']], 7: [['l', 't']], 8: [['t', 'l']],
  9: [['t', 'b']], 10: [['t', 'l'], ['b', 'r']], 11: [['t', 'r']], 12: [['r', 'l']],
  13: [['r', 'b']], 14: [['b', 'l']],
};

export function traceImage(img: ImageData, opts: TraceOpts): Contour[] {
  const w = img.width, h = img.height, px = img.data;
  // binary grid with a 1px background padding so contours are always closed
  const W = w + 2, H = h + 2;
  const bin = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3]! / 255; // transparent pixels = background (white)
      const lum = (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) * a + 255 * (1 - a);
      const ink = opts.invert ? lum >= opts.threshold : lum < opts.threshold;
      if (ink) bin[(y + 1) * W + (x + 1)] = 1;
    }
  }

  // segments between cell-edge midpoints; key = the "from" edge (2x coords -> int)
  const key = (x2: number, y2: number) => y2 * 2 * W + x2;
  const edge = (cx: number, cy: number, e: string): number =>
    e === 't' ? key(2 * cx + 1, 2 * cy)
    : e === 'r' ? key(2 * cx + 2, 2 * cy + 1)
    : e === 'b' ? key(2 * cx + 1, 2 * cy + 2)
    : key(2 * cx, 2 * cy + 1);
  const segs = new Map<number, number>();
  for (let cy = 0; cy < H - 1; cy++) {
    for (let cx = 0; cx < W - 1; cx++) {
      const c = (bin[cy * W + cx]! << 3) | (bin[cy * W + cx + 1]! << 2)
              | (bin[(cy + 1) * W + cx + 1]! << 1) | bin[(cy + 1) * W + cx]!;
      const list = TABLE[c];
      if (!list) continue;
      for (const [f, t] of list) segs.set(edge(cx, cy, f), edge(cx, cy, t));
    }
  }

  // chain segments into closed loops
  const contours: Contour[] = [];
  const visited = new Set<number>();
  for (const start of segs.keys()) {
    if (visited.has(start)) continue;
    const loop: Pt[] = [];
    let cur = start;
    while (!visited.has(cur)) {
      visited.add(cur);
      const x2 = cur % (2 * W), y2 = (cur - x2) / (2 * W);
      loop.push({ x: x2 / 2 - 1, y: -(y2 / 2 - 1) }); // remove padding, flip Y
      const next = segs.get(cur);
      if (next === undefined) break;
      cur = next;
    }
    if (loop.length < 4) continue;
    let pts = rdp(loop, Math.max(0.3, opts.simplify)); // straighten pixel staircases
    pts = chaikin(pts, opts.smooth);
    const area = Math.abs(signedArea(pts));
    if (area > 16) contours.push({ pts, area }); // drop specks < ~4x4 px
  }
  if (!contours.length) throw new Error('No shapes found in the image — try adjusting the threshold.');
  const maxArea = Math.max(...contours.map(c => c.area));
  return contours.filter(c => c.area > maxArea * 0.005).sort((a, b) => b.area - a.area);
}
