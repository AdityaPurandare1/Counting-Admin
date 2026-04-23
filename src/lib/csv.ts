/** Minimal RFC-4180 CSV parser — handles quoted fields, commas inside quotes,
 *  and the "" escape. Not a replacement for papaparse, but plenty for
 *  Craftable AVT exports. Returns a 2D array of string cells; empty cells
 *  remain as empty strings. Trailing newline is tolerated. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { cur.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }  // ignore CR, handled with LF below
    if (c === '\n') {
      cur.push(field); field = '';
      if (!(cur.length === 1 && cur[0] === '')) rows.push(cur);
      cur = [];
      i++;
      continue;
    }

    field += c; i++;
  }

  // Trailing field/row
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (!(cur.length === 1 && cur[0] === '')) rows.push(cur);
  }

  return rows;
}

/** Normalize a header cell for column lookup: lowercase + collapse whitespace. */
function normHeader(h: string): string {
  return String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Match an AVT header row. Returns a column-name -> index map, or null if
 *  no plausible AVT header is found in the first 10 rows. The exact column
 *  labels from Craftable vary across exports, so matching is forgiving. */
export function findAvtHeaderColumns(rows: string[][]): {
  headerRow: number;
  cols: Record<string, number>;
} | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i].map(normHeader);
    if (!row.some(c => c.includes('store'))) continue;
    const cols: Record<string, number> = {};
    row.forEach((cell, j) => {
      if (cell.includes('store')) cols.store = j;
      if (cell === 'item' || (cell.includes('item') && !cell.includes('id'))) cols.item = j;
      if (cell === 'category' || cell.includes('category')) cols.category = j;
      if (cell.includes('actual inventory') || (cell.includes('actual') && !cell.includes('%'))) cols.actual = j;
      if (cell.includes('theo inventory') || (cell.includes('theo') && !cell.includes('%'))) cols.theo = j;
      if (cell === 'variance') cols.variance = j;
      if (cell.includes('variance value') || cell.includes('variance $')) cols.variance_value = j;
      if (cell.includes('variance %') && cell.includes('actual')) cols.variance_pct = j;
      if (cell === 'cu price' || cell === 'price' || (cell.includes('price') && !cell.includes('sale'))) cols.cu_price = j;
      if (cell === 'start' || cell.includes('start')) cols.start_qty = j;
      if (cell === 'purchases' || cell.includes('purchase')) cols.purchases = j;
      if (cell === 'depletions' || cell.includes('depletion')) cols.depletions = j;
    });
    if (cols.item !== undefined) return { headerRow: i, cols };
  }
  return null;
}

/** Parse a single cell as a number, returning null for empty/non-numeric. */
export function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/[$,]/g, '').replace(/^\((.*)\)$/, '-$1'); // handle (1,234)
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
