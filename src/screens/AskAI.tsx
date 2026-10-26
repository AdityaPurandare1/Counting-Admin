import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { VENUES, isOrgWide } from '@/lib/access';
import type { AccessEntry } from '@/lib/access';
import type { KountAvtReport, KountAvtRow } from '@/lib/types';
import { Card, Btn } from '@/components/atoms';
import { baseSystemPrompt, buildVarianceContext } from '@/lib/askAiContext';

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
   ─────────────────────────────────────────────────────────────────────── */

interface Props { user: AccessEntry }
interface Msg { role: 'user' | 'assistant'; content: string }

export function AskAI({ user }: Props) {
  const visibleVenues = useMemo(() => {
    if (isOrgWide(user.role) || user.venueIds === 'all') return VENUES;
    const set = new Set(Array.isArray(user.venueIds) ? user.venueIds : []);
    return VENUES.filter(v => set.has(v.id));
  }, [user]);

  const [venue, setVenue] = useState<string>('');
  const [useVenueData, setUseVenueData] = useState(true);
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

  // Load the venue's latest report (same selection as Variance / Stock on hand).
  useEffect(() => {
    let cancelled = false;
    if (!venue) return;
    (async () => {
      setContextNote('Loading ' + venueName + ' variance…');
      const { data: reports, error: repErr } = await supabase
        .from('kount_avt_reports')
        .select('*')
        .contains('venue_ids', [venue])
        .order('source', { ascending: true })
        .order('uploaded_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (repErr) { setContext(''); setContextNote('Could not load the variance report: ' + repErr.message); return; }
      const rep = (reports?.[0] as KountAvtReport) ?? null;
      let rows: KountAvtRow[] = [];
      if (rep) {
        const { data: r, error: rowErr } = await supabase
          .from('kount_avt_rows').select('*').eq('report_id', rep.id).eq('venue_id', venue);
        if (cancelled) return;
        if (rowErr) { setContext(''); setContextNote('Could not load the variance rows: ' + rowErr.message); return; }
        rows = (r as KountAvtRow[]) ?? [];
      }
      const text = buildVarianceContext(venueName, { asOf: rep ? (rep.computed_at ?? rep.uploaded_at) : null, source: rep?.source ?? null }, rows);
      setContext(text);
      setContextNote(rep
        ? rows.length + ' items from the report of ' + new Date(rep.computed_at ?? rep.uploaded_at).toLocaleDateString()
        : 'No closed count with a report yet for ' + venueName);
    })();
    return () => { cancelled = true; };
  }, [venue, venueName]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(history);
    setInput('');
    setError(null);
    setBusy(true);
    const system = baseSystemPrompt() + (useVenueData && context ? '\n\n' + context : '');
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
  }, [input, busy, messages, useVenueData, context]);

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
          <Btn variant="secondary" size="sm" onClick={() => { setMessages([]); setError(null); }} disabled={busy || messages.length === 0}>New chat</Btn>
        </div>
      </div>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          {useVenueData ? contextNote : 'Venue data off — general questions only.'}
          {' · '}Answers are AI-generated from that data; check figures before acting on them.
        </div>
        <Card padding={16}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 280, maxHeight: '58vh', overflowY: 'auto' }}>
            {messages.length === 0 && (
              <div style={{ color: 'var(--fg-muted)', fontSize: 14 }}>
                Ask about {useVenueData ? venueName + "'s variance, shortages or costs" : 'counting, variance or the admin'} — e.g. “What are the five biggest shortages and what might explain them?”
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
