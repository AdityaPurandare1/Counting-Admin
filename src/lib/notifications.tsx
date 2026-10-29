import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { supabase, channelTopic } from './supabase';
import type { KountAudit, CountPhase, AuditStatus } from './types';
import type { AccessEntry } from './access';

import { isOrgWide } from '@/lib/access';
export interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  auditId: string;
  venueId: string;
  venueName: string;
  createdAt: string;
  read: boolean;
}

interface Ctx {
  items: NotificationItem[];
  unread: number;
  push: (n: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  /** Venue filter: ids the user cares about. Empty set = accept all. */
  venueFilter: Set<string>;
  setVenueFilter: (ids: Set<string>) => void;
}

const NotificationContext = createContext<Ctx | null>(null);

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}

const STORAGE_KEY = 'kount_admin_notifications_v1';
const FILTER_KEY = 'kount_admin_notifications_filter_v1';
const MAX_HISTORY = 50;

function loadStored(): NotificationItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveStored(items: NotificationItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch { /* quota */ }
}
function loadFilter(): Set<string> {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
function saveFilter(s: Set<string>) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify([...s])); } catch { /* quota */ }
}

function venueVisibleToUser(user: AccessEntry | null, venueId: string): boolean {
  if (!user) return false;
  if (isOrgWide(user.role) || user.venueIds === 'all') return true;
  return Array.isArray(user.venueIds) && user.venueIds.includes(venueId);
}

export type AuditState = { status: AuditStatus; count_phase: CountPhase };

/** What an audit was before an UPDATE. kount_audits keeps the default replica
 *  identity, so payload.old carries only the id; every missing "previous"
 *  value used to default to active/count1, and reactivating a cancelled audit
 *  that was in review toasted "Count 1 … completed". So the provider tracks the
 *  last state it saw per audit. Unknown → null → no toast: a missed
 *  notification beats a false one. Exported for the unit test. */
export function priorAuditState(known: AuditState | undefined, old: Partial<KountAudit> | null | undefined): AuditState | null {
  if (old?.status && old.count_phase) return { status: old.status, count_phase: old.count_phase };
  return known ?? null;
}

/** Builds a human-readable title from a phase / status transition. Exported for the unit test. */
export function phaseMessage(audit: KountAudit, prevPhase: CountPhase, prevStatus: AuditStatus): { title: string; body?: string } | null {
  if (audit.status === 'cancelled' && prevStatus !== 'cancelled') {
    return { title: `Audit cancelled — ${audit.venue_name}` };
  }
  if (audit.status === 'submitted' && prevStatus !== 'submitted') {
    return { title: `Audit submitted — ${audit.venue_name}`, body: 'Final report ready' };
  }
  if (audit.count_phase !== prevPhase) {
    if (audit.count_phase === 'review') return { title: `Count 1 for ${audit.venue_name} completed`, body: 'Recount list ready' };
    if (audit.count_phase === 'count2') return { title: `Count 2 started — ${audit.venue_name}` };
    if (audit.count_phase === 'final')  return { title: `Count 2 for ${audit.venue_name} completed`, body: 'Variance finalized' };
  }
  return null;
}

export function NotificationProvider({ user, children }: { user: AccessEntry | null; children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>(() => loadStored());
  const [venueFilter, setVenueFilterState] = useState<Set<string>>(() => loadFilter());

  const setVenueFilter = useCallback((ids: Set<string>) => {
    setVenueFilterState(new Set(ids));
    saveFilter(ids);
  }, []);

  const push = useCallback((n: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => {
    setItems(prev => {
      const dedupKey = `${n.auditId}:${n.title}`;
      if (prev.find(x => `${x.auditId}:${x.title}` === dedupKey && Date.now() - new Date(x.createdAt).getTime() < 60_000)) {
        return prev;  // swallow duplicates within a 60s window (Realtime can retry)
      }
      // Apply venue filter — empty set means "no filter, accept all"
      if (venueFilter.size > 0 && n.venueId && !venueFilter.has(n.venueId)) return prev;
      const next: NotificationItem = {
        ...n,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        read: false,
      };
      const out = [next, ...prev].slice(0, MAX_HISTORY);
      saveStored(out);
      return out;
    });
  }, [venueFilter]);

  const markRead = useCallback((id: string) => {
    setItems(prev => {
      const out = prev.map(n => n.id === id ? { ...n, read: true } : n);
      saveStored(out);
      return out;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems(prev => {
      const out = prev.map(n => ({ ...n, read: true }));
      saveStored(out);
      return out;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    saveStored([]);
  }, []);

  // Subscribe to kount_audits changes globally, filter client-side to venues
  // the user can see. Permissive-dev RLS lets anon see every row — if/when we
  // tighten RLS, the filter here becomes redundant but not wrong.
  // Subscribed per user only; push (which changes with the venue filter) is
  // read through a ref. Re-subscribing on a filter change reused the topic
  // while the old channel was still leaving, and realtime-js then dropped it.
  const pushRef = useRef(push);
  useEffect(() => { pushRef.current = push; }, [push]);
  useEffect(() => {
    if (!user) return;

    // Last status/phase seen per audit (see priorAuditState). Seeded once here;
    // a realtime event that lands first wins over the seed for that audit.
    const known = new Map<string, AuditState>();
    let live = true;
    void supabase
      .from('kount_audits')
      .select('id,status,count_phase')
      .order('started_at', { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { console.warn('[notifications] audit states not loaded; phase toasts wait for the next change', error); return; }
        for (const r of (data ?? []) as Array<AuditState & { id: string }>) {
          if (!known.has(r.id)) known.set(r.id, { status: r.status, count_phase: r.count_phase });
        }
      });

    const channel = supabase
      .channel(channelTopic('kount-audits-notifications'))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'kount_audits',
      }, (payload) => {
        const next = payload.new as KountAudit;
        if (!next || !next.venue_id) return;
        const prev = priorAuditState(known.get(next.id), payload.old as Partial<KountAudit> | null);
        known.set(next.id, { status: next.status, count_phase: next.count_phase });
        if (!prev) return;
        if (!venueVisibleToUser(user, next.venue_id)) return;
        const msg = phaseMessage(next, prev.count_phase, prev.status);
        if (!msg) return;
        pushRef.current({
          title: msg.title,
          body: msg.body,
          auditId: next.id,
          venueId: next.venue_id,
          venueName: next.venue_name,
        });
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'kount_audits',
      }, (payload) => {
        const row = payload.new as KountAudit;
        if (row?.id) known.set(row.id, { status: row.status, count_phase: row.count_phase });
        if (!row || !venueVisibleToUser(user, row.venue_id)) return;
        pushRef.current({
          title: `New audit started — ${row.venue_name}`,
          body: `by ${row.started_by_name || row.started_by_email}`,
          auditId: row.id,
          venueId: row.venue_id,
          venueName: row.venue_name,
        });
      })
      .subscribe();

    return () => { live = false; supabase.removeChannel(channel); };
  }, [user]);

  const unread = useMemo(() => items.filter(i => !i.read).length, [items]);

  const ctx = useMemo<Ctx>(() => ({
    items, unread, push, markRead, markAllRead, clear, venueFilter, setVenueFilter,
  }), [items, unread, push, markRead, markAllRead, clear, venueFilter, setVenueFilter]);

  return <NotificationContext.Provider value={ctx}>{children}</NotificationContext.Provider>;
}
