/**
 * v1.20 invoices sent to accounting (0174). The user, 11/16: "1 more distinction for the invoices we receive. I want
 * it to scan if those invoices are being sent to accounting. hwoodap@iqbackoffice.com and hwoodga@iqbackoffice.com".
 * Examples are the real subjects / attachment names in the mailbox (Sep-Nov 2026).  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNTING_MAILBOXES, accountingBoxes, accountingLabel, acctMailVerdict, firstAccountingMail, invoicesNamedIn, trackableInvoice, vendorMentioned,
  type AcctMail, type OtLine, type OtOrder } from '../src/lib/orderTracker';
import { accountingOf, accountingText, attentionItems, notSentToAccounting, ordersNotSentToAccounting, trackerKpis } from '../src/lib/orderTrackerView';
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
check('digits only: never read inside another number; with a word-prefix it is the same invoice ("INV-46284" for 46284)', same(named('INV-2026-1685034', ['1685034']), [])
  && same(named('Payment Request - Maison Louis Marie (The Nice Guy Candles) INV-46284 - $257.00', ['46284']), ['46284'])
  && same(named('Payment Request - Maison Louis Marie (The Nice Guy Candles) INV-46284 - $257.00', ['INV-46284']), ['INV-46284']));
check('digits only: not a phone number, an amount or fewer than 5 digits', same(named('M. 310.975.9194 O. 310.859.1011 total $16850.34', ['9194', '8591011', '16850', '1011']), []));
check('a number with a part after a hyphen is another one ("INV-46284-2")', same(named('see INV-46284-2', ['INV-46284']), []));
check('a tracked number given twice (any case) is named once; too short or odd ones never',
  same(named('invoice I051432', ['i051432', 'I051432', ' I051432 ']), ['i051432']) && same(named('A12 B 1 INV', ['A12', 'INV', '', 'X Y1']), []));
check('nothing named, nothing found; no text, nothing found', same(named('Re: Delilah Dallas — What is the status of payment on this?', ['INV-2026-348798']), []) && same(invoicesNamedIn(null, ['INV-2026-348798']), []));
check('file names the review found missed: a word-hyphen before, a word after a hyphen, "No." before',
  ['Invoice-1685034.pdf', 'ARC_Invoice-1685034.pdf', '1685034-ARC.pdf', 'Invoice No.1685034'].every(t => same(named(t, ['1685034']), ['1685034']))
  && same(named('INV-2026-423679-Delilah.pdf', ['INV-2026-423679']), ['INV-2026-423679']));
check('... and the false hits it found stay out: an amount, "Query No=", a revision "-01"',
  same(named('Total due $12345', ['12345']), []) && same(named("RE:Payment Request 'Query No=1685034'", ['1685034']), []) && same(named('ARC Invoice #1685034-01.pdf', ['1685034']), []));

// ── which vendor a number of digits only belongs to ─────────────────
check('vendor words: 4+ letters, not the generic ones; a name with none cannot tell (passes)',
  vendorMentioned('A.R.C. Warewash & Laundry Solutions', 'A.R.C. Warewash & Laundry Solutions via QuickBooks') && vendorMentioned('Everything Promo', 'invoice from everything promo')
  && !vendorMentioned('Everything Promo', 'Los Angeles, CA 90069') && vendorMentioned('ABC Supply Group', 'nothing alike') && vendorMentioned('ABC', 'anything'));

// ── one e-mail: did it take this invoice to accounting? ─────────────
const mail = (over: Partial<AcctMail> = {}): AcctMail => ({ id: 'm', receivedDateTime: '2026-10-28T18:04:29Z', subject: '', body: '', hasAttachments: false, isDraft: false,
  from: 'hjariwala@hwoodgroup.com', fromName: 'Hursh Jariwala', recipients: ['hwoodap@iqbackoffice.com'], ...over });
const v = (tok: string, vendor: string, m: AcctMail, names: string[] | null = null) => acctMailVerdict(tok, vendor, m, names);
check('to AP / GA and naming it -> yes; a draft, or not to AP / GA -> no',
  v('INV-2026-348798', 'EE Mercantile', mail({ subject: 'Payment Request - EE Mercantile (Delilah Dallas Glassware) INV-2026-348798 - $4,528.69' })) === 'yes'
  && v('INV-2026-348798', 'EE Mercantile', mail({ subject: 'INV-2026-348798', isDraft: true })) === 'no'
  && v('INV-2026-348798', 'EE Mercantile', mail({ subject: 'INV-2026-348798', recipients: ['aleli@eemercantile.co', 'svaldez@iqbackoffice.com'] })) === 'no');
check('GA on cc counts (Talya looping in hwoodga@)', v('I051432', 'Everything Promo', mail({ subject: 'Re: Your Invoice i051432 From Everything Promo Is Attached.',
  recipients: ['Dom@everythingpromo.com', 'HwoodGA@iqbackoffice.com'] })) === 'yes');
check('not in subject or body but attachments -> read their names; named there -> yes',
  v('INV-2026-423679', 'EE Mercantile', mail({ subject: 'Bottle Service Bucket', hasAttachments: true })) === 'attachments'
  && v('INV-2026-423679', 'EE Mercantile', mail({ subject: 'Bottle Service Bucket', hasAttachments: true }), ['Lady Delilah Invoice-INV-2026-423679_8466007313524144212.pdf']) === 'yes');
check('a number with letters only Outlook found (inside the PDF) counts; digits only must be read, beside the vendor',
  v('INV-2026-423679', 'EE Mercantile', mail({ hasAttachments: true }), ['scan.pdf']) === 'yes' && v('1685034', 'A.R.C. Warewash', mail({ hasAttachments: true }), ['scan.pdf']) === 'no'
  && v('1685034', 'A.R.C. Warewash', mail({ subject: 'New payment request from ARC - invoice 1685034', from: 'quickbooks@notification.intuit.com', fromName: 'A.R.C. Warewash & Laundry Solutions via QuickBooks' })) === 'yes'
  && v('90069', 'A.R.C. Warewash', mail({ body: 'Delilah, Los Angeles, CA 90069' })) === 'no' && v('1685034', 'A.R.C. Warewash', mail({ body: 'invoice 1685034' })) === 'no');
check('no attachments and not named -> no', v('INV-2026-348798', 'EE Mercantile', mail({ subject: 'Re: Delilah Dallas' })) === 'no');
check('re-review: written only as part of another number -> that other invoice, not this one (no Outlook-only yes)',
  v('INV-46284', 'Maison Louis Marie', mail({ subject: 'Payment Request - Maison Louis Marie INV-46284-2', hasAttachments: true }), ['INV-46284-2.pdf']) === 'no'
  && v('I051432', 'Everything Promo', mail({ subject: 'Your Invoice I051432-1 From Everything Promo', hasAttachments: true }), ['I051432-1.pdf']) === 'no');
check('re-review: a number the check cannot read ("TBD", "INV 46284", "A12") is never found',
  ['TBD', 'INV 46284', 'A12', 'SEE PDF'].every(t => v(t, 'EE Mercantile', mail({ subject: t, hasAttachments: true }), ['x.pdf']) === 'no')
  && !trackableInvoice('TBD') && !trackableInvoice('1011') && trackableInvoice('12345') && trackableInvoice('i051432') && trackableInvoice('INV-46284'));

// ── the e-mails -> what the lines keep ──────────────────────────────
const hit = firstAccountingMail([
  mail({ id: 'later', receivedDateTime: '2026-11-11T19:27:03Z', from: 'takpinar@hwoodgroup.com', fromName: 'Talya Akpinar', recipients: ['hwoodga@iqbackoffice.com'], subject: 'Re: invoice' }),
  mail({ id: 'first', receivedDateTime: '2026-11-08T15:02:30Z', from: 'ar@kevidko.com', fromName: 'KEVIDKO', recipients: ['hwoodap@iqbackoffice.com'], subject: 'Past Due - Invoice from KEVIDKO: 377159' }),
  mail({ id: 'x500', receivedDateTime: '2026-11-10T00:31:05Z', from: '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP/CN=RECIPIENTS/CN=ABC', fromName: 'Aditya Purandare', recipients: ['hwoodap@iqbackoffice.com'] }),
]);
check('the first e-mail (who, subject, id), every mailbox any went to, and when one of us first sent it (Outlook’s internal sender is ours)',
  hit?.messageId === 'first' && hit.by === 'KEVIDKO' && hit.subject === 'Past Due - Invoice from KEVIDKO: 377159' && hit.to === 'AP, GA' && hit.ownAt === '2026-11-10T00:31:05Z', hit);
check('only a vendor wrote AP -> no payment request of ours; none -> null',
  firstAccountingMail([mail({ from: 'ar@kevidko.com', fromName: 'KEVIDKO' })])?.ownAt === null && firstAccountingMail([]) === null);

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

// ── v1.21 the bell and the tile, like quotes to approve ─────────────
{
  const today = '2026-11-16';
  const L = order('OSE-0060'), M = order('CUS-0061');
  const ls = [line(L, 'INV-2026-100001', { invoice_date: '2026-11-02' }), line(L, 'INV-2026-100002', { invoice_date: '2026-11-10' }),
    line(M, 'INV-2026-100003', { invoice_date: '2026-11-13' }), line(M, 'INV-2026-100004', { ...sentAP })];
  const w = ordersNotSentToAccounting([L, M], ls, today);
  check('per order: its unsent invoices and days since the oldest was invoiced, oldest first',
    same(w.map(x => [x.order.order_number, x.invoices, x.days]), [['OSE-0060', ['INV-2026-100001', 'INV-2026-100002'], 14], ['CUS-0061', ['INV-2026-100003'], 3]]), w.map(x => [x.order.order_number, x.invoices, x.days]));
  const k = trackerKpis({ orders: [L, M], lines: ls, items: [], moves: [] }, today);
  check('the tile: orders and invoices not sent', k.acct === 2 && k.acctInvoices === 3, [k.acct, k.acctInvoices]);
  const bell = attentionItems({ orders: [L, M], lines: ls, items: [], moves: [] }, today, 0, x => `$${x}`).filter(a => a.title.startsWith('Send to accounting'));
  check('the bell: one "Send to accounting" item per order, opening it', bell.length === 2 && bell[0].title === 'Send to accounting: EE Mercantile OSE-0060'
    && bell[0].sub === 'INV-2026-100001, INV-2026-100002 · no e-mail to AP / GA yet · invoiced 14 days ago' && bell[0].sev === 'warn' && same(bell[0].act, { kind: 'order', id: L.id }), bell);
}

// ── To send: our own e-mail to AP / GA is the payment request (the pull sets pay_requested_at); a vendor's is not ─
const venueName = () => 'Delilah Dallas';
const P = order('OSE-0057');
const ownSent = { ...sentAP, pay_requested_at: sentAP.acct_sent_at };
const pl = [line(P, 'INV-2026-348798', ownSent), line(P, 'INV-2026-348798', ownSent)];
const due = (ls: OtLine[]) => paymentRequestsDue({ orders: [P], lines: ls, documents: [], followups: [] }, venueName).length;
check('To send: no payment request once one of us e-mailed the invoice to accounting; still one when only the vendor did',
  due(pl) === 0 && due(pl.map(l => ({ ...l, pay_requested_at: null }))) === 1);
const old = order('OSE-0058', { created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' });
const ol = [line(old, 'INV-2026-123456', { status_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' })];
const fu = (ls: OtLine[]) => followupsDue({ orders: [old], lines: ls, documents: [], tracking: [], followups: [] }, [], '2026-11-16', venueName);
check('reminders: invoiced, not requested -> "send the payment request"', fu(ol)[0]?.kind === 'pay', fu(ol)[0]);
check('reminders: every invoice with accounting -> no reminder (it used to e-mail the vendor "Paid, not shipped")',
  fu(ol.map(l => ({ ...l, ...ownSent }))).length === 0, fu(ol.map(l => ({ ...l, ...ownSent }))).map(f => f.kind));
const two = [line(old, 'INV-2026-123456', { ...ownSent, status_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' }),
  line(old, 'INV-2026-654321', { status_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' })];
check('reminders: one invoice with accounting and one not -> still "send the payment request"', fu(two)[0]?.kind === 'pay', fu(two)[0]?.kind);
check('reminders: with accounting but past its ETA -> still ask the vendor for a new ETA',
  fu(ol.map(l => ({ ...l, ...ownSent, expected_on: '2026-11-01' })))[0]?.kind === 'late');

// ── the screens ─────────────────────────────────────────────────────
{
  const ov = src('src/components/orderTracker/OrdersView.tsx');
  check('Orders: a "Not sent to accounting N" button beside the stubs one, a chip that clears it, Clear filters resets it',
    ov.includes('Not sent to accounting <span className="num">{notAcct.size}</span>') && ov.includes('if (acctOnly && !notAcct.has(r.o.id)) return false;')
    && ov.includes("onClick={() => { setAcctOnly(true); setState('all'); }}") && ov.includes('setStubsOnly(false); setAcctOnly(false); setQuietOnly(false); setState(\'all\'); };')
    && ov.indexOf('Stubs to send <span') < ov.indexOf('Not sent to accounting <span'));
  check('v1.21 Orders: a "Send to accounting" pill on such an order, beside "Approve quote" (the user: "similar to the quoted items")',
    ov.includes('{notAcct.has(o.id) && <span className="ot-pill warn"') && ov.includes('>Send to accounting</span>}') && !ov.includes('>not sent to accounting</div>}'));
  check('v1.21 Orders: the "acct" preset opens the filter on all orders', ov.includes("| 'stubs' | 'acct'; n: number }") && ov.includes("setState(preset.key === 'stubs' || preset.key === 'acct' ? 'all' : 'open');")
    && ov.includes("setAcctOnly(preset.key === 'acct');"));
  const ot = src('src/screens/OrderTracker.tsx');
  check('v1.21 a "To accounting" tile beside "Quotes to approve" that opens that filter; the tiles fit 7 across',
    ot.includes("onClick={() => kpi('acct')}") && ot.includes('<span className="lbl">To accounting</span>') && ot.indexOf('Quotes to approve</span>') < ot.indexOf('To accounting</span>')
    && src('src/components/orderTracker/tracker.css').includes('.ot-kpis { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));'));
  const drv = src('src/components/orderTracker/OrderDrawer.tsx');
  check('v1.21 the order: a "Send to accounting" note with "I’ve sent it, check now" (this order’s invoices only), like the quote approval',
    drv.includes('<b>Send to accounting.</b>') && drv.includes('onClick={() => void checkAcct()}') && drv.includes('const r = await checkAccounting(order.id);')
    && src('src/lib/orderMail.ts').includes("({ action: 'accounting', order_id })"));
  const dr = src('src/components/orderTracker/OrderDrawer.tsx');
  check('the order: an Accounting column per invoice — "Sent to AP · 10/28" (who / subject on hover), "Not sent" while unpaid',
    dr.includes('<th>Payment</th><th>Accounting</th><th>PDF</th>') && dr.includes('Sent to {accountingText(acct)}') && dr.includes('>Not sent</span>}')
    && dr.includes("const acct = accountingOf(lines.filter(l => invoiceToken(l.invoice_number) === tok && l.status !== 'CANCELLED'));"));
  check('the order: a part-paid invoice shows no "Not sent" (as the Orders filter reads it)', dr.includes(': anyPaid || i.paid ? <span className="faint">'));
  const ib = src('src/components/orderTracker/InboxView.tsx');
  check('Inbox: the last pull says how many lines it found sent, and when the check stopped short or failed',
    ib.includes('found sent to accounting, ') && ib.includes('Sent-to-accounting check: {run.acct_error}'));
}

// ── the morning pull (Counting-App, when it is next to this repo) ───
{
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn) {
    check('pull: the accounting step runs once the run files its invoices (the last call of a chained pull), timed from the run start',
      fn.includes('if (!chain) await accountingPhase(sb, stats, startedMs);') && fn.includes('const until = Math.min(Date.now() + ACCT_BUDGET_MS, startedMs + ACCT_RUN_LIMIT_MS);'));
    check('pull: unpaid invoices only, searchable numbers only; a line added later copies the stamp (a failure there is counted, not fatal)',
      fn.includes("if (ls.some(l => statusRank(l.status) >= statusRank('PAID'))) continue;") && fn.includes('if (!trackableInvoice(t)) continue;')
      && fn.includes('const missing = ls.filter(l => !l.acct_sent_at).map(l => l.id);') && fn.includes('if (error) fail(error); else stats.acct_sent'));
    check('pull: found by a vendor’s own e-mail -> still searched for ours (the payment request); found with ours -> done',
      fn.includes('if (ls.every(l => l.pay_requested_at)) continue;') && fn.includes('stamped: !!found });')
      && fn.includes('const stamp = t.stamped ? {} : { acct_sent_at: hit.at,'));
    check('pull: each number searched as words and in attachments (Outlook’s plain search is from / subject / body only); each e-mail judged once',
      fn.includes('for (const term of [q, `attachment:${q}`]) {') && fn.includes('if (seen.has(m.id)) continue;')
      && fn.includes("let v = acctMailVerdict(t.tok, t.vendor, mail);") && fn.includes("if (v === 'attachments') {"));
    check('pull: the stamp and our payment request in the same update; the rest of the lines get the stamp',
      fn.includes("const hit = firstAccountingMail(hits, OWN_DOMAINS);") && fn.includes(".update({ ...stamp, pay_requested_at: ownAt }).in('id', requested);")
      && fn.includes(".update(stamp).in('id', rest);"));
    check('pull: in number order from where the last pull stopped (acct_cursor), cleared once through them all; failures counted; never failing the pull',
      fn.includes("const after = todo.findIndex(t => t.tok.localeCompare(cursor) > 0);") && fn.includes("update({ acct_cursor: checked < order.length ? lastTok : null })")
      && fn.includes('the next pull goes on from there') && fn.includes("stats.acct_error = msg(e).slice(0, 300);"));
    check('v1.21 "check now": one order’s invoices only, the pulls’ place in the list left alone, found / requested returned',
      fn.includes("if (action === 'accounting') {") && fn.includes('await accountingPhase(sb, stats, Date.now(), orderId);')
      && fn.includes('if (onlyOrder && !ls.some(l => l.order_id === onlyOrder)) continue;') && fn.includes('if (lastTok && !onlyOrder) await')
      && fn.includes('return json(200, { found: stats.acct_sent ?? 0, requested: stats.acct_requested ?? 0,'));
    check('pull: still reads the new API keys (the legacy ones are disabled since 11/15)', fn.includes('const SUPABASE_SERVICE_ROLE_KEY = NEW_SECRET_KEY();')
      && fn.includes('const SUPABASE_ANON_KEY = NEW_PUBLISHABLE_KEY();'));
    const mig = sibling('supabase', 'migrations', '0174_kount_ot_acct_sent.sql');
    check('0174: the five columns, and the stamps alone leave a line\'s updated_at alone', !!mig && ['acct_sent_at timestamptz', 'acct_sent_to text', 'acct_sent_by text', 'acct_sent_subject text', 'acct_message_id text'].every(c => mig.includes(c))
      && mig.includes('new.updated_at := old.updated_at;') && mig.includes('for each row execute function public.kount_ot_line_touch();'));
    check('0174: a line moved to another invoice loses the stamps and the payment request', !!mig
      && mig.includes('if public.kount_ot_inv_token(new.invoice_number) is distinct from public.kount_ot_inv_token(old.invoice_number) then')
      && mig.includes('new.pay_requested_at := null; new.ap_query_no := null;'));
    check('0174: the payment-request stamps (0153) also leave updated_at alone; the check’s place is kept (acct_cursor)', !!mig
      && mig.includes("'{updated_at,acct_sent_at,acct_sent_to,acct_sent_by,acct_sent_subject,acct_message_id,pay_requested_at,ap_query_no}'::text[]")
      && mig.includes('alter table public.kount_ot_mail_account add column if not exists acct_cursor text;'));
  } else console.log('  (Counting-App not next to this repo: the pull checks are skipped)');
}

// ── v1.21 payment requests drafted in Outlook ───────────────────────
{
  const ts = src('src/components/orderTracker/ToSend.tsx');
  const pd = src('src/components/orderTracker/payDraft.ts');
  const dr = src('src/components/orderTracker/OrderDrawer.tsx');
  check('one helper drafts it: the draft with the invoice PDFs (document ids), opened in the tab opened in the click',
    pd.includes('const r = await draftMail({ to: p.email.to, cc: p.email.cc, subject: p.email.subject, text: signedBody(p.email.body, who.name ?? who.email),')
    && pd.includes('document_ids: files.map(d => d.id) });') && pd.includes("if (w) { w.opener = null; w.location.href = r.link; }"));
  check('... no draft (IT has not granted it, another mailbox, not connected): a new e-mail filled in + the PDFs downloaded, and it says why',
    pd.includes('const link = outlookComposeLink(p.email);') && pd.includes("for (const d of files) await downloadDocument(d.storage_path!, d.file_name || `${d.doc_number ?? 'invoice'}.pdf`);")
    && pd.includes('IT has to approve Mail.ReadWrite for the Order Tracker app'));
  check('... either way it is logged (To send stops listing it); a blank tab is closed on an error',
    pd.includes("const logId = await logFollowup({ order_id: p.order.id, kind: 'payment', invoice_numbers: p.invoices, note: p.email.subject.slice(0, 200) });")
    && pd.includes('w?.close();'));
  check('To send: "Draft in Outlook" uses it (Undo kept)', ts.includes('<Btn variant="primary" size="sm" onClick={onDraft}>Draft in Outlook</Btn>')
    && ts.includes("const r = await openPaymentDraft(p, { email: me, name: meName }, w);") && ts.includes('setLogged({ id: r.logId, label: p.email.subject });')
    && !ts.includes('draftMail('));
  check('v1.21 the order\u2019s "Send to accounting" note: "Draft in Outlook" (one per venue) beside "I\u2019ve sent it, check now" (the user: "it only shows I\u2019ve sent it check now")',
    dr.includes('Draft in Outlook{payReqs.length > 1 ? ` (${r.venue})` : \'\'}</button>') && dr.includes('const res = await openPaymentDraft(r, { email: me?.email ?? \'\', name: me?.name ?? null }, w);')
    && dr.indexOf('Draft in Outlook{payReqs') < dr.indexOf("I've sent it, check now</button>", dr.indexOf('<b>Send to accounting.</b>')));
  check('... written as To send writes it, for exactly the invoices the note names, offered even if composed before or not yet at Invoiced',
    dr.includes('const ls = lines.filter(l => l.status !== \'CANCELLED\' && !!l.invoice_number && want.has(invoiceToken(l.invoice_number)))')
    && dr.includes("return paymentRequestsDue({ orders: [order], lines: ls, documents: data.documents, followups: [] }, venueName, me?.email ?? '', venueStage);"));
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  const graph = sibling('supabase', 'functions', 'kount-order-mail', 'graph.ts');
  if (fn && graph) {
    check('function draft_mail: only the connected mailbox owner, a Mail.ReadWrite token asked for only here, not_granted when IT has not given it',
      fn.includes("if (action === 'draft_mail') {") && fn.includes("if (String(acct.mailbox ?? '').toLowerCase() !== caller.email) return json(200, { drafted: false, reason: 'not_owner'")
      && fn.includes('token = (await refreshAccess(String(refresh), DRAFT_SCOPE)).access_token;') && graph.includes("export const DRAFT_SCOPE = 'https://graph.microsoft.com/Mail.ReadWrite';"));
    check('... the tracker documents attached (3 MB each at most), the draft made in Drafts, its Outlook link returned - never sent',
      fn.includes("const { data: docs, error: dErr } = await sb.from('kount_ot_documents').select('id, kind, doc_number, file_name, storage_path, order_id').in('id', docIds as string[]);")
      && fn.includes("if (bytes.length > 3 * 1024 * 1024) { skipped.push(name); continue; }") && fn.includes("await graphPostJson<{ id?: string; webLink?: string }>(token, '/me/messages', {")
      && fn.includes('return json(200, { drafted: true, link: draft.webLink ?? null, attached: attachments.length, skipped });'));
  }
}

// no raw control bytes in what this version touched (the editor once turned regex escapes into them)
{
  const files = ['src/lib/orderTracker.ts', 'src/lib/orderTrackerView.ts', 'src/lib/orderFollowups.ts', 'src/lib/orderMail.ts', 'src/components/orderTracker/OrdersView.tsx',
    'src/components/orderTracker/OrderDrawer.tsx', 'src/components/orderTracker/InboxView.tsx', 'src/components/orderTracker/ToSend.tsx', 'src/lib/orderTrackerData.ts', 'src/components/orderTracker/payDraft.ts'];
  const bad = files.filter(f => [...src(f)].some(ch => { const c = ch.charCodeAt(0); return c < 32 && c !== 9 && c !== 10 && c !== 13; }));
  check('no raw control bytes in the changed files', bad.length === 0, bad);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
