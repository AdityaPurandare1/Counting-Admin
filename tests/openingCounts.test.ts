/**
 * v0.73: a venue's first submitted count (per kind) is its opening count -- labelled and kept out of
 * variance totals in Overview and Reports.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstAuditPerVenue } from '../src/lib/openingCounts';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const ids = firstAuditPerVenue([
  { id: 'LL-038', venue_id: 'v11', started_at: '2026-10-18T14:00:00Z' },
  { id: 'LL-next', venue_id: 'v11', started_at: '2026-10-25T14:00:00Z' },
  { id: 'A-907', venue_id: 'v12', started_at: '2026-09-28T00:00:00Z' },
  { id: 'ALPHA0', venue_id: 'v12', started_at: '2026-08-28T00:00:00Z' },
  { id: 'FOOD1', venue_id: 'v12', started_at: '2026-10-01T00:00:00Z', audit_kind: 'food' },
  { id: 'BEV-null-kind', venue_id: 'v5', started_at: '2026-05-04T00:00:00Z', audit_kind: null },
  { id: 'P-000', venue_id: 'v5', started_at: '2026-10-18T00:00:00Z', audit_kind: 'beverage' },
]);
check('earliest per venue is the opening count', ids.has('LL-038') && ids.has('ALPHA0') && ids.has('BEV-null-kind'));
check('later counts are not', !ids.has('LL-next') && !ids.has('A-907') && !ids.has('P-000'));
check('food counts have their own opening count (kind-aware, like the 0101 window rule)', ids.has('FOOD1'));
check('null kind is treated as beverage', ids.size === 4, [...ids]);

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const ov = src('src/screens/Overview.tsx'); const rp = src('src/screens/Reports.tsx'); const lib = src('src/lib/openingCounts.ts');
check('loader reads submitted audits only', lib.includes(".eq('status', 'submitted')"));
check('loader reports its error instead of hiding counts', lib.includes("if (error) return { ids: new Set(), error: error.message };"));
check('Overview drops opening counts from the aggregate', ov.includes('const scopedAudits = inScope.filter(a => !opening.ids.has(a.id));'));
check('Overview lists what it left out', ov.includes('Opening counts are not in these totals'));
check('Reports totals use countedRows', rp.includes('net: countedRows.reduce('));
check('Reports labels the opening count', rp.includes('>Opening count</Pill>'));
check('picking the opening count still shows its items', rp.includes("r._auditId === auditId || !openingIds.has(r._auditId)"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
