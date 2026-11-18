/* v1.21 Draft in Outlook - the payment request to accounting, from To send and from the order's "Send to accounting"
   note (the user, 11/17: "it only shows I've sent it check now. Not the send email with the template filled in format
   with attachments"). One place, so both open the same e-mail. */
import { downloadDocument, logFollowup } from '@/lib/orderTrackerData';
import { mailtoLink, outlookComposeLink, signedBody, type PayRequest } from '@/lib/orderFollowups';
import { draftMail } from '@/lib/orderMail';

/** v1.25: a mailto link carries the Cc (Outlook on the web's compose link takes only to / subject / body - the user,
 *  11/18: "It doesnt add people in CC yet"); Outlook (the app) opens it. Longer than Outlook takes in a mailto: null. */
export const MAILTO_MAX = 1900;
export function mailtoFor(e: PayRequest['email']): string | null {
  const link = mailtoLink(e);
  return link.length <= MAILTO_MAX ? link : null;
}
function openMailto(link: string) {
  const a = document.createElement('a');
  a.href = link;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The payment request as a real draft in the connected Outlook mailbox with the invoice PDFs attached, opened in `w`
 *  (a tab opened in the click, so it isn't blocked); when the tracker can't make the draft, a new e-mail in Outlook
 *  filled in - to, Cc, subject, body (a mailto link) - and the PDFs downloaded to drag in. Logged as composed (To send stops listing it; logId undoes).
 *  The tab is closed on an error, never left blank. */
export async function openPaymentDraft(p: PayRequest, who: { email: string; name?: string | null }, w: Window | null): Promise<{ note: string; logId: string }> {
  try {
    const files = p.docs.filter(d => d.storage_path);
    const r = await draftMail({ to: p.email.to, cc: p.email.cc, subject: p.email.subject, text: signedBody(p.email.body, who.name ?? who.email),
      document_ids: files.map(d => d.id) });
    let note: string;
    if (r.drafted && r.link) {
      if (w) { w.opener = null; w.location.href = r.link; } else window.open(r.link, '_blank', 'noopener');
      note = `The draft is in your Outlook Drafts${r.attached ? ` with the invoice PDF${r.attached > 1 ? 's' : ''} attached` : ''}${r.skipped?.length ? ` (not attached: ${r.skipped.join(', ')})` : ''} - check it and Send.`;
    } else {
      const mailto = mailtoFor(p.email);
      if (mailto) { try { w?.close(); } catch { /* already closed */ } openMailto(mailto); }
      else {
        // too long for a mailto: Outlook on the web, which cannot take the Cc - the note names who to add
        const link = outlookComposeLink(p.email);
        if (w) { w.opener = null; w.location.href = link; } else window.open(link, '_blank', 'noopener');
      }
      for (const d of files) await downloadDocument(d.storage_path!, d.file_name || `${d.doc_number ?? 'invoice'}.pdf`);
      const why = r.reason === 'not_granted' ? 'Outlook does not let the tracker make drafts yet (IT has to approve Mail.ReadWrite for the Order Tracker app)'
        : r.reason === 'not_owner' ? `the connected mailbox is ${r.mailbox ?? "someone else's"}`
        : r.reason === 'not_connected' ? 'Outlook is not connected in the Inbox' : `the draft could not be made${r.detail ? ` (${r.detail})` : ''}`;
      const ccNote = !mailto && p.email.cc.length ? ` Add ${p.email.cc.join(', ')} on Cc (Outlook on the web leaves Cc empty).` : '';
      note = `A new e-mail is open in Outlook, filled in${files.length ? `, and the invoice PDF${files.length > 1 ? 's are' : ' is'} downloaded - drag ${files.length > 1 ? 'them' : 'it'} in and Send` : ' - attach the invoice and Send'}.${ccNote} (No draft: ${why}.)`;
    }
    const logId = await logFollowup({ order_id: p.order.id, kind: 'payment', invoice_numbers: p.invoices, note: p.email.subject.slice(0, 200) });
    return { note, logId };
  } catch (e) {
    w?.close();
    throw e;
  }
}
