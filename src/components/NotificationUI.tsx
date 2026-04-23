import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/lib/notifications';
import type { NotificationItem } from '@/lib/notifications';
import { Ic } from './Icons';

/** Renders two things:
 *  1) a fixed bell button in the top-right of the main content area, with a
 *     dropdown list of recent notifications (persisted across reloads).
 *  2) a stack of transient toasts in the bottom-right for new notifications.
 *
 *  Both live here so there's one source of truth; any screen can push into the
 *  store via useNotifications().push(), but the app itself subscribes globally
 *  to kount_audits so the common events (count 1 closed etc.) flow through. */

function formatTime(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return d.toLocaleDateString();
}

export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const go = (item: NotificationItem) => {
    markRead(item.id);
    setOpen(false);
    navigate(`/variance?audit=${item.auditId}`);
  };

  return (
    <div ref={ref} style={{ position: 'fixed', top: 16, right: 20, zIndex: 40 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          position: 'relative', width: 38, height: 38, borderRadius: 9999,
          background: '#FFF', border: '1px solid var(--border)',
          display: 'grid', placeItems: 'center', cursor: 'pointer',
          color: 'var(--fg-primary)', boxShadow: 'var(--shadow-sm)',
        }}>
        {Ic.bell(18)}
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 9999,
            background: 'var(--raspberry-300)', color: '#FFF',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
            display: 'grid', placeItems: 'center',
          }}>{unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 46, right: 0,
          width: 340, maxHeight: 480, overflowY: 'auto',
          background: '#FFF', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: 6,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-primary)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Notifications
            </span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--fg-muted)', fontSize: 11, fontFamily: 'inherit',
              }}>Mark all read</button>
            )}
          </div>
          {items.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12 }}>
              No notifications yet.
            </div>
          )}
          {items.map(n => (
            <button
              key={n.id}
              onClick={() => go(n)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 12px', border: 'none',
                background: n.read ? 'transparent' : 'var(--amethyst-100)',
                borderRadius: 6, cursor: 'pointer',
                marginBottom: 2, fontFamily: 'inherit',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--fg-primary)', lineHeight: 1.3 }}>
                  {n.title}
                </span>
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', flex: 'none' }}>
                  {formatTime(n.createdAt)}
                </span>
              </div>
              {n.body && (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 3 }}>
                  {n.body}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------- Toaster -------------------- */

interface ToastItem { id: string; title: string; body?: string; auditId: string; createdAt: number }

export function NotificationToaster() {
  const { items } = useNotifications();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    // Any newly-arrived item (by id) spawns a toast
    for (const n of items) {
      if (seenRef.current.has(n.id)) continue;
      seenRef.current.add(n.id);
      // Don't toast items that were restored from localStorage on mount
      if (Date.now() - new Date(n.createdAt).getTime() > 15_000) continue;
      const t: ToastItem = { id: n.id, title: n.title, body: n.body, auditId: n.auditId, createdAt: Date.now() };
      setToasts(prev => [t, ...prev].slice(0, 4));
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 6000);
    }
  }, [items]);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 50,
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
    }}>
      {toasts.map(t => (
        <button
          key={t.id}
          onClick={() => { navigate(`/variance?audit=${t.auditId}`); setToasts(prev => prev.filter(x => x.id !== t.id)); }}
          style={{
            minWidth: 280, maxWidth: 360, textAlign: 'left',
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--dark-900)', color: 'var(--off-100)',
            border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-md)',
            fontFamily: 'inherit',
          }}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{t.title}</div>
          {t.body && <div style={{ fontSize: 11, color: 'rgba(255,249,245,.65)', marginTop: 3 }}>{t.body}</div>}
          <div style={{ fontSize: 10, color: 'var(--gold-300)', marginTop: 6, letterSpacing: '.05em', textTransform: 'uppercase' }}>
            click to open →
          </div>
        </button>
      ))}
    </div>
  );
}
