import type { Role } from './types';
import { supabase } from './supabase';

/** Access-list rows mirror the app_users table (0003_app_users.sql).
 *
 *  Supabase is the single source of truth. ACCESS_LIST is hydrated from a
 *  localStorage cache for instant first paint, then refreshed live from
 *  app_users on app boot. A fresh install starts empty — login waits for
 *  the Supabase fetch to populate it (or accepts that an unknown email
 *  will be denied until the admin invites them). */

export interface AccessEntry {
  email: string;
  name: string;
  role: Role;
  venueIds: 'all' | string[];
}

const CACHE_KEY = 'kount_admin_app_users_cache_v1';

// Start empty when there's no cache. refreshAccessList() populates it from
// Supabase on App boot; until then, only cached users are resolvable.
export let ACCESS_LIST: AccessEntry[] = loadCache() ?? [];

/* v0.28: VENUES is now backed by a Supabase `venues` table (migration 0013).
 * The const below stays as the boot-time fallback so the app still renders
 * something usable on first paint and during a Supabase outage. After
 * `refreshVenues()` runs, `VENUES` mutates in place to whatever the DB
 * returned (active rows only, sorted by ordinal). All callers that import
 * `VENUES` get the live list.
 *
 * The Venue type is intentionally narrow — admin UIs that need address,
 * default_zones, store_aliases use `VenueRow` from `@/lib/types`. */
const VENUES_BASELINE: Array<{ id: string; name: string }> = [
  { id: 'v1',  name: 'Delilah LA' },
  { id: 'v2',  name: 'Delilah Miami' },
  { id: 'v3',  name: 'The Nice Guy' },
  { id: 'v4',  name: 'The Birdstreet Club' },
  { id: 'v5',  name: 'Poppy' },
  { id: 'v6',  name: 'Keys' },
  { id: 'v7',  name: 'Bootsy Bellows' },
  { id: 'v8',  name: 'The Fleur Room' },
  { id: 'v9',  name: 'Harriets' },
  { id: 'v10', name: '40 Love' },
];

const VENUES_CACHE_KEY = 'kount_admin_venues_cache_v1';

function loadVenuesCache(): Array<{ id: string; name: string }> | null {
  try {
    const raw = localStorage.getItem(VENUES_CACHE_KEY);
    return raw ? JSON.parse(raw) as Array<{ id: string; name: string }> : null;
  } catch { return null; }
}

export const VENUES: Array<{ id: string; name: string }> =
  loadVenuesCache() ?? VENUES_BASELINE.slice();

/** Pull the live venues table and refresh `VENUES` + cache in localStorage.
 *  Silent fallback to existing list on error so a Supabase outage doesn't
 *  blank the picker. Active rows only — soft-deleted (is_active=false)
 *  venues are excluded from pickers but stay queryable for historic audits
 *  via the dedicated VenueSettings screen. */
export async function refreshVenues(): Promise<Array<{ id: string; name: string }>> {
  try {
    const { data, error } = await supabase
      .from('kount_venues')
      .select('id, name, ordinal')
      .eq('is_active', true)
      .order('ordinal')
      .order('name');
    if (error || !data) return VENUES;
    const mapped = (data as Array<{ id: string; name: string; ordinal: number }>).map(v => ({
      id: v.id,
      name: v.name,
    }));
    if (mapped.length > 0) {
      VENUES.length = 0;
      for (const v of mapped) VENUES.push(v);
      try { localStorage.setItem(VENUES_CACHE_KEY, JSON.stringify(mapped)); } catch {}
    }
    return VENUES;
  } catch { return VENUES; }
}

interface AppUserRow {
  email: string;
  name: string | null;
  role: Role;
  venue_ids: string[];
  is_active: boolean;
}

function rowToEntry(r: AppUserRow): AccessEntry {
  return {
    email: r.email,
    name: r.name ?? r.email,
    role: r.role,
    venueIds: r.role === 'corporate' ? 'all' : (r.venue_ids ?? []),
  };
}

function loadCache(): AccessEntry[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as AccessEntry[] : null;
  } catch { return null; }
}

function saveCache(list: AccessEntry[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/** Pull the live app_users table and refresh ACCESS_LIST + the localStorage
 *  cache. On a fetch error we keep the existing list (transient failure
 *  shouldn't accidentally lock everyone out). On an EMPTY successful
 *  result we DO replace — admin clearing the active list is the canonical
 *  "lock everyone out" path and must propagate, not silently fall back to
 *  the cached/baseline users. Same posture as the phone app. */
export async function refreshAccessList(): Promise<AccessEntry[]> {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('is_active', true)
      .order('role')
      .order('email');
    if (error || !data) return ACCESS_LIST;
    const mapped = data.map(r => rowToEntry(r as AppUserRow));
    // Always apply the result — including [] — so a re-opened tab honors
    // the revoked list even before Supabase responds again.
    ACCESS_LIST = mapped;
    saveCache(mapped);
    return ACCESS_LIST;
  } catch { return ACCESS_LIST; }
}

export function resolveAccess(email: string): AccessEntry | null {
  const e = email.trim().toLowerCase();
  return ACCESS_LIST.find(a => a.email.toLowerCase() === e) ?? null;
}

/** Async variant — refreshes from Supabase first, then resolves. Falls back
 *  to the synchronous resolver if Supabase is unreachable. */
export async function resolveAccessAsync(email: string): Promise<AccessEntry | null> {
  await refreshAccessList();
  return resolveAccess(email);
}
