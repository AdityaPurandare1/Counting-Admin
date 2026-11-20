/**
 * v1.32 — adding a missing item to the venue's food list during a count (migration 0207).
 * Source checks on FoodEntry: the add goes to the list at once through kount_food_list_add, a wrong add can be
 * undone through kount_food_list_remove, both errors are read, and the catalog search no longer drops
 * non-food items.
 *
 * Run with:  npm test
 */
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log('        ', detail); }
}
const src = readFileSync(new URL('../src/components/FoodEntry.tsx', import.meta.url), 'utf8');
const version = readFileSync(new URL('../src/lib/version.ts', import.meta.url), 'utf8');

console.log('food list add (v1.32)');
check('adds through kount_food_list_add', src.includes("supabase.rpc('kount_food_list_add'"));
check('the add reads its error', /const \{ data, error \} = await supabase\.rpc\('kount_food_list_add'[\s\S]{0,400}if \(error\) \{ setErr\(error\.message\)/.test(src));
check('undo through kount_food_list_remove, error read', /supabase\.rpc\('kount_food_list_remove'[\s\S]{0,200}if \(rmErr\)/.test(src));
check('sends the picked item, or the name for a new one', src.includes('p_master_item_id: pick.masterId, p_name: pick.masterId ? null : pick.name'));
check('the search keeps non-food items (food first)', src.includes('...all.filter(h => !FOOD_CATEGORY_RE.test'));
check('the add box sits above the sections', src.indexOf('<AddItem ') > 0 && src.indexOf('<AddItem ') < src.indexOf('{FOOD_SHEETS.map(s => {'));
check('every section offers "+ add item"', src.includes('openAdd(s.key)') && src.includes('+ add item'));
check('the new item is focused for its count', src.includes('setFocusKey(masterId)') && src.includes('el.focus()'));
check('no on-screen-only extras are created any more', !src.includes('setExtras(es => [...es,'));
check('version 1.32 or later', Number((/APP_VERSION = '([0-9.]+)'/.exec(version) ?? [])[1]) >= 1.32);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
