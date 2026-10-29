/**
 * v0.77 bug batch: qty drafts, phase labels, the venue's current report,
 * opening counts in Item History, member roles, the date filter range,
 * notification transitions -- behaviour tests of the helpers, a stubbed-client
 * run of the report loader, and source checks of the screen wiring.  npm test
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQtyDraft } from '../src/lib/qtyDraft';
import { phaseLabel, auditStageLabel } from '../src/lib/auditPhase';
import { memberRoleFor } from '../src/lib/access';
import { supabase, channelTopic } from '../src/lib/supabase';
import { loadLatestVenueReport } from '../src/lib/latestVenueReport';
import { buildGrid } from '../src/screens/ItemHistory';
import { localDayRange } from '../src/screens/Variance';
import { phaseMessage, priorAuditState } from '../src/lib/notifications';
import { deepLinkOutcome, revealFilters } from '../src/screens/Summary';
import type { KountAudit } from '../src/lib/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}

async function main() {
  // ── #1 qty drafts ────────────────────────────────────────────────────
  console.log('parseQtyDraft');
  check('blank is not 0', parseQtyDraft('') === null);
  check('spaces are not 0', parseQtyDraft('   ') === null);
  check('null/undefined', parseQtyDraft(null) === null && parseQtyDraft(undefined) === null);
  check('not a number', parseQtyDraft('abc') === null && parseQtyDraft('1..2') === null);
  check('negative refused', parseQtyDraft('-1') === null);
  check('Infinity refused', parseQtyDraft('Infinity') === null);
  check('a typed 0 is a real 0', parseQtyDraft('0') === 0);
  check('decimals and padding', parseQtyDraft(' 2.25 ') === 2.25);

  // ── #12 phase labels ─────────────────────────────────────────────────
  console.log('\nphase labels');
  check('count1 -> Count 1', phaseLabel('count1') === 'Count 1');
  check('review -> Recount review', phaseLabel('review') === 'Recount review');
  check('count2 -> Count 2', phaseLabel('count2') === 'Count 2');
  check('final -> Final', phaseLabel('final') === 'Final');
  check('unknown passes through, empty stays empty', phaseLabel('weird') === 'weird' && phaseLabel(null) === '');
  check('active audit shows its phase', auditStageLabel({ status: 'active', count_phase: 'count2' }) === 'Count 2');
  check('closed audit shows its status', auditStageLabel({ status: 'submitted', count_phase: 'final' }) === 'submitted'
    && auditStageLabel({ status: 'cancelled', count_phase: 'review' }) === 'cancelled');

  // ── member roles (kount_members CHECK: corporate|manager|counter) ──
  console.log('\nmemberRoleFor');
  check('admin -> corporate', memberRoleFor('admin') === 'corporate');
  check('corporate / manager / counter unchanged', memberRoleFor('corporate') === 'corporate' && memberRoleFor('manager') === 'manager' && memberRoleFor('counter') === 'counter');
  check('venue_manager stays off the roster, as on the phone', memberRoleFor('venue_manager') === null);

  // ── #13 local day range for the server-side date filter ─────────────
  console.log('\nlocalDayRange');
  const r = localDayRange('2026-10-21');
  check('bounds are local midnights', !!r && new Date(r.from).getHours() === 0 && new Date(r.from).getDate() === 21 && new Date(r.to).getDate() === 22 && new Date(r.to).getHours() === 0, r);
  check('a plain day is 24h', !!r && Date.parse(r.to) - Date.parse(r.from) === 86_400_000);
  check('month rollover', localDayRange('2026-10-31')?.to === new Date(2026, 10, 1).toISOString());
  check('garbage -> null', localDayRange('') === null && localDayRange('10/21/2026') === null);

  // ── #10 opening counts out of the 4-audit total ─────────────────────
  console.log('\nbuildGrid opening count');
  const g = buildGrid(
    [{ id: 'open', code: 'LL-038', date: '2026-10-18', reportId: 'r0', opening: true }, { id: 'a2', code: 'LL-101', date: '2026-10-25', reportId: 'r2' }],
    [
      { report_id: 'r0', item_name: 'Aperol 1L', category: 'Liquor Cost', actual: 12, variance: 12, variance_value: 300 },
      { report_id: 'r2', item_name: 'Aperol 1L', category: 'Liquor Cost', actual: 10, variance: -1, variance_value: -25 },
    ],
  );
  check('opening count cell still shown', g[0]?.cells.open?.actual === 12 && g[0]?.cells.open?.value === 300, g);
  check('opening count variance left out of the total', g[0]?.total === -25, g[0]?.total);

  // ── notifications: no false "Count 1 completed" ─────────────────────
  console.log('\nnotification transitions');
  const audit = (over: Partial<KountAudit>) => ({ id: 'a', venue_id: 'v1', venue_name: 'Poppy', status: 'active', count_phase: 'review', ...over }) as KountAudit;
  check('payload.old without fields + nothing known -> no prior, no toast', priorAuditState(undefined, { id: 'a' } as Partial<KountAudit>) === null);
  check('payload.old with fields is used', priorAuditState(undefined, { status: 'active', count_phase: 'count1' })?.count_phase === 'count1');
  const reactivated = priorAuditState({ status: 'cancelled', count_phase: 'review' }, { id: 'a' } as Partial<KountAudit>);
  check('reactivating a cancelled audit in review is not "Count 1 completed"', !!reactivated && phaseMessage(audit({}), reactivated.count_phase, reactivated.status) === null);
  check('a real count1 -> review still notifies', phaseMessage(audit({}), 'count1', 'active')?.title === 'Count 1 for Poppy completed');
  check('submit still notifies', phaseMessage(audit({ status: 'submitted', count_phase: 'final' }), 'count2', 'active')?.title === 'Audit submitted — Poppy');

  // ── #8 Summary deep links ────────────────────────────────────────────
  console.log('\nSummary deep link');
  check('not found / deleted -> give up', deepLinkOutcome(null, false) === 'give-up');
  check('still active -> give up (it lives in Variance / Counts)', deepLinkOutcome({ status: 'active' }, true) === 'give-up');
  check('venue out of scope -> give up', deepLinkOutcome({ status: 'submitted' }, false) === 'give-up');
  check('submitted or cancelled in scope -> show', deepLinkOutcome({ status: 'submitted' }, true) === 'show' && deepLinkOutcome({ status: 'cancelled' }, true) === 'show');
  check('already visible -> no filter change', revealFilters({ status: 'submitted', venue_id: 'v5' }, 'submitted', '') === null && revealFilters({ status: 'cancelled', venue_id: 'v5' }, 'all', 'v5') === null);
  check('cancelled audit under the Submitted tab -> switch to Cancelled', JSON.stringify(revealFilters({ status: 'cancelled', venue_id: 'v5' }, 'submitted', '')) === '{"status":"cancelled"}');
  check('other venue picked -> clear the venue filter', JSON.stringify(revealFilters({ status: 'submitted', venue_id: 'v5' }, 'all', 'v1')) === '{"clearVenue":true}');
  check('both at once', JSON.stringify(revealFilters({ status: 'submitted', venue_id: 'v5' }, 'cancelled', 'v1')) === '{"status":"submitted","clearVenue":true}');

  // ── #2 the venue's current report: stubbed client ───────────────────
  console.log('\nloadLatestVenueReport (stubbed client)');
  type Call = [string, ...unknown[]];
  type Result = { data?: unknown[]; error?: { message: string } };
  const run = async (results: Record<string, Result>) => {
    const log: Array<{ table: string; calls: Call[] }> = [];
    const orig = supabase.from;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from = (table: string) => {
      const entry = { table, calls: [] as Call[] };
      log.push(entry);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            const res = results[table] ?? { data: [] };
            const range = entry.calls.find(c => c[0] === 'range') as [string, number, number] | undefined;
            const data = res.error ? null : range ? (res.data ?? []).slice(range[1], range[2] + 1) : (res.data ?? []);
            const out = { data, error: res.error ?? null };
            return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(out).then(ok, bad);
          }
          return (...args: unknown[]) => { entry.calls.push([String(prop), ...args]); return b; };
        },
      });
      return b;
    };
    try {
      const value = await loadLatestVenueReport('v12');
      return { value, error: null as Error | null, log };
    } catch (e) {
      return { value: null, error: e as Error, log };
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from = orig;
    }
  };
  const has = (calls: Call[], ...want: unknown[]) => calls.some(c => JSON.stringify(c) === JSON.stringify(want));

  const ok = await run({
    kount_audits: { data: [{ id: 'A-2', join_code: 'ALPHA2', venue_id: 'v12', status: 'submitted' }] },
    kount_avt_reports: { data: [{ id: 'rep-2', audit_id: 'A-2', source: 'computed' }] },
    kount_avt_rows: { data: Array.from({ length: 1500 }, (_, i) => ({ id: 'row' + i, report_id: 'rep-2', venue_id: 'v12' })) },
  });
  const aq = ok.log.find(l => l.table === 'kount_audits')?.calls ?? [];
  const rq = ok.log.find(l => l.table === 'kount_avt_reports')?.calls ?? [];
  check('picks a submitted audit at the venue', has(aq, 'eq', 'venue_id', 'v12') && has(aq, 'eq', 'status', 'submitted'), aq);
  check('food counts are excluded', has(aq, 'neq', 'audit_kind', 'food'), aq);
  check('newest by close time', has(aq, 'order', 'completed_at', { ascending: false, nullsFirst: false }) && has(aq, 'limit', 1), aq);
  check("loads THAT audit's report, not the newest upload for the venue", has(rq, 'eq', 'audit_id', 'A-2') && !rq.some(c => c[0] === 'contains'), rq);
  check('computed outranks uploaded, as in Variance', has(rq, 'order', 'source', { ascending: true }), rq);
  check('rows are paged past the 1000-row cap', ok.value?.rows.length === 1500 && ok.log.filter(l => l.table === 'kount_avt_rows').length === 2, ok.value?.rows.length);
  check('returns the audit with the report', ok.value?.audit?.id === 'A-2' && ok.value?.report?.id === 'rep-2');

  const noAudit = await run({ kount_audits: { data: [] } });
  check('no closed count -> empty, no report query', !noAudit.error && noAudit.value?.audit === null && !noAudit.log.some(l => l.table === 'kount_avt_reports'));
  const noReport = await run({ kount_audits: { data: [{ id: 'A-3' }] }, kount_avt_reports: { data: [] } });
  check('closed count without a report -> audit kept, report null', noReport.value?.audit?.id === 'A-3' && noReport.value?.report === null);
  const broken = await run({ kount_audits: { error: { message: 'permission denied' } } });
  check('a failed read throws instead of reading as "no report"', !!broken.error && /permission denied/.test(broken.error.message), broken.error?.message);
  const brokenRows = await run({ kount_audits: { data: [{ id: 'A-2' }] }, kount_avt_reports: { data: [{ id: 'rep-2' }] }, kount_avt_rows: { error: { message: 'timeout' } } });
  check('a failed rows read throws too', !!brokenRows.error && /rows could not be loaded: timeout/.test(brokenRows.error.message), brokenRows.error?.message);

  // ── wiring ───────────────────────────────────────────────────────────
  console.log('\nwiring');
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const counts = src('src/screens/Counts.tsx');
  const variance = src('src/screens/Variance.tsx');
  const summary = src('src/screens/Summary.tsx');
  const reports = src('src/screens/Reports.tsx');
  const recount = src('src/screens/Recount.tsx');
  const ih = src('src/screens/ItemHistory.tsx');
  const ov = src('src/screens/Overview.tsx');
  const soh = src('src/screens/StockOnHand.tsx');
  const ai = src('src/screens/AskAI.tsx');
  const stale = src('src/components/StaleAuditsPrompt.tsx');
  const transfers = src('src/screens/Transfers.tsx');
  const issues = src('src/screens/Issues.tsx');
  const venues = src('src/screens/Venues.tsx');

  // #1
  check('#1 Counts entry row + add card parse through parseQtyDraft', (counts.match(/parseQtyDraft\(/g) ?? []).length >= 2 && !/const v = Number\(qtyDraft\)/.test(counts) && !/const q = Number\(qty\)/.test(counts));
  check('#1 Variance edit row parses through parseQtyDraft', variance.includes('parseQtyDraft(qty)') && !variance.includes('const parsed = Number(qty)'));
  // #2
  for (const [name, s] of [['StockOnHand', soh], ['AskAI', ai]] as const) {
    check(`#2 ${name} uses loadLatestVenueReport, not the newest report by upload`, s.includes('loadLatestVenueReport(') && !s.includes(".contains('venue_ids'"));
  }
  check('#2 Stock on hand shows a load error instead of "no report"', soh.includes('Inventory could not be loaded'));
  // #4
  check('#4 Counts workspace is keyed by audit', counts.includes('<CountsWorkspace key={selectedAudit.id}'));
  check('#4 a failed entries load clears the list', /console\.error\('\[counts\] load entries', error\);[\s\S]{0,140}setEntries\(\[\]\)/.test(counts));
  // #5 / #15
  check('#5 Reports export uses countedRows', reports.includes('rows: countedRows as AvtLikeRow[]') && !reports.includes('rows: rows as AvtLikeRow[]'));
  check('#5 "item rows" label counts what is shown', reports.includes('`${countedRows.length} item rows`'));
  check('#15 category resets with venue / audit / window', reports.includes("useEffect(() => { setCat('all'); }, [venue, auditId, window_]);"));
  check('#15 the active category chip never hides', reports.includes("g === 'all' || g === cat || catCounts.get(g)"));
  // #6
  check('#6 Variance Edit re-syncs the draft', variance.includes('setQty(String(entry.qty)); setEditing(true);'));
  // #7
  check('#7 Summary Delete refuses while the entry count is unknown', summary.includes('if (entriesError) {') && summary.includes('!!entriesError}'));
  check('#7 Summary no longer turns a failed entries load into []', !summary.includes(".catch((err): KountEntry[] => { console.error('[summary] load entries', err); return []; })"));
  check('#7 stale prompt keeps an unknown count unknown', !stale.includes('.count ?? 0') && stale.includes('row.entryCount === null'));
  check('#7 Variance tiles show — on a failed load', variance.includes("entriesError ? '—'"));
  // #8
  check('#8 Summary resolves a deep link before clearing the selection', summary.includes('revealedRef') && summary.includes("if (auditParam && revealedRef.current !== auditParam) return;"));
  check('#8 Summary fetches a deep-linked audit by id', /from\('kount_audits'\)\s*\.select\('\*'\)\s*\.eq\('id', auditParam\)\s*\.maybeSingle\(\)/.test(summary));
  // #9
  check('#9 Reports dates are local', !/started_at\.slice\(0, 10\)/.test(reports) && !/iso\.slice\(0, 10\)/.test(reports));
  check('#9 Overview latest audit date is local', ov.includes('localIsoDate(new Date(v.latestAuditDate))'));
  check('#9 Item History dates are local', !/startedAt\.slice\(0, 10\)/.test(ih) && !/started_at\)\.slice\(0, 10\)/.test(ih));
  // #10
  check('#10 Item History reads opening counts', ih.includes('loadOpeningAuditIds()') && ih.includes('>Opening count</Pill>'));
  // #11
  check('#11 Recount detail is keyed by audit', recount.includes('<RecountDetail key={selectedId}'));
  // #12
  const rawPhase = /\? 'submitted' : a\.count_phase|: audit\.count_phase\}|\{active\.count_phase\}|\{a\.count_phase\}|Advance to \{next\}/;
  for (const [name, s] of [['Counts', counts], ['Variance', variance], ['Recount', recount], ['Venues', venues], ['StaleAuditsPrompt', stale]] as const) {
    check(`#12 ${name} shows no raw phase token`, !rawPhase.test(s), s.match(rawPhase)?.[0]);
  }
  check('#12 computed report line has no empty uploader/file segments', !variance.includes('· by {avtReport.uploaded_by_name || avtReport.uploaded_by_email} · {avtReport.file_name}'));
  // #13
  check('#13 a picked date is queried on the server', variance.includes('localDayRange(dateFilter)') && variance.includes('}, [filterVisible, dateFilter]);'));
  // #14
  check('#14 transfer save message lives in the parent', transfers.includes('onSaved={(text) => { setSavedMsg(text);') && transfers.includes('{savedMsg && <div style={okBox}>{savedMsg}</div>}'));
  // lower-value
  check('Variance no longer points at a "Catalog → Recompute variance" control', !variance.includes('Catalog → Recompute variance'));
  check('Counts maps the member role and reports a failed insert', counts.includes('role:            memberRole,') && counts.includes('could not be added to its member list'));
  check('Issues filters venue on the server', issues.includes("'*, kount_audits!inner(venue_id)'") && issues.includes(".in('kount_audits.venue_id', venueScope)"));

  // ── follow-up review round ───────────────────────────────────────────
  console.log('\nfollow-up');
  // The deps of the first effect after a channel name. Re-subscribing a topic
  // while its old channel is still leaving silently kills the subscription
  // (realtime-js channel() returns the leaving one), so these must not change
  // with the loaders' filters.
  const depsAfter = (s: string, marker: string) => {
    const i = s.indexOf(marker);
    if (i < 0) return null;
    return /\}, \[([^\]]*)\]\);/.exec(s.slice(i))?.[1] ?? null;
  };
  const notif = src('src/lib/notifications.tsx');
  const VAR_CH = ".channel(channelTopic('kount-audits-list'))";
  const ISS_CH = ".channel(channelTopic('kount-issues-live'))";
  const NOT_CH = ".channel(channelTopic('kount-audits-notifications'))";
  check('Variance audit list subscribes once, on a per-mount topic', depsAfter(variance, VAR_CH) === '' && variance.includes('void loadAuditsRef.current();'), depsAfter(variance, VAR_CH));
  check('Issues subscribes once, on a per-mount topic', depsAfter(issues, ISS_CH) === '' && issues.includes('void loadRef.current(true);'), depsAfter(issues, ISS_CH));
  check('notifications subscribe per user, on a per-mount topic', depsAfter(notif, NOT_CH) === 'user' && (notif.match(/pushRef\.current\(\{/g) ?? []).length === 2);
  check('Issues realtime refresh keeps the table (no Loading…)', issues.includes('const load = useCallback(async (quiet = false) => {') && issues.includes('if (!quiet) setLoading(true);'));
  const topics = new Set(Array.from({ length: 50 }, () => channelTopic('kount-audits-list')));
  check('channelTopic gives each mount its own topic under the same base', topics.size === 50 && [...topics].every(t => t.startsWith('kount-audits-list-')));
  check('Counts zone topic is per audit (the keyed workspace remounts per audit)', counts.includes(".channel('counts-zones-' + audit.venue_id + '-' + audit.id)"));
  check('Summary deep-link give-up clears the selection', /revealedRef\.current = auditParam;[\s\S]{0,200}selectAudit\(null\);\s*return;/.test(summary));
  check('Summary detail is keyed by audit (and the drill-reset effect it replaces is gone)', summary.includes('<SummaryDetail key={selectedId}') && !summary.includes('useEffect(() => { setDrill(null); }, [auditId]);'));
  check('Stock on hand drops the previous venue while loading', soh.includes('setAudit(null); setReport(null); setRows([]);') && soh.includes("value={loading ? '—'") && soh.includes('disabled={loading || enriched.length === 0}'));
  check('Counts says why a negative qty was refused', counts.includes("Can't be negative — kept"));
  check('date quick-picks come from the unfiltered list', variance.includes('[...activeAudits, ...recentHistoric]') && variance.includes('if (!range && !historicRes.error) setRecentHistoric(historic);'));
  check('Variance ignores a superseded audit-list load', variance.includes('if (seq !== loadSeq.current) return;'));
  const pp = src('src/screens/PurchasePrices.tsx');
  for (const [name, s] of [['Reports', reports], ['Variance', variance], ['StockOnHand', soh], ['PurchasePrices', pp]] as const) {
    check(`export filename date is local in ${name}`, !s.includes('toISOString().slice(0, 10)') && s.includes('localIsoDate(new Date())'));
  }
  check('Ask AI context date is local', src('src/lib/askAiContext.ts').includes('localIsoDate(asOfDate)'));
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(e => { console.error(e); process.exit(1); });
