/* ───────────────────────────────────────────────────────────────────────
   inventoryImport — pure preview logic for the procurement CSV upload.

   The Inventory screen shows a client-side PREVIEW of what the
   import_inventory_csv RPC will do, then the RPC does the real work
   server-side. This module is the single source of truth for that preview
   and is a faithful mirror of the authoritative RPC definition in
   0034_fix_import_inventory_csv.sql. Extracted as a pure function so it can
   be unit-tested without React (the repo's `npm test` is a plain tsx
   harness).

   RPC semantics replicated here (see 0034 for the SQL):

   Master resolution (per row), in priority order:
     1. If a UPC is present, normalize it (digits only, leading zeros
        stripped) and look up master_item_upcs.upc_normalized → master_item_id.
     2. Else case-insensitive master_items.name match WHERE is_active = true.
     3. Else no master → counted in unresolved_master_count.

   Purchase resolution (drives new-vs-update master):
     - UPC exact match on purchase_items.upc (raw, not normalized) first,
       else case-insensitive name.

   Carried determination is keyed on master_item_id, NOT purchase_item_id:
     - A row is "already carried" iff a kount_carried_items row exists with
       the resolved master_item_id; OR, only when no master resolved, a row
       exists with the resolved purchase_item_id.

   Replace-mode removal mirrors the RPC's DELETE exactly: only carried rows
   where master_item_id IS NULL AND purchase_item_id IS NOT NULL AND
   purchase_item_id is NOT among the CSV's matched/created purchase_item_ids.
   ─────────────────────────────────────────────────────────────────────── */

export interface ParsedRow {
  name: string;
  brand: string;
  size: string;
  upc: string;
  category: string;
  sku: string;
}

export interface RowFate {
  row: ParsedRow;
  status: 'new-master' | 'updated-master' | 'newly-carried' | 'already-carried';
  /** purchase_items.id when a purchase match was found / would be created. */
  matchedId?: string;
  matchedName?: string;
}

/** Minimal shapes the preview needs — subsets of the live table rows. */
export interface PurchaseItemLite { id: string; name: string; upc: string | null; }
export interface MasterItemLite   { id: string; name: string; is_active: boolean | null; }
export interface MasterItemUpcLite { upc_normalized: string; master_item_id: string; }
export interface CarriedLite { purchase_item_id: string | null; master_item_id: string | null; }

export interface ImportPreviewInputs {
  purchaseItems: PurchaseItemLite[];
  masterItems: MasterItemLite[];
  masterItemUpcs: MasterItemUpcLite[];
  carried: CarriedLite[];
  /** Accepted for call-site symmetry with the RPC params. removeIds is
   *  always computed (the RPC's delete predicate doesn't depend on the flag
   *  beyond the empty-CSV guard); callers gate the DISPLAY of removeIds on
   *  their own replace-mode state. */
  replaceMode?: boolean;
}

export interface ImportPreview {
  fates: RowFate[];
  /** purchase_item_ids the RPC would delete under replace mode. */
  removeIds: string[];
  unresolvedMasterCount: number;
}

/** UPC normalization, identical to migration 0020 / 0034:
 *  digits only, leading zeros stripped. Empty result → undefined (no UPC). */
export function normalizeUpc(upc: string | null | undefined): string | undefined {
  if (upc == null) return undefined;
  const norm = upc.replace(/[^0-9]/g, '').replace(/^0+/, '');
  return norm === '' ? undefined : norm;
}

/** Pure replica of import_inventory_csv's preview-relevant logic. The phone
 *  app and admin both read carried rows by `master_item_id is not null`; this
 *  function never mutates any input. */
export function computeImportPreview(
  rows: ParsedRow[],
  { purchaseItems, masterItems, masterItemUpcs, carried }: ImportPreviewInputs,
): ImportPreview {
  // Purchase-item lookups. The RPC matches UPC on the RAW string
  // (purchase_items.upc = v_upc, the trimmed CSV cell), then lower(name).
  const purchaseByUpc = new Map<string, PurchaseItemLite>();
  const purchaseByName = new Map<string, PurchaseItemLite>();
  for (const p of purchaseItems) {
    if (p.upc) purchaseByUpc.set(p.upc, p);
    purchaseByName.set(p.name.toLowerCase(), p);
  }

  // Master lookups: normalized UPC → master_item_id, then active-name.
  const masterByUpcNorm = new Map<string, string>();
  for (const u of masterItemUpcs) {
    if (!masterByUpcNorm.has(u.upc_normalized)) masterByUpcNorm.set(u.upc_normalized, u.master_item_id);
  }
  const activeMasterByName = new Map<string, string>();
  for (const m of masterItems) {
    if (m.is_active === true) {
      const key = m.name.toLowerCase();
      if (!activeMasterByName.has(key)) activeMasterByName.set(key, m.id);
    }
  }

  // Carried sets, keyed both ways (the RPC checks master first, then purchase).
  const carriedMasterIds = new Set<string>();
  const carriedPurchaseIds = new Set<string>();
  for (const c of carried) {
    if (c.master_item_id) carriedMasterIds.add(c.master_item_id);
    if (c.purchase_item_id) carriedPurchaseIds.add(c.purchase_item_id);
  }

  let unresolvedMasterCount = 0;
  const csvPurchaseIds: string[] = []; // mirrors v_csv_pids (matched + created)

  const fates: RowFate[] = rows.map((row) => {
    const rawUpc = row.upc.trim() || undefined;

    // ── Purchase match (new-vs-update master) ──
    let purchaseMatch: PurchaseItemLite | undefined;
    if (rawUpc) purchaseMatch = purchaseByUpc.get(rawUpc);
    if (!purchaseMatch) purchaseMatch = purchaseByName.get(row.name.toLowerCase());

    // ── Master resolution (carried key) — RPC priority ──
    let masterId: string | undefined;
    const upcNorm = normalizeUpc(rawUpc);
    if (upcNorm) masterId = masterByUpcNorm.get(upcNorm);
    if (!masterId) masterId = activeMasterByName.get(row.name.toLowerCase());
    if (!masterId) unresolvedMasterCount++;

    if (!purchaseMatch) {
      // New purchase_items row (the RPC INSERTs and counts inserted_master).
      // It is always added to carried, so its outcome is "new-master".
      // We don't yet have the would-be-created id, so it can't appear in
      // csvPurchaseIds — and the RPC's replace delete uses NOT IN that set,
      // which for a freshly created pid is moot (a brand-new pid can't be an
      // existing carried row). matchedId stays undefined here.
      return { row, status: 'new-master' as const };
    }

    csvPurchaseIds.push(purchaseMatch.id);

    // Carried determination: master-keyed first, else purchase-keyed only
    // when no master resolved (mirrors the RPC's lookup order).
    const isCarried = masterId
      ? carriedMasterIds.has(masterId)
      : carriedPurchaseIds.has(purchaseMatch.id);

    // "updated-master" if the CSV carries any enriching field beyond name —
    // the RPC's COALESCE-on-non-empty update fires whenever such a field is
    // present (and the master row already exists). Otherwise it's a carried
    // status: already-carried vs newly-carried.
    const enriches = !!(row.brand || row.size || row.upc || row.category || row.sku);
    if (enriches) {
      return { row, status: 'updated-master' as const, matchedId: purchaseMatch.id, matchedName: purchaseMatch.name };
    }
    if (isCarried) {
      return { row, status: 'already-carried' as const, matchedId: purchaseMatch.id, matchedName: purchaseMatch.name };
    }
    return { row, status: 'newly-carried' as const, matchedId: purchaseMatch.id, matchedName: purchaseMatch.name };
  });

  // Replace-mode removal — exact mirror of the RPC DELETE:
  //   master_item_id IS NULL AND purchase_item_id IS NOT NULL
  //   AND purchase_item_id NOT IN (csv pids)
  // Always computed so the preview is correct even if the caller toggles
  // replace mode after parsing; callers gate the DISPLAY on replaceMode. The
  // RPC still skips the delete entirely when the CSV is empty (csv pids = 0).
  let removeIds: string[] = [];
  if (csvPurchaseIds.length > 0) {
    const csvPidSet = new Set(csvPurchaseIds);
    removeIds = carried
      .filter(c => c.master_item_id == null && c.purchase_item_id != null && !csvPidSet.has(c.purchase_item_id))
      .map(c => c.purchase_item_id!);
  }

  return { fates, removeIds, unresolvedMasterCount };
}
