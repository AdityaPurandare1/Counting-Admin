import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES, isOrgWide } from '@/lib/access';
import type { KountAudit, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Card, Eyebrow, Money, Num, Pill, Btn } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   Item History (v0.63, from hursh-dev v0.59) — the "time machine" view.

   Every other screen (Variance, Reports, Overview) shows one audit's — or
   one period's — snapshot. There was no way to see "has this item been a
   chronic problem at this venue, or did something change last audit"
   without manually opening several past reports and cross-referencing by
   hand. kount_avt_rows already carries everything needed per audit
   (start_qty/purchases/depletions/actual/theo/variance*) — this just
   pulls it across every audit for one venue+item and lines it up by date.

   Items are matched by item_name (case-insensitive) — kount_avt_rows was
   never given a stable item id (no master_item_id column), so a renamed
   catalog item's history before/after the rename won't connect. Same gap
   class as the zone-name problem rename_venue_zone (0049) fixed, but for
   items — out of scope here, noted for whoever eventually tackles it.

   Scoped to ONE venue at a time, not blended across venues: mixing
   physically distinct stock into one timeline would misrepresent what's
   actually happening on the ground at any single location.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

interface HistoryPoint {
  auditId: string;
  auditCode: string;
  startedAt: string;
  startQty: number | null;
  purchases: number | null;
  transfersNet: number;
  depletions: number | null;
  actual: number | null;
  theo: number | null;
  variance: number | null;
  varianceValue: number | null;
  variancePct: number | null;
}

const AUDIT_LIMIT = 500;

export function ItemHistory({ user }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigate();

  const visibleVenues = useMemo(() => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const [venueId, setVenueId] = useState(() => searchParams.get('venue') || visibleVenues[0]?.id || '');
  const [itemInput, setItemInput] = useState(() => searchParams.get('item') || '');
  const [searchedItem, setSearchedItem] = useState(() => searchParams.get('item') || '');
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Re-sync from the URL if it changes under us (e.g. a click-through from
  // Variance/Overview while this screen is already mounted).
  useEffect(() => {
    const v = searchParams.get('venue');
    const i = searchParams.get('item');
    if (v && v !== venueId) setVenueId(v);
    if (i && i !== searchedItem) { setItemInput(i); setSearchedItem(i); }
    if (!i && searchedItem) { setSearchedItem(''); setSearched(false); setPoints([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const load = useCallback(async (vid: string, itemName: string) => {
    if (!vid || !itemName.trim()) return;
    setLoading(true);
    setSearched(true);
    setTruncated(false);
    setLoadError(null);
    // A failed read must not render as "no history for this item".
    const fail = (what: string, err: unknown) => {
      console.error('[item-history] ' + what, err);
      setLoadError(what + ' could not be loaded: ' + ((err as { message?: string })?.message ?? String(err)));
      setPoints([]); setLoading(false);
    };

    const { data: auditRows, error: auditErr } = await supabase
      .from('kount_audits')
      .select('*')
      .eq('venue_id', vid)
      .order('started_at', { ascending: false })
      .limit(AUDIT_LIMIT);
    if (auditErr) { fail('Audits', auditErr); return; }
    const audits = (auditRows ?? []) as KountAudit[];
    setTruncated(audits.length >= AUDIT_LIMIT);
    if (audits.length === 0) { setPoints([]); setLoading(false); return; }

    const auditIds = audits.map(a => a.id);
    const { data: reportRows, error: reportErr } = await supabase
      .from('kount_avt_reports')
      .select('*')
      .in('audit_id', auditIds)
      .eq('source', 'computed')
      .order('computed_at', { ascending: false, nullsFirst: false });
    if (reportErr) { fail('Variance reports', reportErr); return; }

    // Latest computed report per audit — same precedence as Variance/Reports/Overview.
    const latestByAudit = new Map<string, KountAvtReport>();
    for (const rep of (reportRows ?? []) as KountAvtReport[]) {
      if (!rep.audit_id) continue;
      const existing = latestByAudit.get(rep.audit_id);
      if (!existing) { latestByAudit.set(rep.audit_id, rep); continue; }
      const a = new Date(rep.computed_at ?? rep.uploaded_at).getTime();
      const b = new Date(existing.computed_at ?? existing.uploaded_at).getTime();
      if (a > b) latestByAudit.set(rep.audit_id, rep);
    }
    const latestReports = [...latestByAudit.values()];
    if (latestReports.length === 0) { setPoints([]); setLoading(false); return; }

    const reportIds = latestReports.map(r => r.id);
    // Exact, case-insensitive name match: escape ILIKE's wildcards so a name
    // containing % or _ can't match other items.
    const namePattern = itemName.trim().replace(/[\\%_]/g, m => '\\' + m);
    let avtRows: KountAvtRow[] = [];
    try {
      avtRows = await selectAllPagedFiltered<KountAvtRow>(
        () => supabase.from('kount_avt_rows').select('*').in('report_id', reportIds).ilike('item_name', namePattern),
        { column: 'id', ascending: true },
        1000,
        10,
      );
    } catch (err) {
      fail('Variance rows', err);
      return;
    }

    const auditByReportId = new Map<string, KountAudit>();
    const auditById = new Map(audits.map(a => [a.id, a]));
    for (const rep of latestReports) {
      const a = rep.audit_id ? auditById.get(rep.audit_id) : undefined;
      if (a) auditByReportId.set(rep.id, a);
    }

    const built: HistoryPoint[] = avtRows
      .map(r => {
        const a = auditByReportId.get(r.report_id);
        if (!a) return null;
        return {
          auditId: a.id,
          auditCode: a.join_code,
          startedAt: a.started_at,
          startQty: r.start_qty,
          purchases: r.purchases,
          transfersNet: Number(r.transfers_in ?? 0) - Number(r.transfers_out ?? 0),
          depletions: r.depletions,
          actual: r.actual,
          theo: r.theo,
          variance: r.variance,
          varianceValue: r.variance_value,
          variancePct: r.variance_pct,
        };
      })
      .filter((p): p is HistoryPoint => p !== null)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    setPoints(built);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (venueId && searchedItem) void load(venueId, searchedItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, searchedItem]);

  // v0.72: leave the single-item view and go back to the venue's 4-audit grid.
  const backToAll = () => {
    setSearchedItem(''); setItemInput(''); setSearched(false); setPoints([]); setLoadError(null);
    setSearchParams(venueId ? { venue: venueId } : {}, { replace: true });
  };

  const runSearch = () => {
    const item = itemInput.trim();
    if (!item || !venueId) return;
    setSearchedItem(item);
    setSearchParams({ venue: venueId, item }, { replace: true });
  };

  const summary = useMemo(() => {
    if (points.length === 0) return null;
    const totalVariance = points.reduce((s, p) => s + (p.varianceValue ?? 0), 0);
    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const trend = prev && latest.varianceValue != null && prev.varianceValue != null
      ? latest.varianceValue - prev.varianceValue
      : null;
    const worst = points.reduce((w, p) => (p.varianceValue != null && (w == null || p.varianceValue < w.varianceValue!)) ? p : w, null as HistoryPoint | null);
    return { totalVariance, latest, trend, worst, auditCount: points.length };
  }, [points]);

  // Tiny inline sparkline — no charting dependency, consistent with
  // Overview.tsx. Plots variance_value across audits, oldest to newest.
  const sparkline = useMemo(() => {
    const vals = points.map(p => p.varianceValue ?? 0);
    if (vals.length < 2) return null;
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 0);
    const range = max - min || 1;
    const w = 480, h = 60, pad = 6;
    const stepX = (w - pad * 2) / (vals.length - 1);
    const zeroY = h - pad - ((0 - min) / range) * (h - pad * 2);
    const coords = vals.map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y] as const;
    });
    const path = coords.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
    return { w, h, path, zeroY, coords };
  }, [points]);

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Item history</Eyebrow>
          <h1>Time machine</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            One item's counted/theoretical/variance numbers across every audit at a venue — same data Variance already computes, lined up over time.
          </div>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <select style={pickerStyle} value={venueId} onChange={e => { setVenueId(e.target.value); if (!searchedItem) setSearchParams({ venue: e.target.value }, { replace: true }); }}>
            {visibleVenues.length === 0 && <option value="">No venues</option>}
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input
            style={{ ...pickerStyle, width: 260 }}
            placeholder="Filter items, or type a name and press Show history"
            value={itemInput}
            onChange={e => setItemInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          />
          <Btn variant="primary" size="sm" onClick={runSearch} disabled={!itemInput.trim() || !venueId}>Show history</Btn>
          {loading && <Pill tone="neutral" size="sm">loading…</Pill>}
        </div>

        {truncated && !loading && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,193,7,0.10)', border: '1px solid rgba(255,193,7,0.4)', fontSize: 12, color: 'var(--fg)' }}>
            ⚠ This venue has {AUDIT_LIMIT}+ audits — only the most recent {AUDIT_LIMIT} were searched.
          </div>
        )}

        {!searchedItem && venueId && (
          <RecentAuditsGrid
            venueId={venueId}
            filter={itemInput}
            onPick={(name) => { setItemInput(name); setSearchedItem(name); setSearchParams({ venue: venueId, item: name }, { replace: true }); }}
          />
        )}

        {searchedItem && (
          <div style={{ marginBottom: 12 }}>
            <Btn variant="ghost" size="sm" onClick={backToAll}>&larr; All items (last 4 audits)</Btn>
          </div>
        )}

        {loadError && !loading && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12, color: 'var(--fg)' }}>
            {loadError}
          </div>
        )}

        {searched && searchedItem && !loading && !loadError && points.length === 0 && (
          <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No computed variance found for an item matching "{searchedItem}" at this venue. Check the spelling, or this item may not have appeared in a closed audit yet.
          </div></Card>
        )}

        {searchedItem && !loading && points.length > 0 && summary && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
              <Card>
                <div style={kpiLabel}>Cumulative variance ({summary.auditCount} audits)</div>
                <div style={{ marginTop: 6 }}><Money value={summary.totalVariance} showSign size={22} /></div>
              </Card>
              <Card>
                <div style={kpiLabel}>Latest audit</div>
                <div style={{ marginTop: 6 }}>{summary.latest.varianceValue != null ? <Money value={summary.latest.varianceValue} showSign size={18} /> : '—'}</div>
                {summary.trend != null && (
                  <div style={{ marginTop: 4, fontSize: 12, color: summary.trend >= 0 ? 'var(--positive, #2e7d32)' : 'var(--raspberry-300)' }}>
                    {summary.trend >= 0 ? '▲ improved' : '▼ worsened'} vs. previous audit
                  </div>
                )}
              </Card>
              <Card>
                <div style={kpiLabel}>Worst single audit</div>
                {summary.worst ? (
                  <>
                    <div style={{ marginTop: 6 }}><Money value={summary.worst.varianceValue ?? 0} showSign size={18} /></div>
                    <div style={{ marginTop: 2, fontSize: 12, color: 'var(--fg-muted)' }}>{summary.worst.startedAt.slice(0, 10)} · {summary.worst.auditCode}</div>
                  </>
                ) : <div style={{ marginTop: 6, color: 'var(--fg-muted)' }}>—</div>}
              </Card>
            </div>

            {sparkline && (
              <Card style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--fg-muted)', marginBottom: 8 }}>Variance $ over time</div>
                <svg width="100%" viewBox={'0 0 ' + sparkline.w + ' ' + sparkline.h} style={{ display: 'block', maxWidth: sparkline.w }}>
                  <line x1={0} y1={sparkline.zeroY} x2={sparkline.w} y2={sparkline.zeroY} stroke="var(--border)" strokeWidth={1} />
                  <path d={sparkline.path} fill="none" stroke="var(--accent-bg)" strokeWidth={2} />
                  {sparkline.coords.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={3} fill={points[i].varianceValue != null && points[i].varianceValue! < 0 ? 'var(--raspberry-300)' : 'var(--positive, #2e7d32)'} />
                  ))}
                </svg>
              </Card>
            )}

            <Card flush>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      <th style={th}>Audit</th>
                      <th style={{ ...th, textAlign: 'right' }}>Start</th>
                      <th style={{ ...th, textAlign: 'right' }}>Purchases</th>
                      <th style={{ ...th, textAlign: 'right' }}>Transfers</th>
                      <th style={{ ...th, textAlign: 'right' }}>Depletions</th>
                      <th style={{ ...th, textAlign: 'right' }}>Theo</th>
                      <th style={{ ...th, textAlign: 'right' }}>Actual</th>
                      <th style={{ ...th, textAlign: 'right' }}>Δ qty</th>
                      <th style={{ ...th, textAlign: 'right' }}>Δ $</th>
                      <th style={{ ...th, textAlign: 'right' }}>Δ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.slice().reverse().map(p => (
                      <tr key={p.auditId} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => nav('/variance?audit=' + p.auditId)}
                          title="Open this audit in Variance">
                        <td style={{ ...td, fontWeight: 500 }}>{p.startedAt.slice(0, 10)} · <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg-muted)' }}>{p.auditCode}</span></td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{p.startQty ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{p.purchases ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{p.transfersNet ? (p.transfersNet > 0 ? '+' : '') + p.transfersNet : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{p.depletions ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{p.theo ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{p.actual ?? '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{p.variance != null ? <Num value={Number(p.variance)} signed /> : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{p.varianceValue != null ? <Money value={Number(p.varianceValue)} showSign size={13} /> : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.variancePct != null ? p.variancePct.toFixed(1) + '%' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

const pickerStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 13,
};

const kpiLabel: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--fg-muted)' };
const th: React.CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };

/* ───────────────────────────────────────────────────────────────────────
   v0.72 -- the default view: every item at the venue across its last 4
   audits that have a computed report, counted qty and variance $ per audit
   plus the 4-audit total. The filter box narrows it live; clicking an item
   opens that item's full history above.
   ─────────────────────────────────────────────────────────────────────── */
export interface GridAudit { id: string; code: string; date: string; reportId: string }
export interface GridRow {
  item: string;
  category: string | null;
  cells: Record<string, { actual: number | null; variance: number | null; value: number | null }>;
  total: number;
}

/** Pivot avt rows (already limited to the chosen reports) into one row per item. Exported for the unit test. */
export function buildGrid(
  audits: GridAudit[],
  rows: Array<Pick<KountAvtRow, 'report_id' | 'item_name' | 'category' | 'actual' | 'variance' | 'variance_value'>>,
): GridRow[] {
  const auditByReport = new Map(audits.map(a => [a.reportId, a.id]));
  const byItem = new Map<string, GridRow>();
  for (const r of rows) {
    const auditId = auditByReport.get(r.report_id);
    if (!auditId) continue;
    const key = r.item_name.trim().toLowerCase();
    let g = byItem.get(key);
    if (!g) { g = { item: r.item_name, category: r.category, cells: {}, total: 0 }; byItem.set(key, g); }
    g.cells[auditId] = { actual: r.actual, variance: r.variance, value: r.variance_value };
    g.total += Number(r.variance_value ?? 0);
  }
  return [...byItem.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.item.localeCompare(b.item));
}

function RecentAuditsGrid({ venueId, filter, onPick }: { venueId: string; filter: string; onPick: (item: string) => void }) {
  const [audits, setAudits] = useState<GridAudit[]>([]);
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null); setErr(null);
    (async () => {
      const { data: aRows, error: aErr } = await supabase.from('kount_audits').select('*')
        .eq('venue_id', venueId).eq('status', 'submitted')
        .order('completed_at', { ascending: false, nullsFirst: false }).limit(20);
      if (!live) return;
      if (aErr) { setErr('Audits could not be loaded: ' + aErr.message); setRows([]); return; }
      const list = (aRows ?? []) as KountAudit[];
      if (list.length === 0) { setAudits([]); setRows([]); return; }
      const { data: rRows, error: rErr } = await supabase.from('kount_avt_reports').select('*')
        .in('audit_id', list.map(a => a.id)).eq('source', 'computed').order('computed_at', { ascending: false, nullsFirst: false });
      if (!live) return;
      if (rErr) { setErr('Variance reports could not be loaded: ' + rErr.message); setRows([]); return; }
      const latest = new Map<string, KountAvtReport>();
      for (const rep of (rRows ?? []) as KountAvtReport[]) if (rep.audit_id && !latest.has(rep.audit_id)) latest.set(rep.audit_id, rep);
      const picked: GridAudit[] = list.filter(a => latest.has(a.id)).slice(0, 4)
        .map(a => ({ id: a.id, code: a.join_code, date: (a.completed_at ?? a.started_at).slice(0, 10), reportId: latest.get(a.id)!.id }))
        .reverse();
      setAudits(picked);
      if (picked.length === 0) { setRows([]); return; }
      try {
        const avt = await selectAllPagedFiltered<KountAvtRow>(
          () => supabase.from('kount_avt_rows').select('report_id,item_name,category,actual,variance,variance_value').in('report_id', picked.map(p => p.reportId)),
          { column: 'item_name', ascending: true }, 1000, 20);
        if (!live) return;
        setRows(buildGrid(picked, avt));
      } catch (e) {
        if (!live) return;
        setErr('Variance rows could not be loaded: ' + (e instanceof Error ? e.message : String(e))); setRows([]);
      }
    })();
    return () => { live = false; };
  }, [venueId]);

  const f = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (rows ?? []).filter(r => !f || r.item.toLowerCase().includes(f) || (r.category ?? '').toLowerCase().includes(f)),
    [rows, f],
  );

  if (err) return <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12 }}>{err}</div>;
  if (rows === null) return <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>Loading the last 4 audits…</div></Card>;
  if (audits.length === 0) return <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>This venue has no closed audit with a variance report yet.</div></Card>;

  return (
    <Card flush>
      <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--fg-muted)' }}>
        {shown.length} of {rows.length} items · last {audits.length} audit{audits.length === 1 ? '' : 's'} · biggest 4-audit variance first · click an item for its full history
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 360 + audits.length * 170 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              <th style={th} rowSpan={2}>Item</th>
              {audits.map(a => (
                <th key={a.id} colSpan={2} style={{ ...th, textAlign: 'center', borderLeft: '1px solid var(--border)' }}>
                  {a.date} · <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{a.code}</span>
                </th>
              ))}
              <th style={{ ...th, textAlign: 'right', borderLeft: '1px solid var(--border)' }} rowSpan={2}>4-audit Δ $</th>
            </tr>
            <tr style={{ color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              {audits.map(a => [
                <th key={a.id + 'c'} style={{ ...th, textAlign: 'right', borderLeft: '1px solid var(--border)' }}>Counted</th>,
                <th key={a.id + 'v'} style={{ ...th, textAlign: 'right' }}>Δ $</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map(r => (
              <tr key={r.item} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => onPick(r.item)} title="Open this item's full history">
                <td style={{ ...td, fontWeight: 500 }}>
                  {r.item}
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 400 }}>{r.category ?? ''}</div>
                </td>
                {audits.map(a => {
                  const c = r.cells[a.id];
                  return [
                    <td key={a.id + 'c'} style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', borderLeft: '1px solid var(--border)' }}>
                      {c?.actual != null ? Number(c.actual) : '—'}
                    </td>,
                    <td key={a.id + 'v'} style={{ ...td, textAlign: 'right' }}>
                      {c?.value != null ? <Money value={Number(c.value)} showSign size={12} bold={false} /> : '—'}
                    </td>,
                  ];
                })}
                <td style={{ ...td, textAlign: 'right', borderLeft: '1px solid var(--border)' }}><Money value={r.total} showSign size={13} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 500 && <div style={{ padding: 10, fontSize: 12, color: 'var(--fg-muted)' }}>Showing the first 500. Type in the filter box to narrow it.</div>}
    </Card>
  );
}
