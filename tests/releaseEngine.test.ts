/**
 * v1.30 the release engine (0179). The user, 11/18: "I order a large batch, then EE stores it, then from that large pile
 * i keep ordering smaller batches as time goes ... 5 cases to be sent to delilah LA / miami" -> "build the engine that
 * tracks them like this please". The matching rules are tested in orderTracker.test.ts; this checks the wiring.  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseCheckText } from '../src/lib/orderMail';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

// ── what "Check my e-mails to E&E now" says ─────────────────────────
check('a check that found releases', releaseCheckText({ seen: 6, read: 2, recorded: 2, review: 1, linked: 1, note: null, error: null })
  === '6 e-mails to E&E looked at: 2 e-mails recorded as releases, 1 e-mail for you to check, 1 E&E invoice line linked to them.');
check('nothing new', releaseCheckText({ seen: 1, read: 0, recorded: 0, review: 0, linked: 0, note: null, error: null }) === '1 e-mail to E&E looked at: no new releases.');
check('a check that stopped says why', releaseCheckText({ seen: 0, read: 0, recorded: 0, review: 0, linked: 0, note: null, error: 'Outlook is not connected.' })
  === 'The check stopped: Outlook is not connected.');

// ── the admin ───────────────────────────────────────────────────────
const data = src('src/lib/orderTrackerData.ts');
check('the tracker loads the e-mails a person checks and the recorded ones (none before 0179)', data.includes(".from('kount_ot_release_mail')")
  && data.includes(".in('state', ['review', 'recorded'])") && data.includes('releaseMail,'));
check('an E&E invoice line recorded by hand links to a release asked by e-mail (never twice)', data.includes('const { link, insert } = linkStorageRows(moves, existing);'));
check('recording an e-mail by hand: releases from that e-mail, the e-mail marked recorded', data.includes('mail_id: mailId') && data.includes("state: 'recorded', move_ids"));
const wv = src('src/components/orderTracker/WarehouseView.tsx');
check('Warehouse: "Releases asked by e-mail" with Check now, Record (item / cases / venue / day), Not a release', wv.includes('function ReleaseMailQueue')
  && wv.includes("'Check my e-mails to E&E now'") && wv.includes('Not a release') && wv.includes('await recordReleaseMail(form.id'));
check('Warehouse: the queue offers custom E&E stock only, and the storage records pass the moves on screen', wv.includes('isCustomItem(i) && itemLocation(i) === EE_WAREHOUSE')
  && (wv.match(/data\.moves\)/g) ?? []).length >= 2 && wv.includes('}], data.moves);'));
check('version 1.30', src('src/lib/version.ts').includes("'1.30'"));

// ── the database and the pull (the sibling repo, when it is there) ──
const mig = sibling('supabase', 'migrations', '0179_kount_ot_release_mail.sql');
check('0179: kount_ot_release_mail (one row per e-mail, its state), stock_moves.mail_id, the cursor, read / update by permission', mig === null
  || (mig.includes('message_id           text not null unique') && mig.includes("check (state in ('recorded', 'review', 'not_release', 'ignored'))")
    && mig.includes('add column if not exists mail_id uuid references public.kount_ot_release_mail') && mig.includes('add column if not exists release_cursor timestamptz')
    && mig.includes("using (public.kount_has_feature('purchasing:order-tracker'))")));
const pull = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
check('the morning pull reads the e-mails before E&E\'s invoice lines link to them', pull === null
  || /if \(relToken\) await releasePhase\(sb, stats, relToken\);\s*await storagePhase\(sb, stats, 'morning mail pull'\);/.test(pull));
check('the hourly check does too, and there is an on-demand action', pull === null
  || (/await releasePhase\(sb, stats, tok\.access_token\);\s*await storagePhase\(sb, stats, 'hourly check'\);/.test(pull) && pull.includes("if (action === 'releases') {")));
check('only e-mails from h.wood to E&E, a words test before the reader, the same trip never twice', pull === null
  || (pull.includes('onList(domainOf(m.from?.emailAddress?.address), OWN_DOMAINS) && toEe(m)') && pull.includes('if (!releaseMailCandidate(m.subject, body))')
    && pull.includes('matchRelease(moves, d.itemId, plan.venueId, day, d.qty, 7, x => !x.mail_id)') && pull.includes('const { link, insert } = linkStorageRows(rows, moves);')));
const rel = sibling('supabase', 'functions', 'kount-order-mail', 'release.ts');
check('the reader: OpenRouter (routeClaude), the small model, structured answer with no nulls', rel === null
  || (rel.includes("model: 'claude-haiku-4-5'") && rel.includes('routeClaude(') && !rel.includes("'null'") && rel.includes("qty: { type: 'number'")));

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
