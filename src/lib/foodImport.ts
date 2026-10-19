/* ───────────────────────────────────────────────────────────────────────
   foodImport — the food inventory workbook: build the template, read it back.

   Shape (taken from Little Luck's own "FOOD INVENTORY" workbook, so the sheet
   a venue already keeps uploads as-is):
     one worksheet per category  ->  Meat_&_Seafood, Dairy_&_eggs, Grocery,
                                     Produce, Frozen
     row 1  category title
     row 2  Item | Unit | Pack size | Quantity | Price | Total
     rows   one item each; a "TOTAL" row per sheet
     plus a Total_Food_Inventory roll-up sheet (ignored on read).

   Pack size ("units per case") is the one column Little Luck's original sheet
   did not have. 57 of its 196 items are counted by the case and nothing in the
   database recorded how many units a case holds, so a case could not be
   converted or lined up against invoice prices. The template asks for it once.

   The server does the real work: kount_import_food_count (migrations 0081 +
   0088) resolves names to master items, writes the venue's costs and food
   list, and records a count ONLY when the sheet carries quantities. A sheet
   with prices but no quantities sets up the list without a fake count.

   Pure helpers are separate from the exceljs-backed ones so they can be unit
   tested without the workbook library. exceljs is lazy-loaded with the same
   interop-resilient pattern as bevagerImport.ts / auditReport.ts.
   ─────────────────────────────────────────────────────────────────────── */

import type ExcelJSNS from 'exceljs';

export const FOOD_SHEETS = [
  { key: 'Meat_&_Seafood', title: 'Meat & Seafood' },
  { key: 'Dairy_&_eggs',   title: 'Dairy & Eggs' },
  { key: 'Grocery',        title: 'Grocery' },
  { key: 'Produce',        title: 'Produce' },
  { key: 'Frozen',         title: 'Frozen' },
] as const;

export type FoodSheetKey = typeof FOOD_SHEETS[number]['key'];

export const TOTAL_SHEET = 'Total_Food_Inventory';

/** Upload cap, same order as the Bevager import. A food sheet is ~35 KB. */
export const MAX_FOOD_WORKBOOK_BYTES = 10 * 1024 * 1024;

/** One parsed line, exactly the shape kount_import_food_count expects. */
export interface FoodRow {
  item: string;
  unit: string;
  pack: number | null;
  qty: number | null;
  price: number | null;
  sheet: string;
  sort: number;
}

/** A row that had an item name but nothing else -- almost always a section
 *  heading typed into the sheet. Reported, never sent: sending it would make
 *  the server create a junk catalog item named after a heading. */
export interface SkippedRow { sheet: string; item: string }

export interface ParsedFoodWorkbook {
  rows: FoodRow[];
  skipped: SkippedRow[];
  /** Worksheets that contained an item table. */
  sheets: string[];
}

/** What the template is pre-filled with: the venue's food list. */
export interface TemplateItem {
  name: string;
  unit: string | null;
  pack: number | null;
  price: number | null;
  sheet: string | null;
  category?: string | null;
  sort?: number | null;
}

/* ───────────────────────── Pure helpers ───────────────────────── */

/** Unwrap an exceljs cell value to a plain value: formula results, rich text,
 *  hyperlinks. Errors and unknown objects read as empty. */
export function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  const o = v as Record<string, unknown>;
  if ('result' in o) return cellValue(o.result);
  if (Array.isArray(o.richText)) {
    return (o.richText as Array<{ text?: unknown }>).map((r) => String(r.text ?? '')).join('');
  }
  if ('text' in o) return cellValue(o.text);
  return null;
}

export function toText(v: unknown): string {
  const x = cellValue(v);
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x).replace(/\s+/g, ' ').trim();
}

/** Numbers as people type them into a sheet: "$5.91", "1,234.50", "12".
 *  Blank, "-" and anything non-numeric read as null -- never as 0, because a
 *  0 quantity is a real count and must stay distinguishable from "not counted". */
export function toNumber(v: unknown): number | null {
  const x = cellValue(v);
  if (x === null || x === undefined || typeof x === 'boolean') return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/[$,\s]/g, '');
  if (s === '' || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type ColKey = 'item' | 'unit' | 'pack' | 'qty' | 'price' | 'total';

/** Forgiving header map. Matched on the WHOLE normalised cell, so "Count unit"
 *  resolves to unit while a bare "Count" resolves to quantity. */
const HEADER_ALIASES: Record<string, ColKey> = {
  'item': 'item', 'items': 'item', 'product': 'item', 'item name': 'item',
  'product name': 'item', 'description': 'item',
  'unit': 'unit', 'uom': 'unit', 'count unit': 'unit', 'counting unit': 'unit',
  'unit of measure': 'unit',
  'pack size': 'pack', 'pack': 'pack', 'units per case': 'pack', 'case size': 'pack',
  'case pack': 'pack', 'per case': 'pack', 'units/case': 'pack',
  'quantity': 'qty', 'qty': 'qty', 'count': 'qty', 'counted': 'qty',
  'on hand': 'qty', 'qty on hand': 'qty',
  'price': 'price', 'cost': 'price', 'unit price': 'price', 'unit cost': 'price',
  'price per unit': 'price', 'cost per unit': 'price', 'btl ($)': 'price', 'btl $': 'price',
  'total': 'total', 'total cost': 'total', 'extended': 'total', 'value': 'total',
};

const normHeader = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Turn one worksheet's grid (rows of raw cell values) into FoodRows.
 *  Finds the header row by locating an "Item" column in the first 15 rows; a
 *  sheet with no item table (the roll-up, an instructions tab) yields nothing. */
export function rowsFromGrid(sheet: string, grid: unknown[][], startSort: number):
  { rows: FoodRow[]; skipped: SkippedRow[]; hasTable: boolean } {
  let headerRow = -1;
  let cols: Partial<Record<ColKey, number>> = {};
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const found: Partial<Record<ColKey, number>> = {};
    (grid[r] || []).forEach((cell, i) => {
      const key = HEADER_ALIASES[normHeader(toText(cell))];
      if (key && found[key] === undefined) found[key] = i;
    });
    if (found.item !== undefined) { headerRow = r; cols = found; break; }
  }
  if (headerRow < 0) return { rows: [], skipped: [], hasTable: false };

  const at = (row: unknown[], k: ColKey): unknown => (cols[k] === undefined ? null : row[cols[k] as number]);
  const rows: FoodRow[] = [];
  const skipped: SkippedRow[] = [];
  let sort = startSort;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const item = toText(at(row, 'item'));
    if (!item) continue;
    if (/^total\b/i.test(item)) continue;           // per-sheet subtotal row
    const unit = toText(at(row, 'unit')).toLowerCase();
    const pack = toNumber(at(row, 'pack'));
    const qty = toNumber(at(row, 'qty'));
    const price = toNumber(at(row, 'price'));
    if (!unit && pack === null && qty === null && price === null) {
      skipped.push({ sheet, item });                // a heading, not an item
      continue;
    }
    sort++;
    rows.push({ item, unit, pack, qty, price, sheet, sort });
  }
  return { rows, skipped, hasTable: true };
}

/** Which category sheet an item belongs on, for venues whose food list was
 *  never given one. Mirrors the catalog's category names. */
export function sheetForCategory(category: string | null | undefined): FoodSheetKey {
  const c = (category || '').toLowerCase();
  if (/(meat|seafood|fish|poultry|beef|pork)/.test(c)) return 'Meat_&_Seafood';
  if (/(dairy|egg|cheese)/.test(c)) return 'Dairy_&_eggs';
  if (/produce/.test(c)) return 'Produce';
  if (/frozen/.test(c)) return 'Frozen';
  return 'Grocery';
}

function isFoodSheetKey(s: string | null | undefined): s is FoodSheetKey {
  return FOOD_SHEETS.some((f) => f.key === s);
}

/* ─────────────────────── exceljs-backed I/O ─────────────────────── */

async function loadExcelJS(): Promise<typeof import('exceljs')> {
  // exceljs is CommonJS: bundlers hoist its exports onto the namespace, raw
  // Node ESM nests them under `.default`. Resolve both.
  const mod = await import('exceljs');
  return ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod);
}

function sheetToGrid(ws: ExcelJSNS.Worksheet): unknown[][] {
  const grid: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const vals: unknown[] = [];
    // row.values is 1-indexed with a hole at [0]
    const raw = row.values as unknown[];
    for (let c = 1; c < raw.length; c++) vals.push(raw[c]);
    grid[rowNumber - 1] = vals;
  });
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  return grid;
}

/** Google Sheets exports cell comments with ABSOLUTE relationship targets
 *  (Target="/xl/comments/comment1.xml", Id="anysvml"). exceljs cannot resolve
 *  them and throws "Cannot read properties of undefined (reading 'comments')"
 *  on load -- Little Luck's own FOOD INVENTORY workbook does exactly this, so
 *  the sheet the venue already keeps would have failed to upload. Comments and
 *  their VML drawings are irrelevant to a count, so drop them and the
 *  references to them, and hand exceljs a clean package. Cells are untouched. */
export async function stripComments(buf: WorkbookBytes): Promise<Uint8Array> {
  const mod = await import('jszip');
  const JSZip = ((mod as unknown as { default?: typeof import('jszip') }).default ?? mod) as unknown as typeof import('jszip');
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  for (const name of names) {
    if (/^xl\/(comments|threadedComments)\//i.test(name)
        || /^xl\/comments\d*\.xml$/i.test(name)
        || /^xl\/drawings\/.*\.vml$/i.test(name)) {
      zip.remove(name);
    }
  }
  for (const name of names) {
    const f = zip.file(name);
    if (!f) continue;
    if (/^xl\/worksheets\/_rels\/.*\.rels$/i.test(name)) {
      const xml = await f.async('string');
      zip.file(name, xml.replace(
        /<Relationship\s[^>]*Type="[^"]*\/(comments|vmlDrawing|threadedComment)"[^>]*\/>/gi, ''));
    } else if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
      const xml = await f.async('string');
      zip.file(name, xml.replace(/<legacyDrawing\s[^>]*\/>/gi, ''));
    }
  }
  const ct = zip.file('[Content_Types].xml');
  if (ct) {
    const xml = await ct.async('string');
    zip.file('[Content_Types].xml', xml.replace(
      /<Override\s[^>]*PartName="\/xl\/(comments|threadedComments|drawings\/[^"]*\.vml)[^"]*"[^>]*\/>/gi, ''));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** Read an uploaded workbook. Accepts the venue's original 5-column sheet or
 *  the downloaded 6-column template. */
/** Bytes as exceljs produces them: ArrayBuffer in the browser, a Buffer
 *  (Uint8Array) under Node. Both are accepted on read. */
export type WorkbookBytes = ArrayBuffer | Uint8Array;

export async function parseFoodWorkbook(input: Blob | WorkbookBytes): Promise<ParsedFoodWorkbook> {
  let buf: WorkbookBytes;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    buf = input as WorkbookBytes;
  } else {
    if (input.size > MAX_FOOD_WORKBOOK_BYTES) {
      throw new Error(`Workbook is ${Math.round(input.size / 1024 / 1024)} MB — limit is ${MAX_FOOD_WORKBOOK_BYTES / 1024 / 1024} MB.`);
    }
    buf = await input.arrayBuffer();
  }
  if (buf.byteLength > MAX_FOOD_WORKBOOK_BYTES) {
    throw new Error(`Workbook is ${Math.round(buf.byteLength / 1024 / 1024)} MB — limit is ${MAX_FOOD_WORKBOOK_BYTES / 1024 / 1024} MB.`);
  }
  const ExcelJS = await loadExcelJS();
  let wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch (first) {
    // Retry once without comments (see stripComments). Anything still failing
    // is a genuinely unreadable file, reported in plain words.
    try {
      const cleaned = await stripComments(buf);
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(cleaned as unknown as ArrayBuffer);
    } catch {
      const why = first instanceof Error ? first.message : String(first);
      throw new Error(`Could not read this workbook as an .xlsx file (${why}). Re-save it from Excel or Google Sheets as .xlsx and try again.`);
    }
  }

  const out: ParsedFoodWorkbook = { rows: [], skipped: [], sheets: [] };
  for (const ws of wb.worksheets) {
    if (ws.name === TOTAL_SHEET) continue;
    const { rows, skipped, hasTable } = rowsFromGrid(ws.name, sheetToGrid(ws), out.rows.length);
    if (!hasTable) continue;
    out.sheets.push(ws.name);
    out.rows.push(...rows);
    out.skipped.push(...skipped);
  }
  return out;
}

const MONEY = '"$"#,##0.00';
const HEADER_FILL: ExcelJSNS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
const HEADER_FONT: Partial<ExcelJSNS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const NEEDS_PACK_FILL: ExcelJSNS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
const HEADERS = ['Item', 'Unit', 'Pack size', 'Quantity', 'Price', 'Total'];
const BLANK_ROWS = 25;

/** Build the downloadable template, pre-filled with the venue's food list.
 *  With no list yet, each sheet gets blank rows ready to type into. */
export async function buildFoodTemplate(items: TemplateItem[], venueName: string): Promise<WorkbookBytes> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'kount';

  // Group items onto their sheets, ordered as the venue last had them.
  const bySheet = new Map<FoodSheetKey, TemplateItem[]>();
  for (const f of FOOD_SHEETS) bySheet.set(f.key, []);
  for (const it of items) {
    const key = isFoodSheetKey(it.sheet) ? it.sheet : sheetForCategory(it.category);
    (bySheet.get(key) as TemplateItem[]).push(it);
  }
  for (const list of bySheet.values()) {
    list.sort((a, b) => ((a.sort ?? 1e9) - (b.sort ?? 1e9)) || a.name.localeCompare(b.name));
  }

  const totalCellBySheet = new Map<FoodSheetKey, string>();
  for (const f of FOOD_SHEETS) {
    const ws = wb.addWorksheet(f.key, { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.columns = [
      { width: 48 }, { width: 8 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 13 },
    ];
    ws.getCell('A1').value = f.title;
    ws.getCell('A1').font = { bold: true, size: 13 };

    const header = ws.getRow(2);
    HEADERS.forEach((h, i) => {
      const c = header.getCell(i + 1);
      c.value = h;
      c.fill = HEADER_FILL;
      c.font = HEADER_FONT;
    });

    const list = bySheet.get(f.key) as TemplateItem[];
    const lineCount = list.length > 0 ? list.length : BLANK_ROWS;
    for (let i = 0; i < lineCount; i++) {
      const r = i + 3;
      const it = list[i];
      const row = ws.getRow(r);
      if (it) {
        row.getCell(1).value = it.name;
        row.getCell(2).value = it.unit ?? null;
        row.getCell(3).value = it.pack ?? null;
        row.getCell(5).value = it.price ?? null;
        // A case-counted item with no pack size is exactly the gap the column
        // exists to close -- shade it so it gets filled in.
        if ((it.unit || '').toLowerCase() === 'cs' && (it.pack === null || it.pack === undefined)) {
          row.getCell(3).fill = NEEDS_PACK_FILL;
        }
      }
      row.getCell(4).numFmt = '0.##';
      row.getCell(5).numFmt = MONEY;
      row.getCell(6).value = { formula: `IF(OR(D${r}="",E${r}=""),"",D${r}*E${r})` };
      row.getCell(6).numFmt = MONEY;
    }
    const totalRow = lineCount + 3;
    ws.getCell(`A${totalRow}`).value = 'TOTAL';
    ws.getCell(`A${totalRow}`).font = { bold: true };
    ws.getCell(`F${totalRow}`).value = { formula: `SUM(F3:F${totalRow - 1})` };
    ws.getCell(`F${totalRow}`).numFmt = MONEY;
    ws.getCell(`F${totalRow}`).font = { bold: true };
    totalCellBySheet.set(f.key, `'${f.key}'!F${totalRow}`);
  }

  const sum = wb.addWorksheet(TOTAL_SHEET);
  sum.columns = [{ width: 26 }, { width: 16 }];
  sum.getCell('A1').value = `Total Food Inventory — ${venueName}`;
  sum.getCell('A1').font = { bold: true, size: 13 };
  ['Category', 'Total Cost'].forEach((h, i) => {
    const c = sum.getRow(3).getCell(i + 1);
    c.value = h; c.fill = HEADER_FILL; c.font = HEADER_FONT;
  });
  FOOD_SHEETS.forEach((f, i) => {
    const r = i + 4;
    sum.getCell(`A${r}`).value = f.title;
    sum.getCell(`B${r}`).value = { formula: totalCellBySheet.get(f.key) as string };
    sum.getCell(`B${r}`).numFmt = MONEY;
  });
  const grand = FOOD_SHEETS.length + 5;
  sum.getCell(`A${grand}`).value = 'Total Inventory';
  sum.getCell(`A${grand}`).font = { bold: true };
  sum.getCell(`B${grand}`).value = { formula: `SUM(B4:B${grand - 2})` };
  sum.getCell(`B${grand}`).numFmt = MONEY;
  sum.getCell(`B${grand}`).font = { bold: true };

  const notes = [
    'How to fill this in',
    '• Quantity: what you counted, in the Unit shown (ea / cs / lb …). Partial is fine — e.g. 2.5.',
    '• Leave Quantity blank for anything you did not count. 0 means you counted none.',
    '• Price: cost per one Unit. Enter it once — later counts pull it from invoices automatically.',
    '• Pack size: how many units are in one case. Needed for every item counted by the case (cs).',
    '• Add new items on a blank row of the right sheet. Do not rename or reorder the sheets.',
    '• Upload a sheet with no quantities to set up the item list and prices without recording a count.',
  ];
  notes.forEach((t, i) => {
    const c = sum.getCell(`A${grand + 3 + i}`);
    c.value = t;
    if (i === 0) c.font = { bold: true };
  });

  return (await wb.xlsx.writeBuffer()) as unknown as WorkbookBytes;
}
