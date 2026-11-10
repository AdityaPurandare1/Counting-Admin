import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import { Card, Pill, Segment } from '@/components/atoms';
import { documentUrl, loadTracker, type TrackerData } from '@/lib/orderTrackerData';
import { DOC_KIND_LABEL, isoDay, itemLocation, lineTotal, orderVenueName, stockRows } from '@/lib/orderTracker';
import { viewOrderRows, type ViewFilter } from '@/lib/orderTrackerReadOnly';
import { StatusPill, errBox, fmtMoney, fmtQty, headRow, linkBtn, picker, rowBorder, shortDate, subTxt, tbl, td, tdNum, th, thR } from '@/components/orderTracker/shared';

/* v1.08 Order tracker (view) — purchasing:order-tracker-view (0167). A venue's people see their venues'
   orders (status, items, prices, ETA, tracking, the invoices and quotes) and the whole warehouse, and change
   nothing: orders still come in through purchasing's mail. The database decides what they see (kount_ot_scope);
   this page only reads. */

type Tab = 'orders' | 'warehouse';

export function OrderTrackerReadOnly({ user }: { user: AccessEntry }) {
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const [filter, setFilter] = useState<ViewFilter>({ show: 'open', venue: 'all', q: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const today = isoDay(new Date());

  const load = useCallback(async () => {
    try { setData(await loadTracker()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const venueName = useCallback((id: string | null) => orderVenueName(id, VENUES), []);
  const myVenues = user.venueIds === 'all' ? null : user.venueIds;
  const scopeText = myVenues ? (myVenues.length ? myVenues.map(venueName).join(', ') : 'no venue yet') : 'every venue';
  const rows = useMemo(() => (data ? viewOrderRows(data.orders, data.lines, filter) : []), [data, filter]);
  const venueChoices = useMemo(() => {
    const ids = new Set((data ? viewOrderRows(data.orders, data.lines, { ...filter, venue: 'all', q: '' }) : []).flatMap(r => r.venues));
    return [...ids].sort((a, b) => venueName(a).localeCompare(venueName(b)));
  }, [data, filter, venueName]);
  const stock = useMemo(() => (data ? stockRows(data.items, data.moves, data.lines, data.orders, today) : []), [data, today]);

  const openDoc = async (path: string) => {
    const w = window.open('', '_blank');
    try {
      const url = await documentUrl(path);
      if (w) w.location.href = url; else window.location.assign(url);
    } catch (e) {
      w?.close();
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="topbar">
        <div><div className="eyebrow">Purchasing</div><h1>Order tracker</h1></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginRight: 56 }}>
          <Pill tone="inform" size="sm">View only</Pill>
          <button type="button" style={{ ...picker, cursor: 'pointer' }} onClick={() => void load()}>Refresh</button>
        </div>
      </div>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
          Orders for {scopeText}, and the warehouse. View only: orders are placed and updated by purchasing.
        </div>
        {error && <div style={errBox}>{error}</div>}
        <div style={{ maxWidth: 260 }}>
          <Segment<Tab> options={[{ value: 'orders', label: 'Orders' }, { value: 'warehouse', label: 'Warehouse' }]} value={tab} onChange={setTab} />
        </div>

        {!data && !error && <Card><span style={{ color: 'var(--fg-muted)' }}>Loading…</span></Card>}

        {data && tab === 'orders' && (
          <Card padding={0}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: 12 }}>
              <div style={{ width: 180 }}>
                <Segment<'open' | 'all'> options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} value={filter.show}
                  onChange={v => setFilter(f => ({ ...f, show: v }))} />
              </div>
              {venueChoices.length > 1 && (
                <select aria-label="Venue" style={picker} value={filter.venue} onChange={e => setFilter(f => ({ ...f, venue: e.target.value }))}>
                  <option value="all">All my venues</option>
                  {venueChoices.map(id => <option key={id} value={id}>{venueName(id)}</option>)}
                </select>
              )}
              <input aria-label="Search orders" placeholder="Search order, vendor, item, tracking…" style={{ ...picker, minWidth: 240, flex: 1 }}
                value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} order{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead><tr style={headRow}><th style={th}>Order</th><th style={th}>Venue</th><th style={th}>Status</th><th style={th}>ETA</th><th style={thR}>Total</th><th style={th}>Updated</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr style={rowBorder}><td style={td} colSpan={6}><span style={{ color: 'var(--fg-muted)' }}>No orders{filter.show === 'open' ? ' open' : ''}.</span></td></tr>}
                  {rows.map(r => {
                    const isOpen = openId === r.o.id;
                    const docs = data.documents.filter(d => d.order_id === r.o.id && d.storage_path);
                    const tracks = data.tracking.filter(t => t.order_id === r.o.id);
                    return (
                      <Fragment key={r.o.id}>
                        <tr style={{ ...rowBorder, cursor: 'pointer', background: isOpen ? 'var(--off-200, #EFE7DF)' : undefined }} onClick={() => setOpenId(isOpen ? null : r.o.id)}>
                          <td style={td}><button type="button" style={linkBtn}>{r.o.order_number || 'No number'}</button><div style={subTxt}>{r.o.vendor_name}</div></td>
                          <td style={td}>{r.venues.length ? r.venues.map(venueName).join(', ') : venueName(r.o.venue_id)}</td>
                          <td style={td}><StatusPill status={r.status} /></td>
                          <td style={td}>{shortDate(r.eta)}</td>
                          <td style={tdNum}>{fmtMoney(r.total)}</td>
                          <td style={td}>{shortDate(r.last)}</td>
                        </tr>
                        {isOpen && (
                          <tr><td colSpan={6} style={{ padding: '4px 12px 16px', background: 'var(--off-200, #EFE7DF)' }}>
                            <table style={{ ...tbl, background: 'var(--surface)', borderRadius: 8 }}>
                              <thead><tr style={headRow}><th style={th}>Item</th><th style={thR}>Qty</th><th style={thR}>Unit price</th><th style={thR}>Total</th><th style={th}>Status</th><th style={th}>ETA</th><th style={th}>Tracking</th><th style={th}>Invoice</th></tr></thead>
                              <tbody>
                                {r.ls.map(l => (
                                  <tr key={l.id} style={rowBorder}>
                                    <td style={td}>{l.description}{l.sku && <div style={subTxt}>{l.sku}</div>}</td>
                                    <td style={tdNum}>{fmtQty(Number(l.qty) || 0)}{l.unit ? ` ${l.unit}` : ''}</td>
                                    <td style={tdNum}>{fmtMoney(l.unit_price)}</td>
                                    <td style={tdNum}>{fmtMoney(lineTotal(l))}</td>
                                    <td style={td}><StatusPill status={l.status} /></td>
                                    <td style={td}>{shortDate(l.expected_on ?? r.o.expected_on)}</td>
                                    <td style={td}>{l.tracking_number ?? '—'}</td>
                                    <td style={td}>{l.invoice_number ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5 }}>
                              <div><b>Tracking</b>: {tracks.length ? tracks.map(t => `${t.tracking_number}${t.carrier ? ` (${t.carrier})` : ''}`).join(', ') : 'none yet'}</div>
                              <div><b>Documents</b>: {docs.length ? docs.map((d, i) => (
                                <span key={d.id}>{i > 0 && ', '}<button type="button" style={linkBtn} onClick={() => void openDoc(d.storage_path!)}>
                                  {d.kind === 'payment' ? 'Payment stub' : DOC_KIND_LABEL[d.kind]}{d.doc_number ? ` ${d.doc_number}` : ''}</button></span>
                              )) : 'none'}</div>
                              {r.o.notes && <div><b>Notes</b>: {r.o.notes}</div>}
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {data && tab === 'warehouse' && (
          <Card padding={0}>
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead><tr style={headRow}><th style={th}>Item</th><th style={th}>Location</th><th style={thR}>On hand</th><th style={thR}>Used / month</th><th style={th}>Last count</th><th style={th}>Last received</th></tr></thead>
                <tbody>
                  {stock.length === 0 && <tr style={rowBorder}><td style={td} colSpan={6}><span style={{ color: 'var(--fg-muted)' }}>Nothing in the warehouse list.</span></td></tr>}
                  {stock.filter(s => s.item.is_active).map(s => (
                    <tr key={s.item.id} style={rowBorder}>
                      <td style={td}>{s.item.name}{s.item.sku && <div style={subTxt}>{s.item.sku}</div>}</td>
                      <td style={td}>{itemLocation(s.item)}</td>
                      <td style={tdNum}>{fmtQty(s.onHand)} {s.item.unit}</td>
                      <td style={tdNum}>{fmtQty(Math.round(s.monthlyUse * 10) / 10)}</td>
                      <td style={td}>{shortDate(s.lastCount?.moved_on)}</td>
                      <td style={td}>{shortDate(s.lastReceipt?.moved_on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
