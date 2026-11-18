/**
 * v1.28 "Follow up" (0178). The user, 11/18: "for any order without a new email in the thread for over 3 days, needs a
 * status marker saying followup required or something ... it should also have a filter for those".  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OtLine, OtOrder } from '../src/lib/orderTracker';
import { QUIET_DAYS, quietOrder, quietOrders, quietText } from '../src/lib/orderTrackerView';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

type Q = OtOrder & { last_email_at?: string | null; last_email_from?: string | null; last_vendor_email_at?: string | null };
const order = (x: Partial<Q> = {}): Q => ({
  id: 'o1', order_number: 'OSE-0023', vendor_name: 'EE Mercantile', venue_id: 'x:Delilah Dallas', deliver_to: 'venue', ordered_on: '2026-10-28', expected_on: null,
  notes: null, completed_at: null, archived_at: null, created_at: '2026-11-03T01:00:00Z', updated_at: '2026-11-18T20:00:00Z', sent_on: '2026-10-28', ...x,
});
const line = (status: OtLine['status'], x: Partial<OtLine> = {}): OtLine => ({
  id: `l-${status}-${Math.random()}`, order_id: 'o1', item_id: null, description: 'VISKI - NICK & NORA GLASS 6OZ/ 4', sku: null, qty: 30, unit: null, unit_price: 10,
  status, status_at: '2026-11-17T23:00:00Z', status_source: 'manual', status_note: null, quote_number: null, invoice_number: 'INV-2026-348798', invoice_date: null,
  tracking_number: null, expected_on: null, sort: 0, ...x,
} as OtLine);
const TODAY = '2026-11-18';

check('the threshold is the user\'s: more than 3 days', QUIET_DAYS === 3);

// ── the rule ───────────────────────────────────────────────────────
check('last e-mail 11/14 (4 days ago) -> follow up, 4 days, with who wrote it',
  same(quietOrder(order({ last_email_at: '2026-11-14T18:00:00Z', last_email_from: 'jemma@eemercantile.co' }), [line('SHIPPED')], TODAY),
    { days: 4, since: '2026-11-14', from: 'jemma@eemercantile.co', known: true }));
check('exactly 3 days (11/15) is not over 3 days -> no flag', quietOrder(order({ last_email_at: '2026-11-15T18:00:00Z' }), [line('SHIPPED')], TODAY) === null);
check('the day is Los Angeles\'s: 11/15 01:00 UTC is still 11/14 there -> 4 days',
  quietOrder(order({ last_email_at: '2026-11-15T01:00:00Z' }), [line('PAID')], TODAY)?.days === 4);
check('the latest of the thread, the vendor\'s e-mail (0153) and a logged follow-up counts',
  quietOrder(order({ last_email_at: '2026-11-01T18:00:00Z', last_vendor_email_at: '2026-11-16T18:00:00Z' }), [line('PAID')], TODAY) === null
  && quietOrder(order({ last_email_at: '2026-11-01T18:00:00Z' }), [line('PAID')], TODAY,
    [{ order_id: 'o1', kind: 'vendor', created_at: '2026-11-17T17:00:00Z' }]) === null);
check('a payment request (kind payment) or another order\'s follow-up does not count as this thread\'s e-mail',
  quietOrder(order({ last_email_at: '2026-11-01T18:00:00Z' }), [line('PAID')], TODAY,
    [{ order_id: 'o1', kind: 'payment', created_at: '2026-11-17T17:00:00Z' }, { order_id: 'o2', kind: 'vendor', created_at: '2026-11-17T17:00:00Z' }])?.days === 17);
check('no e-mail on file: counted from the day it went to the vendor, marked unknown',
  same(quietOrder(order(), [line('ORDERED')], TODAY), { days: 21, since: '2026-10-28', from: null, known: false }));
check('no sent day: the order day, then the day it was added',
  quietOrder(order({ sent_on: null }), [line('ORDERED')], TODAY)?.since === '2026-10-28'
  && quietOrder(order({ sent_on: null, ordered_on: null }), [line('ORDERED')], TODAY)?.since === '2026-11-02');

// ── which orders ───────────────────────────────────────────────────
const old = { last_email_at: '2026-11-01T18:00:00Z' };
check('every line delivered, received or cancelled -> nothing to chase',
  quietOrder(order(old), [line('DELIVERED'), line('RECEIVED'), line('CANCELLED')], TODAY) === null);
check('one line still out (requested, quoted, invoiced, paid, shipped) -> flagged',
  (['REQUESTED', 'QUOTED', 'ORDERED', 'INVOICED', 'PAID', 'SHIPPED'] as const).every(s => quietOrder(order(old), [line('DELIVERED'), line(s)], TODAY) !== null));
check('completed, archived or no lines -> no flag',
  quietOrder(order({ ...old, completed_at: '2026-11-10T00:00:00Z' }), [line('PAID')], TODAY) === null
  && quietOrder(order({ ...old, archived_at: '2026-11-10T00:00:00Z' }), [line('PAID')], TODAY) === null
  && quietOrder(order(old), [], TODAY) === null);
check('another order\'s lines are not this order\'s', quietOrder(order(old), [line('PAID', { order_id: 'o2' })], TODAY) === null);
check('quietOrders: per order id, only the quiet ones', same([...quietOrders([order(old), order({ id: 'o2', last_email_at: '2026-11-17T18:00:00Z' })],
  [line('PAID'), line('PAID', { order_id: 'o2' })], TODAY).keys()], ['o1']));

// ── the words ──────────────────────────────────────────────────────
check('hover text with the day and the sender', quietText({ days: 6, since: '2026-11-12', from: 'jemma@eemercantile.co', known: true })
  === "No e-mail in this order's threads since 11/12 (jemma@eemercantile.co) - 6 days");
check('hover text with no e-mail on file', quietText({ days: 21, since: '2026-10-28', from: null, known: false }) === 'No e-mail on file for this order; ordered 10/28 - 21 days');

// ── the screens ────────────────────────────────────────────────────
const view = src('src/components/orderTracker/OrdersView.tsx');
check('Orders: a "Follow up" marker per row and a filter button / chip', view.includes('Follow up · {quiet.get(o.id)!.days}d')
  && view.includes('if (quietOnly && !quiet.has(r.o.id)) return false;') && view.includes('Follow up: no e-mail in over 3 days') && view.includes('setQuietOnly(false); setState(\'all\')'));
check('the order drawer says it too', src('src/components/orderTracker/OrderDrawer.tsx').includes('<b>Follow up.</b> {quietText(quiet)}'));
const mig = sibling('supabase', 'migrations', '0178_kount_ot_thread_quiet.sql');
check('0178 adds last_email_at / last_email_from / thread_checked_at, and their stamps keep updated_at',
  mig === null || (mig.includes('add column if not exists last_email_at timestamptz') && mig.includes('add column if not exists thread_checked_at timestamptz')
    && mig.includes('new.updated_at := old.updated_at;')));
const pull = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
check('the hourly check reads the threads (threadPhase after the stubs)', pull === null || /await stubPhase\(sb, tok\.access_token, 0, stats, STUB_CHECK_DAYS\);\s*\/\/ 0178[^\n]*\n\s*await threadPhase\(sb, stats, tok\.access_token\);/.test(pull));

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
