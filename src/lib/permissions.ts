import type { Role } from './types';

/* Per-person permissions (0148). Each person has roles (one primary) and their own list of permission keys
 * ("project:feature"). Roles are templates: ticking a role adds its permissions; after that a person's ticks
 * are their own — changing a template never changes people already set up.
 *
 * This list is the one source: migration 0148 seeds kount_features / kount_role_templates from it (a test
 * compares them), the database checks the same keys (kount_has_feature), and every screen asks `can()`.
 * The templates reproduce exactly what each role could do before permissions existed. */

export interface Feature { key: string; label: string; description: string }
export interface Project { key: string; label: string; features: Feature[] }

export const PROJECTS: Project[] = [
  { key: 'audit', label: 'Audit', features: [
    { key: 'audit:view', label: 'Venues, variance & history', description: 'Venues, Variance, Item history, Recount and Summary for their venues' },
    { key: 'audit:overview', label: 'Overview', description: 'The audit overview: every venue\'s counts at a glance' },
    { key: 'audit:counts', label: 'Counts', description: 'Open counts, close Count 1, finish a count, drill into items' },
    { key: 'audit:edit-counts', label: 'Correct counts', description: 'Change a counted quantity after the count (their venues)' },
    { key: 'audit:delete-lines', label: 'Delete count lines', description: 'Remove a count line from an audit' },
    { key: 'audit:manage', label: 'Manage audits', description: 'Cancel, reopen, reactivate and delete audits; dismiss recounts; clear stale audits' },
    { key: 'audit:costs', label: 'Costs in audit reports', description: 'Item costs in the month-end audit report' },
  ] },
  { key: 'team', label: 'Team', features: [
    { key: 'team:issues', label: 'Issues tracker', description: 'See and resolve the issues counters raise' },
    { key: 'team:ask-ai', label: 'Ask AI', description: 'Ask questions about counts and variance' },
    { key: 'team:ask-ai-orders', label: 'Ask AI about orders', description: 'Ask AI about orders, payments, stock and the venue bibles' },
  ] },
  { key: 'admin', label: 'Admin', features: [
    { key: 'admin:approvals', label: 'Approvals', description: 'Approve or reject new barcodes and items' },
    { key: 'admin:force-approve', label: 'Force-approve barcodes', description: 'Commit a barcode directly when Approve fails' },
    { key: 'admin:stock', label: 'Stock on hand', description: 'Stock on hand by venue' },
    { key: 'admin:reports', label: 'Reports', description: 'Variance and audit reports' },
    { key: 'admin:transfers', label: 'Transfers', description: 'Record transfers between venues' },
    { key: 'admin:transfers-manage', label: 'Delete any transfer', description: 'Delete transfers other people recorded' },
    { key: 'admin:food-count', label: 'Food count', description: 'Upload a food count (their venues)' },
    { key: 'admin:catalog', label: 'Catalog', description: 'Items, barcodes, merges and imports' },
    { key: 'admin:venue-settings', label: 'Venue settings', description: 'Venues, zones and how each venue counts' },
  ] },
  { key: 'purchasing', label: 'Purchasing', features: [
    { key: 'purchasing:order-tracker', label: 'Order tracker', description: 'Orders, the Inbox, warehouse stock and the bibles' },
    { key: 'purchasing:order-prices', label: 'Order prices', description: 'Prices paid on orders and quotes' },
    { key: 'purchasing:liquor-wine', label: 'Liquor & wine prices', description: 'Liquor and wine bottle prices and spend' },
    // v1.08 (0167): ticked per person, never part of a role
    { key: 'purchasing:order-tracker-view', label: 'Order tracker (view)', description: "Their venues' orders, prices, tracking and documents, and the whole warehouse - view only" },
  ] },
  { key: 'access', label: 'Access', features: [
    { key: 'access:all-venues', label: 'All venues', description: 'Sees and runs every venue (corporate access); otherwise only the venues picked' },
    { key: 'access:users', label: 'User access', description: 'Add users; change roles, permissions and venues' },
  ] },
  { key: 'phone', label: 'Counting app', features: [
    { key: 'phone:count', label: 'Count', description: 'Count and scan at their venues on the phone' },
    { key: 'phone:run', label: 'Run counts', description: 'Start, close and submit counts at their venues' },
  ] },
];

export const FEATURES: Feature[] = PROJECTS.flatMap(p => p.features);
export const FEATURE_KEYS = new Set(FEATURES.map(f => f.key));
export const projectOf = (key: string) => key.split(':')[0];

export const ROLES: Array<{ role: Role; label: string }> = [
  { role: 'admin', label: 'Admin' }, { role: 'corporate', label: 'Corporate' }, { role: 'venue_manager', label: 'Venue Management' },
  { role: 'manager', label: 'Manager' }, { role: 'counter', label: 'Counter' },
];
export const roleLabel = (r: string) => ROLES.find(x => x.role === r)?.label ?? r;

/** Permissions only ever ticked per person (0167): in no role's template, not even Admin's. */
export const PER_PERSON_ONLY = new Set(['purchasing:order-tracker-view']);
const ALL = FEATURES.map(f => f.key).filter(k => !PER_PERSON_ONLY.has(k));
const VIEW_TEAM = ['audit:view', 'audit:overview', 'audit:counts', 'team:issues', 'team:ask-ai', 'admin:approvals', 'admin:stock', 'admin:reports', 'admin:transfers'];

/** What each role could do before permissions existed (App.tsx routes, the Sidebar, every screen's checks,
 *  and the database's role gates) — a new person with that role starts with exactly this. */
export const ROLE_TEMPLATES: Record<Role, string[]> = {
  admin: ALL,
  corporate: ALL.filter(k => k !== 'access:users'),
  venue_manager: [...VIEW_TEAM, 'audit:edit-counts'],
  manager: [...VIEW_TEAM, 'audit:costs', 'admin:food-count', 'phone:count', 'phone:run'],
  counter: ['phone:count'],
};

/** A person's starting permissions from their roles (the union of the templates), in catalog order. */
export function templateFor(roles: readonly Role[]): string[] {
  const on = new Set(roles.flatMap(r => ROLE_TEMPLATES[r] ?? []));
  return ALL.filter(k => on.has(k));
}

/** Uses the desktop app at all: any permission outside the phone's. */
export const usesDesktop = (features: readonly string[]) => features.some(k => FEATURE_KEYS.has(k) && projectOf(k) !== 'phone');
