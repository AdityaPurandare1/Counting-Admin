import { VENUES } from './access';
import { supabase } from './supabase';

/* v0.28: STORE_MAP and DEFAULT_VENUE_ZONES are now backed by the venues
 * table (migration 0013). The constants below stay as boot-time fallback;
 * after refreshVenueLookups() runs they get rewritten from the DB row.
 * Both maps mutate in place so existing imports of STORE_MAP /
 * DEFAULT_VENUE_ZONES keep working without callsite changes. */
const VENUE_LOOKUPS_CACHE_KEY = 'kount_admin_venue_lookups_cache_v1';

interface CachedLookups {
  storeMap: Record<string, string>;
  defaultZones: Record<string, string[]>;
}

function loadLookupsCache(): CachedLookups | null {
  try {
    const raw = localStorage.getItem(VENUE_LOOKUPS_CACHE_KEY);
    return raw ? JSON.parse(raw) as CachedLookups : null;
  } catch { return null; }
}

function saveLookupsCache(c: CachedLookups) {
  try { localStorage.setItem(VENUE_LOOKUPS_CACHE_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

const _cached = loadLookupsCache();

/** Mirrors STORE_MAP in the phone app's counting-app.html. Any Craftable
 *  store-label variant → our venue id (v1..v10). v0.28 makes this dynamic
 *  but the const below seeds the initial state for offline/first-paint. */
export const STORE_MAP: Record<string, string> = _cached?.storeMap ?? {
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

/** Default zones per venue. v0.28 dynamic — seeded from cache on first
 *  paint, refreshed from the venues table after `refreshVenueLookups()`.
 *  Mutates in place so existing imports see live data after refresh. */
export const DEFAULT_VENUE_ZONES: Record<string, string[]> = _cached?.defaultZones ?? {
  v1:  ['Main Bar', 'Back Bar', 'Service Bar', 'Wine Room', 'Main Fridge', 'Back Fridge', 'Walk-in Cooler', 'Dry Storage', 'Back Office'],
  v2:  ['Main Bar', 'Service Bar', 'Wine Room', 'Pool Bar', 'Main Fridge', 'Walk-in Cooler', 'Dry Storage', 'Back Office'],
  v3:  ['Main Bar', 'Back Bar', 'Wine Fridge', 'Cellar', 'Main Fridge', 'Kitchen', 'Dry Storage', 'Back Office'],
  v4:  ['Main Bar', 'Back Bar', 'Lounge Bar', 'Wine Cellar', 'Main Fridge', 'Walk-in Cooler', 'Dry Storage', 'Back Office'],
  v5:  ['Main Bar', 'DJ Booth Bar', 'VIP Bar', 'Main Fridge', 'Walk-in Cooler', 'Dry Storage', 'Back Office'],
  v6:  ['Main Bar', 'Back Bar', 'Main Fridge', 'Walk-in Cooler', 'Dry Storage', 'Back Office'],
  v7:  ['Main Bar', 'Back Bar', 'VIP Bar', 'Main Fridge', 'Dry Storage', 'Back Office'],
  v8:  ['Main Bar', 'Lounge Bar', 'Main Fridge', 'Dry Storage', 'Back Office'],
  v9:  ['Rooftop Bar', 'Pool Bar', 'Main Fridge', 'Dry Storage', 'Back Office'],
  v10: ['Main Bar', 'Patio Bar', 'Main Fridge', 'Walk-in Cooler', 'Dry Storage', 'Back Office'],
};

export function getDefaultZones(venueId: string): string[] {
  return DEFAULT_VENUE_ZONES[venueId] ?? [];
}

/* Pull live venue rows and rebuild STORE_MAP + DEFAULT_VENUE_ZONES in
   place. Active rows only — soft-deleted venues stay out of the AVT
   store-name resolver and the new-audit zone seeding so they don't
   accidentally claim aliases that should now route to the replacement
   venue. Cached to localStorage so first paint after a reload is correct
   without round-tripping. Returns the row count for the caller. */
export async function refreshVenueLookups(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('kount_venues')
      .select('id, default_zones, store_aliases')
      .eq('is_active', true);
    if (error || !data) return 0;
    const rows = data as Array<{ id: string; default_zones: string[]; store_aliases: string[] }>;

    // Empty-result guard: a fresh DB without seed (or every venue
    // soft-deleted) returns []. Without this guard the wipe loops
    // below would clear both maps AND the cache, leaving the AVT
    // resolver and zone-tab seeds dead. Keep the existing fallback
    // values in place; the admin VenueSettings empty-state already
    // surfaces a "apply migration / add a venue" hint.
    if (rows.length === 0) return 0;

    // Wipe current state then rebuild from rows
    for (const k of Object.keys(STORE_MAP))         delete STORE_MAP[k];
    for (const k of Object.keys(DEFAULT_VENUE_ZONES)) delete DEFAULT_VENUE_ZONES[k];
    for (const r of rows) {
      DEFAULT_VENUE_ZONES[r.id] = r.default_zones ?? [];
      for (const alias of (r.store_aliases ?? [])) {
        STORE_MAP[String(alias).toLowerCase().trim()] = r.id;
      }
    }
    saveLookupsCache({ storeMap: { ...STORE_MAP }, defaultZones: { ...DEFAULT_VENUE_ZONES } });
    return rows.length;
  } catch {
    return 0;
  }
}
