import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { VENUES } from '@/lib/access';
import { orderVenues } from '@/lib/orderTracker';
import { bibleFromCsv, bibleTextIndex, loadBible, type BibleBook, type BibleSheet } from '@/lib/bibleRender';
import { parseCsv } from '@/lib/sheetPreview';
import { documentUrl, loadBibles, saveBibleIndex, uploadBible, type Bible } from '@/lib/orderTrackerData';
import { shortDate } from './shared';
import { Icon } from './ui';

/** Each venue's OS&E bible, drawn as it looks in Excel (bibleRender): pick the venue, then the sheet. */
const cache = new Map<string, Promise<BibleBook>>();             // a workbook once per session (they run to 25 MB)
const ROW_HEAD = 40, COL_HEAD = 22;

export function BibleView() {
  const [bibles, setBibles] = useState<Bible[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [venue, setVenue] = useState('');
  const [bibleId, setBibleId] = useState('');
  const venues = useMemo(() => orderVenues(VENUES), []);
  const reload = () => loadBibles().then(setBibles).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void reload(); }, []);

  const withBible = useMemo(() => venues.filter(v => bibles?.some(b => b.venue_id === v.id)), [venues, bibles]);
  useEffect(() => { if (!venue && withBible.length) setVenue(withBible[0].id); }, [withBible, venue]);
  const mine = useMemo(() => (bibles ?? []).filter(b => b.venue_id === venue), [bibles, venue]);
  useEffect(() => { if (!mine.some(b => b.id === bibleId)) setBibleId(mine[0]?.id ?? ''); }, [mine, bibleId]);
  const bible = mine.find(b => b.id === bibleId) ?? null;

  return (
    <>
      <div className="ot-toolbar">
        <div className="ot-seg" role="group" aria-label="Venue">
          {withBible.map(v => <button key={v.id} type="button" aria-pressed={venue === v.id} onClick={() => setVenue(v.id)}>{v.name}</button>)}
        </div>
        <AddBible venues={venues.filter(v => !withBible.some(w => w.id === v.id))} onDone={id => { setVenue(id); void reload(); }} />
        {mine.length > 1 && (
          <select className="ot-sel" value={bibleId} onChange={e => setBibleId(e.target.value)} aria-label="Bible">
            {mine.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        )}
      </div>
      {err && <div className="ot-note crit">{err}</div>}
      {!bibles ? <div className="ot-card"><div className="ot-empty"><p>Loading…</p></div></div>
        : !bible ? <div className="ot-card"><div className="ot-empty"><h3>No bible yet</h3><p>Add a venue's bible (the Excel workbook) and it shows here as it looks in Excel.</p></div></div>
        : <BibleDoc key={bible.id} bible={bible} onReplaced={() => void reload()} />}
    </>
  );
}

function AddBible({ venues, onDone }: { venues: Array<{ id: string; name: string }>; onDone: (venueId: string) => void }) {
  const [venue, setVenue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  if (!venues.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select className="ot-sel" value={venue} onChange={e => setVenue(e.target.value)} aria-label="Add a bible for">
        <option value="">Add a bible for…</option>
        {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {venue && <button type="button" className="ot-btn sm" disabled={busy} onClick={() => ref.current?.click()}><Icon name="plus" />{busy ? 'Uploading…' : 'Choose the workbook'}</button>}
      <input ref={ref} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f || !venue) return;
        setBusy(true); setErr(null);
        uploadBible(venue, f.name.replace(/\.(xlsx|csv)$/i, '').replace(/\s*\(\d+\)$/, ''), f, null).then(() => onDone(venue))
          .catch(x => setErr(x instanceof Error ? x.message : String(x))).finally(() => setBusy(false));
      }} />
      {err && <span style={{ color: 'var(--ot-crit)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}

function BibleDoc({ bible, onReplaced }: { bible: Bible; onReplaced: () => void }) {
  const [book, setBook] = useState<BibleBook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState(0);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const csv = bible.storage_path.endsWith('.csv');
    const p = cache.get(bible.storage_path) ?? documentUrl(bible.storage_path)
      .then(u => fetch(u)).then(r => { if (!r.ok) throw new Error(`Could not load the file (${r.status}).`); return r.arrayBuffer(); })
      .then(buf => (csv ? bibleFromCsv(parseCsv(new TextDecoder().decode(buf)), bible.title) : loadBible(buf)));
    cache.set(bible.storage_path, p);
    p.then(b => {
      if (!live) return;
      const m = new Map<string, string>();
      for (const [k, v] of b.media) m.set(k, URL.createObjectURL(new Blob([v.bytes as Uint8Array<ArrayBuffer>], { type: v.mime })));
      setUrls(m); setBook(b); setSheet(0);
      // the first time it is opened, its text is kept for Ask AI (0145)
      if (!bible.text_index) void saveBibleIndex(bible.id, bibleTextIndex(b)).catch(() => undefined);
    }).catch(e => { cache.delete(bible.storage_path); if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [bible.storage_path, bible.title, bible.id, bible.text_index]);
  useEffect(() => () => { for (const u of urls.values()) URL.revokeObjectURL(u); }, [urls]);

  const download = async () => { try { window.open(await documentUrl(bible.storage_path), '_blank', 'noopener'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };

  return (
    <div className="ot-card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--ot-line)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{bible.title}</div>
          <div className="faint" style={{ fontSize: 12.5 }}>{[bible.file_name, bible.size_bytes ? `${(bible.size_bytes / 1e6).toFixed(1)} MB` : '', `added ${shortDate(bible.created_at)}`, bible.uploaded_by].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="ot-btn sm" onClick={() => void download()}><Icon name="download" />Download</button>
        <button type="button" className="ot-btn sm" disabled={busy} onClick={() => ref.current?.click()} title="Upload the updated workbook — this one is kept as the earlier version">
          <Icon name="plus" />{busy ? 'Uploading…' : 'Upload new version'}</button>
        <input ref={ref} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setBusy(true); setErr(null);
          uploadBible(bible.venue_id, bible.title, f, bible.id).then(onReplaced).catch(x => setErr(x instanceof Error ? x.message : String(x))).finally(() => setBusy(false));
        }} />
      </div>
      {err ? <div className="ot-empty"><p>{err}</p></div>
        : !book ? <div className="ot-empty"><p>Opening {bible.title}{bible.size_bytes && bible.size_bytes > 5e6 ? ` (${(bible.size_bytes / 1e6).toFixed(0)} MB, pictures included)` : ''}…</p></div>
        : (
          <>
            {book.sheets.length > 1 && (
              <div className="ot-sheet-tabs" role="tablist" style={{ background: 'var(--ot-surface)' }}>
                {book.sheets.map((s, i) => <button key={s.name + i} type="button" role="tab" aria-selected={i === sheet} onClick={() => setSheet(i)}>{s.name}</button>)}
              </div>
            )}
            {book.sheets[sheet] ? <BibleGrid sheet={book.sheets[sheet]} urls={urls} /> : <div className="ot-empty"><p>This workbook has no sheets to show.</p></div>}
          </>
        )}
    </div>
  );
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** One sheet as Excel draws it: fixed column widths and row heights, fills / fonts / borders, merges,
 *  frozen rows / columns, links, pictures in cells and floating pictures by their anchors. */
function BibleGrid({ sheet, urls }: { sheet: BibleSheet; urls: Map<string, string> }) {
  const cols = sheet.colWidths.map((w, i) => ({ w, i })).filter(c => c.w > 0);
  const total = cols.reduce((s, c) => s + c.w, 0);
  const frozenTop: number[] = [];
  let acc = COL_HEAD;
  sheet.rows.forEach((r, i) => { frozenTop[i] = acc; if (i < sheet.frozenRows) acc += r.height; });
  const frozenLeft: number[] = [];
  let lft = ROW_HEAD;
  sheet.colWidths.forEach((w, i) => { frozenLeft[i] = lft; if (i < sheet.frozenCols) lft += w; });
  const floatsAt = new Map<string, typeof sheet.floats>();
  for (const f of sheet.floats) (floatsAt.get(`${f.row}:${f.col}`) ?? floatsAt.set(`${f.row}:${f.col}`, []).get(`${f.row}:${f.col}`)!).push(f);
  return (
    <div className="ot-bible-scroll">
      <div style={{ position: 'relative', width: total + ROW_HEAD }}>
        <table className="ot-bible" style={{ width: total + ROW_HEAD }}>
          <colgroup><col style={{ width: ROW_HEAD }} />{cols.map(c => <col key={c.i} style={{ width: c.w }} />)}</colgroup>
          <thead><tr style={{ height: COL_HEAD }}><th className="corner" />{cols.map(c => <th key={c.i} className="ch">{colName(c.i)}</th>)}</tr></thead>
          <tbody>
            {sheet.rows.map((r, ri) => (r.height === 0 ? null : (
              <tr key={ri} style={{ height: r.height }}>
                <th className="rh" style={ri < sheet.frozenRows ? { position: 'sticky', top: frozenTop[ri], zIndex: 4 } : undefined}>{ri + 1}</th>
                {cols.map(({ i: ci }) => {
                  const c = r.cells[ci];
                  if (!c || c.covered) return null;
                  const frozenR = ri < sheet.frozenRows, frozenC = ci < sheet.frozenCols;
                  const style: CSSProperties = {
                    ...(c.style as CSSProperties), height: r.height, maxHeight: r.height,
                    ...(frozenR || frozenC ? { position: 'sticky', zIndex: frozenR && frozenC ? 3 : 2, background: (c.style.background as string) ?? '#FFFFFF',
                      ...(frozenR ? { top: frozenTop[ri] } : {}), ...(frozenC ? { left: frozenLeft[ci] } : {}) } : {}),
                  };
                  const src = c.image ? urls.get(c.image) : undefined;
                  // floating pictures ride in their anchor cell (positioned, so they stay with a frozen cell)
                  const here = floatsAt.get(`${ri}:${ci}`);
                  if (here) { if (style.position !== 'sticky') style.position = 'relative'; style.overflow = 'visible'; }
                  return (
                    <td key={ci} rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined} colSpan={c.colSpan > 1 ? c.colSpan : undefined} style={style}>
                      {here?.map((f, k) => { const u = urls.get(f.media); return u ? <img key={k} src={u} alt="" className="float" style={{ left: f.dx, top: f.dy, width: f.width, height: f.height }} /> : null; })}
                      {src ? <img src={src} alt="" className="cellimg" style={{ maxHeight: Math.max(16, r.height * Math.max(1, c.rowSpan) - 4) }} />
                        : c.link ? <a href={c.link} target="_blank" rel="noopener noreferrer">{c.text || c.link}</a>
                        : c.text}
                    </td>
                  );
                })}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {sheet.truncated && <div className="ot-note warn" style={{ margin: 8 }}>A very large sheet: showing its first rows / columns — download the workbook for all of it.</div>}
    </div>
  );
}
