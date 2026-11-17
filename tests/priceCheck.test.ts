/**
 * v1.23 Price check (0176). The user, 11/17: "check for each BOH and FOH item if its being purchased right ... the
 * exact same item mentioned in the bible. all specs have to match exactly. It should run weekly ... If there is a
 * website which doesnt really have those labelled as such but need a quote tag them as quote required".  npm test
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { counts, fmtUnit, itemView, needsQuote, rowsFor, runLine, type PcCheck, type PcData, type PcItem } from '../src/lib/priceCheck';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`, detail ?? ''); }
}
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const sibling = (...parts: string[]) => { const p = join(process.env.COUNTING_APP_DIR ?? join(process.cwd(), '..', 'Counting-App'), ...parts); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

let n = 0;
const item = (over: Partial<PcItem> = {}): PcItem => ({
  id: `i${++n}`, item_key: `K${n}`, item_no: `K${n}`, manufacturer: 'Steelite', item_name: `Item ${n}`, description: null, size: null, specs: {},
  sources: [{ venue_id: 'v1', bible_id: 'b1', title: 'Delilah LA Bible 2026', sheet: 'Smallware' }], bible_price: null, bible_link: null,
  checkable: true, bought: false, active: true, due_at: null, claimed_at: null, last_check_id: null, last_status: null, last_checked_at: null,
  quote_state: null, quote_vendor: null, quote_price: null, quote_note: null, quote_by: null, quote_at: null, ...over,
});
const chk = (i: PcItem, over: Partial<PcCheck> = {}): PcCheck => ({
  id: `c${i.id}`, item_id: i.id, run_id: null, checked_at: '2026-11-21T04:00:00Z', status: i.last_status ?? 'ok', our_unit_price: null, purchases: [],
  best_unit_price: null, best_vendor: null, best_url: null, savings_pct: null, offers: [], quote_vendors: [], rejected: [], notes: null, model: null, cost_usd: null, searches: null, error: null, ...over,
});

const over1 = item({ item_name: 'Oyster Fork', last_status: 'overpaying', bought: true });
const over2 = item({ item_name: 'Dessert Spoon', last_status: 'overpaying', bought: true, sources: [{ venue_id: 'v2', bible_id: 'b2', title: 'Miami', sheet: 'S' }] });
const quoteOnly = item({ item_name: 'Bordeaux', last_status: 'quote_required' });
const okWithQuote = item({ item_name: 'Coupe', last_status: 'ok', bought: true });
const received = item({ item_name: 'Flute', last_status: 'quote_required', quote_state: 'received', quote_price: 3.1 });
const noId = item({ item_name: 'pasta bowl', checkable: false, item_no: null });
const fresh = item({ item_name: 'Carafe' });
const d: PcData = {
  items: [over1, over2, quoteOnly, okWithQuote, received, noId, fresh],
  checks: new Map([
    [over1.id, chk(over1, { savings_pct: 12, our_unit_price: 8.2, best_unit_price: 7.2 })],
    [over2.id, chk(over2, { savings_pct: 39, our_unit_price: 8.2, best_unit_price: 5 })],
    [quoteOnly.id, chk(quoteOnly, { quote_vendors: [{ seller: 'Zwiesel', url: 'https://z.com', note: 'request a quote' }] })],
    [okWithQuote.id, chk(okWithQuote, { quote_vendors: [{ seller: 'Steelite', url: 'https://s.com', note: 'trade pricing' }] })],
    [received.id, chk(received, { quote_vendors: [{ seller: 'Libbey', url: 'https://l.com', note: 'quote' }] })],
  ]),
  runs: [], settings: null,
};

check('a row: no item # / not checked yet / its verdict', itemView(noId) === 'no_item_no' && itemView(fresh) === 'unchecked' && itemView(over1) === 'overpaying');
check('quote required: any seller that only quotes, until a quote is received', needsQuote(quoteOnly, d.checks.get(quoteOnly.id)) && needsQuote(okWithQuote, d.checks.get(okWithQuote.id))
  && !needsQuote(received, d.checks.get(received.id)) && !needsQuote(fresh, undefined));
const c = counts(d);
check('the tiles count each filter', c.overpaying === 2 && c.quote === 2 && c.ok === 1 && c.no_item_no === 1 && c.unchecked === 1 && c.all === 7, c);
check('overpaying: the biggest gap first', rowsFor(d, 'overpaying').map(i => i.item_name).join() === 'Dessert Spoon,Oyster Fork');
check('a venue keeps its own bible items', counts(d, 'v2').all === 1 && rowsFor(d, 'all', 'v2')[0].item_name === 'Dessert Spoon');
check('search: item, maker, item #', rowsFor(d, 'all', '', 'oyster steelite').length === 1 && rowsFor(d, 'all', '', over2.item_no!).length === 1);
check('the run line', runLine(undefined, false) === 'Switched off - no run yet.'
  && runLine({ id: 'r', trigger: 'weekly', model: null, started_at: '2026-11-21T03:00:00Z', finished_at: null, items_total: 952, items_done: 412, cost_usd: 61.2, budget_usd: 200, stopped: null }, true)
    === 'Run started Fri, 11/20, 7:00 PM: 412 of 952 checked, $61.20 of the $200 budget.',
  runLine({ id: 'r', trigger: 'weekly', model: null, started_at: '2026-11-21T03:00:00Z', finished_at: null, items_total: 952, items_done: 412, cost_usd: 61.2, budget_usd: 200, stopped: null }, true));
check('price per piece: cents, tenths of a cent under $1', fmtUnit(4.9992) === '$5.00' && fmtUnit(0.3125) === '$0.313' && fmtUnit(null) === '-');

const app = src('src/App.tsx'), routes = src('src/lib/routes.ts');
check('Purchasing > Price check, behind the Order prices permission', /path="\/price-check"\s+element=\{gate\('purchasing:order-prices', <PriceCheck/.test(app)
  && /\{ to: '\/price-check', label: 'Price check', key: 'purchasing:order-prices' \}/.test(routes));
check('version 1.23', /APP_VERSION = '1\.23'/.test(src('src/lib/version.ts')));

const fn = sibling('supabase', 'functions', 'kount-price-check', 'index.ts');
const mig = sibling('supabase', 'migrations', '0176_kount_price_check.sql');
const toml = sibling('supabase', 'config.toml');
if (fn && mig && toml) {
  check('function: the cron calls need the secret; people need Order tracker or Order prices', /action === 'weekly' \|\| action === 'work'/.test(fn)
    && /safeEqual\(req\.headers\.get\('x-kount-cron'\)/.test(fn) && /const FEATURES = \['purchasing:order-tracker', 'purchasing:order-prices'\];/.test(fn));
  check('function: OpenRouter web search + web fetch, data_collection deny, the key from the secrets', /type: 'openrouter:web_search'/.test(fn) && /type: 'openrouter:web_fetch'/.test(fn)
    && /provider: \{ data_collection: 'deny' \}/.test(fn) && /Deno\.env\.get\('OPENROUTER_API_KEY'\)/.test(fn));
  check('function: stops at the weekly budget; a switched-off check does nothing on its schedule', /overBudget\(Number\(run\.cost_usd\), Number\(run\.budget_usd\)\)/.test(fn)
    && /if \(!st\.enabled\) return json\(200, \{ skipped: 'the price check is switched off' \}\);/.test(fn));
  check('0176: off until switched on, $200 a week, Sonnet 5.5, 10% threshold', /enabled boolean not null default false/.test(mig) && /weekly_budget_usd numeric not null default 200/.test(mig)
    && /model text not null default 'anthropic\/claude-sonnet-5\.5'/.test(mig) && /overpay_pct numeric not null default 10/.test(mig));
  check('0176: read by Order tracker or Order prices; writes only through the function or the two RPCs', /kount_has_feature\(''purchasing:order-tracker''\) or public\.kount_has_feature\(''purchasing:order-prices''\)/.test(mig)
    && !/for (insert|update|delete) to authenticated/.test(mig) && /revoke all on function public\.kount_pc_claim\(int\) from public, anon, authenticated;/.test(mig));
  check('0176: weekly Saturday evening + every 3 min while due, both only when on', /cron\.schedule\('kount-price-check-weekly', '0 3 \* \* 6'/.test(mig) && /cron\.schedule\('kount-price-check-work', '\*\/3 \* \* \* \*'/.test(mig)
    && (mig.match(/where exists \(select 1 from public\.kount_pc_settings where id = 1 and enabled\)/g) ?? []).length === 2);
  check('0176: items we have bought are checked first', /order by c\.bought desc, c\.due_at/.test(mig));
  check('config.toml pins verify_jwt = false for kount-price-check', /\[functions\.kount-price-check\][^[]*verify_jwt = false/.test(toml));
} else console.log('  (skipped: no Counting-App next to this repo)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
