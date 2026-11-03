/* ───────────────────────────────────────────────────────────────────────
   Ask AI over the order tracker and the venue bibles (v0.93).

   The assistant cannot query the database itself (the ask-ai function sends
   text only), so before each question the admin picks what is relevant and
   sends it as text: the purchasing overview always; the orders the question
   names (order / invoice / quote / tracking #, vendor, venue, item words) in
   full; topic lists when it asks about late, unpaid, check stubs, the
   warehouse or the Inbox; the matching rows of the venues' bibles (their
   text copy, 0145); and, in what room is left, a one-line index of every
   order. Pure, so it is tested; everything stays under the budget.
   ─────────────────────────────────────────────────────────────────────── */
import {
  MULTIPLE_VENUES, headlineStatus, isLate, lineTotal, orderState, orderVenueIds, receivedForLine, stockRows,
  type OtDocument, type OtItem, type OtLine, type OtMove, type OtOrder, type OtTracking,
} from './orderTracker';
import { fulfillmentOf, nextEta, paymentOf, stubsToGet, trackerKpis } from './orderTrackerView';
import type { BibleIndex } from './bibleRender';
import { SENT_SOURCE, leadForItem, leadText, median, orderTiming, productLeadIndex, spanText, timingText, vendorLeadTimes } from './leadTime';

export interface AskOrdersData { orders: OtOrder[]; lines: OtLine[]; items: OtItem[]; moves: OtMove[]; documents: OtDocument[]; tracking: OtTracking[] }
export interface AskBible { venue_id: string; title: string; text_index: BibleIndex | null }

export const ORDERS_CONTEXT_BUDGET = 17_000;
/** The ask-ai function's cap on the whole system prompt (it is shared with the phone, so the admin fits in it). */
export const ASK_AI_SYSTEM_CAP = 8000;
const VARIANCE_WORDS = /\b(variance|shortage|shortages|overage|overages|shrink|loss|count|counted|counts|theo|expected|cost|costs|unit cost|par)\b/i;
/** Whether a question is about the venue's variance (then its report goes along; otherwise the room goes to orders). */
export const asksVariance = (question: string) => VARIANCE_WORDS.test(question);
/** The orders text's room: the cap less what else goes in the system prompt, and a margin. */
export const ordersBudget = (otherSystemChars: number) => Math.max(0, ASK_AI_SYSTEM_CAP - otherSystemChars - 40);
const money = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STOP = new Set(('the and for with what which who whom where when why how are was were is be been has have had our our their this that these those '
  + 'from into about any all can could would should will did does do not order orders status statuses detail details tell show give list me us you '
  + 'there here please item items line lines bible bibles venue venues much many get got').split(' '));

/** Text as its words with a space before each, so a word is found from its start ("glass" finds
 *  "glassware", "red" does not find "ordered"). */
export const wordText = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9&]+/g, ' ')}`;
const hasWord = (text: string, w: string) => text.includes(` ${w}`);

/** A product link as its site ("webstaurantstore.com link"), so a bible row's later columns (status, tracking) fit. */
export const shortUrl = (v: string) => v.replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/gi, '$1 link');

/** The question's codes (order / invoice / quote / tracking #) and its words worth searching for. */
export function questionTerms(text: string): { codes: string[]; words: string[] } {
  const codes = [...text.matchAll(/\b(INV-\d{4}-\d{5,7}|Q-\d{4}-\d{4}-\d{4}|(?:CUS|OSE|OPN|WHS)-\d{4}(?:-[A-Z]{2,4})?|1Z[0-9A-Z]{16}|\d{10,22})\b/gi)].map(m => m[1].toUpperCase());
  const words = [...new Set(text.toLowerCase().replace(/[^a-z0-9&\s-]/g, ' ').split(/\s+/)
    .map(w => w.replace(/^-+|-+$/g, '')).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d{1,3}$/.test(w)))];
  return { codes: [...new Set(codes)], words };
}

/** One line per order, for counting and finding. */
export function orderIndexLine(o: OtOrder, ls: OtLine[], venueName: (id: string | null) => string, today: string): string {
  const live = ls.filter(l => l.status !== 'CANCELLED');
  const venues = o.venue_id === MULTIPLE_VENUES ? orderVenueIds(o, ls).map(venueName).join(' + ') : venueName(o.venue_id);
  const pay = paymentOf(ls, today);
  const eta = nextEta(o, ls);
  return [`${o.order_number ?? '(no #)'}`, o.vendor_name, venues, fulfillmentOf(headlineStatus(ls)) ?? 'no lines', pay.label,
    money(live.reduce((s, l) => s + lineTotal(l), 0)), `${live.length} line${live.length === 1 ? '' : 's'}`, eta ? `next ETA ${eta}` : '',
    pay.invoices.length ? `inv ${pay.invoices.slice(0, 3).join(', ')}${pay.invoices.length > 3 ? ` +${pay.invoices.length - 3}` : ''}` : '',
    orderState(o, ls) !== 'open' ? orderState(o, ls) : ''].filter(Boolean).join(' · ');
}

// the last status change's note (loaded with every line, not part of OtLine)
const note = (l: OtLine) => String((l as OtLine & { status_note?: string | null }).status_note ?? '');

/** Everything about one order: its lines (status, invoice, payment, tracking, ETA), documents, tracking, notes. */
export function orderDetail(o: OtOrder, ls: OtLine[], docs: OtDocument[], tracking: OtTracking[], moves: OtMove[], venueName: (id: string | null) => string, today: string): string {
  const out = [`ORDER ${orderIndexLine(o, ls, venueName, today)}`];
  const t = orderTiming(o, ls, today);
  out.push(`  ordered ${o.ordered_on ?? '?'} · delivers to the ${o.deliver_to}${o.expected_on ? ` · expected ${o.expected_on}` : ''}`
    + (t.sentOn ? ` · sent to the vendor ${t.sentOn} (${SENT_SOURCE[o.sent_source ?? ''] ?? 'source not known'}) · ${timingText(t)}` : ' · sent day not known'));
  for (const l of [...ls].sort((a, b) => a.sort - b.sort)) {
    const late = isLate(l, o, today, receivedForLine(moves, l.id));
    const paid = (l.r365_payments ?? []).map(p => `${p.number} on ${p.date}`).join(', ');
    out.push(`  - ${o.venue_id === MULTIPLE_VENUES && l.venue_id ? `[${venueName(l.venue_id)}] ` : ''}${l.description.slice(0, 90)} | ${l.qty} ${l.unit ?? ''} @ ${l.unit_price != null ? money(l.unit_price) : '?'} = ${money(lineTotal(l))}`
      + ` | ${l.status}${late ? ' (LATE)' : ''}` + (l.invoice_number ? ` | ${l.invoice_number}${l.invoice_date ? ` (${l.invoice_date})` : ''}` : '')
      + (paid ? ` | paid in R365 ${paid}` : '') + (l.tracking_number ? ` | tracking ${l.tracking_number.slice(0, 60)}` : '')
      + (l.expected_on ? ` | ETA ${l.expected_on}` : '') + (note(l) ? ` | note: ${note(l).slice(0, 80)}` : ''));
  }
  if (tracking.length) out.push(`  tracking: ${tracking.map(t => `${t.carrier ?? ''} ${t.tracking_number}`.trim()).join(', ')}`);
  if (docs.length) out.push(`  documents: ${docs.map(d => `${d.kind}${d.doc_number ? ` ${d.doc_number}` : ''}${d.kind === 'other' ? ` ${d.file_name}` : ''}`).join(', ')}`);
  if (o.notes) out.push(`  notes: ${o.notes.slice(0, 200)}`);
  return out.join('\n');
}

const TOPIC = {
  late: /\b(late|overdue|behind|delay|delayed|eta|arriv|deliver)/i,
  unpaid: /\b(unpaid|not paid|owe|outstanding|payment|pay|paid|invoice)/i,
  stubs: /\b(stub|stubs|remittance|check|cheque|proof)/i,
  stock: /\b(warehouse|stock|on hand|reorder|storage|e&e|draw|release|corporate|inventory|how many cases)/i,
  inbox: /\b(inbox|waiting|review|unread)/i,
  lead: /\b(lead ?times?|how long|takes?|took|turnaround|weeks?|months?|sent|since)\b/i,
};

export interface OrdersContextInput {
  question: string; data: AskOrdersData; bibles: AskBible[]; venues: Array<{ id: string; name: string }>; today: string; inboxWaiting: number; budget?: number;
}

/** The text sent with the question (see the file header for what goes in, in which order). */
export function buildOrdersContext(p: OrdersContextInput): string {
  const budget = p.budget ?? ORDERS_CONTEXT_BUDGET;
  const venueName = (id: string | null) => (!id ? 'Warehouse stock' : p.venues.find(v => v.id === id)?.name ?? id.replace(/^x:/, ''));
  const { data, today } = p;
  const lm = new Map<string, OtLine[]>();
  for (const l of data.lines) (lm.get(l.order_id) ?? lm.set(l.order_id, []).get(l.order_id)!).push(l);
  const live = data.orders.filter(o => !o.archived_at);
  const terms = questionTerms(p.question);
  const out: string[] = [];
  const room = () => budget - out.join('\n').length;
  const add = (lines: string[]) => { for (const l of lines) { if (l.length + 1 > room()) return false; out.push(l); } return true; };

  // 1. the overview
  const k = trackerKpis(data, today);
  const stubs = stubsToGet(data.orders, data.lines, data.documents);
  add([
    `PURCHASING — the order tracker, as of ${today}. Each order has lines; a line moves Requested → Ordered → Quoted → Invoiced → Paid → Shipped → Delivered → Received.`,
    'A line is LATE when its ETA (its own, else the order\'s) has passed and it is not marked Delivered / Received: often it arrived and nobody marked it.',
    `OVERVIEW: ${k.open} open orders (${k.openLines} lines) · ${k.late} late lines (oldest ${k.oldestLateDays} days past ETA) · ${money(k.onOrder$)} ordered, not delivered (${k.onOrderOrders} orders)`
      + ` · ${money(k.unpaid$)} invoiced, not paid (${k.unpaidInvoices} invoices, oldest ${k.oldestUnpaidDays} days) · ${stubs.needs.length} paid invoices without a check stub`
      + ` · ${k.reorder} warehouse items to reorder · ${p.inboxWaiting} documents waiting in the Inbox.`,
  ]);

  // 2. the orders the question names, in full
  const hays = new Map(live.map(o => [o.id, [o.order_number, o.vendor_name, venueName(o.venue_id), o.notes,
    ...(lm.get(o.id) ?? []).flatMap(l => [l.description, l.sku, l.invoice_number, l.quote_number, l.tracking_number, l.venue_id && venueName(l.venue_id)]),
    ...data.tracking.filter(t => t.order_id === o.id).map(t => t.tracking_number), ...data.documents.filter(d => d.order_id === o.id).flatMap(d => [d.doc_number, d.file_name])]
    .filter(Boolean).join(' ')]));
  // a code (order / invoice / tracking #) settles it; words count by how rare they are ("mints" over "delilah")
  const words = new Map(terms.words.map(w => [w, live.filter(o => hasWord(wordText(hays.get(o.id)!), w)).length]));
  const scoredAll = live.map(o => {
    const h = hays.get(o.id)!, ht = wordText(h);
    const code = terms.codes.filter(c => h.toUpperCase().includes(c)).length;
    const s = code * 10 + terms.words.reduce((t, w) => t + (hasWord(ht, w) ? 1 / Math.max(1, words.get(w)!) : 0), 0);
    return { o, s };
  }).filter(x => x.s > 0);
  const best = Math.max(0, ...scoredAll.map(x => x.s));
  const scored = scoredAll.filter(x => (terms.codes.length ? x.s >= 10 : x.s >= best * 0.6)).sort((a, b) => b.s - a.s);
  if (scored.length) {
    add([`ORDERS MATCHING THE QUESTION (${scored.length}${scored.length > 8 ? ', the 8 closest in full' : ''}):`]);
    for (const { o } of scored.slice(0, 8)) {
      const d = orderDetail(o, lm.get(o.id) ?? [], data.documents.filter(x => x.order_id === o.id), data.tracking.filter(t => t.order_id === o.id), data.moves, venueName, today);
      if (!add(d.split('\n'))) break;
    }
  }

  // 3. topic lists
  const q = p.question;
  if (TOPIC.late.test(q)) {
    const late = live.flatMap(o => (lm.get(o.id) ?? []).filter(l => isLate(l, o, today, receivedForLine(data.moves, l.id))).map(l => ({ o, l, due: l.expected_on ?? o.expected_on ?? '' })))
      .sort((a, b) => a.due.localeCompare(b.due));
    add([`LATE LINES (${late.length}, oldest first):`]);
    add(late.slice(0, 40).map(x => `- ${x.o.order_number} ${x.o.vendor_name} | ${x.l.description.slice(0, 60)} | ${x.l.status} | ETA ${x.due}${x.l.tracking_number ? ' | has tracking' : ''}`));
  }
  if (TOPIC.unpaid.test(q)) {
    const unpaid = live.map(o => ({ o, pay: paymentOf(lm.get(o.id) ?? [], today) })).filter(x => x.pay.state === 'unpaid').sort((a, b) => (b.pay.oldestDays ?? 0) - (a.pay.oldestDays ?? 0));
    add([`INVOICED, NOT PAID (${unpaid.length} orders, oldest first):`]);
    add(unpaid.map(x => `- ${x.o.order_number} ${x.o.vendor_name} | ${money(x.pay.unpaid$)} | ${x.pay.invoices.join(', ')} | ${x.pay.oldestDays ?? '?'} days`));
  }
  if (TOPIC.stubs.test(q) && stubs.groups.length) {
    add([`PAID WITHOUT A CHECK STUB (reprint in R365 by payment):`]);
    add(stubs.groups.map(g => `- ${g.key || 'not matched to an R365 payment'}${g.payments.length ? ` (${g.payments.map(x => x.date).join(', ')}, ${money(g.payments.reduce((s, x) => s + x.amount, 0))})` : ''}: ${g.items.map(i => `${i.orderNumber} ${i.invoice}`).join(', ')}`));
  }
  if (TOPIC.stock.test(q)) {
    const rows = stockRows(data.items, data.moves, data.lines, data.orders, today);
    add([`STOCK ON HAND (by where it is kept; on hand / used per month / state):`]);
    add(rows.map(r => `- [${r.item.location?.trim() || 'E&E warehouse'}] ${r.item.name}${r.item.sku ? ` (${r.item.sku})` : ''}: ${r.onHand} ${r.item.unit}, ${Math.round(r.monthlyUse * 10) / 10}/month, ${r.state}${r.incoming ? `, ${r.incoming} incoming` : ''}`));
  }
  if (TOPIC.inbox.test(q)) add([`INBOX: ${p.inboxWaiting} documents wait for a person (Order tracker → Inbox).`]);
  if (TOPIC.lead.test(q)) {
    // 0147: sent to the vendor -> delivered; ~ = estimated (a delivery day from the ETA, or the PO date for the sent day)
    const vl = vendorLeadTimes(live, data.lines, today);
    add(['LEAD TIMES (the day an order went to the vendor to the day it was delivered; ~ = estimated):']);
    add(vl.map(v => `- ${v.vendor}: ${v.took.length ? `${v.approx === v.took.length ? '~' : ''}${spanText(median(v.took))} typical over ${v.took.length} delivered orders (${spanText(Math.min(...v.took))} to ${spanText(Math.max(...v.took))})` : 'no delivered orders with dates'}`
      + (v.open.length ? ` · open: ${v.open.slice(0, 6).map(x => `${x.order.order_number ?? '(no #)'} sent ${x.order.sent_on} (${spanText(x.days)})`).join(', ')}` : '')));
  }

  // 4. the bibles' matching rows
  const named = p.venues.filter(v => p.question.toLowerCase().includes(v.name.toLowerCase()) || (v.name === 'The Nice Guy' && /\btng\b/i.test(p.question))
    || (v.name === 'The Birdstreet Club' && /\b(bsc|bird ?streets?)\b/i.test(p.question))).map(v => v.id);
  const withText = p.bibles.filter(b => b.text_index);
  if (withText.length) {
    add([`VENUE BIBLES (each venue's OS&E list): ${withText.map(b => `${venueName(b.venue_id)} — "${b.title}" (${b.text_index!.sheets.map(s => s.name).join(', ')})`).join('; ')}.`]);
    const wantBible = /\bbible/i.test(q) || named.length > 0 || terms.words.length > 0;
    if (wantBible) {
      const hits: Array<{ s: number; line: string }> = [];
      const leads = productLeadIndex(data.orders, data.lines, today);
      for (const b of withText) for (const sh of b.text_index!.sheets) for (const r of sh.rows) {
        const text = wordText(r.join(' ')), sheetName = wordText(sh.name);
        const s = terms.codes.filter(c => text.includes(c.toLowerCase())).length * 10 + terms.words.filter(w => hasWord(text, w) || hasWord(sheetName, w)).length;
        const venueHit = named.length && named.includes(b.venue_id);
        if (s > 0 && (!named.length || venueHit)) {
          // the product's lead time from the orders, by its item number (0147)
          const numAt = sh.header.findIndex(h => /item\s*(#|no\b|number)|\bsku\b|mfr\.?\s*#/i.test(h));
          const lead = numAt >= 0 && r[numAt] ? leadForItem(leads, r[numAt]) : null;
          const lt = lead ? leadText(lead) : null;
          hits.push({ s: s + (venueHit ? 1 : 0), line: `- [${b.title} · ${sh.name}] ` + r.map((v, i) => (v ? `${sh.header[i] || `col ${i + 1}`}: ${shortUrl(v)}` : '')).filter(Boolean).join(' | ')
            + (lt ? ` | lead time from orders: ${[lt.took, lt.open].filter(Boolean).join(', ')}` : '') });
        }
      }
      hits.sort((a, b) => b.s - a.s);
      if (hits.length) { add([`BIBLE ROWS MATCHING THE QUESTION (${hits.length}${hits.length > 40 ? ', the 40 closest' : ''}):`]); add(hits.slice(0, 40).map(h => h.line.slice(0, 400))); }
    }
  } else {
    add(['VENUE BIBLES: none has a searchable text copy yet (open each once in Order tracker → Bibles).']);
  }

  // 5. every order, one line each, in what room is left
  if (room() > 400) {
    add([`ALL ORDERS (${live.length}; # · vendor · venue · fulfillment · payment · value · lines · next ETA · invoices):`]);
    const order = [...live].sort((a, b) => (b.ordered_on ?? b.created_at).localeCompare(a.ordered_on ?? a.created_at));
    let shown = 0;
    for (const o of order) { if (!add([`- ${orderIndexLine(o, lm.get(o.id) ?? [], venueName, today)}`])) break; shown++; }
    if (shown < order.length) add([`(${order.length - shown} older orders left out for length — ask about them by number.)`]);
  }
  return out.join('\n');
}

/** What the assistant is told it is, when the order tracker data is on. */
export function ordersSystemPrompt(): string {
  return [
    "You also answer for h.wood's Purchasing team about the order tracker (orders from vendors such as EE Mercantile, their lines, invoices, payments from R365, tracking, documents) and each venue's OS&E bible.",
    'Use only the data given below, quote order numbers and invoice numbers exactly, and say plainly when something is not in it (for example an order outside what was sent) instead of guessing.',
    'Keep answers short: lists for several items, the order # first.',
  ].join(' ');
}
