/**
 * Unit + round-trip test for src/lib/auditReport.ts:
 *
 *   PURE HELPERS
 *     glAccount()             — master_items.category → GL account
 *     countUnit()             — COUNT UNIT column, incl. ml→L promotion
 *     sheetSafe()             — Excel-legal sheet names
 *     makeSheetNamer()        — collision-free sheet-name allocator
 *     pickNewestPrices()      — newest purchase_items cost per master
 *     chunk()                 — fixed-size batches
 *     localIsoDate() / usDate() — the two date renderings
 *     titleCase()             — SUBCATEGORY normalisation
 *     ordinalCompare()        — Bevager's code-unit item ordering
 *     round2 / round4         — half-up rounding on write
 *     buildAuditReportModel() — the whole roll-up
 *
 *   WORKBOOK
 *     buildAuditWorkbookBlob() is built for real and read back with exceljs,
 *     so sheet inventory, sheet ORDER, the five-row header block, the row-7 /
 *     row-8 layout and a sample of cells on every sheet type are asserted
 *     rather than assumed. The builder used to be covered only by typecheck
 *     and by a manual cell-by-cell diff against the Poppy 2026-08-23 Bevager
 *     export; those diffs live outside CI, this does not.
 *
 * Run with:  npm test
 *
 * No test framework is configured in this repo, so this is a plain tsx script
 * that exits non-zero if any assertion fails. The workbook sections use
 * top-level await, so they run BEFORE the pass/fail summary at the bottom.
 */
import type ExcelJSNS from 'exceljs';
import {
  glAccount,
  countUnit,
  sheetSafe,
  makeSheetNamer,
  locationHeaders,
  pickNewestPrices,
  toCountLines,
  NO_ZONE,
  chunk,
  localIsoDate,
  usDate,
  titleCase,
  ordinalCompare,
  round2,
  round4,
  locationAccountKey,
  buildAuditReportModel,
  buildAuditWorkbookBlob,
  type AuditCountLine,
  type AuditEntryRow,
  type PriceRow,
} from '../src/lib/auditReport.ts';
import type { MasterItem } from '../src/lib/types.ts';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
    if (detail !== undefined) console.error('        got:', JSON.stringify(detail));
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(`${label} === ${JSON.stringify(expected)}`, actual === expected, actual);
}

function deepEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(`${label} === ${b}`, a === b, actual);
}

/** Most of this file builds real workbooks, and a regression in the sheet-name
 *  allocator makes exceljs THROW rather than return something wrong. Under
 *  top-level await that surfaces as an unhandled rejection, which would kill
 *  the run before the summary — leaving a red suite with no count and no line
 *  saying what broke. Catching it keeps the house output format intact and
 *  still exits non-zero. */
function abort(kind: string, e: unknown): never {
  failed++;
  console.error(`  FAIL  ${kind} — the suite could not finish`);
  console.error('        ', e instanceof Error ? (e.stack ?? e.message) : String(e));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
process.on('uncaughtException', e => abort('uncaught exception', e));
process.on('unhandledRejection', e => abort('unhandled rejection', e));

/* ── glAccount ── */
console.log('\nglAccount');
eq('Liquor Cost', glAccount('Liquor Cost'), '5310 - Liquor Cost');
eq('Wine Cost', glAccount('Wine Cost'), '5320 - Wine Cost');
eq('Beer Cost', glAccount('Beer Cost'), '5330 - Beer Cost');
eq('N/A Beverage Cost', glAccount('N/A Beverage Cost'), '5335 - N/A Beverage Cost');
// The catalog carries legacy lowercase spellings for the same families;
// Bevager rolls them into the same account, and so must we — it is what makes
// the Poppy liquor total land on 96,398.79 instead of 96,357.09.
eq('legacy liquor', glAccount('liquor'), '5310 - Liquor Cost');
eq('legacy wine', glAccount('wine'), '5320 - Wine Cost');
eq('legacy beer', glAccount('beer'), '5330 - Beer Cost');
eq('legacy non_alcoholic_beverage', glAccount('non_alcoholic_beverage'), '5335 - N/A Beverage Cost');
eq('slashless na spelling', glAccount('NA Beverage Cost'), '5335 - N/A Beverage Cost');
eq('padded + odd case', glAccount('  LIQUOR cost '), '5310 - Liquor Cost');
eq('out of scope', glAccount('Bar Consumables'), null);
eq('food', glAccount('Produce Cost'), null);
eq('null', glAccount(null), null);
eq('undefined', glAccount(undefined), null);
eq('empty', glAccount(''), null);
eq('whitespace only', glAccount('   '), null);

/* ── countUnit ── */
console.log('\ncountUnit');
eq('750 ml', countUnit(750, 'ml', 'Campari 750ml'), '750ml');
eq('1 L', countUnit(1, 'L', 'Belvedere 1L'), '1L');
eq('1.75 L', countUnit(1.75, 'L', 'Belvedere 1.75L'), '1.75L');
eq('12 floz', countUnit(12, 'floz', 'Bud Light 12fl.oz'), '12floz');
eq('8.4 floz', countUnit(8.4, 'floz', 'Red Bull 8.4fl.oz'), '8.4floz');
// Bevager prints a litre-or-more millilitre size in litres.
eq('1000ml promotes to 1L', countUnit(1000, 'ml', 'Jim Beam Bourbon 1L'), '1L');
eq('1500ml promotes to 1.5L', countUnit(1500, 'ml', 'Something 1.5L'), '1.5L');
eq('999ml stays ml', countUnit(999, 'ml', 'Odd 999ml'), '999ml');
eq('lowercase l upcases', countUnit(1.5, 'l', 'Something 1.5L'), '1.5L');
// Masters with no size attributes fall back to the size in the name.
eq('name fallback each', countUnit(null, null, 'Jolene Cold Brew 1each'), '1each');
eq('name fallback fl.oz', countUnit(null, null, 'Bud Light 12fl.oz'), '12floz');
eq('name fallback litre', countUnit(null, null, 'Belvedere 1L'), '1L');
eq('no size anywhere', countUnit(null, null, 'Mystery Bottle'), '');
eq('size without unit', countUnit(750, null, 'Mystery'), '');
// base_size = 0 exists in prod on masters whose size was never filled in. It
// means "missing", not "zero millilitres" — printing '0ml' as the COUNT UNIT
// on a 750ml bottle is what this pins shut.
eq('base_size 0 falls through to the name', countUnit(0, 'ml', 'Mystery 750ml'), '750ml');
eq('base_size 0 with no name token', countUnit(0, 'ml', 'Mystery Bottle'), '');
eq('base_size 0 + name litre token', countUnit(0, 'ml', 'Mystery 1L'), '1L');
eq('negative base_size falls through', countUnit(-750, 'ml', 'Negative 750ml'), '750ml');
eq('negative base_size, no token', countUnit(-750, 'ml', 'Negative'), '');
eq('NaN base_size falls through', countUnit(Number.NaN, 'ml', 'Mystery 750ml'), '750ml');
eq('Infinity base_size falls through', countUnit(Number.POSITIVE_INFINITY, 'ml', 'Mystery 750ml'), '750ml');
// PostgREST hands numerics back as strings often enough to be worth pinning.
eq('numeric-string base_size', countUnit('750' as unknown as number, 'ml', 'Mystery'), '750ml');
eq('empty item name, no size', countUnit(null, null, ''), '');
eq('empty base_unit is falsy → name fallback', countUnit(750, '', 'Mystery 375ml'), '375ml');

/* ── sheetSafe ── */
console.log('\nsheetSafe');
eq('slash becomes comma', sheetSafe('5335 - N/A Beverage Cost'), '5335 - N,A Beverage Cost');
eq('backslash becomes comma', sheetSafe('Walk\\In - Loc'), 'Walk,In - Loc');
eq('plain passes through', sheetSafe('Back Bar - Loc'), 'Back Bar - Loc');
eq('brackets stripped', sheetSafe('Walk [In] - Loc'), 'Walk  In  - Loc');
eq('colon question asterisk stripped', sheetSafe('A:B?C*D'), 'A B C D');
eq('31 char cap', sheetSafe('A'.repeat(40)).length, 31);
// exceljs (worksheet.js:159) throws when a name starts or ends with an
// apostrophe, and (worksheet.js:147) when it is empty.
eq('leading + trailing apostrophes stripped', sheetSafe("'Bar'"), 'Bar');
eq('apostrophes only → placeholder', sheetSafe("'''"), 'Sheet');
eq('whitespace only → placeholder', sheetSafe('   '), 'Sheet');
eq('empty → placeholder', sheetSafe(''), 'Sheet');
eq('sanitises to empty → placeholder', sheetSafe(':::'), 'Sheet');
eq('interior apostrophe is legal and kept', sheetSafe("Joe's Bar"), "Joe's Bar");
// The 31-char cut can itself land on a space or an apostrophe, which Excel
// also refuses — hence the second trailing trim after the slice.
eq('cut landing on a space is re-trimmed', sheetSafe('A'.repeat(30) + ' Tail'), 'A'.repeat(30));
eq('cut landing on an apostrophe is re-trimmed', sheetSafe('A'.repeat(30) + "' - Loc"), 'A'.repeat(30));
check('no sanitised name ends with an apostrophe',
  !sheetSafe('A'.repeat(30) + "' - Loc").endsWith("'"));

/* ── makeSheetNamer ── */
console.log('\nmakeSheetNamer');
{
  // Zones are free text, so 'Bar' and 'bar' are two real locations. exceljs
  // rejects a CASE-INSENSITIVE duplicate, which used to throw at the very end
  // of a multi-second export and lose the whole thing.
  const namer = makeSheetNamer();
  const bar = [namer('Bar'), namer('bar'), namer('BAR')];
  deepEq('case-only duplicates get suffixes', bar, ['Bar', 'bar (2)', 'BAR (3)']);
  eq('three distinct names', new Set(bar.map(s => s.toLowerCase())).size, 3);
}
{
  // Two long zones that only differ past char 31 collide once cut.
  const namer = makeSheetNamer();
  const a = namer('Main Floor Back Bar Storage Rooms Alpha');
  const b = namer('Main Floor Back Bar Storage Rooms Beta');
  check('long names differ', a !== b, [a, b]);
  eq('first long name capped', a.length, 31);
  check('second long name still ≤31', b.length <= 31, b.length);
  check('second long name carries a suffix', b.endsWith(' (2)'), b);
}
{
  // A name that sanitises to nothing must not reach exceljs as ''.
  const namer = makeSheetNamer();
  deepEq('empty-ish names get the placeholder + suffixes',
    [namer('   '), namer(':'), namer("'''"), namer('')],
    ['Sheet', 'Sheet (2)', 'Sheet (3)', 'Sheet (4)']);
}
{
  // The suffix itself can collide with a zone literally named 'bar (2)';
  // the allocator must keep counting rather than hand back a duplicate.
  const namer = makeSheetNamer();
  deepEq('suffix collides with a real name', [namer('Bar'), namer('bar (2)'), namer('bar')],
    ['Bar', 'bar (2)', 'bar (3)']);
}
{
  // Ten collisions push the suffix to two digits; the base must shrink to keep
  // the whole name inside 31 chars.
  const namer = makeSheetNamer();
  const names = Array.from({ length: 12 }, () => namer('Z'.repeat(40)));
  check('12 collisions all ≤31 chars', names.every(n => n.length <= 31), names.map(n => n.length));
  eq('12 collisions are all distinct', new Set(names.map(n => n.toLowerCase())).size, 12);
  check('twelfth carries the (12) suffix', names[11].endsWith(' (12)'), names[11]);
}
{
  const namer = makeSheetNamer();
  eq('apostrophe-wrapped name is cleaned', namer("'Quoted'"), 'Quoted');
  eq('unrelated names pass through untouched', namer('Back Bar'), 'Back Bar');
}
{
  // exceljs RESERVES 'History' (worksheet.js:150 — "The name "History" is
  // protected") and throws on it exactly like a duplicate, so the allocator
  // starts with it already taken and every casing routes through the normal
  // collision path.
  const namer = makeSheetNamer();
  deepEq('History is pre-taken, in every casing',
    [namer('History'), namer('history'), namer('HISTORY')],
    ['History (2)', 'history (3)', 'HISTORY (4)']);
}
{
  // The seed has to live INSIDE the factory. A module-scope set would leak
  // across workbooks and make the second export's sheet names depend on what
  // the first one happened to allocate.
  const a = makeSheetNamer();
  const b = makeSheetNamer();
  eq('first factory renames History', a('History'), 'History (2)');
  eq('second factory renames History independently', b('History'), 'History (2)');
  eq('first factory still hands out a plain name', a('Bar'), 'Bar');
  eq('second factory hands out the same plain name', b('Bar'), 'Bar');
  eq('no cross-factory leak on the suffixed name', b('history'), 'history (3)');
  // The seed is an exact match, not a prefix: only the bare word is reserved.
  eq('a zone starting with History is untouched', a('History Bar'), 'History Bar');
  eq('a zone merely resembling it is untouched', a('Historic Bar'), 'Historic Bar');
  eq('the bare word inside a longer zone is fine', a('Bar History'), 'Bar History');
}

/* ── locationHeaders ── */
console.log('\nlocationHeaders');
// THE REFERENCE GATE: with distinct locations the headers are exactly what
// they have always been. The whole collision fallback is worthless if it
// changes this line, because the cell-by-cell diff against the real Bevager
// export runs through it.
deepEq('ordinary locations still shout',
  locationHeaders(['Bar', 'Walk In', 'Storage']), ['BAR', 'WALK IN', 'STORAGE']);
deepEq('six distinct locations, all upper-cased',
  locationHeaders(['Bar', 'Back Bar', 'Walk In', 'Storage', 'Office', 'Patio']),
  ['BAR', 'BACK BAR', 'WALK IN', 'STORAGE', 'OFFICE', 'PATIO']);
// Upper-casing is lossy: three zones that are distinct by design would become
// three identical column headers over three different columns of numbers.
deepEq('only the colliding group falls back to raw text',
  locationHeaders(['BAR', 'Bar', 'bar', 'Walk In']), ['BAR', 'Bar', 'bar', 'WALK IN']);
deepEq('a two-way collision', locationHeaders(['Bar', 'bar']), ['Bar', 'bar']);
deepEq('collision does not disturb neighbours',
  locationHeaders(['Storage', 'Bar', 'bar', 'Walk In']), ['STORAGE', 'Bar', 'bar', 'WALK IN']);
// Case is not the only lossy part of toUpperCase: 'straße' upper-cases to
// 'STRASSE', so a venue with both zones would collide without either being a
// case variant of the other.
deepEq('non-case upper-casing collisions fall back too',
  locationHeaders(['straße', 'STRASSE']), ['straße', 'STRASSE']);
deepEq('empty list', locationHeaders([]), []);
deepEq('single location', locationHeaders(['Bar']), ['BAR']);
deepEq('already upper-case is unchanged', locationHeaders(['BAR', 'WALK IN']), ['BAR', 'WALK IN']);
deepEq('whitespace and punctuation survive', locationHeaders(['Walk/In #2']), ['WALK/IN #2']);
{
  const src = ['Bar', 'bar'];
  locationHeaders(src);
  deepEq('input array is not mutated', src, ['Bar', 'bar']);
  eq('output length always matches input', locationHeaders(['a', 'b', 'c']).length, 3);
  const three = locationHeaders(['BAR', 'Bar', 'bar']);
  eq('a colliding group yields unique headers', new Set(three).size, 3);
}

/* ── pickNewestPrices ── */
console.log('\npickNewestPrices');
const price = (id: string, master: string | null, cost: number | null, at: string | null): PriceRow =>
  ({ id, master_item_id: master, avg_cost: cost, updated_at: at });

/** Every ordering of a row list, so "newest wins" is asserted as the
 *  order-independent property it has to be — PostgREST page order is not
 *  something this code gets to assume. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}
function everyOrderGives(label: string, rows: PriceRow[], master: string, expected: number | undefined) {
  const results = permutations(rows).map(p => pickNewestPrices(p).get(master));
  check(`${label} — all ${results.length} orderings give ${JSON.stringify(expected)}`,
    results.every(r => r === expected), results);
}

eq('empty input', pickNewestPrices([]).size, 0);
eq('single row', pickNewestPrices([price('p1', 'm1', 12.5, '2026-01-01T00:00:00Z')]).get('m1'), 12.5);
{
  const rows = [
    price('p1', 'm1', 10, '2026-01-01T00:00:00Z'),
    price('p2', 'm1', 20, '2026-06-01T00:00:00Z'),
    price('p3', 'm1', 15, '2026-03-01T00:00:00Z'),
  ];
  eq('newest updated_at wins', pickNewestPrices(rows).get('m1'), 20);
  eq('reversed input gives the same pick', pickNewestPrices([...rows].reverse()).get('m1'), 20);
  everyOrderGives('newest wins', rows, 'm1', 20);
}
{
  // `nulls last`: an undated row loses to any dated one, whichever way round
  // the pages came back.
  const rows = [price('p1', 'm1', 99, null), price('p2', 'm1', 7, '2020-01-01T00:00:00Z')];
  everyOrderGives('null updated_at loses to a dated row', rows, 'm1', 7);
}
{
  // All undated → still a price, and the same one every run.
  const rows = [price('a', 'm1', 1, null), price('b', 'm1', 2, null), price('c', 'm1', 3, null)];
  everyOrderGives('all-null updated_at picks the greatest id deterministically', rows, 'm1', 3);
  eq('all-null still returns a price', pickNewestPrices(rows).size, 1);
}
{
  // Defect D: `new Date('garbage').getTime()` is NaN and every `NaN > x` is
  // false, so a single unparseable row used to win forever.
  const rows = [
    price('p1', 'm1', 999, 'not-a-date'),
    price('p2', 'm1', 42, '2026-05-05T00:00:00Z'),
    price('p3', 'm1', 41, '2024-05-05T00:00:00Z'),
  ];
  eq('garbage updated_at first does not win', pickNewestPrices(rows).get('m1'), 42);
  everyOrderGives('garbage updated_at never wins', rows, 'm1', 42);
}
{
  // Garbage is folded to -Infinity, i.e. treated exactly like null — so when
  // it is all there is, it still yields a price rather than nothing.
  const rows = [price('p1', 'm1', 5, 'not-a-date')];
  eq('garbage-only row still prices the master', pickNewestPrices(rows).get('m1'), 5);
  const mixed = [price('p1', 'm1', 5, 'not-a-date'), price('p2', 'm1', 6, null)];
  everyOrderGives('garbage ties with null and breaks on id', mixed, 'm1', 6);
}
{
  // Defect E: rows sharing an updated_at break on the greatest id, so the pick
  // does not depend on page order.
  const rows = [
    price('aaa', 'm1', 100, '2026-02-02T00:00:00Z'),
    price('bbb', 'm1', 200, '2026-02-02T00:00:00Z'),
    price('ccc', 'm1', 300, '2026-02-02T00:00:00Z'),
  ];
  everyOrderGives('tie on updated_at resolves to the greatest id', rows, 'm1', 300);
  // Different timestamp spellings for the same instant still tie.
  const sameInstant = [
    price('aaa', 'm1', 100, '2026-02-02T00:00:00Z'),
    price('zzz', 'm1', 250, '2026-02-02T00:00:00.000+00:00'),
  ];
  everyOrderGives('equal instants, different spellings, greatest id', sameInstant, 'm1', 250);
}
{
  const rows = [
    price('p1', 'm1', 1, '2026-01-01T00:00:00Z'),
    price('p2', 'm2', 2, '2026-01-01T00:00:00Z'),
    price('p3', 'm3', 3, '2026-01-01T00:00:00Z'),
  ];
  eq('one entry per master', pickNewestPrices(rows).size, 3);
  eq('m2 keeps its own cost', pickNewestPrices(rows).get('m2'), 2);
}
{
  // PostgREST numerics arrive as strings often enough that the Number() coerce
  // is load-bearing: a string cost must reach the workbook as a number, or the
  // AMOUNT column silently becomes text.
  const m = pickNewestPrices([price('p1', 'm1', '12.34' as unknown as number, '2026-01-01T00:00:00Z')]);
  eq('string avg_cost coerces', m.get('m1'), 12.34);
  eq('string avg_cost is a number', typeof m.get('m1'), 'number');
}
{
  const m = pickNewestPrices([
    price('p1', null, 10, '2026-01-01T00:00:00Z'),
    price('p2', 'm1', null, '2026-06-01T00:00:00Z'),
    price('p3', 'm1', 3, '2026-01-01T00:00:00Z'),
  ]);
  eq('null master_item_id skipped', m.size, 1);
  eq('null avg_cost skipped, older priced row wins', m.get('m1'), 3);
}
{
  // 0 is a real cost (a comped / house item), not a missing one.
  const m = pickNewestPrices([price('p1', 'm1', 0, '2026-01-01T00:00:00Z')]);
  check('zero avg_cost is kept', m.has('m1'), [...m]);
  eq('zero avg_cost value', m.get('m1'), 0);
}
{
  // Postgres numeric can hold NaN, and exceljs will happily write <v>NaN</v>,
  // after which Excel calls the whole file corrupt. The drop happens at the
  // END, so the newest row still wins exactly as the SQL says — the master
  // just comes out UNPRICED rather than priced at NaN. The distinction is the
  // point: it must NOT quietly fall back to an older, cheaper, finite row and
  // report a number nobody counted.
  const newestIsNaN = [
    price('old', 'm1', 10, '2020-01-01T00:00:00Z'),
    price('new', 'm1', Number.NaN, '2026-01-01T00:00:00Z'),
  ];
  const m = pickNewestPrices(newestIsNaN);
  check('NaN newest → master is absent, not stale-priced', !m.has('m1'), [...m]);
  eq('NaN newest → empty map', m.size, 0);
  everyOrderGives('NaN newest never falls back to the older row', newestIsNaN, 'm1', undefined);
  const infinite = [
    price('old', 'm1', 10, '2020-01-01T00:00:00Z'),
    price('new', 'm1', Number.POSITIVE_INFINITY, '2026-01-01T00:00:00Z'),
  ];
  everyOrderGives('Infinity newest is dropped too', infinite, 'm1', undefined);
  const negInfinite = [price('new', 'm1', Number.NEGATIVE_INFINITY, '2026-01-01T00:00:00Z')];
  check('-Infinity is dropped', !pickNewestPrices(negInfinite).has('m1'));
  // A non-numeric string is NaN once coerced, and goes the same way.
  const garbageCost = [price('new', 'm1', 'not a number' as unknown as number, '2026-01-01T00:00:00Z')];
  check('garbage avg_cost string is dropped', !pickNewestPrices(garbageCost).has('m1'));
  // The other ordering: a NaN that is NOT the newest loses on the normal rule
  // and the finite winner survives.
  const oldIsNaN = [
    price('old', 'm1', Number.NaN, '2020-01-01T00:00:00Z'),
    price('new', 'm1', 7, '2026-01-01T00:00:00Z'),
  ];
  everyOrderGives('older NaN does not block a finite newer row', oldIsNaN, 'm1', 7);
  // One poisoned master must not take the others down with it.
  const mixed = pickNewestPrices([
    price('a', 'm1', Number.NaN, '2026-01-01T00:00:00Z'),
    price('b', 'm2', 4, '2026-01-01T00:00:00Z'),
  ]);
  eq('other masters are unaffected', mixed.size, 1);
  eq('the healthy master keeps its cost', mixed.get('m2'), 4);
  // Every value that survives is a finite number — the invariant the workbook
  // depends on.
  check('every returned cost is finite',
    [...pickNewestPrices([
      price('a', 'm1', Number.NaN, '2026-01-01T00:00:00Z'),
      price('b', 'm2', 0, '2026-01-01T00:00:00Z'),
      price('c', 'm3', 12.5, '2026-01-01T00:00:00Z'),
    ]).values()].every(Number.isFinite));
}
{
  // A row with no id at all must not blow up the tiebreak.
  const rows = [
    price(undefined as unknown as string, 'm1', 1, '2026-01-01T00:00:00Z'),
    price('b', 'm1', 2, '2026-01-01T00:00:00Z'),
  ];
  everyOrderGives('missing id sorts below a real id', rows, 'm1', 2);
}

/* ── chunk ── */
console.log('\nchunk');
deepEq('empty array', chunk([], 3), []);
deepEq('exact multiple', chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
deepEq('remainder', chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
deepEq('size 1', chunk([1, 2, 3], 1), [[1], [2], [3]]);
deepEq('single element', chunk(['a'], 5), [['a']]);
deepEq('size larger than input', chunk([1, 2], 100), [[1, 2]]);
{
  const src = Array.from({ length: 250 }, (_, i) => i);
  const parts = chunk(src, 100);
  eq('250 / 100 → 3 chunks', parts.length, 3);
  eq('last chunk length', parts[2].length, 50);
  deepEq('chunks concatenate back to the input', parts.flat(), src);
  check('no chunk exceeds the size', parts.every(p => p.length <= 100), parts.map(p => p.length));
}
{
  const src = [1, 2, 3];
  chunk(src, 2)[0].push(99);
  deepEq('chunk does not mutate its input', src, [1, 2, 3]);
}
{
  // A non-positive size used to hang the tab outright — `i += 0` never reaches
  // the end of a non-empty list — so it now throws instead. The guard is
  // written `!(size >= 1)` rather than `size <= 0` on purpose: `NaN <= 0` is
  // false, which would have let a NaN straight through to `i += NaN` and hung
  // exactly the same way.
  const throwsWith = (label: string, fn: () => unknown, needle: string) => {
    let msg = '(did not throw)';
    let err: unknown = null;
    try { fn(); } catch (e) { err = e; msg = e instanceof Error ? e.message : String(e); }
    check(`${label} throws, message mentions ${JSON.stringify(needle)}`, msg.includes(needle), msg);
    return err;
  };
  const e0 = throwsWith('size 0', () => chunk([1, 2, 3], 0), 'size must be >= 1');
  check('the thrown value is an Error', e0 instanceof Error, e0);
  check('the message quotes the offending size', String((e0 as Error).message).includes('got 0'), (e0 as Error).message);
  throwsWith('size -1', () => chunk([1, 2, 3], -1), 'size must be >= 1');
  // The NaN arm: this is the one `size <= 0` would have missed.
  throwsWith('size NaN', () => chunk([1, 2, 3], Number.NaN), 'size must be >= 1');
  throwsWith('size NaN reports NaN', () => chunk([1, 2, 3], Number.NaN), 'got NaN');
  // Deliberate: a fractional size below 1 is rejected even though it would not
  // have hung (0.5 does advance). "At least one item per batch" is the
  // contract; anything else is a caller bug worth surfacing.
  throwsWith('fractional size 0.5', () => chunk([1, 2, 3], 0.5), 'size must be >= 1');
  // Deliberate behaviour CHANGE: this used to return [] because the loop never
  // ran on an empty list. It now throws — the size is wrong either way, and a
  // guard that only fires when the data happens to be non-empty is a guard
  // that fires in production and not in tests.
  throwsWith('empty list with size 0 still throws', () => chunk([], 0), 'size must be >= 1');
  throwsWith('empty list with size NaN still throws', () => chunk([], Number.NaN), 'size must be >= 1');
  // The other side of the guard: everything >= 1 is still allowed through.
  deepEq('size 1 is the boundary and is allowed', chunk([1, 2], 1), [[1], [2]]);
  deepEq('Infinity is >= 1, so one chunk', chunk([1, 2, 3], Number.POSITIVE_INFINITY), [[1, 2, 3]]);
  deepEq('the loader size still works', chunk([1], 100), [[1]]);
}

/* ── toCountLines ── */
console.log('\ntoCountLines');
// The entry → line join, extracted out of the Supabase loader so the three
// coercions it performs (zone, qty, cost) are testable at all. This is the
// first coverage that logic has had.
const master = (o: Partial<MasterItem> & { id: string }): MasterItem => ({
  organization_id: null,
  name: 'Master ' + o.id,
  category: 'Liquor Cost',
  subcategory: 'gin',
  base_unit: 'ml',
  base_size: 750,
  pour_size_oz: null,
  is_bottle_service: null,
  is_active: true,
  product_id: null,
  ...o,
});
const entry = (o: Partial<AuditEntryRow>): AuditEntryRow =>
  ({ master_item_id: 'm1', zone: 'Bar', qty: 1, ...o });
const MASTERS = new Map<string, MasterItem>([['m1', master({ id: 'm1', name: 'Bravo Gin 750ml' })]]);
const PRICES = new Map<string, number>([['m1', 12.5]]);

eq('NO_ZONE label', NO_ZONE, '(no zone)');
{
  const { lines, unresolved } = toCountLines([], MASTERS, PRICES);
  eq('no entries → no lines', lines.length, 0);
  eq('no entries → nothing unresolved', unresolved, 0);
}
{
  const { lines } = toCountLines([entry({})], MASTERS, PRICES);
  eq('one entry → one line', lines.length, 1);
  eq('carries the master id', lines[0].masterItemId, 'm1');
  eq('name comes from the master, not the entry', lines[0].itemName, 'Bravo Gin 750ml');
  eq('category from the master', lines[0].category, 'Liquor Cost');
  eq('subcategory from the master', lines[0].subcategory, 'gin');
  eq('base size from the master', lines[0].baseSize, 750);
  eq('base unit from the master', lines[0].baseUnit, 'ml');
  eq('price from the price map', lines[0].cuPrice, 12.5);
  eq('zone passes through', lines[0].location, 'Bar');
  eq('qty passes through', lines[0].qty, 1);
}
{
  // A null zone would otherwise reach the workbook as a 'null - Loc' sheet
  // and crash the header upper-casing.
  const zones: Array<[AuditEntryRow['zone'], string]> = [
    [null, NO_ZONE],
    ['', NO_ZONE],
    ['   ', NO_ZONE],
    ['\t\n ', NO_ZONE],
    ['  Bar  ', 'Bar'],
    ['Walk In', 'Walk In'],
  ];
  for (const [zone, want] of zones) {
    const { lines } = toCountLines([entry({ zone })], MASTERS, PRICES);
    eq(`zone ${JSON.stringify(zone)} →`, lines[0].location, want);
  }
  // undefined is not in the type, but a PostgREST row can arrive without the
  // key; ?? covers it and the assertion says so.
  const { lines } = toCountLines([entry({ zone: undefined as unknown as null })], MASTERS, PRICES);
  eq('missing zone key →', lines[0].location, NO_ZONE);
}
{
  // qty: null and non-finite both become 0. NaN or Infinity in a qty cell
  // corrupts the workbook exactly the way a non-finite cost does.
  const qtys: Array<[unknown, number]> = [
    [null, 0],
    [undefined, 0],
    [0, 0],
    [-2, -2],
    [3.5, 3.5],
    ['3' as unknown as number, 3],
    ['' as unknown as number, 0],
    ['abc' as unknown as number, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ];
  // JSON.stringify renders Infinity as "null", which would make two different
  // cases print the same label — String() keeps them apart.
  const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
  for (const [qty, want] of qtys) {
    const { lines } = toCountLines([entry({ qty: qty as number })], MASTERS, PRICES);
    eq(`qty ${show(qty)} →`, lines[0].qty, want);
  }
  check('every produced qty is finite',
    toCountLines(qtys.map(([qty]) => entry({ qty: qty as number })), MASTERS, PRICES)
      .lines.every(l => Number.isFinite(l.qty)));
}
{
  // Unresolved: no master_item_id at all, or a master that vanished between
  // the count and now (merged away, deleted, invisible under RLS). Same thing
  // to a reader of the report — a counted bottle no sheet mentions.
  const { lines, unresolved } = toCountLines([
    entry({}),
    entry({ master_item_id: null }),
    entry({ master_item_id: 'gone' }),
    entry({ master_item_id: '' }),
  ], MASTERS, PRICES);
  eq('only the resolvable entry becomes a line', lines.length, 1);
  eq('the other three are counted as unresolved', unresolved, 3);
  check('no line carries a missing master', lines.every(l => MASTERS.has(l.masterItemId)));
}
{
  const { lines } = toCountLines([entry({ master_item_id: 'm2' })],
    new Map([['m2', master({ id: 'm2' })]]), new Map());
  eq('no price → cuPrice null', lines[0].cuPrice, null);
  const zero = toCountLines([entry({ master_item_id: 'm2' })],
    new Map([['m2', master({ id: 'm2' })]]), new Map([['m2', 0]]));
  // 0 is a price. `?? null` (not `|| null`) is what keeps it one.
  eq('price 0 stays 0, does not become null', zero.lines[0].cuPrice, 0);
}
{
  const nulls = toCountLines([entry({ master_item_id: 'm3' })],
    new Map([['m3', master({ id: 'm3', category: null, subcategory: null, base_size: null, base_unit: null })]]),
    new Map());
  eq('null category survives to the line', nulls.lines[0].category, null);
  eq('null subcategory survives', nulls.lines[0].subcategory, null);
  eq('null base size survives', nulls.lines[0].baseSize, null);
  eq('null base unit survives', nulls.lines[0].baseUnit, null);
}
{
  // Input order is preserved, and the same entry counted twice stays two
  // lines — the model does the summing, not this.
  const { lines } = toCountLines([
    entry({ zone: 'Walk In', qty: 4 }),
    entry({ zone: 'Bar', qty: 1 }),
    entry({ zone: 'Bar', qty: 1 }),
  ], MASTERS, PRICES);
  deepEq('order preserved', lines.map(l => `${l.location}:${l.qty}`), ['Walk In:4', 'Bar:1', 'Bar:1']);
  eq('duplicates are not merged here', lines.length, 3);
}

/* ── localIsoDate / usDate ── */
console.log('\nlocalIsoDate');
// Built from LOCAL components on purpose, so the expectation holds in any
// timezone the suite happens to run in.
const localSamples: Array<[number, number, number, number]> = [
  [2026, 0, 1, 0],    // zero-padded month AND day
  [2026, 0, 5, 23],   // single-digit day, late evening
  [2026, 2, 8, 3],    // US spring-forward Sunday
  [2026, 6, 4, 12],
  [2026, 10, 1, 1],   // US fall-back Sunday
  [2026, 11, 31, 23], // year end
];
for (const [y, mo, d, h] of localSamples) {
  const dt = new Date(y, mo, d, h, 30, 0);
  const want = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  eq(`local ${want} @${h}h`, localIsoDate(dt), want);
}
{
  // The defect: a count started at 6pm PDT is 01:00Z the NEXT day, so an ISO
  // slice stamped tomorrow on all 14 sheet headers and on the filename.
  // Asserted timezone-independently: the local calendar day must survive both
  // ends of the day, and (unless the suite is running in UTC) at least one of
  // those two instants has a DIFFERENT UTC date — which is exactly what the
  // old toISOString().slice(0,10) would have returned.
  const early = new Date(2026, 7, 23, 0, 0, 30);
  const late = new Date(2026, 7, 23, 23, 59, 30);
  eq('first minute of the day', localIsoDate(early), '2026-08-23');
  eq('last minute of the day', localIsoDate(late), '2026-08-23');
  const isoDiffers =
    early.toISOString().slice(0, 10) !== '2026-08-23' ||
    late.toISOString().slice(0, 10) !== '2026-08-23';
  const utcTz = new Date(2026, 7, 23).getTimezoneOffset() === 0;
  check(
    utcTz
      ? 'running in UTC — the ISO slice cannot be distinguished here (offset 0)'
      : 'the old UTC slice would have reported a different day at one boundary',
    utcTz ? !isoDiffers : isoDiffers,
    { tzOffset: new Date(2026, 7, 23).getTimezoneOffset(), isoDiffers },
  );
}
{
  // The same defect asserted timezone-independently, so it is caught even when
  // the suite runs in UTC (where the two implementations agree): a stub whose
  // LOCAL getters say Aug 23 while its UTC string says Aug 24 — exactly a 6pm
  // PDT count. The date must come from the local getters.
  const eveningBeforeInUtc = {
    getFullYear: () => 2026,
    getMonth: () => 7,
    getDate: () => 23,
    toISOString: () => '2026-08-24T01:00:00.000Z',
  } as unknown as Date;
  eq('local getters win over the UTC string', localIsoDate(eveningBeforeInUtc), '2026-08-23');
}
{
  // Round-trip property: whatever the string says is what the Date's own local
  // getters say.
  const dt = new Date(2026, 4, 9, 18, 45, 12);
  const [y, m, d] = localIsoDate(dt).split('-').map(Number);
  eq('year round-trips', y, dt.getFullYear());
  eq('month round-trips', m, dt.getMonth() + 1);
  eq('day round-trips', d, dt.getDate());
  eq('always 10 chars', localIsoDate(dt).length, 10);
}

console.log('\nusDate');
eq('iso to US', usDate('2026-08-23'), '08/23/2026');
eq('iso with time', usDate('2026-08-23T01:00:00Z'), '08/23/2026');
eq('zero-padding kept', usDate('2026-01-05'), '01/05/2026');
eq('unparseable passes through', usDate('not a date'), 'not a date');
eq('empty passes through', usDate(''), '');

/* ── titleCase ── */
console.log('\ntitleCase');
eq('liqueur', titleCase('liqueur'), 'Liqueur');
eq('na bev', titleCase('na bev'), 'Na Bev');
eq('already titled', titleCase('Tequila'), 'Tequila');
eq('shouty', titleCase('WHISKEY'), 'Whiskey');
eq('empty', titleCase(''), '');
eq('hyphenated stays one word', titleCase('non-alcoholic'), 'Non-alcoholic');
eq('multiple spaces preserved', titleCase('red  wine'), 'Red  Wine');

/* ── ordinalCompare ── */
console.log('\nordinalCompare');
// The reason this is not localeCompare: Bevager sorts by code unit, so an
// upper-case letter sorts before a lower-case one.
check('MOD before Maison', ordinalCompare('MOD Brut 750ml', 'Maison No. 9 Rose 750ml') < 0);
check('localeCompare would disagree', 'MOD Brut 750ml'.localeCompare('Maison No. 9 Rose 750ml') > 0);
check('digits before letters', ordinalCompare('1800 Anejo', 'Ace of Spades') < 0);
eq('equal', ordinalCompare('same', 'same'), 0);
eq('empty vs empty', ordinalCompare('', ''), 0);
check('empty sorts first', ordinalCompare('', 'a') < 0);

/* ── rounding ── */
console.log('\nrounding');
eq('round2 half up', round2(22.245), 22.25);
eq('round2 plain', round2(1.234), 1.23);
eq('round2 float noise below half', round2(586.5749999999999), 586.57);
eq('round4 tidies float noise', round4(0.7 + 0.2), 0.9);
eq('round4 keeps precision', round4(1.23456), 1.2346);
eq('round2 zero', round2(0), 0);
// Negatives: Math.round is half-up towards +∞, so a negative exact half goes
// towards zero. Asymmetric on purpose — pinned so a "fix" to symmetric
// rounding has to be a deliberate decision rather than a silent one.
eq('round2 negative plain', round2(-1.234), -1.23);
eq('round2 negative half goes towards zero', round2(-22.245), -22.24);
eq('round2 negative below half', round2(-1.006), -1.01);
eq('round4 negative float noise', round4(-(0.7 + 0.2)), -0.9);
eq('round4 negative precision', round4(-1.23456), -1.2346);
eq('round2 large negative', round2(-96398.785), -96398.78);
// Non-finite input is returned untouched rather than becoming NaN/0 noise.
check('round2 NaN stays NaN', Number.isNaN(round2(Number.NaN)));
eq('round2 Infinity passes through', round2(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
eq('round4 -Infinity passes through', round4(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY);

/* ── locationAccountKey ── */
console.log('\nlocationAccountKey');
check('distinct keys', locationAccountKey('Bar', 'A') !== locationAccountKey('Bar A', ''));
check('empty halves stay distinct', locationAccountKey('Bar', '') !== locationAccountKey('', 'Bar'));
{
  // Asserted on CHARACTER CODES, not on a pasted literal. A source escape for
  // a control character is exactly the kind of thing an editor, a copy-paste
  // or a tool round-trip can silently turn into a real (or a different)
  // character — and a separator that quietly became a space would fold
  // ('Bar', 'A') and ('Bar A', '') into one bucket without changing how any
  // of this reads. Building the expectation with fromCharCode means the test
  // cannot be mangled the same way the source could.
  const NUL = String.fromCharCode(0);
  const key = locationAccountKey('Bar', 'A');
  eq('key length is exactly the two halves plus one separator', key.length, 5);
  eq('separator character code is 0', key.charCodeAt(3), 0);
  check('separator is not a space (code 32)', key.charCodeAt(3) !== 32, key.charCodeAt(3));
  deepEq('key splits cleanly back into its halves', key.split(NUL), ['Bar', 'A']);
  eq('the separator appears exactly once', key.split(NUL).length - 1, 1);
}
check('separator is NUL', locationAccountKey('Bar', 'A').includes('\u0000'));
eq('key is location + NUL + account', locationAccountKey('Bar', 'A'), 'Bar\u0000A');

/* ── buildAuditReportModel ── */
console.log('\nbuildAuditReportModel');

const line = (o: Partial<AuditCountLine> & { masterItemId: string; itemName: string; location: string; qty: number }): AuditCountLine => ({
  category: 'Liquor Cost',
  subcategory: null,
  baseSize: 750,
  baseUnit: 'ml',
  cuPrice: 10,
  ...o,
});

/** The fixture the workbook round-trip below is built from too: two
 *  locations, an item in both, an item counted as zero, an unpriced item, an
 *  item in only one location, and one out-of-scope category. */
const FIXTURE: AuditCountLine[] = [
  // Two locations for one item, plus a second entry in the same location that
  // must sum rather than overwrite.
  line({ masterItemId: 'm1', itemName: 'Bravo Gin 750ml', location: 'Bar', qty: 2, cuPrice: 10, subcategory: 'gin' }),
  line({ masterItemId: 'm1', itemName: 'Bravo Gin 750ml', location: 'Bar', qty: 1, cuPrice: 10, subcategory: 'gin' }),
  line({ masterItemId: 'm1', itemName: 'Bravo Gin 750ml', location: 'Walk In', qty: 4, cuPrice: 10, subcategory: 'gin' }),
  // Counted as zero — still belongs to its location.
  line({ masterItemId: 'm2', itemName: 'Alpha Wine 750ml', location: 'Bar', qty: 0, cuPrice: 25, category: 'Wine Cost' }),
  line({ masterItemId: 'm2', itemName: 'Alpha Wine 750ml', location: 'Walk In', qty: 10, cuPrice: 25, category: 'Wine Cost' }),
  // Unpriced.
  line({ masterItemId: 'm3', itemName: 'Charlie Beer 12floz', location: 'Walk In', qty: 6, cuPrice: null, category: 'Beer Cost', baseSize: 12, baseUnit: 'floz' }),
  // The account whose name has to be sanitised for its sheet ('N/A' → 'N,A').
  line({ masterItemId: 'm5', itemName: 'Delta Soda 12floz', location: 'Walk In', qty: 5, cuPrice: 2, category: 'non_alcoholic_beverage', baseSize: 12, baseUnit: 'floz' }),
  // Out of scope — excluded from every sheet but reported back.
  line({ masterItemId: 'm4', itemName: 'Napkins', location: 'Bar', qty: 100, cuPrice: 0.5, category: 'Bar Consumables' }),
];

const model = buildAuditReportModel(FIXTURE);

eq('in-scope items', model.items.length, 4);
deepEq('locations sorted', model.locations, ['Bar', 'Walk In']);
// Accounts are ordered by amount desc: wine 250 > liquor 70 > n/a 10 > beer 0.
deepEq('accounts by amount desc', model.accounts,
  ['5320 - Wine Cost', '5310 - Liquor Cost', '5335 - N/A Beverage Cost', '5330 - Beer Cost']);
deepEq('items ordinally sorted', model.items.map(i => i.itemName),
  ['Alpha Wine 750ml', 'Bravo Gin 750ml', 'Charlie Beer 12floz', 'Delta Soda 12floz']);
check('excluded location never joins the location list', !model.locations.includes('Nowhere'));

const gin = model.items.find(i => i.masterItemId === 'm1')!;
eq('same-location entries sum', gin.byLocation['Bar'], 3);
eq('other location', gin.byLocation['Walk In'], 4);
eq('item total qty', gin.totalQty, 7);
eq('item total amount', gin.totalAmount, 70);
eq('subcategory title-cased', gin.subcategory, 'Gin');
eq('count unit', gin.countUnit, '750ml');

const wine = model.items.find(i => i.masterItemId === 'm2')!;
// Present-but-zero is what puts an item on a location sheet; a missing key
// is what keeps it off one.
check('zero-qty location key present', Object.prototype.hasOwnProperty.call(wine.byLocation, 'Bar'));
eq('zero-qty value', wine.byLocation['Bar'], 0);
check('untouched location absent', !Object.prototype.hasOwnProperty.call(gin.byLocation, 'Nowhere'));
const beerRow = model.items.find(i => i.masterItemId === 'm3')!;
check('item counted in one location only has one key', !Object.prototype.hasOwnProperty.call(beerRow.byLocation, 'Bar'));
eq('null subcategory becomes empty string', beerRow.subcategory, '');

const beer = model.items.find(i => i.masterItemId === 'm3')!;
eq('unpriced amount is null', beer.totalAmount, null);
eq('unpriced count', model.unpricedItems, 1);

eq('liquor account qty', model.byAccount['5310 - Liquor Cost'].qty, 7);
eq('liquor account amount', model.byAccount['5310 - Liquor Cost'].amount, 70);
eq('wine account amount', model.byAccount['5320 - Wine Cost'].amount, 250);
eq('unpriced beer contributes 0', model.byAccount['5330 - Beer Cost'].amount, 0);
eq('beer qty still counts', model.byAccount['5330 - Beer Cost'].qty, 6);

eq('by location+account qty', model.byLocationAccount[locationAccountKey('Bar', '5310 - Liquor Cost')].qty, 3);
eq('by location+account amount', model.byLocationAccount[locationAccountKey('Walk In', '5320 - Wine Cost')].amount, 250);
check('location+account pair that never happened is absent',
  model.byLocationAccount[locationAccountKey('Bar', '5330 - Beer Cost')] === undefined);

eq('grand total qty', model.totals.qty, 7 + 10 + 6 + 5);
eq('grand total amount', model.totals.amount, 330);

eq('one excluded category', model.excluded.length, 1);
eq('excluded name', model.excluded[0].category, 'Bar Consumables');
eq('excluded qty', model.excluded[0].qty, 100);
eq('excluded amount', model.excluded[0].amount, 50);
eq('excluded items', model.excluded[0].items, 1);
check('excluded stays out of totals', model.totals.amount === 330);

// Rollups sum full-precision products and round once, which is what keeps a
// 250-item audit tying to Bevager rather than drifting a few cents.
const drift = buildAuditReportModel(
  Array.from({ length: 3 }, (_, i) =>
    line({ masterItemId: 'd' + i, itemName: 'Drift ' + i, location: 'Bar', qty: 1, cuPrice: 0.005 })),
);
eq('no per-line rounding drift', drift.byAccount['5310 - Liquor Cost'].amount, 0.02);

const empty = buildAuditReportModel([]);
eq('empty items', empty.items.length, 0);
eq('empty total', empty.totals.amount, 0);
eq('empty total qty', empty.totals.qty, 0);
deepEq('empty accounts', empty.accounts, []);
deepEq('empty locations', empty.locations, []);
deepEq('empty excluded', empty.excluded, []);
eq('empty unpriced', empty.unpricedItems, 0);

/* ── roll-up edges ── */
console.log('\nbuildAuditReportModel edges');
{
  // Byte-identical duplicate lines sum; they do not overwrite each other.
  const dup = buildAuditReportModel([
    line({ masterItemId: 'x1', itemName: 'Dup Gin 750ml', location: 'Bar', qty: 5, cuPrice: 3 }),
    line({ masterItemId: 'x1', itemName: 'Dup Gin 750ml', location: 'Bar', qty: 5, cuPrice: 3 }),
  ]);
  eq('identical lines sum', dup.items[0].byLocation['Bar'], 10);
  eq('identical lines total qty', dup.items[0].totalQty, 10);
  eq('identical lines amount', dup.items[0].totalAmount, 30);
}
{
  // Entries that cancel out still leave the item on that location's sheet.
  const net = buildAuditReportModel([
    line({ masterItemId: 'x2', itemName: 'Net Gin 750ml', location: 'Bar', qty: 2, cuPrice: 4 }),
    line({ masterItemId: 'x2', itemName: 'Net Gin 750ml', location: 'Bar', qty: -2, cuPrice: 4 }),
  ]);
  eq('cancelling entries net to 0', net.items[0].byLocation['Bar'], 0);
  check('cancelled-out location key survives',
    Object.prototype.hasOwnProperty.call(net.items[0].byLocation, 'Bar'));
  eq('cancelling entries amount', net.items[0].totalAmount, 0);
}
{
  // Negative counts (a correction entry) must flow through the roll-up as
  // negatives rather than being clamped anywhere.
  const neg = buildAuditReportModel([
    line({ masterItemId: 'n1', itemName: 'Neg Gin 750ml', location: 'Bar', qty: -2, cuPrice: 10 }),
    line({ masterItemId: 'n2', itemName: 'Pos Wine 750ml', location: 'Bar', qty: 1, cuPrice: 5, category: 'Wine Cost' }),
  ]);
  eq('negative item amount', neg.items.find(i => i.masterItemId === 'n1')!.totalAmount, -20);
  eq('negative account amount', neg.byAccount['5310 - Liquor Cost'].amount, -20);
  eq('negative account qty', neg.byAccount['5310 - Liquor Cost'].qty, -2);
  eq('negative grand total amount', neg.totals.amount, -15);
  eq('negative grand total qty', neg.totals.qty, -1);
  deepEq('negative account sorts last', neg.accounts, ['5320 - Wine Cost', '5310 - Liquor Cost']);
}
{
  // cuPrice 0 is a PRICED item worth nothing (comped / house pour), not an
  // unpriced one. Deliberate product decision — pinned here and at the cell
  // level in the workbook section below.
  const free = buildAuditReportModel([
    line({ masterItemId: 'f1', itemName: 'Free Water 1each', location: 'Bar', qty: 4, cuPrice: 0, baseSize: null, baseUnit: null }),
  ]);
  eq('zero price yields amount 0, not null', free.items[0].totalAmount, 0);
  eq('zero price is not counted as unpriced', free.unpricedItems, 0);
  eq('zero price account amount', free.byAccount['5310 - Liquor Cost'].amount, 0);
  eq('zero price keeps its qty', free.byAccount['5310 - Liquor Cost'].qty, 4);
}
{
  // A null category and a whitespace-only one both land in one
  // '(uncategorized)' bucket rather than crashing or splitting.
  const ex = buildAuditReportModel([
    line({ masterItemId: 'u1', itemName: 'No Category A', location: 'Bar', qty: 3, cuPrice: 2, category: null }),
    line({ masterItemId: 'u2', itemName: 'No Category B', location: 'Bar', qty: 1, cuPrice: null, category: '   ' }),
    line({ masterItemId: 'u3', itemName: 'Napkins', location: 'Bar', qty: 10, cuPrice: 1, category: ' Bar Consumables ' }),
    // Same category, differently padded — the bucket key is trimmed, so this
    // must land in the SAME bucket rather than opening a second one.
    line({ masterItemId: 'u4', itemName: 'Straws', location: 'Bar', qty: 2, cuPrice: 1, category: 'Bar Consumables' }),
  ]);
  eq('two excluded buckets', ex.excluded.length, 2);
  const unc = ex.excluded.find(e => e.category === '(uncategorized)')!;
  check('null + blank category fold into one bucket', !!unc, ex.excluded);
  eq('uncategorized item count', unc.items, 2);
  eq('uncategorized qty', unc.qty, 4);
  eq('unpriced excluded line adds nothing to the amount', unc.amount, 6);
  deepEq('excluded sorted by amount desc', ex.excluded.map(e => e.category),
    ['Bar Consumables', '(uncategorized)']);
  // DELIBERATE: bucket keys are trimmed but NOT case-folded, so two catalog
  // spellings that differ only in case stay two buckets and get two Summary
  // footnotes. They are genuinely distinct values in master_items.category,
  // and folding them would report a category name nobody typed.
  const cased = buildAuditReportModel([
    line({ masterItemId: 'k1', itemName: 'Napkins', location: 'Bar', qty: 1, cuPrice: 1, category: 'Bar Consumables' }),
    line({ masterItemId: 'k2', itemName: 'Straws', location: 'Bar', qty: 1, cuPrice: 1, category: 'bar consumables' }),
  ]);
  eq('case-different categories stay separate buckets', cased.excluded.length, 2);
  deepEq('both spellings are reported as typed',
    cased.excluded.map(e => e.category).sort(), ['Bar Consumables', 'bar consumables']);
  eq('excluded category key is trimmed', ex.excluded[0].category, 'Bar Consumables');
  eq('padded + unpadded spellings share one bucket', ex.excluded[0].items, 2);
  eq('padded + unpadded qty sums', ex.excluded[0].qty, 12);
  eq('nothing in-scope', ex.items.length, 0);
  eq('excluded lines contribute no locations', ex.locations.length, 0);
}
{
  // Two accounts on exactly the same amount: must not throw, and must come
  // back in the same order every time (Array#sort is stable, so this is the
  // items order — pinned so a switch to an unstable comparator is visible).
  const tie = buildAuditReportModel([
    line({ masterItemId: 't1', itemName: 'Equal Beer 12floz', location: 'Bar', qty: 5, cuPrice: 1, category: 'beer', baseSize: 12, baseUnit: 'floz' }),
    line({ masterItemId: 't2', itemName: 'Equal Wine 750ml', location: 'Bar', qty: 1, cuPrice: 5, category: 'wine' }),
  ]);
  eq('tied accounts both present', tie.accounts.length, 2);
  eq('tied amounts really are equal',
    tie.byAccount[tie.accounts[0]].amount, tie.byAccount[tie.accounts[1]].amount);
  deepEq('tied accounts order is stable', tie.accounts, ['5330 - Beer Cost', '5320 - Wine Cost']);
  const again = buildAuditReportModel([
    line({ masterItemId: 't1', itemName: 'Equal Beer 12floz', location: 'Bar', qty: 5, cuPrice: 1, category: 'beer', baseSize: 12, baseUnit: 'floz' }),
    line({ masterItemId: 't2', itemName: 'Equal Wine 750ml', location: 'Bar', qty: 1, cuPrice: 5, category: 'wine' }),
  ]);
  deepEq('tied accounts order repeats across calls', again.accounts, tie.accounts);
  // Reversing the input reverses the items order, so the tie lands the other
  // way — the point being that it is decided by the data, never by chance.
  const reversed = buildAuditReportModel([
    line({ masterItemId: 't2', itemName: 'Zulu Wine 750ml', location: 'Bar', qty: 1, cuPrice: 5, category: 'wine' }),
    line({ masterItemId: 't1', itemName: 'Equal Beer 12floz', location: 'Bar', qty: 5, cuPrice: 1, category: 'beer', baseSize: 12, baseUnit: 'floz' }),
  ]);
  deepEq('tie follows the item order, not the input order', reversed.accounts,
    ['5330 - Beer Cost', '5320 - Wine Cost']);
}
{
  // Items with the same name break on master id, so the sheet order is
  // deterministic when the catalog holds a duplicate name.
  const same = buildAuditReportModel([
    line({ masterItemId: 'zz', itemName: 'Same Name 750ml', location: 'Bar', qty: 1, cuPrice: 1 }),
    line({ masterItemId: 'aa', itemName: 'Same Name 750ml', location: 'Bar', qty: 2, cuPrice: 1 }),
  ]);
  deepEq('name tie resolves on masterItemId', same.items.map(i => i.masterItemId), ['aa', 'zz']);
  deepEq('name tie is order-independent',
    buildAuditReportModel([
      line({ masterItemId: 'aa', itemName: 'Same Name 750ml', location: 'Bar', qty: 2, cuPrice: 1 }),
      line({ masterItemId: 'zz', itemName: 'Same Name 750ml', location: 'Bar', qty: 1, cuPrice: 1 }),
    ]).items.map(i => i.masterItemId), ['aa', 'zz']);
}
{
  // Float noise from summing tenths is tidied at 4dp, not carried into the
  // AMOUNT column.
  const tenths = buildAuditReportModel([
    line({ masterItemId: 'q1', itemName: 'Tenths Gin 750ml', location: 'Bar', qty: 0.7, cuPrice: 1 }),
    line({ masterItemId: 'q1', itemName: 'Tenths Gin 750ml', location: 'Bar', qty: 0.2, cuPrice: 1 }),
  ]);
  eq('summed tenths tidy to 0.9', tenths.items[0].byLocation['Bar'], 0.9);
  eq('summed tenths total qty', tenths.items[0].totalQty, 0.9);
  eq('summed tenths amount', tenths.items[0].totalAmount, 0.9);
}

/* ───────────────── Workbook round-trip (exceljs) ───────────────── */
/* Everything below is async and runs before the summary at the bottom. */

const mod = await import('exceljs');
const ExcelJS = ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod);

type CellLike = { value: unknown; numFmt?: string };
type SheetLike = { name: string; rowCount: number; getCell(r: number, c: number): CellLike };
/** Stands in for a sheet that should exist but doesn't, so a missing sheet
 *  fails the assertions that follow instead of crashing the run. */
const MISSING: SheetLike = { name: '(missing)', rowCount: 0, getCell: () => ({ value: '(missing sheet)' }) };

function sheet(wb: ExcelJSNS.Workbook, name: string): SheetLike {
  const ws = wb.getWorksheet(name);
  check(`sheet "${name}" exists`, !!ws, wb.worksheets.map(w => w.name));
  return (ws as unknown as SheetLike) ?? MISSING;
}
function cell(label: string, ws: SheetLike, r: number, c: number, expected: unknown) {
  eq(`${ws.name}!R${r}C${c} ${label}`, ws.getCell(r, c).value, expected);
}
function rowOf(ws: SheetLike, r: number, cols: number): unknown[] {
  return Array.from({ length: cols }, (_, i) => ws.getCell(r, i + 1).value);
}
async function readBack(blob: Blob): Promise<ExcelJSNS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await blob.arrayBuffer()));
  return wb;
}
/** Every numeric cell in the workbook, as `Sheet!R#C# = value`. Used to prove
 *  no NaN/Infinity ever reaches a cell: exceljs writes `<v>NaN</v>` without
 *  complaint and Excel then refuses to open the file at all. */
function nonFiniteCells(wb: ExcelJSNS.Workbook): string[] {
  const bad: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (c, col) => {
        const v = c.value;
        if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${ws.name}!R${r}C${col}=${v}`);
        // A NaN can also survive as the string 'NaN' depending on how the
        // writer serialised it, so that is caught here too.
        if (typeof v === 'string' && /^(NaN|-?Infinity)$/.test(v)) bad.push(`${ws.name}!R${r}C${col}="${v}"`);
      });
    });
  }
  return bad;
}

console.log('\nmakeSheetNamer output is accepted by exceljs');
{
  // The allocator's whole promise is "exceljs will take this". Asserted
  // against the real addWorksheet rather than against a restatement of the
  // rules: every way exceljs can reject a name, fed through one namer into one
  // workbook — reserved word, case-only duplicates, over-length collisions,
  // apostrophe ends, empty-after-sanitising, forbidden characters.
  const HOSTILE = [
    'History', 'history', 'HISTORY',
    'Bar', 'bar', 'BAR',
    "'Quoted'", "'", '   ', ':::', '',
    'A'.repeat(40), 'A'.repeat(39) + 'B',
    'Walk/In \\ Back?Bar*[1]:2',
  ];
  const namer = makeSheetNamer();
  const hostileWb = new ExcelJS.Workbook();
  const given: string[] = [];
  let threw: unknown = null;
  try {
    for (const h of HOSTILE) given.push(hostileWb.addWorksheet(namer(h)).name);
  } catch (e) { threw = e; }
  check('exceljs accepts every allocated name', threw === null,
    threw instanceof Error ? threw.message : threw);
  eq('one sheet per hostile input', given.length, HOSTILE.length);
  check('nothing was allocated the reserved name',
    !given.some(n => n.toLowerCase() === 'history'), given);
  check('all allocated names unique case-insensitively',
    new Set(given.map(n => n.toLowerCase())).size === given.length, given);
  check('all allocated names within Excel limits',
    given.every(n => n.length > 0 && n.length <= 31 && !/(^')|('$)/.test(n) && !/[*?:/\\[\]]/.test(n)),
    given);
}

console.log('\nbuildAuditWorkbookBlob — structure');
const blob = await buildAuditWorkbookBlob({
  venueName: 'Poppy',
  auditDate: '2026-08-23',
  model,
  recountCount: 2,
  unmatchedEntries: 1,
});
check('returns a Blob', blob instanceof Blob);
eq('xlsx mime type', blob.type,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
check('blob is not empty', blob.size > 1000, blob.size);

const wb = await readBack(blob);
// Sheet ORDER is part of the deliverable: the four summaries, then one sheet
// per GL account in amount-descending order, then one per location.
deepEq('sheet names and order', wb.worksheets.map(w => w.name), [
  '1. Summary',
  '2. Summary By Account',
  '3. Summary By Location',
  '4. Summary By Item',
  '5320 - Wine Cost',
  '5310 - Liquor Cost',
  '5335 - N,A Beverage Cost',
  '5330 - Beer Cost',
  'Bar - Loc',
  'Walk In - Loc',
]);
eq('sheet count = 4 + accounts + locations', wb.worksheets.length, 4 + model.accounts.length + model.locations.length);
check('the N/A account sheet name is slash-free (Excel forbids /)',
  !wb.worksheets.some(w => w.name.includes('/')), wb.worksheets.map(w => w.name));
check('every sheet name is ≤31 chars', wb.worksheets.every(w => w.name.length <= 31));

console.log('\nbuildAuditWorkbookBlob — header block (repeated on every sheet)');
for (const ws of wb.worksheets) {
  const s = ws as unknown as SheetLike;
  const head = rowOf(s, 1, 1)[0];
  check(`${ws.name}!A1 is 'Audit'`, head === 'Audit', head);
}
{
  const s = sheet(wb, '1. Summary');
  cell("A1 'Audit'", s, 1, 1, 'Audit');
  cell('A2 venue', s, 2, 1, 'Poppy - Kount');
  cell('A3 count line (US date)', s, 3, 1, 'Count 08/23/2026 Poppy');
  cell('A4 audit date', s, 4, 1, 'Audit date 08/23/2026');
  cell('A5 generated on (today, local)', s, 5, 1, `Generated on ${usDate(localIsoDate(new Date()))}`);
  cell('A6 blank spacer', s, 6, 1, null);
  // Row 7 is the column header, row 8 the first data row — the whole layout
  // hangs off these two constants.
  deepEq('row 7 column headers', rowOf(s, 7, 3), ['CATEGORY', 'TOTAL', 'AMOUNT']);
  deepEq('row 8 is the first data row', rowOf(s, 8, 3), ['5320 - Wine Cost', 10, 250]);
}

console.log('\nbuildAuditWorkbookBlob — 1. Summary');
{
  const s = sheet(wb, '1. Summary');
  deepEq('wine row', rowOf(s, 8, 3), ['5320 - Wine Cost', 10, 250]);
  deepEq('liquor row', rowOf(s, 9, 3), ['5310 - Liquor Cost', 7, 70]);
  deepEq('n/a row keeps the real account name', rowOf(s, 10, 3), ['5335 - N/A Beverage Cost', 5, 10]);
  deepEq('beer row (unpriced → amount 0)', rowOf(s, 11, 3), ['5330 - Beer Cost', 6, 0]);
  deepEq('blank row before the total', rowOf(s, 12, 3), [null, null, null]);
  deepEq('grand TOTAL row', rowOf(s, 13, 3), ['TOTAL', 28, 330]);
  eq('AMOUNT cells carry the money format', s.getCell(8, 3).numFmt, '#,##0.00');
  eq('TOTAL amount carries the money format', s.getCell(13, 3).numFmt, '#,##0.00');
  // The notes below TOTAL are ours, not Bevager's; they keep what the report
  // leaves out visible instead of silently missing.
  const n1 = String(s.getCell(15, 1).value ?? '');
  check('excluded note names the category', n1.startsWith('Excluded from this report: Bar Consumables'), n1);
  check('excluded note carries the qty', n1.includes('100 units'), n1);
  check('excluded note singularises "1 item"', n1.includes('1 item,'), n1);
  const n2 = String(s.getCell(16, 1).value ?? '');
  check('unpriced note present', n2.includes('no unit cost'), n2);
  const n3 = String(s.getCell(17, 1).value ?? '');
  check('unmatched-entry note singularised', n3.startsWith('1 count entry is not linked'), n3);
  const n4 = String(s.getCell(18, 1).value ?? '');
  check('recount note pluralised', n4.startsWith('2 recount overrides were recorded'), n4);
  check('nothing after the last note', s.getCell(19, 1).value == null, s.getCell(19, 1).value);
}

console.log('\nbuildAuditWorkbookBlob — 2. Summary By Account');
{
  const s = sheet(wb, '2. Summary By Account');
  deepEq('row 7 headers', rowOf(s, 7, 3), ['ACCOUNT', 'TOTAL', 'AMOUNT']);
  deepEq('first account row', rowOf(s, 8, 3), ['5320 - Wine Cost', 10, 250]);
  deepEq('last account row', rowOf(s, 11, 3), ['5330 - Beer Cost', 6, 0]);
  // No grand-total row on this sheet, unlike 1. Summary.
  check('no TOTAL row', s.getCell(12, 1).value == null && s.getCell(13, 1).value == null);
}

console.log('\nbuildAuditWorkbookBlob — 3. Summary By Location');
{
  const s = sheet(wb, '3. Summary By Location');
  const rows = s.rowCount; // read before probing past the data
  deepEq('row 7 headers', rowOf(s, 7, 4), ['LOCATION', 'CATEGORY', 'QTY', 'AMOUNT']);
  // Bar only ever saw wine and liquor, so its beer/na pairs are skipped —
  // this sheet is sparse where 4. Summary By Item is dense.
  deepEq('Bar wine (zero qty still listed)', rowOf(s, 8, 4), ['Bar', '5320 - Wine Cost', 0, 0]);
  deepEq('Bar liquor', rowOf(s, 9, 4), ['Bar', '5310 - Liquor Cost', 3, 30]);
  deepEq('Walk In wine', rowOf(s, 10, 4), ['Walk In', '5320 - Wine Cost', 10, 250]);
  deepEq('Walk In liquor', rowOf(s, 11, 4), ['Walk In', '5310 - Liquor Cost', 4, 40]);
  deepEq('Walk In n/a', rowOf(s, 12, 4), ['Walk In', '5335 - N/A Beverage Cost', 5, 10]);
  deepEq('Walk In beer', rowOf(s, 13, 4), ['Walk In', '5330 - Beer Cost', 6, 0]);
  eq('6 data rows — pairs that never happened are skipped', rows, 13);
  check('nothing after the last pair', s.getCell(14, 1).value == null);
}

console.log('\nbuildAuditWorkbookBlob — 4. Summary By Item');
{
  const s = sheet(wb, '4. Summary By Item');
  const rows = s.rowCount;
  deepEq('row 7 headers, one column per location, uppercased', rowOf(s, 7, 9),
    ['ID', 'SKU', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY', 'BAR', 'WALK IN', 'TOTAL']);
  // The grid is fully dense: a location that never saw the item shows 0.
  deepEq('Alpha Wine row', rowOf(s, 8, 9),
    [null, null, 'Alpha Wine 750ml', '750ml', '5320 - Wine Cost', '', 0, 10, 10]);
  deepEq('Bravo Gin row', rowOf(s, 9, 9),
    [null, null, 'Bravo Gin 750ml', '750ml', '5310 - Liquor Cost', 'Gin', 3, 4, 7]);
  deepEq('Charlie Beer row (never in Bar → explicit 0)', rowOf(s, 10, 9),
    [null, null, 'Charlie Beer 12floz', '12floz', '5330 - Beer Cost', '', 0, 6, 6]);
  deepEq('Delta Soda row', rowOf(s, 11, 9),
    [null, null, 'Delta Soda 12floz', '12floz', '5335 - N/A Beverage Cost', '', 0, 5, 5]);
  eq('all four in-scope items, no excluded ones', rows, 11);
  check('ID and SKU columns stay blank', s.getCell(8, 1).value == null && s.getCell(8, 2).value == null);
}

console.log('\nbuildAuditWorkbookBlob — per-account sheets');
{
  const s = sheet(wb, '5330 - Beer Cost');
  const rows = s.rowCount;
  deepEq('beer sheet holds only the beer item', rowOf(s, 8, 9),
    [null, null, 'Charlie Beer 12floz', '12floz', '5330 - Beer Cost', '', 0, 6, 6]);
  eq('one data row', rows, 8);
  deepEq('same location columns as Summary By Item', rowOf(s, 7, 9),
    ['ID', 'SKU', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY', 'BAR', 'WALK IN', 'TOTAL']);
}
{
  const s = sheet(wb, '5335 - N,A Beverage Cost');
  cell('sanitised sheet still lists the real account name', s, 8, 5, '5335 - N/A Beverage Cost');
  cell('and the item', s, 8, 3, 'Delta Soda 12floz');
}

console.log('\nbuildAuditWorkbookBlob — location sheets');
{
  const s = sheet(wb, 'Walk In - Loc');
  const rows = s.rowCount;
  deepEq('row 7 headers', rowOf(s, 7, 9),
    ['ID', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY', 'BIN', 'QTY', 'CU PRICE', 'AMOUNT']);
  deepEq('Alpha Wine line', rowOf(s, 8, 9),
    [null, 'Alpha Wine 750ml', '750ml', '5320 - Wine Cost', '', null, 10, 25, 250]);
  deepEq('Bravo Gin line', rowOf(s, 9, 9),
    [null, 'Bravo Gin 750ml', '750ml', '5310 - Liquor Cost', 'Gin', null, 4, 10, 40]);
  deepEq('Delta Soda line', rowOf(s, 11, 9),
    [null, 'Delta Soda 12floz', '12floz', '5335 - N/A Beverage Cost', '', null, 5, 2, 10]);
  eq('every item counted here, and only those', rows, 11);
  // An unpriced item leaves CU PRICE and AMOUNT blank — NOT 0, which would
  // read as "worth nothing" instead of "we don't know".
  cell('unpriced qty still written', s, 10, 7, 6);
  const cu = s.getCell(10, 8).value;
  const amt = s.getCell(10, 9).value;
  check('unpriced CU PRICE is blank, not 0', cu === null || cu === undefined, cu);
  check('unpriced AMOUNT is blank, not 0', amt === null || amt === undefined, amt);
  check('unpriced AMOUNT is not the number 0', amt !== 0, amt);
  check('BIN column is blank (kount has no bins)', s.getCell(8, 6).value == null);
}
{
  const s = sheet(wb, 'Bar - Loc');
  const rows = s.rowCount;
  // Membership is "was there an entry here", not "qty > 0": the wine counted
  // as 0 in Bar belongs on this sheet, the beer never counted here does not.
  deepEq('zero-qty item is on its location sheet', rowOf(s, 8, 9),
    [null, 'Alpha Wine 750ml', '750ml', '5320 - Wine Cost', '', null, 0, 25, 0]);
  deepEq('gin line sums both Bar entries', rowOf(s, 9, 9),
    [null, 'Bravo Gin 750ml', '750ml', '5310 - Liquor Cost', 'Gin', null, 3, 10, 30]);
  eq('only the two items counted in Bar', rows, 9);
  check('item never counted here is absent',
    ![8, 9].some(r => s.getCell(r, 2).value === 'Charlie Beer 12floz'));
  check('excluded item never reaches a sheet',
    ![8, 9].some(r => s.getCell(r, 2).value === 'Napkins'));
}

console.log('\nbuildAuditWorkbookBlob — no notes when there is nothing to note');
{
  const clean = buildAuditReportModel([
    line({ masterItemId: 'c1', itemName: 'Clean Gin 750ml', location: 'Bar', qty: 2, cuPrice: 5 }),
  ]);
  const cwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: clean }));
  const s = sheet(cwb, '1. Summary');
  deepEq('single account row', rowOf(s, 8, 3), ['5310 - Liquor Cost', 2, 10]);
  deepEq('TOTAL row', rowOf(s, 10, 3), ['TOTAL', 2, 10]);
  check('no notes below the total', s.getCell(12, 1).value == null && s.getCell(13, 1).value == null);
  cell('US date with a single-digit month/day', s, 3, 1, 'Count 01/05/2026 V');
}

console.log('\nbuildAuditWorkbookBlob — priced-at-zero renders 0, not blank');
{
  const free = buildAuditReportModel([
    line({ masterItemId: 'f1', itemName: 'Free Water 1each', location: 'Bar', qty: 4, cuPrice: 0, baseSize: null, baseUnit: null }),
  ]);
  const fwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: free }));
  const s = sheet(fwb, 'Bar - Loc');
  cell('CU PRICE 0 is written as 0', s, 8, 8, 0);
  cell('AMOUNT 0 is written as 0', s, 8, 9, 0);
  cell('count unit falls back to the name token', s, 8, 3, '1each');
  const sum = sheet(fwb, '1. Summary');
  cell('summary amount 0', sum, 8, 3, 0);
  cell('zero-priced item still totals', sum, 10, 1, 'TOTAL');
  // A price of 0 is a price: no "no unit cost" footnote may appear.
  const belowTotal = [11, 12, 13].map(r => String(sum.getCell(r, 1).value ?? '')).join(' ');
  check('no unpriced note for a zero-priced item', !belowTotal.includes('no unit cost'), belowTotal);
  check('nothing at all below the TOTAL row', belowTotal.trim() === '', belowTotal);
}

console.log('\nbuildAuditWorkbookBlob — case-variant zones keep distinct column headers');
{
  // Three zones that differ only in case are three separate locations with
  // three separate columns of numbers. Upper-casing all three would put the
  // same word over all of them.
  const cased = buildAuditReportModel([
    line({ masterItemId: 'c1', itemName: 'Cased Gin 750ml', location: 'BAR', qty: 1, cuPrice: 2 }),
    line({ masterItemId: 'c1', itemName: 'Cased Gin 750ml', location: 'Bar', qty: 2, cuPrice: 2 }),
    line({ masterItemId: 'c1', itemName: 'Cased Gin 750ml', location: 'bar', qty: 3, cuPrice: 2 }),
    line({ masterItemId: 'c1', itemName: 'Cased Gin 750ml', location: 'Walk In', qty: 4, cuPrice: 2 }),
  ]);
  deepEq('locations sort ordinally', cased.locations, ['BAR', 'Bar', 'Walk In', 'bar']);
  const cwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: cased }));
  const byItem = sheet(cwb, '4. Summary By Item');
  deepEq('colliding headers fall back to raw zone text, the rest still shout',
    rowOf(byItem, 7, 11),
    ['ID', 'SKU', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY', 'BAR', 'Bar', 'WALK IN', 'bar', 'TOTAL']);
  const locHeaders = rowOf(byItem, 7, 10).slice(6) as string[];
  eq('all four location headers are distinct', new Set(locHeaders).size, 4);
  // The per-account sheets share the same header builder, so they must agree.
  const acct = sheet(cwb, '5310 - Liquor Cost');
  deepEq('per-account sheet headers match', rowOf(acct, 7, 11), rowOf(byItem, 7, 11));
  // And the numbers under those headers are still the right ones.
  deepEq('one column per zone, in locations order', rowOf(byItem, 8, 11).slice(6),
    [1, 2, 4, 3, 10]);
}

console.log('\nbuildAuditWorkbookBlob — a zone named History');
{
  // End-to-end smoke: a venue with a zone called History exports. Note the
  // location sheet is 'History - Loc', so this path never hit the reserved
  // name itself — the seed in makeSheetNamer protects direct callers and any
  // future sheet named from a zone verbatim. Asserted anyway so "a zone called
  // History exports" is a stated, checked property rather than an inference.
  const hist = buildAuditReportModel([
    line({ masterItemId: 'h1', itemName: 'Hist Gin 750ml', location: 'History', qty: 2, cuPrice: 3 }),
    line({ masterItemId: 'h2', itemName: 'Bar Gin 750ml', location: 'Bar', qty: 1, cuPrice: 3 }),
  ]);
  let names: string[] = [];
  let threw: unknown = null;
  try {
    names = (await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: hist }))).worksheets.map(w => w.name);
  } catch (e) { threw = e; }
  check('workbook with a History zone builds', threw === null,
    threw instanceof Error ? threw.message : threw);
  check('its location sheet is present', names.includes('History - Loc'), names);
  check('no sheet is called History outright',
    !names.some(n => n.toLowerCase() === 'history'), names);
}

console.log('\nbuildAuditWorkbookBlob — no non-finite value ever reaches a cell');
{
  // The full chain, the way production runs it: raw price rows through
  // pickNewestPrices, raw entries through toCountLines, then the model and the
  // workbook. Every non-finite value the database can hand over is in here —
  // a NaN cost, an Infinity cost, a NaN qty, an Infinity qty — because exceljs
  // writes <v>NaN</v> without complaint and Excel then calls the file corrupt.
  const prices = pickNewestPrices([
    price('p1', 'nanCost', Number.NaN, '2026-01-01T00:00:00Z'),
    price('p2', 'infCost', Number.POSITIVE_INFINITY, '2026-01-01T00:00:00Z'),
    price('p3', 'okCost', 4.5, '2026-01-01T00:00:00Z'),
    price('p4', 'nanQty', 2, '2026-01-01T00:00:00Z'),
    price('p5', 'infQty', 3, '2026-01-01T00:00:00Z'),
  ]);
  eq('only the finite cost survived the price pick', prices.size, 3);
  const masters = new Map<string, MasterItem>([
    ['nanCost', master({ id: 'nanCost', name: 'A NaN Cost 750ml' })],
    ['infCost', master({ id: 'infCost', name: 'B Inf Cost 750ml' })],
    ['okCost', master({ id: 'okCost', name: 'C Ok Cost 750ml' })],
    ['nanQty', master({ id: 'nanQty', name: 'D NaN Qty 750ml' })],
    ['infQty', master({ id: 'infQty', name: 'E Inf Qty 750ml' })],
  ]);
  const { lines, unresolved } = toCountLines([
    { master_item_id: 'nanCost', zone: 'Bar', qty: 2 },
    { master_item_id: 'infCost', zone: 'Bar', qty: 2 },
    { master_item_id: 'okCost', zone: 'Bar', qty: 2 },
    { master_item_id: 'nanQty', zone: 'Walk In', qty: Number.NaN },
    { master_item_id: 'infQty', zone: 'Walk In', qty: Number.POSITIVE_INFINITY },
  ], masters, prices);
  eq('all five entries resolved', lines.length, 5);
  eq('nothing unresolved', unresolved, 0);
  check('every line qty is finite', lines.every(l => Number.isFinite(l.qty)), lines.map(l => l.qty));
  check('every line cost is null or finite',
    lines.every(l => l.cuPrice === null || Number.isFinite(l.cuPrice)), lines.map(l => l.cuPrice));

  const poisoned = buildAuditReportModel(lines);
  check('model totals are finite', Number.isFinite(poisoned.totals.amount) && Number.isFinite(poisoned.totals.qty),
    poisoned.totals);
  eq('the two non-finite-cost items are simply unpriced', poisoned.unpricedItems, 2);

  let pwb: ExcelJSNS.Workbook | null = null;
  let threw: unknown = null;
  try {
    pwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: poisoned }));
  } catch (e) { threw = e; }
  check('poisoned data still produces a workbook', threw === null,
    threw instanceof Error ? threw.message : threw);
  const bad = pwb ? nonFiniteCells(pwb) : ['(workbook never built)'];
  check('NO cell anywhere in the workbook holds NaN or Infinity', bad.length === 0, bad);
  // And the unpriced rendering is the normal one, not something new.
  const s = sheet(pwb as ExcelJSNS.Workbook, 'Bar - Loc');
  const cu = s.getCell(8, 8).value;
  check('a NaN-costed item renders as unpriced (blank CU PRICE)', cu === null || cu === undefined, cu);
  cell('a NaN-costed item keeps its qty', s, 8, 7, 2);
  cell('the finite-cost item is priced normally', s, 10, 8, 4.5);
  const wi = sheet(pwb as ExcelJSNS.Workbook, 'Walk In - Loc');
  cell('a NaN qty became 0', wi, 8, 7, 0);
  cell('an Infinity qty became 0', wi, 9, 7, 0);
}

console.log('\nbuildAuditWorkbookBlob — CU PRICE is written raw, on purpose');
{
  // DELIBERATE, and pinned so it is not "tidied up": the CU PRICE column is
  // written unrounded and with NO number format, because the reference
  // Bevager workbook writes it that way (General format), and because 0 of
  // 1,813 priced masters in production carry a cost with more than 2 decimals
  // — so rounding here would risk fidelity against the reference for no
  // practical gain. AMOUNT next to it IS rounded to cents and money-formatted;
  // that asymmetry is the decision.
  const precise = buildAuditReportModel([
    line({ masterItemId: 'r1', itemName: 'Precise Gin 750ml', location: 'Bar', qty: 3, cuPrice: 35.746 }),
  ]);
  const rwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: precise }));
  const s = sheet(rwb, 'Bar - Loc');
  cell('CU PRICE keeps every decimal it was given', s, 8, 8, 35.746);
  eq('CU PRICE carries no number format', s.getCell(8, 8).numFmt, undefined);
  cell('AMOUNT is rounded to cents', s, 8, 9, 107.24);
  eq('AMOUNT does carry the money format', s.getCell(8, 9).numFmt, '#,##0.00');
  eq('QTY carries no number format either', s.getCell(8, 7).numFmt, undefined);
}

console.log('\nbuildAuditWorkbookBlob — the deliberate 2dp/4dp quantity split');
{
  // The two summary sheets print the TOTAL (quantity) column with the AMOUNT
  // treatment — 2dp — because the reference Bevager workbook does. Every other
  // quantity in the file keeps 4dp. Deliberate and inconsistent on purpose, so
  // it is pinned rather than left to be "tidied up" by accident.
  const frac = buildAuditReportModel([
    line({ masterItemId: 'p1', itemName: 'Partial Gin 750ml', location: 'Bar', qty: 0.125, cuPrice: 8 }),
  ]);
  eq('model keeps 4dp', frac.items[0].totalQty, 0.125);
  const pwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: frac }));
  cell('1. Summary TOTAL column is 2dp', sheet(pwb, '1. Summary'), 8, 2, 0.13);
  cell('2. Summary By Account TOTAL column is 2dp', sheet(pwb, '2. Summary By Account'), 8, 2, 0.13);
  cell('3. Summary By Location QTY keeps 4dp', sheet(pwb, '3. Summary By Location'), 8, 3, 0.125);
  // One location → columns are ID, SKU, ITEM, COUNT UNIT, CATEGORY,
  // SUBCATEGORY, BAR, TOTAL, so TOTAL is column 8 here.
  cell('4. Summary By Item location column keeps 4dp', sheet(pwb, '4. Summary By Item'), 8, 7, 0.125);
  cell('4. Summary By Item TOTAL keeps 4dp', sheet(pwb, '4. Summary By Item'), 8, 8, 0.125);
  cell('location sheet QTY keeps 4dp', sheet(pwb, 'Bar - Loc'), 8, 7, 0.125);
  cell('AMOUNT is still rounded to cents', sheet(pwb, 'Bar - Loc'), 8, 9, 1);
}

console.log('\nbuildAuditWorkbookBlob — recountCount is tri-state');
{
  // null = the lookup FAILED (we don't know), undefined = the caller didn't
  // ask, a number = a real count. The three must read differently on the
  // Summary sheet: "we couldn't check" is not the same claim as "there were
  // none", and silently rendering the first as the second is how a corrected
  // count gets signed off as uncorrected.
  const one = buildAuditReportModel([
    line({ masterItemId: 'rc1', itemName: 'Recount Gin 750ml', location: 'Bar', qty: 2, cuPrice: 5 }),
  ]);
  const noteAt = async (recountCount: number | null | undefined) => {
    const rwb = await readBack(await buildAuditWorkbookBlob({
      venueName: 'V', auditDate: '2026-01-05', model: one, recountCount,
    }));
    const s = sheet(rwb, '1. Summary');
    cell('TOTAL is where it always is', s, 10, 1, 'TOTAL');
    return [12, 13].map(r => String(s.getCell(r, 1).value ?? '')).join(' ').trim();
  };
  const failed = await noteAt(null);
  check('null → the lookup-failed note', failed.startsWith('Recount overrides could not be determined'), failed);
  check('null → says the figures are pre-correction', failed.includes('treat these figures as pre-correction'), failed);
  check('null → does NOT claim a number', !/\d+ recount override/.test(failed), failed);
  eq('undefined → no note at all', await noteAt(undefined), '');
  eq('0 → no note either (nothing to disclose)', await noteAt(0), '');
  const single = await noteAt(1);
  check('1 → singular "override was recorded"', single.startsWith('1 recount override was recorded'), single);
  check('1 → explains the report values the originals', single.includes('values the original count entries'), single);
  const many = await noteAt(3);
  check('3 → plural "overrides were recorded"', many.startsWith('3 recount overrides were recorded'), many);
}

console.log('\nbuildAuditWorkbookBlob — A6 names the zone only when the tab cannot');
{
  // Reference fidelity first: for an ordinary zone the tab already says which
  // location it is, so row 6 stays the blank spacer the reference workbook has.
  const plain = buildAuditReportModel([
    line({ masterItemId: 'a1', itemName: 'Plain Gin 750ml', location: 'Bar', qty: 1, cuPrice: 2 }),
  ]);
  const pwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: plain }));
  const s = sheet(pwb, 'Bar - Loc');
  cell('A6 stays blank for an ordinary zone', s, 6, 1, null);
  cell('the header row is still row 7', s, 7, 1, 'ID');
  cell('data still starts on row 8', s, 8, 2, 'Plain Gin 750ml');
  for (const name of ['1. Summary', '2. Summary By Account', '3. Summary By Location', '4. Summary By Item']) {
    cell('A6 blank on a summary sheet', sheet(pwb, name), 6, 1, null);
  }
}
{
  // Three ways the tab stops saying which zone it is: sanitised, suffixed
  // after a case-only collision, and cut at 31 chars. Each has to write the
  // raw zone down somewhere or the sheet is unmappable to what was counted.
  const LONG = 'Main Floor Back Bar Storage Rooms Alpha';
  const messy = buildAuditReportModel([
    line({ masterItemId: 'b1', itemName: 'Gin One 750ml', location: 'Walk/In', qty: 1, cuPrice: 2 }),
    line({ masterItemId: 'b2', itemName: 'Gin Two 750ml', location: 'Bar', qty: 1, cuPrice: 2 }),
    line({ masterItemId: 'b3', itemName: 'Gin Three 750ml', location: 'bar', qty: 1, cuPrice: 2 }),
    line({ masterItemId: 'b4', itemName: 'Gin Four 750ml', location: LONG, qty: 1, cuPrice: 2 }),
  ]);
  const mwb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: messy }));
  const names = mwb.worksheets.map(w => w.name);
  check('the sanitised sheet exists', names.includes('Walk,In - Loc'), names);
  cell('sanitised zone names itself in A6', sheet(mwb, 'Walk,In - Loc'), 6, 1, 'Location: Walk/In');
  // 'Bar' sorts before 'bar', so 'Bar' keeps the plain name and 'bar' is the
  // one that gets suffixed.
  cell('the zone that kept its name has no A6 line', sheet(mwb, 'Bar - Loc'), 6, 1, null);
  cell('the suffixed zone names itself in A6', sheet(mwb, 'bar - Loc (2)'), 6, 1, 'Location: bar');
  const truncated = names.find(n => n.startsWith('Main Floor'))!;
  check('the long zone was truncated', truncated.length === 31 && !truncated.endsWith('- Loc'), truncated);
  cell('the truncated zone names itself in full in A6',
    sheet(mwb, truncated), 6, 1, `Location: ${LONG}`);
  // The extra line must not push the grid down.
  const t = sheet(mwb, truncated);
  cell('header row unmoved despite the A6 line', t, 7, 1, 'ID');
  cell('data row unmoved despite the A6 line', t, 8, 2, 'Gin Four 750ml');
}

console.log('\nbuildAuditWorkbookBlob — empty model still produces a workbook');
{
  const ewb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: buildAuditReportModel([]) }));
  deepEq('four summary sheets, no account/location sheets',
    ewb.worksheets.map(w => w.name),
    ['1. Summary', '2. Summary By Account', '3. Summary By Location', '4. Summary By Item']);
  const s = sheet(ewb, '1. Summary');
  deepEq('TOTAL row with zeroes', rowOf(s, 9, 3), ['TOTAL', 0, 0]);
  const byItem = sheet(ewb, '4. Summary By Item');
  deepEq('no location columns', rowOf(byItem, 7, 7),
    ['ID', 'SKU', 'ITEM', 'COUNT UNIT', 'CATEGORY', 'SUBCATEGORY', 'TOTAL']);
}

console.log('\nbuildAuditWorkbookBlob — adversarial location names');
{
  // Every way a free-text zone can make exceljs throw, in one workbook:
  // case-only duplicates, two names that collide once cut to 31 chars,
  // leading/trailing apostrophes, whitespace-only, sanitises-to-empty, and
  // the six characters Excel forbids outright. This used to throw at the end
  // of the export and lose the whole thing.
  const LOCS = [
    'Bar', 'bar', 'BAR',
    'Main Floor Back Bar Storage Rooms Alpha',
    'Main Floor Back Bar Storage Rooms Beta',
    "'Quoted'",
    "Trailing'",
    '   ',
    ':::',
    'Walk/In \\ Back?Bar*[1]:2',
    "'",
  ];
  const adversarial = buildAuditReportModel(LOCS.map((loc, i) => ({
    masterItemId: 'a' + i,
    itemName: 'Item ' + String(i).padStart(2, '0'),
    category: 'liquor',
    subcategory: 'gin',
    baseSize: 750,
    baseUnit: 'ml',
    location: loc,
    qty: i + 1,
    cuPrice: 1,
  })));
  eq('all adversarial zones survive as distinct locations', adversarial.locations.length, LOCS.length);

  let names: string[] = [];
  let threw: unknown = null;
  try {
    const awb = await readBack(await buildAuditWorkbookBlob({
      venueName: "Joe's / Bar", auditDate: '2026-01-05', model: adversarial,
    }));
    names = awb.worksheets.map(w => w.name);
  } catch (e) {
    threw = e;
  }
  check('workbook builds instead of throwing', threw === null, threw instanceof Error ? threw.message : threw);
  eq('4 summaries + 1 account + 11 location sheets', names.length, 4 + 1 + LOCS.length);
  check('every name is non-empty', names.every(n => n.length > 0), names);
  check('every name is ≤31 chars', names.every(n => n.length <= 31), names.map(n => `${n}:${n.length}`));
  check('no name starts or ends with an apostrophe', names.every(n => !/(^')|('$)/.test(n)), names);
  check('no name carries a character Excel forbids',
    names.every(n => !/[*?:/\\[\]]/.test(n)), names);
  check('all names unique case-insensitively',
    new Set(names.map(n => n.toLowerCase())).size === names.length, names);
  check('Bar / bar / BAR each got their own sheet',
    names.filter(n => /^bar - loc/i.test(n)).length === 3, names);
  check('the two long zones both made it',
    names.filter(n => n.startsWith('Main Floor Back Bar Storage')).length === 2, names);
  check('the three empty-ish zones each got a sheet',
    names.filter(n => n.startsWith('- Loc')).length === 3, names);
}

console.log('\nbuildAuditWorkbookBlob — accounts tied on amount still build');
{
  const tie = buildAuditReportModel([
    line({ masterItemId: 't1', itemName: 'Equal Beer 12floz', location: 'Bar', qty: 5, cuPrice: 1, category: 'beer', baseSize: 12, baseUnit: 'floz' }),
    line({ masterItemId: 't2', itemName: 'Equal Wine 750ml', location: 'Bar', qty: 1, cuPrice: 5, category: 'wine' }),
  ]);
  let twb: ExcelJSNS.Workbook | null = null;
  let threw: unknown = null;
  try {
    twb = await readBack(await buildAuditWorkbookBlob({ venueName: 'V', auditDate: '2026-01-05', model: tie }));
  } catch (e) { threw = e; }
  check('tied accounts do not throw', threw === null, threw instanceof Error ? threw.message : threw);
  deepEq('both account sheets present, in the model order',
    (twb?.worksheets ?? []).map(w => w.name),
    ['1. Summary', '2. Summary By Account', '3. Summary By Location', '4. Summary By Item',
      '5330 - Beer Cost', '5320 - Wine Cost', 'Bar - Loc']);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
