import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Btn, Card, Eyebrow, Money } from '@/components/atoms';

/* Data-gap cards for venues whose purchases come from R365 invoice matching
 * (kount_venues.purchase_mapping = 'venue_item_map', migration 0064).
 *
 *  - UnplacedInvoicesCard: R365 "Missing Vendor Item" lines in this audit's variance
 *    window that are not placed on a counted item (migration 0077,
 *    kount_unplaced_invoice_lines). 0074 keeps them out of the variance rows; this
 *    is where the dollars are shown instead.
 *  - UnmappedPosCard: POS items selling with no bottle or recipe link
 *    (kount_unmapped_pos_items), so new menu items get mapped before they skew
 *    a count.
 * Both RPCs are gated by kount_can_see_venue: a user who cannot see the venue
 * gets no rows. */

export interface UnplacedLine {
  vendor: string; invoice_number: string; invoice_date: string; gl_code: string; description: string;
  qty: number; unit_cost: number; line_total: number; is_beverage: boolean;
}
export interface UnmappedPosItem {
  pos_item: string; category: string | null; qty: number; net_sales: number; first_sold: string; last_sold: string;
}

/** Totals for the card header; exported for the unit test. */
export function summarizeUnplaced(lines: UnplacedLine[]) {
  let bev = 0, other = 0, bevLines = 0;
  const byVendor = new Map<string, number>();
  for (const l of lines) {
    const t = Number(l.line_total) || 0;
    if (l.is_beverage) {
      bev += t; bevLines++;
      byVendor.set(l.vendor, (byVendor.get(l.vendor) ?? 0) + t);
    } else other += t;
  }
  const vendors = [...byVendor.entries()].sort((a, b) => b[1] - a[1]);
  return { bev, other, bevLines, otherLines: lines.length - bevLines, vendors };
}

const th = { padding: '6px 8px', textAlign: 'left' as const, fontWeight: 600, fontSize: 11, color: 'var(--fg-muted)' };
const td = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--border)' };

export function UnplacedInvoicesCard({ auditId, reportId }: { auditId: string; reportId: string | null }) {
  const [lines, setLines] = useState<UnplacedLine[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!reportId) { setLines(null); return; }
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc('kount_unplaced_invoice_lines', { p_audit_id: auditId });
      if (!live) return;
      if (error) { console.error('[variance] unplaced invoice lines', error); setErr(error.message); setLines([]); return; }
      setErr(null);
      setLines((data as UnplacedLine[]) ?? []);
    })();
    return () => { live = false; };
  }, [auditId, reportId]);

  const s = useMemo(() => summarizeUnplaced(lines ?? []), [lines]);
  if (!reportId || lines === null) return null;
  const bevRows = lines.filter(l => l.is_beverage);

  return (
    <Card padding={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Eyebrow>Invoices not placed on counted items</Eyebrow>
          {err
            ? <span style={{ fontSize: 12, color: 'var(--raspberry-300)' }}>Could not load: {err}</span>
            : lines.length === 0
              ? <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Every invoice line in this count's window is placed.</span>
              : <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                  R365 lines entered as "Missing Vendor Item" (no product named) in this count's window. They are kept out of the variance rows above.
                </span>}
        </div>
        {bevRows.length > 0 && (
          <Btn variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>{open ? 'Hide lines' : `Show ${bevRows.length} beverage lines`}</Btn>
        )}
      </div>
      {lines.length > 0 && !err && (
        <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Beverage accounts ({s.bevLines} lines)</div><Money value={s.bev} size={18} /></div>
          <div><div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Food and other ({s.otherLines} lines, not counted)</div><Money value={s.other} size={18} bold={false} /></div>
          {s.vendors.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', alignSelf: 'flex-end' }}>
              {s.vendors.slice(0, 4).map(([v, t]) => `${v} $${Math.round(t).toLocaleString()}`).join(' · ')}
            </div>
          )}
        </div>
      )}
      {open && bevRows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Vendor</th><th style={th}>Invoice</th><th style={th}>Date</th><th style={th}>Account</th><th style={{ ...th, textAlign: 'right' }}>Qty × price</th><th style={{ ...th, textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {bevRows.slice(0, 300).map((l, i) => (
                <tr key={i}>
                  <td style={td}>{l.vendor}</td>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{l.invoice_number}</td>
                  <td style={td}>{l.invoice_date}</td>
                  <td style={td}>{l.gl_code}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{Number(l.qty)} × ${Number(l.unit_cost).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: 'right' }}><Money value={Number(l.line_total)} size={12} bold={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function UnmappedPosCard({ venueId, days = 14 }: { venueId: string; days?: number }) {
  const [items, setItems] = useState<UnmappedPosItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc('kount_unmapped_pos_items', { p_venue_id: venueId, p_days: days });
      if (!live) return;
      if (error) { console.error('[variance] unmapped POS items', error); setErr(error.message); setItems([]); return; }
      setErr(null);
      setItems((data as UnmappedPosItem[]) ?? []);
    })();
    return () => { live = false; };
  }, [venueId, days]);

  if (items === null) return null;
  const total = items.reduce((t, i) => t + (Number(i.net_sales) || 0), 0);

  return (
    <Card padding={16}>
      <Eyebrow>POS items selling with no bottle link · last {days} days</Eyebrow>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
        {err ? <span style={{ color: 'var(--raspberry-300)' }}>Could not load: {err}</span>
          : items.length === 0 ? 'Every drink sold in this period depletes a bottle or recipe.'
          : <>These sales take nothing off the shelf, so their bottles look short at the next count. {items.length} items, <Money value={total} size={12} bold={false} /> in sales.</>}
      </div>
      {items.length > 0 && !err && (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>POS item</th><th style={th}>Category</th><th style={{ ...th, textAlign: 'right' }}>Sold</th><th style={{ ...th, textAlign: 'right' }}>Sales</th><th style={th}>Last sold</th></tr></thead>
            <tbody>
              {items.slice(0, 25).map(i => (
                <tr key={i.pos_item}>
                  <td style={td}>{i.pos_item}</td>
                  <td style={{ ...td, color: 'var(--fg-muted)' }}>{i.category ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{Number(i.qty)}</td>
                  <td style={{ ...td, textAlign: 'right' }}><Money value={Number(i.net_sales)} size={12} bold={false} /></td>
                  <td style={{ ...td, color: 'var(--fg-muted)' }}>{i.last_sold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* v0.68 -- the same pre-close checks the phone shows before Count 1 closes (migration 0078,
 * kount_count_guardrails): empty zones, items missing since the last count, bottle-size switches,
 * counts far below a recent delivery, and invoice weeks missing for regular vendors. */
export interface GuardrailRow { kind: string; message: string; sort_value: number | null }

export const GUARDRAIL_LABELS: Record<string, string> = {
  zone_empty: 'Zones with stock last time, nothing counted now',
  low_after_delivery: 'Counts far below recent deliveries',
  size_switch: 'Possibly the wrong bottle size',
  not_counted: 'Items counted last time, missing now',
  invoice_gap: 'Invoices missing (the variance will look short)',
};
export const GUARDRAIL_ORDER = ['zone_empty', 'low_after_delivery', 'size_switch', 'not_counted', 'invoice_gap'];

/** Group rows by kind in display order; unknown kinds go last. Exported for the unit test. */
export function groupGuardrails(rows: GuardrailRow[]): Array<[string, GuardrailRow[]]> {
  const by = new Map<string, GuardrailRow[]>();
  for (const r of rows) by.set(r.kind, [...(by.get(r.kind) ?? []), r]);
  const kinds = [...GUARDRAIL_ORDER.filter(k => by.has(k)), ...[...by.keys()].filter(k => !GUARDRAIL_ORDER.includes(k))];
  return kinds.map(k => [k, by.get(k)!]);
}

export function CountChecksCard({ auditId, isOpen }: { auditId: string; isOpen: boolean }) {
  const [rows, setRows] = useState<GuardrailRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc('kount_count_guardrails', { p_audit_id: auditId });
      if (!live) return;
      if (error) { console.error('[variance] count checks', error); setErr(error.message); setRows([]); return; }
      setErr(null);
      setRows((data as GuardrailRow[]) ?? []);
    })();
    return () => { live = false; };
  }, [auditId]);

  if (rows === null) return null;
  const groups = groupGuardrails(rows);

  return (
    <Card padding={16}>
      <Eyebrow>{isOpen ? 'Check before closing' : 'Count checks'}</Eyebrow>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
        {err ? <span style={{ color: 'var(--raspberry-300)' }}>Could not load: {err}</span>
          : rows.length === 0 ? 'Nothing flagged against the previous count or the invoice feed.'
          : isOpen ? 'Compared with the previous count and the invoice feed. The phone shows the same list before Count 1 closes.'
          : 'What this count missed compared with the previous one, and invoices missing in its window.'}
      </div>
      {groups.map(([kind, items]) => (
        <div key={kind} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{GUARDRAIL_LABELS[kind] ?? kind} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({items.length})</span></div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {items.slice(0, 12).map((r, i) => <li key={i} style={{ padding: '2px 0' }}>{r.message}</li>)}
            {items.length > 12 && <li style={{ color: 'var(--fg-muted)' }}>…and {items.length - 12} more</li>}
          </ul>
        </div>
      ))}
    </Card>
  );
}
