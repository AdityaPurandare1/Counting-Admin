/**
 * summaryByItem: Summary > By item totals one product across zones.
 * Run with:  npm test   (or: npx tsx tests/summaryByItem.test.ts)
 */
import { summarizeByItem, zoneBreakdown, type SummaryEntry } from '../src/lib/summaryByItem';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
