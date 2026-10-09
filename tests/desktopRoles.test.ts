/**
 * Guard: the desktop admits every role it is supposed to, from ONE list.
 *
 * Background. v0.58 added the 'admin' tier (above corporate) and App.tsx's
 * DESKTOP_ROLES got it, but Login.tsx kept its own hardcoded
 * ['corporate', 'manager', 'venue_manager'] from v0.43. A fresh password
 * login therefore signed every admin straight back out ("This app is for
 * admins, managers, and venue management") while a restored session still
 * worked — so it surfaced only when an admin's session expired (2026-10-09).
 *
 * Source-text checks, like rpcErrors.test.ts, so no React / Supabase client
 * is loaded.  Run with:  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const access = src('src/lib/access.ts');
const login = src('src/screens/Login.tsx');
const app = src('src/App.tsx');

const m = access.match(/export const DESKTOP_ROLES[^=]*=\s*\[([^\]]*)\]/);
const roles = m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
check('access.ts exports DESKTOP_ROLES', roles.length > 0);
for (const r of ['admin', 'corporate', 'manager', 'venue_manager']) {
  check(`DESKTOP_ROLES includes '${r}'`, roles.includes(r), roles);
}
check("DESKTOP_ROLES excludes 'counter' (counters use the phone)", !roles.includes('counter'), roles);

// No screen may re-declare its own list of desktop roles.
const literal = /\[\s*'(admin|corporate|manager|venue_manager)'\s*,\s*'(admin|corporate|manager|venue_manager)'/;
check('Login.tsx has no hardcoded role list', !literal.test(login));
check('App.tsx has no hardcoded role list', !literal.test(app));
check('Login.tsx gates on isDesktopRole', /isDesktopRole\(resolved\.role\)/.test(login));
check('App.tsx gates on isDesktopRole (password-set + restored session)', (app.match(/isDesktopRole\(/g) ?? []).length >= 2);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
