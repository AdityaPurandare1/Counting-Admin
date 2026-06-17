/**
 * Regression test for the C2 number-aware CSV formula-injection guard in
 * src/lib/csv.ts (csvCell).
 *
 * Background: csvCell prefixes a single quote (') to cells that begin with a
 * formula-trigger character (= + - @ TAB CR) so Excel/Sheets treat them as
 * text instead of executing them. The C2 fix added a NUMBER EXCEPTION: a bare
 * numeric value (including negatives like "-98.82") must NOT be escaped, or it
 * lands in the sheet as TEXT and breaks SUM/sort. This test pins both halves:
 *   - real numbers pass through unescaped,
 *   - genuine injection vectors are still escaped,
 *   - plain text is untouched,
 *   - and RFC-4180 quote-wrapping still kicks in for commas/quotes/newlines.
 *
 * Run with:  npm test   (which now runs this AND bevagerImport.parse.test.ts)
 *
 * No test framework is configured in this repo, so this is a plain tsx script
 * that throws/exits non-zero on the first failed assertion and prints a summary.
 */
import { csvCell } from '../src/lib/csv.ts';

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

// True when csvCell decided to neutralize the cell as a formula, i.e. it added
// the leading single-quote sentinel. (Quote-wrapping for commas/quotes is a
// separate concern handled below; the injection sentinel is the FIRST char.)
function isEscaped(out: string): boolean {
  return out.length > 0 && out[0] === "'";
}

function main() {
  console.log('Driving the REAL csvCell...');

  // --- Number exception: must pass through UNescaped (no leading quote). ---
  // These would each START with a trigger char ("-") or be ambiguous, but are
  // real numbers, so the guard must leave them alone.
  console.log('\nNumbers pass through unescaped:');
  for (const n of ['-98.82', '-5', '0', '42', '3.14']) {
    const out = csvCell(n);
    eq(`csvCell(${JSON.stringify(n)})`, out, n);
    check(`  ${JSON.stringify(n)} not escaped`, !isEscaped(out), out);
  }
  // A real numeric (not string) input should behave the same way.
  eq('csvCell(-98.82) [number input]', csvCell(-98.82), '-98.82');
  eq('csvCell(0) [number input]', csvCell(0), '0');

  // --- Injection vectors: must STILL be escaped (leading single quote). ---
  console.log('\nInjection vectors still escaped:');
  const vectors: Array<[string, string]> = [
    ['=1+2', '=1+2'],
    ['+1', '+1'],
    ['@SUM(A1)', '@SUM(A1)'],
    // Classic DDE/command vector that opens with "-" but is NOT numeric.
    ["-1+cmd|'/c calc'!A1", "-1+cmd|'/c calc'!A1"],
    ['-rogue', '-rogue'],
    ['\tleading-tab', '\tleading-tab'],
    ['=cmd', '=cmd'],
  ];
  for (const [input, body] of vectors) {
    const out = csvCell(input);
    check(`csvCell(${JSON.stringify(input)}) is escaped (leading ')`, isEscaped(out), out);
    // The escaped output is the sentinel + original text, possibly further
    // quote-wrapped if the body itself contains a comma/quote/newline. None of
    // these bodies do, so a plain "'" + body is the exact expected output.
    eq(`  csvCell(${JSON.stringify(input)})`, out, "'" + body);
  }

  // --- Plain text: untouched (no sentinel, no wrapping). ---
  console.log('\nPlain text passes through:');
  eq('csvCell("Grey Goose 1L")', csvCell('Grey Goose 1L'), 'Grey Goose 1L');
  check('  "Grey Goose 1L" not escaped', !isEscaped(csvCell('Grey Goose 1L')), csvCell('Grey Goose 1L'));
  eq('csvCell("")', csvCell(''), '');
  check('  "" not escaped', !isEscaped(csvCell('')), csvCell(''));
  eq('csvCell(null)', csvCell(null), '');
  eq('csvCell(undefined)', csvCell(undefined), '');

  // --- RFC-4180 quote-wrapping still applies (orthogonal to the guard). ---
  console.log('\nQuote-wrapping for commas/quotes/newlines:');
  // A comma forces wrapping; not a formula → no sentinel.
  eq('csvCell("Tito\'s, Vodka")', csvCell("Tito's, Vodka"), '"Tito\'s, Vodka"');
  // Embedded double-quote is doubled and wrapped.
  eq('csvCell(\'say "hi"\')', csvCell('say "hi"'), '"say ""hi"""');
  // An injection vector that ALSO contains a comma: sentinel FIRST, then the
  // whole thing wrapped because of the comma. Proves the two layers compose.
  {
    const out = csvCell('=1,2');
    check('csvCell("=1,2") is escaped', isEscaped(out.replace(/^"/, '')) || out.indexOf("'") !== -1, out);
    eq('csvCell("=1,2")', out, '"\'=1,2"');
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
