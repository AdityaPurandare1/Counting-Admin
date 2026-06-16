import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { UpcMapping, KountPendingItem } from '@/lib/types';
import { Btn, Card, Eyebrow, Pill, Segment } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Approvals queue (desktop v0.17)

   Two queues, side-by-side under one screen:
     1. UPCs       — pending upc_mappings rows         (RPC approve_upc_mapping)
     2. New items  — pending kount_pending_items rows  (RPC approve_pending_item)

   The phone app submits to either queue. Admin / manager approves or
   rejects; the RPCs do the side effects (insert master_item_upcs on UPC
   approve, mint a new master_items row on item approve) server-side.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

type Tab = 'upcs' | 'items';

export function Approvals({ user }: Props) {
  const [tab, setTab] = useState<Tab>('upcs');
  const [upcCount, setUpcCount]   = useState(0);
  const [itemCount, setItemCount] = useState(0);

  // Tab badges have to stay live regardless of which tab is mounted —
  // previously each subqueue ran its own subscription only while visible,
  // so switching to one tab silently froze the other badge until you
  // clicked back. Subscribe at the parent for both tables; the active
  // queue keeps its own subscription too (via realtime fan-out the count
  // there is updated by `load()` returning the data, so this parent-level
  // count just polls quickly when something changes).
  const refreshUpcCount = useCallback(async () => {
    const { count } = await supabase
      .from('upc_mappings')
      .select('id', { head: true, count: 'exact' })
      .eq('status', 'pending') as unknown as { count: number };
    if (typeof count === 'number') setUpcCount(count);
  }, []);
  const refreshItemCount = useCallback(async () => {
    const { count } = await supabase
      .from('kount_pending_items')
      .select('id', { head: true, count: 'exact' })
      .eq('status', 'pending') as unknown as { count: number };
    if (typeof count === 'number') setItemCount(count);
  }, []);

  useEffect(() => { void refreshUpcCount(); void refreshItemCount(); }, [refreshUpcCount, refreshItemCount]);

  useEffect(() => {
    const ch = supabase
      .channel('approvals-tab-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'upc_mappings' },     () => { void refreshUpcCount(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_pending_items' }, () => { void refreshItemCount(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refreshUpcCount, refreshItemCount]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Approvals queue</div>
          <h1>Pending submissions</h1>
        </div>
        <div style={{ minWidth: 380 }}>
          <Segment<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'upcs',  label: `UPCs (${upcCount})` },
              { value: 'items', label: `New items (${itemCount})` },
            ]}
          />
        </div>
      </div>

      <div className="content">
        {tab === 'upcs'
          ? <UpcQueue user={user} onCount={setUpcCount} />
          : <ItemQueue user={user} onCount={setItemCount} />}
      </div>
    </>
  );
}

/* ────────── UPC queue (was the entire old screen) ────────── */

function UpcQueue({ user, onCount }: { user: AccessEntry; onCount: (n: number) => void }) {
  const canAct = user.role === 'corporate' || user.role === 'manager';

  const [rows, setRows] = useState<UpcMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('upc_mappings')
      .select('*')
      .eq('status', 'pending')
      .order('id', { ascending: true });
    setLoading(false);
    if (error) { console.error('[approvals] upc load', error); return; }
    const list = (data ?? []) as UpcMapping[];
    setRows(list);
    onCount(list.length);
  }, [onCount]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('upc-approvals-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'upc_mappings' }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const act = async (row: UpcMapping, approve: boolean) => {
    if (!canAct) return;
    setBusyId(row.id);
    setLastError(null);
    const rpc = approve ? 'approve_upc_mapping' : 'reject_upc_mapping';
    const { data, error } = await supabase.rpc(rpc, {
      p_mapping_id: row.id,
      p_admin_email: user.email,
      p_admin_name:  user.name,
      ...(approve ? {} : { p_reason: null }),
    });
    setBusyId(null);
    if (error || (data && (data as { ok?: boolean }).ok === false)) {
      const msg = (data && (data as { error?: string }).error) || error?.message || 'unknown error';
      setLastError(`${approve ? 'Approve' : 'Reject'} via ${rpc} RPC failed for ${row.barcode_raw} → ${row.item_name}: ${msg}`);
      console.warn('[approvals] RPC failed:', { rpc, row, data, error });
      return;
    }
    // Optimistic removal: without this, the only feedback the admin gets is
    // the row disappearing via realtime — and realtime's 2 events/sec cap
    // can throttle, leaving the admin staring at a row that "didn't
    // respond" and re-clicking. Realtime will reconcile naturally.
    const nextRows = rows.filter(r => r.id !== row.id);
    setRows(nextRows);
    onCount(nextRows.length);
  };

  /* Escape hatch: bypass the RPC and directly commit the mapping. Useful
     when approve_upc_mapping errors out (missing RPC, column drift, etc.).
     Only corporate can use it.

     Post Path B: writes to master_item_upcs instead of touching
     purchase_items.upc. The mapping must have a master_item_id (set
     either by the phone at submit time or by an admin in the regular
     approve path). */
  const forceApprove = async (row: UpcMapping) => {
    if (user.role !== 'corporate') return;
    if (!row.master_item_id) {
      alert(
        `Force-approve requires a master_item_id on the mapping row.\n\n` +
        `This row has none — use the regular Approve button, which will let ` +
        `the RPC do name-fallback resolution.`
      );
      return;
    }

    const newNorm = (row.barcode_raw || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!newNorm) {
      alert('Barcode has no digits — cannot link.');
      return;
    }

    // Check master_item_upcs for an existing owner of this UPC. If
    // another master already owns it, the unique index would block our
    // insert — surface the conflict to the admin first.
    let existingOwnerName: string | null = null;
    {
      const { data: existing } = await supabase
        .from('master_item_upcs')
        .select('master_item_id,master_items(name)')
        .eq('upc_normalized', newNorm)
        .maybeSingle();
      if (existing) {
        const o = existing as unknown as { master_item_id: string; master_items: { name: string } | null };
        if (o.master_item_id && o.master_item_id !== row.master_item_id) {
          existingOwnerName = (o.master_items && o.master_items.name) || o.master_item_id;
        }
      }
    }

    const overwriteWarning = existingOwnerName
      ? `\n\n⚠️ UPC ${row.barcode_raw} is currently linked to "${existingOwnerName}". Force-approve will MOVE the link to "${row.item_name}".\nCounters scanning the original bottle will start hitting the new item.`
      : '';
    if (!confirm(
      `Force-approve ${row.barcode_raw} → ${row.item_name}?${overwriteWarning}\n\n` +
      `Bypasses approve_upc_mapping RPC. Writes master_item_upcs + marks upc_mappings row approved directly.`
    )) return;

    setBusyId(row.id);
    setLastError(null);
    try {
      // If another master owns the UPC, delete the existing row first to
      // avoid the unique-index conflict on our insert. Abort on failure —
      // proceeding would leave the barcode linked to the old master while
      // the mapping row claims it was moved.
      if (existingOwnerName) {
        const { error: delErr } = await supabase.from('master_item_upcs').delete().eq('upc_normalized', newNorm);
        if (delErr) throw new Error(`could not unlink UPC from "${existingOwnerName}": ${delErr.message} — nothing was changed`);
      }
      const { error: miuErr } = await supabase
        .from('master_item_upcs')
        .insert({
          master_item_id: row.master_item_id,
          upc_raw:        row.barcode_raw,
          upc_normalized: newNorm,
          source:         'admin_force_approve',
          notes:          'Force-approved by ' + user.email + ' via Approvals',
          added_by_email: user.email,
        });
      if (miuErr) throw new Error('master_item_upcs insert: ' + miuErr.message);

      const { error: mapErr } = await supabase
        .from('upc_mappings')
        .update({
          status: 'approved',
          reviewed_by_email: user.email,
          reviewed_by_name:  user.name,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (mapErr) throw new Error('upc_mappings update: ' + mapErr.message);
    } catch (e: unknown) {
      const msg = (e as Error).message || 'unknown error';
      setLastError('Force-approve failed: ' + msg);
      console.warn('[approvals] force-approve failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {lastError && (
        <Card padding={14} style={{ marginBottom: 12, borderColor: 'var(--raspberry-300)', background: 'var(--raspberry-100)' }}>
          <Eyebrow>Last error</Eyebrow>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--raspberry-400)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap' }}>
            {lastError}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
            If the RPC itself is the problem, corporate admins can use <strong>Force approve</strong> to skip it and commit directly.
          </div>
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Pill tone={rows.length ? 'caution' : 'positive'} size="md">{rows.length} pending UPC{rows.length === 1 ? '' : 's'}</Pill>
        <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
      </div>
      <Card padding={16}>
        {loading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ color: 'var(--fg-muted)' }}>No pending UPC submissions right now.</div>
        )}
        {!loading && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                <th style={{ padding: '6px 4px' }}>Barcode</th>
                <th style={{ padding: '6px 4px' }}>Item</th>
                <th style={{ padding: '6px 4px' }}>Category</th>
                <th style={{ padding: '6px 4px' }}>Submitted by</th>
                <th style={{ padding: '6px 4px', width: 220 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 4px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                    {r.barcode_raw}
                  </td>
                  <td style={{ padding: '10px 4px' }}>
                    <div style={{ fontWeight: 500 }}>{r.item_name}</div>
                    {r.item_brand && <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{r.item_brand}</div>}
                  </td>
                  <td style={{ padding: '10px 4px', color: 'var(--fg-muted)' }}>
                    {r.item_category ?? '—'}
                  </td>
                  <td style={{ padding: '10px 4px', fontSize: 12, color: 'var(--fg-muted)' }}>
                    <div>{r.submitted_by_name ?? r.submitted_by_email}</div>
                    <div style={{ fontSize: 10 }}>{r.submitted_by_email}</div>
                  </td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>
                    {canAct ? (
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Btn variant="positive" size="sm" leading={Ic.check(12)} onClick={() => void act(r, true)}  disabled={busyId === r.id}>Approve</Btn>
                        <Btn variant="critical" size="sm" leading={Ic.close(12)} onClick={() => void act(r, false)} disabled={busyId === r.id}>Reject</Btn>
                        {user.role === 'corporate' && (
                          <Btn variant="ghost" size="sm" onClick={() => void forceApprove(r)} disabled={busyId === r.id} title="Skip the RPC and commit the mapping directly. Use if Approve errors out.">Force</Btn>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>read-only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/* ────────── Pending-item queue (new) ────────── */

function ItemQueue({ user, onCount }: { user: AccessEntry; onCount: (n: number) => void }) {
  const canAct = user.role === 'corporate' || user.role === 'manager';

  const [rows, setRows] = useState<KountPendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kount_pending_items')
      .select('*')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true });
    setLoading(false);
    if (error) { console.error('[approvals] item load', error); return; }
    const list = (data ?? []) as KountPendingItem[];
    setRows(list);
    onCount(list.length);
  }, [onCount]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('item-approvals-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_pending_items' }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const approve = async (row: KountPendingItem) => {
    if (!canAct) return;
    setBusyId(row.id);
    setLastError(null);
    const { data, error } = await supabase.rpc('approve_pending_item', {
      p_pending_id:  row.id,
      p_admin_email: user.email,
      p_admin_name:  user.name,
    });
    setBusyId(null);
    if (error || (data && (data as { ok?: boolean }).ok === false)) {
      const msg = (data && (data as { error?: string }).error) || error?.message || 'unknown error';
      setLastError(`Approve "${row.name}" via approve_pending_item RPC failed: ${msg}`);
      return;
    }
  };

  const reject = async (row: KountPendingItem) => {
    if (!canAct) return;
    const reason = prompt(`Reject "${row.name}"?\n\nOptional reason (shown in audit log):`);
    if (reason === null) return; // cancel
    setBusyId(row.id);
    setLastError(null);
    const { data, error } = await supabase.rpc('reject_pending_item', {
      p_pending_id:  row.id,
      p_admin_email: user.email,
      p_admin_name:  user.name,
      p_reason:      reason || null,
    });
    setBusyId(null);
    if (error || (data && (data as { ok?: boolean }).ok === false)) {
      const msg = (data && (data as { error?: string }).error) || error?.message || 'unknown error';
      setLastError(`Reject "${row.name}" via reject_pending_item RPC failed: ${msg}`);
      return;
    }
  };

  /* Force-approve fallback: bypasses the RPC and writes master_items +
     kount_pending_items directly. Use if approve_pending_item is broken
     or you want to verify a specific schema state. Post Path B the new
     catalog row is created in master_items (purchase_items is procurement-
     only now). Name is composed from brand + name + size to match the
     existing master_items convention. */
  const forceApprove = async (row: KountPendingItem) => {
    if (user.role !== 'corporate') return;
    if (!confirm(`Force-approve "${row.name}"?\n\nBypasses approve_pending_item RPC. Inserts a master_items row and marks the pending row approved directly.`)) return;
    setBusyId(row.id);
    setLastError(null);
    try {
      // Compose the display name the same way the RPC would
      const composedName = [row.brand, row.name, row.size]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Parse size text into base_size + base_unit (best-effort)
      let baseSize: number | null = null;
      let baseUnit: string | null = null;
      const m = (row.size || '').match(/^\s*(\d+(?:\.\d+)?)\s*(ml|cl|l|oz|each|ea)\s*$/i);
      if (m) {
        baseSize = Number(m[1]);
        baseUnit = m[2].toLowerCase();
        if (baseUnit === 'cl') { baseSize = baseSize * 10; baseUnit = 'ml'; }
      }

      const { data: created, error: miErr } = await supabase
        .from('master_items')
        .insert({
          name:        composedName,
          category:    row.category,
          subcategory: row.subcategory,
          base_size:   baseSize,
          base_unit:   baseUnit,
          is_active:   true,
        })
        .select()
        .single();
      if (miErr || !created) throw new Error('master_items insert: ' + (miErr?.message ?? 'no row'));
      const newMasterId = (created as { id: string }).id;

      // If the pending row carried a UPC, attach it to the new master.
      // A failure here doesn't roll back the approval (the master_items row
      // already exists and is the thing being approved), but it must be
      // surfaced — a silently dropped UPC means the barcode scans to
      // nothing and nobody knows why.
      let upcAttachError: string | null = null;
      const upcNorm = (row.upc || '').replace(/\D/g, '').replace(/^0+/, '');
      if (upcNorm) {
        const { error: upcErr } = await supabase.from('master_item_upcs').insert({
          master_item_id: newMasterId,
          upc_raw:        row.upc,
          upc_normalized: upcNorm,
          source:         'admin_force_approve_pending',
          notes:          'From kount_pending_items via Approvals force-approve',
          added_by_email: user.email,
        });
        if (upcErr) {
          console.warn('[approvals] master_item_upcs insert failed (continuing):', upcErr);
          upcAttachError = upcErr.message;
        }
      }

      const { error: pendErr } = await supabase
        .from('kount_pending_items')
        .update({
          status: 'approved',
          reviewed_by_email: user.email,
          reviewed_by_name:  user.name,
          reviewed_at: new Date().toISOString(),
          master_item_id: newMasterId,
        })
        .eq('id', row.id);
      if (pendErr) throw new Error('kount_pending_items update: ' + pendErr.message);

      if (upcAttachError) {
        setLastError(
          `"${row.name}" was approved (master_items row created), BUT UPC ${row.upc} ` +
          `could not be attached: ${upcAttachError}. Link it manually from Counts → Link UPC.`
        );
      }
    } catch (e: unknown) {
      const msg = (e as Error).message || 'unknown error';
      setLastError('Force-approve failed: ' + msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {lastError && (
        <Card padding={14} style={{ marginBottom: 12, borderColor: 'var(--raspberry-300)', background: 'var(--raspberry-100)' }}>
          <Eyebrow>Last error</Eyebrow>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--raspberry-400)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap' }}>
            {lastError}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
            If the RPC isn't deployed yet, corporate admins can use <strong>Force approve</strong> to insert the master_items row directly.
          </div>
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Pill tone={rows.length ? 'caution' : 'positive'} size="md">{rows.length} pending item{rows.length === 1 ? '' : 's'}</Pill>
        <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          Approving mints a row in <code>master_items</code> and links the pending row back via <code>master_item_id</code>.
        </span>
      </div>
      <Card padding={16}>
        {loading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ color: 'var(--fg-muted)' }}>No pending item submissions right now.</div>
        )}
        {!loading && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                <th style={{ padding: '6px 4px' }}>Item</th>
                <th style={{ padding: '6px 4px' }}>Category</th>
                <th style={{ padding: '6px 4px' }}>UPC</th>
                <th style={{ padding: '6px 4px' }}>Submitted by</th>
                <th style={{ padding: '6px 4px' }}>When</th>
                <th style={{ padding: '6px 4px', width: 220 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 4px' }}>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                      {[r.brand, r.size, r.subcategory].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {r.notes && (
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4, fontStyle: 'italic' }}>
                        “{r.notes}”
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 4px', color: 'var(--fg-muted)' }}>{r.category ?? '—'}</td>
                  <td style={{ padding: '10px 4px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: r.upc ? 'var(--fg-primary)' : 'var(--fg-faint)' }}>
                    {r.upc || '—'}
                  </td>
                  <td style={{ padding: '10px 4px', fontSize: 12, color: 'var(--fg-muted)' }}>
                    <div>{r.submitted_by_name ?? r.submitted_by_email}</div>
                    <div style={{ fontSize: 10 }}>{r.submitted_by_email}</div>
                  </td>
                  <td style={{ padding: '10px 4px', fontSize: 11, color: 'var(--fg-muted)' }}>
                    {new Date(r.submitted_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>
                    {canAct ? (
                      <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Btn variant="positive" size="sm" leading={Ic.check(12)} onClick={() => void approve(r)} disabled={busyId === r.id}>Approve</Btn>
                        <Btn variant="critical" size="sm" leading={Ic.close(12)} onClick={() => void reject(r)}  disabled={busyId === r.id}>Reject</Btn>
                        {user.role === 'corporate' && (
                          <Btn variant="ghost" size="sm" onClick={() => void forceApprove(r)} disabled={busyId === r.id} title="Skip the RPC and insert into master_items directly. Use if Approve errors out.">Force</Btn>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>read-only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
