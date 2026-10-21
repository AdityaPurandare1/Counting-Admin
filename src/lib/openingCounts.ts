import { supabase } from './supabase';

/* Opening counts (v0.73).

   A venue's FIRST closed count has no earlier count to start from, so
   compute_avt_for_audit compares it against every purchase and sale since the
   beginning of time. Its "variance" is really the venue's opening stock: Little
   Luck's LL-038 read +$63,621 on $15,245 expected, Alphabet's ALPHA0 +$41,474.
   Summed into the Overview it swamped every real count (2026-10-21: the
   company total jumped by LL-038 the day it got its first report).

   Same rule the compute uses for its window start: the earliest SUBMITTED audit
   of the same kind (beverage vs food, 0101) at the venue. Screens label it
   "Opening count" and leave it out of variance totals and percentages. */

export interface AuditLite { id: string; venue_id: string; started_at: string; audit_kind?: string | null }

/** The first submitted audit per (venue, kind). Pure; exported for the unit test. */
export function firstAuditPerVenue(audits: AuditLite[]): Set<string> {
  const first = new Map<string, AuditLite>();
  for (const a of audits) {
    const key = a.venue_id + '|' + (a.audit_kind ?? 'beverage');
    const cur = first.get(key);
    if (!cur || a.started_at < cur.started_at) first.set(key, a);
  }
  return new Set([...first.values()].map(a => a.id));
}

/** Ids of every venue's opening count. On a read error returns an empty set and the error,
 *  so a failed read never hides a real count. */
export async function loadOpeningAuditIds(): Promise<{ ids: Set<string>; error: string | null }> {
  const { data, error } = await supabase
    .from('kount_audits')
    .select('id,venue_id,started_at,audit_kind')
    .eq('status', 'submitted')
    .order('started_at', { ascending: true })
    .limit(5000);
  if (error) return { ids: new Set(), error: error.message };
  return { ids: firstAuditPerVenue((data ?? []) as AuditLite[]), error: null };
}
