import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VENUES } from '@/lib/access';
import {
  STATUSES, STATUS_LABEL, MULTIPLE_VENUES, ALL_STATUSES, autoOrderNumber, awaitingApproval, extractTracking, isLate, orderState, orderVenues, receivedForLine, statusRank, trackingUrl,
  type LineStatus, type OtDocument, type OtLine, type OtOrder,
} from '@/lib/orderTracker';
import {
  arrivesNow, draftLineTotal, draftStage, draftTotal, invoiceToken, isPlanEmpty, lastUpdate, stubInvoices, lineDraft, markDraft, orderCategory, orderDraft, paymentOf, planOrderSave, setDraftStage, timeAgo,
  type LineDraft, type OrderDraft,
} from '@/lib/orderTrackerView';
import {
  addLines, addMove, addTracking, attachFile, createOrder, deleteLine, deleteOrder, loadEvents, removeTracking, updateLine, updateOrder,
  type EventRow, type TrackerData,
} from '@/lib/orderTrackerData';
import { SENT_SOURCE, orderTiming, timingText } from '@/lib/leadTime';
import { checkApprovals } from '@/lib/orderMail';
import { fmtMoney, shortDate } from './shared';
import { AttachStubButton, DocChip, Icon, isOtherDoc } from './ui';

/** One order in the side panel (the user's design): its fields, the cycle stepper, lines, invoices,
 *  tracking, documents and notes. Edits are a draft — Save writes only what changed (planOrderSave). */
export function OrderDrawer({ order, lines, docs, data, today, venueName, onClose, onReload, onCreated, onOpenDoc }: {
  order: OtOrder | null; lines: OtLine[]; docs: OtDocument[]; data: TrackerData; today: string; venueName: (id: string | null) => string;
  onClose: () => void; onReload: () => void; onCreated: (orderId: string) => void; onOpenDoc: (d: OtDocument) => void;
}) {
  const fresh = useMemo(() => orderDraft(order, lines, today), [order, lines, today]);
  const [draft, setDraft] = useState<OrderDraft>(fresh);
  const [base, setBase] = useState<OrderDraft>(fresh);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  // a reload (after a save, the morning pull) brings the saved order back — unless someone is mid-edit
  const freshSig = order ? JSON.stringify(fresh) : '';
  useEffect(() => { if (order && !dirty) { setDraft(fresh); setBase(fresh); } }, [freshSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'delete' | 'discard' | null>(null);
  const [history, setHistory] = useState<EventRow[] | null>(null);
  const [newTracking, setNewTracking] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => { if (dirty && confirming !== 'discard') setConfirming('discard'); else onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.ot-viewer')) close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const set = (patch: Partial<OrderDraft>) => { setDraft(d => ({ ...d, ...patch })); setConfirming(null); };
  const setLine = (key: string, patch: Partial<LineDraft>) => setDraft(d => ({ ...d, lines: d.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }));

  const save = () => run(async () => {
    const plan = planOrderSave(order, lines, draft, { items: data.items, received: id => receivedForLine(data.moves, id) });
    if (plan.problems.length) throw new Error(plan.problems.join(' '));
    if (plan.backward && !confirm(`${plan.backward} line${plan.backward > 1 ? 's move' : ' moves'} back to an earlier step. Save anyway?`)) return;
    if (!order) {
      const o = await createOrder({
        ...plan.order, vendor_name: draft.vendor_name.trim(),
        order_number: plan.order.order_number ?? autoOrderNumber(plan.adds, draft.vendor_name, data),
      }, plan.adds);
      onCreated(o.id);
      return;
    }
    if (isPlanEmpty(plan)) { setBase(draft); return; }
    if (Object.keys(plan.order).length) await updateOrder(order.id, plan.order);
    for (const u of plan.updates) await updateLine(u.id, u.patch, { source: 'manual' });
    for (const r of plan.receipts) {
      await addMove({ item_id: r.item_id, moved_on: today, kind: 'receipt', qty: r.qty, venue_id: null, line_id: r.line_id, note: `order ${order.order_number ?? ''}`.trim() });
    }
    for (const id of plan.removes) await deleteLine(id);
    if (plan.adds.length) await addLines(order.id, plan.adds, lines.reduce((m, l) => Math.max(m, l.sort + 1), 0));
    setBase(draft);
    onReload();
  });

  const st = order ? orderState(order, lines) : 'open';
  const late = order ? lines.filter(l => isLate(l, order, today, receivedForLine(data.moves, l.id))) : [];
  // Quoted lines with no approval e-mail to the vendor yet (0157): flagged until it is sent
  const toApprove = order && !order.archived_at && !order.completed_at ? lines.filter(awaitingApproval) : [];
  const quoteNums = [...new Set(toApprove.map(l => l.quote_number).filter((q): q is string => !!q))];
  const approvals = [...new Map(lines.filter(l => l.status === 'QUOTED' && l.quote_approved_at && !awaitingApproval(l))
    .map(l => [`${l.quote_approved_for ?? ''}|${l.quote_approved_at}`, l] as const)).values()];
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null);
  const checkNow = () => run(async () => {
    const r = await checkApprovals();
    if (r.error) throw new Error(`Could not check the mailbox: ${r.error}`);
    setApprovalMsg(r.approved ? `Found it: ${r.approved} line${r.approved === 1 ? '' : 's'} approved.` : 'No approval e-mail found yet. Reply to the quote e-mail (Approved / good to go ahead), then check again.');
    if (r.approved) onReload();
  });
  const stage = draftStage(draft);
  const liveDraft = draft.lines.filter(l => !l.removed);
  // payment from the draft as it stands (unsaved changes included)
  const asLines = liveDraft.map(l => ({ status: l.status, invoice_number: l.invoice_number || null, invoice_date: l.invoice_date || null, qty: Number(l.qty) || 0,
    unit_price: Number(l.unit_price) || 0, status_at: `${today}T00:00:00Z` }) as OtLine);
  const pay = paymentOf(asLines, today);
  const invoices = [...new Set(liveDraft.map(l => l.invoice_number.trim()).filter(Boolean))].map(n => {
    const ls = liveDraft.filter(l => l.invoice_number.trim() === n && l.status !== 'CANCELLED');
    const paid = ls.length > 0 && ls.every(l => statusRank(l.status) >= statusRank('PAID'));
    const day = ls.map(l => l.invoice_date).filter(Boolean).sort()[0] ?? '';
    return { n, day, amount: ls.reduce((s, l) => s + draftLineTotal(l), 0), paid,
      waiting: !paid && day ? Math.max(0, Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)) : null };
  });
  const tracking = order ? data.tracking.filter(t => t.order_id === order.id) : [];
  const lineTracking = [...new Set(lines.flatMap(l => (l.tracking_number ?? '').split(/[,;\s]+/)).map(x => x.trim().toUpperCase()).filter(x => x.length >= 8))]
    .filter(n => !tracking.some(t => t.tracking_number === n)).map(n => extractTracking(`tracking ${n}`)[0] ?? { number: n, carrier: null });
  const venueChoices = useMemo(() => orderVenues(VENUES), []);
  const items = useMemo(() => data.items.filter(i => i.is_active).map(i => i.name).sort(), [data.items]);
  const original = new Map(lines.map(l => [l.id, l]));
  const pdfs = docs.filter(d => !isOtherDoc(d));
  const others = docs.filter(isOtherDoc);
  // sent to the vendor -> delivered (0147): open for how long, or how long it took
  const sentSource = order && draft.sent_on === (order.sent_on ?? '') ? order.sent_source ?? null : draft.sent_on ? 'manual' : null;
  const timing = order ? orderTiming({ sent_on: draft.sent_on || null, sent_source: sentSource }, lines, today) : null;
  // lines marked delivered in this edit: on which day they came (lead times)
  const arriving = draft.lines.filter(l => !l.removed && l.id && original.get(l.id) && arrivesNow(original.get(l.id)!.status, l.status)).length;

  return (
    <>
      <div className="ot-scrim" onClick={close} />
      <aside className="ot-drawer ot" role="dialog" aria-modal="true" aria-labelledby="ot-dr-title" style={{ gap: 0 }}>
        <div className="ot-dr-head">
          <div style={{ minWidth: 0 }}>
            <div className="ot-eyebrow">{!order ? 'New order' : st === 'archived' ? 'Archived order' : st === 'completed' ? 'Completed order' : 'Order'}</div>
            <h2 id="ot-dr-title">{draft.vendor_name || 'New order'}{draft.order_number && <span className="mono faint" style={{ fontSize: 15, marginLeft: 8 }}>{draft.order_number}</span>}</h2>
            <div className="meta">{order ? [`Updated ${timeAgo(lastUpdate(order, lines), Date.now())}`, orderCategory(order.order_number)].filter(Boolean).join(' · ') : 'Not saved yet'}</div>
          </div>
          <button type="button" className="ot-x" onClick={close} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="ot-dr-body">
          {toApprove.length > 0 && (
            <div className="ot-note warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 280px' }}>
                <b>Approve the quote.</b> {quoteNums.length ? `Quote ${quoteNums.join(', ')}` : `${toApprove.length} quoted line${toApprove.length > 1 ? 's' : ''}`} has no approval
                e-mail from us yet. Reply to the vendor's quote e-mail ("Approved, good to go ahead"); it stays flagged until that e-mail is sent.
                {approvalMsg && <><br />{approvalMsg}</>}
              </span>
              <button type="button" className="ot-btn sm" disabled={busy} onClick={() => void checkNow()} title="Look in the mailbox for your approval e-mail now (the 9 o'clock pull also checks)">I've sent it, check now</button>
            </div>
          )}
          {approvals.length > 0 && toApprove.length === 0 && (
            <div className="ot-note" title={approvals.map(l => l.quote_approval_note ?? '').filter(Boolean).join('\n')}>
              Quote approved by e-mail{approvals.map(l => ` ${l.quote_approved_for ? `${l.quote_approved_for} ` : ''}on ${shortDate((l.quote_approved_at ?? '').slice(0, 10))}${l.quote_approval_note ? `: ${l.quote_approval_note}` : ''}`).join(';')}.
            </div>
          )}
          {late.length > 0 && <div className="ot-note crit">{late.length} line{late.length > 1 ? 's are' : ' is'} past ETA. Update the ETA or mark {late.length > 1 ? 'them' : 'it'} received.</div>}

          <section className="ot-sec"><div className="ot-grid2">
            <Fld label="Vendor"><input className="ot-inp" list="ot-vendors" value={draft.vendor_name} onChange={e => set({ vendor_name: e.target.value })} placeholder="e.g. EE Mercantile" /></Fld>
            <Fld label="Order / PO #"><input className="ot-inp mono" value={draft.order_number} onChange={e => set({ order_number: e.target.value })} placeholder={order ? '' : 'next number when saved'} /></Fld>
            <Fld label="Venue / ship to">
              <select className="ot-inp" value={draft.venue_id} onChange={e => set({ venue_id: e.target.value })}>
                <option value="">Warehouse stock (no venue)</option>
                {venueChoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                <option value={MULTIPLE_VENUES}>Several venues (each line its own)</option>
              </select>
            </Fld>
            <Fld label="Delivers to">
              <select className="ot-inp" value={draft.deliver_to} onChange={e => set({ deliver_to: e.target.value as 'warehouse' | 'venue' })}>
                <option value="venue">The venue</option><option value="warehouse">The warehouse (stock)</option>
              </select>
            </Fld>
            <Fld label="PO date"><input className="ot-inp" type="date" value={draft.ordered_on} onChange={e => set({ ordered_on: e.target.value })} /></Fld>
            <Fld label="Expected"><input className="ot-inp" type="date" value={draft.expected_on} onChange={e => set({ expected_on: e.target.value })} /></Fld>
            <Fld label="Sent to vendor"><input className="ot-inp" type="date" value={draft.sent_on} onChange={e => set({ sent_on: e.target.value })} /></Fld>
            <div className="ot-fld" style={{ justifyContent: 'flex-end' }}>
              {timing && timing.state !== 'unsent'
                ? <span title={sentSource ? SENT_SOURCE[sentSource] : undefined}><b>{timingText(timing)}</b><span className="faint" style={{ fontSize: 12.5 }}> · {sentSource ? SENT_SOURCE[sentSource] : ''}</span></span>
                : <span className="faint" style={{ fontSize: 12.5 }}>{order ? 'Not known when it was sent — the morning pull reads it from the e-mail to the vendor, or type it.' : 'The day it went to the vendor (for lead times).'}</span>}
            </div>
          </div></section>

          <section className="ot-sec"><h3>Status <span className="faint">every line moves to the step you pick</span></h3>
            <div className="ot-stepper" role="group" aria-label="Order status">
              {STATUSES.map(s => {
                const cur = stage === s, done = stage !== null && stage !== 'CANCELLED' && statusRank(s) < statusRank(stage);
                return <button key={s} type="button" className={`ot-stp${done ? ' done' : ''}${cur ? ' cur' : ''}`} aria-pressed={cur}
                  onClick={() => { const r = setDraftStage(draft, s); if (r.backward && !confirm(`Move ${r.backward} line${r.backward > 1 ? 's' : ''} back to ${STATUS_LABEL[s]}?`)) return; set({ lines: r.draft.lines }); }}>{STATUS_LABEL[s]}</button>;
              })}
            </div>
            {arriving > 0 && (
              <div className="ot-note" style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{arriving} line{arriving > 1 ? 's' : ''} marked delivered — on</span>
                <input className="ot-inp" type="date" style={{ width: 160 }} value={draft.delivered_on} max={today} onChange={e => set({ delivered_on: e.target.value || today })} aria-label="Delivered on" />
                <span className="faint" style={{ fontSize: 12.5 }}>the day {arriving > 1 ? 'they' : 'it'} came, for lead times (today unless changed)</span>
              </div>
            )}
          </section>

          <section className="ot-sec"><h3>Lines <span className="faint">{liveDraft.length} line{liveDraft.length === 1 ? '' : 's'}</span></h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="ot-lines">
                <thead><tr><th style={{ width: '40%' }}>Item</th><th style={{ width: '10%' }}>Qty</th><th style={{ width: '13%' }}>Unit cost</th><th style={{ width: '18%' }}>ETA</th><th title="Received">Rcvd</th><th style={{ textAlign: 'right' }}>Total</th><th /></tr></thead>
                <tbody>
                  {draft.lines.map(l => {
                    const was = l.id ? original.get(l.id) : undefined;
                    const lateLine = !!was && late.some(x => x.id === was.id);
                    return (
                      <tr key={l.key} className={`${lateLine ? 'late' : ''}${l.removed ? ' removed' : ''}`}>
                        <td>
                          <input className="ot-inp" list="ot-items" value={l.description} disabled={l.removed} onChange={e => setLine(l.key, { description: e.target.value, item_id: was && e.target.value === was.description ? was.item_id : null })} placeholder="Item description" aria-label="Item" />
                          <div className="sub">
                            <select value={l.status} disabled={l.removed} onChange={e => setLine(l.key, { status: e.target.value as LineStatus })} aria-label="Line status">
                              {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                            </select>
                            <input style={{ width: 132 }} className="mono" value={l.invoice_number} disabled={l.removed} onChange={e => setLine(l.key, { invoice_number: e.target.value })} placeholder="Invoice #" aria-label="Invoice #" />
                            <select value={l.deliver_to} disabled={l.removed} onChange={e => setLine(l.key, { deliver_to: e.target.value as LineDraft['deliver_to'] })} aria-label="Goes to"
                              title="Where this line goes. Custom items by sea go to the warehouse, by air to the venue (set from the line's text).">
                              <option value="">{draft.deliver_to === 'warehouse' ? 'to the warehouse (order)' : 'to the venue (order)'}</option>
                              <option value="warehouse">to the warehouse</option><option value="venue">to the venue</option>
                            </select>
                            {[l.sku, l.quote_number && `quote ${l.quote_number}`,
                              was && was.status === 'QUOTED' && (awaitingApproval(was) ? 'no approval e-mail yet' : `approved ${shortDate((was.quote_approved_at ?? '').slice(0, 10))}`),
                              l.venue_id && draft.venue_id === MULTIPLE_VENUES && venueName(l.venue_id),
                              l.item_id && `stock: ${data.items.find(i => i.id === l.item_id)?.name ?? 'item'}`].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td><input className="ot-inp num" inputMode="decimal" value={l.qty} disabled={l.removed} onChange={e => setLine(l.key, { qty: e.target.value })} aria-label="Quantity" /></td>
                        <td><input className="ot-inp num" inputMode="decimal" value={l.unit_price} disabled={l.removed} onChange={e => setLine(l.key, { unit_price: e.target.value })} placeholder="0.00" aria-label="Unit cost" /></td>
                        <td><input className="ot-inp" type="date" value={l.expected_on} disabled={l.removed} onChange={e => setLine(l.key, { expected_on: e.target.value })} aria-label="ETA" /></td>
                        <td style={{ textAlign: 'center', paddingTop: 9 }}>
                          <input type="checkbox" checked={l.status === 'RECEIVED'} disabled={l.removed || was?.status === 'RECEIVED'} style={{ width: 16, height: 16, accentColor: 'var(--ot-accent)' }}
                            title={was?.status === 'RECEIVED' ? 'Received' : 'Mark received (a stocked item delivered to the warehouse goes into stock)'}
                            onChange={e => setLine(l.key, { status: e.target.checked ? 'RECEIVED' : (was?.status ?? 'DELIVERED') })} aria-label="Received" />
                        </td>
                        <td className="tot">{fmtMoney(draftLineTotal(l))}</td>
                        <td>{l.removed
                          ? <button type="button" className="ot-btn ghost sm" onClick={() => setLine(l.key, { removed: false })}>Undo</button>
                          : <button type="button" className="ot-x" aria-label="Remove line" onClick={() => (l.id ? setLine(l.key, { removed: true }) : set({ lines: draft.lines.filter(x => x.key !== l.key) }))}><Icon name="x" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ot-lines-foot">
              <button type="button" className="ot-btn sm" onClick={() => set({ lines: [...draft.lines, lineDraft(null, stage && stage !== 'CANCELLED' ? stage : 'REQUESTED')] })}><Icon name="plus" />Add line</button>
              <div className="ot-totbox"><div className="faint" style={{ fontSize: 12 }}>Order total (shipping and fees are lines)</div><div className="big">{fmtMoney(draftTotal(draft))}</div></div>
            </div>
          </section>

          <section className="ot-sec"><h3>Invoice & payment {pay.state === 'unpaid' && pay.oldestDays != null && <span style={{ color: pay.oldestDays >= 14 ? 'var(--ot-crit)' : 'var(--ot-ink-2)' }}>{pay.oldestDays} days waiting</span>}</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <span className={`ot-pill ${pay.state === 'paid' ? 'ok' : pay.state === 'none' ? '' : 'warn'}`}>{pay.label}</span>
              <button type="button" className="ot-btn sm" onClick={() => set({ lines: markDraft(draft, 'INVOICED').lines })}>Mark invoiced</button>
              <button type="button" className="ot-btn sm" onClick={() => set({ lines: markDraft(draft, 'PAID').lines })}>Mark paid</button>
              <span className="faint" style={{ fontSize: 12 }}>Paid also comes from R365 each morning.</span>
            </div>
            {invoices.length ? (
              <table className="ot-invs"><thead><tr><th>Invoice #</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th><th>Payment</th><th>PDF</th><th>Check stub</th></tr></thead>
                <tbody>{invoices.map(i => {
                  const pdf = pdfs.find(d => d.kind === 'invoice' && d.doc_number?.trim() === i.n);
                  const tok = invoiceToken(i.n);
                  const stub = docs.find(d => d.kind === 'payment' && stubInvoices(d as typeof d & { parsed?: unknown }).has(tok));
                  // which R365 payment paid it (0143): the stub to reprint in R365
                  const r365 = [...new Map(lines.filter(l => invoiceToken(l.invoice_number) === tok).flatMap(l => l.r365_payments ?? []).map(p => [p.number, p])).values()];
                  return <tr key={i.n}><td className="mono">{i.n}</td><td>{i.day ? shortDate(i.day) : '—'}</td><td style={{ textAlign: 'right' }} className="num">{fmtMoney(i.amount)}</td>
                    <td><span className={`ot-pill ${i.paid ? 'ok' : 'warn'}`}>{i.paid ? 'Paid' : i.waiting != null ? `Not paid · ${i.waiting}d` : 'Not paid'}</span>
                      {r365.length > 0 && <div className="faint mono" style={{ fontSize: 11.5 }}>{r365.map(p => `${p.number} · ${shortDate(p.date)}`).join(', ')}</div>}</td>
                    <td>{pdf ? <DocChip d={pdf} onOpen={onOpenDoc} /> : <span className="faint">—</span>}</td>
                    <td>{stub ? <DocChip d={stub} onOpen={onOpenDoc} />
                      : i.paid && order ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><span className="ot-pill warn">No stub</span>
                        <AttachStubButton invoices={[tok]} orderIds={[order.id]} payment={r365.map(p => p.number).join(' + ') || null} onDone={onReload} label="Attach" /></span>
                      : <span className="faint">—</span>}</td></tr>;
                })}</tbody></table>
            ) : <div className="faint" style={{ fontSize: 13 }}>No invoice on this order yet. Type the invoice # on its lines, or save the invoice PDF from the Inbox.</div>}
          </section>

          {order && (
            <section className="ot-sec"><h3>Tracking</h3>
              <div className="ot-chips">
                {!tracking.length && !lineTracking.length && <span className="faint" style={{ fontSize: 13 }}>None yet.</span>}
                {lineTracking.map(t => <span key={t.number} className="ot-tchip"><a href={trackingUrl(t)} target="_blank" rel="noopener noreferrer">{t.carrier ? `${t.carrier} ` : ''}{t.number}</a></span>)}
                {tracking.map(t => (
                  <span key={t.id} className="ot-tchip" title={[t.source === 'email' ? 'from email' : t.source, t.note].filter(Boolean).join(' · ')}>
                    <a href={trackingUrl({ number: t.tracking_number, carrier: t.carrier })} target="_blank" rel="noopener noreferrer">{t.carrier ? `${t.carrier} ` : ''}{t.tracking_number}</a>
                    <button type="button" className="ot-x" style={{ width: 20, height: 20 }} disabled={busy} aria-label={`Remove ${t.tracking_number}`}
                      onClick={() => { if (confirm(`Remove tracking ${t.tracking_number}?`)) void run(async () => { await removeTracking(t.id); onReload(); }); }}><Icon name="x" /></button>
                  </span>
                ))}
                <input className="ot-inp mono" style={{ width: 200, height: 28 }} placeholder="Add a tracking #" value={newTracking} onChange={e => setNewTracking(e.target.value)} />
                {newTracking.trim() && (
                  <button type="button" className="ot-btn sm" disabled={busy || dirty} title={dirty ? 'Save your changes first' : 'Adds it and marks unshipped lines shipped'} onClick={() => {
                    const raw = newTracking.trim();
                    const hits = extractTracking(`tracking ${raw}`);
                    void run(async () => { await addTracking(order.id, hits.length ? hits : [{ number: raw.toUpperCase(), carrier: null }], { source: 'manual', note: 'added by hand' }); setNewTracking(''); onReload(); });
                  }}>Add (marks it shipped)</button>
                )}
              </div>
            </section>
          )}

          {order && (
            <section className="ot-sec"><h3>Documents <span className="faint">quotes, invoices, check stubs, and other attachments from the e-mails</span></h3>
              <div className="ot-chips">
                {pdfs.map(d => <DocChip key={d.id} d={d} onOpen={onOpenDoc} full />)}
                {others.map(d => <DocChip key={d.id} d={d} onOpen={onOpenDoc} full />)}
                {!docs.length && <span className="faint" style={{ fontSize: 13 }}>No documents yet.</span>}
                <button type="button" className="ot-btn sm" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="clip" />Attach a file</button>
                <input ref={fileRef} type="file" style={{ display: 'none' }} accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,.png,.jpg,.jpeg,.gif,.webp,.heic"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(async () => { await attachFile(order.id, f); onReload(); }); }} />
              </div>
            </section>
          )}

          <section className="ot-sec"><Fld label="Notes"><textarea className="ot-inp" value={draft.notes} onChange={e => set({ notes: e.target.value })} placeholder="Contacts, routing, approvals, anything the next person needs" /></Fld></section>

          {order && (
            <section className="ot-sec"><h3>History
              <button type="button" className="ot-btn ghost sm" onClick={() => void run(async () => setHistory(history ? null : await loadEvents(order.id)))}>{history ? 'Hide' : 'Show'}</button></h3>
              {history && (
                <div className="ot-hist">
                  {!history.length && <div className="faint">No status changes yet.</div>}
                  {history.map(ev => (
                    <div key={ev.id}>
                      <span className="faint">{new Date(ev.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      {' · '}{lines.find(x => x.id === ev.line_id)?.description ?? (ev.line_id ? 'a removed line' : 'order')}: {ev.from_status ? `${STATUS_LABEL[ev.from_status as LineStatus] ?? ev.from_status} → ` : ''}
                      <b>{STATUS_LABEL[ev.to_status as LineStatus] ?? ev.to_status}</b>{ev.source === 'document' ? ' (from a document)' : ''}{ev.note ? ` — ${ev.note}` : ''}
                      <span className="faint"> {ev.by_email ?? ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {err && <div className="ot-note crit">{err}</div>}
        </div>

        <div className="ot-dr-foot">
          <div className="grp">
            {confirming === 'delete' ? (
              <><span className="ot-dirty" style={{ color: 'var(--ot-crit)' }}>Delete this order for everyone?</span>
                <button type="button" className="ot-btn sm danger" disabled={busy} onClick={() => void run(async () => { await deleteOrder(order!.id); onClose(); onReload(); })}>Delete</button>
                <button type="button" className="ot-btn sm ghost" onClick={() => setConfirming(null)}>Keep</button></>
            ) : confirming === 'discard' ? (
              <><span className="ot-dirty">Discard unsaved changes?</span>
                <button type="button" className="ot-btn sm" onClick={onClose}>Discard</button>
                <button type="button" className="ot-btn sm ghost" onClick={() => setConfirming(null)}>Keep editing</button></>
            ) : order && (
              <>
                {st === 'open' && <button type="button" className="ot-btn sm ghost" disabled={busy} onClick={() => void run(async () => { await updateOrder(order.id, { completed_at: new Date().toISOString() }); onReload(); })}>Mark complete</button>}
                {st === 'completed' && order.completed_at && <button type="button" className="ot-btn sm ghost" disabled={busy} onClick={() => void run(async () => { await updateOrder(order.id, { completed_at: null }); onReload(); })}>Reopen</button>}
                <button type="button" className="ot-btn sm ghost" disabled={busy} title="For orders that were never real (tests, duplicates): they leave every total and the report"
                  onClick={() => void run(async () => { await updateOrder(order.id, { archived_at: order.archived_at ? null : new Date().toISOString() }); onReload(); })}>{order.archived_at ? 'Restore' : 'Archive'}</button>
                <button type="button" className="ot-btn sm ghost danger" onClick={() => setConfirming('delete')}>Delete</button>
              </>
            )}
          </div>
          <div className="grp">
            {dirty && !confirming && <span className="ot-dirty">Unsaved changes</span>}
            <button type="button" className="ot-btn" onClick={close}>{dirty ? 'Cancel' : 'Close'}</button>
            <button type="button" className="ot-btn primary" disabled={busy || (!!order && !dirty)} onClick={() => void save()}>{busy ? 'Saving…' : order ? 'Save' : 'Create order'}</button>
          </div>
        </div>
        <datalist id="ot-items">{items.map(n => <option key={n} value={n} />)}</datalist>
        <datalist id="ot-vendors">{[...new Set(data.orders.map(o => o.vendor_name))].sort().map(v => <option key={v} value={v} />)}</datalist>
      </aside>
    </>
  );
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ot-fld"><span className="lbl">{label}</span>{children}</label>;
}
