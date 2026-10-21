/**
 * Tests for src/lib/visibleVenues.ts — which venues a signed-in user can see.
 *
 * Regression context: screens used to snapshot the venue list once at mount. The
 * list is refreshed in place after sign-in, and the built-in baseline stops at v10,
 * so a manager of a newer venue (v11+) saw no venues until they left the screen and
 * came back. The rule itself must give the right answer for whatever list it is
 * handed, and must never hand back the shared list (callers must not be able to
 * mutate it).
 *
 * Plain tsx script, same style as the other tests here. Run with: npm test
 */
import { visibleVenuesFor, VENUES_REFRESHED_EVENT, type VenueRef } from '../src/lib/visibleVenues.ts';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}`); if (detail !== undefined) console.error('        got:', JSON.stringify(detail)); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(`${label} === ${JSON.stringify(expected)}`, JSON.stringify(actual) === JSON.stringify(expected), actual);
}
const ids = (vs: VenueRef[]) => vs.map(v => v.id);

const baseline: VenueRef[] = [
  { id: 'v1', name: 'Delilah LA' }, { id: 'v5', name: 'Poppy' }, { id: 'v10', name: '40 Love' },
];
const live: VenueRef[] = [...baseline, { id: 'v12', name: 'Alphabet' }, { id: 'v14', name: 'Lady Delilah' }];

console.log('\nvisibleVenuesFor');
eq('org-wide role sees every venue', ids(visibleVenuesFor({ role: 'admin', venueIds: 'all' }, live, true)), ['v1', 'v5', 'v10', 'v12', 'v14']);
eq('venueIds "all" sees every venue even if the role is not org-wide', ids(visibleVenuesFor({ role: 'manager', venueIds: 'all' }, live, false)), ['v1', 'v5', 'v10', 'v12', 'v14']);
eq('manager sees only their own venue', ids(visibleVenuesFor({ role: 'manager', venueIds: ['v14'] }, live, false)), ['v14']);
eq('manager with several venues sees exactly those, in list order', ids(visibleVenuesFor({ role: 'manager', venueIds: ['v14', 'v1'] }, live, false)), ['v1', 'v14']);
eq('venue the list does not contain is simply absent', ids(visibleVenuesFor({ role: 'manager', venueIds: ['v99'] }, live, false)), []);
eq('empty assignment sees nothing', ids(visibleVenuesFor({ role: 'venue_manager', venueIds: [] }, live, false)), []);
eq('malformed venueIds sees nothing', ids(visibleVenuesFor({ role: 'manager', venueIds: undefined as unknown as string[] }, live, false)), []);

console.log('\nthe stale-list bug (the baseline stops at v10)');
const user = { role: 'manager' as const, venueIds: ['v14'] };
eq('against the baseline a v14 manager sees nothing (what mount-time snapshots showed)', ids(visibleVenuesFor(user, baseline, false)), []);
eq('against the refreshed list the same user sees Lady Delilah', ids(visibleVenuesFor(user, live, false)), ['v14']);

console.log('\nsafety');
const shared = baseline.slice();
const out = visibleVenuesFor({ role: 'admin', venueIds: 'all' }, shared, true);
out.push({ id: 'x', name: 'mutated' });
eq('org-wide result is a copy, so callers cannot mutate the shared list', shared.length, 3);
eq('refresh event name is stable (access.ts dispatches it, the hook listens)', VENUES_REFRESHED_EVENT, 'kount:venues-refreshed');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
