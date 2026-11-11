import { useMemo, useState } from 'react';
import { Btn, Card, Pill } from '@/components/atoms';
import { documentUrl, logFollowup, undoFollowup, type TrackerData } from '@/lib/orderTrackerData';
import { FOLLOW_AFTER, followupsDue, mailtoLink, paymentRequestsDue, type FollowUp, type OrderMail, type PayRequest } from '@/lib/orderFollowups';
import { errBox, fmtMoney, linkBtn, shortDate, subTxt } from './shared';

/** v1.04 To send: payment requests for new invoices and follow-ups on quiet orders, each one click from a
 *  filled-in e-mail (src/lib/orderFollowups.ts). Compose opens it in Outlook and logs it (Undo if not sent). */
export function ToSend({ data, mails, today, venueName, me, onOpenOrder, onReload }: {
  data: TrackerData; mails: OrderMail[]; today: string; venueName: (id: string | null) => string; me: string;
  onOpenOrder: (orderId: string) => void; onReload: () => void;
}) {
  const full = { ...data, followups: data.followups ?? [] };
  const pays = useMemo(() => paymentRequestsDue(full, venueName, me), [data, venueName, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const follows = useMemo(() => followupsDue(full, mails, today, venueName, me), [data, mails, today, venueName, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const [logged, setLogged] = useState<{ id: string; label: string } | null>(null);

  const run = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const compose = (r: { orderId: string; kind: 'vendor' | 'payment'; invoices?: string[]; label: string; email: NonNullable<FollowUp['email']> }) => run(async () => {
    window.location.href = mailtoLink(r.email);
    const id = await logFollowup({ order_id: r.orderId, kind: r.kind, invoice_numbers: r.invoices ?? null, note: r.email.subject.slice(0, 200) });
    setLogged({ id, label: r.label });
    onReload();
  });
  const pdf = (path: string) => run(async () => { window.open(await documentUrl(path), '_blank', 'noopener'); });
  const vendorOnes = follows.filter(f => f.to === 'vendor'), ours = follows.filter(f => f.to === 'self');

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {err && <div style={errBox}>{err}</div>}
      {logged && (
        <div style={{ ...subTxt, fontSize: 12 }}>
          Logged: {logged.label}. Didn't send it?{' '}
          <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => void run(async () => { await undoFollowup(logged.id); setLogged(null); onReload(); })}>Undo</button>
        </div>
      )}

      <Card padding={16}>
        <div style={{ fontWeight: 700 }}>Payment requests {pays.length > 0 && <Pill tone="gold" size="sm">{pays.length}</Pill>}</div>
        <div style={subTxt}>Invoices with no payment request yet (none found in the mailbox). Compose opens it to AP, filled in as the team writes them — attach the invoice PDF.</div>
        {pays.length === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-muted)' }}>Nothing to request.</div>}
        {pays.map(p => <PayRow key={p.order.id + p.venue} p={p}
          onCompose={() => void compose({ orderId: p.order.id, kind: 'payment', invoices: p.invoices, label: p.email.subject, email: p.email })}
          onPdf={pdf} onOpen={() => onOpenOrder(p.order.id)} />)}
      </Card>

      <Card padding={16}>
        <div style={{ fontWeight: 700 }}>Follow-ups {vendorOnes.length > 0 && <Pill tone="gold" size="sm">{vendorOnes.length}</Pill>}</div>
        <div style={subTxt}>Open orders with no update for {FOLLOW_AFTER}+ business days — a status move, document, tracking or any vendor e-mail in the thread counts. Check the address before sending.</div>
        {vendorOnes.length === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-muted)' }}>Every open order has moved recently.</div>}
        {vendorOnes.map(f => <FollowRow key={f.order.id} f={f} venueName={venueName} onOpen={() => onOpenOrder(f.order.id)}
          onCompose={f.email ? () => void compose({ orderId: f.order.id, kind: 'vendor', label: `${f.order.order_number ?? f.order.vendor_name} follow-up`, email: f.email! }) : null} />)}
      </Card>

      {ours.length > 0 && (
        <Card padding={16}>
          <div style={{ fontWeight: 700 }}>Waiting on us <Pill tone="neutral" size="sm">{ours.length}</Pill></div>
          <div style={subTxt}>Quiet orders where the next step is ours: a request to order, a quote to approve, an invoice to pay, or a vendor that hasn't answered two follow-ups.</div>
          {ours.map(f => <FollowRow key={f.order.id} f={f} venueName={venueName} onOpen={() => onOpenOrder(f.order.id)} onCompose={null}
            onDone={() => void run(async () => { await logFollowup({ order_id: f.order.id, kind: 'self', note: f.what }); onReload(); })} />)}
        </Card>
      )}
    </div>
  );
}

const row = { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 8, flexWrap: 'wrap' } as const;

function PayRow({ p, onCompose, onPdf, onOpen }: { p: PayRequest; onCompose: () => void; onPdf: (path: string) => void; onOpen: () => void }) {
  return (
    <div style={row}>
      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.venue} · {p.invoices.join(', ')} · {fmtMoney(p.total)}</div>
        <div style={subTxt}>{p.order.order_number ?? 'No order #'} · {p.order.vendor_name}{p.invoiceDate ? ` · invoiced ${shortDate(p.invoiceDate)}` : ''}{p.docs.length ? '' : ' · no invoice PDF in the tracker'}</div>
        <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-secondary)', overflowWrap: 'anywhere' }}>{p.email.subject}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {p.docs.filter(d => d.storage_path).map(d => <button key={d.id} style={{ ...linkBtn, fontSize: 12 }} onClick={() => onPdf(d.storage_path!)}>{d.doc_number ?? 'Invoice'} PDF</button>)}
        <Btn variant="ghost" size="sm" onClick={onOpen}>Open order</Btn>
        <Btn variant="primary" size="sm" onClick={onCompose}>Compose</Btn>
      </div>
    </div>
  );
}

function FollowRow({ f, venueName, onOpen, onCompose, onDone }: { f: FollowUp; venueName: (id: string | null) => string; onOpen: () => void; onCompose: (() => void) | null; onDone?: () => void }) {
  return (
    <div style={row}>
      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          {f.order.order_number ?? 'No order #'} · {f.order.vendor_name} · {venueName(f.order.venue_id)}
          {f.tries > 0 && <> <Pill tone="caution" size="sm">{f.tries} sent</Pill></>}
        </div>
        <div style={subTxt}>{f.idle} business days quiet (since {shortDate(f.since)}) · {f.what}</div>
        <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-secondary)' }}>
          {f.lines.slice(0, 4).map(l => l.description).join(' · ')}{f.lines.length > 4 ? ` · +${f.lines.length - 4} more` : ''}
        </div>
        {f.email && <div style={{ ...subTxt, marginTop: 2 }}>To {f.email.to.join(', ')} — “{f.email.subject}”</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn variant="ghost" size="sm" onClick={onOpen}>Open order</Btn>
        {onDone && <Btn variant="ghost" size="sm" onClick={onDone} title="Hide it until it goes quiet again">Done for today</Btn>}
        {onCompose && <Btn variant="primary" size="sm" onClick={onCompose}>Compose</Btn>}
      </div>
    </div>
  );
}
