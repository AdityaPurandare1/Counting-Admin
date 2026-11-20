/**
 * foodUnits — changing how a food item is counted (v1.31, RPC kount_food_set_count_unit, migration 0205).
 *
 * A count unit is a word with an optional size, as on the venue's food list: "lb", "ea (5 lb)",
 * "cs (30/1 lb)", "pk (50 ct)", "cs (12/14 oz)". Changing it takes one number — how many of the NEW
 * unit make one of the OLD unit (1 cs (30/1 lb) = 30 lb) — because the venue's price, every past
 * count of the item and its invoice maps are restated with it (same value, new unit).
 *
 * When both units state their size in the same measure (weight, volume or pieces) the number is
 * worked out here; otherwise the person types it. 'oz' is read as weight (food), 'fl oz' as volume.
 */

/** Units offered when changing how an item is counted. "other" lets the person type their own word. */
export const COUNT_UNIT_WORDS = ['lb', 'oz', 'kg', 'g', 'ea', 'cs', 'pk', 'bag', 'tub', 'qt', 'gal', 'l', 'dz', 'bunch', 'tray', 'btl'] as const;

const WEIGHT_G: Record<string, number> = { lb: 453.592, lbs: 453.592, '#': 453.592, oz: 28.3495, kg: 1000, g: 1, gr: 1 };
const VOLUME_ML: Record<string, number> = {
  gal: 3785.41, qt: 946.353, pt: 473.176, l: 1000, lt: 1000, ml: 1, floz: 29.5735, 'fl oz': 29.5735, 'fl.oz': 29.5735,
};
const PIECE_WORDS = new Set(['ea', 'each', 'pc', 'pcs', 'piece', 'ct', 'count', 'head', 'heads', 'unit', 'units']);

/** What ONE of a count unit holds: grams, millilitres and/or pieces — whichever its label says. */
export interface UnitMeasure { grams?: number; ml?: number; pieces?: number }

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (s: string) => Number(s);

/** One amount of a unit word: "5 lb" -> 5 x 453.592 g; "50 ct" -> 50 pieces; "1 gal" -> ml. */
function sizeOf(amount: number, unitWord: string): UnitMeasure | null {
  const w = unitWord.replace(/\.$/, '');
  if (w in WEIGHT_G) return { grams: amount * WEIGHT_G[w] };
  if (w in VOLUME_ML) return { ml: amount * VOLUME_ML[w] };
  if (PIECE_WORDS.has(w)) return { pieces: amount };
  if (w === 'dz' || w === 'doz' || w === 'dozen') return { pieces: amount * 12 };
  return null;
}

/** The size inside the brackets: "30/1 lb" (30 of 1 lb), "5 lb", "50 ct", "48/1 ea". */
function innerMeasure(inner: string): UnitMeasure | null {
  const pack = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*([a-z#.]+(?: oz)?)$/.exec(inner);
  if (pack) {
    const each = sizeOf(num(pack[2]), pack[3]);
    const n = num(pack[1]);
    if (!each) return { pieces: n };
    return {
      grams: each.grams !== undefined ? each.grams * n : undefined,
      ml: each.ml !== undefined ? each.ml * n : undefined,
      pieces: each.pieces !== undefined ? each.pieces * n : n,
    };
  }
  const one = /^(\d+(?:\.\d+)?)\s*([a-z#.]+(?: oz)?)$/.exec(inner);
  if (one) {
    const m = sizeOf(num(one[1]), one[2]);
    if (!m) return null;
    return m.pieces !== undefined ? m : { ...m, pieces: 1 };   // "ea (5 lb)": one piece of 5 lb
  }
  return null;
}

/** What one of this count unit holds, or null when its label does not say. */
export function measureOf(countUnit: string | null | undefined, unitsPerCase?: number | null): UnitMeasure | null {
  const raw = norm(countUnit);
  if (!raw) return null;
  const m = /^([a-z#.]+(?: oz)?)\s*(?:\((.*)\))?$/.exec(raw);
  if (!m) {
    const fixed = /^(\d+(?:\.\d+)?)\s*([a-z#.]+(?: oz)?)$/.exec(raw);   // "5 lb", "32 oz"
    return fixed ? sizeOf(num(fixed[1]), fixed[2]) : null;
  }
  const word = m[1].replace(/\.$/, '');
  const inner = (m[2] ?? '').trim();
  if (inner) {
    const im = innerMeasure(inner);
    if (im) return im;
  }
  const own = sizeOf(1, word);
  if (own) return own;
  if ((word === 'cs' || word === 'case' || word === 'pk' || word === 'pack' || word === 'box') && unitsPerCase && unitsPerCase > 0) {
    return { pieces: unitsPerCase };
  }
  return null;
}

/** How many of the new unit make one of the old unit, when both labels say so in the same measure
 *  (weight first, then volume, then pieces). Null = the person has to type it. */
export function suggestFactor(oldUnit: string | null | undefined, oldPack: number | null | undefined,
                              newUnit: string | null | undefined, newPack: number | null | undefined): number | null {
  const a = measureOf(oldUnit, oldPack);
  const b = measureOf(newUnit, newPack);
  if (!a || !b) return null;
  let f: number | null = null;
  if (a.grams !== undefined && b.grams !== undefined && b.grams > 0) f = a.grams / b.grams;
  else if (a.ml !== undefined && b.ml !== undefined && b.ml > 0) f = a.ml / b.ml;
  else if (a.pieces !== undefined && b.pieces !== undefined && b.pieces > 0) f = a.pieces / b.pieces;
  if (f === null || !Number.isFinite(f) || f <= 0) return null;
  return Math.round(f * 10000) / 10000;
}

/** The label stored on the list: the word, plus its size in brackets when one is given. */
export function composeUnit(word: string, size?: string | null): string {
  const w = norm(word);
  const s = norm(size).replace(/^\((.*)\)$/, '$1');
  return s ? `${w} (${s})` : w;
}

/** The typed factor, or NaN when it is not a usable number. Accepts "30", "0.5", "1/6". */
export function parseFactor(text: string): number {
  const t = text.trim().replace(',', '.');
  if (!t) return Number.NaN;
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  const v = frac ? num(frac[1]) / num(frac[2]) : /^\d*\.?\d+$/.test(t) ? num(t) : Number.NaN;
  return Number.isFinite(v) && v > 0 && v <= 100000 ? v : Number.NaN;
}
