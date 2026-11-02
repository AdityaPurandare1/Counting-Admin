/* Small SVG charts for the Purchasing tabs (v0.79): a step line chart for a
   price over time and a stacked column chart for spend by month. Mark specs
   follow the dataviz rules used on Liquor & wine prices: 2px lines, 8px
   markers with a 2px surface ring, ≤24px columns with a 4px rounded data end
   and a 2px surface gap between stacked parts, hairline grid, a legend for 2+
   series, hover / focus tooltips (values also in the table below each chart). */

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/** Validated categorical slots (dataviz default palette, light surface). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
export const OTHER_GRAY = '#898781';

/** Clean axis ticks (1 / 2 / 2.5 / 5 × 10^n steps) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v < hi + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Container width via ResizeObserver; a callback ref so it attaches whenever the element mounts. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(Math.floor(e.contentRect.width)); });
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

export function Legend({ items }: { items: Array<{ label: string; color: string; kind: 'rect' | 'line' }> }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-secondary)' }}>
      {items.map(i => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={i.kind === 'rect'
            ? { width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }
            : { width: 16, height: 2, background: i.color, display: 'inline-block' }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const style: CSSProperties = {
    position: 'absolute', left: Math.max(0, x), top: y, pointerEvents: 'none', zIndex: 5,
    background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 8,
    padding: '8px 10px', boxShadow: 'var(--shadow-sm)', minWidth: 160,
  };
  return <div style={style}>{children}</div>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthShort(ym: string): string { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; }

/* ── step line chart ──────────────────────────────────────────────────── */

export interface LinePoint { x: string; y: number; tip: ReactNode }
export interface LineSeries { key: string; label: string; color: string; points: LinePoint[] }

/** Value over time, one step line per series (a price holds until the next invoice). */
export function StepLineChart({ series, yFormat, ariaLabel, height = 240 }: {
  series: LineSeries[]; yFormat: (v: number) => string; ariaLabel: string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);
  const pts = series.flatMap(s => s.points);
  if (pts.length < 2) return <div ref={ref} />;
  const H = height, PL = 64, PR = 12, PT = 12, PB = 26;
  const W = Math.max(width, 320);
  const t = (d: string) => new Date(d + 'T00:00:00').getTime();
  const t0 = Math.min(...pts.map(p => t(p.x))), t1 = Math.max(...pts.map(p => t(p.x)));
  const lo = Math.min(...pts.map(p => p.y)), hi = Math.max(...pts.map(p => p.y));
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
  const ticks = niceTicks(Math.max(0, lo - pad), hi + pad, 4);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const x = (d: string) => PL + (t1 === t0 ? (W - PL - PR) / 2 : ((t(d) - t0) / (t1 - t0)) * (W - PL - PR));
  const y = (v: number) => H - PB - ((v - yMin) / (yMax - yMin || 1)) * (H - PT - PB);
  const xTicks: string[] = [];
  {
    const a = new Date(t0), b = new Date(t1);
    const span = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    const step = Math.max(1, Math.ceil(span / 6));
    for (let k = 0; k <= span; k += step) {
      const d = new Date(a.getFullYear(), a.getMonth() + k, 1);
      if (d.getTime() >= t0) xTicks.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    }
  }
  const hp = hover ? series[hover.s]?.points[hover.i] : null;
  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 10 }}>
      {series.length > 1 && <Legend items={series.map(s => ({ label: s.label, color: s.color, kind: 'line' as const }))} />}
      <svg width={W} height={H} role="img" aria-label={ariaLabel}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--fg-muted)">{yFormat(v)}</text>
          </g>
        ))}
        {xTicks.map(d => <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">{monthShort(d.slice(0, 7))}</text>)}
        {series.map((s, si) => (
          <g key={s.key}>
            <path d={s.points.map((p, i) => (i === 0 ? `M ${x(p.x)} ${y(p.y)}` : `H ${x(p.x)} V ${y(p.y)}`)).join(' ')}
                  fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, i) => (
              <g key={i}>
                <circle cx={x(p.x)} cy={y(p.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                <circle cx={x(p.x)} cy={y(p.y)} r={12} fill="transparent" tabIndex={0}
                        onMouseEnter={() => setHover({ s: si, i })} onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover({ s: si, i })} onBlur={() => setHover(null)} />
              </g>
            ))}
          </g>
        ))}
      </svg>
      {hp && <ChartTooltip x={Math.min(x(hp.x) + 12, W - 220)} y={Math.max(0, y(hp.y) - 10)}>{hp.tip}</ChartTooltip>}
    </div>
  );
}

/* ── stacked column chart ─────────────────────────────────────────────── */

export interface ColumnKey { key: string; label: string; color: string }

/** One column per month, parts stacked in `keys` order. `values[month][key]`. */
export function ColumnChart({ months, keys, values, yFormat, tip, ariaLabel, height = 240 }: {
  months: string[]; keys: ColumnKey[]; values: Record<string, Record<string, number>>;
  yFormat: (v: number) => string; tip: (month: string) => ReactNode; ariaLabel: string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!months.length) return <div ref={ref} style={{ padding: 24, color: 'var(--fg-muted)' }}>Nothing to show for these filters.</div>;
  const H = height, PL = 64, PR = 8, PT = 12, PB = 26;
  const stack = (m: string) => keys.reduce((s, k) => s + Math.max(0, values[m]?.[k.key] ?? 0), 0);
  const ticks = niceTicks(0, Math.max(...months.map(stack), 1), 4);
  const top = ticks[ticks.length - 1];
  const W = Math.max(width, 320);
  const band = (W - PL - PR) / months.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => H - PB - (v / top) * (H - PT - PB);
  const every = Math.ceil(months.length / 12);
  const path = (x0: number, y0: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h);
    return `M ${x0} ${y0 + h} V ${y0 + rr} Q ${x0} ${y0} ${x0 + rr} ${y0} H ${x0 + w - rr} Q ${x0 + w} ${y0} ${x0 + w} ${y0 + rr} V ${y0 + h} Z`;
  };
  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 10 }}>
      {keys.length > 1 && <Legend items={keys.map(k => ({ label: k.label, color: k.color, kind: 'rect' as const }))} />}
      <svg width={W} height={H} role="img" aria-label={ariaLabel}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-muted)">{yFormat(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = PL + band * i + band / 2;
          let base = 0;
          const live = keys.filter(k => (values[m]?.[k.key] ?? 0) > 0);
          return (
            <g key={m}>
              {live.map((k, ki) => {
                const v = values[m][k.key];
                const y0 = y(base), y1 = y(base + v);
                base += v;
                const h = Math.max(0, y0 - y1 - (ki > 0 ? 2 : 0));   // 2px surface gap between parts
                if (h <= 0) return null;
                return <path key={k.key} d={path(cx - barW / 2, y1, barW, h, ki === live.length - 1 ? 4 : 0)} fill={k.color} opacity={hover == null || hover === i ? 1 : 0.55} />;
              })}
              {i % every === 0 && <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">{monthShort(m)}</text>}
              <rect x={PL + band * i} y={PT} width={band} height={H - PT - PB} fill="transparent" tabIndex={0}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            </g>
          );
        })}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
      </svg>
      {hover != null && <ChartTooltip x={Math.min(PL + band * hover + band / 2 + 12, W - 200)} y={20}>{tip(months[hover])}</ChartTooltip>}
    </div>
  );
}
