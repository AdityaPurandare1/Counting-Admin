import type { PurchaseItem } from './types';

/** Parse a Bevager 'Director' inventory XLSX workbook and pull the item rows
 *  from the '2. Inventory' sheet (column layout observed from a real export).
 *  Returns both the raw cells and a normalized name for matching. */

export interface BevagerRow {
  name: string;             // raw ITEM column
  cu: string;               // container unit (e.g. '750ml', '1each')
  category: string;         // e.g. '5320 - Wine Cost'
  quantity: number;         // on-hand count
}

export async function parseBevagerWorkbook(file: File): Promise<BevagerRow[]> {
  // Lazy-load xlsx so the main bundle stays lean for counters / managers who
  // never open the Catalog import path.
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    try {
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames.find(n => /inventory/i.test(n)) || wb.SheetNames[1] || wb.SheetNames[0];
      if (!sheetName) { reject(new Error('Workbook has no sheets')); return; }
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

        // Find the header row (has ITEM column)
        let headerIdx = -1;
        const colIdx: Record<string, number> = {};
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
          const r = rows[i].map(c => String(c || '').trim().toUpperCase());
          if (r.some(c => c === 'ITEM' || c.startsWith('ITEM'))) {
            headerIdx = i;
            r.forEach((cell, j) => {
              if (cell === 'ID' || cell.startsWith('ID')) colIdx.id = j;
              if (cell === 'CU' || cell.startsWith('CU '))  colIdx.cu = j;
              if (cell === 'ITEM' || cell.startsWith('ITEM')) colIdx.item = j;
              if (cell.startsWith('CATEGORY')) colIdx.category = j;
              if (cell.startsWith('QUANTITY')) colIdx.quantity = j;
            });
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
        out.push({
          name,
          cu:       String(row[colIdx.cu ?? -1] || '').trim(),
          category: String(row[colIdx.category ?? -1] || '').trim(),
          quantity: Number(row[colIdx.quantity ?? -1] || 0),
        });
      }
      resolve(out);
    } catch (e) {
      reject(e);
    }
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
  /** purchase_items.id we'll mark as carried. null = unmatched. */
  purchaseItemId: string | null;
  /** How we got to that id. */
  confidence: 'strict' | 'loose-size-in-name' | 'loose-first' | 'unmatched';
  /** Optional human-readable name of the chosen purchase_items row. */
  matchedName?: string;
  /** How many candidate rows shared the loose key (useful for the report). */
  candidateCount?: number;
}

/** Decide which purchase_items row (if any) an XLSX row should flag. */
export function matchBevagerRows(rows: BevagerRow[], catalog: PurchaseItem[]): MatchResult[] {
  const strictMap = new Map<string, PurchaseItem[]>();
  const looseMap  = new Map<string, PurchaseItem[]>();
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
      return { bevager: r, purchaseItemId: strict[0].id, confidence: 'strict', matchedName: strict[0].name, candidateCount: 1 };
    }
    if (strict && strict.length > 1) {
      // Multiple strict hits — prefer one that has a UPC (curated), else first.
      const withUpc = strict.find(x => !!(x.upc && x.upc.trim()));
      const pick = withUpc || strict[0];
      return { bevager: r, purchaseItemId: pick.id, confidence: 'strict', matchedName: pick.name, candidateCount: strict.length };
    }

    const loose = looseMap.get(looseKey(r.name));
    if (!loose || loose.length === 0) {
      return { bevager: r, purchaseItemId: null, confidence: 'unmatched', candidateCount: 0 };
    }

    // Tie-break for loose: prefer a row whose original name contains the
    // XLSX size literal (e.g. '750ml'); fall back to the UPC-bearing row;
    // then the first row alphabetically (catalog was pre-sorted).
    const sizeHint = extractSizeHint(r.name, r.cu);
    let pick: PurchaseItem | undefined;
    if (sizeHint) {
      const n = foldPunctuation(sizeHint);
      pick = loose.find(x => foldPunctuation(x.name).includes(n));
    }
    if (pick) {
      return { bevager: r, purchaseItemId: pick.id, confidence: 'loose-size-in-name', matchedName: pick.name, candidateCount: loose.length };
    }
    const withUpc = loose.find(x => !!(x.upc && x.upc.trim()));
    pick = withUpc || loose[0];
    return { bevager: r, purchaseItemId: pick.id, confidence: 'loose-first', matchedName: pick.name, candidateCount: loose.length };
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
