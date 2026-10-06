import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AccessEntry } from '@/lib/access';
import { VENUES } from '@/lib/access';
import { groupErrors, type ClientErrorRow } from '@/lib/clientErrors';
import { Card, Eyebrow, Pill, Btn } from '@/components/atoms';

/* ───────────────────────────────────────────────────────────────────────
   Errors (v0.66)

   Both apps write failures to kount_client_errors (0041), but nothing
   displayed that table — reading it meant querying the database by hand,
   so failures surfaced only when someone complained. This lists them,
   grouped so a repeated failure reads as one line ("recount sync failed —
   14x, 6 users, Poppy") instead of 14 near-identical rows.

   Read access: admin + corporate (migration 0063 adds the admin tier; until
   it is applied an admin-tier user simply sees no rows). The route is gated
   on hasCorporateAccess to match.
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }

type WindowChoice = '24h' | '7d' | '30d';
type AppChoice = 'all' | 'phone' | 'admin';
type ViewChoice = 'grouped' | 'all';

const ROW_LIMIT = 2000;
const HOURS: Record<WindowChoice, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

export function Errors(_props: Props) {
  const [window_, setWindow_] = useState<WindowChoice>('7d');
  const [app, setApp] = useState<AppChoice>('all');
  const [venue, setVenue] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewChoice>('grouped');
  const [rows, setRows] = useState<ClientErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const venueName = useCallback((id: string | null) => {
    if (!id) return '—';
    return VENUES.find(v => v.id === id)?.name ?? id;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    const cutoff = new Date(Date.now() - HOURS[window_] * 3_600_000).toISOString();
    let q = supabase
      .from('kount_client_errors')
      .select('*')
      .gte('occurred_at', cutoff)
      .order('occurred_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (app !== 'all') q = q.eq('app', app);
    if (venue) q = q.eq('venue_id', venue);
    const { data, error } = await q;
    setLoading(false);
    if (error) { setLoadErr(error.message); setRows([]); return; }
    setRows((data ?? []) as ClientErrorRow[]);
  }, [window_, app, venue]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      (r.context ?? '').toLowerCase().includes(s) ||
      (r.message ?? '').toLowerCase().includes(s) ||
      (r.user_email ?? '').toLowerCase().includes(s));
  }, [rows, search]);

  const groups = useMemo(() => groupErrors(filtered), [filtered]);
  const usersAffected = useMemo(() => new Set(filtered.map(r => r.user_email).filter(Boolean)).size, [filtered]);
  const truncated = rows.length >= ROW_LIMIT;

  return (
    <>
      <div className="topbar">
        <div>
          <Eyebrow>Errors</Eyebrow>
          <h1>App errors</h1>
          <div className="page-sub" style={{ marginTop: 4 }}>
            Failures recorded by the phone and admin apps, newest first. Repeats of the same problem are grouped.
          </div>
        </div>
      </div>

      <div className="content">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <select style={pickerStyle} value={window_} onChange={e => setWindow_(e.target.value as WindowChoice)}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <select style={pickerStyle} value={app} onChange={e => setApp(e.target.value as AppChoice)}>
            <option value="all">Both apps</option>
            <option value="phone">Phone app</option>
            <option value="admin">Admin app</option>
          </select>
          <select style={pickerStyle} value={venue} onChange={e => setVenue(e.target.value)}>
            <option value="">All venues</option>
            {VENUES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input style={{ ...pickerStyle, width: 220 }} placeholder="Search message, area, or user" value={search} onChange={e => setSearch(e.target.value)} />
          <select style={pickerStyle} value={view} onChange={e => setView(e.target.value as ViewChoice)}>
            <option value="grouped">Grouped</option>
            <option value="all">Every event</option>
          </select>
          <div style={{ flex: 1 }} />
          <Btn variant="secondary" size="sm" onClick={() => void load()}>Refresh</Btn>
        </div>

        {!loading && !loadErr && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Pill tone="neutral" size="sm">{filtered.length} error{filtered.length === 1 ? '' : 's'}</Pill>
            <Pill tone="neutral" size="sm">{groups.length} distinct problem{groups.length === 1 ? '' : 's'}</Pill>
            <Pill tone="neutral" size="sm">{usersAffected} user{usersAffected === 1 ? '' : 's'} affected</Pill>
          </div>
        )}

        {truncated && !loading && (
          <div style={banner}>⚠ Showing the newest {ROW_LIMIT} errors only — narrow the time window or filters to see the rest.</div>
        )}
        {loadErr && <div style={banner}>Could not load errors: {loadErr}</div>}

        <Card flush>
          {loading && <div style={empty}>Loading…</div>}
          {!loading && !loadErr && filtered.length === 0 && (
            <div style={empty}>
              No errors recorded for these filters.
              <div style={{ fontSize: 11, marginTop: 6 }}>
                If you expected some: admin-tier accounts need migration 0063 applied before they can read this log.
              </div>
            </div>
          )}

          {!loading && filtered.length > 0 && view === 'grouped' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={table}>
                <thead>
                  <tr style={headRow}>
                    <th style={th}>Problem</th>
                    <th style={th}>App</th>
                    <th style={{ ...th, textAlign: 'right' }}>Times</th>
                    <th style={{ ...th, textAlign: 'right' }}>Users</th>
                    <th style={th}>Venues</th>
                    <th style={th}>Versions</th>
                    <th style={th}>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <Fragment key={g.key}>
                      <tr style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => setOpen(open === g.key ? null : g.key)}
                          title="Show the individual events">
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{open === g.key ? '▾' : '▸'} {g.context}</div>
                          <div style={msg}>{g.sample || '—'}</div>
                        </td>
                        <td style={td}>{g.app}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{g.count}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{g.users.length}</td>
                        <td style={td}>{g.venueIds.map(venueName).join(', ') || '—'}</td>
                        <td style={td}>{g.versions.join(', ') || '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(g.lastSeen)}</td>
                      </tr>
                      {open === g.key && (
                        <tr><td colSpan={7} style={{ padding: '0 12px 12px', background: 'var(--off-200)' }}>
                          <EventList rows={g.rows.slice(0, 20)} venueName={venueName} />
                          {g.rows.length > 20 && <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>Showing the newest 20 of {g.rows.length}. Switch to "Every event" to see all.</div>}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length > 0 && view === 'all' && (
            <div style={{ padding: '0 12px 12px' }}>
              <EventList rows={filtered} venueName={venueName} showContext />
            </div>
          )}
        </Card>

        <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 10 }}>
          Only signed-in users can record errors, so a failure on the sign-in screen itself won't appear here.
        </div>
      </div>
    </>
  );
}

function EventList({ rows, venueName, showContext }: {
  rows: ClientErrorRow[];
  venueName: (id: string | null) => string;
  showContext?: boolean;
}) {
  return (
    <table style={{ ...table, marginTop: 8 }}>
      <thead>
        <tr style={headRow}>
          <th style={th}>When</th>
          {showContext && <th style={th}>Area</th>}
          <th style={th}>User</th>
          <th style={th}>Venue</th>
          <th style={th}>Version</th>
          <th style={th}>Message</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt(r.occurred_at)}</td>
            {showContext && <td style={td}>{r.context ?? '—'} <span style={{ color: 'var(--fg-muted)' }}>· {r.app}</span></td>}
            <td style={td}>{r.user_email ?? '—'}</td>
            <td style={td}>{venueName(r.venue_id)}</td>
            <td style={td}>{r.app_version ?? '—'}</td>
            <td style={td}>
              <div style={msg}>{r.message || '—'}</div>
              {r.stack && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ fontSize: 11, color: 'var(--fg-muted)', cursor: 'pointer' }}>Technical details</summary>
                  <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', margin: '4px 0 0', maxHeight: 200, overflow: 'auto' }}>{r.stack}</pre>
                </details>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const pickerStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 };
const banner: React.CSSProperties = { marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,193,7,0.10)', border: '1px solid rgba(255,193,7,0.4)', fontSize: 12, color: 'var(--fg)' };
const empty: React.CSSProperties = { padding: 24, textAlign: 'center', color: 'var(--fg-muted)' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 };
const headRow: React.CSSProperties = { textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
const th: React.CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' };
const msg: React.CSSProperties = { fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, wordBreak: 'break-word', maxWidth: 520 };
