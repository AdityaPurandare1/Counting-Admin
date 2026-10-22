import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import { Btn, Card, Eyebrow, Pill, Segment } from '@/components/atoms';
import {
  priceLines, buildSeries, buildMovers, splitMovers, monthlySpend, summarize, moversCsv, periodStart, lineSpend, checkReason,
  type PurchaseLine, type PricedLine, type Mover, type Series, type SpendGroup, type MoverSort, type BevCategory, type MonthRange,
} from '@/lib/purchasePrices';

/* ───────────────────────────────────────────────────────────────────────
   Purchase prices (v0.74) — admin + corporate only.

   How liquor and wine purchase prices and spend move, per bottle, from the
   invoices already in the database (R365 / Craftable via KevaOS). Data comes
   from kount_bev_purchase_lines (migration 0107); the per-bottle maths and
   every number on this screen live in src/lib/purchasePrices.ts.

   Pricing runs over ALL loaded lines before the venue / category / vendor
   filters: an item's other venues are the fallback reference for its case
   size, so filtering first would change the prices.
   ─────────────────────────────────────────────────────────────────────── */

interface Props {
  user: AccessEntry;
  /** Injected by tests / the preview harness; defaults to the RPC. */
  load?: (from: string, to: string) => Promise<PurchaseLine[]>;
  today?: Date;
}

export async function loadPurchaseLines(from: string, to: string): Promise<PurchaseLine[]> {
  const { data, error } = await supabase.rpc('kount_bev_purchase_lines', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as PurchaseLine[]) : [];
}

type View = 'changes' | 'spend' | 'item' | 'review';
type CatFilter = 'all' | BevCategory;

/** Validated categorical slots (dataviz skill default palette, light surface).
 *  Venues take a slot by their fixed venue order, so a filter never repaints. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER_GRAY = '#898781';
const CAT_COLOR: Record<BevCategory, string> = { Liquor: SERIES[0], Wine: SERIES[1] };
const TILE_MIN_PCT = 2;

export function PurchasePrices({ load = loadPurchaseLines, today: todayProp }: Props) {
  const today = useMemo(() => todayProp ?? new Date(), [todayProp]);
  const [months, setMonths] = useState<6 | 12 | 24>(12);
  const [raw, setRaw] = useState<PurchaseLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venue, setVenue] = useState('');
  const [cat, setCat] = useState<CatFilter>('all');
  const [vendor, setVendor] = useState('');
  const [view, setView] = useState<View>('changes');
  const [itemId, setItemId] = useState<string | null>(null);

  // Only the newest request may land: switching 24 -> 6 months while the slow
  // 24-month call is in flight must not show 24 months under "last 6 months".
  const reqSeq = useRef(0);
  const fetchData = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true); setError(null);
    try {
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const rows = await load(periodStart(months, today), iso(today));
      if (seq === reqSeq.current) setRaw(rows);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      console.error('[purchase-prices] load', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally { if (seq === reqSeq.current) setLoading(false); }
  }, [load, months, today]);
  useEffect(() => { void fetchData(); }, [fetchData]);

  const priced = useMemo(() => (raw ? priceLines(raw) : []), [raw]);

  // Venue colours follow the fixed venue order, over everything loaded.
  const venueColor = useMemo(() => {
    const present = new Set(priced.map(l => l.venue_id));
    const order = [...VENUES.map(v => v.id).filter(id => present.has(id)), ...[...present].filter(id => !VENUES.some(v => v.id === id)).sort()];
    const m = new Map<string, string>();
    order.forEach((id, i) => m.set(id, SERIES[i] ?? OTHER_GRAY));
    return m;
  }, [priced]);

  const venueOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const l of priced) names.set(l.venue_id, l.venue_name ?? l.venue_id);
    return [...venueColor.keys()].map(id => ({ id, name: names.get(id) ?? id }));
  }, [priced, venueColor]);

  const vendorOptions = useMemo(() => {
    const t = new Map<string, number>();
    for (const l of priced) if (l.vendor_name) t.set(l.vendor_name, (t.get(l.vendor_name) ?? 0) + l.spend);
    return [...t.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }, [priced]);

  const filtered = useMemo(() => priced.filter(l =>
    (!venue || l.venue_id === venue) && (cat === 'all' || l.category === cat) && (!vendor || l.vendor_name === vendor)), [priced, venue, cat, vendor]);
  const series = useMemo(() => buildSeries(filtered), [filtered]);
  const movers = useMemo(() => buildMovers(series), [series]);
  // Tiles count changes of 2% or more — the Price changes table's default
  // threshold — so the two never disagree on first view.
  const range = useMemo<MonthRange>(() => ({
    from: periodStart(months, today).slice(0, 7),
    to: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
  }), [months, today]);
  const summary = useMemo(() => summarize(filtered, movers.filter(m => Math.abs(m.pct) >= TILE_MIN_PCT), today, range), [filtered, movers, today, range]);
  const reviewCount = summary.unclearLines + summary.unpricedOtherLines + summary.checkCount;

  const openItem = (id: string) => { setItemId(id); setView('item'); };

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Finance</Eyebrow>
          <h1>Purchase prices</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Liquor and wine invoice prices per bottle, and spend by month, from the invoices on file for each venue.
          </div>
        </div>
      </div>

      <div className="content">
        {/* Filters: one row, above everything they scope. Period first. */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 14px' }}>
          <select style={picker} value={months} onChange={e => setMonths(Number(e.target.value) as 6 | 12 | 24)} aria-label="Period">
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
          <select style={picker} value={venue} onChange={e => setVenue(e.target.value)} aria-label="Venue">
            <option value="">All venues</option>
            {venueOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div style={{ width: 290 }}>
            <Segment<CatFilter> value={cat} onChange={setCat}
              options={[{ value: 'all', label: 'All' }, { value: 'Liquor', label: 'Liquor' }, { value: 'Wine', label: 'Wine' }]} />
          </div>
          <select style={{ ...picker, maxWidth: 260 }} value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          {loading && <Pill tone="neutral" size="sm">loading…</Pill>}
        </div>

        {error && (
          <div style={errBox}>
            Purchase prices could not be loaded: {error}
            {/function .* does not exist|Could not find the function/i.test(error) && <div style={{ marginTop: 4 }}>The database function (migration 0107) is not applied yet.</div>}
            {/statement timeout/i.test(error) && <div style={{ marginTop: 4 }}>The database took too long (usually only the first load after a quiet spell). <button style={linkBtn} onClick={() => void fetchData()}>Try again</button>, or pick a shorter period.</div>}
          </div>
        )}

        {raw && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .2s' }}>
            <Tiles summary={summary} months={months} onReview={() => setView('review')} />

            <div style={{ maxWidth: 560, margin: '18px 0 14px' }}>
              <Segment<View> value={view} onChange={setView} options={[
                { value: 'changes', label: 'Price changes' },
                { value: 'spend', label: 'Monthly spend' },
                { value: 'item', label: 'Item history' },
                { value: 'review', label: `Needs review${reviewCount ? ` (${reviewCount})` : ''}` },
              ]} />
            </div>

            {view === 'changes' && <ChangesView movers={movers} onItem={openItem} />}
            {view === 'spend' && <SpendView lines={filtered} cat={cat} today={today} range={range} />}
            {view === 'item' && (
              <ItemView priced={priced} series={series} cat={cat} itemId={itemId} setItemId={setItemId} venueColor={venueColor} />
            )}
            {view === 'review' && <ReviewView lines={filtered} movers={movers} onItem={openItem} />}
          </div>
        )}
      </div>
    </>
  );
}

/* ── tiles ────────────────────────────────────────────────────────────── */

function Tiles({ summary: s, months, onReview }: { summary: ReturnType<typeof summarize>; months: number; onReview: () => void }) {
  const monthDelta = s.prevMonthSpend > 0 ? ((s.lastFullMonthSpend - s.prevMonthSpend) / s.prevMonthSpend) * 100 : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
      <Tile label={`Spend, last ${months} months`} value={fmtCompact(s.spend)}
            sub={s.avgFullMonth ? `about ${fmtCompact(s.avgFullMonth)} a full month` : 'no invoices'} />
      <Tile label={s.lastFullMonth ? `Spend in ${monthName(s.lastFullMonth)}` : 'Last full month'} value={fmtCompact(s.lastFullMonthSpend)}
            title="Invoices for a month keep arriving for a week or two after it ends, so a just-closed month can read low."
            sub={monthDelta == null ? '—' : `${monthDelta >= 0 ? '▲' : '▼'} ${Math.abs(monthDelta).toFixed(0)}% vs the month before`} />
      <Tile label="Prices up 2%+" value={String(s.upCount)}
            sub={s.upCount ? `+${fmtMoney(s.upImpact)} on the latest orders` : 'none in the period'} tone={s.upCount ? 'up' : undefined} />
      <Tile label="Prices down 2%+" value={String(s.downCount)}
            sub={s.downCount ? `−${fmtMoney(Math.abs(s.downImpact))} on the latest orders` : 'none in the period'} tone={s.downCount ? 'down' : undefined} />
      <Tile label="Priced per bottle" value={`${Math.round(s.pricedShare * 100)}%`}
            title="Share of purchase spend (credits and duplicate copies left out) with a reliable price per bottle."
            sub={s.unclearLines + s.unpricedOtherLines + s.checkCount
              ? <button onClick={onReview} style={linkBtn}>{s.unclearLines + s.unpricedOtherLines} lines not priced · {s.checkCount} changes to check</button>
              : 'of purchase spend'} />
    </div>
  );
}

function Tile({ label, value, sub, tone, title }: { label: string; value: string; sub?: ReactNode; tone?: 'up' | 'down'; title?: string }) {
  return (
    <Card padding={14}>
      <div title={title}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: tone === 'up' ? 'var(--raspberry-300)' : tone === 'down' ? 'var(--teal-300)' : 'var(--fg-primary)' }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-secondary)', marginTop: 2 }}>{sub}</div>}
      </div>
    </Card>
  );
}

/* ── price changes ────────────────────────────────────────────────────── */

function ChangesView({ movers, onItem }: { movers: Mover[]; onItem: (id: string) => void }) {
  const [minPct, setMinPct] = useState(String(TILE_MIN_PCT));
  const [sort, setSort] = useState<MoverSort>('impact');
  const { up, down } = useMemo(() => splitMovers(movers, Number(minPct) || 0, sort), [movers, minPct, sort]);

  const exportCsv = () => {
    const blob = new Blob([moversCsv([...up, ...down])], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `purchase-price-changes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label style={inlineLbl}>Smallest change shown
          <input style={{ ...picker, width: 70 }} inputMode="decimal" value={minPct} onChange={e => setMinPct(e.target.value)} />%
        </label>
        <div style={{ width: 320 }}>
          <Segment<MoverSort> value={sort} onChange={setSort} options={[{ value: 'impact', label: 'Rank by $ impact' }, { value: 'pct', label: 'Rank by %' }]} />
        </div>
        <div style={{ flex: 1 }} />
        <Btn variant="secondary" size="sm" onClick={exportCsv} disabled={!up.length && !down.length}>Export CSV</Btn>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>
        Each row is one item at one venue: its latest invoice price per bottle against the invoice before it. $ impact = the change per bottle × bottles on the latest invoice.
      </div>
      <MoverTable title="Price increases" rows={up} onItem={onItem} />
      <div style={{ height: 18 }} />
      <MoverTable title="Price decreases" rows={down} onItem={onItem} />
    </>
  );
}

function MoverTable({ title, rows, onItem }: { title: string; rows: Mover[]; onItem: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 25);
  const total = rows.reduce((s, m) => s + m.impact, 0);
  return (
    <Card flush padding={0}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px' }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} item{rows.length === 1 ? '' : 's'}{rows.length ? ` · ${total >= 0 ? '+' : '−'}${fmtMoney(Math.abs(total))} on the latest orders` : ''}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '0 14px 16px', color: 'var(--fg-muted)', fontSize: 13 }}>None for these filters.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tbl}>
            <thead>
              <tr style={headRow}>
                <th style={th}>Item</th><th style={th}>Venue</th><th style={th}>Vendor</th>
                <th style={thR}>Previous</th><th style={thR}>Latest</th><th style={thR}>Change / bottle</th>
                <th style={thR}>$ impact</th><th style={thR}>Lowest in period</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(m => (
                <tr key={m.key} style={rowBorder}>
                  <td style={{ ...td, maxWidth: 300 }}>
                    <button style={linkBtn} onClick={() => onItem(m.itemId)}>{m.itemName}</button>
                    <div style={subTxt}>{m.category}</div>
                  </td>
                  <td style={td}>{m.venueName}</td>
                  <td style={td}>
                    {m.latest.vendor || '—'}
                    {m.vendorChanged && <div style={subTxt} title={`Previous invoice was from ${m.prev.vendor}`}>was {m.prev.vendor}</div>}
                  </td>
                  <td style={tdR}><PriceCell p={m.prev} /></td>
                  <td style={tdR}><PriceCell p={m.latest} /></td>
                  <td style={tdR}>
                    <div style={{ fontWeight: 600, color: m.delta > 0 ? 'var(--raspberry-300)' : 'var(--teal-300)' }}>{m.delta > 0 ? '▲' : '▼'} {Math.abs(m.pct).toFixed(1)}%</div>
                    <div style={subTxt}>{m.delta > 0 ? '+' : '−'}{fmtMoney(Math.abs(m.delta))}</div>
                  </td>
                  <td style={tdR} title={`${round(m.latest.bottles)} bottles on the latest invoice`}>
                    <div style={{ fontWeight: 600 }}>{m.impact >= 0 ? '+' : '−'}{fmtMoney(Math.abs(m.impact))}</div>
                    <div style={subTxt}>{round(m.latest.bottles)} btl</div>
                  </td>
                  <td style={tdR}>
                    <div>{fmtMoney(m.best.perBottle)}</div>
                    <div style={subTxt}>{m.aboveBestPct >= 0.5 ? `latest is ${m.aboveBestPct.toFixed(0)}% above` : 'latest is the lowest'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 25 && (
        <div style={{ padding: '8px 14px 12px' }}>
          <Btn variant="ghost" size="sm" onClick={() => setAll(a => !a)}>{all ? 'Show top 25' : `Show all ${rows.length}`}</Btn>
        </div>
      )}
    </Card>
  );
}

function PriceCell({ p }: { p: { perBottle: number; date: string; invoiceNumber: string; casePrice: number; pack: number } }) {
  const title = p.pack > 1 ? `${fmtMoney(p.casePrice)} for a case of ${round(p.pack)}` : `${fmtMoney(p.casePrice)} per bottle`;
  return (
    <div title={title}>
      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(p.perBottle)}</div>
      <div style={subTxt}>{shortDate(p.date)}{p.invoiceNumber ? ` · #${p.invoiceNumber}` : ''}</div>
    </div>
  );
}

/* ── monthly spend ────────────────────────────────────────────────────── */

function SpendView({ lines, cat, today, range }: { lines: PricedLine[]; cat: CatFilter; today: Date; range: MonthRange }) {
  const [group, setGroup] = useState<SpendGroup>('category');
  const ms = useMemo(() => monthlySpend(lines, group, 8, range), [lines, group, range]);
  const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const cats: BevCategory[] = cat === 'all' ? ['Liquor', 'Wine'] : [cat];
  const rows = [...ms.months].reverse();

  return (
    <>
      <Card padding={16}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700 }}>Spend by month</div>
          {cats.length > 1 && <Legend items={cats.map(c => ({ label: c, color: CAT_COLOR[c], kind: 'rect' as const }))} />}
          <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Invoice line totals, credits netted, duplicates removed. {monthName(curMonth)} is month to date.</div>
        </div>
        <SpendChart ms={ms} cats={cats} curMonth={curMonth} />
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 10px' }}>
        <div style={{ fontWeight: 700 }}>Breakdown</div>
        <div style={{ width: 300 }}>
          <Segment<SpendGroup> value={group} onChange={setGroup} options={[{ value: 'category', label: 'Category' }, { value: 'venue', label: 'Venue' }, { value: 'vendor', label: 'Vendor' }]} />
        </div>
      </div>
      <Card flush padding={0}>
        <div style={{ overflowX: 'auto' }}>
          <table style={tbl}>
            <thead>
              <tr style={headRow}>
                <th style={th}>Month</th>
                {ms.groups.map(g => <th key={g} style={thR}>{g}</th>)}
                <th style={thR}>Total</th><th style={thR}>vs month before</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => {
                const prev = rows[i + 1];
                const d = prev && ms.totals[prev] > 0 && m !== curMonth ? ((ms.totals[m] - ms.totals[prev]) / ms.totals[prev]) * 100 : null;
                return (
                  <tr key={m} style={rowBorder}>
                    <td style={td}>{monthName(m)}{m === curMonth ? <span style={subTxt}> (to date)</span> : null}</td>
                    {ms.groups.map(g => <td key={g} style={tdNum}>{ms.cells[m]?.[g] ? fmtMoney0(ms.cells[m][g]) : '—'}</td>)}
                    <td style={{ ...tdNum, fontWeight: 700 }}>{fmtMoney0(ms.totals[m])}</td>
                    <td style={tdNum}>{d == null ? '—' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function SpendChart({ ms, cats, curMonth }: { ms: ReturnType<typeof monthlySpend>; cats: BevCategory[]; curMonth: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240, PL = 56, PR = 8, PT = 12, PB = 26;
  const months = ms.months;
  if (!months.length) return <div ref={ref} style={{ padding: 24, color: 'var(--fg-muted)' }}>No spend for these filters.</div>;
  const stackTotal = (m: string) => cats.reduce((s, c) => s + Math.max(0, ms.byCategory[m]?.[c] ?? 0), 0);
  const max = Math.max(...months.map(stackTotal), 1);
  const ticks = niceTicks(0, max, 4);
  const top = ticks[ticks.length - 1];
  const W = Math.max(width, 320);
  const band = (W - PL - PR) / months.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => H - PB - (v / top) * (H - PT - PB);
  const labelEvery = Math.ceil(months.length / 12);

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 10 }}>
      <svg width={W} height={H} role="img" aria-label="Spend by month">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-muted)">{fmtCompact(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = PL + band * i + band / 2;
          let base = 0;
          const segs = cats.map((c, ci) => {
            const v = Math.max(0, ms.byCategory[m]?.[c] ?? 0);
            const y0 = y(base), y1 = y(base + v);
            base += v;
            const isTop = ci === cats.length - 1 || cats.slice(ci + 1).every(cc => !((ms.byCategory[m]?.[cc] ?? 0) > 0));
            // 2px surface gap between stacked segments; 4px rounded data-end on the top segment only.
            const h = Math.max(0, y0 - y1 - (ci > 0 ? 2 : 0));
            if (h <= 0) return null;
            return <path key={c} d={barPath(cx - barW / 2, y1, barW, h, isTop ? 4 : 0)} fill={CAT_COLOR[c]} opacity={hover == null || hover === i ? 1 : 0.55} />;
          });
          return (
            <g key={m}>
              {segs}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">{monthShort(m)}{m === curMonth ? '*' : ''}</text>
              )}
              <rect x={PL + band * i} y={PT} width={band} height={H - PT - PB} fill="transparent" tabIndex={0}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    aria-label={`${monthName(m)} ${fmtMoney0(ms.totals[m])}`} />
            </g>
          );
        })}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
      </svg>
      {hover != null && (
        <Tooltip x={Math.min(PL + band * hover + band / 2 + 12, W - 190)} y={20}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney0(ms.totals[months[hover]])}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>{monthName(months[hover])}{months[hover] === curMonth ? ' (to date)' : ''}</div>
          {cats.map(c => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 12, height: 2, background: CAT_COLOR[c], display: 'inline-block' }} />
              <span style={{ fontWeight: 600 }}>{fmtMoney0(ms.byCategory[months[hover]]?.[c] ?? 0)}</span>
              <span style={{ color: 'var(--fg-muted)' }}>{c}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/* ── item history ─────────────────────────────────────────────────────── */

function ItemView({ priced, series, cat, itemId, setItemId, venueColor }: {
  priced: PricedLine[]; series: Series[]; cat: CatFilter; itemId: string | null;
  setItemId: (id: string | null) => void; venueColor: Map<string, string>;
}) {
  const [q, setQ] = useState('');
  // Items with a price per bottle in the current filters, most-bought first.
  const items = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const s of series) {
      const e = m.get(s.itemId) ?? { id: s.itemId, name: s.itemName, n: 0 };
      e.n += s.points.length; m.set(s.itemId, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [series]);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? items.filter(i => i.name.toLowerCase().includes(t)) : items).slice(0, 12);
  }, [items, q]);

  // The chosen item at EVERY venue — comparing venues is the point — within the category filter.
  const itemSeries = useMemo(() => {
    if (!itemId) return [];
    return buildSeries(priced.filter(l => l.item_id === itemId && (cat === 'all' || l.category === cat)));
  }, [priced, itemId, cat]);
  const name = itemSeries[0]?.itemName ?? items.find(i => i.id === itemId)?.name ?? '';

  return (
    <>
      <div style={{ position: 'relative', maxWidth: 520, marginBottom: 14 }}>
        <input style={{ ...picker, width: '100%' }} placeholder="Search an item (e.g. Casamigos Blanco)" value={q} onChange={e => setQ(e.target.value)} />
        {q.trim() && (
          <div style={dropdown}>
            {hits.length === 0 && <div style={{ padding: '8px 10px', fontSize: 13, color: 'var(--fg-muted)' }}>No priced item matches.</div>}
            {hits.map(h => (
              <div key={h.id} style={dropRow} onMouseDown={() => { setItemId(h.id); setQ(''); }}>
                {h.name} <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{h.n} invoice{h.n === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!itemId && (
        <Card padding={16}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Most-bought items</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {items.slice(0, 24).map(i => <Btn key={i.id} variant="secondary" size="sm" onClick={() => setItemId(i.id)}>{i.name}</Btn>)}
          </div>
        </Card>
      )}

      {itemId && itemSeries.length === 0 && <Card padding={16}>No priced invoices for this item in the period.</Card>}

      {itemId && itemSeries.length > 0 && (
        <>
          <Card padding={16}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
              <Pill tone="neutral" size="sm">{itemSeries[0].category}</Pill>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>every venue and vendor in the period</span>
              <div style={{ flex: 1 }} />
              <Btn variant="ghost" size="sm" onClick={() => setItemId(null)}>Clear</Btn>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
              {itemSeries.map(s => {
                const last = s.points[s.points.length - 1];
                const lo = Math.min(...s.points.map(p => p.perBottle)), hi = Math.max(...s.points.map(p => p.perBottle));
                return (
                  <div key={s.key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-secondary)' }}>
                      <span style={{ width: 14, height: 2, background: venueColor.get(s.venueId) ?? OTHER_GRAY, display: 'inline-block' }} />{s.venueName}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{fmtMoney(last.perBottle)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-muted)' }}> / bottle</span></div>
                    <div style={subTxt}>latest {shortDate(last.date)} · {last.vendor || '—'}</div>
                    <div style={subTxt}>{s.points.length} invoice{s.points.length === 1 ? '' : 's'} · range {fmtMoney(lo)}–{fmtMoney(hi)}</div>
                  </div>
                );
              })}
            </div>
            <PriceChart series={itemSeries} venueColor={venueColor} />
          </Card>

          <div style={{ height: 14 }} />
          <Card flush padding={0}>
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}>
                <thead>
                  <tr style={headRow}>
                    <th style={th}>Date</th><th style={th}>Venue</th><th style={th}>Vendor</th><th style={th}>Invoice</th>
                    <th style={thR}>Bottles</th><th style={thR}>As billed</th><th style={thR}>Per bottle</th><th style={thR}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {itemSeries.flatMap(s => s.points.map((p, i) => ({ s, p, prev: i > 0 ? s.points[i - 1] : null })))
                    .sort((a, b) => (a.p.date === b.p.date ? 0 : a.p.date < b.p.date ? 1 : -1))
                    .map(({ s, p, prev }) => {
                      const ch = prev ? ((p.perBottle - prev.perBottle) / prev.perBottle) * 100 : null;
                      return (
                        <tr key={s.key + p.invoiceId} style={rowBorder}>
                          <td style={td}>{shortDate(p.date)}</td>
                          <td style={td}>{s.venueName}</td>
                          <td style={td}>{p.vendor || '—'}</td>
                          <td style={td}>{p.invoiceNumber || '—'}</td>
                          <td style={tdNum}>{round(p.bottles)}</td>
                          <td style={tdNum}>{fmtMoney(p.casePrice)}{p.pack > 1 ? <span style={subTxt}> / {round(p.pack)}</span> : null}</td>
                          <td style={{ ...tdNum, fontWeight: 600 }}>{fmtMoney(p.perBottle)}</td>
                          <td style={tdNum}>{ch == null || Math.abs(ch) < 0.05 ? '—' : <span style={{ color: ch > 0 ? 'var(--raspberry-300)' : 'var(--teal-300)' }}>{ch > 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(1)}%</span>}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function PriceChart({ series, venueColor }: { series: Series[]; venueColor: Map<string, string> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ s: Series; i: number } | null>(null);
  const pts = series.flatMap(s => s.points);
  if (pts.length < 2) return <div ref={ref} />;
  const H = 240, PL = 56, PR = 12, PT = 12, PB = 26;
  const W = Math.max(width, 320);
  const t = (d: string) => new Date(d + 'T00:00:00').getTime();
  const t0 = Math.min(...pts.map(p => t(p.date))), t1 = Math.max(...pts.map(p => t(p.date)));
  const lo = Math.min(...pts.map(p => p.perBottle)), hi = Math.max(...pts.map(p => p.perBottle));
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.15 - 0.01), hi + (hi - lo) * 0.15 + 0.01, 4);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (d: string) => PL + (t1 === t0 ? (W - PL - PR) / 2 : ((t(d) - t0) / (t1 - t0)) * (W - PL - PR));
  const y = (v: number) => H - PB - ((v - yMin) / (yMax - yMin || 1)) * (H - PT - PB);
  // Month ticks along x (up to 6).
  const xTicks: string[] = [];
  { const a = new Date(t0), b = new Date(t1); const span = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    const step = Math.max(1, Math.ceil(span / 6));
    for (let k = 0; k <= span; k += step) { const d = new Date(a.getFullYear(), a.getMonth() + k, 1); if (d.getTime() >= t0) xTicks.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`); } }

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 14 }}>
      {series.length > 1 && <Legend items={series.map(s => ({ label: s.venueName, color: venueColor.get(s.venueId) ?? OTHER_GRAY, kind: 'line' as const }))} />}
      <svg width={W} height={H} role="img" aria-label="Price per bottle over time by venue">
        {ticks.map(v => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--fg-muted)">{fmtMoney(v)}</text>
          </g>
        ))}
        {xTicks.map(d => <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">{monthShort(d.slice(0, 7))}</text>)}
        {series.map(s => {
          const c = venueColor.get(s.venueId) ?? OTHER_GRAY;
          // Step-after: an invoice price holds until the next invoice.
          const d = s.points.map((p, i) => (i === 0 ? `M ${x(p.date)} ${y(p.perBottle)}` : `H ${x(p.date)} V ${y(p.perBottle)}`)).join(' ');
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p, i) => (
                <g key={p.invoiceId}>
                  <circle cx={x(p.date)} cy={y(p.perBottle)} r={4} fill={c} stroke="var(--surface)" strokeWidth={2} />
                  <circle cx={x(p.date)} cy={y(p.perBottle)} r={12} fill="transparent" tabIndex={0}
                          onMouseEnter={() => setHover({ s, i })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ s, i })} onBlur={() => setHover(null)} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        const p = hover.s.points[hover.i];
        return (
          <Tooltip x={Math.min(x(p.date) + 12, W - 210)} y={Math.max(0, y(p.perBottle) - 10)}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtMoney(p.perBottle)} <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--fg-muted)' }}>per bottle</span></div>
            <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 2, background: venueColor.get(hover.s.venueId) ?? OTHER_GRAY, display: 'inline-block' }} />{hover.s.venueName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{shortDate(p.date)} · {p.vendor || '—'}{p.invoiceNumber ? ` · #${p.invoiceNumber}` : ''}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.pack > 1 ? `${fmtMoney(p.casePrice)} for ${round(p.pack)}` : `${fmtMoney(p.casePrice)} each`} · {round(p.bottles)} btl</div>
          </Tooltip>
        );
      })()}
    </div>
  );
}

/* ── needs review ─────────────────────────────────────────────────────── */

function ReviewView({ lines, movers, onItem }: { lines: PricedLine[]; movers: Mover[]; onItem: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const check = useMemo(() => splitMovers(movers, TILE_MIN_PCT, 'impact').check, [movers]);
  const unclear = useMemo(() => lines.filter(l => l.excluded === 'units unclear').sort((a, b) => b.spend - a.spend), [lines]);
  const other = useMemo(() => lines.filter(l => l.excluded === 'no item' || l.excluded === 'no price').sort((a, b) => b.spend - a.spend), [lines]);
  const dups = useMemo(() => {
    const m = new Map<string, { id: string; num: string; of: string; venue: string; spend: number }>();
    for (const l of lines) if (l.excluded === 'duplicate') {
      const e = m.get(l.invoice_id) ?? { id: l.invoice_id, num: l.invoice_number ?? '—', of: l.dup_of ?? '', venue: l.venue_name ?? l.venue_id, spend: 0 };
      e.spend += lineSpend(l); m.set(l.invoice_id, e);
    }
    return [...m.values()];
  }, [lines]);
  const shown = all ? unclear : unclear.slice(0, 100);
  const sum = (xs: PricedLine[]) => xs.reduce((s, l) => s + l.spend, 0);

  return (
    <>
      <Card flush padding={0}>
        <SectionHead title="Price changes to check" n={check.length}
          sub="Left out of the increase / decrease totals: the price doubled or halved, the two invoices disagree on how many bottles the price covers, or it moved 25%+ with no cost on file to confirm the case size. Usually a case price read as a bottle, two vintages on one item, or a misread line — open the item to check." />
        {check.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead><tr style={headRow}><th style={th}>Item</th><th style={th}>Venue</th><th style={thR}>Previous</th><th style={thR}>Latest</th><th style={thR}>Change</th><th style={th}>Why it is here</th></tr></thead>
              <tbody>
                {check.map(m => (
                  <tr key={m.key} style={rowBorder}>
                    <td style={td}><button style={linkBtn} onClick={() => onItem(m.itemId)}>{m.itemName}</button></td>
                    <td style={td}>{m.venueName}</td>
                    <td style={tdR}><PriceCell p={m.prev} /></td>
                    <td style={tdR}><PriceCell p={m.latest} /></td>
                    <td style={tdNum}>{m.delta > 0 ? '▲' : '▼'} {Math.abs(m.pct).toFixed(0)}%</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--fg-muted)' }}>{checkReason(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: 14 }} />
      <Card flush padding={0}>
        <SectionHead title="Case size unclear" n={unclear.length}
          sub={`These lines count in spend (${fmtMoney0(sum(unclear))}) but not in price changes: the screen could not tell how many bottles the price covers. The invoice does not say, and either there is no cost on file or more than one case size fits it. Setting the item's cost, or mapping the vendor item, fixes them.`} />
        {unclear.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead><tr style={headRow}><th style={th}>Date</th><th style={th}>Venue</th><th style={th}>Item</th><th style={th}>As printed</th><th style={thR}>Qty</th><th style={thR}>Price</th><th style={th}>Why</th></tr></thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.line_id} style={rowBorder}>
                    <td style={td}>{shortDate(l.invoice_date)}<div style={subTxt}>#{l.invoice_number ?? '—'}</div></td>
                    <td style={td}>{l.venue_name ?? l.venue_id}<div style={subTxt}>{l.vendor_name ?? ''}</div></td>
                    <td style={{ ...td, maxWidth: 260 }}>{l.item_name ?? '—'}</td>
                    <td style={{ ...td, maxWidth: 260, color: 'var(--fg-secondary)' }}>{l.description ?? '—'}</td>
                    <td style={tdNum}>{l.qty ?? '—'}</td>
                    <td style={tdNum}>{l.unit_cost != null ? fmtMoney(l.unit_cost) : '—'}</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--fg-muted)', maxWidth: 240 }}>{l.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unclear.length > 100 && <div style={{ padding: '8px 14px 12px' }}><Btn variant="ghost" size="sm" onClick={() => setAll(a => !a)}>{all ? 'Show first 100' : `Show all ${unclear.length}`}</Btn></div>}
      </Card>

      <div style={{ height: 14 }} />
      <Card flush padding={0}>
        <SectionHead title="Not tied to one item, or no unit price" n={other.length}
          sub={`These lines count in spend (${fmtMoney0(sum(other))}) but have no single item to price: R365 placeholder lines, opening orders split across several wines, or a line with a total but no unit price.`} />
        {other.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead><tr style={headRow}><th style={th}>Date</th><th style={th}>Venue</th><th style={th}>As printed</th><th style={thR}>Amount</th><th style={th}>Why</th></tr></thead>
              <tbody>
                {other.slice(0, 100).map(l => (
                  <tr key={l.line_id} style={rowBorder}>
                    <td style={td}>{shortDate(l.invoice_date)}<div style={subTxt}>#{l.invoice_number ?? '—'}</div></td>
                    <td style={td}>{l.venue_name ?? l.venue_id}<div style={subTxt}>{l.vendor_name ?? ''}</div></td>
                    <td style={{ ...td, maxWidth: 360, color: 'var(--fg-secondary)' }}>{l.description ?? l.item_name ?? '—'}</td>
                    <td style={tdNum}>{fmtMoney(l.spend)}</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--fg-muted)' }}>{l.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {other.length > 100 && <div style={{ padding: '8px 14px 12px', fontSize: 12, color: 'var(--fg-muted)' }}>Showing the 100 largest of {other.length}.</div>}
      </Card>

      <div style={{ height: 14 }} />
      <Card flush padding={0}>
        <SectionHead title="Left out as duplicates" n={dups.length}
          sub="Invoices entered by hand that also came in from upstream (same venue, vendor and amount, or the same number with -BRIDGE). Left out of spend and prices so they are not counted twice." />
        {dups.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead><tr style={headRow}><th style={th}>Venue</th><th style={th}>Hand-entered copy</th><th style={th}>Original</th><th style={thR}>Liquor + wine on it</th></tr></thead>
              <tbody>{dups.map(d => <tr key={d.id} style={rowBorder}><td style={td}>{d.venue}</td><td style={td}>{d.num}</td><td style={td}>{d.of}</td><td style={tdNum}>{fmtMoney(d.spend)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function SectionHead({ title, sub, n }: { title: string; sub: string; n: number }) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <Pill tone={n ? 'caution' : 'positive'} size="sm">{n ? String(n) : 'none'}</Pill>
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4, maxWidth: 900 }}>{sub}</div>
    </div>
  );
}

/* ── chart bits ───────────────────────────────────────────────────────── */

function Legend({ items }: { items: Array<{ label: string; color: string; kind: 'rect' | 'line' }> }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-secondary)' }}>
      {items.map(i => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={i.kind === 'rect'
            ? { width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }
            : { width: 16, height: 2, background: i.color, display: 'inline-block' }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: Math.max(0, x), top: y, pointerEvents: 'none', zIndex: 5,
      background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 8,
      padding: '8px 10px', boxShadow: 'var(--shadow-sm)', minWidth: 160,
    }}>{children}</div>
  );
}

/** Column path: square at the baseline, `r` rounding on the data end. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}

/** Clean axis ticks (1 / 2 / 2.5 / 5 × 10^n steps) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v < hi + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Container width, tracked with a ResizeObserver. A callback ref so the
 *  observer attaches whenever the element mounts, not only on first render. */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(Math.floor(e.contentRect.width)); });
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/* ── formatting ───────────────────────────────────────────────────────── */

const fmtMoney = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney0 = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
function fmtCompact(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '−$' : '$';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return s + a.toFixed(0);
}
const round = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthName(ym: string): string { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; }
function monthShort(ym: string): string { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; }
function shortDate(d: string): string { const [y, m, day] = d.split('-'); return `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`; }

/* ── styles (match Transfers) ─────────────────────────────────────────── */

const picker: CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)' };
const inlineLbl: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-secondary)' };
const tbl: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 };
const headRow: CSSProperties = { textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
const th: CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
const thR: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const tdR: CSSProperties = { ...td, textAlign: 'right' };
const tdNum: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const rowBorder: CSSProperties = { borderTop: '1px solid var(--border)' };
const subTxt: CSSProperties = { fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 };
const linkBtn: CSSProperties = { border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--fg-primary)', textDecoration: 'underline', textDecorationColor: 'var(--border-strong)', cursor: 'pointer', textAlign: 'left' };
const errBox: CSSProperties = { marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12 };
const dropdown: CSSProperties = { position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, maxHeight: 300, overflowY: 'auto', boxShadow: 'var(--shadow-sm)' };
const dropRow: CSSProperties = { padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' };
