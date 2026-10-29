/**
 * summaryByItem: Summary > By item totals one product across zones.
 * Run with:  npm test   (or: npx tsx tests/summaryByItem.test.ts)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveRecounts, finalCells, recountsAheadOfReport, RECOUNT_LINK_FIXED_AT, summarizeByItem, zoneBreakdown, WHOLE_ITEM_ZONE, type RecountRow, type SummaryEntry } from '../src/lib/summaryByItem';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log('        ', detail); }
}

console.log('summaryByItem');

const KRUG = 'm-krug';
const e = (item_name: string, zone: string, qty: number | string, master: string | null = null, is_recount = false): SummaryEntry =>
  ({ item_name, zone, qty, master_item_id: master, is_recount });

const { items, recountEntries } = summarizeByItem([
  e('Krug, Grande Cuvee, Brut Champagne', 'Down', 3, KRUG),
  e('Krug, Grande Cuvee, Brut Champagne', 'Storage', 3, KRUG),
  e('krug grande cuvee', 'Storage', 1, KRUG),                 // other spelling, same product
  e('Stony Hill, Napa Valley Chardonnay', 'Storage', 27, 'm-stony'),
  e('Stony Hill, Napa Valley Chardonnay', 'Down', '4', 'm-stony'),   // qty as text
  e('Mystery Mezcal', 'Bar', 2),                              // unlinked
  e('mystery  MEZCAL', 'Bar', 1),                             // unlinked, other spelling
  e('Krug, Grande Cuvee, Brut Champagne', 'Down', 5, KRUG, true), // recount: not added
]);

const krug = items.find(i => i.key === 'm:' + KRUG);
check('one row per linked product across zones and spellings', !!krug && krug.total === 7 && krug.entries === 3, krug);
check('zone split kept, largest first', !!krug && zoneBreakdown(krug.zones) === 'Storage 4 · Down 3', krug && zoneBreakdown(krug.zones));
const stony = items.find(i => i.key === 'm:m-stony');
check('text quantities are summed as numbers', !!stony && stony.total === 31, stony);
const myst = items.filter(i => !i.linked);
check('unlinked entries group by typed name, case/space-insensitive', myst.length === 1 && myst[0].total === 3, myst);
check('recount entries are counted, not added', recountEntries === 1);
check('rows sorted by name', items.map(i => i.name).join('|') === [...items.map(i => i.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).join('|'));
check('empty input', summarizeByItem([]).items.length === 0);

/* v0.77: totals after recount, with compute_avt_for_audit's precedence. */
console.log('\nrecount overrides');
let rid = 0;
const rc = (master: string | null, zone: string | null, count2: number | string | null, over: Partial<RecountRow> = {}): RecountRow => ({
  id: 'r' + String(++rid).padStart(3, '0'), master_item_id: master, item_name: 'Recounted ' + master, zone, count2_qty: count2,
  status: 'done', resolved_at: null, created_at: '2026-10-20T10:00:00+00:00', ...over,
});
const base = [
  e('Krug', 'Down', 3, KRUG), e('Krug', 'Storage', 3, KRUG),
  e('Stony Hill', 'Storage', 27, 'm-stony'),
  e('Mystery Mezcal', 'Bar', 2),
];
const total = (es: SummaryEntry[], rs: RecountRow[]) => finalCells(es, rs).cells.reduce((s, c) => s + c.qty, 0);
const itemOf = (es: SummaryEntry[], rs: RecountRow[], key: string) => summarizeByItem(es, rs).items.find(i => i.key === key);

check('no recounts: Count 1 totals unchanged', total(base, []) === 35 && finalCells(base, []).applied === 0);

const zoned = itemOf(base, [rc(KRUG, 'Storage', 5)], 'm:' + KRUG);
check('zoned recount replaces that zone only', !!zoned && zoned.total === 8 && zoneBreakdown(zoned.zones) === 'Storage 5 · Down 3' && zoned.recounted, zoned);

const whole = itemOf(base, [rc(KRUG, 'Storage', 5), rc(KRUG, null, 4)], 'm:' + KRUG);
check('whole-item recount wins over zones and zoned recounts', !!whole && whole.total === 4 && zoneBreakdown(whole.zones) === WHOLE_ITEM_ZONE + ' 4', whole);
check('whole-item recount keeps the entry count', !!whole && whole.entries === 2, whole);

const newZone = itemOf(base, [rc('m-stony', 'Bar', 2)], 'm:m-stony');
check('zoned recount where nothing was counted adds the zone', !!newZone && newZone.total === 29 && zoneBreakdown(newZone.zones) === 'Storage 27 · Bar 2', newZone);

const foundOnly = itemOf(base, [rc('m-new', null, 6)], 'm:m-new');
check('recount of an item never scanned still counts, under its recount name', !!foundOnly && foundOnly.total === 6 && foundOnly.name === 'Recounted m-new' && foundOnly.entries === 0, foundOnly);

check('dismissed recounts are ignored', total(base, [rc(KRUG, 'Down', 0, { status: 'dismissed' })]) === 35);
check('recounts without a count2_qty are ignored', total(base, [rc(KRUG, 'Down', null)]) === 35);
check('recounts with no catalog link are ignored', total(base, [rc(null, 'Bar', 9)]) === 35);
check('pending recounts with a count2_qty apply (compute only skips dismissed)', total(base, [rc(KRUG, 'Down', 1, { status: 'pending' })]) === 33);
check('a recount to 0 is a real 0', total(base, [rc(KRUG, 'Down', 0)]) === 32);
check('count2_qty as text is a number', total(base, [rc(KRUG, 'Down', '4')]) === 36);
check('unlinked entries are never overridden', itemOf(base, [rc(KRUG, 'Bar', 1)], 'n:mystery mezcal')?.total === 2);

const later = rc(KRUG, 'Down', 9, { resolved_at: '2026-10-21T09:00:00+00:00', created_at: '2026-10-19T00:00:00+00:00' });
const earlier = rc(KRUG, 'Down', 1, { resolved_at: null, created_at: '2026-10-20T12:00:00+00:00' });
check('latest by resolved_at, else created_at', effectiveRecounts([earlier, later]).map(r => r.count2_qty).join() === '9');
const tieA = rc(KRUG, 'Down', 2, { id: 'r-a' }); const tieB = rc(KRUG, 'Down', 7, { id: 'r-b' });
check('full tie broken by id (desc), as the SQL does', effectiveRecounts([tieB, tieA]).map(r => r.count2_qty).join() === '7');
check('...whichever order the rows arrive in (not first-row-wins)', effectiveRecounts([tieA, tieB]).map(r => r.count2_qty).join() === '7');
check('one override per (item, zone) and one per item-wide', effectiveRecounts([rc(KRUG, 'Down', 1), rc(KRUG, 'Down', 2), rc(KRUG, null, 3)]).length === 2);
check('applied = overrides that change a quantity', finalCells(base, [rc(KRUG, 'Down', 1), rc(KRUG, 'Down', 2), rc('m-stony', null, 3)]).applied === 2);
check('a recount confirming the Count 1 number is not a correction (but still marks the item recounted)',
  finalCells(base, [rc(KRUG, 'Down', 3)]).applied === 0 && summarizeByItem(base, [rc(KRUG, 'Down', 3)]).items.find(i => i.key === 'm:' + KRUG)?.recounted === true);
check('a whole-item recount confirming the Count 1 total is not a correction', finalCells(base, [rc(KRUG, null, 6)]).applied === 0);
const superseded = finalCells(base, [rc(KRUG, 'Storage', 5), rc(KRUG, null, 4)]);
check('a zoned recount superseded by a whole-item one is not counted', superseded.applied === 1 && superseded.appliedRecounts[0].zone === null, superseded.appliedRecounts);
check('a zoned recount where nothing was counted counts only when non-zero',
  finalCells(base, [rc('m-stony', 'Bar', 2)]).applied === 1 && finalCells(base, [rc('m-stony', 'Bar', 0)]).applied === 0);

// Is the stored variance behind the corrections shown?
const fix = rc(KRUG, 'Down', 1, { resolved_at: '2026-10-29T10:00:00+00:00' });
check('behind: no report at all', recountsAheadOfReport([fix], null) === true);
check('behind: correction resolved after the report', recountsAheadOfReport([fix], '2026-10-29T09:00:00+00:00') === true);
check('not behind: report computed after the correction (and after 0118)', recountsAheadOfReport([fix], '2026-10-29T11:00:00+00:00') === false);
check('falls back to created_at when not resolved', recountsAheadOfReport([rc(KRUG, 'Down', 1, { created_at: '2026-10-30T00:00:00+00:00' })], '2026-10-29T11:00:00+00:00') === true);
check('no corrections -> never behind', recountsAheadOfReport([], null) === false);
// Poppy P-373 / P-320 shape: corrected 9/20, report computed 10/21, row linked by 0118 on 10/28.
const oldFix = rc(KRUG, 'Down', 1, { resolved_at: '2026-09-20T22:00:00+00:00' });
check('behind: report predates the 0118 link even though the correction is older', recountsAheadOfReport([oldFix], '2026-10-21T08:00:00+00:00') === true);
check('not behind: same correction, report recomputed after 0118 (the 0119 six)', recountsAheadOfReport([oldFix], '2026-10-28T20:00:00+00:00') === false);
check('cutoff is the 0118 apply time', RECOUNT_LINK_FIXED_AT === '2026-10-28T19:00:00Z');

const withLegacy = [...base, e('Krug', 'Down', 50, KRUG, true)];
check('legacy is_recount entries stay out of the totals', total(withLegacy, []) === 35 && finalCells(withLegacy, []).recountEntries === 1);

// Wiring: Summary reads kount_recounts and uses these totals everywhere a qty is shown.
const sm = readFileSync(join(process.cwd(), 'src/screens/Summary.tsx'), 'utf8');
check('Summary loads kount_recounts for the audit', /from\('kount_recounts'\)[\s\S]{0,160}\.eq\('audit_id', auditId\)/.test(sm));
check('Summary Total qty / By zone come from finalCells', sm.includes('finalCells(entries, recounts)') && sm.includes('const totalQty = finals.cells.reduce('));
check('Summary By item gets the recounts', sm.includes('summarizeByItem(entries, recounts)'));
check('by-item CSV marks recounted items', sm.includes("'recounted'],") && sm.includes("i.recounted ? 'yes' : ''"));
check('the UI says the corrections are applied', sm.includes('Total qty · after recount') && sm.includes('Count 2 correction'));
check('no claim that the stored variance matches', !sm.includes('as in the variance'));
check('says when the stored variance predates the corrections',
  sm.includes('recountsAheadOfReport(finals.appliedRecounts, reportAt)') && sm.includes('may not include some of the Count 2 corrections below'));
check('a cancelled count is not called "no variance yet"', sm.includes("audit.status === 'cancelled'\n            ? 'This count was cancelled, so it has no variance"));
check('recounts are paged by id', /from\('kount_recounts'\)[\s\S]{0,200}\{ column: 'id', ascending: true \}/.test(sm));
check('the dead "Count 1 totals" note is gone', !sm.includes('Count 1 totals;'));
check('a failed recount read is said, not hidden', sm.includes('Recount corrections could not be loaded'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
