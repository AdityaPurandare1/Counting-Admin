import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit } from '@/lib/types';
import { Btn, Card, Eyebrow, Pill } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Stale audits prompt (v0.23)

   Audits never auto-close — they sit at status='active' until someone
   manually submits or cancels them. A counter who walks away mid-shift,
   or an audit started by mistake, will linger in Variance / Counts
   forever, taking up a slot.

   This prompt fires once per browser session for corporate admins:
   loads any active audit older than STALE_THRESHOLD_HOURS, presents
   the list with per-audit cancel buttons + a Dismiss escape. Cancel is
   manual per row (not bulk) so the admin doesn't accidentally nuke a
   real long-running audit they forgot about.

   sessionStorage flag suppresses the prompt for the rest of the same
   tab session after dismissal — closing the tab and signing back in
   shows it again if any audits are still stale.
   ─────────────────────────────────────────────────────────────────────── */

const STALE_THRESHOLD_HOURS = 48;
const SESSION_DISMISS_KEY = 'kount_admin_stale_audits_dismissed_v1';

interface StaleRow {
  audit: KountAudit;
  entryCount: number;
}

interface Props {
  user: AccessEntry;
}

export function StaleAuditsPrompt({ user }: Props) {
  const [stale, setStale] = useState<StaleRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (user.role !== 'corporate') return;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return;

    const cutoffIso = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
    const { data, error: qErr } = await supabase
      .from('kount_audits')
      .select('*')
      .eq('status', 'active')
      .lt('started_at', cutoffIso)
      .order('started_at', { ascending: true });
    if (qErr) {
      console.warn('[stale-audits] load failed:', qErr);
      return;
    }
    const audits = (data ?? []) as KountAudit[];
    if (audits.length === 0) return;

    // Pull entry counts so admin can see whether each audit has real data
    // riding on it before cancelling. Done in parallel — should be fast for
    // the small number of stale audits we expect.
    const counts = await Promise.all(audits.map(async a => {
      const r = await supabase
        .from('kount_entries')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', a.id);
      return (r as unknown as { count: number | null }).count ?? 0;
    }));

    setStale(audits.map((a, i) => ({ audit: a, entryCount: counts[i] })));
    setShow(true);
  }, [user]);

  // Run once on mount per identity. The user prop is stable across re-renders
  // unless sign-in / sign-out actually changes it; the App.tsx unmount on
  // sign-out tears down the component and resets state.
  useEffect(() => { void load(); }, [load]);

  const cancelOne = async (row: StaleRow) => {
    const a = row.audit;
    const ageH = Math.round((Date.now() - new Date(a.started_at).getTime()) / 3_600_000);
    const msg = row.entryCount === 0
      ? `Cancel ${a.join_code} (${a.venue_name})?\n\nNo entries recorded — safe to drop.`
      : `Cancel ${a.join_code} (${a.venue_name})?\n\n${row.entryCount} entries on file (${ageH}h old). Entries are preserved on the server; the audit just moves to Cancelled. Reactivate later from Summary if needed.`;
    if (!confirm(msg)) return;

    setBusyId(a.id);
    setError(null);
    const { error: uErr } = await supabase
      .from('kount_audits')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', a.id)
      .eq('status', 'active'); // race guard: someone else may have closed it already
    setBusyId(null);
    if (uErr) {
      setError(`Cancel failed for ${a.join_code}: ${uErr.message}`);
      return;
    }
    // Drop from the local list; close the prompt entirely if it was the last one
    setStale(prev => {
      const next = prev.filter(s => s.audit.id !== a.id);
      if (next.length === 0) setShow(false);
      return next;
    });
  };

  const dismiss = () => {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch { /* ignore */ }
    setShow(false);
  };

  if (!show || stale.length === 0) return null;

  return (
    <div
      // Backdrop: dismiss only when clicking the overlay itself, not when
      // the click bubbles up from anything inside the Card.
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,.45)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <Card
        padding={20}
        style={{ width: 'min(720px, 92vw)', maxHeight: '88vh', overflow: 'auto' }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <Eyebrow>{stale.length} stale audit{stale.length === 1 ? '' : 's'}</Eyebrow>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                Active for over {STALE_THRESHOLD_HOURS} hours
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
                Audits don't auto-close — these are still showing as in-progress in Variance / Counts.
                Cancel any that were forgotten or started by mistake. Reactivate later from Summary
                if you change your mind. Entries are preserved either way.
              </div>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              title="Dismiss for this session"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--fg-muted)', fontSize: 18, lineHeight: 1, padding: 4,
              }}
            >×</button>
          </div>

          {error && (
            <div style={{
              marginTop: 12, padding: '8px 12px',
              background: 'var(--raspberry-100)', border: '1px solid var(--raspberry-300)',
              borderRadius: 6, color: 'var(--raspberry-400)', fontSize: 12,
            }}>{error}</div>
          )}

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stale.map(row => {
              const a = row.audit;
              const startedAt = new Date(a.started_at);
              const ageH = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 3_600_000));
              const ageLabel = ageH < 72 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
              return (
                <div
                  key={a.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    background: 'var(--off-200)', borderRadius: 8,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--accent-bg)', letterSpacing: 2, fontSize: 13 }}>
                        {a.join_code}
                      </span>
                      <Pill tone="caution" size="sm">{a.count_phase}</Pill>
                      <Pill tone="ghost" size="sm">{ageLabel}</Pill>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{a.venue_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
                      started {startedAt.toLocaleString()} · by {a.started_by_name || a.started_by_email}
                      {' · '}
                      <span style={{ color: row.entryCount === 0 ? 'var(--copper-400)' : 'var(--fg-secondary)' }}>
                        {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'}
                      </span>
                    </div>
                  </div>
                  <Btn
                    variant="critical"
                    size="sm"
                    leading={Ic.close(12)}
                    onClick={() => void cancelOne(row)}
                    disabled={busyId === a.id}
                  >
                    {busyId === a.id ? 'Cancelling…' : 'Cancel'}
                  </Btn>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={dismiss}>Dismiss for this session</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
