import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import { Card, Pill } from '@/components/atoms';
import {
  STATUSES, STATUS_LABEL, isLate, isoDay, lineTotal, orderVenueName, receivedForLine,
  type OtLine,
} from '@/lib/orderTracker';
import { loadTracker, type TrackerData } from '@/lib/orderTrackerData';
import { buildReportWorkbook } from '@/lib/orderTrackerReport';
import { attentionItems, stubsToGet, trackerKpis, type Attention } from '@/lib/orderTrackerView';
import { median, spanText, vendorLeadTimes } from '@/lib/leadTime';
import { OrdersView, type OrdersPreset } from '@/components/orderTracker/OrdersView';
import { ToSend } from '@/components/orderTracker/ToSend';
import { followupsDue, paymentRequestsDue } from '@/lib/orderFollowups';
import { AttachStubButton, Icon } from '@/components/orderTracker/ui';
import '@/components/orderTracker/tracker.css';
import { WarehouseView } from '@/components/orderTracker/WarehouseView';
import { BibleView } from '@/components/orderTracker/BibleView';
import { DocumentReview } from '@/components/orderTracker/DocumentReview';
import { InboxView } from '@/components/orderTracker/InboxView';
import { inboxGroups, loadInbox, mailStatus, morningPullAlert, redecideInbox, type InboxItem, type MailStatus } from '@/lib/orderMail';
import { StatusPill, download, errBox, fmtMoney, fmtMoney0, headRow, linkBtn, rowBorder, shortDate, subTxt, tbl, td, tdNum, th, thR } from '@/components/orderTracker/shared';

/* ───────────────────────────────────────────────────────────────────────
   Order tracker (v0.79) — Purchasing section, admin + corporate only.

   Orders for custom / OS&E items through the line lifecycle (quoted →
   ordered → confirmed → in production → shipped → delivered → invoiced →
   paid), quote / confirmation / invoice / shipping PDFs read by AI and
   applied after review, warehouse stock that delivered orders fill and venue
   releases draw down, and an Excel report of all of it. Logic lives in
   src/lib/orderTracker*.ts; tables are kount_ot_* (migration 0132).
   v0.80 Inbox: the morning mail pull (0135, src/lib/orderMail.ts) — what it
   applied by itself, and what waits for a person.
   v0.87 the user's order-tracker.html design: one KPI strip, tabs, a bell of
   what needs attention, the order in a side panel (OrderDrawer), each order's
   documents viewable from the list (src/lib/orderTrackerView.ts, tracker.css).
   ─────────────────────────────────────────────────────────────────────── */

type View = 'orders' | 'inbox' | 'tosend' | 'warehouse' | 'overview' | 'bibles';

export function OrderTracker({ user, today: todayProp, load = loadTracker, loadMail = loadInbox, loadStatus = mailStatus }: {
  user: AccessEntry; today?: Date; load?: () => Promise<TrackerData>; loadMail?: () => Promise<InboxItem[]>; loadStatus?: () => Promise<MailStatus>;
}) {
  const today = useMemo(() => isoDay(todayProp ?? new Date()), [todayProp]);
  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('orders');
  const [newNonce, setNewNonce] = useState(0);
  const [preset, setPreset] = useState<OrdersPreset | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [mailSt, setMailSt] = useState<MailStatus | null>(null);
  const [reviewing, setReviewing] = useState<InboxItem | null>(null);
  const [focusOrder, setFocusOrder] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const s = ++seq.current;
    setLoading(true);
    try {
      // the inbox is extra: if it can't load (0135 not applied), the tracker still works
      // the mail status is extra too: it only feeds the 9 o'clock warning (0160)
      const [d, mail, st] = await Promise.all([load(), loadMail().catch(() => [] as InboxItem[]), loadStatus().catch(() => null)]);
      if (s === seq.current) { setData(d); setInbox(mail); setMailSt(st); setError(null); }
    } catch (e) {
      if (s === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (s === seq.current) setLoading(false); }
  }, [load, loadMail, loadStatus]);
  useEffect(() => { void reload(); }, [reload]);
  const waiting = inboxGroups(inbox).waiting.length;

  const venueName = useCallback((id: string | null) => orderVenueName(id, VENUES), []);
  // v1.08 To send (0153): payment requests + vendor follow-ups waiting (the tab's count)
  const toSendCount = useMemo(() => {
    if (!data) return 0;
    const d = { ...data, followups: data.followups ?? [] };
    return paymentRequestsDue(d, venueName, user.email).length + followupsDue(d, inbox, today, venueName, user.email).filter(f => f.to === 'vendor').length;
  }, [data, inbox, today, venueName, user.email]);

  const downloadReport = async () => {
    if (!data) return;
    setReportBusy(true);
    try {
      const buf = await buildReportWorkbook({ ...data, venueName, today, includeClosed, tracking: data.tracking });
      download(`Order tracker report ${today}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      setError('Report not built: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setReportBusy(false); }
  };

  const kpis = useMemo(() => (data ? trackerKpis(data, today) : null), [data, today]);
  // the 9 o'clock pull not having read today's mail goes first (0160)
  const attention = useMemo(() => {
    const base = data ? attentionItems(data, today, waiting, fmtMoney0, venueName) : [];
    const pull = morningPullAlert(mailSt, todayProp ?? new Date());
    return pull ? [{ sev: 'crit' as const, title: pull.title, sub: pull.sub, act: { kind: 'tab' as const, tab: 'inbox' as const } }, ...base] : base;
  }, [data, today, waiting, mailSt, todayProp]);
  const lateHot = (kpis?.late ?? 0) > 0;
  const kpi = (key: OrdersPreset['key'] | 'warehouse') => {
    if (key === 'warehouse') { setView('warehouse'); return; }
    setView('orders'); setPreset(p => ({ key, n: (p?.n ?? 0) + 1 }));
  };
  const act = (a: Attention['act']) => {
    setBellOpen(false);
    if (a.kind === 'order') { setFocusOrder(null); setTimeout(() => setFocusOrder(a.id), 0); setView('orders'); } else setView(a.tab);
  };
  const tab = (id: View, label: string, ct: number | null, hot = false) => (
    <button key={id} type="button" role="tab" className="ot-tab" aria-selected={view === id} onClick={() => setView(id)}>
      {label}{ct ? <span className={`ct${hot ? ' hot' : ''}`}>{ct}</span> : null}
    </button>
  );

  return (
    <div className="content ot">
      <div className="ot-top">
        <div className="ot-top-l">
          <div className="ot-eyebrow">Purchasing</div>
          <h1 className="ot-title">Order tracker</h1>
          <p className="ot-sub">Custom and operating-supply orders from quote to paid, the stock they put in the warehouse, and what venues draw from it.</p>
        </div>
        <div className="ot-top-r">
          <span className={`ot-live ${error ? 'off' : data && !loading ? 'on' : ''}`} title={error ?? undefined}><i />{error ? 'Not loaded' : loading ? 'Loading…' : 'Live'}</span>
          <div className="ot-pop-wrap">
            <button type="button" className="ot-icon-btn" aria-label={`Needs attention: ${attention.length}`} aria-expanded={bellOpen} onClick={() => setBellOpen(o => !o)}>
              <Icon name="bell" />{attention.length > 0 && <span className="ot-badge">{attention.length > 99 ? '99+' : attention.length}</span>}
            </button>
            {bellOpen && (
              <div className="ot-pop" role="menu">
                <h4>Needs attention</h4>
                {attention.length ? attention.slice(0, 40).map((a, i) => (
                  <button key={i} type="button" className="ot-att" onClick={() => act(a.act)}>
                    <span className="sev" style={{ background: `var(--ot-${a.sev})` }} /><span><b>{a.title}</b><small>{a.sub}</small></span>
                  </button>
                )) : <div className="ot-pop-empty">Nothing needs you right now.</div>}
              </div>
            )}
          </div>
          <button type="button" className="ot-btn" onClick={() => void downloadReport()} disabled={!data || reportBusy} title={includeClosed ? 'Every order, completed ones too' : 'Open orders only'}>
            <Icon name="download" />{reportBusy ? 'Building…' : 'Export to Excel'}
          </button>
          <label className="ot-check" title="Include completed orders in the export"><input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} />with completed</label>
          <button type="button" className="ot-btn" onClick={() => fileRef.current?.click()} title="A quote, order confirmation, invoice or shipping notice (PDF)"><Icon name="doc" />Add document</button>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setDocFile(f); setReviewing(null); } }} />
          <button type="button" className="ot-btn primary" onClick={() => { setView('orders'); setDocFile(null); setReviewing(null); setNewNonce(n => n + 1); }}><Icon name="plus" />New order</button>
        </div>
      </div>

      <div>
        {error && <div style={errBox}>{error}{/relation .*kount_ot_|does not exist/i.test(error) && <div style={{ marginTop: 4 }}>The order tracker tables (migration 0132) are not applied yet.</div>}</div>}
        {loading && !data && <Pill tone="neutral" size="sm">loading…</Pill>}

        {data && docFile && (
          <DocumentReview key={docFile.name + docFile.size + docFile.lastModified} file={docFile} data={data} today={today}
            onCancel={() => setDocFile(null)}
            onDone={orderId => { setDocFile(null); setFocusOrder(orderId); setView('orders'); void reload(); }} />
        )}
        {data && reviewing && !docFile && (
          <DocumentReview key={reviewing.id} file={null} inbox={reviewing} data={data} today={today}
            onCancel={() => setReviewing(null)}
            onDone={orderId => {
              // off the Inbox at once (it was saved), and the lists refreshed now — not after the re-check below,
              // which can take most of a minute and left the item looking unsaved
              const done = reviewing.id;
              setInbox(list => list.filter(i => i.id !== done));
              setReviewing(null); setFocusOrder(orderId); setView('orders');
              void reload();
              // other waiting documents of this order (its invoice, a tracking email) may now go in by themselves
              void redecideInbox().catch(() => undefined).finally(() => void reload());
            }} />
        )}

        {data && kpis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="ot-kpis">
              <button type="button" className="ot-kpi" onClick={() => kpi('open')}><span className="lbl">Open orders</span><span className="val">{kpis.open}</span><span className="hint">{kpis.openLines} line{kpis.openLines === 1 ? '' : 's'}</span></button>
              <button type="button" className={`ot-kpi${kpis.late ? ' alert' : ''}`} onClick={() => kpi('late')}><span className="lbl">Late lines</span><span className="val">{kpis.late}</span>
                <span className="hint">{kpis.late ? `oldest ${kpis.oldestLateDays} day${kpis.oldestLateDays === 1 ? '' : 's'} past ETA` : 'nothing overdue'}</span></button>
              <button type="button" className="ot-kpi" onClick={() => kpi('onorder')}><span className="lbl">On order</span><span className="val">{fmtMoney0(kpis.onOrder$)}</span>
                <span className="hint">{kpis.onOrderOrders} order{kpis.onOrderOrders === 1 ? '' : 's'} not delivered yet</span></button>
              <button type="button" className={`ot-kpi${kpis.unpaid$ ? ' warn' : ''}`} onClick={() => kpi('invoiced')}><span className="lbl">Invoiced, not paid</span><span className="val">{fmtMoney0(kpis.unpaid$)}</span>
                <span className="hint">{kpis.unpaidInvoices ? `${kpis.unpaidInvoices} invoice${kpis.unpaidInvoices === 1 ? '' : 's'} · oldest ${kpis.oldestUnpaidDays}d` : 'no invoices waiting'}</span></button>
              <button type="button" className={`ot-kpi${kpis.approve ? ' warn' : ' good'}`} onClick={() => kpi('approve')} title="Quoted lines stay here until you e-mail the vendor the go-ahead (approved / good to go / yes)"><span className="lbl">Quotes to approve</span><span className="val">{kpis.approve || 'None'}</span>
                <span className="hint">{kpis.approve ? `${kpis.approveLines} line${kpis.approveLines === 1 ? '' : 's'} · no approval e-mail yet` : 'every quote answered'}</span></button>
              <button type="button" className={`ot-kpi${kpis.reorder ? ' warn' : ' good'}`} onClick={() => kpi('warehouse')}><span className="lbl">Warehouse</span><span className="val">{kpis.reorder ? `${kpis.reorder} to reorder` : 'OK'}</span>
                <span className="hint">{kpis.reorder ? 'at or below reorder point' : kpis.soon ? `${kpis.soon} within 30 days` : 'no reorders due'}</span></button>
            </div>
            <div className="ot-tabs" role="tablist">
              {tab('orders', 'Orders', kpis.open, lateHot)}
              {tab('inbox', 'Inbox', waiting)}
              {tab('tosend', 'To send', toSendCount)}
              {tab('warehouse', 'Warehouse', kpis.reorder, kpis.reorder > 0)}
              {tab('overview', 'Overview', null)}
              {tab('bibles', 'Bibles', null)}
            </div>
            <div style={{ opacity: loading ? 0.7 : 1, transition: 'opacity .2s' }}>
            {view === 'orders' && <OrdersView data={data} today={today} venueName={venueName} onReload={() => void reload()} focusOrderId={focusOrder} preset={preset} newNonce={newNonce} />}
            {view === 'inbox' && <InboxView items={inbox} orders={data.orders} lines={data.lines} onReview={i => { setReviewing(i); setDocFile(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onOpenOrder={id => { setFocusOrder(id); setView('orders'); }} onChanged={() => void reload()} />}
            {view === 'tosend' && <ToSend data={data} mails={inbox} today={today} venueName={venueName} me={user.email}
              onOpenOrder={id => { setFocusOrder(id); setView('orders'); }} onReload={() => void reload()} />}
            {view === 'warehouse' && <WarehouseView data={data} today={today} venueName={venueName} onReload={() => void reload()} />}
            {view === 'bibles' && <BibleView data={data} today={today} />}
            {view === 'overview' && <Overview data={data} today={today} venueName={venueName} onOpen={id => { setFocusOrder(id); setView('orders'); }} onReload={() => void reload()} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Overview({ data, today, venueName, onOpen, onReload }: { data: TrackerData; today: string; venueName: (id: string | null) => string; onOpen: (orderId: string) => void; onReload: () => void }) {
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
      <StubsToGet data={data} onOpen={onOpen} onReload={onReload} />
      <LeadTimes data={data} today={today} onOpen={onOpen} />
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

/** Lead times by vendor (0147): sent to the vendor -> delivered, and the orders still open the longest. */
function LeadTimes({ data, today, onOpen }: { data: TrackerData; today: string; onOpen: (orderId: string) => void }) {
  const rows = useMemo(() => vendorLeadTimes(data.orders, data.lines, today), [data.orders, data.lines, today]);
  if (!rows.length) return null;
  const range = (xs: number[]) => (xs.length > 1 ? `${spanText(Math.min(...xs))} – ${spanText(Math.max(...xs))}` : '');
  return (
    <Card flush padding={0}>
      <div style={{ padding: '12px 14px', fontWeight: 700 }}>Lead times <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--fg-muted)' }}>
        from the day an order went to the vendor to the day it was delivered · ~ = estimated (delivery day from the ETA, or the PO date for the sent day)</span></div>
      <table style={tbl}>
        <thead><tr style={headRow}><th style={th}>Vendor</th><th style={thR}>Typical</th><th style={th}>Range</th><th style={thR}>Delivered orders</th><th style={th}>Open the longest</th></tr></thead>
        <tbody>{rows.map(v => (
          <tr key={v.vendor} style={rowBorder}>
            <td style={td}>{v.vendor}</td>
            <td style={tdNum}>{v.took.length ? `${v.approx === v.took.length ? '~' : ''}${spanText(median(v.took))}` : '—'}</td>
            <td style={{ ...td, color: 'var(--fg-secondary)' }}>{range(v.took)}</td>
            <td style={tdNum}>{v.took.length || '—'}{v.approx > 0 && v.approx < v.took.length ? <span style={subTxt}> ({v.approx} est.)</span> : null}</td>
            <td style={td}>{v.open.length === 0 ? <span style={subTxt}>none open</span> : (
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
                {v.open.slice(0, 3).map(x => (
                  <button key={x.order.id} style={linkBtn} onClick={() => onOpen(x.order.id)} title={`Sent ${shortDate(x.order.sent_on!)} — not delivered yet`}>
                    {x.order.order_number || 'No order #'} · {spanText(x.days)}
                  </button>
                ))}
                {v.open.length > 3 && <span style={subTxt}>+{v.open.length - 3} more</span>}
              </span>
            )}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

/** Paid invoices with no check stub (0143): one row per R365 payment — reprint its stub in R365 and attach it
 *  here, and it goes on every order and invoice that payment paid. */
function StubsToGet({ data, onOpen, onReload }: { data: TrackerData; onOpen: (orderId: string) => void; onReload: () => void }) {
  const { needs, groups } = useMemo(() => stubsToGet(data.orders, data.lines, data.documents), [data.orders, data.lines, data.documents]);
  if (!needs.length) return null;
  const matched = groups.filter(g => g.payments.length);
  const other = groups.find(g => !g.payments.length);
  const invoiceChips = (items: typeof needs) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map(n => (
        <button key={`${n.orderId}|${n.invoice}`} type="button" className="ot-doc" onClick={() => onOpen(n.orderId)} title={`${n.vendor} · ${fmtMoney(n.amount)} — open the order`}>
          <span className="ext">{n.orderNumber ?? 'order'}</span><span className="nm mono">{n.invoice}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="ot-card">
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--ot-line)' }}>
        <div style={{ fontWeight: 600 }}>Check stubs to get from R365 <span className="ot-pill warn" style={{ marginLeft: 6 }}>{needs.length} invoice{needs.length > 1 ? 's' : ''}</span></div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          Paid, with no stub on the order. In R365: Accounts Payable → AP Transactions → open the payment below → Action → Check Stub Reprint → save the PDF,
          then attach it here — it goes on every order and invoice that payment paid.
        </div>
      </div>
      <div className="ot-table-wrap">
        <table className="ot-tbl" style={{ minWidth: 820 }}>
          <thead><tr><th>R365 payment</th><th>Paid on</th><th className="r">Payment amount</th><th>Invoices without a stub</th><th /></tr></thead>
          <tbody>
            {matched.map(g => (
              <tr key={g.key}>
                <td className="mono t1">{g.key}</td>
                <td>{g.payments.map(p => shortDate(p.date)).join(', ')}</td>
                <td className="r num">{fmtMoney(g.payments.reduce((s, p) => s + p.amount, 0))}</td>
                <td>{invoiceChips(g.items)}</td>
                <td className="r"><AttachStubButton invoices={g.items.map(i => i.invoice)} orderIds={g.items.map(i => i.orderId)} payment={g.key} onDone={onReload} /></td>
              </tr>
            ))}
            {other && other.items.map(n => (
              <tr key={`x|${n.orderId}|${n.invoice}`}>
                <td className="faint" style={{ fontSize: 12.5 }}>not matched to an R365 payment</td>
                <td className="faint">—</td>
                <td className="r num">{fmtMoney(n.amount)}</td>
                <td>{invoiceChips([n])}</td>
                <td className="r"><AttachStubButton invoices={[n.invoice]} orderIds={[n.orderId]} payment={null} onDone={onReload} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {other && <div className="faint" style={{ fontSize: 12, padding: '8px 16px 12px' }}>
        "Not matched": marked paid (by hand or the old tracker sheet) but no R365 payment matches it — look the invoice up in R365, or it was paid outside R365.
      </div>}
    </div>
  );
}
