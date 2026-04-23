import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { Login } from '@/screens/Login';
import { Variance } from '@/screens/Variance';
import {
  Venues, Recount, Summary, Issues, AI,
} from '@/screens/_placeholders';
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
            <Route path="/venues"   element={<Venues />} />
            <Route path="/variance" element={<Variance user={user} />} />
            <Route path="/recount"  element={<Recount />} />
            <Route path="/summary"  element={<Summary />} />
            <Route path="/issues"   element={<Issues />} />
            <Route path="/ai"       element={<AI />} />
            <Route path="*"         element={<Navigate to="/variance" replace />} />
          </Routes>
        </main>
        <NotificationBell />
        <NotificationToaster />
      </div>
    </NotificationProvider>
  );
}
