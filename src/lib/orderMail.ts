/* Order tracker — the morning mail pull (v0.80, migration 0135). Every
   Supabase call the Inbox makes. The pull itself is the kount-order-mail Edge
   Function: it reads the connected Outlook mailbox at 9:00 Pacific, applies
   documents that clearly belong to an existing order, and leaves the rest
   here (kount_ot_inbox) for a person. The mailbox's sign-in is kept in Vault
   and never reaches the browser; kount_ot_mail_status() is all the admin sees. */

import { supabase, selectAllPagedFiltered } from './supabase';
import type { ReadDoc, TrackingHit } from './orderTracker';

export type InboxState = 'unread' | 'pending' | 'applied' | 'ignored' | 'error';

export interface InboxItem {
  id: string;
  message_id: string;
  /** 'body' = no PDF: tracking numbers read from the email text (0137) */
  attachment_id: string;
  conversation_id: string | null;
  subject: string | null;
  sender_email: string | null;
  sender_name: string | null;
  received_at: string | null;
  file_name: string | null;
  size_bytes: number | null;
  storage_path: string;
  state: InboxState;
  parsed: (ReadDoc & { bill_to?: string; ship_to?: string; tracking?: TrackingHit[]; excerpt?: string; kind?: 'payment'; invoices?: string[] }) | null;
  attempts: number;
  read_error: string | null;
  decision: string | null;
  order_id: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MailRun {
  trigger: string; started_at: string; finished_at?: string;
  messages: number; new_pdfs: number; read: number; applied: number; pending: number; ignored: number; failed: number;
  tracking?: number; paid?: number;
  remaining?: number; error: string | null; reconnect: boolean;
}

export interface MailStatus {
  mailbox: string | null;
  connected: boolean;
  connected_by: string | null;
  connected_at: string | null;
  signing_in: boolean;
  vendor_domains: string[];
  /** document types the pull takes (0136); 'invoice' includes credit memos */
  doc_kinds: string[];
  /** a quote / invoice that matches no order starts one (0138) */
  auto_create: boolean;
  suggested_domains: Record<string, number>;
  fetched_through: string | null;
  running: boolean;
  last_run: MailRun | null;
}

export async function loadInbox(): Promise<InboxItem[]> {
  const cols = 'id, message_id, attachment_id, conversation_id, subject, sender_email, sender_name, received_at, file_name, size_bytes, storage_path, state, parsed, attempts, read_error, decision, order_id, decided_by, created_at, updated_at';
  return selectAllPagedFiltered<InboxItem>(() => supabase.from('kount_ot_inbox').select(cols), { column: 'created_at', ascending: false }, 1000, 20);
}

export async function mailStatus(): Promise<MailStatus> {
  const { data, error } = await supabase.rpc('kount_ot_mail_status');
  if (error) throw new Error(`Could not read the mail connection: ${error.message}`);
  const s = (data ?? {}) as Partial<MailStatus>;
  return {
    mailbox: s.mailbox ?? null, connected: !!s.connected, connected_by: s.connected_by ?? null, connected_at: s.connected_at ?? null,
    signing_in: !!s.signing_in, vendor_domains: Array.isArray(s.vendor_domains) ? s.vendor_domains : [],
    doc_kinds: Array.isArray(s.doc_kinds) ? s.doc_kinds : ['quote', 'confirmation', 'invoice', 'shipping'],
    auto_create: s.auto_create !== false,
    suggested_domains: s.suggested_domains && typeof s.suggested_domains === 'object' ? s.suggested_domains : {},
    fetched_through: s.fetched_through ?? null, running: !!s.running, last_run: (s.last_run as MailRun | null) ?? null,
  };
}

async function invokeMail<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('kount-order-mail', { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') msg = (await ctx.json()).error ?? msg;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return data as T;
}

export interface DeviceCode { user_code: string; verification_uri: string; expires_in: number; interval: number }
export const startConnect = () => invokeMail<DeviceCode>({ action: 'connect_start' });
export const pollConnect = () => invokeMail<{ state: 'waiting' | 'connected' | 'failed' | 'expired'; mailbox?: string; reason?: string }>({ action: 'connect_poll' });
export const pullNow = () => invokeMail<{ started: boolean; reason?: string }>({ action: 'pull' });
/** One invoice / quote by its number, however old (the pull reads only recent mail): its PDF from the vendor's e-mail is read and decided. */
export interface FindResult { found: number; new_pdfs?: number; applied?: number; pending?: number; ignored?: number; failed?: number; paid?: number; reason?: string }
export const findInMail = (number: string) => invokeMail<FindResult>({ action: 'find', number });
/** What a find did, in a sentence. */
export function findSummary(number: string, r: FindResult): string {
  if (r.reason) return r.reason;
  if (!r.found) return `No e-mail from a listed vendor with a PDF mentions ${number}.`;
  if (!r.new_pdfs) return `${number}: its PDF${r.found > 1 ? 's were' : ' was'} already pulled — see the Inbox or the order.`;
  const parts = [r.applied && `${r.applied} saved to an order`, r.pending && `${r.pending} waiting for you below`, r.ignored && `${r.ignored} set aside`,
    r.failed && `${r.failed} could not be read`, r.paid && `${r.paid} marked paid from R365`].filter(Boolean);
  return `${number}: ${r.new_pdfs} PDF${r.new_pdfs > 1 ? 's' : ''} pulled${parts.length ? ` — ${parts.join(', ')}` : ''}.`;
}
/** After a save: waiting items that now match an order (the invoice in the quote's thread, a tracking email) are applied. */
export const redecideInbox = () => invokeMail<{ applied: number }>({ action: 'redecide' });

export const isTrackingEmail = (i: Pick<InboxItem, 'attachment_id'>) => i.attachment_id === 'body';
/** a check stub (0139): goes onto its order by itself once that invoice is tracked */
export const isPaymentStub = (i: Pick<InboxItem, 'parsed'>) => i.parsed?.kind === 'payment';

export async function disconnectMail(): Promise<void> {
  const { error } = await supabase.rpc('kount_ot_mail_disconnect');
  if (error) throw new Error(`Not disconnected: ${error.message}`);
}

export async function setVendorDomains(domains: string[]): Promise<void> {
  const { error } = await supabase.rpc('kount_ot_mail_set_domains', { p_domains: domains });
  if (error) throw new Error(`Vendor list not saved: ${error.message}`);
}

export async function setAutoCreate(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('kount_ot_mail_set_auto_create', { p_on: on });
  if (error) throw new Error(`Not saved: ${error.message}`);
}

export async function setDocKinds(kinds: string[]): Promise<void> {
  const { error } = await supabase.rpc('kount_ot_mail_set_doc_kinds', { p_kinds: kinds });
  if (error) throw new Error(`Document types not saved: ${error.message}`);
}

/** Skip a document, or bring a skipped one back. */
export async function setInboxState(id: string, state: 'ignored' | 'pending', decision: string, by: string | null): Promise<void> {
  const { error } = await supabase.from('kount_ot_inbox').update({ state, decision, decided_by: by }).eq('id', id);
  if (error) throw new Error(`Not updated: ${error.message}`);
}

/** Which inbox rows a person needs to look at, and the rest grouped. */
export function inboxGroups(items: InboxItem[], today: Date = new Date()) {
  const since = new Date(today.getTime() - 30 * 86_400_000).toISOString();
  const byNewest = (a: InboxItem, b: InboxItem) => (b.received_at ?? b.created_at).localeCompare(a.received_at ?? a.created_at);
  return {
    waiting: items.filter(i => (i.state === 'pending' || i.state === 'error') && !isPaymentStub(i)).sort(byNewest),
    stubs: items.filter(i => i.state === 'pending' && isPaymentStub(i)).sort(byNewest),
    reading: items.filter(i => i.state === 'unread').sort(byNewest),
    applied: items.filter(i => i.state === 'applied' && i.updated_at >= since).sort(byNewest),
    skipped: items.filter(i => i.state === 'ignored').sort(byNewest),
  };
}
