import type { BibleIndex } from './bibleRender';
import { itemKey, lineItemKeys } from './leadTime';
import { MULTIPLE_VENUES, type OtLine, type OtOrder } from './orderTracker';

/* ── quotes checked against the venue bibles (v1.07) ───────────────────────
 * The user: "can we have this such as the quotes are check against the bibles to ensure same items exist".
 * A quoted line is IN the bible only when one of its item numbers (its SKU, a "Model No. …", or a code in
 * its text) is one of the item numbers of its venue's current bible (the Manufacturer Item # / Item # /
 * Vendor Item # / SKU columns), as written or without E&E's SP prefix. The quote is green only when every
 * quoted line is in. Anything else is left for a person: a number that is only close to one in the bible
 * (Steelite P64152 vs NUDE 64152-024), a number the bible does not have, a line with no number, a venue
 * with no bible. Names never make a line green: "Dessert Fork" / "Salad Fork" share the same Steelite
 * series, so a name only says which bible row to look at. */

/** A current bible as the tracker loads it: no file, just its text copy (0145). */
export interface BibleText { id: string; venue_id: string; title: string; text_index?: BibleIndex | null }
export interface BibleRow { bible: string; sheet: string; item: string; maker: string; number: string }
/** in: its number is in the bible · near: only a close number is · missing: its number is not ·
 *  no-number: nothing to look up · no-bible: its venue has none · unread: the bible's text is not saved yet */
export type LineBibleState = 'in' | 'near' | 'missing' | 'no-number' | 'no-bible' | 'unread';
export interface LineBibleCheck {
  line: OtLine; state: LineBibleState; venueId: string | null;
  /** the bibles it was checked against (titles) */
  bibles: string[];
  /** in: the row it matched · near: the closest number · missing / no-number: the row its name is most like */
  row: BibleRow | null;
  /** the item numbers read off the line (normalised) */
  keys: string[];
}
export interface QuoteBibleCheck {
  order: OtOrder; lines: LineBibleCheck[];
  /** every quoted line is in its venue's bible */
  ok: boolean;
  /** the lines that are not: for a person to check */
  off: LineBibleCheck[];
  bibles: string[];
  /** venues with quoted lines and no bible */
  noBible: Array<string | null>;
}

const NUMBER_COL = /item\s*(#|no\b|number)|\bsku\b|mfr\.?\s*#|\bmpn\b|model\s*(#|no\b|number)/i;
const MAKER_COL = /manufacturer|\bbrand\b/i;
// a size, an amount or a year, never a product number: "12x18", "750ml", "16oz", "100cs", "2026"
const NOT_A_NUMBER = /^\d+(X\d+)+$|^\d+(ML|CL|OZ|FLOZ|L|LB|LBS|G|KG|IN|INCH|CM|MM|FT|CT|CS|PK|PC|PCS|EA|QT|GAL|DZ)$|^(19|20)\d\d$/;
const numberish = (k: string) => k.length >= 3 && /\d/.test(k) && !NOT_A_NUMBER.test(k);
/** E&E writes many numbers with its SP prefix ("SPLM40Z021"): look both up. */
const withoutSp = (k: string) => (k.startsWith('SP') && k.length >= 6 ? [k, k.slice(2)] : [k]);

/** The item numbers in one item-number cell: the whole cell, and each part of it ("MPN: TR119SR", "A / B"). */
export function cellNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const raw of [text, ...text.split(/[\s,;/|:()]+/)]) {
    const k = itemKey(raw);
    if (numberish(k)) for (const x of withoutSp(k)) out.add(x);
  }
  return [...out];
}

const MODEL_NO = /\b(?:model|style|part|mfr|mpn|sku|item)\s*(?:no\.?|number|#)\s*:?\s*([A-Za-z0-9][A-Za-z0-9.\-]*[A-Za-z0-9])/gi;

/** A quoted line's item numbers, its own first: the SKU, a "Model No. …" in its text, then any code in its
 *  text (lineItemKeys). A short SKU or model number counts here ("6424") — it is only compared with the
 *  bible's item-number cells, never with free text. */
export function lineNumbers(l: Pick<OtLine, 'sku' | 'description'>): string[] {
  const out = new Set<string>();
  const add = (raw: string) => { const k = itemKey(raw); if (numberish(k)) for (const x of withoutSp(k)) out.add(x); };
  for (const part of (l.sku ?? '').split(/[\s,;/|]+/)) add(part);
  for (const m of l.description.matchAll(MODEL_NO)) add(m[1]);
  // the codes in its text (not the SKU again: two SKUs run together are no number)
  for (const k of lineItemKeys({ sku: null, description: l.description })) add(k);
  return [...out];
}

interface BibleBookIndex { titles: string[]; unread: string[]; byNumber: Map<string, BibleRow>; rows: BibleRow[] }

/** One venue's current bibles, by item number. */
export function indexBibles(bibles: readonly BibleText[]): BibleBookIndex {
  const out: BibleBookIndex = { titles: bibles.map(b => b.title), unread: [], byNumber: new Map(), rows: [] };
  for (const b of bibles) {
    if (!b.text_index?.sheets) { out.unread.push(b.title); continue; }
    for (const s of b.text_index.sheets) {
      const nums = s.header.map((h, i) => (NUMBER_COL.test(h) ? i : -1)).filter(i => i >= 0);
      const exact = s.header.findIndex(h => /^\s*item\s*$/i.test(h));
      const itemCol = exact >= 0 ? exact : s.header.findIndex(h => /\bitem\b/i.test(h) && !NUMBER_COL.test(h));
      const descCol = s.header.findIndex(h => /description/i.test(h));
      const makerCol = s.header.findIndex(h => MAKER_COL.test(h) && !NUMBER_COL.test(h));
      for (const r of s.rows) {
        const number = nums.map(i => r[i] ?? '').find(t => t.trim()) ?? '';
        const row: BibleRow = { bible: b.title, sheet: s.name, item: (r[itemCol] || r[descCol] || '').trim(), maker: (r[makerCol] ?? '').trim(), number: number.trim() };
        if (!row.item && !row.number) continue;
        out.rows.push(row);
        for (const i of nums) for (const k of cellNumbers(r[i] ?? '')) if (!out.byNumber.has(k)) out.byNumber.set(k, row);
      }
    }
  }
  return out;
}

/** The longest run two numbers share. */
function common(a: string, b: string): number {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = up;
    }
  }
  return best;
}

/** A bible number close to one of the line's: 5+ characters in a row shared, most of the shorter one
 *  ("P64152" ~ "64152-024", "5340Z021" ~ "SPLM40Z021"). Close is not the same: it only says where to look. */
export function nearNumber(keys: readonly string[], ix: BibleBookIndex): BibleRow | null {
  let best: { row: BibleRow; run: number } | null = null;
  for (const k of keys) {
    if (k.length < 5) continue;
    for (const [n, row] of ix.byNumber) {
      if (n.length < 5) continue;
      const run = common(k, n);
      if (run >= 5 && run >= 0.6 * Math.min(k.length, n.length) && (!best || run > best.run)) best = { row, run };
    }
  }
  return best?.row ?? null;
}

const STOP = new Set(['custom', 'the', 'and', 'with', 'for', 'each', 'case', 'packed', 'model', 'clear', 'inch', 'per', 'pack', 'set', 'this', 'from', 'usually', 'ordered', 'hwood']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3 && !STOP.has(w)).map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));

/** The bible row whose item (and maker) shares the most words with the line: two at least, one from the item.
 *  The item's words count double: "SERVICE TRAY" is the Bottle Service Tray, not the Bussing Tray by Service Ideas. */
export function nameHint(l: Pick<OtLine, 'description'>, ix: BibleBookIndex): BibleRow | null {
  const lw = words(l.description);
  let best: { row: BibleRow; score: number } | null = null;
  for (const row of ix.rows) {
    const iw = [...words(row.item)].filter(w => lw.has(w));
    if (!iw.length) continue;
    const mw = [...words(row.maker)].filter(w => lw.has(w) && !iw.includes(w));
    const score = iw.length * 2 + mw.length;
    if (iw.length + mw.length >= 2 && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
}

/** The venue a line is for: its own (an order for several venues), else the order's. */
const lineVenue = (o: OtOrder, l: OtLine): string | null => l.venue_id ?? (o.venue_id && o.venue_id !== MULTIPLE_VENUES ? o.venue_id : null);

/** One order's quoted lines against its venues' bibles; null when nothing on it is quoted or it is closed. */
export function checkQuoteAgainstBible(order: OtOrder, lines: readonly OtLine[], bibles: readonly BibleText[],
  cache: Map<string, BibleBookIndex> = new Map()): QuoteBibleCheck | null {
  if (order.archived_at || order.completed_at) return null;
  const quoted = lines.filter(l => l.order_id === order.id && l.status === 'QUOTED');
  if (!quoted.length) return null;
  const ixFor = (venue: string) => cache.get(venue) ?? cache.set(venue, indexBibles(bibles.filter(b => b.venue_id === venue))).get(venue)!;
  const checked = quoted.map((l): LineBibleCheck => {
    const venueId = lineVenue(order, l);
    const keys = lineNumbers(l);
    const ix = venueId ? ixFor(venueId) : null;
    const base = { line: l, venueId, keys, bibles: ix?.titles ?? [] };
    if (!ix || !ix.titles.length) return { ...base, state: 'no-bible', row: null };
    if (ix.unread.length === ix.titles.length) return { ...base, state: 'unread', row: null };
    const hit = keys.map(k => ix.byNumber.get(k)).find(Boolean);
    if (hit) return { ...base, state: 'in', row: hit };
    if (!keys.length) return { ...base, state: 'no-number', row: nameHint(l, ix) };
    const near = nearNumber(keys, ix);
    return near ? { ...base, state: 'near', row: near } : { ...base, state: 'missing', row: nameHint(l, ix) };
  });
  const off = checked.filter(c => c.state !== 'in');
  return {
    order, lines: checked, ok: off.length === 0, off,
    bibles: [...new Set(checked.flatMap(c => c.bibles))],
    noBible: [...new Set(checked.filter(c => c.state === 'no-bible').map(c => c.venueId))],
  };
}

/** Every open order with quoted lines, checked; empty when the bibles did not load (no check, no flags). */
export function quoteBibleChecks(orders: readonly OtOrder[], lines: readonly OtLine[], bibles: readonly BibleText[] | undefined): Map<string, QuoteBibleCheck> {
  const out = new Map<string, QuoteBibleCheck>();
  if (!bibles) return out;
  const byOrder = new Map<string, OtLine[]>();
  for (const l of lines) if (l.status === 'QUOTED') (byOrder.get(l.order_id) ?? byOrder.set(l.order_id, []).get(l.order_id)!).push(l);
  const cache = new Map<string, BibleBookIndex>();
  for (const o of orders) {
    const ls = byOrder.get(o.id);
    if (!ls) continue;
    const c = checkQuoteAgainstBible(o, ls, bibles, cache);
    if (c) out.set(o.id, c);
  }
  return out;
}

const rowText = (r: BibleRow) => [r.item, r.maker, r.number].filter(Boolean).join(' · ');

/** What a line says about the bible, in the order panel. */
export function lineBibleText(c: LineBibleCheck): string {
  switch (c.state) {
    case 'in': return `in the bible: ${c.row!.item || c.row!.number} (${c.row!.sheet})`;
    case 'near': return `not exact in the bible: it has ${rowText(c.row!)} (${c.row!.sheet})`;
    case 'missing': return `item # not in the bible${c.row ? `; closest by name: ${rowText(c.row)}` : ''}`;
    case 'no-number': return `no item # to check against the bible${c.row ? `; looks like ${rowText(c.row)}` : ''}`;
    case 'no-bible': return 'no bible for this venue';
    case 'unread': return 'bible not read yet: open it once under Bibles';
  }
}

/** The quote's line in the order panel and the bell: green only when every quoted line is in the bible. */
export function quoteBibleSummary(c: QuoteBibleCheck, venueName: (id: string | null) => string = id => id ?? 'this venue'): { ok: boolean; title: string; sub: string } {
  const n = c.lines.length;
  const items = `${n} quoted item${n === 1 ? '' : 's'}`;
  const where = c.bibles.length ? `the ${c.bibles.join(' / ')}` : 'a bible';
  if (c.ok) return { ok: true, title: 'Matches the bible', sub: `${n === 1 ? 'The quoted item is' : `All ${items} are`} in ${where} by item number.` };
  if (c.off.every(x => x.state === 'no-bible')) {
    return { ok: false, title: 'No bible to check it against', sub: `${c.noBible.map(venueName).join(', ')} has no bible. Upload it under Bibles to check this quote.` };
  }
  // "DESSERT FORK 5340Z023": the line's name (up to " - " or "Model No.") and its number
  const short = (x: LineBibleCheck) => {
    const name = x.line.description.replace(/\s+/g, ' ').trim().split(/\s+-\s+|\s+model\s+no\b/i)[0].slice(0, 36).trim();
    const num = (x.line.sku ?? '').trim() || (x.keys[0] ?? '');
    return num && !itemKey(name).includes(itemKey(num)) ? `${name} ${num}` : name;
  };
  const list = c.off.slice(0, 3).map(x => `${short(x)} (${x.state === 'near' ? 'number differs' : x.state === 'missing' ? 'not in it' : x.state === 'no-number' ? 'no item #' : x.state === 'unread' ? 'bible not read' : 'no bible'})`);
  return {
    ok: false, title: 'Check it against the bible',
    sub: `${c.off.length} of ${items} not found in ${where} by item number: ${list.join('; ')}${c.off.length > 3 ? `; +${c.off.length - 3} more` : ''}.`,
  };
}
