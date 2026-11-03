import { useEffect, useState } from 'react';
import type { OtDocument } from '@/lib/orderTracker';
import { documentUrl } from '@/lib/orderTrackerData';
import { sheetsFromFile, MAX_PREVIEW_ROWS, type SheetPreview } from '@/lib/sheetPreview';

/* Small pieces of the v0.87 order tracker design: icons, document chips, the document viewer. */

const PATHS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35',
  bell: 'M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2Zm-8 4a2 2 0 0 0 4 0',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  doc: 'M7 3h7l5 5v13H7V3Zm7 0v5h5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  clip: 'm20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
  open: 'M14 4h6v6m0-6-9 9M18 14v6H4V6h6',
};
export function Icon({ name }: { name: keyof typeof PATHS }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}

const KIND: Record<string, { ext: string; label: string; cls: string; order: number }> = {
  quote: { ext: 'Q', label: 'Quote', cls: 'q', order: 0 },
  confirmation: { ext: 'OC', label: 'Confirmation', cls: 'q', order: 1 },
  invoice: { ext: 'INV', label: 'Invoice', cls: 'i', order: 2 },
  shipping: { ext: 'SHP', label: 'Shipping', cls: '', order: 3 },
  payment: { ext: 'PAID', label: 'Check stub', cls: 'p', order: 4 },
};
export const isOtherDoc = (d: Pick<OtDocument, 'kind'>) => d.kind === 'other';
export const docSort = (a: OtDocument, b: OtDocument) => (KIND[a.kind]?.order ?? 9) - (KIND[b.kind]?.order ?? 9) || (a.doc_date ?? a.created_at).localeCompare(b.doc_date ?? b.created_at);
const extOf = (name: string | null) => (String(name ?? '').split('.').pop() ?? '').toUpperCase().slice(0, 4);
export const docTitle = (d: OtDocument) => (isOtherDoc(d) ? d.file_name ?? 'Attachment'
  : `${KIND[d.kind]?.label ?? d.kind}${d.doc_number ? ` ${d.doc_number}` : ''}`);

/** One document: quote / invoice / … with its number, or an attachment with its file type. */
export function DocChip({ d, onOpen, full = false }: { d: OtDocument; onOpen: (d: OtDocument) => void; full?: boolean }) {
  const k = KIND[d.kind];
  const other = isOtherDoc(d);
  const day = d.doc_date ? new Date(`${d.doc_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const name = other ? `${d.file_name ?? 'file'}${full && day ? ` · ${day}` : ''}` : full ? docTitle(d) : d.doc_number ?? k?.label ?? d.kind;
  return (
    <button type="button" className={`ot-doc ${other ? '' : k?.cls ?? ''}`} title={`${docTitle(d)}${d.file_name && !other ? ` · ${d.file_name}` : ''} — open`}
      onClick={e => { e.stopPropagation(); onOpen(d); }}>
      <span className="ext">{other ? extOf(d.file_name) || 'FILE' : k?.ext ?? 'DOC'}</span><span className="nm">{name}</span>
    </button>
  );
}

/** An attachment sent again and again (a weekly delivery-status sheet): its newest version only. */
export function latestByName(docs: OtDocument[]): OtDocument[] {
  const m = new Map<string, OtDocument>();
  for (const d of docs) {
    const k = (d.file_name ?? d.id).toLowerCase(), cur = m.get(k);
    if (!cur || (d.doc_date ?? d.created_at) > (cur.doc_date ?? cur.created_at)) m.set(k, d);
  }
  return [...m.values()];
}

/** A row's chips, a few then "+N". */
export function DocChips({ docs, onOpen, max = 3 }: { docs: OtDocument[]; onOpen: (d: OtDocument) => void; max?: number }) {
  if (!docs.length) return <span className="faint">—</span>;
  return (
    <div className="ot-docs">
      {docs.slice(0, max).map(d => <DocChip key={d.id} d={d} onOpen={onOpen} />)}
      {docs.length > max && <button type="button" className="ot-doc" onClick={e => { e.stopPropagation(); onOpen(docs[max]); }} title={docs.slice(max).map(docTitle).join(', ')}>+{docs.length - max}</button>}
    </div>
  );
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** A workbook's sheets as tables, like Excel: a tab per sheet, column letters, row numbers. */
function SheetTables({ sheets, tab, onTab }: { sheets: SheetPreview[]; tab: number; onTab: (i: number) => void }) {
  if (!sheets.length) return <div className="ot-empty"><p>The workbook has no sheets to show.</p></div>;
  const sh = sheets[tab];
  const width = sh.rows.reduce((w, r) => Math.max(w, r.length), 0);
  return (
    <div className="ot-sheet">
      {sheets.length > 1 && (
        <div className="ot-sheet-tabs" role="tablist">
          {sheets.map((x, i) => <button key={x.name + i} type="button" role="tab" aria-selected={i === tab} onClick={() => onTab(i)}>{x.name}</button>)}
        </div>
      )}
      <div className="ot-sheet-scroll">
        {!sh.rows.length ? <div className="ot-empty"><p>This sheet is empty.</p></div> : (
          <table>
            <thead><tr><th />{Array.from({ length: width }, (_, i) => <th key={i}>{colName(i)}</th>)}</tr></thead>
            <tbody>{sh.rows.map((r, ri) => (
              <tr key={ri}><th>{ri + 1}</th>{Array.from({ length: width }, (_, ci) => <td key={ci} className={/^-?[\d,.$%]+$/.test(r[ci] ?? '') ? 'n' : undefined}>{r[ci] ?? ''}</td>)}</tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {sh.truncated && <div className="ot-note warn" style={{ margin: 8 }}>Showing the first {MAX_PREVIEW_ROWS} rows / 60 columns — download it for the rest.</div>}
    </div>
  );
}

/** The document on this page: a PDF, picture or spreadsheet (.xlsx / .csv) shown; anything else (Word, old .xls) to download. */
export function DocViewer({ doc, onClose }: { doc: OtDocument; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!doc.storage_path) { setErr('This document has no file stored.'); return; }
    documentUrl(doc.storage_path).then(u => { if (live) setUrl(u); }).catch(e => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [doc.storage_path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const path = (doc.storage_path ?? '').toLowerCase();
  const pdf = path.endsWith('.pdf');
  const img = /\.(png|jpe?g|gif|webp)$/.test(path);
  const sheet = /\.(xlsx|csv)$/.test(path);
  // a spreadsheet is read in the browser and shown as tables (ExcelJS / CSV), one per sheet
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    if (!url || !sheet) return;
    let live = true;
    fetch(url).then(r => { if (!r.ok) throw new Error(`Could not load the file (${r.status}).`); return r.arrayBuffer(); })
      .then(buf => sheetsFromFile(doc.storage_path ?? '', buf))
      .then(sh => { if (live) setSheets(sh ?? []); })
      .catch(e => { if (live) setErr(`This spreadsheet could not be read here (${e instanceof Error ? e.message : String(e)}) — download it instead.`); });
    return () => { live = false; };
  }, [url, sheet, doc.storage_path]);
  return (
    <>
      <div className="ot-viewer-scrim" onClick={onClose} />
      <div className="ot-viewer ot" role="dialog" aria-modal="true" aria-label={docTitle(doc)}>
        <div className="ot-viewer-head">
          <div style={{ minWidth: 0 }}><b>{docTitle(doc)}</b> <span className="faint" style={{ fontSize: 12.5 }}>{[doc.file_name, doc.doc_date].filter(Boolean).join(' · ')}</span></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {url && <a className="ot-btn sm" href={url} target="_blank" rel="noopener noreferrer"><Icon name={pdf || img ? 'open' : 'download'} />{pdf || img ? 'Open in a tab' : 'Download'}</a>}
            <button type="button" className="ot-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </div>
        {err ? <div className="ot-empty"><p>{err}</p>{url && <a className="ot-btn primary" href={url} target="_blank" rel="noopener noreferrer"><Icon name="download" />Download</a>}</div>
          : !url || (sheet && !sheets) ? <div className="ot-empty"><p>Opening…</p></div>
          : pdf ? <iframe src={url} title={docTitle(doc)} />
          : sheet ? <SheetTables sheets={sheets!} tab={Math.min(tab, Math.max(0, sheets!.length - 1))} onTab={setTab} />
          : img ? <div className="img"><img src={url} alt={docTitle(doc)} /></div>
          : <div className="ot-empty"><h3>{doc.file_name}</h3><p>This file type can't be shown in the page.</p><a className="ot-btn primary" href={url} target="_blank" rel="noopener noreferrer"><Icon name="download" />Download</a></div>}
      </div>
    </>
  );
}
