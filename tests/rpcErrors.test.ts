/**
 * Guard: no supabase.rpc() call may discard its error.
 *
 * Background. The Complete-audit handler in Variance.tsx wrapped the
 * compute_avt_for_audit call in `try { await supabase.rpc(...) } catch`.
 * supabase.rpc RESOLVES with { data, error } — it does not throw — so that
 * catch could never fire and the error was never read. A failed variance
 * computation was therefore indistinguishable from a successful one.
 *
 * It was not theoretical. Alphabet completed two audits that way and had no
 * variance at all until someone went looking; Delilah LA's four went unnoticed
 * from April. Nothing was logged, because nothing was checked.
 *
 * Asserted against source text rather than by importing the screens: pulling
 * them in drags React, the router and a live Supabase client into a repo with
 * no test framework, which is the same reason this went untested originally.
 *
 * Run with:  npm test
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log('        ', detail);
  }
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

console.log('supabase.rpc error handling');

const files = sourceFiles('src');
const offenders: string[] = [];

for (const f of files) {
  const src = readFileSync(f, 'utf-8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (!line.includes('supabase.rpc(')) return;
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    // Acceptable: the result is destructured, or assigned for inspection.
    const destructured = /(const|let)\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await\s+supabase\.rpc\(/.test(line);
    const captured = /(const|let)\s+\w+\s*=\s*await\s+supabase\.rpc\(/.test(line);
    if (!destructured && !captured) {
      offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 96)}`);
    }
  });
}

check(
  'every supabase.rpc() result is captured so its error can be read',
  offenders.length === 0,
  offenders.length ? offenders : undefined,
);

// The specific call that regressed, pinned by name.
const variance = readFileSync(join('src', 'screens', 'Variance.tsx'), 'utf-8');
const computeCall = variance
  .split('\n')
  .find((l) => l.includes("supabase.rpc('compute_avt_for_audit'") && !l.trim().startsWith('//'));

check('the Complete handler still calls compute_avt_for_audit', !!computeCall, computeCall);
check(
  'and reads its error rather than relying on a throw that never comes',
  !!computeCall && /\berror\b/.test(computeCall),
  computeCall,
);
check(
  'the dead try/catch around it is gone',
  !/try\s*\{\s*await supabase\.rpc\('compute_avt_for_audit'/.test(variance),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
