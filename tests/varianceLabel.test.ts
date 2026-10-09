/**
 * Guard: an R365-matched venue's variance panel is not labelled "Craftable".
 * Alphabet (purchase_mapping = venue_item_map, 0064) gets its purchases from R365
 * invoices; its panel said "Craftable AVT variance" until v0.66.
 * Source-text checks so Variance.tsx (React, Supabase) is not loaded.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const s = readFileSync(join(process.cwd(), 'src/screens/Variance.tsx'), 'utf8');
const fn = s.match(/export function varianceSourceLabel[\s\S]*?\n}/)?.[0] ?? '';
check('varianceSourceLabel exists', fn.length > 0);
check("venue_item_map -> 'AVT variance · R365 invoices'", /=== 'venue_item_map' \? 'AVT variance · R365 invoices'/.test(fn), fn);
check("other venues keep 'Craftable AVT variance'", /: 'Craftable AVT variance'/.test(fn), fn);
check('panel title uses the helper, not a literal', s.includes('<Eyebrow>{varianceSourceLabel(purchaseMapping)}</Eyebrow>') && !s.includes('<Eyebrow>Craftable AVT variance</Eyebrow>'));
check("reads kount_venues.purchase_mapping for the audit's venue", /from\('kount_venues'\)\.select\('purchase_mapping'\)\.eq\('id', venueId\)/.test(s));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
