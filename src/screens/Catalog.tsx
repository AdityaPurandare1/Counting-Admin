import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, selectAllPaged } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { PurchaseItem } from '@/lib/types';
import { Btn, Card, Eyebrow, Pill, Segment } from '@/components/atoms';
import { Ic } from '@/components/Icons';

/* ───────────────────────────────────────────────────────────────────────
   Catalog screen (desktop v0.13)

   Admin (corporate) surface for curating which purchase_items rows are
   actively carried. Scanning and searching in the phone app narrows to
   this set when it's non-empty, so a bar counter doesn't have to pick
   the right Campari row from ten near-duplicates.

   Data sources:
     - public.purchase_items (full catalog, read-only here)
     - public.kount_carried_items (this screen's target — insert to add,
       delete to remove). Realtime channel keeps the toggle state live
       across devices.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

const PAGE_SIZE = 50;

type FilterChoice = 'all' | 'carried' | 'uncarried';

export function Catalog({ user }: Props) {
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [carried, setCarried] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterChoice>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  // --- Initial load: full catalog + current carried set ---
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [cat, carr] = await Promise.all([
      selectAllPaged<PurchaseItem>('purchase_items', 'id,name,brand,category,subcategory,upc,sku', 'name'),
      supabase.from('kount_carried_items').select('purchase_item_id'),
    ]);
    setItems(cat);
    const carrSet = new Set<string>();
    for (const row of (carr.data ?? []) as Array<{ purchase_item_id: string }>) {
      carrSet.add(row.purchase_item_id);
    }
    setCarried(carrSet);
    setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Realtime on kount_carried_items so another admin's toggles land here live
  useEffect(() => {
    const ch = supabase
      .channel('kount-carried-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kount_carried_items' }, (evt) => {
        const row = (evt.new || evt.old) as { purchase_item_id?: string } | undefined;
        if (!row?.purchase_item_id) return;
        setCarried(prev => {
          const next = new Set(prev);
          if (evt.eventType === 'DELETE') next.delete(row.purchase_item_id!);
          else next.add(row.purchase_item_id!);
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      if (filter === 'carried'   && !carried.has(item.id)) return false;
      if (filter === 'uncarried' &&  carried.has(item.id)) return false;
      if (q) {
        const hay = (item.name + ' ' + (item.brand || '') + ' ' + (item.upc || '') + ' ' + (item.sku || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, carried, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { if (page >= totalPages) setPage(0); }, [page, totalPages]);

  // Gate at the UI level; the router also redirects non-corporate away
  if (user.role !== 'corporate') {
    return (
      <>
        <div className="topbar"><div><div className="eyebrow">Catalog</div><h1>Carried items</h1></div></div>
        <div className="content"><div className="placeholder">Corporate admins only.</div></div>
      </>
    );
  }

  const toggle = async (item: PurchaseItem) => {
    if (busyId) return;
    setBusyId(item.id);
    const isOn = carried.has(item.id);
    // Optimistic local update
    setCarried(prev => {
      const next = new Set(prev);
      if (isOn) next.delete(item.id); else next.add(item.id);
      return next;
    });
    try {
      if (isOn) {
        const { error } = await supabase.from('kount_carried_items').delete().eq('purchase_item_id', item.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('kount_carried_items').insert({
          purchase_item_id: item.id,
          added_by_email: user.email,
          added_by_name: user.name,
        });
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      // Revert on failure
      setCarried(prev => {
        const next = new Set(prev);
        if (isOn) next.add(item.id); else next.delete(item.id);
        return next;
      });
      alert('Toggle failed: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Catalog</div>
          <h1>Carried items</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pill tone="gold"     size="md">{carried.size} carried</Pill>
          <Pill tone="ghost"    size="md">{items.length} catalog rows</Pill>
          <Btn variant="secondary" size="sm" onClick={() => void loadAll()}>Refresh</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card padding={14}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search name, brand, UPC, SKU…"
              style={{
                flex: 1, minWidth: 260, padding: '8px 12px',
                border: '1px solid var(--border-strong)', borderRadius: 8,
                fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <div style={{ minWidth: 300 }}>
              <Segment<FilterChoice>
                value={filter}
                onChange={v => { setFilter(v); setPage(0); }}
                options={[
                  { value: 'all',        label: 'All' },
                  { value: 'carried',    label: 'Carried' },
                  { value: 'uncarried',  label: 'Not carried' },
                ]}
              />
            </div>
            <Eyebrow>{filtered.length} match{filtered.length === 1 ? '' : 'es'}</Eyebrow>
          </div>
        </Card>

        <Card padding={0}>
          {loading && <div style={{ color: 'var(--fg-muted)', padding: 24 }}>Loading catalog…</div>}
          {!loading && pageItems.length === 0 && (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>No rows match. Clear the search or switch the filter to "All".</div>
          )}
          {!loading && pageItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 14px', width: 80 }}>Carried</th>
                  <th style={{ padding: '10px 14px' }}>Name</th>
                  <th style={{ padding: '10px 14px' }}>Brand</th>
                  <th style={{ padding: '10px 14px' }}>Category</th>
                  <th style={{ padding: '10px 14px' }}>UPC</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(item => {
                  const on = carried.has(item.id);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: on ? 'var(--teal-100)' : undefined }}>
                      <td style={{ padding: '8px 14px' }}>
                        <button
                          onClick={() => void toggle(item)}
                          disabled={busyId === item.id}
                          style={{
                            width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
                            border: '1px solid ' + (on ? 'var(--teal-300)' : 'var(--border-strong)'),
                            background: on ? 'var(--teal-300)' : '#FFF',
                            color: '#FFF', display: 'grid', placeItems: 'center',
                          }}
                          title={on ? 'Remove from carried' : 'Mark as carried'}
                        >
                          {on ? Ic.check(14) : ''}
                        </button>
                      </td>
                      <td style={{ padding: '8px 14px', fontWeight: 500 }}>{item.name}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--fg-muted)' }}>{item.brand || '—'}</td>
                      <td style={{ padding: '8px 14px', color: 'var(--fg-muted)' }}>{item.category || '—'}</td>
                      <td style={{ padding: '8px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: item.upc ? 'var(--fg-primary)' : 'var(--fg-faint)' }}>
                        {item.upc || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <Btn variant="ghost" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} leading={Ic.chevronLeft(14)}>Prev</Btn>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Page {page + 1} of {totalPages}</span>
            <Btn variant="ghost" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} trailing={Ic.chevronRight(14)}>Next</Btn>
          </div>
        )}
      </div>
    </>
  );
}
