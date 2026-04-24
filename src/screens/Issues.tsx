import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { VENUES } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry } from '@/lib/types';
import { Pill, Eyebrow, Card, Btn } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Issues screen (v0.10)

   Derived view over kount_entries where issue != 'none'. No dedicated
   issues table — the entries themselves carry the flag, so nothing
   needs to sync separately.

   Filters: venue (user-visible), issue type, time window.
   Realtime: channel on kount_entries so a newly-scanned issue pops in.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

const KNOWN_ISSUES = [
  'no-sticker',
  'not-in-craftable',
  'no-upc',
  'wrong-location',
  'damaged',
  'misplaced',
  'expired',
  'wrong-vintage',
  'no-label',
  'other',
] as const;

type WindowChoice = 'all' | '7d' | '24h';
type StatusChoice = 'open' | 'resolved' | 'all';

export function Issues({ user }: Props) {
  const [entries,  setEntries]  = useState<KountEntry[]>([]);
  const [audits,   setAudits]   = useState<Map<string, KountAudit>>(new Map());
  const [loading,  setLoading]  = useState(true);
  const [venue,    setVenue]    = useState<string>('');
  const [issue,    setIssue]    = useState<string>('');
  const [window_,  setWindow_]  = useState<WindowChoice>('7d');
  const [status,   setStatus]   = useState<StatusChoice>('open');

  const visibleVenues = useMemo(() => {
    if (user.role === 'corporate' || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);

    // Time window → timestamp cutoff
    const now = Date.now();
    const cutoff = window_ === '24h' ? new Date(now - 86_400_000).toISOString()
                 : window_ === '7d'  ? new Date(now - 7 * 86_400_000).toISOString()
                 : null;

    let q = supabase
      .from('kount_entries')
      .select('*')
      .neq('issue', 'none')
      .order('timestamp', { ascending: false })
      .limit(500);
    if (cutoff) q = q.gte('timestamp', cutoff);
    if (status === 'open')     q = q.eq('issue_resolved', false);
    if (status === 'resolved') q = q.eq('issue_resolved', true);

    const { data: entriesRows, error } = await q;
    if (error) { console.error('[issues] load', error); setLoading(false); return; }

    const rows = (entriesRows ?? []) as KountEntry[];

    // Pull audits referenced by these entries to get venue context
    const auditIds = Array.from(new Set(rows.map(r => r.audit_id)));
    const auditMap = new Map<string, KountAudit>();
    if (auditIds.length > 0) {
      const { data: auditRows } = await supabase
        .from('kount_audits')
        .select('*')
        .in('id', auditIds);
      for (const a of (auditRows ?? []) as KountAudit[]) auditMap.set(a.id, a);
    }
    setAudits(auditMap);

    // Filter by user's visible venues
    const visibleIds = new Set(visibleVenues.map(v => v.id));
    const filtered = rows.filter(r => {
      const a = auditMap.get(r.audit_id);
      if (!a) return false;
      if (user.role !== 'corporate' && !visibleIds.has(a.venue_id)) return false;
      return true;
    });
    setEntries(filtered);
    setLoading(false);
  }, [window_, status, user, visibleVenues]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('kount-issues-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_entries' }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const rendered = useMemo(() => {
    return entries.filter(e => {
      const a = audits.get(e.audit_id);
      if (venue && a?.venue_id !== venue) return false;
      if (issue && e.issue !== issue) return false;
      return true;
    });
  }, [entries, audits, venue, issue]);

  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    const byVenue = new Map<string, number>();
    for (const e of entries) {
      const key = e.issue || 'other';
      byType.set(key, (byType.get(key) ?? 0) + 1);
      const vid = audits.get(e.audit_id)?.venue_id;
      if (vid) byVenue.set(vid, (byVenue.get(vid) ?? 0) + 1);
    }
    return { byType, byVenue };
  }, [entries, audits]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Issues tracker</div>
          <h1>Flagged items</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={status} onChange={e => setStatus(e.target.value as StatusChoice)} style={pickerStyle}>
            <option value="open">Open only</option>
            <option value="resolved">Resolved only</option>
            <option value="all">Open + resolved</option>
          </select>
          <select value={window_} onChange={e => setWindow_(e.target.value as WindowChoice)} style={pickerStyle}>
            <option value="24h">Last 24 h</option>
            <option value="7d">Last 7 days</option>
            <option value="all">All time</option>
          </select>
          <select value={venue} onChange={e => setVenue(e.target.value)} style={pickerStyle}>
            <option value="">All venues</option>
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={issue} onChange={e => setIssue(e.target.value)} style={pickerStyle}>
            <option value="">All issue types</option>
            {KNOWN_ISSUES.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* summary tiles */}
        <Card padding={14}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Tile label="Flagged" value={entries.length} />
            <Tile label="Visible" value={rendered.length} />
            <Tile label="Venues touched" value={counts.byVenue.size} />
            <Tile label="Distinct types" value={counts.byType.size} />
          </div>
        </Card>

        {/* by-type breakdown */}
        {counts.byType.size > 0 && (
          <Card padding={14}>
            <Eyebrow>By issue type</Eyebrow>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {[...counts.byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <button
                  key={t}
                  onClick={() => setIssue(t === issue ? '' : t)}
                  style={{
                    padding: '6px 10px', borderRadius: 9999,
                    border: '1px solid ' + (t === issue ? 'var(--dark-900)' : 'var(--border)'),
                    background: t === issue ? 'var(--dark-900)' : '#FFF',
                    color: t === issue ? 'var(--off-100)' : 'var(--fg-primary)',
                    fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                  }}>
                  {t} · {n}
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card padding={16}>
          {loading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
          {!loading && rendered.length === 0 && (
            <div style={{ color: 'var(--fg-muted)' }}>
              No issues match the current filter. Changing the time window to "All time" may surface older ones.
            </div>
          )}
          {!loading && rendered.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={{ padding: '6px 4px' }}>Venue</th>
                  <th style={{ padding: '6px 4px' }}>Zone</th>
                  <th style={{ padding: '6px 4px' }}>Item</th>
                  <th style={{ padding: '6px 4px' }}>Issue</th>
                  <th style={{ padding: '6px 4px' }}>Notes</th>
                  <th style={{ padding: '6px 4px' }}>Counter</th>
                  <th style={{ padding: '6px 4px' }}>When</th>
                  <th style={{ padding: '6px 4px', width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {rendered.map(e => {
                  const a = audits.get(e.audit_id);
                  const resolved = !!e.issue_resolved;
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid var(--border)', opacity: resolved ? 0.65 : 1 }}>
                      <td style={{ padding: '8px 4px' }}>{a?.venue_name ?? '—'}</td>
                      <td style={{ padding: '8px 4px', color: 'var(--fg-muted)' }}>{e.zone}</td>
                      <td style={{ padding: '8px 4px', fontWeight: 500 }}>{e.item_name}</td>
                      <td style={{ padding: '8px 4px' }}>
                        {resolved ? <Pill tone="positive" size="sm">{e.issue} · resolved</Pill> : <Pill tone="caution" size="sm">{e.issue}</Pill>}
                      </td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: 'var(--fg-muted)', maxWidth: 260 }}>{e.issue_notes ?? ''}</td>
                      <td style={{ padding: '8px 4px', fontSize: 12, color: 'var(--fg-muted)' }}>{e.counted_by_name || e.counted_by_email}</td>
                      <td style={{ padding: '8px 4px', fontSize: 11, color: 'var(--fg-muted)' }}>{new Date(e.timestamp).toLocaleString()}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        {resolved ? (
                          <Btn variant="ghost" size="sm" onClick={() => void toggleResolved(e, false, user)}>Reopen</Btn>
                        ) : (
                          <Btn variant="positive" size="sm" leading={Ic.check(12)} onClick={() => void toggleResolved(e, true, user)}>Resolve</Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

const pickerStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border-strong)',
  borderRadius: 6, fontFamily: 'inherit', fontSize: 13,
};

async function toggleResolved(entry: KountEntry, resolve: boolean, user: AccessEntry) {
  const patch = resolve
    ? { issue_resolved: true,  issue_resolved_by: user.email, issue_resolved_at: new Date().toISOString() }
    : { issue_resolved: false, issue_resolved_by: null,       issue_resolved_at: null };
  const { error } = await supabase.from('kount_entries').update(patch).eq('id', entry.id);
  if (error) alert('Update failed: ' + error.message);
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
