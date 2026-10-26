/** Ask AI (v0.75): the compact, plain-text context the admin assistant gets
 *  about one venue's latest variance report.
 *
 *  Pure (no Supabase, no React) so it can be unit-tested. The ask-ai Edge
 *  Function caps the whole system prompt at 8,000 characters, so this keeps
 *  the venue block under CONTEXT_CHAR_BUDGET and degrades by dropping rows,
 *  never by cutting a line in half. */

export interface AskAiRow {
  item_name: string | null;
  category: string | null;
  actual: number | null;
  theo: number | null;
  variance: number | null;
  variance_value: number | null;
  cu_price: number | null;
}

export interface AskAiReportMeta {
  /** When the report was computed (ISO). */
  asOf: string | null;
  source: string | null;
}

export const CONTEXT_CHAR_BUDGET = 5500;
const TOP_N = 15;

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function money(v: number): string {
  const sign = v < 0 ? '-' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

function itemLine(r: AskAiRow): string {
  const counted = n(r.actual), theo = n(r.theo), cost = n(r.cu_price);
  return '- ' + (r.item_name || '(unnamed)') + ' | counted ' + qty(counted) + ' | expected ' + qty(theo) +
    ' | variance ' + qty(counted - theo) + ' (' + money(n(r.variance_value)) + ')' +
    ' | unit cost ' + (cost > 0 ? money(cost) : 'none');
}

/** The base instructions every admin chat gets, with or without venue data. */
export function baseSystemPrompt(): string {
  return [
    "You are the assistant inside the kΩunt admin (Keva), h.wood Group's bar inventory system.",
    'Answer concisely and directly, for a bar manager or finance reader. No preamble.',
    'Variance = counted minus expected, where expected = start count + purchases - POS sales depletions over the count window.',
    'A negative variance is a shortage (possible loss); positive is an overage. Dollar values use each item\'s unit cost.',
    'Use only the data provided below. If a question needs data that is not provided, say what is missing instead of guessing.',
    'You cannot change counts, costs or any record; point the user to the admin screen that does it when relevant.',
  ].join(' ');
}

/** The venue block: totals, category roll-up, largest shortages and overages, unpriced items. */
export function buildVarianceContext(venueName: string, meta: AskAiReportMeta, rows: AskAiRow[]): string {
  if (rows.length === 0) {
    return 'VENUE: ' + venueName + '\nNo variance report is available for this venue yet (no closed count with a computed report).';
  }
  let countedV = 0, theoV = 0, shrink = 0, over = 0, unpriced = 0;
  const byCat = new Map<string, { counted: number; net: number; items: number }>();
  for (const r of rows) {
    const cost = n(r.cu_price);
    const vv = n(r.variance_value);
    countedV += n(r.actual) * cost;
    theoV += n(r.theo) * cost;
    if (vv < 0) shrink += vv; else over += vv;
    if (cost <= 0) unpriced++;
    const cat = r.category || 'Uncategorised';
    const c = byCat.get(cat) ?? { counted: 0, net: 0, items: 0 };
    c.counted += n(r.actual) * cost;
    c.net += vv;
    c.items++;
    byCat.set(cat, c);
  }
  const net = shrink + over;
  const pct = theoV !== 0 ? (net / theoV) * 100 : 0;
  const asOf = meta.asOf ? meta.asOf.slice(0, 10) : 'unknown date';

  const head: string[] = [
    'VENUE: ' + venueName,
    'LATEST VARIANCE REPORT: ' + (meta.source || 'computed') + ', as of ' + asOf + ', ' + rows.length + ' items (' + unpriced + ' with no unit cost, valued at $0).',
    'TOTALS: counted value ' + money(countedV) + '; expected value ' + money(theoV) + '; net variance ' + money(net) +
      ' (' + pct.toFixed(1) + '% of expected); shortages ' + money(shrink) + '; overages ' + money(over) + '.',
    'BY CATEGORY:',
    ...[...byCat.entries()]
      .sort((a, b) => a[1].net - b[1].net)
      .map(([cat, c]) => '- ' + cat + ': ' + c.items + ' items, counted ' + money(c.counted) + ', net variance ' + money(c.net)),
  ];

  const shortages = rows.filter(r => n(r.variance_value) < 0).sort((a, b) => n(a.variance_value) - n(b.variance_value));
  const overages = rows.filter(r => n(r.variance_value) > 0).sort((a, b) => n(b.variance_value) - n(a.variance_value));
  const noCost = rows.filter(r => n(r.cu_price) <= 0 && n(r.actual) > 0).map(r => r.item_name || '(unnamed)');

  // Add sections while they fit; each list is shortened row by row if needed.
  const out = [...head];
  const fit = (lines: string[]) => (out.join('\n').length + lines.join('\n').length + 1) <= CONTEXT_CHAR_BUDGET;
  const addList = (title: string, items: string[]) => {
    if (items.length === 0) return;
    let take = Math.min(items.length, TOP_N);
    while (take > 0 && !fit([title, ...items.slice(0, take)])) take--;
    if (take > 0) out.push(title, ...items.slice(0, take));
  };
  addList('LARGEST SHORTAGES (most negative $ first):', shortages.map(itemLine));
  addList('LARGEST OVERAGES:', overages.map(itemLine));
  addList('COUNTED BUT NO UNIT COST (first ' + Math.min(noCost.length, TOP_N) + ' of ' + noCost.length + '):', noCost.map(x => '- ' + x));
  return out.join('\n');
}
