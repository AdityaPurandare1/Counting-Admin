import { createClient } from '@supabase/supabase-js';

/** Same project the phone app points at. If you rotate keys, update the phone
 *  app's `counting-app.html` in lockstep so both clients stay aligned. */
export const SUPABASE_URL = 'https://mnraeesscqsaappkaldb.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ucmFlZXNzY3FzYWFwcGthbGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2MzkxNzQsImV4cCI6MjA3ODIxNTE3NH0.QaPiMs48H9nsH7wGNhi_1jYRQ_YAPGLduxSpYOrz1ug';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 2 } },
  auth: { persistSession: false },
});

/** Paginate past the db-max-rows cap (default 1000) so a full catalog loads
 *  without silent truncation. Matches the v1.3 fix in the phone app. */
export async function selectAllPaged<T>(
  table: string,
  select = '*',
  order = 'name',
  pageSize = 1000,
  maxPages = 20,
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
