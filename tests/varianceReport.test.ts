/**
 * Unit test for the PURE helpers in src/lib/varianceReport.ts:
 *   summarize()      — Summary-tab roll-up math
 *   systemicNotes()  — conditional auto-notes
 *   likelyCause()    — first-match-wins heuristic
 *   isMaterial()     — Possible-Causes inclusion gate
 *
 * These are exported separately from the exceljs workbook builder precisely so
 * they can be exercised without loading exceljs. The builder itself (binary
 * .xlsx output) is covered by typecheck + build, not asserted here.
 *
 * Run with:  npm test
 *
 * No test framework is configured in this repo, so this is a plain tsx script
 * that throws/exits non-zero on the first failed assertion and prints a summary.
 */
import {
  summarize,
  systemicNotes,
  likelyCause,
  isMaterial,
  type AvtLikeRow,
} from '../src/lib/varianceReport.ts';

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

function close(label: string, actual: number, expected: number, eps = 1e-9) {
  check(`${label} ≈ ${expected}`, Math.abs(actual - expected) < eps, actual);
}

/** Build an AvtLikeRow with sane defaults; override what the case needs. */
function row(p: Partial<AvtLikeRow>): AvtLikeRow {
  return {
    item_name: 'x',
    category: null,
    start_qty: 0,
    purchases: 0,
    depletions: 0,
    actual: 0,
    theo: 0,
    variance: 0,
    cu_price: null,
    variance_value: null,
    variance_pct: null,
    ...p,
  };
}

function main() {
  console.log('summarize() math:');
  {
    const rows: AvtLikeRow[] = [
      // priced, shrinkage: actual 2 @ $10 = $20; theo 5 @ $10 = $50; var$ -30
      row({ actual: 2, theo: 5, cu_price: 10, variance: -3, variance_value: -30, purchases: 4 }),
      // priced, overage: actual 6 @ $5 = $30; theo 4 @ $5 = $20; var$ +10
      row({ actual: 6, theo: 4, cu_price: 5, variance: 2, variance_value: 10, purchases: 1 }),
      // unpriced: no cu_price, no variance_value
      row({ actual: 1, theo: 1, cu_price: null, variance: 0, variance_value: null }),
    ];
    const s = summarize(rows);
    eq('items', s.items, 3);
    eq('itemsPriced', s.itemsPriced, 2);
    eq('itemsUnpriced', s.itemsUnpriced, 1);
    close('totalActualValue', s.totalActualValue, 2 * 10 + 6 * 5); // 50
    close('totalTheoValue', s.totalTheoValue, 5 * 10 + 4 * 5);     // 70
    close('netVarianceValue', s.netVarianceValue, -30 + 10);       // -20
    close('netVariancePct', s.netVariancePct, (-20 / 70) * 100);
    close('grossShrinkage', s.grossShrinkage, -30);
    close('grossOverage', s.grossOverage, 10);
    close('totalPurchases', s.totalPurchases, 5);
  }

  // netVariancePct guards against /0 theo.
  {
    const s = summarize([row({ variance_value: 5, cu_price: 1, theo: 0 })]);
    eq('netVariancePct with theo$=0 is 0', s.netVariancePct, 0);
  }

  console.log('\nsystemicNotes() conditions:');
  {
    // purchases all 0 → invoice-gap note present.
    const notes = systemicNotes([row({ purchases: 0, variance_value: -5, cu_price: 1, theo: 2, actual: 2 })]);
    check('purchases=0 note present', notes.some(x => x.includes('Purchases = $0')), notes);
  }
  {
    // counted-as-0-but-expected note.
    const notes = systemicNotes([
      row({ actual: 0, theo: 3, cu_price: 1, purchases: 1 }),
      row({ actual: 0, theo: 4, cu_price: 1, purchases: 1 }),
    ]);
    check('zero-but-expected note counts 2', notes.some(x => x.startsWith('2 items counted as 0')), notes);
  }
  {
    // unpriced note.
    const notes = systemicNotes([row({ cu_price: null, purchases: 1 })]);
    check('unpriced note present', notes.some(x => x.includes('not priced')), notes);
  }
  {
    // near-equal shrinkage/overage note.
    const notes = systemicNotes([
      row({ variance_value: -100, cu_price: 1, purchases: 1, actual: 1, theo: 1 }),
      row({ variance_value: 95, cu_price: 1, purchases: 1, actual: 1, theo: 1 }),
    ]);
    check('near-equal split note present', notes.some(x => x.includes('split across two catalog names')), notes);
  }
  {
    // No conditions met → no notes.
    const notes = systemicNotes([row({ purchases: 5, cu_price: 1, actual: 3, theo: 3, variance_value: 0 })]);
    eq('no notes when clean', notes.length, 0);
  }

  console.log('\nlikelyCause() first-match-wins:');
  eq('not counted',
    likelyCause(row({ actual: 0, theo: 3, variance: -3 })),
    'Not counted — verify it was counted in its zone (shows as full shrinkage)');
  eq('not in baseline',
    likelyCause(row({ start_qty: 0, depletions: 0, actual: 4, theo: 0, variance: 4 })),
    'Not in starting baseline — overage expected; add to baseline');
  eq('invoice gap',
    likelyCause(row({ purchases: 0, depletions: 3, actual: 1, theo: 4, variance: -3 })),
    'No purchases recorded (invoice gap) — shrinkage likely overstated');
  eq('plain shrinkage',
    likelyCause(row({ purchases: 5, depletions: 2, actual: 3, theo: 5, variance: -2 })),
    'Shrinkage — over-pour / spillage / untracked usage / theft');
  eq('plain overage',
    likelyCause(row({ start_qty: 2, purchases: 5, depletions: 2, actual: 6, theo: 4, variance: 2 })),
    'Overage — miscount, untracked transfer-in, or unrecorded depletion');
  eq('large pct on small qty',
    likelyCause(row({ start_qty: 1, depletions: 1, actual: 1, theo: 1, variance: 0.2, variance_pct: 40 })),
    'Large % swing on a low-value item');
  eq('within tolerance',
    likelyCause(row({ start_qty: 5, depletions: 1, actual: 5, theo: 5, variance: 0, variance_pct: 0 })),
    'Within tolerance');

  console.log('\nisMaterial() gate:');
  check('qty>0.5 is material', isMaterial(row({ variance: -0.6 })), true);
  check('var$>1 is material', isMaterial(row({ variance: 0, variance_value: -2 })), true);
  check('tiny is not material', !isMaterial(row({ variance: 0.1, variance_value: 0.2 })), false);

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
