import { Fragment, useEffect, useMemo, useState } from 'react';
import { Btn, Card, Pill, Segment } from '@/components/atoms';
import {
  ALL_STATUSES, MULTIPLE_VENUES, ORDER_SORTS, STATUS_LABEL, extractTracking, filterByVenue, headlineStatus, isLate, lineTotal, orderState, orderVenueIds, receivedForLine,
  sortOrders, statusRank, isoDay, trackingUrl,
  type LineStatus, type OrderSort, type OtLine, type OtOrder, type OrderState,
} from '@/lib/orderTracker';
import { addLines, addMove, addTracking, deleteLine, documentUrl, loadEvents, removeTracking, updateLine, updateOrder, type EventRow, type TrackerData } from '@/lib/orderTrackerData';
import { StatusPill, errBox, fmtMoney, fmtQty, headRow, linkBtn, picker, rowBorder, shortDate, smallInput, subTxt, tbl, td, tdNum, th, thR } from './shared';

type StateFilter = 'open' | 'completed' | 'all' | 'archived';

export function OrdersView({ data, today, venueName, onReload, focusOrderId }: {
  data: TrackerData; today: string; venueName: (id: string | null) => string; onReload: () => void; focusOrderId: string | null;
}) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<StateFilter>('open');
  const [vendor, setVendor] = useState('');
  const [venue, setVenue] = useState('');
  const [sort, setSort] = useState<OrderSort>('newest');
  const [open, setOpen] = useState<string | null>(focusOrderId);
  useEffect(() => { if (focusOrderId) setOpen(focusOrderId); }, [focusOrderId]);

  const linesByOrder = useMemo(() => {
    const m = new Map<string, OtLine[]>();
    for (const l of data.lines) (m.get(l.order_id) ?? m.set(l.order_id, []).get(l.order_id)!).push(l);
    for (const ls of m.values()) ls.sort((a, b) => a.sort - b.sort);
    return m;
  }, [data.lines]);
  const vendors = useMemo(() => [...new Set(data.orders.map(o => o.vendor_name))].sort(), [data.orders]);
  // the venues orders are for, by name (an order serving several counts for each)
  const venues = useMemo(() => [...new Set(data.orders.flatMap(o => orderVenueIds(o, linesByOrder.get(o.id) ?? [])))]
    .map(id => ({ id, name: venueName(id) })).sort((a, b) => a.name.localeCompare(b.name)), [data.orders, linesByOrder, venueName]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = data.orders.map(o => {
      const ls = linesByOrder.get(o.id) ?? [];
      return { o, ls, st: orderState(o, ls) as OrderState, head: headlineStatus(ls) };
    }).filter(r => {
      if (state !== 'all' && r.st !== state) return false;
      if (state === 'all' && r.st === 'archived') return false;
      if (vendor && r.o.vendor_name !== vendor) return false;
      if (!term) return true;
      const hay = [r.o.order_number, r.o.vendor_name, venueName(r.o.venue_id), ...r.ls.flatMap(l => [l.description, l.sku, l.invoice_number, l.quote_number, l.tracking_number]),
        ...data.tracking.filter(t => t.order_id === r.o.id).map(t => t.tracking_number)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(term);
    });
    return sortOrders(filterByVenue(list, venue), sort, venueName);
  }, [data.orders, data.tracking, linesByOrder, q, state, vendor, venue, sort, venueName]);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input style={{ ...picker, minWidth: 280 }} placeholder="Search order #, vendor, item, invoice #, tracking…" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ width: 360 }}>
          <Segment<StateFilter> value={state} onChange={setState} options={[
            { value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }, { value: 'archived', label: 'Archived' },
          ]} />
        </div>
        <select style={picker} value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Vendor">
          <option value="">All vendors</option>
          {vendors.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select style={picker} value={venue} onChange={e => setVenue(e.target.value)} aria-label="Venue">
          <option value="">All venues</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--fg-muted)' }}>Sort
          <select style={picker} value={sort} onChange={e => setSort(e.target.value as OrderSort)} aria-label="Sort orders">
            {ORDER_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} order{rows.length === 1 ? '' : 's'}</span>
      </div>

      <Card flush padding={0}>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
            {data.orders.length ? 'No orders match.' : 'No orders yet. Use "New order", or add a quote / invoice PDF.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...tbl, minWidth: 900 }}>
              <thead><tr style={headRow}>
                <th style={th}>Order</th><th style={th}>For</th><th style={th}>Status</th><th style={thR}>Lines</th>
                <th style={thR}>Total</th><th style={th}>Expected</th><th style={th}>Invoices</th>
              </tr></thead>
              <tbody>
                {rows.map(({ o, ls, st, head }) => {
                  const late = ls.some(l => isLate(l, o, today, receivedForLine(data.moves, l.id)));
                  const delivered = ls.filter(l => l.status !== 'CANCELLED' && statusRank(l.status) >= statusRank('DELIVERED')).length;
                  const live = ls.filter(l => l.status !== 'CANCELLED');
                  const invs = [...new Set(ls.map(l => l.invoice_number).filter(Boolean))];
                  const trk = data.tracking.filter(t => t.order_id === o.id);
                  return (
                    <Fragment key={o.id}>
                      <tr style={{ ...rowBorder, cursor: 'pointer', background: open === o.id ? 'var(--surface-alt)' : undefined }} onClick={() => setOpen(open === o.id ? null : o.id)}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{o.order_number || 'No order #'}</div>
                          <div style={subTxt}>{o.vendor_name} · {shortDate(o.ordered_on ?? o.created_at)}</div>
                        </td>
                        <td style={td}>{o.venue_id === MULTIPLE_VENUES ? orderVenueIds(o, ls).map(v => venueName(v)).join(', ') : o.venue_id ? venueName(o.venue_id) : 'Warehouse stock'}
                          <div style={subTxt}>{o.venue_id === MULTIPLE_VENUES ? `${orderVenueIds(o, ls).length} venues · ` : ''}delivers to {o.deliver_to}</div></td>
                        <td style={td}>
                          <StatusPill status={head} />
                          {st !== 'open' && <span style={{ marginLeft: 6 }}><Pill tone="ghost" size="sm">{st}</Pill></span>}
                          <div style={subTxt}>{delivered} of {live.length} delivered</div>
                        </td>
                        <td style={tdNum}>{ls.length}</td>
                        <td style={tdNum}>{fmtMoney(live.reduce((s, l) => s + lineTotal(l), 0))}</td>
                        <td style={td}>{shortDate(o.expected_on)}{late && <div><Pill tone="critical" size="sm">Late</Pill></div>}</td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {invs.length ? invs.join(', ') : <span style={{ color: 'var(--fg-muted)' }}>—</span>}
                          {trk.length > 0 && <div style={subTxt}>{trk.length} tracking # · {trk[trk.length - 1].carrier ?? 'carrier ?'}</div>}
                        </td>
                      </tr>
                      {open === o.id && (
                        <tr><td colSpan={7} style={{ padding: 0, background: 'var(--surface-alt)' }}>
                          <OrderDetail order={o} lines={ls} data={data} today={today} venueName={venueName} onReload={onReload} />
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function OrderDetail({ order, lines, data, today, venueName, onReload }: {
  order: OtOrder; lines: OtLine[]; data: TrackerData; today: string; venueName: (id: string | null) => string; onReload: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [recvQty, setRecvQty] = useState('');
  const [recvDate, setRecvDate] = useState(today);
  const [history, setHistory] = useState<EventRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLine, setNewLine] = useState({ description: '', sku: '', qty: '', unit: '', unitPrice: '', itemId: '' });
  const [newTracking, setNewTracking] = useState('');
  const tracking = data.tracking.filter(t => t.order_id === order.id);
  // numbers only on the lines (a shipping notice PDF, typed on a line) show as links too
  const lineTracking = [...new Set(lines.flatMap(l => (l.tracking_number ?? '').split(/[,;\s]+/)).map(x => x.trim().toUpperCase()).filter(x => x.length >= 8))]
    .filter(n => !tracking.some(t => t.tracking_number === n)).map(n => extractTracking(`tracking ${n}`)[0] ?? { number: n, carrier: null });
  const docs = data.documents.filter(d => d.order_id === order.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const itemById = useMemo(() => new Map(data.items.map(i => [i.id, i])), [data.items]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); onReload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const setStatus = (l: OtLine, s: LineStatus) => {
    if (statusRank(s) < statusRank(l.status) && l.status !== 'CANCELLED' &&
        !confirm(`Move "${l.description}" back from ${STATUS_LABEL[l.status]} to ${STATUS_LABEL[s]}?`)) return;
    void run(() => updateLine(l.id, { status: s }, { source: 'manual' }));
  };
  const saveField = (l: OtLine, field: 'invoice_number' | 'invoice_date' | 'tracking_number' | 'unit_price' | 'qty' | 'expected_on', raw: string) => {
    const v = raw.trim();
    const value = field === 'unit_price' || field === 'qty' ? (v === '' ? (field === 'qty' ? 0 : null) : Number(v)) : (v || null);
    if ((field === 'unit_price' || field === 'qty') && value !== null && !Number.isFinite(value as number)) { setErr('Not a number.'); return; }
    if ((l[field] ?? null) === value) return;
    void run(() => updateLine(l.id, { [field]: value } as Partial<OtLine>));
  };
  const receive = (l: OtLine) => {
    const qty = Number(recvQty);
    if (!Number.isFinite(qty) || qty <= 0) { setErr('Enter how many were received.'); return; }
    const got = receivedForLine(data.moves, l.id), left = Math.max(0, l.qty - got);
    if (qty > left + 1e-9) { setErr(`Only ${fmtQty(left)} left to receive on this line. If more arrived, raise the line's quantity first.`); return; }
    void run(async () => {
      await addMove({ item_id: l.item_id!, moved_on: recvDate || today, kind: 'receipt', qty, venue_id: null, line_id: l.id, note: `order ${order.order_number ?? ''}`.trim() });
      // received only once all of it is in; a part delivery leaves the status where it was
      if (got + qty >= l.qty - 1e-9 && statusRank(l.status) < statusRank('RECEIVED')) {
        await updateLine(l.id, { status: 'RECEIVED' }, { source: 'manual', note: 'received into warehouse' });
      }
      setReceiving(null);
    });
  };
  const openDoc = async (path: string | null) => {
    if (!path) return;
    try { window.open(await documentUrl(path), '_blank', 'noopener'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const addLine = () => {
    const qty = Number(newLine.qty);
    if (!newLine.description.trim() || !Number.isFinite(qty) || qty <= 0) { setErr('A new line needs a description and a quantity above 0.'); return; }
    void run(async () => {
      await addLines(order.id, [{
        item_id: newLine.itemId || null, description: newLine.description.trim(), sku: newLine.sku.trim() || null, qty,
        unit: newLine.unit.trim() || null, unit_price: newLine.unitPrice.trim() ? Number(newLine.unitPrice) : null,
        status: headlineStatus(lines) && headlineStatus(lines) !== 'CANCELLED' ? headlineStatus(lines)! : 'ORDERED',
      }], lines.length);
      setNewLine({ description: '', sku: '', qty: '', unit: '', unitPrice: '', itemId: '' }); setAddOpen(false);
    });
  };
  const st = orderState(order, lines);

  return (
    <div style={{ padding: '12px 14px 16px' }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12, color: 'var(--fg-secondary)' }}>
        <span><b>{order.vendor_name}</b></span>
        <span>For {order.venue_id === MULTIPLE_VENUES ? orderVenueIds(order, lines).map(v => venueName(v)).join(', ') : order.venue_id ? venueName(order.venue_id) : 'warehouse stock'} · delivers to {order.deliver_to}</span>
        <span>Ordered {shortDate(order.ordered_on)}</span>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Expected
          <input key={`${order.id}:${order.updated_at}:e`} type="date" style={smallInput} defaultValue={order.expected_on ?? ''} onBlur={e => { const v = e.target.value || null; if (v !== order.expected_on) void run(() => updateOrder(order.id, { expected_on: v })); }} />
        </label>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Order #
          <input key={`${order.id}:${order.updated_at}:n`} style={{ ...smallInput, width: 120 }} defaultValue={order.order_number ?? ''} onBlur={e => { const v = e.target.value.trim() || null; if (v !== order.order_number) void run(() => updateOrder(order.id, { order_number: v })); }} />
        </label>
        {order.notes && <span>Note: {order.notes}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, marginTop: 8 }}>
        <span style={{ color: 'var(--fg-muted)' }}>Tracking:</span>
        {tracking.length === 0 && lineTracking.length === 0 && <span style={{ color: 'var(--fg-muted)' }}>none yet</span>}
        {lineTracking.map(t => (
          <a key={t.number} href={trackingUrl(t)} target="_blank" rel="noopener noreferrer" style={{ padding: '2px 8px', borderRadius: 12, background: 'var(--surface)' }}>{t.carrier ? `${t.carrier} ` : ''}{t.number}</a>
        ))}
        {tracking.map(t => (
          <span key={t.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '2px 8px', borderRadius: 12, background: 'var(--surface)' }}
                title={[t.source === 'email' ? 'from email' : t.source, t.note, new Date(t.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}>
            <a href={trackingUrl({ number: t.tracking_number, carrier: t.carrier })} target="_blank" rel="noopener noreferrer">{t.carrier ? `${t.carrier} ` : ''}{t.tracking_number}</a>
            <button style={{ ...linkBtn, fontWeight: 400, textDecoration: 'none', color: 'var(--fg-muted)' }} disabled={busy} aria-label={`Remove ${t.tracking_number}`}
              onClick={() => { if (confirm(`Remove tracking ${t.tracking_number}?`)) void run(() => removeTracking(t.id)); }}>×</button>
          </span>
        ))}
        <input style={{ ...smallInput, width: 190 }} placeholder="add a tracking #" value={newTracking} onChange={e => setNewTracking(e.target.value)} />
        {newTracking.trim() && (
          <Btn variant="secondary" size="sm" disabled={busy} onClick={() => {
            const raw = newTracking.trim();
            const hits = extractTracking(`tracking ${raw}`);
            const numbers = hits.length ? hits : [{ number: raw.toUpperCase(), carrier: null }];
            void run(async () => { await addTracking(order.id, numbers, { source: 'manual', note: 'added by hand' }); setNewTracking(''); });
          }}>Add (marks it shipped)</Btn>
        )}
      </div>

      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <table style={{ ...tbl, minWidth: 1050, background: 'var(--surface)', borderRadius: 8 }}>
          <thead><tr style={headRow}>
            <th style={th}>Item</th><th style={thR}>Qty</th><th style={thR}>Unit price</th><th style={thR}>Total</th>
            <th style={th}>Status</th><th style={th}>Invoice # / date</th><th style={th}>Tracking</th><th style={th}>Warehouse</th><th style={th} />
          </tr></thead>
          <tbody>
            {lines.map(l => {
              const item = l.item_id ? itemById.get(l.item_id) : undefined;
              const tracked = !!item?.track_stock && order.deliver_to === 'warehouse';
              const got = tracked ? receivedForLine(data.moves, l.id) : 0;
              const left = Math.max(0, l.qty - got);
              return (
                <Fragment key={l.id}>
                  <tr style={rowBorder}>
                    <td style={{ ...td, maxWidth: 280 }}>
                      <div style={{ fontWeight: 600 }}>{item?.name ?? l.description}</div>
                      <div style={subTxt}>{[l.venue_id && order.venue_id === MULTIPLE_VENUES && venueName(l.venue_id), l.sku, l.quote_number && `quote ${l.quote_number}`, isLate(l, order, today, got) && 'late'].filter(Boolean).join(' · ') || ' '}</div>
                    </td>
                    <td style={tdNum}><input key={`${l.id}:${l.updated_at ?? ''}:q`} style={{ ...smallInput, width: 64, textAlign: 'right' }} defaultValue={fmtQty(l.qty)} onBlur={e => saveField(l, 'qty', e.target.value)} /> <span style={subTxt}>{l.unit ?? item?.unit ?? ''}</span></td>
                    <td style={tdNum}><input key={`${l.id}:${l.updated_at ?? ''}:p`} style={{ ...smallInput, width: 84, textAlign: 'right' }} defaultValue={l.unit_price ?? ''} placeholder="—" onBlur={e => saveField(l, 'unit_price', e.target.value)} /></td>
                    <td style={tdNum}>{l.unit_price != null ? fmtMoney(lineTotal(l)) : '—'}</td>
                    <td style={td}>
                      <select style={smallInput} value={l.status} disabled={busy} onChange={e => setStatus(l, e.target.value as LineStatus)}>
                        {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                      <div style={subTxt}>since {shortDate(l.status_at)}</div>
                    </td>
                    <td style={td}>
                      <input key={`${l.id}:${l.updated_at ?? ''}:i`} style={{ ...smallInput, width: 110 }} defaultValue={l.invoice_number ?? ''} placeholder="Invoice #" onBlur={e => saveField(l, 'invoice_number', e.target.value)} />
                      <div><input key={`${l.id}:${l.updated_at ?? ''}:d`} type="date" style={{ ...smallInput, width: 130, marginTop: 4 }} defaultValue={l.invoice_date ?? ''} onBlur={e => saveField(l, 'invoice_date', e.target.value)} /></div>
                    </td>
                    <td style={td}><input key={`${l.id}:${l.updated_at ?? ''}:t`} style={{ ...smallInput, width: 130 }} defaultValue={l.tracking_number ?? ''} placeholder="Tracking #" onBlur={e => saveField(l, 'tracking_number', e.target.value)} /></td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {!tracked ? <span style={{ color: 'var(--fg-muted)' }}>{order.deliver_to === 'venue' ? 'to venue' : item ? 'not stocked' : 'one-off'}</span> : (
                        <>
                          <div>{fmtQty(got)} of {fmtQty(l.qty)} received</div>
                          {left > 0 && l.status !== 'CANCELLED' && l.status !== 'REQUESTED' && (
                            <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => { setReceiving(l.id); setRecvQty(fmtQty(left)); setRecvDate(today); }}>Receive</button>
                          )}
                        </>
                      )}
                    </td>
                    <td style={td}>
                      <button style={{ ...linkBtn, fontWeight: 400, fontSize: 12, color: 'var(--fg-muted)' }} disabled={busy}
                        onClick={() => { if (confirm(`Remove "${l.description}" from this order?`)) void run(() => deleteLine(l.id)); }}>Remove</button>
                    </td>
                  </tr>
                  {receiving === l.id && (
                    <tr><td colSpan={9} style={{ ...td, background: 'var(--teal-100)' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                        Receive into the warehouse:
                        <input style={{ ...smallInput, width: 80 }} inputMode="decimal" value={recvQty} onChange={e => setRecvQty(e.target.value)} />
                        {l.unit ?? item?.unit ?? ''} on
                        <input type="date" style={smallInput} value={recvDate} onChange={e => setRecvDate(e.target.value)} />
                        <Btn variant="primary" size="sm" onClick={() => receive(l)} disabled={busy}>Receive</Btn>
                        <Btn variant="ghost" size="sm" onClick={() => setReceiving(null)}>Cancel</Btn>
                        <span style={{ color: 'var(--fg-muted)' }}>Adds to on-hand stock; the line is marked received once all of it is in.</span>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {addOpen ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <select style={{ ...picker, width: 190 }} value={newLine.itemId} onChange={e => {
            const it = data.items.find(i => i.id === e.target.value);
            setNewLine(n => ({ ...n, itemId: e.target.value, description: it?.name ?? n.description, sku: it?.sku ?? n.sku, unit: it?.unit ?? n.unit }));
          }}>
            <option value="">One-off line…</option>
            {data.items.filter(i => i.is_active).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input style={{ ...picker, minWidth: 220 }} placeholder="Description" value={newLine.description} onChange={e => setNewLine(n => ({ ...n, description: e.target.value }))} />
          <input style={{ ...picker, width: 100 }} placeholder="SKU" value={newLine.sku} onChange={e => setNewLine(n => ({ ...n, sku: e.target.value }))} />
          <input style={{ ...picker, width: 70 }} placeholder="Qty" inputMode="decimal" value={newLine.qty} onChange={e => setNewLine(n => ({ ...n, qty: e.target.value }))} />
          <input style={{ ...picker, width: 70 }} placeholder="Unit" value={newLine.unit} onChange={e => setNewLine(n => ({ ...n, unit: e.target.value }))} />
          <input style={{ ...picker, width: 100 }} placeholder="Unit price" inputMode="decimal" value={newLine.unitPrice} onChange={e => setNewLine(n => ({ ...n, unitPrice: e.target.value }))} />
          <Btn variant="primary" size="sm" onClick={addLine} disabled={busy}>Add</Btn>
          <Btn variant="ghost" size="sm" onClick={() => setAddOpen(false)}>Cancel</Btn>
        </div>
      ) : null}

      {err && <div style={errBox}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {!addOpen && <Btn variant="secondary" size="sm" onClick={() => setAddOpen(true)}>Add line</Btn>}
        {st === 'open' && <Btn variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => updateOrder(order.id, { completed_at: new Date().toISOString() }))}>Mark complete</Btn>}
        {st === 'completed' && order.completed_at && <Btn variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => updateOrder(order.id, { completed_at: null }))}>Reopen</Btn>}
        {st !== 'archived'
          ? <Btn variant="ghost" size="sm" disabled={busy} onClick={() => { if (confirm('Archive this order? Use it for orders that were never real (tests, duplicates). It leaves every total and the report.')) void run(() => updateOrder(order.id, { archived_at: new Date().toISOString() })); }}>Archive</Btn>
          : <Btn variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => updateOrder(order.id, { archived_at: null }))}>Un-archive</Btn>}
        <Btn variant="ghost" size="sm" onClick={async () => { try { setHistory(history ? null : await loadEvents(order.id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }}>
          {history ? 'Hide history' : 'History'}
        </Btn>
        <div style={{ flex: 1 }} />
        {docs.length > 0 && <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Documents:</span>}
        {docs.map(d => (
          <button key={d.id} style={{ ...linkBtn, fontSize: 12 }} onClick={() => void openDoc(d.storage_path)} title={d.file_name ?? ''}>
            {d.kind === 'payment' ? 'check stub' : d.kind} {d.doc_number ?? ''} ({shortDate(d.doc_date ?? d.created_at)})
          </button>
        ))}
      </div>

      {history && (
        <div style={{ marginTop: 10, fontSize: 12, background: 'var(--surface)', borderRadius: 8, padding: '8px 12px' }}>
          {history.length === 0 && <div style={{ color: 'var(--fg-muted)' }}>No status changes yet.</div>}
          {history.map(ev => {
            const l = lines.find(x => x.id === ev.line_id);
            return (
              <div key={ev.id} style={{ padding: '3px 0' }}>
                <span style={{ color: 'var(--fg-muted)' }}>{new Date(ev.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                {' · '}{l?.description ?? (ev.line_id ? 'line' : 'a removed line')}: {ev.from_status ? `${STATUS_LABEL[ev.from_status as LineStatus] ?? ev.from_status} → ` : ''}<b>{STATUS_LABEL[ev.to_status as LineStatus] ?? ev.to_status}</b>
                {ev.source === 'document' ? ' (from a document)' : ''}{ev.note ? ` — ${ev.note}` : ''}
                <span style={{ color: 'var(--fg-muted)' }}> {ev.by_email ?? ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Today in local time (exported for the screen). */
export const todayIso = () => isoDay(new Date());
