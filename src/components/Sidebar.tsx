import { NavLink } from 'react-router-dom';
import { APP_VERSION } from '@/lib/version';

// `runAudits` rows are hidden from counters: their routes are gated on
// canRunAudits and would just redirect.
const NAV_AUDIT: Array<{ to: string; label: string; runAudits?: boolean }> = [
  { to: '/overview', label: 'Overview', runAudits: true },
  { to: '/venues',   label: 'Venues' },
  { to: '/variance', label: 'Variance' },
  { to: '/item-history', label: 'Item history', runAudits: true },
  { to: '/counts',   label: 'Counts' },
  { to: '/recount',  label: 'Recount' },
  { to: '/summary',  label: 'Summary' },
];

const NAV_TEAM = [
  { to: '/issues', label: 'Issues tracker' },
  { to: '/ai',     label: 'Ask AI' },
];

// `viewer` rows are the only Admin-group links a venue_manager (read-only
// "Venue Management" role) may see. All other rows stay admin/manager-gated.
const NAV_ADMIN = [
  { to: '/approvals',      label: 'Approvals',      manager: true,  viewer: true  },
  { to: '/stock',          label: 'Stock on hand',  manager: true,  viewer: true  },
  { to: '/reports',        label: 'Reports',        manager: true,  viewer: true  },
  { to: '/inventory',      label: 'Inventory',      manager: false, viewer: false },
  { to: '/catalog',        label: 'Catalog',        manager: false, viewer: false },
  { to: '/venue-settings', label: 'Venue settings', manager: false, viewer: false },
  { to: '/security',       label: 'Security',       manager: false, viewer: false, adminOnly: true },
];

const ROLE_LABELS: Record<string, string> = {
  corporate:     'Corporate',
  admin:         'Admin',
  manager:       'Manager',
  counter:       'Counter',
  venue_manager: 'Venue Management',
};

interface Props {
  userName?: string;
  userRole?: string;
  onSignOut: () => void;
}

export function Sidebar({ userName, userRole, onSignOut }: Props) {
  const isPlatformAdmin = userRole === 'admin';
  const isAdmin    = userRole === 'admin' || userRole === 'corporate';
  const isManager  = userRole === 'manager';
  const isVenueMgr = userRole === 'venue_manager';
  // The GM tier runs counts now, so /counts is a live link for it.
  const auditLinks = NAV_AUDIT.filter(n => !(n.runAudits && userRole === 'counter'));
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-mark">kΩ</div>
        <div>
          <div className="sidebar-title">kΩunt</div>
          <div className="sidebar-sub">Keva Ops</div>
        </div>
      </div>

      <div className="sidebar-group-label">Audit</div>
      {auditLinks.map(n => (
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

      {(isAdmin || isManager || isVenueMgr) && (
        <>
          <div className="sidebar-group-label">Admin</div>
          {NAV_ADMIN.filter(n => (n.adminOnly ? isPlatformAdmin : isAdmin) || (isManager && n.manager) || (isVenueMgr && n.viewer)).map(n => (
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
          {userRole ? (ROLE_LABELS[userRole] ?? userRole) : ''}
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
