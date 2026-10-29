/**
 * askAiContext: the venue block the admin Ask AI sends with each question.
 * Run with:  npm test   (or: npx tsx tests/askAiContext.test.ts)
 */
import { baseSystemPrompt, buildVarianceContext, CONTEXT_CHAR_BUDGET, money, type AskAiRow } from '../src/lib/askAiContext';
import { localIsoDate } from '../src/lib/auditReport';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log('        ', detail); }
}

const row = (name: string, cat: string, actual: number, theo: number, cost: number): AskAiRow => ({
  item_name: name, category: cat, actual, theo, variance: actual - theo,
  variance_value: (actual - theo) * cost, cu_price: cost,
});

console.log('askAiContext');

check('money formats sign and cents', money(-1234.5) === '-$1,234.50' && money(0) === '$0.00');

const empty = buildVarianceContext('Little Luck', { asOf: null, source: null }, []);
check('no rows: says there is no report, no totals', /No variance report/.test(empty) && !/TOTALS/.test(empty), empty);

const rows = [
  row('Aperol 750ml', 'Liquor Cost', 4, 10, 28.5),       // -6 x 28.5 = -171
  row('Ketel One 1L', 'Liquor Cost', 12, 10, 21),        // +2 x 21  = +42
  row('Theo Dancer Gamay', 'Wine Cost', 17, 17, 46),     // 0
  row('Mystery Bottle', 'Liquor Cost', 3, 0, 0),         // no cost
];
const ctx = buildVarianceContext('Little Luck', { asOf: '2026-10-20T17:46:34Z', source: 'computed' }, rows);
// v0.77: the date is the local calendar day, not the UTC slice -- so the expectation follows the machine's zone.
check('header names the venue and the date', /VENUE: Little Luck/.test(ctx) && ctx.includes('as of ' + localIsoDate(new Date('2026-10-20T17:46:34Z'))), ctx);
check('an unreadable date says so instead of NaN', buildVarianceContext('X', { asOf: 'not a date', source: 'computed' }, rows).includes('as of unknown date'));
check('counts unpriced items', /1 with no unit cost/.test(ctx), ctx);
check('net variance = shortages + overages', /net variance -\$129\.00/.test(ctx) && /shortages -\$171\.00/.test(ctx) && /overages \$42\.00/.test(ctx), ctx);
check('largest shortage listed first with its numbers', /LARGEST SHORTAGES[^\n]*\n- Aperol 750ml \| counted 4 \| expected 10 \| variance -6 \(-\$171\.00\) \| unit cost \$28\.50/.test(ctx), ctx);
check('overage listed', /LARGEST OVERAGES:\n- Ketel One 1L/.test(ctx), ctx);
check('zero-variance item is in neither list', !/- Theo Dancer Gamay \|/.test(ctx), ctx);
check('counted-but-unpriced item named', /COUNTED BUT NO UNIT COST[^\n]*\n- Mystery Bottle/.test(ctx), ctx);
check('category roll-up, worst first', ctx.indexOf('- Liquor Cost:') < ctx.indexOf('- Wine Cost:'), ctx);

// A big report stays inside the budget and drops rows rather than truncating lines.
const many: AskAiRow[] = [];
for (let i = 0; i < 400; i++) many.push(row('A very long product name number ' + i + ' with vintage 2021 750ml', 'Liquor Cost', i % 7, 5, 30 + i));
const big = buildVarianceContext('Poppy', { asOf: '2026-10-20T00:00:00Z', source: 'computed' }, many);
check('big report fits the budget', big.length <= CONTEXT_CHAR_BUDGET, big.length);
check('every list line is whole (ends with a unit cost)', big.split('\n').filter(l => l.startsWith('- A very')).every(l => /unit cost (\$[0-9,.]+|none)$/.test(l)));
check('base prompt + venue block stays under the Edge Function cap (8000)', (baseSystemPrompt() + '\n\n' + big).length < 8000);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
