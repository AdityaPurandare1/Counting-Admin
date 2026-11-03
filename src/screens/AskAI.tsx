import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { VENUES, can, isOrgWide } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import { Card, Btn } from '@/components/atoms';
import { baseSystemPrompt, buildVarianceContext } from '@/lib/askAiContext';
import { loadLatestVenueReport, type VenueReport } from '@/lib/latestVenueReport';
import { asksVariance, buildOrdersContext, ordersBudget, ordersSystemPrompt, type AskBible } from '@/lib/askAiOrders';
import { isoDay, orderVenues } from '@/lib/orderTracker';
import { loadTracker, type TrackerData } from '@/lib/orderTrackerData';
import { inboxGroups, loadInbox } from '@/lib/orderMail';

/* ───────────────────────────────────────────────────────────────────────
   Ask AI (v0.75) — replaces the "port coming later" placeholder.

   A chat with the same server-side assistant the phone uses: the ask-ai Edge
   Function. supabase.functions.invoke sends the signed-in user's own JWT,
   which the function requires (it rejects the public anon key and anyone not
   an active app user), and the AI keys never reach the browser. The function
   routes the call KevaOS -> OpenRouter -> Anthropic (_shared/ai-router.ts).

   Optional venue context: the venue's latest variance report, summarised by
   lib/askAiContext (totals, category roll-up, largest shortages/overages,
   unpriced items), so a manager can ask "what's driving our variance?". It is
   the same report Variance and Stock on hand read, scoped by the same venue
   access rules.
   v0.93: for admin + corporate, the Purchasing order tracker and the venue
   bibles too (lib/askAiOrders): each question carries the overview, the
   orders and bible rows it names, and topic lists (late, unpaid, stubs,
   warehouse, Inbox).
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }
interface Msg { role: 'user' | 'assistant'; content: string }

export function AskAI({ user }: Props) {
  const visibleVenues = useMemo(() => {
    if (isOrgWide(user) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const [venue, setVenue] = useState<string>('');
  const [useVenueData, setUseVenueData] = useState(true);
  // the order tracker + bibles are admin + corporate data (their RLS says the same)
  const canOrders = can(user, 'team:ask-ai-orders');
  const [useOrders, setUseOrders] = useState(canOrders);
  const [orders, setOrders] = useState<{ data: TrackerData; bibles: AskBible[]; inboxWaiting: number } | null>(null);
  const [ordersNote, setOrdersNote] = useState('');
  const [context, setContext] = useState<string>('');
  const [contextNote, setContextNote] = useState<string>('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!venue && visibleVenues.length > 0) setVenue(visibleVenues[0].id);
  }, [visibleVenues, venue]);

  const venueName = visibleVenues.find(v => v.id === venue)?.name ?? venue;

  // Load the venue's current report: its newest closed beverage count's own
  // report, the same one Stock on hand shows (lib/latestVenueReport, v0.77).
  useEffect(() => {
    let cancelled = false;
    if (!venue) return;
    (async () => {
      setContextNote('Loading ' + venueName + ' variance…');
      let res: VenueReport;
      try {
        res = await loadLatestVenueReport(venue);
      } catch (e) {
        if (cancelled) return;
        setContext(''); setContextNote('Could not load the variance report: ' + (e instanceof Error ? e.message : String(e)));
        return;
      }
      if (cancelled) return;
      const { audit, report: rep, rows } = res;
      const text = buildVarianceContext(venueName, { asOf: rep ? (rep.computed_at ?? rep.uploaded_at) : null, source: rep?.source ?? null }, rows);
      setContext(text);
      setContextNote(rep
        ? rows.length + ' items from the report of ' + (audit ? audit.join_code + ', ' : '') + new Date(rep.computed_at ?? rep.uploaded_at).toLocaleDateString()
        : audit
          ? 'The latest closed count (' + audit.join_code + ') has no report yet for ' + venueName
          : 'No closed count with a report yet for ' + venueName);
    })();
    return () => { cancelled = true; };
  }, [venue, venueName]);

  // the order tracker + the bibles' text, once (refreshed with New chat)
  const loadOrders = useCallback(async () => {
    setOrdersNote('Loading the order tracker and bibles…');
    try {
      const [data, bib, inbox] = await Promise.all([
        loadTracker(),
        supabase.from('kount_ot_bibles').select('venue_id, title, text_index').eq('is_current', true),
        loadInbox().catch(() => []),
      ]);
      if (bib.error) throw new Error(bib.error.message);
      const bibles = (bib.data ?? []) as AskBible[];
      setOrders({ data, bibles, inboxWaiting: inboxGroups(inbox).waiting.length });
      setOrdersNote(`${data.orders.filter(o => !o.archived_at).length} orders · ${bibles.filter(b => b.text_index).length} of ${bibles.length} bibles searchable`);
    } catch (e) {
      setOrders(null); setOrdersNote('Could not load the order tracker: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, []);
  useEffect(() => { if (canOrders && useOrders && !orders) void loadOrders(); }, [canOrders, useOrders, orders, loadOrders]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(history);
    setInput('');
    setError(null);
    setBusy(true);
    // the order tracker: what this question (and the last two before it) names. Everything fits ask-ai's 8,000
    // characters: with orders on, the venue's variance goes along only when the question is about variance.
    const recent = history.filter(m => m.role === 'user').slice(-3).map(m => m.content).join('\n');
    const withOrders = canOrders && useOrders && !!orders;
    const variance = useVenueData && context && (!withOrders || asksVariance(recent)) ? '\n\n' + context : '';
    const head = baseSystemPrompt() + (withOrders ? ' ' + ordersSystemPrompt() : '') + variance;
    const ordersText = withOrders
      ? buildOrdersContext({ question: recent, data: orders!.data, bibles: orders!.bibles, venues: orderVenues(VENUES), today: isoDay(new Date()),
          inboxWaiting: orders!.inboxWaiting, budget: ordersBudget(head.length + 2) })
      : '';
    const system = head + (ordersText ? '\n\n' + ordersText : '');
    const { data, error: fnErr } = await supabase.functions.invoke('ask-ai', {
      body: { messages: history, system, max_tokens: 1024 },
    });
    setBusy(false);
    if (fnErr) {
      // FunctionsHttpError carries the function's JSON body in .context.
      let msg = fnErr.message;
      try {
        const ctx = (fnErr as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          const j = await ctx.json();
          if (j && typeof j.error === 'string') msg = j.error;
        }
      } catch { /* keep the generic message */ }
      setError(msg);
      setMessages(history.slice(0, -1));   // drop the unanswered turn so a retry is clean
      setInput(q);
      return;
    }
    const text = data && typeof (data as { text?: unknown }).text === 'string' ? (data as { text: string }).text : '';
    setMessages([...history, { role: 'assistant', content: text || '(no answer)' }]);
  }, [input, busy, messages, useVenueData, context, canOrders, useOrders, orders]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Ask kΩunt</div>
          <h1>AI assistant</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={venue} onChange={e => setVenue(e.target.value)} style={pickerStyle}>
            {visibleVenues.length === 0 && <option value="">No venues</option>}
            {visibleVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={useVenueData} onChange={e => setUseVenueData(e.target.checked)} />
            Use this venue's latest variance
          </label>
          {canOrders && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={useOrders} onChange={e => setUseOrders(e.target.checked)} />
              Orders &amp; bibles
            </label>
          )}
          <Btn variant="secondary" size="sm" onClick={() => { setMessages([]); setError(null); if (canOrders && useOrders) void loadOrders(); }} disabled={busy || messages.length === 0}>New chat</Btn>
        </div>
      </div>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          {useVenueData ? contextNote : 'Venue data off.'}
          {canOrders && useOrders && ordersNote ? ` · Order tracker: ${ordersNote}` : ''}
          {' · '}Answers are AI-generated from that data; check figures before acting on them.
        </div>
        <Card padding={16}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 280, maxHeight: '58vh', overflowY: 'auto' }}>
            {messages.length === 0 && (
              <div style={{ color: 'var(--fg-muted)', fontSize: 14 }}>
                Ask about {useVenueData ? venueName + "'s variance, shortages or costs" : 'counting, variance or the admin'}{canOrders && useOrders ? ', and any order or bible' : ''} — e.g. “What are the five biggest shortages and what might explain them?”
                {canOrders && useOrders && <div style={{ marginTop: 6 }}>Orders &amp; bibles: “Where is the Delilah Mints order?”, “Which invoices are unpaid over 2 weeks?”, “What's late and why?”, “What glassware is in the Alphabet bible and what's its status?”</div>}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%', whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45,
                padding: '8px 12px', borderRadius: 10,
                background: m.role === 'user' ? 'var(--accent-bg)' : 'var(--bg-subtle, rgba(0,0,0,0.04))',
                color: m.role === 'user' ? 'var(--accent-fg, #fff)' : 'inherit',
              }}>{m.content}</div>
            ))}
            {busy && <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Thinking…</div>}
            <div ref={endRef} />
          </div>
        </Card>
        {error && <div style={{ color: 'var(--critical, #b42318)', fontSize: 13 }}>Ask AI failed: {error}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask a question (Enter to send, Shift+Enter for a new line)"
            rows={2}
            style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #ddd)', font: 'inherit', resize: 'vertical' }}
          />
          <Btn variant="primary" size="sm" onClick={() => void send()} disabled={busy || !input.trim()}>Send</Btn>
        </div>
      </div>
    </>
  );
}

const pickerStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #ddd)', background: 'var(--bg, #fff)', font: 'inherit',
};
