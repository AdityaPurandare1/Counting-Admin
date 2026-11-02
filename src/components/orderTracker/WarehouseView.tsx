import { Fragment, useMemo, useState } from 'react';
import { Btn, Card, Eyebrow, Pill } from '@/components/atoms';
import { VENUES } from '@/lib/access';
import { releasesByVenue, stockRows, type OtItem, type StockRow } from '@/lib/orderTracker';
import { addMove, deleteMove, saveItem, type ItemDraft, type TrackerData } from '@/lib/orderTrackerData';
import { errBox, fmtQty, headRow, lbl, linkBtn, picker, rowBorder, shortDate, smallInput, subTxt, tbl, td, tdNum, th, thR } from './shared';

const STATE_TONE: Record<StockRow['state'], 'critical' | 'caution' | 'positive' | 'ghost'> = {
  'reorder now': 'critical', 'reorder soon': 'caution', ok: 'positive', 'no usage yet': 'ghost',
};

type Action = { itemId: string; kind: 'release' | 'count' } | null;

export function WarehouseView({ data, today, venueName, onReload }: {
  data: TrackerData; today: string; venueName: (id: string | null) => string; onReload: () => void;
}) {
  const rows = useMemo(() => stockRows(data.items, data.moves, data.lines, data.orders, today)
    .sort((a, b) => rank(a.state) - rank(b.state) || a.item.name.localeCompare(b.item.name)), [data, today]);
  const untracked = data.items.filter(i => i.is_active && !i.track_stock);
  const [action, setAction] = useState<Action>(null);
  const [qty, setQty] = useState('');
  const [day, setDay] = useState(today);
  const [venue, setVenue] = useState('');
  const [note, setNote] = useState('');
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [editing, setEditing] = useState<OtItem | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); onReload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const start = (itemId: string, kind: 'release' | 'count') => { setAction({ itemId, kind }); setQty(''); setDay(today); setVenue(''); setNote(''); setErr(null); };
  const submit = () => {
    if (!action) return;
    const q = Number(qty);
    if (!Number.isFinite(q) || q < 0 || (action.kind === 'release' && q === 0)) { setErr(action.kind === 'release' ? 'Enter how many went out.' : 'Enter the counted quantity (0 is allowed).'); return; }
    if (action.kind === 'release' && !venue) { setErr('Pick the venue it went to.'); return; }
    void run(async () => {
      await addMove({ item_id: action.itemId, moved_on: day || today, kind: action.kind, qty: q, venue_id: action.kind === 'release' ? venue : null, line_id: null, note: note.trim() || null });
      setAction(null);
    });
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', maxWidth: 820 }}>
          On hand = last count + received − released. Use per month is the last 90 days of releases. The reorder date leaves the item's lead time
          (+25%) of stock, counting what is already on order; set a reorder point on the item to override it.
        </span>
        <div style={{ flex: 1 }} />
        <Btn variant="secondary" size="sm" onClick={() => setEditing('new')}>Add item</Btn>
      </div>

      {editing && <ItemForm item={editing === 'new' ? null : editing} onDone={() => { setEditing(null); onReload(); }} onCancel={() => setEditing(null)} />}
      {err && <div style={errBox}>{err}</div>}

      <Card flush padding={0}>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>No stocked items yet. "Add item", or tick "add to items" when saving a document.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...tbl, minWidth: 1000 }}>
              <thead><tr style={headRow}>
                <th style={th}>Item</th><th style={thR}>On hand</th><th style={thR} title="Still to come in: ordered, not received into the warehouse yet">Incoming</th>
                <th style={thR}>Used / month</th><th style={thR}>Cover</th><th style={th}>Reorder by</th><th style={th}>Status</th><th style={th} />
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.item.id}>
                    <tr style={rowBorder}>
                      <td style={{ ...td, maxWidth: 280 }}>
                        <button style={linkBtn} onClick={() => setOpenHist(openHist === r.item.id ? null : r.item.id)}>{r.item.name}</button>
                        <div style={subTxt}>{[r.item.sku, r.item.vendor_name, r.item.lead_time_days != null && `${r.item.lead_time_days}-day lead time`].filter(Boolean).join(' · ') || ' '}</div>
                      </td>
                      <td style={{ ...tdNum, fontWeight: 700 }}>{fmtQty(r.onHand)} <span style={subTxt}>{r.item.unit}</span></td>
                      <td style={tdNum}>{r.incoming ? fmtQty(r.incoming) : '—'}
                        {r.awaitingReceipt > 0 && <div style={subTxt}>{fmtQty(r.awaitingReceipt)} delivered, not received</div>}</td>
                      <td style={tdNum}>{r.monthlyUse ? fmtQty(Math.round(r.monthlyUse * 10) / 10) : '—'}</td>
                      <td style={tdNum}>{r.monthsCover != null ? `${(Math.round(r.monthsCover * 10) / 10).toFixed(1)} mo` : '—'}</td>
                      <td style={td}>{r.reorderBy ? shortDate(r.reorderBy) : '—'}{r.stockOutBy && <div style={subTxt}>runs out {shortDate(r.stockOutBy)}</div>}</td>
                      <td style={td}><Pill tone={STATE_TONE[r.state]} size="sm">{r.state}</Pill></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <Btn variant="secondary" size="sm" onClick={() => start(r.item.id, 'release')}>Release</Btn>{' '}
                        <Btn variant="ghost" size="sm" onClick={() => start(r.item.id, 'count')}>Count</Btn>{' '}
                        <Btn variant="ghost" size="sm" onClick={() => setEditing(r.item)}>Edit</Btn>
                      </td>
                    </tr>
                    {action?.itemId === r.item.id && (
                      <tr><td colSpan={8} style={{ ...td, background: 'var(--surface-alt)' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                          {action.kind === 'release' ? 'Released' : 'Counted on hand:'}
                          <input style={{ ...smallInput, width: 80 }} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} autoFocus /> {r.item.unit}
                          {action.kind === 'release' && (
                            <>to
                              <select style={smallInput} value={venue} onChange={e => setVenue(e.target.value)}>
                                <option value="">Venue…</option>
                                {VENUES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                              </select>
                            </>
                          )}
                          on <input type="date" style={smallInput} value={day} onChange={e => setDay(e.target.value)} />
                          <input style={{ ...smallInput, width: 200 }} placeholder="note (optional)" value={note} onChange={e => setNote(e.target.value)} />
                          <Btn variant="primary" size="sm" onClick={submit} disabled={busy}>Save</Btn>
                          <Btn variant="ghost" size="sm" onClick={() => setAction(null)}>Cancel</Btn>
                          {action.kind === 'count' && <span style={{ color: 'var(--fg-muted)' }}>Sets on hand to this number; later moves apply on top.</span>}
                        </div>
                      </td></tr>
                    )}
                    {openHist === r.item.id && (
                      <tr><td colSpan={8} style={{ ...td, background: 'var(--surface-alt)' }}>
                        <ItemHistory itemId={r.item.id} data={data} today={today} venueName={venueName} onDelete={id => void run(() => deleteMove(id))} />
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {untracked.length > 0 && (
        <div style={{ ...subTxt, marginTop: 8 }}>
          Not stocked (price-tracked only): {untracked.map((i, k) => (
            <span key={i.id}>{k ? ', ' : ''}<button style={{ ...linkBtn, fontWeight: 400 }} onClick={() => setEditing(i)}>{i.name}</button></span>
          ))}
        </div>
      )}
    </>
  );
}

const rank = (s: StockRow['state']) => ({ 'reorder now': 0, 'reorder soon': 1, ok: 2, 'no usage yet': 3 })[s];

function ItemHistory({ itemId, data, today, venueName, onDelete }: {
  itemId: string; data: TrackerData; today: string; venueName: (id: string | null) => string; onDelete: (id: string) => void;
}) {
  const moves = data.moves.filter(m => m.item_id === itemId).sort((a, b) => (a.moved_on === b.moved_on ? b.created_at.localeCompare(a.created_at) : a.moved_on < b.moved_on ? 1 : -1));
  const byVenue = releasesByVenue(data.moves, itemId, today);
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
      <div style={{ minWidth: 220 }}>
        <Eyebrow>Released, last 90 days</Eyebrow>
        {byVenue.length === 0 && <div style={{ color: 'var(--fg-muted)', marginTop: 4 }}>None.</div>}
        {byVenue.map(v => <div key={v.venueId ?? '-'} style={{ marginTop: 4 }}>{venueName(v.venueId)}: <b>{fmtQty(v.qty)}</b> ({fmtQty(Math.round(v.qty / 3 * 10) / 10)} / month)</div>)}
      </div>
      <div style={{ flex: 1, minWidth: 360 }}>
        <Eyebrow>Stock movements</Eyebrow>
        {moves.length === 0 && <div style={{ color: 'var(--fg-muted)', marginTop: 4 }}>None yet.</div>}
        {moves.slice(0, 40).map(m => (
          <div key={m.id} style={{ marginTop: 3 }}>
            {shortDate(m.moved_on)} · <b>{m.kind === 'receipt' ? '+' : m.kind === 'release' ? '−' : '='}{fmtQty(m.qty)}</b> {m.kind}
            {m.venue_id ? ` → ${venueName(m.venue_id)}` : ''}{m.note ? ` · ${m.note}` : ''}
            <span style={{ color: 'var(--fg-muted)' }}> {m.created_by ?? ''}</span>{' '}
            <button style={{ ...linkBtn, fontWeight: 400, fontSize: 11, color: 'var(--fg-muted)' }} onClick={() => { if (confirm('Delete this stock entry?')) onDelete(m.id); }}>delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemForm({ item, onDone, onCancel }: { item: OtItem | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: item?.name ?? '', sku: item?.sku ?? '', vendor: item?.vendor_name ?? '', category: item?.category ?? '', unit: item?.unit ?? 'case',
    pack: item?.pack_size != null ? String(item.pack_size) : '', lead: item?.lead_time_days != null ? String(item.lead_time_days) : '',
    rp: item?.reorder_point != null ? String(item.reorder_point) : '', track: item?.track_stock ?? true, notes: item?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
  const save = async () => {
    if (!f.name.trim()) { setErr('Enter the item name.'); return; }
    for (const [label, v] of [['Pack size', f.pack], ['Lead time', f.lead], ['Reorder point', f.rp]] as const) {
      if (v.trim() && (!Number.isFinite(Number(v)) || Number(v) < 0)) { setErr(`${label} must be a number.`); return; }
    }
    if (f.pack.trim() && Number(f.pack) === 0) { setErr('Pieces per unit must be above 0 (or left blank).'); return; }
    setBusy(true); setErr(null);
    const draft: ItemDraft = {
      name: f.name.trim(), sku: f.sku.trim() || null, vendor_name: f.vendor.trim() || null, category: f.category.trim() || null,
      unit: f.unit.trim() || 'case', pack_size: numOrNull(f.pack), lead_time_days: f.lead.trim() ? Math.round(Number(f.lead)) : null,
      reorder_point: numOrNull(f.rp), track_stock: f.track, notes: f.notes.trim() || null,
    };
    try { await saveItem(item?.id ?? null, draft); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f, v: string | boolean) => setF(x => ({ ...x, [k]: v }));
  return (
    <Card padding={16} style={{ marginBottom: 12 }}>
      <Eyebrow>{item ? 'Edit item' : 'Add item'}</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
        <label style={{ ...lbl, gridColumn: 'span 2' }}>Name<input style={picker} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Delilah to-go bag (large)" /></label>
        <label style={lbl}>SKU<input style={picker} value={f.sku} onChange={e => set('sku', e.target.value)} /></label>
        <label style={lbl}>Vendor<input style={picker} value={f.vendor} onChange={e => set('vendor', e.target.value)} /></label>
        <label style={lbl}>Category<input style={picker} value={f.category} onChange={e => set('category', e.target.value)} placeholder="custom printed…" /></label>
        <label style={lbl}>Unit<input style={picker} value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="case" /></label>
        <label style={lbl}>Pieces per unit<input style={picker} inputMode="decimal" value={f.pack} onChange={e => set('pack', e.target.value)} /></label>
        <label style={lbl}>Lead time (days)<input style={picker} inputMode="numeric" value={f.lead} onChange={e => set('lead', e.target.value)} placeholder="e.g. 84" /></label>
        <label style={lbl}>Reorder point<input style={picker} inputMode="decimal" value={f.rp} onChange={e => set('rp', e.target.value)} placeholder="auto" /></label>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 10 }}>
        <input type="checkbox" checked={f.track} onChange={e => set('track', e.target.checked)} /> Track warehouse stock for this item
      </label>
      {err && <div style={errBox}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Btn variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save item'}</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  );
}
