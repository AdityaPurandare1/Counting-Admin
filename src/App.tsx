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
import { AI } from '@/screens/_placeholders';
import { refreshAccessList } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import { NotificationProvider } from '@/lib/notifications';
import { NotificationBell, NotificationToaster } from '@/components/NotificationUI';

const STORAGE_KEY = 'kount_admin_user_v1';

function loadUser(): AccessEntry | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

function saveUser(user: AccessEntry | null) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* quota / private mode */ }
}

export default function App() {
  const [user, setUser] = useState<AccessEntry | null>(() => loadUser());
  const nav = useNavigate();

  useEffect(() => { saveUser(user); }, [user]);

  // Warm the access-list cache at boot so the Login form resolves fast.
  useEffect(() => { void refreshAccessList(); }, []);

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
            <Route path="/recount"  element={<Recount user={user} />} />
            <Route path="/summary"  element={<Summary user={user} />} />
            <Route path="/issues"   element={<Issues user={user} />} />
            <Route path="/ai"       element={<AI />} />
            <Route path="/security" element={user.role === 'corporate' ? <Security user={user} /> : <Navigate to="/variance" replace />} />
            <Route path="*"         element={<Navigate to="/variance" replace />} />
          </Routes>
        </main>
        <NotificationBell />
        <NotificationToaster />
      </div>
    </NotificationProvider>
  );
}
