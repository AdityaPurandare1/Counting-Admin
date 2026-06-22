/** Shared formatted-variance workbook builder.
 *
 *  Both the Variance screen (single audit) and the Reports screen (many
 *  audits) export the SAME rich .xlsx via buildVarianceWorkbookBlob — four
 *  tabs (Summary, Largest Offenders, Possible Causes, Detail), formatted
 *  header rows, $ / qty / % number formats, frozen headers + autofilter,
 *  red font on negatives.
 *
 *  exceljs is lazy-loaded with the same interop-resilient pattern used in
 *  bevagerImport.ts: bundlers hoist the exports onto the namespace, raw Node
 *  ESM nests them under `.default`. Resolve both so `ExcelJS.Workbook` works
 *  either way (and the unit test can drive the pure helpers without loading
 *  exceljs at all). */

import type ExcelJSNS from 'exceljs';

/** Row shape the workbook understands. Mirrors kount_avt_rows (the computed
 *  variance) plus optional per-audit tagging used by the Reports multi-audit
 *  export. All numeric fields may be null when a value wasn't computed. */
export interface AvtLikeRow {
  item_name: string;
  category: string | null;
  start_qty: number | null;
  purchases: number | null;
  depletions: number | null;
  actual: number | null;
  theo: number | null;
  variance: number | null;
  cu_price: number | null;
  variance_value: number | null;
  variance_pct: number | null;
  venue_name?: string | null;
  audit_code?: string | null;
  audit_date?: string | null;
}

export interface BuildVarianceWorkbookOpts {
  title: string;
  subtitle?: string;
  rows: AvtLikeRow[];
}

/* ───────────── Pure helpers (exported for unit testing) ───────────── */

const n = (v: number | null | undefined): number => (v == null ? 0 : Number(v) || 0);

export interface VarianceSummary {
  items: number;
  itemsPriced: number;
  itemsUnpriced: number;
  totalActualValue: number;
  totalTheoValue: number;
  netVarianceValue: number;
  /** net$ / theo$ × 100; 0 when theo$ is 0. */
  netVariancePct: number;
  grossShrinkage: number;   // Σ negatives (<= 0)
  grossOverage: number;     // Σ positives (>= 0)
  totalPurchases: number;
}

/** Roll a row set up into the Summary tile numbers. Pure — no exceljs. */
export function summarize(rows: AvtLikeRow[]): VarianceSummary {
  let totalActualValue = 0;
  let totalTheoValue = 0;
  let netVarianceValue = 0;
  let grossShrinkage = 0;
  let grossOverage = 0;
  let totalPurchases = 0;
  let itemsPriced = 0;

  for (const r of rows) {
    const price = r.cu_price;
    if (price != null) itemsPriced++;
    totalActualValue += n(r.actual) * n(price);
    totalTheoValue += n(r.theo) * n(price);
    const vv = n(r.variance_value);
    netVarianceValue += vv;
    if (vv < 0) grossShrinkage += vv;
    if (vv > 0) grossOverage += vv;
    totalPurchases += n(r.purchases);
  }

  return {
    items: rows.length,
    itemsPriced,
    itemsUnpriced: rows.length - itemsPriced,
    totalActualValue,
    totalTheoValue,
    netVarianceValue,
    netVariancePct: totalTheoValue !== 0 ? (netVarianceValue / totalTheoValue) * 100 : 0,
    grossShrinkage,
    grossOverage,
    totalPurchases,
  };
}

/** Auto-generated systemic notes for the Summary tab. Each note is only
 *  emitted when its condition holds. Pure — no exceljs. */
export function systemicNotes(rows: AvtLikeRow[], s: VarianceSummary = summarize(rows)): string[] {
  const notes: string[] = [];

  if (s.totalPurchases === 0) {
    notes.push(
      '⚠ Purchases = $0 for the period — invoice line-items not ingested upstream; ' +
      'theoretical is understated, so shrinkage is overstated across the board.',
    );
  }

  const zeroButExpected = rows.filter(r => n(r.actual) === 0 && n(r.theo) > 0.5).length;
  if (zeroButExpected > 0) {
    notes.push(`${zeroButExpected} items counted as 0 but expected on hand (show as full shrinkage)`);
  }

  if (s.itemsUnpriced > 0) {
    notes.push(`${s.itemsUnpriced} items not priced ($ variance blank)`);
  }

  // Near-equal gross shrinkage/overage suggests a split-catalog-name pair.
  // Compare magnitudes; only meaningful when both sides carry real money.
  const shrinkMag = Math.abs(s.grossShrinkage);
  const overMag = s.grossOverage;
  if (shrinkMag > 1 && overMag > 1) {
    const ratio = Math.min(shrinkMag, overMag) / Math.max(shrinkMag, overMag);
    if (ratio >= 0.8) {
      notes.push('Near-equal gross shrinkage/overage can indicate the same product split across two catalog names.');
    }
  }

  return notes;
}

/** First-match-wins likely-cause string for a row. Pure — no exceljs. */
export function likelyCause(r: AvtLikeRow): string {
  const start = n(r.start_qty);
  const purchases = n(r.purchases);
  const depletions = n(r.depletions);
  const actual = n(r.actual);
  const theo = n(r.theo);
  const variance = n(r.variance);
  const pct = n(r.variance_pct);

  if (actual === 0 && theo > 0.5) return 'Not counted — verify it was counted in its zone (shows as full shrinkage)';
  if (start === 0 && depletions === 0 && actual > 0) return 'Not in starting baseline — overage expected; add to baseline';
  if (purchases === 0 && depletions > 0 && variance < -0.5) return 'No purchases recorded (invoice gap) — shrinkage likely overstated';
  if (variance < -0.5) return 'Shrinkage — over-pour / spillage / untracked usage / theft';
  if (variance > 0.5) return 'Overage — miscount, untracked transfer-in, or unrecorded depletion';
  if (Math.abs(pct) >= 25) return 'Large % swing on a low-value item';
  return 'Within tolerance';
}

/** True when a row carries material variance worth surfacing on Possible Causes. */
export function isMaterial(r: AvtLikeRow): boolean {
  return Math.abs(n(r.variance)) > 0.5 || Math.abs(n(r.variance_value)) > 1;
}

/* ───────────── Workbook builder (lazy exceljs) ───────────── */

const FMT_MONEY = '$#,##0.00';
const FMT_QTY = '#,##0.00';
const FMT_PCT = '0.0"%"';

const HEADER_FILL: ExcelJSNS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E1B2E' }, // deep amethyst/near-black
};
const HEADER_FONT: Partial<ExcelJSNS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const RED_FONT: Partial<ExcelJSNS.Font> = { color: { argb: 'FFC0392B' } };

/** Apply the dark-fill / white-bold styling to a header row and freeze it. */
function styleHeaderRow(ws: ExcelJSNS.Worksheet, rowNumber: number): void {
  const row = ws.getRow(rowNumber);
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle' };
  });
  row.height = 18;
}

/** Coerce a possibly-null number into an exceljs cell value (blank for null). */
function numOrBlank(v: number | null | undefined): number | null {
  return v == null ? null : Number(v);
}

export async function buildVarianceWorkbookBlob(opts: BuildVarianceWorkbookOpts): Promise<Blob> {
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod);

  const rows = opts.rows;
  const multiVenue = new Set(rows.map(r => r.venue_name ?? '')).size > 1
    || rows.some(r => r.venue_name);
  const hasAuditCols = rows.some(r => r.audit_code || r.audit_date);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Counting Admin';
  wb.created = new Date();

  buildSummarySheet(ExcelJS, wb, opts, rows);
  buildOffendersSheet(wb, rows, multiVenue);
  buildCausesSheet(wb, rows);
  buildDetailSheet(wb, rows, multiVenue, hasAuditCols);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ── Tab 1: Summary ── */
function buildSummarySheet(
  ExcelJS: typeof import('exceljs'),
  wb: ExcelJSNS.Workbook,
  opts: BuildVarianceWorkbookOpts,
  rows: AvtLikeRow[],
): void {
  const ws = wb.addWorksheet('Summary');
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 26;

  // Title + subtitle merged across the two columns, larger font.
  ws.mergeCells('A1:B1');
  const titleCell = ws.getCell('A1');
  titleCell.value = opts.title;
  titleCell.font = { bold: true, size: 16 };
  ws.getRow(1).height = 22;

  let r = 2;
  if (opts.subtitle) {
    ws.mergeCells(`A2:B2`);
    const sub = ws.getCell('A2');
    sub.value = opts.subtitle;
    sub.font = { size: 11, color: { argb: 'FF555555' } };
    r = 3;
  }
  ws.mergeCells(`A${r}:B${r}`);
  const gen = ws.getCell(`A${r}`);
  gen.value = `Generated ${new Date().toLocaleString()}`;
  gen.font = { size: 10, italic: true, color: { argb: 'FF888888' } };
  r += 2;

  const s = summarize(rows);

  // Labeled metric block.
  const metricsHeaderRow = r;
  ws.getCell(`A${r}`).value = 'Metric';
  ws.getCell(`B${r}`).value = 'Value';
  styleHeaderRow(ws, r);
  r++;

  const addMetric = (label: string, value: number | string, fmt?: string) => {
    ws.getCell(`A${r}`).value = label;
    const cell = ws.getCell(`B${r}`);
    cell.value = value;
    if (fmt && typeof value === 'number') cell.numFmt = fmt;
    if (typeof value === 'number' && value < 0) cell.font = RED_FONT;
    r++;
  };

  addMetric('Items', s.items);
  addMetric('Items priced', s.itemsPriced);
  addMetric('Items unpriced', s.itemsUnpriced);
  addMetric('Total Actual $', s.totalActualValue, FMT_MONEY);
  addMetric('Total Theoretical $', s.totalTheoValue, FMT_MONEY);
  addMetric('Net Variance $', s.netVarianceValue, FMT_MONEY);
  addMetric('Net Variance %', s.netVariancePct, FMT_PCT);
  addMetric('Gross Shrinkage $', s.grossShrinkage, FMT_MONEY);
  addMetric('Gross Overage $', s.grossOverage, FMT_MONEY);

  // Systemic notes block.
  const notes = systemicNotes(rows, s);
  if (notes.length > 0) {
    r++;
    ws.mergeCells(`A${r}:B${r}`);
    const hdr = ws.getCell(`A${r}`);
    hdr.value = 'Systemic notes';
    styleHeaderRow(ws, r);
    r++;
    for (const note of notes) {
      ws.mergeCells(`A${r}:B${r}`);
      const cell = ws.getCell(`A${r}`);
      cell.value = note;
      cell.alignment = { wrapText: true, vertical: 'top' };
      cell.font = { size: 11 };
      ws.getRow(r).height = 30;
      r++;
    }
  }

  void ExcelJS; // referenced for signature symmetry; styling uses constants above
  ws.views = [{ state: 'frozen', ySplit: metricsHeaderRow }];
}

/* ── Tab 2: Largest Offenders ── */
function buildOffendersSheet(wb: ExcelJSNS.Workbook, rows: AvtLikeRow[], multiVenue: boolean): void {
  const ws = wb.addWorksheet('Largest Offenders');

  const cols: Array<{ header: string; width: number }> = [
    { header: 'Item', width: 36 },
    { header: 'Category', width: 20 },
  ];
  if (multiVenue) cols.push({ header: 'Venue', width: 20 });
  cols.push(
    { header: 'Variance (qty)', width: 16 },
    { header: 'Variance $', width: 14 },
    { header: 'Variance %', width: 12 },
  );

  const writeRow = (ws_: ExcelJSNS.Worksheet, rowNum: number, r: AvtLikeRow) => {
    let c = 1;
    ws_.getCell(rowNum, c++).value = r.item_name;
    ws_.getCell(rowNum, c++).value = r.category ?? '';
    if (multiVenue) ws_.getCell(rowNum, c++).value = r.venue_name ?? '';
    const qtyCell = ws_.getCell(rowNum, c++);
    qtyCell.value = numOrBlank(r.variance);
    qtyCell.numFmt = FMT_QTY;
    if (n(r.variance) < 0) qtyCell.font = RED_FONT;
    const valCell = ws_.getCell(rowNum, c++);
    valCell.value = numOrBlank(r.variance_value);
    valCell.numFmt = FMT_MONEY;
    if (n(r.variance_value) < 0) valCell.font = RED_FONT;
    const pctCell = ws_.getCell(rowNum, c++);
    pctCell.value = numOrBlank(r.variance_pct);
    pctCell.numFmt = FMT_PCT;
    if (n(r.variance_pct) < 0) pctCell.font = RED_FONT;
  };

  const writeSection = (label: string, sorted: AvtLikeRow[], startRow: number): number => {
    let r = startRow;
    ws.mergeCells(r, 1, r, cols.length);
    const cap = ws.getCell(r, 1);
    cap.value = label;
    cap.font = { bold: true, size: 12 };
    r++;
    const headerRow = r;
    cols.forEach((col, i) => {
      ws.getCell(r, i + 1).value = col.header;
    });
    styleHeaderRow(ws, r);
    r++;
    for (const row of sorted.slice(0, 25)) {
      writeRow(ws, r, row);
      r++;
    }
    return headerRow;
  };

  cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  const byValue = [...rows].sort((a, b) => Math.abs(n(b.variance_value)) - Math.abs(n(a.variance_value)));
  const byQty = [...rows].sort((a, b) => Math.abs(n(b.variance)) - Math.abs(n(a.variance)));

  const firstHeader = writeSection('Top 25 by absolute Variance $', byValue, 1);
  const sectionTwoStart = 1 + 1 + Math.min(25, byValue.length) + 2; // caption+header+rows + gap
  writeSection('Top 25 by absolute Variance (qty)', byQty, sectionTwoStart);

  // Freeze + autofilter on the first (dollar) section's header.
  ws.views = [{ state: 'frozen', ySplit: firstHeader }];
  ws.autoFilter = {
    from: { row: firstHeader, column: 1 },
    to: { row: firstHeader + Math.min(25, byValue.length), column: cols.length },
  };
}

/* ── Tab 3: Possible Causes ── */
function buildCausesSheet(wb: ExcelJSNS.Workbook, rows: AvtLikeRow[]): void {
  const ws = wb.addWorksheet('Possible Causes');
  const headers = ['Item', 'Variance (qty)', 'Variance $', 'Likely cause'];
  const widths = [36, 16, 14, 60];
  headers.forEach((h, i) => {
    ws.getCell(1, i + 1).value = h;
    ws.getColumn(i + 1).width = widths[i];
  });
  styleHeaderRow(ws, 1);

  const material = rows.filter(isMaterial)
    .sort((a, b) => n(a.variance_value) - n(b.variance_value));

  let r = 2;
  for (const row of material) {
    ws.getCell(r, 1).value = row.item_name;
    const qtyCell = ws.getCell(r, 2);
    qtyCell.value = numOrBlank(row.variance);
    qtyCell.numFmt = FMT_QTY;
    if (n(row.variance) < 0) qtyCell.font = RED_FONT;
    const valCell = ws.getCell(r, 3);
    valCell.value = numOrBlank(row.variance_value);
    valCell.numFmt = FMT_MONEY;
    if (n(row.variance_value) < 0) valCell.font = RED_FONT;
    const causeCell = ws.getCell(r, 4);
    causeCell.value = likelyCause(row);
    causeCell.alignment = { wrapText: true, vertical: 'top' };
    r++;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

/* ── Tab 4: Detail ── */
function buildDetailSheet(
  wb: ExcelJSNS.Workbook,
  rows: AvtLikeRow[],
  multiVenue: boolean,
  hasAuditCols: boolean,
): void {
  const ws = wb.addWorksheet('Detail');

  type Col = { header: string; width: number; kind: 'text' | 'qty' | 'money' | 'pct'; get: (r: AvtLikeRow) => string | number | null };
  const cols: Col[] = [
    { header: 'Item', width: 36, kind: 'text', get: r => r.item_name },
    { header: 'Category', width: 20, kind: 'text', get: r => r.category ?? '' },
  ];
  if (multiVenue) cols.push({ header: 'Venue', width: 20, kind: 'text', get: r => r.venue_name ?? '' });
  if (hasAuditCols) {
    cols.push({ header: 'Audit', width: 12, kind: 'text', get: r => r.audit_code ?? '' });
    cols.push({ header: 'Date', width: 12, kind: 'text', get: r => r.audit_date ?? '' });
  }
  cols.push(
    { header: 'Start', width: 10, kind: 'qty', get: r => numOrBlank(r.start_qty) },
    { header: 'Purchases', width: 11, kind: 'qty', get: r => numOrBlank(r.purchases) },
    { header: 'Depletions', width: 11, kind: 'qty', get: r => numOrBlank(r.depletions) },
    { header: 'Actual', width: 10, kind: 'qty', get: r => numOrBlank(r.actual) },
    { header: 'Theoretical', width: 12, kind: 'qty', get: r => numOrBlank(r.theo) },
    { header: 'Variance (qty)', width: 14, kind: 'qty', get: r => numOrBlank(r.variance) },
    { header: 'CU Price', width: 11, kind: 'money', get: r => numOrBlank(r.cu_price) },
    { header: 'Variance $', width: 13, kind: 'money', get: r => numOrBlank(r.variance_value) },
    { header: 'Variance %', width: 12, kind: 'pct', get: r => numOrBlank(r.variance_pct) },
  );

  cols.forEach((col, i) => {
    ws.getCell(1, i + 1).value = col.header;
    ws.getColumn(i + 1).width = col.width;
  });
  styleHeaderRow(ws, 1);

  const sorted = [...rows].sort((a, b) => n(a.variance_value) - n(b.variance_value));

  let r = 2;
  for (const row of sorted) {
    cols.forEach((col, i) => {
      const cell = ws.getCell(r, i + 1);
      const v = col.get(row);
      cell.value = v;
      if (col.kind === 'money') cell.numFmt = FMT_MONEY;
      else if (col.kind === 'qty') cell.numFmt = FMT_QTY;
      else if (col.kind === 'pct') cell.numFmt = FMT_PCT;
      // Red font on negative variance / variance$ / variance% cells.
      if ((col.header === 'Variance (qty)' || col.header === 'Variance $' || col.header === 'Variance %')
          && typeof v === 'number' && v < 0) {
        cell.font = RED_FONT;
      }
    });
    r++;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}
