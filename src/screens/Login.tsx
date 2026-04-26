import { useState } from 'react';
import { resolveAccessAsync } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';

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
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

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
    const hit = await resolveAccessAsync(normalized);
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

    if (!hit) return fail('Access denied. Your email is not authorized.');
    if (hit.role === 'counter') {
      return fail('The desktop app is for managers and admins. Use the phone app.');
    }
    // Use the canonical name from app_users — never the user's typed value.
    // This keeps audit columns (added_by_name, etc.) tamper-resistant.
    setFails(0);
    onSignedIn(hit);
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
          autoComplete="email"
          autoFocus
          required
        />

        {err && <div className="login-err">{err}</div>}
        <button type="submit" disabled={busy || Date.now() < lockedUntil}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
