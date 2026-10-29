import { supabase, selectAllPagedFiltered } from './supabase';
import type { KountAudit, KountAvtReport, KountAvtRow } from './types';

/* A venue's current inventory report (v0.77) — Stock on hand and Ask AI.

   Both used to take the venue's newest kount_avt_reports row by uploaded_at.
   But compute_avt_for_audit deletes and re-inserts its report, stamped now(),
   on every recompute (a transfer, a cost fix, the 15-minute missing-report
   job), and that job computes FOOD counts too (audit_kind = 'food'). So
   recomputing an old count, or closing a food count, made it the venue's
   "current" inventory.

   Same answer as Variance: pick the audit first, then load THAT audit's report
   (computed outranks uploaded, as in Variance's loadAvt). The audit is the
   venue's newest submitted beverage count, by when it closed. */

export interface VenueReport {
  /** Newest submitted, non-food audit at the venue; null when it has none. */
  audit: KountAudit | null;
  /** That audit's report; null when it has not been computed yet. */
  report: KountAvtReport | null;
  rows: KountAvtRow[];
}

/** Throws (with a readable message) on any failed read, so a caller can tell
 *  "could not load" apart from "no report yet". */
export async function loadLatestVenueReport(venueId: string): Promise<VenueReport> {
  const { data: audits, error: auditErr } = await supabase
    .from('kount_audits')
    .select('*')
    .eq('venue_id', venueId)
    .eq('status', 'submitted')
    .neq('audit_kind', 'food')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('started_at', { ascending: false })
    .limit(1);
  if (auditErr) throw new Error('Counts could not be loaded: ' + auditErr.message);
  const audit = ((audits ?? [])[0] as KountAudit | undefined) ?? null;
  if (!audit) return { audit: null, report: null, rows: [] };

  const { data: reports, error: repErr } = await supabase
    .from('kount_avt_reports')
    .select('*')
    .eq('audit_id', audit.id)
    .order('source', { ascending: true })
    .order('uploaded_at', { ascending: false })
    .limit(1);
  if (repErr) throw new Error('The report could not be loaded: ' + repErr.message);
  const report = ((reports ?? [])[0] as KountAvtReport | undefined) ?? null;
  if (!report) return { audit, report: null, rows: [] };

  try {
    // Paged: a busy venue's report can pass PostgREST's 1000-row cap.
    const rows = await selectAllPagedFiltered<KountAvtRow>(
      () => supabase.from('kount_avt_rows').select('*').eq('report_id', report.id).eq('venue_id', venueId),
      { column: 'id', ascending: true },
    );
    return { audit, report, rows };
  } catch (err) {
    throw new Error('The report rows could not be loaded: ' + ((err as { message?: string })?.message ?? String(err)));
  }
}
