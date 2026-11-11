/* Order tracker report (v0.79) — the Excel workbook to share internally:
   every order and line with its status, what is held in the warehouse, and
   invoiced spend by month. v1.10: or one venue's — the user: "i cant pull a
   report per venue for the orders currently in process". Rows are built by pure functions (tested); the
   workbook itself uses exceljs, lazy-loaded like the audit report so it stays
   out of the main bundle. */

import type ExcelJSNS from 'exceljs';
import {
  MULTIPLE_VENUES, STATUS_LABEL, headlineStatus, lineTotal, orderState, orderVenueIds, receivedForLine, stockRows,
  type OtItem, type OtLine, type OtMove, type OtOrder, type OtTracking, type StockRow,
} from './orderTracker';
import { isInvoiced, pricePoints, spendByMonth } from './orderPrices';

export interface ReportInput {
  items: OtItem[];
  orders: OtOrder[];
  lines: OtLine[];
  moves: OtMove[];
  venueName: (id: string | null) => string;
  today: string;            // YYYY-MM-DD
  includeClosed: boolean;   // completed orders too (archived never)
  tracking?: OtTracking[];
  /** v1.10: one venue only — its orders, and of an order for several venues only its lines (totals, status and
   *  open / completed from those lines); no Warehouse sheet (that stock is not one venue's). null = every venue. */
  venueId?: string | null;
}

export type Cell = string | number | null;

export interface ReportSheets {
  summary: Cell[][];
  orders: Cell[][];
  lines: Cell[][];
  warehouse: Cell[][];
  spend: Cell[][];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** The venue a line is for: its own (an order for several venues), else the order's; null = warehouse stock. */
const lineVenue = (o: Pick<OtOrder, 'venue_id'>, l: Pick<OtLine, 'venue_id'>): string | null => {
  const v = l.venue_id ?? o.venue_id;
  return v && v !== MULTIPLE_VENUES ? v : null;
};

/** The venues the export can be for: every venue with an order that is not archived, by name. */
export function reportVenues(orders: OtOrder[], lines: OtLine[], venueName: (id: string | null) => string): Array<{ id: string; name: string }> {
  const byOrder = new Map<string, OtLine[]>();
  for (const l of lines) (byOrder.get(l.order_id) ?? byOrder.set(l.order_id, []).get(l.order_id)!).push(l);
  const ids = new Set(orders.filter(o => !o.archived_at).flatMap(o => orderVenueIds(o, byOrder.get(o.id) ?? [])));
  return [...ids].map(id => ({ id, name: venueName(id) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** "Order tracker report 2026-11-11.xlsx" / "Order tracker report - Delilah LA 2026-11-11.xlsx" (no characters a file name can't hold). */
export const reportFileName = (today: string, venue?: string | null) =>
  `Order tracker report${venue ? ` - ${venue.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}` : ''} ${today}.xlsx`;

export function buildReportRows(inp: ReportInput): ReportSheets {
  const linesByOrder = new Map<string, OtLine[]>();
  for (const l of inp.lines) (linesByOrder.get(l.order_id) ?? linesByOrder.set(l.order_id, []).get(l.order_id)!).push(l);
  const itemById = new Map(inp.items.map(i => [i.id, i]));
  const forVenue = inp.venueId ?? null;
  // one venue: only its lines of each order (an order for several venues is cut down to them)
  const linesOf = (o: OtOrder) => {
    const all = linesByOrder.get(o.id) ?? [];
    return forVenue ? all.filter(l => lineVenue(o, l) === forVenue) : all;
  };

  const shown = inp.orders
    .filter(o => !o.archived_at)
    .filter(o => !forVenue || orderVenueIds(o, linesByOrder.get(o.id) ?? []).includes(forVenue))
    .filter(o => inp.includeClosed || orderState(o, linesOf(o)) === 'open')
    .sort((a, b) => (a.ordered_on ?? a.created_at).localeCompare(b.ordered_on ?? b.created_at));

  const orders: Cell[][] = [['Order #', 'Vendor', 'For', 'Deliver to', 'Ordered', 'Expected', 'Status', 'State', 'Lines', 'Order total', 'Invoiced', 'Invoice #s', 'Tracking #s', 'Last update']];
  const lines: Cell[][] = [['Order #', 'Vendor', 'Venue', 'Item', 'SKU', 'Qty', 'Unit', 'Unit price', 'Line total', 'Status', 'Status since',
    'Quote #', 'Invoice #', 'Invoice date', 'Tracking #', 'Expected', 'Received into warehouse']];
  for (const o of shown) {
    const ls = linesOf(o).slice().sort((a, b) => a.sort - b.sort);
    // an order's tracking numbers are not per venue: for one venue of a shared order, only its own lines' numbers
    const orderTracking = !forVenue || orderVenueIds(o, linesByOrder.get(o.id) ?? []).length <= 1
      ? (inp.tracking ?? []).filter(t => t.order_id === o.id).map(t => t.tracking_number) : [];
    const head = headlineStatus(ls);
    const invoiced = ls.filter(isInvoiced);
    const invNums = [...new Set(ls.map(l => l.invoice_number).filter(Boolean))].join(', ');
    const lastUpdate = [o.updated_at, ...ls.map(l => l.status_at)].sort().slice(-1)[0] ?? '';
    orders.push([o.order_number ?? '', o.vendor_name, inp.venueName(forVenue ?? o.venue_id), o.deliver_to === 'warehouse' ? 'Warehouse' : 'Venue',
      o.ordered_on ?? '', o.expected_on ?? '', head ? STATUS_LABEL[head] : '—', orderState(o, ls), ls.length,
      r2(ls.filter(l => l.status !== 'CANCELLED').reduce((s, l) => s + lineTotal(l), 0)), r2(invoiced.reduce((s, l) => s + lineTotal(l), 0)),
      invNums, [...new Set([...orderTracking,
        ...ls.map(l => l.tracking_number).filter((x): x is string => !!x)])].join(', '), lastUpdate.slice(0, 10)]);
    for (const l of ls) {
      const item = l.item_id ? itemById.get(l.item_id) : undefined;
      const tracked = item?.track_stock && (l.deliver_to ?? o.deliver_to) === 'warehouse';
      lines.push([o.order_number ?? '', o.vendor_name, inp.venueName(l.venue_id ?? o.venue_id), item?.name ?? l.description, l.sku ?? item?.sku ?? '', l.qty, l.unit ?? item?.unit ?? '',
        l.unit_price, l.unit_price != null ? r2(lineTotal(l)) : null, STATUS_LABEL[l.status], l.status_at.slice(0, 10),
        l.quote_number ?? '', l.invoice_number ?? '', l.invoice_date ?? '', l.tracking_number ?? '', l.expected_on ?? o.expected_on ?? '',
        tracked ? receivedForLine(inp.moves, l.id) : null]);
    }
  }

  const stock: StockRow[] = stockRows(inp.items, inp.moves, inp.lines, inp.orders, inp.today);
  const warehouse: Cell[][] = [['Item', 'SKU', 'Vendor', 'Unit', 'On hand', 'Incoming (not received yet)', 'Of which delivered, awaiting receipt', 'Used per month', 'Months of cover',
    'Reorder point', 'Reorder by', 'Runs out by', 'Last count', 'Last receipt', 'Status']];
  for (const s of stock.sort((a, b) => a.item.name.localeCompare(b.item.name))) {
    warehouse.push([s.item.name, s.item.sku ?? '', s.item.vendor_name ?? '', s.item.unit, r2(s.onHand), r2(s.incoming), r2(s.awaitingReceipt),
      r2(s.monthlyUse), s.monthsCover != null ? r2(s.monthsCover) : null, s.reorderPoint != null ? r2(s.reorderPoint) : null,
      s.reorderBy ?? '', s.stockOutBy ?? '', s.lastCount ? `${s.lastCount.qty} on ${s.lastCount.moved_on}` : '',
      s.lastReceipt ? `${s.lastReceipt.qty} on ${s.lastReceipt.moved_on}` : '', s.state]);
  }

  const orderById = new Map(inp.orders.map(o => [o.id, o]));
  const spendLines = forVenue ? inp.lines.filter(l => { const o = orderById.get(l.order_id); return !!o && lineVenue(o, l) === forVenue; }) : inp.lines;
  const pts = pricePoints(spendLines, inp.orders, inp.items);
  const sp = spendByMonth(pts, 'vendor');
  const spend: Cell[][] = [['Month', ...sp.groups, 'Total']];
  for (const m of sp.months) spend.push([m, ...sp.groups.map(g => r2(sp.cells[m]?.[g] ?? 0)), r2(sp.totals[m])]);

  const open = shown.filter(o => orderState(o, linesOf(o)) === 'open');
  const liveLines = shown.flatMap(o => linesOf(o)).filter(l => l.status !== 'CANCELLED');
  const summary: Cell[][] = [
    [forVenue ? `Order tracker report: ${inp.venueName(forVenue)}` : 'Order tracker report', ''],
    ['Generated', inp.today],
    ...(forVenue ? [['Venue', inp.venueName(forVenue)] as Cell[], ['Orders for several venues', 'only this venue\'s lines'] as Cell[]] : []),
    ['Includes', inp.includeClosed ? 'open and completed orders' : 'open orders only (in process)'],
    ['Orders in this report', shown.length],
    ['Open orders', open.length],
    ['', ''],
    ['Lines by status', ''],
    ...(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).filter(s => s !== 'CANCELLED')
      .map(s => [STATUS_LABEL[s], liveLines.filter(l => l.status === s).length] as Cell[]),
    ...(forVenue ? [] : [
      ['', ''] as Cell[],
      ['Warehouse items', stock.length] as Cell[],
      ['Reorder now', stock.filter(s => s.state === 'reorder now').length] as Cell[],
      ['Reorder within 30 days', stock.filter(s => s.state === 'reorder soon').length] as Cell[],
    ]),
  ];
  return { summary, orders, lines, warehouse, spend };
}

const MONEY_COLS: Record<keyof ReportSheets, number[]> = {
  summary: [], orders: [10, 11], lines: [7, 8], warehouse: [], spend: [],
};

/** The .xlsx bytes. */
export async function buildReportWorkbook(inp: ReportInput): Promise<ArrayBuffer> {
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof import('exceljs') }).default ?? mod) as typeof ExcelJSNS;
  const rows = buildReportRows(inp);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'kOunt admin';
  const add = (name: string, key: keyof ReportSheets) => {
    const ws = wb.addWorksheet(name);
    for (const r of rows[key]) ws.addRow(r);
    if (key !== 'summary') {
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[key][0].length } };
    } else {
      ws.getCell('A1').font = { bold: true, size: 14 };
    }
    for (const c of MONEY_COLS[key]) ws.getColumn(c).numFmt = '#,##0.00';
    if (key === 'spend') for (let c = 2; c <= rows.spend[0].length; c++) ws.getColumn(c).numFmt = '#,##0.00';
    ws.columns.forEach(col => {
      let w = 10;
      col.eachCell?.({ includeEmpty: false }, cell => { w = Math.max(w, Math.min(60, String(cell.value ?? '').length + 2)); });
      col.width = w;
    });
  };
  add('Summary', 'summary');
  add('Orders', 'orders');
  add('Order lines', 'lines');
  if (!inp.venueId) add('Warehouse', 'warehouse');   // the warehouse is not one venue's (v1.10)
  add('Spend by month', 'spend');
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
