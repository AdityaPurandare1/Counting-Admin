import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES, isOrgWide } from '@/lib/access';
import type { KountAudit, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Card, Eyebrow, Money, Pill } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   Overview (v0.63, from hursh-dev v0.58)

   Every other screen (Variance, Reports, Summary) is scoped to one venue
   or one audit at a time — there was no single place to see "which
   venues are bleeding money this month, and is it getting better or
   worse." This reuses Reports.tsx's exact data pipeline (pull audits in
   a window across every visible venue, take each audit's latest computed
   kount_avt_rows, same source='computed' precedence) but groups the
   result BY VENUE instead of leaving it as one flat row list.

   Access mirrors Reports.tsx: corporate sees every venue; a manager or
   venue_manager sees only their own assigned venue(s) — same screen,
   same code path, just a narrower venue set. For a single-venue manager
   this degenerates into a one-row table, which is still the right answer
   for "how is my venue trending."
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

type WindowChoice = '7d' | '30d' | 'all';
type Period = 'current' | 'previous';

interface TaggedRow {
  venue_id: string;
  venue_name: string;
  item_name: string;
  variance_value: number;
  theo: number | null;
  cu_price: number | null;
  period: Period;
}

interface TaggedAudit {
  venue_id: string;
  started_at: string;
  period: Period;
}

interface VenueAgg {
  venueId: string;
  venueName: string;
  auditCount: number;
  latestAuditDate: string | null;
  varianceTotal: number;
  theoDollarTotal: number;
  prevVarianceTotal: number;
  prevAuditCount: number;
}

const AUDIT_LIMIT = 400; // covers current + previous window in one pull
const ROW_LIMIT = 20000;

export function Overview({ user }: Props) {
  const nav = useNavigate();
  const [window_, setWindow_] = useState<WindowChoice>('30d');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TaggedRow[]>([]);
  const [taggedAudits, setTaggedAudits] = useState<TaggedAudit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const visibleVenues = useMemo(() => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setTruncated(false);
    setLoadError(null);
    // A failed read must not render as "no variance" — that reads as a clean
    // month. Every early exit below on error sets this instead.
    const fail = (what: string, err: unknown) => {
      console.error('[overview] ' + what, err);
      setLoadError(what + ' could not be loaded: ' + ((err as { message?: string })?.message ?? String(err)));
      setRows([]); setTaggedAudits([]); setLoading(false);
    };

    const now = Date.now();
    // 'all' has no meaningful "previous period" to compare against — both
    // cutoffs stay null and everything in range counts as "current".
    const currentCutoff = window_ === '7d'  ? new Date(now - 7  * 86_400_000).toISOString()
                         : window_ === '30d' ? new Date(now - 30 * 86_400_000).toISOString()
                         : null;
    const prevCutoff = window_ === '7d'  ? new Date(now - 14 * 86_400_000).toISOString()
                      : window_ === '30d' ? new Date(now - 60 * 86_400_000).toISOString()
                      : null;
    const periodOf = (startedAt: string): Period | null => {
      if (!currentCutoff) return 'current';
      if (startedAt >= currentCutoff) return 'current';
      if (prevCutoff && startedAt >= prevCutoff) return 'previous';
      return null;
    };

    // Pull current + previous period in one query (fetch from prevCutoff
    // onward), then split client-side by date — same audit set either way,
    // half the round trips of running the Reports.tsx pipeline twice.
    let aq = supabase.from('kount_audits').select('*').order('started_at', { ascending: false }).limit(AUDIT_LIMIT);
    if (prevCutoff) aq = aq.gte('started_at', prevCutoff);
    const { data: auditRows, error: auditErr } = await aq;
    if (auditErr) { fail('Audits', auditErr); return; }
    const auditLimitHit = (auditRows?.length ?? 0) >= AUDIT_LIMIT;

    const scopedAudits = ((auditRows ?? []) as KountAudit[]).filter(a => {
      if (isOrgWide(user.role) || user.venueIds === 'all') return true;
      return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
    });
    if (scopedAudits.length === 0) { setRows([]); setTaggedAudits([]); setLoading(false); return; }

    // Latest COMPUTED report per audit — uploaded AVT is deprecated, same
    // precedence Reports.tsx and Variance.tsx already use.
    const auditIds = scopedAudits.map(a => a.id);
    const { data: reportRows, error: reportErr } = await supabase
      .from('kount_avt_reports')
      .select('*')
      .in('audit_id', auditIds)
      .eq('source', 'computed')
      .order('computed_at', { ascending: false, nullsFirst: false });
    if (reportErr) { fail('Variance reports', reportErr); return; }

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
    if (latestReports.length === 0) { setRows([]); setTaggedAudits([]); setLoading(false); return; }

    const auditById = new Map(scopedAudits.map(a => [a.id, a]));
    const auditByReportId = new Map<string, KountAudit>();
    for (const rep of latestReports) {
      const a = rep.audit_id ? auditById.get(rep.audit_id) : undefined;
      if (a) auditByReportId.set(rep.id, a);
    }

    // Audit counts/latest-date come from the audit set directly (not the
    // rows below) so a venue with a computed-but-empty report still counts.
    const taggedAuditList: TaggedAudit[] = [];
    for (const a of auditByReportId.values()) {
      const period = periodOf(a.started_at);
      if (period) taggedAuditList.push({ venue_id: a.venue_id, started_at: a.started_at, period });
    }
    setTaggedAudits(taggedAuditList);

    const reportIds = latestReports.map(r => r.id);
    let avtRows: KountAvtRow[] = [];
    let rowLimitHit = false;
    try {
      avtRows = await selectAllPagedFiltered<KountAvtRow>(
        () => supabase.from('kount_avt_rows').select('*').in('report_id', reportIds),
        { column: 'variance_value', ascending: true },
        1000,
        ROW_LIMIT / 1000,
      );
    } catch (err) {
      rowLimitHit = /truncated/i.test(err instanceof Error ? err.message : '');
      if (!rowLimitHit) { fail('Variance rows', err); return; }
      console.warn('[overview] avt rows truncated', err);
    }
    setTruncated(auditLimitHit || rowLimitHit || avtRows.length >= ROW_LIMIT);

    const built: TaggedRow[] = [];
    for (const r of avtRows) {
      const a = auditByReportId.get(r.report_id);
      if (!a) continue;
      const period = periodOf(a.started_at);
      if (!period) continue;
      built.push({
        venue_id: a.venue_id,
        venue_name: r.venue_name ?? a.venue_name,
        item_name: r.item_name,
        variance_value: Number(r.variance_value ?? 0),
        theo: r.theo,
        cu_price: r.cu_price,
        period,
      });
    }
    setRows(built);
    setLoading(false);
  }, [user, window_]);

  useEffect(() => { void load(); }, [load]);

  const venueAgg = useMemo(() => {
    const map = new Map<string, VenueAgg>();
    for (const v of visibleVenues) {
      map.set(v.id, { venueId: v.id, venueName: v.name, auditCount: 0, latestAuditDate: null, varianceTotal: 0, theoDollarTotal: 0, prevVarianceTotal: 0, prevAuditCount: 0 });
    }
    for (const ta of taggedAudits) {
      const agg = map.get(ta.venue_id);
      if (!agg) continue;
      if (ta.period === 'previous') { agg.prevAuditCount += 1; continue; }
      agg.auditCount += 1;
      if (!agg.latestAuditDate || ta.started_at > agg.latestAuditDate) agg.latestAuditDate = ta.started_at;
    }
    for (const r of rows) {
      const agg = map.get(r.venue_id);
      if (!agg) continue;
      if (r.period === 'current') {
        agg.varianceTotal += r.variance_value;
        agg.theoDollarTotal += (r.theo ?? 0) * (r.cu_price ?? 0);
      } else {
        agg.prevVarianceTotal += r.variance_value;
      }
    }
    // Worst (most negative variance) first — venues with no audits in the
    // window sort to the bottom regardless of stale totals.
    return [...map.values()].sort((a, b) => {
      if (a.auditCount === 0 && b.auditCount === 0) return a.venueName.localeCompare(b.venueName);
      if (a.auditCount === 0) return 1;
      if (b.auditCount === 0) return -1;
      return a.varianceTotal - b.varianceTotal;
    });
  }, [visibleVenues, rows, taggedAudits]);

  const company = useMemo(() => {
    const audited = venueAgg.filter(v => v.auditCount > 0);
    const total = audited.reduce((s, v) => s + v.varianceTotal, 0);
    // Trend compares only venues audited in BOTH periods; a venue with no
    // prior audit has nothing to improve on, and counting its whole variance
    // as "worsened" would be wrong.
    const comparable = audited.filter(v => v.prevAuditCount > 0);
    const compTotal = comparable.reduce((s, v) => s + v.varianceTotal, 0);
    const prevTotal = comparable.reduce((s, v) => s + v.prevVarianceTotal, 0);
    const worstVenue = audited[0] ?? null; // already sorted worst-first
    return { total, compTotal, prevTotal, comparableCount: comparable.length, venuesAudited: audited.length, worstVenue };
  }, [venueAgg]);

  const topItems = useMemo(() => {
    return rows
      .filter(r => r.period === 'current' && r.variance_value < 0)
      .slice()
      .sort((a, b) => a.variance_value - b.variance_value)
      .slice(0, 10);
  }, [rows]);

  const showTrend = window_ !== 'all';
  const trendDelta = company.compTotal - company.prevTotal;

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Overview</Eyebrow>
          <h1>Company overview</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Computed variance rolled up across {visibleVenues.length === 1 ? 'your venue' : 'every venue you can see'} — same data as Reports, grouped differently.
          </div>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <select style={pickerStyle} value={window_} onChange={e => setWindow_(e.target.value as WindowChoice)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
          <div style={{ flex: 1 }} />
          <Pill tone="neutral" size="sm">{loading ? 'loading…' : company.venuesAudited + ' of ' + visibleVenues.length + ' venue' + (visibleVenues.length === 1 ? '' : 's') + ' audited'}</Pill>
        </div>

        {truncated && !loading && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,193,7,0.10)', border: '1px solid rgba(255,193,7,0.4)', fontSize: 12, color: 'var(--fg)' }}>
            ⚠ Result set is capped — narrow the date window to see the rest.
          </div>
        )}

        {loadError && !loading && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12, color: 'var(--fg)' }}>
            {loadError}
          </div>
        )}

        {!loading && !loadError && company.venuesAudited === 0 && (
          <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No computed variance in this window. Variance is computed automatically when an audit's Count 2 closes on the phone — try widening the date range.
          </div></Card>
        )}

        {(loading || company.venuesAudited > 0) && (
          <>
            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
              <Card>
                <div style={kpiLabel}>Total variance{showTrend ? ' this period' : ''}</div>
                <div style={{ marginTop: 6 }}><Money value={company.total} showSign size={22} /></div>
                {showTrend && company.comparableCount > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: trendDelta >= 0 ? 'var(--positive, #2e7d32)' : 'var(--raspberry-300)' }}>
                    {trendDelta >= 0 ? '▲ improved' : '▼ worsened'} by <Money value={Math.abs(trendDelta)} size={12} bold={false} /> vs. prior period
                    {company.comparableCount < company.venuesAudited ? ' (' + company.comparableCount + ' venue' + (company.comparableCount === 1 ? '' : 's') + ' audited in both)' : ''}
                  </div>
                )}
              </Card>
              <Card>
                <div style={kpiLabel}>Venues audited</div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700 }}>{company.venuesAudited} / {visibleVenues.length}</div>
              </Card>
              <Card>
                <div style={kpiLabel}>Worst venue</div>
                {company.worstVenue ? (
                  <>
                    <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>{company.worstVenue.venueName}</div>
                    <div style={{ marginTop: 2 }}><Money value={company.worstVenue.varianceTotal} showSign size={14} /></div>
                  </>
                ) : <div style={{ marginTop: 6, color: 'var(--fg-muted)' }}>—</div>}
              </Card>
              <Card>
                <div style={kpiLabel}>Biggest single-item loss</div>
                {topItems[0] ? (
                  <>
                    <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>{topItems[0].item_name}</div>
                    <div style={{ marginTop: 2, fontSize: 12, color: 'var(--fg-muted)' }}>{topItems[0].venue_name}</div>
                    <div style={{ marginTop: 2 }}><Money value={topItems[0].variance_value} showSign size={14} /></div>
                  </>
                ) : <div style={{ marginTop: 6, color: 'var(--fg-muted)' }}>—</div>}
              </Card>
            </div>

            {/* Per-venue table */}
            <Card style={{ marginBottom: 16 }} flush>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      <th style={th}>Venue</th>
                      <th style={{ ...th, textAlign: 'right' }}>Audits</th>
                      <th style={{ ...th, textAlign: 'right' }}>Variance $</th>
                      <th style={{ ...th, textAlign: 'right' }}>Variance %</th>
                      {showTrend && <th style={{ ...th, textAlign: 'right' }}>Trend</th>}
                      <th style={th}>Latest audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venueAgg.map(v => {
                      const pct = v.theoDollarTotal !== 0 ? (v.varianceTotal / Math.abs(v.theoDollarTotal)) * 100 : null;
                      const delta = v.varianceTotal - v.prevVarianceTotal;
                      return (
                        <tr key={v.venueId} style={{ borderBottom: '1px solid var(--border)', opacity: v.auditCount === 0 ? 0.5 : 1 }}>
                          <td style={{ ...td, fontWeight: 500 }}>{v.venueName}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{v.auditCount}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{v.auditCount > 0 ? <Money value={v.varianceTotal} showSign size={13} /> : '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct != null ? pct.toFixed(1) + '%' : '—'}</td>
                          {showTrend && (
                            <td style={{ ...td, textAlign: 'right', fontSize: 12, color: (v.auditCount === 0 || v.prevAuditCount === 0) ? 'var(--fg-muted)' : (delta >= 0 ? 'var(--positive, #2e7d32)' : 'var(--raspberry-300)') }}>
                              {v.auditCount > 0 && v.prevAuditCount > 0 ? (delta >= 0 ? '▲' : '▼') + ' $' + Math.abs(delta).toFixed(0) : '—'}
                            </td>
                          )}
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{v.latestAuditDate ? v.latestAuditDate.slice(0, 10) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Top problem items across all venues */}
            <Card flush>
              <div style={{ padding: '14px 16px 0', fontSize: 13, fontWeight: 600 }}>Biggest variances across all venues</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      <th style={th}>Item</th>
                      <th style={th}>Venue</th>
                      <th style={{ ...th, textAlign: 'right' }}>Variance $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topItems.length === 0 && (
                      <tr><td style={td} colSpan={3}><span style={{ color: 'var(--fg-muted)' }}>No negative variance items in this window.</span></td></tr>
                    )}
                    {topItems.map((r, i) => (
                      <tr
                        key={r.venue_id + ':' + r.item_name + ':' + i}
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        title="View this item's history at this venue"
                        onClick={() => nav('/item-history?venue=' + encodeURIComponent(r.venue_id) + '&item=' + encodeURIComponent(r.item_name))}
                      >
                        <td style={{ ...td, fontWeight: 500, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}>{r.item_name}</td>
                        <td style={{ ...td, color: 'var(--fg-muted)' }}>{r.venue_name}</td>
                        <td style={{ ...td, textAlign: 'right' }}><Money value={r.variance_value} showSign size={13} /></td>
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
