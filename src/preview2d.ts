// 2D contour preview on a canvas: contours grey, cutting lines blue, walls
// red, clipped flanges green; returns the transform for click handling
import type { GenResult, Pt } from './types';
import { boundsAll, pointInPoly, signedArea } from './geo2d';

export interface View2D {
  contours: Pt[][];
  toMm(px: number, py: number): Pt;
}

export function drawPreview(canvas: HTMLCanvasElement, r: GenResult, selectedIdx: number): View2D {
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);
  const W = canvas.clientWidth, H = canvas.clientHeight, PAD = 12;
  ctx.clearRect(0, 0, W, H);

  // fit everything that gets drawn (flanges and other contours)
  const bb = boundsAll([...(r.flangeOuters || r.wallOuters), ...r.displayContours]);
  const s = Math.min((W - 2 * PAD) / bb.w, (H - 2 * PAD) / bb.h);
  const ox = PAD + (W - 2 * PAD - bb.w * s) / 2;
  const oy = H - PAD - (H - 2 * PAD - bb.h * s) / 2;
  const tx = (x: number) => ox + (x - bb.minx) * s;
  const ty = (y: number) => oy - (y - bb.miny) * s; // y up

  const trace = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(tx(p.x), ty(p.y)) : ctx.moveTo(tx(p.x), ty(p.y)));
    ctx.closePath();
  };

  // other contours grey (in single-object mode all except the selected one)
  ctx.strokeStyle = '#565f89'; ctx.lineWidth = 1; ctx.setLineDash([]);
  r.displayContours.forEach((pts, i) => {
    if (!r.allMode && i === selectedIdx) return;
    trace(pts);
    ctx.stroke();
  });

  r.cuts.forEach((cut, i) => {
    trace(cut);
    ctx.fillStyle = 'rgba(122,162,247,.18)';
    ctx.fill();
    ctx.strokeStyle = '#7aa2f7'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.stroke();

    trace(r.wallOuters[i]!);
    ctx.strokeStyle = '#f7768e'; ctx.lineWidth = 1;
    ctx.stroke();
  });

  // actual (neighbour-clipped) flange outlines
  if (r.flangeLoops) {
    ctx.strokeStyle = '#9ece6a'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    for (const loop of r.flangeLoops) {
      trace(loop);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  return {
    contours: r.displayContours,
    toMm: (px, py) => ({ x: (px - ox) / s + bb.minx, y: (oy - py) / s + bb.miny }),
  };
}

/** Smallest contour containing the point (clicking a hole selects the hole); -1 = none */
export function pickContour(view: View2D, pt: Pt): number {
  let hit = -1;
  view.contours.forEach((pts, i) => {
    if (pointInPoly(pt, pts) &&
        (hit < 0 || Math.abs(signedArea(pts)) < Math.abs(signedArea(view.contours[hit]!)))) hit = i;
  });
  return hit;
}
