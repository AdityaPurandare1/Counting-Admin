import type { MasterItem } from './types';

/** Parse a Bevager 'Director' inventory XLSX workbook and pull the item rows
 *  from the '2. Inventory' sheet (column layout observed from a real export).
 *  Returns both the raw cells and a normalized name for matching.
 *
 *  Reading is done with `exceljs` (lazy-loaded). This replaced `xlsx`
 *  (SheetJS), which had two open advisories with no patch available
 *  (prototype pollution + ReDoS); exceljs is actively maintained and free of
 *  those CVEs. */

export interface BevagerRow {
  name: string;             // raw ITEM column
  cu: string;               // container unit (e.g. '750ml', '1each')
  category: string;         // e.g. '5320 - Wine Cost'
  quantity: number;         // on-hand count
}

// Hard cap on workbook size. Bounding the input size keeps the worst-case
// CPU/memory burn predictable even if a malicious file gets uploaded. Real
// Bevager exports are typically <2 MB; 10 MB is generous headroom while
// still well below "spike the tab for minutes."
const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

// Coerce an ExcelJS cell value into the plain string/number the old
// sheet_to_json (xlsx) path produced, so downstream column detection and
// matching keys stay byte-for-byte identical.
//
// ExcelJS cell `.value` can be: string | number | boolean | Date | null |
// { richText: [...] } | { formula, result } | { hyperlink, text } |
// { sharedFormula, result } | { error }. We unwrap the rich variants to
// their visible text/value; anything we can't resolve becomes ''.
function cellValue(value: unknown): string | number {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // Rich text: concatenate the run texts.
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: unknown }>)
        .map(r => (r && typeof r.text === 'string' ? r.text : ''))
        .join('');
    }
    // Formula / shared formula: prefer the computed result.
    if ('result' in v) return cellValue(v.result);
    // Hyperlink: the displayed text is what a human reads in the cell.
    if ('text' in v) return cellValue(v.text);
    // Error cells (e.g. { error: '#N/A' }) have no usable value.
  }
  return '';
}

export async function parseBevagerWorkbook(file: File): Promise<BevagerRow[]> {
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new Error(`Workbook is ${Math.round(file.size / 1024 / 1024)} MB — limit is ${MAX_WORKBOOK_BYTES / 1024 / 1024} MB.`);
  }
  // Lazy-load exceljs so the main bundle stays lean for counters / managers
  // who never open the Catalog import path. exceljs is CommonJS: bundlers
  // (Vite/Rollup) hoist its exports onto the namespace, but raw Node ESM nests
  // them under `.default`. Resolve both so `ExcelJS.Workbook` works either way.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod);
  const buf = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    (async () => {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      // Mirror the old sheet selection: prefer a sheet whose name matches
      // /inventory/i, else the 2nd sheet, else the 1st.
      const ws =
        wb.worksheets.find(s => /inventory/i.test(s.name)) ||
        wb.worksheets[1] ||
        wb.worksheets[0];
      if (!ws) { reject(new Error('Workbook has no sheets')); return; }

      // Build dense, 0-based rows of arrays matching xlsx's
      // sheet_to_json({ header: 1, defval: '' }) output: every used row is
      // present, every cell is a string/number (empty -> ''), and column
      // index 0 == spreadsheet column A. ExcelJS rows/cells are 1-based and
      // sparse, so we expand them explicitly.
      const rows: Array<Array<string | number>> = [];
      ws.eachRow({ includeEmpty: true }, (row) => {
        const arr: Array<string | number> = [];
        // cellCount is the highest populated column (1-based). Walk 1..N and
        // emit a value for each, defaulting empties to '' (defval behavior).
        const last = row.cellCount;
        for (let c = 1; c <= last; c++) {
          arr.push(cellValue(row.getCell(c).value));
        }
        rows.push(arr);
      });

        // Find the header row. A naive "any cell starts with ITEM" check
        // false-positives on rows like "ITEMIZED CHANGES" in section
        // headers; we require at least 3 of the expected columns (ID, CU,
        // ITEM, CATEGORY, QUANTITY) to be present before locking in.
        let headerIdx = -1;
        const colIdx: Record<string, number> = {};
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const r = rows[i].map(c => String(c || '').trim().toUpperCase());
          const tentative: Record<string, number> = {};
          r.forEach((cell, j) => {
            if (cell === 'ID' || cell.startsWith('ID '))         tentative.id = j;
            if (cell === 'CU' || cell.startsWith('CU '))         tentative.cu = j;
            if (cell === 'ITEM' || cell.startsWith('ITEM '))     tentative.item = j;
            if (cell.startsWith('CATEGORY'))                     tentative.category = j;
            if (cell.startsWith('QUANTITY'))                     tentative.quantity = j;
          });
          if (Object.keys(tentative).length >= 3 && tentative.item !== undefined) {
            headerIdx = i;
            Object.assign(colIdx, tentative);
            break;
          }
        }
        if (headerIdx < 0 || colIdx.item === undefined) {
          reject(new Error('No ITEM column found — is this the Bevager Director inventory export?'));
          return;
        }

      const out: BevagerRow[] = [];
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[colIdx.item] || '').trim();
        if (!name) continue;
        // Number() of any non-numeric string is NaN, which then rides
        // through to the preview / CSV export as the literal "NaN".
        // Coerce to 0 explicitly so neither the UI nor any consumer sees
        // it.
        const rawQty = row[colIdx.quantity ?? -1];
        const qty = Number(rawQty);
        out.push({
          name,
          cu:       String(row[colIdx.cu ?? -1] || '').trim(),
          category: String(row[colIdx.category ?? -1] || '').trim(),
          quantity: Number.isFinite(qty) ? qty : 0,
        });
      }
      resolve(out);
    } catch (e) {
      reject(e);
    }
    })();
  });
}

/* ---------- Name normalization ----------
   Two keys per name:
     strictKey  keeps the size suffix (e.g. '750ml', '1l') so
                'campari 750ml' only matches 'Campari 750ml'.
     looseKey   drops size + year so we can fall back when the
                purchase_items row doesn't include the size.
*/

function foldPunctuation(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripYear(s: string): string {
  return s.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
}

const SIZE_RX = /\s*(\d+(?:\.\d+)?\s*(?:ml|oz|fl\.?oz|l|lb|lbs|kg|g|each|ea|ct|cl|gal|qt|pt))\s*$/i;

function stripSize(s: string): string {
  return s.replace(SIZE_RX, '').trim();
}

export function strictKey(name: string): string {
  return stripYear(foldPunctuation(name));
}

export function looseKey(name: string): string {
  return stripSize(strictKey(name));
}

/* ---------- Matching ---------- */

export interface MatchResult {
  /** XLSX row that produced this match. */
  bevager: BevagerRow;
  /** master_items.id we'll mark as carried. null = unmatched. */
  masterItemId: string | null;
  /** How we got to that id. */
  confidence: 'strict' | 'loose-size-in-name' | 'loose-first' | 'unmatched';
  /** Optional human-readable name of the chosen master_items row. */
  matchedName?: string;
  /** How many candidate rows shared the loose key (useful for the report). */
  candidateCount?: number;
}

/** Decide which master_items row (if any) an XLSX row should flag.
 *
 *  Post Path B this matches against master_items instead of purchase_items.
 *  master_items has no `upc` column (UPCs live in master_item_upcs); the
 *  tie-breaker that used to prefer UPC-bearing rows is replaced with a
 *  size-attribute preference using base_size + base_unit. */
export function matchBevagerRows(rows: BevagerRow[], catalog: MasterItem[]): MatchResult[] {
  const strictMap = new Map<string, MasterItem[]>();
  const looseMap  = new Map<string, MasterItem[]>();
  for (const it of catalog) {
    const s = strictKey(it.name);
    const l = looseKey(it.name);
    if (!strictMap.has(s)) strictMap.set(s, []);
    strictMap.get(s)!.push(it);
    if (!looseMap.has(l)) looseMap.set(l, []);
    looseMap.get(l)!.push(it);
  }

  return rows.map(r => {
    const strict = strictMap.get(strictKey(r.name));
    if (strict && strict.length === 1) {
      return { bevager: r, masterItemId: strict[0].id, confidence: 'strict', matchedName: strict[0].name, candidateCount: 1 };
    }
    if (strict && strict.length > 1) {
      // Multiple strict hits — prefer the one whose name doesn't include a
      // size suffix (the base SKU), else first.
      const noSize = strict.find(x => !/\b\d+(\.\d+)?\s*(ml|l|oz|fl\.?\s*oz)\b/i.test(x.name));
      const pick = noSize || strict[0];
      return { bevager: r, masterItemId: pick.id, confidence: 'strict', matchedName: pick.name, candidateCount: strict.length };
    }

    const loose = looseMap.get(looseKey(r.name));
    if (!loose || loose.length === 0) {
      return { bevager: r, masterItemId: null, confidence: 'unmatched', candidateCount: 0 };
    }

    // Tie-break for loose: prefer a row whose original name contains the
    // XLSX size literal (e.g. '750ml'); fall back to base_size attribute
    // match; then the first row alphabetically.
    const sizeHint = extractSizeHint(r.name, r.cu);
    let pick: MasterItem | undefined;
    if (sizeHint) {
      const n = foldPunctuation(sizeHint);
      pick = loose.find(x => foldPunctuation(x.name).includes(n));
      // Fall back to base_size+base_unit if the size isn't embedded in name
      if (!pick) {
        const m = sizeHint.match(/(\d+(?:\.\d+)?)\s*(ml|l|oz)/i);
        if (m) {
          const v = Number(m[1]);
          const u = m[2].toLowerCase();
          pick = loose.find(x => {
            if (x.base_size == null || !x.base_unit) return false;
            return Number(x.base_size) === v && String(x.base_unit).toLowerCase() === u;
          });
        }
      }
    }
    if (pick) {
      return { bevager: r, masterItemId: pick.id, confidence: 'loose-size-in-name', matchedName: pick.name, candidateCount: loose.length };
    }
    pick = loose[0];
    return { bevager: r, masterItemId: pick.id, confidence: 'loose-first', matchedName: pick.name, candidateCount: loose.length };
  });
}

function extractSizeHint(name: string, cu: string): string | null {
  const fromName = name.match(SIZE_RX);
  if (fromName) return fromName[1].replace(/\s+/g, '').toLowerCase();
  if (cu) {
    const c = cu.replace(/\s+/g, '').toLowerCase();
    if (/^\d+(?:\.\d+)?(?:ml|oz|l|lb|each|ea|ct|kg|g|gal)$/.test(c)) return c;
  }
  return null;
}
