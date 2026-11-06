import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Eyebrow, Btn, Num, Money, Pill } from '@/components/atoms';
import { FOOD_SHEETS, sheetForCategory, type FoodRow, type FoodSheetKey } from '@/lib/foodImport';
import { foodKey, parseQty, rankMatches, searchStem, unitLabel, worthRemembering, UNIT_CHOICES } from '@/lib/foodMatch';

/* ───────────────────────────────────────────────────────────────────────
   Food count → Type counts. The chef opens the venue's food list, types a
   quantity next to each item, and records it. No spreadsheet.

   - Every item on the venue's list (kount_venue_food_items), grouped by sheet
     (Meat & Seafood, Dairy & Eggs, Grocery, Produce, Frozen), with its unit
     spelled out ("Case · 4 × 1 gal") and the last food count beside it.
   - Blank = not counted, 0 = counted zero. "Count blanks as 0" is offered at
     review, never assumed.
   - Add an item: suggestions come from the venue's list and the catalog by the
     spelling-proof key (foodMatch.foodKey = SQL kount_food_key), so "Unsalted
     Butter" lands on "Butter, Unsalted" instead of a new item. A pick made from
     a different spelling is remembered for the venue (kount_food_alias_save),
     which is what lets the next upload match it too.
   - Typing is saved as a draft in this browser until the count is recorded.
   - Records through kount_import_food_count with each row's master_item_id
     (0155), prices NOT sent: typing a count never rewrites the venue's costs.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { venue: string; venueName: string; userEmail: string }

interface ListItem {
  key: string;                       // master_item_id, or "new:<n>" for an item added on screen
  masterId: string | null;
  name: string;
  unit: string | null;
  pack: number | null;
  sheet: FoodSheetKey;
  sort: number;                      // display order only
  listSort: number | null;           // the list's own sort_order -- the only value ever sent back
  price: number | null;
  last: number | null;
  added: boolean;
  typed?: string;                    // what the chef typed when adding it (remembered on record)
}

interface Extra { key: string; masterId: string | null; name: string; unit: string; pack: number | null; sheet: FoodSheetKey; typed?: string }
interface Draft { qty: Record<string, string>; extras: Extra[]; savedAt: string }

interface ImportResult {
  ok: boolean; committed: boolean; has_counts: boolean; venue_name: string; audit_id: string | null;
  rows_in_sheet: number; matched: number; matched_by?: Record<string, number>; unmatched: string[];
  masters_created: number; rows_with_qty: number; entries_written: number; already_recorded?: boolean;
}

interface CatalogHit { id: string; name: string; category: string | null }

/** A row as sent to kount_import_food_count: FoodRow, but sort may be null and the item may be named outright (0155). */
type SendRow = Omit<FoodRow, 'sort'> & { sort: number | null; master_item_id?: string };

const FOOD_CATEGORY_RE = /(meat|seafood|fish|poultry|dairy|egg|cheese|produce|grocery|dry|bakery|frozen|food|pantry|spice|oil|bread)/i;

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const countedAtFor = (dateStr: string) =>
  dateStr === todayIso() ? new Date().toISOString() : new Date(`${dateStr}T23:59:00`).toISOString();

/** A draft belongs to one person at one venue (a kitchen PC is shared) and is dropped after two days, so last
 *  week's half-finished count never refills the screen. */
const DRAFT_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const draftKey = (venue: string, who: string) => `kount.foodDraft.v2.${venue}.${who.toLowerCase()}`;
function readDraft(venue: string, who: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(venue, who));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || typeof d !== 'object' || !d.qty) return null;
    if (!(Date.now() - new Date(d.savedAt).getTime() < DRAFT_MAX_AGE_MS)) { localStorage.removeItem(draftKey(venue, who)); return null; }
    return { qty: d.qty, extras: Array.isArray(d.extras) ? d.extras : [], savedAt: d.savedAt };
  } catch { return null; }
}
function writeDraft(venue: string, who: string, d: Draft | null) {
  try {
    if (d === null) localStorage.removeItem(draftKey(venue, who));
    else localStorage.setItem(draftKey(venue, who), JSON.stringify(d));
  } catch { /* private mode / blocked storage: the count still works, it just isn't kept across reloads */ }
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const sheetTitle = (k: string) => FOOD_SHEETS.find(s => s.key === k)?.title ?? k;
const isSheet = (s: string | null | undefined): s is FoodSheetKey => FOOD_SHEETS.some(f => f.key === s);

export function FoodEntry({ venue, venueName, userEmail }: Props) {
  // FoodCount mounts this with key={venue}, so the draft is read once, before the first save can overwrite it.
  const [initial]                 = useState(() => readDraft(venue, userEmail));
  const [base, setBase]           = useState<ListItem[] | null>(null);
  const [lastOn, setLastOn]       = useState<string | null>(null);
  const [loadErr, setLoadErr]     = useState('');
  const [qty, setQty]             = useState<Record<string, string>>(() => initial?.qty ?? {});
  const [extras, setExtras]       = useState<Extra[]>(() => initial?.extras ?? []);
  const [filter, setFilter]       = useState('');
  const [countedOn, setCountedOn] = useState(todayIso());
  const [blanksZero, setBlanksZero] = useState(false);
  const [preview, setPreview]     = useState<ImportResult | null>(null);
  const [result, setResult]       = useState<ImportResult | null>(null);
  const [busy, setBusy]           = useState<'' | 'preview' | 'commit'>('');
  const [error, setError]         = useState('');
  const [restored, setRestored]   = useState<string | null>(() =>
    initial && (Object.values(initial.qty).some(v => String(v).trim() !== '') || initial.extras.length > 0) ? initial.savedAt : null);

  /* ── load the list, prices and the last food count ── */
  useEffect(() => {
    let live = true;
    setBase(null); setLoadErr(''); setPreview(null); setResult(null); setError('');
    (async () => {
      const [list, costs, audits] = await Promise.all([
        supabase.from('kount_venue_food_items')
          .select('master_item_id,count_unit,units_per_case,sheet_category,sort_order,master_items(name,category,is_active)')
          .eq('venue_id', venue),
        supabase.from('kount_venue_cost_overrides').select('master_item_id,cost_per_unit').eq('venue_id', venue),
        supabase.from('kount_audits').select('id,started_at').eq('venue_id', venue).eq('audit_kind', 'food')
          .eq('status', 'submitted').order('started_at', { ascending: false }).limit(1),
      ]);
      if (!live) return;
      const err = list.error ?? costs.error ?? audits.error;
      if (err) { setLoadErr(err.message); setBase([]); return; }

      const last = new Map<string, number>();
      const lastAudit = (audits.data ?? [])[0] as { id: string; started_at: string } | undefined;
      if (lastAudit) {
        const { data: ents, error: eErr } = await supabase.from('kount_entries')
          .select('master_item_id,qty').eq('audit_id', lastAudit.id).limit(5000);
        if (!live) return;
        if (!eErr) for (const e of (ents ?? []) as Array<{ master_item_id: string | null; qty: number | null }>) {
          if (e.master_item_id && e.qty !== null) last.set(e.master_item_id, (last.get(e.master_item_id) ?? 0) + Number(e.qty));
        }
        setLastOn(lastAudit.started_at.slice(0, 10));
      } else setLastOn(null);

      const price = new Map<string, number>();
      for (const c of (costs.data ?? []) as Array<{ master_item_id: string; cost_per_unit: number | null }>) {
        if (c.cost_per_unit !== null) price.set(c.master_item_id, Number(c.cost_per_unit));
      }
      type Row = { master_item_id: string; count_unit: string | null; units_per_case: number | null; sheet_category: string | null; sort_order: number | null;
                   master_items: { name: string; category: string | null; is_active: boolean } | Array<{ name: string; category: string | null; is_active: boolean }> | null };
      const items: ListItem[] = ((list.data ?? []) as unknown as Row[]).map((r, i) => {
        const m = one(r.master_items);
        return {
          key: r.master_item_id, masterId: r.master_item_id, name: m?.name ?? '(unnamed item)',
          unit: r.count_unit, pack: r.units_per_case === null ? null : Number(r.units_per_case),
          sheet: isSheet(r.sheet_category) ? r.sheet_category : sheetForCategory(m?.category),
          sort: r.sort_order ?? 100000 + i, listSort: r.sort_order, price: price.get(r.master_item_id) ?? null,
          last: last.get(r.master_item_id) ?? null, added: false,
        };
      });
      setBase(items);
    })();
    return () => { live = false; };
  }, [venue]);

  /* ── draft: save every change for this venue ── */
  useEffect(() => {
    const any = Object.values(qty).some(v => v.trim() !== '') || extras.length > 0;
    writeDraft(venue, userEmail, any ? { qty, extras, savedAt: new Date().toISOString() } : null);
  }, [qty, extras, venue, userEmail]);

  const items: ListItem[] = useMemo(() => {
    const listed = base ?? [];
    const onList = new Set(listed.map(i => i.masterId));
    const added = extras
      .filter(x => !x.masterId || !onList.has(x.masterId))
      .map((x, i): ListItem => ({ key: x.key, masterId: x.masterId, name: x.name, unit: x.unit, pack: x.pack, sheet: x.sheet,
                                  sort: 900000 + i, listSort: null, price: null, last: null, added: true, typed: x.typed }));
    return [...listed, ...added];
  }, [base, extras]);

  const removeExtra = (key: string) => {
    setExtras(es => es.filter(x => x.key !== key));
    setQty(q => { const { [key]: _gone, ...rest } = q; return rest; });
    setPreview(null);
  };

  const parsed = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const it of items) m.set(it.key, parseQty(qty[it.key] ?? ''));
    return m;
  }, [items, qty]);

  const counted = items.filter(i => { const q = parsed.get(i.key); return q !== null && q !== undefined && !Number.isNaN(q); });
  const invalid = items.filter(i => Number.isNaN(parsed.get(i.key) as number));
  const blanks = items.length - counted.length - invalid.length;
  const value = counted.reduce((t, i) => t + (parsed.get(i.key) ?? 0) * (i.price ?? 0), 0);

  const filterKey = foodKey(filter);
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    const words = filterKey ? filterKey.split(' ') : [];
    return items.filter(i => {
      if (i.name.toLowerCase().includes(f)) return true;
      const k = foodKey(i.name).split(' ');
      return words.length > 0 && words.every(w => k.some(t => t.startsWith(w)));
    });
  }, [items, filter, filterKey]);

  const bySheet = useMemo(() => {
    const g = new Map<FoodSheetKey, ListItem[]>();
    for (const s of FOOD_SHEETS) g.set(s.key, []);
    for (const i of visible) g.get(i.sheet)?.push(i);
    for (const arr of g.values()) arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    return g;
  }, [visible]);

  const order = useMemo(() => FOOD_SHEETS.flatMap(s => bySheet.get(s.key) ?? []).map(i => i.key), [bySheet]);
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const focusNext = (key: string) => {
    const i = order.indexOf(key);
    const next = i >= 0 ? order[i + 1] : undefined;
    if (next) inputs.current.get(next)?.focus();
  };

  const setOne = (key: string, v: string) => { setQty(q => ({ ...q, [key]: v })); setPreview(null); setResult(null); };

  /* ── record ── */
  const rowsToSend = useCallback((): SendRow[] => {
    const out: SendRow[] = [];
    for (const it of items) {
      let q = parsed.get(it.key) ?? null;
      if (q === null && blanksZero) q = 0;
      if (q === null || Number.isNaN(q)) continue;
      // sort: only the list's own order goes back (the import keeps the existing one when it is null);
      // the display order of unsorted / added items is never written into the venue's list.
      const row: SendRow = {
        item: it.name, unit: it.unit ?? '', pack: it.pack, qty: q, price: null, sheet: it.sheet, sort: it.listSort,
      };
      if (it.masterId) row.master_item_id = it.masterId;
      out.push(row);
    }
    return out;
  }, [items, parsed, blanksZero]);

  // The moment the count is stamped at is fixed when Review is pressed and reused by Record, so a retry after a
  // lost response sends the same moment and the import answers "already recorded" instead of writing it twice.
  const stamp = useRef<string>('');
  const run = useCallback(async (commit: boolean) => {
    const { data, error: rpcErr } = await supabase.rpc('kount_import_food_count', {
      p_venue_id: venue, p_rows: rowsToSend(), p_counted_at: stamp.current, p_commit: commit, p_create_missing: true,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    return data as ImportResult;
  }, [venue, rowsToSend]);

  const review = async () => {
    setBusy('preview'); setError(''); setResult(null);
    stamp.current = countedAtFor(countedOn);
    try { setPreview(await run(false)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };
  const record = async () => {
    setBusy('commit'); setError('');
    try {
      const r = await run(true);
      const notWritten = new Set((r.unmatched ?? []).map(n => n.toLowerCase()));
      // Spellings the chef typed for catalog items they then actually counted: remembered for the venue only now,
      // so a wrong pick that was removed or left blank never becomes a match.
      for (const it of items) {
        const q = parsed.get(it.key);
        if (it.added && it.masterId && it.typed && (q !== null || blanksZero) && worthRemembering(it.typed, it.name)) {
          void rememberSpelling(venue, it.typed, it.masterId);
        }
      }
      setResult(r); setPreview(null); setRestored(null);
      // Anything the import could not place keeps its typed number on screen (and in the draft) instead of vanishing.
      const keep = items.filter(it => notWritten.has(it.name.toLowerCase()));
      setQty(Object.fromEntries(keep.map(it => [it.key, qty[it.key] ?? ''])));
      setExtras(extras.filter(x => keep.some(k => k.key === x.key)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const addItem = (x: Omit<Extra, 'key'>, typed: string) => {
    if (x.masterId && (base ?? []).some(i => i.masterId === x.masterId)) {
      setFilter(x.name);                // already on the list: show it instead of adding a second row
      return;
    }
    if (x.masterId && extras.some(e => e.masterId === x.masterId)) { setFilter(x.name); return; }
    const key = x.masterId ?? `new:${Date.now()}`;
    setExtras(es => [...es, { ...x, key, typed: typed.trim() || undefined }]);
    setPreview(null);                   // a review never covers an item added after it
  };

  if (base === null) return <Card padding={16}>Loading {venueName}'s food list…</Card>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loadErr && <Card padding={16}><span style={{ color: 'var(--danger)' }}>Could not load the food list: {loadErr}</span></Card>}

      <Card padding={16}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={lbl}>Counted on
            <input type="date" value={countedOn} max={todayIso()} onChange={e => setCountedOn(e.target.value || todayIso())} style={picker} />
          </label>
          <label style={{ ...lbl, flex: '1 1 220px' }}>Find an item
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="e.g. butter, avocado, wagyu" style={{ ...picker, width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
            <Stat label="Counted" value={<><Num value={counted.length} /> <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>of {items.length}</span></>} />
            <Stat label="Value so far" value={<Money value={value} />} />
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          Type how many of each <strong>unit</strong> you have. Leave it blank if you didn't count it; type <strong>0</strong> if there is none.
          Enter jumps to the next item. {lastOn ? <>"Last" is the food count from {lastOn}.</> : null}
          {restored && <> · Picked up your unsaved count from {new Date(restored).toLocaleString()}.</>}
        </div>
      </Card>

      {items.length === 0 && (
        <Card padding={16}>
          {venueName} has no food list yet. Add items below, or upload the venue's workbook once (Upload workbook) to set the list up.
        </Card>
      )}

      {FOOD_SHEETS.map(s => {
        const rows = bySheet.get(s.key) ?? [];
        if (rows.length === 0) return null;
        const done = rows.filter(r => { const q = parsed.get(r.key); return q !== null && q !== undefined && !Number.isNaN(q); }).length;
        return (
          <Card key={s.key} padding={0}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <Eyebrow>{s.title}</Eyebrow>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{done} of {rows.length} counted</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={headRow}>
                    <th style={th}>Item</th><th style={th}>Unit</th><th style={{ ...th, textAlign: 'right' }}>Last</th>
                    <th style={{ ...th, textAlign: 'right' }}>Count</th><th style={{ ...th, textAlign: 'right' }}>Price / unit</th><th style={{ ...th, textAlign: 'right' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(it => {
                    const u = unitLabel(it.unit, it.pack);
                    const q = parsed.get(it.key);
                    const bad = Number.isNaN(q as number);
                    return (
                      <tr key={it.key} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={td}>
                          {it.name}{' '}
                          {it.added && <Pill tone={it.masterId ? 'inform' : 'caution'} size="sm">{it.masterId ? 'added' : 'new item'}</Pill>}
                          {it.added && (
                            <button onClick={() => removeExtra(it.key)} title="Remove this added item"
                                    style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }}>✕</button>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <strong>{u.unit}</strong>{u.detail && <span style={{ color: 'var(--fg-muted)' }}> · {u.detail}</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: 'var(--fg-muted)' }}>{it.last === null ? '—' : fmt(it.last)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <input
                            ref={el => { inputs.current.set(it.key, el); }}
                            inputMode="decimal" value={qty[it.key] ?? ''} placeholder="—"
                            aria-label={`Count of ${it.name} in ${u.text}`}
                            onChange={e => setOne(it.key, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNext(it.key); } }}
                            style={{ ...picker, width: 84, textAlign: 'right', borderColor: bad ? 'var(--danger)' : undefined }} />
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: 'var(--fg-muted)' }}>{it.price === null ? '—' : <Money value={it.price} bold={false} size={13} />}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {q !== null && q !== undefined && !bad && it.price !== null ? <Money value={q * it.price} bold={false} size={13} /> : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      <AddItem venueItems={base} onAdd={addItem} />

      <Card padding={16}>
        <Eyebrow>Record the count</Eyebrow>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.6 }}>
          {counted.length} item{counted.length === 1 ? '' : 's'} counted · {blanks} left blank
          {invalid.length > 0 && <span style={{ color: 'var(--danger)' }}> · {invalid.length} not a number ({invalid.slice(0, 3).map(i => i.name).join(', ')}{invalid.length > 3 ? '…' : ''})</span>}
        </div>
        {blanks > 0 && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
            <input type="checkbox" checked={blanksZero} onChange={e => { setBlanksZero(e.target.checked); setPreview(null); }} />
            Count the {blanks} blank item{blanks === 1 ? '' : 's'} as 0 (none on hand)
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Btn variant="secondary" onClick={() => void review()} disabled={busy !== '' || invalid.length > 0 || (counted.length === 0 && !blanksZero)}>
            {busy === 'preview' ? 'Checking…' : 'Review'}
          </Btn>
          {preview && (
            <Btn onClick={() => void record()} disabled={busy !== ''}>
              {busy === 'commit' ? 'Saving…' : `Record food count (${preview.rows_with_qty} items)`}
            </Btn>
          )}
        </div>

        {preview && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 6, background: 'var(--inform-bg)', fontSize: 13, lineHeight: 1.6 }}>
            This records a <strong>food count</strong> for {venueName} on <strong>{countedOn}</strong>: {preview.rows_with_qty} items, about <Money value={value} bold={false} size={13} /> at current prices.
            {preview.unmatched.length > 0 && <> {preview.unmatched.length} item{preview.unmatched.length === 1 ? " isn't" : "s aren't"} in the catalog yet and will be added as new: {preview.unmatched.slice(0, 8).join(', ')}{preview.unmatched.length > 8 ? '…' : ''}.</>}
            {' '}Prices are not changed.
          </div>
        )}
        {result && (
          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 6, background: 'var(--positive-bg)', fontSize: 13 }}>
            {result.already_recorded
              ? <>This count was already recorded for <strong>{result.venue_name}</strong> ({result.entries_written} items) — nothing was written twice.</>
              : <>Food count recorded for <strong>{result.venue_name}</strong>: {result.entries_written} items.</>}
            {result.masters_created > 0 && <> {result.masters_created} new catalog item{result.masters_created === 1 ? '' : 's'} added.</>}
          </div>
        )}
        {result && !result.already_recorded && result.entries_written < result.rows_with_qty && (
          <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 6, background: 'var(--caution-bg)', fontSize: 13 }}>
            {result.rows_with_qty - result.entries_written} item{result.rows_with_qty - result.entries_written === 1 ? ' was' : 's were'} <strong>not recorded</strong>
            {result.unmatched.length > 0 && <> ({result.unmatched.slice(0, 8).join(', ')}{result.unmatched.length > 8 ? '…' : ''})</>}: the name matches an
            archived duplicate in the catalog. The numbers are still on screen: pick the right item under "Add an item" and record again.
          </div>
        )}
        {error && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)' }}>{error}</div>}
      </Card>
    </div>
  );
}

/** Remember a spelling someone confirmed for the venue (0155), so uploads match it too.
 *  Best effort: the count does not depend on it. */
async function rememberSpelling(venue: string, typed: string, masterId: string) {
  const { error: aliasErr } = await supabase.rpc('kount_food_alias_save', { p_venue_id: venue, p_alias: typed, p_master_item_id: masterId });
  if (aliasErr) console.warn('[food] alias not saved', aliasErr.message);
}

/* ── add an item: the venue's list first, then the catalog, then "new" ── */
function AddItem({ venueItems, onAdd }: {
  venueItems: ListItem[];
  onAdd: (x: Omit<Extra, 'key'>, typed: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [pick, setPick] = useState<{ masterId: string | null; name: string; category: string | null } | null>(null);
  const [unit, setUnit] = useState<string>('lb');
  const [pack, setPack] = useState('');
  const [sheet, setSheet] = useState<FoodSheetKey>('Grocery');

  useEffect(() => {
    const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
    if (words.length === 0) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const term = searchStem(words[0]).replace(/[\\%_]/g, m => '\\' + m);
      const { data, error } = await supabase.from('master_items').select('id,name,category')
        .eq('is_active', true).ilike('name', '%' + term + '%').limit(60);
      if (!live) return;
      if (error) { console.error('[food] item search', error); setHits([]); return; }
      setHits(((data ?? []) as CatalogHit[]).filter(h => FOOD_CATEGORY_RE.test(h.category ?? '')));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const listMatches = useMemo(() => rankMatches(q, venueItems.filter(i => i.masterId).map(i => ({ id: i.masterId as string, name: i.name })), 4), [q, venueItems]);
  const catMatches = useMemo(() => {
    const onList = new Set(venueItems.map(i => i.masterId));
    return rankMatches(q, hits.filter(h => !onList.has(h.id)), 6);
  }, [q, hits, venueItems]);

  const choose = (masterId: string | null, name: string, category: string | null) => {
    setPick({ masterId, name, category });
    setSheet(sheetForCategory(category));
  };
  const confirm = () => {
    if (!pick) return;
    const n = Number(pack);
    onAdd({ masterId: pick.masterId, name: pick.name, unit, pack: pack.trim() && Number.isFinite(n) && n > 0 ? n : null, sheet }, q);
    setQ(''); setPick(null); setPack(''); setHits([]);
  };

  return (
    <Card padding={16}>
      <Eyebrow>Add an item that isn't listed</Eyebrow>
      {!pick && (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type the item the way you call it, e.g. unsalted butter"
                 style={{ ...picker, width: '100%', marginTop: 10 }} />
          {q.trim().length >= 2 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {listMatches.filter(m => m.score >= 0.34).map(m => (
                <div key={'l' + m.item.id} style={sugg}>
                  <span><strong>{m.item.name}</strong> <span style={{ color: 'var(--fg-muted)' }}>— already on your list</span></span>
                  <Btn size="sm" variant="ghost" onClick={() => { onAdd({ masterId: m.item.id, name: m.item.name, unit: '', pack: null, sheet: 'Grocery' }, q); setQ(''); }}>Show it</Btn>
                </div>
              ))}
              {catMatches.map(m => (
                <div key={'c' + m.item.id} style={sugg}>
                  <span>{m.item.name} <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{m.item.category}{m.sameKey ? ' · same item' : ''}</span></span>
                  <Btn size="sm" variant="secondary" onClick={() => choose(m.item.id, m.item.name, m.item.category)}>Use this</Btn>
                </div>
              ))}
              <div style={sugg}>
                <span>None of these — add <strong>"{q.trim()}"</strong> as a new item</span>
                <Btn size="sm" variant="ghost" onClick={() => choose(null, q.trim().replace(/\s+/g, ' '), null)}>Add new</Btn>
              </div>
            </div>
          )}
        </>
      )}
      {pick && (
        <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, minWidth: 200 }}>
            <strong>{pick.name}</strong> {pick.masterId ? '' : <Pill tone="caution" size="sm">new item</Pill>}
          </div>
          <label style={lbl}>Counted in
            <select value={unit} onChange={e => setUnit(e.target.value)} style={picker}>
              {UNIT_CHOICES.map(u => <option key={u} value={u}>{unitLabel(u).unit}</option>)}
            </select>
          </label>
          {(unit === 'cs' || unit === 'pk') && (
            <label style={lbl}>Units per {unit === 'cs' ? 'case' : 'pack'}
              <input inputMode="decimal" value={pack} onChange={e => setPack(e.target.value)} style={{ ...picker, width: 80 }} placeholder="e.g. 12" />
            </label>
          )}
          <label style={lbl}>Section
            <select value={sheet} onChange={e => setSheet(e.target.value as FoodSheetKey)} style={picker}>
              {FOOD_SHEETS.map(s => <option key={s.key} value={s.key}>{sheetTitle(s.key)}</option>)}
            </select>
          </label>
          <Btn size="sm" onClick={confirm}>Add to the count</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setPick(null)}>Back</Btn>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const picker: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '.05em' };
const headRow: React.CSSProperties = { textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
const th: React.CSSProperties = { padding: '8px 12px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
const sugg: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 };
