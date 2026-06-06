// wrapper over clipper-lib: offsets, booleans and stroke expansion on Pt[]
// (clipper works with ints -> coordinates are scaled 1 mm = 1000 units)
import ClipperLib from 'clipper-lib';
import type { Contour, Pt } from './types';
import { signedArea } from './geo2d';

const CLIP_SCALE = 1000;

type ClipPath = { X: number; Y: number }[];

const toClip = (pts: Pt[]): ClipPath =>
  pts.map(p => ({ X: Math.round(p.x * CLIP_SCALE), Y: Math.round(p.y * CLIP_SCALE) }));
const fromClip = (path: ClipPath): Pt[] =>
  path.map(p => ({ x: p.X / CLIP_SCALE, y: p.Y / CLIP_SCALE }));

const largest = (paths: ClipPath[]): ClipPath =>
  paths.reduce((a, b) => Math.abs(ClipperLib.Clipper.Area(a)) > Math.abs(ClipperLib.Clipper.Area(b)) ? a : b);

/** Fix self-intersections (~ shapely buffer(0)); returns the largest polygon */
export function simplifyPoly(pts: Pt[]): Pt[] {
  const sol: ClipPath[] = ClipperLib.Clipper.SimplifyPolygon(toClip(pts), ClipperLib.PolyFillType.pftNonZero);
  if (!sol.length) throw new Error('Failed to process the outline (degenerate geometry).');
  return fromClip(largest(sol));
}

/** Polygon offset by delta mm (positive = outward), round joins; returns the largest result */
export function offsetPoly(pts: Pt[], delta: number): Pt[] {
  const co = new ClipperLib.ClipperOffset(2, 0.02 * CLIP_SCALE);
  co.AddPath(toClip(pts), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, delta * CLIP_SCALE);
  if (!sol.length) throw new Error(`Offset of ${delta} mm failed — check the outline and parameters.`);
  return fromClip(largest(sol));
}

/**
 * Stroke expansion: turns a line (stroke) into a filled outline of the given
 * width. A closed line yields outer + inner contours, an open one a capsule.
 */
export function expandStroke(pts: Pt[], width: number, closed: boolean): Pt[][] {
  const co = new ClipperLib.ClipperOffset(2, 0.02 * CLIP_SCALE);
  co.AddPath(toClip(pts), ClipperLib.JoinType.jtRound,
    closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, (width / 2) * CLIP_SCALE);
  return sol.map(fromClip);
}

/** Union of all contours (pftNonZero) -> outlines of the merged shape incl. holes */
export function unionContours(cs: Contour[]): Contour[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(cs.map(k => toClip(k.pts)), ClipperLib.PolyType.ptSubject, true);
  const sol = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  if (!sol.length) throw new Error('Union of contours failed.');
  return sol
    .map((p: ClipPath) => { const pts = fromClip(p); return { pts, area: Math.abs(signedArea(pts)) }; })
    .sort((a: Contour, b: Contour) => b.area - a.area);
}

/**
 * Region difference: subject (oriented loops, holes CW) minus clips.
 * The output is cleaned (SimplifyPolygons + CleanPolygons) — raw boolean
 * loops contain micro-slivers that break triangulation.
 * Returns loops in clipper orientation (outer CCW, holes CW).
 */
export function diffRegions(subject: Pt[][], clips: Pt[][]): Pt[][] {
  if (!clips.length) return subject;
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject.map(toClip), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clips.map(toClip), ClipperLib.PolyType.ptClip, true);
  let sol = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctDifference, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  sol = ClipperLib.Clipper.SimplifyPolygons(sol, ClipperLib.PolyFillType.pftNonZero) || sol;
  sol = ClipperLib.Clipper.CleanPolygons(sol, 0.01 * CLIP_SCALE) || sol;
  return sol.map(fromClip).filter((l: Pt[]) => l.length >= 3);
}
