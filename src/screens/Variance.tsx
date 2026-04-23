import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry, KountMember, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Pill, Eyebrow, Card, Btn, Num, Money, Avatar } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { AvtUpload } from '@/components/AvtUpload';

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

  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(auditParam);

  // --- Load active audits the user can see ---
  const loadAudits = useCallback(async () => {
    setLoadingAudits(true);
    const { data, error } = await supabase
      .from('kount_audits')
      .select('*')
      .eq('status', 'active')
      .order('started_at', { ascending: false });
    setLoadingAudits(false);
    if (error) { console.error('[variance] load audits', error); return; }

    const visible = (data ?? []).filter(a => {
      if (user.role === 'corporate' || user.venueIds === 'all') return true;
      return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
    });
    setAudits(visible as KountAudit[]);
  }, [user]);

  useEffect(() => { void loadAudits(); }, [loadAudits]);

  // Keep the active-audits list live as the phone app creates/closes audits
  useEffect(() => {
    const ch = supabase
      .channel('kount-audits-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits' }, () => { void loadAudits(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAudits]);

  // Keep URL ?audit=... in sync with the selection
  useEffect(() => {
    if (selectedId && selectedId !== auditParam) setSearchParams({ audit: selectedId }, { replace: true });
  }, [selectedId, auditParam, setSearchParams]);

  const openAudit = (id: string) => {
    const a = audits.find(x => x.id === id);
    if (!a) return;
    if (user.role !== 'corporate') {
      const ok = user.venueIds === 'all' || (Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id));
      if (!ok) return;
    }
    setSelectedId(id);
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Variance dashboard</div>
          <h1>Active audits</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AvtUpload user={user} onUploaded={() => { /* detail pane re-fetches via realtime subscription on kount_avt_reports */ }} />
          <Btn variant="secondary" size="sm" onClick={() => void loadAudits()}>Refresh</Btn>
        </div>
      </div>
      <div className="content" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <aside>
          <Eyebrow style={{ marginBottom: 8 }}>Audits ({audits.length})</Eyebrow>
          {loadingAudits && <Card padding={14}><div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Loading…</div></Card>}
          {!loadingAudits && audits.length === 0 && (
            <Card padding={14}>
              <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                No active audits. Start one from the phone app.
              </div>
            </Card>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {audits.map(a => (
              <button
                key={a.id}
                onClick={() => openAudit(a.id)}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: selectedId === a.id ? 'var(--amethyst-100)' : '#FFF',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 2, color: 'var(--accent-bg)', fontSize: 14 }}>
                    {a.join_code}
                  </span>
                  <Pill tone={a.count_phase === 'count1' ? 'gold' : a.count_phase === 'review' ? 'inform' : 'positive'} size="sm">
                    {a.count_phase}
                  </Pill>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{a.venue_name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                  by {a.started_by_name || a.started_by_email} · {new Date(a.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </button>
            ))}
          </div>
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
    const [{ data: a }, { data: e }, { data: m }] = await Promise.all([
      supabase.from('kount_audits').select('*').eq('id', auditId).single(),
      supabase.from('kount_entries').select('*').eq('audit_id', auditId).order('timestamp', { ascending: false }),
      supabase.from('kount_members').select('*').eq('audit_id', auditId),
    ]);
    setAudit((a as KountAudit) ?? null);
    setEntries((e as KountEntry[]) ?? []);
    setMembers((m as KountMember[]) ?? []);
  }, [auditId]);

  // Pull the most-recent AVT report that covers this audit's venue + its rows
  const loadAvt = useCallback(async (venueId: string) => {
    const { data: reports } = await supabase
      .from('kount_avt_reports')
      .select('*')
      .contains('venue_ids', [venueId])
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

  useEffect(() => {
    const ch = supabase
      .channel('kount-audit-detail-' + auditId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_entries', filter: `audit_id=eq.${auditId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_members', filter: `audit_id=eq.${auditId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits',  filter: `id=eq.${auditId}` },       () => { void load(); })
      // New AVT reports touching this venue → refresh variance table
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kount_avt_reports' }, (evt) => {
        const row = evt.new as KountAvtReport;
        if (audit?.venue_id && row?.venue_ids?.includes(audit.venue_id)) void loadAvt(audit.venue_id);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [auditId, load, loadAvt, audit?.venue_id]);

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

  const closeCount1 = async () => {
    if (!audit || closing) return;
    setClosing(true);
    const { error } = await supabase
      .from('kount_audits')
      .update({ count_phase: 'review', count1_closed_at: new Date().toISOString() })
      .eq('id', audit.id);
    setClosing(false);
    if (error) { alert('Close Count 1 failed: ' + error.message); return; }
    onClosed();
  };

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
            <Pill tone={audit.count_phase === 'count1' ? 'gold' : audit.count_phase === 'review' ? 'inform' : 'positive'}>
              {audit.count_phase}
            </Pill>
            {canClose && (
              <Btn variant="primary" size="md" onClick={closeCount1} disabled={closing} leading={Ic.flag(14)}>
                {closing ? 'Closing…' : 'Close Count 1'}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Eyebrow>Craftable AVT variance</Eyebrow>
          {avtReport
            ? <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                uploaded {new Date(avtReport.uploaded_at).toLocaleString()} · by {avtReport.uploaded_by_name || avtReport.uploaded_by_email} · {avtReport.file_name}
              </span>
            : <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>no report uploaded for this venue yet</span>}
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
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>showing latest 30</span>
        </div>
        {entries.length === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No entries yet.</div>}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {entries.slice(0, 30).map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px' }}>{e.item_name}</td>
                <td style={{ padding: '6px 4px', color: 'var(--fg-muted)' }}>{e.zone}</td>
                <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{Number(e.qty).toFixed(e.qty % 1 === 0 ? 0 : 2)}</td>
                <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{e.method || '—'}</td>
                <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{e.counted_by_name || e.counted_by_email}</td>
                <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 10 }}>
                  {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card padding={14}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </Card>
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

function MiniTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: 10, background: 'var(--off-200)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
