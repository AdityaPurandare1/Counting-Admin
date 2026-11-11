/* Quote approval e-mail (v1.11). The user: "auto email send when I mark a quote approve. It should trigger an
   email saying the quote is approved." Approve on an order shows the e-mail (to, subject, text) to check, and
   Send writes it from the connected mailbox (kount-order-mail 'approve_quote'): a reply in the vendor's quote
   e-mail when the quote came by e-mail, else a new e-mail; the quoted lines are then stamped approved. Until IT
   grants the tracker Mail.Send, or for anyone but the mailbox's owner, the same e-mail opens in Outlook instead
   (mailto), and the 9 o'clock pull (0157) finds it once it is sent. Pure: the data comes in. */

import { awaitingApproval, isOwnSender, quoteKey, type OtDocument, type OtLine, type OtOrder } from './orderTracker';
import { vendorContact, type Email, type OrderMail } from './orderFollowups';

/** What the Inbox knows about an e-mail (InboxItem has these). */
export type ThreadMail = OrderMail & { message_id: string };

export interface ApprovalDraft {
  /** the quote number the lines carry; null = quoted lines with no number */
  quote: string | null;
  lines: OtLine[];
  /** the vendor's quote e-mail to reply to (its immutable id); null = a new e-mail */
  replyTo: string | null;
  email: Email;
}

const firstName = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const myFirst = (me: { name?: string | null; email: string }) =>
  (String(me.name ?? '').trim().split(/\s+/)[0] || me.email.split('@')[0]).replace(/^./, c => c.toUpperCase());

/** One approval e-mail per quote number among the order's Quoted lines that wait for one (0157). */
export function approvalDrafts(order: OtOrder, lines: readonly OtLine[], docs: readonly OtDocument[], mails: readonly ThreadMail[],
                               venueName: (id: string | null) => string, me: { email: string; name?: string | null }): ApprovalDraft[] {
  const groups = new Map<string, OtLine[]>();
  for (const l of lines) if (l.order_id === order.id && awaitingApproval(l)) {
    const k = quoteKey(l.quote_number ?? '');
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
  }
  const venue = venueName(order.venue_id);
  return [...groups.values()].map(ls => {
    const quote = ls[0].quote_number ?? null;
    // the e-mail that brought the quote PDF: reply in that thread, to whoever sent it (not to ourselves)
    const doc = quote ? docs.find(d => d.order_id === order.id && d.kind === 'quote' && quoteKey(d.doc_number ?? '') === quoteKey(quote) && d.source_message_id) : undefined;
    const thread = doc ? mails.find(m => m.message_id === doc.source_message_id) : undefined;
    const fromVendor = thread && thread.sender_email && !isOwnSender(thread.sender_email) ? thread : undefined;
    const contact = fromVendor ? { email: fromVendor.sender_email!.toLowerCase(), name: fromVendor.sender_name, subject: fromVendor.subject } : vendorContact(order, [...mails]);
    const what = `${quote ? `quote ${quote}` : 'the quote'} for ${venue}${order.order_number ? ` (${order.order_number})` : ''}`;
    const subject = fromVendor?.subject ? (/^re:/i.test(fromVendor.subject) ? fromVendor.subject : `Re: ${fromVendor.subject}`)
      : `${quote ? `Quote ${quote}` : 'Quote'} approved – ${order.order_number ?? order.vendor_name} – ${venue}`;
    return {
      quote, lines: ls, replyTo: fromVendor ? doc!.source_message_id ?? null : null,
      email: {
        to: contact ? [contact.email] : [], cc: [],
        subject,
        // "Approved, ..." on its own line: what the 9 o'clock pull reads as our approval (0157) if it goes out from Outlook
        body: `Hi ${firstName(contact?.name)},\n\nApproved, please go ahead with ${what} and send over the invoice.\n\nThank you,\n${myFirst(me)}`,
      },
    };
  });
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
/** "a@x.com, b@y.com; c@z.com" -> the addresses, and any that are not one. */
export function parseAddresses(text: string): { ok: string[]; bad: string[] } {
  const parts = text.split(/[,;\s]+/).map(s => s.trim().replace(/^<|>$/g, '')).filter(Boolean);
  return { ok: [...new Set(parts.filter(p => EMAIL.test(p)).map(p => p.toLowerCase()))], bad: parts.filter(p => !EMAIL.test(p)) };
}

/** What the tracker said when it could not send, for the person; `thread` = the vendor's quote e-mail can be
 *  opened in Outlook (v1.12 Reply in Outlook keeps the approval in its thread). */
export function sendFallbackText(r: { reason?: string; mailbox?: string | null; detail?: string | null }, thread = false): string {
  const how = thread ? 'Use Reply in Outlook: it opens the vendor\'s quote e-mail with the message copied, so it stays in the thread.'
    : 'Open it in Outlook and send it there.';
  if (r.reason === 'not_granted') return `Sending from the tracker is waiting on IT (the Order Tracker app needs Microsoft Mail.Send). ${how} The 9 o'clock pull will mark the quote approved.`;
  if (r.reason === 'not_owner') return `Only ${r.mailbox ?? 'the connected mailbox'}'s owner sends from the tracker. Open it in your own Outlook and send it there.`;
  if (r.reason === 'not_connected') return `Outlook is not connected (Inbox). ${how}`;
  return `Not sent${r.detail ? `: ${r.detail}` : ''}. ${how}`;
}
