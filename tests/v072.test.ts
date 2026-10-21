/**
 * v0.72: Item History 4-audit grid, Reports redesign, Inventory archived, Transfers screen.
 * Behaviour tests of the exported helpers + source checks of the wiring.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catGroup, closedHow } from '../src/screens/Reports';
import { buildGrid } from '../src/screens/ItemHistory';
import { validateDraft, toLocalInput } from '../src/screens/Transfers';
import { transferNet } from '../src/screens/Variance';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}

// catGroup
check('Liquor Cost -> Liquor', catGroup('Liquor Cost') === 'Liquor');
check('wine -> Wine', catGroup('wine') === 'Wine');
check('N/A Beverage Cost -> Soft drinks', catGroup('N/A Beverage Cost') === 'Soft drinks');
check('non_alcoholic_beverage -> Soft drinks', catGroup('non_alcoholic_beverage') === 'Soft drinks');
check('bar_consumable -> Bar consumables', catGroup('bar_consumable') === 'Bar consumables');
check('null -> Other', catGroup(null) === 'Other');

// closedHow
const base = { status: 'submitted', count_phase: 'final', count1_closed_at: null, count2_closed_at: null, completed_at: null } as const;
check('count 2 closed', closedHow({ ...base, count1_closed_at: 'x', count2_closed_at: 'y' }) === 'Count 2 closed');
check('finalized after count 1 (LL-038 / P-843 shape)', closedHow({ ...base, count1_closed_at: 'x', completed_at: 'x' }) === 'Finalized after Count 1');
check('active, counting', closedHow({ ...base, status: 'active', count_phase: 'count1' }) === 'Counting');
check('active, recount', closedHow({ ...base, status: 'active', count_phase: 'count2', count1_closed_at: 'x' }) === 'Recount in progress');

// buildGrid
const audits = [{ id: 'a1', code: 'A1', date: '2026-09-01', reportId: 'r1' }, { id: 'a2', code: 'A2', date: '2026-09-28', reportId: 'r2' }];
const g = buildGrid(audits, [
  { report_id: 'r1', item_name: 'Ketel One 1L', category: 'Liquor Cost', actual: 10, variance: -1, variance_value: -27.75 },
  { report_id: 'r2', item_name: 'ketel one 1L ', category: 'Liquor Cost', actual: 30, variance: 24.8, variance_value: 689 },
  { report_id: 'r2', item_name: 'Aperol 1L', category: 'Liquor Cost', actual: 7, variance: -1.5, variance_value: -37 },
  { report_id: 'rX', item_name: 'Not in chosen reports', category: null, actual: 1, variance: 0, variance_value: 999 },
]);
check('one row per item (name match ignores case/spaces)', g.length === 2, g.map(r => r.item));
check('totals summed across audits', Math.abs(g[0].total - 661.25) < 1e-9, g[0].total);
check('biggest |total| first', g[0].item === 'Ketel One 1L' && g[1].item === 'Aperol 1L');
check('cells keyed by audit id', g[0].cells.a1?.actual === 10 && g[0].cells.a2?.actual === 30);
check('rows from other reports ignored', !g.some(r => r.item.startsWith('Not in')));

// Transfers form validation
const item = { id: 'm1', name: 'Ketel One 1L', category: 'Liquor Cost' };
const L = (over: object) => [{ key: 1, item, qty: '6', unitCost: '', ...over }];
check('needs both venues', validateDraft('', 'v12', '2026-10-21T10:00', L({})) === 'Pick both venues.');
check('venues must differ', validateDraft('v12', 'v12', '2026-10-21T10:00', L({})) === 'The two venues must be different.');
check('needs a time', validateDraft('v11', 'v12', '', L({}))?.startsWith('Pick the date'));
check('needs an item', validateDraft('v11', 'v12', '2026-10-21T10:00', [{ key: 1, item: null, qty: '', unitCost: '' }]) === 'Add at least one item.');
check('qty above 0', validateDraft('v11', 'v12', '2026-10-21T10:00', L({ qty: '0' }))?.includes('quantity above 0'));
check('bad unit cost', validateDraft('v11', 'v12', '2026-10-21T10:00', L({ unitCost: 'abc' }))?.includes('not a number'));
check('valid draft passes', validateDraft('v11', 'v12', '2026-10-21T10:00', L({ unitCost: '27.75' })) === null);
check('toLocalInput format', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(toLocalInput(new Date(2026, 9, 21, 9, 5))) && toLocalInput(new Date(2026, 9, 21, 9, 5)) === '2026-10-21T09:05');

// transferNet
check('transfer net in minus out', transferNet({ transfers_in: 6, transfers_out: 2 }) === 4);
check('transfer net handles missing columns', transferNet({}) === 0);

// wiring
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const app = src('src/App.tsx'); const side = src('src/components/Sidebar.tsx');
check('Inventory route redirects (archived)', app.includes('<Route path="/inventory" element={<Navigate to="/variance" replace />} />'));
check('Inventory nav row commented out', /\/\/ \{ to: '\/inventory'/.test(side) && !/^\s*\{ to: '\/inventory'/m.test(side));
check('Transfers route gated by canRunAudits', app.includes('<Route path="/transfers" element={canRunAudits(user.role) ? <Transfers user={user} />'));
check('Transfers nav row present', side.includes("{ to: '/transfers',      label: 'Transfers'"));
const t = src('src/screens/Transfers.tsx');
check('create via kount_create_transfer with the 0099 parameters', t.includes("supabase.rpc('kount_create_transfer', {") && t.includes('p_lines: payload'));
check('delete via kount_delete_transfer', t.includes("supabase.rpc('kount_delete_transfer', { p_id: r.id })"));
const ih = src('src/screens/ItemHistory.tsx');
check('item history opens on the grid when no item is chosen', ih.includes('{!searchedItem && venueId && (') && ih.includes('<RecentAuditsGrid'));
check('grid takes the last 4 reported audits', ih.includes('.slice(0, 4)'));
const r = src('src/screens/Reports.tsx');
check('reports lists audits without a report (Computing)', r.includes('<Pill tone="caution" size="sm">Computing</Pill>'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
