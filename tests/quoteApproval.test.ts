/**
 * v1.11 the quote approval e-mail. The user: "auto email send when I mark a quote approve. It should trigger an
 * email saying the quote is approved." Chosen: shown first, one click to send; a real send from the connected
 * mailbox once IT grants Mail.Send, Outlook until then. Shaped on OSE-0037 / E&E quote 582 (Aleli).  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { approvalDrafts, parseAddresses, sendFallbackText, type ThreadMail } from '../src/lib/quoteApprovalMail';
import { mailtoLink } from '../src/lib/orderFollowups';
import { approvalPhrase, awaitingApproval, findApproval, type OtDocument, type OtLine, type OtOrder } from '../src/lib/orderTracker';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

let n = 0;
const id = (p: string) => `${p}-0000-0000-0000-${String(++n).padStart(12, '0')}`.padStart(36, '0');
const order = (over: Partial<OtOrder> = {}): OtOrder => ({
  id: id('o'), order_number: 'OSE-0037', vendor_name: 'EE Mercantile', venue_id: 'x:Delilah Dallas', deliver_to: 'venue', ordered_on: '2026-11-03',
  expected_on: null, notes: null, completed_at: null, archived_at: null, created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:00:00Z', ...over,
});
const line = (o: OtOrder, over: Partial<OtLine> = {}): OtLine => ({
  id: id('l'), order_id: o.id, item_id: null, description: 'NICK & NORA - Custom Model No. 6424', sku: '6424', qty: 8, unit: 'case', unit_price: 50.38,
  status: 'QUOTED', status_at: '2026-11-05T10:00:00Z', quote_number: '582', invoice_number: null, invoice_date: null, tracking_number: null,
  expected_on: null, sort: 0, ...over,
});
const venueName = (v: string | null) => (v === 'x:Delilah Dallas' ? 'Delilah Dallas' : v ?? 'Warehouse');
const me = { email: 'apurandare@hwoodgroup.com', name: 'Aditya Purandare' };

const o = order();
const l1 = line(o), l2 = line(o, { description: 'DINNER FORK 5340Z021', sku: '5340Z021' });
const noNum = line(o, { quote_number: null, description: 'SERVICE TRAY - Custom' });
const done = line(o, { quote_approved_at: '2026-11-06T18:00:00Z', quote_approved_for: '582' });   // already approved by e-mail
const doc = { id: 'd1', order_id: o.id, kind: 'quote', doc_number: '582', source_message_id: 'MSG-582' } as unknown as OtDocument;
const mails: ThreadMail[] = [{ message_id: 'MSG-582', order_id: o.id, sender_email: 'Aleli@eemercantile.co', sender_name: 'Aleli Cruz', subject: 'Quote 582 - Delilah Dallas glassware', received_at: '2026-11-05T17:00:00Z' }];

const drafts = approvalDrafts(o, [l1, l2, noNum, done], [doc], mails, venueName, me);
const q582 = drafts.find(d => d.quote === '582')!;
const blank = drafts.find(d => d.quote === null)!;
check('one draft per quote waiting for approval (an approved line is not in it)', drafts.length === 2 && q582.lines.length === 2 && !q582.lines.includes(done) && blank.lines.length === 1, drafts.map(d => [d.quote, d.lines.length]));
check('the quote came by e-mail: a reply in that thread, to its sender, "Re:" its subject', q582.replyTo === 'MSG-582' && q582.email.to.join() === 'aleli@eemercantile.co'
  && q582.email.subject === 'Re: Quote 582 - Delilah Dallas glassware' && q582.email.cc.length === 0, q582);
check('the text: greets the vendor, says approved, names the quote / venue / order, signed by me',
  q582.email.body === 'Hi Aleli,\n\nApproved, please go ahead with quote 582 for Delilah Dallas (OSE-0037) and send over the invoice.\n\nThank you,\nAditya', q582.email.body);
check('the 9 o\'clock pull reads that text as our approval (if it goes out from Outlook)', !!approvalPhrase(q582.email.body)
  && !!findApproval([{ id: 'm', sentDateTime: '2026-11-11T18:00:00Z', isDraft: false, from: { emailAddress: { address: me.email } },
    toRecipients: [{ emailAddress: { address: 'aleli@eemercantile.co' } }], uniqueBody: { content: q582.email.body } }], Date.parse('2026-11-05T17:00:00Z')));
check('no quote e-mail: a new e-mail to E&E\'s buyer (Aleli for OSE), its own subject', blank.replyTo === null && blank.email.to.join() === 'aleli@eemercantile.co'
  && blank.email.subject === 'Quote approved – OSE-0037 – Delilah Dallas' && /Approved, please go ahead with the quote for Delilah Dallas \(OSE-0037\)/.test(blank.email.body), blank);
const fwd = approvalDrafts(o, [l1], [doc], [{ ...mails[0], sender_email: 'hjariwala@hwoodgroup.com', sender_name: 'Hursh Jariwala' }], venueName, me)[0];
check('a quote that reached us forwarded by a colleague: not a reply to them — a new e-mail to the vendor', fwd.replyTo === null && fwd.email.to.join() === 'aleli@eemercantile.co', fwd);
const cus = approvalDrafts(order({ order_number: 'CUS-0042', vendor_name: 'EE Mercantile' }), [], [], [], venueName, me);
check('nothing waiting -> no draft', cus.length === 0);
check('lines all approved -> nothing waits', !awaitingApproval(done) && awaitingApproval(l1));

check('addresses: commas / semicolons / spaces, <> stripped, lower-cased, bad ones named', JSON.stringify(parseAddresses('Aleli@eemercantile.co; <jemma@eemercantile.co>, nope'))
  === JSON.stringify({ ok: ['aleli@eemercantile.co', 'jemma@eemercantile.co'], bad: ['nope'] }));
check('why it did not send, in words', /waiting on IT/.test(sendFallbackText({ reason: 'not_granted' })) && /Only apurandare@hwoodgroup\.com's owner/.test(sendFallbackText({ reason: 'not_owner', mailbox: 'apurandare@hwoodgroup.com' }))
  && /not connected/.test(sendFallbackText({ reason: 'not_connected' })) && /Not sent: boom/.test(sendFallbackText({ detail: 'boom' })));
const link = mailtoLink(q582.email);
check('Outlook instead: the same e-mail, filled in', link.startsWith('mailto:aleli%40eemercantile.co?') && link.includes('subject=Re%3A%20Quote%20582') && link.includes('Approved%2C%20please%20go%20ahead'));

// ── the function ──
const fn = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
const graph = sibling('supabase', 'functions', 'kount-order-mail', 'graph.ts');
if (fn && graph) {
  const block = fn.slice(fn.indexOf("if (action === 'approve_quote')"), fn.indexOf("if (action === 'approvals')"));
  check('function: the read sign-in is unchanged; sending asks for Mail.Send separately', /export const SCOPE = 'Mail\.Read openid profile offline_access';/.test(graph)
    && /export const SEND_SCOPE = 'https:\/\/graph\.microsoft\.com\/Mail\.Send';/.test(graph) && /refreshAccess\(String\(refresh\), SEND_SCOPE\)/.test(block));
  check('function: the send path never stores a token or marks Outlook for reconnect', block.length > 500 && !/kount_ot_mail_token_set/.test(block) && !/reconnect/.test(block));
  check('function: only the connected mailbox\'s owner sends; anyone else is told to use Outlook', /String\(acct\.mailbox \?\? ''\)\.toLowerCase\(\) !== caller\.email\) return json\(200, \{ sent: false, reason: 'not_owner'/.test(block));
  check('function: only this order\'s Quoted lines of that quote', /l\.order_id !== p\.order_id \|\| l\.status !== 'QUOTED' \|\| quoteKey\(l\.quote_number \?\? ''\) !== quoteKey\(quote \?\? ''\)/.test(block));
  check('function: a reply in the quote thread, else a new e-mail', /graphPost\(token, `\/me\/messages\/\$\{encodeURIComponent\(replyTo\)\}\/reply`, \{ message \}\)/.test(block)
    && /graphPost\(token, '\/me\/sendMail', \{ message: \{ \.\.\.message, subject \}, saveToSentItems: true \}\)/.test(block));
  check('function: no permission yet -> not sent, said so (never an error page)', (block.match(/reason: 'not_granted'/g) ?? []).length === 2);
  check('function: lines stamped approved only after the send, and only still-Quoted ones',
    block.indexOf("/me/sendMail") < block.indexOf('quote_approved_at: nowIso()') && /\.in\('id', ids as string\[\]\)\.eq\('status', 'QUOTED'\)/.test(block));
  const post = graph.slice(graph.indexOf('export async function graphPost'), graph.indexOf('export async function graphGet'));
  check('graph: a send is tried once (a retry could send it twice), with immutable ids', post.length > 100 && !/attempt/.test(post) && /IdType=\\?"ImmutableId\\?"/.test(post));
}

// ── where it shows ──
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const drawer = src('src/components/orderTracker/OrderDrawer.tsx');
const dlg = src('src/components/orderTracker/QuoteApprovalDialog.tsx');
check('order panel: "Approve & e-mail vendor" on the approve banner opens the e-mail first',
  /Approve &amp; e-mail vendor/.test(drawer) && /setApproving\(approvalDrafts\(order, lines, docs, mails, venueName/.test(drawer) && /<QuoteApprovalDialog order=\{order\} drafts=\{approving\}/.test(drawer));
check('order panel: Escape closes the e-mail, not the order', /document\.querySelector\('\.ot-viewer, \.ot-dialog'\)/.test(drawer));
check('the e-mail: Send approval / Open in Outlook instead / Cancel; Send calls approve_quote with the lines',
  /Send approval/.test(dlg) && /Open in Outlook instead/.test(dlg) && /approveQuote\(\{ order_id: order\.id, line_ids: d\.lines\.map\(l => l\.id\)/.test(dlg) && /window\.location\.href = mailtoLink\(email\)/.test(dlg));
check('the tracker hands the Inbox and who is signed in down to the order panel', /mails=\{inbox\} me=\{\{ email: user\.email, name: user\.name \}\}/.test(src('src/screens/OrderTracker.tsx'))
  && /mails=\{mails\} me=\{me\}/.test(src('src/components/orderTracker/OrdersView.tsx')));

// ── v1.12 Reply in Outlook: "Can it go to the thread some how ?" (without Mail.Send) ──
{
  check('no send permission + the quote came by e-mail: points to Reply in Outlook (it stays in the thread)',
    /Use Reply in Outlook: it opens the vendor's quote e-mail with the message copied, so it stays in the thread\./.test(sendFallbackText({ reason: 'not_granted' }, true))
    && /Open it in Outlook and send it there\./.test(sendFallbackText({ reason: 'not_granted' }, false)));
  const dlgSrc = readFileSync(join(process.cwd(), 'src/components/orderTracker/QuoteApprovalDialog.tsx'), 'utf8');
  check('the dialog finds the quote e-mail when it opens (so the click can open it at once)', /messageLink\(d\.replyTo\)\.then/.test(dlgSrc) && /if \(d\.replyTo\) \{/.test(dlgSrc));
  check('Reply in Outlook: copies the message, opens the quote e-mail in a new tab, says what to do',
    /const copying = navigator\.clipboard \? navigator\.clipboard\.writeText\(text\)/.test(dlgSrc) && dlgSrc.indexOf('const copying') < dlgSrc.indexOf("window.open(link.url, '_blank', 'noopener')")
    && dlgSrc.indexOf("window.open(link.url, '_blank', 'noopener')") < dlgSrc.indexOf('const copied = await copying') && /disabled=\{busy \|\| !canReply \|\| !text\.trim\(\)\}/.test(dlgSrc) && /click Reply, paste \(Ctrl\+V\) and Send\. It stays in the thread/.test(dlgSrc));
  check('a quote that came by e-mail offers Reply in Outlook and a new e-mail; one that did not, Open in Outlook',
    />\s*Reply in Outlook<\/button>/.test(dlgSrc) && />New e-mail in Outlook<\/button>/.test(dlgSrc) && />Open in Outlook instead<\/button>/.test(dlgSrc));
  const fn2 = sibling('supabase', 'functions', 'kount-order-mail', 'index.ts');
  if (fn2) {
    const blk = fn2.slice(fn2.indexOf("if (action === 'message_link')"), fn2.indexOf("if (action === 'approve_quote')"));
    check('function message_link: only the mailbox\'s owner, read token only, just the webLink, only an Outlook address',
      blk.length > 300 && /!== caller\.email\) return json\(200, \{ link: null, reason: 'not_owner'/.test(blk) && /refreshAccess\(String\(refresh\)\);/.test(blk) && !/SEND_SCOPE/.test(blk)
      && /\?\$select=webLink`/.test(blk) && /\^https:\\\/\\\/outlook\\\.\(office365\|office\|live\)\\\.com\\\//.test(blk) && !/graphPost/.test(blk));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
