import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry, KountMember, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Pill, Eyebrow, Card, Btn, Num, Money, Avatar } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { buildVarianceWorkbookBlob, type AvtLikeRow } from '@/lib/varianceReport';

/* ───────────────────────────────────────────────────────────────────────
   Variance screen (v0.3)

   Shows the list of active audits on the left; clicking one opens a live
   dashboard of its count entries on the right. Uses Realtime to keep the
   entries list in sync as counters scan.

   Admin super-join (per v0.3 spec):
     corporate role can open any audit by clicking it — no code prompt,
     no kount_members row is inserted (silent, read-only).
   Managers can only open audits whose venue_id is in their venueIds.
   ─────────────────────────────────────────────────────────────────────── */

interface Props {
  user: AccessEntry;
}

export function Variance({ user }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const auditParam = searchParams.get('audit');

  const [activeAudits, setActiveAudits] = useState<KountAudit[]>([]);
  const [historicAudits, setHistoricAudits] = useState<KountAudit[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(auditParam);
  // Date filter for the audit picker. Empty = all dates. Compared on the
  // local calendar date (active → started_at, historic → completed_at ?? started_at).
  const [dateFilter, setDateFilter] = useState<string>('');

  const filterVisible = useCallback((rows: KountAudit[]) => rows.filter(a => {
    if (user.role === 'corporate' || user.venueIds === 'all') return true;
    return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
  }), [user]);

  // --- Load both active and recent (submitted + cancelled) audits ---
  const loadAudits = useCallback(async () => {
    setLoadingAudits(true);
    const [activeRes, historicRes] = await Promise.all([
      supabase
        .from('kount_audits')
        .select('*')
        .eq('status', 'active')
        .order('started_at', { ascending: false }),
      supabase
        .from('kount_audits')
        .select('*')
        .in('status', ['submitted', 'cancelled'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(25),
    ]);
    setLoadingAudits(false);
    if (activeRes.error)   console.error('[variance] load active',   activeRes.error);
    if (historicRes.error) console.error('[variance] load historic', historicRes.error);

    setActiveAudits(filterVisible((activeRes.data ?? []) as KountAudit[]));
    setHistoricAudits(filterVisible((historicRes.data ?? []) as KountAudit[]));
  }, [filterVisible]);

  useEffect(() => { void loadAudits(); }, [loadAudits]);

  // Keep the active-audits list live as the phone app creates/closes audits
  useEffect(() => {
    const ch = supabase
      .channel('kount-audits-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits' }, () => { void loadAudits(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAudits]);

  // URL is the source of truth — let manual edits + back-button win.
  // Previously this effect wrote state INTO the URL on every selectedId
  // change, which clobbered user-typed URL edits within milliseconds.
  useEffect(() => {
    if (auditParam !== selectedId) setSelectedId(auditParam);
  }, [auditParam, selectedId]);

  const openAudit = (id: string) => {
    const a = [...activeAudits, ...historicAudits].find(x => x.id === id);
    if (!a) return;
    if (user.role !== 'corporate') {
      const ok = user.venueIds === 'all' || (Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id));
      if (!ok) return;
    }
    setSelectedId(id);
    setSearchParams({ audit: id }, { replace: true });
  };

  // Local calendar date (YYYY-MM-DD) for an audit — historic audits key off
  // completed_at, falling back to started_at; active audits key off started_at.
  const auditDate = useCallback((a: KountAudit): string => {
    const iso = a.status !== 'active' ? (a.completed_at ?? a.started_at) : a.started_at;
    return localDateKey(iso);
  }, []);

  // Distinct dates present across both lists, newest first, for the picker.
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const a of [...activeAudits, ...historicAudits]) set.add(auditDate(a));
    return [...set].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0));
  }, [activeAudits, historicAudits, auditDate]);

  const filteredActive   = useMemo(() => dateFilter ? activeAudits.filter(a => auditDate(a) === dateFilter) : activeAudits,   [activeAudits, dateFilter, auditDate]);
  const filteredHistoric = useMemo(() => dateFilter ? historicAudits.filter(a => auditDate(a) === dateFilter) : historicAudits, [historicAudits, dateFilter, auditDate]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Variance dashboard</div>
          <h1>Active audits</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn variant="secondary" size="sm" onClick={() => void loadAudits()}>Refresh</Btn>
        </div>
      </div>
      <div className="content" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Filter by date</Eyebrow>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                list="variance-audit-dates"
                style={{
                  flex: 1, padding: '6px 10px', border: '1px solid var(--border-strong)',
                  borderRadius: 6, fontFamily: 'inherit', fontSize: 13,
                }}
              />
              {/* Surface the dates that actually have audits as quick-pick options. */}
              <datalist id="variance-audit-dates">
                {availableDates.map(d => <option key={d} value={d} />)}
              </datalist>
              {dateFilter && (
                <Btn variant="ghost" size="sm" onClick={() => setDateFilter('')} title="Show all dates">Clear</Btn>
              )}
            </div>
          </div>
          <AuditList
            title="Active"
            count={filteredActive.length}
            audits={filteredActive}
            selectedId={selectedId}
            onOpen={openAudit}
            loading={loadingAudits}
            emptyMessage={dateFilter ? 'No active audits on this date.' : 'No active audits. Start one from the phone app.'}
          />
          <AuditList
            title="Historic"
            count={filteredHistoric.length}
            audits={filteredHistoric}
            selectedId={selectedId}
            onOpen={openAudit}
            loading={false}
            emptyMessage={dateFilter ? 'No historic audits on this date.' : 'No completed or cancelled audits yet.'}
          />
        </aside>

        <section>
          {selectedId
            ? <AuditDetail auditId={selectedId} user={user} onClosed={() => { setSelectedId(null); void loadAudits(); }} />
            : <Card padding={24}>
                <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Pick an audit on the left to see live counts, zones, and variance.</div>
              </Card>}
        </section>
      </div>
    </>
  );
}

/* ────────────── Per-audit detail pane ────────────── */

function AuditDetail({ auditId, user, onClosed }: { auditId: string; user: AccessEntry; onClosed: () => void }) {
  const [audit, setAudit] = useState<KountAudit | null>(null);
  const [entries, setEntries] = useState<KountEntry[]>([]);
  const [members, setMembers] = useState<KountMember[]>([]);
  const [avtReport, setAvtReport] = useState<KountAvtReport | null>(null);
  const [avtRows, setAvtRows] = useState<KountAvtRow[]>([]);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    // kount_entries paginated past the 1000-row cap so busy audits don't
    // silently truncate stat tiles (totalEntries, totalQty, byZone,
    // byCounter). Other queries here naturally fit under the cap.
    const [{ data: a }, e, { data: m }] = await Promise.all([
      supabase.from('kount_audits').select('*').eq('id', auditId).single(),
      selectAllPagedFiltered<KountEntry>(
        () => supabase.from('kount_entries').select('*').eq('audit_id', auditId),
        { column: 'timestamp', ascending: false },
      ).catch((err): KountEntry[] => { console.error('[variance] load entries', err); return []; }),
      supabase.from('kount_members').select('*').eq('audit_id', auditId),
    ]);
    setAudit((a as KountAudit) ?? null);
    setEntries(e);
    setMembers((m as KountMember[]) ?? []);
  }, [auditId]);

  // Pull the most-recent AVT report that covers this audit's venue + its rows
  const loadAvt = useCallback(async (venueId: string) => {
    // Uploaded AVT is DEPRECATED; the computed report is the product. Order by
    // source ascending so 'computed' (< 'uploaded' alphabetically) deterministically
    // outranks any uploaded Craftable export — even one uploaded AFTER Count 2 —
    // then by uploaded_at desc within a source. Mirrors the phone's
    // loadAvtFromSupabase ordering (source.asc,uploaded_at.desc). Uploaded only
    // wins when no computed report exists for the venue.
    const { data: reports } = await supabase
      .from('kount_avt_reports')
      .select('*')
      .contains('venue_ids', [venueId])
      .order('source', { ascending: true })
      .order('uploaded_at', { ascending: false })
      .limit(1);
    const rep = (reports?.[0] as KountAvtReport) ?? null;
    setAvtReport(rep);
    if (!rep) { setAvtRows([]); return; }
    const { data: rows } = await supabase
      .from('kount_avt_rows')
      .select('*')
      .eq('report_id', rep.id)
      .eq('venue_id', venueId)
      .order('variance_value', { ascending: true });
    setAvtRows((rows as KountAvtRow[]) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (audit?.venue_id) void loadAvt(audit.venue_id); }, [audit?.venue_id, loadAvt]);

  // Hold the latest venue_id in a ref so the realtime callback always
  // reads the current value, not the value at subscription time. Without
  // this the AVT-INSERT handler closes over the venue_id that was set
  // when the subscription first fired (often null on first render),
  // dropping events that arrive in the window before the audit loads.
  const venueIdRef = useRef<string | null>(audit?.venue_id ?? null);
  useEffect(() => { venueIdRef.current = audit?.venue_id ?? null; }, [audit?.venue_id]);

  useEffect(() => {
    const ch = supabase
      .channel('kount-audit-detail-' + auditId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_entries', filter: `audit_id=eq.${auditId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_members', filter: `audit_id=eq.${auditId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits',  filter: `id=eq.${auditId}` },       () => { void load(); })
      // New AVT reports touching this venue → refresh variance table
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kount_avt_reports' }, (evt) => {
        const row = evt.new as KountAvtReport;
        const currentVenueId = venueIdRef.current;
        if (currentVenueId && row?.venue_ids?.includes(currentVenueId)) void loadAvt(currentVenueId);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [auditId, load, loadAvt]);

  const stats = useMemo(() => {
    const totalEntries = entries.length;
    const totalQty = entries.reduce((s, e) => s + Number(e.qty || 0), 0);
    const issueCount = entries.filter(e => e.issue && e.issue !== 'none').length;
    const byZone = new Map<string, number>();
    const byCounter = new Map<string, number>();
    for (const e of entries) {
      byZone.set(e.zone, (byZone.get(e.zone) ?? 0) + 1);
      const who = e.counted_by_name || e.counted_by_email;
      byCounter.set(who, (byCounter.get(who) ?? 0) + 1);
    }
    return { totalEntries, totalQty, issueCount, byZone, byCounter };
  }, [entries]);

  const canClose = (user.role === 'corporate' || user.role === 'manager')
    && audit?.status === 'active'
    && audit?.count_phase === 'count1';

  const canCancel = user.role === 'corporate' && audit?.status === 'active';
  const [cancelling, setCancelling] = useState(false);

  const closeCount1 = async () => {
    if (!audit || closing) return;
    // Closing from the desktop does NOT build kount_recounts — only the
    // phone's close flow generates the recount list. Keep the action
    // available (corporate may need it) but make sure it's informed.
    if (!confirm(
      `Close Count 1 for ${audit.join_code} (${audit.venue_name})?\n\n` +
      'WARNING: closing from the desktop will NOT generate the recount list — ' +
      'that only happens when the counting manager closes Count 1 on the phone. ' +
      'Count 2 will start without a recount list.\n\nProceed anyway?'
    )) return;
    setClosing(true);
    const { error } = await supabase
      .from('kount_audits')
      .update({ count_phase: 'review', count1_closed_at: new Date().toISOString() })
      .eq('id', audit.id);
    setClosing(false);
    if (error) { alert('Close Count 1 failed: ' + error.message); return; }
    onClosed();
  };

  const cancelAudit = async () => {
    if (!audit || cancelling) return;
    if (!confirm(`Cancel audit ${audit.join_code} at ${audit.venue_name}?\n\nCounters will lose access to this audit. This cannot be undone.`)) return;
    setCancelling(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('kount_audits')
      .update({ status: 'cancelled', completed_at: now })
      .eq('id', audit.id);
    setCancelling(false);
    if (error) { alert('Cancel failed: ' + error.message); return; }
    // Keep the detail pane open so the admin sees the "cancelled" badge;
    // the active list will drop it and the historic list will pick it up.
  };

  // Export the COMPUTED variance (kount_avt_rows) as a formatted, multi-tab
  // .xlsx — this is the correct product. The Reports screen now uses the SAME
  // builder. Rows are mapped straight from the on-screen AVT data (variance_pct
  // is already stored ×100 by compute_avt, and the builder does NOT multiply
  // again).
  const [exporting, setExporting] = useState(false);
  const exportVarianceReport = useCallback(async () => {
    if (!audit || avtRows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const reportRows: AvtLikeRow[] = avtRows.map(r => ({
        item_name: r.item_name,
        category: r.category,
        start_qty: r.start_qty,
        purchases: r.purchases,
        depletions: r.depletions,
        actual: r.actual,
        theo: r.theo,
        variance: r.variance,
        cu_price: r.cu_price,
        variance_value: r.variance_value,
        variance_pct: r.variance_pct,
      }));
      const ts = new Date().toISOString().slice(0, 10);
      const blob = await buildVarianceWorkbookBlob({
        title: 'Variance Report — ' + audit.venue_name,
        subtitle: `${audit.join_code} · ${ts}`,
        rows: reportRows,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const venueSlug = (audit.venue_name || 'venue').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'venue';
      a.download = `variance_${audit.join_code}_${venueSlug}_${ts}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[variance] export report', e);
      alert('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }, [audit, avtRows, exporting]);

  if (!audit) return <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Loading audit…</div></Card>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <Card padding={18}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <Eyebrow>Audit</Eyebrow>
            <div style={{ font: 'var(--text-headline-md)', marginTop: 4 }}>
              {audit.venue_name} · <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-bg)', letterSpacing: 2 }}>{audit.join_code}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
              started {new Date(audit.started_at).toLocaleString()} · by {audit.started_by_name || audit.started_by_email}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pill tone={
              audit.status === 'cancelled' ? 'critical'
              : audit.status === 'submitted' ? 'positive'
              : audit.count_phase === 'count1' ? 'gold'
              : audit.count_phase === 'review' ? 'inform'
              : 'positive'
            }>
              {audit.status === 'cancelled' ? 'cancelled' : audit.status === 'submitted' ? 'submitted' : audit.count_phase}
            </Pill>
            {canClose && (
              <Btn variant="primary" size="md" onClick={closeCount1} disabled={closing} leading={Ic.flag(14)}>
                {closing ? 'Closing…' : 'Close Count 1'}
              </Btn>
            )}
            {canCancel && (
              <Btn variant="critical" size="md" onClick={cancelAudit} disabled={cancelling} leading={Ic.close(14)}>
                {cancelling ? 'Cancelling…' : 'Cancel audit'}
              </Btn>
            )}
          </div>
        </div>
      </Card>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatTile label="Entries"     value={<Num value={stats.totalEntries} />} />
        <StatTile label="Total qty"   value={<Num value={stats.totalQty} />} />
        <StatTile label="Counters"    value={<Num value={stats.byCounter.size} />} />
        <StatTile label="Issues flagged" value={<Num value={stats.issueCount} color={stats.issueCount ? 'var(--raspberry-300)' : undefined} />} />
      </div>

      {/* Members */}
      <Card padding={16}>
        <Eyebrow>Members</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          {members.length === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No one has joined yet.</div>}
          {members.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--off-200)', borderRadius: 9999 }}>
              <Avatar name={m.user_name || m.user_email} size={24} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{m.user_name || m.user_email}</div>
                <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{m.role}</div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>· {stats.byCounter.get(m.user_name || m.user_email) ?? 0}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Entries by zone */}
      <Card padding={16}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Eyebrow>Entries by zone</Eyebrow>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>live</span>
        </div>
        {stats.byZone.size === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No entries yet.</div>}
        {[...stats.byZone.entries()].sort((a, b) => b[1] - a[1]).map(([zone, count]) => (
          <div key={zone} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span>{zone}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{count}</span>
          </div>
        ))}
      </Card>

      {/* AVT variance — pulled from latest kount_avt_reports row covering this venue */}
      <Card padding={16}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Eyebrow>Craftable AVT variance</Eyebrow>
            {avtReport
              ? <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  uploaded {new Date(avtReport.uploaded_at).toLocaleString()} · by {avtReport.uploaded_by_name || avtReport.uploaded_by_email} · {avtReport.file_name}
                  <span style={{ marginLeft: 6, fontSize: 11, color: avtReport.source === 'computed' ? 'var(--success)' : 'var(--fg-muted)' }}>
                    · {avtReport.source === 'computed' ? 'Computed' : 'Uploaded'}
                  </span>
                </span>
              : <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>no AVT report for this venue yet — one is computed automatically when an audit's Count 2 closes on the phone</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <Btn
              variant="secondary"
              size="sm"
              onClick={() => void exportVarianceReport()}
              disabled={avtRows.length === 0 || exporting}
              title={avtRows.length === 0 ? 'No computed variance yet — close Count 1 first' : 'Download the formatted variance workbook (.xlsx)'}
              leading={Ic.download(14)}
            >
              {exporting ? 'Building…' : 'Export Report'}
            </Btn>
            {avtRows.length === 0 && (
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>No computed variance yet — close Count 1 first</span>
            )}
          </div>
        </div>
        {avtReport && avtRows.length > 0 && (
          <>
            <VarianceSummaryStrip rows={avtRows} />
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={{ padding: '4px 4px' }}>Item</th>
                  <th style={{ padding: '4px 4px' }}>Actual</th>
                  <th style={{ padding: '4px 4px' }}>Theo</th>
                  <th style={{ padding: '4px 4px' }}>Δ qty</th>
                  <th style={{ padding: '4px 4px' }}>Δ $</th>
                </tr>
              </thead>
              <tbody>
                {avtRows.slice(0, 40).map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px' }}>{r.item_name}</td>
                    <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{r.actual ?? '—'}</td>
                    <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{r.theo ?? '—'}</td>
                    <td style={{ padding: '6px 4px' }}>
                      {r.variance !== null ? <Num value={Number(r.variance)} signed /> : '—'}
                    </td>
                    <td style={{ padding: '6px 4px' }}>
                      {r.variance_value !== null ? <Money value={Number(r.variance_value)} showSign /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {avtRows.length > 40 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
                showing 40 of {avtRows.length} · sorted by worst variance first
              </div>
            )}
          </>
        )}
      </Card>

      {/* Recent entries */}
      <Card padding={16}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Eyebrow>Recent entries</Eyebrow>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>showing latest 30 · admin can edit / delete</span>
        </div>
        {entries.length === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No entries yet.</div>}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {entries.slice(0, 30).map(e => (
              <EntryRow key={e.id} entry={e} canEdit={user.role === 'corporate'} />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Local calendar date key (YYYY-MM-DD) for an ISO timestamp. Uses local
 *  time — not the ISO slice — so an audit started late at night reads as the
 *  user's calendar day, matching <input type="date"> which is also local. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card padding={14}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </Card>
  );
}

function EntryRow({ entry, canEdit }: { entry: KountEntry; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(entry.qty));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed < 0) { alert('Enter a non-negative number'); return; }
    setBusy(true);
    const { error } = await supabase.from('kount_entries').update({ qty: parsed }).eq('id', entry.id);
    setBusy(false);
    if (error) { alert('Update failed: ' + error.message); return; }
    setEditing(false);
  };

  const remove = async () => {
    if (!confirm(`Delete this entry?\n\n${entry.item_name} · ${entry.zone} · qty ${entry.qty}`)) return;
    setBusy(true);
    const { error } = await supabase.from('kount_entries').delete().eq('id', entry.id);
    setBusy(false);
    if (error) alert('Delete failed: ' + error.message);
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 4px' }}>{entry.item_name}</td>
      <td style={{ padding: '6px 4px', color: 'var(--fg-muted)' }}>{entry.zone}</td>
      <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>
        {editing
          ? <input
              type="number" step="0.25" min="0" value={qty}
              onChange={e => setQty(e.target.value)}
              style={{ width: 70, padding: '2px 6px', fontFamily: 'inherit', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 4 }}/>
          : Number(entry.qty).toFixed(entry.qty % 1 === 0 ? 0 : 2)}
      </td>
      <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{entry.method || '—'}</td>
      <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{entry.counted_by_name || entry.counted_by_email}</td>
      <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 10 }}>
        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </td>
      {canEdit && (
        <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {editing ? (
            <>
              <Btn variant="positive" size="sm" onClick={save} disabled={busy}>Save</Btn>{' '}
              <Btn variant="ghost"    size="sm" onClick={() => { setEditing(false); setQty(String(entry.qty)); }} disabled={busy}>Cancel</Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" size="sm" onClick={() => setEditing(true)} title="Edit qty">Edit</Btn>{' '}
              <Btn variant="ghost" size="sm" onClick={remove} disabled={busy} style={{ color: 'var(--raspberry-300)' }}>Delete</Btn>
            </>
          )}
        </td>
      )}
    </tr>
  );
}

function VarianceSummaryStrip({ rows }: { rows: KountAvtRow[] }) {
  const stats = useMemo(() => {
    let totalVarianceValue = 0;
    let totalTheoValue = 0;
    let overCount = 0;
    let underCount = 0;
    for (const r of rows) {
      const vv = Number(r.variance_value ?? 0);
      totalVarianceValue += vv;
      if ((r.variance ?? 0) > 0) overCount++;
      if ((r.variance ?? 0) < 0) underCount++;
      totalTheoValue += Number(r.theo ?? 0) * Number(r.cu_price ?? 0);
    }
    return { totalVarianceValue, totalTheoValue, overCount, underCount };
  }, [rows]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <MiniTile label="Items w/ AVT" value={<Num value={rows.length} />} />
      <MiniTile label="Over theo" value={<Num value={stats.overCount} />} />
      <MiniTile label="Under theo" value={<Num value={stats.underCount} />} />
      <MiniTile label="Net variance $" value={<Money value={stats.totalVarianceValue} showSign />} />
    </div>
  );
}

function AuditList({
  title, count, audits, selectedId, onOpen, loading, emptyMessage,
}: {
  title: string;
  count: number;
  audits: KountAudit[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  loading: boolean;
  emptyMessage: string;
}) {
  return (
    <div>
      <Eyebrow style={{ marginBottom: 8 }}>{title} ({count})</Eyebrow>
      {loading && <Card padding={14}><div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Loading…</div></Card>}
      {!loading && audits.length === 0 && (
        <Card padding={14}>
          <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{emptyMessage}</div>
        </Card>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {audits.map(a => <AuditListItem key={a.id} audit={a} selected={selectedId === a.id} onClick={() => onOpen(a.id)} />)}
      </div>
    </div>
  );
}

function AuditListItem({ audit, selected, onClick }: { audit: KountAudit; selected: boolean; onClick: () => void }) {
  const isHistoric = audit.status !== 'active';
  const badgeTone =
    audit.status === 'cancelled' ? 'critical'
  : audit.status === 'submitted' ? 'positive'
  : audit.count_phase === 'count1' ? 'gold'
  : audit.count_phase === 'review' ? 'inform'
  : 'positive';
  const badgeLabel = audit.status === 'cancelled' ? 'cancelled' : audit.status === 'submitted' ? 'submitted' : audit.count_phase;
  const timestampLabel = isHistoric && audit.completed_at
    ? new Date(audit.completed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(audit.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border)',
        background: selected ? 'var(--amethyst-100)' : (isHistoric ? 'var(--off-200)' : '#FFF'),
        cursor: 'pointer', fontFamily: 'inherit',
        opacity: isHistoric ? 0.9 : 1,
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 2, color: 'var(--accent-bg)', fontSize: 14 }}>
          {audit.join_code}
        </span>
        <Pill tone={badgeTone as 'gold' | 'inform' | 'positive' | 'critical'} size="sm">{badgeLabel}</Pill>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{audit.venue_name}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
        {isHistoric ? `ended ${timestampLabel}` : `started ${timestampLabel}`} · {audit.started_by_name || audit.started_by_email}
      </div>
    </button>
  );
}

function MiniTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: 10, background: 'var(--off-200)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
