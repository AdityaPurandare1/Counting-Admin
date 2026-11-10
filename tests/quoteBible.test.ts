/**
 * v1.07 quotes checked against the venue bibles. The user: "can we have this such as the quotes are check
 * against the bibles to ensure same items exist". Shaped on the real 11/10 quotes and bible rows: Delilah
 * Dallas (OSE-0037, OSE-0023), Keys (OSE-0004, OSE-0020), Delilah Miami (OSE-0017), Lady Delilah (no bible).
 * npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cellNumbers, checkQuoteAgainstBible, indexBibles, lineBibleText, lineNumbers, quoteBibleChecks, quoteBibleSummary, type BibleText,
} from '../src/lib/quoteBible';
import { attentionItems } from '../src/lib/orderTrackerView';
import { MULTIPLE_VENUES, type OtLine, type OtOrder } from '../src/lib/orderTracker';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}

let n = 0;
const id = (p: string) => `${p}${++n}`;
const order = (over: Partial<OtOrder> = {}): OtOrder => ({
  id: id('o'), order_number: 'OSE-0037', vendor_name: 'EE Mercantile', venue_id: 'x:Delilah Dallas', deliver_to: 'venue', ordered_on: '2026-10-20',
  expected_on: null, notes: null, completed_at: null, archived_at: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...over,
});
const line = (o: OtOrder, description: string, sku: string | null, over: Partial<OtLine> = {}): OtLine => ({
  id: id('l'), order_id: o.id, item_id: null, description, sku, qty: 1, unit: 'case', unit_price: 10, status: 'QUOTED', status_at: '2026-10-20T10:00:00Z',
  quote_number: 'Q-2026-1', invoice_number: null, invoice_date: null, tracking_number: null, expected_on: null, sort: 0, ...over,
});

// ── the real bible rows (11/10), as their text copies hold them ─────────────
const H = ['Image', 'Item', 'Manufacturer', 'Description/Color/Pattern', 'Manufacturer Item #', 'Size', 'Link', 'Notes'];
const r = (item: string, maker: string, number: string, desc = '') => ['', item, maker, desc, number, '', '', ''];
const dallas: BibleText = { id: 'b1', venue_id: 'x:Delilah Dallas', title: 'Delilah Dallas Bible 2026', text_index: { sheets: [
  { name: 'Glassware', header: H, rows: [
    r('Cocktail Glass', 'Viski', '6424', 'clear, crystal glass'), r('Collins Glass', 'NUDE', '64152-024', 'clear, crystal glass'),
    r('Goblet Glass', 'Libbey', 'SPSHLIB156', 'Neo, Clear')] },
  { name: 'Smallware', header: H, rows: [
    r('Dinner Fork', "Steelite INT'L USA", 'SPLM40Z021', 'Monza, 18/10 Stainless Steel'), r('Salad Fork', "Steelite INT'L USA", 'SPLM40Z023', 'Monza'),
    r('large Bussing Tray', 'Service Ideas', 'SPCSTR1614', 'Tray, round, stackable'), r('Bottle Service Tray', 'SDS', '', 'Custom'), r('Cocktail Tray Small', 'Service Ideas', 'MPN: TR119SR', 'Non-Slip Tray'),
    r('Silver Condiment Tray', 'Wine-n-gear', 'WNG-3110')] },
] } };
const keys: BibleText = { id: 'b2', venue_id: 'v6', title: 'Keys Bible', text_index: { sheets: [
  { name: 'Glassware', header: ['Image', 'Item', 'Manufacturer', 'Description/Color/Pattern', 'Manufacturer Item #', 'Size', 'Vendor', 'Vendor Item #', 'Price'],
    rows: [['', 'Rocks glass', 'Hospitality Brands', 'Tryst 12.75 oz. Double Old Fashioned', 'HUF204-012', '12.75 oz', 'EE', '', '']] },
] } };
const miami: BibleText = { id: 'b3', venue_id: 'v2', title: 'Delilah Miami OS&E Bible', text_index: { sheets: [
  { name: 'Glassware', header: H, rows: [r('Bowl', 'Marquis By Waterford', 'B00SG8DQP4', 'Markham Bowl, Glass, 9 inch, Clear')] },
] } };
const bibles = [dallas, keys, miami];

// ── item numbers ───────────────────────────────────────────────────────────
check('bible cells: "MPN: TR119SR" -> TR119SR, "64152-024" as one, E&E SP prefix both ways', cellNumbers('MPN: TR119SR').includes('TR119SR')
  && cellNumbers('64152-024').includes('64152024') && cellNumbers('SPLM40Z021').includes('SPLM40Z021') && cellNumbers('SPLM40Z021').includes('LM40Z021'));
check('bible cells: sizes, years and short bits are not numbers', cellNumbers('750ml').length === 0 && cellNumbers('2026').length === 0
  && cellNumbers('16 oz').length === 0 && cellNumbers('#40').length === 0 && cellNumbers('12x18').length === 0);
check('line: the SKU, a "Model No." and a code in the text', lineNumbers({ sku: '6424', description: 'NICK & NORA - Custom Model No. 6424 Packed cs' }).join() === '6424'
  && lineNumbers({ sku: null, description: 'Hospitality Brands Tryst 12.75 oz DOF (HUF204-012)' }).includes('HUF204012')
  && lineNumbers({ sku: null, description: 'GLASS GOBLET - Libbey Model No. 9156 Packed 1 cs' }).includes('9156'));
check('line: a bare 4-digit number in free text is not an item number (only a SKU or Model No. is)',
  lineNumbers({ sku: null, description: 'Cocktail glass 6424 clear' }).length === 0, lineNumbers({ sku: null, description: 'Cocktail glass 6424 clear' }));
check('line: two SKUs "SMAPR-10KD / SMAES-10" are both read', lineNumbers({ sku: 'SMAPR-10KD / SMAES-10', description: 'Sheet Pan Rack' }).join() === 'SMAPR10KD,SMAES10');
const ix = indexBibles([dallas]);
check('index: item-number columns only, item and maker kept per row', ix.byNumber.get('6424')?.item === 'Cocktail Glass' && ix.byNumber.get('6424')?.maker === 'Viski'
  && ix.byNumber.get('6424')?.sheet === 'Glassware' && !ix.byNumber.has('1810') && ix.rows.some(x => x.item === 'Bottle Service Tray' && x.number === ''));

// ── OSE-0037 (Delilah Dallas): one exact, three close, one not there ─────────
const o37 = order();
const l37 = [
  line(o37, 'NICK & NORA - Custom Model No. 6424 Packed cs VISKI - NICK & NORA GLASS 6OZ/ 4', '6424'),
  line(o37, 'DESSERT FORK - Steelite International Model No. 5340Z023 Packed dozen', '5340Z023'),
  line(o37, 'GLASS GOBLET - Libbey Model No. 9156 Packed 1 cs Reserve by', '9156'),
  line(o37, 'HI BALL GLASS - Steelite International Model No. P64152 Packed cs', 'P64152'),
  line(o37, 'DINNER FORK - Steelite International Model No. 5340Z021 Packed dozen', '5340Z021'),
];
const c37 = checkQuoteAgainstBible(o37, l37, bibles)!;
const st = (i: number) => c37.lines[i].state;
check('OSE-0037: Viski 6424 is in the bible (Cocktail Glass, Glassware)', st(0) === 'in' && c37.lines[0].row?.item === 'Cocktail Glass', c37.lines[0]);
check('OSE-0037: Steelite P64152 is only close to NUDE 64152-024 -> not green', st(3) === 'near' && c37.lines[3].row?.number === '64152-024', c37.lines[3]);
check('OSE-0037: 5340Z021 is only close to SPLM40Z021 (Dinner Fork)', st(4) === 'near' && c37.lines[4].row?.item === 'Dinner Fork', c37.lines[4]);
check('OSE-0037: the DESSERT fork 5340Z023 is closest to the bible\'s SALAD fork -> flagged, the panel names it',
  st(1) === 'near' && c37.lines[1].row?.item === 'Salad Fork' && /Salad Fork/.test(lineBibleText(c37.lines[1])), lineBibleText(c37.lines[1]));
check('OSE-0037: Libbey 9156 is not in the bible; closest by name is the Libbey Goblet Glass',
  st(2) === 'missing' && c37.lines[2].row?.item === 'Goblet Glass' && /not in the bible.*Goblet Glass/.test(lineBibleText(c37.lines[2])), lineBibleText(c37.lines[2]));
check('OSE-0037: not green, 4 of 5 to check', !c37.ok && c37.off.length === 4 && c37.bibles.join() === 'Delilah Dallas Bible 2026');
const s37 = quoteBibleSummary(c37);
check('OSE-0037 summary: says how many, against which bible, and why each', !s37.ok && s37.title === 'Check it against the bible'
  && s37.sub === '4 of 5 quoted items not found in the Delilah Dallas Bible 2026 by item number: DESSERT FORK 5340Z023 (number differs); GLASS GOBLET 9156 (not in it); HI BALL GLASS P64152 (number differs); +1 more.', s37.sub);

// ── OSE-0023: a custom tray with no item number ───────────────────────────
const o23 = order({ order_number: 'OSE-0023' });
const c23 = checkQuoteAgainstBible(o23, [line(o23, 'SERVICE TRAY - Custom - This is usually ordered by Hwood directly', null)], bibles)!;
check('OSE-0023: no item number -> left to a person, pointed at the Bottle Service Tray (item words beat the maker "Service Ideas")',
  !c23.ok && c23.lines[0].state === 'no-number' && c23.lines[0].row?.item === 'Bottle Service Tray' && /no item # to check.*Bottle Service Tray/.test(lineBibleText(c23.lines[0])), c23.lines[0]);

// ── Keys and Miami: every line in -> green ───────────────────────────────
const o20 = order({ order_number: 'OSE-0020', venue_id: 'v6' });
const c20 = checkQuoteAgainstBible(o20, [line(o20, 'PLASTIC BEVERAGEWARE Hospitality Brands Model No. HUF204-012', 'HUF204-012')], bibles)!;
const o04 = order({ order_number: 'OSE-0004', venue_id: 'v6' });
const c04 = checkQuoteAgainstBible(o04, [line(o04, 'Hospitality Brands Tryst 12.75 oz DOF (HUF204-012)', null)], bibles)!;
const o17 = order({ order_number: 'OSE-0017', venue_id: 'v2' });
const c17 = checkQuoteAgainstBible(o17, [line(o17, 'BOWL Custom Model No. B00SG8DQP4 Marquis Markham Bowl, 9in', 'B00SG8DQP4')], bibles)!;
check('OSE-0020 / OSE-0004 (Keys) and OSE-0017 (Miami) are green: the number is in the bible', c20.ok && c04.ok && c17.ok
  && c04.lines[0].row?.item === 'Rocks glass' && c17.lines[0].row?.item === 'Bowl');
check('green summary', quoteBibleSummary(c20).ok && quoteBibleSummary(c20).sub === 'The quoted item is in the Keys Bible by item number.'
  && quoteBibleSummary(checkQuoteAgainstBible(o20, [c20.lines[0].line, line(o20, 'Rocks glass', 'HUF204-012')], bibles)!).sub === 'All 2 quoted items are in the Keys Bible by item number.'
  && quoteBibleSummary(c37).ok === false, quoteBibleSummary(c20));

// ── no bible, unread bible, several venues, E&E numbers ───────────────────
const oLD = order({ order_number: 'CUS-0042', venue_id: 'v14' });
const cLD = checkQuoteAgainstBible(oLD, [line(oLD, 'Lady Delilah Mints (1000/CS) buttermint 1color logo print', null)], bibles)!;
const sLD = quoteBibleSummary(cLD, v => (v === 'v14' ? 'Lady Delilah' : String(v)));
check('CUS-0042 (Lady Delilah): no bible -> said so, never green', !cLD.ok && cLD.lines[0].state === 'no-bible' && cLD.noBible.join() === 'v14'
  && sLD.title === 'No bible to check it against' && /^Lady Delilah has no bible\. Upload it under Bibles/.test(sLD.sub), sLD);
const unread: BibleText = { id: 'b9', venue_id: 'v9', title: 'Harriet\'s Bible', text_index: null };
const o9 = order({ venue_id: 'v9' });
check('a bible never opened (no text copy) -> "open it once"', checkQuoteAgainstBible(o9, [line(o9, 'Coupe', 'ABC123')], [unread])!.lines[0].state === 'unread'
  && /open it once under Bibles/.test(lineBibleText(checkQuoteAgainstBible(o9, [line(o9, 'Coupe', 'ABC123')], [unread])!.lines[0])));
const oM = order({ venue_id: MULTIPLE_VENUES });
const cM = checkQuoteAgainstBible(oM, [line(oM, 'Rocks glass', 'HUF204-012', { venue_id: 'v6' }), line(oM, 'Bowl', 'B00SG8DQP4', { venue_id: 'v2' })], bibles)!;
check('an order for several venues: each line against its own venue\'s bible', cM.ok && cM.lines.map(c => c.bibles[0]).join() === 'Keys Bible,Delilah Miami OS&E Bible');
const cMx = checkQuoteAgainstBible(oM, [line(oM, 'Rocks glass', 'HUF204-012')], bibles)!;
check('several venues and the line has none -> no bible (not checked against a guess)', cMx.lines[0].state === 'no-bible' && cMx.noBible[0] === null);
const oE = order();
const cE = checkQuoteAgainstBible(oE, [line(oE, 'Dinner fork', 'SPLM40Z021'), line(oE, 'Dinner fork', 'LM40Z021'), line(oE, 'Small tray', 'TR119SR')], bibles)!;
check('E&E numbers: SPLM40Z021 and LM40Z021 both find the Dinner Fork; TR119SR finds "MPN: TR119SR"', cE.ok, cE.lines.map(c => c.state));

// ── which orders are checked ──────────────────────────────────────────────
const oDone = order({ completed_at: '2026-11-01T00:00:00Z' });
const oArch = order({ archived_at: '2026-11-01T00:00:00Z' });
const oOrd = order();
check('only open orders with Quoted lines', checkQuoteAgainstBible(oDone, [line(oDone, 'x', '6424')], bibles) === null
  && checkQuoteAgainstBible(oArch, [line(oArch, 'x', '6424')], bibles) === null
  && checkQuoteAgainstBible(oOrd, [line(oOrd, 'x', '6424', { status: 'ORDERED' })], bibles) === null);
const all = [o37, o23, o20, oLD];
const allLines = [...l37, ...c23.lines.map(c => c.line), ...c20.lines.map(c => c.line), ...cLD.lines.map(c => c.line)];
const map = quoteBibleChecks(all, allLines, bibles);
check('quoteBibleChecks: one per quoted order', map.size === 4 && map.get(o20.id)?.ok === true && map.get(o37.id)?.ok === false);
check('bibles not loaded -> nothing checked, nothing flagged', quoteBibleChecks(all, allLines, undefined).size === 0);

// ── the bell ──────────────────────────────────────────────────────────────
const att = attentionItems({ orders: all, lines: allLines, items: [], moves: [], documents: [], bibles }, '2026-11-10', 0, x => `$${x}`,
  v => (v === 'v14' ? 'Lady Delilah' : String(v)));
const bibleAtt = att.filter(a => /bible/i.test(a.title));
check('bell: OSE-0037 and OSE-0023 to check against the bible (warn), opening the order',
  bibleAtt.filter(a => a.sev === 'warn').map(a => a.title).join('|') === 'Check the quote against the bible: EE Mercantile OSE-0037|Check the quote against the bible: EE Mercantile OSE-0023'
  && bibleAtt.every(a => a.sev !== 'warn' || a.act.kind === 'order'), bibleAtt);
check('bell: Lady Delilah has no bible -> one info line that opens Bibles; the green quote says nothing',
  bibleAtt.some(a => a.sev === 'info' && a.title === 'No Lady Delilah bible to check 1 quote against' && a.act.kind === 'tab' && a.act.tab === 'bibles')
  && !bibleAtt.some(a => /OSE-0020/.test(a.title + a.sub)), bibleAtt);
check('bell: no bibles loaded -> no bible lines', !attentionItems({ orders: all, lines: allLines, items: [], moves: [], documents: [] }, '2026-11-10', 0, x => `$${x}`).some(a => /bible/i.test(a.title)));

// ── wiring ────────────────────────────────────────────────────────────────
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const data = src('src/lib/orderTrackerData.ts');
check('the tracker loads the current bibles\' text (not the files), and leaves them out if that fails',
  /from\('kount_ot_bibles'\)\.select\('id, venue_id, title, text_index'\)\.eq\('is_current', true\)\)/.test(data) && /error \? undefined/.test(data) && /\(\) => undefined\)/.test(data));
const drawer = src('src/components/orderTracker/OrderDrawer.tsx');
check('order panel: the green / amber bible line and each quoted line\'s place in the bible',
  /checkQuoteAgainstBible\(order, lines, data\.bibles\)/.test(drawer) && /ot-note \$\{bibleSum\.ok \? 'ok' : 'warn'\}/.test(drawer) && /lineBibleText\(bibleLine\.get\(was\.id\)!\)/.test(drawer));
const rows = src('src/components/orderTracker/OrdersView.tsx');
check('order rows: In bible / Check bible (no pill for a venue with no bible)', />In bible</.test(rows) && />Check bible</.test(rows) && /bible\.off\.some\(x => x\.state !== 'no-bible'\)/.test(rows));
check('the bell gets venue names', /attentionItems\(data, today, waiting, fmtMoney0, venueName\)/.test(src('src/screens/OrderTracker.tsx')));
check('the green note has its colour', /\.ot-note\.ok \{ background: var\(--ot-ok-bg\); color: var\(--ot-ok\); \}/.test(src('src/components/orderTracker/tracker.css')));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
