import { NavLink } from 'react-router-dom';
import { APP_VERSION } from '@/lib/version';

const NAV_AUDIT = [
  { to: '/venues',   label: 'Venues' },
  { to: '/variance', label: 'Variance' },
  { to: '/recount',  label: 'Recount' },
  { to: '/summary',  label: 'Summary' },
];

const NAV_TEAM = [
  { to: '/issues', label: 'Issues tracker' },
  { to: '/ai',     label: 'Ask AI' },
];

const NAV_ADMIN = [
  { to: '/approvals', label: 'UPC approvals', manager: true  },
  { to: '/catalog',   label: 'Catalog',       manager: false },
  { to: '/security',  label: 'Security',      manager: false },
];

interface Props {
  userName?: string;
  userRole?: string;
  onSignOut: () => void;
}

export function Sidebar({ userName, userRole, onSignOut }: Props) {
  const isAdmin   = userRole === 'corporate';
  const isManager = userRole === 'manager';
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-mark">kΩ</div>
        <div>
          <div className="sidebar-title">kΩunt</div>
          <div className="sidebar-sub">H.Wood Ops</div>
        </div>
      </div>

      <div className="sidebar-group-label">Audit</div>
      {NAV_AUDIT.map(n => (
        <NavLink
          key={n.to}
          to={n.to}
          className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
        >
          {n.label}
        </NavLink>
      ))}

      <div className="sidebar-group-label">Team</div>
      {NAV_TEAM.map(n => (
        <NavLink
          key={n.to}
          to={n.to}
          className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
        >
          {n.label}
        </NavLink>
      ))}

      {(isAdmin || isManager) && (
        <>
          <div className="sidebar-group-label">Admin</div>
          {NAV_ADMIN.filter(n => isAdmin || (isManager && n.manager)).map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
            >
              {n.label}
            </NavLink>
          ))}
        </>
      )}

      <div style={{ flex: 1 }} />

      <div style={{
        margin: '0 10px 12px',
        padding: '12px 16px',
        borderRadius: 12,
        background: 'rgba(255, 249, 245, 0.06)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{userName ?? '—'}</div>
        <div style={{ fontSize: 10, color: 'rgba(255, 249, 245, 0.55)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>
          {userRole ?? ''}
        </div>
        <button
          className="sidebar-link"
          style={{ marginTop: 10, margin: '10px 0 0', color: 'var(--raspberry-300)' }}
          onClick={onSignOut}
        >
          Sign out
        </button>
      </div>

      <div className="sidebar-footer">© H.Wood Group 2026 · v{APP_VERSION}</div>
    </aside>
  );
}
