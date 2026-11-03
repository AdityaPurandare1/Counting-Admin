import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { Login } from '@/screens/Login';
import { Overview } from '@/screens/Overview';
import { ItemHistory } from '@/screens/ItemHistory';
import { Variance } from '@/screens/Variance';
import { Recount } from '@/screens/Recount';
import { Summary } from '@/screens/Summary';
import { Security } from '@/screens/Security';
import { Venues } from '@/screens/Venues';
import { Issues } from '@/screens/Issues';
import { Approvals } from '@/screens/Approvals';
import { Catalog } from '@/screens/Catalog';
import { Counts } from '@/screens/Counts';
import { VenueSettings } from '@/screens/VenueSettings';
import { Reports } from '@/screens/Reports';
// v0.72: Inventory archived -- screen kept in src/screens/Inventory.tsx, route redirects.
import { Transfers } from '@/screens/Transfers';
import { StockOnHand } from '@/screens/StockOnHand';
import { FoodCount } from '@/screens/FoodCount';
import { UserAccess } from '@/screens/UserAccess';
import { PurchasePrices } from '@/screens/PurchasePrices';
import { OrderTracker } from '@/screens/OrderTracker';
import { OrderPrices } from '@/screens/OrderPrices';
import { AskAI } from '@/screens/AskAI';
import { refreshAccessList, refreshVenues, resolveAccess, can, isDesktopUser } from '@/lib/access';
import { firstRoute } from '@/lib/routes';
import { refreshVenueLookups } from '@/lib/venueMap';
import type { AccessEntry } from '@/lib/access';
import { NotificationProvider } from '@/lib/notifications';
import { NotificationBell, NotificationToaster } from '@/components/NotificationUI';
import { StaleAuditsPrompt } from '@/components/StaleAuditsPrompt';
import { supabase } from '@/lib/supabase';
import { setTelemetryUser } from '@/lib/telemetry';

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
  if (o.role !== 'admin' && o.role !== 'corporate' && o.role !== 'manager' && o.role !== 'counter' && o.role !== 'venue_manager') return false;
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

/* Phase 3 helper: heuristic for "this SIGNED_IN is from clicking an invite
 * link" vs a normal repeat sign-in. created_at and last_sign_in_at land
 * within seconds of each other on the very first session and diverge
 * meaningfully on every later one. 5-minute slop covers clock skew + the
 * window between user-creation and the user actually clicking the email.
 * False if either timestamp is missing — better to silently proceed with
 * a normal SIGNED_IN than spuriously prompt an existing user. */
function _isFirstLoginSession(session: { user?: { created_at?: string; last_sign_in_at?: string } } | null): boolean {
  if (!session || !session.user) return false;
  const createdAt    = session.user.created_at;
  const lastSignInAt = session.user.last_sign_in_at;
  if (!createdAt || !lastSignInAt) return false;
  const created = new Date(createdAt).getTime();
  const last    = new Date(lastSignInAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(last)) return false;
  return Math.abs(last - created) < 5 * 60 * 1000;
}

/* Phase 3 helper: shared password-set prompt for invite + reset flows.
 * Mirrors the phone app's handlePasswordRecoveryFlow. window.prompt is
 * intentionally minimal — a fancier modal can come later. On cancel /
 * too-short / updateUser failure we sign the temp session OUT so the
 * email link stays re-usable (the user can just click it again). */
async function runPasswordRecoveryFlow(
  setUser: (u: AccessEntry | null) => void,
  nav: (path: string) => void,
): Promise<void> {
  const newPassword = window.prompt('Welcome — set a password to finish signing in. Minimum 8 characters.');
  if (!newPassword || newPassword.length < 8) {
    alert('Password not set — signing out. Re-open your email link to try again.');
    await supabase.auth.signOut().catch(() => {});
    return;
  }
  const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updateErr) {
    alert('Couldn\'t set password: ' + (updateErr.message || 'unknown') + '. Signing out — try the link again.');
    await supabase.auth.signOut().catch(() => {});
    return;
  }
  // Hydrate from the live session: app_users lookup gives role + venues.
  await refreshAccessList();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.email) {
    alert('Password set but session lookup failed — please sign in again.');
    await supabase.auth.signOut().catch(() => {});
    return;
  }
  const profile = resolveAccess(session.user.email);
  if (!profile) {
    alert('Password set but no app profile found. Ask another admin to assign your role.');
    await supabase.auth.signOut().catch(() => {});
    return;
  }
  if (!isDesktopUser(profile)) {
    alert('Password set, but the desktop app is for admins, corporate, managers and venue management only. Counters use the phone app instead.');
    await supabase.auth.signOut().catch(() => {});
    return;
  }
  setUser(profile);
  nav('/variance');
}

export default function App() {
  const [user, setUser] = useState<AccessEntry | null>(() => loadUser());
  const nav = useNavigate();

  useEffect(() => {
    saveUser(user);
    // Attribute telemetry to the signed-in admin (cleared on sign-out).
    setTelemetryUser(user?.email ?? null);
  }, [user]);

  // Warm the access-list + venue caches at boot so the Login form +
  // venue pickers resolve fast, then re-validate the restored session
  // against the live app_users table — a deactivation in the DB should
  // kick the user immediately. v0.28: venues table is now the source of
  // truth for venues; the local VENUES const seeds first paint and gets
  // overwritten by refreshVenues / refreshVenueLookups.
  useEffect(() => {
    void (async () => {
      await Promise.all([
        refreshAccessList(),
        refreshVenues(),
        refreshVenueLookups(),
      ]);
      if (!user) return;
      const live = resolveAccess(user.email);
      if (!live || !isDesktopUser(live)) {
        setUser(null);
        nav('/');
      } else if (JSON.stringify([live.role, live.roles, live.features, live.venueIds]) !== JSON.stringify([user.role, user.roles, user.features, user.venueIds])) {
        // Role / permission / venue changes propagate in-place rather than forcing a sign-out.
        setUser(live);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v0.56: re-run the lookups once there IS a signed-in user.
  //
  // The effect above has [] deps, so it fires once at mount — BEFORE
  // sign-in. Its refreshVenues() therefore goes out unauthenticated, and
  // kount_venues is {authenticated}-only, so it comes back with 0 rows and
  // no error. refreshVenues only overwrites when mapped.length > 0, so it
  // correctly keeps what it had — which is the hardcoded VENUES_BASELINE,
  // v1..v10. Nothing re-ran it afterwards, so the venue list stayed frozen
  // at that baseline for the whole session: venues retired since then still
  // listed, and every venue added since missing.
  //
  // That is invisible to a corporate user, who sees ten plausible venues.
  // It is fatal to a manager scoped to a newer one: Dean (venue_ids
  // = {v12}) filtered the stale list down to an EMPTY set, so the Start
  // audit modal had nothing to offer and he could not open a count at all.
  //
  // Same root cause as the phone's v2.00-v2.02 fixes: a boot-time read
  // racing the session, and an empty result being indistinguishable from
  // 'nothing there'.
  useEffect(() => {
    if (!user?.email) return;
    void Promise.all([refreshVenues(), refreshVenueLookups(), refreshAccessList()]);
  }, [user?.email]);

  // Phase 3 (Supabase Auth) auth-state subscription. Three events to handle:
  //   - SIGNED_OUT: session disappeared server-side (admin disabled the
  //     user, or refresh window past 30 days). Yank to login.
  //   - PASSWORD_RECOVERY: user landed via a reset-password email link.
  //     Prompt them to set a new password, then route through the post-
  //     login profile lookup.
  //   - SIGNED_IN: fires on every login including the FIRST one after
  //     clicking an invite email. We detect first-login (created_at ≈
  //     last_sign_in_at within 5 min) and treat it the same as
  //     PASSWORD_RECOVERY — the invited user has no usable password yet
  //     and must set one before their session expires.
  // Legacy ACCESS_LIST users never had a Supabase session at all, so
  // none of these fire for them.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        nav('/');
        return;
      }
      if (event === 'PASSWORD_RECOVERY') {
        void runPasswordRecoveryFlow(setUser, nav);
        return;
      }
      if (event === 'SIGNED_IN' && session && _isFirstLoginSession(session)) {
        void runPasswordRecoveryFlow(setUser, nav);
        return;
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [nav]);

  if (!user) {
    return <Login onSignedIn={(u) => { setUser(u); nav(firstRoute(u)); }} />;
  }

  const home = firstRoute(user);
  const gate = (key: string, el: JSX.Element) => (can(user, key) ? el : <Navigate to={home} replace />);

  return (
    <NotificationProvider user={user}>
      <div className="app-shell">
        <Sidebar
          user={user}
          onSignOut={() => {
            // Invalidate the Supabase Auth session too. signOut() fires
            // SIGNED_OUT which our auth-state effect picks up and clears
            // local state; we still call setUser/nav synchronously so
            // the screen flips immediately even if the network call is
            // slow. Legacy ACCESS_LIST users have no session, so signOut
            // is a no-op for them.
            void supabase.auth.signOut().catch(() => {});
            setUser(null);
            nav('/');
          }}
        />
        <main className="main">
          <Routes>
            {/* v0.96: every screen by its permission (src/lib/permissions.ts); without it, the first screen the person has */}
            <Route path="/"         element={<Navigate to={home} replace />} />
            <Route path="/overview" element={gate('audit:overview', <Overview user={user} />)} />
            <Route path="/venues"   element={gate('audit:view', <Venues user={user} />)} />
            <Route path="/variance" element={gate('audit:view', <Variance user={user} />)} />
            <Route path="/item-history" element={gate('audit:view', <ItemHistory user={user} />)} />
            <Route path="/counts"   element={gate('audit:counts', <Counts user={user} />)} />
            <Route path="/recount"  element={gate('audit:view', <Recount user={user} />)} />
            <Route path="/summary"  element={gate('audit:view', <Summary user={user} />)} />
            <Route path="/reports"  element={gate('admin:reports', <Reports user={user} />)} />
            <Route path="/issues"   element={gate('team:issues', <Issues user={user} />)} />
            <Route path="/ai"       element={gate('team:ask-ai', <AskAI user={user} />)} />
            <Route path="/approvals" element={gate('admin:approvals', <Approvals user={user} />)} />
            <Route path="/catalog"   element={gate('admin:catalog', <Catalog user={user} />)} />
            {/* org-wide money data: the RPC / the kount_ot_* RLS check the same permissions (0149) */}
            <Route path="/purchase-prices" element={gate('purchasing:liquor-wine', <PurchasePrices user={user} />)} />
            <Route path="/order-tracker"   element={gate('purchasing:order-tracker', <OrderTracker user={user} />)} />
            <Route path="/order-prices"    element={gate('purchasing:order-prices', <OrderPrices user={user} />)} />
            <Route path="/inventory" element={<Navigate to={home} replace />} />
            <Route path="/transfers" element={gate('admin:transfers', <Transfers user={user} />)} />
            <Route path="/stock"     element={gate('admin:stock', <StockOnHand user={user} />)} />
            <Route path="/food"      element={gate('admin:food-count', <FoodCount user={user} />)} />
            <Route path="/security"  element={gate('access:users', <Security user={user} />)} />
            <Route path="/user-access" element={gate('access:users', <UserAccess user={user} onChanged={(live: AccessEntry | null) => { if (live) setUser(live); }} />)} />
            <Route path="/venue-settings" element={gate('admin:venue-settings', <VenueSettings user={user} />)} />
            <Route path="*"         element={<Navigate to={home} replace />} />
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
