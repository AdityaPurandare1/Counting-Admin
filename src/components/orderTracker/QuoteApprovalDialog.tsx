import { useEffect, useState } from 'react';
import { approveQuote } from '@/lib/orderMail';
import { mailtoLink } from '@/lib/orderFollowups';
import { parseAddresses, sendFallbackText, type ApprovalDraft } from '@/lib/quoteApprovalMail';

/** v1.11: the quote approval e-mail, shown before it goes (the user's choice: "show it, one click to send").
 *  Send = from the connected mailbox, in the vendor's quote thread when there is one; the quoted lines are
 *  stamped approved. If the tracker can't send (IT has not granted Mail.Send yet, or it is not your mailbox),
 *  it says so and the same e-mail opens in Outlook. Nothing is sent without Send / Outlook's own Send. */
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
  useEffect(() => { setTo(d.email.to.join(', ')); setCc(d.email.cc.join(', ')); setSubject(d.email.subject); setText(d.email.body); setNote(null); }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const toA = parseAddresses(to), ccA = parseAddresses(cc);
  const problem = !toA.ok.length ? 'Add who it goes to.' : toA.bad.length || ccA.bad.length ? `Not an e-mail address: ${[...toA.bad, ...ccA.bad].join(', ')}` : !text.trim() ? 'The message is empty.' : null;
  const email = { to: toA.ok, cc: ccA.ok, subject: subject.trim(), body: text };
  const openInOutlook = () => { window.location.href = mailtoLink(email); };

  const send = async () => {
    if (problem) return;
    setBusy(true); setNote(null);
    try {
      const r = await approveQuote({ order_id: order.id, line_ids: d.lines.map(l => l.id), quote_number: d.quote, to: email.to, cc: email.cc,
        subject: email.subject, text: email.body, reply_to: d.replyTo });
      if (r.sent) { setNote({ kind: 'ok', text: `Sent. ${r.approved ?? d.lines.length} line${(r.approved ?? d.lines.length) === 1 ? '' : 's'} marked approved.` }); onSent(); return; }
      setNote({ kind: 'warn', text: sendFallbackText(r) });
    } catch (e) {
      setNote({ kind: 'crit', text: sendFallbackText({ detail: e instanceof Error ? e.message : String(e) }) });
    } finally { setBusy(false); }
  };

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
          <button type="button" className={`ot-btn${note?.kind === 'warn' ? ' primary' : ''}`} onClick={openInOutlook} disabled={busy || !!problem}
            title="Opens this e-mail in Outlook to send yourself; the 9 o'clock pull then marks the quote approved">Open in Outlook instead</button>
          {note?.kind !== 'ok' && <button type="button" className={`ot-btn${note?.kind === 'warn' ? '' : ' primary'}`} onClick={() => void send()} disabled={busy || !!problem}>
            {busy ? 'Sending…' : 'Send approval'}</button>}
        </div>
      </div>
    </>
  );
}
