/**
 * Tests for src/lib/clientErrors.ts — the grouping rules behind the Errors
 * screen. Grouping must collapse failures that differ only in ids/numbers/
 * quoted values, but keep apart failures that are genuinely different
 * (another context, another app, another HTTP status).
 *
 * Plain tsx script, same style as the other tests here. Run with: npm test
 */
import { normalizeMessage, groupErrors, type ClientErrorRow } from '../src/lib/clientErrors.ts';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}`); if (detail !== undefined) console.error('        got:', JSON.stringify(detail)); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(`${label} === ${JSON.stringify(expected)}`, JSON.stringify(actual) === JSON.stringify(expected), actual);
}

let seq = 0;
function row(p: Partial<ClientErrorRow>): ClientErrorRow {
  seq++;
  return {
    id: 'id' + seq, occurred_at: p.occurred_at ?? '2026-10-01T10:00:00Z', app: p.app ?? 'phone',
    app_version: p.app_version ?? '2.13', level: 'error',
    context: 'context' in p ? (p.context as string | null) : 'syncRecountUpdateToSupabase',
    message: p.message ?? 'HTTP 500 boom', stack: null, url: null, user_email: p.user_email ?? 'a@h.com',
    venue_id: p.venue_id ?? 'v5', user_agent: null,
  };
}

console.log('\nnormalizeMessage');
eq('uuids collapse', normalizeMessage('row 8f3c1a2b-1111-4111-8111-111111111111 failed'), 'row <id> failed');
eq('numbers collapse', normalizeMessage('page 12 failed after 3.5s'), 'page # failed after #s');
eq('HTTP status kept', normalizeMessage('HTTP 401 expired'), 'HTTP 401 expired');
eq('double-quoted values collapse', normalizeMessage('no item "Belvedere 1L" found'), 'no item <value> found');
eq('apostrophes untouched', normalizeMessage("can't sync, it's offline"), "can't sync, it's offline");
eq('null is empty', normalizeMessage(null), '');
eq('whitespace squashed', normalizeMessage('a   \n  b'), 'a b');

console.log('\ngroupErrors');
const rows = [
  row({ message: 'HTTP 500 on row 8f3c1a2b-1111-4111-8111-111111111111', user_email: 'anna@h.com', occurred_at: '2026-10-01T09:00:00Z', app_version: '2.12' }),
  row({ message: 'HTTP 500 on row 1a2b3c4d-2222-4222-8222-222222222222', user_email: 'pati@h.com', occurred_at: '2026-10-02T09:00:00Z', app_version: '2.13', venue_id: 'v12' }),
  row({ message: 'HTTP 500 on row 9f9f9f9f-3333-4333-8333-333333333333', user_email: 'anna@h.com', occurred_at: '2026-10-03T09:00:00Z', app_version: '2.13' }),
  row({ message: 'HTTP 401 on row 9f9f9f9f-3333-4333-8333-333333333333', occurred_at: '2026-10-03T10:00:00Z' }),
  row({ context: 'saveState', message: 'QuotaExceededError', occurred_at: '2026-10-01T11:00:00Z' }),
  row({ app: 'admin', message: 'HTTP 500 on row 8f3c1a2b-1111-4111-8111-111111111111', occurred_at: '2026-10-01T12:00:00Z' }),
];
const groups = groupErrors(rows);
eq('4 distinct problems', groups.length, 4);
const big = groups[0];
eq('most frequent group first (3 occurrences)', big.count, 3);
eq('distinct users', big.users, ['anna@h.com', 'pati@h.com']);
eq('distinct venues', big.venueIds, ['v12', 'v5']);
eq('versions sorted numerically', big.versions, ['2.12', '2.13']);
eq('first seen', big.firstSeen, '2026-10-01T09:00:00Z');
eq('last seen', big.lastSeen, '2026-10-03T09:00:00Z');
check('sample is the newest raw message', big.sample.includes('9f9f9f9f'), big.sample);
check('rows newest first', big.rows[0].occurred_at > big.rows[2].occurred_at, big.rows.map(r => r.occurred_at));
check('401 kept apart from 500', groups.some(g => g.count === 1 && g.sample.startsWith('HTTP 401')));
check('same message from the admin app kept apart from phone', groups.some(g => g.app === 'admin'));
eq('empty input -> no groups', groupErrors([]).length, 0);
const tie = groupErrors([
  row({ context: 'a', message: 'x', occurred_at: '2026-10-01T00:00:00Z' }),
  row({ context: 'b', message: 'y', occurred_at: '2026-10-05T00:00:00Z' }),
]);
eq('ties broken by most recent', tie[0].context, 'b');
eq('missing context labeled', groupErrors([row({ context: null })])[0].context, '(no context)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
