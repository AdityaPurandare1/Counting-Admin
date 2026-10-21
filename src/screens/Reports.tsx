import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES, isOrgWide } from '@/lib/access';
import type { KountAudit, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Card, Eyebrow, Btn, Pill, Money } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { buildVarianceWorkbookBlob, type AvtLikeRow } from '@/lib/varianceReport';
import { loadOpeningAuditIds } from '@/lib/openingCounts';

/* ───────────────────────────────────────────────────────────────────────
   Reports screen

   Data (unchanged since v0.39): for every audit visible under the venue /
   audit / date-window filters, the audit's newest COMPUTED kount_avt_reports
   row, then all those reports' kount_avt_rows in one paged pull. The table
   and the .xlsx export both come from that one dataset via
   buildVarianceWorkbookBlob.

   v0.72 redesign: summary tiles; an audit list that shows EVERY audit in
   scope -- including ones with no report yet, which used to make a venue
   look empty (Little Luck's LL-038 had none until 0099's 15-minute job);
   then the item table with search, category filter, sorting and paging.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

interface ReportRow extends AvtLikeRow {
  _venueId: string;
  _auditId: string;
  _startedAt: string;
}

export interface AuditSummary {
  audit: KountAudit;
  report: KountAvtReport | null;
  items: number;
  net: number;
  abs: number;
  within1: number;
}

const AUDIT_LIMIT = 200;
const ROW_LIMIT = 20000;
const PAGE = 200;

type WindowChoice = 'all' | '30d' | '7d' | '90d';
type SortChoice = 'abs' | 'neg' | 'pos' | 'name';
export type CatGroup = 'all' | 'Liquor' | 'Wine' | 'Beer' | 'Soft drinks' | 'Bar consumables' | 'Other';

/** Category -> the five groups used everywhere else in variance reporting. Exported for the unit test. */
export function catGroup(category: string | null | undefined): Exclude<CatGroup, 'all'> {
  const c = (category ?? '').toLowerCase();
  if (c.startsWith('liquor')) return 'Liquor';
  if (c.startsWith('wine')) return 'Wine';
  if (c.startsWith('beer')) return 'Beer';
  if (c.startsWith('n/a') || c.startsWith('non_alcoholic')) return 'Soft drinks';
  if (c.startsWith('bar')) return 'Bar consumables';
  return 'Other';
}

/** How an audit was closed, in words. Exported for the unit test. */
export function closedHow(a: Pick<KountAudit, 'status' | 'count_phase' | 'count1_closed_at' | 'count2_closed_at' | 'completed_at'>): string {
  if (a.status === 'active') return a.count1_closed_at ? 'Recount in progress' : 'Counting';
  if (a.status === 'cancelled') return 'Cancelled';
  if (a.count2_closed_at) return 'Count 2 closed';
  if (a.count1_closed_at) return 'Finalized after Count 1';
  return 'Submitted';
}

const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '—');

export function Reports({ user }: Props) {
  const nav = useNavigate();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [reportByAudit, setReportByAudit] = useState<Map<string, KountAvtReport>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [venue, setVenue] = useState<string>('');
  const [auditId, setAuditId] = useState<string>('');
  const [window_, setWindow_] = useState<WindowChoice>('30d');
  const [exporting, setExporting] = useState(false);
  const [auditTrunc, setAuditTrunc] = useState(false);
  const [rowTrunc, setRowTrunc] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CatGroup>('all');
  const [sort, setSort] = useState<SortChoice>('abs');
  const [limit, setLimit] = useState(PAGE);
  // v0.73: each venue's opening count (no earlier count to compare) -- labelled, kept out of the totals.
  const [openingIds, setOpeningIds] = useState<Set<string>>(new Set());

  const visibleVenues = useMemo(() => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const fail = (what: string, err: unknown) => {
      console.error('[reports] ' + what, err);
      setLoadError(what + ' could not be loaded: ' + ((err as { message?: string })?.message ?? String(err)));
      setRows([]); setRowTrunc(false); setLoading(false);
    };

    const now = Date.now();
    const days = window_ === '7d' ? 7 : window_ === '30d' ? 30 : window_ === '90d' ? 90 : null;
    const cutoff = days ? new Date(now - days * 86_400_000).toISOString() : null;

    let aq = supabase.from('kount_audits').select('*').neq('status', 'cancelled')
      .order('started_at', { ascending: false }).limit(AUDIT_LIMIT);
    if (cutoff) aq = aq.gte('started_at', cutoff);
    const { data: auditRows, error: auditErr } = await aq;
    if (auditErr) { fail('Audits', auditErr); setAudits([]); setAuditTrunc(false); return; }
    setAuditTrunc((auditRows?.length ?? 0) >= AUDIT_LIMIT);

    const visibleAudits = ((auditRows ?? []) as KountAudit[]).filter(a =>
      isOrgWide(user.role) || user.venueIds === 'all' || (Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id)));
    setAudits(visibleAudits);
    const opening = await loadOpeningAuditIds();
    if (opening.error) console.warn('[reports] opening counts not identified', opening.error);
    setOpeningIds(opening.ids);
    if (visibleAudits.length === 0) { setReportByAudit(new Map()); setRows([]); setRowTrunc(false); setLoading(false); return; }

    const { data: reportRows, error: reportErr } = await supabase.from('kount_avt_reports').select('*')
      .in('audit_id', visibleAudits.map(a => a.id)).eq('source', 'computed')
      .order('computed_at', { ascending: false, nullsFirst: false });
    if (reportErr) { fail('Variance reports', reportErr); return; }
    const latest = new Map<string, KountAvtReport>();
    for (const rep of (reportRows ?? []) as KountAvtReport[]) {
      if (!rep.audit_id) continue;
      const ex = latest.get(rep.audit_id);
      if (!ex || new Date(rep.computed_at ?? rep.uploaded_at).getTime() > new Date(ex.computed_at ?? ex.uploaded_at).getTime()) latest.set(rep.audit_id, rep);
    }
    setReportByAudit(latest);

    const scoped = visibleAudits.filter(a => (!auditId || a.id === auditId) && (!venue || a.venue_id === venue));
    const reports = scoped.map(a => latest.get(a.id)).filter((r): r is KountAvtReport => !!r);
    if (reports.length === 0) { setRows([]); setRowTrunc(false); setLoading(false); return; }

    let avtRows: KountAvtRow[] = [];
    let truncated = false;
    try {
      avtRows = await selectAllPagedFiltered<KountAvtRow>(
        () => supabase.from('kount_avt_rows').select('*').in('report_id', reports.map(r => r.id)),
        { column: 'variance_value', ascending: true }, 1000, ROW_LIMIT / 1000);
    } catch (err) {
      truncated = /truncated/i.test(err instanceof Error ? err.message : '');
      if (!truncated) { fail('Variance rows', err); return; }
    }
    setRowTrunc(truncated || avtRows.length >= ROW_LIMIT);

    const auditByReport = new Map<string, KountAudit>();
    const byId = new Map(scoped.map(a => [a.id, a]));
    for (const rep of reports) { const a = rep.audit_id ? byId.get(rep.audit_id) : undefined; if (a) auditByReport.set(rep.id, a); }

    setRows(avtRows.flatMap(r => {
      const a = auditByReport.get(r.report_id);
      if (!a) return [];
      return [{
        item_name: r.item_name, category: r.category, start_qty: r.start_qty, purchases: r.purchases,
        depletions: r.depletions, actual: r.actual, theo: r.theo, variance: r.variance, cu_price: r.cu_price,
        variance_value: r.variance_value, variance_pct: r.variance_pct,
        venue_name: r.venue_name ?? a.venue_name, audit_code: a.join_code, audit_date: a.started_at.slice(0, 10),
        _venueId: a.venue_id, _auditId: a.id, _startedAt: a.started_at,
      }];
    }));
    setLoading(false);
  }, [user, venue, auditId, window_]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setLimit(PAGE); }, [q, cat, sort, venue, auditId, window_]);

  // Per-audit summaries for the audit list (every audit in the venue/window scope, report or not).
  const auditSummaries = useMemo<AuditSummary[]>(() => {
    const byAudit = new Map<string, ReportRow[]>();
    for (const r of rows) byAudit.set(r._auditId, [...(byAudit.get(r._auditId) ?? []), r]);
    return audits
      .filter(a => !venue || a.venue_id === venue)
      .map(a => {
        const rs = byAudit.get(a.id) ?? [];
        return {
          audit: a, report: reportByAudit.get(a.id) ?? null, items: rs.length,
          net: rs.reduce((s, r) => s + Number(r.variance_value ?? 0), 0),
          abs: rs.reduce((s, r) => s + Math.abs(Number(r.variance_value ?? 0)), 0),
          within1: rs.filter(r => Math.abs(Number(r.variance ?? 0)) <= 1).length,
        };
      });
  }, [audits, rows, reportByAudit, venue]);

  // Rows that count toward totals: everything except opening counts, unless that opening count is
  // the one audit picked.
  const countedRows = useMemo(() => rows.filter(r => r._auditId === auditId || !openingIds.has(r._auditId)), [rows, openingIds, auditId]);

  const kpi = useMemo(() => {
    const scopedAudits = auditSummaries.filter(s => !auditId || s.audit.id === auditId);
    const submitted = scopedAudits.filter(s => s.audit.status === 'submitted');
    return {
      submitted: submitted.length,
      withReport: submitted.filter(s => s.report).length,
      opening: scopedAudits.filter(s => openingIds.has(s.audit.id) && s.audit.id !== auditId).length,
      net: countedRows.reduce((s, r) => s + Number(r.variance_value ?? 0), 0),
      abs: countedRows.reduce((s, r) => s + Math.abs(Number(r.variance_value ?? 0)), 0),
      within1: countedRows.length ? Math.round(100 * countedRows.filter(r => Math.abs(Number(r.variance ?? 0)) <= 1).length / countedRows.length) : 0,
    };
  }, [auditSummaries, countedRows, auditId, openingIds]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of countedRows) { const g = catGroup(r.category); m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  }, [countedRows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = countedRows.filter(r => (cat === 'all' || catGroup(r.category) === cat) && (!term || r.item_name.toLowerCase().includes(term)));
    const v = (r: ReportRow) => Number(r.variance_value ?? 0);
    if (sort === 'abs') out.sort((a, b) => Math.abs(v(b)) - Math.abs(v(a)));
    else if (sort === 'neg') out.sort((a, b) => v(a) - v(b));
    else if (sort === 'pos') out.sort((a, b) => v(b) - v(a));
    else out.sort((a, b) => a.item_name.localeCompare(b.item_name));
    return out;
  }, [countedRows, q, cat, sort]);

  const multiVenue = useMemo(() => new Set(rows.map(r => r.venue_name ?? '')).size > 1, [rows]);

  const exportReport = useCallback(async () => {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const venueName = venue ? (VENUES.find(v => v.id === venue)?.name ?? '') : '';
      const title = venueName ? 'Variance Report — ' + venueName : 'Variance Report — All Audits';
      const ts = new Date().toISOString().slice(0, 10);
      const windowLabel = window_ === '7d' ? 'last 7 days' : window_ === '30d' ? 'last 30 days' : window_ === '90d' ? 'last 90 days' : 'all time';
      const blob = await buildVarianceWorkbookBlob({ title, subtitle: `${kpi.withReport} audits · ${windowLabel} · ${ts}`, rows: rows as AvtLikeRow[] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'variance_report_' + ts + '.xlsx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('[reports] export', e);
      alert('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }, [rows, exporting, venue, window_, kpi.withReport]);

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Reports</Eyebrow>
          <h1>Audit reports</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>Computed variance for every closed count, by venue and audit. Export gives the full formatted workbook.</div>
        </div>
        <Btn variant="primary" size="sm" onClick={() => void exportReport()} disabled={rows.length === 0 || exporting} leading={Ic.download(14)}>
          {exporting ? 'Building…' : 'Export report'}
        </Btn>
      </div>

      <div className="content">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <select style={picker} value={venue} onChange={e => { setVenue(e.target.value); setAuditId(''); }}>
            <option value="">All venues</option>
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select style={picker} value={auditId} onChange={e => setAuditId(e.target.value)}>
            <option value="">All audits in window</option>
            {audits.filter(a => !venue || a.venue_id === venue).map(a => (
              <option key={a.id} value={a.id}>{a.venue_name} · {a.join_code} · {a.started_at.slice(0, 10)}</option>
            ))}
          </select>
          <select style={picker} value={window_} onChange={e => { setWindow_(e.target.value as WindowChoice); setAuditId(''); }}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          {loading && <Pill tone="neutral" size="sm">loading…</Pill>}
        </div>

        {loadError && <div style={errBox}>{loadError}</div>}
        {(auditTrunc || rowTrunc) && !loading && (
          <div style={warnBox}>
            Result set is capped. Narrow the date window or pick a single audit to see the rest.
            {auditTrunc && <> The audit list hit the {AUDIT_LIMIT}-audit cap.</>}
            {rowTrunc && <> Variance rows hit the {ROW_LIMIT}-row cap.</>}
          </div>
        )}

        {/* Summary tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <Tile label="Closed audits with a report" value={<span style={big}>{kpi.withReport}<span style={{ color: 'var(--fg-muted)', fontSize: 16 }}> / {kpi.submitted}</span></span>}
                sub={kpi.submitted > kpi.withReport ? `${kpi.submitted - kpi.withReport} still computing (runs every 15 min)` : 'all closed audits computed'} />
          <Tile label="Net variance" value={<Money value={kpi.net} showSign size={22} />}
                sub={kpi.opening ? `excludes ${kpi.opening} opening count${kpi.opening === 1 ? '' : 's'}` : 'counted minus expected, at cost'} />
          <Tile label="Absolute variance" value={<Money value={kpi.abs} size={22} />} sub="every item's miss, either direction" />
          <Tile label="Items within ±1 unit" value={<span style={big}>{kpi.within1}%</span>} sub={`${rows.length} item rows`} />
        </div>

        {/* Audits */}
        <Card flush style={{ marginBottom: 16 }}>
          <div style={sectionHead}><Eyebrow>Audits</Eyebrow><span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Click a row to see only that audit's items</span></div>
          {auditSummaries.length === 0 && !loading && <div style={empty}>No audits in this window. Try a longer window.</div>}
          {auditSummaries.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl(760)}>
                <thead><tr style={headRow}>
                  <th style={th}>Venue</th><th style={th}>Audit</th><th style={th}>Closed</th><th style={th}>How it closed</th><th style={th}>Report</th>
                  <th style={{ ...th, textAlign: 'right' }}>Items</th><th style={{ ...th, textAlign: 'right' }}>Net $</th><th style={{ ...th, textAlign: 'right' }}>Absolute $</th><th style={th} />
                </tr></thead>
                <tbody>
                  {auditSummaries.map(s => {
                    const a = s.audit; const selected = auditId === a.id;
                    return (
                      <tr key={a.id} onClick={() => setAuditId(selected ? '' : a.id)}
                          style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', background: selected ? 'var(--copper-100, rgba(0,0,0,0.03))' : undefined }}>
                        <td style={{ ...td, fontWeight: 500 }}>{a.venue_name}</td>
                        <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{a.join_code}</td>
                        <td style={td}>{fmtDate(a.completed_at ?? a.count2_closed_at ?? a.count1_closed_at ?? a.started_at)}</td>
                        <td style={{ ...td, color: 'var(--fg-muted)' }}>{closedHow(a)}</td>
                        <td style={td}>
                          {openingIds.has(a.id) ? <span title="The venue's first count: nothing earlier to compare, so its variance is the opening stock. Not in the totals."><Pill tone="neutral" size="sm">Opening count</Pill></span>
                            : s.report ? <Pill tone="positive" size="sm">Ready</Pill>
                            : a.status === 'submitted' ? <Pill tone="caution" size="sm">Computing</Pill>
                            : <Pill tone="neutral" size="sm">Not closed</Pill>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{s.report ? s.items : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{s.report ? <Money value={s.net} showSign size={13} /> : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{s.report ? <Money value={s.abs} size={13} bold={false} /> : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <Btn variant="ghost" size="sm" onClick={() => nav('/variance?audit=' + a.id)}>Open</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Items */}
        <Card flush>
          <div style={{ ...sectionHead, flexWrap: 'wrap', gap: 10 }}>
            <Eyebrow>Items{auditId ? ' · ' + (audits.find(a => a.id === auditId)?.join_code ?? '') : ''}</Eyebrow>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input style={{ ...picker, width: 220 }} placeholder="Search items" value={q} onChange={e => setQ(e.target.value)} />
              <select style={picker} value={sort} onChange={e => setSort(e.target.value as SortChoice)}>
                <option value="abs">Biggest $ either way</option>
                <option value="neg">Most short first</option>
                <option value="pos">Most over first</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 14px 10px' }}>
            {(['all', 'Liquor', 'Wine', 'Beer', 'Soft drinks', 'Bar consumables', 'Other'] as CatGroup[])
              .filter(g => g === 'all' || catCounts.get(g))
              .map(g => (
                <button key={g} onClick={() => setCat(g)} style={chip(cat === g)}>
                  {g === 'all' ? `All (${countedRows.length})` : `${g} (${catCounts.get(g)})`}
                </button>
              ))}
          </div>
          {!loading && rows.length === 0 && (
            <div style={empty}>
              No computed variance for these filters. Closed audits get their report automatically, within 15 minutes of closing.
            </div>
          )}
          {filtered.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl(820)}>
                <thead><tr style={headRow}>
                  <th style={th}>Item</th>{multiVenue && <th style={th}>Venue</th>}<th style={th}>Audit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Counted</th><th style={{ ...th, textAlign: 'right' }}>Expected</th>
                  <th style={{ ...th, textAlign: 'right' }}>Δ qty</th><th style={{ ...th, textAlign: 'right' }}>Δ $</th><th style={{ ...th, textAlign: 'right' }}>Δ %</th>
                </tr></thead>
                <tbody>
                  {filtered.slice(0, limit).map((r, i) => {
                    const neg = Number(r.variance_value ?? 0) < 0;
                    return (
                      <tr key={r._auditId + ':' + r.item_name + ':' + i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ ...td, fontWeight: 500 }}>{r.item_name}<div style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 400 }}>{catGroup(r.category)}</div></td>
                        {multiVenue && <td style={{ ...td, color: 'var(--fg-muted)' }}>{r.venue_name || '—'}</td>}
                        <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg-muted)' }}>{r.audit_code || '—'}</td>
                        <td style={num}>{r.actual != null ? Number(r.actual) : '—'}</td>
                        <td style={num}>{r.theo != null ? Number(r.theo).toFixed(1) : '—'}</td>
                        <td style={{ ...num, color: neg ? 'var(--raspberry-300)' : undefined }}>{r.variance != null ? (r.variance > 0 ? '+' : '') + Number(r.variance).toFixed(1) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{r.variance_value != null ? <Money value={Number(r.variance_value)} showSign size={13} /> : '—'}</td>
                        <td style={{ ...num, color: neg ? 'var(--raspberry-300)' : 'var(--fg-muted)' }}>{r.variance_pct != null ? Number(r.variance_pct).toFixed(1) + '%' : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > limit && (
            <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
              <Btn variant="secondary" size="sm" onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Btn>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{limit} of {filtered.length} shown</span>
            </div>
          )}
          {rows.length > 0 && filtered.length === 0 && <div style={empty}>No items match "{q}".</div>}
        </Card>
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <Card>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{ marginTop: 6 }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--fg-muted)' }}>{sub}</div>
    </Card>
  );
}

const picker: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)' };
const big: React.CSSProperties = { fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' };
const sectionHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px' };
const headRow: React.CSSProperties = { textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
const th: React.CSSProperties = { padding: '8px 12px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '9px 12px', verticalAlign: 'top' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'JetBrains Mono, monospace' };
const tbl = (min: number): React.CSSProperties => ({ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: min });
const empty: React.CSSProperties = { padding: 24, textAlign: 'center', color: 'var(--fg-muted)' };
const chip = (on: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  border: '1px solid ' + (on ? 'var(--dark-900, #222)' : 'var(--border-strong)'),
  background: on ? 'var(--dark-900, #222)' : 'var(--surface)', color: on ? 'var(--off-100, #fff)' : 'var(--fg-primary)',
});
const errBox: React.CSSProperties = { marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12 };
const warnBox: React.CSSProperties = { marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,193,7,0.10)', border: '1px solid rgba(255,193,7,0.4)', fontSize: 12 };
