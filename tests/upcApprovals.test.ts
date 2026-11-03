/**
 * v0.97 barcode approvals: the queue the user hit on 2026-11-03 — "Approve via approve_upc_mapping RPC failed for
 * 674545000063 → Don Julio 1942 Anejo 750ml: No master_items match the item_name; admin must pick explicitly",
 * with no way to pick. Shaped on that queue (20 rows, 3 repeats, 1 with no catalog item).  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupPending, linkState, needsPick, searchTerm, upcNorm, type Owner } from '../src/lib/upcApprovals';
import type { UpcMapping } from '../src/lib/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
let n = 0;
const m = (barcode: string, name: string, master: string | null): UpcMapping => ({
  id: `u${++n}`, barcode_raw: barcode, barcode_normalized: null, purchase_item_id: null, master_item_id: master, item_name: name, item_brand: null,
  item_category: 'spirits', submitted_by_email: 'alexaposner@gmail.com', submitted_by_name: 'Alexa Posner', status: 'pending', reviewed_by_email: null, reviewed_by_name: null, reviewed_at: null,
});

check('barcode as the RPC stores it: digits, no leading zeros', upcNorm('0611269002683') === '611269002683' && upcNorm(' 674545000063 ') === '674545000063' && upcNorm(null) === '');

const rows = [
  m('674545000063', 'Don Julio 1942 Anejo 750ml', null), m('898195001120', 'Fever Tree Club Soda 200ml', 'mFT'), m('674545000063', 'Don Julio 1942 Anejo 750ml', null),
  m('898195001120', 'Fever Tree Club Soda 200ml', 'mFT'), m('898195001120', 'Fever tree club soda 200ml ', 'mFT'), m('080686958024', 'Haku Japanese Vodka 750 ML', 'mHAKU2'),
  m('080480004699', 'St. Germain 750ml', 'mSTG'), m('852322814083', 'Giffard Framboise 750ml', 'mGIF'),
];
const groups = groupPending(rows);
check('the same scan sent again is one decision (Don Julio x2, Club Soda x3)', groups.length === 5
  && groups.find(g => g.first.item_name.startsWith('Don Julio'))?.rows.length === 2 && groups.find(g => g.first.barcode_raw === '898195001120')?.rows.length === 3, groups.map(g => g.rows.length));
check('a different catalog item for the same barcode stays its own decision', groupPending([m('1234567', 'X', 'a'), m('1234567', 'X', 'b')]).length === 2);

const owners = new Map<string, Owner>([
  ['674545000063', { id: 'mDJA', name: 'Don Julio Anejo 750ml' }], ['80686958024', { id: 'mHAKU1', name: 'Haku 750ml' }], ['80480004699', { id: 'mSTG', name: 'St. Germain 750ml' }],
]);
const kind = (name: string) => linkState(groups.find(g => g.first.item_name === name)!.first, owners);
check('no catalog item: Approve must ask which (and say the barcode is already on Don Julio Anejo)', kind('Don Julio 1942 Anejo 750ml').kind === 'no-item' && kind('Don Julio 1942 Anejo 750ml').owner?.name === 'Don Julio Anejo 750ml');
check('barcode already on ANOTHER item (Haku 750ml): the RPC keeps it there — said, not hidden', kind('Haku Japanese Vodka 750 ML').kind === 'other-owner' && kind('Haku Japanese Vodka 750 ML').owner?.id === 'mHAKU1');
check('barcode already on the same item: approving only clears it', kind('St. Germain 750ml').kind === 'same');
check('a barcode nobody has: a new link', kind('Giffard Framboise 750ml').kind === 'new' && kind('Giffard Framboise 750ml').owner === null);
check('the RPC\'s "pick explicitly" answers open the picker', needsPick('No master_items match the item_name; admin must pick explicitly') && needsPick('Multiple master_items match the name; admin must pick explicitly') && !needsPick('not authorized'));
check('the picker searches from the name\'s first words, sizes left out', searchTerm('Don Julio 1942 Anejo 750ml') === 'don julio' && searchTerm('Haku Japanese Vodka 750 ML') === 'haku japanese' && searchTerm('St. Germain 750ml') === 'st germain');

const src = readFileSync(join(process.cwd(), 'src/screens/Approvals.tsx'), 'utf8');
check('Approve on a row with no catalog item opens the picker instead of failing', /if \(approve && !masterId && !row\.master_item_id\) \{ setPicking\(g\); return; \}/.test(src));
check('the picked item goes to the RPC as p_master_item_id, for every repeat of the scan', /for \(const r of g\.rows\)/.test(src) && /p_master_item_id: masterId/.test(src));
check('a "pick explicitly" answer from the RPC opens the picker too', /if \(approve && needsPick\(msg\)\) \{ setBusyId\(null\); setPicking\(g\); return; \}/.test(src));
check('rows say what Approve will do (links to / already linked / already on another item)', /→ links to \{target\}/.test(src) && /Already linked to \{target\}/.test(src) && /Barcode is already on "\{link\.owner!\.name\}"/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
