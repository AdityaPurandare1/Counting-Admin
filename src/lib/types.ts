/** Shared row shapes, kept in lockstep with 0001_multi_user_audits.sql. */

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
}

export interface UpcMapping {
  id: string;
  barcode_raw: string;
  barcode_normalized: string | null;
  purchase_item_id: string | null;
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
  item_id: string | null;
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
  purchase_item_id: string;
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
  purchase_item_id: string | null;
}

export interface KountRecount {
  id: string;
  audit_id: string;
  item_id: string | null;
  item_name: string;
  severity: Severity;
  variance_value: number | null;
  count1_qty: number | null;
  count2_qty: number | null;
  status: 'pending' | 'done' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
}
