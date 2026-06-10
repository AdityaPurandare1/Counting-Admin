/** Minimal RFC-4180 CSV parser — handles quoted fields, commas inside quotes,
 *  and the "" escape. Not a replacement for papaparse, but plenty for the
 *  spreadsheet exports we ingest (e.g. Bevager inventory). Returns a 2D
 *  array of string cells; empty cells remain as empty strings. Trailing
 *  newline is tolerated. */
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

/** Encode a single value for CSV output: handles RFC-4180 quoting AND
 *  formula-injection protection. Cells starting with =, +, -, @, tab, or
 *  carriage return can execute as formulas when the CSV is opened in
 *  Excel/Google Sheets — we prefix those with a single quote so the
 *  spreadsheet treats them as text. Then standard quote-escape if the
 *  cell contains any character that needs quoting. */
export function csvCell(value: unknown): string {
  let s = String(value ?? '');
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
