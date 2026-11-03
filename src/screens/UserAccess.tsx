import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { VENUES, refreshAccessList, resolveAccess, type AccessEntry } from '@/lib/access';
import { PROJECTS, ROLES, roleLabel } from '@/lib/permissions';
import {
  accessChanges, accessDraft, accessProblems, allowedIn, noVenues, resetToRoles, setPrimary, toggleFeature, toggleRole, toggleVenue,
  type AccessDraft, type AccessRow,
} from '@/lib/userAccess';
import { adminUserMgmt } from '@/lib/adminUserMgmt';
import { Btn, Card, Pill } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   User access (v0.96) — one person at a time: their roles (one PRIMARY),
   the venues they see, and, project by project, each permission they have.
   Roles are templates: ticking a role adds its permissions; after that the
   ticks are the person's own. Saved through admin-user-mgmt (set_access).
   Users are added / disabled / deleted on Security.
   ─────────────────────────────────────────────────────────────────────── */

const muted: CSSProperties = { color: 'var(--fg-muted)' };
const label: CSSProperties = { fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 };

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{
      width: 16, height: 16, borderRadius: 8, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: on ? 'none' : '1.5px solid var(--border-strong)', background: on ? 'var(--positive, #3E8E5E)' : 'transparent',
    }}>{on && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2 4.1 7.2 8 3" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
  );
}

export function UserAccess({ user, onChanged }: { user: AccessEntry; onChanged?: (live: AccessEntry | null) => void }) {
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [email, setEmail] = useState('');
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const [project, setProject] = useState(PROJECTS[0].key);
  const [editRoles, setEditRoles] = useState(false);
  const [editFeatures, setEditFeatures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('app_users').select('email, name, role, roles, features, venue_ids, is_active').order('name');
    if (error) { setErr(error.message); return; }
    setRows((data ?? []) as AccessRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!email && rows.length) setEmail(rows.find(r => r.is_active)?.email ?? rows[0].email); }, [rows, email]);

  const row = rows.find(r => r.email === email) ?? null;
  const saved = useMemo(() => (row ? accessDraft(row) : null), [row]);
  useEffect(() => { setDraft(saved); setEditRoles(false); setEditFeatures(false); setNote(null); setErr(null); }, [saved]);

  if (!row || !draft || !saved) {
    return (
      <>
        <div className="topbar"><div><div className="eyebrow">Admin</div><h1>User access</h1></div></div>
        <div className="content"><Card padding={16}>{err ? <span style={{ color: 'var(--raspberry-400)' }}>{err}</span> : <span style={muted}>Loading…</span>}</Card></div>
      </>
    );
  }

  const self = row.email.toLowerCase() === user.email.toLowerCase();
  const changes = accessChanges(saved, draft);
  const problems = accessProblems(draft, self);
  const proj = PROJECTS.find(p => p.key === project) ?? PROJECTS[0];
  const shown = allowedIn(draft.features, proj.key);
  const allVenues = draft.features.includes('access:all-venues');

  const save = async () => {
    setSaving(true); setErr(null); setNote(null);
    try {
      await adminUserMgmt.setAccess({ email: row.email, role: draft.role, roles: draft.roles, features: draft.features, venue_ids: allVenues ? [] : draft.venueIds });
      await load();
      await refreshAccessList();
      if (self) onChanged?.(resolveAccess(user.email));
      setNote(`Saved — ${changes.join('; ')}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="topbar">
        <div><div className="eyebrow">Admin</div><h1>User access</h1></div>
        <div style={{ display: 'flex', gap: 8, marginRight: 56 }}>
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
          <Btn variant="ghost" size="sm" onClick={() => nav('/security')} title="Invite, disable or delete users (Security)">All users</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: changes.length ? 90 : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={email} onChange={e => setEmail(e.target.value)} aria-label="Person"
            style={{ font: 'inherit', fontSize: 15, fontWeight: 600, border: 'none', background: 'transparent', padding: '4px 2px', cursor: 'pointer' }}>
            {rows.map(r => <option key={r.email} value={r.email}>{r.name || r.email}{r.is_active ? '' : ' (disabled)'}</option>)}
          </select>
          <span style={{ ...muted, fontSize: 12.5 }}>{row.email}</span>
          {!row.is_active && <Pill tone="neutral" size="sm">Disabled</Pill>}
          {self && <Pill tone="inform" size="sm">You</Pill>}
        </div>

        {/* ── roles ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div><div style={label}>Roles</div><div style={{ ...muted, fontSize: 12.5, marginTop: 2 }}>{draft.roles.length} active</div></div>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => setEditRoles(v => !v)} style={{ border: 'none', background: 'none', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}>
              {editRoles ? 'Done' : 'Edit roles'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px 24px', marginTop: 12 }}>
            {ROLES.map(({ role }) => {
              const on = draft.roles.includes(role), primary = draft.role === role;
              return (
                <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: on || editRoles ? 1 : 0.6 }}>
                  <button type="button" disabled={!editRoles} onClick={() => setDraft(toggleRole(draft, role))} aria-pressed={on}
                    title={editRoles ? (on ? 'Remove this role (their permissions stay — untick them or Reset)' : 'Add this role and its permissions') : undefined}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', font: 'inherit', padding: 0, cursor: editRoles ? 'pointer' : 'default', color: 'inherit' }}>
                    <Check on={on} /><span style={{ fontWeight: on ? 600 : 400 }}>{roleLabel(role)}</span>
                  </button>
                  {primary && <span style={{ fontSize: 10, letterSpacing: '.08em', fontWeight: 700, color: 'var(--copper-400, #A0703A)' }}>PRIMARY</span>}
                  {editRoles && on && !primary && <button type="button" onClick={() => setDraft(setPrimary(draft, role))}
                    style={{ border: 'none', background: 'none', font: 'inherit', fontSize: 11.5, color: 'var(--fg-muted)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>make primary</button>}
                </div>
              );
            })}
          </div>
          {editRoles && <div style={{ ...muted, fontSize: 12, marginTop: 10 }}>
            Adding a role adds its permissions. Removing one keeps the person's permissions — untick them below, or{' '}
            <button type="button" onClick={() => setDraft(resetToRoles(draft))} style={{ border: 'none', background: 'none', font: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, color: 'inherit' }}>reset to exactly their roles</button>.
            The primary role is the one shown, and what the phone app reads for now.</div>}
        </section>

        {/* ── venues ── */}
        <section>
          <div style={label}>Venues</div>
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {allVenues ? <span>All venues <span style={{ ...muted, fontSize: 12.5 }}>— from the All venues permission (Access)</span></span>
              : VENUES.map(v => {
                const on = draft.venueIds.includes(v.id);
                return (
                  <button key={v.id} type="button" onClick={() => setDraft(toggleVenue(draft, v.id))} aria-pressed={on}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, font: 'inherit', fontSize: 12.5, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--fg-primary, #1F1A17)' : 'var(--border)'}`, background: on ? 'var(--off-200, #EFE7DF)' : 'transparent', color: 'inherit' }}>
                    <Check on={on} />{v.name}</button>
                );
              })}
          </div>
          {noVenues(draft) && <div style={{ color: 'var(--raspberry-400)', fontSize: 12.5, marginTop: 6 }}>No venue picked: their audit permissions see nothing until one is.</div>}
        </section>

        {/* ── projects / permissions ── */}
        <section style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 40, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...label, letterSpacing: 0, textTransform: 'none', fontSize: 12, fontWeight: 500 }}><span>Project</span><span>Allowed</span></div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
              {PROJECTS.map(p => {
                const a = allowedIn(draft.features, p.key);
                return (
                  <button key={p.key} type="button" onClick={() => setProject(p.key)} aria-pressed={p.key === proj.key}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', color: 'inherit',
                      fontWeight: p.key === proj.key ? 700 : 400 }}>
                    <span>{p.label}</span><span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>{a.n}/{a.m}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ ...muted, fontSize: 12 }}>{proj.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 650, marginTop: 2 }}>{row.name || row.email}</div>
                <div style={{ ...muted, fontSize: 13, marginTop: 2 }}>{roleLabel(draft.role)} · {shown.n} of {shown.m} features allowed</div>
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setEditFeatures(v => !v)} style={{ border: 'none', background: 'none', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}>{editFeatures ? 'Done' : 'Edit'}</button>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {proj.features.map(f => {
                const on = draft.features.includes(f.key), was = saved.features.includes(f.key);
                return (
                  <button key={f.key} type="button" disabled={!editFeatures} onClick={() => setDraft(toggleFeature(draft, f.key))} aria-pressed={on}
                    style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', padding: '8px 0', border: 'none', background: 'none', font: 'inherit', color: 'inherit',
                      cursor: editFeatures ? 'pointer' : 'default' }}>
                    <span style={{ marginTop: 2 }}><Check on={on} /></span>
                    <span>
                      <span style={{ fontWeight: on ? 600 : 400, color: on ? 'inherit' : 'var(--fg-secondary)' }}>{f.label}</span>
                      <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: 'var(--fg-muted)', marginLeft: 8 }}>{f.key}</span>
                      {on !== was && <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--copper-400, #A0703A)', fontWeight: 600 }}>{on ? 'added' : 'removed'}</span>}
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 1 }}>{f.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {proj.key === 'phone' && <div style={{ ...muted, fontSize: 12, marginTop: 8 }}>The counting app reads the primary role for now; these decide what the database lets them do at their venues.</div>}
          </div>
        </section>

        {err && <div style={{ color: 'var(--raspberry-400)' }}>{err}</div>}
        {note && <div style={{ color: 'var(--positive, #3E8E5E)' }}>{note}</div>}
      </div>

      {changes.length > 0 && (
        <div style={{ position: 'fixed', left: 260, right: 24, bottom: 18, zIndex: 20, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px',
          background: 'var(--surface, #fff)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-sm, 0 4px 16px rgba(0,0,0,.12))' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{changes.length} change{changes.length > 1 ? 's' : ''} for {row.name || row.email}</div>
            <div style={{ ...muted, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={changes.join('\n')}>{changes.join(' · ')}</div>
            {problems.map(p => <div key={p} style={{ color: 'var(--raspberry-400)', fontSize: 12.5 }}>{p}</div>)}
          </div>
          <Btn variant="ghost" size="sm" onClick={() => setDraft(saved)} disabled={saving}>Discard</Btn>
          <Btn variant="primary" size="sm" onClick={() => void save()} disabled={saving || problems.length > 0}>{saving ? 'Saving…' : 'Save'}</Btn>
        </div>
      )}
    </>
  );
}
