/* v1.23 Price check (0176): every bible item checked weekly against the web for the EXACT item (manufacturer item #
   and every spec), the cheapest exact offer per piece against what we paid. The user, 11/17: "check for each BOH and
   FOH item if its being purchased right ... the exact same item mentioned in the bible ... If there is a website which
   doesnt really have those labelled as such but need a quote tag them as quote required and I can work on getting
   the quote". The work: Counting-App supabase/functions/kount-price-check. */
import { supabase } from './supabase';

export type PcStatus = 'overpaying' | 'ok' | 'market_only' | 'quote_required' | 'not_found' | 'no_item_no' | 'error';
export type PcView = PcStatus | 'unchecked';

export interface PcOffer { seller: string; url: string; price: number; price_for: string; pack_qty: number; unit_price: number; in_stock: boolean | null; evidence: string }
export interface PcQuoteSeller { seller: string; url: string; note: string }
export interface PcRejected { seller: string; url: string; why: string }
export interface PcPurchase { vendor: string; order_number: string | null; invoice_number: string | null; date: string | null; unit_price: number; unit: string | null; qty: number | null; description: string }

export interface PcItem {
  id: string; item_key: string; item_no: string | null; manufacturer: string | null; item_name: string | null; description: string | null; size: string | null;
  specs: Record<string, string>; sources: Array<{ venue_id: string; bible_id: string; title: string; sheet: string }>;
  bible_price: string | null; bible_link: string | null; checkable: boolean; bought: boolean; active: boolean;
  due_at: string | null; claimed_at: string | null; last_check_id: string | null; last_status: PcStatus | null; last_checked_at: string | null;
  quote_state: 'requested' | 'received' | null; quote_vendor: string | null; quote_price: number | null; quote_note: string | null; quote_by: string | null; quote_at: string | null;
}
export interface PcCheck {
  id: string; item_id: string; run_id: string | null; checked_at: string; status: PcStatus; our_unit_price: number | null; purchases: PcPurchase[];
  best_unit_price: number | null; best_vendor: string | null; best_url: string | null; savings_pct: number | null;
  offers: PcOffer[]; quote_vendors: PcQuoteSeller[]; rejected: PcRejected[]; notes: string | null; model: string | null; cost_usd: number | null; searches: number | null; error: string | null;
}
export interface PcRun { id: string; trigger: string; model: string | null; started_at: string; finished_at: string | null; items_total: number; items_done: number; cost_usd: number; budget_usd: number | null; stopped: string | null }
export interface PcSettings { enabled: boolean; model: string; weekly_budget_usd: number; overpay_pct: number; per_tick: number; updated_at: string; updated_by: string | null }
export interface PcData { items: PcItem[]; checks: Map<string, PcCheck>; runs: PcRun[]; settings: PcSettings | null }

export const MODELS: Array<{ value: string; label: string }> = [
  { value: 'anthropic/claude-sonnet-5.5', label: 'Sonnet 5.5 (about $0.15 an item)' },
  { value: 'anthropic/claude-opus-5.5', label: 'Opus 5.5 (about 2x Sonnet)' },
  { value: 'anthropic/claude-haiku-5.5', label: 'Haiku 5.5 (cheapest, more misses)' },
];

export const VIEW_LABEL: Record<PcView, string> = {
  overpaying: 'Overpaying', ok: 'Price OK', market_only: 'Market price only', quote_required: 'Quote required',
  not_found: 'Not found online', no_item_no: 'No item # in the bible', error: 'Could not check', unchecked: 'Not checked yet',
};
export const VIEW_TONE: Record<PcView, 'critical' | 'positive' | 'inform' | 'gold' | 'neutral' | 'caution' | 'ghost'> = {
  overpaying: 'critical', ok: 'positive', market_only: 'inform', quote_required: 'gold', not_found: 'neutral', no_item_no: 'ghost', error: 'caution', unchecked: 'ghost',
};

async function all<T>(q: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export async function loadPriceCheck(): Promise<PcData> {
  const items = await all<PcItem>(from => supabase.from('kount_pc_items').select('*').eq('active', true).order('item_key').range(from, from + 999));
  const ids = items.map(i => i.last_check_id).filter((x): x is string => !!x);
  const checks = new Map<string, PcCheck>();
  for (let k = 0; k < ids.length; k += 200) {
    const { data, error } = await supabase.from('kount_pc_checks')
      .select('id, item_id, run_id, checked_at, status, our_unit_price, purchases, best_unit_price, best_vendor, best_url, savings_pct, offers, quote_vendors, rejected, notes, model, cost_usd, searches, error')
      .in('id', ids.slice(k, k + 200));
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as PcCheck[]) checks.set(c.item_id, c);
  }
  const [{ data: runs, error: rErr }, { data: st, error: sErr }] = await Promise.all([
    supabase.from('kount_pc_runs').select('*').order('started_at', { ascending: false }).limit(5),
    supabase.from('kount_pc_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (rErr) throw new Error(rErr.message);
  if (sErr) throw new Error(sErr.message);
  return { items, checks, runs: (runs ?? []) as PcRun[], settings: (st as PcSettings | null) ?? null };
}

/** What a row shows: no item # (cannot be proven exact), not checked yet, else its latest check's verdict. */
export function itemView(i: Pick<PcItem, 'checkable' | 'last_status'>): PcView {
  return !i.checkable ? 'no_item_no' : (i.last_status ?? 'unchecked');
}

/** Tagged quote required: a seller lists the exact item only behind "request a quote", and no quote is in yet. */
export function needsQuote(i: Pick<PcItem, 'quote_state'>, c: Pick<PcCheck, 'quote_vendors'> | undefined): boolean {
  return !!c && c.quote_vendors.length > 0 && i.quote_state !== 'received';
}

export type PcFilter = PcView | 'all' | 'quote';
export const FILTERS: PcFilter[] = ['overpaying', 'quote', 'market_only', 'ok', 'not_found', 'error', 'unchecked', 'no_item_no'];
export const FILTER_LABEL: Record<PcFilter, string> = { ...VIEW_LABEL, all: 'All items', quote: 'Quote required' };

export function matches(i: PcItem, c: PcCheck | undefined, f: PcFilter, venue: string, q: string): boolean {
  if (venue && !i.sources.some(s => s.venue_id === venue)) return false;
  if (q) {
    const hay = [i.item_name, i.manufacturer, i.item_no, i.description, i.size, ...i.sources.map(s => s.title)].join(' ').toLowerCase();
    if (!q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
  }
  if (f === 'all') return true;
  if (f === 'quote') return needsQuote(i, c);
  return itemView(i) === f;
}

/** The rows for a filter: overpaying by how much, the rest bought first then by name. */
export function rowsFor(d: PcData, f: PcFilter, venue = '', q = ''): PcItem[] {
  return d.items.filter(i => matches(i, d.checks.get(i.id), f, venue, q)).sort((a, b) => {
    const ca = d.checks.get(a.id), cb = d.checks.get(b.id);
    if (f === 'overpaying') return (cb?.savings_pct ?? 0) - (ca?.savings_pct ?? 0);
    return Number(b.bought) - Number(a.bought) || String(a.item_name ?? a.item_key).localeCompare(String(b.item_name ?? b.item_key));
  });
}

export function counts(d: PcData, venue = '', q = ''): Record<PcFilter, number> {
  const out = Object.fromEntries([...FILTERS, 'all'].map(k => [k, 0])) as Record<PcFilter, number>;
  for (const i of d.items) {
    const c = d.checks.get(i.id);
    for (const f of [...FILTERS, 'all'] as PcFilter[]) if (matches(i, c, f, venue, q)) out[f]++;
  }
  return out;
}

/** The latest run in words: "412 of 952 checked, $61.20 of the $200 budget" / when it finished or why it stopped. */
export function runLine(r: PcRun | undefined, enabled: boolean): string {
  if (!r) return enabled ? 'No run yet - the first starts Saturday evening, or start one now.' : 'Switched off - no run yet.';
  const spent = `$${Number(r.cost_usd).toFixed(2)}${r.budget_usd ? ` of the $${Number(r.budget_usd).toFixed(0)} budget` : ''}`;
  const when = new Date(r.started_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (!r.finished_at) return `Run started ${when}: ${r.items_done} of ${r.items_total} checked, ${spent}.`;
  return `Last run ${when}: ${r.items_done} of ${r.items_total} checked, ${spent}${r.stopped ? ` - stopped: ${r.stopped}` : ''}.`;
}

/** A price per piece: cents, or tenths of a cent under a dollar ("$0.312"). */
export const fmtUnit = (n: number | null | undefined) => (n == null ? '-' : `$${Number(n) < 1 ? Number(n).toFixed(3) : Number(n).toFixed(2)}`);

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('kount-price-check', { body });
  if (error) {
    let m = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx && typeof ctx.json === 'function') m = (await ctx.json()).error ?? m; } catch { /* generic */ }
    throw new Error(m);
  }
  return data as T;
}
export const syncBibles = () => invoke<{ items: number; checkable: number; bought: number; retired: number }>({ action: 'sync' });
export const startRun = () => invoke<{ run_id: string; checkable: number; enabled: boolean }>({ action: 'start' });
export const checkNow = (itemId: string) => invoke<{ check: PcCheck | null }>({ action: 'check', item_id: itemId });

export async function setQuote(itemId: string, state: 'requested' | 'received' | null, vendor: string, price: number | null, note: string): Promise<void> {
  const { error } = await supabase.rpc('kount_pc_set_quote', { p_item: itemId, p_state: state, p_vendor: vendor, p_price: price, p_note: note });
  if (error) throw new Error(error.message);
}
export async function setSettings(p: { enabled?: boolean; budget?: number; overpay?: number; model?: string }): Promise<void> {
  const { error } = await supabase.rpc('kount_pc_set_settings', { p_enabled: p.enabled ?? null, p_budget: p.budget ?? null, p_overpay: p.overpay ?? null, p_model: p.model ?? null });
  if (error) throw new Error(error.message);
}
