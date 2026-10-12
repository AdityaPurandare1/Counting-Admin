import type { Role } from './types';

/* Which venues a signed-in user can see. A plain function (no React, no Supabase)
   so the rule is unit-testable. Org-wide roles (admin, corporate) are what
   isOrgWide() in access.ts says; this takes the same flag so it stays in step. */

export interface VenueRef { id: string; name: string }

export const VENUES_REFRESHED_EVENT = 'kount:venues-refreshed';

export function visibleVenuesFor(
  user: { role: Role; venueIds: 'all' | string[] },
  venues: VenueRef[],
  orgWide: boolean,
): VenueRef[] {
  if (orgWide || user.venueIds === 'all') return venues.slice();
  const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
  return venues.filter(v => set.has(v.id));
}
