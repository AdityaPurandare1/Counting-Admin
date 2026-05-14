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
 *  with headroom; tune up if the catalog grows.
 *
 *  When the cap is actually hit (last page is full = more rows exist) we
 *  throw rather than return a silently-truncated set. Callers that legitimately
 *  expect more data must raise `maxPages` explicitly; callers that don't
 *  catch will fail loudly, which is the right failure mode for catalog
 *  dedup / inventory imports that would silently misclassify rows. */
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
    // Last allowed page came back full → more rows exist that we're not
    // loading. Bail loudly so the caller can't ship a truncated set.
    if (page === maxPages - 1) {
      throw new Error(
        `selectAllPaged(${table}) truncated at ${maxPages * pageSize} rows ` +
        `— raise maxPages or paginate explicitly.`,
      );
    }
  }
  return rows;
}

/** Paginate an arbitrary filtered query past the db-max-rows cap.
 *
 *  `buildBase` is a factory that returns a fresh Supabase query builder for
 *  each page — we can't reuse one because `.range()` mutates the builder.
 *  Callers chain `.eq()`, `.in()`, etc. before returning. The helper adds
 *  the order + range and runs the page.
 *
 *  Same truncation contract as `selectAllPaged`: if the last allowed page
 *  comes back full (meaning more rows exist), we throw rather than silently
 *  return a partial set. Callers that legitimately expect more must raise
 *  maxPages. 100 pages × 1000 = 100 k rows headroom — large enough for any
 *  audit we've seen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilteredQuery = any;

export async function selectAllPagedFiltered<T>(
  buildBase: () => FilteredQuery,
  order: { column: string; ascending: boolean },
  pageSize = 1000,
  maxPages = 100,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await buildBase()
      .order(order.column, { ascending: order.ascending })
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
    if (page === maxPages - 1) {
      throw new Error(
        `selectAllPagedFiltered truncated at ${maxPages * pageSize} rows ` +
        `— raise maxPages or paginate explicitly.`,
      );
    }
  }
  return rows;
}
