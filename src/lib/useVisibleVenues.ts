import { useEffect, useMemo, useState } from 'react';
import { VENUES, isOrgWide } from './access';
import type { AccessEntry } from './access';
import { VENUES_REFRESHED_EVENT, visibleVenuesFor } from './visibleVenues';

/* The venues this user can see, kept current.
 *
 * VENUES is a module-level list that refreshVenues() overwrites IN PLACE after
 * sign-in. Screens used to snapshot it in useMemo(..., [user]), so a screen
 * that mounted before the refresh (the default landing page does) kept the
 * baseline list forever. The baseline stops at v10, so a manager of a newer
 * venue (Little Luck v11, Alphabet v12, Lady Delilah v14) saw "0 of 0 venues"
 * and empty pickers until they left the screen and came back.
 *
 * Mutating the array in place never changes its identity, so the memo needs an
 * explicit signal: refreshVenues() dispatches VENUES_REFRESHED_EVENT and this
 * hook re-reads on it. The bump after subscribing covers a refresh that landed
 * between the first render and the effect. */
export function useVisibleVenues(user: AccessEntry) {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev(r => r + 1);
    window.addEventListener(VENUES_REFRESHED_EVENT, bump);
    bump();
    return () => window.removeEventListener(VENUES_REFRESHED_EVENT, bump);
  }, []);
  // rev is a dependency only to force a re-read: VENUES itself never changes identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => visibleVenuesFor(user, VENUES, isOrgWide(user.role)), [user, rev]);
}
