/**
 * v1.14 check stubs to send. The user: "when the status changes to paid for any order ... flagged as recently paid
 * ... so that I can pull the check stub and send it to the vendor on time" and "things are sent for payment every
 * thursday and friday". Calendar: Tue 11/10/2026 -> last week's run was Thu 11/5 - Fri 11/6.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attentionItems, nextBusinessDay, paymentRun, stubsToSend } from '../src/lib/orderTrackerView';
import { stubEmail } from '../src/lib/stubMail';
import type { OtDocument, OtLine, OtOrder } from '../src/lib/orderTracker';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}

let n = 0;
const id = (p: string) => `${p}${++n}`;
const order = (num: string, over: Partial<OtOrder> = {}): OtOrder => ({
  id: id('o'), order_number: num, vendor_name: 'EE Mercantile', venue_id: 'v1', deliver_to: 'venue', ordered_on: '2026-10-20',
  expected_on: null, notes: null, completed_at: null, archived_at: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...over,
});
const line = (o: OtOrder, invoice: string, over: Partial<OtLine> = {}): OtLine => ({
  id: id('l'), order_id: o.id, item_id: null, description: 'Glassware', sku: null, qty: 10, unit: 'case', unit_price: 100,
  status: 'PAID', status_at: '2026-11-07T15:00:00Z', quote_number: null, invoice_number: invoice, invoice_date: '2026-10-28', tracking_number: null,
  expected_on: null, sort: 0, ...over,
});
const pay = (number: string, date: string, amount = 1000) => ({ r365_payments: [{ number, date, amount }] });
const doc = (o: OtOrder, kind: string, number: string, source: string | null) =>
  ({ id: id('d'), order_id: o.id, kind, doc_number: number, source_message_id: source, parsed: kind === 'payment' ? { invoices: [number] } : null }) as unknown as OtDocument;

const today = '2026-11-11';
check('payment run: Thu and Fri are one run, labelled by its days', paymentRun('2026-11-05').key === 'run:2026-11-05' && paymentRun('2026-11-06').key === 'run:2026-11-05'
  && paymentRun('2026-11-05').label === 'Thu 11/5 – Fri 11/6 payment run' && paymentRun('2026-11-06').endsOn === '2026-11-06', paymentRun('2026-11-06'));
check('payment run: another day stands alone', paymentRun('2026-11-04').key === 'day:2026-11-04' && paymentRun('2026-11-04').label === 'paid Wed 11/4');
check('due the next business day (a Friday run -> Monday)', nextBusinessDay('2026-11-06') === '2026-11-09' && nextBusinessDay('2026-11-04') === '2026-11-05');

const A = order('OSE-0030'), B = order('WHS-0004'), C = order('OSE-0001'), D = order('OSE-0035'), E = order('CUS-0023'), F = order('OSE-0040'), G = order('OSE-0041');
const H = order('OSE-0042', { archived_at: '2026-11-01T00:00:00Z' });
const I = order('CUS-0031');   // imported from the sheet on 11/3 already Paid: no R365 payment, status time = creation time
const lines = [
  line(A, 'INV-2026-885072', pay('ACH - 24567', '2026-11-06', 494.4)),       // last week's run, no stub
  line(B, 'INV-2026-099612', pay('ACH - 24567', '2026-11-06', 41.67)),       // the same ACH -> one stub e-mail
  line(C, 'INV-2026-100001', pay('ACH - 20000', '2026-10-01')),               // paid six weeks ago: not "recent"
  line(D, 'INV-2026-396769', pay('ACH - 24500', '2026-11-05')),               // its stub already went out (from our e-mail)
  line(E, 'INV-2026-228285', pay('ACH - 24400', '2026-11-04')),               // stub attached by hand, not sent
  line(F, 'INV-2026-555555', { status_at: '2026-11-10T18:00:00Z' }),          // marked Paid by hand yesterday, no R365 payment
  line(G, 'INV-2026-666666', { status: 'INVOICED' }),                         // not paid
  line(H, 'INV-2026-777777', pay('ACH - 24567', '2026-11-06')),               // archived
  { ...line(I, 'INV-2026-591868', { status_at: '2026-11-03T21:00:00Z' }), created_at: '2026-11-03T21:00:00Z' } as OtLine,   // born Paid
];
const docs = [doc(D, 'payment', 'INV-2026-396769', 'MSG-OUR-STUB'), doc(E, 'payment', 'INV-2026-228285', null), doc(A, 'invoice', 'INV-2026-885072', 'MSG-INV-A')];
const sends = stubsToSend([A, B, C, D, E, F, G, H, I], lines, docs, today);
const by = (num: string) => sends.find(g => g.items.some(i => i.orderNumber === num));
check('recently paid, stub not sent: A+B (one ACH), E (on file), F (marked Paid) — not C (old), D (sent), G (unpaid), H (archived)',
  sends.length === 3 && !!by('OSE-0030') && by('OSE-0030') === by('WHS-0004') && !!by('CUS-0023') && !!by('OSE-0040')
  && !by('OSE-0001') && !by('OSE-0035') && !by('OSE-0041') && !by('OSE-0042'), sends.map(g => g.items.map(i => i.orderNumber)));
const ach = by('OSE-0030')!;
check('one ACH paying two invoices = one stub e-mail: both invoices, the payment, the total', ach.items.map(i => i.invoice).join() === 'INV-2026-099612,INV-2026-885072'
  && ach.payments.map(p => p.number).join() === 'ACH - 24567' && ach.total === 2000 && ach.stage === 'get', ach);
check('last week\'s Thu-Fri run, due Monday 11/9 -> overdue on Wednesday 11/11', ach.run.label === 'Thu 11/5 – Fri 11/6 payment run' && ach.dueOn === '2026-11-09' && ach.overdue);
check('the invoice came by e-mail: a reply in that thread is offered', ach.replyTo === 'MSG-INV-A');
check('a stub attached by hand is on file but not sent', by('CUS-0023')!.stage === 'send' && by('CUS-0023')!.run.key === 'day:2026-11-04');
const f = by('OSE-0040')!;
check('marked Paid by hand: paid the day it was marked, due the next business day, not overdue yet', f.paidOn === '2026-11-10' && f.dueOn === '2026-11-11' && !f.overdue && f.payments.length === 0);
check('newest first', sends[0] === f, sends.map(g => g.paidOn));
check('a line that arrived already Paid (the sheet import) is not "recently paid" — only a change to Paid is', !by('CUS-0031'));

const mails = [{ message_id: 'MSG-INV-A', order_id: A.id, sender_email: 'aleli@eemercantile.co', sender_name: 'Aleli Abad', subject: 'Invoice INV-2026-885072', received_at: '2026-10-28T17:00:00Z' }];
const e = stubEmail(ach, [A, B], mails, { email: 'apurandare@hwoodgroup.com', name: 'Aditya Purandare' });
check('the stub e-mail: to the invoice\'s sender, "Payment stub – <invoices>"', e.to.join() === 'aleli@eemercantile.co' && e.subject === 'Payment stub – INV-2026-099612, INV-2026-885072', e);
check('its text says "payment stub" and every invoice — what the mail pull looks for to file the stub and clear it',
  e.body === 'Hi Aleli,\n\nPlease find attached the payment stub for INV-2026-099612 and INV-2026-885072 ($2,000.00, paid Nov 6 – ACH - 24567).\n\nThank you,\nAditya'
  && /payment stub/i.test(e.body) && [...e.body.matchAll(/INV-\d{4}-\d{5,7}/gi)].map(m => m[0]).join() === 'INV-2026-099612,INV-2026-885072', e.body);
const noThread = stubEmail(by('CUS-0023')!, [E], [], { email: 'apurandare@hwoodgroup.com', name: 'Aditya' });
check('no invoice e-mail: to the vendor\'s buyer on file (Jemma for CUS)', noThread.to.join() === 'jemma@eemercantile.co' && /^Hi Jemma,/.test(noThread.body));

const att = attentionItems({ orders: [A, B, C, D, E, F, G, H, I], lines, items: [], moves: [], documents: docs }, today, 0, x => `$${x}`);
const stubAtt = att.filter(a => /check stub/i.test(a.title));
check('bell: one item per payment run, red once overdue, opening To send',
  stubAtt.some(a => a.sev === 'crit' && a.title === 'Send the check stub: Thu 11/5 – Fri 11/6 payment run' && /overdue since 2026-11-09/.test(a.sub) && a.act.kind === 'tab' && (a.act as { tab: string }).tab === 'tosend')
  && stubAtt.some(a => a.sev === 'warn' && /paid Tue 11\/10/.test(a.title) && /send by 2026-11-11/.test(a.sub)), stubAtt);
check('bell: the old "no check stub" count is the backlog only — C (paid six weeks ago) and CUS-0031 (imported Paid), not the recent ones',
  stubAtt.some(a => a.sev === 'info' && a.title === '2 paid invoices have no check stub'), stubAtt.map(a => a.title));

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const ts = src('src/components/orderTracker/ToSend.tsx');
check('To send: "Check stubs to send" first, by payment run with its send-by day; Reply in Outlook / New e-mail',
  ts.indexOf('Check stubs to send') < ts.indexOf('Payment requests') && /send by \{shortDate\(g\.dueOn\)\}/.test(ts) && />Reply in Outlook</.test(ts) && />New e-mail</.test(ts)
  && /Check Stub Reprint/.test(ts));
check('To send: Reply in Outlook copies the text and opens the tab in the click (not blocked)', /navigator\.clipboard\.writeText\(e\.body\)/.test(ts) && /const w = window\.open\('', '_blank'\);/.test(ts) && /w\.location\.href = r\.link/.test(ts));
check('Orders: "Send stub" / "Stub overdue" on the order row', /'Stub overdue' : 'Send stub'/.test(src('src/components/orderTracker/OrdersView.tsx')));
check('the To send count includes the stubs', /\+ stubsToSend\(data\.orders, data\.lines, data\.documents, today\)\.length/.test(src('src/screens/OrderTracker.tsx')));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
