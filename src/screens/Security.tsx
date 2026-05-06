import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { VENUES, refreshAccessList } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { Role } from '@/lib/types';
import { Card, Btn, Pill, Eyebrow } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { adminUserMgmt, AdminFunctionError, type UpdateProfileArgs } from '@/lib/adminUserMgmt';

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
  const [migrating, setMigrating] = useState(false);

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
          <Btn variant="ghost" size="sm" onClick={() => setMigrating(true)}>Migrate legacy users</Btn>
          <Btn variant="primary" size="sm" leading={Ic.plus(14)} onClick={() => setCreating(true)}>Invite user</Btn>
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
      {migrating && <MigrateLegacyModal onClose={() => setMigrating(false)} />}
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
     vs. .single() which would 406 — we want a clean "no duplicate" path.
     v0.25: use ilike instead of eq so the dupe banner also fires when an
     existing app_users row has a different-case spelling of the same
     email (e.g. row stored as User@HWoodGroup.com vs. typed
     user@hwoodgroup.com). The save-path INSERT will still fail with
     23505 on case-only duplicates if the table has a citext / lower()
     unique index, but the banner gets a chance to catch it first. */
  const checkForDuplicate = async () => {
    if (mode !== 'create') return;
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim) { setDupeRow(null); return; }
    setCheckingDupe(true);
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .ilike('email', emailTrim)
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

    try {
      if (mode === 'create') {
        // Phase 3: invite via Edge Function. The user receives an email
        // with a link to set their own password — admin never picks it.
        // The function writes both auth.users + app_users in one shot
        // (with rollback if the second write fails).
        await adminUserMgmt.invite({
          email: emailTrim,
          name: name.trim() || undefined,
          role,
          venue_ids: role === 'corporate' ? [] : venueIds,
        });
        setBusy(false);
        onSaved();
        return;
      }

      // Edit mode: split the status flip from other field updates so the
      // auth ban toggles in lockstep with app_users.is_active. Without
      // this, deactivating someone in the form would only set the flag —
      // they could still authenticate via Supabase until the next role
      // recheck on the phone.
      if (isActive !== editingRow!.is_active) {
        await (isActive
          ? adminUserMgmt.enable(editingRow!.email)
          : adminUserMgmt.disable(editingRow!.email));
      }

      // Other-field changes go through update_profile. Skip the call
      // entirely if nothing changed (avoids a network round-trip when
      // the admin only flipped Status).
      const profileUpdate: UpdateProfileArgs = { email: editingRow!.email };
      let hasUpdate = false;
      const newName = name.trim() || null;
      if (newName !== (editingRow!.name ?? null)) {
        profileUpdate.name = newName ?? undefined;
        hasUpdate = true;
      }
      if (role !== editingRow!.role) {
        profileUpdate.role = role;
        hasUpdate = true;
      }
      const newVenueIds = role === 'corporate' ? [] : venueIds;
      const oldVenueIds = editingRow!.venue_ids ?? [];
      if (JSON.stringify(newVenueIds.slice().sort()) !== JSON.stringify(oldVenueIds.slice().sort())) {
        profileUpdate.venue_ids = newVenueIds;
        hasUpdate = true;
      }
      if (hasUpdate) {
        await adminUserMgmt.updateProfile(profileUpdate);
      }

      setBusy(false);
      onSaved();
    } catch (e) {
      setBusy(false);
      // 409 from invite means user already exists in auth — switch the
      // form to edit mode against the existing app_users row, mirroring
      // the prior 23505/duplicate-key handling.
      if (mode === 'create' && e instanceof AdminFunctionError && e.status === 409) {
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
      const msg = e instanceof AdminFunctionError ? e.detail : (e as Error).message;
      setErr(msg || 'Save failed');
    }
  };

  const remove = async () => {
    if (!editingRow) return;
    if (!confirm(`Delete ${editingRow.email}? This can't be undone — they'll lose access immediately.`)) return;
    setBusy(true);
    try {
      await adminUserMgmt.delete(editingRow.email);
      setBusy(false);
      onSaved();
    } catch (e) {
      setBusy(false);
      const msg = e instanceof AdminFunctionError ? e.detail : (e as Error).message;
      setErr(msg || 'Delete failed');
    }
  };

  const resetPassword = async () => {
    if (!editingRow) return;
    if (!confirm(`Send a password-reset email to ${editingRow.email}?`)) return;
    setBusy(true);
    try {
      const result = await adminUserMgmt.resetPassword(editingRow.email);
      setBusy(false);
      setErr(null);
      // Surface the action_link so admin can copy + send manually if
      // email delivery is flaky. The function emails it automatically
      // either way.
      const baseMsg = 'Reset email sent to ' + editingRow.email;
      if (result.action_link) {
        alert(baseMsg + '.\n\nIf they don\'t receive it, copy and send this link manually:\n\n' + result.action_link);
      } else {
        alert(baseMsg);
      }
    } catch (e) {
      setBusy(false);
      const msg = e instanceof AdminFunctionError ? e.detail : (e as Error).message;
      setErr(msg || 'Reset failed');
    }
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

        {mode === 'edit' && (
          <Field label="Status">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
            </label>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
              Toggling this also bans / un-bans the auth account so existing sessions invalidate within ~1 hour.
            </div>
          </Field>
        )}

        {err && <div style={{ color: 'var(--raspberry-300)', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'edit' && (
              <>
                <Btn variant="ghost" size="sm" onClick={remove} disabled={busy} style={{ color: 'var(--raspberry-300)' }}>Delete</Btn>
                <Btn variant="ghost" size="sm" onClick={resetPassword} disabled={busy}>Reset password</Btn>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn variant="primary"   size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : (mode === 'create' ? 'Send invite' : 'Save')}
            </Btn>
          </div>
        </div>

        {mode === 'create' && (
          <div style={{ marginTop: 12, padding: 10, fontSize: 11, color: 'var(--fg-muted)', background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 6 }}>
            Send invite emails the user a sign-up link. They pick their own password — admins never see or set it.
          </div>
        )}
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

/* ───────────────────────────────────────────────────────────────────────
   Phase 5: bulk-migrate legacy users
   One-shot tool that walks every active app_users row, finds the ones
   with no matching auth.users yet, and (after a confirmation step)
   sends each an invite email so they can set their password.
   Always runs a dry-run first so admin can confirm the candidate set.
   ─────────────────────────────────────────────────────────────────── */
function MigrateLegacyModal({ onClose }: { onClose: () => void }) {
  type Phase = 'loading' | 'preview' | 'applying' | 'done' | 'error';
  const [phase, setPhase] = useState<Phase>('loading');
  const [err, setErr] = useState<string | null>(null);

  // Preview shape (dry_run=true)
  const [preview, setPreview] = useState<{
    totalActive: number;
    alreadyAuthed: number;
    candidates: Array<{ email: string; name: string | null; role: string }>;
  } | null>(null);

  // Apply result (dry_run=false)
  const [applied, setApplied] = useState<{
    invited: number;
    failed: number;
    results: Array<{ email: string; ok: boolean; error?: string }>;
  } | null>(null);

  // Run the dry-run on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await adminUserMgmt.migrateLegacy({ dryRun: true });
        if (cancelled) return;
        setPreview({
          totalActive: res.total_active ?? 0,
          alreadyAuthed: res.already_authed ?? 0,
          candidates: res.would_invite ?? [],
        });
        setPhase('preview');
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof AdminFunctionError ? e.detail : (e as Error).message;
        setErr(msg || 'Dry-run failed');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const apply = async () => {
    setPhase('applying');
    setErr(null);
    try {
      const res = await adminUserMgmt.migrateLegacy({ dryRun: false });
      setApplied({
        invited: res.invited ?? 0,
        failed: res.failed ?? 0,
        results: res.results ?? [],
      });
      setPhase('done');
    } catch (e) {
      const msg = e instanceof AdminFunctionError ? e.detail : (e as Error).message;
      setErr(msg || 'Migration failed');
      setPhase('error');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(13,10,8,0.45)', zIndex: 60,
        display: 'grid', placeItems: 'center', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 600, maxHeight: '85vh', overflow: 'auto',
          background: '#FFF', border: '1px solid var(--border)',
          borderRadius: 12, padding: 22,
        }}
      >
        <Eyebrow>Migrate legacy users</Eyebrow>
        <h2 style={{ margin: '6px 0 14px', fontSize: 18 }}>Bulk invite to Supabase Auth</h2>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14 }}>
          Sends an invite email to every active app_user that doesn't yet have a Supabase Auth account.
          Each user will receive a "set your password" link. Safe to re-run — already-migrated users are skipped.
        </div>

        {phase === 'loading' && (
          <div style={{ padding: '20px 0', color: 'var(--fg-muted)' }}>Scanning app_users vs. auth.users…</div>
        )}

        {phase === 'preview' && preview && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, fontSize: 12 }}>
              <Pill tone="ink"      size="sm">{preview.totalActive} active</Pill>
              <Pill tone="positive" size="sm">{preview.alreadyAuthed} already migrated</Pill>
              <Pill tone="gold"     size="sm">{preview.candidates.length} to invite</Pill>
            </div>
            {preview.candidates.length === 0 ? (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--fg-muted)' }}>
                Everyone is already on Supabase Auth — nothing to do.
              </div>
            ) : (
              <div style={{
                maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)',
                borderRadius: 8, padding: 8, marginBottom: 14, fontSize: 12,
              }}>
                {preview.candidates.map(c => (
                  <div key={c.email} style={{ padding: '4px 6px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{c.email}</span>
                    <span style={{ color: 'var(--fg-muted)' }}>{c.name ?? '—'} · {c.role}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === 'applying' && (
          <div style={{ padding: '20px 0', color: 'var(--fg-muted)' }}>
            Sending invite emails… this can take ~1s per user.
          </div>
        )}

        {phase === 'done' && applied && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14, fontSize: 12 }}>
              <Pill tone="positive" size="sm">{applied.invited} invited</Pill>
              {applied.failed > 0 && <Pill tone="ghost" size="sm">{applied.failed} failed</Pill>}
            </div>
            <div style={{
              maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)',
              borderRadius: 8, padding: 8, marginBottom: 14, fontSize: 12,
            }}>
              {applied.results.map(r => (
                <div key={r.email} style={{ padding: '4px 6px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.email}</span>
                  <span style={{ color: r.ok ? 'var(--positive-300)' : 'var(--raspberry-300)' }}>
                    {r.ok ? 'invited' : (r.error || 'failed')}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {phase === 'error' && (
          <div style={{ padding: 12, color: 'var(--raspberry-300)', fontSize: 13 }}>
            {err || 'Unknown error'}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          {phase === 'preview' && preview && preview.candidates.length > 0 && (
            <Btn variant="primary" size="sm" onClick={() => void apply()}>
              Send {preview.candidates.length} invite{preview.candidates.length === 1 ? '' : 's'}
            </Btn>
          )}
          <Btn variant="secondary" size="sm" onClick={onClose}>
            {phase === 'done' || phase === 'error' || (phase === 'preview' && preview?.candidates.length === 0) ? 'Close' : 'Cancel'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
