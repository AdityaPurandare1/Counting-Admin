/* Order tracker — what to send (v1.04, migration 0153).

   Each morning, after the 9 o'clock pull, the tracker lists two kinds of e-mail for a person to send:

   • FOLLOW-UPS — an open order with no update for FOLLOW_AFTER business days (a status move, a document,
     tracking, a delivery-sheet row or any e-mail from the vendor in its thread all count). What it asks
     depends on where the order is: not confirmed -> confirm + quote; paid, not shipped -> production + ETA;
     past its ETA -> new ETA + tracking. Where the next step is ours (a quote to approve, an invoice to pay,
     a request not ordered yet) it reminds the person instead of e-mailing the vendor. After MAX_TRIES
     follow-ups with no reply it stops chasing and says so.
   • PAYMENT REQUESTS — an invoice with no payment request yet, written the way the team writes them to AP
     (Hursh's "Payment Request - EE Mercantile (Delilah LA Glassware & Flatware) INV-2026-086418 - $2,397.33").

   Compose opens a filled-in e-mail (mailto) to check and send; payment requests take the invoice PDF along by
   hand until IT grants the mailbox write permission, when the same list becomes real Outlook drafts (a reply in
   the vendor's thread / a forward of the vendor's invoice e-mail, PDF attached). Pure: the data comes in. */

import { headlineStatus, isoDay, normText, statusRank, type OtDocument, type OtLine, type OtOrder, type OtTracking } from './orderTracker';

export const FOLLOW_AFTER = 3;      // business days with no update
export const MAX_TRIES = 2;         // follow-ups to a vendor with no reply, then a note to the person instead

export const AP_TO = 'hwoodap@iqbackoffice.com';
/** who payment requests copy (the user, 11/16: "cc - Cara connor, ahmed, porfirio and stephanie"); the person
 *  composing is left out */
export const AP_CC = ['cconnor@hwoodgroup.com', 'aameziane@hwoodgroup.com', 'pcaamal@hwoodgroup.com', 'spineda@hwoodgroup.com'];
const APPROVER = 'aameziane@hwoodgroup.com';

/** a logged follow-up / payment request (kount_ot_followups) */
export interface OtFollowup { id: string; order_id: string; kind: 'vendor' | 'payment' | 'self'; sent_on: string; by_email: string | null; invoice_numbers: string[] | null; note: string | null; created_at: string }
/** what the Inbox knows about an order's e-mails: who wrote, the subject */
export interface OrderMail { order_id: string | null; sender_email: string | null; sender_name: string | null; subject: string | null; received_at: string | null }

export type FollowKind = 'confirm' | 'eta' | 'late' | 'delivery' | 'order-it' | 'approve' | 'pay' | 'no-reply';
export interface FollowUp {
  order: OtOrder; kind: FollowKind; to: 'vendor' | 'self'; lines: OtLine[];
  /** business days since the last update, and that update's day */
  idle: number; since: string;
  /** follow-ups already sent since that update */
  tries: number;
  email: Email | null;
  /** one line for the list */
  what: string;
}
export interface Email { to: string[]; cc: string[]; subject: string; body: string }
export interface PayRequest {
  order: OtOrder; venue: string; invoices: string[]; lines: OtLine[];
  /** v1.21 where the e-mail's details come from: the invoice PDF as read when it was filed, or (no PDF / not read)
   *  the order's lines - then the person checks it */
  source: 'invoice' | 'order';
  subtotal: number; tax: number; total: number; invoiceDate: string | null;
  /** the invoice PDFs on the order (download to attach) */
  docs: OtDocument[];
  email: Email;
}

const DONE: OtLine['status'][] = ['DELIVERED', 'RECEIVED', 'CANCELLED'];
const money = (x: number) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (day: string) => { const [, m, d] = day.split('-'); return `${Number(m)}/${Number(d)}`; };

/** Weekdays after `from` up to and including `to` (both 'YYYY-MM-DD'): Friday -> Wednesday = 3. */
export function businessDaysBetween(from: string, to: string): number {
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`), end = new Date(`${to}T12:00:00Z`);
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/** The day of an ISO time in Los Angeles. */
const laDay = (iso: string) => isoDay(new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })));

/** The last time anything happened on an order: its lines and the order itself, a document, tracking, a
 *  vendor e-mail in its thread (0153), a follow-up sent. */
export function lastActivity(o: OtOrder & { last_vendor_email_at?: string | null }, ls: OtLine[], docs: OtDocument[], tracking: OtTracking[], sent: OtFollowup[]): string {
  return [o.created_at, o.updated_at, o.last_vendor_email_at ?? '', ...ls.flatMap(l => [l.status_at, l.updated_at ?? '']),
    ...docs.map(d => d.created_at), ...tracking.map(t => (t as OtTracking & { created_at?: string }).created_at ?? ''),
    ...sent.map(f => f.created_at)].filter(Boolean).sort().slice(-1)[0];
}

/** Who to write to about an order: the vendor's latest e-mail on it (the Inbox), else E&E's buyer for its kind. */
export function vendorContact(o: OtOrder, mails: OrderMail[]): { email: string; name: string | null; subject: string | null } | null {
  const own = /@hwoodgroup\.com$/i;
  const m = mails.filter(x => x.order_id === o.id && x.sender_email && !own.test(x.sender_email))
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))[0];
  if (m) return { email: m.sender_email!.toLowerCase(), name: m.sender_name, subject: m.subject };
  if (/e\s*&?\s*e\s*mercantile/i.test(o.vendor_name)) {
    // custom / branded orders go through Jemma, operating supplies through Aleli (the threads of Sept-Nov)
    return /^CUS-/i.test(o.order_number ?? '') ? { email: 'jemma@eemercantile.co', name: 'Jemma', subject: null } : { email: 'aleli@eemercantile.co', name: 'Aleli', subject: null };
  }
  return null;
}

const firstName = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const refsOf = (ls: OtLine[]) => [...new Set(ls.flatMap(l => [l.invoice_number, l.quote_number]).filter((x): x is string => !!x))];
const lineList = (ls: OtLine[]) => ls.map(l => `- ${l.description}${l.qty ? ` — ${l.qty}${l.unit ? ' ' + l.unit : ''}` : ''}${l.expected_on ? ` (ETA ${shortDate(l.expected_on)})` : ''}`).join('\n');

/** Every open order that has gone quiet, oldest first, with what to send. */
export function followupsDue(data: { orders: OtOrder[]; lines: OtLine[]; documents: OtDocument[]; tracking: OtTracking[]; followups: OtFollowup[] },
                             mails: OrderMail[], today: string, venueName: (id: string | null) => string, me = ''): FollowUp[] {
  const out: FollowUp[] = [];
  for (const o of data.orders) {
    if (o.archived_at || o.completed_at) continue;
    const ls = data.lines.filter(l => l.order_id === o.id);
    const open = ls.filter(l => !DONE.includes(l.status));
    if (!open.length) continue;
    const docs = data.documents.filter(d => d.order_id === o.id);
    const sent = data.followups.filter(f => f.order_id === o.id);
    // what counts as the last update leaves out our own follow-ups; they are counted as tries instead
    const lastReal = lastActivity(o, ls, docs, data.tracking.filter(t => t.order_id === o.id), []);
    const since = laDay(lastReal);
    const triesSince = sent.filter(f => f.kind === 'vendor' && f.created_at > lastReal);
    const lastTry = triesSince.map(f => f.sent_on).sort().slice(-1)[0];
    const idle = businessDaysBetween(lastTry ?? since, today);
    if (idle < FOLLOW_AFTER) continue;
    if (sent.some(f => f.kind === 'self' && f.sent_on === today)) continue;

    const stage = headlineStatus(open)!;
    const late = open.filter(l => (l.expected_on ?? o.expected_on ?? '') !== '' && (l.expected_on ?? o.expected_on)! < today && statusRank(l.status) < statusRank('DELIVERED'));
    // invoices with no payment request yet (0153; v1.20: our own e-mail of it to AP / GA counts, set by the pull)
    const unpaid = open.filter(l => l.status === 'INVOICED' && !l.pay_requested_at);
    let kind: FollowKind, to: 'vendor' | 'self', what: string;
    if (stage === 'REQUESTED') { kind = 'order-it'; to = 'self'; what = 'Requested, not ordered yet'; }
    else if (stage === 'QUOTED') { kind = 'approve'; to = 'self'; what = 'Quote waiting for approval — approve it and ask for the invoice'; }
    else if (stage === 'INVOICED' && unpaid.length) { kind = 'pay'; to = 'self'; what = 'Invoice not paid yet — send the payment request'; }
    else if (late.length) { kind = 'late'; to = 'vendor'; what = `${late.length} line${late.length > 1 ? 's' : ''} past ETA — ask for a new ETA`; }
    // v1.20 (review): every invoice is with accounting — waiting on the payment, nothing to chase (it used to fall
    // through to "Paid, not shipped" and an e-mail to the vendor)
    else if (stage === 'INVOICED') continue;
    else if (stage === 'ORDERED') { kind = 'confirm'; to = 'vendor'; what = 'Not confirmed — ask for the confirmation / quote'; }
    else if (stage === 'SHIPPED') { kind = 'delivery'; to = 'vendor'; what = 'Shipped, not delivered — confirm delivery'; }
    else { kind = 'eta'; to = 'vendor'; what = 'Paid, not shipped — ask for production status + ETA'; }
    if (to === 'vendor' && triesSince.length >= MAX_TRIES) { kind = 'no-reply'; to = 'self'; what = `No reply to ${triesSince.length} follow-ups — call or escalate`; }

    const contact = to === 'vendor' ? vendorContact(o, mails) : null;
    const asked = kind === 'late' ? late : open;
    let email: Email | null = null;
    if (to === 'vendor' && contact) {
      const refs = refsOf(asked);
      const what2 = `${o.order_number ?? 'our order'}${refs.length ? ` (${refs.join(', ')})` : ''} for ${venueName(o.venue_id)}`;
      const ask = kind === 'late' ? 'These were due by now — could you share an updated ETA and tracking once they ship?'
        : kind === 'confirm' ? 'Could you confirm the order and send over the quote / invoice?'
        : kind === 'delivery' ? 'Could you confirm when these are expected to be delivered (and tracking if you have it)?'
        : 'Could you share the production status and an ETA?';
      email = {
        to: [contact.email], cc: [],
        subject: contact.subject ? (/^re:/i.test(contact.subject) ? contact.subject : `Re: ${contact.subject}`) : `${o.order_number ?? 'Order'} – ${venueName(o.venue_id)} – update?`,
        body: `Hi ${firstName(contact.name)},\n\nFollowing up on ${what2}. ${ask}\n\n${lineList(asked)}\n\nThank you,`,
      };
      if (me) email.cc = email.cc.filter(c => c !== me);
    }
    out.push({ order: o, kind, to, lines: asked, idle, since, tries: triesSince.length, email, what: to === 'vendor' && !contact ? `${what} (no vendor e-mail on file)` : what });
  }
  return out.sort((a, b) => b.idle - a.idle);
}

/* ── payment requests ─────────────────────────────────────────────────── */

const WORDS: Array<[RegExp, string]> = [
  [/\bglass|goblet|coupe|tumbler|flute|nick\s*&?\s*nora|highball|collins/i, 'Glassware'],
  [/\bfork|knife|knives|spoon|flatware/i, 'Flatware'],
  [/\bplate|bowl|platter|saucer|cup\b|mug/i, 'Plateware'],
  [/\bmatch/i, 'Matches'], [/\bnapkin|linen|towel/i, 'Linens'], [/\bcoaster|doil/i, 'Coasters'],
  [/\bbag|box|tote|liner|wrap|container/i, 'Packaging'], [/\bmint/i, 'Mints'], [/\bpick|stir|straw/i, 'Bar Supplies'],
  [/\bwarehous|delivery\b/i, 'Delivery Fees'], [/\bshipping|freight|ups\b|fedex/i, 'Shipping Fee'],
];
/** a line that is only a fee: "Shipping fee for Lady Delilah custom bags", "Delivery - ...", "UPS shipping" */
const FEE_LINE = /^\s*(?:shipping|freight|delivery|warehous|ups\b|fedex)|\b(?:shipping|freight|delivery)\s+(?:fee|charge)/i;
/** "Glassware & Flatware" from what the lines are (the words the team uses in the subject); at most two. An invoice
 *  of fees only is named for the fee (v1.21, the user's "Lady Delilah Bag Shipping Fee"), not for what it shipped. */
export function payCategory(ls: Pick<OtLine, 'description'>[]): string {
  const feesOnly = ls.length > 0 && ls.every(l => FEE_LINE.test(l.description));
  const hit = WORDS.filter(([re, w]) => (!feesOnly || w === 'Delivery Fees' || w === 'Shipping Fee') && ls.some(l => re.test(l.description))).map(([, w]) => w);
  return [...new Set(hit)].slice(0, 2).join(' & ') || 'Order';
}

/** Invoices with no payment request yet (none found in the mailbox — v1.20: our own e-mail of it to AP / GA is one —
 *  none composed here), one request per order
 *  and venue, written as the team writes them. Amount = the invoice PDF's total (tax and shipping as billed);
 *  without the PDF, the lines' total before tax (said so). */
export function paymentRequestsDue(data: { orders: OtOrder[]; lines: OtLine[]; documents: OtDocument[]; followups: OtFollowup[] },
                                   venueName: (id: string | null) => string, me = ''): PayRequest[] {
  const composed = new Set(data.followups.filter(f => f.kind === 'payment').flatMap(f => (f.invoice_numbers ?? []).map(normText)));
  const out: PayRequest[] = [];
  for (const o of data.orders) {
    if (o.archived_at) continue;
    const waiting = data.lines.filter(l => l.order_id === o.id && l.status === 'INVOICED' && l.invoice_number
      && !l.pay_requested_at && !composed.has(normText(l.invoice_number)));
    if (!waiting.length) continue;
    const byVenue = new Map<string, OtLine[]>();
    for (const l of waiting) { const v = l.venue_id ?? o.venue_id ?? ''; (byVenue.get(v) ?? byVenue.set(v, []).get(v)!).push(l); }
    for (const [venueId, ls] of byVenue) {
      const invoices = [...new Set(ls.map(l => l.invoice_number!))].sort();
      const docs = data.documents.filter(d => d.kind === 'invoice' && d.order_id === o.id && invoices.some(i => normText(i) === normText(d.doc_number)));
      const linesTotal = ls.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
      const parsedOf = (d: OtDocument) => (d as OtDocument & { parsed?: { subtotal?: number; total?: number } | null }).parsed ?? null;
      const allPdfs = invoices.every(i => docs.some(d => normText(d.doc_number) === normText(i)));
      // v1.21 the user: "the details mentioned in the email comes from the invoice" - what the invoice PDF says, as read
      // when it was filed (its items, total, shipping, tax, terms). Not for an invoice the order splits over several
      // venues (its lines are not all this venue's), nor without the PDF or its reading: then the order's lines, said so.
      const read = allPdfs && byVenue.size === 1 ? readInvoices(docs) : null;
      const total = read ? read.total : allPdfs ? docs.reduce((s, d) => s + (Number(d.total ?? parsedOf(d)?.total) || 0), 0) : linesTotal;
      const subtotal = read ? read.product : allPdfs ? docs.reduce((s, d) => s + (Number(parsedOf(d)?.subtotal) || Number(d.total) || 0), 0) : linesTotal;
      const tax = read ? read.tax : Math.max(0, Math.round((total - subtotal) * 100) / 100);
      const venue = venueId ? venueName(venueId) : read?.billTo || venueName(null);
      const ee = /e\s*&?\s*e\s*mercantile/i.test(o.vendor_name);
      const vendor = ee ? 'EE Mercantile' : o.vendor_name;
      const date = docs.map(d => d.doc_date).filter((x): x is string => !!x).sort()[0] ?? null;
      // a fee-only invoice (shipping, delivery) is named for the fee; otherwise for the goods on it
      const feeOnly = read ? read.product <= 0 && (read.freight > 0 || read.fee > 0) : false;
      const cat = read ? (feeOnly ? (read.freight > 0 ? 'Shipping Fee' : 'Fees') : payCategory(read.products.map(l => ({ description: String(l.description ?? '') }))))
        : payCategory(ls);
      const items = read ? invoiceItems(feeOnly ? read.others : read.products, !feeOnly)
        : ls.map(l => `${l.description}${l.sku ? ` (${l.sku}, qty ${l.qty}${l.unit ? ' ' + l.unit : ''})` : l.qty ? ` (qty ${l.qty}${l.unit ? ' ' + l.unit : ''})` : ''}`).join(', ');
      const two = invoices.length > 1;
      // no PDF and no prices: the amount is not known, so it is left for the person (never a $0.00 request, 11/10)
      const known = total > 0;
      const fee = read ? feeOnly : /shipping|delivery/i.test(cat) && !/&/.test(cat);
      const amount = !known ? 'not known (no invoice PDF or prices in the tracker): fill it in from the invoice'
        : read ? invoiceAmount(read)
        : !allPdfs ? `${money(total)} before tax (the invoice PDF is not in the tracker — check the amount)`
        : tax > 0 && subtotal > 0 ? `${money(total)} (incl. ${(Math.round(tax / subtotal * 10000) / 100).toFixed(2)}% tax of ${money(tax)})`
        : `${money(total)} (${fee ? `${cat.toLowerCase().replace(/s$/, '')} only; ` : ''}no tax)`;
      out.push({
        order: o, venue, invoices, lines: ls, source: read ? 'invoice' : 'order', subtotal, tax, total, invoiceDate: date, docs,
        email: {
          to: [AP_TO], cc: AP_CC.filter(c => c !== me),
          // v1.21 the user's example (Hursh's 11/16 "Payment Request – EE Mercantile (Lady Delilah Bag Shipping Fee)
          // INV-2026-522228 – $3,233.00"): en dashes, the vendor's legal name, no invoice-date line; the sign-off is
          // the person's Outlook signature
          subject: `Payment Request ${DASH} ${vendor} (${venue} ${cat}) ${invoices.join(' & ')} ${DASH} ${known ? money(total) : '$____'}`,
          body: `Hi,\n\nPlease find the attached ${two ? `${invoices.length} invoices` : 'invoice'} from ${vendor} for the ${fee ? `${cat.toLowerCase()} on the ${venue} order` : `${cat.toLowerCase()} ordered for ${venue}`}. `
            + `Kindly confirm once the ${two ? 'invoices have' : 'invoice has'} been processed so I can coordinate with the supplier and arrange delivery.\n\n`
            + `Invoice #: ${invoices.join(', ')}\nVendor: ${ee ? 'EE Mercantile LLC' : o.vendor_name}\nAmount: ${amount}\nVenue: ${venue}\nItem: ${items}\n`
            + `Terms: ${read?.terms || 'Due on Receipt'}`
            + `${AP_CC.includes(APPROVER) && me !== APPROVER ? "\n\nI've also included Ahmed for approval, if needed." : ''}`,
        },
      });
    }
  }
  return out;
}

const DASH = '–';

/** v1.21 one line of an invoice as the reader saw it (kount_ot_documents.parsed.lines) */
interface ReadLine { line_kind?: string; description?: string; sku?: string; qty?: number; unit?: string; line_total?: number }
export interface InvoiceRead {
  total: number; product: number; freight: number; tax: number; fee: number;
  /** "7.25%" when the tax lines print one rate */
  taxRate: string | null;
  products: ReadLine[]; others: ReadLine[];
  terms: string | null; billTo: string | null;
}
const r2 = (x: number) => Math.round(x * 100) / 100;
/** What the invoice PDFs say, from their reading (null when one has no reading of its lines): the total as printed,
 *  the product / freight / tax / fee amounts from its lines, the tax rate printed on the tax line, the terms. */
export function readInvoices(docs: ReadonlyArray<OtDocument>): InvoiceRead | null {
  type Parsed = { total?: number; terms?: string; bill_to?: string; lines?: ReadLine[] };
  const ps = docs.map(d => (d as OtDocument & { parsed?: Parsed | null }).parsed ?? null);
  if (!ps.length || ps.some(p => !p || !Array.isArray(p.lines) || !p.lines.length)) return null;
  const lines = ps.flatMap(p => p!.lines!);
  const kind = (l: ReadLine) => l.line_kind || 'product';
  const sum = (k: string) => r2(lines.filter(l => kind(l) === k).reduce((s, l) => s + (Number(l.line_total) || 0), 0));
  const product = sum('product'), freight = sum('freight'), tax = sum('tax'), fee = sum('fee'), discount = sum('discount');
  const printed = r2(ps.reduce((s, p) => s + (Number(p!.total) || 0), 0));
  const rates = [...new Set(lines.filter(l => kind(l) === 'tax').map(l => /([0-9]+(?:[.][0-9]+)?)\s*%/.exec(l.description ?? '')?.[1]).filter((x): x is string => !!x))];
  const terms = [...new Set(ps.map(p => String(p!.terms ?? '').trim()).filter(Boolean))];
  const named = (l: ReadLine) => String(l.description ?? '').trim() !== '';
  return {
    total: printed || r2(product + freight + tax + fee - Math.abs(discount)), product, freight, tax, fee,
    taxRate: rates.length === 1 ? `${rates[0]}%` : null,
    products: lines.filter(l => kind(l) === 'product' && named(l)), others: lines.filter(l => (kind(l) === 'freight' || kind(l) === 'fee') && named(l)),
    terms: terms.length ? terms.join(' / ') : null, billTo: ps.map(p => String(p!.bill_to ?? '').trim()).find(Boolean) ?? null,
  };
}

/** "Libbey Collins 10.5 oz (2510, qty 6 cs), ..." from the invoice's lines; the first 6, then "and N more". */
export function invoiceItems(ls: ReadonlyArray<ReadLine>, withQty = true): string {
  const one = (l: ReadLine) => {
    const q = withQty && Number(l.qty) ? `qty ${Number(l.qty)}${l.unit ? ' ' + l.unit : ''}` : '';
    const inner = [withQty ? String(l.sku ?? '').trim() : '', q].filter(Boolean).join(', ');
    return `${String(l.description ?? '').trim()}${inner ? ` (${inner})` : ''}`;
  };
  const shown = ls.slice(0, 6).map(one);
  return shown.join(', ') + (ls.length > 6 ? `, and ${ls.length - 6} more` : '');
}

/** "$702.42 (incl. $48.86 shipping and 7.00% tax of $42.76)", "$319.68 (shipping fee only; no tax)". */
export function invoiceAmount(r: InvoiceRead): string {
  const feeOnly = r.product <= 0 && (r.freight > 0 || r.fee > 0);
  const taxPart = r.tax > 0 ? `${r.taxRate ? r.taxRate + ' ' : ''}tax of ${money(r.tax)}` : '';
  if (feeOnly) return `${money(r.total)} (${r.freight > 0 ? 'shipping fee' : 'fees'} only; ${taxPart ? `incl. ${taxPart}` : 'no tax'})`;
  const parts = [r.freight > 0 ? `${money(r.freight)} shipping` : '', r.fee > 0 ? `${money(r.fee)} fees` : '', taxPart].filter(Boolean);
  return `${money(r.total)} (${parts.length ? `incl. ${parts.join(' and ')}` : 'no tax'})`;
}

/** v1.21 a new e-mail in Outlook on the web, filled in (to, cc, subject, message): where Draft in Outlook falls back
 *  to when it can't make the draft itself. Attachments can't ride along; the PDFs are downloaded beside it. */
export function outlookComposeLink(e: Email): string {
  const q = [`to=${encodeURIComponent(e.to.join(';'))}`, e.cc.length ? `cc=${encodeURIComponent(e.cc.join(';'))}` : '',
    `subject=${encodeURIComponent(e.subject)}`, `body=${encodeURIComponent(e.body)}`].filter(Boolean).join('&');
  return `https://outlook.office.com/mail/deeplink/compose?${q}`;
}

/** What a draft made by the app ends with (Outlook adds no signature to it): "Thank you," and the name. */
export function signedBody(body: string, name: string | null | undefined): string {
  return `${body}\n\nThank you,${name?.trim() ? `\n${name.trim()}` : ''}`;
}

/** A filled-in e-mail to open in Outlook (plain text; the signature is Outlook's). */
export function mailtoLink(e: Email): string {
  const q = [e.cc.length ? `cc=${encodeURIComponent(e.cc.join(','))}` : '', `subject=${encodeURIComponent(e.subject)}`, `body=${encodeURIComponent(e.body.replace(/\n/g, '\r\n'))}`].filter(Boolean).join('&');
  return `mailto:${e.to.map(encodeURIComponent).join(',')}?${q}`;
}
