import { useEffect, useMemo, useState } from 'react';
import { Btn, Card, Eyebrow, Pill } from '@/components/atoms';
import { VENUES } from '@/lib/access';
import {
  DOC_KIND_LABEL, STATUS_LABEL, documentChecks, matchOrder, planDocRows, planDocumentSave, statusAfterDocument, headlineStatus,
  type DocKind, type DocRowPlan, type LineStatus,
} from '@/lib/orderTracker';
import {
  AlreadySavedError, applyDocument, readDocument, removeDocumentPdf, uploadDocumentPdf,
  type ReadDocument, type TrackerData,
} from '@/lib/orderTrackerData';
import { errBox, fmtMoney, headRow, lbl, okBox, picker, rowBorder, smallInput, subTxt, tbl, td, tdNum, th, thR } from './shared';

/** Upload a vendor PDF → AI reads it → the person checks it → save updates the order. */
export function DocumentReview({ file, data, today, onDone, onCancel }: {
  file: File; data: TrackerData; today: string; onDone: (orderId: string) => void; onCancel: () => void;
}) {
  const [doc, setDoc] = useState<ReadDocument | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [kind, setKind] = useState<DocKind>('invoice');
  const [vendor, setVendor] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [expected, setExpected] = useState('');
  const [tracking, setTracking] = useState('');
  const [target, setTarget] = useState<string>('new');
  const [deliverTo, setDeliverTo] = useState<'warehouse' | 'venue'>('warehouse');
  const [venueId, setVenueId] = useState('');
  const [rows, setRows] = useState<DocRowPlan[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // One id per review: the PDF is stored under it and the database refuses a
  // second save of it, so a retry after a dropped connection cannot double-count.
  const docId = useMemo(() => crypto.randomUUID(), [file]);

  // 1. read the PDF — once per file (each read is a paid AI call; a data reload must not repeat it)
  useEffect(() => {
    let live = true;
    readDocument(file).then(d => {
      if (!live) return;
      setDoc(d);
      setKind(d.doc_kind);
      setVendor(d.vendor_name);
      setDocNumber(d.doc_number);
      setDocDate(/^\d{4}-\d{2}-\d{2}$/.test(d.doc_date) ? d.doc_date : '');
      setOrderNumber(d.order_number);
      setExpected(/^\d{4}-\d{2}-\d{2}$/.test(d.expected_date) ? d.expected_date : '');
      setTracking((d.tracking_numbers || []).join(', '));
    }).catch(e => { if (live) setReadErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [file]);

  // the order it belongs to, picked once when the reading arrives (the person can change it)
  useEffect(() => {
    if (!doc) return;
    const o = matchOrder(data.orders, data.lines, { order_number: doc.order_number, doc_number: doc.doc_number, kind: doc.doc_kind, vendor_name: doc.vendor_name });
    setTarget(o?.id ?? 'new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const order = target === 'new' ? null : data.orders.find(o => o.id === target) ?? null;
  const orderLines = useMemo(() => (target === 'new' ? [] : data.lines.filter(l => l.order_id === target).sort((a, b) => a.sort - b.sort)), [target, data.lines]);

  // 2. plan each document line against the chosen order — only when the reading, the order or the
  //    document type changes, so a background reload never wipes the person's ticks and choices
  useEffect(() => {
    if (!doc) return;
    setRows(planDocRows(doc.lines, orderLines, data.items, kind, doc.is_credit === true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, target, kind]);

  const setRow = (i: number, patch: Partial<DocRowPlan>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // checks a person should see before saving
  const checks = useMemo(() => (doc
    ? documentChecks({ kind, vendor, docNumber, order, orderLines, rows }, doc, data, fmtMoney)
    : []), [doc, kind, vendor, docNumber, order, orderLines, rows, data]);

  const save = async () => {
    if (!doc || saved) return;
    if (!vendor.trim()) { setSaveErr('Enter the vendor.'); return; }
    if (!rows.some(r => r.include)) { setSaveErr('Tick at least one line to save, or cancel.'); return; }
    setSaving(true); setSaveErr(null);
    let path: string | null = null;
    try {
      path = await uploadDocumentPdf(docId, file);
      const orderId = await applyDocument(planDocumentSave({
        docId, kind, vendor, docNumber, docDate, orderNumber, expected, tracking, order, orderLines, deliverTo, venueId,
        rows, today, fileName: file.name, storagePath: path, total: doc.total, parsed: doc,
      }));
      setSaved(true);
      onDone(orderId);
    } catch (e) {
      if (e instanceof AlreadySavedError) {
        setSaved(true);
        setSaveErr('This document is already saved — an earlier try went through. Close this and check the order.');
      } else {
        // a database refusal means nothing was written, so the stored PDF goes too; a dropped
        // connection is left alone (the save may have gone through — a retry will say so)
        const refused = !!(e as { refused?: boolean }).refused;
        if (refused && path) await removeDocumentPdf(path).catch(() => undefined);
        setSaveErr((e instanceof Error ? e.message : String(e)) +
          (refused ? ' — nothing was saved.' : ' — the connection dropped before the save was confirmed. Try again: if it went through, you will be told.'));
      }
    } finally { setSaving(false); }
  };

  const openOrders = data.orders.filter(o => !o.archived_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const headline = (id: string) => headlineStatus(data.lines.filter(l => l.order_id === id));

  return (
    <Card padding={16} style={{ marginBottom: 14 }}>
      <Eyebrow>Add a document · {file.name}</Eyebrow>
      {!doc && !readErr && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--fg-secondary)' }}>Reading the PDF… (usually 10–40 seconds)</div>}
      {readErr && (
        <>
          <div style={errBox}>Could not read this PDF: {readErr}</div>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Close</Btn>
        </>
      )}
      {doc && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
            <label style={lbl}>Document
              <select style={picker} value={kind} onChange={e => setKind(e.target.value as DocKind)}>
                {(Object.keys(DOC_KIND_LABEL) as DocKind[]).map(k => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label style={lbl}>Vendor<input style={picker} value={vendor} onChange={e => setVendor(e.target.value)} /></label>
            <label style={lbl}>Document #<input style={picker} value={docNumber} onChange={e => setDocNumber(e.target.value)} /></label>
            <label style={lbl}>Date<input type="date" style={picker} value={docDate} onChange={e => setDocDate(e.target.value)} /></label>
            <label style={lbl}>Your PO / order #<input style={picker} value={orderNumber} onChange={e => setOrderNumber(e.target.value)} /></label>
            <label style={lbl}>Expected<input type="date" style={picker} value={expected} onChange={e => setExpected(e.target.value)} /></label>
            {(kind === 'shipping' || tracking) && <label style={lbl}>Tracking<input style={picker} value={tracking} onChange={e => setTracking(e.target.value)} /></label>}
          </div>
          {(doc.bill_to || doc.ship_to) && <div style={{ ...subTxt, marginTop: 6 }}>Bill to: {doc.bill_to || '—'} · Ship to: {doc.ship_to || '—'}</div>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
            <label style={{ ...lbl, minWidth: 320 }}>Goes on order
              <select style={picker} value={target} onChange={e => setTarget(e.target.value)}>
                <option value="new">A new order</option>
                {openOrders.map(o => {
                  const h = headline(o.id);
                  return <option key={o.id} value={o.id}>{o.order_number || 'No order #'} · {o.vendor_name}{h ? ` · ${STATUS_LABEL[h]}` : ''}</option>;
                })}
              </select>
            </label>
            {target === 'new' && (
              <>
                <label style={lbl}>Delivers to
                  <select style={picker} value={deliverTo} onChange={e => setDeliverTo(e.target.value as 'warehouse' | 'venue')}>
                    <option value="warehouse">Warehouse</option><option value="venue">Venue</option>
                  </select>
                </label>
                <label style={lbl}>For venue
                  <select style={picker} value={venueId} onChange={e => setVenueId(e.target.value)}>
                    <option value="">All / warehouse stock</option>
                    {VENUES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
              </>
            )}
            {target !== 'new' && <Pill tone="positive" size="sm">matched by {normMatchReason(orderNumber, docNumber, data, target)}</Pill>}
          </div>

          {checks.length > 0 && <div style={errBox}>{checks.map((c, i) => <div key={i}>⚠ {c}</div>)}</div>}
          {checks.length === 0 && <div style={okBox}>The lines agree with the printed totals.</div>}

          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ ...tbl, minWidth: 980 }}>
              <thead><tr style={headRow}>
                <th style={th}>Save</th><th style={th}>Line as printed</th><th style={thR}>Qty</th><th style={thR}>Price</th><th style={thR}>Total</th>
                <th style={th}>Updates</th><th style={th}>Catalog item</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ ...rowBorder, opacity: r.include ? 1 : 0.55 }}>
                    <td style={td}><input type="checkbox" checked={r.include} onChange={e => setRow(i, { include: e.target.checked })} /></td>
                    <td style={{ ...td, maxWidth: 300 }}>
                      <div style={{ fontWeight: 600 }}>{r.doc.description}</div>
                      <div style={subTxt}>{[r.doc.line_kind !== 'product' && r.doc.line_kind, r.doc.sku, r.doc.pack_size > 0 && `${r.doc.pack_size} per ${r.doc.unit || 'unit'}`].filter(Boolean).join(' · ') || ' '}</div>
                    </td>
                    <td style={tdNum}>{r.doc.qty} <span style={subTxt}>{r.doc.unit}</span></td>
                    <td style={tdNum}>{fmtMoney(r.doc.unit_price)}</td>
                    <td style={tdNum}>{fmtMoney(r.doc.line_total)}</td>
                    <td style={td}>
                      <select style={{ ...smallInput, maxWidth: 260 }} value={r.target} onChange={e => setRow(i, { target: e.target.value })}>
                        <option value="new">Add as a new line</option>
                        {orderLines.map(l => <option key={l.id} value={l.id}>{l.description} · {STATUS_LABEL[l.status]}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select style={{ ...smallInput, maxWidth: 220 }} value={r.itemId} onChange={e => setRow(i, { itemId: e.target.value, addItem: false })}>
                        <option value="">None</option>
                        {data.items.filter(it => it.is_active).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </select>
                      {!r.itemId && r.doc.line_kind === 'product' && (
                        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, marginTop: 4, color: 'var(--fg-secondary)' }}>
                          <input type="checkbox" checked={r.addItem} onChange={e => setRow(i, { addItem: e.target.checked })} /> add to items (track price + stock)
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ ...subTxt, marginTop: 6 }}>
            Saving moves each line to <b>{STATUS_LABEL[(statusAfterDocument(null, kind) ?? 'ORDERED') as LineStatus]}</b> (never backwards),
            {kind === 'invoice' ? ' records the invoice # and price,' : kind === 'quote' ? ' records the quote # and price,' : kind === 'shipping' ? ' records the tracking #,' : ''} and stores the PDF on the order.
            Document total {fmtMoney(doc.total)}.
          </div>
          {saveErr && <div style={errBox}>{saveErr}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Btn variant="primary" size="sm" onClick={() => void save()} disabled={saving || saved}>{saving ? 'Saving…' : 'Save to order'}</Btn>
            <Btn variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Btn>
          </div>
        </>
      )}
    </Card>
  );
}

function normMatchReason(orderNumber: string, docNumber: string, data: TrackerData, target: string): string {
  const o = data.orders.find(x => x.id === target);
  if (o && orderNumber && (o.order_number ?? '').toLowerCase().replace(/\W/g, '') === orderNumber.toLowerCase().replace(/\W/g, '')) return 'PO #';
  if (docNumber && data.lines.some(l => l.order_id === target && ((l.quote_number ?? '') === docNumber || (l.invoice_number ?? '') === docNumber))) return 'document #';
  return 'your choice';
}
