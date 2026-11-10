import { can, type Who } from './access';

/** The desktop's screens by sidebar group, each with the permission that opens it (v0.96). The Sidebar draws
 *  these; App.tsx's routes check the same keys; firstRoute picks where a person lands. */
export interface NavItem { to: string; label: string; key: string }

export const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Audit', items: [
    { to: '/overview', label: 'Overview', key: 'audit:overview' },
    { to: '/venues', label: 'Venues', key: 'audit:view' },
    { to: '/variance', label: 'Variance', key: 'audit:view' },
    { to: '/item-history', label: 'Item history', key: 'audit:view' },
    { to: '/counts', label: 'Counts', key: 'audit:counts' },
    { to: '/recount', label: 'Recount', key: 'audit:view' },
    { to: '/summary', label: 'Summary', key: 'audit:view' },
  ] },
  { group: 'Team', items: [
    { to: '/issues', label: 'Issues tracker', key: 'team:issues' },
    { to: '/ai', label: 'Ask AI', key: 'team:ask-ai' },
  ] },
  // org-wide money data (the RPC / RLS check the same permissions)
  { group: 'Purchasing', items: [
    { to: '/order-tracker', label: 'Order tracker', key: 'purchasing:order-tracker' },
    { to: '/order-prices', label: 'Order prices', key: 'purchasing:order-prices' },
    { to: '/purchase-prices', label: 'Liquor & wine prices', key: 'purchasing:liquor-wine' },
    { to: '/order-tracker-view', label: 'Order tracker (view)', key: 'purchasing:order-tracker-view' },
  ] },
  { group: 'Admin', items: [
    { to: '/approvals', label: 'Approvals', key: 'admin:approvals' },
    { to: '/stock', label: 'Stock on hand', key: 'admin:stock' },
    { to: '/food', label: 'Food count', key: 'admin:food-count' },
    { to: '/reports', label: 'Reports', key: 'admin:reports' },
    { to: '/transfers', label: 'Transfers', key: 'admin:transfers' },
    // v0.72: Inventory archived (not needed for now). Restore a row here and the /inventory route in App.tsx.
    { to: '/catalog', label: 'Catalog', key: 'admin:catalog' },
    { to: '/venue-settings', label: 'Venue settings', key: 'admin:venue-settings' },
    { to: '/user-access', label: 'User access', key: 'access:users' },
    { to: '/security', label: 'Security', key: 'access:users' },
  ] },
];

/** The screens this person may open, by group (empty groups left out). */
export const navFor = (u: Who) => NAV.map(g => ({ group: g.group, items: g.items.filter(i => can(u, i.key)) })).filter(g => g.items.length);

/** Where a person lands: Variance when they may see it (as before), else the first screen they may open. */
export function firstRoute(u: Who): string {
  if (can(u, 'audit:view')) return '/variance';
  return navFor(u)[0]?.items[0]?.to ?? '/variance';
}
