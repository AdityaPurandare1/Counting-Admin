/* ───────────────────────────────────────────────────────────────────────
   Order tracker — what the redesigned screen shows (v0.87, the user's
   order-tracker.html design): the Orders list's Fulfillment / Payment
   columns, the top KPIs, the bell's "needs attention" list, and the order
   drawer's draft → save plan. Pure, so it is tested; the screen only draws.
   Kept apart from orderTracker.ts, whose copy the morning pull runs.
   ─────────────────────────────────────────────────────────────────────── */
import {
  MULTIPLE_VENUES, STATUSES, isLate, isStorageLine, lineTotal, orderState, receivedForLine, statusRank, stockRows,
  type LineStatus, type OtDocument, type OtItem, type OtLine, type OtMove, type OtOrder,
} from './orderTracker';

const DAY = 86_400_000;
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
const live = (ls: OtLine[]) => ls.filter(l => l.status !== 'CANCELLED');

/* ── Fulfillment: the cycle without its payment steps ─────────────────── */

/** E&E is prepaid: once invoiced / paid, the goods are being made until they ship. */
export const FULFILLMENT = ['Requested', 'Ordered', 'Quoted', 'In production', 'Shipped', 'Delivered', 'Received'] as const;
export type Fulfillment = typeof FULFILLMENT[number];
const FULFILLMENT_OF: Record<LineStatus, Fulfillment | 'Cancelled'> = {
  REQUESTED: 'Requested', ORDERED: 'Ordered', QUOTED: 'Quoted', INVOICED: 'In production', PAID: 'In production',
  SHIPPED: 'Shipped', DELIVERED: 'Delivered', RECEIVED: 'Received', CANCELLED: 'Cancelled',
};
export const fulfillmentOf = (s: LineStatus | null): Fulfillment | 'Cancelled' | null => (s ? FULFILLMENT_OF[s] : null);
export const fulfillmentStep = (s: LineStatus | null): number => {
  const f = fulfillmentOf(s);
  return f && f !== 'Cancelled' ? FULFILLMENT.indexOf(f) : -1;
};

/* ── Payment: from the lines' invoices and statuses ───────────────────── */

export interface PaymentView {
  state: 'none' | 'unpaid' | 'part' | 'paid';
  label: string;
  invoices: string[];
  /** invoiced, not paid */
  unpaid$: number;
  /** days since the oldest unpaid invoice */
  oldestDays: number | null;
}
const PAY_LABEL: Record<PaymentView['state'], string> = { none: 'Not invoiced', unpaid: 'Invoiced, not paid', part: 'Part paid', paid: 'Paid' };

export function paymentOf(lines: OtLine[], today: string): PaymentView {
  const ls = live(lines);
  const invoices = [...new Set(ls.map(l => l.invoice_number?.trim()).filter((x): x is string => !!x))];
  // invoiced and not yet paid: at Invoiced, or an invoice # typed on a line still before Invoiced
  const unpaid = ls.filter(l => l.status === 'INVOICED' || (!!l.invoice_number && statusRank(l.status) < statusRank('INVOICED')));
  const paid = ls.filter(l => statusRank(l.status) >= statusRank('PAID'));
  const state: PaymentView['state'] = unpaid.length ? 'unpaid' : !paid.length ? 'none' : paid.length === ls.length ? 'paid' : 'part';
  const since = unpaid.map(l => l.invoice_date ?? l.status_at.slice(0, 10)).sort()[0] ?? null;
  return { state, label: PAY_LABEL[state], invoices, unpaid$: unpaid.reduce((s, l) => s + lineTotal(l), 0), oldestDays: since ? Math.max(0, daysFrom(since, today)) : null };
}

/* ── the list's other columns ─────────────────────────────────────────── */

/** The soonest promised date of what has not arrived yet (a line's own ETA, else the order's). */
export function nextEta(o: Pick<OtOrder, 'expected_on'>, lines: OtLine[]): string | null {
  return live(lines).filter(l => statusRank(l.status) < statusRank('DELIVERED')).map(l => l.expected_on ?? o.expected_on)
    .filter((x): x is string => !!x).sort()[0] ?? null;
}

export function lastUpdate(o: Pick<OtOrder, 'updated_at' | 'created_at'>, lines: OtLine[]): string {
  return [o.updated_at, o.created_at, ...lines.flatMap(l => [l.status_at, l.updated_at ?? ''])].filter(Boolean).sort().slice(-1)[0];
}

export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The user's tracker numbers orders by kind (CUS-0042, OSE-0035, OPN-0004, WHS-0011). */
const CATEGORY: Record<string, string> = { CUS: 'Custom / branded', OSE: 'Operating supplies', OPN: 'Opening order', WHS: 'Warehousing & delivery' };
export const orderCategory = (orderNumber: string | null | undefined): string | null => CATEGORY[String(orderNumber ?? '').split('-')[0].toUpperCase()] ?? null;

/* ── KPIs + the bell ──────────────────────────────────────────────────── */

export interface TrackerKpis {
  open: number; openLines: number; late: number; oldestLateDays: number;
  onOrder$: number; onOrderOrders: number; unpaid$: number; unpaidInvoices: number; oldestUnpaidDays: number;
  reorder: number; soon: number;
}
interface Data { orders: OtOrder[]; lines: OtLine[]; items: OtItem[]; moves: OtMove[]; documents?: OtDocument[] }
const byOrder = (lines: OtLine[]) => {
  const m = new Map<string, OtLine[]>();
  for (const l of lines) (m.get(l.order_id) ?? m.set(l.order_id, []).get(l.order_id)!).push(l);
  return m;
};

export function trackerKpis(data: Data, today: string): TrackerKpis {
  const lm = byOrder(data.lines);
  const open = data.orders.filter(o => orderState(o, lm.get(o.id) ?? []) === 'open');
  const openLines = open.flatMap(o => live(lm.get(o.id) ?? []));
  const late = open.flatMap(o => (lm.get(o.id) ?? []).filter(l => isLate(l, o, today, receivedForLine(data.moves, l.id))).map(l => ({ o, l })));
  const notArrived = (l: OtLine) => l.status !== 'REQUESTED' && statusRank(l.status) < statusRank('DELIVERED');
  // archived orders were never real (tests, duplicates): they leave every total
  const pays = data.orders.filter(o => !o.archived_at).map(o => paymentOf(lm.get(o.id) ?? [], today)).filter(p => p.state === 'unpaid');
  const unpaidInvoices = new Set(data.orders.filter(o => !o.archived_at).flatMap(o => live(lm.get(o.id) ?? [])
    .filter(l => l.status === 'INVOICED' || (!!l.invoice_number && statusRank(l.status) < statusRank('INVOICED'))).map(l => l.invoice_number ?? `line:${l.id}`)));
  const stock = stockRows(data.items, data.moves, data.lines, data.orders, today);
  return {
    open: open.length, openLines: openLines.length, late: late.length,
    oldestLateDays: late.reduce((m, x) => Math.max(m, daysFrom(x.l.expected_on ?? x.o.expected_on ?? today, today)), 0),
    onOrder$: openLines.filter(notArrived).reduce((s, l) => s + lineTotal(l), 0),
    onOrderOrders: open.filter(o => (lm.get(o.id) ?? []).some(notArrived)).length,
    unpaid$: pays.reduce((s, p) => s + p.unpaid$, 0), unpaidInvoices: unpaidInvoices.size,
    oldestUnpaidDays: pays.reduce((m, p) => Math.max(m, p.oldestDays ?? 0), 0),
    reorder: stock.filter(r => r.state === 'reorder now').length, soon: stock.filter(r => r.state === 'reorder soon').length,
  };
}

export type AttentionAct = { kind: 'order'; id: string } | { kind: 'tab'; tab: 'inbox' | 'warehouse' | 'overview' };
export interface Attention { sev: 'crit' | 'warn' | 'info'; title: string; sub: string; act: AttentionAct }
export const CHASE_DAYS = 14;

/** What needs someone now: late orders, invoices unpaid past two weeks, the Inbox, E&E deliveries
 *  to put in stock, items to reorder — worst first. */
export function attentionItems(data: Data, today: string, inboxWaiting: number, fmt: (x: number) => string): Attention[] {
  const lm = byOrder(data.lines);
  const out: Attention[] = [];
  for (const o of data.orders.filter(x => orderState(x, lm.get(x.id) ?? []) === 'open')) {
    const ls = lm.get(o.id) ?? [];
    const late = ls.filter(l => isLate(l, o, today, receivedForLine(data.moves, l.id)));
    if (late.length) {
      const oldest = late.reduce((m, l) => Math.max(m, daysFrom(l.expected_on ?? o.expected_on ?? today, today)), 0);
      out.push({ sev: 'crit', title: `${o.vendor_name} ${o.order_number ?? ''}`.trim(), sub: `${late.length} line${late.length > 1 ? 's' : ''} past ETA · oldest ${oldest} day${oldest === 1 ? '' : 's'}`, act: { kind: 'order', id: o.id } });
    }
  }
  for (const o of data.orders.filter(x => !x.archived_at)) {
    const p = paymentOf(lm.get(o.id) ?? [], today);
    if (p.state === 'unpaid' && (p.oldestDays ?? 0) >= CHASE_DAYS) {
      out.push({ sev: 'warn', title: `${o.vendor_name} invoice ${p.invoices[0] ?? ''}`.trim(), sub: `${fmt(p.unpaid$)} · ${p.oldestDays} days unpaid · ${o.order_number ?? ''}`.replace(/ · $/, ''), act: { kind: 'order', id: o.id } });
    }
  }
  if (inboxWaiting > 0) out.push({ sev: 'info', title: `${inboxWaiting} document${inboxWaiting > 1 ? 's' : ''} waiting in the Inbox`, sub: 'quotes / invoices the pull could not place by itself', act: { kind: 'tab', tab: 'inbox' } });
  const orders = new Map(data.orders.map(o => [o.id, o]));
  const drawn = new Set(data.moves.map(m => m.line_id).filter(Boolean));
  const deliveries = data.lines.filter(l => !l.stock_draw && !drawn.has(l.id) && orders.has(l.order_id) && isStorageLine(l, orders.get(l.order_id)!.vendor_name)).length;
  if (deliveries) out.push({ sev: 'info', title: `${deliveries} E&E deliver${deliveries > 1 ? 'ies' : 'y'} to put in stock`, sub: 'pick the item for each in Warehouse', act: { kind: 'tab', tab: 'warehouse' } });
  if (data.documents) {
    const { needs, groups } = stubsToGet(data.orders, data.lines, data.documents);
    if (needs.length) out.push({ sev: 'info', title: `${needs.length} paid invoice${needs.length > 1 ? 's have' : ' has'} no check stub`,
      sub: `${groups.filter(g => g.payments.length).length} R365 payment${groups.filter(g => g.payments.length).length === 1 ? '' : 's'} to reprint — see Overview`, act: { kind: 'tab', tab: 'overview' } });
  }
  const reorder = stockRows(data.items, data.moves, data.lines, data.orders, today).filter(r => r.state === 'reorder now');
  if (reorder.length) out.push({ sev: 'warn', title: `${reorder.length} item${reorder.length > 1 ? 's' : ''} to reorder`, sub: reorder.slice(0, 3).map(r => r.item.name).join(', ') + (reorder.length > 3 ? '…' : ''), act: { kind: 'tab', tab: 'warehouse' } });
  const rank = { crit: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}

/* ── the order drawer: a draft, saved in one go ───────────────────────── */

export interface LineDraft {
  key: string;
  /** null = a line added in the drawer */
  id: string | null;
  item_id: string | null; description: string; sku: string; qty: string; unit: string; unit_price: string;
  expected_on: string; status: LineStatus; invoice_number: string; invoice_date: string; quote_number: string | null;
  venue_id: string | null;
  removed: boolean;
}
export interface OrderDraft {
  vendor_name: string; order_number: string; venue_id: string; deliver_to: 'warehouse' | 'venue';
  ordered_on: string; expected_on: string; notes: string;
  lines: LineDraft[];
}

let draftKey = 0;
const numText = (x: number | null) => (x == null ? '' : String(x));
export function lineDraft(l: OtLine | null, status: LineStatus = 'REQUESTED'): LineDraft {
  return {
    key: l?.id ?? `new-${++draftKey}`, id: l?.id ?? null, item_id: l?.item_id ?? null, description: l?.description ?? '', sku: l?.sku ?? '',
    qty: l ? numText(l.qty) : '', unit: l?.unit ?? '', unit_price: l ? numText(l.unit_price) : '', expected_on: l?.expected_on ?? '',
    status: l?.status ?? status, invoice_number: l?.invoice_number ?? '', invoice_date: l?.invoice_date ?? '', quote_number: l?.quote_number ?? null,
    venue_id: l?.venue_id ?? null, removed: false,
  };
}
export function orderDraft(o: OtOrder | null, lines: OtLine[], today: string): OrderDraft {
  return {
    vendor_name: o?.vendor_name ?? '', order_number: o?.order_number ?? '', venue_id: o?.venue_id ?? '', deliver_to: o?.deliver_to ?? 'venue',
    ordered_on: o ? o.ordered_on ?? '' : today, expected_on: o?.expected_on ?? '', notes: o?.notes ?? '',
    lines: o ? [...lines].sort((a, b) => a.sort - b.sort).map(l => lineDraft(l)) : [lineDraft(null)],
  };
}

/** The draft's stage for the stepper: its least-advanced live line (as headlineStatus). */
export function draftStage(d: OrderDraft): LineStatus | null {
  const ls = d.lines.filter(l => !l.removed && l.status !== 'CANCELLED');
  return ls.length ? ls.reduce((m, l) => (statusRank(l.status) < statusRank(m) ? l.status : m), ls[0].status) : null;
}
/** Every live line to `s` (the stepper). `backward` = how many lines that moves back. */
export function setDraftStage(d: OrderDraft, s: LineStatus): { draft: OrderDraft; backward: number } {
  let backward = 0;
  const lines = d.lines.map(l => {
    if (l.removed || l.status === 'CANCELLED' || l.status === s) return l;
    if (statusRank(s) < statusRank(l.status)) backward++;
    return { ...l, status: s };
  });
  return { draft: { ...d, lines }, backward };
}
/** Payment buttons: lines before Invoiced → Invoiced, or before Paid → Paid. Forward only. */
export function markDraft(d: OrderDraft, to: 'INVOICED' | 'PAID'): OrderDraft {
  return { ...d, lines: d.lines.map(l => (l.removed || l.status === 'CANCELLED' || statusRank(l.status) >= statusRank(to) ? l : { ...l, status: to })) };
}

export const draftLineTotal = (l: Pick<LineDraft, 'qty' | 'unit_price'>) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
export const draftTotal = (d: OrderDraft) => d.lines.filter(l => !l.removed && l.status !== 'CANCELLED').reduce((s, l) => s + draftLineTotal(l), 0);

export interface OrderSavePlan {
  problems: string[];
  order: Partial<OtOrder>;
  updates: Array<{ id: string; patch: Partial<OtLine> }>;
  /** units to receive into the warehouse (a stocked item, delivered to the warehouse, ticked received) */
  receipts: Array<{ line_id: string; item_id: string; qty: number }>;
  adds: Array<{ item_id: string | null; description: string; sku: string | null; qty: number; unit: string | null; unit_price: number | null;
    status: LineStatus; invoice_number: string | null; invoice_date: string | null; expected_on: string | null }>;
  removes: string[];
  backward: number;
}

/** What Save writes: only what changed. A line's item comes from its exact catalog name when it has none. */
export function planOrderSave(o: OtOrder | null, lines: OtLine[], d: OrderDraft,
                              ctx: { items: OtItem[]; received: (lineId: string) => number }): OrderSavePlan {
  const plan: OrderSavePlan = { problems: [], order: {}, updates: [], receipts: [], adds: [], removes: [], backward: 0 };
  if (!d.vendor_name.trim()) plan.problems.push('Enter the vendor.');
  const txt = (s: string) => s.trim() || null;
  const fields: Partial<OtOrder> = {
    vendor_name: d.vendor_name.trim(), order_number: txt(d.order_number), venue_id: d.venue_id || null, deliver_to: d.deliver_to,
    ordered_on: d.ordered_on || null, expected_on: d.expected_on || null, notes: txt(d.notes),
  };
  for (const [k, v] of Object.entries(fields) as Array<[keyof OtOrder, unknown]>) if (!o || (o[k] ?? null) !== v) (plan.order as Record<string, unknown>)[k] = v;
  const byName = new Map(ctx.items.filter(i => i.is_active).map(i => [i.name.trim().toLowerCase(), i]));
  const kept = d.lines.filter(l => !l.removed);
  if (!kept.some(l => l.description.trim())) plan.problems.push('Add at least one line.');
  kept.forEach((l, i) => {
    const row = `Line ${i + 1}`;
    if (!l.description.trim()) { if (l.id || l.qty || l.unit_price) plan.problems.push(`${row}: enter the item.`); return; }
    const qty = Number(l.qty === '' ? NaN : l.qty);
    if (!Number.isFinite(qty) || qty < 0) plan.problems.push(`${row}: enter the quantity.`);
    const price = l.unit_price.trim() === '' ? null : Number(l.unit_price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) plan.problems.push(`${row}: the unit cost is not a number.`);
  });
  if (plan.problems.length) return plan;

  const old = new Map(lines.map(l => [l.id, l]));
  for (const l of d.lines) {
    if (l.removed) { if (l.id) plan.removes.push(l.id); continue; }
    if (!l.description.trim()) continue;
    const item_id = l.item_id ?? byName.get(l.description.trim().toLowerCase())?.id ?? null;
    const row = {
      item_id, description: l.description.trim(), sku: txt(l.sku), qty: Number(l.qty), unit: txt(l.unit), unit_price: l.unit_price.trim() === '' ? null : Number(l.unit_price),
      status: l.status, invoice_number: txt(l.invoice_number), invoice_date: l.invoice_date || null, expected_on: l.expected_on || null,
    };
    const was = l.id ? old.get(l.id) : undefined;
    if (!was) { plan.adds.push(row); continue; }
    const patch: Partial<OtLine> = {};
    for (const [k, v] of Object.entries(row) as Array<[keyof OtLine, unknown]>) {
      const before = k === 'qty' || k === 'unit_price' ? (was[k] == null ? null : Number(was[k])) : (was[k] ?? null);
      if (before !== v) (patch as Record<string, unknown>)[k] = v;
    }
    if (patch.status && patch.status !== 'CANCELLED' && was.status !== 'CANCELLED' && statusRank(patch.status) < statusRank(was.status)) plan.backward++;
    // ticked received: what is still to come of a stocked item goes into the warehouse
    if (patch.status === 'RECEIVED' && item_id && (o?.deliver_to ?? d.deliver_to) === 'warehouse' && ctx.items.find(i => i.id === item_id)?.track_stock) {
      const left = Math.max(0, row.qty - ctx.received(was.id));
      if (left > 0) plan.receipts.push({ line_id: was.id, item_id, qty: left });
    }
    if (Object.keys(patch).length) plan.updates.push({ id: was.id, patch });
  }
  return plan;
}

export const isPlanEmpty = (p: OrderSavePlan) => !Object.keys(p.order).length && !p.updates.length && !p.adds.length && !p.removes.length;

/** The order's venue choices: counting venues + order-only ones, several, or none (warehouse stock). */
export const VENUE_SEVERAL = MULTIPLE_VENUES;
export const ALL_LINE_STATUSES = STATUSES;

/* ── check stubs to get from R365 (0143) ──────────────────────────────── */

export interface R365Payment { number: string; date: string; amount: number }
/** The invoice # as R365 and the stubs write it ("INV-2026-857309 Delilah LA" → "INV-2026-857309"). */
export const invoiceToken = (s: string | null | undefined) => {
  const t = String(s ?? '').trim().toUpperCase();
  return t.match(/INV-\d{4}-\d{5,7}/)?.[0] ?? t;
};
/** The invoices a check stub on an order covers (its parsed list, else the numbers in its doc #). */
export const stubInvoices = (d: Pick<OtDocument, 'kind' | 'doc_number'> & { parsed?: unknown }) => {
  const listed = (d.parsed as { invoices?: unknown } | null)?.invoices;
  return new Set((Array.isArray(listed) ? listed.map(String) : String(d.doc_number ?? '').split(/[,;\s]+/)).map(invoiceToken).filter(Boolean));
};

export interface StubNeed { orderId: string; orderNumber: string | null; vendor: string; invoice: string; amount: number; payments: R365Payment[] }
export interface StubGroup { key: string; payments: R365Payment[]; items: StubNeed[] }

/** Paid invoices with no check stub on their order — grouped by the R365 payment that paid them, since R365
 *  reprints a stub per payment (one ACH often pays several invoices). A group with no payment = paid but not
 *  matched to an R365 payment (paid outside R365, or per the old sheet). */
export function stubsToGet(orders: OtOrder[], lines: OtLine[], documents: OtDocument[]): { needs: StubNeed[]; groups: StubGroup[] } {
  const live = new Map(orders.filter(o => !o.archived_at).map(o => [o.id, o]));
  const covered = new Set<string>();
  for (const d of documents) if (d.kind === 'payment' && d.order_id) for (const t of stubInvoices(d)) covered.add(`${d.order_id}|${t}`);
  const byInvoice = new Map<string, OtLine[]>();
  for (const l of lines) {
    if (!l.invoice_number || l.status === 'CANCELLED' || !live.has(l.order_id)) continue;
    const k = `${l.order_id}|${invoiceToken(l.invoice_number)}`;
    (byInvoice.get(k) ?? byInvoice.set(k, []).get(k)!).push(l);
  }
  const needs: StubNeed[] = [];
  for (const [k, ls] of byInvoice) {
    if (covered.has(k) || !ls.every(l => statusRank(l.status) >= statusRank('PAID'))) continue;
    const o = live.get(ls[0].order_id)!;
    const pays = new Map<string, R365Payment>();
    for (const l of ls) for (const p of l.r365_payments ?? []) pays.set(p.number, { number: p.number, date: p.date, amount: Number(p.amount) || 0 });
    needs.push({ orderId: o.id, orderNumber: o.order_number, vendor: o.vendor_name, invoice: k.split('|')[1], amount: ls.reduce((s, l) => s + lineTotal(l), 0),
      payments: [...pays.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  const groups = new Map<string, StubGroup>();
  for (const n of needs) {
    const key = n.payments.map(p => p.number).join(' + ') || '';
    (groups.get(key) ?? groups.set(key, { key, payments: n.payments, items: [] }).get(key)!).items.push(n);
  }
  // the newest payments first; the unmatched ones last
  const sorted = [...groups.values()].sort((a, b) => (!a.key ? 1 : !b.key ? -1 : (b.payments.slice(-1)[0]?.date ?? '').localeCompare(a.payments.slice(-1)[0]?.date ?? '')));
  for (const g of sorted) g.items.sort((a, b) => a.invoice.localeCompare(b.invoice));
  return { needs, groups: sorted };
}
