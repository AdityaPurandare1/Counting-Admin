/* Order tracker report (v0.79) — the Excel workbook to share internally:
   every order and line with its status, what is held in the warehouse, and
   invoiced spend by month. Rows are built by pure functions (tested); the
   workbook itself uses exceljs, lazy-loaded like the audit report so it stays
   out of the main bundle. */

import type ExcelJSNS from 'exceljs';
import {
  STATUS_LABEL, headlineStatus, lineTotal, orderState, receivedForLine, stockRows,
  type OtItem, type OtLine, type OtMove, type OtOrder, type StockRow,
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

export function buildReportRows(inp: ReportInput): ReportSheets {
  const linesByOrder = new Map<string, OtLine[]>();
  for (const l of inp.lines) (linesByOrder.get(l.order_id) ?? linesByOrder.set(l.order_id, []).get(l.order_id)!).push(l);
  const itemById = new Map(inp.items.map(i => [i.id, i]));

  const shown = inp.orders
    .filter(o => !o.archived_at)
    .filter(o => inp.includeClosed || orderState(o, linesByOrder.get(o.id) ?? []) === 'open')
    .sort((a, b) => (a.ordered_on ?? a.created_at).localeCompare(b.ordered_on ?? b.created_at));

  const orders: Cell[][] = [['Order #', 'Vendor', 'For', 'Deliver to', 'Ordered', 'Expected', 'Status', 'State', 'Lines', 'Order total', 'Invoiced', 'Invoice #s', 'Last update']];
  const lines: Cell[][] = [['Order #', 'Vendor', 'Item', 'SKU', 'Qty', 'Unit', 'Unit price', 'Line total', 'Status', 'Status since',
    'Quote #', 'Invoice #', 'Invoice date', 'Tracking #', 'Expected', 'Received into warehouse']];
  for (const o of shown) {
    const ls = (linesByOrder.get(o.id) ?? []).slice().sort((a, b) => a.sort - b.sort);
    const head = headlineStatus(ls);
    const invoiced = ls.filter(isInvoiced);
    const invNums = [...new Set(ls.map(l => l.invoice_number).filter(Boolean))].join(', ');
    const lastUpdate = [o.updated_at, ...ls.map(l => l.status_at)].sort().slice(-1)[0] ?? '';
    orders.push([o.order_number ?? '', o.vendor_name, inp.venueName(o.venue_id), o.deliver_to === 'warehouse' ? 'Warehouse' : 'Venue',
      o.ordered_on ?? '', o.expected_on ?? '', head ? STATUS_LABEL[head] : '—', orderState(o, ls), ls.length,
      r2(ls.filter(l => l.status !== 'CANCELLED').reduce((s, l) => s + lineTotal(l), 0)), r2(invoiced.reduce((s, l) => s + lineTotal(l), 0)),
      invNums, lastUpdate.slice(0, 10)]);
    for (const l of ls) {
      const item = l.item_id ? itemById.get(l.item_id) : undefined;
      const tracked = item?.track_stock && o.deliver_to === 'warehouse';
      lines.push([o.order_number ?? '', o.vendor_name, item?.name ?? l.description, l.sku ?? item?.sku ?? '', l.qty, l.unit ?? item?.unit ?? '',
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

  const pts = pricePoints(inp.lines, inp.orders, inp.items);
  const sp = spendByMonth(pts, 'vendor');
  const spend: Cell[][] = [['Month', ...sp.groups, 'Total']];
  for (const m of sp.months) spend.push([m, ...sp.groups.map(g => r2(sp.cells[m]?.[g] ?? 0)), r2(sp.totals[m])]);

  const open = shown.filter(o => orderState(o, linesByOrder.get(o.id) ?? []) === 'open');
  const liveLines = shown.flatMap(o => linesByOrder.get(o.id) ?? []).filter(l => l.status !== 'CANCELLED');
  const summary: Cell[][] = [
    ['Order tracker report', ''],
    ['Generated', inp.today],
    ['Orders in this report', shown.length],
    ['Open orders', open.length],
    ['', ''],
    ['Lines by status', ''],
    ...(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).filter(s => s !== 'CANCELLED')
      .map(s => [STATUS_LABEL[s], liveLines.filter(l => l.status === s).length] as Cell[]),
    ['', ''],
    ['Warehouse items', stock.length],
    ['Reorder now', stock.filter(s => s.state === 'reorder now').length],
    ['Reorder within 30 days', stock.filter(s => s.state === 'reorder soon').length],
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
  add('Warehouse', 'warehouse');
  add('Spend by month', 'spend');
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
