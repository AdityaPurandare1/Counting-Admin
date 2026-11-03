import { useMemo, useState } from 'react';
import { Btn, Card, Eyebrow, Segment } from '@/components/atoms';
import { VENUES } from '@/lib/access';
import { isoDay, orderVenues, validateNewOrder, type DraftLine, type LineStatus, type OtItem, type OtOrder } from '@/lib/orderTracker';
import { createOrder } from '@/lib/orderTrackerData';
import { errBox, lbl, picker } from './shared';

let lineKey = 1;
const blank = (): DraftLine => ({ key: lineKey++, itemId: null, description: '', sku: '', qty: '', unit: '', unitPrice: '' });

/** Manual order entry: vendor, who it is for, lines (catalog items or free text). */
export function NewOrderForm({ items, orders, onSaved, onCancel }: {
  items: OtItem[]; orders: OtOrder[]; onSaved: (o: OtOrder) => void; onCancel: () => void;
}) {
  const [vendor, setVendor] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [venueId, setVenueId] = useState('');
  const [deliverTo, setDeliverTo] = useState<'warehouse' | 'venue'>('warehouse');
  const [orderedOn, setOrderedOn] = useState(isoDay(new Date()));
  const [expectedOn, setExpectedOn] = useState('');
  const [status, setStatus] = useState<LineStatus>('REQUESTED');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blank()]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const vendors = useMemo(() => [...new Set([...orders.map(o => o.vendor_name), ...items.map(i => i.vendor_name).filter(Boolean) as string[]])].sort(), [orders, items]);
  const activeItems = useMemo(() => items.filter(i => i.is_active).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const setLine = (key: number, patch: Partial<DraftLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const pickItem = (key: number, itemId: string) => {
    const it = items.find(i => i.id === itemId);
    if (!it) { setLine(key, { itemId: null }); return; }
    setLine(key, { itemId: it.id, description: it.name, sku: it.sku ?? '', unit: it.unit });
    if (!vendor && it.vendor_name) setVendor(it.vendor_name);
  };

  const save = async () => {
    const problem = validateNewOrder(vendor, lines);
    if (problem) { setErr(problem); return; }
    setSaving(true); setErr(null);
    try {
      const o = await createOrder({
        vendor_name: vendor.trim(), order_number: orderNumber.trim() || null, venue_id: venueId || null, deliver_to: deliverTo,
        ordered_on: orderedOn || null, expected_on: expectedOn || null, notes: notes.trim() || null,
      }, lines.filter(l => l.description.trim()).map(l => ({
        item_id: l.itemId, description: l.description.trim(), sku: l.sku.trim() || null, qty: Number(l.qty),
        unit: l.unit.trim() || null, unit_price: l.unitPrice.trim() ? Number(l.unitPrice) : null, status,
        quote_number: null, expected_on: expectedOn || null,
      })));
      onSaved(o);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  return (
    <Card padding={16} style={{ marginBottom: 14 }}>
      <Eyebrow>New order</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 10 }}>
        <label style={lbl}>Vendor
          <input style={picker} list="ot-vendors" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. EE Mercantile" />
          <datalist id="ot-vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist>
        </label>
        <label style={lbl}>Order / PO #
          <input style={picker} value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="optional" />
        </label>
        <label style={lbl}>For venue
          <select style={picker} value={venueId} onChange={e => setVenueId(e.target.value)}>
            <option value="">All / warehouse stock</option>
            {orderVenues(VENUES).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label style={lbl}>Ordered on
          <input type="date" style={picker} value={orderedOn} onChange={e => setOrderedOn(e.target.value)} />
        </label>
        <label style={lbl}>Expected
          <input type="date" style={picker} value={expectedOn} onChange={e => setExpectedOn(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <div style={{ width: 300 }}>
          <Segment<'warehouse' | 'venue'> value={deliverTo} onChange={setDeliverTo}
            options={[{ value: 'warehouse', label: 'Delivers to warehouse' }, { value: 'venue', label: 'Delivers to venue' }]} />
        </div>
        <div style={{ width: 320 }}>
          <Segment<LineStatus> value={status} onChange={setStatus} options={[
            { value: 'REQUESTED', label: 'Requested' }, { value: 'ORDERED', label: 'Ordered' }, { value: 'QUOTED', label: 'Quoted' },
          ]} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          {deliverTo === 'warehouse' ? 'Delivered lines can be received into warehouse stock.' : 'Goes straight to the venue — no warehouse stock.'}
        </span>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, fontWeight: 600 }}>Lines</div>
      {lines.map(l => (
        <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <select style={{ ...picker, width: 200 }} value={l.itemId ?? ''} onChange={e => pickItem(l.key, e.target.value)} title="A catalog item (tracks price and stock) or a one-off line">
            <option value="">One-off line…</option>
            {activeItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input style={{ ...picker, minWidth: 240, flex: 1 }} placeholder="Description" value={l.description} onChange={e => setLine(l.key, { description: e.target.value })} />
          <input style={{ ...picker, width: 110 }} placeholder="SKU" value={l.sku} onChange={e => setLine(l.key, { sku: e.target.value })} />
          <input style={{ ...picker, width: 80 }} inputMode="decimal" placeholder="Qty" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} />
          <input style={{ ...picker, width: 80 }} placeholder="Unit" value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} />
          <input style={{ ...picker, width: 110 }} inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={e => setLine(l.key, { unitPrice: e.target.value })} />
          {lines.length > 1 && <Btn variant="ghost" size="sm" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>Remove</Btn>}
        </div>
      ))}
      <div style={{ marginTop: 8 }}><Btn variant="secondary" size="sm" onClick={() => setLines(ls => [...ls, blank()])}>Add line</Btn></div>
      <label style={{ ...lbl, marginTop: 12 }}>Notes
        <input style={picker} value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" />
      </label>
      {err && <div style={errBox}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <Btn variant="primary" size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save order'}</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  );
}
