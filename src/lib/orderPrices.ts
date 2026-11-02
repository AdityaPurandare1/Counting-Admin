/* ───────────────────────────────────────────────────────────────────────
   Order prices (v0.79) — the price tracker for invoices received in the
   order tracker (Purchasing > Order prices). Pure logic over kount_ot_lines;
   tested in tests/orderTracker.test.ts.

   A PRICE POINT is an invoiced line: a line with an invoice number, or one
   whose status reached INVOICED / PAID, with a unit price above 0 (a
   cancelled line never is, whatever number it carries). Prices are
   compared as entered (per case, per each...) and only like with like: a
   change between two invoices whose UNIT differs is sent to the check list,
   never counted as a price move.
   ─────────────────────────────────────────────────────────────────────── */

import { csvCell } from './csv';
import { normText, sameVendor, statusRank, type OtLine, type OtOrder, type OtItem, type OtDocument } from './orderTracker';

export interface PricePoint {
  key: string;               // item key (item id, else normalised description + sku)
  itemName: string;
  date: string;              // invoice date, else when the line reached its status
  invoiceNumber: string;
  vendor: string;
  orderId: string;
  orderNumber: string;
  unit: string;
  unitPrice: number;          // qty-weighted when an invoice has the item twice
  qty: number;
  total: number;
}

const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

export function itemKey(l: Pick<OtLine, 'item_id' | 'description' | 'sku'>): string {
  return l.item_id ? 'item:' + l.item_id : 'desc:' + normText(l.description) + '|' + normText(l.sku);
}

export function isInvoiced(l: Pick<OtLine, 'invoice_number' | 'status'>): boolean {
  if (l.status === 'CANCELLED') return false;
  return !!(l.invoice_number && l.invoice_number.trim()) || statusRank(l.status) >= statusRank('INVOICED');
}

/** Invoiced lines as price points, one per item per invoice, oldest first. */
export function pricePoints(lines: OtLine[], orders: OtOrder[], items: OtItem[]): PricePoint[] {
  const orderById = new Map(orders.map(o => [o.id, o]));
  const itemById = new Map(items.map(i => [i.id, i]));
  // _w / _wq: price × weight and the weights, weight = qty (1 when a line has no qty)
  const acc = new Map<string, PricePoint & { _w: number; _wq: number }>();
  for (const l of lines) {
    const o = orderById.get(l.order_id);
    if (!o || o.archived_at || !isInvoiced(l) || !(num(l.unit_price) > 0)) continue;
    const key = itemKey(l);
    const inv = (l.invoice_number || '').trim();
    const date = l.invoice_date || l.status_at.slice(0, 10);
    const k = `${key}|${inv || 'line:' + l.id}`;
    const qty = num(l.qty);
    const w = qty > 0 ? qty : 1;
    const p = acc.get(k);
    if (p) {
      p._w += num(l.unit_price) * w; p._wq += w;
      p.qty += qty; p.total += num(l.unit_price) * qty;
      p.unitPrice = p._w / p._wq;
    } else {
      acc.set(k, {
        key, itemName: (l.item_id && itemById.get(l.item_id)?.name) || l.description,
        date, invoiceNumber: inv, vendor: o.vendor_name, orderId: o.id, orderNumber: o.order_number || '',
        unit: (l.unit || (l.item_id && itemById.get(l.item_id)?.unit) || '').toLowerCase(),
        unitPrice: num(l.unit_price), qty, total: num(l.unit_price) * qty, _w: num(l.unit_price) * w, _wq: w,
      });
    }
  }
  return [...acc.values()].map(({ _w: _a, _wq: _b, ...p }) => p)
    .sort((a, b) => (a.date === b.date ? a.invoiceNumber.localeCompare(b.invoiceNumber) : a.date < b.date ? -1 : 1));
}

export interface ItemHistory { key: string; itemName: string; points: PricePoint[] }

export function histories(points: PricePoint[]): ItemHistory[] {
  const m = new Map<string, ItemHistory>();
  for (const p of points) {
    const h = m.get(p.key) ?? { key: p.key, itemName: p.itemName, points: [] };
    h.points.push(p); m.set(p.key, h);
  }
  return [...m.values()].sort((a, b) => b.points.length - a.points.length || a.itemName.localeCompare(b.itemName));
}

export interface PriceMove {
  key: string;
  itemName: string;
  prev: PricePoint;
  latest: PricePoint;
  pct: number;
  delta: number;           // per unit
  impact: number;          // delta × qty on the latest invoice
  lowest: PricePoint;
  aboveLowestPct: number;
  vendorChanged: boolean;
  /** Not comparable as-is: the unit changed, or the price doubled / halved. */
  check: string | null;
}

export function priceMoves(hs: ItemHistory[]): PriceMove[] {
  const out: PriceMove[] = [];
  for (const h of hs) {
    const pts = h.points;
    if (pts.length < 2) continue;
    const prev = pts[pts.length - 2], latest = pts[pts.length - 1];
    const delta = latest.unitPrice - prev.unitPrice;
    if (!(prev.unitPrice > 0) || Math.abs(delta) < 0.005) continue;
    const ratio = latest.unitPrice / prev.unitPrice;
    const lowest = pts.reduce((m, p) => (p.unit === latest.unit && p.unitPrice < m.unitPrice ? p : m), latest);
    const check = prev.unit !== latest.unit ? `unit changed (${prev.unit || '—'} → ${latest.unit || '—'})`
      : ratio >= 2 ? 'more than doubled' : ratio <= 0.5 ? 'halved or more' : null;
    out.push({
      key: h.key, itemName: h.itemName, prev, latest,
      pct: (delta / prev.unitPrice) * 100, delta, impact: delta * latest.qty,
      lowest, aboveLowestPct: lowest.unitPrice > 0 ? ((latest.unitPrice - lowest.unitPrice) / lowest.unitPrice) * 100 : 0,
      vendorChanged: prev.vendor !== latest.vendor, check,
    });
  }
  return out.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

/** Quoted lines next to the last price actually paid for the same item and unit. */
export interface QuoteCheck { line: OtLine; order: OtOrder; lastPaid: PricePoint | null; pct: number | null }

export function quoteChecks(lines: OtLine[], orders: OtOrder[], points: PricePoint[]): QuoteCheck[] {
  const orderById = new Map(orders.map(o => [o.id, o]));
  const lastByKeyUnit = new Map<string, PricePoint>();
  for (const p of points) lastByKeyUnit.set(p.key + '|' + p.unit, p);   // points are oldest-first
  return lines.filter(l => l.status === 'QUOTED' && num(l.unit_price) > 0 && orderById.get(l.order_id) && !orderById.get(l.order_id)!.archived_at)
    .map(l => {
      const lp = lastByKeyUnit.get(itemKey(l) + '|' + (l.unit || '').toLowerCase()) ?? null;
      return { line: l, order: orderById.get(l.order_id)!, lastPaid: lp, pct: lp && lp.unitPrice > 0 ? ((num(l.unit_price) - lp.unitPrice) / lp.unitPrice) * 100 : null };
    });
}

/** Spend per month (invoiced lines), optionally split by vendor. */
export function spendByMonth(points: PricePoint[], by: 'total' | 'vendor'): { months: string[]; groups: string[]; cells: Record<string, Record<string, number>>; totals: Record<string, number> } {
  const cells: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = {};
  const groupTotals = new Map<string, number>();
  for (const p of points) {
    const m = p.date.slice(0, 7);
    const g = by === 'vendor' ? p.vendor : 'Total';
    (cells[m] ??= {})[g] = (cells[m][g] ?? 0) + p.total;
    totals[m] = (totals[m] ?? 0) + p.total;
    groupTotals.set(g, (groupTotals.get(g) ?? 0) + p.total);
  }
  const months = Object.keys(totals).sort();
  const groups = [...groupTotals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  return { months, groups, cells, totals };
}

export interface InvoiceRow {
  invoiceNumber: string;
  date: string;
  vendor: string;
  orderNumbers: string[];
  lines: number;
  total: number;
  document: OtDocument | null;
}

/** One row per (vendor, invoice number) with its total and the stored PDF when there is one. */
export function invoiceRegister(points: PricePoint[], docs: OtDocument[]): InvoiceRow[] {
  const m = new Map<string, InvoiceRow>();
  for (const p of points) {
    if (!p.invoiceNumber) continue;
    const k = normText(p.vendor) + '|' + normText(p.invoiceNumber);
    const r = m.get(k) ?? { invoiceNumber: p.invoiceNumber, date: p.date, vendor: p.vendor, orderNumbers: [], lines: 0, total: 0, document: null };
    r.lines += 1; r.total += p.total;
    if (p.orderNumber && !r.orderNumbers.includes(p.orderNumber)) r.orderNumbers.push(p.orderNumber);
    if (p.date < r.date) r.date = p.date;
    m.set(k, r);
  }
  for (const r of m.values()) {
    // by vendor too: two vendors can both send an invoice "1001"
    r.document = docs.find(d => d.kind === 'invoice' && normText(d.doc_number) === normText(r.invoiceNumber) && sameVendor(d.vendor_name, r.vendor)) ?? null;
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function priceMovesCsv(rows: PriceMove[]): string {
  const head = ['Item', 'Vendor', 'Unit', 'Previous price', 'Previous invoice', 'Previous date', 'Latest price', 'Latest invoice', 'Latest date',
    'Change %', 'Change per unit', 'Qty on latest invoice', '$ impact', 'Lowest paid', 'Above lowest %', 'Check'];
  const out = [head.map(csvCell).join(',')];
  for (const m of rows) {
    out.push([m.itemName, m.latest.vendor, m.latest.unit, m.prev.unitPrice.toFixed(2), m.prev.invoiceNumber, m.prev.date,
      m.latest.unitPrice.toFixed(2), m.latest.invoiceNumber, m.latest.date, m.pct.toFixed(1), m.delta.toFixed(2), String(m.latest.qty),
      m.impact.toFixed(2), m.lowest.unitPrice.toFixed(2), m.aboveLowestPct.toFixed(1), m.check ?? ''].map(csvCell).join(','));
  }
  return out.join('\r\n');
}
