import { useEffect, useState } from 'react';
import { approveQuote, messageLink } from '@/lib/orderMail';
import { mailtoLink } from '@/lib/orderFollowups';
import { parseAddresses, sendFallbackText, type ApprovalDraft } from '@/lib/quoteApprovalMail';

/** v1.11: the quote approval e-mail, shown before it goes (the user's choice: "show it, one click to send").
 *  Send = from the connected mailbox, in the vendor's quote thread when there is one; the quoted lines are
 *  stamped approved. If the tracker can't send (IT has not granted Mail.Send yet, or it is not your mailbox):
 *  v1.12 "Reply in Outlook" — the text is copied and the vendor's quote e-mail opens in Outlook, so Reply + paste
 *  keeps it in the thread (the user: "Can it go to the thread some how ?"); else a new e-mail in Outlook.
 *  Nothing is sent without Send / Outlook's own Send. */
export function QuoteApprovalDialog({ order, drafts, onClose, onSent }: {
  order: { id: string; order_number: string | null; vendor_name: string };
  drafts: ApprovalDraft[]; onClose: () => void; onSent: () => void;
}) {
  const [pick, setPick] = useState(0);
  const d = drafts[pick] ?? drafts[0];
  const [to, setTo] = useState(d.email.to.join(', '));
  const [cc, setCc] = useState(d.email.cc.join(', '));
  const [subject, setSubject] = useState(d.email.subject);
  const [text, setText] = useState(d.email.body);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'warn' | 'crit' | 'ok'; text: string } | null>(null);
  // the vendor's quote e-mail in Outlook on the web (fetched when the dialog opens, so the click can open it at once)
  const [link, setLink] = useState<{ url: string | null; reason?: string | null; mailbox?: string | null } | null>(null);
  useEffect(() => { setTo(d.email.to.join(', ')); setCc(d.email.cc.join(', ')); setSubject(d.email.subject); setText(d.email.body); setNote(null); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setLink(null);
    if (d.replyTo) {
      messageLink(d.replyTo).then(r => { if (live) setLink({ url: r.link, reason: r.reason ?? null, mailbox: r.mailbox ?? null }); })
        .catch(e => { if (live) setLink({ url: null, reason: e instanceof Error ? e.message : String(e) }); });
    }
    return () => { live = false; };
  }, [d.replyTo]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const toA = parseAddresses(to), ccA = parseAddresses(cc);
  const problem = !toA.ok.length ? 'Add who it goes to.' : toA.bad.length || ccA.bad.length ? `Not an e-mail address: ${[...toA.bad, ...ccA.bad].join(', ')}` : !text.trim() ? 'The message is empty.' : null;
  const email = { to: toA.ok, cc: ccA.ok, subject: subject.trim(), body: text };
  const newInOutlook = () => { window.location.href = mailtoLink(email); };
  const canReply = !!d.replyTo && !!link?.url;

  // a reply in the thread without Mail.Send: copy the text, open the vendor's e-mail; Reply + paste there
  const replyInOutlook = async () => {
    if (!link?.url) return;
    // the copy starts while this page has focus, the tab opens in the click itself (no await before it: not blocked)
    const copying = navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
    window.open(link.url, '_blank', 'noopener');
    const copied = await copying;
    setNote({ kind: 'ok', text: `${copied ? 'The message is copied. ' : 'Copy the message above, then: '}The quote e-mail is open in Outlook — click Reply, paste (Ctrl+V) and Send. It stays in the thread, and the 9 o'clock pull (or "I've sent it, check now") marks the quote approved.` });
  };

  const send = async () => {
    if (problem) return;
    setBusy(true); setNote(null);
    try {
      const r = await approveQuote({ order_id: order.id, line_ids: d.lines.map(l => l.id), quote_number: d.quote, to: email.to, cc: email.cc,
        subject: email.subject, text: email.body, reply_to: d.replyTo });
      if (r.sent) { setNote({ kind: 'ok', text: `Sent. ${r.approved ?? d.lines.length} line${(r.approved ?? d.lines.length) === 1 ? '' : 's'} marked approved.` }); onSent(); return; }
      setNote({ kind: 'warn', text: sendFallbackText(r, canReply) });
    } catch (e) {
      setNote({ kind: 'crit', text: sendFallbackText({ detail: e instanceof Error ? e.message : String(e) }, canReply) });
    } finally { setBusy(false); }
  };

  const fellBack = note?.kind === 'warn' || note?.kind === 'crit';
  return (
    <>
      <div className="ot-viewer-scrim" onClick={() => { if (!busy) onClose(); }} />
      <div className="ot-dialog ot" role="dialog" aria-modal="true" aria-labelledby="ot-qa-title">
        <div className="ot-viewer-head">
          <b id="ot-qa-title">Approve the quote{order.order_number ? ` · ${order.order_number}` : ''}</b>
          <button type="button" className="ot-btn ghost sm" onClick={onClose} disabled={busy}>Close</button>
        </div>
        <div className="ot-dialog-body">
          {drafts.length > 1 && (
            <label className="ot-fld"><span className="lbl">Quote</span>
              <select className="ot-inp" value={pick} onChange={e => setPick(Number(e.target.value))}>
                {drafts.map((x, i) => <option key={i} value={i}>{x.quote ? `Quote ${x.quote}` : 'Quoted lines with no number'} · {x.lines.length} line{x.lines.length === 1 ? '' : 's'}</option>)}
              </select>
            </label>
          )}
          <div className="sub">{d.replyTo ? 'Goes as a reply in the vendor\'s quote e-mail.' : 'Goes as a new e-mail (the quote did not come in by e-mail).'} Approves {d.lines.length} quoted line{d.lines.length === 1 ? '' : 's'}.</div>
          <label className="ot-fld"><span className="lbl">To</span><input className="ot-inp" value={to} onChange={e => setTo(e.target.value)} aria-label="To" /></label>
          <label className="ot-fld"><span className="lbl">Cc</span><input className="ot-inp" value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" aria-label="Cc" /></label>
          <label className="ot-fld"><span className="lbl">Subject</span><input className="ot-inp" value={subject} onChange={e => setSubject(e.target.value)} disabled={!!d.replyTo} aria-label="Subject"
            title={d.replyTo ? 'A reply keeps the thread\'s subject' : undefined} /></label>
          <label className="ot-fld"><span className="lbl">Message</span><textarea className="ot-inp" rows={7} value={text} onChange={e => setText(e.target.value)} aria-label="Message" /></label>
          {problem && <div className="ot-note warn">{problem}</div>}
          {note && <div className={`ot-note ${note.kind}`}>{note.text}</div>}
        </div>
        <div className="ot-dialog-foot">
          <button type="button" className="ot-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {d.replyTo ? (
            <>
              <button type="button" className="ot-btn ghost" onClick={newInOutlook} disabled={busy || !!problem}
                title="A new e-mail in Outlook (not in the vendor's thread)">New e-mail in Outlook</button>
              <button type="button" className={`ot-btn${fellBack ? ' primary' : ''}`} onClick={() => void replyInOutlook()} disabled={busy || !canReply || !text.trim()}
                title={canReply ? 'Copies the message and opens the vendor\'s quote e-mail in Outlook: Reply, paste, Send — it stays in the thread'
                  : link?.reason === 'not_owner' ? `The quote e-mail is in ${link.mailbox ?? 'another'} mailbox` : link ? 'The quote e-mail could not be found in Outlook' : 'Finding the quote e-mail…'}>
                Reply in Outlook</button>
            </>
          ) : (
            <button type="button" className={`ot-btn${fellBack ? ' primary' : ''}`} onClick={newInOutlook} disabled={busy || !!problem}
              title="Opens this e-mail in Outlook to send yourself; the 9 o'clock pull then marks the quote approved">Open in Outlook instead</button>
          )}
          {note?.kind !== 'ok' && <button type="button" className={`ot-btn${fellBack ? '' : ' primary'}`} onClick={() => void send()} disabled={busy || !!problem}>
            {busy ? 'Sending…' : 'Send approval'}</button>}
        </div>
      </div>
    </>
  );
}
