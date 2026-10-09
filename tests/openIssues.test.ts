/**
 * Guard: a resolved issue stops counting everywhere in the desktop app.
 *
 * Before v0.65 the Summary and Variance "issues" tiles and the Counts
 * "Flagged" filter tested `issue` alone, so issues resolved from the Issues
 * screen (or in bulk, 2026-10-09) kept showing. Behaviour checks on the
 * helper, plus source-text checks that no screen re-tests the bare flag.
 * Run with:  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasIssue, isOpenIssue } from '../src/lib/issues';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}

check('open: flagged, unresolved', isOpenIssue({ issue: 'damaged', issue_resolved: false }));
check('open: flagged, resolved flag missing (pre-0004 row)', isOpenIssue({ issue: 'other' }));
check('open: flagged, resolved null', isOpenIssue({ issue: 'other', issue_resolved: null }));
check('not open: flagged but resolved', !isOpenIssue({ issue: 'other', issue_resolved: true }));
check("not open: issue 'none'", !isOpenIssue({ issue: 'none', issue_resolved: false }));
check('not open: issue null', !isOpenIssue({ issue: null }));
check('not open: issue empty string', !isOpenIssue({ issue: '' }));
check('hasIssue still true for a resolved issue (history kept)', hasIssue({ issue: 'other', issue_resolved: true }));

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const bare = /\.issue\s*&&\s*\w+\.issue\s*!==\s*'none'|filter === 'flagged' && !e\.issue\b|background:\s*entry\.issue\s*\?/;
for (const f of ['src/screens/Summary.tsx', 'src/screens/Variance.tsx', 'src/screens/Counts.tsx']) {
  const s = src(f);
  check(`${f} uses isOpenIssue (import + at least one use)`, s.split('isOpenIssue').length - 1 >= 2);
  check(`${f} has no bare issue-flag test`, !bare.test(s), s.match(bare)?.[0]);
}
check('Issues screen still defaults to open only', /useState<StatusChoice>\('open'\)/.test(src('src/screens/Issues.tsx')));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
