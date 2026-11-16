/**
 * v1.20 invoices sent to accounting (0174). The user, 11/16: "1 more distinction for the invoices we receive. I want
 * it to scan if those invoices are being sent to accounting. hwoodap@iqbackoffice.com and hwoodga@iqbackoffice.com".
 * Examples are the real subjects / attachment names in the mailbox (Sep-Nov 2026).  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNTING_MAILBOXES, accountingBoxes, accountingLabel, invoicesNamedIn, type OtLine, type OtOrder } from '../src/lib/orderTracker';
import { accountingOf, accountingText, notSentToAccounting } from '../src/lib/orderTrackerView';
import { followupsDue, paymentRequestsDue } from '../src/lib/orderFollowups';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

// ── the two mailboxes ───────────────────────────────────────────────
check('the two accounting mailboxes, AP then GA', same(ACCOUNTING_MAILBOXES.map(b => `${b.label}=${b.address}`), ['AP=hwoodap@iqbackoffice.com', 'GA=hwoodga@iqbackoffice.com']));
check('which of them an e-mail went to (case and spaces ignored, others ignored)',
  same(accountingBoxes([' Hwoodga@IQBackOffice.com', 'jacob@hwoodgroup.com', 'HWOODAP@iqbackoffice.com']), ['AP', 'GA'])
  && same(accountingBoxes(['svaldez@iqbackoffice.com', null, undefined]), []));
check('the label: AP, GA in that order, once each, from stored and new parts', accountingLabel('GA', 'AP', 'ap') === 'AP, GA'
  && accountingLabel('AP, GA', null) === 'AP, GA' && accountingLabel('GA') === 'GA' && accountingLabel() === '' && accountingLabel('XX') === '');

// ── the invoice numbers an e-mail names ─────────────────────────────
const named = (text: string, tracked: string[]) => invoicesNamedIn(text, tracked);
check("Hursh's payment request: the invoice in the subject, not a shorter or longer number",
  same(named('Payment Request - EE Mercantile (Delilah Dallas Glassware) INV-2026-348798 - $4,528.69', ['INV-2026-348798', 'INV-2026-34879', 'INV-2026-3487981']), ['INV-2026-348798']));
check('a batch: every invoice it names', same(named('Payment Request - EE Mercantile (Delilah Tissue Coasters - Dallas, Miami & LA) INV-2026-280644, INV-2026-466262 & INV-2026-569180 - $2,660.62',
  ['INV-2026-466262', 'INV-2026-280644', 'INV-2026-569180', 'INV-2026-999999']), ['INV-2026-466262', 'INV-2026-280644', 'INV-2026-569180']));
check("Talya's forward to hwoodga@: Everything Promo's own numbering, any case", same(named('Re: Your Invoice i051432 From Everything Promo Is Attached.', ['I051432']), ['I051432']));
check("Cara's attachment name: a word and a hyphen before, an underscore after",
  same(named('Lady Delilah Invoice-INV-2026-423679_8466007313524144212.pdf', ['INV-2026-423679']), ['INV-2026-423679']));
check("a vendor's own e-mail to AP with us on copy (ARC): a number of digits only", same(named('New payment request from ARC - invoice 1685034', ['1685034']), ['1685034'])
  && same(named('Past Due - Invoice from KEVIDKO: 377159', ['377159']), ['377159']));
check('digits only: never read inside another number or after a hyphen', same(named('INV-2026-1685034', ['1685034']), [])
  && same(named('Payment Request - Maison Louis Marie (The Nice Guy Candles) INV-46284 - $257.00', ['46284']), [])
  && same(named('Payment Request - Maison Louis Marie (The Nice Guy Candles) INV-46284 - $257.00', ['INV-46284']), ['INV-46284']));
check('digits only: not a phone number, an amount or fewer than 5 digits', same(named('M. 310.975.9194 O. 310.859.1011 total $16850.34', ['9194', '8591011', '16850', '1011']), []));
check('a number with a part after a hyphen is another one ("INV-46284-2")', same(named('see INV-46284-2', ['INV-46284']), []));
check('a tracked number given twice (any case) is named once; too short or odd ones never',
  same(named('invoice I051432', ['i051432', 'I051432', ' I051432 ']), ['i051432']) && same(named('A12 B 1 INV', ['A12', 'INV', '', 'X Y1']), []));
check('nothing named, nothing found; no text, nothing found', same(named('Re: Delilah Dallas — What is the status of payment on this?', ['INV-2026-348798']), []) && same(invoicesNamedIn(null, ['INV-2026-348798']), []));

// ── an invoice's accounting state ───────────────────────────────────
let n = 0;
const id = (p: string) => `${p}${++n}`;
const order = (num: string, over: Partial<OtOrder> = {}): OtOrder => ({
  id: id('o'), order_number: num, vendor_name: 'EE Mercantile', venue_id: 'v1', deliver_to: 'venue', ordered_on: '2026-10-20',
  expected_on: null, notes: null, completed_at: null, archived_at: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...over,
});
const line = (o: OtOrder, invoice: string | null, over: Partial<OtLine> = {}): OtLine => ({
  id: id('l'), order_id: o.id, item_id: null, description: 'Libbey Contour Goblet Glass 16 oz', sku: '9156', qty: 6, unit: 'cs', unit_price: 68.84,
  status: 'INVOICED', status_at: '2026-10-28T15:00:00Z', quote_number: null, invoice_number: invoice, invoice_date: '2026-10-28', tracking_number: null,
  expected_on: null, sort: 0, ...over,
});
const sentAP = { acct_sent_at: '2026-10-28T18:04:29Z', acct_sent_to: 'AP', acct_sent_by: 'Hursh Jariwala', acct_sent_subject: 'Payment Request - EE Mercantile (Delilah Dallas Glassware) INV-2026-348798 - $4,528.69', acct_message_id: 'm1' };

const X = order('OSE-0050');
const a1 = line(X, 'INV-2026-348798', { ...sentAP, acct_sent_at: '2026-10-30T10:00:00Z', acct_sent_to: 'AP, GA', acct_sent_by: 'Cara Connor' });
const a2 = line(X, 'INV-2026-348798', sentAP);
const first = accountingOf([a1, a2]);
check('the first e-mail to accounting is the one shown', first?.at === '2026-10-28T18:04:29Z' && first?.by === 'Hursh Jariwala' && first?.to === 'AP' && first?.messageId === 'm1', first);
check('a payment request found before 0174 still counts (mailbox not known)', same(accountingOf([line(X, 'INV-2026-1', { pay_requested_at: '2026-10-29T22:08:37Z' })]),
  { at: '2026-10-29T22:08:37Z', to: null, by: null, subject: null, messageId: null }));
check('none seen -> null', accountingOf([line(X, 'INV-2026-2')]) === null && accountingOf([]) === null);
check('the pill: where, and the day in LA (a 10 pm e-mail is that day)', accountingText({ at: '2026-10-29T05:00:00Z', to: 'GA', by: null, subject: null, messageId: null }) === 'GA · 10/28'
  && accountingText({ at: '2026-11-11T19:27:03Z', to: 'AP, GA', by: null, subject: null, messageId: null }) === 'AP, GA · 11/11'
  && accountingText({ at: '2026-10-29T22:08:37Z', to: null, by: null, subject: null, messageId: null }) === 'AP · 10/29');

// ── the Orders filter: unpaid invoices no e-mail to accounting named ─
const A = order('OSE-0051'), B = order('OSE-0052'), C = order('OSE-0053'), D = order('OSE-0054', { archived_at: '2026-11-01T00:00:00Z' }),
  E = order('OSE-0055', { completed_at: '2026-11-10T00:00:00Z' }), F = order('CUS-0030'), G = order('OSE-0056');
const lines: OtLine[] = [
  line(A, 'INV-2026-111111'), line(A, 'INV-2026-111111'), line(A, 'INV-2026-222222', sentAP), line(A, null, { status: 'ORDERED' }),
  line(B, 'INV-2026-333333', { pay_requested_at: '2026-10-29T22:08:37Z' }),
  line(C, 'INV-2026-444444', { status: 'PAID' }),
  line(D, 'INV-2026-555555'),
  line(E, 'Invoice INV-2026-666666 Delilah LA'),
  line(F, 'i051432', { status: 'QUOTED' }), line(F, 'INV-2026-777777', { status: 'CANCELLED' }),
  line(G, 'INV-2026-888888', { status: 'PAID' }), line(G, 'INV-2026-888888'),
];
const miss = notSentToAccounting([A, B, C, D, E, F, G], lines);
check('an unpaid invoice with no e-mail to accounting: its order, the invoice once', same(miss.get(A.id), ['INV-2026-111111']), miss.get(A.id));
check('sent (an e-mail to AP / GA, or a payment request) or paid -> not listed', !miss.has(B.id) && !miss.has(C.id) && !miss.has(G.id));
check('archived orders and cancelled lines are left out; a completed order still owes it', !miss.has(D.id) && same(miss.get(E.id), ['INV-2026-666666']));
check('an invoice # typed on a line still before Invoiced counts (as the Payment column reads it)', same(miss.get(F.id), ['I051432']));

// ── To send: no payment request for an invoice already at accounting ─
const venueName = () => 'Delilah Dallas';
const P = order('OSE-0057');
const pl = [line(P, 'INV-2026-348798', sentAP), line(P, 'INV-2026-348798', sentAP)];
check('To send asks for no payment request once the invoice was e-mailed to accounting',
  paymentRequestsDue({ orders: [P], lines: pl, documents: [], followups: [] }, venueName).length === 0
  && paymentRequestsDue({ orders: [P], lines: pl.map(l => ({ ...l, acct_sent_at: null })), documents: [], followups: [] }, venueName).length === 1);
const old = order('OSE-0058', { created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' });
const ol = [line(old, 'INV-2026-123456', { status_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' })];
const fu = (ls: OtLine[]) => followupsDue({ orders: [old], lines: ls, documents: [], tracking: [], followups: [] }, [], '2026-11-16', venueName);
check('... and no "send the payment request" reminder either', fu(ol)[0]?.kind === 'pay' && fu(ol.map(l => ({ ...l, ...sentAP })))[0]?.kind !== 'pay', [fu(ol)[0]?.kind, fu(ol.map(l => ({ ...l, ...sentAP })))[0]?.kind]);

// ── the screens ─────────────────────────────────────────────────────
{
  const ov = src('src/components/orderTracker/OrdersView.tsx');
  check('Orders: a "Not sent to accounting N" button beside the stubs one, a chip that clears it, Clear filters resets it',
    ov.includes('Not sent to accounting <span className="num">{notAcct.size}</span>') && ov.includes('if (acctOnly && !notAcct.has(r.o.id)) return false;')
    && ov.includes("onClick={() => { setAcctOnly(true); setState('all'); }}") && ov.includes('setStubsOnly(false); setAcctOnly(false); setState(\'all\'); };')
    && ov.indexOf('Stubs to send <span') < ov.indexOf('Not sent to accounting <span'));
  check('Orders: the Payment column says "not sent to accounting" on such an order', ov.includes('{notAcct.has(o.id) && <div className="t2"') && ov.includes('>not sent to accounting</div>}'));
  const dr = src('src/components/orderTracker/OrderDrawer.tsx');
  check('the order: an Accounting column per invoice — "Sent to AP · 10/28" (who / subject on hover), "Not sent" while unpaid',
    dr.includes('<th>Payment</th><th>Accounting</th><th>PDF</th>') && dr.includes('Sent to {accountingText(acct)}') && dr.includes('>Not sent</span>}')
    && dr.includes("const acct = accountingOf(lines.filter(l => invoiceToken(l.invoice_number) === tok && l.status !== 'CANCELLED'));"));
}

// ── the morning pull (Counting-App, when it is next to this repo) ───
{
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn) {
    check('pull: the accounting step runs once the run files its invoices (the last call of a chained pull)', fn.includes('if (!chain) await accountingPhase(sb, stats);'));
    check('pull: every e-mail to AP or GA in the look-back, by Outlook search, the message itself addressed to one, no drafts',
      fn.includes('for (const box of ACCOUNTING_MAILBOXES)') && fn.includes('"recipients:${box.address} received>=${sinceDay}"')
      && fn.includes('if (!boxes.length) continue;') && fn.includes('if (seen.has(m.id) || m.isDraft) continue;') && fn.includes('const ACCT_LOOKBACK_DAYS = 90;'));
    check('pull: subject and body first; attachment names only when they name none',
      fn.includes("let invs = invoicesNamedIn(`${m.subject ?? ''} ${m.body?.content ?? ''}`, tracked);") && fn.includes('if (!invs.length && m.hasAttachments) {'));
    check('pull: the first e-mail kept, the mailboxes only grow, a time limit that says so, never failing the pull',
      fn.includes('const earlier = !l.acct_sent_at || Date.parse(hit.at) < Date.parse(l.acct_sent_at);') && fn.includes('const to = accountingLabel(l.acct_sent_to, ...hit.boxes);')
      && fn.includes('const ACCT_BUDGET_MS = 45_000;') && fn.includes("stats.acct_error = msg(e).slice(0, 300);"));
    check('pull: still reads the new API keys (the legacy ones are disabled since 11/15)', fn.includes('const SUPABASE_SERVICE_ROLE_KEY = NEW_SECRET_KEY();')
      && fn.includes('const SUPABASE_ANON_KEY = NEW_PUBLISHABLE_KEY();'));
    const mig = sibling('supabase', 'migrations', '0174_kount_ot_acct_sent.sql');
    check('0174: the five columns, and the stamps alone leave a line\'s updated_at alone', !!mig && ['acct_sent_at timestamptz', 'acct_sent_to text', 'acct_sent_by text', 'acct_sent_subject text', 'acct_message_id text'].every(c => mig.includes(c))
      && mig.includes('new.updated_at := old.updated_at;') && mig.includes('for each row execute function public.kount_ot_line_touch();'));
  } else console.log('  (Counting-App not next to this repo: the pull checks are skipped)');
}

// no raw control bytes in what this version touched (the editor once turned regex escapes into them)
{
  const files = ['src/lib/orderTracker.ts', 'src/lib/orderTrackerView.ts', 'src/lib/orderFollowups.ts', 'src/components/orderTracker/OrdersView.tsx', 'src/components/orderTracker/OrderDrawer.tsx'];
  const bad = files.filter(f => [...src(f)].some(ch => { const c = ch.charCodeAt(0); return c < 32 && c !== 9 && c !== 10 && c !== 13; }));
  check('no raw control bytes in the changed files', bad.length === 0, bad);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
