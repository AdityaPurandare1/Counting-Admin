/* v1.14 the check stub e-mail to the vendor. Worded so the mail pull knows it: "payment stub" and the invoice
   numbers in the text (kount-order-mail stubPhase searches our sent mail for that and files the attached stub on
   the order — which is what takes it off "Check stubs to send"). Pure: the data comes in. */

import { isOwnSender, type OtOrder } from './orderTracker';
import { vendorContact, type Email, type OrderMail } from './orderFollowups';
import type { StubToSend } from './orderTrackerView';

const money = (x: number) => x.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const firstName = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const myFirst = (me: { name?: string | null; email: string }) =>
  (String(me.name ?? '').trim().split(/\s+/)[0] || me.email.split('@')[0]).replace(/^./, c => c.toUpperCase());
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Who it goes to (the sender of the vendor's invoice e-mail, else the vendor's buyer on file) and what it says. */
export function stubEmail(g: StubToSend, orders: readonly OtOrder[], mails: ReadonlyArray<OrderMail & { message_id?: string }>,
                          me: { email: string; name?: string | null }): Email {
  const thread = g.replyTo ? mails.find(m => m.message_id === g.replyTo && m.sender_email && !isOwnSender(m.sender_email)) : undefined;
  const order = orders.find(o => o.id === g.items[0]?.orderId);
  const contact = thread ? { email: thread.sender_email!.toLowerCase(), name: thread.sender_name } : order ? vendorContact(order, [...mails]) : null;
  const invoices = g.items.map(i => i.invoice);
  const list = invoices.length > 1 ? `${invoices.slice(0, -1).join(', ')} and ${invoices[invoices.length - 1]}` : invoices[0];
  const paid = `paid ${longDay(g.paidOn)}${g.payments.length ? ` – ${g.payments.map(p => p.number).join(', ')}` : ''}`;
  return {
    to: contact ? [contact.email] : [], cc: [],
    subject: `Payment stub – ${invoices.join(', ')}`,
    body: `Hi ${firstName(contact?.name)},\n\nPlease find attached the payment stub for ${list} (${money(g.total)}, ${paid}).\n\nThank you,\n${myFirst(me)}`,
  };
}
