import { createClient } from '@supabase/supabase-js';

/** Same project the phone app points at. If you rotate keys, update the phone
 *  app's `counting-app.html` in lockstep so both clients stay aligned. */
export const SUPABASE_URL = 'https://mnraeesscqsaappkaldb.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ucmFlZXNzY3FzYWFwcGthbGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2MzkxNzQsImV4cCI6MjA3ODIxNTE3NH0.QaPiMs48H9nsH7wGNhi_1jYRQ_YAPGLduxSpYOrz1ug';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 2 } },
  auth: {
    // Phase 3 (Supabase Auth migration): admin signs in via Supabase Auth
    // and the session persists across reloads. The JWT is also what
    // authorizes admin-user-mgmt Edge Function calls — no JWT, no admin
    // actions. Pre-migration users still in ACCESS_LIST keep working
    // through Login.tsx's dual-path fallback until Phase 5 migrates
    // everyone.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,  // catches password-reset / invite redirects
  },
});

/** Paginate past the db-max-rows cap (default 1000) so a full catalog loads
 *  without silent truncation. Matches the v1.3 fix in the phone app. Cap is
 *  50 pages = 50 k rows, high enough for the current purchase_items (~23 k)
 *  with headroom; tune up if the catalog grows. */
export async function selectAllPaged<T>(
  table: string,
  select = '*',
  order = 'name',
  pageSize = 1000,
  maxPages = 50,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(order)
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}
