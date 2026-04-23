import { useState } from 'react';
import { resolveAccess } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';

interface Props {
  onSignedIn: (user: AccessEntry) => void;
}

export function Login({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const hit = resolveAccess(email);
    if (!hit) { setErr('Access denied. Your email is not authorized.'); return; }
    if (hit.role === 'counter') {
      setErr('The desktop app is for managers and admins. Use the phone app.');
      return;
    }
    onSignedIn({ ...hit, name: name.trim() || hit.name });
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 3, color: 'var(--gold-300)', marginBottom: 8 }}>kΩunt</div>
        <h2>Desktop admin</h2>
        <div className="muted">Managers and admins only. Counters should use the phone app.</div>

        <label>Email</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@hwoodgroup.com" autoFocus />

        <label>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />

        {err && <div className="login-err">{err}</div>}
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
