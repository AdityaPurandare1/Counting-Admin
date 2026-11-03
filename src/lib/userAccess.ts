import type { Role } from './types';
import { FEATURES, PROJECTS, ROLES, roleLabel, templateFor } from './permissions';

/* The User access editor's logic (v0.96): one person's roles (one primary), permissions and venues, as a
 * draft that is saved in one go. Roles are templates — ticking a role adds its permissions; unticking it
 * leaves the person's ticks alone (untick them, or Reset to their roles). */

export interface AccessRow { email: string; name: string | null; role: Role; roles?: Role[] | null; features?: string[] | null; venue_ids: string[] | null; is_active: boolean }
export interface AccessDraft { role: Role; roles: Role[]; features: string[]; venueIds: string[] }

const inCatalogOrder = (keys: Iterable<string>) => { const on = new Set(keys); return FEATURES.map(f => f.key).filter(k => on.has(k)); };

export function accessDraft(r: AccessRow): AccessDraft {
  const roles = r.roles?.length ? r.roles : [r.role];
  return { role: r.role, roles: ROLES.map(x => x.role).filter(x => roles.includes(x)), features: inCatalogOrder(r.features ?? templateFor(roles)), venueIds: [...(r.venue_ids ?? [])] };
}

/** Tick a role: it joins (with its permissions added). Untick: it leaves (permissions kept); never the last one;
 *  the primary moves to the first role left. */
export function toggleRole(d: AccessDraft, role: Role): AccessDraft {
  if (d.roles.includes(role)) {
    if (d.roles.length === 1) return d;
    const roles = d.roles.filter(r => r !== role);
    return { ...d, roles, role: d.role === role ? roles[0] : d.role };
  }
  const roles = ROLES.map(x => x.role).filter(r => r === role || d.roles.includes(r));
  return { ...d, roles, features: inCatalogOrder([...d.features, ...templateFor([role])]) };
}

export const setPrimary = (d: AccessDraft, role: Role): AccessDraft => (d.roles.includes(role) ? { ...d, role } : d);
export const toggleFeature = (d: AccessDraft, key: string): AccessDraft =>
  ({ ...d, features: d.features.includes(key) ? d.features.filter(k => k !== key) : inCatalogOrder([...d.features, key]) });
export const toggleVenue = (d: AccessDraft, id: string): AccessDraft =>
  ({ ...d, venueIds: d.venueIds.includes(id) ? d.venueIds.filter(v => v !== id) : [...d.venueIds, id] });
/** Back to exactly what their roles give. */
export const resetToRoles = (d: AccessDraft): AccessDraft => ({ ...d, features: templateFor(d.roles) });

/** "n of m" per project. */
export const allowedIn = (features: readonly string[], projectKey: string) => {
  const p = PROJECTS.find(x => x.key === projectKey);
  return { n: p ? p.features.filter(f => features.includes(f.key)).length : 0, m: p?.features.length ?? 0 };
};

/** What Save would change, in words (empty = nothing). */
export function accessChanges(a: AccessDraft, b: AccessDraft): string[] {
  const out: string[] = [];
  const label = (k: string) => FEATURES.find(f => f.key === k)?.label ?? k;
  const added = b.roles.filter(r => !a.roles.includes(r)), removed = a.roles.filter(r => !b.roles.includes(r));
  if (added.length) out.push(`role ${added.map(roleLabel).join(', ')} added`);
  if (removed.length) out.push(`role ${removed.map(roleLabel).join(', ')} removed`);
  if (a.role !== b.role) out.push(`primary role ${roleLabel(b.role)}`);
  const on = b.features.filter(k => !a.features.includes(k)), off = a.features.filter(k => !b.features.includes(k));
  if (on.length) out.push(`allowed: ${on.map(label).join(', ')}`);
  if (off.length) out.push(`not allowed: ${off.map(label).join(', ')}`);
  const vOn = b.venueIds.filter(v => !a.venueIds.includes(v)), vOff = a.venueIds.filter(v => !b.venueIds.includes(v));
  if (vOn.length || vOff.length) out.push(`venues ${[...vOn.map(v => `+${v}`), ...vOff.map(v => `−${v}`)].join(' ')}`);
  return out;
}

/** Why it cannot be saved (empty = it can). `self`: the signed-in person editing their own access. */
export function accessProblems(d: AccessDraft, self: boolean): string[] {
  const out: string[] = [];
  if (!d.roles.length || !d.roles.includes(d.role)) out.push('Pick at least one role, and its primary.');
  if (self && !d.features.includes('access:users')) out.push('You cannot take User access away from yourself — another admin has to.');
  return out;
}

/** Worth a warning, not a stop: venue-scoped permissions with no venue picked see nothing. */
export const noVenues = (d: AccessDraft) => !d.features.includes('access:all-venues') && !d.venueIds.length && d.features.some(k => !k.startsWith('access:') && !k.startsWith('purchasing:'));
