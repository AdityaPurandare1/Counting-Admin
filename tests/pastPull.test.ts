/**
 * v1.13 past e-mails from one vendor domain. The user: "when I add another domain, i want to be able to pull emails
 * from that domain only. Along with marking since what date I want them pulled". Shaped on everythingpromo.com
 * (added 11/11: its 11/3 invoice i051027 was older than the morning pull's mark).  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pastPullConfirm, pastPullDefaultDay } from '../src/lib/orderMail';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

check('the day starts 30 days back by default', pastPullDefaultDay(new Date('2026-11-11T20:00:00Z')) === '2026-10-12', pastPullDefaultDay(new Date('2026-11-11T20:00:00Z')));
const ask = pastPullConfirm('everythingpromo.com', '2026-10-01');
check('Pull asks first: which domain, since when, what it reads, what old documents do, the 9 o\'clock pull untouched',
  /^Pull everythingpromo\.com's e-mails since 2026-10-01: quotes, order confirmations, invoices, shipping notices and tracking\?/.test(ask)
  && /older than 30 days start no new orders \(they wait in the Inbox for you\)/.test(ask) && /added without moving lines/.test(ask) && /9 o'clock pull is not affected/.test(ask), ask);

const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
if (fn) {
  const pull = fn.slice(fn.indexOf("if (action === 'pull') {"), fn.indexOf("if (action === 'pull') {") + 2200);
  check('function: a past pull needs a real day (2025 on, not the future)', /const fromMs = body\.since == null \|\| body\.since === '' \? 0 : backfillStart\(body\.since\);/.test(pull)
    && /if \(body\.since && !fromMs\) return reject\(400/.test(pull) && /ms >= Date\.parse\('2025-01-01T00:00:00Z'\) && ms <= Date\.now\(\)/.test(fn));
  check('function: one domain, and only one already on the vendor list (never an arbitrary sender)',
    /if \(!fromMs\) return reject\(400, 'Pick the day to pull that domain\\'s e-mails from\.'\);/.test(pull)
    && /\.includes\(only\)\) return reject\(400, `\$\{only\} is not on the vendor list\. Add it first\.`\);/.test(pull));
  check('function: it runs as a pull (the run lock, in the background), labelled with the domain and day',
    /kount_ot_mail_begin_run/.test(pull) && /background\(runPull\(sb, fromMs \? `past e-mails: \$\{only \?\? 'every listed vendor'\} since \$\{body\.since\} \(by \$\{caller\.email\}\)` : `by \$\{caller\.email\}`, 0, fromMs, only\)\);/.test(pull));
  const fetch = fn.slice(fn.indexOf('async function fetchPhase'), fn.indexOf('async function fetchPhase') + 3000);
  check('function: a past pull reads that domain only — its PDFs and tracking — and leaves the morning mark alone',
    /const vendors = only \? \[only\] : \(acct\.vendor_domains \?\? \[\]\);/.test(fetch) && /await backfillPdfs\(sb, tok\.access_token, vendors, fromMs, stats, kinds\);/.test(fetch)
    && /await trackingPhase\(sb, tok\.access_token, vendors, fromMs, stats\);/.test(fetch) && /if \(!only\) await stubPhase/.test(fetch)
    && fetch.indexOf('if (fromMs) {') < fetch.indexOf('const prevThrough') && fetch.indexOf('return;') < fetch.indexOf('const prevThrough'));
  check('function: a past pull does not count as today\'s 9 o\'clock read (one at 8:00 would have skipped the morning)',
    /if \(!fromMs\) await sb\.from\('kount_ot_mail_account'\)\.update\(\{ last_fetch_at: nowIso\(\) \}\)/.test(fn));
  check('function: older documents start no new orders (read and re-check both)', (fn.match(/optsFor\(opts, r\.(b\.)?received_at\)/g) ?? []).length === 2
    && /return opts\.autoCreate && !isRecent\(receivedAt\) \? \{ \.\.\.opts, autoCreate: false \} : opts;/.test(fn) && /const RECENT_DAYS = 30;/.test(fn));
  check('function: older tracking is added without moving lines', /ship_lines: shipLines,/.test(fn)
    && /isRecent\(m\.receivedDateTime\)\)\) \{/.test(fn) && /isRecent\(r\.received_at\)\)\) \{ stats\.tracking\+\+/.test(fn));
  check('function: that domain\'s mail is found by search (from:domain received>=day), at most 40 pages, PDFs by the usual rules',
    /"from:\$\{domain\} received>=\$\{sinceDay\}"/.test(fn) && /while \(url && pages\+\+ < 40\)/.test(fn) && /wantsAttachment\(kinds, m\.subject, a\.name\)\) await takePdf/.test(fn));
}

const inbox = readFileSync(join(process.cwd(), 'src/components/orderTracker/InboxView.tsx'), 'utf8');
check('Inbox: adding a domain (typed, Add, or a suggestion) picks it for the past pull', (inbox.match(/addDomain\(/g) ?? []).length === 3 && /const addDomain = \(raw: string\) =>/.test(inbox)
  && /setNewDomain\(''\); setPastDomain\(d\); setJustAdded\(d\);/.test(inbox));
check('Inbox: Pull past e-mails from [domain] since [day] — asks first, then pulls that domain',
  /aria-label="Vendor domain to pull"/.test(inbox) && /aria-label="Pull since"/.test(inbox) && /confirm\(pastPullConfirm\(dom, pastDay\)\)/.test(inbox)
  && /await pullPast\(dom, pastDay\)/.test(inbox) && /Added \$\{dom\}\. Pull its older e-mails too:/.test(inbox));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
