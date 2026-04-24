import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountRecount, Severity } from '@/lib/types';
import { Pill, SevChip, Card, Eyebrow, Btn, Money, Num } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Recount screen (v0.7)

   Reads public.kount_recounts for a selected audit and renders the list
   grouped by severity. Live via realtime on kount_recounts so the
   desktop sees counters' count2 submissions appear without a reload.

   Admin can dismiss a recount item (status='dismissed') — useful when
   the variance is known/explained and shouldn't gate audit close.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'WATCH', 'LOW'];

export function Recount({ user }: Props) {
  const [params, setParams] = useSearchParams();
  const auditParam = params.get('audit');

  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(auditParam);

  const filterVisible = useCallback((rows: KountAudit[]) => rows.filter(a => {
    if (user.role === 'corporate' || user.venueIds === 'all') return true;
    return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
  }), [user]);

  const loadAudits = useCallback(async () => {
    const { data, error } = await supabase
      .from('kount_audits')
      .select('*')
      .in('status', ['active', 'submitted'])
      .order('started_at', { ascending: false })
      .limit(30);
    if (error) { console.error('[recount] load audits', error); return; }
    setAudits(filterVisible((data ?? []) as KountAudit[]));
  }, [filterVisible]);

  useEffect(() => { void loadAudits(); }, [loadAudits]);

  useEffect(() => {
    const ch = supabase
      .channel('kount-audits-recount')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits' }, () => { void loadAudits(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAudits]);

  useEffect(() => {
    if (selectedId && selectedId !== auditParam) setParams({ audit: selectedId }, { replace: true });
  }, [selectedId, auditParam, setParams]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Recount handoff</div>
          <h1>Flagged items</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={selectedId ?? ''}
            onChange={e => setSelectedId(e.target.value || null)}
            style={{ padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, minWidth: 240 }}>
            <option value="">Select an audit…</option>
            {audits.map(a => (
              <option key={a.id} value={a.id}>
                {a.join_code} · {a.venue_name} · {a.status === 'submitted' ? 'submitted' : a.count_phase}
              </option>
            ))}
          </select>
          <Btn variant="secondary" size="sm" onClick={() => void loadAudits()}>Refresh</Btn>
        </div>
      </div>

      <div className="content">
        {!selectedId
          ? <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Pick an audit above to see its flagged items.</div></Card>
          : <RecountDetail auditId={selectedId} auditLabel={audits.find(a => a.id === selectedId)?.venue_name ?? ''} user={user} />}
      </div>
    </>
  );
}

/* ────────── Per-audit recount detail ────────── */

function RecountDetail({ auditId, auditLabel, user }: { auditId: string; auditLabel: string; user: AccessEntry }) {
  const [rows, setRows] = useState<KountRecount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kount_recounts')
      .select('*')
      .eq('audit_id', auditId)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) { console.error('[recount] load rows', error); return; }
    setRows((data ?? []) as KountRecount[]);
  }, [auditId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('kount-recounts-' + auditId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_recounts', filter: `audit_id=eq.${auditId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [auditId, load]);

  const dismiss = async (row: KountRecount) => {
    if (!confirm(`Dismiss ${row.item_name}?\n\nIt'll no longer block Count 2 close.`)) return;
    const { error } = await supabase
      .from('kount_recounts')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) alert('Dismiss failed: ' + error.message);
  };

  const grouped = useMemo(() => {
    const map = new Map<Severity, KountRecount[]>();
    for (const sev of SEVERITY_ORDER) map.set(sev, []);
    for (const r of rows) {
      const bucket = map.get(r.severity as Severity) ?? map.get('LOW')!;
      bucket.push(r);
    }
    return map;
  }, [rows]);

  const stats = useMemo(() => {
    let pending = 0, done = 0, dismissed = 0, totalVariance = 0;
    for (const r of rows) {
      if (r.status === 'pending')   pending++;
      if (r.status === 'done')      done++;
      if (r.status === 'dismissed') dismissed++;
      totalVariance += Number(r.variance_value ?? 0);
    }
    return { pending, done, dismissed, totalVariance };
  }, [rows]);

  if (loading) return <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Loading recount list…</div></Card>;
  if (rows.length === 0) return (
    <Card padding={24}>
      <div style={{ color: 'var(--fg-muted)' }}>
        No recount items for <strong>{auditLabel}</strong> yet.
        The list is generated when a manager closes Count 1 on the phone.
      </div>
    </Card>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary strip */}
      <Card padding={14}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <StatCell label="Flagged total" value={<Num value={rows.length} />} />
          <StatCell label="Pending"       value={<Num value={stats.pending} color={stats.pending ? 'var(--copper-300)' : undefined} />} />
          <StatCell label="Recounted"     value={<Num value={stats.done} color="var(--teal-300)" />} />
          <StatCell label="Net variance"  value={<Money value={stats.totalVariance} showSign />} />
        </div>
      </Card>

      {SEVERITY_ORDER.map(sev => {
        const bucket = grouped.get(sev) ?? [];
        if (bucket.length === 0) return null;
        return (
          <Card key={sev} padding={16}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <SevChip sev={sev.toLowerCase() as 'critical' | 'high' | 'medium' | 'watch' | 'low'} />
              <Eyebrow>{bucket.length} item{bucket.length === 1 ? '' : 's'}</Eyebrow>
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={{ padding: '4px 4px' }}>Item</th>
                  <th style={{ padding: '4px 4px' }}>Count 1</th>
                  <th style={{ padding: '4px 4px' }}>Count 2</th>
                  <th style={{ padding: '4px 4px' }}>Variance</th>
                  <th style={{ padding: '4px 4px' }}>Status</th>
                  {user.role === 'corporate' && <th />}
                </tr>
              </thead>
              <tbody>
                {bucket.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 500 }}>{r.item_name}</td>
                    <td style={{ padding: '8px 4px', fontFamily: 'JetBrains Mono, monospace' }}>
                      {r.count1_qty !== null ? Number(r.count1_qty).toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '8px 4px', fontFamily: 'JetBrains Mono, monospace', color: r.count2_qty !== null ? 'var(--teal-300)' : 'var(--fg-muted)' }}>
                      {r.count2_qty !== null ? Number(r.count2_qty).toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {r.variance_value !== null ? <Money value={Number(r.variance_value)} showSign size={12} /> : '—'}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <Pill tone={r.status === 'done' ? 'positive' : r.status === 'dismissed' ? 'ghost' : 'caution'} size="sm">
                        {r.status}
                      </Pill>
                    </td>
                    {user.role === 'corporate' && (
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        {r.status === 'pending' && (
                          <Btn variant="ghost" size="sm" leading={Ic.close(12)} onClick={() => void dismiss(r)}>Dismiss</Btn>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
