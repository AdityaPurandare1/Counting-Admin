import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import { Btn, Card, Eyebrow, Pill } from '@/components/atoms';
import { orderVenueName } from '@/lib/orderTracker';
import {
  checkNow, counts, FILTER_LABEL, FILTERS, fmtUnit, itemView, loadPriceCheck, MODELS, needsQuote, rowsFor, runLine, setQuote, setSettings, startRun, syncBibles,
  VIEW_LABEL, VIEW_TONE, type PcCheck, type PcData, type PcFilter, type PcItem,
} from '@/lib/priceCheck';
import { errBox, headRow, okBox, picker, rowBorder, shortDate, smallInput, subTxt, tbl, td, tdNum, th, thR } from '@/components/orderTracker/shared';

/* ───────────────────────────────────────────────────────────────────────
   Price check (v1.23, migration 0176) — Purchasing. Every bible item is
   checked weekly against the web for the EXACT item (manufacturer item #
   and every spec); the cheapest exact offer per piece against what we paid
   in the order tracker. Sellers that only quote are tagged Quote required.
   Logic: src/lib/priceCheck.ts; the work: kount-price-check.
   ─────────────────────────────────────────────────────────────────────── */

const venueName = (id: string) => orderVenueName(id, VENUES);
const PAGE = 100;

export function PriceCheck({ user, load = loadPriceCheck }: { user: AccessEntry; load?: () => Promise<PcData> }) {
  const [data, setData] = useState<PcData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<PcFilter>('overpaying');
  const [venue, setVenue] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const s = ++seq.current;
    try { const d = await load(); if (s === seq.current) { setData(d); setError(null); } }
    catch (e) { if (s === seq.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [load]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setShown(PAGE); }, [filter, venue, q]);

  const run = async (label: string, f: () => Promise<string | void>) => {
    setBusy(label); setNote(null); setError(null);
    try { const m = await f(); if (m) setNote(m); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const n = useMemo(() => (data ? counts(data, venue, q) : null), [data, venue, q]);
  const rows = useMemo(() => (data ? rowsFor(data, filter, venue, q) : []), [data, filter, venue, q]);
  const venues = useMemo(() => (data ? [...new Set(data.items.flatMap(i => i.sources.map(s => s.venue_id)))].sort((a, b) => venueName(a).localeCompare(venueName(b))) : []), [data]);
  const st = data?.settings ?? null;
  const lastRun = data?.runs[0];

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Purchasing</Eyebrow>
          <h1>Price check</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Every bible item checked each week against sellers online - the exact item only (same manufacturer item # and every spec the bible gives).
            Sellers that list it only behind a quote are tagged Quote required.
          </div>
        </div>
      </div>
      <div className="content">
        {error && <div style={errBox}>{error}</div>}
        {note && <div style={okBox}>{note}</div>}
        {!data && !error && <Pill tone="neutral" size="sm">loading…</Pill>}
        {data && st && (
          <>
            <Card padding={14}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <Pill tone={st.enabled ? 'positive' : 'neutral'}>{st.enabled ? 'Weekly check on' : 'Weekly check off'}</Pill>
                <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => void run('toggle', async () => { await setSettings({ enabled: !st.enabled }); return st.enabled ? 'Switched off.' : 'Switched on: it runs every Saturday evening.'; })}>
                  {st.enabled ? 'Switch off' : 'Switch on'}</Btn>
                <label style={{ fontSize: 12 }}>Model{' '}
                  <select style={picker} value={st.model} disabled={!!busy} onChange={e => void run('model', async () => { await setSettings({ model: e.target.value }); })}>
                    {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select></label>
                <label style={{ fontSize: 12 }}>Weekly budget ${' '}
                  <input style={{ ...smallInput, width: 70 }} type="number" min={0} step={10} defaultValue={st.weekly_budget_usd} key={`b${st.updated_at}`}
                    onBlur={e => { const v = Number(e.target.value); if (v >= 0 && v !== Number(st.weekly_budget_usd)) void run('budget', async () => { await setSettings({ budget: v }); }); }} /></label>
                <label style={{ fontSize: 12 }}>Overpaying from{' '}
                  <input style={{ ...smallInput, width: 50 }} type="number" min={1} max={90} defaultValue={st.overpay_pct} key={`o${st.updated_at}`}
                    onBlur={e => { const v = Number(e.target.value); if (v > 0 && v < 100 && v !== Number(st.overpay_pct)) void run('overpay', async () => { await setSettings({ overpay: v }); }); }} />% cheaper</label>
                <span style={{ flex: 1 }} />
                <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => void run('sync', async () => {
                  const r = await syncBibles(); return `Bibles re-read: ${r.items} items, ${r.checkable} with an item #, ${r.bought} bought${r.retired ? `, ${r.retired} no longer in a bible` : ''}.`; })}>
                  {busy === 'sync' ? 'Reading…' : 'Re-read the bibles'}</Btn>
                <Btn size="sm" disabled={!!busy} onClick={() => void run('start', async () => {
                  const r = await startRun(); return r.enabled ? `Run started: ${r.checkable} items, a few every 3 minutes (bought items first).` : `${r.checkable} items are due, but the weekly check is off - switch it on to run them.`; })}>
                  Start a run now</Btn>
              </div>
              <div style={{ ...subTxt, marginTop: 8 }}>{runLine(lastRun, st.enabled)}</div>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, margin: '14px 0' }}>
              {FILTERS.map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit',
                  border: filter === f ? '2px solid var(--fg-primary)' : '1px solid var(--border)', background: 'var(--surface)' }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{FILTER_LABEL[f]}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{n?.[f] ?? 0}</div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select style={picker} value={venue} onChange={e => setVenue(e.target.value)} aria-label="Venue">
                <option value="">All venues</option>
                {venues.map(v => <option key={v} value={v}>{venueName(v)}</option>)}
              </select>
              <input style={{ ...picker, minWidth: 240 }} placeholder="Search item, maker, item #" value={q} onChange={e => setQ(e.target.value)} />
              <Btn size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>All items ({n?.all ?? 0})</Btn>
            </div>

            <Card padding={0}>
              <table style={tbl}>
                <thead><tr style={headRow}>
                  <th style={th}>Item</th><th style={th}>Venues</th><th style={thR}>We pay / piece</th><th style={thR}>Best exact / piece</th>
                  <th style={thR}>Difference</th><th style={th}>Status</th><th style={th}>Checked</th>
                </tr></thead>
                <tbody>
                  {rows.slice(0, shown).map(i => {
                    const c = data.checks.get(i.id);
                    const v = itemView(i);
                    return (
                      <Fragment key={i.id}>
                        <tr style={{ ...rowBorder, cursor: 'pointer', background: open === i.id ? 'var(--surface-2, rgba(0,0,0,0.03))' : undefined }} onClick={() => setOpen(open === i.id ? null : i.id)}>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{i.item_name ?? i.description ?? i.item_key}</div>
                            <div style={subTxt}>{[i.manufacturer, i.item_no && `#${i.item_no}`, i.size].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td style={td}><span title={i.sources.map(s => `${s.title} (${s.sheet})`).join('\n')}>{[...new Set(i.sources.map(s => venueName(s.venue_id)))].join(', ')}</span></td>
                          <td style={tdNum}>{fmtUnit(c?.our_unit_price)}{c?.purchases?.[0] && <div style={subTxt}>{c.purchases[0].vendor}</div>}</td>
                          <td style={tdNum}>{fmtUnit(c?.best_unit_price)}{c?.best_vendor && <div style={subTxt}>{c.best_vendor}</div>}</td>
                          <td style={tdNum}>{c?.savings_pct != null ? <Pill size="sm" tone={c.savings_pct > 0 ? (v === 'overpaying' ? 'critical' : 'neutral') : 'positive'}>{c.savings_pct > 0 ? `${c.savings_pct}% cheaper` : `${Math.abs(c.savings_pct)}% more`}</Pill> : '-'}</td>
                          <td style={td}>
                            <Pill size="sm" tone={VIEW_TONE[v]}>{VIEW_LABEL[v]}</Pill>
                            {v !== 'quote_required' && needsQuote(i, c) && <> <Pill size="sm" tone="gold">Quote required</Pill></>}
                            {i.quote_state && <div style={subTxt}>Quote {i.quote_state}{i.quote_price ? `: ${fmtUnit(i.quote_price)}` : ''}{i.quote_vendor ? ` (${i.quote_vendor})` : ''}</div>}
                          </td>
                          <td style={td}>{i.last_checked_at ? shortDate(i.last_checked_at.slice(0, 10)) : i.due_at ? 'queued' : '-'}</td>
                        </tr>
                        {open === i.id && <tr><td colSpan={7} style={{ ...td, background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
                          <ItemDetail item={i} check={c} busy={busy} onCheck={() => void run(`check:${i.id}`, async () => {
                            const r = await checkNow(i.id); return r.check ? `Checked: ${VIEW_LABEL[r.check.status]}${r.check.cost_usd ? ` ($${Number(r.check.cost_usd).toFixed(2)})` : ''}.` : 'Not checked - try again.'; })}
                            onQuote={(state, vendor, price, nt) => void run('quote', async () => { await setQuote(i.id, state, vendor, price, nt); return state ? `Quote marked ${state}.` : 'Quote cleared.'; })} />
                        </td></tr>}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={7} style={{ ...td, color: 'var(--fg-muted)' }}>Nothing here.</td></tr>}
                </tbody>
              </table>
              {rows.length > shown && <div style={{ padding: 10 }}><Btn size="sm" variant="secondary" onClick={() => setShown(shown + PAGE)}>Show more ({rows.length - shown} left)</Btn></div>}
            </Card>
            <div style={{ ...subTxt, marginTop: 8 }}>Signed in as {user.email}. Prices are per piece: a case price is divided by the pieces in the case as the seller states them.</div>
          </>
        )}
      </div>
    </>
  );
}

function ItemDetail({ item, check, busy, onCheck, onQuote }: { item: PcItem; check: PcCheck | undefined; busy: string | null; onCheck: () => void;
  onQuote: (state: 'requested' | 'received' | null, vendor: string, price: number | null, note: string) => void }) {
  const [qv, setQv] = useState(item.quote_vendor ?? check?.quote_vendors[0]?.seller ?? '');
  const [qp, setQp] = useState(item.quote_price ? String(item.quote_price) : '');
  const [qn, setQn] = useState(item.quote_note ?? '');
  const link = (u: string, t: string) => (u ? <a href={u} target="_blank" rel="noreferrer noopener">{t || u}</a> : t);
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>The bible says:</b>
        <span>{[item.manufacturer, item.item_no && `item # ${item.item_no}`, item.description, item.size, ...Object.entries(item.specs).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ')}</span>
        {item.bible_price && <span>· price in the bible: {item.bible_price}</span>}
        {item.bible_link && <span>· {link(item.bible_link, 'link')}</span>}
        <span style={{ flex: 1 }} />
        {item.checkable && <Btn size="sm" variant="secondary" disabled={!!busy} onClick={onCheck}>{busy === `check:${item.id}` ? 'Checking… (about a minute)' : 'Check now'}</Btn>}
      </div>
      {!item.checkable && <div>The bible gives no manufacturer item #, so an exact match cannot be proven - add the item # to the bible to have it checked.</div>}
      {check?.purchases?.length ? <div><b>What we paid:</b> {check.purchases.map((p, k) => <span key={k}>{k ? ' · ' : ' '}{p.date ?? '?'} {p.vendor}{p.order_number ? ` ${p.order_number}` : ''}: ${p.unit_price.toFixed(2)} per {p.unit || 'unit'}</span>)}
        {check.our_unit_price != null && <> = <b>{fmtUnit(check.our_unit_price)}</b> a piece</>}</div> : check && <div>No purchase in the order tracker - market price only.</div>}
      {check?.offers?.length ? (
        <table style={tbl}><thead><tr style={headRow}><th style={th}>Exact offers</th><th style={thR}>Price</th><th style={th}>For</th><th style={thR}>Per piece</th><th style={th}>In stock</th><th style={th}>Proof of the exact item</th></tr></thead>
          <tbody>{[...check.offers].sort((a, b) => a.unit_price - b.unit_price).map((o, k) => (
            <tr key={k} style={rowBorder}><td style={td}>{link(o.url, o.seller)}</td><td style={tdNum}>${o.price.toFixed(2)}</td><td style={td}>{o.price_for || `${o.pack_qty}`}</td>
              <td style={tdNum}>{fmtUnit(o.unit_price)}</td><td style={td}>{o.in_stock == null ? '-' : o.in_stock ? 'yes' : 'no'}</td><td style={td}>{o.evidence}</td></tr>))}</tbody></table>
      ) : check && <div>No seller lists the exact item with a price.</div>}
      {check?.quote_vendors?.length ? (
        <div><b>Quote required at:</b> {check.quote_vendors.map((qs, k) => <span key={k}>{k ? ' · ' : ' '}{link(qs.url, qs.seller)}{qs.note ? ` (${qs.note})` : ''}</span>)}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <input style={smallInput} placeholder="Seller" value={qv} onChange={e => setQv(e.target.value)} />
            <input style={{ ...smallInput, width: 90 }} placeholder="$ per piece" value={qp} onChange={e => setQp(e.target.value)} />
            <input style={{ ...smallInput, minWidth: 180 }} placeholder="Note" value={qn} onChange={e => setQn(e.target.value)} />
            <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => onQuote('requested', qv, null, qn)}>Quote requested</Btn>
            <Btn size="sm" disabled={!!busy || !(Number(qp) > 0)} onClick={() => onQuote('received', qv, Number(qp), qn)}>Quote received</Btn>
            {item.quote_state && <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => onQuote(null, '', null, '')}>Clear</Btn>}
          </div></div>
      ) : null}
      {check?.rejected?.length ? <div><b>Not the same item:</b> {check.rejected.map((r, k) => <span key={k}>{k ? ' · ' : ' '}{link(r.url, r.seller)}: {r.why}</span>)}</div> : null}
      {check?.notes && <div><b>Notes:</b> {check.notes}</div>}
      {check?.error && <div style={errBox}>The last check failed: {check.error}</div>}
      {check && <div style={subTxt}>Checked {new Date(check.checked_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} with {check.model ?? 'the model'}{check.searches ? `, ${check.searches} searches` : ''}{check.cost_usd ? `, $${Number(check.cost_usd).toFixed(2)}` : ''}.</div>}
    </div>
  );
}
