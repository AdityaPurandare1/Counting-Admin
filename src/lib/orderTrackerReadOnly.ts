/* v1.08 Order tracker (view) — the read-only page for the purchasing:order-tracker-view permission (migration
   0167). The database hands such a person only their venues' orders, lines, documents and tracking (and the
   whole warehouse); this turns those rows into the page's list. Nothing here writes. */

import { headlineStatus, lineTotal, orderState, orderVenueIds, type LineStatus, type OtLine, type OtOrder } from './orderTracker';
import { lastUpdate, nextEta } from './orderTrackerView';

export interface ViewOrderRow {
  o: OtOrder;
  /** the order's lines the person can see, in the order's own order */
  ls: OtLine[];
  status: LineStatus | null;
  eta: string | null;
  /** the visible lines' value, cancelled lines left out */
  total: number;
  last: string;
  venues: string[];
  open: boolean;
}

export interface ViewFilter { show: 'open' | 'all'; venue: string; q: string }

/** Orders newest-updated first: archived ones never, completed ones only when asked for, one venue or all,
 *  and a search over the order number, vendor and each line's text, SKU, invoice and tracking number. */
export function viewOrderRows(orders: OtOrder[], lines: OtLine[], f: ViewFilter): ViewOrderRow[] {
  const byOrder = new Map<string, OtLine[]>();
  for (const l of lines) (byOrder.get(l.order_id) ?? byOrder.set(l.order_id, []).get(l.order_id)!).push(l);
  const q = f.q.trim().toLowerCase();
  return orders
    .filter(o => !o.archived_at)
    .map(o => {
      const ls = (byOrder.get(o.id) ?? []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      return {
        o, ls,
        status: headlineStatus(ls),
        eta: nextEta(o, ls),
        total: ls.filter(l => l.status !== 'CANCELLED').reduce((s, l) => s + lineTotal(l), 0),
        last: lastUpdate(o, ls),
        venues: orderVenueIds(o, ls),
        open: orderState(o, ls) === 'open',
      };
    })
    .filter(r => f.show === 'all' || r.open)
    .filter(r => f.venue === 'all' || r.venues.includes(f.venue))
    .filter(r => !q || [r.o.order_number, r.o.vendor_name, ...r.ls.flatMap(l => [l.description, l.sku, l.invoice_number, l.tracking_number])]
      .some(s => (s ?? '').toLowerCase().includes(q)))
    .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''));
}
