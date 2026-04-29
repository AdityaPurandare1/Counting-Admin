import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { refreshVenues } from '@/lib/access';
import { refreshVenueLookups } from '@/lib/venueMap';
import type { AccessEntry } from '@/lib/access';
import type { VenueRow } from '@/lib/types';
import { Card, Btn, Pill, Eyebrow } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Venue settings (v0.28)

   Corporate-only CRUD over public.venues. Replaces the four hardcoded
   venue lists that used to live in:
     - phone counting-app.html appState.venues
     - admin lib/access.ts VENUES const
     - admin lib/venueMap.ts STORE_MAP
     - admin lib/venueMap.ts DEFAULT_VENUE_ZONES
   The venues table (migration 0013) is now the single source of truth
   and changes here flow live to the phone via realtime.

   Design choices:
     - Soft delete via is_active=false (keeps historic audits resolvable)
     - Hard delete only via the explicit Delete button on inactive rows
       so admin has to take two deliberate steps to drop a venue with FK
       references behind it. Same race-guarded pattern as Summary.tsx
       Delete (eq is_active=false on the DELETE).
     - default_zones + store_aliases are array editors (one-per-line
       textarea) so admin can paste in bulk without per-row form clicks.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

export function VenueSettings({ user }: Props) {
  const [rows, setRows] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<VenueRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kount_venues')
      .select('*')
      .order('ordinal')
      .order('name');
    setLoading(false);
    if (error) { console.error('[venues] load', error); return; }
    setRows((data ?? []) as VenueRow[]);
    // Repopulate the in-memory caches consumers use
    void refreshVenues();
    void refreshVenueLookups();
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Realtime: any insert/update/delete on venues bumps the local list +
     the in-memory caches. Channel name uses a single fixed identifier
     (multiple admin tabs each get their own subscription anyway). */
  useEffect(() => {
    const ch = supabase
      .channel('venues-admin-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_venues' }, () => {
        void load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // Router gate redundancy — App.tsx route already enforces this, but
  // keep the in-screen check as defense in depth in case someone deep-
  // links a tab that survived a role demotion.
  if (user.role !== 'corporate') {
    return (
      <>
        <div className="topbar"><div><div className="eyebrow">Venue settings</div><h1>Manage venues</h1></div></div>
        <div className="content"><div className="placeholder">Corporate admins only.</div></div>
      </>
    );
  }

  const visible = showInactive ? rows : rows.filter(r => r.is_active);
  const activeCount   = rows.filter(r => r.is_active).length;
  const inactiveCount = rows.length - activeCount;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Venue settings</div>
          <h1>Manage venues</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-muted)' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive ({inactiveCount})
          </label>
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
          <Btn variant="primary" size="sm" leading={Ic.plus(14)} onClick={() => setCreating(true)}>Add venue</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card padding={14}>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--fg-muted)' }}>
            <span>{activeCount} active venues</span>
            <span>·</span>
            <span>Changes flow live to the phone app and the admin pickers within a render tick.</span>
          </div>
        </Card>

        <Card padding={16}>
          {loading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
          {!loading && visible.length === 0 && (
            <div style={{ color: 'var(--fg-muted)' }}>
              {rows.length === 0
                ? <>No venues yet. Apply <code>0013_venues.sql</code> in the Supabase SQL editor, or click "Add venue" to seed one.</>
                : 'No active venues. Toggle "Show inactive" to see soft-deleted rows.'}
            </div>
          )}
          {!loading && visible.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={{ padding: '8px 6px', width: 60 }}>Order</th>
                  <th style={{ padding: '8px 6px', width: 60 }}>ID</th>
                  <th style={{ padding: '8px 6px' }}>Name</th>
                  <th style={{ padding: '8px 6px' }}>Address</th>
                  <th style={{ padding: '8px 6px', width: 70 }}>Zones</th>
                  <th style={{ padding: '8px 6px', width: 80 }}>Aliases</th>
                  <th style={{ padding: '8px 6px', width: 80 }}>Status</th>
                  <th style={{ padding: '8px 6px', width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--border)', opacity: v.is_active ? 1 : 0.55 }}>
                    <td style={{ padding: '10px 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--fg-muted)' }}>{v.ordinal}</td>
                    <td style={{ padding: '10px 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--accent-bg)', letterSpacing: 1 }}>{v.id}</td>
                    <td style={{ padding: '10px 6px', fontWeight: 600 }}>{v.name}</td>
                    <td style={{ padding: '10px 6px', color: 'var(--fg-muted)', fontSize: 12 }}>{v.address || '—'}</td>
                    <td style={{ padding: '10px 6px', fontSize: 12 }}>{v.default_zones?.length ?? 0}</td>
                    <td style={{ padding: '10px 6px', fontSize: 12 }}>{v.store_aliases?.length ?? 0}</td>
                    <td style={{ padding: '10px 6px' }}>
                      <Pill tone={v.is_active ? 'positive' : 'ghost'} size="sm">{v.is_active ? 'active' : 'inactive'}</Pill>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right' }}>
                      <Btn variant="ghost" size="sm" onClick={() => setEditing(v)}>Edit</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {creating && (
        <VenueFormModal
          mode="create"
          existingIds={new Set(rows.map(r => r.id))}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load(); }}
        />
      )}
      {editing && (
        <VenueFormModal
          mode="edit"
          initial={editing}
          existingIds={new Set(rows.map(r => r.id))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </>
  );
}

/* ────────── Add / edit modal ────────── */

function VenueFormModal({
  mode, initial, existingIds, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: VenueRow;
  existingIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Auto-suggest the next v<N> id for create mode by scanning existingIds
  // for the max v<digit> and adding 1. Admin can override the suggestion
  // — useful for non-numeric ids if the scheme ever needs to change.
  const suggestedId = mode === 'create'
    ? (() => {
        let max = 0;
        for (const id of existingIds) {
          const m = /^v(\d+)$/.exec(id);
          if (m) max = Math.max(max, parseInt(m[1], 10));
        }
        return 'v' + (max + 1);
      })()
    : initial!.id;

  const [id,            setId]            = useState(suggestedId);
  const [name,          setName]          = useState(initial?.name ?? '');
  const [address,       setAddress]       = useState(initial?.address ?? '');
  const [ordinal,       setOrdinal]       = useState<string>(String(initial?.ordinal ?? 100));
  const [defaultZones,  setDefaultZones]  = useState((initial?.default_zones ?? []).join('\n'));
  const [storeAliases,  setStoreAliases]  = useState((initial?.store_aliases ?? []).join('\n'));
  const [isActive,      setIsActive]      = useState<boolean>(initial?.is_active ?? true);
  const [busy,          setBusy]          = useState(false);
  const [err,           setErr]           = useState<string | null>(null);

  const parseList = (s: string) =>
    s.split('\n').map(line => line.trim()).filter(Boolean);

  const save = async () => {
    setErr(null);
    const idTrim = id.trim();
    if (!idTrim) { setErr('Venue id required (e.g. "v11")'); return; }
    if (!/^[a-z0-9_-]+$/i.test(idTrim)) { setErr('Venue id can only contain letters, digits, _ or -'); return; }
    if (mode === 'create' && existingIds.has(idTrim)) { setErr('Venue id "' + idTrim + '" already exists'); return; }
    if (!name.trim()) { setErr('Name required'); return; }
    const ord = parseInt(ordinal, 10);
    if (!Number.isFinite(ord)) { setErr('Order must be a number'); return; }

    setBusy(true);
    const payload = {
      id: idTrim,
      name: name.trim(),
      address: address.trim() || null,
      default_zones: parseList(defaultZones),
      // Aliases stored lowercase to match the runtime lookup key in
      // mapStoreToVenueId; admin can type in any case.
      store_aliases: parseList(storeAliases).map(a => a.toLowerCase()),
      ordinal: ord,
      is_active: isActive,
    };
    const q = mode === 'create'
      ? supabase.from('kount_venues').insert(payload).select().single()
      : supabase.from('kount_venues').update(payload).eq('id', initial!.id).select().single();
    const { error } = await q;
    setBusy(false);
    if (error) {
      // Migration 0013 is required before any of this works. Surface
      // a friendly hint if the table doesn't exist yet.
      if (/relation .*kount_venues.* does not exist/i.test(error.message)) {
        setErr('kount_venues table not found — apply migration 0013_venues.sql in the Supabase SQL editor.');
      } else {
        setErr(error.message);
      }
      return;
    }
    onSaved();
  };

  // Hard delete — only allowed on inactive venues so admin can't nuke a
  // live venue with audits behind it in one click. Race-guard via
  // .eq('is_active', false) so a parallel reactivate cancels the delete.
  const remove = async () => {
    if (!initial) return;
    if (initial.is_active) {
      alert('Set the venue inactive first (uncheck Active and Save), then Delete becomes available.');
      return;
    }
    if (!confirm(
      `Permanently delete venue "${initial.name}" (${initial.id})?\n\n` +
      'Audits, AVT rows, and app_users that reference this venue id will keep their text references but the venue itself will no longer resolve. Cannot be undone.'
    )) return;
    setBusy(true);
    // .select('id') so we can tell whether the row actually got deleted vs
    // RLS-filtered to zero (mirrors the Summary.tsx Sweep guard). A parallel
    // admin who reactivated the venue between confirm and delete trips the
    // is_active=false race guard; surface that instead of closing the modal
    // as if it succeeded.
    const { data, error } = await supabase
      .from('kount_venues')
      .delete()
      .eq('id', initial.id)
      .eq('is_active', false)
      .select('id');
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!data || data.length === 0) {
      setErr(
        'Delete returned 0 rows. Likely causes: (a) another admin reactivated this venue ' +
        'just now, or (b) the dev_venues_delete RLS policy on the venues table didn\'t apply. ' +
        'Refresh and try again.'
      );
      return;
    }
    onSaved();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(13,10,8,0.45)', zIndex: 60,
      display: 'grid', placeItems: 'center', padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 620, background: '#FFF',
        border: '1px solid var(--border)', borderRadius: 12, padding: 22,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <Eyebrow>{mode === 'create' ? 'Add venue' : 'Edit venue'}</Eyebrow>
        <h2 style={{ margin: '6px 0 14px', fontSize: 18 }}>{mode === 'create' ? 'New venue' : initial?.name}</h2>

        <Field label="Venue id">
          <input
            value={id}
            onChange={e => setId(e.target.value)}
            disabled={mode === 'edit'}
            placeholder="v11"
            style={fieldInput}
          />
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            {mode === 'create'
              ? 'Stable identifier (foreign-keyed by audits, AVT rows, user access). Convention: v<N>.'
              : 'Locked after creation — too many tables reference this string to safely rename.'}
          </div>
        </Field>

        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="The Birdstreet Club" style={fieldInput} />
        </Field>

        <Field label="Address">
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="8741 Sunset Blvd, West Hollywood" style={fieldInput} />
        </Field>

        <Field label="Display order">
          <input value={ordinal} onChange={e => setOrdinal(e.target.value)} placeholder="100" style={{ ...fieldInput, width: 100 }} />
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>Lower numbers come first in pickers.</div>
        </Field>

        <Field label="Default zones (one per line)">
          <textarea value={defaultZones} onChange={e => setDefaultZones(e.target.value)}
            rows={6} style={{ ...fieldInput, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            placeholder={'Main Bar\nBack Bar\nWalk-in Cooler\nDry Storage'}/>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            These are the zones the phone seeds the zone-tab list with on this venue. Counters can still add custom zones at audit time.
          </div>
        </Field>

        <Field label="Store aliases (Craftable AVT labels, one per line)">
          <textarea value={storeAliases} onChange={e => setStoreAliases(e.target.value)}
            rows={4} style={{ ...fieldInput, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            placeholder={'delilah la\ndelilah - la\ndelilah west hollywood'}/>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            Stored lowercase. Lets the AVT upload flow map Craftable's store-name spelling variants to this venue id.
          </div>
        </Field>

        <Field label="Status">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Active
          </label>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
            Inactive venues are hidden from new-audit pickers but stay queryable so historic audits keep resolving their venue name.
          </div>
        </Field>

        {err && <div style={{ color: 'var(--raspberry-300)', fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
          <div>
            {mode === 'edit' && !initial!.is_active && (
              <Btn variant="ghost" size="sm" onClick={() => void remove()} disabled={busy} style={{ color: 'var(--raspberry-300)' }}>Delete permanently</Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Btn>
            <Btn variant="primary"   size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
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
