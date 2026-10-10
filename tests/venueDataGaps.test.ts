/**
 * v0.67 data-gap cards: unplaced R365 lines and unmapped POS items.
 * Behaviour test of the summary helper + source-text checks of the wiring.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeUnplaced, groupGuardrails, type UnplacedLine } from '../src/components/VenueDataGaps';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const L = (vendor: string, total: number, bev: boolean): UnplacedLine => ({
  vendor, invoice_number: '1', invoice_date: '2026-09-01', gl_code: bev ? '5315' : '5110', description: 'Missing Vendor Item',
  qty: 1, unit_cost: total, line_total: total, is_beverage: bev,
});
const s = summarizeUnplaced([L('Demarks', 900, true), L('Vesta', 50.5, true), L('Demarks', 210, true), L('Premier Meat', 2000, false)]);
check('beverage dollars summed', Math.abs(s.bev - 1160.5) < 1e-9, s.bev);
check('food/other kept separate', s.other === 2000, s.other);
check('line counts split', s.bevLines === 3 && s.otherLines === 1, s);
check('vendors ranked by beverage dollars', s.vendors[0][0] === 'Demarks' && s.vendors[0][1] === 1110, s.vendors);
check('string totals from PostgREST numerics are coerced', summarizeUnplaced([{ ...L('X', 0, true), line_total: '12.50' as unknown as number }]).bev === 12.5);
check('empty input is all zeros', JSON.stringify(summarizeUnplaced([])) === JSON.stringify({ bev: 0, other: 0, bevLines: 0, otherLines: 0, vendors: [] }));

const v = readFileSync(join(process.cwd(), 'src/screens/Variance.tsx'), 'utf8');
const c = readFileSync(join(process.cwd(), 'src/components/VenueDataGaps.tsx'), 'utf8');
check('cards render only for R365-matched venues', (v.match(/purchaseMapping === 'venue_item_map' &&/g) ?? []).length === 3);
check('unplaced card waits for a computed report', v.includes("reportId={avtReport?.source === 'computed' ? avtReport.id : null}"));
check("calls kount_unplaced_invoice_lines with p_audit_id", c.includes("supabase.rpc('kount_unplaced_invoice_lines', { p_audit_id: auditId })"));
check("calls kount_unmapped_pos_items with p_venue_id / p_days", c.includes("supabase.rpc('kount_unmapped_pos_items', { p_venue_id: venueId, p_days: days })"));
check('every RPC error is read and shown', (c.match(/Could not load:/g) ?? []).length === 3);
const g = groupGuardrails([
  { kind: 'invoice_gap', message: 'a', sort_value: null }, { kind: 'zone_empty', message: 'b', sort_value: 1 },
  { kind: 'weird', message: 'c', sort_value: null }, { kind: 'zone_empty', message: 'd', sort_value: 2 },
]);
check('guardrails grouped in display order, unknown kinds last', g.map(x => x[0]).join(',') === 'zone_empty,invoice_gap,weird', g.map(x => x[0]));
check('rows kept per kind', g[0][1].length === 2);
check('count-checks card is gated and passes the open state', v.includes("<CountChecksCard auditId={auditId} isOpen={audit?.status === 'active'} />"));
check('calls kount_count_guardrails with p_audit_id', c.includes("supabase.rpc('kount_count_guardrails', { p_audit_id: auditId })"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
