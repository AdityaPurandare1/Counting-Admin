import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { VENUES } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountAvtReport, PurchaseItem } from '@/lib/types';
import { Pill, Eyebrow, Card, Num } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Venues screen (v0.9)

   A grid of venue cards, one per venue the signed-in user can see.
   Each card shows: active audit (if any, with join code + phase pill),
   last completed audit date, AVT last-upload date, item-master size.

   Corporate/managers use this as the at-a-glance dashboard before
   drilling into a specific audit via Variance or Summary.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

export function Venues({ user }: Props) {
  const nav = useNavigate();

  const visibleVenues = useMemo(() => {
    if (user.role === 'corporate' || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const [activeAudits,   setActiveAudits]   = useState<KountAudit[]>([]);
  const [latestByVenue,  setLatestByVenue]  = useState<Map<string, KountAudit>>(new Map());
  const [avtByVenue,     setAvtByVenue]     = useState<Map<string, KountAvtReport>>(new Map());
  const [itemCount,      setItemCount]      = useState<number | null>(null);

  const loadActive = useCallback(async () => {
    const { data } = await supabase.from('kount_audits').select('*').eq('status', 'active');
    setActiveAudits((data ?? []) as KountAudit[]);
  }, []);

  const loadHistoryMap = useCallback(async () => {
    // Grab the last 40 completed audits and pick the first per venue (they're ordered desc)
    const { data } = await supabase
      .from('kount_audits')
      .select('*')
      .in('status', ['submitted', 'cancelled'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(80);
    const map = new Map<string, KountAudit>();
    for (const row of (data ?? []) as KountAudit[]) {
      if (!map.has(row.venue_id)) map.set(row.venue_id, row);
    }
    setLatestByVenue(map);
  }, []);

  const loadAvt = useCallback(async () => {
    const { data } = await supabase
      .from('kount_avt_reports')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(40);
    const map = new Map<string, KountAvtReport>();
    for (const row of (data ?? []) as KountAvtReport[]) {
      for (const vid of (row.venue_ids ?? [])) {
        if (!map.has(vid)) map.set(vid, row);
      }
    }
    setAvtByVenue(map);
  }, []);

  const loadItemCount = useCallback(async () => {
    const { count } = await supabase
      .from('purchase_items')
      .select('id', { head: true, count: 'exact' }) as unknown as { count: number };
    setItemCount(typeof count === 'number' ? count : null);
  }, []);

  useEffect(() => { void loadActive();      }, [loadActive]);
  useEffect(() => { void loadHistoryMap();  }, [loadHistoryMap]);
  useEffect(() => { void loadAvt();         }, [loadAvt]);
  useEffect(() => { void loadItemCount();   }, [loadItemCount]);

  useEffect(() => {
    const ch = supabase
      .channel('venues-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_audits' }, () => { void loadActive(); void loadHistoryMap(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kount_avt_reports' }, () => { void loadAvt(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadActive, loadHistoryMap, loadAvt]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>Venues</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
            <Stat label="Active audits" value={activeAudits.length} />
            <Stat label="Venues"         value={visibleVenues.length} />
            {itemCount !== null && <Stat label="Catalog items" value={itemCount} />}
          </div>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {visibleVenues.map(v => {
            const active = activeAudits.find(a => a.venue_id === v.id);
            const latest = latestByVenue.get(v.id);
            const avt    = avtByVenue.get(v.id);
            return (
              <VenueCard
                key={v.id}
                name={v.name}
                active={active}
                latest={latest}
                avt={avt}
                onOpenActive={() => active && nav(`/variance?audit=${active.id}`)}
                onOpenLatest={() => latest && nav(`/summary?audit=${latest.id}`)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function VenueCard({
  name, active, latest, avt, onOpenActive, onOpenLatest,
}: {
  name: string;
  active?: KountAudit;
  latest?: KountAudit;
  avt?: KountAvtReport;
  onOpenActive: () => void;
  onOpenLatest: () => void;
}) {
  return (
    <Card padding={0} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.005em' }}>{name}</div>
            {!active && !latest && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>No audit history yet</div>}
          </div>
          {active && <Pill tone={active.count_phase === 'count1' ? 'gold' : active.count_phase === 'review' ? 'inform' : 'positive'} size="sm">{active.count_phase}</Pill>}
        </div>
      </div>

      {active ? (
        <button onClick={onOpenActive} style={{
          padding: 14, textAlign: 'left', border: 'none', cursor: 'pointer',
          background: 'var(--amethyst-100)', borderBottom: '1px solid var(--border)', fontFamily: 'inherit',
        }}>
          <Eyebrow>Active audit</Eyebrow>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent-bg)', letterSpacing: 2 }}>{active.join_code}</span>
            <span>·</span>
            <span style={{ color: 'var(--fg-muted)' }}>{active.started_by_name || active.started_by_email}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
            started {new Date(active.started_at).toLocaleString()}
          </div>
        </button>
      ) : latest ? (
        <button onClick={onOpenLatest} style={{
          padding: 14, textAlign: 'left', border: 'none', cursor: 'pointer', background: 'transparent',
          borderBottom: '1px solid var(--border)', fontFamily: 'inherit',
        }}>
          <Eyebrow>Last audit</Eyebrow>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
            {latest.completed_at ? new Date(latest.completed_at).toLocaleDateString() : '—'}
            <span style={{ marginLeft: 8 }}>
              <Pill tone={latest.status === 'cancelled' ? 'critical' : 'positive'} size="sm">{latest.status}</Pill>
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1 }}>
            {latest.join_code}
          </div>
        </button>
      ) : null}

      <div style={{ padding: 14, fontSize: 12, color: 'var(--fg-muted)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>AVT last uploaded</span>
          <span style={{ fontWeight: 500, color: avt ? 'var(--fg-primary)' : undefined }}>
            {avt ? new Date(avt.uploaded_at).toLocaleDateString() : '—'}
          </span>
        </div>
        {avt && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--fg-muted)' }}>
            {avt.row_count} row{avt.row_count === 1 ? '' : 's'} · by {avt.uploaded_by_name || avt.uploaded_by_email}
          </div>
        )}
      </div>
    </Card>
  );
}
