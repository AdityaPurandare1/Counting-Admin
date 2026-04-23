/* Atoms — ported from docs/designs/raw/app/atoms.jsx with TS types.
   API preserved so later screen ports can be mostly literal. */
import type { CSSProperties, ReactNode } from 'react';

/* ---------------- Pill + SevChip ---------------- */

type PillTone = 'neutral' | 'gold' | 'critical' | 'caution' | 'positive' | 'inform' | 'ink' | 'ghost';

const PILL_TONES: Record<PillTone, { bg: string; fg: string; border?: string }> = {
  neutral:  { bg: '#EDE9E6',                fg: '#4F4B4B' },
  gold:     { bg: 'var(--gold-100)',        fg: 'var(--gold-400)' },
  critical: { bg: 'var(--raspberry-100)',   fg: 'var(--raspberry-300)' },
  caution:  { bg: 'var(--copper-100)',      fg: 'var(--copper-400)' },
  positive: { bg: 'var(--teal-100)',        fg: 'var(--teal-300)' },
  inform:   { bg: 'var(--amethyst-100)',    fg: 'var(--amethyst-300)' },
  ink:      { bg: 'var(--dark-900)',        fg: 'var(--off-100)' },
  ghost:    { bg: 'transparent', fg: 'var(--fg-muted)', border: '1px solid var(--border)' },
};

export function Pill({
  tone = 'neutral', children, size = 'md',
}: { tone?: PillTone; children: ReactNode; size?: 'sm' | 'md' }) {
  const t = PILL_TONES[tone];
  const h = size === 'sm' ? 18 : 22;
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: h, padding: '0 10px', borderRadius: 9999,
      background: t.bg, color: t.fg,
      fontSize: fs, fontWeight: 600, letterSpacing: '.06em',
      textTransform: 'uppercase', whiteSpace: 'nowrap', fontFamily: 'inherit',
      border: t.border || 'none',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
      {children}
    </span>
  );
}

export type Severity = 'critical' | 'high' | 'medium' | 'watch' | 'low';

export function SevChip({ sev }: { sev: Severity }) {
  const map: Record<Severity, { tone: PillTone; label: string }> = {
    critical: { tone: 'critical', label: 'Critical' },
    high:     { tone: 'caution',  label: 'High' },
    medium:   { tone: 'caution',  label: 'Medium' },
    watch:    { tone: 'inform',   label: 'Watch' },
    low:      { tone: 'positive', label: 'Low' },
  };
  const { tone, label } = map[sev] ?? map.low;
  return <Pill tone={tone} size="sm">{label}</Pill>;
}

/* ---------------- Eyebrow (section label) ---------------- */

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '.1em',
      textTransform: 'uppercase', color: 'var(--fg-muted)',
      fontFamily: 'inherit', ...style,
    }}>{children}</div>
  );
}

/* ---------------- Money + Num ---------------- */

export function Money({
  value, showSign = false, size = 14, bold = true,
}: { value: number; showSign?: boolean; size?: number; bold?: boolean }) {
  const neg = value < 0;
  const prefix = neg ? '−$' : (showSign && value > 0 ? '+$' : '$');
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums lining-nums',
      fontWeight: bold ? 700 : 500, fontSize: size,
      color: neg ? 'var(--raspberry-300)' : 'var(--fg-primary)',
      fontFamily: 'inherit',
    }}>{prefix}{abs}</span>
  );
}

export function Num({
  value, signed = false, size = 14, color, bold = true,
}: { value: number; signed?: boolean; size?: number; color?: string; bold?: boolean }) {
  const neg = value < 0;
  const sign = neg ? '−' : (signed && value > 0 ? '+' : '');
  const abs = Math.abs(value);
  const str = Number.isInteger(abs) ? abs.toString() : abs.toFixed(1);
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums lining-nums',
      fontWeight: bold ? 700 : 500, fontSize: size,
      color: color || (neg ? 'var(--raspberry-300)' : 'var(--fg-primary)'),
      fontFamily: 'inherit',
    }}>{sign}{str}</span>
  );
}

/* ---------------- Card ---------------- */

export function Card({
  children, style, padding = 16, flush = false,
}: { children: ReactNode; style?: CSSProperties; padding?: number; flush?: boolean }) {
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: flush ? 'none' : 'var(--shadow-sm)',
      padding, ...style,
    }}>{children}</div>
  );
}

/* ---------------- Btn ---------------- */

type BtnVariant = 'primary' | 'secondary' | 'gold' | 'critical' | 'positive' | 'ghost' | 'accent';

const BTN_VARIANTS: Record<BtnVariant, CSSProperties> = {
  primary:   { background: 'var(--dark-900)',        color: 'var(--off-100)',  border: '1px solid var(--dark-900)' },
  secondary: { background: '#FFF',                   color: 'var(--fg-primary)', border: '1px solid var(--border-strong)' },
  gold:      { background: 'var(--gold-300)',        color: 'var(--dark-900)', border: '1px solid var(--gold-300)' },
  critical:  { background: 'var(--raspberry-300)',   color: '#FFF',            border: '1px solid var(--raspberry-300)' },
  positive:  { background: 'var(--teal-300)',        color: '#FFF',            border: '1px solid var(--teal-300)' },
  ghost:     { background: 'transparent',            color: 'var(--fg-primary)', border: '1px solid transparent' },
  accent:    { background: 'var(--accent-bg)',       color: 'var(--accent-fg)', border: '1px solid var(--accent-bg)' },
};

export function Btn({
  variant = 'primary', size = 'md', children, leading, trailing, fullWidth, onClick, style, disabled, title, type,
}: {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  fullWidth?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
}) {
  const h = size === 'lg' ? 44 : size === 'sm' ? 32 : 40;
  const pad = size === 'lg' ? '0 20px' : size === 'sm' ? '0 12px' : '0 16px';
  const fs = size === 'lg' ? 15 : size === 'sm' ? 13 : 14;
  const v = BTN_VARIANTS[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      type={type ?? 'button'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: h, padding: pad, fontSize: fs, fontWeight: 600,
        fontFamily: 'inherit', letterSpacing: '.005em',
        borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        ...v, ...(style || {}),
      }}>
      {leading}{children}{trailing}
    </button>
  );
}

/* ---------------- Progress ---------------- */

export function Progress({
  value, total, tone = 'ink', height = 4,
}: { value: number; total: number; tone?: 'ink' | 'gold' | 'positive' | 'accent'; height?: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const fill: Record<string, string> = {
    ink:      'var(--dark-900)',
    gold:     'var(--gold-300)',
    positive: 'var(--teal-300)',
    accent:   'var(--accent-bg)',
  };
  return (
    <div style={{ height, width: '100%', background: '#E9E3DF', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: fill[tone] ?? fill.ink, transition: 'width .3s' }} />
    </div>
  );
}

/* ---------------- Segment ---------------- */

export function Segment<T extends string>({
  options, value, onChange,
}: { options: Array<{ value: T; label: string }>; value: T; onChange?: (v: T) => void }) {
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2,
      background: '#FFF', border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button key={opt.value} onClick={() => onChange && onChange(opt.value)} style={{
            flex: 1, padding: '7px 10px', border: 'none',
            background: active ? 'var(--dark-900)' : 'transparent',
            color: active ? 'var(--off-100)' : 'var(--fg-secondary)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            borderRadius: 6, cursor: 'pointer', letterSpacing: '.01em',
          }}>{opt.label}</button>
        );
      })}
    </div>
  );
}

/* ---------------- Avatar ---------------- */

export function Avatar({
  name = '', size = 32, tone = 'var(--gold-300)', ink = 'var(--dark-900)',
}: { name?: string; size?: number; tone?: string; ink?: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: tone, color: ink,
      display: 'inline-grid', placeItems: 'center',
      fontWeight: 700, fontSize: size * 0.38,
      fontFamily: 'inherit', flex: 'none',
    }}>{initials || '·'}</span>
  );
}

/* ---------------- SevDot ---------------- */

const SEV_DOT_COLORS: Record<string, string> = {
  critical: 'var(--raspberry-300)',
  high:     'var(--copper-300)',
  medium:   'var(--copper-300)',
  watch:    'var(--amethyst-300)',
  low:      'var(--teal-300)',
  ok:       'var(--teal-300)',
  pending:  '#BDB8B6',
};

export function SevDot({ sev, size = 8 }: { sev: keyof typeof SEV_DOT_COLORS | string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: SEV_DOT_COLORS[sev] ?? '#BDB8B6',
      display: 'inline-block', flex: 'none',
    }} />
  );
}
