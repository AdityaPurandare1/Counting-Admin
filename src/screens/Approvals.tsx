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
   rejects; the RPCs do the side effects (purchase_items.upc copy on UPC
   approve, mint a new purchase_items row on item approve) server-side.
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
  };

  /* Escape hatch: bypass the RPC and directly commit the mapping. Useful
     when approve_upc_mapping errors out (missing RPC, column drift, RLS
     on purchase_items update, etc.). Only corporate can use it. */
  const forceApprove = async (row: UpcMapping) => {
    if (user.role !== 'corporate') return;
    if (!confirm(`Force-approve ${row.barcode_raw} → ${row.item_name}?\n\nBypasses approve_upc_mapping RPC. Updates purchase_items.upc + marks upc_mappings row approved directly.`)) return;
    setBusyId(row.id);
    setLastError(null);
    try {
      if (row.purchase_item_id) {
        const { error: piErr } = await supabase
          .from('purchase_items')
          .update({ upc: row.barcode_raw })
          .eq('id', row.purchase_item_id);
        if (piErr) throw new Error('purchase_items update: ' + piErr.message);
      }
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

  /* Force-approve fallback: same shape as the UPC version. Bypasses the RPC
     and writes purchase_items + kount_pending_items directly. Use if the
     approve_pending_item function isn't deployed yet, or RLS gets weird. */
  const forceApprove = async (row: KountPendingItem) => {
    if (user.role !== 'corporate') return;
    if (!confirm(`Force-approve "${row.name}"?\n\nBypasses approve_pending_item RPC. Inserts a purchase_items row and marks the pending row approved directly.`)) return;
    setBusyId(row.id);
    setLastError(null);
    try {
      const { data: created, error: piErr } = await supabase
        .from('purchase_items')
        .insert({
          name:        row.name,
          brand:       row.brand,
          category:    row.category,
          subcategory: row.subcategory,
          upc:         row.upc,
          size:        row.size,
        })
        .select()
        .single();
      if (piErr || !created) throw new Error('purchase_items insert: ' + (piErr?.message ?? 'no row'));
      const newId = (created as { id: string }).id;
      const { error: pendErr } = await supabase
        .from('kount_pending_items')
        .update({
          status: 'approved',
          reviewed_by_email: user.email,
          reviewed_by_name:  user.name,
          reviewed_at: new Date().toISOString(),
          purchase_item_id: newId,
        })
        .eq('id', row.id);
      if (pendErr) throw new Error('kount_pending_items update: ' + pendErr.message);
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
            If the RPC isn't deployed yet, corporate admins can use <strong>Force approve</strong> to insert the purchase_items row directly.
          </div>
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Pill tone={rows.length ? 'caution' : 'positive'} size="md">{rows.length} pending item{rows.length === 1 ? '' : 's'}</Pill>
        <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          Approving inserts a row into <code>purchase_items</code> and links it back via <code>purchase_item_id</code>.
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
                          <Btn variant="ghost" size="sm" onClick={() => void forceApprove(r)} disabled={busyId === r.id} title="Skip the RPC and insert into purchase_items directly. Use if Approve errors out.">Force</Btn>
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
