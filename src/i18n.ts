// tiny client-only i18n: a flat dictionary keyed by string id, Czech + English.
// Static markup is translated via [data-i18n] attributes; dynamic strings
// (status / info / dimension labels) go through t(). Language is persisted in
// localStorage and applied on load.
export type Lang = 'cs' | 'en';

type Dict = Record<string, string>;

const EN: Dict = {
  'app.subtitle': '— cookie cutter generator',
  'drop.title': 'Drop SVG / PNG / JPG here',
  'drop.sub': 'or click to choose · or paste (⌘V)',

  'raster.legend': 'Image vectorization',
  'raster.threshold': 'Brightness threshold',
  'raster.invert': 'invert (light shapes)',
  'raster.simplify': 'Simplification',
  'raster.smooth': 'Smoothing (0–3)',

  'line.legend': 'Cutting line',
  'line.outer': 'outer perimeter',
  'line.center': 'line center',
  'line.inner': 'inner perimeter',
  'line.allObjects': 'cut all objects',
  'line.unionAll': 'merge all paths (union)',

  'params.legend': 'Parameters (mm)',
  'params.preset': 'Preset',
  'preset.classic': 'classic',
  'preset.gingerbread': 'gingerbread',
  'preset.thin': 'thin / fondant',
  'preset.custom': 'custom',
  'params.targetW': 'Cookie width',
  'params.wall': 'Wall thickness (blade)',
  'params.edge': 'Blade edge',
  'params.taperH': 'Taper height',
  'params.height': 'Wall height',
  'params.flangeW': 'Flange overhang',
  'params.flangeT': 'Flange thickness',
  'params.flangeAt': 'Flange position',
  'flangeAt.bottom': 'bottom',
  'flangeAt.top': 'top',
  'params.showDims': 'show dimensions',

  'hint3d': 'Load a file…',

  'status.generating': 'Generating model…',
  'status.modelGenerated': 'Model generated.',
  'status.fetching': 'Fetching image…',
  'status.imageLoadFailed': 'Failed to load the image.',
  'status.fetchFailed': 'Could not fetch the image (the source site may block it). Save it and drop the file instead.',

  'info.objects': 'Objects: {basis} (contours: {contours})',
  'info.contours': 'Contours: {contours}',
  'info.selected': ' (selected #{idx} — click the preview to change)',
  'info.cutExtent': 'Cutting lines extent',
  'info.cookie': 'Cookie (cutting line)',
  'info.size': '{w} × {h} mm',
  'info.overall': 'Overall size: {w} × {h} × {d} mm',
  'info.triangles': 'Triangles: {n}',

  'dim.width': 'width {v} mm',
  'dim.wallHeight': 'wall height {v} mm',
  'dim.edge': 'edge {v} mm',
  'dim.wall': 'wall {v} mm',
  'dim.taper': 'taper {v} mm',
  'dim.flangeOverhang': 'flange overhang {v} mm',
  'dim.flange': 'flange {v} mm',
};

const CS: Dict = {
  'app.subtitle': '— generátor vykrajovátek',
  'drop.title': 'Přetáhněte sem SVG / PNG / JPG',
  'drop.sub': 'nebo klikněte pro výběr · nebo vložte (⌘V)',

  'raster.legend': 'Vektorizace obrázku',
  'raster.threshold': 'Práh jasu',
  'raster.invert': 'invertovat (světlé tvary)',
  'raster.simplify': 'Zjednodušení',
  'raster.smooth': 'Vyhlazení (0–3)',

  'line.legend': 'Řezná linie',
  'line.outer': 'vnější obvod',
  'line.center': 'střed linie',
  'line.inner': 'vnitřní obvod',
  'line.allObjects': 'vykrojit všechny objekty',
  'line.unionAll': 'sloučit všechny cesty (sjednocení)',

  'params.legend': 'Parametry (mm)',
  'params.preset': 'Předvolba',
  'preset.classic': 'klasické',
  'preset.gingerbread': 'perník',
  'preset.thin': 'tenké / fondán',
  'preset.custom': 'vlastní',
  'params.targetW': 'Šířka sušenky',
  'params.wall': 'Tloušťka stěny (čepel)',
  'params.edge': 'Ostří čepele',
  'params.taperH': 'Výška zkosení',
  'params.height': 'Výška stěny',
  'params.flangeW': 'Přesah obruby',
  'params.flangeT': 'Tloušťka obruby',
  'params.flangeAt': 'Pozice obruby',
  'flangeAt.bottom': 'dole',
  'flangeAt.top': 'nahoře',
  'params.showDims': 'zobrazit kóty',

  'hint3d': 'Načtěte soubor…',

  'status.generating': 'Generuji model…',
  'status.modelGenerated': 'Model vygenerován.',
  'status.fetching': 'Načítám obrázek…',
  'status.imageLoadFailed': 'Nepodařilo se načíst obrázek.',
  'status.fetchFailed': 'Obrázek se nepodařilo stáhnout (zdrojový web jej může blokovat). Uložte jej a přetáhněte jako soubor.',

  'info.objects': 'Objekty: {basis} (kontury: {contours})',
  'info.contours': 'Kontury: {contours}',
  'info.selected': ' (vybrána #{idx} — kliknutím na náhled změníte)',
  'info.cutExtent': 'Rozsah řezných linií',
  'info.cookie': 'Sušenka (řezná linie)',
  'info.size': '{w} × {h} mm',
  'info.overall': 'Celkový rozměr: {w} × {h} × {d} mm',
  'info.triangles': 'Trojúhelníky: {n}',

  'dim.width': 'šířka {v} mm',
  'dim.wallHeight': 'výška stěny {v} mm',
  'dim.edge': 'ostří {v} mm',
  'dim.wall': 'stěna {v} mm',
  'dim.taper': 'zkosení {v} mm',
  'dim.flangeOverhang': 'přesah {v} mm',
  'dim.flange': 'obruba {v} mm',
};

const DICTS: Record<Lang, Dict> = { cs: CS, en: EN };
const STORAGE_KEY = 'cookiecut.lang';

function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'cs' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;
  applyStaticI18n();
  for (const cb of listeners) cb();
}

/** Subscribe to language changes (re-render dynamic content). */
export function onLangChange(cb: () => void): void {
  listeners.add(cb);
}

/** Translate a key, substituting {name} placeholders from vars. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang][key] ?? EN[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Fill every [data-i18n] element's text from the current dictionary. */
export function applyStaticI18n(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n!);
  }
  document.documentElement.lang = lang;
}
