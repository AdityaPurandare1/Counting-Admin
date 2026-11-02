import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccessEntry } from '@/lib/access';
import { Btn, Card, Eyebrow, Pill, Segment } from '@/components/atoms';
import { loadTracker, documentUrl, type TrackerData } from '@/lib/orderTrackerData';
import { isoDay } from '@/lib/orderTracker';
import { histories, invoiceRegister, priceMoves, priceMovesCsv, pricePoints, quoteChecks, spendByMonth, type PriceMove } from '@/lib/orderPrices';
import { ColumnChart, SERIES, OTHER_GRAY, StepLineChart } from '@/components/charts';
import { download, errBox, fmtCompact, fmtMoney, fmtMoney0, fmtQty, headRow, linkBtn, monthName, picker, rowBorder, shortDate, subTxt, tbl, td, tdNum, th, thR } from '@/components/orderTracker/shared';

/* ───────────────────────────────────────────────────────────────────────
   Order prices (v0.79) — Purchasing section, admin + corporate only.
   The price tracker for the invoices received in the Order tracker: every
   invoiced line is a price point (with its invoice number), so this shows how
   each item's price moves invoice to invoice, open quotes against the last
   price paid, spend by month and vendor, and the invoice register with PDFs.
   Logic: src/lib/orderPrices.ts.
   ─────────────────────────────────────────────────────────────────────── */

type View = 'changes' | 'history' | 'spend' | 'invoices' | 'quotes';
type Period = 12 | 24 | 0;

export function OrderPrices({ today: todayProp, load = loadTracker }: { user: AccessEntry; today?: Date; load?: () => Promise<TrackerData> }) {
  const today = useMemo(() => isoDay(todayProp ?? new Date()), [todayProp]);
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('changes');
  const [vendor, setVendor] = useState('');
  const [period, setPeriod] = useState<Period>(12);
  const [itemKey, setItemKey] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const s = ++seq.current;
    try { const d = await load(); if (s === seq.current) { setData(d); setError(null); } }
    catch (e) { if (s === seq.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [load]);
  useEffect(() => { void reload(); }, [reload]);

  const allPoints = useMemo(() => (data ? pricePoints(data.lines, data.orders, data.items) : []), [data]);
  const vendors = useMemo(() => [...new Set(allPoints.map(p => p.vendor))].sort(), [allPoints]);
  const since = useMemo(() => {
    if (!period) return '';
    const [y, m] = today.split('-').map(Number);
    return isoDay(new Date(y, m - 1 - period + 1, 1));
  }, [period, today]);
  const points = useMemo(() => allPoints.filter(p => (!vendor || p.vendor === vendor) && (!since || p.date >= since)), [allPoints, vendor, since]);
  const hs = useMemo(() => histories(points), [points]);
  const moves = useMemo(() => priceMoves(hs), [hs]);
  const spend = points.reduce((s, p) => s + p.total, 0);
  const up = moves.filter(m => !m.check && m.delta > 0), down = moves.filter(m => !m.check && m.delta < 0), check = moves.filter(m => m.check);
  const openItem = (k: string) => { setItemKey(k); setView('history'); };

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Purchasing</Eyebrow>
          <h1>Order prices</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>Prices and spend from the invoices received in the Order tracker, with their invoice numbers.</div>
        </div>
      </div>
      <div className="content">
        {error && <div style={errBox}>Order prices could not be loaded: {error}</div>}
        {!data && !error && <Pill tone="neutral" size="sm">loading…</Pill>}
        {data && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 14px' }}>
              <select style={picker} value={period} onChange={e => setPeriod(Number(e.target.value) as Period)} aria-label="Period">
                <option value={12}>Last 12 months</option><option value={24}>Last 24 months</option><option value={0}>All time</option>
              </select>
              <select style={{ ...picker, maxWidth: 260 }} value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Vendor">
                <option value="">All vendors</option>
                {vendors.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <Tile label="Invoiced spend" value={fmtCompact(spend)} sub={`${new Set(points.map(p => p.vendor + '|' + p.invoiceNumber)).size} invoices · ${hs.length} items`} />
              <Tile label="Prices up" value={String(up.length)} sub={up.length ? `+${fmtMoney(up.reduce((s, m) => s + m.impact, 0))} on the latest orders` : 'none'} tone={up.length ? 'up' : undefined} />
              <Tile label="Prices down" value={String(down.length)} sub={down.length ? `−${fmtMoney(Math.abs(down.reduce((s, m) => s + m.impact, 0)))} on the latest orders` : 'none'} tone={down.length ? 'down' : undefined} />
              <Tile label="To check" value={String(check.length)} sub="unit changed, or doubled / halved" />
            </div>

            <div style={{ maxWidth: 640, margin: '16px 0 14px' }}>
              <Segment<View> value={view} onChange={setView} options={[
                { value: 'changes', label: 'Price changes' }, { value: 'history', label: 'Item history' }, { value: 'spend', label: 'Spend' },
                { value: 'invoices', label: 'Invoices' }, { value: 'quotes', label: 'Quotes' },
              ]} />
            </div>

            {points.length === 0 && view !== 'quotes' && (
              <Card padding={16}><div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
                No invoiced lines yet. A line becomes a price point when it has an invoice number or reaches Invoiced — add an invoice PDF in the Order tracker, or enter the invoice # on a line.
              </div></Card>
            )}
            {points.length > 0 && view === 'changes' && <ChangesView up={up} down={down} check={check} onItem={openItem} />}
            {points.length > 0 && view === 'history' && <HistoryView hs={hs} itemKey={itemKey} setItemKey={setItemKey} />}
            {points.length > 0 && view === 'spend' && <SpendView points={points} />}
            {points.length > 0 && view === 'invoices' && <InvoicesView data={data} points={points} />}
            {view === 'quotes' && <QuotesView data={data} points={allPoints} />}
          </>
        )}
      </div>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' }) {
  return (
    <Card padding={14}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: tone === 'up' ? 'var(--raspberry-300)' : tone === 'down' ? 'var(--teal-300)' : 'var(--fg-primary)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--fg-secondary)', marginTop: 2 }}>{sub}</div>
    </Card>
  );
}

function ChangesView({ up, down, check, onItem }: { up: PriceMove[]; down: PriceMove[]; check: PriceMove[]; onItem: (k: string) => void }) {
  const table = (title: string, rows: PriceMove[], showCheck = false) => (
    <Card flush padding={0} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px' }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} item{rows.length === 1 ? '' : 's'}</div>
      </div>
      {rows.length === 0 ? <div style={{ padding: '0 14px 14px', color: 'var(--fg-muted)', fontSize: 13 }}>None.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ ...tbl, minWidth: 860 }}>
            <thead><tr style={headRow}>
              <th style={th}>Item</th><th style={th}>Vendor</th><th style={thR}>Previous</th><th style={thR}>Latest</th><th style={thR}>Change</th>
              <th style={thR}>$ impact</th><th style={thR}>Lowest paid</th>{showCheck && <th style={th}>Why</th>}
            </tr></thead>
            <tbody>{rows.map(m => (
              <tr key={m.key} style={rowBorder}>
                <td style={{ ...td, maxWidth: 300 }}><button style={linkBtn} onClick={() => onItem(m.key)}>{m.itemName}</button><div style={subTxt}>per {m.latest.unit || 'unit'}</div></td>
                <td style={td}>{m.latest.vendor}{m.vendorChanged && <div style={subTxt}>was {m.prev.vendor}</div>}</td>
                <td style={tdNum}>{fmtMoney(m.prev.unitPrice)}<div style={subTxt}>{shortDate(m.prev.date)}{m.prev.invoiceNumber ? ` · #${m.prev.invoiceNumber}` : ''}</div></td>
                <td style={tdNum}>{fmtMoney(m.latest.unitPrice)}<div style={subTxt}>{shortDate(m.latest.date)}{m.latest.invoiceNumber ? ` · #${m.latest.invoiceNumber}` : ''}</div></td>
                <td style={tdNum}><span style={{ fontWeight: 600, color: m.delta > 0 ? 'var(--raspberry-300)' : 'var(--teal-300)' }}>{m.delta > 0 ? '▲' : '▼'} {Math.abs(m.pct).toFixed(1)}%</span><div style={subTxt}>{m.delta > 0 ? '+' : '−'}{fmtMoney(Math.abs(m.delta))}</div></td>
                <td style={tdNum}>{m.impact >= 0 ? '+' : '−'}{fmtMoney(Math.abs(m.impact))}<div style={subTxt}>{fmtQty(m.latest.qty)} {m.latest.unit}</div></td>
                <td style={tdNum}>{fmtMoney(m.lowest.unitPrice)}<div style={subTxt}>{m.aboveLowestPct >= 0.5 ? `latest ${m.aboveLowestPct.toFixed(0)}% above` : 'latest is lowest'}</div></td>
                {showCheck && <td style={{ ...td, fontSize: 12, color: 'var(--fg-muted)' }}>{m.check}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Each item's latest invoiced price against the invoice before it. $ impact = change per unit × quantity on the latest invoice.</div>
        <div style={{ flex: 1 }} />
        <Btn variant="secondary" size="sm" disabled={!up.length && !down.length} onClick={() => download(`order-price-changes-${isoDay(new Date())}.csv`, priceMovesCsv([...up, ...down, ...check]), 'text/csv')}>Export CSV</Btn>
      </div>
      {table('Price increases', up)}
      {table('Price decreases', down)}
      {check.length > 0 && table('To check before acting', check, true)}
    </>
  );
}

function HistoryView({ hs, itemKey, setItemKey }: { hs: ReturnType<typeof histories>; itemKey: string | null; setItemKey: (k: string | null) => void }) {
  const [q, setQ] = useState('');
  const h = hs.find(x => x.key === itemKey) ?? null;
  const hits = hs.filter(x => !q.trim() || x.itemName.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  // one line per vendor, colours by fixed vendor order within this item
  const byVendor = useMemo(() => {
    if (!h) return [];
    const vs = [...new Set(h.points.map(p => p.vendor))];
    return vs.map((v, i) => ({
      key: v, label: v, color: SERIES[i] ?? OTHER_GRAY,
      points: h.points.filter(p => p.vendor === v).map(p => ({
        x: p.date, y: p.unitPrice,
        tip: (<>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney(p.unitPrice)} <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--fg-muted)' }}>per {p.unit || 'unit'}</span></div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{shortDate(p.date)} · {p.vendor}{p.invoiceNumber ? ` · #${p.invoiceNumber}` : ''}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{fmtQty(p.qty)} {p.unit} · {fmtMoney(p.total)}</div>
        </>),
      })),
    }));
  }, [h]);
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input style={{ ...picker, minWidth: 280 }} placeholder="Search an item" value={q} onChange={e => setQ(e.target.value)} />
        {h && <Btn variant="ghost" size="sm" onClick={() => setItemKey(null)}>Clear</Btn>}
      </div>
      {!h && (
        <Card padding={16}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Items with invoiced prices</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {hits.map(x => <Btn key={x.key} variant="secondary" size="sm" onClick={() => setItemKey(x.key)}>{x.itemName} ({x.points.length})</Btn>)}
          </div>
        </Card>
      )}
      {h && (
        <>
          <Card padding={16}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{h.itemName}</div>
            <div style={subTxt}>{h.points.length} invoice{h.points.length === 1 ? '' : 's'} · from {fmtMoney(Math.min(...h.points.map(p => p.unitPrice)))} to {fmtMoney(Math.max(...h.points.map(p => p.unitPrice)))}</div>
            <StepLineChart series={byVendor} yFormat={v => fmtMoney(v)} ariaLabel={`Price of ${h.itemName} over time`} />
          </Card>
          <div style={{ height: 14 }} />
          <Card flush padding={0}>
            <table style={tbl}>
              <thead><tr style={headRow}><th style={th}>Date</th><th style={th}>Vendor</th><th style={th}>Invoice #</th><th style={th}>Order #</th><th style={thR}>Qty</th><th style={thR}>Price</th><th style={thR}>Total</th><th style={thR}>Change</th></tr></thead>
              <tbody>{[...h.points].reverse().map((p, i, arr) => {
                const prev = arr[i + 1];
                const ch = prev && prev.unit === p.unit && prev.unitPrice > 0 ? ((p.unitPrice - prev.unitPrice) / prev.unitPrice) * 100 : null;
                return (
                  <tr key={p.date + p.invoiceNumber + i} style={rowBorder}>
                    <td style={td}>{shortDate(p.date)}</td><td style={td}>{p.vendor}</td><td style={td}>{p.invoiceNumber || '—'}</td><td style={td}>{p.orderNumber || '—'}</td>
                    <td style={tdNum}>{fmtQty(p.qty)} <span style={subTxt}>{p.unit}</span></td><td style={{ ...tdNum, fontWeight: 600 }}>{fmtMoney(p.unitPrice)}</td>
                    <td style={tdNum}>{fmtMoney(p.total)}</td>
                    <td style={tdNum}>{ch == null || Math.abs(ch) < 0.05 ? '—' : <span style={{ color: ch > 0 ? 'var(--raspberry-300)' : 'var(--teal-300)' }}>{ch > 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(1)}%</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}

function SpendView({ points }: { points: ReturnType<typeof pricePoints> }) {
  const sp = useMemo(() => spendByMonth(points, 'vendor'), [points]);
  // top five vendors keep a colour; the rest fold into Other (no generated 7th hue)
  const top = sp.groups.slice(0, 5);
  const keys = [...top.map((g, i) => ({ key: g, label: g, color: SERIES[i] })), ...(sp.groups.length > 5 ? [{ key: 'Other', label: 'Other vendors', color: OTHER_GRAY }] : [])];
  const values = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const m of sp.months) {
      const row: Record<string, number> = {};
      for (const [g, v] of Object.entries(sp.cells[m] ?? {})) { const k = top.includes(g) ? g : 'Other'; row[k] = (row[k] ?? 0) + v; }
      out[m] = row;
    }
    return out;
  }, [sp, top]);
  return (
    <>
      <Card padding={16}>
        <div style={{ fontWeight: 700 }}>Invoiced spend by month</div>
        <ColumnChart months={sp.months} keys={keys} values={values} yFormat={fmtCompact} ariaLabel="Invoiced spend by month"
          tip={m => (<>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney0(sp.totals[m] ?? 0)}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>{monthName(m)}</div>
            {keys.filter(k => (values[m]?.[k.key] ?? 0) > 0).map(k => (
              <div key={k.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                <span style={{ width: 12, height: 2, background: k.color, display: 'inline-block' }} /><b>{fmtMoney0(values[m][k.key])}</b> <span style={{ color: 'var(--fg-muted)' }}>{k.label}</span>
              </div>
            ))}
          </>)} />
      </Card>
      <div style={{ height: 14 }} />
      <Card flush padding={0}>
        <div style={{ overflowX: 'auto' }}>
          <table style={tbl}>
            <thead><tr style={headRow}><th style={th}>Month</th>{sp.groups.map(g => <th key={g} style={thR}>{g}</th>)}<th style={thR}>Total</th></tr></thead>
            <tbody>{[...sp.months].reverse().map(m => (
              <tr key={m} style={rowBorder}>
                <td style={td}>{monthName(m)}</td>
                {sp.groups.map(g => <td key={g} style={tdNum}>{sp.cells[m]?.[g] ? fmtMoney0(sp.cells[m][g]) : '—'}</td>)}
                <td style={{ ...tdNum, fontWeight: 700 }}>{fmtMoney0(sp.totals[m])}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function InvoicesView({ data, points }: { data: TrackerData; points: ReturnType<typeof pricePoints> }) {
  const rows = useMemo(() => invoiceRegister(points, data.documents), [points, data.documents]);
  const [err, setErr] = useState<string | null>(null);
  const open = async (path: string | null) => {
    if (!path) return;
    try { window.open(await documentUrl(path), '_blank', 'noopener'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Card flush padding={0}>
      {err && <div style={{ padding: '0 14px' }}><div style={errBox}>{err}</div></div>}
      {rows.length === 0 ? <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>No invoice numbers recorded yet.</div> : (
        <table style={tbl}>
          <thead><tr style={headRow}><th style={th}>Invoice #</th><th style={th}>Date</th><th style={th}>Vendor</th><th style={th}>Order #</th><th style={thR}>Lines</th><th style={thR}>Total</th><th style={th}>PDF</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.vendor + r.invoiceNumber} style={rowBorder}>
              <td style={{ ...td, fontWeight: 600 }}>{r.invoiceNumber}</td><td style={td}>{shortDate(r.date)}</td><td style={td}>{r.vendor}</td>
              <td style={td}>{r.orderNumbers.join(', ') || '—'}</td><td style={tdNum}>{r.lines}</td><td style={tdNum}>{fmtMoney(r.total)}</td>
              <td style={td}>{r.document?.storage_path ? <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => void open(r.document!.storage_path)}>Open</button> : <span style={{ color: 'var(--fg-muted)' }}>—</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function QuotesView({ data, points }: { data: TrackerData; points: ReturnType<typeof pricePoints> }) {
  const rows = useMemo(() => quoteChecks(data.lines, data.orders, points), [data, points]);
  return (
    <Card flush padding={0}>
      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--fg-muted)' }}>Lines still at Quoted, next to the last price paid for the same item in the same unit — what to push back on before ordering.</div>
      {rows.length === 0 ? <div style={{ padding: '0 14px 14px', color: 'var(--fg-muted)', fontSize: 13 }}>No open quotes with a price.</div> : (
        <table style={tbl}>
          <thead><tr style={headRow}><th style={th}>Item</th><th style={th}>Vendor / quote</th><th style={thR}>Quoted</th><th style={thR}>Last paid</th><th style={thR}>Difference</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.line.id} style={rowBorder}>
              <td style={td}>{r.line.description}<div style={subTxt}>{fmtQty(r.line.qty)} {r.line.unit ?? ''}</div></td>
              <td style={td}>{r.order.vendor_name}<div style={subTxt}>{r.line.quote_number ? `quote ${r.line.quote_number}` : r.order.order_number ?? ''}</div></td>
              <td style={tdNum}>{fmtMoney(r.line.unit_price)}</td>
              <td style={tdNum}>{r.lastPaid ? <>{fmtMoney(r.lastPaid.unitPrice)}<div style={subTxt}>{shortDate(r.lastPaid.date)}{r.lastPaid.invoiceNumber ? ` · #${r.lastPaid.invoiceNumber}` : ''}</div></> : <span style={{ color: 'var(--fg-muted)' }}>never bought</span>}</td>
              <td style={tdNum}>{r.pct == null ? '—' : <span style={{ fontWeight: 600, color: r.pct > 0.05 ? 'var(--raspberry-300)' : r.pct < -0.05 ? 'var(--teal-300)' : undefined }}>{r.pct > 0 ? '▲' : r.pct < 0 ? '▼' : ''} {Math.abs(r.pct).toFixed(1)}%</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}
