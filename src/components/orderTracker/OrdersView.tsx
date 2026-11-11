import { useEffect, useMemo, useState } from 'react';
import {
  ORDER_SORTS, awaitingApproval, filterByVenue, headlineStatus, isLate, isoDay, lineTotal, orderState, orderVenueIds, receivedForLine, sortOrders, MULTIPLE_VENUES,
  type OrderSort, type OrderState, type OtDocument, type OtLine,
} from '@/lib/orderTracker';
import { FULFILLMENT, fulfillmentOf, fulfillmentStep, lastUpdate, nextEta, orderCategory, paymentOf, stubsToGet, timeAgo, type PaymentView } from '@/lib/orderTrackerView';
import type { TrackerData } from '@/lib/orderTrackerData';
import { orderTiming, timingText } from '@/lib/leadTime';
import { quoteBibleChecks, quoteBibleSummary } from '@/lib/quoteBible';
import { fmtMoney, shortDate } from './shared';
import { OrderDrawer } from './OrderDrawer';
import type { ThreadMail } from '@/lib/quoteApprovalMail';
import { DocChips, DocViewer, Icon, docSort, isOtherDoc, latestByName } from './ui';

type StateFilter = 'open' | 'completed' | 'all' | 'archived';
/** A KPI tile clicked: the list it stands for (n makes a second click on the same tile count). */
export interface OrdersPreset { key: 'open' | 'late' | 'onorder' | 'invoiced' | 'approve'; n: number }

const FUL_TONE: Record<string, string> = { 'In production': 'info', Shipped: 'info', Delivered: 'ok', Received: 'ok' };
const PAY_TONE: Record<PaymentView['state'], string> = { none: '', unpaid: 'warn', part: 'warn', paid: 'ok' };

export function OrdersView({ data, today, venueName, onReload, focusOrderId, preset, newNonce, mails, me }: {
  data: TrackerData; today: string; venueName: (id: string | null) => string; onReload: () => void;
  focusOrderId: string | null; preset: OrdersPreset | null; newNonce: number;
  /** for the quote approval e-mail (v1.11): the Inbox's e-mails and who is signed in */
  mails?: ThreadMail[]; me?: { email: string; name?: string | null };
}) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<StateFilter>('open');
  const [vendor, setVendor] = useState('');
  const [venue, setVenue] = useState('');
  const [sort, setSort] = useState<OrderSort>('newest');
  const [lateOnly, setLateOnly] = useState(false);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [approveOnly, setApproveOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(focusOrderId);
  const [viewing, setViewing] = useState<OtDocument | null>(null);
  useEffect(() => { if (focusOrderId) setOpenId(focusOrderId); }, [focusOrderId]);
  useEffect(() => { if (newNonce) setOpenId('new'); }, [newNonce]);
  useEffect(() => {
    if (!preset) return;
    setState('open'); setQ(''); setLateOnly(preset.key === 'late'); setUnpaidOnly(preset.key === 'invoiced'); setApproveOnly(preset.key === 'approve');
  }, [preset]);

  const linesByOrder = useMemo(() => {
    const m = new Map<string, OtLine[]>();
    for (const l of data.lines) (m.get(l.order_id) ?? m.set(l.order_id, []).get(l.order_id)!).push(l);
    for (const ls of m.values()) ls.sort((a, b) => a.sort - b.sort);
    return m;
  }, [data.lines]);
  // each open order's quoted lines against its venue's bible (v1.07)
  const bibleChecks = useMemo(() => quoteBibleChecks(data.orders, data.lines, data.bibles), [data.orders, data.lines, data.bibles]);
  const docsByOrder = useMemo(() => {
    const m = new Map<string, OtDocument[]>();
    for (const d of data.documents) if (d.order_id) (m.get(d.order_id) ?? m.set(d.order_id, []).get(d.order_id)!).push(d);
    for (const ds of m.values()) ds.sort(docSort);
    return m;
  }, [data.documents]);
  const vendors = useMemo(() => [...new Set(data.orders.map(o => o.vendor_name))].sort(), [data.orders]);
  // paid invoices with no check stub, per order (reprint them from R365 — Overview lists them by payment)
  const noStub = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of stubsToGet(data.orders, data.lines, data.documents).needs) m.set(n.orderId, (m.get(n.orderId) ?? 0) + 1);
    return m;
  }, [data.orders, data.lines, data.documents]);
  // the venues orders are for, by name (an order serving several counts for each)
  const venues = useMemo(() => [...new Set(data.orders.flatMap(o => orderVenueIds(o, linesByOrder.get(o.id) ?? [])))]
    .map(id => ({ id, name: venueName(id) })).sort((a, b) => a.name.localeCompare(b.name)), [data.orders, linesByOrder, venueName]);

  const all = useMemo(() => data.orders.map(o => {
    const ls = linesByOrder.get(o.id) ?? [];
    return { o, ls, st: orderState(o, ls) as OrderState, pay: paymentOf(ls, today),
      late: ls.filter(l => isLate(l, o, today, receivedForLine(data.moves, l.id))).length,
      toApprove: o.archived_at || o.completed_at ? 0 : ls.filter(awaitingApproval).length, bible: bibleChecks.get(o.id) ?? null };
  }), [data.orders, data.moves, linesByOrder, today, bibleChecks]);
  const counts = useMemo(() => ({
    open: all.filter(r => r.st === 'open').length, completed: all.filter(r => r.st === 'completed').length,
    all: all.filter(r => r.st !== 'archived').length, archived: all.filter(r => r.st === 'archived').length,
  }), [all]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = all.filter(r => {
      if (state !== 'all' && r.st !== state) return false;
      if (state === 'all' && r.st === 'archived') return false;
      if (vendor && r.o.vendor_name !== vendor) return false;
      if (lateOnly && !r.late) return false;
      if (unpaidOnly && r.pay.state !== 'unpaid') return false;
      if (approveOnly && !r.toApprove) return false;
      if (!term) return true;
      const hay = [r.o.order_number, r.o.vendor_name, venueName(r.o.venue_id), ...r.ls.flatMap(l => [l.description, l.sku, l.invoice_number, l.quote_number, l.tracking_number]),
        ...data.tracking.filter(t => t.order_id === r.o.id).map(t => t.tracking_number), ...(docsByOrder.get(r.o.id) ?? []).flatMap(d => [d.doc_number, d.file_name])]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(term);
    });
    return sortOrders(filterByVenue(list, venue), sort, venueName);
  }, [all, data.tracking, docsByOrder, q, state, vendor, venue, sort, lateOnly, unpaidOnly, approveOnly, venueName]);

  const clearFilters = () => { setQ(''); setVendor(''); setVenue(''); setLateOnly(false); setUnpaidOnly(false); setApproveOnly(false); setState('all'); };
  const toApproveCount = all.filter(r => r.toApprove > 0).length;
  const now = Date.now();
  const openOrder = openId && openId !== 'new' ? data.orders.find(o => o.id === openId) ?? null : null;

  return (
    <>
      <div className="ot-toolbar">
        <label className="ot-search"><Icon name="search" />
          <input type="search" placeholder="Search order #, vendor, item, invoice #, tracking, file" value={q} onChange={e => setQ(e.target.value)} aria-label="Search orders" />
        </label>
        <div className="ot-seg" role="group" aria-label="Order status">
          {([['open', 'Open'], ['completed', 'Completed'], ['all', 'All'], ['archived', 'Archived']] as Array<[StateFilter, string]>).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={state === k} onClick={() => setState(k)}>{l}<span className="n">{counts[k]}</span></button>
          ))}
        </div>
        <select className="ot-sel" value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Vendor">
          <option value="">All vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="ot-sel" value={venue} onChange={e => setVenue(e.target.value)} aria-label="Venue">
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className="ot-sel" value={sort} onChange={e => setSort(e.target.value as OrderSort)} aria-label="Sort orders" title="Sort">
          {ORDER_SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
        </select>
        {lateOnly && <span className="ot-fchip">Late lines only<button type="button" onClick={() => setLateOnly(false)} aria-label="Clear late filter"><Icon name="x" /></button></span>}
        {unpaidOnly && <span className="ot-fchip warn">Invoiced, not paid<button type="button" onClick={() => setUnpaidOnly(false)} aria-label="Clear unpaid filter"><Icon name="x" /></button></span>}
        {approveOnly ? <span className="ot-fchip warn">Quotes to approve<button type="button" onClick={() => setApproveOnly(false)} aria-label="Clear the quotes-to-approve filter"><Icon name="x" /></button></span>
          : toApproveCount > 0 && <button type="button" className="ot-btn sm" onClick={() => { setApproveOnly(true); setState('open'); }} title="Quoted lines with no approval e-mail to the vendor yet">Quotes to approve <span className="num">{toApproveCount}</span></button>}
        <span className="ot-count num">{rows.length} order{rows.length === 1 ? '' : 's'}</span>
      </div>

      <div className="ot-card">
        {!data.orders.length ? (
          <div className="ot-empty"><h3>No orders yet</h3><p>Start one with New order, or add a quote or invoice PDF and save it as an order.</p></div>
        ) : !rows.length ? (
          <div className="ot-empty"><h3>No orders match</h3><p>Try another status, vendor or venue, or clear the search.</p>
            <button type="button" className="ot-btn" onClick={clearFilters}>Clear filters</button></div>
        ) : (
          <div className="ot-table-wrap">
            <table className="ot-tbl">
              <thead><tr>
                <th>Order</th><th>Venue</th><th>Fulfillment</th><th>Payment</th><th className="r">Lines</th><th>Sent</th><th>Next ETA</th><th className="r">Value</th>
                <th>Documents</th><th>Other</th><th className="r">Updated</th>
              </tr></thead>
              <tbody>
                {rows.map(({ o, ls, st, pay, late, toApprove, bible }) => {
                  const head = headlineStatus(ls);
                  const ful = fulfillmentOf(head);
                  const step = fulfillmentStep(head);
                  const eta = nextEta(o, ls);
                  const timing = orderTiming(o, ls, today);
                  const liveLines = ls.filter(l => l.status !== 'CANCELLED');
                  const docs = docsByOrder.get(o.id) ?? [];
                  const vIds = o.venue_id === MULTIPLE_VENUES ? orderVenueIds(o, ls) : [];
                  return (
                    <tr key={o.id} className={`click${openId === o.id ? ' sel' : ''}`} tabIndex={0} onClick={() => setOpenId(o.id)}
                      onKeyDown={e => { if (e.key === 'Enter') setOpenId(o.id); }}>
                      <td><div className="t1">{o.vendor_name}</div><div className="t2 mono">{o.order_number || '—'}</div>
                        {toApprove > 0 && <span className="ot-pill warn" title="Quoted, and no e-mail to the vendor approving it yet">Approve quote</span>}
                        {bible && (bible.ok ? <span className="ot-pill ok" title={quoteBibleSummary(bible, venueName).sub}>In bible</span>
                          : bible.off.some(x => x.state !== 'no-bible') && <span className="ot-pill warn" title={quoteBibleSummary(bible, venueName).sub}>Check bible</span>)}</td>
                      <td className="venue">{o.venue_id === MULTIPLE_VENUES ? vIds.map(v => venueName(v)).join(', ') : o.venue_id ? venueName(o.venue_id) : 'Warehouse stock'}
                        <div className="t2">{[orderCategory(o.order_number), st !== 'open' && st,
                          o.deliver_to === 'venue' && ls.some(l => l.deliver_to === 'warehouse' && l.status !== 'CANCELLED') && 'sea part to the warehouse'].filter(Boolean).join(' · ') || (o.deliver_to === 'warehouse' ? 'to the warehouse' : 'to the venue')}</div></td>
                      <td>
                        {ful ? <span className={`ot-pill ${FUL_TONE[ful] ?? ''}`}>{ful}</span> : <span className="faint">No lines</span>}
                        {step >= 0 && <div className="ot-steps" aria-hidden="true">{FULFILLMENT.map((f, i) =>
                          <i key={f} className={i < step || (i === step && i === FULFILLMENT.length - 1) ? 'done' : i === step ? 'on' : ''} />)}</div>}
                      </td>
                      <td>
                        <span className={`ot-pill ${PAY_TONE[pay.state]}`}>{pay.label}</span>
                        {pay.invoices.length > 0 && <div className="t2 mono" title={pay.invoices.join(', ')}>{pay.invoices[0]}{pay.invoices.length > 1 ? ` +${pay.invoices.length - 1}` : ''}</div>}
                        {noStub.get(o.id) ? <div className="t2" style={{ color: 'var(--ot-warn)' }}>no check stub{noStub.get(o.id)! > 1 ? ` (${noStub.get(o.id)})` : ''}</div> : null}
                        {pay.state === 'unpaid' && pay.oldestDays != null && <div className="t2">{pay.oldestDays ? `${pay.oldestDays} day${pay.oldestDays === 1 ? '' : 's'} waiting` : 'invoiced today'}</div>}
                      </td>
                      <td className="r num">{ls.length}{late > 0 && <span className="ot-pill crit" style={{ marginLeft: 6 }}>{late} late</span>}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }} title={timing.approx ? 'An estimate: the PO date or an ETA stands in for a day not known' : undefined}>
                        {timing.sentOn ? shortDate(timing.sentOn) : <span className="faint">—</span>}
                        {timing.state !== 'unsent' && <div className="t2" style={timing.state === 'open' && (timing.days ?? 0) >= 42 ? { color: 'var(--ot-warn)' } : undefined}>{timingText(timing)}</div>}
                      </td>
                      <td className="num" style={eta && eta < today && late ? { color: 'var(--ot-crit)', fontWeight: 600 } : undefined}>{eta ? shortDate(eta) : <span className="faint">—</span>}</td>
                      <td className="r num">{fmtMoney(liveLines.reduce((s, l) => s + lineTotal(l), 0))}</td>
                      <td><DocChips docs={docs.filter(d => !isOtherDoc(d))} onOpen={setViewing} /></td>
                      <td><DocChips docs={latestByName(docs.filter(isOtherDoc))} onOpen={setViewing} max={2} /></td>
                      <td className="r t2" style={{ whiteSpace: 'nowrap' }}>{timeAgo(lastUpdate(o, ls), now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && (openId === 'new' || openOrder) && (
        <OrderDrawer key={openId} order={openOrder} lines={openOrder ? linesByOrder.get(openOrder.id) ?? [] : []} docs={openOrder ? docsByOrder.get(openOrder.id) ?? [] : []}
          data={data} today={today} venueName={venueName} onClose={() => setOpenId(null)} onReload={onReload} onOpenDoc={setViewing} mails={mails} me={me}
          onCreated={id => { setState('open'); setOpenId(id); onReload(); }} />
      )}
      {viewing && <DocViewer doc={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** Today in local time (exported for the screen). */
export const todayIso = () => isoDay(new Date());
