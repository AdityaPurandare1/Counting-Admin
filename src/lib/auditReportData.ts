/** Loader for the Bevager-format audit report.
 *
 *  Kept separate from auditReport.ts so that file stays free of the Supabase
 *  client and its pure roll-up helpers can be unit-tested on their own.
 *
 *  Mirrors the pricing rule compute_avt_for_audit uses, so the audit report
 *  and the variance report agree on what an item costs: the newest priced
 *  purchase_items row per master, by updated_at (nulls last). Cost
 *  overrides need no special handling here — the enforce_cost_override
 *  trigger writes kount_cost_overrides straight into avg_cost, so avg_cost is
 *  already the effective cost (and kount_cost_overrides is not readable from
 *  the browser: RLS is on with no SELECT policy). That trigger and table
 *  exist in PRODUCTION ONLY: neither appears in any migration in either repo,
 *  so this was verified against the live database and cannot be checked from
 *  the source tree.
 *
 *  The agreement holds wherever one row is newest. Where two rows for the
 *  same master share an updated_at, the SQL's `distinct on` picks arbitrarily
 *  while this side deterministically takes the greatest id (see
 *  pickNewestPrices), so the two can still land on different avg_cost values.
 *  Closing that needs a matching tiebreak in the migration — out of scope
 *  here, and noted so the gap is known rather than assumed away.
 *
 *  One thing the SQL does not have to worry about and this file does:
 *  compute_avt_for_audit is SECURITY DEFINER, while this reads purchase_items
 *  under the user's own JWT — so RLS can leave this side with nothing. See the
 *  guard in loadAuditReportData. */

import { supabase, selectAllPagedFiltered } from '@/lib/supabase';
import type { MasterItem } from '@/lib/types';
import {
  chunk, pickNewestPrices, toCountLines,
  type AuditCountLine, type AuditEntryRow, type PriceRow,
} from '@/lib/auditReport';

/** UUIDs per `.in(...)` request. 100 × 37 chars keeps the query string well
 *  inside any proxy's URL limit while still being only a handful of round
 *  trips for a typical 250–300 item audit. */
const ID_CHUNK = 100;

export interface AuditReportData {
  lines: AuditCountLine[];
  /** Entries that never became a report line: no master_item_id, or a master
   *  that has since vanished. Either way there is no category and no cost, so
   *  they can't be placed on a GL account — counted so the workbook can say
   *  so out loud rather than just being lighter than the count. */
  unmatchedEntries: number;
  /** Recount overrides recorded for this audit. The report values the
   *  original entries, so a non-zero count is worth a note. `null` means the
   *  lookup failed and the workbook must say THAT instead. */
  recountCount: number | null;
}

export async function loadAuditReportData(auditId: string): Promise<AuditReportData> {
  // 1) The count itself. is_recount rows are the recount trail, not the count
  //    — the same exclusion compute_avt_for_audit makes.
  const entries = await selectAllPagedFiltered<AuditEntryRow>(
    () => supabase
      .from('kount_entries')
      .select('id,master_item_id,qty,zone')
      .eq('audit_id', auditId)
      .eq('is_recount', false),
    { column: 'id', ascending: true },
  );

  const masterIds = [...new Set(entries.map(e => e.master_item_id).filter((id): id is string => !!id))];
  if (masterIds.length === 0) {
    return { lines: [], unmatchedEntries: entries.length, recountCount: await countRecounts(auditId) };
  }

  // 2) Item metadata, 3) unit costs — both chunked by master id — and the
  //    recount disclosure, which is independent of all of it.
  const [masters, prices, recountCount] = await Promise.all([
    loadMasters(masterIds),
    loadPrices(masterIds),
    countRecounts(auditId),
  ]);

  // Zero costs for a whole audit is not a valuation, it is a failed read
  // wearing one. purchase_items is read under the user's JWT, and its RLS
  // grants rows only via organization_users membership — an admin without
  // that row gets an empty result set and NO error, which would render as a
  // correctly-named workbook whose every AMOUNT is blank and whose grand
  // TOTAL is 0.00. Accounting cannot tell that apart from "the bar is empty",
  // so refuse to build it. (compute_avt_for_audit never had this failure mode:
  // it is SECURITY DEFINER.)
  if (prices.size === 0) {
    throw new Error(
      'Cost lookup returned nothing for any of the ' + masterIds.length + ' counted items, ' +
      'so every value in this report would be blank. Either no purchase costs exist for ' +
      'this catalog, or the signed-in user is missing the organization membership that ' +
      'purchase_items row-level security requires. Nothing was exported.',
    );
  }

  const { lines, unresolved } = toCountLines(entries, masters, prices);

  return { lines, unmatchedEntries: unresolved, recountCount };
}

async function loadMasters(ids: string[]): Promise<Map<string, MasterItem>> {
  const out = new Map<string, MasterItem>();
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('master_items')
      .select('id,name,category,subcategory,base_size,base_unit')
      .in('id', part);
    if (error) throw error;
    for (const m of (data ?? []) as MasterItem[]) out.set(m.id, m);
  }
  return out;
}

/** Every priced purchase_items row for these masters; pickNewestPrices does
 *  the choosing. */
async function loadPrices(ids: string[]): Promise<Map<string, number>> {
  const rows: PriceRow[] = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    rows.push(...await selectAllPagedFiltered<PriceRow>(
      () => supabase
        .from('purchase_items')
        .select('id,master_item_id,avg_cost,updated_at')
        .in('master_item_id', part)
        .not('avg_cost', 'is', null),
      // The paging key must be UNIQUE. Postgres imposes no order among ties,
      // so paging on master_item_id can hand back one row twice and skip
      // another entirely across a page boundary, once a chunk exceeds the
      // 1000-row page size — and the skipped row can be the newest one,
      // silently changing cu_price. Which order we page in doesn't matter;
      // only that every row is seen exactly once.
      { column: 'id', ascending: true },
    ));
  }
  return pickNewestPrices(rows);
}

/** How many recount overrides this audit recorded, or null if we could not
 *  find out. */
async function countRecounts(auditId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('kount_recounts')
    .select('id', { count: 'exact', head: true })
    .eq('audit_id', auditId)
    // The same filters compute_avt_for_audit's recount_overrides_applied
    // uses: a recount with no master link or a dismissed one overrides
    // nothing, so counting it would make the Summary footnote claim
    // corrections that were never applied. (The SQL additionally counts
    // distinct (master, zone) pairs; a row count can only exceed that, and
    // only when the same item was recounted twice in one zone.)
    .not('master_item_id', 'is', null)
    .not('count2_qty', 'is', null)
    .neq('status', 'dismissed');
  // A failed count is not worth failing the whole export over, but it must
  // not read as zero either: this number drives the ONLY statement in the
  // workbook that these figures are pre-correction, and "0 recounts" would
  // quietly delete it. Return null so the Summary sheet says the lookup
  // failed, and leave a trace in the console for whoever is asked why.
  if (error) {
    console.warn('[auditReport] recount count failed; workbook will say so', error);
    return null;
  }
  return count ?? 0;
}
