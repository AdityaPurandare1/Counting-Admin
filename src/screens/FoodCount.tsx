import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isOrgWide } from '@/lib/access';
import { useVisibleVenues } from '@/lib/useVisibleVenues';
import type { AccessEntry } from '@/lib/access';
import { Card, Eyebrow, Btn, Num, Money, Pill } from '@/components/atoms';
import {
  buildFoodTemplate, parseFoodWorkbook,
  type ParsedFoodWorkbook, type TemplateItem,
} from '@/lib/foodImport';

/* ───────────────────────────────────────────────────────────────────────
   Food count — download the venue's food inventory workbook, upload it
   filled in, and record it.

   The server does the work (kount_import_food_count, migrations 0081 + 0088):
   it matches names to the catalog, writes the venue's costs and food list,
   and records a food audit ONLY when the sheet carries quantities. Prices
   are seeded once and later refreshed from invoices automatically.

   Who: org-wide roles anywhere, managers at their own venues. Deliberately
   NOT canRunAudits(), which also admits the read-only venue_manager role --
   the RPC rejects that role, so offering it the screen would only produce a
   permission error after the upload.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

interface ImportResult {
  ok: boolean;
  committed: boolean;
  has_counts: boolean;
  venue_name: string;
  audit_id: string | null;
  rows_in_sheet: number;
  matched: number;
  unmatched: string[];
  masters_created: number;
  rows_with_qty: number;
  rows_with_price: number;
  entries_written: number;
  costs_written: number;
  total_value: number;
}

interface FoodListRow {
  master_item_id: string;
  count_unit: string | null;
  units_per_case: number | null;
  sheet_category: string | null;
  sort_order: number | null;
  master_items: { name: string; category: string | null } | { name: string; category: string | null }[] | null;
}

export function canUseFoodCount(role: AccessEntry['role']): boolean {
  return isOrgWide(role) || role === 'manager';
}

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The moment the count is stamped at. Today -> now; a past date -> the end of
 *  that day, so the variance window closes after that day's sales rather than
 *  at midnight before them. */
function countedAtFor(dateStr: string): string {
  if (dateStr === todayIso()) return new Date().toISOString();
  return new Date(`${dateStr}T23:59:00`).toISOString();
}

/* Venue names are free text and not necessarily admin-typed, so the download
   name is treated as untrusted, exactly as Counts.tsx does for the audit
   report: control characters and the bidi overrides that can make "...xlsx"
   render as something else are dropped, Windows-forbidden characters become
   spaces, and the whole thing is capped. The invisible-character class is
   built from char codes on purpose -- written as escapes, an editor can turn
   them into the very characters they are meant to strip. */
const ch = (a: number, b?: number) =>
  String.fromCharCode(a) + (b === undefined ? '' : '-' + String.fromCharCode(b));
const INVISIBLE = new RegExp(
  '[' + ch(0x00, 0x1f) + ch(0x7f, 0x9f) + ch(0x200e) + ch(0x200f) + ch(0x202a, 0x202e) + ch(0x2066, 0x2069) + ']',
  'g',
);
function safeName(s: string): string {
  return (s || 'Venue')
    .replace(INVISIBLE, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim() || 'Venue';
}

function download(bytes: ArrayBuffer | Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Deferred revoke: an immediate one has been seen to abort the download
  // before the browser has read the blob (same as Counts / Catalog).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FoodCount({ user }: Props) {
  const visibleVenues = useVisibleVenues(user);

  const [venue, setVenue]             = useState<string>('');
  const [listSize, setListSize]       = useState<number | null>(null);
  const [countedOn, setCountedOn]     = useState<string>(todayIso());
  const [fileName, setFileName]       = useState<string>('');
  const [parsed, setParsed]           = useState<ParsedFoodWorkbook | null>(null);
  const [preview, setPreview]         = useState<ImportResult | null>(null);
  const [result, setResult]           = useState<ImportResult | null>(null);
  const [busy, setBusy]               = useState<'' | 'template' | 'reading' | 'preview' | 'commit'>('');
  const [error, setError]             = useState<string>('');

  useEffect(() => {
    if (!venue && visibleVenues.length) setVenue(visibleVenues[0].id);
  }, [venue, visibleVenues]);

  const venueName = visibleVenues.find(v => v.id === venue)?.name ?? '';

  const loadListSize = useCallback(async (v: string) => {
    if (!v) { setListSize(null); return; }
    const { count, error: e } = await supabase
      .from('kount_venue_food_items')
      .select('master_item_id', { count: 'exact', head: true })
      .eq('venue_id', v);
    setListSize(e ? null : (count ?? 0));
  }, []);

  useEffect(() => {
    void loadListSize(venue);
    setParsed(null); setPreview(null); setResult(null); setError(''); setFileName('');
  }, [venue, loadListSize]);

  const downloadTemplate = useCallback(async () => {
    if (!venue) return;
    setBusy('template'); setError('');
    try {
      const { data: list, error: listErr } = await supabase
        .from('kount_venue_food_items')
        .select('master_item_id,count_unit,units_per_case,sheet_category,sort_order,master_items(name,category)')
        .eq('venue_id', venue);
      if (listErr) throw new Error(`Could not load the food list: ${listErr.message}`);

      const { data: costs, error: costErr } = await supabase
        .from('kount_venue_cost_overrides')
        .select('master_item_id,cost_per_unit')
        .eq('venue_id', venue);
      if (costErr) throw new Error(`Could not load prices: ${costErr.message}`);

      const price = new Map<string, number>();
      for (const c of (costs ?? []) as Array<{ master_item_id: string; cost_per_unit: number | null }>) {
        if (c.cost_per_unit !== null) price.set(c.master_item_id, Number(c.cost_per_unit));
      }
      const items: TemplateItem[] = ((list ?? []) as unknown as FoodListRow[]).map((r) => {
        const m = Array.isArray(r.master_items) ? r.master_items[0] : r.master_items;
        return {
          name: m?.name ?? '(unnamed item)',
          unit: r.count_unit,
          pack: r.units_per_case === null ? null : Number(r.units_per_case),
          price: price.get(r.master_item_id) ?? null,
          sheet: r.sheet_category,
          category: m?.category ?? null,
          sort: r.sort_order,
        };
      });
      const bytes = await buildFoodTemplate(items, venueName);
      download(bytes, `${safeName(venueName)} - Food Inventory ${todayIso()}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }, [venue, venueName]);

  const runImport = useCallback(async (rows: ParsedFoodWorkbook['rows'], commit: boolean) => {
    const { data, error: rpcErr } = await supabase.rpc('kount_import_food_count', {
      p_venue_id: venue,
      p_rows: rows,
      p_counted_at: countedAtFor(countedOn),
      p_commit: commit,
      p_create_missing: true,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    return data as ImportResult;
  }, [venue, countedOn]);

  const onFile = useCallback(async (file: File | undefined) => {
    setParsed(null); setPreview(null); setResult(null); setError('');
    if (!file) return;
    setFileName(file.name);
    setBusy('reading');
    try {
      const wb = await parseFoodWorkbook(file);
      setParsed(wb);
      if (wb.rows.length === 0) {
        setError('No items found. Use the downloaded template, or a sheet with an "Item" column.');
        return;
      }
      setBusy('preview');
      setPreview(await runImport(wb.rows, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }, [runImport]);

  const commit = useCallback(async () => {
    if (!parsed) return;
    setBusy('commit'); setError('');
    try {
      const r = await runImport(parsed.rows, true);
      setResult(r);
      setParsed(null); setPreview(null); setFileName('');
      void loadListSize(venue);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }, [parsed, runImport, loadListSize, venue]);

  if (!canUseFoodCount(user.role)) {
    return (
      <div className="content">
        <Card padding={16}>Food counts are available to managers and corporate.</Card>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Inventory</div>
          <h1>Food count</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={venue} onChange={e => setVenue(e.target.value)} style={pickerStyle}>
            {visibleVenues.length === 0 && <option value="">No venues</option>}
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card padding={16}>
          <Eyebrow>1 · Download the template</Eyebrow>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
            {listSize === null
              ? 'Loading the food list…'
              : listSize > 0
                ? <>Pre-filled with <strong>{venueName}</strong>'s {listSize} food items and their last prices. Fill in <strong>Quantity</strong>; add any new items on a blank row.</>
                : <>{venueName} has no food list yet, so the template is blank. You can also upload the sheet you already keep — it will set up the list.</>}
          </div>
          <div style={{ marginTop: 12 }}>
            <Btn variant="secondary" onClick={() => void downloadTemplate()} disabled={!venue || busy !== ''}>
              {busy === 'template' ? 'Building…' : 'Download template'}
            </Btn>
          </div>
        </Card>

        <Card padding={16}>
          <Eyebrow>2 · Upload the filled workbook</Eyebrow>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>
              Counted on{' '}
              <input type="date" value={countedOn} max={todayIso()}
                onChange={e => setCountedOn(e.target.value || todayIso())} style={pickerStyle} />
            </label>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={!venue || busy !== ''}
              onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            {fileName && <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fileName}</span>}
          </div>

          {(busy === 'reading' || busy === 'preview') && (
            <div style={{ marginTop: 12, color: 'var(--fg-muted)' }}>
              {busy === 'reading' ? 'Reading the workbook…' : 'Checking items against the catalog…'}
            </div>
          )}

          {parsed && parsed.skipped.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--warning)' }}>
              Ignored {parsed.skipped.length} row{parsed.skipped.length === 1 ? '' : 's'} that had a name but no unit, quantity or price
              (looked like headings): {parsed.skipped.slice(0, 6).map(s => s.item).join(', ')}
              {parsed.skipped.length > 6 ? '…' : ''}
            </div>
          )}

          {preview && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                <Tile label="Items" value={<Num value={preview.rows_in_sheet} />} />
                <Tile label="Matched" value={<Num value={preview.matched} />} />
                <Tile label="Counted" value={<Num value={preview.rows_with_qty} />} />
                <Tile label="Priced" value={<Num value={preview.rows_with_price} />} />
                <Tile label="Value" value={<Money value={preview.total_value} />} />
              </div>

              {preview.unmatched.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--fg-secondary)', marginBottom: 6 }}>
                    {preview.unmatched.length} item{preview.unmatched.length === 1 ? ' is' : 's are'} not in the catalog yet and will be added:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {preview.unmatched.slice(0, 40).map(n => <Pill key={n} tone="neutral" size="sm">{n}</Pill>)}
                    {preview.unmatched.length > 40 && <Pill tone="neutral" size="sm">+{preview.unmatched.length - 40} more</Pill>}
                  </div>
                </div>
              )}

              <div style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 6, fontSize: 13,
                background: preview.has_counts ? 'var(--inform-bg)' : 'var(--caution-bg)',
              }}>
                {preview.has_counts
                  ? <>This records a <strong>food count</strong> for {venueName} on <strong>{countedOn}</strong> ({preview.rows_with_qty} items counted), separate from the bar count.</>
                  : <>This sheet has <strong>no quantities</strong>, so it will save {venueName}'s item list and prices only — <strong>no count is recorded</strong>.</>}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <Btn onClick={() => void commit()} disabled={busy !== ''}>
                  {busy === 'commit' ? 'Saving…' : preview.has_counts ? 'Record food count' : 'Save list & prices'}
                </Btn>
                <Btn variant="ghost" onClick={() => { setParsed(null); setPreview(null); setFileName(''); }} disabled={busy !== ''}>
                  Cancel
                </Btn>
              </div>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 6, background: 'var(--positive-bg)', fontSize: 13 }}>
              {result.has_counts
                ? <>Food count recorded for <strong>{result.venue_name}</strong>: {result.entries_written} items, <Money value={result.total_value} />.</>
                : <>Saved <strong>{result.venue_name}</strong>'s food list and {result.costs_written} prices. No count was recorded.</>}
              {result.masters_created > 0 && <> {result.masters_created} new catalog item{result.masters_created === 1 ? '' : 's'} added.</>}
            </div>
          )}

          {error && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)' }}>{error}</div>
          )}
        </Card>
      </div>
    </>
  );
}

const pickerStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border-strong)',
  borderRadius: 6, fontFamily: 'inherit', fontSize: 13,
};

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
