/**
 * v1.04 what to send: follow-ups on quiet orders and payment requests to AP (src/lib/orderFollowups.ts).
 * Shaped on real orders: Delilah LA's INV-2026-086418 (Hursh's payment request of 10/29, $2,397.33 incl. 7.25% tax),
 * Delilah Dallas OSE-0023 (paid 10/28, nothing since), CUS-0019 matches.  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AP_TO, businessDaysBetween, followupsDue, lastActivity, mailtoLink, payCategory, paymentRequestsDue, vendorContact, type OrderMail, type OtFollowup } from '../src/lib/orderFollowups';
import { findApproval, isOwnSender, paymentRequestOf, type MailMessage, type OtDocument, type OtLine, type OtOrder, type OtTracking } from '../src/lib/orderTracker';
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const TODAY = '2026-11-05';                                       // a Thursday
const VENUES: Record<string, string> = { v1: 'Delilah LA', v2: 'Delilah Miami', v14: 'Lady Delilah', 'x:Delilah Dallas': 'Delilah Dallas' };
const venueName = (id: string | null) => (id ? VENUES[id] ?? id.replace(/^x:/, '') : 'Warehouse');
let n = 0;
const order = (over: Partial<OtOrder> & { last_vendor_email_at?: string | null } = {}): OtOrder => ({
  id: `o${++n}`, order_number: `OSE-00${n}`, vendor_name: 'EE Mercantile', venue_id: 'v1', deliver_to: 'venue', ordered_on: '2026-10-20', expected_on: null, notes: null,
  completed_at: null, archived_at: null, created_at: '2026-10-20T18:00:00Z', updated_at: '2026-10-20T18:00:00Z', ...over,
});
const line = (o: OtOrder, over: Partial<OtLine> & { pay_requested_at?: string | null } = {}): OtLine => ({
  id: `l${++n}`, order_id: o.id, item_id: null, description: 'Item', sku: null, qty: 1, unit: 'cs', unit_price: 10, status: 'PAID', status_at: '2026-10-28T18:00:00Z',
  quote_number: null, invoice_number: null, invoice_date: null, tracking_number: null, expected_on: null, sort: n, updated_at: '2026-10-28T18:00:00Z', ...over,
});
const sent = (o: OtOrder, kind: OtFollowup['kind'], day: string, inv: string[] | null = null): OtFollowup =>
  ({ id: `f${++n}`, order_id: o.id, kind, sent_on: day, by_email: 'apurandare@hwoodgroup.com', invoice_numbers: inv, note: null, created_at: `${day}T17:30:00Z` });

// ── business days ───────────────────────────────────────────────────
check('business days: Fri -> Wed = 3, Fri -> Mon = 1, same day = 0, weekend only = 0',
  businessDaysBetween('2026-10-30', '2026-11-04') === 3 && businessDaysBetween('2026-10-30', '2026-11-02') === 1
  && businessDaysBetween('2026-11-05', '2026-11-05') === 0 && businessDaysBetween('2026-10-30', '2026-11-01') === 0);

// ── follow-ups ──────────────────────────────────────────────────────
{
  const dallas = order({ order_number: 'OSE-0023', venue_id: 'x:Delilah Dallas' });
  const goblet = line(dallas, { description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12', qty: 30, invoice_number: 'INV-2026-348798' });
  const nora = line(dallas, { description: 'VISKI - NICK & NORA GLASS 6OZ/ 4', qty: 30, invoice_number: 'INV-2026-348798' });
  const mails: OrderMail[] = [
    { order_id: dallas.id, sender_email: 'Aleli@eemercantile.co', sender_name: 'Aleli Abad', subject: 'Order Delilah Dallas - Glassware', received_at: '2026-10-28T01:00:00Z' },
    { order_id: dallas.id, sender_email: 'hjariwala@hwoodgroup.com', sender_name: 'Hursh Jariwala', subject: 'Re: Order Delilah Dallas - Glassware', received_at: '2026-10-29T01:00:00Z' },
  ];
  const quietEta = order({ order_number: 'OSE-0040', expected_on: null });
  const lateOne = order({ order_number: 'OSE-0041' });
  const lateLine = line(lateOne, { description: 'Bar spoons', expected_on: '2026-10-30', status: 'SHIPPED' }), onTime = line(lateOne, { description: 'Jiggers', expected_on: '2026-11-20' });
  const fresh = order({ order_number: 'OSE-0042', last_vendor_email_at: '2026-11-05T07:16:21Z' });
  const quote = order({ order_number: 'OSE-0043' }), req = order({ order_number: 'OSE-0044' }), inv = order({ order_number: 'OSE-0045' });
  const chased = order({ order_number: 'OSE-0046' }), justChased = order({ order_number: 'OSE-0047' });
  const done = order({ order_number: 'OSE-0048' }), archived = order({ order_number: 'OSE-0049', archived_at: '2026-11-01T00:00:00Z' });
  const custom = order({ order_number: 'CUS-0050', venue_id: 'v14' });
  const lines = [goblet, nora, line(quietEta, { description: 'Pepper mills' }), lateLine, onTime, line(fresh), line(quote, { status: 'QUOTED' }), line(req, { status: 'REQUESTED' }),
    line(inv, { status: 'INVOICED', invoice_number: 'INV-2026-1' }), line(chased), line(justChased), line(done, { status: 'DELIVERED' }), line(archived), line(custom, { status: 'ORDERED', description: 'Chopsticks' })];
  const followups = [sent(chased, 'vendor', '2026-10-29'), sent(chased, 'vendor', '2026-10-30'), sent(justChased, 'vendor', '2026-11-04')];
  const data = { orders: [dallas, quietEta, lateOne, fresh, quote, req, inv, chased, justChased, done, archived, custom], lines, documents: [] as OtDocument[], tracking: [] as OtTracking[], followups };
  const due = followupsDue(data, mails, TODAY, venueName, 'apurandare@hwoodgroup.com');
  const of = (o: OtOrder) => due.find(f => f.order.id === o.id);

  const d = of(dallas)!;
  check('Dallas OSE-0023 (paid 10/28, nothing since): ask E&E for production status + ETA, 6 business days quiet', d?.kind === 'eta' && d.to === 'vendor' && d.idle === 6, d);
  check('... to the vendor who wrote last (not our own reply), in that thread', d.email?.to.join() === 'aleli@eemercantile.co' && d.email?.subject === 'Re: Order Delilah Dallas - Glassware', d.email);
  check('... names the order, its invoice, the venue and the open lines', /Hi Aleli,/.test(d.email!.body) && d.email!.body.includes('OSE-0023 (INV-2026-348798) for Delilah Dallas')
    && d.email!.body.includes('- VISKI - NICK & NORA GLASS 6OZ/ 4 — 30 cs'));
  check('past its ETA: asks for a new ETA, about the late lines only', of(lateOne)?.kind === 'late' && of(lateOne)?.lines.map(l => l.description).join() === 'Bar spoons');
  check('a vendor e-mail in the thread this morning counts as an update (Jemma\'s tracking reply)', !of(fresh));
  check('our next step -> a reminder to us, not the vendor: quote to approve, request to order, invoice to pay',
    of(quote)?.kind === 'approve' && of(quote)?.to === 'self' && !of(quote)?.email && of(req)?.kind === 'order-it' && of(inv)?.kind === 'pay');
  check('two follow-ups with no reply: stop chasing, tell us', of(chased)?.kind === 'no-reply' && of(chased)?.to === 'self' && of(chased)?.tries === 2);
  check('chased yesterday: not again until 3 business days after that', !of(justChased));
  check('delivered / archived orders: nothing', !of(done) && !of(archived));
  check('a custom order with no vendor e-mail on file goes to Jemma, an OS&E one to Aleli',
    vendorContact(custom, [])?.email === 'jemma@eemercantile.co' && vendorContact(quietEta, [])?.email === 'aleli@eemercantile.co' && of(custom)?.kind === 'confirm');
  check('oldest first', due[0].idle >= due[due.length - 1].idle);
  check('last activity: a document or tracking added later counts',
    lastActivity(quietEta, [], [{ created_at: '2026-11-04T10:00:00Z' } as OtDocument], [{ created_at: '2026-11-03T10:00:00Z' } as unknown as OtTracking], []) === '2026-11-04T10:00:00Z');
}

// ── payment requests ────────────────────────────────────────────────
{
  check('category words from the lines', payCategory([{ description: 'LIBBEY - CONTOUR GOBLET GLASS 16 OZ/ 12' }, { description: 'STEELITE- DESSERT FORK MONZA- 7"/ 12' }]) === 'Glassware & Flatware'
    && payCategory([{ description: 'Matchbook 2500 pcs/case' }]) === 'Matches' && payCategory([{ description: 'Shipping Fee - For items under INV-2026-418553' }]) === 'Shipping'
    && payCategory([{ description: 'Mystery' }]) === 'Order');

  const la = order({ order_number: 'OSE-0029', vendor_name: 'EE Mercantile', venue_id: 'v1' });
  const g = line(la, { description: 'Libbey Contour Goblet Glass 16 oz', sku: '9156', qty: 6, unit: 'cs', unit_price: 68.84, status: 'INVOICED', invoice_number: 'INV-2026-086418' });
  const f = line(la, { description: 'Steelite Monza Dessert Fork 7"', sku: '5340Z023', qty: 17, unit: 'dz', unit_price: 107.19, status: 'INVOICED', invoice_number: 'INV-2026-086418' });
  const pdf = { id: 'd1', order_id: la.id, kind: 'invoice', doc_number: 'INV-2026-086418', doc_date: '2026-10-29', vendor_name: 'EE Mercantile', total: 2397.33,
    file_name: 'Invoice-INV-2026-086418.pdf', storage_path: 'docs/x.pdf', created_at: '2026-10-29T22:02:00Z', parsed: { subtotal: 2235.27, total: 2397.33 } } as OtDocument;
  const [p] = paymentRequestsDue({ orders: [la], lines: [g, f], documents: [pdf], followups: [] }, venueName, 'apurandare@hwoodgroup.com');
  check('Delilah LA INV-2026-086418: the subject Hursh wrote', p?.email.subject === 'Payment Request - EE Mercantile (Delilah LA Glassware & Flatware) INV-2026-086418 - $2,397.33', p?.email.subject);
  check('... amount and tax from the invoice ($2,397.33 incl. 7.25% tax of $162.06)', p.email.body.includes('Amount: $2,397.33 (incl. 7.25% tax of $162.06)') && p.tax === 162.06);
  check('... items with item # and qty, invoice date, terms, Ahmed for approval', p.email.body.includes('Item: Libbey Contour Goblet Glass 16 oz (9156, qty 6 cs), Steelite Monza Dessert Fork 7" (5340Z023, qty 17 dz)')
    && p.email.body.includes('Invoice Date: October 29, 2026') && p.email.body.includes('Terms: Due on Receipt') && p.email.body.includes("I've also included Ahmed for approval."));
  check('... to AP, copying the team but not the person composing; the PDF to attach', p.email.to.join() === AP_TO && !p.email.cc.includes('apurandare@hwoodgroup.com')
    && p.email.cc.includes('aameziane@hwoodgroup.com') && p.docs.length === 1);

  const requested = paymentRequestsDue({ orders: [la], lines: [{ ...g, pay_requested_at: '2026-10-29T22:08:37Z' } as OtLine, { ...f, pay_requested_at: '2026-10-29T22:08:37Z' } as OtLine], documents: [pdf], followups: [] }, venueName);
  const composed = paymentRequestsDue({ orders: [la], lines: [g, f], documents: [pdf], followups: [sent(la, 'payment', TODAY, ['INV-2026-086418'])] }, venueName);
  check('already requested (found in the mailbox) or composed here: not again', requested.length === 0 && composed.length === 0);

  const m = order({ order_number: 'CUS-0019', venue_id: 'x:Multiple venues' });
  const lam = line(m, { description: 'Delilah Matches — LA (SPDELMAT), 2,500/cs', venue_id: 'v1', qty: 4, unit_price: 1481.25, status: 'INVOICED', invoice_number: 'INV-2026-450410' });
  const mia = line(m, { description: 'Delilah Matches — Miami (SPDELMATMI), 2,500/cs', venue_id: 'v2', qty: 4, unit_price: 1481.25, status: 'INVOICED', invoice_number: 'INV-2026-280738' });
  const two = paymentRequestsDue({ orders: [m], lines: [lam, mia], documents: [], followups: [] }, venueName);
  check('one request per venue of a multi-venue order', two.length === 2 && two.map(r => r.venue).sort().join() === 'Delilah LA,Delilah Miami');
  check('no invoice PDF in the tracker: the lines\' total before tax, said so', two[0].total === 5925 && /\$5,925\.00 before tax \(the invoice PDF is not in the tracker/.test(two[0].email.body));
  check('paid / shipped lines are not asked for', paymentRequestsDue({ orders: [la], lines: [{ ...g, status: 'PAID' }], documents: [pdf], followups: [] }, venueName).length === 0);
}

// ── compose ─────────────────────────────────────────────────────────
{
  const link = mailtoLink({ to: ['hwoodap@iqbackoffice.com'], cc: ['a@x.com', 'b@x.com'], subject: 'Payment Request - EE Mercantile (Delilah LA Glassware & Flatware) INV-1 - $1.00', body: 'Hi,\n\nLine & more' });
  check('mailto: to, cc, subject and body encoded; line breaks as CRLF', link.startsWith('mailto:hwoodap%40iqbackoffice.com?cc=a%40x.com%2Cb%40x.com&subject=Payment%20Request')
    && link.includes('&body=Hi%2C%0D%0A%0D%0ALine%20%26%20more'), link);
}

// ── payment requests already sent (the mail pull, 0153) ─────────────
{
  const ours = paymentRequestOf('Payment Request - EE Mercantile (Delilah Miami UPS Shipping) INV-2026-236646 & INV-2026-528010 - $1,219.48');
  const ap = paymentRequestOf("RE:Payment Request - EE Mercantile (Delilah LA Glassware & Flatware) INV-2026-086418 - $2,397.33 'Query No=005-485-081'");
  check('a payment request subject: its invoices; AP\'s reply: + the query number', ours?.invoices.join() === 'INV-2026-236646,INV-2026-528010' && ours.queryNo === null
    && ap?.invoices.join() === 'INV-2026-086418' && ap.queryNo === '005-485-081');
  check('not a payment request (or none named): nothing', paymentRequestOf('New payment request from ARC - invoice 1684871') === null && paymentRequestOf('Re: Delilah Matches') === null);
  const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn) {
    check('pull: payment requests from the team or AP mark their invoices\' lines (first one wins, query # kept), morning and backfill',
      /if \(!isOwnSender\(addr, OWN_DOMAINS\) && !onList\(domainOf\(addr\), \['iqbackoffice\.com'\]\)\) continue;/.test(fn) && /update\(\{ pay_requested_at: at, ap_query_no: q \}\)/.test(fn)
      && (fn.match(/await payRequestPhase\(sb, tok\.access_token, sinceMs, stats\)/g) ?? []).length === 1 && /stats\.pay_requests_error = msg\(e\)/.test(fn));
    check('pull: payment requests are looked for 90 days back every morning (sent before this step, or by someone else)',
      /const PAY_LOOKBACK_DAYS = 90;/.test(fn) && /Math\.min\(sinceMs \|\| Date\.now\(\), Date\.now\(\) - PAY_LOOKBACK_DAYS \* 86_400_000\)/.test(fn));
    check('pull: a batch request is read from its body; the stub step counts our own internal senders too',
      /paymentRequestOf\(m\.subject, m\.uniqueBody\?\.content\)/.test(fn) && /!isOwnSender\(m\.from\?\.emailAddress\?\.address, OWN_DOMAINS\)\) continue;/.test(fn));
    check('pull: every vendor e-mail it sees moves its order\'s last_vendor_email_at forward only',
      /lastMail\.set\(about\.id, m\.receivedDateTime\)/.test(fn) && /\.or\(`last_vendor_email_at\.is\.null,last_vendor_email_at\.lt\.\$\{at\}`\)/.test(fn));
  }
  const sql = sibling('supabase', 'migrations', '0153_kount_ot_followups.sql');
  if (sql) check('0153: who / which day stamped by the database; Undo only your own, same day; Order tracker permission',
    /new\.by_email := coalesce\(nullif\(auth\.jwt\(\) ->> 'email', ''\), current_user\)/.test(sql) && /by_email = \(auth\.jwt\(\) ->> 'email'\)\s+and sent_on = /.test(sql)
    && (sql.match(/kount_has_feature\('purchasing:order-tracker'\)/g) ?? []).length === 3);
}

// ── 11/10 fixes, found on the live mailbox before going live ─────────
{
  // Hursh's 10/15 batch named its five invoices only in the body
  const batch = paymentRequestOf('Payment Request - EE Mercantile (Delilah & TNG Delivery/Warehousing Fees) 5 Invoices - $1,183.11',
    'Hi, Please find the attached five invoices ... INV-2026-111111, INV-2026-222222 and INV-2026-333333 ...');
  check('a batch request with no invoice in its subject: the invoices in its body', batch?.invoices.join() === 'INV-2026-111111,INV-2026-222222,INV-2026-333333', batch);
  check('the subject\'s invoices win over the body\'s; a vendor\'s "New payment request" names none -> nothing',
    paymentRequestOf('Payment Request - X INV-2026-444444 - $1', 'INV-2026-555555')?.invoices.join() === 'INV-2026-444444'
    && paymentRequestOf('New payment request from ARC - invoice 1684871', 'BALANCE DUE $1,175.31') === null);

  // Aditya's own 10/27 request came back from Outlook as "/O=EXCHANGELABS/..." instead of his address
  const x500 = '/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=2719AC90301245CD881B04D682023D3C-F16D6809-6C';
  check('our own sender: our domain, or Exchange\'s internal form of our mailboxes; never a vendor',
    isOwnSender('apurandare@hwoodgroup.com') && isOwnSender(x500) && !isOwnSender('aleli@eemercantile.co') && !isOwnSender('') && !isOwnSender(null));
  const msg = (from: string, name: string): MailMessage => ({ id: 'm1', sentDateTime: '2026-11-05T18:00:00Z', isDraft: false,
    from: { emailAddress: { address: from, name } }, toRecipients: [{ emailAddress: { address: 'aleli@eemercantile.co' } }],
    uniqueBody: { content: 'Hi Aleli,' + String.fromCharCode(10) + 'Approved, please go ahead with the order.' } });
  const a = findApproval([msg(x500, 'Aditya Purandare')], Date.parse('2026-11-01T00:00:00Z'));
  check('an approval sent from Outlook with the internal sender form is found, by name', !!a && a.by === 'aditya purandare', a);
  check('a vendor saying "approved" is still not our approval', findApproval([msg('aleli@eemercantile.co', 'Aleli')], 0) === null);
}

// ── where it shows ──────────────────────────────────────────────────
{
  const view = readFileSync(join(process.cwd(), 'src/components/orderTracker/ToSend.tsx'), 'utf8');
  check('To send: Compose opens the e-mail and logs it; payment requests download the invoice to attach',
    /window\.location\.href = mailtoLink\(/.test(view) && /logFollowup\(/.test(view) && /window\.open\(await documentUrl\(path\)/.test(view) && /onPdf\(d\.storage_path!\)/.test(view));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
