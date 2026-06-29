import { useState } from 'react';
import { resolveAccess, refreshAccessList } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import { supabase } from '@/lib/supabase';

interface Props {
  onSignedIn: (user: AccessEntry) => void;
}

// RFC-5322 simplified: we only need to reject obvious garbage like trailing
// spaces, missing @, or empty domain. Server-side check (Supabase + the
// app_users PK) is the actual gate.
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Slow down brute-force / enumeration attempts. State lives in
// localStorage so a tab reload doesn't reset the counter — the previous
// in-memory-only implementation was trivially bypassable by Cmd-R.
const FAIL_LOCK_MS  = 15_000;
const FAIL_LOCK_AT  = 5;
const LOCK_STORAGE_KEY = 'kount_admin_login_fails_v1';

function loadLockState(): { fails: number; lockedUntil: number } {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return { fails: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as { fails?: number; lockedUntil?: number };
    const lockedUntil = Number(parsed.lockedUntil) || 0;
    // Expired lockout — wipe and start fresh.
    if (lockedUntil && Date.now() >= lockedUntil) return { fails: 0, lockedUntil: 0 };
    return { fails: Number(parsed.fails) || 0, lockedUntil };
  } catch { return { fails: 0, lockedUntil: 0 }; }
}

function saveLockState(fails: number, lockedUntil: number) {
  try { localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify({ fails, lockedUntil })); } catch { /* quota */ }
}

/** Sign out and verify it took. Falls back to local-scope signOut if the
 *  default (global) signOut errors — at minimum we want the local session
 *  storage cleared so the rejected user can't continue authenticated
 *  requests. Returns true if the session is gone, false if we couldn't
 *  confirm. */
async function safeSignOut(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.signOut();
    if (!error) return true;
    console.warn('[admin-auth] signOut(global) failed, retrying local:', error);
    try {
      const { error: localErr } = await supabase.auth.signOut({ scope: 'local' });
      return !localErr;
    } catch (e) {
      console.warn('[admin-auth] signOut(local) threw:', e);
      return false;
    }
  } catch (e) {
    console.warn('[admin-auth] signOut threw:', e);
    return false;
  }
}

export function Login({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const initialLock = loadLockState();
  const [fails, setFails] = useState(initialLock.fails);
  const [lockedUntil, setLockedUntil] = useState(initialLock.lockedUntil);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    if (Date.now() < lockedUntil) {
      const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
      setErr(`Too many failed attempts. Try again in ${wait}s.`);
      return;
    }

    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RX.test(normalized)) {
      setErr('Enter a valid email address.');
      return;
    }

    if (!password) {
      setErr('Password required. If you do not have one yet, tap "Email me a sign-in link" or "Forgot your password?" below.');
      return;
    }

    setBusy(true);

    // Single-path auth: Supabase Auth is the only way in. Role + venue
    // assignments come from app_users after sign-in succeeds. Users who
    // don't have a password yet recover via signInWithOtp (magic link)
    // or resetPasswordForEmail — both linked below this form.

    let authedOk = false;
    let authInvalidCredentials = false;
    let authTransientError = false;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });
      if (!error && data.user) {
        authedOk = true;
      } else if (error && /invalid login|invalid_credentials|invalid grant/i.test(error.message)) {
        authInvalidCredentials = true;
      } else if (error) {
        // Network / 5xx — surface as transient so the user knows to retry.
        console.warn('[admin-auth] signInWithPassword transient error:', error);
        authTransientError = true;
      }
    } catch (e) {
      console.warn('[admin-auth] signInWithPassword threw:', e);
      authTransientError = true;
    }

    setBusy(false);

    const fail = (msg: string) => {
      const next = fails + 1;
      if (next >= FAIL_LOCK_AT) {
        const newLockedUntil = Date.now() + FAIL_LOCK_MS;
        setLockedUntil(newLockedUntil);
        setFails(0);
        saveLockState(0, newLockedUntil);
        setErr(`Too many failed attempts. Locked for ${FAIL_LOCK_MS / 1000}s.`);
      } else {
        setFails(next);
        saveLockState(next, lockedUntil);
        setErr(msg);
      }
    };

    if (authTransientError) {
      return fail('Sign-in temporarily unavailable. Try again in a moment, or use "Email me a sign-in link".');
    }
    if (authInvalidCredentials) {
      return fail('Email or password incorrect. If you do not have a password yet, tap "Email me a sign-in link" or "Forgot your password?" below.');
    }
    if (!authedOk) {
      return fail('Sign-in failed. Try again, or use "Email me a sign-in link".');
    }

    // Authoritative role/venue lookup from the live app_users table.
    await refreshAccessList();
    const resolved: AccessEntry | null = resolveAccess(normalized);
    if (!resolved) {
      await safeSignOut();
      return fail('Signed in but no app profile found. Ask another admin to set your role.');
    }
    if (!['corporate', 'manager', 'venue_manager'].includes(resolved.role)) {
      // Counters (and any future non-desktop role) do not belong on the
      // desktop — invalidate the Supabase session before refusing entry.
      // If signOut fails we cannot just refuse and trust the UI gate; the
      // user would still hold a valid JWT good for direct RPC / Edge
      // Function calls. Surface a hard error telling them to close the tab
      // so the session expires naturally rather than letting them continue
      // with a leaked identity.
      const cleared = await safeSignOut();
      if (!cleared) {
        setErr('Sign-in could not be completed cleanly. Close this tab and try again.');
        return;
      }
      return fail('This app is for admins, managers, and venue management. Counters use the phone app.');
    }

    // Use the canonical name from app_users — never the user's typed value.
    // This keeps audit columns (added_by_name, etc.) tamper-resistant.
    setFails(0);
    saveLockState(0, 0);
    onSignedIn(resolved);
  }

  async function forgotPassword() {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RX.test(normalized)) {
      setErr('Type your email above first, then click Forgot password.');
      return;
    }
    setErr(null);
    try {
      // Vague success message either way — never disclose whether the
      // address has an account.
      await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: window.location.origin,
      });
    } catch (e) {
      console.warn('[admin-auth] resetPasswordForEmail threw:', e);
    }
    setInfo('If that email is registered, a reset link is on its way.');
  }

  async function magicLink() {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RX.test(normalized)) {
      setErr('Type your email above first, then click Email me a sign-in link.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      // shouldCreateUser:false because signups are disabled — only existing
      // app_users emails should work. Supabase still returns a generic
      // success either way (no account-existence leak), but this avoids
      // accidentally creating a stray auth.users row if Supabase's signup
      // policy ever changes.
      await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin,
        },
      });
    } catch (e) {
      console.warn('[admin-auth] signInWithOtp threw:', e);
    }
    setBusy(false);
    setInfo('If that email is registered, a sign-in link is on its way. Click it from the same browser to sign in.');
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 3, color: 'var(--gold-300)', marginBottom: 8 }}>kΩunt</div>
        <h2>Desktop admin</h2>
        <div className="muted">Managers and admins only. Counters should use the phone app.</div>

        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@hwoodgroup.com"
          autoComplete="username"
          autoFocus
          required
        />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
        />

        {err  && <div className="login-err">{err}</div>}
        {info && <div className="login-err" style={{ color: 'var(--fg-muted)' }}>{info}</div>}

        <button type="submit" disabled={busy || Date.now() < lockedUntil}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => void magicLink()}
          disabled={busy}
          style={{
            marginTop: 10, padding: '8px 12px',
            background: 'transparent', color: 'var(--gold-300)',
            border: '1px solid var(--gold-300)', borderRadius: 6,
            cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 500,
          }}
        >
          Email me a sign-in link instead
        </button>

        <button
          type="button"
          onClick={() => void forgotPassword()}
          style={{
            marginTop: 8, background: 'transparent', border: 'none',
            color: 'var(--gold-300)', cursor: 'pointer', fontSize: 12,
            padding: '6px 0', textDecoration: 'underline',
          }}
        >
          Forgot your password?
        </button>
      </form>
    </div>
  );
}
