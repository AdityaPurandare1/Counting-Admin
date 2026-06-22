import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import type { KountAudit, KountRecount } from '@/lib/types';
import { Card, Eyebrow, Btn, Pill } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   Reports screen (corporate-only)

   One row per recount item across the venues the user has access to.
   Columns mirror the format the corporate team already uses internally:

     Item · Category · Issue Type · Variance · Replacement Value
        · Audit Results · Counter Initials · Context

   Filters: venue + audit + date window. CSV export uses native Blob
   download so we don't need a CSV writer dependency.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

interface ReportRow {
  item: string;
  category: string;
  issueType: string;
  variance: number | null;
  replacementValue: number | null;
  auditResult: string;
  counterInitials: string;
  context: string;
  // Bookkeeping for the venue/audit filters; not surfaced as a column.
  _venueId: string;
  _venueName: string;
  _auditId: string;
  _startedAt: string;
}

const AUDIT_LIMIT   = 200;
const RECOUNT_LIMIT = 5000;

type WindowChoice = 'all' | '30d' | '7d';

export function Reports({ user }: Props) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [venue, setVenue] = useState<string>('');
  const [auditId, setAuditId] = useState<string>('');
  const [window_, setWindow_] = useState<WindowChoice>('30d');
  // Track when a query hits the hard cap so we can surface a banner
  // instead of silently truncating. The cap protects against a runaway
  // 100k-row pull, but the user needs to know they're seeing a window.
  const [auditTrunc,   setAuditTrunc]   = useState(false);
  const [recountTrunc, setRecountTrunc] = useState(false);

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

    // Pull audits in window first so we can filter recounts by audit_id and
    // also surface the audit picker. Hard cap so a runaway environment
    // doesn't paginate forever.
    let aq = supabase
      .from('kount_audits')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(AUDIT_LIMIT);
    if (cutoff) aq = aq.gte('started_at', cutoff);
    const { data: auditRows, error: auditErr } = await aq;
    // Clear rows on error — otherwise the previous successful load lingers
    // visibly with loading=false, which makes the user think the failed
    // query succeeded.
    if (auditErr) { console.error('[reports] audits', auditErr); setRows([]); setAudits([]); setAuditTrunc(false); setRecountTrunc(false); setLoading(false); return; }
    setAuditTrunc((auditRows?.length ?? 0) >= AUDIT_LIMIT);

    const allAudits = (auditRows ?? []) as KountAudit[];
    const visibleAudits = allAudits.filter(a => {
      if (user.role === 'corporate' || user.venueIds === 'all') return true;
      return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
    });
    setAudits(visibleAudits);

    if (visibleAudits.length === 0) { setRows([]); setLoading(false); return; }

    // Restrict to a single audit if the user picked one. Otherwise pull
    // recounts across every audit they can see.
    const auditIds = auditId
      ? visibleAudits.filter(a => a.id === auditId).map(a => a.id)
      : visibleAudits.map(a => a.id);

    if (auditIds.length === 0) { setRows([]); setLoading(false); return; }

    const { data: recountRows, error: recountErr } = await supabase
      .from('kount_recounts')
      .select('*')
      .in('audit_id', auditIds)
      .order('created_at', { ascending: false })
      .limit(RECOUNT_LIMIT);
    if (recountErr) { console.error('[reports] recounts', recountErr); setRows([]); setRecountTrunc(false); setLoading(false); return; }
    setRecountTrunc((recountRows?.length ?? 0) >= RECOUNT_LIMIT);

    const auditById = new Map(visibleAudits.map(a => [a.id, a]));
    const auditResultLabel = (r: KountRecount): string => {
      if (r.audit_result === 'corrected') return 'Count Corrected';
      if (r.audit_result === 'verified')  return 'Count Verified';
      return ''; // not yet decided
    };

    const built: ReportRow[] = ((recountRows ?? []) as KountRecount[]).flatMap(r => {
      const a = auditById.get(r.audit_id);
      if (!a) return [];
      // Optional venue filter
      if (venue && a.venue_id !== venue) return [];
      return [{
        item:             r.item_name,
        category:         r.category ?? '',
        issueType:        'Recount variance',
        variance:         r.variance_qty != null ? Number(r.variance_qty) : null,
        replacementValue: r.variance_value != null ? Number(r.variance_value) : null,
        auditResult:      auditResultLabel(r),
        counterInitials:  r.counter_initials ?? '',
        context:          r.audit_reason ?? '',
        _venueId:         a.venue_id,
        _venueName:       a.venue_name,
        _auditId:         a.id,
        _startedAt:       a.started_at,
      }];
    });

    setRows(built);
    setLoading(false);
  }, [user, venue, auditId, window_]);

  useEffect(() => { void load(); }, [load]);

  const exportCSV = useCallback(() => {
    const header = ['Item', 'Category', 'Issue Type', 'Variance', 'Replacement Value', 'Audit Results', 'Counter Initials', 'Context'];
    const escape = (v: string | number | null): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      // CSV formula-injection guard: a field starting with =, +, -, or @
      // is interpreted by Excel / Sheets / Numbers as a formula. A
      // counter who names a custom item `=cmd|'/c calc'!A1` could
      // execute commands when the report is opened. Prefix a single
      // tab character (which spreadsheet apps treat as a no-op text
      // hint) to neutralize without changing the visible cell.
      // Number exception: a bare numeric value (incl. negatives like
      // "-98.82") starts with "-" but is not an injection vector, and
      // escaping it would turn it into TEXT and break SUM/sort. Leave
      // real numbers unescaped.
      const isNumeric = /^-?\d+(\.\d+)?$/.test(s);
      if (!isNumeric && /^[=+\-@\t\r]/.test(s)) s = '\t' + s;
      // RFC 4180: wrap in double-quotes, double the inner double-quotes.
      if (/[",\n\r\t]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    // Replacement Value exports as a bare number (no leading "-$"), so the
    // column SUMs and sorts in Excel. The "$" prefix would have made every
    // cell text; keeping it a plain number is the only way the value column
    // is actually usable in a spreadsheet, and it stays consistent with the
    // Variance column.
    const fmtCurrency = (n: number | null): string => n === null ? '' : n.toFixed(2);
    const fmtVariance = (n: number | null): string => n === null ? '' : n.toFixed(2);

    const lines: string[] = [];
    // If either server-side cap fired, mark the export so BI consumers can't
    // ingest it thinking it's a complete dataset. Single-column comment row
    // at the very top — the banner in the UI says the same thing but the
    // downloaded file needs its own signal.
    if (auditTrunc || recountTrunc) {
      const caps: string[] = [];
      if (auditTrunc)   caps.push(`audit list: ${AUDIT_LIMIT} max`);
      if (recountTrunc) caps.push(`recount rows: ${RECOUNT_LIMIT} max`);
      lines.push(escape(
        `# TRUNCATED: this export hit a server-side cap (${caps.join('; ')}). ` +
        `Narrow the date window or audit selection to see all rows.`,
      ));
    }
    lines.push(header.map(escape).join(','));
    rows.forEach(r => {
      lines.push([
        r.item,
        r.category,
        r.issueType,
        fmtVariance(r.variance),
        fmtCurrency(r.replacementValue),
        r.auditResult,
        r.counterInitials,
        r.context,
      ].map(escape).join(','));
    });

    // Prepend BOM so Excel on Windows picks UTF-8 instead of treating the
    // first character as Latin-1. We pass the raw EF BB BF byte sequence
    // as a Uint8Array part of the Blob — relying on a JS string '﻿'
    // to round-trip cleanly through Blob's encoder is browser-dependent
    // and Safari has historically dropped it.
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const csv = lines.join('\r\n');
    const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = 'kount-report-' + ts + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, auditTrunc, recountTrunc]);

  const totalCount = rows.length;

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>Reports</Eyebrow>
          <h1 className="page-title">Audit reports</h1>
          <div className="page-sub">Per-recount-item view across audits — Item · Category · Issue Type · Variance · Replacement Value · Audit Results · Counter Initials · Context.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select
          style={pickerStyle}
          value={venue}
          onChange={e => {
            // Changing venue invalidates any pinned audit — the audit may
            // belong to a different venue, in which case our visibility
            // filter would drop it and the table would silently show "No
            // rows match" with no explanation. Reset auditId so the user
            // sees the full audit list for the new venue.
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
                {/* ISO YYYY-MM-DD instead of toLocaleDateString so the same
                    audit reads identically for a US user and an EU user
                    sharing a screenshot. The wider report still uses
                    locale formatting where free-form is fine. */}
                {a.venue_name} · {a.join_code} · {a.started_at.slice(0, 10)}
              </option>
            ))}
        </select>
        <select
          style={pickerStyle}
          value={window_}
          onChange={e => {
            // Same rationale as the venue reset: a window change can
            // strand an auditId that's no longer in the visible set.
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
        <Btn variant="primary" size="sm" onClick={exportCSV} disabled={rows.length === 0}>Export CSV</Btn>
      </div>

      {(auditTrunc || recountTrunc) && !loading && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,193,7,0.10)', border: '1px solid rgba(255,193,7,0.4)', fontSize: 12, color: 'var(--fg)' }}>
          ⚠ Result set is capped — narrow the date window or pick a single audit to see the rest.
          {auditTrunc   && <> Audit list hit the {AUDIT_LIMIT}-row cap.</>}
          {recountTrunc && <> Recount rows hit the {RECOUNT_LIMIT}-row cap.</>}
        </div>
      )}

      <Card>
        {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>Loading reports…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>
            No recount rows match the current filters. Try widening the date window or clearing the venue.
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={th}>Item</th>
                  <th style={th}>Category</th>
                  <th style={th}>Issue Type</th>
                  <th style={{ ...th, textAlign: 'right' }}>Variance</th>
                  <th style={{ ...th, textAlign: 'right' }}>Replacement Value</th>
                  <th style={th}>Audit Results</th>
                  <th style={th}>Counter Initials</th>
                  <th style={th}>Context</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._auditId + ':' + r.item + ':' + i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.item}</td>
                    <td style={{ ...td, color: 'var(--fg-muted)' }}>{r.category || '—'}</td>
                    <td style={td}>{r.issueType}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.variance != null ? r.variance.toFixed(2) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (r.replacementValue ?? 0) < 0 ? 'var(--raspberry-300, #f06292)' : 'inherit' }}>
                      {r.replacementValue != null
                        ? (r.replacementValue < 0 ? '-$' : '$') + Math.abs(r.replacementValue).toFixed(2)
                        : '—'}
                    </td>
                    <td style={td}>{r.auditResult || <span style={{ color: 'var(--fg-muted)' }}>—</span>}</td>
                    <td style={{ ...td, fontFamily: 'monospace', textTransform: 'uppercase' }}>{r.counterInitials || '—'}</td>
                    <td style={{ ...td, color: 'var(--fg-muted)', maxWidth: 320 }}>{r.context || '—'}</td>
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
