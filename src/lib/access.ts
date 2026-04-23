import type { Role } from './types';
import { supabase } from './supabase';

/** Access-list rows mirror the app_users table (0003_app_users.sql).
 *
 *  Primary source of truth is Supabase; the BASELINE list below is a
 *  compile-time fallback so the desktop app can still log someone in if
 *  Supabase is unreachable (e.g. during a network blip or the very first
 *  time someone loads the app before 0003 is applied). Both apps also
 *  cache the Supabase list in localStorage so subsequent offline logins
 *  work. */

export interface AccessEntry {
  email: string;
  name: string;
  role: Role;
  venueIds: 'all' | string[];
}

const CACHE_KEY = 'kount_admin_app_users_cache_v1';

/** Baseline / fallback — kept in sync with the seed rows in 0003_app_users.sql
 *  so fresh installs still log in without a DB round-trip. Any edits made
 *  through the Security screen will override these via the Supabase fetch. */
const BASELINE: AccessEntry[] = [
  { email: 'admin@hwood.com',    name: 'Admin',     role: 'corporate', venueIds: 'all' },
  { email: 'ceo@hwood.com',      name: 'CEO',       role: 'corporate', venueIds: 'all' },
  { email: 'manager1@hwood.com', name: 'Manager 1', role: 'manager',   venueIds: ['v1', 'v2', 'v3'] },
  { email: 'manager2@hwood.com', name: 'Manager 2', role: 'manager',   venueIds: ['v4', 'v5', 'v6'] },
  { email: 'manager3@hwood.com', name: 'Manager 3', role: 'manager',   venueIds: ['v7', 'v8', 'v9', 'v10'] },
  { email: 'counter1@team.com',  name: 'Counter 1', role: 'counter',   venueIds: ['v1', 'v2'] },
  { email: 'counter2@team.com',  name: 'Counter 2', role: 'counter',   venueIds: ['v3', 'v4'] },
  { email: 'counter3@team.com',  name: 'Counter 3', role: 'counter',   venueIds: ['v5', 'v6'] },
  { email: 'counter4@team.com',  name: 'Counter 4', role: 'counter',   venueIds: ['v7', 'v8'] },
  { email: 'counter5@team.com',  name: 'Counter 5', role: 'counter',   venueIds: ['v9', 'v10'] },
];

// Keep the list accessible even before a first fetch — seed with BASELINE.
export let ACCESS_LIST: AccessEntry[] = loadCache() ?? BASELINE.slice();

export const VENUES: Array<{ id: string; name: string }> = [
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
 *  cache. Silently falls back to the existing list on error, so an offline
 *  page still boots with whatever was cached last time. */
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
    if (mapped.length > 0) {
      ACCESS_LIST = mapped;
      saveCache(mapped);
    }
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
