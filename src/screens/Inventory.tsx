import { useCallback, useMemo, useRef, useState } from 'react';
import { supabase, selectAllPaged } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import type { PurchaseItem } from '@/lib/types';
import { parseCSV } from '@/lib/csv';
import { Card, Eyebrow, Btn, Pill } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   Inventory upload screen (corporate-only)

   Admin uploads a CSV of the items the venue actually carries. The flow:
     1. Parse the CSV client-side
     2. Cross-reference each row against purchase_items + the live
        kount_carried_items set (Set of purchase_item_id)
     3. Show a preview broken down by what will happen:
          - new master rows (CSV item not in purchase_items at all)
          - updated master rows (CSV adds UPC / size / etc to existing)
          - already-carried (no change)
          - newly-carried (existing master, will be added to carried set)
          - to-remove (replace mode only — currently carried but absent
            from CSV; will be unmarked)
     4. Admin clicks Commit → calls the import_inventory_csv RPC, which
        does the master upserts + carried-set mutations server-side
        (purchase_items has anon-SELECT-only RLS, so client cannot do
        the master writes directly).

   Mode toggle:
     - Merge (default, safe): only adds. Items in carried but not in CSV
       are left alone.
     - Replace: CSV becomes the source of truth — items currently carried
       but not in the CSV get unmarked. Used when admin re-uploads the
       full canonical inventory list.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

interface ParsedRow {
  name: string;
  brand: string;
  size: string;
  upc: string;
  category: string;
  sku: string;
}

interface RowFate {
  row: ParsedRow;
  status: 'new-master' | 'updated-master' | 'newly-carried' | 'already-carried';
  matchedId?: string;
  matchedName?: string;
}

// Forgiving header → field map. Lowercase + collapse whitespace before
// comparing so "Item Name" and "ITEM_NAME" both resolve.
const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  name: 'name', item: 'name', product: 'name', 'item name': 'name', 'product name': 'name',
  brand: 'brand', manufacturer: 'brand', vendor: 'brand', producer: 'brand',
  size: 'size', cu: 'size', container: 'size', 'container unit': 'size', volume: 'size',
  upc: 'upc', barcode: 'upc', gtin: 'upc',
  category: 'category', cat: 'category', type: 'category',
  sku: 'sku', 'item id': 'sku', code: 'sku',
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function detectColumns(rows: string[][]): { headerRow: number; cols: Partial<Record<keyof ParsedRow, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const cols: Partial<Record<keyof ParsedRow, number>> = {};
    row.forEach((cell, j) => {
      const k = HEADER_ALIASES[norm(String(cell || ''))];
      if (k && cols[k] === undefined) cols[k] = j;
    });
    if (cols.name !== undefined) return { headerRow: i, cols };
  }
  return null;
}

export function Inventory({ user }: Props) {
  const [parsed, setParsed]   = useState<ParsedRow[] | null>(null);
  const [fates, setFates]     = useState<RowFate[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]); // purchase_item_ids that would be unmarked under Replace
  const [replaceMode, setReplaceMode] = useState(false);
  const [phase, setPhase]     = useState<null | 'parsing' | 'matching' | 'committing' | 'done'>(null);
  const [error, setError]     = useState<string | null>(null);
  const [summary, setSummary] = useState<null | {
    inserted_master: number;
    updated_master: number;
    added_carried: number;
    removed_carried: number;
    skipped: number;
  }>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c = { newMaster: 0, updatedMaster: 0, newlyCarried: 0, alreadyCarried: 0 };
    for (const f of fates) {
      if (f.status === 'new-master')      c.newMaster++;
      if (f.status === 'updated-master')  c.updatedMaster++;
      if (f.status === 'newly-carried')   c.newlyCarried++;
      if (f.status === 'already-carried') c.alreadyCarried++;
    }
    return c;
  }, [fates]);

  if (user.role !== 'corporate') {
    return (
      <>
        <div className="page-head">
          <div>
            <Eyebrow>Inventory</Eyebrow>
            <h1 className="page-title">Inventory upload</h1>
          </div>
        </div>
        <Card><div style={{ padding: 24, color: 'var(--fg-muted)', textAlign: 'center' }}>Corporate admins only.</div></Card>
      </>
    );
  }

  const handleFile = useCallback(async (file: File) => {
    setError(null); setParsed(null); setFates([]); setRemoveIds([]); setSummary(null);
    setPhase('parsing');
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error('CSV has no data rows.');
      const detected = detectColumns(rows);
      if (!detected) {
        throw new Error('No "Name" / "Item" / "Product" column found. CSV must have a header row including at least one of those (case-insensitive).');
      }
      const { headerRow, cols } = detected;
      const items: ParsedRow[] = [];
      for (let i = headerRow + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        const get = (k: keyof ParsedRow) => cols[k] !== undefined ? String(r[cols[k]!] ?? '').trim() : '';
        const name = get('name');
        if (!name) continue; // skip blank rows
        items.push({
          name, brand: get('brand'), size: get('size'),
          upc:  get('upc'),  category: get('category'), sku: get('sku'),
        });
      }
      if (items.length === 0) throw new Error('No rows with a non-empty Name column.');
      setParsed(items);

      setPhase('matching');
      const [catalog, carriedRows] = await Promise.all([
        selectAllPaged<PurchaseItem>('purchase_items', 'id,name,upc', 'name'),
        selectAllPaged<{ purchase_item_id: string }>('kount_carried_items', 'purchase_item_id', 'purchase_item_id'),
      ]);
      const byUpc  = new Map<string, PurchaseItem>();
      const byName = new Map<string, PurchaseItem>();
      for (const c of catalog) {
        if (c.upc) byUpc.set(c.upc, c);
        byName.set(c.name.toLowerCase(), c);
      }
      const carried = new Set(carriedRows.map(r => r.purchase_item_id));

      const seenMatched = new Set<string>(); // items where a master match was found this batch
      const f: RowFate[] = items.map(row => {
        let match: PurchaseItem | undefined;
        if (row.upc)  match = byUpc.get(row.upc);
        if (!match)   match = byName.get(row.name.toLowerCase());

        if (!match) {
          return { row, status: 'new-master' as const };
        }
        seenMatched.add(match.id);
        // Heuristic for "updated-master" vs "no-op" — we say it'll
        // update if the CSV has any non-empty field beyond name. The
        // RPC's COALESCE-only-on-non-empty logic mirrors this.
        const enriches = !!(row.brand || row.size || row.upc || row.category || row.sku);
        const isCarried = carried.has(match.id);
        if (enriches && !isCarried) return { row, status: 'updated-master' as const, matchedId: match.id, matchedName: match.name };
        if (enriches &&  isCarried) return { row, status: 'updated-master' as const, matchedId: match.id, matchedName: match.name };
        if (isCarried)              return { row, status: 'already-carried' as const, matchedId: match.id, matchedName: match.name };
        return { row, status: 'newly-carried' as const, matchedId: match.id, matchedName: match.name };
      });
      setFates(f);

      // For replace mode preview: which currently-carried IDs are NOT
      // in the CSV and would be unmarked.
      const csvMatchedIds = new Set(f.filter(x => x.matchedId).map(x => x.matchedId!));
      const wouldRemove = Array.from(carried).filter(id => !csvMatchedIds.has(id));
      setRemoveIds(wouldRemove);

      setPhase(null);
    } catch (e) {
      setError((e as Error).message || 'Parse failed');
      setPhase(null);
    }
  }, []);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void handleFile(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  const commit = useCallback(async () => {
    if (!parsed || parsed.length === 0) return;
    setPhase('committing'); setError(null); setSummary(null);
    try {
      // Use the RPC because purchase_items writes need SECURITY DEFINER.
      const { data, error } = await supabase.rpc('import_inventory_csv', {
        p_items: parsed,
        p_replace: replaceMode,
        p_actor_email: user.email,
        p_actor_name: user.name,
      });
      if (error) throw error;
      setSummary(data as typeof summary);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message || 'Import failed');
      setPhase(null);
    }
  }, [parsed, replaceMode, user.email, user.name]);

  const reset = () => {
    setParsed(null); setFates([]); setRemoveIds([]); setSummary(null); setError(null); setPhase(null);
  };

  const busy = phase === 'parsing' || phase === 'matching' || phase === 'committing';

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>Inventory</Eyebrow>
          <h1 className="page-title">Upload inventory CSV</h1>
          <div className="page-sub">
            Upload the items this group carries. New rows are added to the master catalog; existing rows get their UPC / size / category enriched from the CSV. The phone app's typed search and photo matching narrow to this set, so a counter doesn't have to pick from 23 k rows.
          </div>
        </div>
      </div>

      {!parsed && phase !== 'committing' && phase !== 'done' && (
        <Card>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--fg-muted)' }}>
              CSV columns (case-insensitive headers): <strong>Name</strong> (required) plus any of <em>Brand, Size, UPC, Category, SKU</em>.
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onPickFile}
              disabled={busy}
              style={{ display: 'none' }}
            />
            <Btn variant="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              {phase === 'parsing' ? 'Parsing…' : phase === 'matching' ? 'Matching…' : 'Choose CSV file'}
            </Btn>
            {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: 'rgba(220,80,80,0.10)', border: '1px solid rgba(220,80,80,0.4)', color: 'var(--fg)', fontSize: 13 }}>⚠ {error}</div>}
          </div>
        </Card>
      )}

      {parsed && fates.length > 0 && phase !== 'done' && (
        <>
          <Card>
            <div style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                <Pill tone="positive" size="sm">{counts.newMaster} new master</Pill>
                <Pill tone="neutral"  size="sm">{counts.updatedMaster} update master</Pill>
                <Pill tone="positive" size="sm">{counts.newlyCarried} newly carried</Pill>
                <Pill tone="neutral"  size="sm">{counts.alreadyCarried} already carried</Pill>
                {replaceMode && removeIds.length > 0 && (
                  <Pill tone="caution" size="sm">{removeIds.length} would be removed</Pill>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, cursor: 'pointer', marginBottom: 14 }}>
                <input
                  type="checkbox"
                  checked={replaceMode}
                  onChange={e => setReplaceMode(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Replace mode</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    {replaceMode
                      ? 'Items currently carried but missing from this CSV will be UNMARKED.'
                      : 'Default merge mode — only add / enrich. Existing carried items are left alone.'}
                  </div>
                </div>
              </label>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Btn variant="primary" onClick={() => void commit()} disabled={busy}>
                  {phase === 'committing' ? 'Committing…' : `Commit ${parsed.length} rows`}
                </Btn>
                <Btn variant="ghost" onClick={reset} disabled={busy}>Cancel / pick different file</Btn>
              </div>

              {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: 'rgba(220,80,80,0.10)', border: '1px solid rgba(220,80,80,0.4)', color: 'var(--fg)', fontSize: 13 }}>⚠ {error}</div>}
            </div>
          </Card>

          <Card style={{ marginTop: 14 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                    <th style={th}>Name (CSV)</th>
                    <th style={th}>Brand</th>
                    <th style={th}>Size</th>
                    <th style={th}>UPC</th>
                    <th style={th}>Category</th>
                    <th style={th}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {fates.slice(0, 200).map((f, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={td}>{f.row.name}</td>
                      <td style={{ ...td, color: 'var(--fg-muted)' }}>{f.row.brand || '—'}</td>
                      <td style={{ ...td, color: 'var(--fg-muted)' }}>{f.row.size || '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{f.row.upc || '—'}</td>
                      <td style={{ ...td, color: 'var(--fg-muted)' }}>{f.row.category || '—'}</td>
                      <td style={td}>{outcomeLabel(f)}</td>
                    </tr>
                  ))}
                  {fates.length > 200 && (
                    <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--fg-muted)' }}>… and {fates.length - 200} more rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {phase === 'done' && summary && (
        <Card>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 14, color: 'var(--success)' }}>✓ Import complete</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
              <Pill tone="positive">{summary.inserted_master} new master rows</Pill>
              <Pill tone="neutral">{summary.updated_master} master rows enriched</Pill>
              <Pill tone="positive">{summary.added_carried} added to carried</Pill>
              {summary.removed_carried > 0 && <Pill tone="caution">{summary.removed_carried} removed from carried</Pill>}
              {summary.skipped > 0 && <Pill tone="caution">{summary.skipped} skipped (missing name)</Pill>}
            </div>
            <Btn variant="primary" onClick={reset}>Upload another CSV</Btn>
          </div>
        </Card>
      )}
    </>
  );
}

function outcomeLabel(f: RowFate): React.ReactNode {
  switch (f.status) {
    case 'new-master':      return <span style={{ color: 'var(--success)' }}>+ New master + carried</span>;
    case 'updated-master':  return <span style={{ color: 'var(--accent)' }}>↻ Update master {f.matchedName ? `(matched: ${f.matchedName})` : ''}</span>;
    case 'newly-carried':   return <span style={{ color: 'var(--success)' }}>✓ Newly carried {f.matchedName ? `(matched: ${f.matchedName})` : ''}</span>;
    case 'already-carried': return <span style={{ color: 'var(--fg-muted)' }}>— Already carried {f.matchedName ? `(${f.matchedName})` : ''}</span>;
  }
}

const th: React.CSSProperties = { padding: '6px 8px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };
