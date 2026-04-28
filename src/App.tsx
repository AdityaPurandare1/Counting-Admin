import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { Login } from '@/screens/Login';
import { Variance } from '@/screens/Variance';
import { Recount } from '@/screens/Recount';
import { Summary } from '@/screens/Summary';
import { Security } from '@/screens/Security';
import { Venues } from '@/screens/Venues';
import { Issues } from '@/screens/Issues';
import { Approvals } from '@/screens/Approvals';
import { Catalog } from '@/screens/Catalog';
import { Counts } from '@/screens/Counts';
import { AI } from '@/screens/_placeholders';
import { refreshAccessList, resolveAccess } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import { NotificationProvider } from '@/lib/notifications';
import { NotificationBell, NotificationToaster } from '@/components/NotificationUI';
import { StaleAuditsPrompt } from '@/components/StaleAuditsPrompt';

const STORAGE_KEY  = 'kount_admin_user_v1';
const SESSION_MS   = 8 * 60 * 60 * 1000; // 8 hours

interface StoredSession {
  user: AccessEntry;
  expiresAt: number;
}

function isAccessEntry(x: unknown): x is AccessEntry {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.email !== 'string' || typeof o.name !== 'string') return false;
  if (o.role !== 'corporate' && o.role !== 'manager' && o.role !== 'counter') return false;
  if (o.venueIds !== 'all' && !Array.isArray(o.venueIds)) return false;
  return true;
}

function loadUser(): AccessEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.user || !parsed.expiresAt) return null;
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!isAccessEntry(parsed.user)) {
      // Tampered or pre-hardening shape — refuse and force a fresh sign-in.
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.user;
  } catch { return null; }
}

function saveUser(user: AccessEntry | null) {
  try {
    if (user) {
      const session: StoredSession = { user, expiresAt: Date.now() + SESSION_MS };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* quota / private mode */ }
}

export default function App() {
  const [user, setUser] = useState<AccessEntry | null>(() => loadUser());
  const nav = useNavigate();

  useEffect(() => { saveUser(user); }, [user]);

  // Warm the access-list cache at boot so the Login form resolves fast,
  // then re-validate the restored session against the live app_users
  // table — a deactivation in the DB should kick the user immediately.
  useEffect(() => {
    void (async () => {
      await refreshAccessList();
      if (!user) return;
      const live = resolveAccess(user.email);
      if (!live || live.role === 'counter') {
        setUser(null);
        nav('/');
      } else if (live.role !== user.role) {
        // Role/scope changes propagate in-place rather than forcing a sign-out.
        setUser(live);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) {
    return <Login onSignedIn={(u) => { setUser(u); nav('/variance'); }} />;
  }

  return (
    <NotificationProvider user={user}>
      <div className="app-shell">
        <Sidebar
          userName={user.name}
          userRole={user.role}
          onSignOut={() => { setUser(null); nav('/'); }}
        />
        <main className="main">
          <Routes>
            <Route path="/"         element={<Navigate to="/variance" replace />} />
            <Route path="/venues"   element={<Venues user={user} />} />
            <Route path="/variance" element={<Variance user={user} />} />
            <Route path="/counts"   element={(user.role === 'corporate' || user.role === 'manager') ? <Counts user={user} /> : <Navigate to="/variance" replace />} />
            <Route path="/recount"  element={<Recount user={user} />} />
            <Route path="/summary"  element={<Summary user={user} />} />
            <Route path="/issues"   element={<Issues user={user} />} />
            <Route path="/ai"       element={<AI />} />
            <Route path="/approvals" element={(user.role === 'corporate' || user.role === 'manager') ? <Approvals user={user} /> : <Navigate to="/variance" replace />} />
            <Route path="/catalog"   element={user.role === 'corporate' ? <Catalog user={user} /> : <Navigate to="/variance" replace />} />
            <Route path="/security"  element={user.role === 'corporate' ? <Security user={user} /> : <Navigate to="/variance" replace />} />
            <Route path="*"         element={<Navigate to="/variance" replace />} />
          </Routes>
        </main>
        <NotificationBell />
        <NotificationToaster />
        {/* Stale-audits prompt — fires once per session for corporate admins
            with active audits older than 48 h. Component self-gates by role
            and sessionStorage, so cheap to mount unconditionally. */}
        <StaleAuditsPrompt user={user} />
      </div>
    </NotificationProvider>
  );
}
