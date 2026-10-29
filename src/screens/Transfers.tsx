import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES, isOrgWide } from '@/lib/access';
import { IN_SCOPE_CATEGORIES } from '@/lib/types';
import { Btn, Card, Eyebrow, Money, Pill } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   Transfers (v0.72) — stock moved from one venue to another.

   Recorded through kount_create_transfer (migration 0099): both venues must be
   visible to the user, counters cannot record, and each line's unit cost
   defaults to the sending venue's cost (then the catalog). compute_avt_for_audit
   counts a transfer IN like a purchase and OUT like a depletion in the audit
   window that holds its time; saving or deleting one recomputes the closed audits
   it falls into, so the variance includes it straight away.

   public.transfers stores KevaOS venue ids (venues.id); the screen maps them to
   counting venues through kount_venues.ops_venue_id.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

interface TransferLine { id: string; master_item_id: string | null; description: string | null; qty: number; unit_cost: number | null; line_total: number | null }
interface TransferRow {
  id: string; transfer_date: string; transferred_at: string | null; transferred_by: string | null;
  from_venue_id: string | null; to_venue_id: string | null; from_venue_name: string | null; to_venue_name: string | null;
  total_amount: number | null; note: string | null; created_by_email: string | null; external_source: string | null;
  transfer_lines: TransferLine[];
}
interface KvRow { id: string; name: string; ops_venue_id: string | null }
interface ItemHit { id: string; name: string; category: string | null }
interface DraftLine { key: number; item: ItemHit | null; qty: string; unitCost: string }

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. Exported for the unit test. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Validate a draft before calling the RPC. Returns an error message, or null when it can be saved. */
export function validateDraft(from: string, to: string, when: string, lines: DraftLine[]): string | null {
  if (!from || !to) return 'Pick both venues.';
  if (from === to) return 'The two venues must be different.';
  if (!when || Number.isNaN(new Date(when).getTime())) return 'Pick the date and time of the transfer.';
  const used = lines.filter(l => l.item || l.qty.trim());
  if (used.length === 0) return 'Add at least one item.';
  for (const l of used) {
    if (!l.item) return 'Every line needs an item.';
    const q = Number(l.qty);
    if (!Number.isFinite(q) || q <= 0) return `Enter a quantity above 0 for ${l.item.name}.`;
    if (l.unitCost.trim() && (!Number.isFinite(Number(l.unitCost)) || Number(l.unitCost) < 0)) return `The unit cost for ${l.item.name} is not a number.`;
  }
  return null;
}

let lineKey = 1;
const blankLine = (): DraftLine => ({ key: lineKey++, item: null, qty: '', unitCost: '' });

export function Transfers({ user }: Props) {
  const [kv, setKv] = useState<KvRow[]>([]);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [venueFilter, setVenueFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  // The save confirmation lives here, not in the form: saving closes the form,
  // which used to unmount the message the moment it appeared.
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const visibleVenues = useMemo(() => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    const [{ data: kvRows, error: kvErr }, { data: tRows, error: tErr }] = await Promise.all([
      supabase.from('kount_venues').select('id,name,ops_venue_id'),
      supabase.from('transfers').select('*, transfer_lines(*)').order('transfer_date', { ascending: false }).limit(300),
    ]);
    if (kvErr || tErr) {
      console.error('[transfers] load', kvErr ?? tErr);
      setLoadError((kvErr ?? tErr)!.message); setLoading(false); return;
    }
    setKv((kvRows as KvRow[]) ?? []);
    setRows((tRows as TransferRow[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const kvByOps = useMemo(() => new Map(kv.filter(k => k.ops_venue_id).map(k => [k.ops_venue_id as string, k])), [kv]);
  const visibleIds = useMemo(() => new Set(visibleVenues.map(v => v.id)), [visibleVenues]);

  const shown = useMemo(() => rows.filter(r => {
    const f = r.from_venue_id ? kvByOps.get(r.from_venue_id)?.id : undefined;
    const t = r.to_venue_id ? kvByOps.get(r.to_venue_id)?.id : undefined;
    if (!(isOrgWide(user.role) || user.venueIds === 'all') && !((f && visibleIds.has(f)) || (t && visibleIds.has(t)))) return false;
    if (venueFilter && f !== venueFilter && t !== venueFilter) return false;
    return true;
  }), [rows, kvByOps, visibleIds, venueFilter, user]);

  const totals = useMemo(() => ({
    count: shown.length,
    bottles: shown.reduce((s, r) => s + r.transfer_lines.reduce((a, l) => a + Number(l.qty || 0), 0), 0),
    cost: shown.reduce((s, r) => s + Number(r.total_amount || 0), 0),
  }), [shown]);

  const canDelete = (r: TransferRow) =>
    user.role === 'admin' || user.role === 'corporate' || (r.created_by_email ?? '').toLowerCase() === user.email.toLowerCase();

  const remove = async (r: TransferRow) => {
    if (!confirm(`Delete this transfer (${r.from_venue_name} → ${r.to_venue_name}, ${r.transfer_date})? The affected variance reports are recomputed.`)) return;
    const { data, error } = await supabase.rpc('kount_delete_transfer', { p_id: r.id });
    if (error) { alert('Delete failed: ' + error.message); return; }
    const codes = ((data as { recomputed?: string[] } | null)?.recomputed ?? []);
    if (codes.length) alert('Deleted. Recomputed: ' + codes.join(', '));
    void load();
  };

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Stock movement</Eyebrow>
          <h1>Transfers</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Bottles moved between venues. A transfer adds to the receiving venue's expected stock and takes it off the sender's, in the count window it falls into.
          </div>
        </div>
        <Btn variant="primary" size="sm" onClick={() => { setSavedMsg(null); setShowForm(s => !s); }}>{showForm ? 'Close form' : 'Record a transfer'}</Btn>
      </div>

      <div className="content">
        {showForm && (
          <TransferForm
            user={user}
            venues={visibleVenues}
            onSaved={(text) => { setSavedMsg(text); setShowForm(false); void load(); }}
          />
        )}
        {savedMsg && <div style={okBox}>{savedMsg}</div>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
          <select style={picker} value={venueFilter} onChange={e => setVenueFilter(e.target.value)}>
            <option value="">All venues</option>
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <Pill tone="neutral" size="sm">{loading ? 'loading…' : `${totals.count} transfers · ${totals.bottles} units`}</Pill>
          {!loading && <Money value={totals.cost} size={14} />}
        </div>

        {loadError && <div style={errBox}>Transfers could not be loaded: {loadError}</div>}

        <Card flush>
          {!loading && shown.length === 0 && !loadError && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)' }}>No transfers recorded{venueFilter ? ' for this venue' : ''} yet.</div>
          )}
          {shown.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
                <thead>
                  <tr style={headRow}>
                    <th style={th}>When</th><th style={th}>From → To</th><th style={th}>Items</th>
                    <th style={{ ...th, textAlign: 'right' }}>Units</th><th style={{ ...th, textAlign: 'right' }}>Cost</th>
                    <th style={th}>Transferred by</th><th style={th}>Recorded by</th><th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.transferred_at ? new Date(r.transferred_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : r.transfer_date}
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>{r.from_venue_name ?? '?'} → {r.to_venue_name ?? '?'}</td>
                      <td style={td}>
                        {r.transfer_lines.map(l => (
                          <div key={l.id}>{l.description ?? 'Item'} <span style={{ color: 'var(--fg-muted)' }}>× {Number(l.qty)}{l.unit_cost != null ? ` @ $${Number(l.unit_cost).toFixed(2)}` : ''}</span></div>
                        ))}
                        {r.note && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{r.note}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{r.transfer_lines.reduce((a, l) => a + Number(l.qty || 0), 0)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.total_amount != null ? <Money value={Number(r.total_amount)} size={13} bold={false} /> : '—'}</td>
                      <td style={td}>{r.transferred_by ?? '—'}</td>
                      <td style={{ ...td, color: 'var(--fg-muted)', fontSize: 12 }}>{r.created_by_email ?? (r.external_source ?? '—')}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {canDelete(r) && <Btn variant="ghost" size="sm" onClick={() => void remove(r)} style={{ color: 'var(--raspberry-300)' }}>Delete</Btn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function TransferForm({ user, venues, onSaved }: { user: AccessEntry; venues: Array<{ id: string; name: string }>; onSaved: (message: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [by, setBy] = useState(user.name);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setLine = (key: number, patch: Partial<DraftLine>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    const problem = validateDraft(from, to, when, lines);
    if (problem) { setMsg(problem); return; }
    setSaving(true); setMsg(null);
    const payload = lines.filter(l => l.item).map(l => ({
      master_item_id: l.item!.id, qty: Number(l.qty), ...(l.unitCost.trim() ? { unit_cost: Number(l.unitCost) } : {}),
    }));
    const { data, error } = await supabase.rpc('kount_create_transfer', {
      p_from_venue: from, p_to_venue: to, p_transferred_at: new Date(when).toISOString(),
      p_transferred_by: by, p_note: note, p_lines: payload,
    });
    setSaving(false);
    if (error) { setMsg('Not saved: ' + error.message); return; }
    const res = (data ?? {}) as { total?: number; recomputed?: string[] };
    onSaved(`Transfer saved ($${Number(res.total ?? 0).toFixed(2)}).` + (res.recomputed?.length ? ` Recomputed: ${res.recomputed.join(', ')}.` : ' It will count in the next variance report.'));
  };

  return (
    <Card padding={16} style={{ marginTop: 4 }}>
      <Eyebrow>Record a transfer</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
        <label style={lbl}>From venue
          <select style={picker} value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">Choose…</option>{venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label style={lbl}>To venue
          <select style={picker} value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Choose…</option>{venues.filter(v => v.id !== from).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label style={lbl}>When
          <input type="datetime-local" style={picker} value={when} onChange={e => setWhen(e.target.value)} />
        </label>
        <label style={lbl}>Transferred by
          <input style={picker} value={by} onChange={e => setBy(e.target.value)} placeholder="Name" />
        </label>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, fontWeight: 600 }}>Items</div>
      {lines.map(l => (
        <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6, flexWrap: 'wrap' }}>
          <ItemPicker value={l.item} onChange={item => setLine(l.key, { item })} />
          <input style={{ ...picker, width: 90 }} inputMode="decimal" placeholder="Qty" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} />
          <input style={{ ...picker, width: 130 }} inputMode="decimal" placeholder="Unit cost (auto)" value={l.unitCost} onChange={e => setLine(l.key, { unitCost: e.target.value })}
                 title="Leave blank to use the sending venue's cost" />
          {lines.length > 1 && <Btn variant="ghost" size="sm" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>Remove</Btn>}
        </div>
      ))}
      <div style={{ marginTop: 8 }}><Btn variant="secondary" size="sm" onClick={() => setLines(ls => [...ls, blankLine()])}>Add item</Btn></div>

      <label style={{ ...lbl, marginTop: 12 }}>Note (optional)
        <input style={picker} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. covering a shortage for Friday's event" />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <Btn variant="primary" size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save transfer'}</Btn>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Units are counted units (bottles, cans). Unit cost defaults to the sending venue's cost.</span>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--raspberry-300)' }}>{msg}</div>}
    </Card>
  );
}

function ItemPicker({ value, onChange }: { value: ItemHit | null; onChange: (i: ItemHit | null) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from('master_items').select('id,name,category')
        .eq('is_active', true).in('category', IN_SCOPE_CATEGORIES as unknown as string[])
        .ilike('name', '%' + term.replace(/[\\%_]/g, m => '\\' + m) + '%').order('name').limit(20);
      if (!live) return;
      if (error) { console.error('[transfers] item search', error); setHits([]); return; }
      setHits((data as ItemHit[]) ?? []); setOpen(true);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  if (value) {
    return (
      <div style={{ ...picker, minWidth: 280, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span>{value.name}</span>
        <button onClick={() => { onChange(null); setQ(''); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg-muted)' }} title="Change item">✕</button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', minWidth: 280 }}>
      <input style={{ ...picker, width: '100%' }} placeholder="Search an item (e.g. Ketel One 1L)" value={q}
             onChange={e => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 5, top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, maxHeight: 240, overflowY: 'auto', boxShadow: 'var(--shadow-sm)' }}>
          {hits.map(h => (
            <div key={h.id} onMouseDown={() => { onChange(h); setOpen(false); }}
                 style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}>
              {h.name} <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{h.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const picker: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '.05em' };
const headRow: React.CSSProperties = { textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
const th: React.CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const errBox: React.CSSProperties = { marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12 };
const okBox: React.CSSProperties = { marginTop: 4, padding: '10px 12px', borderRadius: 8, background: 'rgba(46,125,50,0.08)', border: '1px solid var(--positive, #2e7d32)', fontSize: 12, color: 'var(--positive, #2e7d32)' };
