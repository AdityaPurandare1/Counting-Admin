import { VENUES } from './access';

/** Mirrors STORE_MAP in the phone app's counting-app.html. Any Craftable
 *  store-label variant → our venue id (v1..v10). Keep these two lists in
 *  lockstep until the ACCESS_LIST / venue table migration in v0.5 makes
 *  this a single source of truth in Supabase. */
export const STORE_MAP: Record<string, string> = {
  // The Birdstreet Club
  'bird street': 'v4',
  'birdstreet': 'v4',
  'the birdstreet club': 'v4',
  'birdstreet club': 'v4',
  'bird street club': 'v4',
  // Delilah LA
  'delilah la': 'v1',
  'delilah - la': 'v1',
  'delilah': 'v1',
  'delilah los angeles': 'v1',
  'delilah west hollywood': 'v1',
  // Delilah Miami
  'delilah miami': 'v2',
  'delilah - miami': 'v2',
  'delilah mia': 'v2',
  'delilah miami beach': 'v2',
  // The Nice Guy
  'the nice guy': 'v3',
  'nice guy': 'v3',
  'tng': 'v3',
  // Poppy
  'poppy': 'v5',
  // Keys
  'keys': 'v6',
  'the keys': 'v6',
  // Bootsy Bellows
  'bootsy bellows': 'v7',
  'bootsy': 'v7',
  // The Fleur Room
  'the fleur room': 'v8',
  'fleur room': 'v8',
  'fleur': 'v8',
  // Harriets
  'harriets': 'v9',
  "harriet's": 'v9',
  'harriets rooftop': 'v9',
  // 40 Love
  '40 love': 'v10',
  'forty love': 'v10',
};

export function mapStoreToVenueId(storeName: string | null | undefined): string | null {
  const normalized = String(storeName ?? '').toLowerCase().trim();
  return STORE_MAP[normalized] ?? null;
}

export function mapStoreToVenueName(storeName: string | null | undefined): string | null {
  const vid = mapStoreToVenueId(storeName);
  if (!vid) return storeName ?? null;
  return VENUES.find(v => v.id === vid)?.name ?? storeName ?? null;
}
