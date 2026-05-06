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

// Slow down brute-force / enumeration attempts from the same browser session.
const FAIL_LOCK_MS  = 15_000;
const FAIL_LOCK_AT  = 5;

export function Login({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

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

    setBusy(true);

    // Phase 3 dual-path (mirrors the phone app's handleLogin):
    //   1. If a password was typed, try Supabase Auth first. Success
    //      gives us a real JWT — that's what authorizes admin-user-mgmt
    //      Edge Function calls and what RLS will gate on after Phase 4.
    //   2. On invalid-credentials AND no legacy fallback, surface the
    //      auth error. On invalid-credentials but legacy IS available,
    //      fall back (handles "muscle memory typed a password they
    //      don't have yet" without locking them out during transition).
    //   3. No password OR transient auth failure → legacy ACCESS_LIST
    //      path. Once Phase 5 migrates everyone, the legacy branch
    //      goes away.

    const legacyEntry = resolveAccess(normalized);

    let authedOk = false;
    let authInvalidCredentials = false;
    if (password) {
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
          // Network / 5xx — log and fall through to legacy.
          console.warn('[admin-auth] signInWithPassword transient error, trying legacy:', error);
        }
      } catch (e) {
        console.warn('[admin-auth] signInWithPassword threw, trying legacy:', e);
      }
    }

    setBusy(false);

    const fail = (msg: string) => {
      const next = fails + 1;
      setFails(next);
      if (next >= FAIL_LOCK_AT) {
        setLockedUntil(Date.now() + FAIL_LOCK_MS);
        setFails(0);
        setErr(`Too many failed attempts. Locked for ${FAIL_LOCK_MS / 1000}s.`);
      } else {
        setErr(msg);
      }
    };

    // If auth said "invalid" AND we have no legacy fallback, surface the
    // real error. If a legacy candidate exists for this email, fall
    // through to legacy (the typed password was just confused muscle
    // memory).
    if (authInvalidCredentials && !legacyEntry) {
      return fail('Email or password incorrect. If you do not have a password yet, ask another admin for an invite.');
    }

    let resolved: AccessEntry | null = null;
    if (authedOk) {
      // Authoritative role/venue lookup from the live app_users table.
      // The legacy ACCESS_LIST cache is informational at this point.
      await refreshAccessList();
      resolved = resolveAccess(normalized);
      if (!resolved) {
        await supabase.auth.signOut().catch(() => {});
        return fail('Signed in but no app profile found. Ask another admin to set your role.');
      }
    } else {
      resolved = legacyEntry;
    }

    if (!resolved) {
      return fail('Access denied. Your email is not authorized.');
    }
    if (resolved.role === 'counter') {
      // Sign out the auth session too if we created one — counters do
      // not belong here regardless of how they got in.
      if (authedOk) await supabase.auth.signOut().catch(() => {});
      return fail('The desktop app is for managers and admins. Use the phone app.');
    }

    // Use the canonical name from app_users — never the user's typed value.
    // This keeps audit columns (added_by_name, etc.) tamper-resistant.
    setFails(0);
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
