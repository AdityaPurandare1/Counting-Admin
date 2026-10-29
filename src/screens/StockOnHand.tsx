import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VENUES, isOrgWide } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { KountAudit, KountAvtReport, KountAvtRow } from '@/lib/types';
import { Card, Eyebrow, Btn, Num, Money } from '@/components/atoms';
import { loadLatestVenueReport } from '@/lib/latestVenueReport';
import { localIsoDate } from '@/lib/auditReport';

/* ───────────────────────────────────────────────────────────────────────
   Stock on hand (v0.41)

   Read-only "current complete inventory" for a selected venue. Sourced from
   the report of the venue's newest closed beverage count (v0.77,
   lib/latestVenueReport — kount_avt_reports + kount_avt_rows) — the same
   computed data the Variance screen uses, but framed as inventory rather
   than variance:

     - Counted      = actual (last physical count)
     - Theoretical  = theo   (start + purchases − depletions over the
                              count's window — i.e. what the system expected)
     - Δ qty        = counted − theo
     - On-hand $    = counted × cu_price

   It's "as of" the last count/compute (date shown in the header), not a
   live-to-this-minute perpetual — a true roll-forward would inherit the
   upstream purchase-line gaps, so the last physical count is the trustworthy
   anchor and theo is shown alongside it for context.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

export function StockOnHand({ user }: Props) {
  const visibleVenues = useMemo(() => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const [venue, setVenue]     = useState<string>('');
  const [audit, setAudit]     = useState<KountAudit | null>(null);
  const [report, setReport]   = useState<KountAvtReport | null>(null);
  const [rows, setRows]       = useState<KountAvtRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const requestRef = useRef(0);

  // Default to the first venue the user can see.
  useEffect(() => {
    if (!venue && visibleVenues.length > 0) setVenue(visibleVenues[0].id);
  }, [visibleVenues, venue]);

  const load = useCallback(async (venueId: string) => {
    if (!venueId) return;
    // Switching venues mid-load must not let the slower answer win.
    const req = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    // Drop the previous venue's numbers so its tiles, as-of line and CSV can't
    // pass for this venue's while it loads.
    setAudit(null); setReport(null); setRows([]);
    // v0.77: the venue's newest closed beverage count, then THAT audit's
    // report — not the newest report by upload time (lib/latestVenueReport).
    try {
      const res = await loadLatestVenueReport(venueId);
      if (req !== requestRef.current) return;
      setAudit(res.audit);
      setReport(res.report);
      setRows(res.rows);
    } catch (e) {
      if (req !== requestRef.current) return;
      console.error('[stock-on-hand] load', e);
      setAudit(null); setReport(null); setRows([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { if (venue) void load(venue); }, [venue, load]);

  const enriched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .map(r => {
        const counted = Number(r.actual ?? 0);
        const theo    = Number(r.theo ?? 0);
        const cost    = Number(r.cu_price ?? 0);
        return { ...r, counted, theo, cost, diff: counted - theo, onHandValue: counted * cost, theoValue: theo * cost };
      })
      .filter(r => !q || (r.item_name ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.onHandValue - a.onHandValue);
  }, [rows, search]);

  const totals = useMemo(() => {
    let items = 0, onHand = 0, theoV = 0;
    for (const r of enriched) { items++; onHand += r.onHandValue; theoV += r.theoValue; }
    return { items, onHand, theoV, diffV: onHand - theoV };
  }, [enriched]);

  const venueName = visibleVenues.find(v => v.id === venue)?.name ?? venue;

  const exportCsv = useCallback(() => {
    if (enriched.length === 0) return;
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['Item', 'Category', 'Counted (on hand)', 'Theoretical', 'Difference', 'Unit cost', 'On-hand value'];
    const lines = [header.join(',')];
    for (const r of enriched) {
      lines.push([r.item_name, r.category ?? '', r.counted, r.theo, r.diff.toFixed(2), r.cost.toFixed(2), r.onHandValue.toFixed(2)].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = localIsoDate(new Date());
    const slug = venueName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'venue';
    a.download = `stock_on_hand_${slug}_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Deferred revoke, matching Catalog/Counts/Summary: revoking the object
    // URL in the same tick as click() can abort the download before the
    // browser has finished reading the blob. Worst for the XLSX workbooks,
    // which are by far the largest payloads we emit.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [enriched, venueName]);

  const asOf = report ? new Date(report.computed_at ?? report.uploaded_at) : null;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Inventory</div>
          <h1>Stock on hand</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={venue} onChange={e => setVenue(e.target.value)} style={pickerStyle}>
            {visibleVenues.length === 0 && <option value="">No venues</option>}
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <Btn variant="secondary" size="sm" onClick={() => void load(venue)} disabled={!venue || loading}>Refresh</Btn>
          <Btn variant="secondary" size="sm" onClick={exportCsv} disabled={loading || enriched.length === 0}>Export CSV</Btn>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card padding={14}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Tile label="Items" value={loading ? '—' : <Num value={totals.items} />} />
            <Tile label="On-hand value" value={loading ? '—' : <Money value={totals.onHand} />} />
            <Tile label="Theoretical value" value={loading ? '—' : <Money value={totals.theoV} />} />
            <Tile label="Difference" value={loading ? '—' : <Money value={totals.diffV} showSign />} />
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--fg-muted)' }}>
            {loadError
              ? <span style={{ color: 'var(--raspberry-300)' }}>Inventory could not be loaded — {loadError}</span>
              : asOf
              ? <><strong>Counted</strong> = last physical count · <strong>Theoretical</strong> = expected (start + purchases − depletions) · as of <strong>{asOf.toLocaleDateString()}</strong> ({audit ? audit.join_code + ', ' : ''}{report?.source === 'computed' ? 'computed' : 'uploaded'} report). Items with no unit cost show $0 value.</>
              : audit
              ? <>The latest closed count ({audit.join_code}{audit.completed_at ? ', closed ' + new Date(audit.completed_at).toLocaleDateString() : ''}) has no inventory report yet — closed counts are computed within 15 minutes.</>
              : loading ? 'Loading…' : 'No closed count for this venue yet — run and close a count to generate one.'}
          </div>
        </Card>

        <Card padding={16}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 }}>
            <Eyebrow>Complete inventory — {venueName}</Eyebrow>
            <input
              placeholder="Search item…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...pickerStyle, minWidth: 200 }}
            />
          </div>
          {loading && <div style={{ color: 'var(--fg-muted)' }}>Loading…</div>}
          {!loading && !loadError && enriched.length === 0 && (
            <div style={{ color: 'var(--fg-muted)' }}>
              {report ? 'No items match.' : 'No inventory data for this venue yet.'}
            </div>
          )}
          {!loading && loadError && (
            <div style={{ color: 'var(--raspberry-300)' }}>Could not load this venue's inventory. Use Refresh to try again.</div>
          )}
          {!loading && enriched.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={th}>Item</th>
                  <th style={th}>Category</th>
                  <th style={{ ...th, textAlign: 'right' }}>Counted</th>
                  <th style={{ ...th, textAlign: 'right' }}>Theo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Δ qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Unit $</th>
                  <th style={{ ...th, textAlign: 'right' }}>On-hand $</th>
                </tr>
              </thead>
              <tbody>
                {enriched.slice(0, 500).map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.item_name}</td>
                    <td style={{ ...td, color: 'var(--fg-muted)', fontSize: 12 }}>{r.category ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(r.counted)}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg-muted)' }}>{fmt(r.theo)}</td>
                    <td style={{ ...td, textAlign: 'right' }}><Num value={r.diff} signed /></td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--fg-muted)' }}><Money value={r.cost} /></td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}><Money value={r.onHandValue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {enriched.length > 500 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>showing 500 of {enriched.length} · sorted by on-hand value</div>
          )}
        </Card>
      </div>
    </>
  );
}

const pickerStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border-strong)',
  borderRadius: 6, fontFamily: 'inherit', fontSize: 13,
};
const th: React.CSSProperties = { padding: '6px 4px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 4px', verticalAlign: 'top' };
const fmt = (n: number) => (Number.isFinite(n) ? (n % 1 === 0 ? String(n) : n.toFixed(2)) : '—');

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
