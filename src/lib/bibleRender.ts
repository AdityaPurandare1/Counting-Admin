/* ───────────────────────────────────────────────────────────────────────
   Venue bibles (v0.92) — each venue's OS&E bible workbook drawn in the
   admin as it looks in Excel: column widths, row heights, fills and fonts
   (theme colours resolved), borders, merged cells, frozen header rows,
   links, and the pictures — both floating ones and Excel's "picture in
   cell" ones, which ExcelJS reads as #VALUE! (they live in xl/richData;
   richImageMap follows cell vm → metadata → rich value → media).
   Text only: nothing in a workbook is run or rendered as HTML.
   ─────────────────────────────────────────────────────────────────────── */
import type ExcelJSNS from 'exceljs';
import { cellText } from './sheetPreview';

export interface BibleStyle { [css: string]: string | number }
export interface BibleCell { text: string; style: BibleStyle; link: string | null; image: string | null; rowSpan: number; colSpan: number; covered: boolean }
/** A floating picture, drawn inside the cell it is anchored to (row / col, 0-based) at dx / dy px — so it stays with a frozen cell. */
export interface BibleFloat { media: string; row: number; col: number; dx: number; dy: number; width: number; height: number }
export interface BibleSheet {
  name: string; colWidths: number[]; rows: Array<{ height: number; cells: BibleCell[] }>;
  frozenRows: number; frozenCols: number; floats: BibleFloat[]; truncated: boolean;
}
export interface BibleBook { sheets: BibleSheet[]; media: Map<string, { bytes: Uint8Array; mime: string }> }

export const MAX_BIBLE_ROWS = 1500;
export const MAX_BIBLE_COLS = 60;
const EMU_PER_PX = 9525;

/* ── sizes ── */
/** Excel column width (characters of the default font) → pixels; no width = Excel's default 8.43 (64 px). */
export const colWidthPx = (w: number | null | undefined) => (w && w > 0 ? Math.round(w * 7 + 5) : 64);
/** Row height in points → pixels; none = Excel's default 15 pt (20 px). */
export const rowHeightPx = (pt: number | null | undefined) => Math.round((pt && pt > 0 ? pt : 15) * 4 / 3);

/* ── colours ── */
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/** Excel's tint: below 0 darkens (L × (1 + tint)), above 0 lightens (L × (1 − tint) + tint). */
export function applyTint(hex: string, tint: number | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !tint) return m ? `#${m[1].toUpperCase()}` : hex;
  const n = parseInt(m[1], 16);
  const [h, s, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l2)));
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}
/** The workbook theme's colours in Excel's index order: lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink. */
export function themePalette(themeXml: string | null): string[] {
  const fallback = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#0563C1', '#954F72'];
  if (!themeXml) return fallback;
  const pick = (tag: string, i: number) => {
    const m = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(themeXml);
    const v = m && (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(m[1]) ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(m[1]));
    return v ? `#${v[1].toUpperCase()}` : fallback[i];
  };
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(pick);
}
// Excel's legacy indexed palette (0–63; 64 = system foreground → none)
const INDEXED = ('000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,800000,008000,000080,808000,800080,008080,C0C0C0,808080,'
  + '9999FF,993366,FFFFCC,CCFFFF,660066,FF8080,0066CC,CCCCFF,000080,FF00FF,FFFF00,00FFFF,800080,800000,008080,0000FF,00CCFF,CCFFFF,CCFFCC,FFFF99,99CCFF,FF99CC,CC99FF,FFCC99,'
  + '3366FF,33CCCC,99CC00,FFCC00,FF9900,FF6600,666699,969696,003366,339966,003300,333300,993300,993366,333399,333333').split(',');
/** An ExcelJS colour ({argb} | {theme, tint} | {indexed}) as CSS, or null for none / automatic. */
export function excelColor(c: { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined | null, palette: string[]): string | null {
  if (!c) return null;
  if (c.argb && /^[0-9A-Fa-f]{8}$/.test(c.argb)) return `#${c.argb.slice(2).toUpperCase()}`;
  if (c.argb && /^[0-9A-Fa-f]{6}$/.test(c.argb)) return `#${c.argb.toUpperCase()}`;
  if (c.theme != null && palette[c.theme]) return applyTint(palette[c.theme], c.tint);
  if (c.indexed != null && c.indexed < 64 && INDEXED[c.indexed]) return `#${INDEXED[c.indexed]}`;
  return null;
}

/* ── Excel's "picture in cell" (xl/richData) ── */
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
/** Which sheet file each sheet name is (workbook.xml + its rels). */
export function sheetFiles(workbookXml: string, workbookRels: string): Map<string, string> {
  const rels = new Map([...workbookRels.matchAll(/<Relationship\b[^>]*>/g)].map(m => attrs(m[0])).map(a => [a.Id, a.Target]));
  const out = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const target = rels.get(a['r:id']);
    if (a.name && target) out.set(a.name.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
      target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  return out;
}
/** The cells of a sheet that hold a rich value (vm, 1-based), by address. */
export function sheetVmCells(sheetXml: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of sheetXml.matchAll(/<c\b[^>]*\bvm="(\d+)"[^>]*>/g)) { const a = attrs(m[0]); if (a.r) out.set(a.r, Number(m[1])); }
  return out;
}
/** vm (1-based) → the picture's media path: valueMetadata bk → futureMetadata rvb → rich value → its
 *  _rvRel:LocalImageIdentifier → richValueRel → the image file. null when the vm is not a local image. */
export function richImageMap(p: { metadata: string | null; richValues: string | null; structures: string | null; valueRels: string | null; valueRelsRels: string | null }): Array<string | null> {
  if (!p.metadata || !p.richValues || !p.structures || !p.valueRels || !p.valueRelsRels) return [];
  const block = (xml: string, tag: string) => (new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? '');
  const future = [...block(p.metadata, 'futureMetadata').matchAll(/<bk>([\s\S]*?)<\/bk>/g)].map(m => Number(/rvb i="(\d+)"/.exec(m[1])?.[1] ?? NaN));
  const valueMeta = [...block(p.metadata, 'valueMetadata').matchAll(/<bk>([\s\S]*?)<\/bk>/g)].map(m => Number(/<rc\b[^>]*\bv="(\d+)"/.exec(m[1])?.[1] ?? NaN));
  const structures = [...p.structures.matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map(m => [...m[1].matchAll(/<k\b[^>]*n="([^"]+)"/g)].map(k => k[1]));
  const values = [...p.richValues.matchAll(/<rv\b([^>]*)>([\s\S]*?)<\/rv>/g)].map(m => ({ s: Number(/s="(\d+)"/.exec(m[1])?.[1] ?? 0), v: [...m[2].matchAll(/<v\b[^>]*>([^<]*)<\/v>/g)].map(x => x[1]) }));
  const relIds = [...p.valueRels.matchAll(/<rel\b[^>]*r:id="([^"]+)"/g)].map(m => m[1]);
  const targets = new Map([...p.valueRelsRels.matchAll(/<Relationship\b[^>]*>/g)].map(m => attrs(m[0])).map(a => [a.Id, a.Target]));
  return valueMeta.map(fi => {
    const rv = values[future[fi]];
    if (!rv) return null;
    const k = (structures[rv.s] ?? []).indexOf('_rvRel:LocalImageIdentifier');
    const target = k >= 0 ? targets.get(relIds[Number(rv.v[k])]) : undefined;
    return target ? `xl/${target.replace(/^\.\.\//, '')}` : null;
  });
}

/* ── one cell ── */
const BORDER_W: Record<string, string> = { thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', medium: '2px solid', mediumDashed: '2px dashed', thick: '3px solid', double: '3px double' };
/** A cell's look as CSS (fill, font, alignment, borders). */
export function cellStyle(s: Partial<ExcelJSNS.Style> | undefined, palette: string[]): BibleStyle {
  const out: BibleStyle = {};
  if (!s) return out;
  const fill = s.fill as { type?: string; pattern?: string; fgColor?: never; bgColor?: never } | undefined;
  if (fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
    const bg = excelColor(fill.fgColor, palette) ?? excelColor(fill.bgColor, palette);
    if (bg) out.background = bg;
  }
  const f = s.font;
  if (f) {
    if (f.bold) out.fontWeight = 700;
    if (f.italic) out.fontStyle = 'italic';
    if (f.size) out.fontSize = Math.round(f.size * 4 / 3);
    const color = excelColor(f.color as never, palette);
    if (color) out.color = color;
    const deco = [f.underline && 'underline', f.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) out.textDecoration = deco;
  }
  const a = s.alignment;
  if (a?.horizontal && ['left', 'center', 'right', 'justify'].includes(a.horizontal)) out.textAlign = a.horizontal;
  if (a?.horizontal === 'centerContinuous') out.textAlign = 'center';
  out.verticalAlign = a?.vertical === 'top' ? 'top' : a?.vertical === 'middle' ? 'middle' : 'bottom';
  if (a?.wrapText) out.whiteSpace = 'pre-wrap';
  const b = s.border;
  if (b) for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const e = b[side];
    if (e?.style && BORDER_W[e.style]) out[`border${side[0].toUpperCase()}${side.slice(1)}`] = `${BORDER_W[e.style]} ${excelColor(e.color as never, palette) ?? '#000'}`;
  }
  return out;
}
/** What a cell shows: currency / percent number formats applied; else cellText (dates as days, formula results). */
export function displayText(value: unknown, numFmt: string | undefined): string {
  if (typeof value === 'number' && numFmt) {
    if (/%/.test(numFmt)) return `${(value * 100).toFixed(/0\.0/.test(numFmt) ? 1 : 0)}%`;
    if (/[$€£]/.test(numFmt)) {
      const sym = /€/.test(numFmt) ? '€' : /£/.test(numFmt) ? '£' : '$';
      return `${value < 0 ? '-' : ''}${sym}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: /0\.00/.test(numFmt) ? 2 : 0, maximumFractionDigits: 2 })}`;
    }
    if (/#,##0/.test(numFmt)) return value.toLocaleString('en-US', { maximumFractionDigits: /0\.00/.test(numFmt) ? 2 : 0, minimumFractionDigits: /0\.00/.test(numFmt) ? 2 : 0 });
  }
  if (value && typeof value === 'object' && 'error' in (value as object)) return '';
  return cellText(value);
}
/** Only web and mail links open from a bible. */
export const safeLink = (u: unknown) => {
  const s = String(u ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(s) ? s : null;
};

/* ── the workbook ── */
const mimeOf = (path: string) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' } as Record<string, string>)[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

export async function loadBible(buf: ArrayBuffer): Promise<BibleBook> {
  const [{ default: JSZip }, excel] = await Promise.all([import('jszip'), import('exceljs')]);
  const ExcelJS = ((excel as unknown as { default?: typeof import('exceljs') }).default ?? excel);
  const zip = await JSZip.loadAsync(buf);
  const text = async (n: string) => (zip.file(n) ? await zip.file(n)!.async('string') : null);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const palette = themePalette(await text('xl/theme/theme1.xml'));
  const images = richImageMap({
    metadata: await text('xl/metadata.xml'), richValues: await text('xl/richData/rdrichvalue.xml'), structures: await text('xl/richData/rdrichvaluestructure.xml'),
    valueRels: await text('xl/richData/richValueRel.xml'), valueRelsRels: await text('xl/richData/_rels/richValueRel.xml.rels'),
  });
  const files = sheetFiles((await text('xl/workbook.xml')) ?? '', (await text('xl/_rels/workbook.xml.rels')) ?? '');
  const media: BibleBook['media'] = new Map();
  const want = async (path: string) => {
    if (media.has(path) || !zip.file(path)) return;
    media.set(path, { bytes: await zip.file(path)!.async('uint8array'), mime: mimeOf(path) });
  };
  const sheets: BibleSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state === 'hidden' || ws.state === 'veryHidden') continue;
    const file = files.get(ws.name);
    const vms = file ? sheetVmCells((await text(file)) ?? '') : new Map<string, number>();
    const nRows = Math.min(ws.rowCount, MAX_BIBLE_ROWS), nCols = Math.min(ws.columnCount, MAX_BIBLE_COLS);
    const colWidths = Array.from({ length: nCols }, (_, i) => {
      const col = ws.getColumn(i + 1);
      return col.hidden ? 0 : colWidthPx(col.width ?? ws.properties.defaultColWidth);
    });
    const merges = (ws as unknown as { _merges?: Record<string, { model: { top: number; left: number; bottom: number; right: number } }> })._merges ?? {};
    const rows: BibleSheet['rows'] = [];
    for (let r = 1; r <= nRows; r++) {
      const row = ws.getRow(r);
      const cells: BibleCell[] = [];
      for (let c = 1; c <= nCols; c++) {
        const cell = row.getCell(c);
        const covered = cell.isMerged && cell.master.address !== cell.address;
        const span = merges[cell.address]?.model;
        const vm = vms.get(cell.address);
        const image = vm ? images[vm - 1] ?? null : null;
        if (image) await want(image);
        const v = cell.value as unknown;
        const link = safeLink(cell.hyperlink ?? (v && typeof v === 'object' ? (v as { hyperlink?: string }).hyperlink : null))
          ?? safeLink(typeof v === 'string' ? v : null);
        cells.push({
          text: image ? '' : displayText(v, cell.numFmt), style: covered ? {} : cellStyle(cell.style, palette), link, image, covered,
          rowSpan: span ? Math.min(span.bottom, nRows) - span.top + 1 : 1, colSpan: span ? Math.min(span.right, nCols) - span.left + 1 : 1,
        });
      }
      rows.push({ height: row.hidden ? 0 : rowHeightPx(row.height ?? ws.properties.defaultRowHeight), cells });
    }
    // floating pictures, placed by their anchors (EMU offsets inside the anchor cell)
    const colLeft = (i: number) => colWidths.slice(0, Math.max(0, i)).reduce((s, w) => s + w, 0);
    const rowTop = (i: number) => rows.slice(0, Math.max(0, i)).reduce((s, x) => s + x.height, 0);
    const floats: BibleFloat[] = [];
    for (const im of ws.getImages()) {
      const meta = wb.getImage(Number(im.imageId)) as unknown as { buffer?: Uint8Array; extension?: string } | undefined;
      if (!meta?.buffer) continue;
      const key = `float:${im.imageId}.${meta.extension ?? 'png'}`;
      if (!media.has(key)) media.set(key, { bytes: new Uint8Array(meta.buffer), mime: mimeOf(key) });
      const tl = im.range.tl as unknown as { nativeCol: number; nativeColOff: number; nativeRow: number; nativeRowOff: number };
      const br = (im.range as { br?: unknown }).br as typeof tl | undefined;
      const ext = (im.range as { ext?: { width: number; height: number } }).ext;
      const left = colLeft(tl.nativeCol) + tl.nativeColOff / EMU_PER_PX, top = rowTop(tl.nativeRow) + tl.nativeRowOff / EMU_PER_PX;
      const width = br ? colLeft(br.nativeCol) + br.nativeColOff / EMU_PER_PX - left : ext?.width ?? 80;
      const height = br ? rowTop(br.nativeRow) + br.nativeRowOff / EMU_PER_PX - top : ext?.height ?? 80;
      if (!(width > 0 && height > 0) || tl.nativeRow >= rows.length || tl.nativeCol >= colWidths.length) continue;
      // anchored in a merged block: its first cell hosts it
      const m = Object.values(merges).map(x => x.model).find(x => tl.nativeRow + 1 >= x.top && tl.nativeRow + 1 <= x.bottom && tl.nativeCol + 1 >= x.left && tl.nativeCol + 1 <= x.right);
      const row = m ? m.top - 1 : tl.nativeRow, col = m ? m.left - 1 : tl.nativeCol;
      floats.push({ media: key, row, col, dx: left - colLeft(col), dy: top - rowTop(row), width, height });
    }
    const view = (ws.views ?? [])[0] as { state?: string; ySplit?: number; xSplit?: number } | undefined;
    sheets.push({
      name: ws.name, colWidths, rows, floats, truncated: ws.rowCount > MAX_BIBLE_ROWS || ws.columnCount > MAX_BIBLE_COLS,
      frozenRows: view?.state === 'frozen' ? Math.min(view.ySplit ?? 0, 6) : 0, frozenCols: view?.state === 'frozen' ? Math.min(view.xSplit ?? 0, 3) : 0,
    });
  }
  return { sheets, media };
}

/** A CSV bible (TNG's "all items" list) as one plain sheet: its header row bold, columns sized to their text. */
export function bibleFromCsv(rows: string[][], name: string): BibleBook {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const colWidths = Array.from({ length: Math.min(width, MAX_BIBLE_COLS) }, (_, i) =>
    Math.min(360, Math.max(64, ...rows.slice(0, 200).map(r => Math.round((r[i] ?? '').length * 7.2 + 14)))));
  return {
    media: new Map(),
    sheets: [{
      name, colWidths, floats: [], frozenRows: rows.length > 1 ? 1 : 0, frozenCols: 0, truncated: rows.length > MAX_BIBLE_ROWS,
      rows: rows.slice(0, MAX_BIBLE_ROWS).map((r, ri) => ({
        height: 20,
        cells: colWidths.map((_, ci): BibleCell => ({
          text: r[ci] ?? '', link: safeLink(r[ci]), image: null, rowSpan: 1, colSpan: 1, covered: false,
          style: (ri === 0 ? { fontWeight: 700, background: '#F3F1EA', verticalAlign: 'bottom' } : { verticalAlign: 'bottom' }) as BibleStyle,
        })),
      })),
    }],
  };
}

/* ── the bible's text, for Ask AI (0145) ── */

export interface BibleIndexSheet { name: string; header: string[]; rows: string[][] }
export interface BibleIndex { sheets: BibleIndexSheet[] }
const HEADER_WORD = /\b(item|description|manufacturer|vendor|qty|quantity|sku|size|status|link)\b/i;
const ITEM_NO = /item\s*(#|no\b|number)|\bsku\b|mfr\.?\s*#/i;

/** The row naming the columns (as bibleTextIndex finds it) and its Item # / SKU column — where a row's product
 *  number is, to look up its lead time (0147). Null when the sheet has none. */
export function bibleItemColumn(sheet: BibleSheet): { headerRow: number; col: number } | null {
  const texts = sheet.rows.slice(0, 8).map(r => r.cells.map(c => (c.covered ? '' : c.text.trim())));
  const h = texts.findIndex(r => r.filter(Boolean).length >= 3 && r.some(x => HEADER_WORD.test(x)));
  if (h < 0) return null;
  const col = texts[h].findIndex(x => ITEM_NO.test(x));
  return col < 0 ? null : { headerRow: h, col };
}

/** A bible's cell text by sheet (no pictures, no styling): its header row (the first of the top rows that
 *  names columns like Item / Manufacturer / QTY), then every row with at least two filled cells. Empty
 *  columns are dropped and long cells cut, so all the bibles stay small enough to search per question. */
export function bibleTextIndex(book: BibleBook): BibleIndex {
  return {
    sheets: book.sheets.map(s => {
      const texts = s.rows.map(r => r.cells.map(c => (c.covered ? '' : (c.text || (c.link ?? '')).replace(/\s+/g, ' ').trim().slice(0, 160))));
      const h = texts.slice(0, 8).findIndex(r => r.filter(Boolean).length >= 3 && r.some(x => HEADER_WORD.test(x)));
      const headerAt = h >= 0 ? h : texts.findIndex(r => r.filter(Boolean).length >= 3);
      const body = texts.slice(headerAt + 1).filter(r => r.filter(Boolean).length >= 2 && !(headerAt >= 0 && r.join('|') === texts[headerAt].join('|')));
      const used = (texts[headerAt] ?? []).map((_, i) => i).filter(i => (texts[headerAt]?.[i] ?? '') || body.some(r => r[i]));
      const width = Math.max(used.length ? used[used.length - 1] + 1 : 0, ...body.map(r => r.length));
      const keep = Array.from({ length: width }, (_, i) => i).filter(i => (texts[headerAt]?.[i] ?? '') || body.some(r => r[i]));
      return { name: s.name, header: keep.map(i => texts[headerAt]?.[i] ?? ''), rows: body.map(r => keep.map(i => r[i] ?? '')) };
    }).filter(s => s.rows.length),
  };
}
