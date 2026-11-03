/* ───────────────────────────────────────────────────────────────────────
   A spreadsheet shown in the page (v0.89) — the order tracker's document
   viewer opens an .xlsx / .csv attachment (E&E's "Delivery Status" sheets)
   as tables, one per sheet. .xlsx is read with ExcelJS (already loaded on
   demand for the audit report); .csv by parseCsv. Text only: nothing in a
   cell is run or rendered as HTML.
   ─────────────────────────────────────────────────────────────────────── */

export interface SheetPreview { name: string; rows: string[][]; truncated: boolean }

export const MAX_PREVIEW_ROWS = 2000;
export const MAX_PREVIEW_COLS = 60;

const pad2 = (n: number) => String(n).padStart(2, '0');
/** What a cell shows: a date as MM/DD/YYYY, a formula by its result, rich text / a link by its text. */
export function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    // ExcelJS gives dates as UTC midnight; show the calendar day the sheet holds
    return Number.isNaN(v.getTime()) ? '' : `${pad2(v.getUTCMonth() + 1)}/${pad2(v.getUTCDate())}/${v.getUTCFullYear()}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text?: string }>; text?: unknown; result?: unknown; error?: string; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text ?? '').join('');
    if ('result' in o) return cellText(o.result);
    if (o.text != null) return cellText(o.text);
    if (o.error) return String(o.error);
    if (o.hyperlink) return String(o.hyperlink);
    return '';
  }
  return String(v);
}

/** Trailing empty rows and columns off; at most MAX rows / columns. */
export function tidyRows(rows: string[][]): { rows: string[][]; truncated: boolean } {
  let end = rows.length;
  while (end > 0 && !rows[end - 1].some(c => c.trim())) end--;
  const kept = rows.slice(0, end);
  const width = Math.min(MAX_PREVIEW_COLS, kept.reduce((w, r) => {
    let last = r.length;
    while (last > 0 && !r[last - 1].trim()) last--;
    return Math.max(w, last);
  }, 0));
  const truncated = kept.length > MAX_PREVIEW_ROWS || kept.some(r => r.slice(MAX_PREVIEW_COLS).some(c => c.trim()));
  return { rows: kept.slice(0, MAX_PREVIEW_ROWS).map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')), truncated };
}

/** RFC 4180 CSV: quoted fields with commas, doubled quotes and line breaks; \n or \r\n rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;               // a byte-order mark Excel writes
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Every sheet of an .xlsx workbook as rows of cell text. */
export async function sheetsFromXlsx(buf: ArrayBuffer): Promise<SheetPreview[]> {
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets.filter(ws => ws.state !== 'hidden' && ws.state !== 'veryHidden').map(ws => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      if (n > MAX_PREVIEW_ROWS + 1) return;
      const cells: string[] = [];
      // a merged block ("DELIVERED" across the sheet) shows once, in its first cell, as in Excel
      r.eachCell({ includeEmpty: true }, (c, col) => { cells[col - 1] = c.isMerged && c.master.address !== c.address ? '' : cellText(c.value); });
      rows[n - 1] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
    });
    const dense = Array.from({ length: rows.length }, (_, i) => rows[i] ?? []);
    return { name: ws.name, ...tidyRows(dense) };
  });
}

export async function sheetsFromFile(name: string, buf: ArrayBuffer): Promise<SheetPreview[] | null> {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'xlsx') return sheetsFromXlsx(buf);
  if (ext === 'csv') return [{ name: name.replace(/\.csv$/i, ''), ...tidyRows(parseCsv(new TextDecoder().decode(buf))) }];
  return null;
}
