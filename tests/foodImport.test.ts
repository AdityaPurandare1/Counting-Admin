/**
 * foodImport — template builder + workbook reader for food counts.
 *
 * Covers the pure helpers directly, then a real round trip through exceljs:
 * build the downloadable template, read it back with parseFoodWorkbook, and
 * check nothing is lost or invented. If Little Luck's actual workbook is on
 * this machine it is read too (skipped in CI, where it does not exist).
 *
 * Run with:  npm test
 */
import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import {
  FOOD_SHEETS, TOTAL_SHEET, cellValue, toNumber, toText, rowsFromGrid,
  sheetForCategory, parseFoodWorkbook, buildFoodTemplate,
  type TemplateItem,
} from '../src/lib/foodImport.ts';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log('        ', detail); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('cell helpers');
check('formula cell unwraps to its result', cellValue({ formula: 'D3*E3', result: 42 }) === 42);
check('rich text joins its runs', cellValue({ richText: [{ text: 'Short ' }, { text: 'Rib' }] }) === 'Short Rib');
check('hyperlink cell reads its text', cellValue({ text: 'Maggi', hyperlink: 'x' }) === 'Maggi');
check('error cell reads as empty', cellValue({ error: '#REF!' }) === null);
check('toText collapses whitespace', toText('  Wagyu,   Dry-Aged  ') === 'Wagyu, Dry-Aged');
check('toNumber: currency string', toNumber('$5.91') === 5.91);
check('toNumber: thousands separator', toNumber('1,234.50') === 1234.5);
check('toNumber: a real 0 stays 0 (counted none)', toNumber(0) === 0);
check('toNumber: blank is null, not 0', toNumber('') === null && toNumber(null) === null);
check('toNumber: dash is null', toNumber('-') === null);
check('toNumber: formula result', toNumber({ formula: 'x', result: 12 }) === 12);
check('toNumber: boolean is null', toNumber(true) === null);
check('toNumber: junk is null', toNumber('n/a') === null);

console.log('rowsFromGrid');
// Little Luck's ORIGINAL 5-column sheet: title, header, items, TOTAL.
const legacy = [
  ['Meat & Seafood', null, null, null, null],
  ['Item', 'Unit', 'Quantity', 'Price', 'Total'],
  ['A5 Wagyu Rib Cap', 'lb', null, null, null],
  ['Short Rib, Bone-In, Choice Angus, 10#', 'lb', 4, 9.87, { formula: 'C4*D4', result: 39.48 }],
  ['TOTAL', null, null, null, { formula: 'SUM(E3:E4)', result: 39.48 }],
];
const L = rowsFromGrid('Meat_&_Seafood', legacy, 0);
check('legacy sheet: header found', L.hasTable);
check('legacy sheet: TOTAL row is not an item', L.rows.length === 2, L.rows);
check('legacy sheet: values mapped',
  eq(L.rows[1], { item: 'Short Rib, Bone-In, Choice Angus, 10#', unit: 'lb', pack: null, qty: 4, price: 9.87, sheet: 'Meat_&_Seafood', sort: 2 }),
  L.rows[1]);
check('legacy sheet: uncounted row keeps qty null', L.rows[0].qty === null);

// The new 6-column template with Pack size.
const tmpl = [
  ['Grocery'],
  ['Item', 'Unit', 'Pack size', 'Quantity', 'Price', 'Total'],
  ['Soy Sauce, Kikkoman', 'cs', 6, 2, 39.92, null],
];
const T = rowsFromGrid('Grocery', tmpl, 10);
check('template sheet: pack size read', T.rows[0].pack === 6 && T.rows[0].qty === 2);
check('template sheet: sort continues from the previous sheet', T.rows[0].sort === 11);
check('unit is normalised to lower case', rowsFromGrid('G', [['Item', 'Unit'], ['X', 'CS']], 0).rows[0].unit === 'cs');

// The wine sheet's headers: COUNT and BTL ($).
const aliases = rowsFromGrid('S', [['Item', 'BTL ($)', 'COUNT'], ['Prosecco', '1.08', 3]], 0);
check('aliases: BTL ($) -> price, COUNT -> quantity',
  aliases.rows[0].price === 1.08 && aliases.rows[0].qty === 3, aliases.rows[0]);

// A heading typed inside the table must not become a catalog item.
const head = rowsFromGrid('Produce', [['Item', 'Unit', 'Quantity'], ['HERBS', null, null], ['Cilantro', 'cs', 1]], 0);
check('section heading is skipped, not sent', head.rows.length === 1 && head.rows[0].item === 'Cilantro');
check('section heading is reported', eq(head.skipped, [{ sheet: 'Produce', item: 'HERBS' }]));

check('sheet with no item table yields nothing',
  rowsFromGrid(TOTAL_SHEET, [['Category', 'Total Cost'], ['Meat & Seafood', 100]], 0).hasTable === false);

check('sheetForCategory', sheetForCategory('Meat Cost') === 'Meat_&_Seafood'
  && sheetForCategory('Seafood Cost') === 'Meat_&_Seafood'
  && sheetForCategory('Dairy Cost') === 'Dairy_&_eggs'
  && sheetForCategory('Produce Cost') === 'Produce'
  && sheetForCategory('frozen') === 'Frozen'
  && sheetForCategory('Grocery and Dry Goods Cost') === 'Grocery'
  && sheetForCategory(null) === 'Grocery');

async function main() {
  console.log('template round trip (real exceljs)');
  const items: TemplateItem[] = [
    { name: 'Wagyu Ground Beef, 5lb CVP', unit: 'lb', pack: null, price: 5.91, sheet: 'Meat_&_Seafood', sort: 1 },
    { name: 'Butter, Unsalted', unit: 'cs', pack: 36, price: 98.5, sheet: 'Dairy_&_eggs', sort: 2 },
    { name: 'Cilantro', unit: 'cs', pack: null, price: null, sheet: null, category: 'Produce Cost', sort: 3 },
  ];
  const buf = await buildFoodTemplate(items, 'Little Luck');
  const parsed = await parseFoodWorkbook(buf);
  check('round trip: every food sheet is present and read',
    eq(parsed.sheets, FOOD_SHEETS.map((f) => f.key)), parsed.sheets);
  check('round trip: the roll-up sheet is ignored', !parsed.sheets.includes(TOTAL_SHEET));
  check('round trip: no items invented or lost', parsed.rows.length === 3, parsed.rows);
  const byName = new Map(parsed.rows.map((r) => [r.item, r]));
  const butter = byName.get('Butter, Unsalted');
  check('round trip: unit, pack and price survive',
    !!butter && butter.unit === 'cs' && butter.pack === 36 && butter.price === 98.5, butter);
  check('round trip: quantities start blank', parsed.rows.every((r) => r.qty === null));
  check('round trip: an item with no sheet lands on its category sheet',
    byName.get('Cilantro')?.sheet === 'Produce');
  check('round trip: nothing reported as a heading', parsed.skipped.length === 0, parsed.skipped);

  // A counter fills it in: quantities typed next to formula Total cells.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const dairy = wb.getWorksheet('Dairy_&_eggs');
  if (!dairy) throw new Error('Dairy_&_eggs sheet missing from template');
  dairy.getCell('D3').value = 2.5;
  const filled = await parseFoodWorkbook((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
  const b2 = filled.rows.find((r) => r.item === 'Butter, Unsalted');
  check('filled template: a partial quantity is read', b2?.qty === 2.5, b2);
  check('filled template: others stay uncounted', filled.rows.filter((r) => r.qty !== null).length === 1);

  // The case-counted item missing its pack size is shaded for attention.
  const cil = new ExcelJS.Workbook();
  await cil.xlsx.load(buf as ArrayBuffer);
  const produce = cil.getWorksheet('Produce');
  const fill = produce?.getCell('C3').fill as { fgColor?: { argb?: string } } | undefined;
  check('missing pack size on a cs item is highlighted', fill?.fgColor?.argb === 'FFFFF2B3', fill);

  console.log('blank template (venue has no food list yet)');
  const blank = await parseFoodWorkbook(await buildFoodTemplate([], 'New Venue'));
  check('blank template parses to zero rows', blank.rows.length === 0 && blank.skipped.length === 0, blank);
  check('blank template still has all five sheets', blank.sheets.length === FOOD_SHEETS.length);

  const real = 'C:/Users/AdityaPurandare/Downloads/LITTLE LUCK FOOD INVENTORY - Priced.xlsx';
  if (existsSync(real)) {
    console.log('Little Luck\'s real workbook');
    const ll = await parseFoodWorkbook(new Uint8Array(readFileSync(real)));
    check('real workbook: 191 items (5 TOTAL rows dropped from 196)', ll.rows.length === 191, ll.rows.length);
    check('real workbook: 153 priced', ll.rows.filter((r) => r.price !== null).length === 153);
    check('real workbook: no quantities, so it would set up the list, not record a count',
      ll.rows.every((r) => r.qty === null));
  } else {
    console.log('  SKIP  Little Luck\'s real workbook (not on this machine)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
