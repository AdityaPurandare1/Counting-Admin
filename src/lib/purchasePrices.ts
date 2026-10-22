/* ───────────────────────────────────────────────────────────────────────
   Purchase prices (v0.74) — liquor and wine invoice prices, per bottle.

   Input: kount_bev_purchase_lines (migration 0107), one row per invoice line
   with the item it is about, the line's case/unit price, and hints for how
   many bottles that price covers.

   The hard part is the unit. invoice_lines.unit_cost is usually a CASE price
   (Ketel One 1L $252 = 12 × $21) and the line rarely says how many bottles:
   Craftable's cu_qty is often 1 on a case line, R365 lines carry nothing.
   resolvePack() starts from the nightly cost job's rules (0093) and departs
   from them where real invoices proved them wrong:
     1. a known pack — the invoice map, "BPC: n", or cu_qty — when its price per
        bottle lands within 2.5x of a reference cost (1.5x for cu_qty). A mapped pack or BPC that
        does not fit stays unresolved (0093's rule); only cu_qty, which is often
        1 on a case line, falls through to inference;
     2. the pack the description states, whenever it lands within 2x of the
        reference — never silently replaced by a closer candidate;
     3. otherwise the candidate pack (1, 3, 6, 12, 24, and 4 for 1.5L+) whose
        price per bottle lands within 1.5x of the reference, if exactly one does
        or the closest is within 1.25x and no other is;
     4. with no reference, the stated pack when the price per litre is plausible
        for spirits / wine ($6–$1,500/L).
   Reference = this venue's cost, else the median at the other venues, else
   the catalog cost. A second pass re-checks lines that only cu_qty decided, and
   lines still unresolved, against the median price per bottle of the same
   item's OTHER lines.

   Every line remembers where its pack came from. A price change whose two
   invoices disagree on the pack, when either pack was inferred rather than
   stated, is not a price change you can act on — it goes to the check list,
   out of the totals, along with anything that doubled or halved and any 25%+
   move where no reference cost confirmed either price's pack.

   Lines that cannot be priced per bottle stay in SPEND (dollars never need the
   pack) and are listed under "Needs review".
   ─────────────────────────────────────────────────────────────────────── */

import { csvCell } from './csv';

export type BevCategory = 'Liquor' | 'Wine';

/** One row of kount_bev_purchase_lines. Nulls are stripped server-side, so
 *  every optional field may be absent. */
export interface PurchaseLine {
  line_id: string;
  invoice_id: string;
  invoice_number?: string | null;
  invoice_date: string;            // YYYY-MM-DD
  is_credit?: boolean | null;
  dup_of?: string | null;
  venue_id: string;
  venue_name?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  item_id?: string | null;
  item_name?: string | null;
  category: BevCategory;
  route?: string | null;
  description?: string | null;
  qty?: number | null;
  unit_cost?: number | null;
  line_total?: number | null;
  gl_code?: string | null;
  cu_qty?: number | null;
  map_pack?: number | null;
  bpc?: number | null;
  dpk?: number | null;
  liters?: number | null;
  ref_venue?: number | null;
  ref_sister?: number | null;
  ref_catalog?: number | null;
}

export type Exclusion = 'duplicate' | 'credit' | 'no item' | 'no price' | 'units unclear';

/** Where a line's pack came from. 'inferred' = chosen because its price per
 *  bottle landed near a reference, not because anything said so. */
export type PackSource = 'mapped' | 'bpc' | 'line' | 'description' | 'inferred';

export interface PricedLine extends PurchaseLine {
  /** Bottles per invoice unit, or null when it could not be decided. */
  pack: number | null;
  packSource: PackSource | null;
  /** No reference cost was available to confirm the pack. */
  unverified: boolean;
  perBottle: number | null;
  bottles: number | null;
  /** How the pack was decided, or why it was not. */
  basis: string;
  /** Signed contribution to spend: credits negative, duplicates 0. */
  spend: number;
  /** Why the line is left out of price analysis; null when it is used. */
  excluded: Exclusion | null;
}

/* ── numbers ──────────────────────────────────────────────────────────── */

function num(x: unknown): number {
  const n = typeof x === 'number' ? x : x == null ? NaN : Number(x);
  return Number.isFinite(n) ? n : NaN;
}
const pos = (x: unknown): number | null => { const n = num(x); return n > 0 ? n : null; };

const LN_KNOWN = Math.log(2.5);   // a known pack must land within 2.5x (0093)
const LN_STATED = Math.log(2.0);  // the description's pack within 2x (0093)
const LN_FIT = Math.log(1.5);     // an inferred pack within 1.5x (0093)
const LN_CLOSE = Math.log(1.25);  // ...and the clear winner when two fit
const PER_LITRE = { lo: 6, hi: 1500 } as const;

function within(x: number, ref: number, lnTol: number): boolean {
  return x > 0 && ref > 0 && Math.abs(Math.log(x / ref)) <= lnTol;
}
function plausible(perBottle: number, liters: number | null): boolean {
  if (!liters || !(perBottle > 0)) return false;
  const perL = perBottle / liters;
  return perL >= PER_LITRE.lo && perL <= PER_LITRE.hi;
}

/** The reference price per bottle a pack is checked against, with its source. */
export function referenceFor(l: PurchaseLine): { value: number; source: string } | null {
  const v = pos(l.ref_venue);   if (v) return { value: v, source: "this venue's cost" };
  const s = pos(l.ref_sister);  if (s) return { value: s, source: 'cost at other venues' };
  const c = pos(l.ref_catalog); if (c) return { value: c, source: 'catalog cost' };
  return null;
}

/** `weak` = decided by cu_qty alone with no reference cost (cu_qty is often 1
 *  on a case line), or the line read as per-bottle because its stated pack was
 *  implausible. Only weak results may be corrected by the second pass. */
export interface PackResult { pack: number | null; basis: string; source?: PackSource; weak?: boolean; /** decided with no reference cost at all */ unverified?: boolean }

/** Bottles per invoice unit for one line. `refOverride` replaces the line's
 *  own reference (second pass: the item's other invoices) and skips step 1. */
export function resolvePack(l: PurchaseLine, refOverride?: { value: number; source: string }): PackResult {
  const unit = num(l.unit_cost);
  if (!(unit > 0)) return { pack: null, basis: 'no unit price on the line' };
  const ref = refOverride ?? referenceFor(l);
  const liters = pos(l.liters);
  const stated = pos(l.dpk);
  const known: { pack: number; label: string; source: PackSource } | null =
    pos(l.map_pack) != null ? { pack: pos(l.map_pack)!, label: 'mapped pack', source: 'mapped' } :
    pos(l.bpc) != null      ? { pack: pos(l.bpc)!,      label: 'BPC on the line', source: 'bpc' } :
    pos(l.cu_qty) != null   ? { pack: pos(l.cu_qty)!,   label: 'case size on the line', source: 'line' } : null;

  // 1. A known pack, checked the way the nightly cost job checks it.
  if (known && !refOverride) {
    if (ref) {
      // cu_qty gets the inference tolerance, not 0093's 2.5x: Ketel One's $126
      // half case carries cu_qty 12, and $10.50 is "within 2.5x" of $21.
      const tol = known.source === 'line' ? LN_FIT : LN_KNOWN;
      if (known.pack !== 1 && within(unit / known.pack, ref.value, tol)) {
        return { pack: known.pack, basis: `case of ${fmtPack(known.pack)} (${known.label})`, source: known.source };
      }
      if (within(unit, ref.value, tol)) return { pack: 1, basis: 'priced per bottle', source: known.source };
      // A mapping or a BPC that disagrees with the reference is a question for
      // a person, not something to override (0093 sends it to review). Only
      // cu_qty — often 1 on a case line — falls through to inference.
      if (known.source !== 'line') {
        return { pack: null, basis: `${known.label} (${fmtPack(known.pack)}) does not match ${ref.source} ($${ref.value.toFixed(2)})` };
      }
    } else if (liters == null || plausible(unit / known.pack, liters)) {
      return {
        pack: known.pack, basis: known.pack === 1 ? 'priced per bottle' : `case of ${fmtPack(known.pack)} (${known.label})`,
        source: known.source, weak: known.source === 'line', unverified: true,
      };
    }
  }

  if (ref) {
    // 2. The pack the description states, whenever it lands within 2x.
    if (stated && within(unit / stated, ref.value, LN_STATED)) {
      return { pack: stated, basis: stated === 1 ? 'priced per bottle (description)' : `case of ${fmtPack(stated)} (from the description)`, source: 'description' };
    }
    // 3. Otherwise the candidate whose price per bottle lands closest to it.
    // Prestige bottles ship in 3s at every size (Dom Perignon Luminous 750ml:
    // $904.50 = 3 x $301.50), and large formats also in 4s (Don Julio 1942
    // 1.75L: $1,101.45 = 4 x $275.36).
    const big = liters != null && liters >= 1.5;
    const cands = [...new Set([1, 3, 6, 12, 24, big ? 4 : null, known?.pack ?? null]
      .filter((p): p is number => p != null && p > 0))];
    const dist = (p: number) => Math.abs(Math.log(unit / p / ref.value));
    const fits = cands.filter(p => within(unit / p, ref.value, LN_FIT)).sort((a, b) => dist(a) - dist(b));
    // One fit; or several but the closest is within 1.25x and no other is.
    const clear = fits.length > 1 && dist(fits[0]) <= LN_CLOSE && dist(fits[1]) > LN_CLOSE;
    if (fits.length === 1 || clear) {
      const p = fits[0];
      return { pack: p, basis: p === 1 ? `priced per bottle (matches ${ref.source})` : `case of ${fmtPack(p)} (matches ${ref.source})`, source: 'inferred' };
    }
    if (fits.length > 1) return { pack: null, basis: `more than one case size fits ${ref.source} ($${ref.value.toFixed(2)})` };
    return { pack: null, basis: `no case size lands near ${ref.source} ($${ref.value.toFixed(2)})` };
  }

  // 4. No reference: only the description's pack, and only if plausible per litre.
  if (stated && plausible(unit / stated, liters)) return { pack: stated, basis: `case of ${fmtPack(stated)} (from the description)`, source: 'description', unverified: true };
  if (stated && plausible(unit, liters)) return { pack: 1, basis: 'priced per bottle (description pack implausible)', source: 'inferred', weak: true, unverified: true };
  return { pack: null, basis: 'no reference cost and no usable case size' };
}

function fmtPack(p: number): string { return Number.isInteger(p) ? String(p) : p.toFixed(2); }

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Signed spend of one line: credit memos arrive with positive totals and an
 *  is_credit flag, so they are negated here. */
export function lineSpend(l: PurchaseLine): number {
  const total = num(l.line_total);
  const amount = Number.isFinite(total) ? total : (num(l.qty) * num(l.unit_cost)) || 0;
  return l.is_credit ? -Math.abs(amount) : amount;
}

/** Price every line: pack, price per bottle, signed spend, and why a line is
 *  left out of price analysis. */
export function priceLines(lines: PurchaseLine[]): PricedLine[] {
  const weak: boolean[] = new Array(lines.length).fill(false);
  const blank = { pack: null, packSource: null, unverified: false, perBottle: null, bottles: null };
  const first: PricedLine[] = lines.map((l, i) => {
    if (l.dup_of) return { ...l, ...blank, basis: `copy of invoice ${l.dup_of}`, spend: 0, excluded: 'duplicate' };
    const spend = lineSpend(l);
    if (l.is_credit) return { ...l, ...blank, basis: 'credit', spend, excluded: 'credit' };
    if (!l.item_id) return { ...l, ...blank, basis: 'not linked to a single item', spend, excluded: 'no item' };
    if (!(num(l.unit_cost) > 0)) return { ...l, ...blank, basis: 'no unit price on the line', spend, excluded: 'no price' };
    const r = resolvePack(l);
    weak[i] = !!r.weak;
    return withPack(l, r, spend);
  });

  // Second pass: the item's own invoices as the reference. A plausible-per-litre
  // test cannot tell a $24 bottle from a $288 case of 12 (both sit inside the
  // spirits band), so a line that only cu_qty decided is re-checked against the
  // median price per bottle of the same item's OTHER lines, and its pack
  // corrected when another one lands on that median. A pack a mapping, a BPC, a
  // description or a real reference cost decided is never second-guessed —
  // that is what keeps a genuine price jump visible.
  const byItem = new Map<string, number[]>();
  for (const p of first) if (p.perBottle != null && p.item_id) {
    const a = byItem.get(p.item_id); if (a) a.push(p.perBottle); else byItem.set(p.item_id, [p.perBottle]);
  }
  return first.map((p, i) => {
    if (!p.item_id) return p;
    const unclear = p.excluded === 'units unclear';
    const weakOk = p.excluded === null && weak[i];
    if (!unclear && !weakOk) return p;
    const siblings = [...(byItem.get(p.item_id) ?? [])];
    if (weakOk) siblings.splice(siblings.indexOf(p.perBottle!), 1);   // never its own reference
    const m = median(siblings);
    if (m == null) return p;
    if (weakOk && within(p.perBottle!, m, LN_FIT)) return p;   // agrees with its siblings
    if (weakOk && siblings.length < 3) return p;                // too few siblings to overrule it
    const r = resolvePack(p, { value: m, source: "this item's other invoices" });
    if (!r.pack) return p;
    return withPack(p, { pack: r.pack, source: 'inferred', basis: weakOk ? r.basis.replace(/\)$/, ', corrected)') : r.basis }, p.spend);
  });
}

function withPack(l: PurchaseLine, r: PackResult, spend: number): PricedLine {
  if (!r.pack) return { ...l, pack: null, packSource: null, unverified: false, perBottle: null, bottles: null, basis: r.basis, spend, excluded: 'units unclear' };
  const unit = num(l.unit_cost);
  const qty = num(l.qty);
  return {
    ...l, pack: r.pack, packSource: r.source ?? 'inferred', unverified: !!r.unverified, perBottle: unit / r.pack,
    bottles: Number.isFinite(qty) ? qty * r.pack : null,
    basis: r.basis, spend, excluded: null,
  };
}

/* ── price series: one per venue + item ───────────────────────────────── */

export interface PricePoint {
  date: string;
  invoiceId: string;
  invoiceNumber: string;
  vendor: string;
  perBottle: number;   // bottle-weighted when an invoice has several lines
  bottles: number;
  casePrice: number;   // the line's price as billed (first line on the invoice)
  pack: number;        // the first line's pack
  /** The invoice's lines disagree on the pack. */
  mixedPack: boolean;
  /** At least one line's pack was inferred rather than stated. */
  inferred: boolean;
  /** At least one line had no reference cost to confirm its pack. */
  unverified: boolean;
}

export interface Series {
  key: string;
  venueId: string;
  venueName: string;
  itemId: string;
  itemName: string;
  category: BevCategory;
  points: PricePoint[];  // oldest first
}

export function buildSeries(priced: PricedLine[]): Series[] {
  const map = new Map<string, Series & { _inv: Map<string, { w: number; b: number; n: number; p: PricePoint }> }>();
  for (const l of priced) {
    if (l.excluded || l.perBottle == null || !l.item_id) continue;
    const key = `${l.venue_id}|${l.item_id}`;
    let s = map.get(key);
    if (!s) {
      s = { key, venueId: l.venue_id, venueName: l.venue_name ?? l.venue_id, itemId: l.item_id, itemName: l.item_name ?? 'Item',
            category: l.category, points: [], _inv: new Map() };
      map.set(key, s);
    }
    const b = l.bottles != null && l.bottles > 0 ? l.bottles : 0;
    const acc = s._inv.get(l.invoice_id);
    const inferred = l.packSource === 'inferred';
    if (acc) {
      acc.w += l.perBottle * (b || 1); acc.b += b; acc.n += b || 1;
      if ((l.pack ?? 1) !== acc.p.pack) acc.p.mixedPack = true;
      if (inferred) acc.p.inferred = true;
      if (l.unverified) acc.p.unverified = true;
    } else {
      s._inv.set(l.invoice_id, {
        w: l.perBottle * (b || 1), b, n: b || 1,
        p: { date: l.invoice_date, invoiceId: l.invoice_id, invoiceNumber: l.invoice_number ?? '', vendor: l.vendor_name ?? '',
             perBottle: l.perBottle, bottles: b, casePrice: num(l.unit_cost), pack: l.pack ?? 1, mixedPack: false, inferred,
             unverified: l.unverified },
      });
    }
  }
  const out: Series[] = [];
  for (const s of map.values()) {
    const points = [...s._inv.values()].map(a => ({ ...a.p, perBottle: a.w / a.n, bottles: a.b }));
    points.sort((a, b) => (a.date === b.date ? a.invoiceNumber.localeCompare(b.invoiceNumber) : a.date < b.date ? -1 : 1));
    out.push({ key: s.key, venueId: s.venueId, venueName: s.venueName, itemId: s.itemId, itemName: s.itemName, category: s.category, points });
  }
  return out;
}

/* ── movers: latest price vs the one before, per venue + item ─────────── */

export interface Mover {
  key: string;
  venueId: string;
  venueName: string;
  itemId: string;
  itemName: string;
  category: BevCategory;
  prev: PricePoint;
  latest: PricePoint;
  pct: number;          // change in price per bottle, %
  delta: number;        // $ per bottle
  impact: number;       // delta × bottles on the latest invoice
  best: PricePoint;     // lowest price per bottle in the period
  aboveBestPct: number;
  vendorChanged: boolean;
  bigJump: boolean;     // doubled or halved
  /** The two invoices disagree on the pack and at least one pack was inferred. */
  packFlip: boolean;
  /** A 25%+ change where either price had no reference cost to confirm its pack. */
  unverifiedBig: boolean;
  /** Not a price change to act on until a person has looked. */
  needsCheck: boolean;
}

/** Changes smaller than a cent per bottle are rounding, not a price move. */
const MIN_DELTA = 0.01;
const UNVERIFIED_MOVE_PCT = 25;

export function buildMovers(series: Series[]): Mover[] {
  const out: Mover[] = [];
  for (const s of series) {
    const n = s.points.length;
    if (n < 2) continue;
    const prev = s.points[n - 2], latest = s.points[n - 1];
    const delta = latest.perBottle - prev.perBottle;
    if (!(prev.perBottle > 0) || Math.abs(delta) < MIN_DELTA) continue;
    const pct = (delta / prev.perBottle) * 100;
    const best = s.points.reduce((m, p) => (p.perBottle < m.perBottle ? p : m), s.points[0]);
    const ratio = latest.perBottle / prev.perBottle;
    const bigJump = ratio >= 2 || ratio <= 0.5;
    const packFlip = (prev.pack !== latest.pack || prev.mixedPack || latest.mixedPack) && (prev.inferred || latest.inferred);
    // Liquor and wine prices rarely move 25% between two invoices; when they do
    // and nothing confirmed how many bottles either price covers, it is far more
    // often a different pack or product on the same item than a price change.
    const unverifiedBig = (prev.unverified || latest.unverified) && Math.abs(pct) >= UNVERIFIED_MOVE_PCT;
    out.push({
      key: s.key, venueId: s.venueId, venueName: s.venueName, itemId: s.itemId, itemName: s.itemName, category: s.category,
      prev, latest, pct, delta, impact: delta * latest.bottles, best,
      aboveBestPct: best.perBottle > 0 ? ((latest.perBottle - best.perBottle) / best.perBottle) * 100 : 0,
      vendorChanged: !!prev.vendor && !!latest.vendor && prev.vendor !== latest.vendor,
      bigJump, packFlip, unverifiedBig, needsCheck: bigJump || packFlip || unverifiedBig,
    });
  }
  return out;
}

/** Why a mover is on the check list, in plain words. */
export function checkReason(m: Mover): string {
  if (m.bigJump) return m.delta > 0 ? 'more than doubled' : 'halved or more';
  if (m.packFlip) return `case size differs (${fmtPack(m.prev.pack)} vs ${fmtPack(m.latest.pack)}) and one was inferred`;
  return `moved ${Math.abs(m.pct).toFixed(0)}% with no cost on file to confirm the case size`;
}

export type MoverSort = 'impact' | 'pct';

/** Increases and decreases, plus the changes a person must look at first
 *  (`check`): a price that doubled or halved, or two invoices whose packs
 *  disagree when either pack was inferred. Those are kept OUT of the up/down
 *  lists and totals — they are usually a case read as a bottle, two vintages on
 *  one item, or a misread line, not a price to negotiate on. */
export function splitMovers(movers: Mover[], minPct: number, sort: MoverSort): { up: Mover[]; down: Mover[]; check: Mover[] } {
  const shown = movers.filter(m => Math.abs(m.pct) >= minPct);
  const normal = shown.filter(m => !m.needsCheck);
  const up = normal.filter(m => m.delta > 0).sort(sort === 'impact' ? (a, b) => b.impact - a.impact : (a, b) => b.pct - a.pct);
  const down = normal.filter(m => m.delta < 0).sort(sort === 'impact' ? (a, b) => a.impact - b.impact : (a, b) => a.pct - b.pct);
  const check = shown.filter(m => m.needsCheck).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return { up, down, check };
}

/* ── spend by month ───────────────────────────────────────────────────── */

export type SpendGroup = 'category' | 'venue' | 'vendor';

/** YYYY-MM bounds; every month between them is emitted, empty ones as 0. */
export interface MonthRange { from: string; to: string }

export interface MonthlySpend {
  months: string[];                                   // YYYY-MM, oldest first
  groups: string[];                                   // biggest first, 'Other' last
  cells: Record<string, Record<string, number>>;      // month -> group -> $
  totals: Record<string, number>;                     // month -> $
  byCategory: Record<string, Record<BevCategory, number>>;
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  for (let guard = 0; (y < ty || (y === ty && m <= tm)) && guard < 600; guard++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function monthlySpend(priced: PricedLine[], groupBy: SpendGroup, maxGroups = 8, range?: MonthRange): MonthlySpend {
  const groupOf = (l: PricedLine) =>
    groupBy === 'category' ? l.category : groupBy === 'venue' ? (l.venue_name ?? l.venue_id) : (l.vendor_name ?? 'Unknown vendor');
  const totalsByGroup = new Map<string, number>();
  for (const l of priced) if (l.spend) totalsByGroup.set(groupOf(l), (totalsByGroup.get(groupOf(l)) ?? 0) + l.spend);
  const ranked = [...totalsByGroup.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const keep = new Set(ranked.length > maxGroups ? ranked.slice(0, maxGroups - 1) : ranked);
  const groups = ranked.filter(g => keep.has(g));
  if (ranked.length > keep.size) groups.push('Other');

  const cells: MonthlySpend['cells'] = {};
  const totals: MonthlySpend['totals'] = {};
  const byCategory: MonthlySpend['byCategory'] = {};
  for (const l of priced) {
    if (!l.spend) continue;
    const m = l.invoice_date.slice(0, 7);
    const g = keep.has(groupOf(l)) ? groupOf(l) : 'Other';
    (cells[m] ??= {})[g] = (cells[m][g] ?? 0) + l.spend;
    totals[m] = (totals[m] ?? 0) + l.spend;
    const c = (byCategory[m] ??= { Liquor: 0, Wine: 0 });
    c[l.category] += l.spend;
  }
  // A month with no invoices is a $0 month, not a missing one — otherwise
  // "vs the month before" silently compares against two months back.
  const seen = Object.keys(totals).sort();
  const months = range ? monthsBetween(range.from, range.to) : seen.length ? monthsBetween(seen[0], seen[seen.length - 1]) : [];
  for (const m of months) {
    totals[m] ??= 0;
    byCategory[m] ??= { Liquor: 0, Wine: 0 };
  }
  return { months, groups, cells, totals, byCategory };
}

/* ── headline numbers ─────────────────────────────────────────────────── */

export interface PriceSummary {
  spend: number;
  months: number;
  /** Average over FULL months only (the current month is partial). */
  avgFullMonth: number;
  lastFullMonth: string | null;
  lastFullMonthSpend: number;
  prevMonthSpend: number;
  upCount: number;
  upImpact: number;
  downCount: number;
  downImpact: number;
  unclearLines: number;
  unclearSpend: number;
  /** Lines in spend that are not tied to one item or have no unit price. */
  unpricedOtherLines: number;
  unpricedOtherSpend: number;
  duplicateLines: number;
  checkCount: number;
  /** Share of purchase spend (credits and copies left out) priced per bottle, 0..1. */
  pricedShare: number;
}

/** `today` is injectable for tests; the current month is partial, so the
 *  headline month is the last FULL one. */
export function summarize(priced: PricedLine[], movers: Mover[], today: Date = new Date(), range?: MonthRange): PriceSummary {
  const ms = monthlySpend(priced, 'category', 8, range);
  const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const full = ms.months.filter(m => m < curMonth);
  const last = full.length ? full[full.length - 1] : null;
  const prev = full.length > 1 ? full[full.length - 2] : null;
  const spend = priced.reduce((s, l) => s + l.spend, 0);
  const unclear = priced.filter(l => l.excluded === 'units unclear');
  const other = priced.filter(l => l.excluded === 'no item' || l.excluded === 'no price');
  const purchases = priced.filter(l => l.excluded !== 'credit' && l.excluded !== 'duplicate').reduce((s, l) => s + l.spend, 0);
  const pricedSpend = priced.filter(l => !l.excluded).reduce((s, l) => s + l.spend, 0);
  const up = movers.filter(m => m.delta > 0 && !m.needsCheck), down = movers.filter(m => m.delta < 0 && !m.needsCheck);
  return {
    spend,
    months: ms.months.length,
    avgFullMonth: full.length ? full.reduce((s, m) => s + ms.totals[m], 0) / full.length : 0,
    lastFullMonth: last,
    lastFullMonthSpend: last ? ms.totals[last] : 0,
    prevMonthSpend: prev ? ms.totals[prev] : 0,
    upCount: up.length,
    upImpact: up.reduce((s, m) => s + m.impact, 0),
    downCount: down.length,
    downImpact: down.reduce((s, m) => s + m.impact, 0),
    unclearLines: unclear.length,
    unclearSpend: unclear.reduce((s, l) => s + l.spend, 0),
    unpricedOtherLines: other.length,
    unpricedOtherSpend: other.reduce((s, l) => s + l.spend, 0),
    duplicateLines: priced.filter(l => l.excluded === 'duplicate').length,
    checkCount: movers.filter(m => m.needsCheck).length,
    pricedShare: purchases > 0 ? Math.min(1, pricedSpend / purchases) : 0,
  };
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

export function moversCsv(rows: Mover[]): string {
  const head = ['Item', 'Category', 'Venue', 'Vendor', 'Previous $/bottle', 'Previous invoice', 'Previous date',
    'Latest $/bottle', 'Latest invoice', 'Latest date', 'Change %', 'Change $/bottle', 'Bottles on latest invoice',
    '$ impact on latest invoice', 'Best $/bottle in period', 'Above best %'];
  const out = [head.map(csvCell).join(',')];
  for (const m of rows) {
    out.push([
      m.itemName, m.category, m.venueName, m.latest.vendor,
      m.prev.perBottle.toFixed(2), m.prev.invoiceNumber, m.prev.date,
      m.latest.perBottle.toFixed(2), m.latest.invoiceNumber, m.latest.date,
      m.pct.toFixed(1), m.delta.toFixed(2), String(round2(m.latest.bottles)), m.impact.toFixed(2),
      m.best.perBottle.toFixed(2), m.aboveBestPct.toFixed(1),
    ].map(csvCell).join(','));
  }
  return out.join('\r\n');
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Months back from today as an ISO date (first day of that month). */
export function periodStart(monthsBack: number, today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
