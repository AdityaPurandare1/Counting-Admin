import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import { Btn, Card, Eyebrow, Pill, Segment } from '@/components/atoms';
import {
  STATUSES, STATUS_LABEL, isLate, isoDay, lineTotal, orderState, receivedForLine, statusRank, stockRows,
  type OtLine,
} from '@/lib/orderTracker';
import { loadTracker, type TrackerData } from '@/lib/orderTrackerData';
import { buildReportWorkbook } from '@/lib/orderTrackerReport';
import { NewOrderForm } from '@/components/orderTracker/NewOrderForm';
import { OrdersView } from '@/components/orderTracker/OrdersView';
import { WarehouseView } from '@/components/orderTracker/WarehouseView';
import { DocumentReview } from '@/components/orderTracker/DocumentReview';
import { StatusPill, download, errBox, fmtCompact, fmtMoney, headRow, linkBtn, rowBorder, shortDate, subTxt, tbl, td, tdNum, th, thR } from '@/components/orderTracker/shared';

/* ───────────────────────────────────────────────────────────────────────
   Order tracker (v0.79) — Purchasing section, admin + corporate only.

   Orders for custom / OS&E items through the line lifecycle (quoted →
   ordered → confirmed → in production → shipped → delivered → invoiced →
   paid), quote / confirmation / invoice / shipping PDFs read by AI and
   applied after review, warehouse stock that delivered orders fill and venue
   releases draw down, and an Excel report of all of it. Logic lives in
   src/lib/orderTracker*.ts; tables are kount_ot_* (migration 0132).
   ─────────────────────────────────────────────────────────────────────── */

type View = 'orders' | 'warehouse' | 'overview';

export function OrderTracker({ today: todayProp, load = loadTracker }: { user: AccessEntry; today?: Date; load?: () => Promise<TrackerData> }) {
  const today = useMemo(() => isoDay(todayProp ?? new Date()), [todayProp]);
  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('orders');
  const [newOpen, setNewOpen] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [focusOrder, setFocusOrder] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const s = ++seq.current;
    setLoading(true);
    try {
      const d = await load();
      if (s === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (s === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (s === seq.current) setLoading(false); }
  }, [load]);
  useEffect(() => { void reload(); }, [reload]);

  const venueName = useCallback((id: string | null) => (id ? VENUES.find(v => v.id === id)?.name ?? id : 'Warehouse'), []);

  const downloadReport = async () => {
    if (!data) return;
    setReportBusy(true);
    try {
      const buf = await buildReportWorkbook({ ...data, venueName, today, includeClosed });
      download(`Order tracker report ${today}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      setError('Report not built: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setReportBusy(false); }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Purchasing</Eyebrow>
          <h1>Order tracker</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Orders for custom and operating supplies from quote to paid, the stock they put in the warehouse, and what venues draw from it.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn variant="primary" size="sm" onClick={() => { setNewOpen(o => !o); setDocFile(null); }}>{newOpen ? 'Close' : 'New order'}</Btn>
          <Btn variant="secondary" size="sm" onClick={() => fileRef.current?.click()} title="A quote, order confirmation, invoice or shipping notice (PDF)">Add a document</Btn>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setDocFile(f); setNewOpen(false); } }} />
          <Btn variant="secondary" size="sm" onClick={() => void downloadReport()} disabled={!data || reportBusy}>{reportBusy ? 'Building…' : 'Download report (Excel)'}</Btn>
          <label style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }} title="Include completed orders in the report">
            <input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} /> with completed
          </label>
        </div>
      </div>

      <div className="content">
        {error && <div style={errBox}>{error}{/relation .*kount_ot_|does not exist/i.test(error) && <div style={{ marginTop: 4 }}>The order tracker tables (migration 0132) are not applied yet.</div>}</div>}
        {loading && !data && <Pill tone="neutral" size="sm">loading…</Pill>}

        {data && newOpen && (
          <NewOrderForm items={data.items} orders={data.orders} onCancel={() => setNewOpen(false)}
            onSaved={o => { setNewOpen(false); setFocusOrder(o.id); setView('orders'); void reload(); }} />
        )}
        {data && docFile && (
          <DocumentReview key={docFile.name + docFile.size + docFile.lastModified} file={docFile} data={data} today={today}
            onCancel={() => setDocFile(null)}
            onDone={orderId => { setDocFile(null); setFocusOrder(orderId); setView('orders'); void reload(); }} />
        )}

        {data && (
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
            <Tiles data={data} today={today} />
            <div style={{ maxWidth: 420, margin: '16px 0 14px' }}>
              <Segment<View> value={view} onChange={setView} options={[
                { value: 'orders', label: 'Orders' }, { value: 'warehouse', label: 'Warehouse' }, { value: 'overview', label: 'Overview' },
              ]} />
            </div>
            {view === 'orders' && <OrdersView data={data} today={today} venueName={venueName} onReload={() => void reload()} focusOrderId={focusOrder} />}
            {view === 'warehouse' && <WarehouseView data={data} today={today} venueName={venueName} onReload={() => void reload()} />}
            {view === 'overview' && <Overview data={data} today={today} venueName={venueName} onOpen={id => { setFocusOrder(id); setView('orders'); }} />}
          </div>
        )}
      </div>
    </>
  );
}

function Tiles({ data, today }: { data: TrackerData; today: string }) {
  const s = useMemo(() => {
    const byOrder = new Map<string, OtLine[]>();
    for (const l of data.lines) (byOrder.get(l.order_id) ?? byOrder.set(l.order_id, []).get(l.order_id)!).push(l);
    const open = data.orders.filter(o => orderState(o, byOrder.get(o.id) ?? []) === 'open');
    const openLines = open.flatMap(o => (byOrder.get(o.id) ?? []).filter(l => l.status !== 'CANCELLED'));
    const late = open.flatMap(o => (byOrder.get(o.id) ?? []).filter(l => isLate(l, o, today, receivedForLine(data.moves, l.id))));
    const onOrder$ = openLines.filter(l => statusRank(l.status) < statusRank('DELIVERED') && l.status !== 'QUOTED').reduce((a, l) => a + lineTotal(l), 0);
    // archived orders were never real (tests, duplicates): they leave every total
    const live = new Set(data.orders.filter(o => !o.archived_at).map(o => o.id));
    const unpaid$ = data.lines.filter(l => l.status === 'INVOICED' && live.has(l.order_id)).reduce((a, l) => a + lineTotal(l), 0);
    const stock = stockRows(data.items, data.moves, data.lines, data.orders, today);
    return { open: open.length, openLines: openLines.length, late: late.length, onOrder$, unpaid$,
      reorder: stock.filter(r => r.state === 'reorder now').length, soon: stock.filter(r => r.state === 'reorder soon').length };
  }, [data, today]);
  const tile = (label: string, value: string, sub: string, tone?: 'up') => (
    <Card padding={14}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: tone === 'up' ? 'var(--raspberry-300)' : 'var(--fg-primary)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--fg-secondary)', marginTop: 2 }}>{sub}</div>
    </Card>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
      {tile('Open orders', String(s.open), `${s.openLines} lines`)}
      {tile('Late lines', String(s.late), s.late ? 'past their expected date' : 'nothing overdue', s.late ? 'up' : undefined)}
      {tile('On order', fmtCompact(s.onOrder$), 'ordered, not delivered yet')}
      {tile('Invoiced, not paid', fmtCompact(s.unpaid$), 'lines at Invoiced')}
      {tile('Warehouse', s.reorder ? `${s.reorder} to reorder` : 'OK', s.soon ? `${s.soon} more within 30 days` : 'no reorders due soon', s.reorder ? 'up' : undefined)}
    </div>
  );
}

function Overview({ data, today, venueName, onOpen }: { data: TrackerData; today: string; venueName: (id: string | null) => string; onOpen: (orderId: string) => void }) {
  const byOrder = useMemo(() => {
    const m = new Map<string, OtLine[]>();
    for (const l of data.lines) (m.get(l.order_id) ?? m.set(l.order_id, []).get(l.order_id)!).push(l);
    return m;
  }, [data.lines]);
  const live = data.orders.filter(o => !o.archived_at);
  const liveLines = live.flatMap(o => byOrder.get(o.id) ?? []).filter(l => l.status !== 'CANCELLED');
  const funnel = STATUSES.map(s => {
    const ls = liveLines.filter(l => l.status === s);
    return { s, n: ls.length, v: ls.reduce((a, l) => a + lineTotal(l), 0) };
  });
  const maxN = Math.max(1, ...funnel.map(f => f.n));
  const late = live.flatMap(o => (byOrder.get(o.id) ?? []).filter(l => isLate(l, o, today, receivedForLine(data.moves, l.id))).map(l => ({ o, l })))
    .sort((a, b) => (a.l.expected_on ?? a.o.expected_on ?? '').localeCompare(b.l.expected_on ?? b.o.expected_on ?? ''));
  const recent = [...data.lines].sort((a, b) => b.status_at.localeCompare(a.status_at)).slice(0, 12);
  const orderById = new Map(data.orders.map(o => [o.id, o]));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Card padding={16}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Where every line is</div>
        {funnel.map(f => (
          <div key={f.s} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 70px 110px', gap: 10, alignItems: 'center', padding: '4px 0' }}>
            <StatusPill status={f.s} />
            <div style={{ background: 'var(--surface-alt)', borderRadius: 4, height: 10 }}>
              <div style={{ width: `${(f.n / maxN) * 100}%`, height: 10, borderRadius: 4, background: 'var(--dark-600)' }} />
            </div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.n} line{f.n === 1 ? '' : 's'}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-secondary)' }}>{fmtMoney(f.v)}</div>
          </div>
        ))}
      </Card>

      <Card flush padding={0}>
        <div style={{ padding: '12px 14px', fontWeight: 700 }}>Late <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--fg-muted)' }}>past the expected date and not delivered</span></div>
        {late.length === 0 ? <div style={{ padding: '0 14px 14px', color: 'var(--fg-muted)', fontSize: 13 }}>Nothing is late.</div> : (
          <table style={tbl}>
            <thead><tr style={headRow}><th style={th}>Order</th><th style={th}>Item</th><th style={th}>Status</th><th style={th}>Expected</th><th style={thR}>Days late</th></tr></thead>
            <tbody>{late.map(({ o, l }) => {
              const due = l.expected_on ?? o.expected_on ?? today;
              const days = Math.round((new Date(today).getTime() - new Date(due).getTime()) / 86_400_000);
              return (
                <tr key={l.id} style={rowBorder}>
                  <td style={td}><button style={linkBtn} onClick={() => onOpen(o.id)}>{o.order_number || 'No order #'}</button><div style={subTxt}>{o.vendor_name}</div></td>
                  <td style={td}>{l.description}</td>
                  <td style={td}><StatusPill status={l.status} /></td>
                  <td style={td}>{shortDate(due)}</td>
                  <td style={tdNum}>{days}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>

      <Card flush padding={0}>
        <div style={{ padding: '12px 14px', fontWeight: 700 }}>Latest status changes</div>
        {recent.length === 0 ? <div style={{ padding: '0 14px 14px', color: 'var(--fg-muted)', fontSize: 13 }}>No orders yet.</div> : (
          <table style={tbl}>
            <tbody>{recent.map(l => {
              const o = orderById.get(l.order_id);
              return (
                <tr key={l.id} style={rowBorder}>
                  <td style={{ ...td, width: 150, color: 'var(--fg-muted)' }}>{shortDate(l.status_at)}</td>
                  <td style={td}>{l.description}<div style={subTxt}>{o ? `${o.order_number || 'No order #'} · ${o.vendor_name} · ${o.venue_id ? venueName(o.venue_id) : 'warehouse'}` : ''}</div></td>
                  <td style={td}><StatusPill status={l.status} /></td>
                  <td style={td}>{o && <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => onOpen(o.id)}>Open order</button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
      <div style={subTxt}>An order's status is its least-advanced line. {STATUS_LABEL.CANCELLED} lines are left out of every count.</div>
    </div>
  );
}
