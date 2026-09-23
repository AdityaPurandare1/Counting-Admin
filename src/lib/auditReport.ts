/** Bevager-format audit workbook builder.
 *
 *  Reproduces the month-end "<Venue> - Audit <date>.xlsx" that used to be
 *  produced by hand from a Bevager export. This is a VALUATION report (what
 *  was counted, where, and what it's worth) — not the variance/AVT report in
 *  varianceReport.ts, which answers a different question entirely.
 *
 *  Sheet layout, mirrored 1:1 from a real Bevager export:
 *
 *    1. Summary              CATEGORY · TOTAL · AMOUNT  (+ grand TOTAL row)
 *    2. Summary By Account   same, no total row
 *    3. Summary By Location  LOCATION · CATEGORY · QTY · AMOUNT
 *    4. Summary By Item      item × one column per location, + TOTAL
 *    5..n <account>          same layout as #4, filtered to one GL account
 *    n.. <location> - Loc    item · CU · category · subcat · bin · qty ·
 *                            CU price · amount
 *
 *  Every sheet carries the same five-row header block (Audit / venue / count
 *  name / audit date / generated on) with data starting at row 8.
 *
 *  Data provenance (validated against Poppy P-330 / 2026-08-23 by a
 *  cell-by-cell diff of a rebuilt workbook against the real export — every
 *  cell matches except the two footnote cells we add deliberately and one
 *  line that lands a cent off, an artefact of Bevager's higher-precision
 *  internal unit cost; see round()'s note):
 *    qty      kount_entries, is_recount = false, summed per (master, zone)
 *    cost     purchase_items.avg_cost — already override-adjusted, because
 *             the enforce_cost_override trigger writes kount_cost_overrides
 *             into avg_cost on every write. NOTE: that trigger and table
 *             exist in production only — they appear in no migration in
 *             either repo (0001–0050), so this claim was verified against
 *             the live database and CANNOT be verified from the repo. If
 *             prod is ever rebuilt from migrations, cost overrides silently
 *             stop being applied here.
 *    meta     master_items (name, category, subcategory, base_size/base_unit)
 *
 *  ── How to re-verify this builder against the reference ──────────────────
 *
 *  The unit tests below prove internal consistency; they cannot prove this
 *  still reproduces Bevager. That takes a diff against a real pair, and the
 *  pair is recorded here so someone who wasn't there can redo it:
 *
 *    reference   "Poppy - Bevager - Audit 2026-08-23.xlsx", the last workbook
 *                Bevager produced before this builder replaced it
 *    audit       f37935bc-d1b2-4dda-8148-e55dff76c1b0 (Poppy, join code
 *                P-330, started 2026-08-23) — 447 count lines, 262 in-scope
 *                items, 6 locations, grand total $189,219.45
 *    method      build the model from that audit's rows, write a workbook,
 *                load both with exceljs, compare every cell of every sheet.
 *                Skip header rows 2 and 5: row 2 names us rather than
 *                Bevager, row 5 is the generation date.
 *
 *  EXPECTED RESULT: 3 differing cells out of 11,536. Any other number means
 *  something changed. The three, and why each is expected:
 *
 *    "1. Summary" R15C1  the excluded-category footnote — ours, Bevager has
 *                        no such row
 *    "1. Summary" R16C1  the unpriced-items footnote — likewise ours
 *    "Service Well - Loc" R52C9  Courvoisier VS 1L, 53.62 vs our 53.63.
 *                        1.5 × 35.75 is exactly 53.625, a true half-cent
 *                        tie. Across the workbook five lines land on such a
 *                        tie and Bevager rounds three down, two up — because
 *                        its internal cost carries more precision than the
 *                        two decimals it prints. No rounding rule reproduces
 *                        all five; half-up matches four. Do not "fix" this.
 *
 *  exceljs is lazy-loaded with the same interop-resilient pattern used in
 *  bevagerImport.ts and varianceReport.ts, so the pure helpers below can be
 *  unit-tested without pulling in the workbook library. */

import type ExcelJSNS from 'exceljs';
import type { MasterItem } from '@/lib/types';

/* ───────────────────────── Types ───────────────────────── */

/** One counted line: a kount_entries row joined to its master_items row and
 *  that master's effective unit cost. One line per (entry) — the builder does
 *  the per-(item, location) summing itself. */
export interface AuditCountLine {
  masterItemId: string;
  itemName: string;
  /** Raw master_items.category. Mapped to a GL account by glAccount(); rows
   *  whose category has no GL account are excluded from the report and
   *  reported back via AuditReportModel.excluded. */
  category: string | null;
  subcategory: string | null;
  baseSize: number | null;
  baseUnit: string | null;
  /** kount_entries.zone → the report's LOCATION. */
  location: string;
  qty: number;
  /** null = unpriced; AMOUNT cells stay blank, exactly as Bevager renders them. */
  cuPrice: number | null;
}

/** One item's row on the Summary By Item / per-account sheets. */
export interface AuditItemRow {
  masterItemId: string;
  itemName: string;
  countUnit: string;
  account: string;
  subcategory: string;
  cuPrice: number | null;
  /** location → summed qty. A key is present only when that location had at
   *  least one entry for this item, which is what drives the per-location
   *  sheets — an entry counted as 0 still belongs on its location sheet,
   *  while a location that never saw the item does not. */
  byLocation: Record<string, number>;
  totalQty: number;
  /** totalQty × cuPrice, or null when unpriced. */
  totalAmount: number | null;
}

export interface AccountTotals { qty: number; amount: number }

/** Categories counted but outside the four GL accounts (e.g. Bar Consumables).
 *  Bevager omits these; we omit them too, but surface them on the Summary
 *  sheet so the gap is visible rather than silent. */
export interface ExcludedCategory {
  category: string;
  items: number;
  qty: number;
  amount: number;
}

export interface AuditReportModel {
  /** Alphabetical by item name, matching the Bevager sheets. */
  items: AuditItemRow[];
  /** Alphabetical. */
  locations: string[];
  /** Ordered by amount descending — the order Bevager lists accounts in. */
  accounts: string[];
  byAccount: Record<string, AccountTotals>;
  /** Keyed by locationAccountKey(location, account). */
  byLocationAccount: Record<string, AccountTotals>;
  totals: AccountTotals;
  excluded: ExcludedCategory[];
  /** Items in scope with no unit cost — their AMOUNT cells are blank. */
  unpricedItems: number;
}

export interface BuildAuditWorkbookOpts {
  venueName: string;
  /** Audit date, ISO `YYYY-MM-DD` (kount_audits.started_at). */
  auditDate: string;
  model: AuditReportModel;
  /** Number of recount overrides recorded for this audit. Non-zero adds a
   *  note to the Summary sheet: the report counts raw entries, so a recount
   *  correction is not reflected in these numbers.
   *
   *  Tri-state on purpose. `null` means the lookup FAILED — not that there
   *  were none — and gets its own, louder note. A failed lookup silently
   *  rendering as "no recounts" would delete the only disclosure that these
   *  figures are pre-correction. `undefined` means the caller didn't ask. */
  recountCount?: number | null;
  /** Entries that never resolved to a master_items row and so carry no
   *  category or cost. Noted on the Summary sheet when non-zero. */
  unmatchedEntries?: number;
}

/* ───────────── Pure helpers (exported for unit testing) ───────────── */

/** The four GL accounts a Bevager beverage audit reports on, each with the
 *  master_items.category spellings that map to it. The catalog carries both
 *  the Title Case ("Liquor Cost") and legacy lowercase ("liquor") forms for
 *  the same product family, and Bevager rolls both into one account. */
export const GL_ACCOUNTS: ReadonlyArray<{ account: string; categories: readonly string[] }> = [
  { account: '5310 - Liquor Cost',       categories: ['liquor cost', 'liquor'] },
  { account: '5320 - Wine Cost',         categories: ['wine cost', 'wine'] },
  { account: '5330 - Beer Cost',         categories: ['beer cost', 'beer'] },
  { account: '5335 - N/A Beverage Cost', categories: ['n/a beverage cost', 'na beverage cost', 'non_alcoholic_beverage'] },
];

const ACCOUNT_BY_CATEGORY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const { account, categories } of GL_ACCOUNTS) {
    for (const c of categories) m[c] = account;
  }
  return m;
})();

/** Map a raw master_items.category onto its GL account, or null when the
 *  category is outside the report's scope (Bar Consumables, food, …). */
export function glAccount(category: string | null | undefined): string | null {
  if (!category) return null;
  return ACCOUNT_BY_CATEGORY[category.trim().toLowerCase()] ?? null;
}

/** Trailing size token, e.g. 'Bud Light 12fl.oz' → '12floz'. Used only when
 *  the master row has no base_size/base_unit. */
const NAME_SIZE_RX = /(\d+(?:\.\d+)?)\s*(ml|cl|l|fl\.?\s*oz|oz|lbs|lb|kg|g|gal|qt|pt|each|ea|ct)\s*$/i;

/** Drop a trailing '.0' so 1 → '1' rather than '1.0'. */
function trimNumber(v: number): string {
  return String(Number(v.toFixed(4)));
}

/** Render a size + unit the way Bevager's COUNT UNIT column does: units are
 *  lower case except litres ('1L', not '1l'), and a millilitre size of a
 *  litre or more is promoted ('1000ml' → '1L', '1500ml' → '1.5L'). Anything
 *  under a litre stays as counted ('750ml', '375ml'). */
function formatCountUnit(size: number, rawUnit: string): string {
  let unit = rawUnit.trim().toLowerCase().replace(/[.\s]/g, '');
  let value = size;
  if (unit === 'ml' && value >= 1000) {
    value = value / 1000;
    unit = 'l';
  }
  if (unit === 'l') unit = 'L';
  return trimNumber(value) + unit;
}

/** The report's COUNT UNIT column: base_size + base_unit ('750' + 'ml' →
 *  '750ml'), falling back to the size token embedded in the item name for
 *  masters whose size attributes were never filled in. */
export function countUnit(
  baseSize: number | null | undefined,
  baseUnit: string | null | undefined,
  itemName: string,
): string {
  const size = Number(baseSize);
  // base_size = 0 exists in prod on masters whose size was never filled in;
  // it is "missing", not "zero millilitres", so it falls through to the name.
  if (baseSize != null && Number.isFinite(size) && size > 0 && baseUnit) {
    return formatCountUnit(size, String(baseUnit));
  }
  const m = NAME_SIZE_RX.exec(itemName || '');
  if (!m) return '';
  return formatCountUnit(Number(m[1]), m[2]);
}

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
 *  Bevager renders '5335 - N/A Beverage Cost' as '5335 - N,A Beverage Cost';
 *  we match that so sheet names line up with the files already on file.
 *
 *  Sheet names are built from zone text, which is free-form, so the other two
 *  ways exceljs throws are both reachable and both handled here: a name that
 *  starts or ends with an apostrophe (worksheet.js:159), and an empty name.
 *  The trailing trim runs again after the 31-char cut, because the cut itself
 *  can land on a space — which Excel also refuses. */
export function sheetSafe(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, ',')
    .replace(/[?*[\]:]/g, ' ')
    .replace(/^['\s]+|['\s]+$/g, '')
    .slice(0, 31)
    .replace(/['\s]+$/g, '');
  return cleaned || 'Sheet';
}

/** Hands out sheet names that exceljs will accept, remembering what it has
 *  already given out.
 *
 *  exceljs rejects a CASE-INSENSITIVE duplicate (worksheet.js:169), and zones
 *  are free text: 'Bar' and 'bar' are two separate locations by design, and
 *  two long zone names can also become the same string once cut to 31 chars.
 *  Both used to throw at the very end of a multi-second export, losing all of
 *  it. A collision now takes a numeric suffix instead, with the base cut
 *  further to keep the whole name inside Excel's 31-char budget.
 *
 *  'History' starts out taken: exceljs reserves it (worksheet.js:150) and
 *  throws on it like any other bad name, so it gets suffixed rather than
 *  becoming the one input that still breaks the promise in this doc line. */
export function makeSheetNamer(): (name: string) => string {
  const taken = new Set<string>(['history']);
  return (name: string): string => {
    const base = sheetSafe(name);
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = sheetSafe(base.slice(0, 31 - suffix.length)) + suffix;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

/** Column headers for the per-location columns on the item grids.
 *
 *  Bevager shouts them, and so do we — but upper-casing is lossy, and 'Bar',
 *  'bar' and 'BAR' are three separate locations by design (the sheet names
 *  disambiguate them; see makeSheetNamer). Three columns all headed 'BAR'
 *  with different numbers under them is worse than not shouting, so a
 *  location whose upper-cased header would be shared falls back to its raw
 *  zone text, which is unique by construction. Only the colliding ones
 *  change: in the ordinary case — the reference workbook's six distinct
 *  locations — every header is exactly what it always was. */
export function locationHeaders(locations: string[]): string[] {
  const upper = locations.map(l => l.toUpperCase());
  const counts = new Map<string, number>();
  for (const u of upper) counts.set(u, (counts.get(u) ?? 0) + 1);
  return upper.map((u, i) => ((counts.get(u) ?? 0) > 1 ? locations[i] : u));
}

/** Local calendar date (YYYY-MM-DD) — the date the user sees on screen, not
 *  the UTC one. A count started at 6pm PDT is 01:00Z the NEXT day, so an ISO
 *  slice would stamp tomorrow's date on all 14 sheet headers and on the
 *  filename. (Variance.tsx carries the same helper for the same reason.) */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Split a list into fixed-size batches. Lives here rather than in the loader
 *  so it stays importable without the Supabase client.
 *
 *  A non-positive size is a caller bug, and one that would otherwise hang the
 *  tab — `i += 0` never reaches the end of a non-empty list. Throwing follows
 *  selectAllPaged, which also fails loudly rather than returning something
 *  quietly wrong. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!(size >= 1)) throw new Error(`chunk: size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One purchase_items candidate cost, as loaded by auditReportData.ts. */
export interface PriceRow {
  id: string;
  master_item_id: string | null;
  avg_cost: number | null;
  updated_at: string | null;
}

/** Newest priced row per master — the TS side of compute_avt_for_audit's
 *  `distinct on (master_item_id) ... order by master_item_id, updated_at desc
 *  nulls last`. Pure (and here, not in the loader) so it can be tested
 *  without a client.
 *
 *  Three subtleties, all of which used to end up in the workbook:
 *    · an unparseable updated_at yields NaN, and every `NaN > x` comparison is
 *      false, so a single bad row would beat every later well-dated one
 *      forever. It is folded into -Infinity, which is also how `nulls last`
 *      behaves.
 *    · rows tied on updated_at break on the greatest id, so the pick is
 *      deterministic instead of depending on the order pages came back in.
 *    · a non-finite avg_cost is dropped at the end rather than at the start:
 *      Postgres numeric can hold NaN, and the newest row still wins the way
 *      the SQL says it does — it just leaves the master UNPRICED instead of
 *      priced at NaN. That matters because exceljs writes <v>NaN</v> and
 *      Excel then calls the whole file corrupt, whereas an unpriced item is
 *      a case every sheet already renders (blank AMOUNT). */
export function pickNewestPrices(rows: PriceRow[]): Map<string, number> {
  const best = new Map<string, { cost: number; at: number; id: string }>();
  for (const r of rows) {
    if (r.avg_cost == null || !r.master_item_id) continue;
    const parsed = r.updated_at ? new Date(r.updated_at).getTime() : NaN;
    const at = Number.isFinite(parsed) ? parsed : -Infinity;
    const id = String(r.id ?? '');
    const prev = best.get(r.master_item_id);
    if (!prev || at > prev.at || (at === prev.at && id > prev.id)) {
      best.set(r.master_item_id, { cost: Number(r.avg_cost), at, id });
    }
  }
  const out = new Map<string, number>();
  for (const [masterId, v] of best) {
    if (Number.isFinite(v.cost)) out.set(masterId, v.cost);
  }
  return out;
}

/** kount_entries.zone is typed as a string, but legacy rows reach us null or
 *  blank — and the report names a whole sheet after the zone, so it needs
 *  some label rather than none. */
export const NO_ZONE = '(no zone)';

/** The subset of a kount_entries row the report reads. Narrower than
 *  KountEntry on purpose: it is the actual contract of toCountLines, and it
 *  admits the nulls the database can really return. */
export interface AuditEntryRow {
  master_item_id: string | null;
  zone: string | null;
  qty: number | null;
}

/** Join counted entries to their master row and unit cost. Pure, so the
 *  three things that happen here — the zone coercion, the qty coercion, and
 *  the accounting for entries we can't place — are testable without a client.
 *
 *  `unresolved` is every entry that never became a line: no master_item_id at
 *  all, or a master that vanished between the count and now (merged away,
 *  deleted, or invisible under RLS). Both are the same thing to a reader of
 *  the report — a counted bottle that no sheet mentions — so they are counted
 *  together and disclosed as one number on the Summary sheet. */
export function toCountLines(
  entries: AuditEntryRow[],
  masters: Map<string, MasterItem>,
  prices: Map<string, number>,
): { lines: AuditCountLine[]; unresolved: number } {
  const lines: AuditCountLine[] = [];
  let unresolved = 0;
  for (const e of entries) {
    const id = e.master_item_id;
    const m = id ? masters.get(id) : undefined;
    if (!id || !m) {
      unresolved++;
      continue;
    }
    const qty = Number(e.qty);
    lines.push({
      masterItemId: id,
      itemName: m.name,
      category: m.category,
      subcategory: m.subcategory,
      baseSize: m.base_size,
      baseUnit: m.base_unit,
      // Coerced here, at the boundary: a null zone would otherwise reach the
      // workbook as a "null - Loc" sheet and crash the header .toUpperCase().
      location: String(e.zone ?? '').trim() || NO_ZONE,
      // Non-finite as well as null → 0: NaN or Infinity in a qty cell makes
      // Excel reject the file outright, same as a non-finite cost.
      qty: Number.isFinite(qty) ? qty : 0,
      cuPrice: prices.get(id) ?? null,
    });
  }
  return { lines, unresolved };
}

/** Key for AuditReportModel.byLocationAccount. NUL can't appear in either
 *  component, so it can't collide the way a '|', '-' or ' ' separator could
 *  — a space would fold ('Bar', 'A') and ('Bar A', '') into one bucket. The
 *  separator is written as an escape, not a raw control character, so no
 *  editor or copy-paste can quietly turn it back into a space. */
export function locationAccountKey(location: string, account: string): string {
  return location + '\u0000' + account;
}

/** Ordinary half-up rounding on the IEEE double.
 *
 *  Worth recording why it is deliberately plain: across a full 262-item audit
 *  there are five lines where qty × price lands on an exact half-cent, and
 *  Bevager rounds three of them down and two up. No single rule reproduces
 *  all five — because Bevager's internal unit cost carries more precision
 *  than the two decimals it prints (e.g. it shows 35.75 and 14.83, but its
 *  own products imply ~35.746 and ~35.833). Half-up matches four of the five
 *  and every non-tie line; the fifth is a one-cent artefact of source
 *  precision we do not have, not a rounding bug to chase. Neither banker's
 *  rounding nor an epsilon nudge does better. */
const round = (v: number, dp: number): number => {
  const f = 10 ** dp;
  const x = v * f;
  if (!Number.isFinite(x)) return v;
  return Math.round(x) / f;
};

/** Money is rounded to cents on write, matching how Bevager stores AMOUNT.
 *  Rounding happens ONLY on write: roll-ups sum full-precision products and
 *  round once at the end, so a category total is the rounded true total
 *  rather than a sum of already-rounded lines. (Summing rounded lines drifts
 *  a few cents over a 250-item audit and stops matching Bevager.) */
export const round2 = (v: number): number => round(v, 2);
/** Quantities keep four places — enough to kill float noise from summing
 *  tenths ( 0.7 + 0.2 ) without altering any real count. */
export const round4 = (v: number): number => round(v, 4);

/** Bevager renders SUBCATEGORY in Title Case; the catalog stores it however
 *  it was imported ('liqueur', 'Tequila', 'na bev'). Normalising on write is
 *  what makes the two files line up. */
export function titleCase(s: string): string {
  return s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Bevager orders items by raw code unit, not locale — which is why
 *  "MOD Brut 750ml" sorts BEFORE "Maison No. 9 Rose 750ml" ('O' < 'a').
 *  localeCompare would swap them. */
export function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Roll count lines up into everything the sheets need. Pure — no exceljs. */
export function buildAuditReportModel(lines: AuditCountLine[]): AuditReportModel {
  // 1) Group by master, keeping in-scope and out-of-scope items apart.
  const byItem = new Map<string, AuditItemRow>();
  const excluded = new Map<string, ExcludedCategory & { itemIds: Set<string> }>();
  const locationSet = new Set<string>();

  for (const line of lines) {
    const account = glAccount(line.category);
    if (!account) {
      const key = (line.category ?? '(uncategorized)').trim() || '(uncategorized)';
      let ex = excluded.get(key);
      if (!ex) {
        ex = { category: key, items: 0, qty: 0, amount: 0, itemIds: new Set() };
        excluded.set(key, ex);
      }
      ex.itemIds.add(line.masterItemId);
      ex.qty += line.qty;
      if (line.cuPrice != null) ex.amount += line.qty * line.cuPrice;
      continue;
    }

    locationSet.add(line.location);

    let item = byItem.get(line.masterItemId);
    if (!item) {
      item = {
        masterItemId: line.masterItemId,
        itemName: line.itemName,
        countUnit: countUnit(line.baseSize, line.baseUnit, line.itemName),
        account,
        subcategory: titleCase((line.subcategory ?? '').trim()),
        cuPrice: line.cuPrice,
        byLocation: {},
        totalQty: 0,
        totalAmount: null,
      };
      byItem.set(line.masterItemId, item);
    }
    // Present-but-zero is meaningful: it puts the item on that location's
    // sheet. `?? 0` (not `|| 0`) so an existing 0 isn't re-initialised.
    item.byLocation[line.location] = (item.byLocation[line.location] ?? 0) + line.qty;
  }

  // 2) Finalise per-item totals.
  const items = [...byItem.values()];
  let unpricedItems = 0;
  for (const item of items) {
    for (const loc of Object.keys(item.byLocation)) {
      item.byLocation[loc] = round4(item.byLocation[loc]);
    }
    item.totalQty = round4(Object.values(item.byLocation).reduce((a, b) => a + b, 0));
    item.totalAmount = item.cuPrice == null ? null : round2(item.totalQty * item.cuPrice);
    if (item.cuPrice == null) unpricedItems++;
  }
  items.sort((a, b) => ordinalCompare(a.itemName, b.itemName) || ordinalCompare(a.masterItemId, b.masterItemId));

  // 3) Roll up by account and by (location, account). Products are summed at
  //    full precision and rounded once, at the end — see round2's note.
  const byAccount: Record<string, AccountTotals> = {};
  const byLocationAccount: Record<string, AccountTotals> = {};
  const bump = (bucket: Record<string, AccountTotals>, key: string, qty: number, amount: number) => {
    const t = bucket[key] ?? (bucket[key] = { qty: 0, amount: 0 });
    t.qty += qty;
    t.amount += amount;
  };

  for (const item of items) {
    for (const [loc, qty] of Object.entries(item.byLocation)) {
      const amount = item.cuPrice == null ? 0 : qty * item.cuPrice;
      bump(byAccount, item.account, qty, amount);
      bump(byLocationAccount, locationAccountKey(loc, item.account), qty, amount);
    }
  }
  for (const t of [...Object.values(byAccount), ...Object.values(byLocationAccount)]) {
    t.qty = round4(t.qty);
    t.amount = round2(t.amount);
  }

  const accounts = Object.keys(byAccount).sort((a, b) => byAccount[b].amount - byAccount[a].amount);
  const totals: AccountTotals = {
    qty: round4(accounts.reduce((s, a) => s + byAccount[a].qty, 0)),
    amount: round2(accounts.reduce((s, a) => s + byAccount[a].amount, 0)),
  };

  return {
    items,
    locations: [...locationSet].sort(ordinalCompare),
    accounts,
    byAccount,
    byLocationAccount,
    totals,
    excluded: [...excluded.values()]
      .map(({ category, qty, amount, itemIds }) => ({
        category,
        items: itemIds.size,
        qty: round4(qty),
        amount: round2(amount),
      }))
      .sort((a, b) => b.amount - a.amount),
    unpricedItems,
  };
}

/* ───────────── Workbook builder (lazy exceljs) ───────────── */

const FMT_MONEY = '#,##0.00';

/** Slate header band, matching the Bevager export byte for byte. */
const HEADER_FILL: ExcelJSNS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF374151' },
};
const HEADER_FONT: Partial<ExcelJSNS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const NOTE_FONT: Partial<ExcelJSNS.Font> = { italic: true, size: 10, color: { argb: 'FF888888' } };

/** Row the data starts on. Rows 1–5 are the header block, row 6 is blank,
 *  row 7 is the column header. */
const HEADER_ROW = 7;
const FIRST_DATA_ROW = 8;

/** US-style MM/DD/YYYY, built from the ISO date's parts rather than a Date so
 *  it can't shift a day under the viewer's timezone. */
export function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** Write the five-row identification block every sheet repeats. */
function writeHeaderBlock(
  ws: ExcelJSNS.Worksheet,
  venueName: string,
  auditDate: string,
  generatedOn: string,
): void {
  ws.getCell('A1').value = 'Audit';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${venueName} - Kount`;
  ws.getCell('A2').font = { bold: true };
  ws.getCell('A3').value = `Count ${usDate(auditDate)} ${venueName}`;
  ws.getCell('A4').value = `Audit date ${usDate(auditDate)}`;
  ws.getCell('A5').value = `Generated on ${usDate(generatedOn)}`;
}

/** Write + style the column-header row and set column widths. */
function writeColumnHeaders(ws: ExcelJSNS.Worksheet, headers: string[], widths: number[]): void {
  headers.forEach((h, i) => {
    const cell = ws.getCell(HEADER_ROW, i + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    ws.getColumn(i + 1).width = widths[i] ?? 13;
  });
}

/** Write a 2dp, money-formatted cell — blank (not 0) for null, which is how
 *  Bevager renders an unpriced line. */
function money2dp(ws: ExcelJSNS.Worksheet, row: number, col: number, v: number | null): void {
  const cell = ws.getCell(row, col);
  cell.value = v == null ? null : round2(v);
  if (v != null) cell.numFmt = FMT_MONEY;
}

/** An AMOUNT cell: money, so 2dp is simply what money is. */
const amountCell = money2dp;

/** A QUANTITY cell on the two summary sheets, written with the AMOUNT
 *  treatment — 2dp and money-formatted.
 *
 *  Deliberate, and the one place quantity rounding is inconsistent on
 *  purpose: the reference Bevager workbook prints the summary TOTAL column
 *  that way, and this builder is validated by a cell-by-cell diff against it.
 *  Every other quantity in the workbook (Summary By Location, the item grids,
 *  the location sheets) keeps round4. Call it out at the call site so a future
 *  reader sees a decision rather than a copy-paste. */
const qtyAsMoneyCell = money2dp;

export async function buildAuditWorkbookBlob(opts: BuildAuditWorkbookOpts): Promise<Blob> {
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod);

  const { venueName, auditDate, model } = opts;
  const generatedOn = localIsoDate(new Date());

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Counting Admin';
  wb.created = new Date();

  const head = (ws: ExcelJSNS.Worksheet) => writeHeaderBlock(ws, venueName, auditDate, generatedOn);
  // Single door to addWorksheet: account and zone names are free text, and a
  // duplicate (even case-only) or illegal name makes exceljs throw after the
  // whole workbook has already been built. See makeSheetNamer.
  const nameFor = makeSheetNamer();
  const add: AddSheetFn = name => wb.addWorksheet(nameFor(name));

  buildSummarySheet(add, head, opts);
  buildByAccountSheet(add, head, model);
  buildByLocationSheet(add, head, model);
  buildByItemSheet(add, head, model, '4. Summary By Item', model.items);
  for (const account of model.accounts) {
    buildByItemSheet(add, head, model, account, model.items.filter(i => i.account === account));
  }
  for (const location of model.locations) {
    buildLocationSheet(add, head, model, location);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

type HeadFn = (ws: ExcelJSNS.Worksheet) => void;
/** Adds a worksheet under a name the allocator has cleared. */
type AddSheetFn = (name: string) => ExcelJSNS.Worksheet;

/* ── 1. Summary ── */
function buildSummarySheet(add: AddSheetFn, head: HeadFn, opts: BuildAuditWorkbookOpts): void {
  const { model } = opts;
  const ws = add('1. Summary');
  head(ws);
  writeColumnHeaders(ws, ['CATEGORY', 'TOTAL', 'AMOUNT'], [34, 16, 16]);

  let r = FIRST_DATA_ROW;
  for (const account of model.accounts) {
    const t = model.byAccount[account];
    ws.getCell(r, 1).value = account;
    qtyAsMoneyCell(ws, r, 2, t.qty);
    amountCell(ws, r, 3, t.amount);
    r++;
  }
  r++; // Bevager leaves one blank row before the grand total.
  ws.getCell(r, 1).value = 'TOTAL';
  qtyAsMoneyCell(ws, r, 2, model.totals.qty);
  amountCell(ws, r, 3, model.totals.amount);
  r += 2;

  // Notes. Everything below the TOTAL row is ours, not Bevager's — it exists
  // so the things this report deliberately leaves out stay visible instead of
  // quietly vanishing from a month-end number.
  const notes: string[] = [];
  for (const ex of model.excluded) {
    notes.push(
      `Excluded from this report: ${ex.category} — ${ex.items} item${ex.items === 1 ? '' : 's'}, ` +
      `${round4(ex.qty)} units, ${round2(ex.amount).toFixed(2)}. ` +
      'Bevager audits cover the four beverage GL accounts only.',
    );
  }
  if (model.unpricedItems > 0) {
    notes.push(`${model.unpricedItems} counted item${model.unpricedItems === 1 ? ' has' : 's have'} no unit cost — their AMOUNT cells are blank and they contribute 0 to these totals.`);
  }
  if (opts.unmatchedEntries) {
    notes.push(`${opts.unmatchedEntries} count entr${opts.unmatchedEntries === 1 ? 'y is' : 'ies are'} not linked to a catalog item, so they carry no category or cost and are not included.`);
  }
  if (opts.recountCount === null) {
    notes.push('Recount overrides could not be determined for this audit — the lookup failed. This report values the original count entries, so treat these figures as pre-correction.');
  } else if (opts.recountCount) {
    notes.push(`${opts.recountCount} recount override${opts.recountCount === 1 ? ' was' : 's were'} recorded for this audit. This report values the original count entries, so those corrections are not reflected here.`);
  }
  for (const note of notes) {
    const cell = ws.getCell(r, 1);
    cell.value = note;
    cell.font = NOTE_FONT;
    r++;
  }
}

/* ── 2. Summary By Account ── */
function buildByAccountSheet(add: AddSheetFn, head: HeadFn, model: AuditReportModel): void {
  const ws = add('2. Summary By Account');
  head(ws);
  writeColumnHeaders(ws, ['ACCOUNT', 'TOTAL', 'AMOUNT'], [34, 16, 16]);

  let r = FIRST_DATA_ROW;
  for (const account of model.accounts) {
    const t = model.byAccount[account];
    ws.getCell(r, 1).value = account;
    qtyAsMoneyCell(ws, r, 2, t.qty);
    amountCell(ws, r, 3, t.amount);
    r++;
  }
}

/* ── 3. Summary By Location ── */
function buildByLocationSheet(add: AddSheetFn, head: HeadFn, model: AuditReportModel): void {
  const ws = add('3. Summary By Location');
  head(ws);
  writeColumnHeaders(ws, ['LOCATION', 'CATEGORY', 'QTY', 'AMOUNT'], [18, 26, 12, 14]);

  let r = FIRST_DATA_ROW;
  for (const location of model.locations) {
    // Accounts stay in the workbook-wide order (amount desc) within each
    // location, so every sheet reads the same way down the page.
    for (const account of model.accounts) {
      const t = model.byLocationAccount[locationAccountKey(location, account)];
      if (!t) continue;
      ws.getCell(r, 1).value = location;
      ws.getCell(r, 2).value = account;
      // Plain round4, unlike the two summary sheets above — see qtyAsMoneyCell.
      ws.getCell(r, 3).value = round4(t.qty);
      amountCell(ws, r, 4, t.amount);
      r++;
    }
  }
}

/* ── 4. Summary By Item + one sheet per GL account ── */
function buildByItemSheet(
  add: AddSheetFn,
  head: HeadFn,
  model: AuditReportModel,
  sheetName: string,
  items: AuditItemRow[],
): void {
  const ws = add(sheetName);
  head(ws);

  // ID and SKU are blank in the Bevager export (its own internal ids), but the
  // columns are kept so the column letters line up with the files already on
  // file and any downstream sheet that references them.
  const headers = ['ID', 'SKU', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY',
    ...locationHeaders(model.locations), 'TOTAL'];
  const widths = [13, 13, 34, 13, 22, 16, ...model.locations.map(() => 13), 13];
  writeColumnHeaders(ws, headers, widths);

  let r = FIRST_DATA_ROW;
  for (const item of items) {
    ws.getCell(r, 3).value = item.itemName;
    ws.getCell(r, 4).value = item.countUnit;
    ws.getCell(r, 5).value = item.account;
    ws.getCell(r, 6).value = item.subcategory;
    model.locations.forEach((loc, i) => {
      // Explicit 0 (not blank) for locations that never saw this item —
      // matching the Bevager grid, which is fully dense.
      ws.getCell(r, 7 + i).value = item.byLocation[loc] ?? 0;
    });
    ws.getCell(r, 7 + model.locations.length).value = item.totalQty;
    r++;
  }
}

/* ── One sheet per location ── */
function buildLocationSheet(
  add: AddSheetFn,
  head: HeadFn,
  model: AuditReportModel,
  location: string,
): void {
  const wanted = `${location} - Loc`;
  const ws = add(wanted);
  head(ws);
  // Row 6 is the blank spacer, and it stays blank in the ordinary case so the
  // sheet keeps the reference layout. It only earns a line when the tab name
  // no longer says which zone this is — sanitised ('Walk/In' → 'Walk,In'),
  // cut at 31 chars, or suffixed '(2)' because another zone claimed the name
  // first. Then the raw zone has to be written down somewhere, or two
  // similarly-named zones are unmappable back to what was counted.
  if (ws.name !== wanted) {
    const cell = ws.getCell('A6');
    cell.value = `Location: ${location}`;
    cell.font = NOTE_FONT;
  }
  writeColumnHeaders(
    ws,
    ['ID', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY', 'BIN', 'QTY', 'CU PRICE', 'AMOUNT'],
    [13, 34, 13, 22, 16, 13, 13, 13, 13],
  );

  let r = FIRST_DATA_ROW;
  // Membership is by "was there an entry here", not "is the qty > 0" — an
  // item counted as zero in a location was still counted there.
  for (const item of model.items) {
    const qty = item.byLocation[location];
    if (qty === undefined) continue;
    ws.getCell(r, 2).value = item.itemName;
    ws.getCell(r, 3).value = item.countUnit;
    ws.getCell(r, 4).value = item.account;
    ws.getCell(r, 5).value = item.subcategory;
    // BIN (column 6) is blank — kount has no bin-level location.
    ws.getCell(r, 7).value = qty;
    ws.getCell(r, 8).value = item.cuPrice == null ? null : item.cuPrice;
    amountCell(ws, r, 9, item.cuPrice == null ? null : qty * item.cuPrice);
    r++;
  }
}
