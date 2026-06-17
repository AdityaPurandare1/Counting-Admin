/**
 * Regression test for the C3 preview-vs-server mismatch in the procurement
 * CSV upload. The pure computeImportPreview() in src/lib/inventoryImport.ts
 * must faithfully mirror the authoritative RPC import_inventory_csv defined in
 * Counting-App/supabase/migrations/0034_fix_import_inventory_csv.sql.
 *
 * The cases below pin each RPC rule the old purchase_item_id-only preview got
 * wrong:
 *   (a) master-keyed carried row (NULL purchase_item_id) → already-carried,
 *   (b) UPC normalization (digits only, leading zeros stripped) via
 *       master_item_upcs,
 *   (c) active-name master match ignores is_active=false masters,
 *   (d) new-master row when there's no purchase match,
 *   (e) replace-mode removeIds includes ONLY master_item_id-NULL purchase-keyed
 *       rows absent from the CSV, EXCLUDING master-curated rows,
 *   (f) unresolvedMasterCount counts rows with no resolvable master.
 *
 * Same plain-tsx style as csv.test.ts: throws/exits non-zero on first failure
 * and prints a summary. No test framework configured.
 *
 * Run with:  npm test   (chained after bevagerImport + csv tests)
 */
import {
  computeImportPreview,
  normalizeUpc,
  type ParsedRow,
  type ImportPreviewInputs,
} from '../src/lib/inventoryImport.ts';

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

/** Build a ParsedRow with only the fields a case cares about. */
function row(p: Partial<ParsedRow> & { name: string }): ParsedRow {
  return { name: p.name, brand: p.brand ?? '', size: p.size ?? '', upc: p.upc ?? '', category: p.category ?? '', sku: p.sku ?? '' };
}

/** Empty-by-default inputs so each case wires only what it needs. */
function inputs(over: Partial<ImportPreviewInputs>): ImportPreviewInputs {
  return {
    purchaseItems: over.purchaseItems ?? [],
    masterItems: over.masterItems ?? [],
    masterItemUpcs: over.masterItemUpcs ?? [],
    carried: over.carried ?? [],
    replaceMode: over.replaceMode ?? false,
  };
}

function main() {
  console.log('Driving the REAL computeImportPreview...');

  // --- normalizeUpc unit checks (the RPC's 0020 normalization) ---
  console.log('\nnormalizeUpc: digits only, leading zeros stripped:');
  eq('normalizeUpc("000111222333")', normalizeUpc('000111222333'), '111222333');
  eq('normalizeUpc("0-08 11 5")', normalizeUpc('0-08 11 5'), '8115');
  eq('normalizeUpc("abc")', normalizeUpc('abc'), undefined);
  eq('normalizeUpc("0000")', normalizeUpc('0000'), undefined);
  eq('normalizeUpc("")', normalizeUpc(''), undefined);
  eq('normalizeUpc(null)', normalizeUpc(null), undefined);

  // --- (a) master-keyed carried row with NULL purchase_item_id ---
  // The CSV row resolves to a purchase item (by name) AND to a master (active
  // name). The carried row exists keyed on master_item_id with NULL
  // purchase_item_id (typical post Path B). The old preview keyed carried on
  // purchase_item_id only, so it would miss this and say "newly-carried". The
  // RPC checks master first → already carried.
  console.log('\n(a) master-keyed carried (NULL purchase_item_id) → already-carried:');
  {
    const p = computeImportPreview([row({ name: 'Grey Goose 1L' })], inputs({
      purchaseItems: [{ id: 'p1', name: 'Grey Goose 1L', upc: null }],
      masterItems: [{ id: 'm1', name: 'Grey Goose 1L', is_active: true }],
      carried: [{ purchase_item_id: null, master_item_id: 'm1' }],
    }));
    eq('  fate.status', p.fates[0].status, 'already-carried');
    eq('  fate.matchedId', p.fates[0].matchedId, 'p1');
  }

  // --- (b) UPC normalization resolves via master_item_upcs ---
  // CSV UPC "0-08 11 5" normalizes to "8115" and matches a master_item_upcs
  // row, even though the raw string differs. No purchase match → new-master,
  // but master IS resolved so it's NOT counted unresolved.
  console.log('\n(b) UPC normalization resolves master via master_item_upcs:');
  {
    const p = computeImportPreview([row({ name: 'Unmatched Name', upc: '0-08 11 5' })], inputs({
      masterItemUpcs: [{ upc_normalized: '8115', master_item_id: 'm9' }],
    }));
    eq('  fate.status (no purchase match)', p.fates[0].status, 'new-master');
    eq('  unresolvedMasterCount (master resolved)', p.unresolvedMasterCount, 0);
  }

  // --- (c) active-name match ignores is_active=false masters ---
  // Two masters share the name; only the inactive one exists → no master
  // resolves → unresolved. With an active one, it resolves.
  console.log('\n(c) active-name match ignores is_active=false masters:');
  {
    const inactiveOnly = computeImportPreview([row({ name: 'Old Brand' })], inputs({
      masterItems: [{ id: 'mInactive', name: 'Old Brand', is_active: false }],
    }));
    eq('  unresolved when only inactive master', inactiveOnly.unresolvedMasterCount, 1);

    const active = computeImportPreview([row({ name: 'Old Brand' })], inputs({
      masterItems: [
        { id: 'mInactive', name: 'Old Brand', is_active: false },
        { id: 'mActive', name: 'Old Brand', is_active: true },
      ],
    }));
    eq('  resolves when an active master exists', active.unresolvedMasterCount, 0);
  }

  // --- (d) new-master row (no purchase match) ---
  console.log('\n(d) new-master row when no purchase match:');
  {
    const p = computeImportPreview([row({ name: 'Brand New Thing' })], inputs({
      purchaseItems: [{ id: 'pX', name: 'Something Else', upc: null }],
    }));
    eq('  fate.status', p.fates[0].status, 'new-master');
    eq('  fate.matchedId (none — would be created)', p.fates[0].matchedId, undefined);
  }

  // --- (e) replace-mode removeIds: master_item_id-NULL purchase-keyed only ---
  // CSV carries p1 only. Live carried set:
  //   c1: purchase p1            → in CSV, keep
  //   c2: purchase p2, no master → master-NULL, absent from CSV → REMOVE
  //   c3: master m3 (NULL pid)   → master-curated, NEVER removed
  //   c4: purchase p4, master m4 → has master → NEVER removed
  // The old preview would have removed p2 AND p4 (both purchase ids absent
  // from CSV). The RPC (and now the preview) removes ONLY p2.
  console.log('\n(e) replace removeIds = master-NULL purchase-keyed rows absent from CSV:');
  {
    const p = computeImportPreview([row({ name: 'Keep Me' })], inputs({
      purchaseItems: [{ id: 'p1', name: 'Keep Me', upc: null }],
      carried: [
        { purchase_item_id: 'p1', master_item_id: null },
        { purchase_item_id: 'p2', master_item_id: null },
        { purchase_item_id: null, master_item_id: 'm3' },
        { purchase_item_id: 'p4', master_item_id: 'm4' },
      ],
      replaceMode: true,
    }));
    eq('  removeIds length', p.removeIds.length, 1);
    eq('  removeIds[0]', p.removeIds[0], 'p2');
    check('  excludes master-curated p4', !p.removeIds.includes('p4'), p.removeIds);
    check('  excludes NULL-pid curated m3 row', !p.removeIds.includes(null as unknown as string), p.removeIds);
  }

  // --- (f) unresolvedMasterCount counts rows with no resolvable master ---
  // Row1: resolves via active name. Row2 & Row3: no UPC match, no active name
  // match → unresolved.
  console.log('\n(f) unresolvedMasterCount counts no-resolvable-master rows:');
  {
    const p = computeImportPreview(
      [row({ name: 'Has Master' }), row({ name: 'No Master A' }), row({ name: 'No Master B', upc: '12345' })],
      inputs({
        masterItems: [{ id: 'm1', name: 'Has Master', is_active: true }],
        // no master_item_upcs row for 12345 → still unresolved
      }),
    );
    eq('  unresolvedMasterCount', p.unresolvedMasterCount, 2);
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
