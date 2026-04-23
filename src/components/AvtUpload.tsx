import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { parseCSV, findAvtHeaderColumns, numOrNull } from '@/lib/csv';
import { mapStoreToVenueId, mapStoreToVenueName } from '@/lib/venueMap';
import type { AccessEntry } from '@/lib/access';
import { Btn } from './atoms';
import { Ic } from './Icons';

/** Admin-only file picker that parses a Craftable AVT CSV export and inserts
 *  one kount_avt_reports row + many kount_avt_rows. Rows whose store label
 *  can't be mapped to a known venue are skipped with a visible warning, so
 *  the admin knows to update STORE_MAP before the next upload. */

const CHUNK_SIZE = 500;   // insert in batches to stay under PostgREST request limits

interface Props {
  user: AccessEntry;
  onUploaded?: () => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'success'; inserted: number; skipped: number }
  | { kind: 'error'; message: string };

export function AvtUpload({ user, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });

  if (user.role !== 'corporate') return null;   // admin-only per spec

  const trigger = () => { fileRef.current?.click(); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setState({ kind: 'parsing' });

    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setState({ kind: 'error', message: 'Could not read the file.' });
      return;
    }

    const rows = parseCSV(text);
    const header = findAvtHeaderColumns(rows);
    if (!header) {
      setState({ kind: 'error', message: 'No AVT header row found. Expect columns: STORE, ITEM, ACTUAL, THEO, VARIANCE.' });
      return;
    }

    const { headerRow, cols } = header;
    const dataRows = rows.slice(headerRow + 1);

    // Build the insert payloads
    const parsed: Array<{
      store: string | null; venue_id: string | null; venue_name: string | null;
      item_name: string; category: string | null;
      actual: number | null; theo: number | null; variance: number | null;
      variance_value: number | null; variance_pct: number | null;
      cu_price: number | null; start_qty: number | null; purchases: number | null; depletions: number | null;
    }> = [];
    const skippedStores = new Set<string>();

    for (const r of dataRows) {
      const item = String(r[cols.item] ?? '').trim();
      if (!item) continue;
      const storeRaw = String(r[cols.store] ?? '').trim() || null;
      const venueId = mapStoreToVenueId(storeRaw);
      if (!venueId) { if (storeRaw) skippedStores.add(storeRaw); continue; }
      parsed.push({
        store: storeRaw,
        venue_id: venueId,
        venue_name: mapStoreToVenueName(storeRaw),
        item_name: item,
        category: cols.category !== undefined ? (String(r[cols.category] ?? '').trim() || null) : null,
        actual:         cols.actual         !== undefined ? numOrNull(r[cols.actual])         : null,
        theo:           cols.theo           !== undefined ? numOrNull(r[cols.theo])           : null,
        variance:       cols.variance       !== undefined ? numOrNull(r[cols.variance])       : null,
        variance_value: cols.variance_value !== undefined ? numOrNull(r[cols.variance_value]) : null,
        variance_pct:   cols.variance_pct   !== undefined ? numOrNull(r[cols.variance_pct])   : null,
        cu_price:       cols.cu_price       !== undefined ? numOrNull(r[cols.cu_price])       : null,
        start_qty:      cols.start_qty      !== undefined ? numOrNull(r[cols.start_qty])      : null,
        purchases:      cols.purchases      !== undefined ? numOrNull(r[cols.purchases])      : null,
        depletions:     cols.depletions     !== undefined ? numOrNull(r[cols.depletions])     : null,
      });
    }

    if (parsed.length === 0) {
      setState({ kind: 'error', message: `No rows could be mapped to a venue. Unknown stores: ${[...skippedStores].join(', ') || 'none'}` });
      return;
    }

    // 1) insert the report row
    const venueIds = Array.from(new Set(parsed.map(p => p.venue_id!).filter(Boolean)));
    setState({ kind: 'uploading', done: 0, total: parsed.length });
    const { data: reportInsert, error: repErr } = await supabase
      .from('kount_avt_reports')
      .insert({
        uploaded_by_email: user.email,
        uploaded_by_name: user.name,
        file_name: file.name,
        row_count: parsed.length,
        venue_ids: venueIds,
      })
      .select()
      .single();
    if (repErr || !reportInsert) {
      setState({ kind: 'error', message: 'Could not create report: ' + (repErr?.message || 'unknown') });
      return;
    }
    const reportId = reportInsert.id as string;

    // 2) insert rows in batches
    for (let i = 0; i < parsed.length; i += CHUNK_SIZE) {
      const chunk = parsed.slice(i, i + CHUNK_SIZE).map(row => ({ ...row, report_id: reportId }));
      const { error } = await supabase.from('kount_avt_rows').insert(chunk);
      if (error) {
        setState({ kind: 'error', message: `Row batch ${i}..${i + chunk.length} failed: ${error.message}` });
        return;
      }
      setState({ kind: 'uploading', done: Math.min(i + CHUNK_SIZE, parsed.length), total: parsed.length });
    }

    setState({ kind: 'success', inserted: parsed.length, skipped: skippedStores.size });
    onUploaded?.();
  };

  const label =
    state.kind === 'parsing'   ? 'Parsing…'
  : state.kind === 'uploading' ? `Uploading ${state.done}/${state.total}…`
  : 'Upload AVT (CSV)';

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
      <Btn
        variant="secondary" size="sm"
        leading={Ic.upload(14)}
        onClick={trigger}
        disabled={state.kind === 'parsing' || state.kind === 'uploading'}
        title="Upload a Craftable AVT report (CSV). Inserts one kount_avt_reports row and many kount_avt_rows."
      >{label}</Btn>

      {state.kind === 'success' && (
        <span style={{ fontSize: 11, color: 'var(--teal-300)', marginLeft: 8 }}>
          ✓ {state.inserted} rows uploaded{state.skipped ? ` (${state.skipped} stores skipped)` : ''}
        </span>
      )}
      {state.kind === 'error' && (
        <span style={{ fontSize: 11, color: 'var(--raspberry-300)', marginLeft: 8 }}>
          {state.message}
        </span>
      )}
    </>
  );
}
