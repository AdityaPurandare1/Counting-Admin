/* Pure helpers for the Errors screen (kount_client_errors, migration 0041).
   Kept out of the component so the grouping rules are unit-testable. */

export interface ClientErrorRow {
  id: string;
  occurred_at: string;
  app: 'phone' | 'admin';
  app_version: string | null;
  level: 'error' | 'warn';
  context: string | null;
  message: string | null;
  stack: string | null;
  url: string | null;
  user_email: string | null;
  venue_id: string | null;
  user_agent: string | null;
}

export interface ErrorGroup {
  key: string;
  app: 'phone' | 'admin';
  context: string;
  sample: string;          // the newest raw message in the group
  count: number;
  users: string[];         // distinct, sorted
  venueIds: string[];      // distinct, sorted
  versions: string[];      // distinct, sorted
  firstSeen: string;
  lastSeen: string;
  rows: ClientErrorRow[];  // newest first
}

/* Collapse the parts of a message that differ between otherwise-identical
   failures (ids, numbers, double-quoted values) so "HTTP 500 on row 8f3c…" and
   "HTTP 500 on row 1a2b…" land in one group. HTTP status codes are kept —
   a 401 and a 500 are different problems. */
export function normalizeMessage(msg: string | null | undefined): string {
  let s = String(msg ?? '').trim();
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>');
  // Double quotes only: single quotes appear as apostrophes ("can't").
  s = s.replace(/"[^"]{1,200}"/g, '<value>');
  // Numbers that start a token collapse; a status right after "HTTP " stays.
  s = s.replace(/(?<!HTTP )\b\d+(?:\.\d+)?/g, '#');
  s = s.replace(/\s+/g, ' ');
  return s.slice(0, 300);
}

export function groupErrors(rows: ClientErrorRow[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const context = r.context || '(no context)';
    const key = r.app + '|' + context + '|' + normalizeMessage(r.message);
    let g = map.get(key);
    if (!g) {
      g = { key, app: r.app, context, sample: r.message || '', count: 0, users: [], venueIds: [],
            versions: [], firstSeen: r.occurred_at, lastSeen: r.occurred_at, rows: [] };
      map.set(key, g);
    }
    g.count++;
    g.rows.push(r);
    if (r.user_email && !g.users.includes(r.user_email)) g.users.push(r.user_email);
    if (r.venue_id && !g.venueIds.includes(r.venue_id)) g.venueIds.push(r.venue_id);
    if (r.app_version && !g.versions.includes(r.app_version)) g.versions.push(r.app_version);
    if (r.occurred_at < g.firstSeen) g.firstSeen = r.occurred_at;
    if (r.occurred_at > g.lastSeen) { g.lastSeen = r.occurred_at; g.sample = r.message || ''; }
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    g.users.sort(); g.venueIds.sort();
    g.versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  // Most frequent first; ties broken by most recent.
  return groups.sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
}
