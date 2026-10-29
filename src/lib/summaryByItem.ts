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
 *  Legacy is_recount entries are left out of the totals, as compute_avt_for_audit
 *  leaves them out: kount_recounts is where recount results live now.
 *
 *  v0.77: totals are AFTER recount. The phone writes a "count corrected" result
 *  only to kount_recounts.count2_qty, and compute_avt_for_audit applies it, so
 *  the Summary used to show Count 1 while the variance used Count 2. finalCells
 *  applies the same overrides with the same precedence (latest Counting-App
 *  definition: 0105_poppy_missing_costs.sql, steps 4a):
 *    - per (master, zone-or-null), the latest non-dismissed recount with a
 *      count2_qty and a master link (resolved_at, else created_at; then
 *      created_at, then id);
 *    - a zoned recount REPLACES that zone's entry sum (and adds the zone if
 *      nothing was counted there);
 *    - a whole-item recount (zone null) replaces the item's total across every
 *      zone, and wins over its zoned recounts. It has no zone of its own, so it
 *      is shown under WHOLE_ITEM_ZONE. */

export interface SummaryEntry {
  master_item_id: string | null;
  item_name: string;
  qty: number | string | null;
  zone: string;
  is_recount?: boolean | null;
}

/** A kount_recounts row, as far as the final quantities need it. */
export interface RecountRow {
  id: string;
  master_item_id: string | null;
  item_name: string;
  zone: string | null;
  count2_qty: number | string | null;
  status: string;
  resolved_at: string | null;
  created_at: string;
}

/** Where a whole-item recount lands in a by-zone view. */
export const WHOLE_ITEM_ZONE = 'All zones (recount)';

export interface FinalCell {
  key: string;
  name: string;
  linked: boolean;
  zone: string;
  qty: number;
  entries: number;
  recounted: boolean;
}

export interface ItemTotal {
  key: string;
  name: string;
  linked: boolean;
  total: number;
  entries: number;
  zones: Array<{ zone: string; qty: number }>;
  recounted: boolean;
}

/** The recount rows compute_avt_for_audit would apply: one per (master, zone-or-null). */
export function effectiveRecounts(recounts: RecountRow[]): RecountRow[] {
  const latest = new Map<string, RecountRow>();
  const recency = (r: RecountRow) => r.resolved_at ?? r.created_at;
  for (const r of recounts) {
    if (!r.master_item_id || r.count2_qty == null || r.status === 'dismissed') continue;
    if (!Number.isFinite(Number(r.count2_qty))) continue;
    const k = r.master_item_id + '\u0000' + (r.zone ?? '\u0001');
    const cur = latest.get(k);
    if (!cur || isLater(r, cur, recency)) latest.set(k, r);
  }
  return [...latest.values()];
}

function isLater(a: RecountRow, b: RecountRow, recency: (r: RecountRow) => string): boolean {
  const ta = Date.parse(recency(a)), tb = Date.parse(recency(b));
  if (ta !== tb) return ta > tb;
  const ca = Date.parse(a.created_at), cb = Date.parse(b.created_at);
  if (ca !== cb) return ca > cb;
  return a.id > b.id;
}

/** Final quantity per (item, zone), recounts applied.
 *  `appliedRecounts` / `applied`: the recounts that actually CHANGED a Count 1
 *  quantity — not a zoned recount superseded by a whole-item one, and not a
 *  recount that confirmed the number already there. (`recounted` on a cell
 *  still marks any recount in effect, confirming ones included.) */
export function finalCells(entries: SummaryEntry[], recounts: RecountRow[] = []): { cells: FinalCell[]; applied: number; appliedRecounts: RecountRow[]; recountEntries: number } {
  const cells = new Map<string, FinalCell>();
  const cellKey = (key: string, zone: string) => key + '\u0000' + zone;
  let recountEntries = 0;
  for (const e of entries) {
    if (e.is_recount) { recountEntries++; continue; }
    const name = String(e.item_name || '').trim() || '(unnamed)';
    const key = e.master_item_id ? 'm:' + e.master_item_id : 'n:' + name.toLowerCase().replace(/\s+/g, ' ');
    const zone = e.zone ?? '';
    const ck = cellKey(key, zone);
    const c = cells.get(ck) ?? { key, name, linked: !!e.master_item_id, zone, qty: 0, entries: 0, recounted: false };
    c.qty += Number(e.qty) || 0;
    c.entries += 1;
    cells.set(ck, c);
  }

  const eff = effectiveRecounts(recounts);
  const appliedRecounts: RecountRow[] = [];
  const changes = (before: number, after: number) => Math.abs(before - after) > 1e-9;
  // Count 1 totals per product, before any recount, for the whole-item comparison.
  const count1Total = new Map<string, number>();
  for (const c of cells.values()) count1Total.set(c.key, (count1Total.get(c.key) ?? 0) + c.qty);
  const wholeItem = new Set(eff.filter(x => x.zone == null).map(x => 'm:' + x.master_item_id));

  // Zoned recounts first; a whole-item recount for the same product then replaces them too.
  for (const r of eff.filter(x => x.zone != null)) {
    const key = 'm:' + r.master_item_id;
    const ck = cellKey(key, r.zone as string);
    const c = cells.get(ck) ?? { key, name: nameFor(cells, key, r), linked: true, zone: r.zone as string, qty: 0, entries: 0, recounted: false };
    if (!wholeItem.has(key) && changes(c.qty, Number(r.count2_qty))) appliedRecounts.push(r);
    c.qty = Number(r.count2_qty);
    c.recounted = true;
    cells.set(ck, c);
  }
  for (const r of eff.filter(x => x.zone == null)) {
    const key = 'm:' + r.master_item_id;
    const name = nameFor(cells, key, r);
    if (changes(count1Total.get(key) ?? 0, Number(r.count2_qty))) appliedRecounts.push(r);
    let entryCount = 0;
    for (const [ck, c] of cells) if (c.key === key) { entryCount += c.entries; cells.delete(ck); }
    cells.set(cellKey(key, WHOLE_ITEM_ZONE), { key, name, linked: true, zone: WHOLE_ITEM_ZONE, qty: Number(r.count2_qty), entries: entryCount, recounted: true });
  }
  return { cells: [...cells.values()], applied: appliedRecounts.length, appliedRecounts, recountEntries };
}

/** When Counting-App migration 0118 (recount_master_link) was applied. Until
 *  then the phone (<= v2.24) wrote most recount rows without master_item_id
 *  and compute_avt_for_audit skipped them; 0118 back-linked those rows but
 *  recomputed nothing (0119 recomputed six Poppy counts, not P-373 / P-320).
 *  So a report computed before this time may lack corrections that are
 *  linked — and applied here — today, whatever their own timestamps say. */
export const RECOUNT_LINK_FIXED_AT = '2026-10-28T19:00:00Z';

/** True when the audit's stored variance report may not include every
 *  correction shown here:
 *    - there is no computed report;
 *    - the report predates RECOUNT_LINK_FIXED_AT (the row may have been linked
 *      after it was computed — its timestamps can't show that); or
 *    - an applied recount (resolved_at, else created_at — the recency compute
 *      uses) is newer than the report's computed_at.
 *  Deliberately not a per-item comparison with kount_avt_rows.actual: those
 *  rows carry only item_name (no master id) and entry names don't always match
 *  catalog names, so a comparison would flag mismatches that aren't there.
 *  Errs toward "may not include". */
export function recountsAheadOfReport(applied: RecountRow[], reportComputedAt: string | null): boolean {
  if (applied.length === 0) return false;
  if (!reportComputedAt) return true;
  const t = Date.parse(reportComputedAt);
  if (Number.isNaN(t) || t < Date.parse(RECOUNT_LINK_FIXED_AT)) return true;
  return applied.some(r => Date.parse(r.resolved_at ?? r.created_at) > t);
}

/** The counted name for a product when it has one, else the recount's own. */
function nameFor(cells: Map<string, FinalCell>, key: string, r: RecountRow): string {
  for (const c of cells.values()) if (c.key === key) return c.name;
  return String(r.item_name || '').trim() || '(unnamed)';
}

export function summarizeByItem(entries: SummaryEntry[], recounts: RecountRow[] = []): { items: ItemTotal[]; recountEntries: number; recountsApplied: number } {
  const { cells, applied, recountEntries } = finalCells(entries, recounts);
  const map = new Map<string, { name: string; linked: boolean; total: number; entries: number; zones: Map<string, number>; recounted: boolean }>();
  for (const c of cells) {
    const row = map.get(c.key) ?? { name: c.name, linked: c.linked, total: 0, entries: 0, zones: new Map<string, number>(), recounted: false };
    row.total += c.qty;
    row.entries += c.entries;
    row.recounted = row.recounted || c.recounted;
    const z = c.zone || '(no zone)';
    row.zones.set(z, (row.zones.get(z) ?? 0) + c.qty);
    map.set(c.key, row);
  }
  const items: ItemTotal[] = [...map.entries()].map(([key, r]) => ({
    key,
    name: r.name,
    linked: r.linked,
    total: round2(r.total),
    entries: r.entries,
    zones: [...r.zones.entries()].map(([zone, qty]) => ({ zone, qty: round2(qty) })).sort((a, b) => b.qty - a.qty || a.zone.localeCompare(b.zone)),
    recounted: r.recounted,
  }));
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { items, recountEntries, recountsApplied: applied };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** "Down 3 · Storage 3" */
export function zoneBreakdown(zones: Array<{ zone: string; qty: number }>): string {
  return zones.map(z => z.zone + ' ' + z.qty).join(' · ');
}
