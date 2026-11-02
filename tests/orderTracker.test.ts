/**
 * v0.79 Purchasing — Order tracker + Order prices logic, report rows, wiring.  npm test
 * Shaped on the real use: 100 cases of Delilah to-go bags ordered to the
 * warehouse, venues drawing 3–4 cases a month, quotes → invoices with numbers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  statusRank, headlineStatus, orderState, isLate, statusAfterDocument, matchDocLines, matchItem, matchOrder,
  onHand, receivedForLine, stockRows, releasesByVenue, validateNewOrder, similarity, addDays, sameVendor,
  planDocRows, planDocumentSave, documentChecks,
  type OtItem, type OtLine, type OtMove, type OtOrder, type OtDocument, type DocLine, type DocReview,
} from '../src/lib/orderTracker';
import { pricePoints, histories, priceMoves, quoteChecks, invoiceRegister, spendByMonth, isInvoiced, priceMovesCsv } from '../src/lib/orderPrices';
import { buildReportRows } from '../src/lib/orderTrackerReport';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const near = (a: number | null | undefined, b: number, eps = 0.01) => a != null && Math.abs(a - b) <= eps;

let n = 0;
const id = (p: string) => `${p}${++n}`;
const item = (over: Partial<OtItem> = {}): OtItem => ({
  id: id('i'), name: 'Delilah To-Go Bag', sku: 'DEL-TOGO', vendor_name: 'EE Mercantile', category: 'custom printed', unit: 'case',
  pack_size: 250, lead_time_days: 84, reorder_point: null, track_stock: true, notes: null, is_active: true, ...over,
});
const order = (over: Partial<OtOrder> = {}): OtOrder => ({
  id: id('o'), order_number: 'PO-100', vendor_name: 'EE Mercantile', venue_id: null, deliver_to: 'warehouse', ordered_on: '2026-08-01',
  expected_on: '2026-10-15', notes: null, completed_at: null, archived_at: null, created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z', ...over,
});
const line = (o: OtOrder, over: Partial<OtLine> = {}): OtLine => ({
  id: id('l'), order_id: o.id, item_id: null, description: 'Delilah to-go bags', sku: 'DEL-TOGO', qty: 100, unit: 'case', unit_price: 62.5,
  status: 'ORDERED', status_at: '2026-08-01T10:00:00Z', quote_number: null, invoice_number: null, invoice_date: null, tracking_number: null,
  expected_on: null, sort: 0, ...over,
});
const move = (itemId: string, kind: OtMove['kind'], qty: number, moved_on: string, over: Partial<OtMove> = {}): OtMove => ({
  id: id('m'), item_id: itemId, moved_on, kind, qty, venue_id: null, line_id: null, note: null, created_at: moved_on + 'T12:00:00Z', ...over,
});

// ── lifecycle ──────────────────────────────────────────────────────────
check('cycle order', statusRank('QUOTED') < statusRank('ORDERED') && statusRank('SHIPPED') < statusRank('DELIVERED') && statusRank('INVOICED') < statusRank('PAID'));
{
  const o = order();
  const ls = [line(o, { status: 'SHIPPED' }), line(o, { status: 'CONFIRMED' }), line(o, { status: 'CANCELLED' })];
  check('headline = least-advanced live line', headlineStatus(ls) === 'CONFIRMED', headlineStatus(ls));
  check('all cancelled -> CANCELLED; no lines -> null', headlineStatus([line(o, { status: 'CANCELLED' })]) === 'CANCELLED' && headlineStatus([]) === null);
  check('open while lines are moving', orderState(o, ls) === 'open');
  check('every live line paid -> completed', orderState(o, [line(o, { status: 'PAID' }), line(o, { status: 'CANCELLED' })]) === 'completed');
  check('marked complete wins', orderState({ ...o, completed_at: 'x' }, ls) === 'completed');
  check('archived wins over everything', orderState({ ...o, archived_at: 'x', completed_at: 'x' }, ls) === 'archived');
  check('late: expected date passed, not delivered', isLate(line(o, { status: 'SHIPPED' }), o, '2026-10-20') === true);
  check('not late once delivered', isLate(line(o, { status: 'DELIVERED' }), o, '2026-10-20') === false);
  check('line date beats order date', isLate(line(o, { status: 'ORDERED', expected_on: '2026-11-01' }), o, '2026-10-20') === false);
  check('cancelled is never late', isLate(line(o, { status: 'CANCELLED' }), o, '2026-12-01') === false);
  check('fully received is not late, whatever the status says', isLate(line(o, { status: 'SHIPPED', qty: 100 }), o, '2026-10-20', 100) === false);
  check('part received is still late', isLate(line(o, { status: 'SHIPPED', qty: 100 }), o, '2026-10-20', 40) === true);
}

// ── documents move lines forward only ──────────────────────────────────
check('invoice moves an ordered line to INVOICED', statusAfterDocument('ORDERED', 'invoice') === 'INVOICED');
check('a confirmation does not pull a shipped line back', statusAfterDocument('SHIPPED', 'confirmation') === 'SHIPPED');
check('an invoice for a paid line leaves it paid', statusAfterDocument('PAID', 'invoice') === 'PAID');
check('a quote never re-opens an ordered line', statusAfterDocument('ORDERED', 'quote') === 'ORDERED');
check('cancelled stays cancelled', statusAfterDocument('CANCELLED', 'invoice') === 'CANCELLED');
check('new line from a shipping notice starts SHIPPED', statusAfterDocument(null, 'shipping') === 'SHIPPED');
check('"other" documents change nothing', statusAfterDocument('ORDERED', 'other') === 'ORDERED' && statusAfterDocument(null, 'other') === null);

// ── matching ───────────────────────────────────────────────────────────
{
  const o = order();
  const bags = line(o, { description: 'Delilah To-Go Bag Large', sku: 'DEL-TOGO' });
  const napkins = line(o, { description: 'Bird Streets cocktail napkins', sku: 'BS-NAP' });
  const dl = (over: Partial<DocLine>): DocLine => ({ line_kind: 'product', description: '', sku: '', qty: 1, unit: 'case', unit_price: 1, line_total: 1, pack_size: 0, ...over });
  const m = matchDocLines([dl({ description: 'Napkins cocktail BS 1-ply', sku: 'BS-NAP' }), dl({ description: 'DELILAH TO GO BAG LARGE' }), dl({ description: 'Totally new thing' })], [bags, napkins]);
  check('SKU match first', m[0]?.id === napkins.id, m[0]);
  check('description match second', m[1]?.id === bags.id, m[1]);
  check('no match -> null', m[2] === null);
  const twice = matchDocLines([dl({ sku: 'DEL-TOGO', description: 'a' }), dl({ sku: 'DEL-TOGO', description: 'b' })], [bags]);
  check('one order line is matched at most once', twice[0]?.id === bags.id && twice[1] === null, twice);
  check('similarity ignores punctuation and case', similarity('Delilah To-Go Bag', 'DELILAH TO GO BAG') === 1);

  const catalog = [item({ name: 'Delilah To-Go Bag', sku: 'DEL-TOGO' }), item({ name: 'Bird Streets Napkin', sku: 'BS-NAP' }), item({ name: 'Old thing', sku: 'OLD', is_active: false })];
  check('item by SKU', matchItem(catalog, 'whatever', 'bs-nap')?.sku === 'BS-NAP');
  check('item by exact name', matchItem(catalog, 'delilah to go bag', null)?.sku === 'DEL-TOGO');
  check('inactive items never match', matchItem(catalog, 'x', 'OLD') === null);

  const o2 = order({ order_number: 'PO-2026-0042' });
  const q = line(o2, { quote_number: 'Q-881' });
  const inv = line(o2, { invoice_number: 'INV-77' });
  check('order by its PO # (normalised)', matchOrder([o, o2], [q, inv], { order_number: 'po 2026 0042', doc_number: '', kind: 'invoice' })?.id === o2.id);
  check('order by a quote # on its lines', matchOrder([o, o2], [q], { order_number: '', doc_number: 'Q-881', kind: 'confirmation' })?.id === o2.id);
  check('invoice # only matches an invoice', matchOrder([o2], [inv], { order_number: '', doc_number: 'INV-77', kind: 'invoice' })?.id === o2.id &&
    matchOrder([o2], [inv], { order_number: '', doc_number: 'INV-77', kind: 'shipping' }) === null);
  check('archived orders are never matched', matchOrder([{ ...o2, archived_at: 'x' }], [], { order_number: 'PO-2026-0042', doc_number: '', kind: 'invoice' }) === null);
  const other = order({ order_number: '1001', vendor_name: 'Uline' }), mine = order({ order_number: '1001', vendor_name: 'EE Mercantile' });
  check('the same PO # from another vendor is not matched', matchOrder([other, mine], [], { order_number: '1001', doc_number: '', kind: 'invoice', vendor_name: 'EE Mercantile LLC' })?.id === mine.id);
  check('no order from the vendor -> no match', matchOrder([other], [], { order_number: '1001', doc_number: '', kind: 'invoice', vendor_name: 'EE Mercantile' }) === null);
  check("a quote # on another vendor's order is not matched", matchOrder([o2], [q], { order_number: '', doc_number: 'Q-881', kind: 'confirmation', vendor_name: 'Uline' }) === null);
  check('vendor names: case / suffix tolerant, blank never blocks', sameVendor('ULINE', 'Uline Inc.') && sameVendor('', 'x') && !sameVendor('Uline', 'EE Mercantile'));
}

// ── warehouse stock: 100 cases in, 3–4 a month out ─────────────────────
{
  const bag = item();
  const o = order();
  const l1 = line(o, { item_id: bag.id, status: 'DELIVERED' });
  const moves = [
    move(bag.id, 'receipt', 100, '2026-07-01', { line_id: l1.id }),
    move(bag.id, 'release', 4, '2026-07-25', { venue_id: 'v1' }),
    move(bag.id, 'release', 3, '2026-08-25', { venue_id: 'v1' }),
    move(bag.id, 'release', 4, '2026-09-25', { venue_id: 'v2' }),
  ];
  check('on hand = received − released', onHand(moves) === 89);
  check('on hand as of a date', onHand(moves, '2026-08-01') === 96);
  check('a count resets, later moves apply on top', onHand([...moves, move(bag.id, 'count', 80, '2026-10-01'), move(bag.id, 'release', 2, '2026-10-05')]) === 78);
  check('same-day: creation order', onHand([move(bag.id, 'count', 10, '2026-10-01', { created_at: '2026-10-01T09:00:00Z' }), move(bag.id, 'release', 1, '2026-10-01', { created_at: '2026-10-01T10:00:00Z' })]) === 9);
  check('received per line', receivedForLine(moves, l1.id) === 100);

  const [row] = stockRows([bag], moves, [l1], [o], '2026-10-20');
  // window = the 90 days before 10/20 (from 7/22): all three releases (4+3+4 = 11) fall in it, and as
  // the first one was 7/25 the rate is measured over the 87 days since then
  const daily = 11 / 87;
  check('use per month: released in the window / days measured × 30', near(row.monthlyUse, daily * 30), row.monthlyUse);
  check('months of cover', near(row.monthsCover, 89 / (daily * 30)), row.monthsCover);
  check('reorder point default = lead time demand + 25%', near(row.reorderPoint, daily * 84 * 1.25), row.reorderPoint);
  check('reorder by: when on hand reaches the reorder point', row.reorderBy === addDays('2026-10-20', (89 - daily * 84 * 1.25) / daily), row.reorderBy);
  check('state ok with ~3 years of cover', row.state === 'ok', row.state);
  check('nothing awaiting receipt once received', row.awaitingReceipt === 0);

  const low = stockRows([bag], [move(bag.id, 'count', 5, '2026-10-01'), move(bag.id, 'release', 4, '2026-09-01'), move(bag.id, 'release', 4, '2026-10-10')], [], [o], '2026-10-20')[0];
  check('reorder now when on hand is under the reorder point', low.state === 'reorder now', low);

  // on order / awaiting receipt
  const o2 = order({ order_number: 'PO-101' });
  const shipped = line(o2, { item_id: bag.id, status: 'SHIPPED', qty: 50 });
  const quoted = line(o2, { item_id: bag.id, status: 'QUOTED', qty: 999 });
  const cancelled = line(o2, { item_id: bag.id, status: 'CANCELLED', qty: 999 });
  const delivered = line(o2, { item_id: bag.id, status: 'DELIVERED', qty: 30 });
  const toVenue = order({ order_number: 'PO-102', deliver_to: 'venue' });
  const venueLine = line(toVenue, { item_id: bag.id, status: 'SHIPPED', qty: 999 });
  const r2 = stockRows([bag], [move(bag.id, 'receipt', 10, '2026-10-02', { line_id: delivered.id })], [shipped, quoted, cancelled, delivered, venueLine], [o2, toVenue], '2026-10-20')[0];
  check('incoming: every unreceived unit on open warehouse orders (not quotes, not cancelled, not venue deliveries)', r2.incoming === 70, r2.incoming);
  check('awaiting receipt: the delivered-not-received part of incoming', r2.awaitingReceipt === 20, r2.awaitingReceipt);
  const doneO = order({ order_number: 'PO-103', completed_at: '2026-10-01T00:00:00Z' });
  const paidO = order({ order_number: 'PO-104' });
  const r3 = stockRows([bag], [], [line(doneO, { item_id: bag.id, status: 'SHIPPED', qty: 40 }), line(paidO, { item_id: bag.id, status: 'PAID', qty: 40 })], [doneO, paidO], '2026-10-20')[0];
  check('completed orders (by hand, or all paid) bring nothing more in', r3.incoming === 0, r3.incoming);
  const invoicedO = order({ order_number: 'PO-105' });
  const invLine = line(invoicedO, { item_id: bag.id, status: 'INVOICED', qty: 40 });
  const r4 = stockRows([bag], [], [invLine, line(invoicedO, { item_id: bag.id, status: 'SHIPPED', qty: 1 })], [invoicedO], '2026-10-20')[0];
  check('an invoiced line not received yet is still incoming', r4.incoming === 41 && r4.awaitingReceipt === 40, r4);
  const rpItem = item({ reorder_point: 20 });
  const openO = order({ order_number: 'PO-106' });
  const r5 = stockRows([rpItem], [move(rpItem.id, 'count', 10, '2026-10-01')], [line(openO, { item_id: rpItem.id, status: 'ORDERED', qty: 50 })], [openO], '2026-10-20')[0];
  check('incoming counts toward the reorder position (10 on hand + 50 coming > 20)', r5.state !== 'reorder now', r5.state);
  const r6 = stockRows([rpItem], [move(rpItem.id, 'count', 10, '2026-10-01')], [], [], '2026-10-20')[0];
  check('...and without it, 10 on hand under a reorder point of 20 is reorder now', r6.state === 'reorder now', r6.state);
  check('no releases yet -> "no usage yet", no dates', r2.state === 'no usage yet' && r2.reorderBy === null && r2.monthsCover === null);

  const fresh = stockRows([bag], [move(bag.id, 'receipt', 100, '2026-10-01'), move(bag.id, 'release', 4, '2026-10-10')], [], [o], '2026-10-20')[0];
  check('short history: rate over at least 30 days (one early release is not 12/month)', near(fresh.monthlyUse, 4), fresh.monthlyUse);
  check('untracked items are left out', stockRows([item({ track_stock: false })], [], [], [], '2026-10-20').length === 0);

  const byV = releasesByVenue(moves, bag.id, '2026-10-20');
  check('releases by venue, biggest first', byV.length === 2 && byV[0].venueId === 'v1' && byV[0].qty === 7 && byV[1].venueId === 'v2' && byV[1].qty === 4, byV);
  check('releases by venue: older than 90 days left out', releasesByVenue(moves, bag.id, '2026-12-20').every(v => v.venueId !== 'v1' || v.qty === 3), releasesByVenue(moves, bag.id, '2026-12-20'));
}

// ── new order validation ───────────────────────────────────────────────
{
  const L = (over: object) => [{ key: 1, itemId: null, description: 'Bags', sku: '', qty: '100', unit: 'case', unitPrice: '62.5', ...over }];
  check('needs a vendor', validateNewOrder(' ', L({})) === 'Enter the vendor.');
  check('needs a line', validateNewOrder('EE', [{ key: 1, itemId: null, description: '', sku: '', qty: '', unit: '', unitPrice: '' }]) === 'Add at least one line.');
  check('qty above 0', validateNewOrder('EE', L({ qty: '0' }))?.includes('quantity above 0'));
  check('price must be a number', validateNewOrder('EE', L({ unitPrice: 'abc' }))?.includes('not a number'));
  check('valid order passes', validateNewOrder('EE', L({})) === null);
}

// ── order prices ───────────────────────────────────────────────────────
{
  const bag = item();
  const o1 = order({ order_number: 'PO-1' }), o2 = order({ order_number: 'PO-2' }), oArch = order({ archived_at: 'x' });
  const lines = [
    line(o1, { item_id: bag.id, qty: 100, unit_price: 60, invoice_number: 'INV-1', invoice_date: '2026-06-01', status: 'PAID' }),
    line(o2, { item_id: bag.id, qty: 50, unit_price: 66, invoice_number: 'INV-2', invoice_date: '2026-09-01', status: 'INVOICED' }),
    line(o2, { item_id: bag.id, qty: 50, unit_price: 64, invoice_number: 'INV-2', invoice_date: '2026-09-01', status: 'INVOICED' }),
    line(o2, { description: 'Freight', sku: null, qty: 1, unit: null, unit_price: 120, invoice_number: 'INV-2', invoice_date: '2026-09-01', status: 'INVOICED' }),
    line(o2, { item_id: bag.id, qty: 100, unit_price: 70, status: 'QUOTED', quote_number: 'Q-9' }),
    line(o2, { item_id: bag.id, qty: 100, unit_price: 70, status: 'ORDERED' }),
    line(oArch, { item_id: bag.id, qty: 1, unit_price: 1, invoice_number: 'INV-X', invoice_date: '2026-09-02', status: 'INVOICED' }),
  ];
  check('invoiced = invoice # or status ≥ INVOICED', isInvoiced(lines[0]) && !isInvoiced(lines[5]) && isInvoiced({ invoice_number: null, status: 'PAID' }) && !isInvoiced({ invoice_number: null, status: 'CANCELLED' }));
  check('a cancelled line is never invoiced, even with a number', !isInvoiced({ invoice_number: 'INV-1', status: 'CANCELLED' }));
  const pts = pricePoints(lines, [o1, o2, oArch], [bag]);
  check('price points: invoiced only, archived orders out, item lines on one invoice collapse', pts.length === 3, pts.map(p => [p.itemName, p.invoiceNumber, p.unitPrice]));
  const bagPts = pts.filter(p => p.itemName === bag.name);
  check('same item twice on one invoice: qty-weighted price', bagPts.length === 2 && near(bagPts[1].unitPrice, 65) && bagPts[1].qty === 100, bagPts);
  const hs = histories(pts);
  const mv = priceMoves(hs);
  check('latest vs previous invoice: +8.3% per case', mv.length === 1 && near(mv[0].pct, (65 - 60) / 60 * 100) && near(mv[0].impact, 500), mv[0]);
  check('lowest paid in the same unit', near(mv[0].lowest.unitPrice, 60) && near(mv[0].aboveLowestPct, (65 - 60) / 60 * 100));
  const unitFlip = priceMoves(histories(pricePoints([
    line(o1, { item_id: bag.id, unit: 'case', unit_price: 60, invoice_number: 'A', invoice_date: '2026-01-01' }),
    line(o1, { item_id: bag.id, unit: 'each', unit_price: 0.25, invoice_number: 'B', invoice_date: '2026-02-01' }),
  ], [o1], [bag])));
  check('a unit change is a check, not a −99% price drop', unitFlip[0]?.check?.startsWith('unit changed') === true, unitFlip[0]);
  const qc = quoteChecks(lines, [o1, o2, oArch], pts);
  check('open quote vs last paid for the same item + unit', qc.length === 1 && near(qc[0].pct, (70 - 65) / 65 * 100), qc);
  const reg = invoiceRegister(pts, [{ id: 'd1', order_id: o2.id, kind: 'invoice', doc_number: 'inv-2', doc_date: '2026-09-01', vendor_name: 'EE', total: 6620, file_name: 'x.pdf', storage_path: 'o/d1.pdf', created_at: '' }]);
  check('invoice register: one row per invoice, total incl. freight, PDF linked', reg.length === 2 && reg[0].invoiceNumber === 'INV-2' && near(reg[0].total, 6620) && reg[0].document?.id === 'd1', reg);
  const regOther = invoiceRegister(pts, [{ id: 'd2', order_id: null, kind: 'invoice', doc_number: 'INV-2', doc_date: '2026-09-01', vendor_name: 'Uline', total: 1, file_name: 'y.pdf', storage_path: 'docs/d2.pdf', created_at: '' }]);
  check("invoice register: another vendor's PDF with the same number is not linked", regOther[0].document === null, regOther[0].document);
  const frac = pricePoints([
    line(o1, { item_id: bag.id, qty: 0.25, unit_price: 10, invoice_number: 'F', invoice_date: '2026-03-01' }),
    line(o1, { item_id: bag.id, qty: 0.25, unit_price: 20, invoice_number: 'F', invoice_date: '2026-03-01' }),
  ], [o1], [bag]);
  check('qty-weighted price holds for part units (0.25 + 0.25 -> 15, not 7.50)', frac.length === 1 && near(frac[0].unitPrice, 15), frac);
  const sp = spendByMonth(pts, 'vendor');
  check('spend by month', sp.months.join() === '2026-06,2026-09' && near(sp.totals['2026-09'], 6620), sp.totals);
  const csv = priceMovesCsv(mv);
  check('csv header + row', csv.split('\r\n').length === 2 && csv.startsWith('Item,Vendor,Unit'));
}

// ── a reviewed document → one save (planDocumentSave → kount_ot_apply_document) ──
{
  const dl = (over: Partial<DocLine>): DocLine => ({ line_kind: 'product', description: 'Delilah to-go bags', sku: 'DEL-TOGO', qty: 100, unit: 'case', unit_price: 64, line_total: 6400, pack_size: 250, ...over });
  const bag = item();
  const o = order({ order_number: 'PO-200', expected_on: null });
  const bagLine = line(o, { item_id: bag.id, status: 'ORDERED', unit_price: 62.5 });
  const invoiceLines = [dl({}), dl({ line_kind: 'freight', description: 'Freight', sku: '', qty: 1, unit: '', unit_price: 120, line_total: 120 }),
    dl({ line_kind: 'tax', description: 'Sales tax', sku: '', qty: 0, unit: '', unit_price: 0, line_total: 512 }),
    dl({ line_kind: 'discount', description: 'Promo', sku: '', qty: 1, unit: '', unit_price: -50, line_total: -50 })];

  const rows = planDocRows(invoiceLines, [bagLine], [bag], 'invoice');
  check('plan: product matched to its order line + item', rows[0].include && rows[0].target === bagLine.id && rows[0].itemId === bag.id, rows[0]);
  check('plan: freight ticked on an invoice, tax never', rows[1].include && !rows[2].include);
  check('plan: a negative line is never ticked by default', !rows[3].include);
  check('plan: freight on a quote is not ticked', !planDocRows(invoiceLines, [], [], 'quote')[1].include);
  // the real E&E credit memo reads as positive "discount" lines (live test 11/2)
  const creditLines = [dl({ line_kind: 'discount', description: 'Total Excess Payment (for Credit)', sku: '', qty: 0, unit: '', unit_price: 0, line_total: 2865.51 })];
  check('plan: nothing on a credit memo is ticked, even with positive amounts', planDocRows([dl({}), ...creditLines], [], [], 'invoice', true).every(r => !r.include));
  check('checks: a credit memo is named as one', documentChecks({ kind: 'other', vendor: 'EE', docNumber: '', order: null, orderLines: [], rows: [] },
    { subtotal: 2865.51, total: 3073.26, lines: creditLines, is_credit: true }, { documents: [], lines: [], orders: [] }, x => String(x)).some(c => c.startsWith('This is a credit memo')));

  const base: DocReview = {
    docId: 'doc-1', kind: 'invoice', vendor: 'EE Mercantile', docNumber: 'INV-9', docDate: '2026-10-05', orderNumber: 'PO-200', expected: '2026-10-30', tracking: '',
    order: o, orderLines: [bagLine], deliverTo: 'warehouse', venueId: '', rows, today: '2026-10-20', fileName: 'inv.pdf', storagePath: 'docs/doc-1.pdf', total: 7032, parsed: {},
  };
  const p = planDocumentSave(base);
  check('save: existing order, not a new one', p.order_id === o.id && !p.new_order);
  check('save: order gets the expected date it lacked (its PO # it already had is kept)', p.order_patch?.expected_on === '2026-10-30' && !p.order_patch?.order_number, p.order_patch);
  check('save: matched line -> INVOICED + invoice # / date + invoice price', p.updates.length === 1 && p.updates[0].status === 'INVOICED' && p.updates[0].invoice_number === 'INV-9'
    && p.updates[0].invoice_date === '2026-10-05' && p.updates[0].unit_price === 64, p.updates);
  check('save: the line already linked to the item is not re-linked', !('item_id' in p.updates[0]) && !('item_key' in p.updates[0]));
  check('save: freight added as a new INVOICED line', p.new_lines.length === 1 && p.new_lines[0].description === 'Freight' && p.new_lines[0].status === 'INVOICED' && p.new_lines[0].unit_price === 120, p.new_lines);
  check('save: the document row rides along with its id + path', p.document.id === 'doc-1' && p.document.storage_path === 'docs/doc-1.pdf' && p.document.kind === 'invoice' && p.note === 'Invoice INV-9');

  // a new order, with a catalog item created from a line
  const fresh = planDocumentSave({ ...base, kind: 'quote', docNumber: 'Q-5', order: null, orderLines: [],
    rows: [{ doc: dl({ description: 'Napkins', sku: 'NAP-1', pack_size: 0 }), include: true, target: 'new', itemId: '', addItem: true }] });
  check('save: a new order from a quote has no ordered date', fresh.new_order?.ordered_on === null && fresh.new_order?.vendor_name === 'EE Mercantile' && !fresh.order_id, fresh.new_order);
  check('save: a new item is tied to its line by key', fresh.new_items.length === 1 && fresh.new_items[0].pack_size === null && fresh.new_lines[0].item_key === fresh.new_items[0].key && fresh.new_lines[0].item_id === null, fresh);
  check('save: a quote line starts QUOTED with the quote #', fresh.new_lines[0].status === 'QUOTED' && fresh.new_lines[0].quote_number === 'Q-5' && fresh.new_lines[0].invoice_number === null);

  // a second invoice for a line that is already on another one
  const onOther = { ...bagLine, status: 'INVOICED' as const, invoice_number: 'INV-1', invoice_date: '2026-09-01', unit_price: 60 };
  const second = planDocumentSave({ ...base, orderLines: [onOther], rows: [{ ...rows[0], target: onOther.id }] });
  check('save: a line on a different invoice keeps its number, date and price', second.updates.length === 0, second.updates);
  const paidLine = { ...bagLine, status: 'PAID' as const };
  check('save: an invoice for a paid line does not move it back', !('status' in (planDocumentSave({ ...base, orderLines: [paidLine], rows: [{ ...rows[0], target: paidLine.id }] }).updates[0] ?? {})));

  // the checks a person sees
  const fmt = (x: number) => '$' + x.toFixed(2);
  const known = { documents: [] as OtDocument[], lines: [bagLine], orders: [o] };
  const printed = { subtotal: 6520, total: 7032, lines: invoiceLines };
  const clean = documentChecks(base, { ...printed, lines: invoiceLines.slice(0, 3) }, known, fmt);
  check('checks: a clean invoice has nothing to flag', clean.length === 0, clean);
  const dupDoc: OtDocument = { id: 'd0', order_id: o.id, kind: 'invoice', doc_number: 'inv 9', doc_date: null, vendor_name: 'EE Mercantile Inc', total: 7032, file_name: null, storage_path: null, created_at: '2026-10-06T10:00:00Z' };
  check('checks: the same invoice from the same vendor again', documentChecks(base, printed, { ...known, documents: [dupDoc] }, fmt).some(c => c.includes('already added on 2026-10-06')));
  check('checks: ...but not another vendor\'s invoice with that number', !documentChecks(base, printed, { ...known, documents: [{ ...dupDoc, vendor_name: 'Uline' }] }, fmt).some(c => c.includes('already added')));
  check('checks: an invoice # already typed onto lines', documentChecks(base, printed, { ...known, lines: [{ ...bagLine, invoice_number: 'INV-9' }] }, fmt).some(c => c.includes('already on 1 line')));
  check('checks: order from another vendor', documentChecks({ ...base, vendor: 'Uline' }, printed, known, fmt).some(c => c.includes('chosen order is from EE Mercantile')));
  check('checks: credit memo', documentChecks(base, printed, known, fmt).some(c => c.includes('credit memo')));
  check('checks: line on another invoice', documentChecks({ ...base, orderLines: [onOther], rows: [{ ...rows[0], target: onOther.id }] }, printed, known, fmt).some(c => c.includes('already on invoice INV-1')));
  check('checks: quantity differs from the order', documentChecks({ ...base, rows: [{ ...rows[0], doc: dl({ qty: 80, line_total: 5120 }) }] }, printed, known, fmt).some(c => c.includes('the document says 80, the order line says 100')));
}

// ── report rows ────────────────────────────────────────────────────────
{
  const bag = item();
  const open = order({ order_number: 'PO-OPEN' }), done = order({ order_number: 'PO-DONE', completed_at: '2026-09-30T00:00:00Z' }), arch = order({ order_number: 'PO-ARCH', archived_at: 'x' });
  const lines = [line(open, { item_id: bag.id, status: 'SHIPPED' }), line(done, { item_id: bag.id, status: 'PAID', invoice_number: 'INV-5', invoice_date: '2026-09-01' }), line(arch)];
  const moves = [move(bag.id, 'receipt', 100, '2026-09-02', { line_id: lines[1].id }), move(bag.id, 'release', 4, '2026-10-01', { venue_id: 'v1' })];
  const base = { items: [bag], orders: [open, done, arch], lines, moves, venueName: (v: string | null) => v ?? 'Warehouse', today: '2026-10-20' };
  const all = buildReportRows({ ...base, includeClosed: true });
  const openOnly = buildReportRows({ ...base, includeClosed: false });
  check('report: archived orders never included', !all.orders.some(r => r[0] === 'PO-ARCH'));
  check('report: completed included on request', all.orders.length === 3 && openOnly.orders.length === 2, [all.orders.length, openOnly.orders.length]);
  check('report: order status column is the headline status', all.orders.find(r => r[0] === 'PO-OPEN')?.[6] === 'Shipped');
  check('report: a line row per line with invoice #', all.lines.length === 3 && all.lines.some(r => r[11] === 'INV-5'));
  check('report: warehouse on hand', all.warehouse.length === 2 && all.warehouse[1][4] === 96, all.warehouse[1]);
  check('report: warehouse incoming column', all.warehouse[0][5] === 'Incoming (not received yet)' && all.warehouse[1][5] === 100, all.warehouse[1]);
  check('report: spend sheet from invoiced lines', all.spend.length === 2 && all.spend[1][0] === '2026-09');
}

// ── wiring ─────────────────────────────────────────────────────────────
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const app = src('src/App.tsx'); const side = src('src/components/Sidebar.tsx');
check('order tracker route gated to admin + corporate', app.includes('<Route path="/order-tracker"   element={hasCorporateAccess(user.role) ? <OrderTracker user={user} />'));
check('order prices route gated to admin + corporate', app.includes('<Route path="/order-prices"    element={hasCorporateAccess(user.role) ? <OrderPrices user={user} />'));
check('Purchasing section lists the three tabs', /NAV_PURCHASING = \[\s*\{ to: '\/order-tracker',\s+label: 'Order tracker' \},\s*\{ to: '\/order-prices',\s+label: 'Order prices' \},\s*\{ to: '\/purchase-prices', label: 'Liquor & wine prices' \},\s*\];/.test(side));
check('Purchasing section rendered only for admin + corporate', side.includes("const isAdmin    = userRole === 'admin' || userRole === 'corporate';") && /\{isAdmin && \(\s*<>\s*<div className="sidebar-group-label">Purchasing<\/div>/.test(side));
check('documents read through the admin/corporate-gated function', src('src/lib/orderTrackerData.ts').includes("supabase.functions.invoke('kount-read-purchase-doc'"));
check('a reload never re-reads the PDF (read keyed on the file only)', /readDocument\(file\)[\s\S]*?\}, \[file\]\);/.test(src('src/components/orderTracker/DocumentReview.tsx')));

{
  const dr = src('src/components/orderTracker/DocumentReview.tsx'), data = src('src/lib/orderTrackerData.ts');
  check('a document saves in ONE database call (no step-by-step writes from the review)', dr.includes('applyDocument(planDocumentSave(') && !/\b(createOrder|updateLine|addLines|saveItem|updateOrder)\(/.test(dr));
  check('...through the transactional RPC', data.includes("supabase.rpc('kount_ot_apply_document', { p })"));
  check('the PDF is stored by document id before the save', data.includes('docs/${docId}.pdf') && /uploadDocumentPdf\(docId, file\)[\s\S]*applyDocument/.test(dr));
  check('a reload never re-plans the rows (planned on reading / order / type only)', /setRows\(planDocRows\([\s\S]*?\}, \[doc, target, kind\]\);/.test(dr));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
