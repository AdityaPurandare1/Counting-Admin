import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry, KountMember } from '@/lib/types';
import { Pill, Eyebrow, Card, Btn, Num, Avatar, Segment } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { csvCell } from '@/lib/csv';
import { isOpenIssue, issueLabel } from '@/lib/issues';
import { finalCells, recountsAheadOfReport, summarizeByItem, zoneBreakdown, WHOLE_ITEM_ZONE, type RecountRow } from '@/lib/summaryByItem';

import { isOrgWide, hasCorporateAccess, canRunAudits } from '@/lib/access';
/* ───────────────────────────────────────────────────────────────────────
   Summary screen (v0.8)

   Historic audit browser. Lists submitted + cancelled audits filtered
   by venue access; opens any one for a full breakdown of zones,
   members, counter activity, and CSV export of the entries.

   Read-only: no lifecycle mutations live here. Variance is where you
   close or cancel an active audit.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

type StatusFilter = 'submitted' | 'cancelled' | 'all';

/** A deep-linked audit that was in neither list, after fetching it by id:
 *  'show' it (spliced into the list), or 'give-up' and clear the selection —
 *  deleted / not found, still active (that lives in Variance and Counts), or
 *  at a venue this user can't see. Exported for the unit test. */
export function deepLinkOutcome(row: Pick<KountAudit, 'status'> | null, canSee: boolean): 'show' | 'give-up' {
  if (!row || !canSee) return 'give-up';
  return row.status === 'submitted' || row.status === 'cancelled' ? 'show' : 'give-up';
}

/** Filter changes that bring a listed deep-linked audit into view; null when
 *  the current filters already show it. Exported for the unit test. */
export function revealFilters(
  a: Pick<KountAudit, 'status' | 'venue_id'>,
  statusFilter: StatusFilter,
  venueFilter: string,
): { status?: 'submitted' | 'cancelled'; clearVenue?: true } | null {
  const statusOk = statusFilter === 'all' || a.status === statusFilter;
  const venueOk = !venueFilter || venueFilter === a.venue_id;
  if (statusOk && venueOk) return null;
  return {
    ...(statusOk ? {} : { status: a.status === 'cancelled' ? 'cancelled' as const : 'submitted' as const }),
    ...(venueOk ? {} : { clearVenue: true as const }),
  };
}

export function Summary({ user }: Props) {
  const [params, setParams] = useSearchParams();
  const auditParam = params.get('audit');

  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(auditParam);
  const [venueFilter, setVenueFilter] = useState<string>('');
  const [sweepBusy, setSweepBusy] = useState(false);
  const canSweep = hasCorporateAccess(user.role);
  // Submitted is the more common review case (closed-out audits) so it's
  // the default. Cancelled is its own bucket — bad audits, mistakes, walk-
  // aways. "All" stays available because the cross-cutting view is useful
  // when scanning a date range.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('submitted');

  const filterVisible = useCallback((rows: KountAudit[]) => rows.filter(a => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return true;
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

  // URL is the source of truth — manual edits + back-button win.
  useEffect(() => {
    if (auditParam !== selectedId) setSelectedId(auditParam);
  }, [auditParam, selectedId]);

  const selectAudit = (id: string | null) => {
    setSelectedId(id);
    setParams(id ? { audit: id } : {}, { replace: true });
  };

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

  // Deep link (?audit=<id>, e.g. the Venues card's "Last audit"): make sure the
  // audit is in the list and that the status / venue filters show it. Mirrors
  // Counts.tsx: the audit can be older than the 200 loaded, so fetch it by id
  // and splice it in; and a cancelled one is hidden by the default Submitted
  // tab, so switch tabs. Marked done per id only once the filters already show
  // it, so the effect below never sees a half-applied filter change.
  const revealedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!auditParam || loading || revealedRef.current === auditParam) return;
    const listed = audits.find(a => a.id === auditParam);
    if (listed) {
      const change = revealFilters(listed, statusFilter, venueFilter);
      if (!change) { revealedRef.current = auditParam; return; }
      if (change.status) setStatusFilter(change.status);
      if (change.clearVenue) setVenueFilter('');
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('kount_audits')
        .select('*')
        .eq('id', auditParam)
        .maybeSingle();
      if (cancelled) return;
      const row = error ? null : (data as KountAudit | null);
      if (deepLinkOutcome(row, !!row && filterVisible([row]).length > 0) === 'give-up' || !row) {
        if (!row) console.warn('[summary] deep-linked audit not found', auditParam, error);
        revealedRef.current = auditParam;
        // Clear it here: the ref alone doesn't re-render, so the effect below
        // never ran and the panel sat on "Loading audit…" for good.
        selectAudit(null);
        return;
      }
      setAudits(prev => prev.some(a => a.id === row.id) ? prev : [row, ...prev]);
    })();
    return () => { cancelled = true; };
  }, [auditParam, audits, loading, statusFilter, venueFilter, filterVisible]);

  // If the currently-selected audit drops out of the filter (e.g. user
  // switched from Submitted to Cancelled), close the detail panel so the
  // right pane doesn't show an audit the user can't see in the list. Not
  // while the list is loading or a deep link is still being resolved — that
  // used to clear the Venues link's selection before the list arrived.
  useEffect(() => {
    if (loading) return;
    if (auditParam && revealedRef.current !== auditParam) return;
    if (selectedId && !filtered.some(a => a.id === selectedId)) {
      selectAudit(null);
    }
  }, [filtered, selectedId, loading, auditParam]);

  /* Sweep cancelled audits in the user's venue scope. Built for the
     bulk-cleanup workflow after StaleAuditsPrompt mass-cancels —
     typically 10+ audits with 0 entries each. Two-query flow:
       1. List cancelled audits in scope (filterVisible reuses the same
          venue-access predicate the rest of the screen uses).
       2. Per-audit head+count probes against kount_entries (same pattern
          as StaleAuditsPrompt). The old single IN.(<ids>) row probe was
          capped at 1000 rows by PostgREST, so audits whose entries fell
          past the cap were misclassified "empty" and hard-deleted —
          head+count never truncates.
     Two-stage confirm: empties get the familiar confirm; audits that
     still HAVE entries get a second, explicit confirm spelling out how
     many counted entries get destroyed (v0.31 — previously they were
     always skipped, which left admin with no bulk way to flush them).
     Declining the second confirm falls back to empty-only. Probe-failed
     audits (count -1) are never eligible for either branch.
     The DELETE itself is a single round trip with .in('id', ids) and a
     status='cancelled' guard so a parallel Reactivate wins. */
  const sweepCancelled = async () => {
    if (!hasCorporateAccess(user.role)) return; // defense-in-depth: read-only roles can't sweep
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
      let entryCounts: number[];
      try {
        entryCounts = await Promise.all(visible.map(async a => {
          const r = await supabase
            .from('kount_entries')
            .select('id', { count: 'exact', head: true })
            .eq('audit_id', a.id);
          if (r.error) throw r.error;
          // null count (shouldn't happen with head+count, but this path
          // hard-deletes) is treated as "has entries" → skipped, not swept.
          return (r as unknown as { count: number | null }).count ?? -1;
        }));
      } catch (e) {
        alert('Sweep failed (entries probe): ' + ((e as Error).message || String(e)));
        return;
      }
      const empty    = visible.filter((_, i) => entryCounts[i] === 0);
      const nonEmpty = visible.filter((_, i) => entryCounts[i] > 0);
      // count -1 = probe returned a null count → protected. Never eligible
      // for deletion, not even via the destructive second confirm.
      const protectedCount = visible.length - empty.length - nonEmpty.length;
      const nonEmptyEntryTotal = entryCounts.reduce((s, c) => s + (c > 0 ? c : 0), 0);
      if (empty.length === 0 && nonEmpty.length === 0) {
        alert(
          `No cancelled audits eligible to sweep.\n\n` +
          `${visible.length} cancelled audit${visible.length === 1 ? '' : 's'} in scope, but the entry probes ` +
          `came back without counts, so they stay protected.`
        );
        return;
      }
      // Stage 1 — empties, same confirm as before. Declining aborts the
      // whole sweep (including the non-empty stage).
      if (empty.length > 0) {
        const msg = `Permanently delete ${empty.length} empty cancelled audit${empty.length === 1 ? '' : 's'}?` +
          (nonEmpty.length > 0 ? `\n\n${nonEmpty.length} cancelled audit${nonEmpty.length === 1 ? '' : 's'} with entries on file — you'll be asked about ${nonEmpty.length === 1 ? 'it' : 'those'} next.` : '') +
          `\n\nThis cannot be undone.\n(Cancel aborts the whole sweep — nothing will be deleted.)`;
        if (!confirm(msg)) return;
      }
      // Stage 2 — audits that still hold counted entries get their own
      // explicit confirm so the data loss is impossible to miss. Cancel
      // here = old behavior: only the empties (if any) are swept.
      let flushNonEmpty = false;
      if (nonEmpty.length > 0) {
        flushNonEmpty = confirm(
          `${nonEmpty.length} cancelled audit${nonEmpty.length === 1 ? '' : 's'} still hold${nonEmpty.length === 1 ? 's' : ''} ` +
          `${nonEmptyEntryTotal} counted entr${nonEmptyEntryTotal === 1 ? 'y' : 'ies'}. ` +
          `Deleting ${nonEmpty.length === 1 ? 'it' : 'them'} permanently destroys those counts.\n\n` +
          `Delete ${nonEmpty.length === 1 ? 'it' : 'them'} anyway?` +
          (empty.length > 0 ? `\n\n(Cancel keeps ${nonEmpty.length === 1 ? 'it' : 'them'} and sweeps only the ${empty.length} empty one${empty.length === 1 ? '' : 's'}.)` : '')
        );
        if (!flushNonEmpty && empty.length === 0) return; // nothing left to sweep
      }
      const targets = flushNonEmpty ? [...empty, ...nonEmpty] : empty;
      const { data: deleted, error: dErr } = await supabase
        .from('kount_audits')
        .delete()
        .in('id', targets.map(a => a.id))
        .eq('status', 'cancelled') // race guard: a parallel Reactivate wins
        .select('id');
      if (dErr) { alert('Sweep failed (delete): ' + dErr.message); return; }
      const got = (deleted ?? []).length;
      // Migration 0012 silently filters DELETEs to 0 rows when the policy
      // isn't applied — surface that here so admin doesn't think the click
      // worked when it didn't.
      if (got === 0 && targets.length > 0) {
        alert(
          'Sweep returned 0 deletions despite ' + targets.length + ' candidates.\n\n' +
          'This usually means migration 0012 (anon DELETE policy on kount_audits) ' +
          'has not been applied to Supabase yet. Apply 0012_delete_policies.sql ' +
          'in the SQL editor and try again.'
        );
        // Refresh anyway: candidates may have been reactivated/RLS-filtered
        // mid-sweep, so show the real state rather than the stale list.
        await load();
        return;
      }
      // Skipped/protected tally: non-empties the admin chose to keep,
      // probe-failed audits, and any race-guard misses (reactivated or
      // RLS-filtered between the probe and the delete).
      const raceSkipped = targets.length - got;
      const kept = (flushNonEmpty ? 0 : nonEmpty.length) + protectedCount + raceSkipped;
      alert(
        `Deleted ${got} cancelled audit${got === 1 ? '' : 's'}.` +
        (kept > 0 ? `\n\n${kept} skipped/protected (entries kept, reactivated mid-sweep, or probe failed).` : '')
      );
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
              onClick={() => void sweepCancelled()}
              disabled={sweepBusy}
              title="Permanently delete cancelled audits. Empty ones are swept first; audits that still hold counted entries require a second explicit confirmation."
            >
              {sweepBusy ? 'Sweeping…' : 'Sweep cancelled'}
            </Btn>
          )}
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        <aside>
          <div style={{ marginBottom: 12 }}>
            <Segment<StatusFilter>
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
            {filtered.map(a => <SummaryListItem key={a.id} audit={a} selected={selectedId === a.id} onOpen={() => selectAudit(a.id)} />)}
          </div>
        </aside>

        <section>
          {selectedId
            // Keyed by audit: nothing loaded for the previous audit (its entry
            // list, which Delete's confirm reads) may show under this one.
            ? <SummaryDetail key={selectedId} auditId={selectedId} user={user} onAuditChanged={() => void load()} />
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
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [recounts, setRecounts] = useState<RecountRow[]>([]);
  const [recountError, setRecountError] = useState<string | null>(null);
  // computed_at of the audit's variance report: null = no report, undefined = not known.
  const [reportAt, setReportAt] = useState<string | null | undefined>(undefined);
  const [members, setMembers] = useState<KountMember[]>([]);
  const [drill, setDrill]     = useState<Drill | null>(null);
  const [reactBusy, setReactBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Drill-down: corporate + manager. Counters stay read-only — they don't
  // need (and shouldn't see) per-counter attribution buckets. Earlier this
  // was corporate-only out of identity-privacy caution, but managers run
  // the audits and need to filter live to see how each zone / counter is
  // progressing — without drill-down there's no real filter available
  // and the audit-state cards become decorative.
  const canDrill      = canRunAudits(user.role);
  const canReactivate = hasCorporateAccess(user.role);
  const canDelete     = hasCorporateAccess(user.role);

  const load = useCallback(async () => {
    // kount_entries paginated past the 1000-row cap so the CSV export
    // and zone breakdown don't silently lose rows from busy audits.
    // A failed read is kept as an error, not turned into "no entries": Delete
    // reads the entry count, and an empty list made it say "safe to drop".
    const settle = <T,>(what: string, p: Promise<T[]>) => p.then(
      rows => ({ rows, error: null as string | null }),
      (err: unknown) => {
        console.error('[summary] load ' + what, err);
        return { rows: [] as T[], error: (err as { message?: string })?.message ?? String(err) };
      },
    );
    const [{ data: a }, e, { data: m }, rc, rep] = await Promise.all([
      supabase.from('kount_audits').select('*').eq('id', auditId).single(),
      settle('entries', selectAllPagedFiltered<KountEntry>(
        () => supabase.from('kount_entries').select('*').eq('audit_id', auditId),
        { column: 'timestamp', ascending: true },
      )),
      supabase.from('kount_members').select('*').eq('audit_id', auditId),
      // v0.77: recount corrections, applied the way compute_avt_for_audit does.
      // Paged by id: created_at is not unique, so it can split a page unevenly.
      settle('recounts', selectAllPagedFiltered<RecountRow>(
        () => supabase.from('kount_recounts')
          .select('id,master_item_id,item_name,zone,count2_qty,status,resolved_at,created_at')
          .eq('audit_id', auditId),
        { column: 'id', ascending: true },
      )),
      // When this audit's variance was last computed — to say when the stored
      // variance predates a correction shown here.
      supabase.from('kount_avt_reports').select('computed_at')
        .eq('audit_id', auditId).eq('source', 'computed')
        .order('computed_at', { ascending: false, nullsFirst: false }).limit(1),
    ]);
    setAudit((a as KountAudit) ?? null);
    setEntries(e.rows);
    setEntriesError(e.error);
    setRecounts(rc.rows);
    setRecountError(rc.error);
    if (rep.error) console.warn('[summary] variance report time not loaded', rep.error);
    setReportAt(rep.error ? undefined : (((rep.data ?? [])[0] as { computed_at: string | null } | undefined)?.computed_at ?? null));
    setMembers((m as KountMember[]) ?? []);
  }, [auditId]);

  useEffect(() => { void load(); }, [load]);
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
    if (!hasCorporateAccess(user.role)) return; // defense-in-depth: read-only roles can't reactivate
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

  /* v0.70: Reopen a SUBMITTED audit. Server-side (kount_reopen_audit, 0092)
     because it is more than a status flip: the closed stamps must all be
     cleared (a stale count1_closed_at would end the next variance window
     early and drop every later sale), and the computed variance report is
     removed so the reopened count never shows as the venue's latest. The
     function also refuses when the venue already has an active audit or the
     audit has recounts, and when the caller is not corporate/admin. */
  const reopen = async () => {
    if (!hasCorporateAccess(user.role)) return; // defense-in-depth: the RPC re-checks
    if (!audit || !canReactivate) return;
    if (audit.status !== 'submitted') return;
    if (!confirm(
      `Reopen audit ${audit.join_code} (${audit.venue_name})?\n\n` +
      `It goes back to Active, Count 1. Counters rejoin with the same code ${audit.join_code}; ` +
      `all ${entriesError ? '' : entries.length + ' '}entries are kept.\n\n` +
      'Its variance report is removed and recalculated when the count is closed again.'
    )) return;
    setReactBusy(true);
    const { data, error: rpcErr } = await supabase.rpc('kount_reopen_audit', { p_audit_id: audit.id });
    setReactBusy(false);
    if (rpcErr) { alert('Reopen failed: ' + rpcErr.message); return; }
    const res = (data ?? {}) as { join_code?: string; entries?: number };
    alert(`${res.join_code ?? audit.join_code} is open again (${res.entries ?? entries.length} entries kept). Counters can rejoin with the same code.`);
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
    if (!hasCorporateAccess(user.role)) return; // defense-in-depth: read-only roles can't delete
    if (!audit || !canDelete) return;
    if (audit.status !== 'cancelled') return;
    if (entriesError) {
      alert(`The entries for ${audit.join_code} could not be loaded, so how many would be destroyed is unknown.\n\nNothing was deleted. Reload and try again.`);
      return;
    }
    const entryCount = entries.length;
    const msg = entryCount === 0
      ? `Permanently delete ${audit.join_code} (${audit.venue_name})?\n\nNo entries on file — safe to drop.`
      : `Permanently delete ${audit.join_code} (${audit.venue_name})?\n\nThis removes the audit AND ${entryCount} count entries from the server. CANNOT be undone.`;
    if (!confirm(msg)) return;
    setDeleteBusy(true);
    const { data: deleted, error } = await supabase
      .from('kount_audits')
      .delete()
      .eq('id', audit.id)
      .eq('status', 'cancelled') // race guard: refuses if someone reactivated it just now
      .select('id');
    setDeleteBusy(false);
    if (error) { alert('Delete failed: ' + error.message); return; }
    // PostgREST reports success even when RLS or the status guard filtered
    // the DELETE down to 0 rows — check the returned ids so a silent no-op
    // (reactivated mid-flow, or migration 0012 missing) doesn't look like
    // a successful delete.
    if ((deleted ?? []).length === 0) {
      alert(
        'Nothing was deleted. The audit may have been reactivated by someone else, ' +
        'or migration 0012 (anon DELETE policy on kount_audits) is not applied.'
      );
      await load();
      onAuditChanged?.();
      return;
    }
    // Parent's useEffect clears selectedId once the audit drops out of the
    // filtered list; load() refreshes that list.
    onAuditChanged?.();
  };

  // v0.77: quantities after recount -- the same final numbers the variance
  // uses (lib/summaryByItem). Entry counts and counters stay per entry.
  const finals = useMemo(() => finalCells(entries, recounts), [entries, recounts]);
  // The stored variance only has a correction if it was computed after it.
  const varianceBehind = reportAt !== undefined && recountsAheadOfReport(finals.appliedRecounts, reportAt);

  const stats = useMemo(() => {
    const totalEntries = entries.length;
    const totalQty = finals.cells.reduce((s, c) => s + c.qty, 0);
    const byZone = new Map<string, { items: number; qty: number; counters: Set<string> }>();
    const byCounter = new Map<string, number>();
    const byMethod: Record<string, number> = { barcode: 0, photo: 0, manual: 0, guided: 0, quick: 0, recount: 0, other: 0 };
    const issues = entries.filter(isOpenIssue).length;
    for (const c of finals.cells) {
      const bucket = byZone.get(c.zone) ?? { items: 0, qty: 0, counters: new Set<string>() };
      bucket.qty += c.qty;
      byZone.set(c.zone, bucket);
    }
    for (const r of entries) {
      const zone = r.zone;
      const bucket = byZone.get(zone) ?? { items: 0, qty: 0, counters: new Set<string>() };
      bucket.items += 1;
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
  }, [entries, audit, finals]);

  // v0.76: one row per product, totalled across zones (see lib/summaryByItem).
  const [itemSearch, setItemSearch] = useState('');
  const byItem = useMemo(() => summarizeByItem(entries, recounts), [entries, recounts]);
  const byItemShown = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return q ? byItem.items.filter(i => i.name.toLowerCase().includes(q)) : byItem.items;
  }, [byItem, itemSearch]);

  const exportItemsCsv = () => {
    if (!audit) return;
    const rows: string[][] = [
      ['item_name', 'total_qty', 'entries', 'zones', 'recounted'],
      ...byItem.items.map(i => [i.name, String(i.total), String(i.entries), zoneBreakdown(i.zones), i.recounted ? 'yes' : '']),
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_${audit.join_code}_${audit.venue_name.replace(/\s+/g, '_')}_by_item.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportCsv = () => {
    if (!audit) return;
    const rows: string[][] = [
      ['zone','item_name','qty','method','issue','issue_notes','counted_by','timestamp','is_recount'],
      ...entries.map(r => [
        r.zone, r.item_name, String(r.qty), r.method ?? '', issueLabel(r.issue), r.issue_notes ?? '',
        r.counted_by_name || r.counted_by_email, r.timestamp, String(r.is_recount),
      ]),
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
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
            {canReactivate && audit.status === 'submitted' && (
              <Btn
                variant="positive"
                size="sm"
                onClick={() => void reopen()}
                disabled={reactBusy || deleteBusy}
                title="Move this submitted audit back to Active, Count 1. Entries are kept; counters rejoin with the same code."
              >
                {reactBusy ? 'Reopening…' : 'Reopen audit'}
              </Btn>
            )}
            {canDelete && audit.status === 'cancelled' && (
              <Btn
                variant="critical"
                size="sm"
                leading={Ic.close(14)}
                onClick={() => void deleteAudit()}
                disabled={reactBusy || deleteBusy || !!entriesError}
                title={entriesError
                  ? 'Entries could not be loaded, so what this would destroy is unknown. Reload first.'
                  : 'Permanently remove this cancelled audit and all its entries from the server. Cannot be undone.'}
              >
                {deleteBusy ? 'Deleting…' : 'Delete audit'}
              </Btn>
            )}
            <Btn variant="secondary" size="sm" leading={Ic.download(14)} onClick={exportCsv}>Export CSV</Btn>
          </div>
        </div>
      </Card>

      {entriesError && (
        <Card padding={14} style={{ borderColor: 'var(--raspberry-300)', background: 'var(--raspberry-100)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240, fontSize: 12, color: 'var(--raspberry-400)' }}>
              Entries could not be loaded: {entriesError} — the numbers below are incomplete{audit.status === 'cancelled' ? ' and Delete is off until they load' : ''}.
            </div>
            <Btn variant="secondary" size="sm" onClick={() => void load()}>Retry</Btn>
          </div>
        </Card>
      )}
      {recountError && (
        <Card padding={14} style={{ borderColor: 'var(--copper-300)', background: 'var(--copper-100)' }}>
          <div style={{ fontSize: 12, color: 'var(--copper-400)' }}>
            Recount corrections could not be loaded: {recountError} — quantities below are before recount and may not match the variance.
          </div>
        </Card>
      )}

      {/* Stat strip — clickable for admin (corporate) to drill into the underlying entries */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatTile
          label="Entries" value={<Num value={stats.totalEntries} />}
          clickable={canDrill} active={drill?.kind === 'entries'}
          onClick={() => canDrill && setDrill(drill?.kind === 'entries' ? null : { kind: 'entries' })}
        />
        <StatTile
          label={finals.applied > 0 ? 'Total qty · after recount' : 'Total qty'} value={<Num value={stats.totalQty} />}
          clickable={canDrill} active={drill?.kind === 'qty'}
          onClick={() => canDrill && setDrill(drill?.kind === 'qty' ? null : { kind: 'qty' })}
        />
        <StatTile
          label="Counters" value={<Num value={stats.byCounter.size} />}
          clickable={canDrill} active={drill?.kind === 'counters'}
          onClick={() => canDrill && setDrill(drill?.kind === 'counters' ? null : { kind: 'counters' })}
        />
        <StatTile
          label="Open issues"
          value={<Num value={stats.issues} color={stats.issues ? 'var(--raspberry-300)' : undefined} />}
          clickable={canDrill && stats.issues > 0}
          active={drill?.kind === 'issues'}
          onClick={() => (canDrill && stats.issues > 0) && setDrill(drill?.kind === 'issues' ? null : { kind: 'issues' })}
        />
      </div>

      {varianceBehind && (
        <div style={{ fontSize: 11, color: 'var(--copper-400)' }}>
          {audit.status === 'cancelled'
            ? 'This count was cancelled, so it has no variance — the Count 2 corrections below are not in any variance report.'
            : reportAt
            ? `This audit's variance was computed ${new Date(reportAt).toLocaleString()} and may not include some of the Count 2 corrections below (recounts only reach the variance once linked to a catalog item, fixed 10/28) — they're in once it is recomputed.`
            : "This audit has no computed variance yet, so the Count 2 corrections below aren't in any variance report."}
        </div>
      )}

      {/* By zone — each row is its own drill target */}
      <Card padding={16}>
        <Eyebrow>By zone</Eyebrow>
        {finals.applied > 0 && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 11, marginTop: 6 }}>
            Qty with {finals.applied} Count 2 correction{finals.applied === 1 ? '' : 's'} applied, replacing the Count 1 quantity.
          </div>
        )}
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
              // Whole-item recounts have no entries of their own to drill into.
              const zoneDrill = canDrill && zone !== WHOLE_ITEM_ZONE;
              const handler = () => zoneDrill && setDrill(isActive ? null : { kind: 'zone', zone });
              return (
                <tr
                  key={zone}
                  onClick={zoneDrill ? handler : undefined}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    cursor: zoneDrill ? 'pointer' : 'default',
                    background: isActive ? 'var(--amethyst-100)' : undefined,
                  }}
                >
                  <td style={{ padding: '6px 4px' }}>{zone}</td>
                  <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{b.items}</td>
                  <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{b.qty.toFixed(1)}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{[...b.counters].join(', ')}</td>
                  {canDrill && (
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--fg-muted)', fontSize: 11 }}>
                      {zoneDrill ? (isActive ? 'open ↓' : 'view →') : ''}
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
          afterRecount={finals.applied > 0}
          onClose={() => setDrill(null)}
        />
      )}

      {/* By item (v0.76) — each product once, totalled across zones */}
      <Card padding={16}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Eyebrow>By item · {byItem.items.length} products</Eyebrow>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={itemSearch}
              onChange={e => setItemSearch(e.target.value)}
              placeholder="Search item…"
              style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
            />
            <Btn variant="secondary" size="sm" leading={Ic.download(14)} onClick={exportItemsCsv} disabled={byItem.items.length === 0}>Export by item</Btn>
          </div>
        </div>
        {(byItem.recountsApplied > 0 || byItem.recountEntries > 0) && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 11, marginTop: 6 }}>
            {byItem.recountsApplied > 0 && <>Totals with {byItem.recountsApplied} Count 2 correction{byItem.recountsApplied === 1 ? '' : 's'} applied, replacing the Count 1 quantity. </>}
            {byItem.recountEntries > 0 && <>{byItem.recountEntries} legacy recount-flagged {byItem.recountEntries === 1 ? 'entry is' : 'entries are'} left out, as the variance calculation leaves them out.</>}
          </div>
        )}
        <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                <th style={{ padding: '4px 4px' }}>Item</th>
                <th style={{ padding: '4px 4px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '4px 4px' }}>Where</th>
              </tr>
            </thead>
            <tbody>
              {byItemShown.map(i => (
                <tr key={i.key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px' }}>
                    {i.name}
                    {i.recounted && <span style={{ color: 'var(--fg-muted)', fontSize: 10, marginLeft: 6 }}>recounted</span>}
                    {!i.linked && <span style={{ color: 'var(--fg-muted)', fontSize: 10, marginLeft: 6 }}>not linked to a catalog item</span>}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{i.total}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{zoneBreakdown(i.zones)}</td>
                </tr>
              ))}
              {byItemShown.length === 0 && (
                <tr><td colSpan={3} style={{ padding: '8px 4px', color: 'var(--fg-muted)', fontSize: 12 }}>No matching items.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
  drill, entries, stats, afterRecount, onClose,
}: {
  drill: Drill;
  entries: KountEntry[];
  stats: ReturnType<typeof computeStats> extends infer T ? T : never; // see note below
  /** stats.totalQty has recount corrections applied; the rows listed are the raw entries. */
  afterRecount: boolean;
  onClose: () => void;
}) {
  // The shape of `stats` matches what useMemo returns above; we accept it as
  // typeof inference for ergonomic reasons rather than re-declaring the shape.

  const filtered = useMemo(() => {
    switch (drill.kind) {
      case 'entries':
      case 'qty':       return entries;
      case 'issues':    return entries.filter(isOpenIssue);
      case 'zone':      return entries.filter(r => r.zone === drill.zone);
      case 'counters':  return entries; // grouped view, see below
    }
  }, [drill, entries]);

  const title = (() => {
    switch (drill.kind) {
      case 'entries':  return `All ${entries.length} entries`;
      case 'qty':      return `All ${entries.length} entries — total qty ${stats.totalQty.toFixed(1)}${afterRecount ? ' after recount' : ''}`;
      case 'issues':   return `${filtered.length} open issue${filtered.length === 1 ? '' : 's'}`;
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
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: isOpenIssue(r) && drill.kind !== 'issues' ? 'var(--copper-100)' : undefined }}>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{r.item_name}</td>
                  <td style={{ padding: '6px 8px' }}>{r.zone}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono, monospace' }}>{Number(r.qty).toFixed(Number.isInteger(r.qty) ? 0 : 1)}</td>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--fg-muted)' }}>{r.method ?? '—'}</td>
                  <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--fg-muted)' }}>{r.counted_by_name || r.counted_by_email}</td>
                  <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--fg-muted)' }}>{new Date(r.timestamp).toLocaleString()}</td>
                  {drill.kind === 'issues' && (
                    <td style={{ padding: '6px 8px' }}>
                      <Pill tone={r.issue_resolved ? 'positive' : 'caution'} size="sm">{issueLabel(r.issue)}</Pill>
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
