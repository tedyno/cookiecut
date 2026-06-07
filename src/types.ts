// shared types — no code, just contracts between modules and the worker

export interface Pt { x: number; y: number }

/** Closed contour from SVG/raster; area is absolute (orientation is resolved at build time) */
export interface Contour { pts: Pt[]; area: number }

export interface Box { minx: number; miny: number; maxx: number; maxy: number; w: number; h: number }

export type LineMode = 'outer' | 'center' | 'inner';
export type FlangeAt = 'bottom' | 'top';

/** Generation input — values from the UI, sent to the worker */
export interface Params {
  targetW: number;   // target width of the cutting line / whole set [mm]
  wall: number;      // wall (blade) thickness [mm]
  height: number;    // wall height [mm]
  flangeW: number;   // flange overhang [mm], 0 = no flange
  flangeT: number;   // flange thickness [mm]
  flangeAt: FlangeAt;
  edge: number;      // blade edge thickness [mm]; >= wall disables the taper
  taperH: number;    // taper zone height below the cutting edge [mm]
  lineMode: LineMode;
  unionAll: boolean;   // merge all paths before selection
  allObjects: boolean; // a cutter for every standalone object
  selectedIdx: number; // base contour in single-object mode
}

/** Generation output — triangles for STL/preview + data for the UI */
export interface GenResult {
  positions: Float32Array;     // triangle soup (xyz by 9), mm, z up
  cuts: Pt[][];                // cutting lines (after scaling to mm)
  wallOuters: Pt[][];          // outer wall outlines
  flangeOuters: Pt[][] | null; // unclipped flange outlines (for bounds)
  flangeLoops: Pt[][] | null;  // actual (clipped) flange loops for the 2D preview
  displayContours: Pt[][];     // all contours in mm (preview, clicking)
  contourCount: number;
  topCount: number;            // number of standalone objects
  basisCount: number;          // number of generated cutters
  allMode: boolean;
  hasInner: boolean;           // base has an inner contour -> enable center/inner
  selectedIdx: number;         // clamped selection
  cutSize: { w: number; h: number };
  totalSize: { w: number; h: number };
}
