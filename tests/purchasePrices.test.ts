/**
 * v0.74 Purchase prices — per-bottle resolution, movers, spend, wiring.
 * Cases are shaped on real invoice lines (Ketel One 1L, St. George Spiced
 * Pear, Don Julio 1942 1.75L, Minuty) seen when the screen was built.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolvePack, priceLines, buildSeries, buildMovers, splitMovers, monthlySpend, summarize, moversCsv, periodStart, checkReason,
  type PurchaseLine,
} from '../src/lib/purchasePrices';
import { niceTicks } from '../src/screens/PurchasePrices';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const near = (a: number | null | undefined, b: number, eps = 0.005) => a != null && Math.abs(a - b) <= eps;

let n = 0;
function L(over: Partial<PurchaseLine>): PurchaseLine {
  n++;
  return {
    line_id: 'l' + n, invoice_id: 'i' + n, invoice_number: String(1000 + n), invoice_date: '2026-09-01',
    venue_id: 'v1', venue_name: 'Delilah LA', vendor_name: 'SGWS', item_id: 'ketel', item_name: 'Ketel One 1L',
    category: 'Liquor', qty: 1, unit_cost: 21, line_total: 21, liters: 1, ...over,
  };
}

// ── resolvePack: step 1, a known pack ──────────────────────────────────
{
  const r = resolvePack(L({ unit_cost: 252, cu_qty: 12, ref_venue: 21 }));
  check('case of 12 from cu_qty, checked against the venue cost', r.pack === 12 && /case of 12/.test(r.basis), r);
}
{
  const r = resolvePack(L({ unit_cost: 288, cu_qty: 1, ref_sister: 24, liters: 0.75 }));
  check('cu_qty 1 on a case line is not trusted: inferred case of 12', r.pack === 12, r);
}
{
  const r = resolvePack(L({ unit_cost: 21, cu_qty: 12, ref_venue: 21 }));
  check('per-bottle price with a case size on the line = priced per bottle', r.pack === 1, r);
}
{
  const r = resolvePack(L({ unit_cost: 192, map_pack: 12, cu_qty: 6, ref_venue: 16, liters: 0.75 }));
  check('mapped pack wins over cu_qty', r.pack === 12 && /mapped pack/.test(r.basis), r);
}

// ── resolvePack: step 2, inference from a reference ────────────────────
{
  const r = resolvePack(L({ unit_cost: 126, ref_venue: 21 }));
  check('Ketel One $126 = half case (6), not a 50% price drop', r.pack === 6, r);
}
{
  const r = resolvePack(L({ unit_cost: 21.5, ref_catalog: 21 }));
  check('bottle price matching the catalog cost = 1', r.pack === 1 && /catalog cost/.test(r.basis), r);
}
{
  const r = resolvePack(L({ unit_cost: 1101.45, liters: 1.75, ref_sister: 285.39, item_name: 'Don Julio 1942 1.75L' }));
  check('Don Julio 1942 1.75L: $1,101.45 is a case of 4 (3 also fits 1.5x, 4 is the clear winner)', r.pack === 4, r);
}
{
  const r = resolvePack(L({ unit_cost: 1101.45, liters: 0.75, ref_sister: 285.39 }));
  check('4 is only a candidate for large formats', r.pack !== 4, r);
}
{
  const r = resolvePack(L({ unit_cost: 868.5, liters: 0.75, ref_venue: 301.5, item_name: "Dom Perignon, 'Luminous Brut', Champagne 750ml" }));
  check('Dom Perignon Luminous 750ml: $868.50 is a case of 3, not of 6', r.pack === 3 && Math.abs(868.5 / 3 - 289.5) < 0.01, r);
}
{
  const r = resolvePack(L({ unit_cost: 200, ref_venue: 23.5, liters: 0.75 }));
  check('two packs fit about equally (6 and 12) -> unresolved', r.pack === null && /more than one/.test(r.basis), r);
}
{
  const r = resolvePack(L({ unit_cost: 1000, ref_venue: 21 }));
  check('nothing lands near the reference -> unresolved', r.pack === null && /no case size lands/.test(r.basis), r);
}
{
  const r = resolvePack(L({ unit_cost: 147, dpk: 6, ref_venue: 24.5, liters: 0.75 }));
  check('description pack within 2x of the reference', r.pack === 6 && /description/.test(r.basis), r);
}

// ── resolvePack: step 3, no reference ──────────────────────────────────
{
  const r = resolvePack(L({ unit_cost: 147, dpk: 6, liters: 0.75 }));
  check('no reference: description pack used when plausible per litre — and NOT weak (the second pass must not override it)', r.pack === 6 && r.source === 'description' && !r.weak, r);
}
{
  const r = resolvePack(L({ unit_cost: 90, liters: 0.75 }));
  check('no reference and no pack -> unresolved', r.pack === null, r);
}
{
  const r = resolvePack(L({ unit_cost: 0 }));
  check('no unit price -> unresolved', r.pack === null && /no unit price/.test(r.basis), r);
}

// ── priceLines ─────────────────────────────────────────────────────────
{
  const p = priceLines([L({ unit_cost: 252, qty: 3, line_total: 756, cu_qty: 12, ref_venue: 21 })])[0];
  check('per bottle and bottles', near(p.perBottle, 21) && p.bottles === 36 && p.excluded === null, p);
  check('spend = line total', p.spend === 756, p.spend);
}
{
  const [d, c, ni, np] = priceLines([
    L({ dup_of: '2577968', line_total: 1101.44 }),
    L({ is_credit: true, unit_cost: 196.8, line_total: 196.8 }),
    L({ item_id: null, line_total: 50 }),
    L({ unit_cost: 0, line_total: 0 }),
  ]);
  check('duplicate copy: excluded, no spend', d.excluded === 'duplicate' && d.spend === 0, d);
  check('credit: excluded from prices, NEGATIVE spend (credits arrive positive with is_credit)', c.excluded === 'credit' && c.spend === -196.8, c);
  check('no item: excluded from prices, still in spend', ni.excluded === 'no item' && ni.spend === 50, ni);
  check('no unit price: excluded', np.excluded === 'no price', np);
}
{
  // St. George Spiced Pear at two venues, no cost on file anywhere: three
  // lines settle it at ~$24.50; a $288 case line with cu_qty 1 would read as a
  // $288 bottle (plausible per litre!) unless the item's other lines overrule it.
  const sg = { item_id: 'stg', item_name: 'St. George Spiced Pear Liqueur 750ml', liters: 0.75 };
  const out = priceLines([
    L({ ...sg, venue_id: 'v2', unit_cost: 147, dpk: 6, qty: 2, line_total: 294 }),
    L({ ...sg, venue_id: 'v2', unit_cost: 24.5, dpk: 6, qty: 12, line_total: 294 }),
    L({ ...sg, venue_id: 'v1', unit_cost: 26, cu_qty: 1, qty: 6, line_total: 156 }),
    L({ ...sg, venue_id: 'v1', unit_cost: 288, cu_qty: 1, qty: 1, line_total: 288 }),
  ]);
  const last = out[3];
  check('weak $288 "bottle" corrected to a case of 12 by the item\'s other invoices', last.pack === 12 && near(last.perBottle, 24) && /corrected/.test(last.basis), last);
  check('lines that agree with their siblings are left alone', out[2].pack === 1 && !/corrected/.test(out[2].basis), out[2]);
}
{
  const sg = { item_id: 'x', liters: 0.75 };
  const out = priceLines([
    L({ ...sg, unit_cost: 24, cu_qty: 1 }),
    L({ ...sg, unit_cost: 288, cu_qty: 1 }),
  ]);
  check('a weak line with fewer than 3 siblings is not overruled', out[1].pack === 1, out[1]);
}
{
  const out = priceLines([
    L({ item_id: 'y', unit_cost: 22, ref_venue: 21 }),
    L({ item_id: 'y', unit_cost: 22.5, ref_venue: 21 }),
    L({ item_id: 'y', unit_cost: 270, liters: 1 }),
  ]);
  check('an unresolved line is resolved against the item\'s other invoices', out[2].pack === 12 && near(out[2].perBottle, 22.5), out[2]);
}

// ── series + movers ────────────────────────────────────────────────────
const KO = { item_id: 'ketel', item_name: 'Ketel One 1L', ref_venue: 21, cu_qty: 12 };
const hist = priceLines([
  L({ ...KO, invoice_id: 'a', invoice_number: 'A', invoice_date: '2026-08-01', unit_cost: 240, qty: 2, line_total: 480, vendor_name: 'SGWS' }),
  L({ ...KO, invoice_id: 'b', invoice_number: 'B', invoice_date: '2026-09-01', unit_cost: 252, qty: 1, line_total: 252, vendor_name: 'SGWS' }),
  L({ ...KO, invoice_id: 'b', invoice_number: 'B', invoice_date: '2026-09-01', unit_cost: 264, qty: 1, line_total: 264, vendor_name: 'SGWS' }),
  L({ ...KO, invoice_id: 'c', invoice_number: 'C', invoice_date: '2026-10-01', unit_cost: 276, qty: 3, line_total: 828, vendor_name: 'RNDC' }),
]);
const series = buildSeries(hist);
check('one series per venue + item', series.length === 1 && series[0].points.length === 3, series);
check('two lines on one invoice collapse to a bottle-weighted price', near(series[0].points[1].perBottle, 21.5) && series[0].points[1].bottles === 24, series[0].points[1]);
const mv = buildMovers(series);
check('mover: latest vs the invoice before', mv.length === 1 && near(mv[0].prev.perBottle, 21.5) && near(mv[0].latest.perBottle, 23), mv[0]);
check('mover: % and $ per bottle', near(mv[0].pct, (1.5 / 21.5) * 100, 0.01) && near(mv[0].delta, 1.5), mv[0]);
check('mover: $ impact = change per bottle x bottles on the latest invoice', near(mv[0].impact, 1.5 * 36), mv[0].impact);
check('mover: lowest in period and how far above it', near(mv[0].best.perBottle, 20) && near(mv[0].aboveBestPct, 15, 0.01), mv[0]);
check('mover: vendor change flagged', mv[0].vendorChanged === true, mv[0]);
{
  const flat = buildMovers(buildSeries(priceLines([
    L({ ...KO, invoice_id: 'p', invoice_date: '2026-08-01', unit_cost: 252 }),
    L({ ...KO, invoice_id: 'q', invoice_date: '2026-09-01', unit_cost: 252.04 }),
  ])));
  check('a sub-cent change per bottle is not a mover', flat.length === 0, flat);
}
{
  const jump = buildMovers(buildSeries(priceLines([
    L({ item_id: 'lb', item_name: 'Chateau Lynch Bages', invoice_id: 'r', invoice_date: '2026-02-24', unit_cost: 20, cu_qty: 1, liters: 0.75 }),
    L({ item_id: 'lb', item_name: 'Chateau Lynch Bages', invoice_id: 's', invoice_date: '2026-10-13', unit_cost: 260, cu_qty: 1, liters: 0.75 }),
  ])));
  const all = [...mv, ...jump];
  const sp = splitMovers(all, 0, 'impact');
  check('doubled/halved goes to check, not to increases', jump[0]?.bigJump === true && sp.check.length === 1 && sp.up.length === 1, sp);
  const s = summarize(hist, all, new Date('2026-10-22'));
  check('summary up/down totals leave the check list out', s.upCount === 1 && near(s.upImpact, 54) && s.checkCount === 1, s);
}
{
  const a = { ...mv[0], key: 'a', pct: 10, impact: 5, delta: 1 };
  const b = { ...mv[0], key: 'b', pct: 3, impact: 50, delta: 1 };
  const c = { ...mv[0], key: 'c', pct: 1, impact: 500, delta: 1 };
  const byImpact = splitMovers([a, b, c], 2, 'impact');
  const byPct = splitMovers([a, b, c], 2, 'pct');
  check('min % filter', byImpact.up.length === 2 && !byImpact.up.some(m => m.key === 'c'), byImpact.up.map(m => m.key));
  check('rank by $ impact vs by %', byImpact.up[0].key === 'b' && byPct.up[0].key === 'a');
}

// ── monthly spend + summary ────────────────────────────────────────────
{
  const lines = priceLines([
    L({ invoice_date: '2026-08-10', line_total: 100, category: 'Liquor', venue_name: 'Delilah LA' }),
    L({ invoice_date: '2026-08-12', line_total: 50, category: 'Wine', venue_name: 'Poppy', venue_id: 'v5' }),
    L({ invoice_date: '2026-09-03', line_total: 300, category: 'Liquor', venue_name: 'Keys', venue_id: 'v6' }),
    L({ invoice_date: '2026-09-04', line_total: 40, is_credit: true, category: 'Liquor', venue_name: 'Keys', venue_id: 'v6' }),
    L({ invoice_date: '2026-09-05', line_total: 999, dup_of: 'X', category: 'Liquor' }),
    L({ invoice_date: '2026-10-02', line_total: 70, category: 'Wine', venue_name: 'Delilah LA' }),
  ]);
  const ms = monthlySpend(lines, 'category');
  check('months oldest first', ms.months.join() === '2026-08,2026-09,2026-10', ms.months);
  check('credits netted, duplicates out', ms.totals['2026-09'] === 260, ms.totals);
  check('split by category', ms.byCategory['2026-08'].Liquor === 100 && ms.byCategory['2026-08'].Wine === 50, ms.byCategory);
  const mv2 = monthlySpend(lines, 'venue', 2);
  check('groups beyond the cap fold into Other', mv2.groups.length === 2 && mv2.groups[1] === 'Other' && mv2.groups[0] === 'Keys', mv2.groups);
  const s = summarize(lines, [], new Date('2026-10-22'));
  check('headline month is the last FULL month (Oct is partial)', s.lastFullMonth === '2026-09' && s.lastFullMonthSpend === 260 && s.prevMonthSpend === 150, s);
  check('total spend', s.spend === 480, s.spend);
}

// ── review fixes (Zeus, 2026-10-22) ────────────────────────────────────
{
  // B1a: stale reference + small real move must not flip the stated pack.
  const w = { item_id: 'w1', item_name: 'Some Wine 750ml', category: 'Wine' as const, liters: 0.75, dpk: 12, ref_catalog: 30 };
  const out = priceLines([
    L({ ...w, invoice_id: 'w-a', invoice_date: '2026-08-01', unit_cost: 470, qty: 1 }),
    L({ ...w, invoice_id: 'w-b', invoice_date: '2026-09-01', unit_cost: 550, qty: 1 }),
  ]);
  check('B1a: a stated 12 within 2x of a stale reference is kept on both invoices', out[0].pack === 12 && out[1].pack === 12, out.map(o => [o.pack, o.basis]));
  const m = buildMovers(buildSeries(out));
  check('B1a: shown as the real +17%, not a fake -41%', m.length === 1 && near(m[0].pct, (550 / 470 - 1) * 100, 0.01) && !m[0].needsCheck, m[0]);
}
{
  // B1b: a genuine +60% on a stated 12-pack with no reference must stay visible.
  const w = { item_id: 'w2', category: 'Wine' as const, liters: 0.75, dpk: 12 };
  const out = priceLines([
    L({ ...w, invoice_id: 'b1', invoice_date: '2026-06-01', unit_cost: 360 }),
    L({ ...w, invoice_id: 'b2', invoice_date: '2026-07-01', unit_cost: 360 }),
    L({ ...w, invoice_id: 'b3', invoice_date: '2026-08-01', unit_cost: 360 }),
    L({ ...w, invoice_id: 'b4', invoice_date: '2026-09-01', unit_cost: 576 }),
  ]);
  check('B1b: the second pass does not "correct" a description-stated pack', out[3].pack === 12 && !/corrected/.test(out[3].basis), out[3]);
  const m = buildMovers(buildSeries(out));
  check('B1b: +60% kept as +60% (not corrected away), and routed to check: no cost on file confirms either pack', near(m[0]?.pct, 60, 0.01) && m[0].unverifiedBig && m[0].needsCheck && /no cost on file/.test(checkReason(m[0])), m[0]);
}
{
  // B1c: a real -45% closeout with a stated 12 lands within 2x of the venue cost.
  const w = { item_id: 'w3', category: 'Wine' as const, liters: 0.75, dpk: 12, ref_venue: 20 };
  const out = priceLines([
    L({ ...w, invoice_id: 'c1', invoice_date: '2026-08-01', unit_cost: 240 }),
    L({ ...w, invoice_id: 'c2', invoice_date: '2026-09-01', unit_cost: 132 }),
  ]);
  const m = buildMovers(buildSeries(out));
  check('B1c: closeout shown as -45%, not +10%', out[1].pack === 12 && near(m[0]?.pct, -45, 0.01), [out[1].pack, m[0]?.pct]);
}
{
  // An inferred pack that differs from the invoice before it: not a price change to act on.
  const out = priceLines([
    L({ ...KO, invoice_id: 'f1', invoice_date: '2026-08-01', unit_cost: 252, cu_qty: 12 }),
    L({ item_id: 'ketel', item_name: 'Ketel One 1L', ref_venue: 21, invoice_id: 'f2', invoice_date: '2026-09-01', unit_cost: 150 }),
  ]);
  check('pack inferred as 6 for the second invoice', out[1].pack === 6 && out[1].packSource === 'inferred', out[1]);
  const m = buildMovers(buildSeries(out));
  const sp = splitMovers(m, 0, 'impact');
  check('pack flip with an inferred side goes to check, not increases', m[0]?.packFlip === true && sp.check.length === 1 && sp.up.length === 0, m[0]);
  check('check reason names the pack disagreement', /case size differs \(12 vs 6\)/.test(checkReason(m[0])), checkReason(m[0]));
}
{
  const r = resolvePack(L({ unit_cost: 126, cu_qty: 12, ref_venue: 21 }));
  check('Ketel One half case with cu_qty 12: inferred 6 ($21), not 12 ($10.50)', r.pack === 6 && r.source === 'inferred', r);
}
{
  const r = resolvePack(L({ unit_cost: 540, map_pack: 12, ref_venue: 15, liters: 0.75 }));
  check('a mapped pack that does not fit the reference is NOT overridden (unresolved)', r.pack === null && /does not match/.test(r.basis), r);
  const b = resolvePack(L({ unit_cost: 540, bpc: 12, ref_venue: 15, liters: 0.75 }));
  check('same for BPC on the line', b.pack === null, b);
}
{
  const out = priceLines([
    L({ invoice_date: '2026-09-01', unit_cost: 252, cu_qty: 12, ref_venue: 21, line_total: 1008, qty: 4 }),
    L({ invoice_date: '2026-09-02', is_credit: true, unit_cost: 252, line_total: 252 }),
  ]);
  const s = summarize(out, [], new Date(2026, 9, 22));
  check('priced share ignores credits in the denominator (never over 100%)', s.pricedShare === 1, s.pricedShare);
}
{
  const out = priceLines([
    L({ invoice_date: '2026-07-10', line_total: 100 }),
    L({ invoice_date: '2026-08-10', line_total: 200 }),
    L({ invoice_date: '2026-10-05', line_total: 50 }),
  ]);
  const ms = monthlySpend(out, 'category', 8, { from: '2026-07', to: '2026-10' });
  check('empty months are emitted as $0', ms.months.join() === '2026-07,2026-08,2026-09,2026-10' && ms.totals['2026-09'] === 0, ms.months);
  const s = summarize(out, [], new Date(2026, 9, 22), { from: '2026-07', to: '2026-10' });
  check('headline month is September ($0), compared with August', s.lastFullMonth === '2026-09' && s.lastFullMonthSpend === 0 && s.prevMonthSpend === 200, s);
  check('average over full months only (Jul-Sep)', near(s.avgFullMonth, 100), s.avgFullMonth);
  const yr = monthlySpend(out, 'category', 8, { from: '2025-11', to: '2026-02' });
  check('month range crosses the year boundary', yr.months.join() === '2025-11,2025-12,2026-01,2026-02', yr.months);
}
{
  // a small move with no reference stays a normal mover
  const w = { item_id: 'w4', category: 'Wine' as const, liters: 0.75, dpk: 12 };
  const m = buildMovers(buildSeries(priceLines([
    L({ ...w, invoice_id: 'd1', invoice_date: '2026-08-01', unit_cost: 360 }),
    L({ ...w, invoice_id: 'd2', invoice_date: '2026-09-01', unit_cost: 378 }),
  ])));
  check('+5% with no reference is still a normal price change', near(m[0]?.pct, 5, 0.01) && !m[0].needsCheck, m[0]);
}
{
  const out = priceLines([L({ item_id: null, line_total: 1718.2 }), L({ unit_cost: 0, line_total: 40 })]);
  const s = summarize(out, [], new Date(2026, 9, 22));
  check('lines with no item / no price are counted for Needs review', s.unpricedOtherLines === 2 && near(s.unpricedOtherSpend, 1758.2), s);
}

// ── CSV + dates + ticks ────────────────────────────────────────────────
{
  const csv = moversCsv([{ ...mv[0], itemName: '=HYPERLINK("x")' }]);
  const rows = csv.split('\r\n');
  check('csv header + one row', rows.length === 2 && rows[0].startsWith('Item,Category,Venue'), rows[0]);
  check('csv guards formula injection in names', rows[1].startsWith(`"'=HYPERLINK(""x"")"`), rows[1]);
}
check('periodStart 12 months back = first of the month 11 months ago', periodStart(12, new Date(2026, 9, 22)) === '2025-11-01', periodStart(12, new Date(2026, 9, 22)));
check('periodStart 6', periodStart(6, new Date(2026, 9, 22)) === '2026-05-01');
check('niceTicks money axis', niceTicks(0, 278953, 4).join() === '0,100000,200000,300000', niceTicks(0, 278953, 4));
check('niceTicks small range', niceTicks(20, 24, 4).join() === '20,21,22,23,24', niceTicks(20, 24, 4));

// ── wiring ─────────────────────────────────────────────────────────────
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const app = src('src/App.tsx'); const side = src('src/components/Sidebar.tsx'); const screen = src('src/screens/PurchasePrices.tsx');
check('route gated to admin + corporate', app.includes('<Route path="/purchase-prices" element={hasCorporateAccess(user.role) ? <PurchasePrices user={user} />'));
check('nav row hidden from managers and venue management', /\{ to: '\/purchase-prices', label: 'Purchase prices', manager: false, viewer: false \}/.test(side));
check('loads through the 0107 RPC', screen.includes("supabase.rpc('kount_bev_purchase_lines', { p_from: from, p_to: to })"));
check('prices ALL lines before filtering (cross-venue references)', /const priced = useMemo\(\(\) => \(raw \? priceLines\(raw\) : \[\]\), \[raw\]\);/.test(screen));
// At least the version that shipped Purchase prices (an exact pin broke on the next bump).
check('version >= 0.74', (() => {
  const m = src('src/lib/version.ts').match(/APP_VERSION = '(\d+)\.(\d+)'/);
  return !!m && (Number(m[1]) > 0 || Number(m[2]) >= 74);
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
