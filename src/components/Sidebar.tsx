import { NavLink } from 'react-router-dom';
import { APP_VERSION } from '@/lib/version';

import type { AccessEntry } from '@/lib/access';
import { navFor } from '@/lib/routes';
import { roleLabel } from '@/lib/permissions';

interface Props {
  user: AccessEntry;
  onSignOut: () => void;
}

/** v0.96: the links are the screens this person's permissions open (src/lib/routes.ts), by group. */
export function Sidebar({ user, onSignOut }: Props) {
  const userName = user.name;
  const userRole = user.role;
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-mark">kΩ</div>
        <div>
          <div className="sidebar-title">kΩunt</div>
          <div className="sidebar-sub">Keva Ops</div>
        </div>
      </div>

      {navFor(user).map(g => (
        <div key={g.group} style={{ display: 'contents' }}>
          <div className="sidebar-group-label">{g.group}</div>
          {g.items.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      <div style={{
        margin: '0 10px 12px',
        padding: '12px 16px',
        borderRadius: 12,
        background: 'rgba(255, 249, 245, 0.06)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{userName ?? '—'}</div>
        <div style={{ fontSize: 10, color: 'rgba(255, 249, 245, 0.55)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>
          {userRole ? roleLabel(userRole) : ''}
        </div>
        <button
          className="sidebar-link"
          style={{ marginTop: 10, margin: '10px 0 0', color: 'var(--raspberry-300)' }}
          onClick={onSignOut}
        >
          Sign out
        </button>
      </div>

      <div className="sidebar-footer">© Keva 2026 · v{APP_VERSION}</div>
    </aside>
  );
}
