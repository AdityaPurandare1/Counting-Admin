import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import type { KountAudit, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Card, Eyebrow, Btn, Pill } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { buildVarianceWorkbookBlob, type AvtLikeRow } from '@/lib/varianceReport';

/* ───────────────────────────────────────────────────────────────────────
   Reports screen (corporate-only)

   Re-sourced (v0.39) from the COMPUTED variance, not recounts: for every
   audit visible under the venue / audit / date-window filters we load that
   audit's latest computed kount_avt_reports row (source='computed', newest),
   then pull all those reports' kount_avt_rows in one `.in('report_id', …)`
   query, tag each row with its venue / join_code / audit date, and
   concatenate. The on-screen table and the .xlsx export both come from this
   one AVT dataset via the shared buildVarianceWorkbookBlob — the same rich,
   multi-tab workbook the per-audit Variance screen produces.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

/** One AVT row tagged with its source audit, for display + export. */
interface ReportRow extends AvtLikeRow {
  _venueId: string;
  _auditId: string;
  _startedAt: string;
}

const AUDIT_LIMIT = 200;
const ROW_LIMIT = 20000;

type WindowChoice = 'all' | '30d' | '7d';

export function Reports({ user }: Props) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [venue, setVenue] = useState<string>('');
  const [auditId, setAuditId] = useState<string>('');
  const [window_, setWindow_] = useState<WindowChoice>('30d');
  const [exporting, setExporting] = useState(false);
  // Track when a query hits the hard cap so we can surface a banner instead of
  // silently truncating.
  const [auditTrunc, setAuditTrunc] = useState(false);
  const [rowTrunc, setRowTrunc] = useState(false);

  const visibleVenues = useMemo(() => {
    if (user.role === 'corporate' || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);

    const now = Date.now();
    const cutoff = window_ === '7d'  ? new Date(now - 7  * 86_400_000).toISOString()
                 : window_ === '30d' ? new Date(now - 30 * 86_400_000).toISOString()
                 : null;

    // Pull audits in window first so we can scope report lookups by audit_id
    // and also drive the audit picker.
    let aq = supabase
      .from('kount_audits')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(AUDIT_LIMIT);
    if (cutoff) aq = aq.gte('started_at', cutoff);
    const { data: auditRows, error: auditErr } = await aq;
    if (auditErr) { console.error('[reports] audits', auditErr); setRows([]); setAudits([]); setAuditTrunc(false); setRowTrunc(false); setLoading(false); return; }
    setAuditTrunc((auditRows?.length ?? 0) >= AUDIT_LIMIT);

    const allAudits = (auditRows ?? []) as KountAudit[];
    const visibleAudits = allAudits.filter(a => {
      if (user.role === 'corporate' || user.venueIds === 'all') return true;
      return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
    });
    setAudits(visibleAudits);

    if (visibleAudits.length === 0) { setRows([]); setRowTrunc(false); setLoading(false); return; }

    // Apply venue + single-audit filters to the set of audits we report on.
    const scopedAudits = visibleAudits.filter(a => {
      if (auditId && a.id !== auditId) return false;
      if (venue && a.venue_id !== venue) return false;
      return true;
    });
    if (scopedAudits.length === 0) { setRows([]); setRowTrunc(false); setLoading(false); return; }

    const auditIds = scopedAudits.map(a => a.id);

    // Pull every COMPUTED report for the scoped audits, then keep the newest
    // per audit (computed_at, falling back to uploaded_at). Uploaded reports
    // are DEPRECATED and intentionally excluded — the computed report is the
    // product.
    const { data: reportRows, error: reportErr } = await supabase
      .from('kount_avt_reports')
      .select('*')
      .in('audit_id', auditIds)
      .eq('source', 'computed')
      .order('computed_at', { ascending: false, nullsFirst: false });
    if (reportErr) { console.error('[reports] avt reports', reportErr); setRows([]); setRowTrunc(false); setLoading(false); return; }

    const reports = (reportRows ?? []) as KountAvtReport[];
    const latestByAudit = new Map<string, KountAvtReport>();
    for (const rep of reports) {
      if (!rep.audit_id) continue;
      const existing = latestByAudit.get(rep.audit_id);
      if (!existing) { latestByAudit.set(rep.audit_id, rep); continue; }
      const a = new Date(rep.computed_at ?? rep.uploaded_at).getTime();
      const b = new Date(existing.computed_at ?? existing.uploaded_at).getTime();
      if (a > b) latestByAudit.set(rep.audit_id, rep);
    }

    const latestReports = [...latestByAudit.values()];
    if (latestReports.length === 0) { setRows([]); setRowTrunc(false); setLoading(false); return; }

    // Pull all rows across the chosen reports, paginating past the 1000-row
    // PostgREST cap. A soft cap (ROW_LIMIT) protects the UI from a runaway
    // pull; selectAllPagedFiltered hard-stops at maxPages and throws, which we
    // treat as truncation rather than letting the table render half a dataset.
    const reportIds = latestReports.map(r => r.id);
    let avtRows: KountAvtRow[];
    let truncated = false;
    try {
      avtRows = await selectAllPagedFiltered<KountAvtRow>(
        () => supabase.from('kount_avt_rows').select('*').in('report_id', reportIds),
        { column: 'variance_value', ascending: true },
        1000,
        ROW_LIMIT / 1000,
      );
    } catch (err) {
      console.error('[reports] avt rows', err);
      avtRows = [];
      // A truncation error still means we have *some* data conceptually, but
      // selectAllPagedFiltered doesn't return the partial set on throw, so flag
      // the cap and show the empty/partial state honestly.
      truncated = /truncated/i.test(err instanceof Error ? err.message : '');
    }
    setRowTrunc(truncated || avtRows.length >= ROW_LIMIT);

    // Map report_id → its audit so each row can be tagged with venue/code/date.
    const auditByReportId = new Map<string, KountAudit>();
    const auditById = new Map(scopedAudits.map(a => [a.id, a]));
    for (const rep of latestReports) {
      const a = rep.audit_id ? auditById.get(rep.audit_id) : undefined;
      if (a) auditByReportId.set(rep.id, a);
    }

    const built: ReportRow[] = avtRows.flatMap(r => {
      const a = auditByReportId.get(r.report_id);
      if (!a) return [];
      return [{
        item_name:      r.item_name,
        category:       r.category,
        start_qty:      r.start_qty,
        purchases:      r.purchases,
        depletions:     r.depletions,
        actual:         r.actual,
        theo:           r.theo,
        variance:       r.variance,
        cu_price:       r.cu_price,
        variance_value: r.variance_value,
        variance_pct:   r.variance_pct,
        venue_name:     r.venue_name ?? a.venue_name,
        audit_code:     a.join_code,
        audit_date:     a.started_at.slice(0, 10),
        _venueId:       a.venue_id,
        _auditId:       a.id,
        _startedAt:     a.started_at,
      }];
    });

    setRows(built);
    setLoading(false);
  }, [user, venue, auditId, window_]);

  useEffect(() => { void load(); }, [load]);

  const exportReport = useCallback(async () => {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      // Title reflects whether the export is scoped to a single venue.
      const venueName = venue ? (VENUES.find(v => v.id === venue)?.name ?? '') : '';
      const title = venueName ? 'Variance Report — ' + venueName : 'Variance Report — All Audits';
      const ts = new Date().toISOString().slice(0, 10);
      const windowLabel = window_ === '7d' ? 'last 7 days' : window_ === '30d' ? 'last 30 days' : 'all time';
      const blob = await buildVarianceWorkbookBlob({
        title,
        subtitle: `${audits.length} audits in scope · ${windowLabel} · ${ts}`,
        rows: rows as AvtLikeRow[],
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'variance_report_' + ts + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[reports] export', e);
      alert('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }, [rows, exporting, venue, window_, audits.length]);

  const totalCount = rows.length;
  const multiVenue = useMemo(() => new Set(rows.map(r => r.venue_name ?? '')).size > 1, [rows]);

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>Reports</Eyebrow>
          <h1 className="page-title">Audit reports</h1>
          <div className="page-sub">Computed variance across audits — Item · Venue · Variance qty · Variance $ · Variance %. Export is the full formatted workbook (Summary · Largest Offenders · Possible Causes · Detail).</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select
          style={pickerStyle}
          value={venue}
          onChange={e => {
            // Changing venue invalidates any pinned audit — reset auditId so
            // the picker shows the new venue's audits.
            setVenue(e.target.value);
            setAuditId('');
          }}
        >
          <option value="">All venues</option>
          {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select style={pickerStyle} value={auditId} onChange={e => setAuditId(e.target.value)}>
          <option value="">All audits in window</option>
          {audits
            .filter(a => !venue || a.venue_id === venue)
            .map(a => (
              <option key={a.id} value={a.id}>
                {/* ISO YYYY-MM-DD so the same audit reads identically across locales. */}
                {a.venue_name} · {a.join_code} · {a.started_at.slice(0, 10)}
              </option>
            ))}
        </select>
        <select
          style={pickerStyle}
          value={window_}
          onChange={e => {
            // A window change can strand an auditId that's no longer visible.
            setWindow_(e.target.value as WindowChoice);
            setAuditId('');
          }}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        <div style={{ flex: 1 }} />
        <Pill tone="neutral" size="sm">{loading ? 'loading…' : totalCount + ' row' + (totalCount === 1 ? '' : 's')}</Pill>
        <Btn variant="primary" size="sm" onClick={() => void exportReport()} disabled={rows.length === 0 || exporting} leading={Ic.download(14)}>
          {exporting ? 'Building…' : 'Export Report'}
        </Btn>
      </div>

      {(auditTrunc || rowTrunc) && !loading && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,193,7,0.10)', border: '1px solid rgba(255,193,7,0.4)', fontSize: 12, color: 'var(--fg)' }}>
          ⚠ Result set is capped — narrow the date window or pick a single audit to see the rest.
          {auditTrunc && <> Audit list hit the {AUDIT_LIMIT}-row cap.</>}
          {rowTrunc   && <> Variance rows hit the {ROW_LIMIT}-row cap.</>}
        </div>
      )}

      <Card>
        {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>Loading reports…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No computed variance matches the current filters. Variance is computed automatically when an audit's Count 2 closes on the phone — try widening the date window or clearing the venue.
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={th}>Item</th>
                  <th style={th}>Category</th>
                  {multiVenue && <th style={th}>Venue</th>}
                  <th style={th}>Audit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Variance (qty)</th>
                  <th style={{ ...th, textAlign: 'right' }}>Variance $</th>
                  <th style={{ ...th, textAlign: 'right' }}>Variance %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._auditId + ':' + r.item_name + ':' + i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.item_name}</td>
                    <td style={{ ...td, color: 'var(--fg-muted)' }}>{r.category || '—'}</td>
                    {multiVenue && <td style={{ ...td, color: 'var(--fg-muted)' }}>{r.venue_name || '—'}</td>}
                    <td style={{ ...td, fontFamily: 'monospace' }}>{r.audit_code || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (r.variance ?? 0) < 0 ? 'var(--raspberry-300, #f06292)' : 'inherit' }}>
                      {r.variance != null ? r.variance.toFixed(2) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (r.variance_value ?? 0) < 0 ? 'var(--raspberry-300, #f06292)' : 'inherit' }}>
                      {r.variance_value != null
                        ? (r.variance_value < 0 ? '-$' : '$') + Math.abs(r.variance_value).toFixed(2)
                        : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (r.variance_pct ?? 0) < 0 ? 'var(--raspberry-300, #f06292)' : 'inherit' }}>
                      {r.variance_pct != null ? r.variance_pct.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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

const th: React.CSSProperties = { padding: '6px 8px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 8px', verticalAlign: 'top' };
