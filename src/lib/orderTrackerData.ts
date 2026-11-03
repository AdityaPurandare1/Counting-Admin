/* Order tracker (v0.79) — every Supabase read and write the Purchasing tabs
   make. Tables are kount_ot_* (migration 0132), all admin + corporate only by
   RLS; documents live in the private 'kount-order-docs' bucket and are read
   by the kount-read-purchase-doc Edge Function. */

import { supabase, selectAllPagedFiltered } from './supabase';
import type { ApplyDocument, DocKind, DocLine, LineStatus, OtDocument, OtItem, OtLine, OtMove, OtOrder, OtTracking } from './orderTracker';

export const DOC_BUCKET = 'kount-order-docs';

export interface TrackerData {
  items: OtItem[];
  orders: OtOrder[];
  lines: OtLine[];
  moves: OtMove[];
  documents: OtDocument[];
  /** tracking numbers per order (0137); empty when that migration is missing */
  tracking: OtTracking[];
}

const num = (x: unknown): number | null => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

function fail(what: string, e: { message: string } | null): never {
  throw new Error(`${what}: ${e?.message ?? 'unknown error'}`);
}

export async function loadTracker(): Promise<TrackerData> {
  const page = <T,>(table: string, order: string) =>
    selectAllPagedFiltered<T>(() => supabase.from(table).select('*'), { column: order, ascending: true }, 1000, 50);
  const [items, orders, lines, moves, documents] = await Promise.all([
    page<OtItem>('kount_ot_items', 'name'),
    page<OtOrder>('kount_ot_orders', 'created_at'),
    page<OtLine>('kount_ot_lines', 'created_at'),
    page<OtMove>('kount_ot_stock_moves', 'created_at'),
    page<OtDocument>('kount_ot_documents', 'created_at'),
  ]);
  const tracking = await page<OtTracking>('kount_ot_tracking', 'created_at').catch(() => [] as OtTracking[]);
  const fixLine = (l: OtLine): OtLine => ({ ...l, qty: Number(l.qty) || 0, unit_price: num(l.unit_price) });
  const fixItem = (i: OtItem): OtItem => ({ ...i, pack_size: num(i.pack_size), reorder_point: num(i.reorder_point), lead_time_days: num(i.lead_time_days) });
  return {
    items: items.map(fixItem),
    orders,
    lines: lines.map(fixLine),
    moves: moves.map(m => ({ ...m, qty: Number(m.qty) || 0 })),
    documents: documents.map(d => ({ ...d, total: num(d.total) })),
    tracking,
  };
}

export interface EventRow { id: number; line_id: string | null; order_id: string | null; from_status: string | null; to_status: string; source: string; note: string | null; by_email: string | null; at: string }

export async function loadEvents(orderId: string): Promise<EventRow[]> {
  const { data, error } = await supabase.from('kount_ot_events').select('*').eq('order_id', orderId).order('at', { ascending: false }).limit(200);
  if (error) fail('Could not load the history', error);
  return (data as EventRow[]) ?? [];
}

/* ── items ── */

export type ItemDraft = Omit<OtItem, 'id' | 'is_active'> & { is_active?: boolean };

export async function saveItem(id: string | null, draft: ItemDraft): Promise<OtItem> {
  const q = id ? supabase.from('kount_ot_items').update(draft).eq('id', id) : supabase.from('kount_ot_items').insert(draft);
  const { data, error } = await q.select('*').single();
  if (error) fail(error.message.includes('duplicate') ? 'An item with that name and SKU already exists' : 'Item not saved', error);
  return data as OtItem;
}

/* ── orders + lines ── */

export interface NewLine { item_id: string | null; description: string; sku: string | null; qty: number; unit: string | null; unit_price: number | null; status: LineStatus; quote_number?: string | null; invoice_number?: string | null; invoice_date?: string | null; tracking_number?: string | null; expected_on?: string | null }

export async function createOrder(order: Partial<OtOrder> & { vendor_name: string }, lines: NewLine[]): Promise<OtOrder> {
  const { data, error } = await supabase.from('kount_ot_orders').insert(order).select('*').single();
  if (error) fail('Order not saved', error);
  const o = data as OtOrder;
  if (lines.length) {
    const rows = lines.map((l, i) => ({ ...l, order_id: o.id, sort: i, status_source: 'manual' }));
    const { error: le } = await supabase.from('kount_ot_lines').insert(rows);
    if (le) {
      // Do not leave an empty order behind when its lines were refused.
      await supabase.from('kount_ot_orders').delete().eq('id', o.id);
      fail('Order lines not saved', le);
    }
  }
  return o;
}

export async function updateOrder(id: string, patch: Partial<OtOrder>): Promise<void> {
  const { error } = await supabase.from('kount_ot_orders').update(patch).eq('id', id);
  if (error) fail('Order not updated', error);
}

/** A line change. A status change always says how it happened (the audit trail reads it). */
/** Delete an order for everyone: its lines go with it; its documents and inbox rows stay, unlinked. */
export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase.from('kount_ot_orders').delete().eq('id', id);
  if (error) fail('Order not deleted', error);
}

/** A file attached to an order by hand (an Excel of tracking numbers, a photo): an 'other' document (0142). */
export async function attachFile(orderId: string, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const id = crypto.randomUUID();
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `other/${id}.${ext}`;
  const up = await supabase.storage.from(DOC_BUCKET).upload(path, bytes, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (up.error) fail('File not attached', up.error);
  const { error } = await supabase.from('kount_ot_documents').insert({
    id, order_id: orderId, kind: 'other', file_name: file.name.slice(0, 200), storage_path: path, doc_date: new Date().toISOString().slice(0, 10), content_hash: hash,
  });
  if (error) {
    await supabase.storage.from(DOC_BUCKET).remove([path]);
    if (error.code === '23505') throw new Error('That file is already attached to this order.');
    fail('File not attached', error);
  }
}

export async function updateLine(id: string, patch: Partial<OtLine>, how: { source: 'manual' | 'document'; note?: string | null } = { source: 'manual' }): Promise<void> {
  const body: Record<string, unknown> = { ...patch };
  if ('status' in patch) { body.status_source = how.source; body.status_note = how.note ?? null; }
  const { error } = await supabase.from('kount_ot_lines').update(body).eq('id', id);
  if (error) fail('Line not updated', error);
}

export async function addLines(orderId: string, lines: NewLine[], startSort: number, how: { source: 'manual' | 'document'; note?: string | null } = { source: 'manual' }): Promise<void> {
  if (!lines.length) return;
  const rows = lines.map((l, i) => ({ ...l, order_id: orderId, sort: startSort + i, status_source: how.source, status_note: how.note ?? null }));
  const { error } = await supabase.from('kount_ot_lines').insert(rows);
  if (error) fail('Lines not added', error);
}

export async function deleteLine(id: string): Promise<void> {
  const { error } = await supabase.from('kount_ot_lines').delete().eq('id', id);
  if (error) fail('Line not removed', error);
}

/* ── stock ── */

export async function addMove(move: Omit<OtMove, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase.from('kount_ot_stock_moves').insert(move);
  if (error) fail('Stock not updated', error);
}

/** Record an E&E storage line once (0141): claim it, then write its stock moves (undoing the claim if they fail). */
export async function recordStorageLine(lineId: string, moves: Array<Omit<OtMove, 'id' | 'created_at'> & { created_at?: string }>): Promise<void> {
  const { data, error } = await supabase.from('kount_ot_lines').update({ stock_draw: 'recorded' }).eq('id', lineId).is('stock_draw', null).select('id');
  if (error) fail('Delivery not recorded', error);
  if (!data?.length) throw new Error('This delivery was already recorded — reload.');
  const { error: mErr } = await supabase.from('kount_ot_stock_moves').insert(moves);
  if (mErr) {
    await supabase.from('kount_ot_lines').update({ stock_draw: null }).eq('id', lineId);
    fail('Delivery not recorded', mErr);
  }
}

/** An E&E storage line that moved no stock of ours (or is already in a count). */
export async function skipStorageLine(lineId: string): Promise<void> {
  const { error } = await supabase.from('kount_ot_lines').update({ stock_draw: 'none' }).eq('id', lineId);
  if (error) fail('Delivery not updated', error);
}

export async function deleteMove(id: string): Promise<void> {
  const { error } = await supabase.from('kount_ot_stock_moves').delete().eq('id', id);
  if (error) fail('Stock entry not removed', error);
}

/* ── tracking ── */

/** Add tracking numbers to an order; its lines not shipped yet move to Shipped (kount_ot_add_tracking, 0137). */
export async function addTracking(orderId: string, numbers: Array<{ number: string; carrier: string | null }>, opts: { inboxId?: string; note?: string; source?: 'email' | 'manual'; shipLines?: boolean } = {}): Promise<number> {
  const { data, error } = await supabase.rpc('kount_ot_add_tracking', { p: {
    order_id: orderId, numbers, inbox_id: opts.inboxId ?? null, note: opts.note ?? null, source: opts.source ?? 'manual',
    ship_lines: opts.shipLines ?? true, decision: opts.inboxId ? 'Tracking added from the inbox.' : null,
  } });
  if (error) fail('Tracking not added', error);
  return Number(data) || 0;
}

export async function removeTracking(id: string): Promise<void> {
  const { error } = await supabase.from('kount_ot_tracking').delete().eq('id', id);
  if (error) fail('Tracking not removed', error);
}

/* ── documents ── */

export interface ReadDocument {
  doc_kind: DocKind;
  /** A credit memo / refund (vendors often print credits with positive amounts). */
  is_credit?: boolean;
  vendor_name: string;
  doc_number: string;
  doc_date: string;
  order_number: string;
  bill_to: string;
  ship_to: string;
  expected_date: string;
  tracking_numbers: string[];
  /** other invoices / quotes it says it is for ("Shipping Fee - For Items Under INV-…"); absent on older reads */
  refers_to?: string[];
  subtotal: number;
  total: number;
  lines: DocLine[];
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Send a PDF to the reader. Nothing is stored until the reviewed result is saved. */
export async function readDocument(file: File): Promise<ReadDocument> {
  const pdf = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('kount-read-purchase-doc', { body: { pdf, file_name: file.name } });
  if (error) {
    // supabase-js wraps non-2xx replies; the function's own message is in the response body.
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') msg = (await ctx.json()).error ?? msg;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  const doc = (data as { document?: ReadDocument } | null)?.document;
  if (!doc || !Array.isArray(doc.lines)) throw new Error('The reader returned nothing usable — enter the document by hand.');
  return doc;
}

/** Where a reviewed document's PDF is kept: by document id, so it is stored
 *  before the order exists and a retry of the same review overwrites it. */
export const documentPath = (docId: string) => `docs/${docId}.pdf`;

export async function uploadDocumentPdf(docId: string, file: File): Promise<string> {
  const path = documentPath(docId);
  const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (error) fail('PDF not stored', error);
  return path;
}

export async function removeDocumentPdf(path: string): Promise<void> {
  await supabase.storage.from(DOC_BUCKET).remove([path]);
}

export class AlreadySavedError extends Error {}

/** One reviewed document (planDocumentSave) in ONE transaction: the order,
 *  new catalog items, line updates, new lines and the document row — nothing
 *  is written unless all of it is. Returns the order id. */
export async function applyDocument(p: ApplyDocument): Promise<string> {
  const { data, error } = await supabase.rpc('kount_ot_apply_document', { p });
  if (error) {
    if (error.code === '23505' && /already saved/i.test(error.message)) throw new AlreadySavedError(error.message);
    // `refused`: the database answered with an error code, so nothing was written. Without a code
    // the reply was lost (network) and the save may have gone through.
    throw Object.assign(new Error(`Document not saved: ${error.message}`), { refused: !!error.code });
  }
  return data as string;
}

/** A short-lived link to open a stored PDF (the bucket is private). */
export async function documentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(storagePath, 600);
  if (error || !data?.signedUrl) fail('Could not open the file', error);
  return data.signedUrl;
}
