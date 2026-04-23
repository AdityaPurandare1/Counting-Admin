import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { supabase } from './supabase';
import type { KountAudit, CountPhase, AuditStatus } from './types';
import type { AccessEntry } from './access';

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
}

const NotificationContext = createContext<Ctx | null>(null);

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}

const STORAGE_KEY = 'kount_admin_notifications_v1';
const MAX_HISTORY = 50;

function loadStored(): NotificationItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveStored(items: NotificationItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch { /* quota */ }
}

function venueVisibleToUser(user: AccessEntry | null, venueId: string): boolean {
  if (!user) return false;
  if (user.role === 'corporate' || user.venueIds === 'all') return true;
  return Array.isArray(user.venueIds) && user.venueIds.includes(venueId);
}

/** Builds a human-readable title from a phase / status transition. */
function phaseMessage(audit: KountAudit, prevPhase: CountPhase, prevStatus: AuditStatus): { title: string; body?: string } | null {
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

  const push = useCallback((n: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => {
    setItems(prev => {
      const dedupKey = `${n.auditId}:${n.title}`;
      if (prev.find(x => `${x.auditId}:${x.title}` === dedupKey && Date.now() - new Date(x.createdAt).getTime() < 60_000)) {
        return prev;  // swallow duplicates within a 60s window (Realtime can retry)
      }
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
  }, []);

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
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('kount-audits-notifications')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'kount_audits',
      }, (payload) => {
        const next = payload.new as KountAudit;
        const prev = (payload.old ?? {}) as Partial<KountAudit>;
        if (!next || !next.venue_id) return;
        if (!venueVisibleToUser(user, next.venue_id)) return;
        const msg = phaseMessage(next, (prev.count_phase ?? 'count1') as CountPhase, (prev.status ?? 'active') as AuditStatus);
        if (!msg) return;
        push({
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
        if (!row || !venueVisibleToUser(user, row.venue_id)) return;
        push({
          title: `New audit started — ${row.venue_name}`,
          body: `by ${row.started_by_name || row.started_by_email}`,
          auditId: row.id,
          venueId: row.venue_id,
          venueName: row.venue_name,
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, push]);

  const unread = useMemo(() => items.filter(i => !i.read).length, [items]);

  const ctx = useMemo<Ctx>(() => ({ items, unread, push, markRead, markAllRead, clear }), [items, unread, push, markRead, markAllRead, clear]);

  return <NotificationContext.Provider value={ctx}>{children}</NotificationContext.Provider>;
}
