import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountEntry, KountMember } from '@/lib/types';
import { Pill, Eyebrow, Card, Btn, Num, Avatar } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Summary screen (v0.8)

   Historic audit browser. Lists submitted + cancelled audits filtered
   by venue access; opens any one for a full breakdown of zones,
   members, counter activity, and CSV export of the entries.

   Read-only: no lifecycle mutations live here. Variance is where you
   close or cancel an active audit.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

export function Summary({ user }: Props) {
  const [params, setParams] = useSearchParams();
  const auditParam = params.get('audit');

  const [audits, setAudits] = useState<KountAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(auditParam);
  const [venueFilter, setVenueFilter] = useState<string>('');

  const filterVisible = useCallback((rows: KountAudit[]) => rows.filter(a => {
    if (user.role === 'corporate' || user.venueIds === 'all') return true;
    return Array.isArray(user.venueIds) && user.venueIds.includes(a.venue_id);
  }), [user]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kount_audits')
      .select('*')
      .in('status', ['submitted', 'cancelled'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(200);
    setLoading(false);
    if (error) { console.error('[summary] load', error); return; }
    setAudits(filterVisible((data ?? []) as KountAudit[]));
  }, [filterVisible]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selectedId && selectedId !== auditParam) setParams({ audit: selectedId }, { replace: true });
  }, [selectedId, auditParam, setParams]);

  const venues = useMemo(() => {
    const set = new Set(audits.map(a => a.venue_id));
    return Array.from(set).sort();
  }, [audits]);

  const filtered = useMemo(() =>
    venueFilter ? audits.filter(a => a.venue_id === venueFilter) : audits,
    [audits, venueFilter],
  );

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Audit summary</div>
          <h1>Historic audits</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={venueFilter}
            onChange={e => setVenueFilter(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }}>
            <option value="">All venues</option>
            {venues.map(v => {
              const name = audits.find(a => a.venue_id === v)?.venue_name ?? v;
              return <option key={v} value={v}>{name}</option>;
            })}
          </select>
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        <aside>
          <Eyebrow style={{ marginBottom: 8 }}>{filtered.length} audit{filtered.length === 1 ? '' : 's'}</Eyebrow>
          {loading && <Card padding={14}><div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>Loading…</div></Card>}
          {!loading && filtered.length === 0 && (
            <Card padding={14}>
              <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                {audits.length === 0 ? 'No historic audits yet — close an audit on the phone or the Variance screen to see it here.' : 'No audits match the venue filter.'}
              </div>
            </Card>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(a => <SummaryListItem key={a.id} audit={a} selected={selectedId === a.id} onOpen={() => setSelectedId(a.id)} />)}
          </div>
        </aside>

        <section>
          {selectedId
            ? <SummaryDetail auditId={selectedId} />
            : <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Pick an audit on the left to see its full breakdown.</div></Card>}
        </section>
      </div>
    </>
  );
}

function SummaryListItem({ audit, selected, onOpen }: { audit: KountAudit; selected: boolean; onOpen: () => void }) {
  const ended = audit.completed_at ? new Date(audit.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: 'left', padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border)',
        background: selected ? 'var(--amethyst-100)' : 'var(--off-200)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 2, color: 'var(--accent-bg)', fontSize: 14 }}>{audit.join_code}</span>
        <Pill tone={audit.status === 'cancelled' ? 'critical' : 'positive'} size="sm">{audit.status}</Pill>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{audit.venue_name}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
        ended {ended} · {audit.started_by_name || audit.started_by_email}
      </div>
    </button>
  );
}

/* ────────── Per-audit summary detail ────────── */

function SummaryDetail({ auditId }: { auditId: string }) {
  const [audit, setAudit]     = useState<KountAudit | null>(null);
  const [entries, setEntries] = useState<KountEntry[]>([]);
  const [members, setMembers] = useState<KountMember[]>([]);

  const load = useCallback(async () => {
    const [{ data: a }, { data: e }, { data: m }] = await Promise.all([
      supabase.from('kount_audits').select('*').eq('id', auditId).single(),
      supabase.from('kount_entries').select('*').eq('audit_id', auditId).order('timestamp', { ascending: true }),
      supabase.from('kount_members').select('*').eq('audit_id', auditId),
    ]);
    setAudit((a as KountAudit) ?? null);
    setEntries((e as KountEntry[]) ?? []);
    setMembers((m as KountMember[]) ?? []);
  }, [auditId]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const totalEntries = entries.length;
    const totalQty = entries.reduce((s, r) => s + Number(r.qty || 0), 0);
    const byZone = new Map<string, { items: number; qty: number; counters: Set<string> }>();
    const byCounter = new Map<string, number>();
    const byMethod: Record<string, number> = { barcode: 0, photo: 0, manual: 0, guided: 0, quick: 0, recount: 0, other: 0 };
    const issues = entries.filter(r => r.issue && r.issue !== 'none').length;
    for (const r of entries) {
      const zone = r.zone;
      const bucket = byZone.get(zone) ?? { items: 0, qty: 0, counters: new Set<string>() };
      bucket.items += 1;
      bucket.qty   += Number(r.qty || 0);
      bucket.counters.add(r.counted_by_name || r.counted_by_email);
      byZone.set(zone, bucket);
      const who = r.counted_by_name || r.counted_by_email;
      byCounter.set(who, (byCounter.get(who) ?? 0) + 1);
      const m = (r.method && byMethod[r.method] !== undefined) ? r.method : 'other';
      byMethod[m] += 1;
    }
    const durationMin = audit?.started_at && audit?.completed_at
      ? Math.max(0, Math.round((new Date(audit.completed_at).getTime() - new Date(audit.started_at).getTime()) / 60_000))
      : null;
    return { totalEntries, totalQty, byZone, byCounter, byMethod, issues, durationMin };
  }, [entries, audit]);

  const exportCsv = () => {
    if (!audit) return;
    const rows: string[][] = [
      ['zone','item_name','qty','method','issue','issue_notes','counted_by','timestamp','is_recount'],
      ...entries.map(r => [
        r.zone, r.item_name, String(r.qty), r.method ?? '', r.issue ?? '', r.issue_notes ?? '',
        r.counted_by_name || r.counted_by_email, r.timestamp, String(r.is_recount),
      ]),
    ];
    const csv = rows.map(row => row.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_${audit.join_code}_${audit.venue_name.replace(/\s+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!audit) return <Card padding={24}><div style={{ color: 'var(--fg-muted)' }}>Loading audit…</div></Card>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card padding={18}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <Eyebrow>{audit.status}</Eyebrow>
            <div style={{ font: 'var(--text-headline-md)', marginTop: 4 }}>
              {audit.venue_name} · <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-bg)', letterSpacing: 2 }}>{audit.join_code}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
              started {new Date(audit.started_at).toLocaleString()}
              {audit.completed_at && <> · ended {new Date(audit.completed_at).toLocaleString()}</>}
              {stats.durationMin != null && <> · {stats.durationMin} min total</>}
              · by {audit.started_by_name || audit.started_by_email}
            </div>
          </div>
          <Btn variant="secondary" size="sm" leading={Ic.download(14)} onClick={exportCsv}>Export CSV</Btn>
        </div>
      </Card>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatTile label="Entries"         value={<Num value={stats.totalEntries} />} />
        <StatTile label="Total qty"       value={<Num value={stats.totalQty} />} />
        <StatTile label="Counters"        value={<Num value={stats.byCounter.size} />} />
        <StatTile label="Issues flagged"  value={<Num value={stats.issues} color={stats.issues ? 'var(--raspberry-300)' : undefined} />} />
      </div>

      {/* By zone */}
      <Card padding={16}>
        <Eyebrow>By zone</Eyebrow>
        {stats.byZone.size === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 8 }}>No entries.</div>}
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 10 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              <th style={{ padding: '4px 4px' }}>Zone</th>
              <th style={{ padding: '4px 4px' }}>Items</th>
              <th style={{ padding: '4px 4px' }}>Qty</th>
              <th style={{ padding: '4px 4px' }}>Counters</th>
            </tr>
          </thead>
          <tbody>
            {[...stats.byZone.entries()].sort((a, b) => b[1].items - a[1].items).map(([zone, b]) => (
              <tr key={zone} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 4px' }}>{zone}</td>
                <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{b.items}</td>
                <td style={{ padding: '6px 4px', fontFamily: 'JetBrains Mono, monospace' }}>{b.qty.toFixed(1)}</td>
                <td style={{ padding: '6px 4px', color: 'var(--fg-muted)', fontSize: 11 }}>{[...b.counters].join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* By counter */}
      <Card padding={16}>
        <Eyebrow>By counter</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {members.length === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>No members recorded.</div>}
          {members.map(m => {
            const who = m.user_name || m.user_email;
            const count = stats.byCounter.get(who) ?? 0;
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--off-200)', borderRadius: 9999 }}>
                <Avatar name={who} size={24} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{who}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{m.role} · {count} entries</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Method breakdown */}
      <Card padding={16}>
        <Eyebrow>Capture method</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginTop: 10 }}>
          {Object.entries(stats.byMethod).filter(([, v]) => v > 0).map(([k, v]) => (
            <div key={k} style={{ padding: 10, background: 'var(--off-200)', borderRadius: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)', fontWeight: 600 }}>{k}</div>
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card padding={14}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </Card>
  );
}
