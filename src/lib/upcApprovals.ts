import type { UpcMapping } from './types';

/* The barcode queue's logic (v0.97). A counter's scan arrives as an upc_mappings row; Approve links the barcode
 * to a catalog item (master_item_upcs) through approve_upc_mapping. That RPC needs the catalog item: the row's
 * own master_item_id, one the admin picks, or else an exact name match — and a name typed on the phone
 * ("Don Julio 1942 Anejo 750ml") rarely matches, which left the admin with "No master_items match the
 * item_name; admin must pick explicitly" and no way to pick. */

/** As the RPC stores it: digits only, no leading zeros. */
export const upcNorm = (raw: string | null | undefined) => (raw ?? '').trim().replace(/\D/g, '').replace(/^0+/, '');

export interface UpcGroup { key: string; rows: UpcMapping[]; first: UpcMapping }

/** The same barcode, name and catalog item sent more than once (a counter scanning twice) is one decision. */
export function groupPending(rows: readonly UpcMapping[]): UpcGroup[] {
  const out = new Map<string, UpcGroup>();
  for (const r of rows) {
    const key = [upcNorm(r.barcode_raw) || r.barcode_raw, r.item_name.trim().toLowerCase(), r.master_item_id ?? ''].join('|');
    const g = out.get(key);
    if (g) g.rows.push(r); else out.set(key, { key, rows: [r], first: r });
  }
  return [...out.values()];
}

export interface Owner { id: string; name: string }
export type LinkKind = 'new' | 'same' | 'other-owner' | 'no-item';

/** What Approve will do: link a new barcode / it is already on that item / it is on ANOTHER item (the RPC keeps
 *  it there — only Force moves it) / no catalog item yet (pick one). */
export function linkState(r: Pick<UpcMapping, 'barcode_raw' | 'master_item_id'>, owners: ReadonlyMap<string, Owner>): { kind: LinkKind; owner: Owner | null } {
  const owner = owners.get(upcNorm(r.barcode_raw)) ?? null;
  if (!r.master_item_id) return { kind: 'no-item', owner };
  if (!owner) return { kind: 'new', owner };
  return { kind: owner.id === r.master_item_id ? 'same' : 'other-owner', owner };
}

/** The RPC could not choose the catalog item itself. */
export const needsPick = (message: string | null | undefined) => /must pick explicitly/i.test(message ?? '');

/** Words to search the catalog with: the submitted name less sizes and filler ("Don Julio 1942 Anejo 750ml" -> "don julio"). */
export function searchTerm(itemName: string): string {
  const words = itemName.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !/^\d+(ml|l|oz|lt|cl)?$/.test(w) && !['ml', 'oz', 'lt', 'the'].includes(w));
  return words.slice(0, 2).join(' ');
}
