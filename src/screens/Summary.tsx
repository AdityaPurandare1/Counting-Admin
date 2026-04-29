import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry, KountMember } from '@/lib/types';
import { Pill, Eyebrow, Card, Btn, Num, Avatar, Segment } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Summary screen (v0.8)

   Historic audit browser. Lists submitted + cancelled audits filtered
   by venue access; opens any one for a full breakdown of zones,
   members, counter activity, and CSV export of the entries.

   Read-only: no lifecycle mutations live here. Variance is where you
   close or cancel an active audit.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

export function Summary({ user }: Props) {
  const [params, setParams] = useSearchParams();
  const auditParam = params.get('audit');

  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(auditParam);
  const [venueFilter, setVenueFilter] = useState<string>('');
  const [sweepBusy, setSweepBusy] = useState(false);
  const canSweep = user.role === 'corporate';
  // Submitted is the more common review case (closed-out audits) so it's
  // the default. Cancelled is its own bucket — bad audits, mistakes, walk-
  // aways. "All" stays available because the cross-cutting view is useful
  // when scanning a date range.
  const [statusFilter, setStatusFilter] = useState<'submitted' | 'cancelled' | 'all'>('submitted');

  const filterVisible = useCallback((rows: KountAudit[]) => rows.filter(a => {
    if (user.role === 'corporate' || user.venueIds === 'all') return true;
    return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
  }), [user]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kount_audits')
      .select('*')
      .in('status', ['submitted', 'cancelled'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(200);
    setLoading(false);
    if (error) { console.error('[summary] load', error); return; }
    setAudits(filterVisible((data ?? []) as KountAudit[]));
  }, [filterVisible]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selectedId && selectedId !== auditParam) setParams({ audit: selectedId }, { replace: true });
  }, [selectedId, auditParam, setParams]);

  const venues = useMemo(() => {
    const set = new Set(audits.map(a => a.venue_id));
    return Array.from(set).sort();
  }, [audits]);

  // Counts per status drive the segment labels — admin gets a glanceable
  // sense of how many of each are pending review.
  const submittedCount = useMemo(() => audits.filter(a => a.status === 'submitted').length, [audits]);
  const cancelledCount = useMemo(() => audits.filter(a => a.status === 'cancelled').length, [audits]);

  const filtered = useMemo(() => {
    let xs = audits;
    if (statusFilter !== 'all') xs = xs.filter(a => a.status === statusFilter);
    if (venueFilter) xs = xs.filter(a => a.venue_id === venueFilter);
    return xs;
  }, [audits, venueFilter, statusFilter]);

  // If the currently-selected audit drops out of the filter (e.g. user
  // switched from Submitted to Cancelled), close the detail panel so the
  // right pane doesn't show an audit the user can't see in the list.
  useEffect(() => {
    if (selectedId && !filtered.some(a => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  /* Sweep all *empty* cancelled audits in the user's venue scope. Built
     for the bulk-cleanup workflow after StaleAuditsPrompt mass-cancels —
     typically 10+ audits with 0 entries each. Deletes only the empties;
     audits with entries are skipped intentionally so admin doesn't lose
     data via a button-mash. Two-query flow:
       1. List cancelled audits in scope (filterVisible reuses the same
          venue-access predicate the rest of the screen uses).
       2. One IN.(<ids>) query against kount_entries → set of audit_ids
          that have any entry. Audits NOT in that set are the empties.
     The DELETE itself is a single round trip with .in('id', emptyIds)
     and a status='cancelled' guard so a parallel Reactivate wins. */
  const sweepEmptyCancelled = async () => {
    if (!canSweep) return;
    setSweepBusy(true);
    try {
      const { data: cancelled, error: cErr } = await supabase
        .from('kount_audits')
        .select('id, join_code, venue_id, venue_name')
        .eq('status', 'cancelled');
      if (cErr) { alert('Sweep failed (load): ' + cErr.message); return; }
      const visible = filterVisible((cancelled ?? []) as KountAudit[]);
      if (visible.length === 0) {
        alert('No cancelled audits in scope to sweep.');
        return;
      }
      const ids = visible.map(a => a.id);
      const { data: entryHits, error: eErr } = await supabase
        .from('kount_entries')
        .select('audit_id')
        .in('audit_id', ids);
      if (eErr) { alert('Sweep failed (entries probe): ' + eErr.message); return; }
      const withEntries = new Set((entryHits ?? []).map(r => (r as { audit_id: string }).audit_id));
      const empty = visible.filter(a => !withEntries.has(a.id));
      if (empty.length === 0) {
        alert(
          `No empty cancelled audits to sweep.\n\n` +
          `${visible.length} cancelled audit${visible.length === 1 ? '' : 's'} in scope, all of them have entries on file. ` +
          `Use the per-audit Delete button on each one if you really want to remove them.`
        );
        return;
      }
      const skipped = visible.length - empty.length;
      const msg = `Permanently delete ${empty.length} empty cancelled audit${empty.length === 1 ? '' : 's'}?` +
        (skipped > 0 ? `\n\n${skipped} cancelled audit${skipped === 1 ? '' : 's'} with entries on file will NOT be touched.` : '') +
        `\n\nThis cannot be undone.`;
      if (!confirm(msg)) return;
      const { data: deleted, error: dErr } = await supabase
        .from('kount_audits')
        .delete()
        .in('id', empty.map(a => a.id))
        .eq('status', 'cancelled')
        .select('id');
      if (dErr) { alert('Sweep failed (delete): ' + dErr.message); return; }
      const got = (deleted ?? []).length;
      // Migration 0012 silently filters DELETEs to 0 rows when the policy
      // isn't applied — surface that here so admin doesn't think the click
      // worked when it didn't.
      if (got === 0 && empty.length > 0) {
        alert(
          'Sweep returned 0 deletions despite ' + empty.length + ' candidates.\n\n' +
          'This usually means migration 0012 (anon DELETE policy on kount_audits) ' +
          'has not been applied to Supabase yet. Apply 0012_delete_policies.sql ' +
          'in the SQL editor and try again.'
        );
        return;
      }
      alert(`Deleted ${got} empty cancelled audit${got === 1 ? '' : 's'}.`);
      await load();
    } finally {
      setSweepBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Audit summary</div>
          <h1>Historic audits</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={venueFilter}
            onChange={e => setVenueFilter(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }}>
            <option value="">All venues</option>
            {venues.map(v => {
              const name = audits.find(a => a.venue_id === v)?.venue_name ?? v;
              return <option key={v} value={v}>{name}</option>;
            })}
          </select>
          {canSweep && cancelledCount > 0 && (
            <Btn
              variant="critical"
              size="sm"
              leading={Ic.close(14)}
              onClick={() => void sweepEmptyCancelled()}
              disabled={sweepBusy}
              title="Permanently delete every cancelled audit that has zero count entries. Audits with entries are skipped."
            >
              {sweepBusy ? 'Sweeping…' : 'Sweep empty cancelled'}
            </Btn>
          )}
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        <aside>
          <div style={{ marginBottom: 12 }}>
            <Segment<'submitted' | 'cancelled' | 'all'>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'submitted', label: `Submitted (${submittedCount})` },
                { value: 'cancelled', label: `Cancelled (${cancelledCount})` },
                { value: 'all',       label: `All (${audits.length})` },
              ]}
            />
          </div>
          <Eyebrow style={{ marginBottom: 8 }}>{filtered.length} audit{filtered.length === 1 ? '' : 's'}</Eyebrow>
          {loading && <Card padding={14}><div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Loading…</div></Card>}
          {!loading && filtered.length === 0 && (
            <Card padding={14}>
              <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                {audits.length === 0
                  ? 'No historic audits yet — close an audit on the phone or the Variance screen to see it here.'
                  : statusFilter !== 'all' && audits.some(a => (statusFilter === 'submitted' ? a.status === 'submitted' : a.status === 'cancelled'))
                    ? 'No audits match the venue filter in this tab.'
                    : statusFilter === 'submitted'
                      ? 'No submitted audits yet. Switch to Cancelled or All to see other states.'
                      : statusFilter === 'cancelled'
                        ? 'No cancelled audits — all clean.'
                        : 'No audits match the venue filter.'}
              </div>
            </Card>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(a => <SummaryListItem key={a.id} audit={a} selected={selectedId === a.id} onOpen={() => setSelectedId(a.id)} />)}
          </div>
        </aside>

        <section>
          {selectedId
            ? <SummaryDetail auditId={selectedId} user={user} onAuditChanged={() => void load()} />
            : <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Pick an audit on the left to see its full breakdown.</div></Card>}
        </section>
      </div>
    </>
  );
}

function SummaryListItem({ audit, selected, onOpen }: { audit: KountAudit; selected: boolean; onOpen: () => void }) {
  const ended = audit.completed_at ? new Date(audit.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: 'left', padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border)',
        background: selected ? 'var(--amethyst-100)' : 'var(--off-200)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 2, color: 'var(--accent-bg)', fontSize: 14 }}>{audit.join_code}</span>
        <Pill tone={audit.status === 'cancelled' ? 'critical' : 'positive'} size="sm">{audit.status}</Pill>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{audit.venue_name}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
        ended {ended} · {audit.started_by_name || audit.started_by_email}
      </div>
    </button>
  );
}

/* ────────── Per-audit summary detail ────────── */

/* Drill-down state: which card/zone the admin clicked to expand into a
 * full entries breakdown. Cleared by clicking the close (×) on the panel. */
type Drill =
  | { kind: 'entries' }
  | { kind: 'qty' }
  | { kind: 'counters' }
  | { kind: 'issues' }
  | { kind: 'zone'; zone: string };

function SummaryDetail({
  auditId, user, onAuditChanged,
}: {
  auditId: string;
  user: AccessEntry;
  onAuditChanged?: () => void;
}) {
  const [audit, setAudit]     = useState<KountAudit | null>(null);
  const [entries, setEntries] = useState<KountEntry[]>([]);
  const [members, setMembers] = useState<KountMember[]>([]);
  const [drill, setDrill]     = useState<Drill | null>(null);
  const [reactBusy, setReactBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Drill-down is admin-only because some buckets (counters, issues) reveal
  // submitter identities that managers/counters wouldn't normally see in the
  // summary read-only view. Same gate the Reactivate / Delete actions use.
  const canDrill      = user.role === 'corporate';
  const canReactivate = user.role === 'corporate';
  const canDelete     = user.role === 'corporate';

  const load = useCallback(async () => {
    const [{ data: a }, { data: e }, { data: m }] = await Promise.all([
      supabase.from('kount_audits').select('*').eq('id', auditId).single(),
      supabase.from('kount_entries').select('*').eq('audit_id', auditId).order('timestamp', { ascending: true }),
      supabase.from('kount_members').select('*').eq('audit_id', auditId),
    ]);
    setAudit((a as KountAudit) ?? null);
    setEntries((e as KountEntry[]) ?? []);
    setMembers((m as KountMember[]) ?? []);
  }, [auditId]);

  useEffect(() => { void load(); }, [load]);

  // Switching audits should drop the open drill — what we were drilled into
  // doesn't apply to the new audit's entries.
  useEffect(() => { setDrill(null); }, [auditId]);

  /* Reactivate a cancelled audit. Flips status back to 'active' and clears
     completed_at so it re-appears in Variance / Counts as in-progress. The
     count_phase is left as-is so a mid-count1 cancellation picks up where
     it stopped — admin can advance the phase from Counts.tsx if needed.
     v0.25: also clear count1_closed_at / count2_closed_at when their phase
     hasn't been completed yet — otherwise an audit cancelled mid-count2
     ends up with status='active', count_phase='count2', count2_closed_at
     non-null, which is contradictory state the phone's flow doesn't
     handle cleanly. */
  const reactivate = async () => {
    if (!audit || !canReactivate) return;
    if (audit.status !== 'cancelled') return;
    if (!confirm(
      `Reactivate audit ${audit.join_code} (${audit.venue_name})?\n\n` +
      'It moves back to Active and rejoins the Variance / Counts screens. ' +
      'All previously-recorded entries are preserved.'
    )) return;
    setReactBusy(true);
    // Phases at or after the current one shouldn't carry a closed_at —
    // those are forward-looking phases that still need to be reached.
    // count1 cancelled mid-count1 → both nulled (back to fresh)
    // review cancelled → count1_closed_at preserved (count1 actually finished),
    //   count2_closed_at cleared
    // count2 cancelled → both preserved up through count1, count2 cleared
    // final cancelled → all preserved (audit was already done; reactivating
    //   restores it as-was)
    const phase = audit.count_phase;
    const patch: Partial<KountAudit> = { status: 'active', completed_at: null };
    if (phase === 'count1') {
      patch.count1_closed_at = null;
      patch.count2_closed_at = null;
    } else if (phase === 'review' || phase === 'count2') {
      patch.count2_closed_at = null;
    }
    const { error } = await supabase
      .from('kount_audits')
      .update(patch)
      .eq('id', audit.id);
    setReactBusy(false);
    if (error) { alert('Reactivate failed: ' + error.message); return; }
    await load();
    onAuditChanged?.();
  };

  /* Permanently delete a cancelled audit. Corporate-only because it's
     destructive — kount_audits' children (kount_entries, kount_members,
     kount_recounts) all cascade, so the audit and every entry under it
     are wiped from the server. Gated to status='cancelled' to make
     submitted audits non-deletable from the UI; those are reports of
     completed work and should always be retained.

     Confirm copy includes the entry count so admin doesn't accidentally
     destroy something with real data. The default-cancelled-with-zero-
     entries case (the StaleAuditsPrompt cleanup workflow) gets a softer
     message because there's nothing to lose. */
  const deleteAudit = async () => {
    if (!audit || !canDelete) return;
    if (audit.status !== 'cancelled') return;
    const entryCount = entries.length;
    const msg = entryCount === 0
      ? `Permanently delete ${audit.join_code} (${audit.venue_name})?\n\nNo entries on file — safe to drop.`
      : `Permanently delete ${audit.join_code} (${audit.venue_name})?\n\nThis removes the audit AND ${entryCount} count entries from the server. CANNOT be undone.`;
    if (!confirm(msg)) return;
    setDeleteBusy(true);
    const { error } = await supabase
      .from('kount_audits')
      .delete()
      .eq('id', audit.id)
      .eq('status', 'cancelled'); // race guard: refuses if someone reactivated it just now
    setDeleteBusy(false);
    if (error) { alert('Delete failed: ' + error.message); return; }
    // Parent's useEffect clears selectedId once the audit drops out of the
    // filtered list; load() refreshes that list.
    onAuditChanged?.();
  };

  const stats = useMemo(() => {
    const totalEntries = entries.length;
    const totalQty = entries.reduce((s, r) => s + Number(r.qty || 0), 0);
    const byZone = new Map<string, { items: number; qty: number; counters: Set<string> }>();
    const byCounter = new Map<string, number>();
    const byMethod: Record<string, number> = { barcode: 0, photo: 0, manual: 0, guided: 0, quick: 0, recount: 0, other: 0 };
    const issues = entries.filter(r => r.issue && r.issue !== 'none').length;
    for (const r of entries) {
      const zone = r.zone;
      const bucket = byZone.get(zone) ?? { items: 0, qty: 0, counters: new Set<string>() };
      bucket.items += 1;
      bucket.qty   += Number(r.qty || 0);
      bucket.counters.add(r.counted_by_name || r.counted_by_email);
      byZone.set(zone, bucket);
      const who = r.counted_by_name || r.counted_by_email;
      byCounter.set(who, (byCounter.get(who) ?? 0) + 1);
      const m = (r.method && byMethod[r.method] !== undefined) ? r.method : 'other';
      byMethod[m] += 1;
    }
    const durationMin = audit?.started_at && audit?.completed_at
      ? Math.max(0, Math.round((new Date(audit.completed_at).getTime() - new Date(audit.started_at).getTime()) / 60_000))
      : null;
    return { totalEntries, totalQty, byZone, byCounter, byMethod, issues, durationMin };
  }, [entries, audit]);

  const exportCsv = () => {
    if (!audit) return;
    const rows: string[][] = [
      ['zone','item_name','qty','method','issue','issue_notes','counted_by','timestamp','is_recount'],
      ...entries.map(r => [
        r.zone, r.item_name, String(r.qty), r.method ?? '', r.issue ?? '', r.issue_notes ?? '',
        r.counted_by_name || r.counted_by_email, r.timestamp, String(r.is_recount),
      ]),
    ];
    const csv = rows.map(row => row.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_${audit.join_code}_${audit.venue_name.replace(/\s+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!audit) return <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Loading audit…</div></Card>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card padding={18}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <Eyebrow>{audit.status}</Eyebrow>
            <div style={{ font: 'var(--text-headline-md)', marginTop: 4 }}>
              {audit.venue_name} · <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-bg)', letterSpacing: 2 }}>{audit.join_code}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
              started {new Date(audit.started_at).toLocaleString()}
              {audit.completed_at && <> · ended {new Date(audit.completed_at).toLocaleString()}</>}
              {stats.durationMin != null && <> · {stats.durationMin} min total</>}
              · by {audit.started_by_name || audit.started_by_email}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {canReactivate && audit.status === 'cancelled' && (
              <Btn
                variant="positive"
                size="sm"
                onClick={() => void reactivate()}
                disabled={reactBusy || deleteBusy}
                title="Move this audit back to Active. Entries are preserved; admin can resume from Counts."
              >
                {reactBusy ? 'Reactivating…' : 'Reactivate audit'}
              </Btn>
            )}
            {canDelete && audit.status === 'cancelled' && (
              <Btn
                variant="critical"
                size="sm"
                leading={Ic.close(14)}
                onClick={() => void deleteAudit()}
                disabled={reactBusy || deleteBusy}
                title="Permanently remove this cancelled audit and all its entries from the server. Cannot be undone."
              >
                {deleteBusy ? 'Deleting…' : 'Delete audit'}
              </Btn>
            )}
            <Btn variant="secondary" size="sm" leading={Ic.download(14)} onClick={exportCsv}>Export CSV</Btn>
          </div>
        </div>
      </Card>

      {/* Stat strip — clickable for admin (corporate) to drill into the underlying entries */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatTile
          label="Entries" value={<Num value={stats.totalEntries} />}
          clickable={canDrill} active={drill?.kind === 'entries'}
          onClick={() => canDrill && setDrill(drill?.kind === 'entries' ? null : { kind: 'entries' })}
        />
        <StatTile
          label="Total qty" value={<Num value={stats.totalQty} />}
          clickable={canDrill} active={drill?.kind === 'qty'}
          onClick={() => canDrill && setDrill(drill?.kind === 'qty' ? null : { kind: 'qty' })}
        />
        <StatTile
          label="Counters" value={<Num value={stats.byCounter.size} />}
          clickable={canDrill} active={drill?.kind === 'counters'}
          onClick={() => canDrill && setDrill(drill?.kind === 'counters' ? null : { kind: 'counters' })}
        />
        <StatTile
          label="Issues flagged"
          value={<Num value={stats.issues} color={stats.issues ? 'var(--raspberry-300)' : undefined} />}
          clickable={canDrill && stats.issues > 0}
          active={drill?.kind === 'issues'}
          onClick={() => (canDrill && stats.issues > 0) && setDrill(drill?.kind === 'issues' ? null : { kind: 'issues' })}
        />
      </div>

      {/* By zone — each row is its own drill target */}
      <Card padding={16}>
        <Eyebrow>By zone</Eyebrow>
        {stats.byZone.size === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 8 }}>No entries.</div>}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 10 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              <th style={{ padding: '4px 4px' }}>Zone</th>
              <th style={{ padding: '4px 4px' }}>Items</th>
              <th style={{ padding: '4px 4px' }}>Qty</th>
              <th style={{ padding: '4px 4px' }}>Counters</th>
              {canDrill && <th />}
            </tr>
          </thead>
          <tbody>
            {[...stats.byZone.entries()].sort((a, b) => b[1].items - a[1].items).map(([zone, b]) => {
              const isActive = drill?.kind === 'zone' && drill.zone === zone;
              const handler = () => canDrill && setDrill(isActive ? null : { kind: 'zone', zone });
              return (
                <tr
                  key={zone}
                  onClick={canDrill ? handler : undefined}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    cursor: canDrill ? 'pointer' : 'default',
                    background: isActive ? 'var(--amethyst-100)' : undefined,
                  }}
                >
                  <td style={{ padding: '6px 4px' }}>{zone}</td>
                  <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{b.items}</td>
                  <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{b.qty.toFixed(1)}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{[...b.counters].join(', ')}</td>
                  {canDrill && (
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--fg-muted)', fontSize: 11 }}>
                      {isActive ? 'open ↓' : 'view →'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {drill && (
        <DrillDetail
          drill={drill}
          entries={entries}
          stats={stats}
          onClose={() => setDrill(null)}
        />
      )}

      {/* By counter */}
      <Card padding={16}>
        <Eyebrow>By counter</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {members.length === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No members recorded.</div>}
          {members.map(m => {
            const who = m.user_name || m.user_email;
            const count = stats.byCounter.get(who) ?? 0;
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--off-200)', borderRadius: 9999 }}>
                <Avatar name={who} size={24} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{who}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{m.role} · {count} entries</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Method breakdown */}
      <Card padding={16}>
        <Eyebrow>Capture method</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 10 }}>
          {Object.entries(stats.byMethod).filter(([, v]) => v > 0).map(([k, v]) => (
            <div key={k} style={{ padding: 10, background: 'var(--off-200)', borderRadius: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 }}>{k}</div>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StatTile({
  label, value, clickable, active, onClick,
}: {
  label: string;
  value: React.ReactNode;
  clickable?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const interactiveStyle: React.CSSProperties = clickable
    ? {
        cursor: 'pointer',
        // Subtle highlight when active so the admin knows which drill is open
        background: active ? 'var(--amethyst-100)' : undefined,
        borderColor: active ? 'var(--amethyst-300)' : undefined,
        transition: 'background .15s, border-color .15s',
      }
    : {};
  return (
    <Card padding={14} style={interactiveStyle}>
      <div
        onClick={clickable ? onClick : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } : undefined}
        style={{ outline: 'none' }}
      >
        <Eyebrow>{label}</Eyebrow>
        <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span>{value}</span>
          {clickable && (
            <span style={{ fontSize: 11, color: active ? 'var(--amethyst-300)' : 'var(--fg-muted)', fontWeight: 600, letterSpacing: '.06em' }}>
              {active ? 'OPEN ↓' : 'VIEW →'}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ────────── Drill-down panel ────────── */

function DrillDetail({
  drill, entries, stats, onClose,
}: {
  drill: Drill;
  entries: KountEntry[];
  stats: ReturnType<typeof computeStats> extends infer T ? T : never; // see note below
  onClose: () => void;
}) {
  // The shape of `stats` matches what useMemo returns above; we accept it as
  // typeof inference for ergonomic reasons rather than re-declaring the shape.

  const filtered = useMemo(() => {
    switch (drill.kind) {
      case 'entries':
      case 'qty':       return entries;
      case 'issues':    return entries.filter(r => r.issue && r.issue !== 'none');
      case 'zone':      return entries.filter(r => r.zone === drill.zone);
      case 'counters':  return entries; // grouped view, see below
    }
  }, [drill, entries]);

  const title = (() => {
    switch (drill.kind) {
      case 'entries':  return `All ${entries.length} entries`;
      case 'qty':      return `All ${entries.length} entries — total qty ${stats.totalQty.toFixed(1)}`;
      case 'issues':   return `${filtered.length} flagged entries`;
      case 'zone':     return `Zone: ${drill.zone} — ${filtered.length} entries`;
      case 'counters': return `${stats.byCounter.size} counter${stats.byCounter.size === 1 ? '' : 's'}`;
    }
  })();

  return (
    <Card padding={16} style={{ borderColor: 'var(--amethyst-300)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Eyebrow style={{ color: 'var(--amethyst-300)' }}>Details</Eyebrow>
        <button
          onClick={onClose}
          aria-label="Close details"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--fg-muted)', padding: 4, fontSize: 14,
          }}
        >×</button>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{title}</div>

      {drill.kind === 'counters' ? (
        // Grouped breakdown by counter — entries-per-counter + total qty
        <CountersBreakdown entries={entries} />
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No entries to show.</div>
      ) : (
        <div style={{ overflow: 'auto', maxHeight: 480 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, position: 'sticky', top: 0, background: '#FFF' }}>
                <th style={{ padding: '6px 8px' }}>Item</th>
                <th style={{ padding: '6px 8px' }}>Zone</th>
                <th style={{ padding: '6px 8px' }}>Qty</th>
                <th style={{ padding: '6px 8px' }}>Method</th>
                <th style={{ padding: '6px 8px' }}>Counter</th>
                <th style={{ padding: '6px 8px' }}>Time</th>
                {drill.kind === 'issues' && <th style={{ padding: '6px 8px' }}>Issue</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: r.issue && r.issue !== 'none' && drill.kind !== 'issues' ? 'var(--copper-100)' : undefined }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{r.item_name}</td>
                  <td style={{ padding: '6px 8px' }}>{r.zone}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono, monospace' }}>{Number(r.qty).toFixed(Number.isInteger(r.qty) ? 0 : 1)}</td>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--fg-muted)' }}>{r.method ?? '—'}</td>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--fg-muted)' }}>{r.counted_by_name || r.counted_by_email}</td>
                  <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--fg-muted)' }}>{new Date(r.timestamp).toLocaleString()}</td>
                  {drill.kind === 'issues' && (
                    <td style={{ padding: '6px 8px' }}>
                      <Pill tone={r.issue_resolved ? 'positive' : 'caution'} size="sm">{r.issue}</Pill>
                      {r.issue_notes && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{r.issue_notes}</div>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CountersBreakdown({ entries }: { entries: KountEntry[] }) {
  // Aggregate by counter: entry count + total qty + zones touched
  const map = new Map<string, { name: string; email: string; entries: number; qty: number; zones: Set<string> }>();
  for (const r of entries) {
    const key = r.counted_by_email || r.counted_by_name || '(unknown)';
    const e = map.get(key) ?? {
      name: r.counted_by_name || r.counted_by_email,
      email: r.counted_by_email,
      entries: 0, qty: 0, zones: new Set<string>(),
    };
    e.entries++;
    e.qty += Number(r.qty || 0);
    e.zones.add(r.zone);
    map.set(key, e);
  }
  const rows = [...map.values()].sort((a, b) => b.entries - a.entries);
  return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          <th style={{ padding: '6px 8px' }}>Counter</th>
          <th style={{ padding: '6px 8px' }}>Entries</th>
          <th style={{ padding: '6px 8px' }}>Total qty</th>
          <th style={{ padding: '6px 8px' }}>Zones</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.email} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '8px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Avatar name={r.name} size={26} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{r.email}</div>
                </div>
              </div>
            </td>
            <td style={{ padding: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{r.entries}</td>
            <td style={{ padding: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{r.qty.toFixed(1)}</td>
            <td style={{ padding: '8px', fontSize: 11, color: 'var(--fg-muted)' }}>{[...r.zones].join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Phantom helper so the `typeof computeStats` inference compiles. The actual
// stats are produced inline via useMemo inside SummaryDetail; this function
// merely declares the shape the DrillDetail component depends on.
function computeStats(_e: KountEntry[]): {
  totalEntries: number; totalQty: number;
  byZone: Map<string, { items: number; qty: number; counters: Set<string> }>;
  byCounter: Map<string, number>;
  byMethod: Record<string, number>;
  issues: number;
  durationMin: number | null;
} {
  return {
    totalEntries: 0, totalQty: 0,
    byZone: new Map(), byCounter: new Map(),
    byMethod: {}, issues: 0, durationMin: null,
  };
}
