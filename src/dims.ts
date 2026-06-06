// dimension annotations of edited parameters in the 3D preview: technical
// dimensions with extension lines and arrows; small dimensions get arrows
// outside and the text beside. Colors match the dots next to sidebar inputs.
import * as THREE from 'three';
import type { GenResult, Params, Pt } from './types';
import { boundsAll } from './geo2d';

export interface Dims {
  /** Group to add into modelGroup (mm, z up) */
  group: THREE.Group;
  /** Redraw dimensions from the generation result and current parameters */
  update(r: GenResult, p: Params): void;
  /** Highlight the dimension of the given parameter, fade others (null = all full) */
  emphasize(id: string | null): void;
}

const COLORS: Record<string, string> = {
  targetW: '#7aa2f7',
  wall: '#f7768e',
  height: '#bb9af7',
  flangeW: '#9ece6a',
  flangeT: '#e0af68',
};

const maxXPoint = (loops: Pt[][]): Pt => loops.flat().reduce((b, p) => (p.x > b.x ? p : b));
const minXPoint = (loops: Pt[][]): Pt => loops.flat().reduce((b, p) => (p.x < b.x ? p : b));
const minYPoint = (loops: Pt[][]): Pt => loops.flat().reduce((b, p) => (p.y < b.y ? p : b));

function makeLabel(text: string, color: string, height: number): THREE.Sprite {
  const cv = document.createElement('canvas');
  const font = 'bold 44px -apple-system, BlinkMacSystemFont, sans-serif';
  let ctx = cv.getContext('2d')!;
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + 24;
  cv.height = 64;
  ctx = cv.getContext('2d')!; // resizing resets the context state
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(height * cv.width / cv.height, height, 1);
  sprite.renderOrder = 11;
  return sprite;
}

export function createDims(): Dims {
  const group = new THREE.Group();
  const items: Record<string, THREE.Object3D[]> = {};

  function addDimension(id: string, p1: THREE.Vector3, p2: THREE.Vector3,
                        offsetDir: THREE.Vector3, offset: number,
                        label: string, textH: number): void {
    const color = COLORS[id]!;
    const dn = p2.clone().sub(p1).normalize();
    const len = p2.distanceTo(p1);
    const on = offsetDir.clone().normalize();
    const ext = textH * 0.35;                       // extension line overshoot
    const a = p1.clone().add(on.clone().multiplyScalar(offset));
    const b = p2.clone().add(on.clone().multiplyScalar(offset));
    const as = Math.min(textH * 0.55, len * 0.4);   // arrow size
    const small = len < as * 4.5;                   // arrows do not fit inside

    const pts: THREE.Vector3[] = [
      p1, p1.clone().add(on.clone().multiplyScalar(offset + ext)),  // extension lines
      p2, p2.clone().add(on.clone().multiplyScalar(offset + ext)),
      small ? a.clone().sub(dn.clone().multiplyScalar(as * 2.5)) : a, // dimension line
      small ? b.clone().add(dn.clone().multiplyScalar(as * 2.5)) : b,
    ];
    const wing = (tip: THREE.Vector3, dir: THREE.Vector3) => {
      const base = tip.clone().add(dir.clone().multiplyScalar(as));
      pts.push(tip, base.clone().add(on.clone().multiplyScalar(as * 0.35)));
      pts.push(tip, base.clone().sub(on.clone().multiplyScalar(as * 0.35)));
    };
    wing(a, small ? dn.clone().negate() : dn);      // arrows (outside for small dims)
    wing(b, small ? dn : dn.clone().negate());

    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    line.renderOrder = 10;
    group.add(line);

    const sprite = makeLabel(label, color, textH);
    if (small) {
      sprite.position.copy(b.clone().add(dn.clone().multiplyScalar(as * 3.2)));
      sprite.center.set(0, 0.5);                    // text after the extended line
    } else {
      sprite.position.copy(a.clone().add(b).multiplyScalar(0.5).add(on.clone().multiplyScalar(textH * 0.8)));
    }
    group.add(sprite);
    (items[id] ??= []).push(line, sprite);
  }

  function update(r: GenResult, p: Params): void {
    group.clear();
    for (const k of Object.keys(items)) delete items[k];

    const bb = boundsAll([...(r.flangeLoops ?? []), ...r.wallOuters]);
    const cutBB = boundsAll(r.cuts);
    const H = p.height;
    const T = Math.min(p.flangeT, H);
    const [zf1, zf2] = p.flangeAt === 'bottom' ? [0, T] : [H - T, H];

    const maxDim = Math.max(bb.w, bb.h, H);
    const off = Math.max(4, maxDim * 0.08);
    const textH = Math.max(3.5, maxDim * 0.06);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // cookie width — dimension across the cutting line, front on the plate
    addDimension('targetW',
      v(cutBB.minx, bb.miny, 0), v(cutBB.maxx, bb.miny, 0), v(0, -1, 0), off,
      `width ${cutBB.w.toFixed(1)} mm`, textH);

    // wall height — vertical dimension on the left side (flange dims are on the right)
    const pwl = minXPoint(r.wallOuters);
    addDimension('height',
      v(pwl.x, pwl.y, 0), v(pwl.x, pwl.y, H), v(-1, 0, 0), pwl.x - bb.minx + off * 1.8,
      `wall height ${H.toFixed(1)} mm`, textH);

    // wall thickness — dimension across the blade at the top edge (arrows outside)
    const pc = maxXPoint(r.cuts);
    addDimension('wall',
      v(pc.x, pc.y, H), v(pc.x + p.wall, pc.y, H), v(0, 0, 1), off * 0.7,
      `wall ${p.wall.toFixed(1)} mm`, textH);

    if (r.flangeLoops?.length && p.flangeW > 0) {
      // flange overhang — dimension on the flange top face, wall to edge
      const pf = maxXPoint(r.flangeLoops);
      addDimension('flangeW',
        v(pf.x - p.flangeW, pf.y, zf2), v(pf.x, pf.y, zf2), v(0, 0, 1), off * 0.6,
        `flange overhang ${p.flangeW.toFixed(1)} mm`, textH);
      // flange thickness — vertical dimension on the flange front edge
      const pff = minYPoint(r.flangeLoops);
      addDimension('flangeT',
        v(pff.x, pff.y, zf1), v(pff.x, pff.y, zf2), v(0, -1, 0), off * 0.5,
        `flange ${T.toFixed(1)} mm`, textH);
    }
  }

  function emphasize(id: string | null): void {
    for (const [key, objs] of Object.entries(items)) {
      const opacity = id === null || key === id ? 1 : 0.12;
      for (const o of objs) {
        ((o as THREE.Mesh).material as THREE.Material).opacity = opacity;
      }
    }
  }

  return { group, update, emphasize };
}
