import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { UpcMapping } from '@/lib/types';
import { Btn, Card, Eyebrow, Pill } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   UPC approvals queue (desktop v0.11)

   Admin / manager review surface for pending upc_mappings rows. The
   phone app already queues submissions from counter+manager updates;
   this screen is where they get approved or rejected in bulk.

   Actions call the approve_upc_mapping / reject_upc_mapping RPCs that
   the phone already uses; they handle the status flip + trail + the
   purchase_items.upc copy server-side.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

export function Approvals({ user }: Props) {
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
    if (error) { console.error('[approvals] load', error); return; }
    setRows((data ?? []) as UpcMapping[]);
  }, []);

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
      <div className="topbar">
        <div>
          <div className="eyebrow">UPC approvals</div>
          <h1>Pending submissions</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pill tone={rows.length ? 'caution' : 'positive'} size="md">{rows.length} pending</Pill>
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        </div>
      </div>

      <div className="content">
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
      </div>
    </>
  );
}
