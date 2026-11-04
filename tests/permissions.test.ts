/**
 * v0.96 per-person permissions (0148): roles are templates, every screen asks can().
 * The promise to the user: "For the people with current accesses donot change anything give them the
 * exact permissions they have". So every old role check is written down here as it was, and each role's
 * template must answer it the same way.  npm test
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES, PROJECTS, ROLE_TEMPLATES, templateFor, usesDesktop, roleLabel } from '../src/lib/permissions';
import { can, featuresOf, isOrgWide, canManageUsers, canRunAudits, canEditCounts, isDesktopUser, type Who } from '../src/lib/access';
import { NAV, navFor, firstRoute } from '../src/lib/routes';
import { accessDraft, toggleRole, setPrimary, toggleFeature, toggleVenue, resetToRoles, allowedIn, accessChanges, accessProblems, noVenues } from '../src/lib/userAccess';
import type { Role } from '../src/lib/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const sibling = (...parts: string[]) => { const p = join(process.cwd(), '..', 'Counting-App', ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

const ROLES: Role[] = ['admin', 'corporate', 'venue_manager', 'manager', 'counter'];
const as = (role: Role): Who => ({ role, features: templateFor([role]) });

// ── the old role checks, exactly as they were (access.ts, FoodCount.tsx, Sidebar.tsx, screens) ──────────
const old = {
  orgWide: (r: Role) => r === 'admin' || r === 'corporate',
  users: (r: Role) => r === 'admin',
  corporate: (r: Role) => r === 'admin' || r === 'corporate',
  runAudits: (r: Role) => r === 'admin' || r === 'corporate' || r === 'venue_manager' || r === 'manager',
  editCounts: (r: Role) => r === 'admin' || r === 'corporate' || r === 'venue_manager',
  food: (r: Role) => r === 'admin' || r === 'corporate' || r === 'manager',
  desktop: (r: Role) => r === 'admin' || r === 'corporate' || r === 'manager' || r === 'venue_manager',
};
// every gate in the app before v0.96 -> the permission that replaced it
const GATES: Array<[string, (r: Role) => boolean, string]> = [
  ['all venues (isOrgWide)', old.orgWide, 'access:all-venues'],
  ['Security / users (canManageUsers)', old.users, 'access:users'],
  ['Overview route (canRunAudits)', old.runAudits, 'audit:overview'],
  ['Counts route, close / finish, drill (canRunAudits)', old.runAudits, 'audit:counts'],
  ['Reports route (canRunAudits)', old.runAudits, 'admin:reports'],
  ['Approvals route + Approve / Reject (canRunAudits)', old.runAudits, 'admin:approvals'],
  ['Transfers route (canRunAudits)', old.runAudits, 'admin:transfers'],
  ['Stock on hand route (canRunAudits)', old.runAudits, 'admin:stock'],
  ['Correct counts (canEditCounts)', old.editCounts, 'audit:edit-counts'],
  ['Food count (canUseFoodCount)', old.food, 'admin:food-count'],
  ['Catalog / Inventory (hasCorporateAccess)', old.corporate, 'admin:catalog'],
  ['Venue settings (hasCorporateAccess)', old.corporate, 'admin:venue-settings'],
  ['Liquor & wine prices (hasCorporateAccess)', old.corporate, 'purchasing:liquor-wine'],
  ['Order tracker (hasCorporateAccess)', old.corporate, 'purchasing:order-tracker'],
  ['Order prices (hasCorporateAccess)', old.corporate, 'purchasing:order-prices'],
  ['Force-approve (hasCorporateAccess)', old.corporate, 'admin:force-approve'],
  ['Cancel / reactivate / delete / sweep audits, dismiss recounts (hasCorporateAccess)', old.corporate, 'audit:manage'],
  ['Delete count lines (hasCorporateAccess)', old.corporate, 'audit:delete-lines'],
  ['Ask AI about orders (isOrgWide)', old.orgWide, 'team:ask-ai-orders'],
  ['Delete any transfer (admin / corporate)', old.corporate, 'admin:transfers-manage'],
  ['Variance / Venues / Item history / Recount / Summary (every desktop role)', old.desktop, 'audit:view'],
  ['Issues tracker (every desktop role)', old.desktop, 'team:issues'],
  ['Ask AI (every desktop role)', old.desktop, 'team:ask-ai'],
];
for (const [name, was, key] of GATES) {
  const diff = ROLES.filter(r => was(r) !== can(as(r), key));
  check(`same as before: ${name} = ${key}`, diff.length === 0, diff);
}
check('same as before: the desktop admits admin, corporate, manager, venue management — not counters',
  ROLES.every(r => old.desktop(r) === isDesktopUser(as(r))));
check('same as before: the named helpers', ROLES.every(r => isOrgWide(as(r)) === old.orgWide(r) && canManageUsers(as(r)) === old.users(r)
  && canRunAudits(as(r)) === old.runAudits(r) && canEditCounts(as(r)) === old.editCounts(r)));
// the server's role gates (0149 swaps them for these keys): kount_catalog_prices C/A/M; approve/reject C/A/M/VM;
// kount_create_transfer refuses counters; kount_role_for_venue: manager / counter / viewer at their venues
check('same as before (database): audit costs = corporate, admin, manager', ROLES.filter(r => can(as(r), 'audit:costs')).join() === 'admin,corporate,manager');
check('same as before (database): phone run = admin, corporate, manager; count adds counter',
  ROLES.filter(r => can(as(r), 'phone:run')).join() === 'admin,corporate,manager' && ROLES.filter(r => can(as(r), 'phone:count')).join() === 'admin,corporate,manager,counter');
check('every key in a template is in the catalog, and the catalog keys are unique',
  Object.values(ROLE_TEMPLATES).flat().every(k => FEATURES.some(f => f.key === k)) && new Set(FEATURES.map(f => f.key)).size === FEATURES.length);
check('keys are project:feature and each sits in its own project', FEATURES.every(f => /^[a-z]+:[a-z0-9-]+$/.test(f.key))
  && PROJECTS.every(p => p.features.every(f => f.key.startsWith(p.key + ':'))));

// the sidebar: the same links per role as before, plus User access for admins
const OLD_SIDEBAR: Record<Role, string[]> = {
  admin: ['/overview', '/venues', '/variance', '/item-history', '/counts', '/recount', '/summary', '/issues', '/ai', '/order-tracker', '/order-prices', '/purchase-prices',
    '/approvals', '/stock', '/food', '/reports', '/transfers', '/catalog', '/venue-settings', '/security'],
  corporate: ['/overview', '/venues', '/variance', '/item-history', '/counts', '/recount', '/summary', '/issues', '/ai', '/order-tracker', '/order-prices', '/purchase-prices',
    '/approvals', '/stock', '/food', '/reports', '/transfers', '/catalog', '/venue-settings'],
  venue_manager: ['/overview', '/venues', '/variance', '/item-history', '/counts', '/recount', '/summary', '/issues', '/ai', '/approvals', '/stock', '/reports', '/transfers'],
  manager: ['/overview', '/venues', '/variance', '/item-history', '/counts', '/recount', '/summary', '/issues', '/ai', '/approvals', '/stock', '/food', '/reports', '/transfers'],
  counter: [],
};
for (const r of ROLES) {
  const now = navFor(as(r)).flatMap(g => g.items.map(i => i.to)).filter(t => t !== '/user-access');
  check(`sidebar for ${roleLabel(r)} is what it was`, JSON.stringify([...now].sort()) === JSON.stringify([...OLD_SIDEBAR[r]].sort()), now);
}
check('User access sits next to Security, for whoever has access:users', NAV.flatMap(g => g.items).filter(i => i.key === 'access:users').map(i => i.to).join() === '/user-access,/security'
  && navFor(as('admin')).some(g => g.items.some(i => i.to === '/user-access')) && !navFor(as('corporate')).some(g => g.items.some(i => i.to === '/user-access')));
check('a person lands on Variance as before; one without it on their first screen',
  firstRoute(as('manager')) === '/variance' && firstRoute({ role: 'manager', features: ['purchasing:order-prices'] }) === '/order-prices');
check('a session saved before v0.96 (no permissions stored) gets its role\'s template',
  JSON.stringify(featuresOf({ role: 'venue_manager' })) === JSON.stringify(templateFor(['venue_manager'])) && can({ role: 'corporate' }, 'admin:catalog'));
check('beyond a role: a manager given the order tracker has it, and nothing else of corporate',
  can({ role: 'manager', features: [...templateFor(['manager']), 'purchasing:order-tracker'] }, 'purchasing:order-tracker') && !can({ role: 'manager', features: templateFor(['manager']) }, 'admin:catalog'));
check('phone permissions alone do not open the desktop', !usesDesktop(['phone:count', 'phone:run']) && usesDesktop(['team:issues']));

// ── the editor ───────────────────────────────────────────────────────────
{
  const row = { email: 'gm@hwoodgroup.com', name: 'GM', role: 'venue_manager' as Role, roles: null, features: null, venue_ids: ['v1'], is_active: true };
  const d0 = accessDraft(row);
  check('editor: a row from before 0148 starts from its role', d0.roles.join() === 'venue_manager' && d0.features.join() === templateFor(['venue_manager']).join());
  const d1 = toggleRole(d0, 'manager');
  check('editor: ticking a role adds its permissions (templates)', d1.roles.join() === 'venue_manager,manager' && d1.features.includes('admin:food-count') && d1.features.includes('audit:edit-counts') && d1.role === 'venue_manager');
  const d2 = toggleRole(setPrimary(d1, 'manager'), 'manager');
  check('editor: unticking a role keeps the permissions; the primary moves to a role left', d2.roles.join() === 'venue_manager' && d2.role === 'venue_manager' && d2.features.includes('admin:food-count'));
  check('editor: the last role cannot be unticked', toggleRole(d0, 'venue_manager') === d0);
  check('editor: reset = exactly their roles', resetToRoles(d2).features.join() === templateFor(['venue_manager']).join());
  check('editor: primary only among their roles', setPrimary(d0, 'admin').role === 'venue_manager');
  const d3 = toggleFeature(toggleFeature(d0, 'purchasing:order-tracker'), 'audit:edit-counts');
  check('editor: features tick on and off, kept in catalog order', d3.features.includes('purchasing:order-tracker') && !d3.features.includes('audit:edit-counts')
    && d3.features.indexOf('purchasing:order-tracker') > d3.features.indexOf('admin:transfers'));
  check('editor: n of m per project', allowedIn(d0.features, 'audit').n === 4 && allowedIn(d0.features, 'audit').m === 7 && allowedIn(d0.features, 'purchasing').n === 0);
  const ch = accessChanges(d0, toggleVenue(d3, 'v2'));
  check('editor: what Save changes, in words', ch.some(c => /allowed: Order tracker/.test(c)) && ch.some(c => /not allowed: Correct counts/.test(c)) && ch.some(c => /venues \+v2/.test(c)) && accessChanges(d0, d0).length === 0, ch);
  check('editor: nobody takes User access away from themselves', accessProblems(accessDraft({ ...row, role: 'admin' }), true).length === 0
    && accessProblems(toggleFeature(accessDraft({ ...row, role: 'admin' }), 'access:users'), true).length === 1 && accessProblems(d0, false).length === 0);
  check('editor: venue-scoped permissions with no venue get a warning; all venues none', noVenues({ ...d0, venueIds: [] }) && !noVenues(d0)
    && !noVenues({ ...accessDraft({ ...row, role: 'corporate' }), venueIds: [] }));
}

// ── wiring ───────────────────────────────────────────────────────────────
{
  const app = src('src/App.tsx'), side = src('src/components/Sidebar.tsx'), ua = src('src/screens/UserAccess.tsx'), mgmt = src('src/lib/adminUserMgmt.ts');
  const routes = [...app.matchAll(/<Route path="([^"]+)"\s+element=\{gate\('([a-z]+:[a-z0-9-]+)'/g)].map(m => [m[1], m[2]]);
  const navKeys = new Map(NAV.flatMap(g => g.items).map(i => [i.to, i.key]));
  check('every screen\'s route checks the same permission as its sidebar link', routes.length >= 21 && routes.every(([to, key]) => !navKeys.has(to) || navKeys.get(to) === key), routes);
  check('no screen asks a role any more', !/hasCorporateAccess|isDesktopRole|\.role === 'admin'|\.role === 'corporate'/.test(
    ['src/App.tsx', 'src/screens/Approvals.tsx', 'src/screens/Summary.tsx', 'src/screens/Variance.tsx', 'src/screens/Recount.tsx', 'src/screens/Transfers.tsx', 'src/screens/AskAI.tsx', 'src/components/Sidebar.tsx'].map(src).join('\n')));
  check('the sidebar draws navFor(user)', /navFor\(user\)\.map/.test(side));
  check('User access saves roles, permissions and venues together through admin-user-mgmt', /adminUserMgmt\.setAccess\(\{ email: row\.email, role: draft\.role, roles: draft\.roles, features: draft\.features/.test(ua)
    && /action: 'set_access'/.test(mgmt));
  const mig = sibling('supabase', 'migrations', '0148_kount_user_permissions.sql');
  if (mig) {
    const feats = [...mig.matchAll(/^\s+\('([a-z]+:[a-z0-9-]+)', '([a-z]+)', '[^']*', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+)\)/gm)].map(m => m[1]);
    const tpl = [...mig.matchAll(/^\s+\('(admin|corporate|manager|counter|venue_manager)', '([a-z]+:[a-z0-9-]+)'\)/gm)].map(m => `${m[1]}>${m[2]}`).sort();
    const want = Object.entries(ROLE_TEMPLATES).flatMap(([r, ks]) => ks.map(k => `${r}>${k}`)).sort();
    check('0148 seeds the same catalog as permissions.ts', feats.join() === FEATURES.map(f => f.key).join(), feats);
    check('0148 seeds the same role templates as permissions.ts', tpl.join() === want.join());
  }
  // the phone (counting-app.html v2.32) keeps its own copy of the templates for the keys it reads
  const phone = sibling('counting-app.html');
  if (phone) {
    const m = phone.match(/var PHONE_ROLE_TEMPLATES = \{([\s\S]*?)\n\};/);
    const tpl = m ? Object.fromEntries([...m[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map(r => [r[1], [...r[2].matchAll(/'([a-z]+:[a-z0-9-]+)'/g)].map(k => k[1]).sort()])) : {};
    const keys = new Set(Object.values(tpl).flat());
    const diff = ROLES.filter(r => JSON.stringify(tpl[r] ?? null) !== JSON.stringify(templateFor([r]).filter(k => keys.has(k)).sort()));
    check('the phone\'s role templates match permissions.ts for every key it reads', !!m && keys.size >= 7 && diff.length === 0, { diff, tpl });
    check('the phone asks permissions, not roles', /function userCan\(key\)/.test(phone) && !/role === 'corporate'|role === 'venue_manager'|role !== 'corporate'/.test(phone));
  }
  const fn = sibling('supabase', 'functions', 'admin-user-mgmt', 'index.ts');
  if (fn) check('admin-user-mgmt: set_access, for whoever has access:users', /case 'set_access':/.test(fn) && /'access:users'/.test(fn));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
