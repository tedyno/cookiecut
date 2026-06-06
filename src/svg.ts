// SVG parsing: shapes -> sampled contours (needs the DOM, runs on the main thread)
import type { Contour, Pt } from './types';
import { signedArea } from './geo2d';
import { expandStroke } from './clipper2d';

// converts a d attribute to absolute commands so subpaths can be split safely
function absolutizePath(d: string): string {
  const tok = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  const out: string[] = [];
  const num = () => parseFloat(tok[i++]!);
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i]!)) {
      cmd = tok[i++]!;
    } else if (cmd === 'M') cmd = 'L';   // implicit repeat after M is lineto
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; sx = x; sy = y; out.push(`M ${x} ${y}`); break; }
      case 'L': { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; out.push(`L ${x} ${y}`); break; }
      case 'H': { let x = num(); if (rel) x += cx; cx = x; out.push(`L ${x} ${cy}`); break; }
      case 'V': { let y = num(); if (rel) y += cy; cy = y; out.push(`L ${cx} ${y}`); break; }
      case 'C': { let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num(); if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; } cx = x; cy = y; out.push(`C ${x1} ${y1} ${x2} ${y2} ${x} ${y}`); break; }
      case 'S': { let x2 = num(), y2 = num(), x = num(), y = num(); if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; } cx = x; cy = y; out.push(`S ${x2} ${y2} ${x} ${y}`); break; }
      case 'Q': { let x1 = num(), y1 = num(), x = num(), y = num(); if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; } cx = x; cy = y; out.push(`Q ${x1} ${y1} ${x} ${y}`); break; }
      case 'T': { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; out.push(`T ${x} ${y}`); break; }
      case 'A': { const rx = num(), ry = num(), rot = num(), laf = num(), sf = num(); let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; out.push(`A ${rx} ${ry} ${rot} ${laf} ${sf} ${x} ${y}`); break; }
      case 'Z': { cx = sx; cy = sy; out.push('Z'); break; }
      default: i++; // skip unknown token
    }
  }
  return out.join(' ');
}

interface SampledSub {
  el: SVGGeometryElement;
  len: number;
  ctm: DOMMatrix | null;
  closed: boolean;
  strokeW: number; // 0 = filled shape, >0 = stroke to expand
}

// Loads SVG text and returns contours sorted by area, largest first.
// Filled shapes are sampled as polygons; stroke-only shapes (fill="none")
// are expanded to outlines of the stroke width.
export function extractContours(svgText: string): Contour[] {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('The file is not valid SVG.');
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(host);
  try {
    const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
    host.appendChild(svg);

    const shapeEls = [...svg.querySelectorAll<SVGGeometryElement>('path, rect, circle, ellipse, polygon, polyline')];
    if (!shapeEls.length) throw new Error('The SVG contains no shapes (path, rect, circle, …).');

    // collect contours of all shapes incl. their CTM; split paths into subpaths
    const subs: SampledSub[] = [];
    for (const el of shapeEls) {
      const ctm = el.getCTM();
      const style = getComputedStyle(el);
      const stroked = style.fill === 'none' && style.stroke !== 'none' && style.stroke !== '';
      // stroke width transforms together with the shape -> average CTM scale
      const ctmScale = ctm ? Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) : 1;
      const strokeW = stroked ? (parseFloat(style.strokeWidth) || 1) * ctmScale : 0;

      if (el.tagName === 'path') {
        for (const dSub of (absolutizePath(el.getAttribute('d') || '').match(/M[^M]*/g) || [])) {
          const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          tmp.setAttribute('d', dSub);
          svg.appendChild(tmp);
          const len = tmp.getTotalLength();
          if (len > 0) subs.push({ el: tmp, len, ctm, closed: /Z/i.test(dSub), strokeW });
        }
      } else {
        const len = el.getTotalLength();
        const closed = el.tagName !== 'polyline';
        if (len > 0) subs.push({ el, len, ctm, closed, strokeW });
      }
    }
    if (!subs.length) throw new Error('No usable outlines found in the shapes.');

    const maxLen = Math.max(...subs.map(s => s.len));
    const contours: Contour[] = [];
    for (const { el, len, ctm, closed, strokeW } of subs) {
      const n = Math.max(96, Math.min(1600, Math.round(1200 * len / maxLen)));
      const pts: Pt[] = [];
      const open = strokeW > 0 && !closed;
      const count = open ? n + 1 : n; // sample an open line including its end
      for (let k = 0; k < count; k++) {
        const p = el.getPointAtLength(len * Math.min(k / n, 1));
        let x = p.x, y = p.y;
        if (ctm) { x = ctm.a * p.x + ctm.c * p.y + ctm.e; y = ctm.b * p.x + ctm.d * p.y + ctm.f; }
        pts.push({ x, y: -y }); // SVG has Y down -> flip
      }
      if (strokeW > 0) {
        // stroke -> filled outline; a closed line yields outer + inner contours
        for (const poly of expandStroke(pts, strokeW, closed)) {
          const area = Math.abs(signedArea(poly));
          if (area > 1e-6) contours.push({ pts: poly, area });
        }
      } else {
        const area = Math.abs(signedArea(pts));
        if (area > 1e-6) contours.push({ pts, area });
      }
    }
    if (!contours.length) throw new Error('No usable outlines found in the shapes.');
    // drop crumbs (< 0.5 % of the largest area) and sort largest first
    const maxArea = Math.max(...contours.map(c => c.area));
    return contours.filter(c => c.area > maxArea * 0.005).sort((a, b) => b.area - a.area);
  } finally {
    host.remove();
  }
}
