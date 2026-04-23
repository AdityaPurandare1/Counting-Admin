import type { Role } from './types';

/** Mirrors ACCESS_LIST in the phone app's counting-app.html.
 *
 *  Drift risk: if you edit one list you must edit the other. A v0.2+
 *  migration will move this to a Supabase `app_users` table so both apps
 *  read from one source. For now, keep them byte-for-byte in sync. */

export interface AccessEntry {
  email: string;
  name: string;
  role: Role;
  venueIds: 'all' | string[];
}

export const ACCESS_LIST: AccessEntry[] = [
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

export function resolveAccess(email: string): AccessEntry | null {
  const e = email.trim().toLowerCase();
  return ACCESS_LIST.find(a => a.email.toLowerCase() === e) ?? null;
}
