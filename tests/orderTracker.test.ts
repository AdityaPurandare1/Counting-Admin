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
  planDocRows, planDocumentSave, documentChecks, decideMailDocument, extractTracking, trackingUrl, orderForEmail, venueForDoc, filterByVenue, sortOrders, orderVenueIds,
  planStorageLine, storageMoveRows, isStorageLine, autoOrderNumber, lineOutsideSubtotal, orderForReferences,
  keepOtherAttachment, isSpreadsheet, sheetUpdates,
  type ReadDoc, type MailSource,
  type OtItem, type OtLine, type OtMove, type OtOrder, type OtDocument, type DocLine, type DocReview,
} from '../src/lib/orderTracker';
import { pricePoints, histories, priceMoves, quoteChecks, invoiceRegister, spendByMonth, isInvoiced, priceMovesCsv } from '../src/lib/orderPrices';
import { buildReportRows } from '../src/lib/orderTrackerReport';
import { parseCsv, tidyRows, cellText, sheetsFromXlsx, sheetsFromFile } from '../src/lib/sheetPreview';
import { colWidthPx, rowHeightPx, applyTint, themePalette, excelColor, cellStyle, displayText, safeLink, richImageMap, sheetVmCells, sheetFiles, loadBible, bibleFromCsv, bibleTextIndex } from '../src/lib/bibleRender';
import { questionTerms, buildOrdersContext, asksVariance, ordersBudget, shortUrl } from '../src/lib/askAiOrders';
import {
  fulfillmentOf, fulfillmentStep, paymentOf, nextEta, orderCategory, timeAgo, lastUpdate, trackerKpis, attentionItems,
  orderDraft, lineDraft, planOrderSave, isPlanEmpty, setDraftStage, markDraft, draftStage, draftTotal, draftLineTotal,
  stubsToGet, invoiceToken, stubInvoices,
} from '../src/lib/orderTrackerView';
import { inboxGroups, findSummary, type InboxItem } from '../src/lib/orderMail';
import { existsSync } from 'node:fs';

// the sibling Counting-App repo (the pull, the reader): only on a machine that has both — CI checks out this repo alone
const sibling = (...parts: string[]) => { const p = join(process.cwd(), '..', 'Counting-App', ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
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
check('cycle order = requested, ordered, quoted, invoiced, paid, shipped, delivered, received',
  ['REQUESTED', 'ORDERED', 'QUOTED', 'INVOICED', 'PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'].every((st, i, a) => i === 0 || statusRank(a[i - 1] as never) < statusRank(st as never)));
{
  const o = order();
  const ls = [line(o, { status: 'SHIPPED' }), line(o, { status: 'CONFIRMED' }), line(o, { status: 'CANCELLED' })];
  check('headline = least-advanced live line', headlineStatus(ls) === 'CONFIRMED', headlineStatus(ls));
  check('all cancelled -> CANCELLED; no lines -> null', headlineStatus([line(o, { status: 'CANCELLED' })]) === 'CANCELLED' && headlineStatus([]) === null);
  check('open while lines are moving', orderState(o, ls) === 'open');
  check('every live line received -> completed', orderState(o, [line(o, { status: 'RECEIVED' }), line(o, { status: 'CANCELLED' })]) === 'completed');
  check('paid is not done: it still has to ship', orderState(o, [line(o, { status: 'PAID' })]) === 'open');
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
check('a quote moves an ordered line to QUOTED', statusAfterDocument('ORDERED', 'quote') === 'QUOTED');
check('a quote never pulls an invoiced line back', statusAfterDocument('INVOICED', 'quote') === 'INVOICED');
check('an order confirmation means ORDERED', statusAfterDocument('REQUESTED', 'confirmation') === 'ORDERED' && statusAfterDocument('PAID', 'confirmation') === 'PAID');
check('a shipping notice after payment -> SHIPPED', statusAfterDocument('PAID', 'shipping') === 'SHIPPED');
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
  const quoted = line(o2, { item_id: bag.id, status: 'REQUESTED', qty: 999 });
  const cancelled = line(o2, { item_id: bag.id, status: 'CANCELLED', qty: 999 });
  const delivered = line(o2, { item_id: bag.id, status: 'DELIVERED', qty: 30 });
  const toVenue = order({ order_number: 'PO-102', deliver_to: 'venue' });
  const venueLine = line(toVenue, { item_id: bag.id, status: 'SHIPPED', qty: 999 });
  const r2 = stockRows([bag], [move(bag.id, 'receipt', 10, '2026-10-02', { line_id: delivered.id })], [shipped, quoted, cancelled, delivered, venueLine], [o2, toVenue], '2026-10-20')[0];
  check('incoming: every unreceived unit on open warehouse orders (not requests, not cancelled, not venue deliveries)', r2.incoming === 70, r2.incoming);
  check('awaiting receipt: the delivered-not-received part of incoming', r2.awaitingReceipt === 20, r2.awaitingReceipt);
  const doneO = order({ order_number: 'PO-103', completed_at: '2026-10-01T00:00:00Z' });
  const paidO = order({ order_number: 'PO-104' });
  const r3 = stockRows([bag], [], [line(doneO, { item_id: bag.id, status: 'SHIPPED', qty: 40 }), line(paidO, { item_id: bag.id, status: 'RECEIVED', qty: 40 })], [doneO, paidO], '2026-10-20')[0];
  check('completed orders (by hand, or all received) bring nothing more in', r3.incoming === 0, r3.incoming);
  const invoicedO = order({ order_number: 'PO-105' });
  const invLine = line(invoicedO, { item_id: bag.id, status: 'DELIVERED', qty: 40 });
  const r4 = stockRows([bag], [], [invLine, line(invoicedO, { item_id: bag.id, status: 'SHIPPED', qty: 1 })], [invoicedO], '2026-10-20')[0];
  check('a delivered line not received yet is still incoming (awaiting receipt)', r4.incoming === 41 && r4.awaitingReceipt === 40, r4);
  const r4b = stockRows([bag], [], [line(invoicedO, { item_id: bag.id, status: 'QUOTED', qty: 5 })], [invoicedO], '2026-10-20')[0];
  check('a quoted line counts as coming (it was ordered first)', r4b.incoming === 5, r4b.incoming);
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
  const otherOrder = order({ order_number: 'PO-OTHER' });
  check('checks: an invoice # already typed onto ANOTHER order lines', documentChecks(base, printed, { ...known, orders: [o, otherOrder], lines: [bagLine, line(otherOrder, { invoice_number: 'INV-9' })] }, fmt).some(c => c.includes('already on 1 line')));
  check('checks: ...but not when it is on the order being updated (saving updates those lines)', !documentChecks(base, printed, { ...known, lines: [{ ...bagLine, invoice_number: 'INV-9' }] }, fmt).some(c => c.includes('already on')));
  check('checks: order from another vendor', documentChecks({ ...base, vendor: 'Uline' }, printed, known, fmt).some(c => c.includes('chosen order is from EE Mercantile')));
  check('checks: credit memo', documentChecks(base, printed, known, fmt).some(c => c.includes('credit memo')));
  check('checks: line on another invoice', documentChecks({ ...base, orderLines: [onOther], rows: [{ ...rows[0], target: onOther.id }] }, printed, known, fmt).some(c => c.includes('already on invoice INV-1')));
  check('checks: quantity differs from the order', documentChecks({ ...base, rows: [{ ...rows[0], doc: dl({ qty: 80, line_total: 5120 }) }] }, printed, known, fmt).some(c => c.includes('the document says 80, the order line says 100')));
}

// ── morning mail pull: apply on its own, or wait for a person ──────────
{
  const dl = (over: Partial<DocLine>): DocLine => ({ line_kind: 'product', description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12', sku: '9156', qty: 6, unit: '', unit_price: 68.84, line_total: 413.04, pack_size: 12, ...over });
  const o = order({ order_number: null, vendor_name: 'EE Mercantile', expected_on: null });
  const goblet = line(o, { description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12', sku: '9156', qty: 6, status: 'QUOTED', unit_price: 68.84, quote_number: 'Q-1' });
  const fork = line(o, { description: 'STEELITE- DESSERT FORK MONZA- 7"/ 12', sku: '5340Z023', qty: 17, status: 'QUOTED', unit_price: 107.19, quote_number: 'Q-1', sort: 1 });
  const quoteDoc: OtDocument = { id: 'qdoc', order_id: o.id, kind: 'quote', doc_number: 'Q-1', doc_date: '2026-10-28', vendor_name: 'EE Mercantile', total: 2235.27, file_name: 'q.pdf', storage_path: 'docs/qdoc.pdf', created_at: '2026-10-28T20:00:00Z', source_conversation_id: 'THREAD-1' };
  const data = { orders: [o], lines: [goblet, fork], items: [], documents: [quoteDoc] };
  const inv = (over: Partial<ReadDoc> = {}): ReadDoc => ({
    doc_kind: 'invoice', is_credit: false, vendor_name: 'EE Mercantile', doc_number: 'INV-2026-086418', doc_date: '2026-10-29', order_number: '', expected_date: '',
    tracking_numbers: [], subtotal: 2235.27, total: 2397.33,
    lines: [dl({}), dl({ description: 'STEELITE- DESSERT FORK MONZA- 7"/ 12', sku: '5340Z023', qty: 17, unit_price: 107.19, line_total: 1822.23 }),
      dl({ line_kind: 'tax', description: 'Tax 7.25%', sku: '', qty: 0, unit_price: 0, line_total: 162.06, pack_size: 0 })], ...over,
  });
  const src = (over: Partial<MailSource> = {}): MailSource => ({ id: 'inbox-1', message_id: 'MSG-1', conversation_id: 'THREAD-1', file_name: 'Invoice-INV-2026-086418.pdf', storage_path: 'docs/inbox-1.pdf', ...over });
  const fmt = (x: number) => '$' + x.toFixed(2);

  const a = decideMailDocument(inv(), src(), data, '2026-10-30', fmt);
  check('mail: the invoice in the quote\'s email thread applies on its own', a.state === 'applied' && a.reason.includes('same email thread'), a);
  if (a.state === 'applied') {
    check('mail: both lines -> INVOICED with the invoice #', a.payload.updates.length === 2 && a.payload.updates.every(u => u.status === 'INVOICED' && u.invoice_number === 'INV-2026-086418'), a.payload.updates);
    check('mail: the save closes its inbox row and remembers the thread', a.payload.inbox_id === 'inbox-1' && a.payload.document.id === 'inbox-1'
      && a.payload.document.source_conversation_id === 'THREAD-1' && a.payload.document.source_message_id === 'MSG-1');
    check('mail: the trail says it was automatic', a.payload.note.includes('applied automatically'));
    check('mail: tax is not added as a line', a.payload.new_lines.length === 0, a.payload.new_lines);
  }
  const noThread = decideMailDocument(inv(), src({ conversation_id: 'OTHER' }), data, '2026-10-30', fmt);
  check('mail: no thread, no number match -> waits ("create one")', noThread.state === 'pending' && noThread.reason.startsWith('No matching order'), noThread);
  const byPo = decideMailDocument(inv({ order_number: 'PO-77' }), src({ conversation_id: null }), { ...data, orders: [{ ...o, order_number: 'PO-77' }] }, '2026-10-30', fmt);
  check('mail: matched by PO # from the same vendor', byPo.state === 'applied' && byPo.reason.includes('PO #'), byPo);
  const otherVendor = decideMailDocument(inv({ vendor_name: 'Uline' }), src(), data, '2026-10-30', fmt);
  check('mail: same thread but another vendor -> waits', otherVendor.state === 'pending', otherVendor);
  // (an extra item is in the printed subtotal, as on a real invoice)
  const extra = decideMailDocument(inv({ subtotal: 2235.27 + 3138.8, total: 2397.33 + 3138.8, lines: [...inv().lines, dl({ description: 'MEPRA - WINE COOLER', sku: '200680', qty: 10, unit_price: 313.88, line_total: 3138.8 })] }), src(), data, '2026-10-30', fmt);
  const option = decideMailDocument(inv({ lines: [...inv().lines, dl({ description: 'Volume Pricing: 100C', sku: '', qty: 10, unit_price: 313.88, line_total: 3138.8 })] }), src(), data, '2026-10-30', fmt);
  check('mail: a line outside the printed subtotal (price option) -> waits for a person, never auto-saved', option.state === 'pending' && option.reason.includes('not in the printed subtotal'), option);
  check('mail: an item not on the order -> waits', extra.state === 'pending' && extra.reason.includes('not on'), extra);
  const qty = decideMailDocument(inv({ lines: [dl({ qty: 5, line_total: 344.2 })], subtotal: 344.2 }), src(), data, '2026-10-30', fmt);
  check('mail: a review warning (qty differs) -> waits, with the warning', qty.state === 'pending' && qty.reason.includes('the document says 5'), qty);
  const credit = decideMailDocument(inv({ is_credit: true, doc_kind: 'other', doc_number: '' }), src(), data, '2026-10-30', fmt);
  check('mail: a credit memo always waits', credit.state === 'pending' && credit.reason.includes('credit memo'), credit);
  const other = decideMailDocument(inv({ doc_kind: 'other', doc_number: '' }), src(), data, '2026-10-30', fmt);
  check('mail: not a purchasing document -> ignored', other.state === 'ignored', other);
  const savedInv: OtDocument = { ...quoteDoc, id: 'd9', kind: 'invoice', doc_number: 'INV-2026-086418', created_at: '2026-10-29T22:00:00Z' };
  const again = decideMailDocument(inv(), src(), { ...data, documents: [quoteDoc, savedInv] }, '2026-10-30', fmt);
  check('mail: an invoice already saved (forwarded again by AP) -> ignored', again.state === 'ignored' && again.reason.startsWith('Already saved'), again);
  const o2 = order({ vendor_name: 'EE Mercantile' });
  const twoOrders = decideMailDocument(inv(), src(), { ...data, orders: [o, o2], documents: [quoteDoc, { ...quoteDoc, id: 'q2', order_id: o2.id, doc_number: 'Q-2' }] }, '2026-10-30', fmt);
  check('mail: a thread that spans two orders is not trusted', twoOrders.state === 'pending', twoOrders);
  const archived = decideMailDocument(inv(), src(), { ...data, orders: [{ ...o, archived_at: 'x' }] }, '2026-10-30', fmt);
  check('mail: never onto an archived order', archived.state === 'pending', archived);
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
  check('report: a line row per line with invoice # (and its venue)', all.lines.length === 3 && all.lines.some(r => r[12] === 'INV-5') && all.lines[0][2] === 'Venue');
  check('report: warehouse on hand', all.warehouse.length === 2 && all.warehouse[1][4] === 96, all.warehouse[1]);
  check('report: warehouse incoming column', all.warehouse[0][5] === 'Incoming (not received yet)' && all.warehouse[1][5] === 100, all.warehouse[1]);
  // prepaid: a SHIPPED line has been invoiced and paid, so it is spend too (Aug, from its status date)
  check('report: spend sheet from invoiced lines (shipped = invoiced first)', all.spend.length === 3 && all.spend.some(r => r[0] === '2026-09') && all.spend.some(r => r[0] === '2026-08'), all.spend);
  check('report: orders sheet has the tracking column', all.orders[0].includes('Tracking #s'));
}

// ── wiring ─────────────────────────────────────────────────────────────
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const app = src('src/App.tsx'); const side = src('src/components/Sidebar.tsx');
check('order tracker route gated to admin + corporate', app.includes('<Route path="/order-tracker"   element={hasCorporateAccess(user.role) ? <OrderTracker user={user} />'));
check('order prices route gated to admin + corporate', app.includes('<Route path="/order-prices"    element={hasCorporateAccess(user.role) ? <OrderPrices user={user} />'));
check('Purchasing section lists the three tabs', /NAV_PURCHASING = \[\s*\{ to: '\/order-tracker',\s+label: 'Order tracker' \},\s*\{ to: '\/order-prices',\s+label: 'Order prices' \},\s*\{ to: '\/purchase-prices', label: 'Liquor & wine prices' \},\s*\];/.test(side));
check('Purchasing section rendered only for admin + corporate', side.includes("const isAdmin    = userRole === 'admin' || userRole === 'corporate';") && /\{isAdmin && \(\s*<>\s*<div className="sidebar-group-label">Purchasing<\/div>/.test(side));
check('documents read through the admin/corporate-gated function', src('src/lib/orderTrackerData.ts').includes("supabase.functions.invoke('kount-read-purchase-doc'"));
check('a reload never re-reads the PDF (read keyed on the file / inbox row only)', /readDocument\(file\)[\s\S]*?\}, \[file, inbox\?\.id\]\);/.test(src('src/components/orderTracker/DocumentReview.tsx')));

{
  const dr = src('src/components/orderTracker/DocumentReview.tsx'), data = src('src/lib/orderTrackerData.ts');
  check('a document saves in ONE database call (no step-by-step writes from the review)', dr.includes('const payload = planDocumentSave(') && dr.includes('await applyDocument(payload)') && !/\b(createOrder|updateLine|addLines|saveItem|updateOrder)\(/.test(dr));
  check('...through the transactional RPC', data.includes("supabase.rpc('kount_ot_apply_document', { p })"));
  check('the PDF is stored by document id before the save', data.includes('docs/${docId}.pdf') && /uploadDocumentPdf\(docId, file!?\)[\s\S]*applyDocument/.test(dr));
  check('a reload never re-plans the rows (planned on reading / order / type only)', /setRows\(planDocRows\([\s\S]*?\}, \[doc, target, kind\]\);/.test(dr));
}

// ── v0.80 inbox (morning mail pull) ───────────────────────────────────
{
  const it = (over: Partial<InboxItem>): InboxItem => ({
    id: id('x'), message_id: 'm', conversation_id: null, subject: null, sender_email: 'a@eemercantile.co', sender_name: null, received_at: '2026-10-30T16:00:00Z',
    file_name: 'x.pdf', size_bytes: 1, storage_path: 'docs/x.pdf', state: 'pending', parsed: null, attempts: 1, read_error: null, decision: null, order_id: null,
    decided_by: null, created_at: '2026-10-30T16:01:00Z', updated_at: '2026-10-30T16:02:00Z', ...over,
  });
  const g = inboxGroups([
    it({ state: 'pending', received_at: '2026-10-29T10:00:00Z' }), it({ state: 'error', received_at: '2026-10-31T10:00:00Z' }), it({ state: 'unread' }),
    it({ state: 'applied', updated_at: '2026-10-30T17:00:00Z' }), it({ state: 'applied', updated_at: '2026-08-01T17:00:00Z' }), it({ state: 'ignored' }),
  ], new Date('2026-11-02T18:00:00Z'));
  check('inbox: waiting = pending + could not read, newest first', g.waiting.length === 2 && g.waiting[0].state === 'error', g.waiting.map(x => x.state));
  check('inbox: being read / skipped', g.reading.length === 1 && g.skipped.length === 1);
  check('inbox: saved list is the last 30 days', g.applied.length === 1, g.applied.length);

  const dr = src('src/components/orderTracker/DocumentReview.tsx'), ot = src('src/screens/OrderTracker.tsx');
  check('inbox review never re-reads the PDF (uses what the pull read)', dr.includes('inbox?.parsed ? Promise.resolve(inbox.parsed as ReadDocument)'));
  check('inbox review never re-uploads (the PDF is the inbox row\'s)', dr.includes('path = inbox ? inbox.storage_path : await uploadDocumentPdf(docId, file!)') && dr.includes('refused && path && !inbox'));
  check('inbox review closes its row in the same save', dr.includes('payload.inbox_id = inbox.id') && dr.includes('useMemo(() => inbox?.id ?? crypto.randomUUID()'));
  check('order tracker shows the Inbox tab with a waiting count', ot.includes("tab('inbox', 'Inbox', waiting)"));
  check('a failing inbox load never hides the orders', ot.includes('loadMail().catch(() => [] as InboxItem[])'));
  const mail = src('src/lib/orderMail.ts');
  check('the mailbox sign-in never reaches the browser (status RPC only)', mail.includes("supabase.rpc('kount_ot_mail_status')") && !/kount_ot_mail_account|token_get/.test(mail));
  // the pull runs the SAME rules: its copy of this file must not drift
  const serverCopy = join(process.cwd(), '..', 'Counting-App', 'supabase', 'functions', '_shared', 'orderTracker.ts');
  if (existsSync(serverCopy)) {
    check('the morning pull runs an identical copy of src/lib/orderTracker.ts', readFileSync(serverCopy, 'utf8') === src('src/lib/orderTracker.ts'),
      'copy src/lib/orderTracker.ts to Counting-App/supabase/functions/_shared/orderTracker.ts and redeploy kount-order-mail');
  }
}

// ── tracking numbers in vendor emails (0137) ─────────────────────────
{
  const jemma = "Hi Hursh, here's the tracking Fedex with tracking# 879337642791 and 879337641177 Thanks On Fri, Oct 16, 2026 at 7:21 AM Jemma Eredera <jemma@eemercantile.co> wrote:";
  const hits = extractTracking(jemma);
  check('tracking: both FedEx numbers from E&E\'s reply', hits.length === 2 && hits.every(h => h.carrier === 'FedEx') && hits.map(h => h.number).join() === '879337642791,879337641177', hits);
  check('tracking: UPS 1Z anywhere', extractTracking('Your box: 1Z999AA10123456784 arrives Tue')[0]?.carrier === 'UPS');
  const ups = extractTracking("Hi Talya, Here's the tracking# for the bags. UPS: 1Z16HE520327398588 matches - UPS: 1ZB87Y470431767890 1ZB87Y470436463502");
  check('tracking: the tail of a UPS number is never a second (FedEx) number', ups.length === 3 && ups.every(h => h.carrier === 'UPS'), ups);
  check('tracking: USPS 22-digit', extractTracking('USPS tracking 9400 1000 0000 0000 0000 00')[0]?.number === '9400100000000000000000');
  const sig = 'Aleli Abad Buyer- OS&E 323.576.3157 EEMercantile.co. Invoice INV-2026-086418 total $2397.33. Account #: 215732249556 on Oct 29, 2026';
  check('tracking: phone, invoice #, dates and an account # with no tracking word are not taken', extractTracking(sig).length === 0, extractTracking(sig));
  check('tracking: "will ship after November 15" has no number -> nothing', extractTracking('the glasses will be available to ship after November 15 (estimate only)').length === 0);
  check('tracking links', trackingUrl({ number: '879337642791', carrier: 'FedEx' }).includes('fedex.com') && trackingUrl({ number: '1Z9', carrier: 'UPS' }).includes('ups.com'));

  const o = order({ order_number: null, vendor_name: 'EE Mercantile' }), o2 = order({ vendor_name: 'EE Mercantile' });
  const l1 = line(o, { invoice_number: 'INV-2026-918389', status: 'PAID' });
  const d1: OtDocument = { id: 'd1', order_id: o.id, kind: 'quote', doc_number: 'Q-1', doc_date: null, vendor_name: 'EE Mercantile', total: 1, file_name: null, storage_path: null, created_at: '', source_conversation_id: 'POPPY-BAGS' };
  const data = { orders: [o, o2], lines: [l1], documents: [d1] };
  check('email -> order: the quote\'s thread', orderForEmail('POPPY-BAGS', jemma, data)?.id === o.id);
  check('email -> order: an invoice # in the text', orderForEmail(null, 'Shipped today for INV-2026-918389, tracking 1Z999AA10123456784', data)?.id === o.id);
  check('email -> order: nothing to go on -> none', orderForEmail('OTHER', jemma, data) === null);
  check('email -> order: never an archived order', orderForEmail('POPPY-BAGS', jemma, { ...data, orders: [{ ...o, archived_at: 'x' }, o2] }) === null);
}

// a quote that arrives AFTER the invoice never overwrites the invoiced price
{
  const o = order({ expected_on: null });
  const inv = line(o, { status: 'INVOICED', invoice_number: 'INV-1', unit_price: 60, sku: 'S1', description: 'Bag' });
  const dl: DocLine = { line_kind: 'product', description: 'Bag', sku: 'S1', qty: 100, unit: 'case', unit_price: 55, line_total: 5500, pack_size: 0 };
  const rows = planDocRows([dl], [inv], [], 'quote');
  const p = planDocumentSave({ docId: 'q', kind: 'quote', vendor: 'EE Mercantile', docNumber: 'Q-9', docDate: '', orderNumber: '', expected: '', tracking: '', order: o, orderLines: [inv],
    deliverTo: 'warehouse', venueId: '', rows, today: '2026-11-02', fileName: 'q.pdf', storagePath: 'docs/q.pdf', total: 5500, parsed: {} });
  check('late quote: records the quote #, keeps the invoiced price and status', p.updates.length === 1 && p.updates[0].quote_number === 'Q-9' && !('unit_price' in p.updates[0]) && !('status' in p.updates[0]), p.updates);
}

// ── auto-create (0138): a quote / invoice with no order starts one ────
{
  const venues = [{ id: 'v4', name: 'Delilah LA' }, { id: 'v5', name: 'Delilah Miami' }, { id: 'v9', name: 'The Nice Guy' }, { id: 'v14', name: 'Lady Delilah' }];
  check('venue from Ship to / Bill to', venueForDoc({ bill_to: 'Delilah LA', ship_to: '' }, venues)?.id === 'v4' && venueForDoc({ bill_to: 'The Nice Guy LLC' }, venues)?.id === 'v9');
  check('venue: never the wrong Delilah', venueForDoc({ bill_to: 'Delilah Dallas' }, venues) === null, venueForDoc({ bill_to: 'Delilah Dallas' }, venues));
  const dl = (over: Partial<DocLine> = {}): DocLine => ({ line_kind: 'product', description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12', sku: '9156', qty: 6, unit: '', unit_price: 68.84, line_total: 413.04, pack_size: 12, ...over });
  const quote = (over: Partial<ReadDoc> = {}): ReadDoc => ({ doc_kind: 'quote', is_credit: false, vendor_name: 'EE Mercantile', doc_number: 'Q-2026-1028-9329', doc_date: '2026-10-28',
    order_number: '', expected_date: '', tracking_numbers: [], subtotal: 413.04, total: 413.04, bill_to: 'Delilah LA', ship_to: 'Delilah LA', lines: [dl()], ...over });
  const src = (over: Partial<MailSource> = {}): MailSource => ({ id: 'ib-1', message_id: 'M1', conversation_id: 'T1', file_name: 'Q.pdf', storage_path: 'docs/ib-1.pdf', ...over });
  const empty = { orders: [], lines: [], items: [], documents: [] };
  const fmt = (x: number) => '$' + x.toFixed(2);
  const a = decideMailDocument(quote(), src(), empty, '2026-11-02', fmt, { autoCreate: true, venues });
  check('auto-create: the new order gets the next order #', a.state === 'applied' && a.payload.new_order?.order_number === 'OSE-0001', a.state === 'applied' && a.payload.new_order);
  check('auto-create: a quote with no order starts one at Quoted, for its venue', a.state === 'applied' && !!a.payload.new_order && a.payload.new_order.venue_id === 'v4'
    && a.payload.new_order.deliver_to === 'venue' && a.payload.new_lines[0]?.status === 'QUOTED' && a.payload.document.source_conversation_id === 'T1', a);
  check('auto-create off: it waits', decideMailDocument(quote(), src(), empty, '2026-11-02', fmt, {}).state === 'pending');
  const inv = decideMailDocument(quote({ doc_kind: 'invoice', doc_number: 'INV-2026-086418' }), src(), empty, '2026-11-02', fmt, { autoCreate: true, venues });
  check('auto-create: an invoice with no order starts one at Invoiced', inv.state === 'applied' && inv.payload.new_lines[0]?.status === 'INVOICED' && inv.payload.new_lines[0]?.invoice_number === 'INV-2026-086418', inv);
  const ship = decideMailDocument(quote({ doc_kind: 'shipping', doc_number: 'PS-1' }), src(), empty, '2026-11-02', fmt, { autoCreate: true, venues });
  check('auto-create: never from a shipping notice alone', ship.state === 'pending', ship);
  const off = decideMailDocument(quote({ subtotal: 999 }), src(), empty, '2026-11-02', fmt, { autoCreate: true, venues });
  check('auto-create: a review warning (totals off) -> waits', off.state === 'pending' && off.reason.startsWith('Not created automatically'), off);
  // the thread already has an order with OTHER items: this is a second order, not a mismatch
  const o = order({ vendor_name: 'EE Mercantile' });
  const other = line(o, { description: 'MEPRA - WINE COOLER', sku: '200680', status: 'QUOTED' });
  const d1: OtDocument = { id: 'd1', order_id: o.id, kind: 'quote', doc_number: 'Q-OTHER', doc_date: null, vendor_name: 'EE Mercantile', total: 1, file_name: null, storage_path: null, created_at: '', source_conversation_id: 'T1' };
  const second = decideMailDocument(quote(), src(), { orders: [o], lines: [other], items: [], documents: [d1] }, '2026-11-02', fmt, { autoCreate: true, venues });
  check('one request = one order: new items in the same thread are ADDED to its order, not a new one', second.state === 'applied' && second.payload.order_id === o.id && !second.payload.new_order && second.payload.new_lines.length === 1, second);
  const same = line(o, { description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12', sku: '9156', qty: 6, status: 'QUOTED', unit_price: 68.84, quote_number: 'Q-OTHER' });
  const follow = decideMailDocument(quote({ doc_kind: 'invoice', doc_number: 'INV-9' }), src(), { orders: [o], lines: [same], items: [], documents: [d1] }, '2026-11-02', fmt, { autoCreate: true, venues });
  const feeOnly = decideMailDocument(quote({ doc_kind: 'invoice', doc_number: 'INV-2026-885072', subtotal: 494.4, total: 494.4,
    lines: [dl({ line_kind: 'freight', description: 'Shipping fee', sku: '', qty: 1, unit_price: 494.4, line_total: 494.4, pack_size: 0 })] }), src({ conversation_id: 'T9' }), empty, '2026-11-02', fmt, { autoCreate: true, venues });
  check('auto-create: a shipping-fee-only invoice starts an order too', feeOnly.state === 'applied' && feeOnly.payload.new_lines.length === 1, feeOnly);
  const fee = (description: string, line_total: number) => dl({ line_kind: 'fee', description, sku: '', qty: 1, unit_price: line_total, line_total, pack_size: 0 });
  const storage = (lines: DocLine[]) => decideMailDocument(quote({ doc_kind: 'invoice', doc_number: 'INV-2026-794351', bill_to: 'h.wood Group', ship_to: '',
    subtotal: lines.reduce((s, l) => s + l.line_total, 0), total: lines.reduce((s, l) => s + l.line_total, 0), lines }), src({ conversation_id: 'T-whs' }), empty, '2026-11-03', fmt, { autoCreate: true, venues });
  const oneVenue = storage([fee('TNG - delivery 10/28/2026 SKU: TNG-EURO (2)', 31.8)]);
  check('auto-create: billed to h.wood, the venue comes from the line ("TNG delivery"), and it is a WHS order',
    oneVenue.state === 'applied' && oneVenue.payload.new_order?.venue_id === 'v9' && oneVenue.payload.new_order?.deliver_to === 'venue' && oneVenue.payload.new_order?.order_number === 'WHS-0001', oneVenue.state === 'applied' && oneVenue.payload.new_order);
  const twoVenues = storage([fee('TNG delivery - 10/12/2026 - 3 CASES TNG-EURO', 34.8), fee('Delilah LA delivery - 10/13/2026 - 2cs bags', 28.8)]);
  check('auto-create: two venues on one storage invoice -> one order serving both, each line its venue',
    twoVenues.state === 'applied' && twoVenues.payload.new_order?.venue_id === 'x:Multiple venues' && twoVenues.payload.new_lines.map(l => l.venue_id).join() === 'v9,v4', twoVenues.state === 'applied' && twoVenues.payload);
  const miami = { ...o, venue_id: 'v5' };
  const invoiced = line(miami, { description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12', sku: '9156', qty: 6, status: 'INVOICED', unit_price: 68.84, invoice_number: 'INV-A' });
  const perVenue = decideMailDocument(quote({ doc_kind: 'invoice', doc_number: 'INV-B' }), src(), { orders: [miami], lines: [invoiced], items: [], documents: [d1] }, '2026-11-02', fmt, { autoCreate: true, venues });
  check('per-venue invoices of one request: the LA invoice joins the Miami order as an LA line, the order serves several venues',
    perVenue.state === 'applied' && perVenue.payload.order_id === o.id && perVenue.payload.new_lines[0]?.venue_id === 'v4'
    && perVenue.payload.order_patch?.venue_id === 'x:Multiple venues' && perVenue.payload.updates.length === 0, perVenue);
  check('auto-create: the invoice after the quote updates that order (no new one)', follow.state === 'applied' && follow.payload.order_id === o.id && !follow.payload.new_order
    && follow.payload.updates[0]?.status === 'INVOICED', follow);
}

// ── Orders list: filter by venue, sort ─────────────────────────────────
{
  const o1 = order({ order_number: 'OSE-0002', venue_id: 'v1', ordered_on: '2026-09-01', expected_on: '2026-11-20' });
  const o2 = order({ order_number: 'OSE-0010', venue_id: 'x:Multiple venues', ordered_on: '2026-10-01', expected_on: null });
  const o3 = order({ order_number: 'CUS-0003', vendor_name: 'Uline', venue_id: 'v3', ordered_on: '2026-08-15', expected_on: '2026-11-05' });
  const rows = [
    { o: o1, ls: [line(o1, { qty: 1, unit_price: 100, status: 'PAID', status_at: '2026-10-01T00:00:00Z' })] },
    { o: o2, ls: [line(o2, { qty: 2, unit_price: 500, status: 'QUOTED', venue_id: 'v2' }), line(o2, { qty: 1, unit_price: 50, status: 'SHIPPED', venue_id: 'x:Delilah Dallas' })] },
    { o: o3, ls: [line(o3, { qty: 3, unit_price: 10, status: 'DELIVERED', status_at: '2026-10-30T00:00:00Z' })] },
  ];
  const vn = (id: string | null) => ({ v1: 'Delilah LA', v2: 'Delilah Miami', v3: 'The Nice Guy', 'x:Delilah Dallas': 'Delilah Dallas' } as Record<string, string>)[id ?? ''] ?? '';
  const nums = (rs: typeof rows) => rs.map(r => r.o.order_number).join(',');
  check('venue filter: an order serving several venues shows under each of them', nums(filterByVenue(rows, 'x:Delilah Dallas')) === 'OSE-0010' && nums(filterByVenue(rows, 'v2')) === 'OSE-0010');
  check('venue filter: single-venue orders by their venue; none = all', nums(filterByVenue(rows, 'v1')) === 'OSE-0002' && filterByVenue(rows, '').length === 3);
  check('venues of an order', orderVenueIds(o2, rows[1].ls).sort().join() === 'v2,x:Delilah Dallas' && orderVenueIds(o1, rows[0].ls).join() === 'v1');
  check('sort: newest / oldest', nums(sortOrders(rows, 'newest', vn)) === 'OSE-0010,OSE-0002,CUS-0003' && nums(sortOrders(rows, 'oldest', vn)) === 'CUS-0003,OSE-0002,OSE-0010');
  check('sort: total high to low', nums(sortOrders(rows, 'total-desc', vn)) === 'OSE-0010,OSE-0002,CUS-0003');
  check('sort: expected soonest, no date last', nums(sortOrders(rows, 'expected', vn)) === 'CUS-0003,OSE-0002,OSE-0010', nums(sortOrders(rows, 'expected', vn)));
  check('sort: status, earliest stage first', nums(sortOrders(rows, 'status', vn)) === 'OSE-0010,OSE-0002,CUS-0003');
  check('sort: order # in number order', nums(sortOrders(rows, 'number', vn)) === 'CUS-0003,OSE-0002,OSE-0010');
  check('sort: venue A-Z (an order serving several sorts by its first venue)', nums(sortOrders(rows, 'venue', vn)) === 'OSE-0010,OSE-0002,CUS-0003', nums(sortOrders(rows, 'venue', vn)));
  check('sort never changes the list it was given', nums(rows) === 'OSE-0002,OSE-0010,CUS-0003');
}

// ── E&E storage deliveries → stock draws (the real lines of Oct 2026) ───
{
  const V = [{ id: 'v1', name: 'Delilah LA' }, { id: 'v2', name: 'Delilah Miami' }, { id: 'v3', name: 'The Nice Guy' }, { id: 'v4', name: 'The Birdstreet Club' },
             { id: 'v11', name: 'Little Luck' }, { id: 'v14', name: 'Lady Delilah' }, { id: 'x:Delilah Dallas', name: 'Delilah Dallas' }];
  const st = (name: string, sku: string | null, category: string) => item({ name, sku, category, pack_size: null, lead_time_days: null });
  const napkin = st('TNG Custom Napkin /1000', 'TNG-NAPKIN', 'The Nice Guy'), tngEuro = st('TNG Eurotote Bag', 'TNG-EURO', 'The Nice Guy');
  const pizza = st('TNG Pizza Box', 'SPTNGPZBX2', 'The Nice Guy'), paso = st('Paso Robles Pizza Box', null, 'Paso Robles');
  const taco = st('BS Taco Wrap 6x7', 'SPBSTACOW', 'Bird Streets'), bsEuro = st('BS Eurotote Bag', 'SPBS-EURO', 'Bird Streets');
  const gloss = st('Delilah Gloss Eurotote Bag', 'SHUR8180', 'Delilah'), medium = st('Delilah Medium Eurotote Bag', null, 'Delilah');
  const foil = st('BS Linen-like Guest Towels (foil logo)', 'BS-FOILLOGO', 'Bird Streets');
  const pag = st('PAG Black Unbranded Eurotote Bags / 100', 'SHUR8123', 'h.wood'), soap = st("Hwood Mrs. Meyer's Hand Soap", 'SPHW8452', 'h.wood');
  const items = [napkin, tngEuro, pizza, paso, taco, bsEuro, gloss, medium, pag, soap, foil];
  const moves = [move(gloss.id, 'count', 18, '2026-10-07'), move(napkin.id, 'count', 37, '2026-10-07'), move(pag.id, 'count', 0, '2026-10-07')];
  const whs = order({ order_number: 'WHS-0001', venue_id: 'x:Multiple venues' }), bsc = order({ order_number: 'WHS-0007', venue_id: 'v4' });
  const plan = (description: string, o = bsc, venue_id: string | null = null) => planStorageLine({ description, venue_id }, o, items, moves, V);
  const draws = (p: ReturnType<typeof plan>) => p.draws.map(d => `${d.qty} ${d.name}`).join(' + ');

  const a = plan('TNG delivery - 10/12/2026 - 3 CASES TNG-EURO / 2 CASES TNG-PIZZAB');
  check('storage: two items on one line, venue from the text (not the BSC order it sits on), the day written on it',
    a.problem === null && a.kind === 'release' && a.venueId === 'v3' && a.day === '2026-10-12' && draws(a) === '3 TNG Eurotote Bag + 2 TNG Pizza Box', a);
  check('storage: a cut-off SKU still finds the item by its words, and only among the venue\'s brand (not Paso Robles)', a.draws[1]?.itemId === pizza.id);
  const b = plan('TNG delivery - 10/07/2026 - 3 CASES TNG-NAPKIN', whs, 'v3');
  check('storage: SKU written on the line', b.problem === null && draws(b) === '3 TNG Custom Napkin /1000' && b.day === '2026-10-07');
  const c = plan('BSC delivery - 10/22/2026 - 2cs taco wrap');
  check('storage: "2cs taco wrap" = 2 cases of BS Taco Wrap for Bird Streets', c.problem === null && c.venueId === 'v4' && draws(c) === '2 BS Taco Wrap 6x7');
  const d = plan('Delilah Miami delivery - 10/05/2026 - 5 CASES OF BAGS SHIPPED VIA UPS', whs, 'v2');
  check('storage: "bags" for Delilah = the Delilah bag we hold stock of (gloss counted, medium never)', d.problem === null && d.venueId === 'v2' && draws(d) === '5 Delilah Gloss Eurotote Bag', d);
  const e = plan('Delilah Dallas delivery - 10/05/2026 - 2cs of bags via UPS', whs, 'x:Delilah Dallas');
  check('storage: an order-only venue (Delilah Dallas) is read from the text too', e.problem === null && e.venueId === 'x:Delilah Dallas' && draws(e) === '2 Delilah Gloss Eurotote Bag');
  const f = planStorageLine({ description: 'Delilah LA delivery - 10/05/2026 - 2cs of bags via UPS', venue_id: 'v1' }, whs, items, [], V);
  check('storage: two equal matches and stock of neither = asked, not guessed', f.problem !== null && /could be .* or .*pick one/i.test(f.problem) && !f.draws.length, f.problem);
  const g = plan('TNG delivery - 10/19/2026 - 6 CASES / UBER PICK UP');
  check('storage: cases with no item named = asked which item', g.problem !== null && /which item are the 6 cases\?/i.test(g.problem) && g.venueId === 'v3', g.problem);
  check('storage: a date with nothing else = asked', /no item or quantity/i.test(plan('BSC delivery - 10/13/2026').problem ?? ''));
  const h = plan('Receiving and Warehousing - TNG napkins - 1pallet', whs, 'v3');
  check('storage: receiving = stock coming in; a pallet asks how many cases', h.kind === 'receipt' && /how many cases of TNG Custom Napkin \/1000 were on the pallet\?/i.test(h.problem ?? ''), h.problem);
  const i2 = plan('Delilah Miami UPS returns CS 1', order({ venue_id: 'v2' }));
  check('storage: a return is stock coming back; "CS 1" is 1 case, the item still has to be named', i2.kind === 'receipt' && /which item is the 1 case\?/i.test(i2.problem ?? ''), i2.problem);
  check('storage: a delivery with no venue written and a several-venue order = asked which venue',
    /which venue/i.test(plan('delivery - 11/02/2026 - 2 cs hand soap', whs).problem ?? ''));
  check('storage: two venues on one line = asked', /more than one venue/i.test(plan('Delilah LA / Delilah Miami delivery - 11/02/2026 - 2cs bags', whs).problem ?? ''));
  check('storage: h.wood stock any venue can draw', draws(plan('TNG delivery - 11/02/2026 - 1 cs hand soap')) === "1 Hwood Mrs. Meyer's Hand Soap");
  check('storage: an item not in stock = asked', /no stock item matches/i.test(plan('TNG delivery - 11/02/2026 - 2 cs glass ashtrays').problem ?? ''));
  const k = plan('BSC - delivery 10/28/2026 SKU: BS-EUROTTE (2) SKU: BS-FOILLOGO (2)', order({ venue_id: null }));
  check('storage: E&E\'s "SKU: X (2)" form (11/3 pull) — one draw per SKU, cases in brackets, E&E\'s own SKU spelling',
    k.problem === null && k.venueId === 'v4' && k.day === '2026-10-28' && draws(k) === '2 BS Eurotote Bag + 2 BS Linen-like Guest Towels (foil logo)', k);
  check('storage: one letter off in a long word still matches ("EUROTTE")',
    draws(plan('Delilah LA delivery - 11/02/2026 - SKU: DEL-EUROTTE (3)', whs, 'v1')) === '3 Delilah Gloss Eurotote Bag');
  const rows = storageMoveRows(a, { id: 'L9', description: 'TNG delivery - 10/12/2026 - 3 CASES TNG-EURO / 2 CASES TNG-PIZZAB' }, '2026-10-20');
  check('storage moves: one release per item, tied to the line, on the delivery day at noon (a count that day wins)',
    rows.length === 2 && rows.every(r => r.line_id === 'L9' && r.kind === 'release' && r.venue_id === 'v3' && r.moved_on === '2026-10-12' && r.created_at === '2026-10-12T19:00:00Z'));
  check('storage moves: no day on the line = the invoice day', storageMoveRows(plan('TNG delivery 3 cases tng-euro'), { id: 'L', description: 'x' }, '2026-10-20')[0]?.moved_on === '2026-10-20');
  const counted = [move(napkin.id, 'count', 37, '2026-10-07', { created_at: '2026-10-07T21:42:58Z' }),
                   ...storageMoveRows(b, { id: 'L1', description: 'x' }, '2026-10-14').map(r => ({ ...r, id: 'm-x', item_id: r.item_id } as OtMove)),
                   ...storageMoveRows(plan('TNG delivery - 10/12/2026 - 3 CASES TNG-NAPKIN'), { id: 'L2', description: 'x' }, '2026-10-20').map(r => ({ ...r, id: 'm-y' } as OtMove))];
  check('storage moves: a same-day draw is inside the count; a later one comes off it', onHand(counted) === 34);
  check('storage line = an E&E delivery / return / receiving fee line, nothing else',
    isStorageLine({ description: 'TNG delivery - 10/07/2026 - 3 CASES', item_id: null }, 'EE Mercantile')
    && isStorageLine({ description: 'Receiving and Warehousing - TNG napkins', item_id: null }, 'E&E Mercantile Co.')
    && !isStorageLine({ description: 'TNG delivery - 10/07/2026', item_id: null }, 'Uline')
    && !isStorageLine({ description: 'Delilah to-go bags', item_id: null }, 'EE Mercantile')
    && !isStorageLine({ description: 'Delivery fee', item_id: 'i1' }, 'EE Mercantile'));
}

// ── order # for orders the pull starts ──────────────────────────────
{
  const st = (name: string, category: string | null) => item({ name, sku: null, category });
  const items = [st('BS Eurotote Bag', 'Bird Streets'), st('Hwood Mrs. Meyer\'s Hand Soap', 'h.wood')];
  const orders = ['WHS-0001', 'WHS-0010', 'CUS-0025', 'CUS-0025-DAL', 'CUS-0042', 'OSE-0035', null].map(n => ({ order_number: n }));
  const nl = (description: string) => ({ description, sku: null, item_id: null });
  check('order #: an E&E storage delivery -> next WHS', autoOrderNumber([nl('BSC - delivery 10/28/2026 SKU: BS-EUROTTE (2)')], 'EE Mercantile', { orders, items }) === 'WHS-0011');
  check('order #: a custom (branded) item -> next CUS', autoOrderNumber([nl('Bird Streets eurotote bag')], 'EE Mercantile', { orders, items }) === 'CUS-0043');
  check('order #: anything else -> next OSE', autoOrderNumber([nl('LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12')], 'EE Mercantile', { orders, items }) === 'OSE-0036');
  check('order #: a series starts at 0001', autoOrderNumber([nl('Mepra wine cooler')], 'EE Mercantile', { orders: [], items: [] }) === 'OSE-0001');
}

// ── a price option printed like a line (Alphabet Eurototes quote Q-2026-1021-5051, 11/3) ──
{
  const pl = (description: string, qty: number, unit_price: number, line_kind: DocLine['line_kind'] = 'product'): DocLine =>
    ({ line_kind, description, sku: '', qty, unit: 'case', unit_price, line_total: Math.round(qty * unit_price * 100) / 100, pack_size: 100 });
  const lines = [pl('Eurotote Bag - via air (100/CS) 16x9x12" C1S 200 gsm print 3C', 10, 550.8), pl('Eurotote Bag - via sea (100/CS) 16x9x12" C1S 200 gsm print 3C', 90, 214.8),
                 pl('Volume Pricing: 100C', 100, 198), { ...pl('TAX', 0, 0, 'tax'), line_total: 1800.9 }];
  const printed = { subtotal: 24840, total: 26640.9, lines };
  check('outside the subtotal: the one line whose removal makes it add up ("Volume Pricing")', lineOutsideSubtotal(lines, 24840) === 2);
  check('outside the subtotal: none when the lines already add up, or no single line explains it',
    lineOutsideSubtotal(lines.slice(0, 2), 24840) === null && lineOutsideSubtotal(lines, 20000) === null && lineOutsideSubtotal(lines, 0) === null);
  const rows = planDocRows(lines, [], [], 'quote', false, 24840);
  check('review: the price option starts unticked and says why; the air + sea lines stay ticked',
    rows[2].include === false && rows[2].outside === true && rows[0].include && rows[1].include && !rows[0].outside);
  const checks = documentChecks({ kind: 'quote', vendor: 'EE Mercantile', docNumber: 'Q-2026-1021-5051', order: null, orderLines: [], rows }, printed,
    { documents: [], lines: [], orders: [] }, x => '$' + x.toFixed(2));
  check('review: no red "lines add up to $44,640" warning for it', !checks.some(c => /add up/.test(c)), checks);
  check('review: a genuinely missing line still warns', documentChecks({ kind: 'quote', vendor: 'EE', docNumber: 'Q', order: null, orderLines: [], rows },
    { ...printed, subtotal: 30000 }, { documents: [], lines: [], orders: [] }, x => '$' + x.toFixed(2)).some(c => /add up/.test(c)));
  const saved = planDocumentSave({ docId: 'd', kind: 'quote', vendor: 'EE Mercantile', docNumber: 'Q-2026-1021-5051', docDate: '2026-10-21', orderNumber: '', expected: '', tracking: '',
    order: null, orderLines: [], deliverTo: 'warehouse', venueId: 'v12', rows, today: '2026-11-03', fileName: 'q.pdf', storagePath: 'p', total: 26640.9, parsed: {} });
  check('saved: 10 cs air + 90 cs sea = $24,840, not 200 cases', saved.new_lines.length === 2 && saved.new_lines.reduce((s, l) => s + l.qty * (l.unit_price ?? 0), 0) === 24840);
  const ui = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  check('Inbox: a saved item leaves the list at once (not after the minute-long re-check)',
    /setInbox\(list => list\.filter\(i => i\.id !== done\)\)[\s\S]{0,200}void reload\(\);[\s\S]{0,200}redecideInbox\(\)/.test(ui('src/screens/OrderTracker.tsx')));
  check('review: opened again after saving = "Already saved on …", no second save',
    /alreadySaved = data\.documents\.find\(d => d\.id === docId\)/.test(ui('src/components/orderTracker/DocumentReview.tsx')) && /saved \|\| !!alreadySaved/.test(ui('src/components/orderTracker/DocumentReview.tsx')));
  check('review: a new order saved with no number gets the next one', /new_order\.order_number = autoOrderNumber\(/.test(ui('src/components/orderTracker/DocumentReview.tsx')));
}

// ── a separate shipping-fee invoice names the invoice it is for (INV-2026-885072 -> INV-2026-368461) ──
{
  const o = order({ order_number: 'OSE-0030', venue_id: 'x:Multiple venues', deliver_to: 'venue' });
  const kit = line(o, { description: 'FOOD STORAGE CONTAINER Cambro 4SFSCW135', sku: '4SFSCW135', qty: 6, unit_price: 40, status: 'INVOICED', invoice_number: 'INV-2026-368461', venue_id: 'v3' });
  const other = order({ order_number: 'OSE-0031', vendor_name: 'EE Mercantile' });
  const data = { orders: [o, other], lines: [kit, line(other, { invoice_number: 'INV-2026-111111' })], items: [], documents: [] as OtDocument[] };
  check('references: the order holding the invoice it names, and that invoice\'s venue',
    orderForReferences(['INV-2026-368461'], 'INV-2026-885072', data)?.order.id === o.id && orderForReferences(['INV-2026-368461'], 'INV-2026-885072', data)?.venueId === 'v3');
  check('references: never its own number; nothing / unknown = none',
    orderForReferences(['INV-2026-885072'], 'INV-2026-885072', data) === null && orderForReferences([], 'X', data) === null && orderForReferences(['INV-2026-999999'], 'X', data) === null && orderForReferences(undefined, 'X', data) === null);
  check('references: an invoice on two orders = unsure = none',
    orderForReferences(['INV-2026-368461'], 'X', { ...data, lines: [...data.lines, line(other, { invoice_number: 'INV-2026-368461' })] }) === null);
  const fee: ReadDoc = { doc_kind: 'invoice', is_credit: false, vendor_name: 'EE Mercantile', doc_number: 'INV-2026-885072', doc_date: '2026-10-29', order_number: '', expected_date: '',
    tracking_numbers: [], refers_to: ['INV-2026-368461'], subtotal: 494.4, total: 494.4, bill_to: 'h.wood Group', ship_to: '',
    lines: [{ line_kind: 'freight', description: 'Shipping fee', sku: '', qty: 1, unit: '', unit_price: 494.4, line_total: 494.4, pack_size: 0 }] };
  const src = { id: 'ib-fee', message_id: 'M-fee', conversation_id: 'ANOTHER-THREAD', file_name: 'Invoice-INV-2026-885072.pdf', storage_path: 'docs/ib-fee.pdf' };
  const d = decideMailDocument(fee, src, data, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: true, venues: [{ id: 'v3', name: 'The Nice Guy' }] });
  check('shipping-fee invoice: goes onto the order of the invoice it names (another email thread, no new order)',
    d.state === 'applied' && d.payload.order_id === o.id && !d.payload.new_order && d.payload.new_lines.length === 1 && /it is for INV-2026-368461/.test(d.reason), d);
  check('shipping-fee invoice: its line carries that invoice\'s venue on a several-venue order',
    d.state === 'applied' && d.payload.new_lines[0].venue_id === 'v3' && d.payload.new_lines[0].invoice_number === 'INV-2026-885072', d.state === 'applied' && d.payload.new_lines);
  const noRef = decideMailDocument({ ...fee, refers_to: [] }, src, data, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: true, venues: [] });
  check('shipping-fee invoice naming nothing: starts its own order as before', noRef.state === 'applied' && !!noRef.payload.new_order, noRef);
  const unknownRef = decideMailDocument({ ...fee, refers_to: ['INV-2026-999999'] }, src, data, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: true, venues: [] });
  check('shipping-fee invoice naming an invoice not in the tracker: waits ("save it onto that order"), no stray order',
    unknownRef.state === 'pending' && /INV-2026-999999, which is not on any order yet/.test(unknownRef.reason), unknownRef);
  const otherVendor = decideMailDocument({ ...fee, vendor_name: 'Uline' }, src, data, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: false });
  check('shipping-fee invoice from another vendor naming our invoice: not put on it', otherVendor.state === 'pending', otherVendor);
  check('review: opens on the order of the invoice it names',
    /fromInbox \?\? orderForReferences\(doc\.refers_to, doc\.doc_number, data\)\?\.order \?\? matchOrder\(/.test(readFileSync(join(process.cwd(), 'src/components/orderTracker/DocumentReview.tsx'), 'utf8')));
  const reader = sibling('supabase', 'functions', '_shared', 'purchase-doc.ts');
  if (reader) check('reader: asks for refers_to and requires it', /refers_to: \{ type: 'array'/.test(reader) && /'tracking_numbers', 'refers_to',/.test(reader));
}

// ── Find in Outlook: one older invoice / quote by its number ─────────
{
  check('find: nothing found / already pulled / pulled and decided, in a sentence',
    findSummary('INV-2026-418553', { found: 0 }).startsWith('No e-mail from a listed vendor')
    && /already pulled/.test(findSummary('INV-2026-418553', { found: 2, new_pdfs: 0 }))
    && findSummary('INV-2026-418553', { found: 1, new_pdfs: 1, applied: 1, paid: 1 }) === 'INV-2026-418553: 1 PDF pulled — 1 saved to an order, 1 marked paid from R365.'
    && findSummary('X', { found: 0, reason: 'A pull is running — try again in a minute.' }).startsWith('A pull is running'));
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn) check('find: corporate-only action, holds the run lock and always lets it go, vendor senders only, PDFs read + paid check',
    /if \(action === 'find'\)/.test(fn) && fn.indexOf("if (action === 'find')") > fn.indexOf('const caller = await corporateCaller')
    && /kount_ot_mail_begin_run[\s\S]{0,400}findPhase\(sb, number, stats\)[\s\S]{0,400}readPhase[\s\S]{0,200}r365PaidPhase[\s\S]{0,900}finally \{\s*await sb\.from\('kount_ot_mail_account'\)\.update\(\{ running_since: null/.test(fn)
    && /!m\.hasAttachments \|\| !domain \|\| !onList\(domain, domains\)/.test(fn));
}

// ── other attachments of an order's e-mails (0142) ───────────────────
{
  check('kept: a spreadsheet / CSV / Word / a real photo', keepOtherAttachment({ name: 'Tracking Delilah.xlsx', size: 9000 }) === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    && keepOtherAttachment({ name: 'ship.csv', size: 300 }) === 'text/csv' && keepOtherAttachment({ name: 'spec.docx', size: 40000 })?.includes('wordprocessingml') === true
    && keepOtherAttachment({ name: 'IMG_2041.jpeg', size: 1_800_000 }) === 'image/jpeg');
  check('left: inline pictures, signature logos (image001.png, small images), unknown types, PDFs (read separately), over 20 MB',
    keepOtherAttachment({ name: 'photo.jpg', size: 900000, isInline: true }) === null && keepOtherAttachment({ name: 'image001.png', size: 80000 }) === null
    && keepOtherAttachment({ name: 'tiny.png', size: 4000 }) === null && keepOtherAttachment({ name: 'setup.exe', size: 1000 }) === null
    && keepOtherAttachment({ name: 'Invoice.pdf', size: 5000 }) === null && keepOtherAttachment({ name: 'big.xlsx', size: 30 * 1024 * 1024 }) === null);
  check('spreadsheet = xlsx / xls / csv', isSpreadsheet('a.XLSX') && isSpreadsheet('b.csv') && !isSpreadsheet('c.docx') && !isSpreadsheet(null));
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn) check('pull: other attachments go onto the e-mail\'s order (thread / INV #), once (hash + message|file); a sheet moves each line by its own row, never every line; never fails the pull',
    /orderForEmail\(m\.conversationId \?\? null/.test(fn) && /kind: 'other'/.test(fn) && /content_hash: await sha256Hex\(bytes\)/.test(fn)
    && /sheetUpdates\(grid, lines/.test(fn) && /ignoreDuplicates: true/.test(fn) && !/ship_lines: true/.test(fn.slice(fn.indexOf('async function attachOthersOf'), fn.indexOf('async function trackingPhase')))
    && /stats\.others_error = msg\(e\)/.test(fn) && /await otherPhase\(sb, stats\);/.test(fn));
}

// ── the redesigned Orders screen (v0.87): what it shows ──────────────
{
  const o = order({ order_number: 'CUS-0012', venue_id: 'v4', deliver_to: 'venue', expected_on: '2026-11-20', updated_at: '2026-10-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' });
  const paidL = line(o, { status: 'PAID', invoice_number: 'INV-1', invoice_date: '2026-09-01', qty: 2, unit_price: 100, status_at: '2026-10-02T00:00:00Z' });
  const invL = line(o, { status: 'INVOICED', invoice_number: 'INV-2', invoice_date: '2026-10-10', qty: 1, unit_price: 50, expected_on: '2026-10-25' });
  const reqL = line(o, { status: 'REQUESTED', qty: 1, unit_price: 10 });
  check('fulfillment: invoiced / paid = In production (prepaid), the other steps by name',
    fulfillmentOf('INVOICED') === 'In production' && fulfillmentOf('PAID') === 'In production' && fulfillmentOf('SHIPPED') === 'Shipped' && fulfillmentOf(null) === null
    && fulfillmentStep('QUOTED') === 2 && fulfillmentStep('RECEIVED') === 6 && fulfillmentStep('CANCELLED') === -1);
  const p = paymentOf([paidL, invL], '2026-11-03');
  check('payment: an invoice at Invoiced = not paid, its amount and days waiting', p.state === 'unpaid' && p.unpaid$ === 50 && p.oldestDays === 24 && p.invoices.join() === 'INV-1,INV-2', p);
  check('payment: all paid / some paid / none invoiced', paymentOf([paidL], '2026-11-03').state === 'paid' && paymentOf([paidL, reqL], '2026-11-03').state === 'part'
    && paymentOf([reqL], '2026-11-03').label === 'Not invoiced');
  check('payment: an invoice # typed on a line still at Quoted counts as unpaid', paymentOf([line(o, { status: 'QUOTED', invoice_number: 'INV-9', invoice_date: '2026-11-01' })], '2026-11-03').state === 'unpaid');
  check('next ETA: the soonest date of what has not arrived (a line\'s own, else the order\'s)', nextEta(o, [paidL, invL]) === '2026-10-25' && nextEta(o, [paidL]) === '2026-11-20'
    && nextEta(o, [line(o, { status: 'DELIVERED', expected_on: '2026-01-01' })]) === null);
  check('category from the order # series', orderCategory('CUS-0012') === 'Custom / branded' && orderCategory('ose-0030') === 'Operating supplies' && orderCategory('WHS-0011') === 'Warehousing & delivery' && orderCategory('PO-7') === null);
  const now = Date.parse('2026-11-03T12:00:00Z');
  check('updated: just now / minutes / hours / days', timeAgo('2026-11-03T11:59:30Z', now) === 'just now' && timeAgo('2026-11-03T11:00:00Z', now) === '1h ago' && timeAgo('2026-11-03T11:30:00Z', now) === '30m ago'
    && timeAgo('2026-11-03T06:00:00Z', now) === '6h ago' && timeAgo('2026-10-31T12:00:00Z', now) === '3d ago' && timeAgo(null, now) === '—');
  check('updated = the latest of the order and its lines', lastUpdate(o, [paidL]) === '2026-10-02T00:00:00Z');

  const data = { orders: [o], lines: [paidL, invL, reqL], items: [] as OtItem[], moves: [] as OtMove[] };
  const k = trackerKpis(data, '2026-11-03');
  check('KPIs: open, late (oldest days), on order, invoiced-not-paid, invoices', k.open === 1 && k.openLines === 3 && k.late === 1 && k.oldestLateDays === 9
    && k.onOrder$ === 250 && k.unpaid$ === 50 && k.unpaidInvoices === 1 && k.oldestUnpaidDays === 24, k);
  const att = attentionItems(data, '2026-11-03', 3, x => '$' + x);
  check('bell: late orders first, then unpaid past 14 days, then the Inbox', att.map(a => a.sev).join() === 'crit,warn,info' && att[0].act.kind === 'order'
    && /1 line past ETA/.test(att[0].sub) && /24 days unpaid/.test(att[1].sub) && att[2].title === '3 documents waiting in the Inbox', att);

  // the drawer: a draft saved in one go
  const d0 = orderDraft(o, [paidL, invL], '2026-11-03');
  const same = planOrderSave(o, [paidL, invL], d0, { items: [], received: () => 0 });
  check('drawer: an untouched draft saves nothing', isPlanEmpty(same) && !same.problems.length, same);
  const d1 = { ...d0, notes: 'call Aleli', lines: [{ ...d0.lines[0], qty: '3' }, { ...d0.lines[1], removed: true }, { ...lineDraft(null), description: 'Pins', qty: '20', unit_price: '5' }] };
  const p1 = planOrderSave(o, [paidL, invL], d1, { items: [], received: () => 0 });
  check('drawer: only what changed — order notes, a qty, a removed line, a new line',
    JSON.stringify(p1.order) === '{"notes":"call Aleli"}' && p1.updates.length === 1 && JSON.stringify(p1.updates[0].patch) === '{"qty":3}'
    && p1.removes.join() === invL.id && p1.adds.length === 1 && p1.adds[0].qty === 20 && p1.adds[0].unit_price === 5, p1);
  check('drawer: problems stop the save', planOrderSave(o, [paidL], { ...d0, vendor_name: ' ' }, { items: [], received: () => 0 }).problems[0] === 'Enter the vendor.'
    && /Line 1: enter the quantity/.test(planOrderSave(o, [paidL], { ...d0, lines: [{ ...d0.lines[0], qty: 'x' }] }, { items: [], received: () => 0 }).problems.join()));
  const st = setDraftStage(d0, 'SHIPPED');
  check('stepper: every live line to the step; counts lines moved back', st.backward === 0 && st.draft.lines.every(l => l.status === 'SHIPPED')
    && setDraftStage(d0, 'QUOTED').backward === 2 && draftStage(d0) === 'INVOICED');
  check('payment buttons: forward only', markDraft(d0, 'PAID').lines.map(l => l.status).join() === 'PAID,PAID' && markDraft({ ...d0, lines: [{ ...d0.lines[0], status: 'SHIPPED' }] }, 'PAID').lines[0].status === 'SHIPPED');
  check('totals: qty × unit cost of live lines', draftTotal(d0) === 250 && draftLineTotal({ qty: '2', unit_price: '' }) === 0);
  const stocked = item({ name: 'BS Towel', track_stock: true });
  const wo = { ...o, deliver_to: 'warehouse' as const };
  const towel = line(wo, { item_id: stocked.id, qty: 10, status: 'DELIVERED' });
  const recv = planOrderSave(wo, [towel], { ...orderDraft(wo, [towel], '2026-11-03'), lines: [{ ...lineDraft(towel), status: 'RECEIVED' }] }, { items: [stocked], received: () => 4 });
  check('drawer: ticking received on a stocked warehouse line receives what is left (6 of 10) into stock', recv.receipts.length === 1 && recv.receipts[0].qty === 6 && recv.updates[0].patch.status === 'RECEIVED', recv);
  const back = planOrderSave(o, [paidL], { ...d0, lines: [{ ...d0.lines[0], status: 'QUOTED' }] }, { items: [], received: () => 0 });
  check('drawer: a line moved back is counted (the screen asks first)', back.backward === 1);
  const fresh = planOrderSave(null, [], { ...orderDraft(null, [], '2026-11-03'), vendor_name: 'Uline', lines: [{ ...lineDraft(null), description: 'BS Towel', qty: '2' }] }, { items: [stocked], received: () => 0 });
  check('new order: all fields, the line\'s item from its exact catalog name', fresh.order.vendor_name === 'Uline' && fresh.order.ordered_on === '2026-11-03' && fresh.adds[0].item_id === stocked.id, fresh);
}

// ── E&E "Delivery Status" sheets: each row moves its own line (the 11/3 sheets) ──
{
  // TNG Kitchenware Delivery Status Report.xlsx — every item "Complete"; "Qty Delievered" spelled so
  const tng = order({ order_number: 'OSE-0030' });
  const box = line(tng, { description: 'FOOD STORAGE CONTAINER Cambro Model No. 4SFSCW135 Packed 6 ea', sku: null, qty: 8, status: 'PAID' });
  const pot = line(tng, { description: 'STOCK POT Rosenthal Sambonet Paderno Model No. 11001-24 Stock pot', sku: null, qty: 2, status: 'PAID' });
  const lid = line(tng, { description: '11061-24 Lid, 9-1/2" dia., stainless steel', sku: null, qty: 2, status: 'PAID' });
  const fee = line(tng, { description: 'Shipping', sku: null, qty: 1, status: 'INVOICED' });
  const H = ['', 'EEMC Descriptionn', 'Item #', 'Qty Ordered', 'SRP', 'Total Cost', 'Inv #', 'Qty Delievered', 'ETA', 'Tracking #', 'Remarks'];
  const a = sheetUpdates([H,
    ['1.0', 'CAMBRO - SQUARE CONTAINER 4QT', '4SFSCW135', '8.0', '10.81', '86.48', 'INV-2026-368461', '8.0', '2026-10-06', 'via truck', 'Complete'],
    ['8.0', 'ROSENTHAL - STOCK POT LID SS', '11001-24', '2.0', '122.45', '244.9', 'INV-2026-368461', '2.0', '2026-10-08', 'UPS 1Z7R988F0346095754', 'Complete'],
    ['9.0', 'ROSENTHAL - STOCK POT LID SS', '11061-24', '2.0', '28.96', '57.92', 'INV-2026-368461', '2.0', '2026-10-08', 'UPS 1Z7R988F0346095754', 'Complete'],
  ], [box, pot, lid, fee], 'TNG Kitchenware Delivery Status Report.xlsx');
  const by = (r: typeof a, l: OtLine) => r.updates.find(u => u.lineId === l.id);
  check('sheet rows: "Complete" = Delivered, matched by the SKU in the line\'s description, each line once',
    a.matched === 3 && by(a, box)?.status === 'DELIVERED' && by(a, pot)?.status === 'DELIVERED' && by(a, lid)?.status === 'DELIVERED' && !by(a, fee), a);
  check('sheet rows: the row\'s tracking goes on its line, carrier numbers onto the order (not "via truck")',
    by(a, pot)?.tracking === 'UPS 1Z7R988F0346095754' && by(a, box)?.tracking === 'via truck' && a.tracking.map(h => h.number).join() === '1Z7R988F0346095754');

  // The Bird Street Delivery Status September Order.xlsx — complete, a back order, "ETA to follow"
  const bs = order({ order_number: 'OSE-0009' });
  const zombie = line(bs, { description: 'LIBBEY - ZOMBIE GLASS - 12 OZ / 36', sku: null, qty: 1, status: 'PAID' });
  const shot = line(bs, { description: 'SPIEGELAU - SHOT GLASS PERFECT SERVE 2.5 OZ / 12', sku: '4508041', qty: 8, status: 'PAID' });
  const stolzle = line(bs, { description: 'STOLZLE - STARLIGHT BORDEAUX 22 OZ / 6', sku: 'Z2450035', qty: 1, status: 'PAID' });
  const HB = ['', 'EEMC Descriptionn', 'Item #', 'Qty Ordered', 'SRP', 'Total Cost', 'Inv # (paid 10/02/2026)', 'Qty Delivered', 'ETA', 'Tracking #', 'Remarks'];
  const b = sheetUpdates([HB,
    ['1', 'LIBBEY - ZOMBIE GLASS - 12 OZ / 36', '96', '1', '$161.35', '$161.35', 'INV-2026-414412', '1', '10/20/2026', 'DDP 951018778', 'Complete'],
    ['2', 'SPIEGELAU - SHOT GLASS PERFECT SERVE 2.5 OZ', '4508041', '8', '$124.74', '$997.92', 'INV-2026-414412', '3', '10/20/2026', 'DDP 951018778', 'BO: 5 case'],
    ['9', 'STOLZLE - STARLIGHT BORDEAUX', 'Z2450035', '1', '$456.30', '$456.30', 'INV-2026-414412', '', '', '', 'ETA to follow'],
  ], [zombie, shot, stolzle], 'The Bird Street Delivery Status September Order.xlsx');
  check('sheet rows: a short item # (96) is not trusted — matched by its description instead; Complete = Delivered', by(b, zombie)?.status === 'DELIVERED', b);
  check('sheet rows: a back order (3 of 8, "BO: 5 case") = Shipped, not Delivered, and says so', by(b, shot)?.status === 'SHIPPED' && /BO: 5 case, 3 of 8/.test(by(b, shot)?.note ?? ''), by(b, shot));
  check('sheet rows: "ETA to follow" with nothing else changes nothing', !by(b, stolzle));

  // For Cara Delivery Status Delilah NYC Smallwares Opening.xlsx — sections, the header repeated, an unnamed description column
  const nyc = order({ order_number: 'OPN-0011' });
  const spindle = line(nyc, { description: 'CHOICE - CHECK SPINDLE 6" / 1', sku: '407CS36C', qty: 4, status: 'PAID' });
  const carafe = line(nyc, { description: 'HOSPITALITY - CARAFE GLASS PITCHER 15 OZ / 48', sku: 'FGC51530-048', qty: 19, status: 'PAID' });
  const fork = line(nyc, { description: 'DEGRENNE - OYSTER FORK EMPIRE / 12', sku: '186517', qty: 25, status: 'PAID' });
  const HN = ['Item No', 'Mfr', 'Model', '', 'Qty', 'Unit', 'Category', 'Sell', 'SellTotal', 'Qty Delivered', 'ETA', 'Tracking Numbers', 'Remarks'];
  const c = sheetUpdates([['DELILAH NYC OPENING ORDERS'], ['SMALLWARES BATCH 1'], HN, ['DELIVERED'],
    ['29', 'Custom', '407CS36C', 'CHOICE - CHECK SPINDLE 6" / 1', '4', 'ea', 'Check Spindle', '2.87', '11.48', '4', '10/15/2026', 'Fedex 547141861476', ''],
    HN, ['IN TRANSIT'],
    ['31', 'Hospitality Brands', 'FGC51530-048', 'HOSPITALITY - CARAFE GLASS P', '19', 'cs', 'Decanter Carafe', '275.1', '5226.9', '19', '10/21/2026', '', ''],
    ['9', 'Custom', '186517', 'DEGRENNE - OYSTER FORK EMPIRE', '25', 'dz', 'Fork, Cocktail Oyster', '103.68', '2592', '20', '10/23/2026', 'Daylight 184555563', ''],
  ], [spindle, carafe, fork], 'For Cara Delivery Status Delilah NYC Smallwares Opening.xlsx');
  check('sheet sections: DELIVERED rows = Delivered (with the FedEx #), IN TRANSIT rows = Shipped even at 19 of 19, with their ETA',
    by(c, spindle)?.status === 'DELIVERED' && by(c, carafe)?.status === 'SHIPPED' && by(c, carafe)?.eta === '2026-10-21' && by(c, fork)?.status === 'SHIPPED' && by(c, fork)?.eta === '2026-10-23'
    && c.tracking.some(h => h.number === '547141861476' && h.carrier === 'FedEx'), c);
  check('sheet rows that match no line of the order are left alone', sheetUpdates([HN, ['1', 'X', 'NOPE-123', 'Something else entirely', '1', 'ea', '', '', '', '1', '', 'Fedex 547141861476', 'Delivered']], [spindle], 'x.xlsx').matched === 0);
}

// ── a spreadsheet shown in the page (v0.89 document viewer) ──────────
{
  check('csv: quoted commas, doubled quotes, a line break inside quotes, CRLF rows, a byte-order mark',
    JSON.stringify(parseCsv(String.fromCharCode(0xfeff) + 'Item,Qty,Tracking #\r\n"Tray, oval",16,"Fedex ""878681470371"""\r\n"two\nlines",1,\r\n'))
      === JSON.stringify([['Item', 'Qty', 'Tracking #'], ['Tray, oval', '16', 'Fedex "878681470371"'], ['two\nlines', '1', '']]));
  const tidy = tidyRows([['a', '', ''], ['', 'b', ''], ['', '', ''], ['', '', '']]);
  check('tidy: trailing empty rows and columns off, rows made even', JSON.stringify(tidy.rows) === JSON.stringify([['a', ''], ['', 'b']]) && !tidy.truncated);
  check('tidy: more rows than the preview shows = truncated', tidyRows(Array.from({ length: 2005 }, () => ['x'])).truncated && tidyRows(Array.from({ length: 2005 }, () => ['x'])).rows.length === 2000);
  check('cell text: a date as its calendar day, a formula by its result, rich text, a link, a whole number, a long decimal',
    cellText(new Date(Date.UTC(2026, 9, 15))) === '10/15/2026' && cellText({ formula: 'B2*C2', result: 11.48 }) === '11.48'
    && cellText({ richText: [{ text: 'Fedex ' }, { text: '547141861476' }] }) === 'Fedex 547141861476' && cellText({ text: 'UPS', hyperlink: 'https://ups.com' }) === 'UPS'
    && cellText(547141861476) === '547141861476' && cellText(2.87) === '2.87' && cellText(1 / 3) === '0.333333' && cellText(null) === '');

  const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Smallwares Batch 1');
  ws.addRow(['Item No', 'Model', '', 'Qty', 'Sell', 'SellTotal', 'ETA', 'Tracking Numbers']);
  ws.addRow([29, '407CS36C', 'CHOICE - CHECK SPINDLE 6"', 4, 2.87, { formula: 'D2*E2', result: 11.48 }, new Date(Date.UTC(2026, 9, 15)), 'Fedex 547141861476']);
  ws.addRow(['DELIVERED']); ws.mergeCells('A3:H3');
  wb.addWorksheet('Batch 2').addRow(['IN TRANSIT']);
  wb.addWorksheet('hidden notes', { state: 'hidden' }).addRow(['secret']);
  const sheets = await sheetsFromXlsx(await wb.xlsx.writeBuffer() as ArrayBuffer);
  check('xlsx: every visible sheet, as the cells read (formula result, date), a merged block once', sheets.map(s => s.name).join('|') === 'Smallwares Batch 1|Batch 2'
    && JSON.stringify(sheets[0].rows[1]) === JSON.stringify(['29', '407CS36C', 'CHOICE - CHECK SPINDLE 6"', '4', '2.87', '11.48', '10/15/2026', 'Fedex 547141861476'])
    && JSON.stringify(sheets[0].rows[2]) === JSON.stringify(['DELIVERED', '', '', '', '', '', '', '']), sheets);
  check('file type: .xlsx / .csv shown, anything else (Word, old .xls) not', (await sheetsFromFile('a.docx', new ArrayBuffer(0))) === null
    && (await sheetsFromFile('Ship.CSV', new TextEncoder().encode('a,b\n1,2').buffer as ArrayBuffer))?.[0].rows.length === 2);
  const ui = readFileSync(join(process.cwd(), 'src/components/orderTracker/ui.tsx'), 'utf8');
  check('viewer: a spreadsheet opens as tables (never as HTML from the file), with Download kept', /sheetsFromFile\(doc\.storage_path/.test(ui) && /<SheetTables/.test(ui) && !/dangerouslySetInnerHTML/.test(ui));
}

// ── check stubs to get from R365 (0143) ──────────────────────────────
{
  const ach = (number: string, date: string, amount: number) => [{ number, date, amount }];
  const a = order({ order_number: 'OSE-0035', vendor_name: 'EE Mercantile' }), b = order({ order_number: 'CUS-0041' }), c = order({ order_number: 'WHS-0001' });
  const old = order({ order_number: 'CUS-0001', archived_at: '2026-10-01T00:00:00Z' });
  const ls = [
    line(a, { invoice_number: 'INV-2026-418553', status: 'PAID', qty: 3, unit_price: 100, r365_payments: ach('ACH - 24567', '2026-10-22', 10926.42) }),
    line(a, { invoice_number: 'INV-2026-418553', status: 'DELIVERED', qty: 1, unit_price: 50, r365_payments: ach('ACH - 24567', '2026-10-22', 10926.42) }),
    line(b, { invoice_number: 'INV-2026-466262 Delilah Miami', status: 'SHIPPED', qty: 1, unit_price: 80, r365_payments: ach('ACH - 24567', '2026-10-22', 10926.42) }),
    line(b, { invoice_number: 'INV-2026-280644', status: 'PAID', qty: 1, unit_price: 70, r365_payments: ach('ACH - 24779', '2026-10-29', 8355.77) }),
    line(c, { invoice_number: 'INV-2026-875132', status: 'PAID', qty: 1, unit_price: 28.8 }),
    line(c, { invoice_number: 'INV-2026-804153', status: 'INVOICED', qty: 1, unit_price: 36.6 }),
    line(old, { invoice_number: 'INV-2026-752134', status: 'PAID', qty: 1, unit_price: 1 }),
  ];
  const stub = (order_id: string, invoices: string[] | null, doc_number: string | null = null) =>
    ({ id: id('d'), order_id, kind: 'payment', doc_number, doc_date: null, vendor_name: null, total: null, file_name: 'stub.pdf', storage_path: 'docs/s.pdf', created_at: '', parsed: invoices ? { invoices } : null }) as OtDocument;
  const docs = [stub(b.id, ['INV-2026-280644']), stub(a.id, null, 'INV-2026-999999')];
  const { needs, groups } = stubsToGet([a, b, c, old], ls, docs);
  check('stubs: invoice # read as R365 writes it', invoiceToken('INV-2026-466262 Delilah Miami') === 'INV-2026-466262' && invoiceToken(' inv-2026-857309/2 ') === 'INV-2026-857309');
  check('stubs: a stub covers the invoices it lists (or names in its doc #)', stubInvoices(docs[0] as never).has('INV-2026-280644') && stubInvoices(docs[1] as never).has('INV-2026-999999'));
  check('stubs: paid invoices with no stub on their order — not the covered one, not an unpaid one, not an archived order',
    needs.map(n => n.invoice).sort().join() === 'INV-2026-418553,INV-2026-466262,INV-2026-875132', needs);
  check('stubs: one row per R365 payment (one ACH paid two orders\' invoices), the unmatched last',
    groups.length === 2 && groups[0].key === 'ACH - 24567' && groups[0].items.map(i => i.orderNumber).sort().join() === 'CUS-0041,OSE-0035' && groups[1].key === '' && groups[1].items[0].invoice === 'INV-2026-875132', groups);
  check('stubs: the invoice amount is its lines (paid, delivered alike)', needs.find(n => n.invoice === 'INV-2026-418553')?.amount === 350);
  const att = attentionItems({ orders: [a, b, c, old], lines: ls, items: [], moves: [], documents: docs }, '2026-11-03', 0, x => '$' + x);
  check('bell: "N paid invoices have no check stub" → Overview', att.some(x => x.title === '3 paid invoices have no check stub' && x.act.kind === 'tab' && (x.act as { tab: string }).tab === 'overview' && /1 R365 payment to reprint/.test(x.sub)), att);
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn) check('pull: each paid line keeps the R365 payment that paid it, lines past Paid too',
    /r365_payments: refs/.test(fn) && /\.in\('status', PAID_ON\)\.is\('r365_payments', null\)/.test(fn));
  const ot = readFileSync(join(process.cwd(), 'src/screens/OrderTracker.tsx'), 'utf8');
  check('Overview lists them by R365 payment with Attach stub (on every order of the payment)', /<StubsToGet /.test(ot) && /orderIds=\{g\.items\.map\(i => i\.orderId\)\}/.test(ot));
}

// ── an invoice PDF for lines that already have it (Delilah Mints Sept order, 11/3) ──
{
  const o = order({ order_number: 'CUS-0013', venue_id: 'x:Multiple venues', deliver_to: 'venue' });
  const mk = (venue_id: string, inv: string, status: OtLine['status']) => line(o, { description: 'Mints — custom', sku: null, qty: 5, unit: 'case', unit_price: 98.72, invoice_number: inv, venue_id, status });
  const la = mk('v1', 'INV-2026-418297', 'DELIVERED'), hq = mk('x:h.wood Corporate', 'INV-2026-702662', 'SHIPPED'), dal = mk('x:Delilah Dallas', 'INV-2026-244133', 'DELIVERED');
  const data = { orders: [o], lines: [la, hq, dal], items: [], documents: [] as OtDocument[] };
  const inv = (doc_number: string, bill_to: string): ReadDoc => ({ doc_kind: 'invoice', is_credit: false, vendor_name: 'EE Mercantile', doc_number, doc_date: '2026-08-31', order_number: '',
    expected_date: '', tracking_numbers: [], subtotal: 493.6, total: 529.39, bill_to, ship_to: '',
    lines: [{ line_kind: 'product', description: 'DELILAH - MINTS 1000/CS', sku: '', qty: 5, unit: 'case', unit_price: 98.72, line_total: 493.6, pack_size: 1000 }, { line_kind: 'tax', description: 'Tax 7.25%', sku: '', qty: 0, unit: '', unit_price: 0, line_total: 35.79, pack_size: 0 }] });
  const src = { id: 'ib-hq', message_id: 'M-mints', conversation_id: 'T-mints', file_name: 'Invoice-INV-2026-702662 (1).pdf', storage_path: 'docs/ib-hq.pdf' };
  const venues = [{ id: 'v1', name: 'Delilah LA' }, { id: 'x:Delilah Dallas', name: 'Delilah Dallas' }, { id: 'x:h.wood Corporate', name: 'h.wood Corporate' }];
  const d = decideMailDocument(inv('INV-2026-702662', 'Delilah LA'), src, data, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: true, venues });
  check('known invoice: the HQ invoice billed to LA goes on the HQ line (its own number), not the LA line', d.state === 'applied'
    && !d.payload.updates.some(u => u.id === la.id) && !d.payload.new_lines.length, d);
  check('known invoice: the PDF goes on the order, only the HQ line is touched (its invoice date filled), no status change',
    d.state === 'applied' && d.payload.order_id === o.id && d.payload.document.doc_number === 'INV-2026-702662'
    && d.payload.updates.every(u => u.id === hq.id && !('status' in u)) && d.payload.updates[0]?.invoice_date === '2026-08-31', d.state === 'applied' ? d.payload.updates : d);
  const full = { ...data, lines: [la, { ...hq, invoice_date: '2026-08-31' }, dal] };
  const again = decideMailDocument(inv('INV-2026-702662', 'Delilah LA'), src, full, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: true, venues });
  check('known invoice: nothing on it changes the order → the PDF is still attached ("Attached to …"), not left waiting',
    again.state === 'applied' && !again.payload.updates.length && /^Attached to CUS-0013/.test(again.reason), again.state === 'applied' ? JSON.stringify(again.payload.updates) : again);
  const dd = decideMailDocument(inv('INV-2026-244133', 'Delilah Dallas'), { ...src, id: 'ib-dal' }, data, '2026-11-03', x => '$' + x.toFixed(2), { autoCreate: true, venues });
  check('known invoice: never moves a delivered line back to Invoiced', dd.state === 'applied' && !dd.payload.updates.some(u => 'status' in u), dd);
}

// ── venue bibles drawn as in Excel (v0.92) ───────────────────────────
{
  check('bible sizes: Excel column widths and row heights in pixels', colWidthPx(8.43) === 64 && colWidthPx(undefined) === 64 && colWidthPx(17) === 124 && rowHeightPx(15) === 20 && rowHeightPx(68.1) === 91 && rowHeightPx(null) === 20);
  check('bible colours: Excel tint darkens / lightens, none = the colour', applyTint('#8E7CC3', 0) === '#8E7CC3' && applyTint('#FFFFFF', -0.5) === '#808080' && applyTint('#000000', 0.5) === '#808080');
  const theme = '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4><a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink><a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme>';
  const pal = themePalette(theme);
  check('bible theme: Excel index order lt1, dk1, lt2, dk2, accents', pal.slice(0, 5).join() === '#FFFFFF,#000000,#E8E8E8,#0E2841,#156082' && pal[9] === '#4EA72E');
  check('bible colours: argb / theme + tint / legacy index / automatic', excelColor({ argb: 'FF38761D' }, pal) === '#38761D' && excelColor({ theme: 4 }, pal) === '#156082'
    && excelColor({ theme: 0, tint: -0.5 }, pal) === '#808080' && excelColor({ indexed: 10 }, pal) === '#FF0000' && excelColor({ indexed: 64 }, pal) === null && excelColor(undefined, pal) === null);
  const st = cellStyle({ fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8E7CC3' } }, font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: { top: { style: 'thin', color: { argb: 'FF000000' } }, bottom: { style: 'medium' } } } as never, pal);
  check('bible cell look: fill, bold white 16px, centred, wrapped, borders', st.background === '#8E7CC3' && st.fontWeight === 700 && st.fontSize === 16 && st.color === '#FFFFFF'
    && st.textAlign === 'center' && st.verticalAlign === 'middle' && st.whiteSpace === 'pre-wrap' && st.borderTop === '1px solid #000000' && st.borderBottom === '2px solid #000', st);
  check('bible text: currency / percent / thousands formats, the #VALUE! of a picture cell blank', displayText(1234.5, '"$"#,##0.00') === '$1,234.50' && displayText(0.25, '0%') === '25%'
    && displayText(1234567, '#,##0') === '1,234,567' && displayText({ error: '#VALUE!' }, undefined) === '' && displayText('Red Wine', undefined) === 'Red Wine');
  check('bible links: only web and mail open', safeLink('https://www.webstaurantstore.com/x') !== null && safeLink('mailto:a@b.co') !== null && safeLink('javascript:alert(1)') === null && safeLink('file:///c:/x') === null && safeLink('Link') === null);
  // Excel's "picture in cell": vm → metadata → rich value → richValueRel → media (from the Alphabet bible's parts)
  const map = richImageMap({
    metadata: '<metadata><futureMetadata name="XLRICHVALUE" count="2"><bk><extLst><ext><xlrd:rvb i="0"/></ext></extLst></bk><bk><extLst><ext><xlrd:rvb i="1"/></ext></extLst></bk></futureMetadata><valueMetadata count="2"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata></metadata>',
    richValues: '<rvData count="2"><rv s="0"><v>1</v><v>5</v></rv><rv s="0"><v>0</v><v>5</v></rv></rvData>',
    structures: '<rvStructures count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>',
    valueRels: '<richValueRels><rel r:id="rId7"/><rel r:id="rId3"/></richValueRels>',
    valueRelsRels: '<Relationships><Relationship Id="rId3" Type="x/image" Target="../media/image21.png"/><Relationship Id="rId7" Type="x/image" Target="../media/image1.png"/></Relationships>',
  });
  check('bible in-cell pictures: each vm to its media file', JSON.stringify(map) === JSON.stringify(['xl/media/image21.png', 'xl/media/image1.png']), map);
  check('bible in-cell pictures: no rich data = none', richImageMap({ metadata: null, richValues: null, structures: null, valueRels: null, valueRelsRels: null }).length === 0);
  check('bible: picture cells by address, sheet names to their files', sheetVmCells('<c r="A3" s="51" t="e" vm="1"><v>#VALUE!</v></c><c r="B3" s="2"><v>1</v></c><c r="A4" t="e" vm="2">').get('A4') === 2
    && sheetVmCells('<c r="B3" s="2">').size === 0
    && sheetFiles('<sheets><sheet name="Glassware" sheetId="1" r:id="rId1"/><sheet name="Bird Street&apos;s" sheetId="2" r:id="rId2"/></sheets>',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet9.xml"/></Relationships>').get("Bird Street's") === 'xl/worksheets/sheet9.xml');

  // a whole workbook: merges, a link, a frozen header, a floating picture in its cell
  const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Glassware', { views: [{ state: 'frozen', ySplit: 2, xSplit: 0 }] });
  ws.columns = [{ width: 17 }, { width: 28 }, { width: 12 }];
  ws.addRow(['Glass', '', 'Alphabet']); ws.mergeCells('A1:B1');
  ws.addRow(['Image', 'Item', 'Link']);
  ws.addRow(['', 'Red Wine', { text: 'Webstaurant', hyperlink: 'https://www.webstaurantstore.com/x' }]);
  ws.getRow(3).height = 68.1;
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8E7CC3' } };
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0));
  const imageId = wb.addImage({ buffer: png.buffer as never, extension: 'png' });
  ws.addImage(imageId, { tl: { col: 0.25, row: 2.1 }, ext: { width: 52, height: 67 } });
  const book = await loadBible(await wb.xlsx.writeBuffer() as ArrayBuffer);
  const sh = book.sheets[0];
  check('bible workbook: columns / row heights as Excel, merged title spans two columns, the link, frozen header',
    sh.colWidths.join() === '124,201,89' && sh.rows[2].height === 91 && sh.rows[0].cells[0].colSpan === 2 && sh.rows[0].cells[1].covered
    && sh.rows[0].cells[0].style.background === '#8E7CC3' && sh.rows[2].cells[2].link === 'https://www.webstaurantstore.com/x' && sh.rows[2].cells[2].text === 'Webstaurant' && sh.frozenRows === 2, sh);
  check('bible workbook: a floating picture rides in its anchor cell (A3) with its size', sh.floats.length === 1 && sh.floats[0].row === 2 && sh.floats[0].col === 0
    && sh.floats[0].width === 52 && sh.floats[0].height === 67 && book.media.has(sh.floats[0].media), sh.floats);
  const csv = bibleFromCsv([['Item', 'Link'], ['Coupe', 'https://x.co/c']], 'TNG bible (all items)');
  check('bible from CSV: one sheet, header row bold, links', csv.sheets.length === 1 && csv.sheets[0].rows[0].cells[0].style.fontWeight === 700 && csv.sheets[0].rows[1].cells[1].link === 'https://x.co/c' && csv.sheets[0].frozenRows === 1);
  const ot = readFileSync(join(process.cwd(), 'src/screens/OrderTracker.tsx'), 'utf8'), bv = readFileSync(join(process.cwd(), 'src/components/orderTracker/BibleView.tsx'), 'utf8');
  check('Bibles tab: venue picker, sheet tabs, never HTML from a workbook', ot.includes("tab('bibles', 'Bibles', null)") && /<BibleGrid sheet=/.test(bv) && !/dangerouslySetInnerHTML/.test(bv));
}

// ── Ask AI over the order tracker and the bibles (v0.93) ─────────────
{
  const qt = questionTerms('Where is the Delilah Mints order CUS-0013? Is INV-2026-244133 paid, and tracking 1Z999AA10123456784?');
  check('ask: the question\'s codes and words', qt.codes.join() === 'CUS-0013,INV-2026-244133,1Z999AA10123456784' && qt.words.includes('delilah') && qt.words.includes('mints') && !qt.words.includes('where') && !qt.words.includes('order'), qt);
  const V = [{ id: 'v1', name: 'Delilah LA' }, { id: 'v12', name: 'Alphabet' }, { id: 'x:Delilah Dallas', name: 'Delilah Dallas' }];
  const mints = order({ order_number: 'CUS-0013', vendor_name: 'EE Mercantile', venue_id: 'x:Multiple venues', deliver_to: 'venue', expected_on: null, notes: 'Delilah Mints September order' });
  const ml = [
    line(mints, { description: 'Mints — custom', qty: 5, unit_price: 98.72, status: 'DELIVERED', invoice_number: 'INV-2026-418297', venue_id: 'v1', r365_payments: [{ number: 'ACH - 23239', date: '2026-08-27', amount: 3340.58 }] }),
    line(mints, { description: 'Mints — custom', qty: 5, unit_price: 98.72, status: 'SHIPPED', invoice_number: 'INV-2026-244133', venue_id: 'x:Delilah Dallas', expected_on: '2026-09-28' }),
  ];
  const glass = order({ order_number: 'OSE-0035', vendor_name: 'EE Mercantile', venue_id: 'x:Delilah Dallas', deliver_to: 'venue' });
  const gl = [line(glass, { description: 'STEELITE - CHAFER MILLENIUM', qty: 3, unit_price: 1308.22, status: 'INVOICED', invoice_number: 'INV-2026-418553', invoice_date: '2026-09-14' })];
  const data = { orders: [mints, glass], lines: [...ml, ...gl], items: [], moves: [], documents: [{ id: 'd1', order_id: mints.id, kind: 'invoice', doc_number: 'INV-2026-244133', doc_date: null, vendor_name: null, total: null, file_name: 'Invoice-INV-2026-244133.pdf', storage_path: 'p', created_at: '' } as OtDocument], tracking: [] };
  const bibles = [{ venue_id: 'v12', title: 'Alphabet Bible', text_index: { sheets: [{ name: 'Glassware', header: ['Item', 'Manufacturer', 'QTY', 'Status', 'Tracking'], rows: [['Red Wine', 'Zweisel Fortessa', '36', 'Shipped', '875267211237'], ['Coupe', 'Nude', '24', 'Ordered', '']] }] } },
                  { venue_id: 'v1', title: 'Delilah LA Bible 2026', text_index: { sheets: [{ name: 'Glassware', header: ['Item', 'Manufacturer'], rows: [['Red Wine', 'Riedel']] }] } }];
  const ctx = (question: string, budget?: number) => buildOrdersContext({ question, data, bibles, venues: V, today: '2026-11-03', inboxWaiting: 5, budget });
  const a = ctx('Where is the Delilah Mints order?');
  check('ask: the overview always, with what "late" means', /^PURCHASING/.test(a) && /A line is LATE when its ETA/.test(a) && /5 documents waiting in the Inbox/.test(a));
  check('ask: the order it names, in full — per-venue lines, status, invoice, R365 payment, documents',
    /ORDERS MATCHING THE QUESTION \(1\)/.test(a) && /ORDER CUS-0013/.test(a) && /\[Delilah Dallas\] Mints — custom .* SHIPPED \(LATE\) \| INV-2026-244133/.test(a)
    && /paid in R365 ACH - 23239 on 2026-08-27/.test(a) && /documents: invoice INV-2026-244133/.test(a), a);
  check('ask: an invoice # finds its order', /ORDER OSE-0035/.test(ctx('is INV-2026-418553 paid?')) && !/ORDER CUS-0013/.test(ctx('is INV-2026-418553 paid?')));
  const late = ctx('what is late?');
  check('ask: "late" → the late lines, oldest first', /LATE LINES \(2, oldest first\):\n- CUS-0013 EE Mercantile \| Mints — custom \| SHIPPED \| ETA 2026-09-28\n- OSE-0035 EE Mercantile \| STEELITE - CHAFER MILLENIUM \| INVOICED \| ETA 2026-10-15/.test(late), late);
  check('ask: a word is found from its start ("red" is not in "ordered"; "glass" is in "glassware")', !/Coupe/.test(ctx('red wine in the Alphabet bible')) && /Red Wine/.test(ctx('glass at Alphabet')));
  check('ask: "unpaid" → invoiced-not-paid orders with days', /INVOICED, NOT PAID \(1 orders/.test(ctx('which invoices are unpaid?')) && /OSE-0035 EE Mercantile \| \$3,924.66 \| INV-2026-418553 \| 50 days/.test(ctx('which invoices are unpaid?')));
  const bib = ctx('what red wine glasses are in the Alphabet bible and their status?');
  check('ask: bible rows that match, only the venue it names, with their column names',
    /BIBLE ROWS MATCHING THE QUESTION \(1\)/.test(bib) && /\[Alphabet Bible · Glassware\] Item: Red Wine \| Manufacturer: Zweisel Fortessa \| QTY: 36 \| Status: Shipped \| Tracking: 875267211237/.test(bib) && !/Riedel/.test(bib), bib);
  check('ask: every order on one line in the room left', /ALL ORDERS \(2;/.test(a) && /- OSE-0035 · EE Mercantile · Delilah Dallas · In production · Invoiced, not paid · \$3,924.66/.test(a));
  check('ask: a product link is shortened to its site so the row\'s status / tracking fit', shortUrl('https://www.webstaurantstore.com/schott-zwiesel-cinco-17-9-oz/549111123777.html') === 'webstaurantstore.com link');
  const small = ctx('what is late?', 900);
  check('ask: never over the budget (sections drop, lines are never cut)', small.length <= 900 && /^PURCHASING/.test(small) && !/\n$/.test(small), small.length);
  check('ask: bibles with no text copy yet say so', /none has a searchable text copy yet/.test(buildOrdersContext({ question: 'bible', data, bibles: [{ venue_id: 'v1', title: 'x', text_index: null }], venues: V, today: '2026-11-03', inboxWaiting: 0 })));
  const ai = readFileSync(join(process.cwd(), 'src/screens/AskAI.tsx'), 'utf8');
  check('Ask AI: orders & bibles only for admin / corporate, built from the last questions', /const canOrders = isOrgWide\(user\.role\)/.test(ai) && /const recent = history\.filter\(m => m\.role === 'user'\)\.slice\(-3\)/.test(ai) && /buildOrdersContext\(\{ question: recent/.test(ai));
  check('Ask AI fits ask-ai\'s 8,000 characters: variance only when asked about, orders get the rest',
    /const variance = useVenueData && context && \(!withOrders \|\| asksVariance\(recent\)\)/.test(ai) && /budget: ordersBudget\(head\.length \+ 2\)/.test(ai)
    && asksVariance('what are our biggest shortages?') && !asksVariance('where is the mints order?') && ordersBudget(1200) === 6760 && ordersBudget(9000) === 0);
  const fitted = ctx('Where is the Delilah Mints order?', ordersBudget(1500));
  check('Ask AI: the orders text for a question stays inside its room', fitted.length <= ordersBudget(1500) && /ORDER CUS-0013/.test(fitted));
  const bt = bibleTextIndex({ media: new Map(), sheets: [{ name: 'Glassware', colWidths: [64, 64, 64, 64], floats: [], frozenRows: 0, frozenCols: 0, truncated: false, rows: [
    { height: 20, cells: ['Glass', '', 'Alphabet', ''].map(t => ({ text: t, style: {}, link: null, image: null, rowSpan: 1, colSpan: 1, covered: false })) },
    { height: 20, cells: ['Image', 'Item', 'Link', ''].map(t => ({ text: t, style: {}, link: null, image: null, rowSpan: 1, colSpan: 1, covered: false })) },
    { height: 20, cells: [{ text: '', image: 'xl/media/image1.png' }, { text: 'Red Wine' }, { text: 'Webstaurant', link: 'https://w.co' }, { text: '' }].map(c => ({ style: {}, link: null, image: null, rowSpan: 1, colSpan: 1, covered: false, ...c })) },
  ] }] });
  check('bible text copy: header row found, title row left out, empty columns dropped', JSON.stringify(bt.sheets[0]) === JSON.stringify({ name: 'Glassware', header: ['Image', 'Item', 'Link'], rows: [['', 'Red Wine', 'Webstaurant']] }), bt.sheets[0]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
