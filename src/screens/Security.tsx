import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { VENUES, refreshAccessList } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { Role } from '@/lib/types';
import { Card, Btn, Pill, Eyebrow } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Security screen (v0.5)
   Admin-only CRUD over public.app_users. Corporate can add/edit/delete
   any row; manager/counter never see this route (enforced by App.tsx).
   ─────────────────────────────────────────────────────────────────────── */

interface AppUserRow {
  email: string;
  name: string | null;
  role: Role;
  venue_ids: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Props { user: AccessEntry }

export function Security({ user }: Props) {
  const [rows, setRows] = useState<AppUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AppUserRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('app_users').select('*').order('role').order('email');
    setLoading(false);
    if (error) { console.error('[security] load', error); return; }
    setRows((data ?? []) as AppUserRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('app-users-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users' }, () => {
        void load();
        void refreshAccessList();  // keep the login cache aligned
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // Gate in case someone router-nav'd here with the wrong role
  if (user.role !== 'corporate') {
    return (
      <>
        <div className="topbar"><div><div className="eyebrow">Security</div><h1>Access control</h1></div></div>
        <div className="content"><div className="placeholder">Corporate admins only.</div></div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Security</div>
          <h1>Access control</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
          <Btn variant="primary" size="sm" leading={Ic.plus(14)} onClick={() => setCreating(true)}>Add user</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card padding={16}>
          {loading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
          {!loading && rows.length === 0 && (
            <div style={{ color: 'var(--fg-muted)' }}>
              No users yet. Apply <code>supabase/migrations/0003_app_users.sql</code> in the SQL editor, or click "Add user" to create one.
            </div>
          )}
          {!loading && rows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={{ padding: '8px 6px' }}>Email</th>
                  <th style={{ padding: '8px 6px' }}>Name</th>
                  <th style={{ padding: '8px 6px' }}>Role</th>
                  <th style={{ padding: '8px 6px' }}>Venues</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <UserRow key={r.email} row={r} onEdit={() => setEditing(r)} />)}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {creating && <UserFormModal mode="create" onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); void refreshAccessList(); }} />}
      {editing  && <UserFormModal mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); void refreshAccessList(); }} />}
    </>
  );
}

function UserRow({ row, onEdit }: { row: AppUserRow; onEdit: () => void }) {
  const venueLabel = useMemo(() => {
    if (row.role === 'corporate') return 'all';
    if (!row.venue_ids || row.venue_ids.length === 0) return '—';
    return row.venue_ids.map(id => VENUES.find(v => v.id === id)?.name ?? id).join(', ');
  }, [row.role, row.venue_ids]);

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '10px 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{row.email}</td>
      <td style={{ padding: '10px 6px', fontWeight: 500 }}>{row.name ?? '—'}</td>
      <td style={{ padding: '10px 6px' }}>
        <Pill tone={row.role === 'corporate' ? 'ink' : row.role === 'manager' ? 'gold' : 'neutral'} size="sm">{row.role}</Pill>
      </td>
      <td style={{ padding: '10px 6px', maxWidth: 360, fontSize: 12 }}>{venueLabel}</td>
      <td style={{ padding: '10px 6px' }}>
        <Pill tone={row.is_active ? 'positive' : 'ghost'} size="sm">{row.is_active ? 'active' : 'disabled'}</Pill>
      </td>
      <td style={{ padding: '10px 6px', textAlign: 'right' }}>
        <Btn variant="ghost" size="sm" onClick={onEdit}>Edit</Btn>
      </td>
    </tr>
  );
}

function UserFormModal({
  mode: initialMode, initial, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: AppUserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  // mode is mutable inside the modal so we can swap create→edit when the
  // user types an email that already exists. Otherwise the form would dead-
  // end with a raw Postgres "duplicate key" error and force them to close
  // and find the row in the underlying table — confusing for new admins.
  const [mode, setMode] = useState<'create' | 'edit'>(initialMode);
  const [editingRow, setEditingRow] = useState<AppUserRow | undefined>(initial);

  const [email, setEmail] = useState(initial?.email ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState<Role>(initial?.role ?? 'counter');
  const [venueIds, setVenueIds] = useState<string[]>(initial?.venue_ids ?? []);
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If the email being typed already exists in app_users, we capture the row
  // here and surface a banner with a "Edit instead" affordance. Cleared when
  // the user changes the email or successfully switches to edit mode.
  const [dupeRow, setDupeRow] = useState<AppUserRow | null>(null);
  const [checkingDupe, setCheckingDupe] = useState(false);

  const toggleVenue = (id: string) => {
    setVenueIds(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  };

  /* Pre-flight duplicate check fires when the email field loses focus
     during create mode. .maybeSingle() returns null when no row matches,
     vs. .single() which would 406 — we want a clean "no duplicate" path. */
  const checkForDuplicate = async () => {
    if (mode !== 'create') return;
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim) { setDupeRow(null); return; }
    setCheckingDupe(true);
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('email', emailTrim)
      .maybeSingle();
    setCheckingDupe(false);
    if (error) { console.warn('[security] dupe check', error); return; }
    setDupeRow((data as AppUserRow | null) ?? null);
  };

  /* Swap create→edit and pre-load every form field from the existing row.
     The submit handler reads `mode` and `editingRow` to UPDATE instead of
     INSERT; the banner stays mounted as a confirmation that we're now
     editing rather than creating a new row. */
  const switchToEdit = (row: AppUserRow) => {
    setMode('edit');
    setEditingRow(row);
    setEmail(row.email);
    setName(row.name ?? '');
    setRole(row.role);
    setVenueIds(row.venue_ids ?? []);
    setIsActive(row.is_active);
    setDupeRow(null);
    setErr(null);
  };

  const save = async () => {
    setErr(null);
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim) { setErr('Email required'); return; }
    setBusy(true);
    const payload = {
      email: emailTrim,
      name: name.trim() || null,
      role,
      venue_ids: role === 'corporate' ? [] : venueIds,
      is_active: isActive,
    };
    const q = mode === 'create'
      ? supabase.from('app_users').insert(payload).select().single()
      : supabase.from('app_users').update(payload).eq('email', editingRow!.email).select().single();
    const { error } = await q;
    setBusy(false);
    if (error) {
      // Race fallback: the pre-flight blur check might have missed (user
      // clicked Save without losing focus, or another admin inserted the
      // same email between our check and our INSERT). Catch the unique
      // violation, fetch the conflicting row, and surface the same banner.
      if (mode === 'create' && /23505|duplicate key|unique constraint/i.test(error.message)) {
        const { data: existing } = await supabase
          .from('app_users')
          .select('*')
          .eq('email', emailTrim)
          .maybeSingle();
        if (existing) {
          setDupeRow(existing as AppUserRow);
          setErr(null);
          return;
        }
      }
      setErr(error.message);
      return;
    }
    onSaved();
  };

  const remove = async () => {
    if (!editingRow) return;
    if (!confirm(`Delete ${editingRow.email}? This can't be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.from('app_users').delete().eq('email', editingRow.email);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(13,10,8,0.45)', zIndex: 60,
      display: 'grid', placeItems: 'center', padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 520, background: '#FFF',
        border: '1px solid var(--border)', borderRadius: 12, padding: 22,
      }}>
        <Eyebrow>{mode === 'create' ? 'Add user' : 'Edit user'}</Eyebrow>
        <h2 style={{ margin: '6px 0 14px', fontSize: 18 }}>{mode === 'create' ? 'New access entry' : editingRow?.email}</h2>

        <Field label="Email">
          <input
            value={email}
            onChange={e => { setEmail(e.target.value); setDupeRow(null); }}
            onBlur={() => void checkForDuplicate()}
            disabled={mode === 'edit'}
            placeholder="user@hwood.com"
            style={fieldInput}
          />
          {checkingDupe && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>Checking…</div>
          )}
        </Field>

        {dupeRow && mode === 'create' && (
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--copper-100)',
              border: '1px solid var(--copper-300)',
              borderRadius: 8,
              marginBottom: 12,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--copper-400)' }}>
                User already exists
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-secondary)', marginTop: 2 }}>
                <strong>{dupeRow.name ?? dupeRow.email}</strong>
                {' · '}
                <span style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10, fontWeight: 600 }}>{dupeRow.role}</span>
                {!dupeRow.is_active && <> · <span style={{ color: 'var(--raspberry-300)' }}>disabled</span></>}
              </div>
            </div>
            <Btn variant="primary" size="sm" onClick={() => switchToEdit(dupeRow)}>
              Edit instead
            </Btn>
          </div>
        )}
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" style={fieldInput} />
        </Field>
        <Field label="Role">
          <select value={role} onChange={e => setRole(e.target.value as Role)} style={fieldInput}>
            <option value="corporate">corporate (admin — all venues)</option>
            <option value="manager">manager</option>
            <option value="counter">counter</option>
          </select>
        </Field>

        {role !== 'corporate' && (
          <Field label="Venues">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {VENUES.map(v => {
                const on = venueIds.includes(v.id);
                return (
                  <button key={v.id} type="button" onClick={() => toggleVenue(v.id)} style={{
                    padding: '6px 10px', borderRadius: 999, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                    border: '1px solid ' + (on ? 'var(--dark-900)' : 'var(--border)'),
                    background: on ? 'var(--dark-900)' : '#FFF',
                    color: on ? 'var(--off-100)' : 'var(--fg-secondary)',
                  }}>{v.name}</button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Status">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
          </label>
        </Field>

        {err && <div style={{ color: 'var(--raspberry-300)', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
          <div>
            {mode === 'edit' && (
              <Btn variant="ghost" size="sm" onClick={remove} disabled={busy} style={{ color: 'var(--raspberry-300)' }}>Delete</Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn variant="primary"   size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldInput: React.CSSProperties = {
  width: '100%', padding: '9px 11px',
  border: '1px solid var(--border-strong)',
  borderRadius: 8, background: 'var(--canvas)',
  fontFamily: 'inherit', fontSize: 13,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 0.8,
        color: 'var(--fg-muted)', marginBottom: 6,
      }}>{label}</label>
      {children}
    </div>
  );
}
