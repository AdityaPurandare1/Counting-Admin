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

// v0.96: the desktop admits whoever has a desktop permission (access.ts isDesktopUser -> permissions.ts usesDesktop)
check('access.ts has the one check, isDesktopUser', /export function isDesktopUser\(u: Who\): boolean \{\s*return usesDesktop\(featuresOf\(u\)\);/.test(access));
const perms = src('src/lib/permissions.ts');
check('a desktop permission is any outside the phone\'s', /usesDesktop = \(features: readonly string\[\]\) => features\.some\(k => FEATURE_KEYS\.has\(k\) && projectOf\(k\) !== 'phone'\)/.test(perms));
check("the counter template is phone-only (counters use the phone)", /counter: \['phone:count'\]/.test(perms));

// No screen may re-declare its own list of desktop roles.
const literal = /\[\s*'(admin|corporate|manager|venue_manager)'\s*,\s*'(admin|corporate|manager|venue_manager)'/;
check('Login.tsx has no hardcoded role list', !literal.test(login));
check('App.tsx has no hardcoded role list', !literal.test(app));
check('Login.tsx gates on isDesktopUser', /isDesktopUser\(resolved\)/.test(login));
check('App.tsx gates on isDesktopUser (password-set + restored session)', (app.match(/isDesktopUser\(/g) ?? []).length >= 2);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
