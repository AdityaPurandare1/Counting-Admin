import { useMemo, useState } from 'react';
import { Btn, Card, Pill } from '@/components/atoms';
import { documentUrl, logFollowup, undoFollowup, type TrackerData } from '@/lib/orderTrackerData';
import { FOLLOW_AFTER, followupsDue, mailtoLink, paymentRequestsDue, type FollowUp, type OrderMail, type PayRequest } from '@/lib/orderFollowups';
import { errBox, fmtMoney, linkBtn, shortDate, subTxt } from './shared';
import { RECENT_PAID_DAYS, STUB_SENT_NOTE, stubsToSend, type StubToSend } from '@/lib/orderTrackerView';
import { stubCheckLine, type StubCheck } from '@/lib/orderMail';
import { stubEmail } from '@/lib/stubMail';
import { messageLink } from '@/lib/orderMail';
import { openPaymentDraft } from './payDraft';
import { venueStage } from '@/lib/access';

/** v1.04 To send: payment requests for new invoices and follow-ups on quiet orders, each one click from a
 *  filled-in e-mail (src/lib/orderFollowups.ts). Compose opens it in Outlook and logs it (Undo if not sent). */
export function ToSend({ data, mails, today, venueName, me, meName = null, stubCheck = null, onOpenOrder, onReload }: {
  data: TrackerData; mails: OrderMail[]; today: string; venueName: (id: string | null) => string; me: string; meName?: string | null;
  /** v1.22 (0175): the latest hourly stub check (mail status last_run.stub_check) */
  stubCheck?: StubCheck | null;
  onOpenOrder: (orderId: string) => void; onReload: () => void;
}) {
  const full = { ...data, followups: data.followups ?? [] };
  const pays = useMemo(() => paymentRequestsDue(full, venueName, me, venueStage), [data, venueName, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const follows = useMemo(() => followupsDue(full, mails, today, venueName, me), [data, mails, today, venueName, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const [logged, setLogged] = useState<{ id: string; label: string } | null>(null);
  // v1.14 check stubs to send: paid recently, the stub not sent to the vendor yet, by payment run (Thu-Fri)
  const stubs = useMemo(() => stubsToSend(data.orders, data.lines, data.documents, today, data.followups ?? []), [data.orders, data.lines, data.documents, data.followups, today]);
  const [stubNote, setStubNote] = useState<string | null>(null);
  const [stubMarked, setStubMarked] = useState<{ ids: string[]; label: string } | null>(null);
  // signed with the person's name (not the part of the e-mail address before the @)
  const meEntry = { email: me, name: meName };
  const copyText = (g: StubToSend) => {
    const body = stubEmail(g, data.orders, mails, meEntry).body;
    (navigator.clipboard ? navigator.clipboard.writeText(body) : Promise.reject(new Error('no clipboard')))
      .then(() => setStubNote('The message is copied.'), () => setStubNote('Could not copy — select the message under "Message" and copy it by hand.'));
  };
  // Mark sent: one log per order (with that order's invoices), Undo removes them all
  const markSent = (g: StubToSend) => void run(async () => {
    const ids: string[] = [];
    for (const orderId of [...new Set(g.items.map(i => i.orderId))]) {
      const invs = [...new Set(g.items.filter(i => i.orderId === orderId).map(i => i.invoice))];
      ids.push(await logFollowup({ order_id: orderId, kind: 'payment', invoice_numbers: invs, note: `${STUB_SENT_NOTE}: ${invs.join(', ')}`.slice(0, 200) }));
    }
    setStubMarked({ ids, label: `${g.vendor} ${g.payments.map(p => p.number).join(', ') || g.items.map(i => i.invoice).join(', ')}` });
    onReload();
  });
  // Reply in Outlook: the text is copied while this page has focus, the tab opened in the click (so it isn't
  // blocked), then pointed at the vendor's invoice e-mail
  const stubReply = (g: StubToSend) => {
    const e = stubEmail(g, data.orders, mails, meEntry);
    const copied = navigator.clipboard ? navigator.clipboard.writeText(e.body).then(() => true, () => false) : Promise.resolve(false);
    const w = window.open('', '_blank');
    void run(async () => {
      try {
        const r = await messageLink(g.replyTo!);
        if (!r.link) throw new Error(r.reason === 'not_owner' ? `The vendor's e-mail is in ${r.mailbox ?? 'another'} mailbox — use New e-mail.` : 'The vendor\'s invoice e-mail could not be opened — use New e-mail.');
        if (w) { w.opener = null; w.location.href = r.link; } else window.open(r.link, '_blank', 'noopener');
      } catch (err) { w?.close(); throw err; }   // never leave a blank tab behind
      setStubNote((await copied)
        ? 'The message is copied. The invoice e-mail is open in Outlook: Reply, paste, attach the stub PDF, Send. The next mail pull files the stub and it leaves this list.'
        : 'The invoice e-mail is open in Outlook, but the message could NOT be copied — use Copy text (or copy it from "Message"), then Reply, paste, attach the stub PDF, Send.');
    });
  };

  const run = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const compose = (r: { orderId: string; kind: 'vendor' | 'payment'; invoices?: string[]; label: string; email: NonNullable<FollowUp['email']> }) => run(async () => {
    window.location.href = mailtoLink(r.email);
    const id = await logFollowup({ order_id: r.orderId, kind: r.kind, invoice_numbers: r.invoices ?? null, note: r.email.subject.slice(0, 200) });
    setLogged({ id, label: r.label });
    onReload();
  });
  const pdf = (path: string) => run(async () => { window.open(await documentUrl(path), '_blank', 'noopener'); });
  // v1.21 the user: "new emails can be drafted in the app and opened in outlook to be sent" - a real draft with the
  // invoice PDF attached when the tracker may make one, else a new e-mail filled in and the PDF downloaded to attach.
  // The tab is opened in the click (so it isn't blocked), then pointed at the draft / the new e-mail.
  const [payNote, setPayNote] = useState<string | null>(null);
  const draftPay = (p: PayRequest) => {
    const w = window.open('', '_blank');
    void run(async () => {
      setPayNote(null);
      const r = await openPaymentDraft(p, { email: me, name: meName }, w);
      setPayNote(r.note);
      setLogged({ id: r.logId, label: p.email.subject });
      onReload();
    });
  };
  const copyPay = (p: PayRequest) => {
    const text = `To: ${p.email.to.join('; ')}\nCc: ${p.email.cc.join('; ')}\nSubject: ${p.email.subject}\n\n${p.email.body}`;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
      .then(() => setPayNote('Copied: to, cc, subject and message.'), () => setPayNote('Could not copy - open the order and copy it by hand.'));
  };
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
        <div style={{ fontWeight: 700 }}>Check stubs to send {stubs.length > 0 && <Pill tone={stubs.some(g => g.overdue) ? 'critical' : 'gold'} size="sm">{stubs.length}</Pill>}</div>
        <div style={subTxt}>Paid in the last {RECENT_PAID_DAYS} days and the stub not sent to the vendor yet, by payment run (Thursday / Friday) — send each by the next business day.
          Reprint it in R365 (Accounts Payable → AP Transactions → the payment → Action → Check Stub Reprint), then send it with the e-mail below and attach the PDF.
          Your sent mail is checked for stubs at the 9 o'clock pull and again every hour from 10:30 to 5:30: a stub you send leaves this list within the hour.</div>
        {stubCheckLine(stubCheck) && <div style={{ ...subTxt, marginTop: 6 }}>{stubCheckLine(stubCheck)}</div>}
        {stubNote && <div style={{ ...subTxt, marginTop: 6 }}>{stubNote}</div>}
        {stubMarked && <div style={{ ...subTxt, marginTop: 6 }}>Marked sent: {stubMarked.label}.{' '}
          <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => void run(async () => { for (const x of stubMarked.ids) await undoFollowup(x); setStubMarked(null); onReload(); })}>Undo</button></div>}
        {stubs.length === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-muted)' }}>Nothing to send.</div>}
        {stubs.map((g, i) => (
          <div key={g.key}>
            {(i === 0 || stubs[i - 1].run.key !== g.run.key) && <div style={{ fontWeight: 600, fontSize: 12.5, marginTop: 12 }}>{g.run.label[0].toUpperCase() + g.run.label.slice(1)} · send by {shortDate(g.dueOn)}</div>}
            <StubRow g={g} email={stubEmail(g, data.orders, mails, meEntry)} onOpen={onOpenOrder} onReply={g.replyTo ? () => stubReply(g) : null}
              onCopy={() => copyText(g)} onMarkSent={() => markSent(g)} />
          </div>
        ))}
      </Card>

      <Card padding={16}>
        <div style={{ fontWeight: 700 }}>Payment requests {pays.length > 0 && <Pill tone="gold" size="sm">{pays.length}</Pill>}</div>
        <div style={subTxt}>Invoices with no payment request yet (none found in the mailbox). Draft in Outlook writes it to accounting (hwoodap@iqbackoffice.com for an operating venue, hwoodga@ for a pre-opening
          one, as set in Venue settings; cc Ahmed, Porfirio and Stephanie) as the team writes them, the invoice PDF attached, and opens it in Outlook to check and Send.</div>
        {payNote && <div style={{ ...subTxt, marginTop: 6 }}>{payNote}</div>}
        {pays.length === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-muted)' }}>Nothing to request.</div>}
        {pays.map(p => <PayRow key={p.order.id + p.venue} p={p} onDraft={() => draftPay(p)} onCopy={() => copyPay(p)}
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

function StubRow({ g, email, onOpen, onReply, onCopy, onMarkSent }: { g: StubToSend; email: ReturnType<typeof stubEmail>; onOpen: (orderId: string) => void;
  onReply: (() => void) | null; onCopy: () => void; onMarkSent: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 300px', minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{g.vendor} · {fmtMoney(g.total)}{g.payments.length ? ` · ${g.payments.map(p => p.number).join(', ')}` : ''}
          {' '}{g.overdue ? <Pill tone="critical" size="sm">overdue</Pill> : <Pill tone="gold" size="sm">due {shortDate(g.dueOn)}</Pill>}</div>
        <div style={subTxt}>Paid {shortDate(g.paidOn)} · {g.stage === 'get' ? 'no stub on file — reprint it in R365' : 'stub on file, not sent to the vendor yet'} ·{' '}
          {g.items.map((it, k) => <span key={it.orderId + it.invoice}>{k ? ', ' : ''}{it.invoice} (<button style={{ ...linkBtn, fontSize: 12 }} onClick={() => onOpen(it.orderId)}>{it.orderNumber ?? 'order'}</button>)</span>)}</div>
        <div style={{ ...subTxt, marginTop: 2 }}>To {email.to.join(', ') || '(no vendor e-mail on file)'} — “{email.subject}”</div>
        <details style={{ ...subTxt, marginTop: 2 }}><summary style={{ cursor: 'pointer' }}>Message</summary><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0' }}>{email.body}</pre></details>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onReply && <Btn variant="primary" size="sm" onClick={onReply}>Reply in Outlook</Btn>}
        <Btn variant={onReply ? 'secondary' : 'primary'} size="sm" onClick={() => { window.location.href = mailtoLink(email); }}>New e-mail</Btn>
        <Btn variant="secondary" size="sm" onClick={onCopy}>Copy text</Btn>
        <Btn variant="ghost" size="sm" onClick={onMarkSent} title="Sent it another way (or the vendor's invoice numbers aren't ones the mail pull can read): take it off the list">Mark sent</Btn>
      </div>
    </div>
  );
}

function PayRow({ p, onDraft, onCopy, onPdf, onOpen }: { p: PayRequest; onDraft: () => void; onCopy: () => void; onPdf: (path: string) => void; onOpen: () => void }) {
  return (
    <div style={row}>
      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.venue} · {p.invoices.join(', ')} · {fmtMoney(p.total)}</div>
        <div style={subTxt}>{p.order.order_number ?? 'No order #'} · {p.order.vendor_name}{p.invoiceDate ? ` · invoiced ${shortDate(p.invoiceDate)}` : ''}{p.docs.length ? '' : ' · no invoice PDF in the tracker'}
          {p.source === 'invoice' ? ' · written from the invoice' : <span style={{ color: 'var(--ot-warn)' }}> · written from the order lines (the invoice was not read) - check it</span>}</div>
        <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-secondary)', overflowWrap: 'anywhere' }}>{p.email.subject}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {p.docs.filter(d => d.storage_path).map(d => <button key={d.id} style={{ ...linkBtn, fontSize: 12 }} onClick={() => onPdf(d.storage_path!)}>{d.doc_number ?? 'Invoice'} PDF</button>)}
        <Btn variant="ghost" size="sm" onClick={onOpen}>Open order</Btn>
        <Btn variant="secondary" size="sm" onClick={onCopy}>Copy text</Btn>
        <Btn variant="primary" size="sm" onClick={onDraft}>Draft in Outlook</Btn>
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
