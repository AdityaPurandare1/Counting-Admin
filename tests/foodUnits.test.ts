/**
 * foodUnits — changing how a food item is counted (v1.31 / migration 0205).
 * Unit labels are the spellings on Little Luck's real food list.
 *
 * Run with:  npm test
 */
import { composeUnit, measureOf, parseFactor, suggestFactor } from '../src/lib/foodUnits.ts';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log('        ', detail); }
}
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.0002;

console.log('measureOf');
check('lb = 453.592 g', near(measureOf('lb')?.grams ?? null, 453.592), measureOf('lb'));
check('cs (30/1 lb) = 30 lb and 30 pieces', near(measureOf('cs (30/1 lb)')?.grams ?? null, 30 * 453.592) && measureOf('cs (30/1 lb)')?.pieces === 30, measureOf('cs (30/1 lb)'));
check('ea (5 lb) = one piece of 5 lb', near(measureOf('ea (5 lb)')?.grams ?? null, 5 * 453.592) && measureOf('ea (5 lb)')?.pieces === 1, measureOf('ea (5 lb)'));
check('pk (50 ct) = 50 pieces', measureOf('pk (50 ct)')?.pieces === 50, measureOf('pk (50 ct)'));
check('cs (4/1 gal) = 4 gal', near(measureOf('cs (4/1 gal)')?.ml ?? null, 4 * 3785.41), measureOf('cs (4/1 gal)'));
check('cs with 6 per case, no size = 6 pieces', measureOf('cs', 6)?.pieces === 6, measureOf('cs', 6));
check('cs (48/1 ea) = 48 pieces', measureOf('cs (48/1 ea)')?.pieces === 48, measureOf('cs (48/1 ea)'));
check('fl oz is volume', near(measureOf('btl (25.4 fl oz)')?.ml ?? null, 25.4 * 29.5735), measureOf('btl (25.4 fl oz)'));
check('dz = 12 pieces', measureOf('dz')?.pieces === 12, measureOf('dz'));
check('"5 lb" written plain', near(measureOf('5 lb')?.grams ?? null, 5 * 453.592), measureOf('5 lb'));
check('unknown word with no size says nothing', measureOf('tub') === null && measureOf('carton') === null && measureOf('') === null);

console.log('suggestFactor (how many NEW make one OLD)');
check('cs (30/1 lb) -> lb = 30', suggestFactor('cs (30/1 lb)', null, 'lb', null) === 30, suggestFactor('cs (30/1 lb)', null, 'lb', null));
check('cs (30/1 lb) -> ea = 30 (pieces)', suggestFactor('cs (30/1 lb)', null, 'ea', null) === 30, suggestFactor('cs (30/1 lb)', null, 'ea', null));
check('ea (5 lb) -> lb = 5', suggestFactor('ea (5 lb)', null, 'lb', null) === 5);
check('lb -> oz = 16', suggestFactor('lb', null, 'oz', null) === 16, suggestFactor('lb', null, 'oz', null));
check('kg -> lb = 2.2046', suggestFactor('kg', null, 'lb', null) === 2.2046, suggestFactor('kg', null, 'lb', null));
check('lb -> bag (25 lb) = 0.04', suggestFactor('lb', null, 'bag (25 lb)', null) === 0.04, suggestFactor('lb', null, 'bag (25 lb)', null));
check('ea -> cs (6/1 lb) = 1/6 (pieces)', suggestFactor('ea', null, 'cs (6/1 lb)', null) === 0.1667, suggestFactor('ea', null, 'cs (6/1 lb)', null));
check('cs (6 per case) -> ea = 6', suggestFactor('cs', 6, 'ea', null) === 6);
check('cs (4/1 gal) -> qt = 16', suggestFactor('cs (4/1 gal)', null, 'qt', null) === 16, suggestFactor('cs (4/1 gal)', null, 'qt', null));
check('lb -> ea: no common measure, typed', suggestFactor('lb', null, 'ea', null) === null);
check('tub -> lb: old says nothing, typed', suggestFactor('tub', null, 'lb', null) === null);

console.log('composeUnit / parseFactor');
check('lb', composeUnit('lb') === 'lb');
check('ea + 5 lb -> ea (5 lb)', composeUnit('ea', '5 lb') === 'ea (5 lb)');
check('brackets typed are not doubled', composeUnit('cs', '(30/1 lb)') === 'cs (30/1 lb)', composeUnit('cs', '(30/1 lb)'));
check('case and spaces tidied', composeUnit(' Bag ', '25  LB') === 'bag (25 lb)', composeUnit(' Bag ', '25  LB'));
check('30', parseFactor('30') === 30);
check('0.5 and ,5', parseFactor('0.5') === 0.5 && parseFactor('0,5') === 0.5);
check('1/6', Math.abs(parseFactor('1/6') - 1 / 6) < 1e-9);
check('0, blank, words, negative are not numbers', [parseFactor('0'), parseFactor(''), parseFactor('abc'), parseFactor('-2')].every(Number.isNaN));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
