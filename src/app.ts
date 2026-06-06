// application wiring: UI <-> worker <-> three.js; no geometry here
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { Contour, FlangeAt, GenResult, LineMode, Params } from './types';
import { extractContours } from './svg';
import { traceImage } from './raster';
import { createGenerator } from './worker-client';
import { createViewport } from './scene';
import { createDims } from './dims';
import { drawPreview, pickContour, type View2D } from './preview2d';

// ---------------------------------------------------------------------------
// UI elements
// ---------------------------------------------------------------------------

const els = {
  drop: document.getElementById('drop')!,
  file: document.getElementById('file') as HTMLInputElement,
  targetW: document.getElementById('targetW') as HTMLInputElement,
  wall: document.getElementById('wall') as HTMLInputElement,
  height: document.getElementById('height') as HTMLInputElement,
  flangeW: document.getElementById('flangeW') as HTMLInputElement,
  flangeT: document.getElementById('flangeT') as HTMLInputElement,
  flangeAt: document.getElementById('flangeAt') as HTMLSelectElement,
  unionAll: document.getElementById('unionAll') as HTMLInputElement,
  allObjects: document.getElementById('allObjects') as HTMLInputElement,
  preview2d: document.getElementById('preview2d') as HTMLCanvasElement,
  showDims: document.getElementById('showDims') as HTMLInputElement,
  rasterFs: document.getElementById('rasterFs') as HTMLFieldSetElement,
  threshold: document.getElementById('threshold') as HTMLInputElement,
  thresholdVal: document.getElementById('thresholdVal')!,
  invert: document.getElementById('invert') as HTMLInputElement,
  simplify: document.getElementById('simplify') as HTMLInputElement,
  simplifyVal: document.getElementById('simplifyVal')!,
  smooth: document.getElementById('smooth') as HTMLInputElement,
  info: document.getElementById('info')!,
  status: document.getElementById('status')!,
  download: document.getElementById('download') as HTMLButtonElement,
  hint3d: document.getElementById('hint3d')!,
};

function setStatus(msg: string, cls: '' | 'ok' | 'err' = ''): void {
  els.status.textContent = msg;
  els.status.className = cls;
}

function lineMode(): LineMode {
  return (document.querySelector('input[name=line]:checked') as HTMLInputElement).value as LineMode;
}

function readParams(): Params {
  return {
    targetW: +els.targetW.value,
    wall: +els.wall.value,
    height: +els.height.value,
    flangeW: +els.flangeW.value,
    flangeT: +els.flangeT.value,
    flangeAt: els.flangeAt.value as FlangeAt,
    lineMode: lineMode(),
    unionAll: els.unionAll.checked,
    allObjects: els.allObjects.checked,
    selectedIdx,
  };
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let rawContours: Contour[] = [];   // contours from the file (sorted largest first)
let rasterData: ImageData | null = null; // source raster for retracing
let selectedIdx = 0;               // base contour in single-object mode
let svgName = 'cutter';
let exportGeometry: THREE.BufferGeometry | null = null; // mm, z up — for STL
let lastResult: GenResult | null = null;
let view2d: View2D | null = null;
let refitOnNext = false;

// ---------------------------------------------------------------------------
// 3D scene + dimensions + worker
// ---------------------------------------------------------------------------

const viewport = createViewport(document.getElementById('viewport')!);
const dims = createDims();

const generator = createGenerator({
  onResult: applyResult,
  onError(message) {
    setStatus(message, 'err');
    els.download.disabled = true;
  },
});

function rebuild({ refit = false }: { refit?: boolean } = {}): void {
  if (!rawContours.length) return;
  refitOnNext = refit || refitOnNext;
  setStatus('Generating model…');
  generator.request(rawContours, readParams());
}

function applyResult(r: GenResult): void {
  lastResult = r;
  selectedIdx = r.selectedIdx;
  const p = readParams();

  exportGeometry = new THREE.BufferGeometry();
  exportGeometry.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  exportGeometry.computeVertexNormals();

  viewport.modelGroup.clear();
  viewport.modelGroup.add(new THREE.Mesh(exportGeometry, viewport.material));
  dims.update(r, p);
  dims.group.visible = els.showDims.checked;
  viewport.modelGroup.add(dims.group);
  els.hint3d.style.display = 'none';
  if (refitOnNext) { viewport.fitCamera(); refitOnNext = false; }

  view2d = drawPreview(els.preview2d, r, selectedIdx);
  updateControls(r);

  els.info.textContent =
    (r.allMode
      ? `Objects: ${r.basisCount} (contours: ${r.contourCount})`
      : `Contours: ${r.contourCount}` + (r.contourCount > 1 ? ` (selected #${selectedIdx + 1} — click the preview to change)` : '')) + '\n' +
    `${r.allMode ? 'Cutting lines extent' : 'Cookie (cutting line)'}: ${r.cutSize.w.toFixed(1)} × ${r.cutSize.h.toFixed(1)} mm\n` +
    `Overall size: ${r.totalSize.w.toFixed(1)} × ${r.totalSize.h.toFixed(1)} × ${p.height.toFixed(1)} mm\n` +
    `Triangles: ${r.positions.length / 9}`;
  els.download.disabled = false;
  setStatus('Model generated.', 'ok');
}

/** Center/inner only when the base contains something; "all objects" only with several objects */
function updateControls(r: GenResult): void {
  for (const value of ['center', 'inner']) {
    const input = document.querySelector(`input[name=line][value=${value}]`) as HTMLInputElement;
    input.disabled = !r.hasInner;
    input.closest('label')!.classList.toggle('disabled', !r.hasInner);
  }
  if (!r.hasInner) (document.querySelector('input[name=line][value=outer]') as HTMLInputElement).checked = true;
  els.allObjects.disabled = r.topCount < 2;
  els.allObjects.closest('label')!.classList.toggle('disabled', r.topCount < 2);
}

// ---------------------------------------------------------------------------
// file loading (SVG directly, PNG/JPG via vectorization)
// ---------------------------------------------------------------------------

function loadSvg(text: string, name: string): void {
  try {
    rawContours = extractContours(text);
    svgName = name.replace(/\.svg$/i, '') || 'cutter';
    selectedIdx = 0;
    els.allObjects.checked = true;
    rebuild({ refit: true });
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

function retrace(refit = false): void {
  if (!rasterData) return;
  try {
    rawContours = traceImage(rasterData, {
      threshold: +els.threshold.value,
      invert: els.invert.checked,
      simplify: +els.simplify.value,
      smooth: +els.smooth.value,
    });
    selectedIdx = 0;
    rebuild({ refit });
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : String(e), 'err');
  }
}

async function loadFile(f: File): Promise<void> {
  if (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml') {
    rasterData = null;
    els.rasterFs.style.display = 'none';
    loadSvg(await f.text(), f.name);
    return;
  }
  try {
    // downscale to max 1024 px — a cookie cutter needs no more detail
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    const cw = Math.max(1, Math.round(bmp.width * s)), ch = Math.max(1, Math.round(bmp.height * s));
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, cw, ch);
    rasterData = ctx.getImageData(0, 0, cw, ch);
    svgName = f.name.replace(/\.[a-z0-9]+$/i, '') || 'cutter';
    els.rasterFs.style.display = '';
    els.allObjects.checked = true;
    retrace(true);
  } catch (e) {
    console.error(e);
    setStatus('Failed to load the image.', 'err');
  }
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

// files: drop zone + picker
els.drop.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  const f = els.file.files?.[0];
  if (f) void loadFile(f);
});
for (const ev of ['dragover', 'dragleave', 'drop'] as const) {
  els.drop.addEventListener(ev, e => {
    e.preventDefault();
    els.drop.classList.toggle('over', ev === 'dragover');
    if (ev === 'drop') {
      const f = (e as DragEvent).dataTransfer?.files[0];
      if (f) void loadFile(f);
    }
  });
}

// parameters: debounced rebuild; focus highlights the matching dimension
const debounce = (fn: () => void, ms = 150) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};
const debouncedRebuild = debounce(() => rebuild());
for (const id of ['targetW', 'wall', 'height', 'flangeW', 'flangeT'] as const) {
  els[id].addEventListener('input', debouncedRebuild);
  els[id].addEventListener('focus', () => dims.emphasize(id));
  els[id].addEventListener('blur', () => dims.emphasize(null));
}
els.flangeAt.addEventListener('change', () => rebuild());
els.showDims.addEventListener('change', () => { dims.group.visible = els.showDims.checked; });
for (const radio of document.querySelectorAll('input[name=line]')) {
  radio.addEventListener('change', () => rebuild());
}
els.allObjects.addEventListener('change', () => rebuild());
els.unionAll.addEventListener('change', () => {
  selectedIdx = 0;
  rebuild();
});

// vectorization: threshold/simplification/smoothing changes retrace the image
const debouncedRetrace = debounce(() => retrace());
els.threshold.addEventListener('input', () => {
  els.thresholdVal.textContent = els.threshold.value;
  debouncedRetrace();
});
els.simplify.addEventListener('input', () => {
  els.simplifyVal.textContent = els.simplify.value;
  debouncedRetrace();
});
els.invert.addEventListener('change', () => retrace());
els.smooth.addEventListener('input', () => retrace());

// click in the 2D preview = select the base contour (disabled in "all objects" mode)
els.preview2d.addEventListener('click', e => {
  if (!view2d || !lastResult || lastResult.contourCount < 2 || lastResult.allMode) return;
  const rect = els.preview2d.getBoundingClientRect();
  const hit = pickContour(view2d, view2d.toMm(e.clientX - rect.left, e.clientY - rect.top));
  if (hit >= 0 && hit !== selectedIdx) {
    selectedIdx = hit;
    rebuild();
  }
});

// STL export (binary)
els.download.addEventListener('click', () => {
  if (!exportGeometry) return;
  const data = new STLExporter().parse(new THREE.Mesh(exportGeometry), { binary: true }) as DataView<ArrayBuffer>;
  const blob = new Blob([data], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${svgName}_cutter.stl`;
  a.click();
  URL.revokeObjectURL(a.href);
});
