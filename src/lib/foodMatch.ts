/* ───────────────────────────────────────────────────────────────────────
   foodMatch — pure helpers for the typed food count (Food count → Type counts).

   foodKey      the spelling-proof key, SAME rules as the database's
                kount_food_key (migration 0155), so the screen and the import
                agree on what "the same item" is:
                  "Butter, Unsalted" = "Unsalted Butter" = "Butter Unsalted 1 lb"
                lower case, accents off, "(4/1 gal)"-style notes, sizes ("5lb",
                "40%") and pack counts ("20/24") gone, simple plurals singular,
                filler words dropped, words sorted.
   unitLabel    the unit a venue types ("cs (4/1 gal)", "bag (25 lb)", "pk (50 ct)")
                as words a chef reads at a glance: "Case" + "4 × 1 gal".
   rankMatches  suggestions for a typed name: same key first, then most shared
                words; used for "add an item" so a new spelling lands on the
                item the venue already has instead of a duplicate.
   ─────────────────────────────────────────────────────────────────────── */

const STOP = new Set(['and', 'the', 'of', 'a', 'w', 'with', 'for', 'in', 'x']);

// Combining accents (U+0300..U+036F) built from char codes: written as escapes, an editor can turn them into
// the invisible characters themselves (same reason as FoodCount.tsx's INVISIBLE).
const COMBINING = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(COMBINING, '');
}

function singular(t: string): string {
  if (t.length > 3 && /(ss|us|is)$/.test(t)) return t;
  if (t.length > 4 && /ies$/.test(t)) return t.slice(0, -3) + 'y';
  if (t.length > 4 && /(ch|sh|x|z)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 4 && /oes$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && /s$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Same result as SQL kount_food_key(name). */
export function foodKey(name: string | null | undefined): string {
  let s = stripAccents(String(name ?? '').toLowerCase());
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/\d+(\.\d+)?\s*(lbs?|#|oz|g|kg|ml|l|gal|ct|pcs?|pk|cs|ea|qt|pt|dz|in|cm|mm|%)(?![a-z])/g, ' ');
  s = s.replace(/\d+(\.\d+)?(\/\d+(\.\d+)?)*/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  const words = new Set<string>();
  for (const t of s.split(' ')) {
    if (t === '' || STOP.has(t)) continue;
    words.add(singular(t));
  }
  return [...words].sort().join(' ');
}

/* ───────────────────────── units ───────────────────────── */

const UNIT_WORDS: Record<string, string> = {
  lb: 'lb', lbs: 'lb', '#': 'lb', oz: 'oz', kg: 'kg', g: 'g',
  ea: 'Each', each: 'Each', pc: 'Piece', pcs: 'Piece', piece: 'Piece',
  cs: 'Case', case: 'Case', pk: 'Pack', pack: 'Pack', pkg: 'Package', bag: 'Bag', box: 'Box', bx: 'Box',
  tub: 'Tub', carton: 'Carton', ctn: 'Carton', tray: 'Tray', ty: 'Tray', pl: 'Pail', pail: 'Pail',
  bunch: 'Bunch', bn: 'Bunch', dz: 'Dozen', dozen: 'Dozen', qt: 'Quart', pt: 'Pint', gal: 'Gallon',
  jar: 'Jar', can: 'Can', btl: 'Bottle', bottle: 'Bottle', bucket: 'Bucket', container: 'Container',
};

export interface UnitLabel {
  /** What one counted "1" is: "Case", "lb", "Each". */
  unit: string;
  /** What is inside / how big it is: "4 × 1 gal", "25 lb", "50 ct". Null when the unit says it all. */
  detail: string | null;
  /** Both together, for a single line: "Case · 4 × 1 gal". */
  text: string;
}

/** "cs (4/1 gal)" -> Case · 4 × 1 gal;  "bag (25 lb)" -> Bag · 25 lb;  "5 lb" -> 5 lb;  "cs" + 12/case -> Case · 12 per case. */
export function unitLabel(countUnit: string | null | undefined, unitsPerCase?: number | null): UnitLabel {
  const raw = String(countUnit ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) {
    return { unit: 'Unit', detail: null, text: 'Unit' };
  }
  const m = /^([a-z#.]+)\s*(?:\((.*)\))?$/.exec(raw);
  if (!m) {
    // "5 lb", "3 lb", "32 oz": a fixed-size unit, read as written.
    return { unit: raw, detail: null, text: raw };
  }
  const word = m[1].replace(/\.$/, '');
  const unit = UNIT_WORDS[word] ?? word;
  let detail: string | null = null;
  const inner = (m[2] ?? '').trim();
  if (inner) {
    const pack = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*([a-z#]+)$/.exec(inner);   // 4/1 gal
    detail = pack ? `${pack[1]} × ${pack[2]} ${pack[3]}` : inner;                       // 25 lb, 50 ct
  } else if (unitsPerCase && unitsPerCase > 1 && (unit === 'Case' || unit === 'Pack' || unit === 'Box')) {
    detail = `${fmtNum(unitsPerCase)} per ${unit.toLowerCase()}`;
  }
  return { unit, detail, text: detail ? `${unit} · ${detail}` : unit };
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Units offered when adding an item; the first matches how most of Little Luck's list counts. */
export const UNIT_CHOICES = ['lb', 'ea', 'cs', 'pk', 'bag', 'qt', 'gal', 'dz', 'tub', 'oz'] as const;

/* ───────────────────────── matching ───────────────────────── */

export interface MatchCandidate { id: string; name: string }
export interface RankedMatch<T extends MatchCandidate> { item: T; score: number; sameKey: boolean }

/** Suggestions for a typed name. Same key = 1; otherwise shared words / all words (both sides).
 *  Anything sharing no word is dropped. Best first, then by name. */
export function rankMatches<T extends MatchCandidate>(typed: string, candidates: T[], limit = 8): RankedMatch<T>[] {
  const key = foodKey(typed);
  if (!key) return [];
  const want = new Set(key.split(' '));
  const out: RankedMatch<T>[] = [];
  for (const c of candidates) {
    const ck = foodKey(c.name);
    if (!ck) continue;
    if (ck === key) { out.push({ item: c, score: 1, sameKey: true }); continue; }
    const have = new Set(ck.split(' '));
    let shared = 0;
    for (const w of want) {
      if (have.has(w)) shared++;
      else if (w.length >= 4 && [...have].some(h => h.length >= 4 && (h.startsWith(w) || w.startsWith(h)))) shared += 0.5;
    }
    if (shared === 0) continue;
    const score = shared / (want.size + have.size - shared);
    out.push({ item: c, score, sameKey: false });
  }
  out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return out.slice(0, limit);
}

/* ───────────────────────── quantities ───────────────────────── */

/** A typed quantity: "" -> not counted (null); "0" -> counted zero; "1.5" / "1,5" -> 1.5; junk -> NaN. */
export function parseQty(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return NaN;
  return Number(t);
}
