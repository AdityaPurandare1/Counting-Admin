/** Shared row shapes, kept in lockstep with 0001_multi_user_audits.sql. */

/** Counting-App scope: bar / bev / liquor / wine / mixers / beer. Food,
 *  produce, supplies, and services categories are intentionally excluded
 *  from any master_items query the count flow makes. Includes the
 *  lowercase + Title-case variants because the upstream catalog has
 *  inconsistent casing.
 *
 *  Mirror of the IN_SCOPE_CATEGORIES constant in the phone app's
 *  counting-app.html and the WHERE clause in migration 0024. */
export const IN_SCOPE_CATEGORIES = [
  'Wine Cost', 'wine', 'Wine',
  'Liquor Cost', 'liquor', 'Liquor',
  'Beer Cost', 'beer',
  'N/A Beverage Cost', 'non_alcoholic_beverage',
  'Bar Consumables', 'bar_consumable',
  'Bar Supplies',
] as const;

/** PostgREST in.(...) format — values with spaces / slashes need quoting. */
export const IN_SCOPE_FILTER = 'category=in.(' +
  IN_SCOPE_CATEGORIES.map(c => '"' + c.replace(/"/g, '\\"') + '"').join(',') +
  ')';

export type Role = 'corporate' | 'manager' | 'counter';
export type AuditStatus = 'active' | 'submitted' | 'cancelled';
export type CountPhase = 'count1' | 'review' | 'count2' | 'final';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'WATCH' | 'LOW';

export interface PurchaseItem {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  upc: string | null;
  brand: string | null;
  size: string | null;
  base_uom: string | null;
  is_active: boolean | null;
  organization_id: string | null;
  /** Path B: every purchase_item links to its canonical master_item. */
  master_item_id: string | null;
}

/** Mirror of public.master_items (no migration in this repo — the table
 *  predates the kount_* schema). master_items is the canonical product
 *  catalog: one row per real product+size variant. purchase_items is the
 *  procurement table (vendor SKUs, cost tiers); each purchase_item links
 *  to a master via master_item_id.
 *
 *  Counting (carried, scans, entries) targets master_items post Path B. */
export interface MasterItem {
  id: string;
  organization_id: string | null;
  name: string;
  category: string | null;
  subcategory: string | null;
  base_unit: string | null;
  base_size: number | null;
  pour_size_oz: number | null;
  is_bottle_service: boolean | null;
  is_active: boolean | null;
  product_id: string | null;
}

/** Mirror of public.master_item_upcs (migration 0020). Many-UPCs-per-master
 *  mapping that replaces the single purchase_items.upc column. A bottle
 *  legitimately carrying multiple barcodes (front label + back label +
 *  multipack outer) gets multiple rows; each upc_normalized resolves to
 *  exactly one master_item. */
export interface MasterItemUpc {
  id: string;
  master_item_id: string;
  upc_raw: string;
  upc_normalized: string;
  source: string;
  notes: string | null;
  added_by_email: string | null;
  added_at: string;
}

/** Mirror of public.master_item_upcs_review (migration 0022). Holding
 *  table for UPCs from the purchase_items.upc backfill that couldn't be
 *  unambiguously linked to one master. Surfaced in the Approvals queue
 *  for human reconciliation. */
export interface MasterItemUpcReview {
  id: string;
  upc_raw: string;
  upc_normalized: string;
  candidate_masters: Array<{ id: string; name: string; base_size?: number | null; base_unit?: string | null }>;
  lookup_title: string | null;
  lookup_brand: string | null;
  lookup_size_text: string | null;
  lookup_size_ml: number | null;
  lookup_source: string | null;
  reason: 'not_found' | 'no_size' | 'size_no_match' | 'multiple_size_match' | 'no_candidates' | string;
  resolved_master_id: string | null;
  resolved_at: string | null;
  resolved_by_email: string | null;
  resolved_notes: string | null;
  added_at: string;
}

export interface UpcMapping {
  id: string;
  barcode_raw: string;
  barcode_normalized: string | null;
  /** Legacy — kept for migration history. Post Path B, scans link via
   *  master_item_id and the approve_upc_mapping RPC inserts into
   *  master_item_upcs instead of touching purchase_items.upc. */
  purchase_item_id: string | null;
  master_item_id: string | null;
  item_name: string;
  item_brand: string | null;
  item_category: string | null;
  submitted_by_email: string;
  submitted_by_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by_email: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
}

export interface KountAudit {
  id: string;
  venue_id: string;
  venue_name: string;
  status: AuditStatus;
  count_phase: CountPhase;
  join_code: string;
  started_by_email: string;
  started_by_name: string | null;
  started_at: string;
  count1_closed_at: string | null;
  count2_closed_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

export interface KountMember {
  id: string;
  audit_id: string;
  user_email: string;
  user_name: string | null;
  role: Role;
  assigned_zones: string[];
  joined_at: string;
  last_seen_at: string;
}

export interface KountEntry {
  id: string;
  audit_id: string;
  /** Legacy — points at purchase_items.id on pre-Path-B rows. Post Path B
   *  (migration 0025) the phone writes both this AND master_item_id. */
  item_id: string | null;
  /** Path B: canonical master_items.id. Prefer this for joins/display. */
  master_item_id: string | null;
  item_name: string;
  category: string | null;
  qty: number;
  zone: string;
  method: string | null;
  issue: string | null;
  issue_notes: string | null;
  sku: string | null;
  upc: string | null;
  counted_by_email: string;
  counted_by_name: string | null;
  is_recount: boolean;
  photo_id: string | null;
  timestamp: string;
  /** From migration 0004 — resolution trail for flagged issues. */
  issue_resolved?: boolean;
  issue_resolved_by?: string | null;
  issue_resolved_at?: string | null;
}

export interface KountAvtReport {
  id: string;
  uploaded_by_email: string;
  uploaded_by_name: string | null;
  uploaded_at: string;
  file_name: string | null;
  row_count: number;
  venue_ids: string[];
  notes: string | null;
  source: 'uploaded' | 'computed';
  audit_id: string | null;
  computed_at: string | null;
}

export interface KountAvtRow {
  id: string;
  report_id: string;
  store: string | null;
  venue_id: string;
  venue_name: string | null;
  item_name: string;
  category: string | null;
  actual: number | null;
  theo: number | null;
  variance: number | null;
  variance_value: number | null;
  variance_pct: number | null;
  cu_price: number | null;
  start_qty: number | null;
  purchases: number | null;
  depletions: number | null;
}

export interface KountCarriedItem {
  /** Legacy — Path B writes master_item_id instead. Some legacy rows still
   *  have this populated; new writes should leave it null. */
  purchase_item_id: string | null;
  /** Post Path B (migration 0023): the canonical product carried. */
  master_item_id: string | null;
  added_by_email: string;
  added_by_name: string | null;
  added_at: string;
  notes: string | null;
}

/** Mirror of public.kount_venue_zones (migration 0008). User-added zones
 *  per venue. Default hardcoded zones live in venueMap.ts and are NOT
 *  stored here — only counter/admin additions land in this table. */
export interface KountVenueZone {
  id: string;
  venue_id: string;
  zone_name: string;
  added_by_email: string | null;
  added_by_name: string | null;
  added_at: string;
}

/** Mirror of public.venues (migration 0013). The single source of truth for
 *  venues — replaces the four hardcoded copies that lived in the phone app's
 *  appState.venues, the admin's VENUES const, STORE_MAP, and DEFAULT_VENUE_ZONES.
 *  Soft-deleted (is_active=false) venues stay queryable so historic audits
 *  resolve their venue_name, but are hidden from new-audit pickers. */
export interface VenueRow {
  id: string;
  name: string;
  address: string | null;
  default_zones: string[];
  store_aliases: string[];
  ordinal: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Mirror of public.kount_pending_items (migration 0009). New-item suggestions
 *  submitted by counters/managers when they hit a gap in the catalog. Admin
 *  approves → approve_pending_item RPC mints a purchase_items row and links it
 *  via purchase_item_id. */
export interface KountPendingItem {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  size: string | null;
  upc: string | null;
  notes: string | null;
  submitted_by_email: string;
  submitted_by_name: string | null;
  submitted_at: string;
  audit_id: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by_email: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  /** Legacy — Path B replaces this with master_item_id. The new
   *  approve_pending_item RPC mints a master_items row and writes
   *  its id into master_item_id below. */
  purchase_item_id: string | null;
  master_item_id: string | null;
}

export interface KountRecount {
  id: string;
  audit_id: string;
  item_id: string | null;
  // Migration 0029 — Path B forward read path; item_id stays for back-compat.
  // Null on AVT/name-derived recount rows that have no master_items link.
  master_item_id?: string | null;
  item_name: string;
  severity: Severity;
  variance_value: number | null;
  count1_qty: number | null;
  count2_qty: number | null;
  status: 'pending' | 'done' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
  // Migration 0014 — recount audit decision + admin Reports columns.
  audit_result?: 'corrected' | 'verified' | null;
  audit_reason?: string | null;
  zone?: string | null;
  category?: string | null;
  counter_initials?: string | null;
  variance_qty?: number | null;
}
