/** Summary > By item (v0.76): one row per product, totalled across zones.
 *
 *  A venue asked for it (Alphabet, 10/26): the Summary screen only broke a
 *  count down BY ZONE, so a product counted in two places showed as two
 *  separate lines ("Krug 3" in Down, "Krug 3" in Storage) and nowhere as
 *  "Krug: 6". Pure so it can be unit-tested.
 *
 *  Grouping key: the catalog product (master_item_id) when the entry is
 *  linked, else the typed name (case/space-insensitive) -- so two spellings
 *  of one linked product still land on one row, and an unlinked entry is not
 *  silently merged into a linked one.
 *
 *  Recount entries are left out of the totals: they re-measure bottles that
 *  are already in the Count 1 entries, so adding them would count twice. */

export interface SummaryEntry {
  master_item_id: string | null;
  item_name: string;
  qty: number | string | null;
  zone: string;
  is_recount?: boolean | null;
}

export interface ItemTotal {
  key: string;
  name: string;
  linked: boolean;
  total: number;
  entries: number;
  zones: Array<{ zone: string; qty: number }>;
}

export function summarizeByItem(entries: SummaryEntry[]): { items: ItemTotal[]; recountEntries: number } {
  const map = new Map<string, { name: string; linked: boolean; total: number; entries: number; zones: Map<string, number> }>();
  let recountEntries = 0;
  for (const e of entries) {
    if (e.is_recount) { recountEntries++; continue; }
    const name = String(e.item_name || '').trim() || '(unnamed)';
    const key = e.master_item_id ? 'm:' + e.master_item_id : 'n:' + name.toLowerCase().replace(/\s+/g, ' ');
    const q = Number(e.qty) || 0;
    const row = map.get(key) ?? { name, linked: !!e.master_item_id, total: 0, entries: 0, zones: new Map<string, number>() };
    row.total += q;
    row.entries += 1;
    const z = e.zone || '(no zone)';
    row.zones.set(z, (row.zones.get(z) ?? 0) + q);
    map.set(key, row);
  }
  const items: ItemTotal[] = [...map.entries()].map(([key, r]) => ({
    key,
    name: r.name,
    linked: r.linked,
    total: round2(r.total),
    entries: r.entries,
    zones: [...r.zones.entries()].map(([zone, qty]) => ({ zone, qty: round2(qty) })).sort((a, b) => b.qty - a.qty || a.zone.localeCompare(b.zone)),
  }));
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { items, recountEntries };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** "Down 3 · Storage 3" */
export function zoneBreakdown(zones: Array<{ zone: string; qty: number }>): string {
  return zones.map(z => z.zone + ' ' + z.qty).join(' · ');
}
