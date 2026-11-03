import { isStorageLine, sameVendor, type OtLine, type OtOrder } from './orderTracker';

/* Lead times (0147): from the day an order went to the vendor (kount_ot_orders.sent_on) to the day each line
 * was delivered (kount_ot_lines.delivered_on); an order not delivered yet is counted to today. Products are
 * known across orders and bibles by their item number only — names alike ("Cinco red wine glass" / "Verbelle
 * sauvignon glass") are different products too often to share a lead time. */

const DELIVERED = new Set<OtLine['status']>(['DELIVERED', 'RECEIVED']);
const isoMs = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');

export const daysBetween = (from: string, to: string) => Math.round((isoMs(to) - isoMs(from)) / 86_400_000);

/** 5 days · 3 wks · 2 mo: days under two weeks, weeks under nine, then months. */
export function spanText(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d < 14) return `${d} day${d === 1 ? '' : 's'}`;
  if (d < 63) return `${Math.round(d / 7)} wks`;
  return `${Math.round(d / 30.44)} mo`;
}

/** How the sent day is known, said in the order panel. */
export const SENT_SOURCE: Record<string, string> = {
  email: 'from the e-mail to the vendor', sheet: 'from your tracker sheet', po_date: 'PO date — the day it was sent is not known', manual: 'typed in',
};

export interface OrderTiming {
  sentOn: string | null;
  /** open: not every line delivered (counted to today) · took: all delivered (to the last) · delivered: all
   *  delivered, on days not known · unsent: no sent day */
  state: 'open' | 'took' | 'delivered' | 'unsent';
  days: number | null;
  /** an estimate: the PO date stands in for the sent day, or an ETA for a delivered day */
  approx: boolean;
}

export function orderTiming(o: Pick<OtOrder, 'sent_on' | 'sent_source'>, lines: readonly OtLine[], today: string): OrderTiming {
  const live = lines.filter(l => l.status !== 'CANCELLED');
  const sentOn = o.sent_on ?? null;
  if (!sentOn) return { sentOn, state: 'unsent', days: null, approx: false };
  const poDate = o.sent_source === 'po_date';
  if (!live.length || live.some(l => !DELIVERED.has(l.status))) return { sentOn, state: 'open', days: Math.max(0, daysBetween(sentOn, today)), approx: poDate };
  const known = live.filter(l => l.delivered_on);
  if (!known.length) return { sentOn, state: 'delivered', days: null, approx: poDate };
  const last = known.map(l => l.delivered_on!).sort().pop()!;
  return { sentOn, state: 'took', days: Math.max(0, daysBetween(sentOn, last)), approx: poDate || known.length < live.length || known.some(l => l.delivered_source === 'eta') };
}

/** "open 3 wks" / "took 6 wks" / "delivered" — a ~ marks an estimate. */
export function timingText(t: OrderTiming): string {
  const s = t.days == null ? '' : `${t.approx ? '~' : ''}${spanText(t.days)}`;
  return t.state === 'open' ? `open ${s}` : t.state === 'took' ? `took ${s}` : t.state === 'delivered' ? 'delivered' : '';
}

/* ── item numbers ──────────────────────────────────────────────────────── */

/** An item number compared without punctuation: "FGC51530-048" = "FGC51530048", "#853817" = "853817". */
export const itemKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// a size or an amount, not a product: "12x18", "24X72X74", "750ml", "100cs", "16oz"
const SIZE_LIKE = /^\d+(X\d+)+$|^\d+(ML|CL|OZ|FLOZ|L|LB|LBS|G|KG|IN|INCH|CM|MM|FT|CT|CS|PK|PC|PCS|EA|QT|GAL)$/;

/** Long enough to name one product: 5+ characters, or 4 that mix letters and digits — never a size, a pack
 *  count or a year ("6.5", "1000", "2026", "12x18", "750ml"). */
export const isItemKey = (k: string) => /\d/.test(k) && !SIZE_LIKE.test(k) && (k.length >= 5 || (k.length === 4 && /[A-Z]/.test(k)));

/** The item numbers on an order line: its SKU, and each token of its description that reads as one
 *  ("Carafe 6.25 oz (Z3470070)", "STOLZLE - CARAFE (#Z3470070)", "WMF ... 06.7540.6040"). */
export function lineItemKeys(l: Pick<OtLine, 'sku' | 'description'>): string[] {
  const out = new Set<string>();
  for (const raw of [l.sku ?? '', ...l.description.split(/[\s()[\],;/]+/)]) {
    const k = itemKey(raw);
    if (isItemKey(k)) out.add(k);
  }
  return [...out];
}

export interface ProductLead {
  /** one per order: the days from sent to delivered (the last line of that product on the order) */
  took: Array<{ orderId: string; days: number; approx: boolean }>;
  /** orders of it not delivered yet, days since they were sent */
  open: Array<{ orderId: string; orderNumber: string | null; days: number }>;
}

/** Lead times per item number across every order (cancelled lines and orders with no sent day left out). */
export function productLeadIndex(orders: readonly OtOrder[], lines: readonly OtLine[], today: string): Map<string, ProductLead> {
  const byId = new Map(orders.map(o => [o.id, o]));
  const index = new Map<string, ProductLead>();
  for (const l of lines) {
    const o = byId.get(l.order_id);
    if (!o?.sent_on || l.status === 'CANCELLED') continue;
    const keys = lineItemKeys(l);
    if (!keys.length) continue;
    const delivered = DELIVERED.has(l.status);
    if (delivered && !l.delivered_on) continue;
    const days = Math.max(0, daysBetween(o.sent_on, delivered ? l.delivered_on! : today));
    const approx = o.sent_source === 'po_date' || l.delivered_source === 'eta';
    for (const k of keys) {
      const p = index.get(k) ?? index.set(k, { took: [], open: [] }).get(k)!;
      if (delivered) {
        const had = p.took.find(x => x.orderId === o.id);
        if (had) { had.days = Math.max(had.days, days); had.approx = had.approx || approx; }
        else p.took.push({ orderId: o.id, days, approx });
      } else {
        const had = p.open.find(x => x.orderId === o.id);
        if (had) had.days = Math.max(had.days, days);
        else p.open.push({ orderId: o.id, orderNumber: o.order_number, days });
      }
    }
  }
  return index;
}

/** A bible row's item number (the Item # / SKU cell) looked up: as written, or with E&E's SP prefix. */
export function leadForItem(index: Map<string, ProductLead>, text: string): ProductLead | null {
  const k = itemKey(text);
  if (!isItemKey(k)) return null;
  return index.get(k) ?? index.get('SP' + k) ?? null;
}

export const median = (xs: readonly number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** "~4 wks (3 orders)" · "on order 2 wks" — what a bible row shows. */
export function leadText(p: ProductLead): { took: string; open: string; title: string } {
  const days = p.took.map(t => t.days);
  const approx = p.took.length > 0 && p.took.every(t => t.approx);
  const took = p.took.length ? `${approx ? '~' : ''}${spanText(median(days))}${p.took.length > 1 ? ` (${p.took.length} orders)` : ''}` : '';
  const oldest = p.open.reduce((a, b) => (b.days > a ? b.days : a), -1);
  const open = p.open.length ? `on order ${spanText(oldest)}` : '';
  const range = p.took.length > 1 ? `, ${spanText(Math.min(...days))} to ${spanText(Math.max(...days))}` : '';
  const title = [
    p.took.length ? `Sent to delivered: ${spanText(median(days))} typical${range}${approx ? ' (delivery days estimated from ETAs)' : ''}` : '',
    p.open.length ? `Not delivered yet: ${p.open.map(o => `${o.orderNumber ?? 'an order'} sent ${spanText(o.days)} ago`).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return { took, open, title };
}

/* ── per vendor ─────────────────────────────────────────────────────────── */

/** A vendor's name without case, punctuation or company suffix: "E&E Mercantile Co." = "EE MERCANTILE". */
const vendorKey = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !['co', 'inc', 'llc', 'ltd', 'corp', 'company'].includes(w)).join('');

export interface VendorLead { vendor: string; took: number[]; approx: number; open: Array<{ order: OtOrder; days: number }> }

/** Each vendor's lead times — one per order, to the last of its lines delivered so far (an order half
 *  delivered still says how long those took) — and its orders not all delivered yet, open the longest first.
 *  Orders of E&E warehouse delivery / storage fees only are not purchases and are left out. */
export function vendorLeadTimes(orders: readonly OtOrder[], lines: readonly OtLine[], today: string): VendorLead[] {
  const linesOf = new Map<string, OtLine[]>();
  for (const l of lines) (linesOf.get(l.order_id) ?? linesOf.set(l.order_id, []).get(l.order_id)!).push(l);
  const out = new Map<string, VendorLead>();
  for (const o of orders) {
    if (o.archived_at || !o.sent_on) continue;
    const ls = (linesOf.get(o.id) ?? []).filter(l => l.status !== 'CANCELLED');
    if (ls.length && ls.every(l => isStorageLine(l, o.vendor_name))) continue;
    // one row per vendor however its name is written ("EE Mercantile", "E&E Mercantile Co.", "EE MERCANTILE")
    const key = [...out.keys()].find(k => vendorKey(k) === vendorKey(o.vendor_name) || sameVendor(k, o.vendor_name)) ?? o.vendor_name;
    const v = out.get(key) ?? out.set(key, { vendor: o.vendor_name, took: [], approx: 0, open: [] }).get(key)!;
    const came = ls.filter(l => DELIVERED.has(l.status) && l.delivered_on);
    if (came.length) {
      v.took.push(Math.max(0, daysBetween(o.sent_on, came.map(l => l.delivered_on!).sort().pop()!)));
      if (o.sent_source === 'po_date' || came.some(l => l.delivered_source === 'eta')) v.approx++;
    }
    const t = orderTiming(o, ls, today);
    if (t.state === 'open' && t.days != null) v.open.push({ order: o, days: t.days });
  }
  for (const v of out.values()) v.open.sort((a, b) => b.days - a.days);
  return [...out.values()].filter(v => v.took.length || v.open.length).sort((a, b) => b.took.length + b.open.length - (a.took.length + a.open.length) || a.vendor.localeCompare(b.vendor));
}
