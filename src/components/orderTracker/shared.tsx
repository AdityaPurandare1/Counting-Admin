/* Shared pieces for the Purchasing > Order tracker / Order prices screens (v0.79). */
import type { CSSProperties } from 'react';
import { Pill } from '@/components/atoms';
import { STATUS_LABEL, type LineStatus } from '@/lib/orderTracker';

type Tone = 'neutral' | 'gold' | 'critical' | 'caution' | 'positive' | 'inform' | 'ink' | 'ghost';

const STATUS_TONE: Record<LineStatus, Tone> = {
  REQUESTED: 'ghost', ORDERED: 'neutral', QUOTED: 'inform', INVOICED: 'gold', PAID: 'ink',
  SHIPPED: 'caution', DELIVERED: 'positive', RECEIVED: 'positive', CANCELLED: 'ghost',
};

/** Status always carries its name — the colour is a second channel, never the only one. */
export function StatusPill({ status }: { status: LineStatus | null }) {
  if (!status) return <Pill tone="ghost" size="sm">No lines</Pill>;
  return <Pill tone={STATUS_TONE[status]} size="sm">{STATUS_LABEL[status]}</Pill>;
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtMoney0 = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
export function fmtCompact(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '−$' : '$';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return s + a.toFixed(0);
}
export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`;
}
export function monthName(ym: string): string { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; }

export function download(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export const picker: CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)' };
export const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '.05em' };
export const tbl: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
export const headRow: CSSProperties = { textAlign: 'left', color: 'var(--fg-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
export const th: CSSProperties = { padding: '9px 10px', whiteSpace: 'nowrap' };
export const thR: CSSProperties = { ...th, textAlign: 'right' };
export const td: CSSProperties = { padding: '9px 10px', verticalAlign: 'top' };
export const tdNum: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
export const rowBorder: CSSProperties = { borderTop: '1px solid var(--border)' };
export const subTxt: CSSProperties = { fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 };
export const linkBtn: CSSProperties = { border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--fg-primary)', textDecoration: 'underline', textDecorationColor: 'var(--border-strong)', cursor: 'pointer', textAlign: 'left' };
export const errBox: CSSProperties = { margin: '8px 0', padding: '10px 12px', borderRadius: 8, background: 'rgba(214,51,108,0.10)', border: '1px solid var(--raspberry-300)', fontSize: 12 };
export const okBox: CSSProperties = { margin: '8px 0', padding: '10px 12px', borderRadius: 8, background: 'var(--teal-100)', border: '1px solid var(--teal-300)', fontSize: 12 };
export const smallInput: CSSProperties = { ...picker, padding: '4px 6px', fontSize: 12 };
