/**
 * Equivalence test for the exceljs-based parseBevagerWorkbook.
 *
 * Background: the XLSX reader in src/lib/bevagerImport.ts was swapped from
 * `xlsx` (SheetJS) to `exceljs`. This test GENERATES a Bevager-style workbook
 * in-memory with exceljs, then feeds it through the ACTUAL exported
 * parseBevagerWorkbook (via a global File built from the buffer) and asserts the
 * returned BevagerRow[] is what a human would expect.
 *
 * Run with:  npm test   (alias for: tsx tests/bevagerImport.parse.test.ts)
 *
 * No test framework is configured in this repo, so this is a plain tsx script
 * that throws on the first failed assertion and prints a summary.
 *
 * parseBevagerWorkbook is run directly: its `await import('exceljs')` is now
 * interop-resilient, so no custom module loader is needed under raw Node ESM.
 */
import ExcelJS from 'exceljs';
import { parseBevagerWorkbook } from '../src/lib/bevagerImport.ts';

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

/**
 * Build a workbook that mirrors a real Bevager 'Director' export:
 *  - Sheet 1 is a NON-inventory sheet (so /inventory/i selection is tested).
 *  - Sheet 2 is named "2. Inventory" and holds the data.
 *  - The header row is NOT row 1: a title row + a blank row sit above it,
 *    exercising the 15-row header scan.
 *  - Columns: ID, CU, ITEM, CATEGORY, QUANTITY (position-based extraction).
 *  - One ITEM cell is exceljs rich text to exercise cellValue() flattening.
 *  - QUANTITY values are real numbers (numeric preservation).
 */
async function buildWorkbookBuffer(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: decoy / summary sheet. Must NOT be selected.
  const summary = wb.addWorksheet('Summary');
  summary.addRow(['This is a summary sheet, not inventory.']);
  summary.addRow(['ITEM', 'CU', 'CATEGORY', 'QUANTITY']); // header-like, but on the wrong sheet
  summary.addRow(['DECOY ITEM', '750ml', '5320 - Wine Cost', 999]);

  // Sheet 2: the real inventory sheet. Name matches /inventory/i.
  const ws = wb.addWorksheet('2. Inventory');

  // Row 1: title (no recognizable columns)
  ws.addRow(['Bevager Director — Inventory Export']);
  // Row 2: blank
  ws.addRow([]);
  // Row 3: header (column A == ID, B == CU, C == ITEM, D == CATEGORY, E == QUANTITY)
  ws.addRow(['ID', 'CU', 'ITEM', 'CATEGORY', 'QUANTITY']);

  // Row 4: plain string ITEM, integer quantity
  ws.addRow(['1001', '750ml', 'Campari 750ml', '5320 - Wine Cost', 12]);

  // Row 5: ITEM as RICH TEXT (two runs). cellValue() must flatten to the
  // concatenated visible string "Grey Goose Vodka". Quantity is a float.
  const richRow = ws.addRow([
    '1002',
    '1L',
    null, // placeholder; set rich text below
    '5310 - Liquor Cost',
    3.5,
  ]);
  richRow.getCell(3).value = {
    richText: [
      { text: 'Grey Goose ' },
      { text: 'Vodka' },
    ],
  } as ExcelJS.CellRichTextValue;

  // Row 6: quantity that is a non-numeric string -> must coerce to 0
  ws.addRow(['1003', 'each', 'Bitters Dash', '5310 - Liquor Cost', 'n/a']);

  // Row 7: blank ITEM -> row must be skipped entirely
  ws.addRow(['1004', '750ml', '', '5320 - Wine Cost', 7]);

  // Row 8: ITEM with surrounding whitespace -> must be trimmed
  ws.addRow(['1005', '375ml', '  Aperol 375ml  ', '5320 - Wine Cost', 0]);

  const buf = await wb.xlsx.writeBuffer();
  // ExcelJS returns a Node Buffer (which is an ArrayBufferView); normalize to
  // a standalone ArrayBuffer slice for File construction.
  return (buf as Buffer).buffer.slice(
    (buf as Buffer).byteOffset,
    (buf as Buffer).byteOffset + (buf as Buffer).byteLength,
  );
}

async function main() {
  console.log('Generating Bevager-style workbook with exceljs...');
  const ab = await buildWorkbookBuffer();

  // Node 20+ exposes global File. parseBevagerWorkbook calls file.size and
  // file.arrayBuffer(), both of which File provides.
  const file = new File([ab], 'inventory.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  console.log(`File constructed: ${file.size} bytes\n`);

  console.log('Driving the REAL parseBevagerWorkbook...');
  const rows = await parseBevagerWorkbook(file);
  console.log('Returned rows:', JSON.stringify(rows, null, 2), '\n');

  console.log('Assertions:');
  // Blank-ITEM row (1004) skipped; "n/a" qty row (1003) kept with qty 0.
  // So expected rows: Campari, Grey Goose, Bitters, Aperol = 4.
  eq('row count', rows.length, 4);

  // Row 0: plain string name, integer quantity preserved
  eq('row0.name', rows[0]?.name, 'Campari 750ml');
  eq('row0.cu', rows[0]?.cu, '750ml');
  eq('row0.category', rows[0]?.category, '5320 - Wine Cost');
  eq('row0.quantity', rows[0]?.quantity, 12);
  check('row0.quantity is number', typeof rows[0]?.quantity === 'number', typeof rows[0]?.quantity);

  // Row 1: RICH TEXT name flattened to plain visible string, float qty kept
  eq('row1.name (rich text flattened)', rows[1]?.name, 'Grey Goose Vodka');
  eq('row1.cu', rows[1]?.cu, '1L');
  eq('row1.category', rows[1]?.category, '5310 - Liquor Cost');
  eq('row1.quantity (float preserved)', rows[1]?.quantity, 3.5);

  // Row 2: non-numeric quantity coerced to 0
  eq('row2.name', rows[2]?.name, 'Bitters Dash');
  eq('row2.cu', rows[2]?.cu, 'each');
  eq('row2.quantity (n/a -> 0)', rows[2]?.quantity, 0);

  // Row 3: whitespace-padded name trimmed, qty 0 preserved
  eq('row3.name (trimmed)', rows[3]?.name, 'Aperol 375ml');
  eq('row3.quantity (0 preserved)', rows[3]?.quantity, 0);

  // Sheet selection: ensure the decoy "Summary" sheet was NOT used. If it had
  // been, "DECOY ITEM" / qty 999 would appear.
  check(
    'inventory sheet selected (no DECOY ITEM present)',
    !rows.some(r => r.name === 'DECOY ITEM'),
    rows.map(r => r.name),
  );

  // --- Second scenario: prove the 2nd-sheet fallback when no name matches
  //     /inventory/i, AND that a named match still wins over position. ---
  await sheetSelectionScenarios();

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

/**
 * Extra coverage for the sheet-selection rule:
 *   (a) No sheet matches /inventory/i  -> the 2nd sheet is used.
 *   (b) A sheet named to match /inventory/i wins even if it is NOT the 2nd.
 */
async function sheetSelectionScenarios() {
  console.log('\nSheet-selection scenarios:');

  // (a) Two sheets, neither named with "inventory". Data lives on sheet 2.
  {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet('Cover');
    s1.addRow(['Cover page only']);
    const s2 = wb.addWorksheet('Data'); // not /inventory/i, but it's sheet #2
    s2.addRow(['ID', 'CU', 'ITEM', 'CATEGORY', 'QUANTITY']);
    s2.addRow(['9', '750ml', 'Second-Sheet Wine', '5320 - Wine Cost', 5]);
    const buf = (await wb.xlsx.writeBuffer()) as Buffer;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const file = new File([ab], 'wb.xlsx');
    const rows = await parseBevagerWorkbook(file);
    eq('(a) 2nd-sheet fallback row count', rows.length, 1);
    eq('(a) 2nd-sheet fallback name', rows[0]?.name, 'Second-Sheet Wine');
  }

  // (b) Inventory sheet is sheet #3 (not the 2nd) but named "Inventory".
  //     The /inventory/i rule must win over the positional 2nd-sheet rule.
  {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Cover').addRow(['cover']);
    const decoy = wb.addWorksheet('Notes'); // this is sheet #2 (positional)
    decoy.addRow(['ID', 'CU', 'ITEM', 'CATEGORY', 'QUANTITY']);
    decoy.addRow(['0', 'na', 'WRONG SHEET ITEM', 'x', 1]);
    const inv = wb.addWorksheet('Store Inventory'); // sheet #3, name matches
    inv.addRow(['ID', 'CU', 'ITEM', 'CATEGORY', 'QUANTITY']);
    inv.addRow(['10', '1L', 'Named-Sheet Gin', '5310 - Liquor Cost', 8]);
    const buf = (await wb.xlsx.writeBuffer()) as Buffer;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const file = new File([ab], 'wb.xlsx');
    const rows = await parseBevagerWorkbook(file);
    eq('(b) named-inventory wins, row count', rows.length, 1);
    eq('(b) named-inventory name', rows[0]?.name, 'Named-Sheet Gin');
    check(
      '(b) positional 2nd sheet NOT used',
      !rows.some(r => r.name === 'WRONG SHEET ITEM'),
      rows.map(r => r.name),
    );
  }
}

main().catch(err => {
  console.error('\nUNCAUGHT ERROR while running test:');
  console.error(err);
  process.exit(1);
});
