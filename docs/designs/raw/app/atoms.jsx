// Atoms — Woody-grounded shared primitives (Pill, Card, Eyebrow, Money, etc.)
// Use currentColor-based icons; only use CSS variables for palette.

const Pill = ({ tone = 'neutral', children, size = 'md' }) => {
  const tones = {
    neutral:  { bg: '#EDE9E6',           fg: '#4F4B4B' },
    gold:     { bg: 'var(--gold-100)',   fg: 'var(--gold-400)' },
    critical: { bg: 'var(--raspberry-100)', fg: 'var(--raspberry-300)' },
    caution:  { bg: 'var(--copper-100)', fg: 'var(--copper-400)' },
    positive: { bg: 'var(--teal-100)',   fg: 'var(--teal-300)' },
    inform:   { bg: 'var(--amethyst-100)', fg: 'var(--amethyst-300)' },
    ink:      { bg: 'var(--dark-900)',   fg: 'var(--off-100)' },
    ghost:    { bg: 'transparent', fg: 'var(--fg-muted)', border: '1px solid var(--border)' },
  }[tone] || { bg: '#EDE9E6', fg: '#4F4B4B' };
  const h = size === 'sm' ? 18 : 22;
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: h, padding: '0 10px', borderRadius: 9999,
      background: tones.bg, color: tones.fg,
      fontSize: fs, fontWeight: 600, letterSpacing: '.06em',
      textTransform: 'uppercase', whiteSpace: 'nowrap', fontFamily: 'inherit',
      border: tones.border || 'none',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
      {children}
    </span>
  );
};

const SevChip = ({ sev }) => {
  const map = {
    critical: { tone: 'critical', label: 'Critical' },
    high:     { tone: 'caution',  label: 'High' },
    medium:   { tone: 'caution',  label: 'Medium' },
    watch:    { tone: 'inform',   label: 'Watch' },
    low:      { tone: 'positive', label: 'Low' },
  };
  const { tone, label } = map[sev] || map.low;
  return <Pill tone={tone} size="sm">{label}</Pill>;
};

const Eyebrow = ({ children, style }) => (
  <div style={{
    fontSize: 11, fontWeight: 600, letterSpacing: '.1em',
    textTransform: 'uppercase', color: 'var(--fg-muted)',
    fontFamily: 'inherit', ...style,
  }}>{children}</div>
);

const Money = ({ value, showSign = false, size = 14, bold = true }) => {
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
};

const Num = ({ value, signed = false, size = 14, color, bold = true }) => {
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
};

const Card = ({ children, style, padding = 16, flush = false }) => (
  <div style={{
    background: '#FFFFFF', border: '1px solid var(--border)',
    borderRadius: 8, boxShadow: flush ? 'none' : 'var(--shadow-sm)',
    padding, ...style,
  }}>{children}</div>
);

// Ink button — Woody primary
const Btn = ({ variant = 'primary', size = 'md', children, leading, trailing, fullWidth, onClick, style }) => {
  const h = size === 'lg' ? 44 : size === 'sm' ? 32 : 40;
  const pad = size === 'lg' ? '0 20px' : size === 'sm' ? '0 12px' : '0 16px';
  const fs = size === 'lg' ? 15 : size === 'sm' ? 13 : 14;
  const v = {
    primary:   { background: 'var(--dark-900)', color: 'var(--off-100)', border: '1px solid var(--dark-900)' },
    secondary: { background: '#FFF', color: 'var(--fg-primary)', border: '1px solid var(--border-strong)' },
    gold:      { background: 'var(--gold-300)', color: 'var(--dark-900)', border: '1px solid var(--gold-300)' },
    critical:  { background: 'var(--raspberry-300)', color: '#FFF', border: '1px solid var(--raspberry-300)' },
    positive:  { background: 'var(--teal-300)', color: '#FFF', border: '1px solid var(--teal-300)' },
    ghost:     { background: 'transparent', color: 'var(--fg-primary)', border: '1px solid transparent' },
    accent:    { background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: '1px solid var(--accent-bg)' },
  }[variant];
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      height: h, padding: pad, fontSize: fs, fontWeight: 600,
      fontFamily: 'inherit', letterSpacing: '.005em',
      borderRadius: 6, cursor: 'pointer',
      width: fullWidth ? '100%' : undefined,
      ...v, ...(style || {}),
    }}>
      {leading}{children}{trailing}
    </button>
  );
};

// Progress bar (ink-filled, Woody style, no gradients)
const Progress = ({ value, total, tone = 'ink', height = 4 }) => {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const fill = {
    ink:      'var(--dark-900)',
    gold:     'var(--gold-300)',
    positive: 'var(--teal-300)',
    accent:   'var(--accent-bg)',
  }[tone] || 'var(--dark-900)';
  return (
    <div style={{ height, width: '100%', background: '#E9E3DF', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: fill, transition: 'width .3s' }} />
    </div>
  );
};

// Segment control — pill-row
const Segment = ({ options, value, onChange, tone = 'ink' }) => (
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
          borderRadius: 6, cursor: 'pointer',
          letterSpacing: active ? '.01em' : '.01em',
        }}>{opt.label}</button>
      );
    })}
  </div>
);

// Avatar circle w/ initials
const Avatar = ({ name = '', size = 32, tone = 'var(--gold-300)', ink = 'var(--dark-900)' }) => {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: tone, color: ink,
      display: 'inline-grid', placeItems: 'center',
      fontWeight: 700, fontSize: size * 0.38,
      fontFamily: 'Inter, sans-serif', flex: 'none',
    }}>{initials}</span>
  );
};

// Severity dot (tiny color coded dot)
const SevDot = ({ sev, size = 8 }) => {
  const map = {
    critical: 'var(--raspberry-300)',
    high:     'var(--copper-300)',
    medium:   'var(--copper-300)',
    watch:    'var(--amethyst-300)',
    low:      'var(--teal-300)',
    ok:       'var(--teal-300)',
    pending:  '#BDB8B6',
  };
  return <span style={{ width: size, height: size, borderRadius: '50%', background: map[sev] || '#BDB8B6', display: 'inline-block', flex: 'none' }} />;
};

Object.assign(window, { Pill, SevChip, Eyebrow, Money, Num, Card, Btn, Progress, Segment, Avatar, SevDot });
