/**
 * foodMatch — the typed food count's pure helpers.
 *
 * foodKey must give the SAME key as the database's kount_food_key (migration
 * 0155): the cases below are that migration's own verification select. Unit
 * labels use the unit spellings on Little Luck's real food list.
 *
 * Run with:  npm test
 */
import { foodKey, parseQty, rankMatches, searchStem, unitLabel, worthRemembering } from '../src/lib/foodMatch.ts';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log('        ', detail); }
}

console.log('foodKey = SQL kount_food_key (0155 verification cases)');
check('word order and commas do not matter', foodKey('Butter, Unsalted') === foodKey('Unsalted Butter'), [foodKey('Butter, Unsalted'), foodKey('Unsalted Butter')]);
check('percent goes: Heavy Cream 40%', foodKey('Heavy Cream 40%') === 'cream heavy', foodKey('Heavy Cream 40%'));
check('size + note go: Wagyu Ground Beef, 5lb CVP (Margaret River)', foodKey('Wagyu Ground Beef, 5lb CVP (Margaret River)') === 'beef cvp ground wagyu', foodKey('Wagyu Ground Beef, 5lb CVP (Margaret River)'));
check('pack count goes: Avocado, Hass 20/24', foodKey('Avocado, Hass 20/24') === 'avocado hass', foodKey('Avocado, Hass 20/24'));
check('plural: Eggs, Large', foodKey('Eggs, Large') === 'egg large', foodKey('Eggs, Large'));
check('& and -oes plurals: Tomatoes & Potatoes', foodKey('Tomatoes & Potatoes') === 'potato tomato', foodKey('Tomatoes & Potatoes'));
check('size inside the name: Butter Unsalted 1 lb', foodKey('Butter Unsalted 1 lb') === foodKey('Unsalted Butter'));
check('accents: Crème Fraîche = creme fraiche', foodKey('Crème Fraîche') === foodKey('creme fraiche'), foodKey('Crème Fraîche'));
check('-ies plural: Cherries -> cherry', foodKey('Cherries') === 'cherry');
check('-ss / -us words kept: Asparagus, Watercress', foodKey('Asparagus') === 'asparagus' && foodKey('Watercress') === 'watercress');
check('empty / null', foodKey('') === '' && foodKey(null) === '');
check('accents outside the SQL list are separators, as in SQL: Koshō -> kosh', foodKey('Yuzu Koshō') === 'kosh yuzu', foodKey('Yuzu Koshō'));
check('½ is a separator, as in SQL: Butter ½ lb -> butter lb', foodKey('Butter ½ lb') === 'butter lb', foodKey('Butter ½ lb'));

console.log('unitLabel (Little Luck spellings)');
const u = (s: string, p?: number | null) => unitLabel(s, p).text;
check('cs (4/1 gal) -> Case · 4 × 1 gal', u('cs (4/1 gal)') === 'Case · 4 × 1 gal', u('cs (4/1 gal)'));
check('cs (24/3.5 oz) -> Case · 24 × 3.5 oz', u('cs (24/3.5 oz)') === 'Case · 24 × 3.5 oz', u('cs (24/3.5 oz)'));
check('bag (25 lb) -> Bag · 25 lb', u('bag (25 lb)') === 'Bag · 25 lb', u('bag (25 lb)'));
check('pk (50 ct) -> Pack · 50 ct', u('pk (50 ct)') === 'Pack · 50 ct', u('pk (50 ct)'));
check('ty (250 g) -> Tray · 250 g', u('ty (250 g)') === 'Tray · 250 g', u('ty (250 g)'));
check('pl (4/5 lb) -> Pail · 4 × 5 lb', u('pl (4/5 lb)') === 'Pail · 4 × 5 lb', u('pl (4/5 lb)'));
check('ea / each -> Each', u('ea') === 'Each' && u('each') === 'Each');
check('lb stays lb', u('lb') === 'lb');
check('5 lb is read as written', u('5 lb') === '5 lb', u('5 lb'));
check('plain cs with a pack size -> Case · 12 per case', u('cs', 12) === 'Case · 12 per case', u('cs', 12));
check('plain cs without a pack size -> Case', u('cs') === 'Case');
check('blank -> Unit', u('') === 'Unit');
check('unit and detail are split for the screen', unitLabel('cs (12/12 oz)').unit === 'Case' && unitLabel('cs (12/12 oz)').detail === '12 × 12 oz');

console.log('rankMatches');
const cands = [
  { id: '1', name: 'Butter, Unsalted' }, { id: '2', name: 'Butter, Salted' }, { id: '3', name: 'Peanut Butter' },
  { id: '4', name: 'Avocado, Hass 20/24' }, { id: '5', name: 'Wagyu Ground Beef, 5lb CVP' },
];
const r = rankMatches('unsalted butter', cands);
check('same item first, marked sameKey', r[0]?.item.id === '1' && r[0].sameKey, r.map(x => [x.item.name, x.score]));
check('other butters follow, unrelated items dropped', r.every(x => x.item.name.toLowerCase().includes('butter')) && r.length === 3, r.map(x => x.item.name));
check('"avocados" finds Avocado, Hass', rankMatches('avocados', cands)[0]?.item.id === '4');
check('"ground wagyu" finds the wagyu', rankMatches('ground wagyu', cands)[0]?.item.id === '5');
check('nothing typed -> no suggestions', rankMatches('  ', cands).length === 0);

console.log('parseQty');
check('blank = not counted (null)', parseQty('') === null && parseQty('  ') === null);
check('0 is a real count', parseQty('0') === 0);
check('decimals with a dot', parseQty('1.5') === 1.5 && parseQty('.5') === 0.5 && parseQty('2.') === 2);
check('a comma is refused, never guessed (1,250 is not 1.25)', Number.isNaN(parseQty('1,250') as number) && Number.isNaN(parseQty('1,5') as number));
check('junk is NaN, never 0', Number.isNaN(parseQty('abc') as number) && Number.isNaN(parseQty('1-2') as number) && Number.isNaN(parseQty('-1') as number));

console.log('worthRemembering / searchStem');
check('a partial search is not remembered: olive oil -> Olive Oil, Extra Virgin', !worthRemembering('olive oil', 'Olive Oil, Extra Virgin'));
check('one word is not remembered: oil -> Olive Oil', !worthRemembering('oil', 'Olive Oil'));
check('the same item spelled differently is not remembered (same key)', !worthRemembering('unsalted butter', 'Butter, Unsalted'));
check('a real other name is remembered: ap flour -> Flour, All Purpose', worthRemembering('ap flour', 'Flour, All Purpose'));
check('cherries searches cherr (finds Cherry and Cherries)', searchStem('cherries') === 'cherr');
check('avocados searches avocado', searchStem('avocados') === 'avocado');
check('short words keep their ending: gas', searchStem('gas') === 'gas');

console.log(`\nfoodMatch: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
