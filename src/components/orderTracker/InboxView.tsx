import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Btn, Card, Pill } from '@/components/atoms';
import { DOC_KIND_LABEL } from '@/lib/orderTracker';
import { documentUrl } from '@/lib/orderTrackerData';
import {
  disconnectMail, inboxGroups, mailStatus, pollConnect, pullNow, setInboxState, setVendorDomains, startConnect,
  type DeviceCode, type InboxItem, type MailStatus,
} from '@/lib/orderMail';
import { errBox, fmtMoney, linkBtn, okBox, picker, shortDate, smallInput, subTxt } from './shared';

/** The morning mail pull: the Outlook connection, then what it found — waiting for a person first. */
export function InboxView({ items, onReview, onOpenOrder, onChanged }: {
  items: InboxItem[]; onReview: (item: InboxItem) => void; onOpenOrder: (orderId: string) => void; onChanged: () => void;
}) {
  const g = inboxGroups(items);
  const [showSkipped, setShowSkipped] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const skip = async (i: InboxItem, back = false) => {
    setErr(null);
    try { await setInboxState(i.id, back ? 'pending' : 'ignored', back ? 'Brought back by hand.' : 'Skipped by hand.', null); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <MailCard onChanged={onChanged} />
      {err && <div style={errBox}>{err}</div>}

      <Card padding={16}>
        <div style={{ fontWeight: 700 }}>Waiting for you {g.waiting.length > 0 && <Pill tone="gold" size="sm">{g.waiting.length}</Pill>}</div>
        <div style={subTxt}>Documents the pull could not place on an order by itself. Review one to save it — a new order, or onto the right one.</div>
        {g.waiting.length === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-muted)' }}>Nothing waiting.</div>}
        {g.waiting.map(i => <InboxRow key={i.id} item={i} actions={
          <>
            {i.parsed && <Btn variant="primary" size="sm" onClick={() => onReview(i)}>Review</Btn>}
            <Btn variant="ghost" size="sm" onClick={() => void skip(i)}>Skip</Btn>
          </>
        } />)}
      </Card>

      {g.reading.length > 0 && (
        <Card padding={16}>
          <div style={{ fontWeight: 700 }}>Being read <Pill tone="neutral" size="sm">{g.reading.length}</Pill></div>
          <div style={subTxt}>Found in the mailbox; the reader takes 10–40 seconds per PDF.</div>
          {g.reading.slice(0, 8).map(i => <InboxRow key={i.id} item={i} actions={null} />)}
        </Card>
      )}

      <Card padding={16}>
        <div style={{ fontWeight: 700 }}>Saved, last 30 days</div>
        <div style={subTxt}>Applied by the morning pull on its own, or saved by someone from this inbox.</div>
        {g.applied.length === 0 && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-muted)' }}>None yet.</div>}
        {g.applied.map(i => <InboxRow key={i.id} item={i} actions={i.order_id ? <Btn variant="ghost" size="sm" onClick={() => onOpenOrder(i.order_id!)}>Open order</Btn> : null} />)}
      </Card>

      {g.skipped.length > 0 && (
        <Card padding={16}>
          <button style={{ ...linkBtn, fontSize: 13 }} onClick={() => setShowSkipped(s => !s)}>
            {showSkipped ? 'Hide' : 'Show'} skipped ({g.skipped.length}) — not purchasing documents, already saved, or skipped by hand
          </button>
          {showSkipped && g.skipped.map(i => <InboxRow key={i.id} item={i} actions={<Btn variant="ghost" size="sm" onClick={() => void skip(i, true)}>Bring back</Btn>} />)}
        </Card>
      )}
    </div>
  );
}

function InboxRow({ item: i, actions }: { item: InboxItem; actions: ReactNode }) {
  const [err, setErr] = useState<string | null>(null);
  const d = i.parsed;
  const open = async () => {
    try { window.open(await documentUrl(i.storage_path), '_blank', 'noopener'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const what = d ? [d.is_credit ? 'Credit memo' : DOC_KIND_LABEL[d.doc_kind] ?? d.doc_kind, d.vendor_name, d.doc_number && `#${d.doc_number}`, d.total ? fmtMoney(d.total) : null].filter(Boolean).join(' · ') : null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)', marginTop: 8, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{what ?? i.file_name}</div>
        <div style={subTxt}>
          {shortDate(i.received_at)} · {i.sender_name || i.sender_email}{i.subject ? ` · ${i.subject}` : ''}
        </div>
        {i.decision && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--fg-secondary)' }}>{i.decision}</div>}
        {i.state === 'error' && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--raspberry-300)' }}>Could not be read: {i.read_error}</div>}
        {err && <div style={{ fontSize: 12, color: 'var(--raspberry-300)' }}>{err}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={{ ...linkBtn, fontSize: 12 }} onClick={() => void open()} title={i.file_name ?? ''}>PDF</button>
        {actions}
      </div>
    </div>
  );
}

/** Connect Outlook (device code), pull now, vendor domains, the last run. */
function MailCard({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<MailStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const wasRunning = useRef(false);

  const refresh = useCallback(async () => {
    try { setS(await mailStatus()); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // while a pull runs, watch it; when it ends, reload the inbox and the orders
  useEffect(() => {
    if (s?.running) { wasRunning.current = true; const t = setTimeout(() => void refresh(), 5000); return () => clearTimeout(t); }
    if (wasRunning.current) { wasRunning.current = false; onChanged(); }
    return undefined;
  }, [s, refresh, onChanged]);

  // a sign-in in progress: ask Microsoft every few seconds whether it went through
  useEffect(() => {
    if (!code) return undefined;
    let live = true;
    const t = setInterval(async () => {
      try {
        const r = await pollConnect();
        if (!live || r.state === 'waiting') return;
        setCode(null);
        if (r.state !== 'connected') setErr(r.reason ?? 'The sign-in did not finish.');
        void refresh();
      } catch (e) { if (live) { setCode(null); setErr(e instanceof Error ? e.message : String(e)); } }
    }, Math.max(5, code.interval) * 1000);
    return () => { live = false; clearInterval(t); };
  }, [code, refresh]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const saveDomains = (list: string[]) => act(async () => { await setVendorDomains(list); await refresh(); });

  if (!s) return <Card padding={16}>{err ? <div style={errBox}>{err}{/kount_ot_mail_status|does not exist/i.test(err) && ' — the mail pull (migration 0135) is not applied yet.'}</div> : <Pill tone="neutral" size="sm">loading…</Pill>}</Card>;

  const run = s.last_run;
  const suggestions = Object.entries(s.suggested_domains).filter(([d]) => !s.vendor_domains.includes(d)).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <Card padding={16}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px' }}>
          <div style={{ fontWeight: 700 }}>Morning mail pull</div>
          {s.connected ? (
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Reading <b>{s.mailbox}</b> every day at 9:00 Pacific. Quotes, confirmations, invoices and shipping notices from the vendors below go
              onto their order when they clearly belong to one; the rest wait here.
            </div>
          ) : (
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Connect the Outlook mailbox vendor emails come to. Every morning at 9:00 Pacific the PDFs from the vendors below are read and put
              on their orders. Read-only: it can't send, move or delete mail.
            </div>
          )}
          {run && (
            <div style={{ ...subTxt, marginTop: 6 }}>
              Last pull {new Date(run.finished_at ?? run.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ({run.trigger}):
              {' '}{run.new_pdfs} new PDF{run.new_pdfs === 1 ? '' : 's'}, {run.applied} applied, {run.pending} waiting, {run.ignored} skipped
              {run.failed ? `, ${run.failed} not read` : ''}{run.remaining ? `, ${run.remaining} still to read` : ''}.
            </div>
          )}
          {run?.error && <div style={errBox}>{run.reconnect ? 'The Outlook sign-in has expired — reconnect below.' : `The last pull stopped: ${run.error}`}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {s.running && <Pill tone="neutral" size="sm">pulling…</Pill>}
          {s.connected && <Btn variant="primary" size="sm" disabled={busy || s.running} onClick={() => void act(async () => { const r = await pullNow(); if (!r.started) setErr(r.reason ?? 'Not started.'); await refresh(); })}>Pull now</Btn>}
          {(!s.connected || run?.reconnect) && !code && <Btn variant={s.connected ? 'secondary' : 'primary'} size="sm" disabled={busy} onClick={() => void act(async () => setCode(await startConnect()))}>{s.connected ? 'Reconnect Outlook' : 'Connect Outlook'}</Btn>}
          {s.connected && <Btn variant="ghost" size="sm" disabled={busy} onClick={() => { if (confirm('Disconnect Outlook? The morning pull stops until someone connects again.')) void act(async () => { await disconnectMail(); await refresh(); }); }}>Disconnect</Btn>}
        </div>
      </div>

      {code && (
        <div style={okBox}>
          Go to <a href={code.verification_uri} target="_blank" rel="noopener noreferrer"><b>{code.verification_uri.replace(/^https?:\/\//, '')}</b></a>,
          enter <b style={{ fontSize: 15, letterSpacing: 1 }}>{code.user_code}</b> and sign in with the mailbox to read.
          {' '}<button style={{ ...linkBtn, fontSize: 12 }} onClick={() => void navigator.clipboard?.writeText(code.user_code)}>copy code</button>
          <div style={{ ...subTxt, marginTop: 4 }}>Waiting for Microsoft… this page notices by itself. The first pull then reads the last 30 days.</div>
        </div>
      )}
      {err && <div style={errBox}>{err}</div>}

      <div style={{ marginTop: 12, fontSize: 12 }}>
        <div style={{ color: 'var(--fg-muted)', marginBottom: 4 }}>PDFs are only read from these sender domains (nothing from anyone else is opened):</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {s.vendor_domains.map(d => (
            <span key={d} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '2px 8px', borderRadius: 12, background: 'var(--surface-alt)' }}>
              {d}<button style={{ ...linkBtn, fontWeight: 400, textDecoration: 'none' }} disabled={busy} aria-label={`Remove ${d}`}
                onClick={() => void saveDomains(s.vendor_domains.filter(x => x !== d))}>×</button>
            </span>
          ))}
          <input style={{ ...smallInput, width: 170 }} placeholder="add a vendor domain" value={newDomain} onChange={e => setNewDomain(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newDomain.trim()) { void saveDomains([...s.vendor_domains, newDomain.trim()]); setNewDomain(''); } }} />
          {newDomain.trim() && <Btn variant="secondary" size="sm" disabled={busy} onClick={() => { void saveDomains([...s.vendor_domains, newDomain.trim()]); setNewDomain(''); }}>Add</Btn>}
        </div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <span style={{ color: 'var(--fg-muted)' }}>Also sent you invoice or quote PDFs (not read): </span>
            {suggestions.map(([d, n]) => (
              <button key={d} style={{ ...picker, padding: '2px 8px', fontSize: 12, marginRight: 6, cursor: 'pointer' }} disabled={busy}
                onClick={() => void saveDomains([...s.vendor_domains, d])} title="Add to the vendor list">+ {d} ({n})</button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
