import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, selectAllPaged } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { PurchaseItem } from '@/lib/types';
import { Btn, Card, Eyebrow, Pill, Segment } from '@/components/atoms';
import { Ic } from '@/components/Icons';
import { parseBevagerWorkbook, matchBevagerRows } from '@/lib/bevagerImport';
import type { MatchResult } from '@/lib/bevagerImport';

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
  const [importPreview, setImportPreview] = useState<{
    matches: MatchResult[];
    unmatched: MatchResult[];
    alreadyCarried: MatchResult[];
    toInsert: MatchResult[];
  } | null>(null);
  const [importing, setImporting] = useState<null | 'parsing' | 'matching' | 'inserting' | 'done'>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- Initial load: full catalog + current carried set ---
  // Both must paginate — the kount_carried_items query previously used a plain
  // select() which silently capped at Supabase's 1000-row default, leaving the
  // local set incomplete and breaking the import dedupe (PK violations on
  // insert when carried > 1000 rows in DB).
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [cat, carr] = await Promise.all([
      selectAllPaged<PurchaseItem>('purchase_items', 'id,name,category,subcategory,upc,sku', 'name'),
      selectAllPaged<{ purchase_item_id: string }>('kount_carried_items', 'purchase_item_id', 'purchase_item_id'),
    ]);
    setItems(cat);
    const carrSet = new Set<string>();
    for (const row of carr) carrSet.add(row.purchase_item_id);
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

  const handleBevagerFile = async (file: File) => {
    setImportError(null);
    setImportPreview(null);
    setImporting('parsing');
    try {
      const bevRows = await parseBevagerWorkbook(file);
      console.log('[import] parsed XLSX rows:', bevRows.length);
      if (bevRows.length === 0) {
        throw new Error('No rows parsed from the XLSX. Expected the "2. Inventory" sheet with an ITEM column.');
      }

      setImporting('matching');
      // Re-fetch the full catalog AND the live carried set right here instead
      // of trusting React state, which can be stale (mid-load on a fast click,
      // or out of sync if another admin curated in another tab).
      const [catalog, carriedRows] = await Promise.all([
        selectAllPaged<PurchaseItem>(
          'purchase_items',
          'id,name,category,subcategory,upc,sku',
          'name',
        ),
        selectAllPaged<{ purchase_item_id: string }>(
          'kount_carried_items',
          'purchase_item_id',
          'purchase_item_id',
        ),
      ]);
      console.log('[import] fresh catalog rows:', catalog.length, 'carried rows:', carriedRows.length);
      if (catalog.length === 0) {
        throw new Error('purchase_items came back empty. Check Supabase RLS / network, then retry.');
      }
      const liveCarried = new Set(carriedRows.map(r => r.purchase_item_id));

      const results = matchBevagerRows(bevRows, catalog);
      const unmatched = results.filter(r => r.confidence === 'unmatched');
      const matched   = results.filter(r => r.confidence !== 'unmatched');
      console.log('[import] matched:', matched.length, 'unmatched:', unmatched.length);

      const alreadyCarried = matched.filter(r => r.purchaseItemId && liveCarried.has(r.purchaseItemId));
      // Dedupe on purchase_item_id for the insert list (multiple XLSX rows
      // can collapse to the same purchase_items row via loose match).
      const seen = new Set<string>();
      const toInsert: MatchResult[] = [];
      for (const r of matched) {
        if (!r.purchaseItemId || liveCarried.has(r.purchaseItemId)) continue;
        if (seen.has(r.purchaseItemId)) continue;
        seen.add(r.purchaseItemId);
        toInsert.push(r);
      }
      setImportPreview({ matches: matched, unmatched, alreadyCarried, toInsert });

      // Refresh the on-screen catalog + carried highlight so they reflect
      // reality after the admin confirms the import.
      setItems(catalog);
      setCarried(liveCarried);
      setImporting(null);
    } catch (e) {
      setImportError((e as Error).message || 'Parse failed');
      setImporting(null);
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    setImporting('inserting');
    setImportError(null);
    const CHUNK = 200;
    try {
      for (let i = 0; i < importPreview.toInsert.length; i += CHUNK) {
        const chunk = importPreview.toInsert.slice(i, i + CHUNK).map(r => ({
          purchase_item_id: r.purchaseItemId!,
          added_by_email:   user.email,
          added_by_name:    user.name,
          notes:            'imported from Bevager XLSX: ' + (r.matchedName ?? r.bevager.name),
        }));
        // upsert + ignoreDuplicates makes this idempotent: if any rows already
        // landed (a previous failed run, a parallel admin, or a stale local
        // dedupe), the call still succeeds rather than throwing on PK.
        const { error } = await supabase
          .from('kount_carried_items')
          .upsert(chunk, { onConflict: 'purchase_item_id', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
      setImporting('done');
    } catch (e) {
      setImportError('Insert failed: ' + (e as Error).message);
      setImporting(null);
    } finally {
      // Always reload — partial-success runs leave DB ahead of local state,
      // which is exactly what made matched items "not show" before.
      await loadAll();
    }
  };

  const downloadUnmatched = () => {
    if (!importPreview) return;
    const lines = ['name,cu,category,quantity'];
    for (const r of importPreview.unmatched) {
      const row = [r.bevager.name, r.bevager.cu, r.bevager.category, String(r.bevager.quantity)]
        .map(c => /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(',');
      lines.push(row);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bevager-unmatched.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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
          <input ref={fileRef} type="file" accept=".xlsx,.xls"
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void handleBevagerFile(f);
            }}
            style={{ display: 'none' }} />
          <Btn variant="secondary" size="sm" leading={Ic.upload(14)}
            onClick={() => fileRef.current?.click()}
            disabled={importing === 'parsing' || importing === 'matching' || importing === 'inserting'}>
            {importing === 'parsing'   ? 'Parsing…'
           : importing === 'matching'  ? 'Matching…'
           : importing === 'inserting' ? 'Importing…'
           :                             'Import Bevager XLSX'}
          </Btn>
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

        {(importPreview || importError) && (
          <Card padding={16} style={{ borderColor: importError ? 'var(--raspberry-300)' : 'var(--border)' }}>
            <Eyebrow>{importError ? 'Import error' : 'Import preview'}</Eyebrow>
            {importError && (
              <div style={{ marginTop: 8, color: 'var(--raspberry-400)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                {importError}
              </div>
            )}
            {importPreview && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 10 }}>
                  <PreviewTile label="Matched"            value={importPreview.matches.length}   tone="positive" />
                  <PreviewTile label="Unmatched"          value={importPreview.unmatched.length} tone={importPreview.unmatched.length ? 'caution' : 'positive'} />
                  <PreviewTile label="Already carried"    value={importPreview.alreadyCarried.length} tone="ghost" />
                  <PreviewTile label="New carried rows"   value={importPreview.toInsert.length}  tone="gold" />
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {importing !== 'done' ? (
                    <>
                      <Btn variant="primary"   size="md" onClick={() => void confirmImport()} disabled={importing === 'inserting'}>
                        {importing === 'inserting' ? 'Importing…' : `Add ${importPreview.toInsert.length} to carried`}
                      </Btn>
                      <Btn variant="secondary" size="md" onClick={() => setImportPreview(null)} disabled={importing === 'inserting'}>Cancel</Btn>
                    </>
                  ) : (
                    <Btn variant="secondary" size="md" onClick={() => { setImportPreview(null); setImporting(null); }}>Done</Btn>
                  )}
                  {importPreview.unmatched.length > 0 && (
                    <Btn variant="ghost" size="md" leading={Ic.download(14)} onClick={downloadUnmatched}>
                      Download {importPreview.unmatched.length} unmatched (CSV)
                    </Btn>
                  )}
                </div>
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--fg-muted)' }}>
                    Preview — first 20 of {importPreview.toInsert.length} new rows
                  </summary>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                        <th style={{ padding: '6px 4px' }}>XLSX name</th>
                        <th style={{ padding: '6px 4px' }}>→ catalog row</th>
                        <th style={{ padding: '6px 4px' }}>match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.toInsert.slice(0, 20).map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 4px' }}>{r.bevager.name}</td>
                          <td style={{ padding: '4px 4px', color: 'var(--fg-muted)' }}>{r.matchedName ?? '—'}</td>
                          <td style={{ padding: '4px 4px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: r.confidence === 'strict' ? 'var(--teal-300)' : 'var(--copper-300)' }}>
                            {r.confidence}{r.candidateCount && r.candidateCount > 1 ? ` · ${r.candidateCount} candidates` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            )}
          </Card>
        )}

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

function PreviewTile({ label, value, tone }: { label: string; value: number; tone: 'gold' | 'caution' | 'positive' | 'ghost' }) {
  const bg = tone === 'gold'     ? 'var(--gold-100)'
           : tone === 'caution'  ? 'var(--copper-100)'
           : tone === 'positive' ? 'var(--teal-100)'
           :                       'var(--off-200)';
  const fg = tone === 'gold'     ? 'var(--gold-400)'
           : tone === 'caution'  ? 'var(--copper-400)'
           : tone === 'positive' ? 'var(--teal-300)'
           :                       'var(--fg-muted)';
  return (
    <div style={{ padding: 12, background: bg, borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: fg }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: 'var(--fg-primary)' }}>{value}</div>
    </div>
  );
}
