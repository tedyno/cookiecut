// stroke expansion via clipper-lib — the one 2D op Manifold's CrossSection
// cannot do (it only handles closed polygons, not open-path offsets);
// used by the SVG extractor on the main thread
import ClipperLib from 'clipper-lib';
import type { Pt } from './types';

const CLIP_SCALE = 1000; // clipper works with ints -> 1 mm = 1000 units

type ClipPath = { X: number; Y: number }[];

const toClip = (pts: Pt[]): ClipPath =>
  pts.map(p => ({ X: Math.round(p.x * CLIP_SCALE), Y: Math.round(p.y * CLIP_SCALE) }));
const fromClip = (path: ClipPath): Pt[] =>
  path.map(p => ({ x: p.X / CLIP_SCALE, y: p.Y / CLIP_SCALE }));

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
