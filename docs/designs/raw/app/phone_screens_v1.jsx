// Phone screens — counter POV, 390x800 canvas
const { VENUES, ZONES, GUIDED_ITEMS, QUICK_TILES, RECOUNT, ACTIVITY } = window.KOUNT_DATA;

const PhoneShell = ({ title, children, tab, onTab, hideNav, hideHeader, sub }) => (
  <div style={{ flex:1, display:'flex', flexDirection:'column', background:'var(--canvas)', position:'relative', paddingTop: 44 }}>
    {/* Top bar (below notch) */}
    {!hideHeader && (
      <div style={{
        padding: '10px 20px 10px', display:'flex', alignItems:'center', justifyContent:'space-between',
        borderBottom: '1px solid var(--border)', background: 'var(--canvas)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{
            width:30, height:30, borderRadius:6, background:'var(--dark-900)',
            display:'grid', placeItems:'center', color:'var(--off-100)',
            fontFamily:'JetBrains Mono, monospace', fontWeight:600, fontSize:13, letterSpacing:'.04em',
          }}>kΩ</div>
          <div>
            <div style={{fontSize:14, fontWeight:600, lineHeight:1.1, color:'var(--fg-primary)'}}>{title}</div>
            {sub && <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:2, letterSpacing:'.03em'}}>{sub}</div>}
          </div>
        </div>
        <button style={{
          width:32, height:32, borderRadius:6, border:'1px solid var(--border)',
          background:'#FFF', color:'var(--fg-secondary)', display:'grid', placeItems:'center', cursor:'pointer',
        }}>{Ic.menu(16)}</button>
      </div>
    )}
    {/* Scrollable content */}
    <div style={{flex:1, overflowY:'auto', padding:'14px 16px 88px', position:'relative'}}>{children}</div>
    {/* Bottom nav */}
    {!hideNav && (
      <div style={{
        position:'absolute', left:0, right:0, bottom:0,
        background:'var(--canvas)', borderTop:'1px solid var(--border)',
        display:'flex', padding:'6px 4px 16px',
      }}>
        {[
          {k:'venues',  label:'Venues',   icon: Ic.home(18)},
          {k:'count',   label:'Count',    icon: Ic.clipboard(18)},
          {k:'variance',label:'Variance', icon: Ic.chart(18)},
          {k:'search',  label:'Search',   icon: Ic.search(18)},
          {k:'summary', label:'Summary',  icon: Ic.list(18)},
        ].map(t => (
          <button key={t.k} onClick={()=>onTab&&onTab(t.k)} style={{
            flex:1, border:'none', background:'transparent',
            display:'flex', flexDirection:'column', alignItems:'center', gap:4,
            color: tab === t.k ? 'var(--dark-900)' : 'var(--fg-muted)',
            fontFamily:'inherit', fontSize:10, fontWeight:600, cursor:'pointer', padding:'6px 0',
            letterSpacing:'.04em',
          }}>
            <span style={{opacity: tab === t.k ? 1 : 0.7}}>{t.icon}</span>
            <span style={{textTransform:'uppercase'}}>{t.label}</span>
          </button>
        ))}
      </div>
    )}
  </div>
);

// ═══════════════════════ LOGIN ═══════════════════════
const PhoneLogin = () => (
  <div style={{flex:1, display:'flex', flexDirection:'column', background:'var(--canvas)', padding:'64px 28px 40px', position:'relative'}}>
    <div style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'center'}}>
      <div style={{marginBottom: 36}}>
        <div style={{
          width:56, height:56, borderRadius:10, background:'var(--dark-900)',
          display:'grid', placeItems:'center', color:'var(--off-100)',
          fontFamily:'JetBrains Mono, monospace', fontWeight:700, fontSize:22, letterSpacing:'.08em',
          marginBottom: 20,
        }}>kΩ</div>
        <div style={{font:'var(--text-headline-md)', color:'var(--fg-primary)', letterSpacing:'-.01em', marginBottom: 8}}>
          Sign in to kΩunt
        </div>
        <div style={{font:'var(--text-body-md)', color:'var(--fg-secondary)', lineHeight:1.5}}>
          Restricted to H.Wood Group staff with venue access.
        </div>
      </div>
      <div style={{marginBottom: 14}}>
        <div style={{fontSize:12, fontWeight:600, color:'var(--fg-secondary)', marginBottom: 6, letterSpacing:'.02em'}}>Email</div>
        <input defaultValue="m.reyes@hwood.com" style={{
          width:'100%', height:44, border:'1px solid var(--border-strong)', borderRadius:6,
          padding:'0 14px', fontFamily:'inherit', fontSize:14, background:'#FFF', color:'var(--fg-primary)', outline:'none',
        }}/>
      </div>
      <div style={{marginBottom: 20}}>
        <div style={{fontSize:12, fontWeight:600, color:'var(--fg-secondary)', marginBottom: 6, letterSpacing:'.02em'}}>Name</div>
        <input defaultValue="Miguel Reyes" style={{
          width:'100%', height:44, border:'1px solid var(--border-strong)', borderRadius:6,
          padding:'0 14px', fontFamily:'inherit', fontSize:14, background:'#FFF', color:'var(--fg-primary)', outline:'none',
        }}/>
      </div>
      <Btn variant="primary" size="lg" fullWidth>Sign in</Btn>
      <div style={{display:'flex', alignItems:'center', gap:8, marginTop: 18, justifyContent:'center'}}>
        <span style={{color:'var(--fg-muted)'}}>{Ic.lock(12)}</span>
        <div style={{fontSize:11, color:'var(--fg-muted)', letterSpacing:'.02em'}}>Access is email-gated · verified at sign-in</div>
      </div>
    </div>
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop: 16, borderTop:'1px solid var(--border)'}}>
      <div style={{fontFamily:'Azeret Mono, JetBrains Mono, monospace', fontSize:10, color:'var(--fg-muted)', letterSpacing:'.08em'}}>© H.WOOD GROUP 2026</div>
      <div style={{fontSize:10, color:'var(--fg-muted)', letterSpacing:'.04em'}}>v2.4.1</div>
    </div>
  </div>
);

// ═══════════════════════ VENUES ═══════════════════════
const PhoneVenues = ({ tab, setTab }) => (
  <PhoneShell title="Select venue" sub="Choose where you're counting today" tab="venues" onTab={setTab}>
    <div style={{marginBottom:12}}>
      <Eyebrow>6 venues · all regions</Eyebrow>
    </div>
    {VENUES.map(v => {
      const statusTone = v.status === 'active' ? 'positive' : v.status === 'overdue' ? 'critical' : v.status === 'scheduled' ? 'inform' : 'ghost';
      const statusLabel = v.status === 'active' ? 'In progress' : v.status === 'overdue' ? 'Overdue' : v.status === 'scheduled' ? 'Scheduled' : 'Idle';
      return (
        <div key={v.id} style={{
          background:'#FFF', border:'1px solid var(--border)', borderRadius:8,
          padding: '14px 16px', marginBottom: 8, display:'flex', alignItems:'center', gap:12,
          boxShadow:'var(--shadow-sm)',
        }}>
          <div style={{
            width:44, height:44, borderRadius:6, background:'var(--off-200)',
            display:'grid', placeItems:'center', color:'var(--dark-700)',
            fontFamily:'Inter', fontWeight:700, fontSize:15, letterSpacing:'.04em',
          }}>{v.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <div style={{font:'var(--text-title-md)', color:'var(--fg-primary)'}}>{v.name}</div>
              <Pill tone={statusTone} size="sm">{statusLabel}</Pill>
            </div>
            <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:2, letterSpacing:'.02em'}}>
              {v.city} · {v.items.toLocaleString()} items · last {v.lastCount}
            </div>
          </div>
          <span style={{color:'var(--fg-muted)'}}>{Ic.chevronRight(18)}</span>
        </div>
      );
    })}
    <div style={{marginTop:20, padding:'14px 16px', background:'var(--off-200)', borderRadius:8, border:'1px solid var(--border)'}}>
      <Eyebrow style={{marginBottom:6}}>This week</Eyebrow>
      <div style={{display:'flex', justifyContent:'space-between'}}>
        <div>
          <div style={{font:'var(--text-title-md)', color:'var(--fg-primary)'}}>1 active · 1 overdue</div>
          <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:2}}>Complete Poppy by Friday</div>
        </div>
        <Btn variant="secondary" size="sm">Schedule</Btn>
      </div>
    </div>
  </PhoneShell>
);

// ═══════════════════════ COUNT — GUIDED ═══════════════════════
const PhoneCountGuided = ({ tab, setTab, density = 'comfy' }) => {
  const activeZone = 'bar-main';
  const done = GUIDED_ITEMS.filter(i => i.counted > 0).length;
  return (
    <PhoneShell title="Delilah LA" sub="Count 1 · Main Bar" tab="count" onTab={setTab}>
      {/* Audit status bar */}
      <div style={{
        display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
        background:'var(--accent-soft)', borderRadius:6, marginBottom: 12,
        border:'1px solid color-mix(in oklab, var(--accent-ink) 20%, transparent)',
      }}>
        <span style={{
          width:8, height:8, borderRadius:'50%', background:'var(--teal-300)',
          animation: 'pulse 1.5s infinite',
        }} />
        <div style={{fontSize:12, color:'var(--dark-800)', fontWeight:600, letterSpacing:'.01em'}}>In progress · 00:42:18</div>
        <div style={{flex:1}}/>
        <button style={{background:'transparent', border:'1px solid var(--raspberry-300)', color:'var(--raspberry-300)', fontSize:10, fontWeight:600, padding:'2px 10px', borderRadius:4, fontFamily:'inherit', cursor:'pointer', letterSpacing:'.04em', textTransform:'uppercase'}}>End</button>
      </div>

      {/* Progress */}
      <div style={{marginBottom: 12}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 6}}>
          <Eyebrow>Main Bar progress</Eyebrow>
          <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:600, color:'var(--fg-primary)'}}>142 / 184</span>
        </div>
        <Progress value={142} total={184} tone="ink" height={4} />
      </div>

      {/* Zone chips */}
      <div style={{display:'flex', gap:6, overflowX:'auto', marginBottom:12, paddingBottom: 2}}>
        {ZONES.map(z => {
          const active = z.id === activeZone;
          const done = z.counted === z.total;
          return (
            <button key={z.id} style={{
              flex:'none', padding:'6px 12px', borderRadius: 9999,
              border: '1px solid ' + (active ? 'var(--dark-900)' : 'var(--border)'),
              background: active ? 'var(--dark-900)' : '#FFF',
              color: active ? 'var(--off-100)' : 'var(--fg-secondary)',
              fontFamily:'inherit', fontSize: 12, fontWeight: 600, cursor:'pointer',
              display:'flex', alignItems:'center', gap: 6, letterSpacing:'.01em',
            }}>
              {done && !active && <span style={{color:'var(--teal-300)'}}>{Ic.checkCircle(12)}</span>}
              {z.name}
              <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:10, opacity: .7}}>
                {z.counted}/{z.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode segment */}
      <div style={{marginBottom: 12}}>
        <Segment options={[
          {value:'guided', label:'Guided'},
          {value:'free',   label:'Free'},
          {value:'quick',  label:'Quick tap'},
        ]} value="guided" />
      </div>

      {/* Next-up card (hero of guided mode) */}
      <div style={{
        background:'#FFF', border:'1px solid var(--border)', borderRadius:8,
        boxShadow:'var(--shadow-sm)', padding:16, marginBottom: 10,
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8}}>
          <Eyebrow>Now counting · 7 of 184</Eyebrow>
          <Pill tone="gold" size="sm">Guided</Pill>
        </div>
        <div style={{fontSize:18, fontWeight:700, color:'var(--fg-primary)', letterSpacing:'-.005em', lineHeight:1.2}}>
          Don Julio 1942 Añejo
        </div>
        <div style={{fontSize:12, color:'var(--fg-muted)', marginTop:4}}>
          Tequila · 750ml · PAR 8 · UPC 811538010121
        </div>
        <div style={{display:'flex', alignItems:'center', gap:10, marginTop:14}}>
          <button style={{
            width:44, height:44, border:'1px solid var(--border-strong)', background:'#FFF',
            borderRadius:6, color:'var(--fg-primary)', display:'grid', placeItems:'center', cursor:'pointer',
          }}>{Ic.minus(18)}</button>
          <div style={{
            flex:1, height:44, background:'var(--off-200)', borderRadius:6,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontWeight:700, fontSize:22, color:'var(--fg-primary)',
          }}>6</div>
          <button style={{
            width:44, height:44, background:'var(--dark-900)', color:'var(--off-100)',
            borderRadius:6, border:'none', display:'grid', placeItems:'center', cursor:'pointer',
          }}>{Ic.plus(18)}</button>
        </div>
        {/* Partial bottle quick-row */}
        <div style={{display:'flex', gap:4, marginTop:10}}>
          {[0.25, 0.5, 0.75, 1].map(p => {
            const active = p === 1;
            return (
              <button key={p} style={{
                flex:1, height:32, borderRadius:4,
                border: '1px solid ' + (active ? 'var(--dark-900)' : 'var(--border)'),
                background: active ? 'var(--dark-900)' : '#FFF',
                color: active ? 'var(--off-100)' : 'var(--fg-secondary)',
                fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:600, cursor:'pointer',
              }}>{p === 1 ? 'Full' : `${Math.round(p*100)}%`}</button>
            );
          })}
        </div>
        <div style={{display:'flex', gap:8, marginTop:12}}>
          <Btn variant="secondary" size="sm" style={{flex:1}} leading={Ic.flag(14)}>Flag</Btn>
          <Btn variant="primary" size="sm" style={{flex:2}} trailing={Ic.arrowRight(14)}>Next item</Btn>
        </div>
      </div>

      {/* Recent counted items (compact) */}
      <Eyebrow style={{marginTop: 18, marginBottom: 8}}>Just counted</Eyebrow>
      {GUIDED_ITEMS.slice(1, 5).map(it => (
        <div key={it.id} style={{
          background:'#FFF', border:'1px solid var(--border)', borderRadius:8,
          padding: density === 'dense' ? '8px 12px' : '12px 14px', marginBottom: 6,
          display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{color:'var(--teal-300)'}}>{Ic.checkCircle(16)}</span>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
            <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:1}}>{it.category} · {it.counted} / {it.par}</div>
          </div>
          <span style={{
            fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:700, color:'var(--fg-primary)',
          }}>{it.counted}</span>
        </div>
      ))}
    </PhoneShell>
  );
};

// ═══════════════════════ COUNT — FREE / SCAN ═══════════════════════
const PhoneCountFree = ({ tab, setTab }) => (
  <PhoneShell title="Delilah LA" sub="Count 1 · Main Bar · Free mode" tab="count" onTab={setTab}>
    {/* Scan action tiles */}
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14}}>
      {[
        { key:'barcode', label:'Barcode', icon:Ic.barcode(22), tone:'accent' },
        { key:'photo',   label:'Photo',   icon:Ic.camera(22),  tone:'ink' },
        { key:'manual',  label:'Manual',  icon:Ic.edit(22),    tone:'ghost' },
      ].map(t => (
        <button key={t.key} style={{
          padding:'14px 8px', border: t.tone==='ghost' ? '1px solid var(--border)' : 'none',
          background: t.tone==='accent' ? 'var(--dark-900)' : t.tone==='ink' ? 'var(--off-200)' : '#FFF',
          color: t.tone==='accent' ? 'var(--off-100)' : t.tone==='ink' ? 'var(--dark-900)' : 'var(--fg-primary)',
          borderRadius:8, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:600,
          display:'flex', flexDirection:'column', alignItems:'center', gap:8,
        }}>
          <span>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>

    {/* Mode segment */}
    <div style={{marginBottom: 12}}>
      <Segment options={[
        {value:'guided', label:'Guided'},
        {value:'free',   label:'Free'},
        {value:'quick',  label:'Quick tap'},
      ]} value="free" />
    </div>

    {/* Search */}
    <div style={{
      position:'relative', marginBottom: 12,
    }}>
      <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--fg-muted)'}}>{Ic.search(16)}</span>
      <input placeholder="Search counted items..." style={{
        width:'100%', height:40, padding:'0 12px 0 36px',
        border:'1px solid var(--border)', borderRadius:6, fontFamily:'inherit', fontSize:13,
        background:'#FFF', color:'var(--fg-primary)', outline:'none',
      }}/>
    </div>

    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 8}}>
      <Eyebrow>Counted · Main Bar</Eyebrow>
      <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'var(--fg-muted)'}}>142 items</span>
    </div>

    {GUIDED_ITEMS.slice(0,6).map((it, idx) => {
      const methods = ['barcode','photo','barcode','manual','photo','barcode'];
      const method = methods[idx];
      const methodTone = { barcode:'gold', photo:'inform', manual:'neutral' }[method];
      return (
        <div key={it.id} style={{
          background:'#FFF', border:'1px solid var(--border)', borderRadius:8,
          padding: '10px 12px', marginBottom: 6,
          display:'flex', alignItems:'center', gap:10,
          borderLeft: '3px solid var(--teal-300)',
        }}>
          <div style={{
            width:40, height:40, borderRadius:6, background:'var(--off-200)',
            display:'grid', placeItems:'center', color:'var(--fg-muted)',
          }}>{Ic.wine(18)}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
            <div style={{display:'flex', alignItems:'center', gap:6, marginTop:2}}>
              <Pill tone={methodTone} size="sm">{method}</Pill>
              <span style={{fontSize:11, color:'var(--fg-muted)'}}>{it.category}</span>
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:6}}>
            <button style={{
              width:28, height:28, border:'1px solid var(--border)', background:'var(--off-200)',
              borderRadius:4, color:'var(--fg-primary)', display:'grid', placeItems:'center', cursor:'pointer',
            }}>{Ic.minus(14)}</button>
            <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:700, minWidth:22, textAlign:'center'}}>{it.counted}</span>
            <button style={{
              width:28, height:28, border:'none', background:'var(--dark-900)',
              borderRadius:4, color:'var(--off-100)', display:'grid', placeItems:'center', cursor:'pointer',
            }}>{Ic.plus(14)}</button>
          </div>
        </div>
      );
    })}
  </PhoneShell>
);

// ═══════════════════════ COUNT — QUICK TAP GRID ═══════════════════════
const PhoneCountQuick = ({ tab, setTab }) => (
  <PhoneShell title="Delilah LA" sub="Count 1 · Main Bar · Quick tap" tab="count" onTab={setTab}>
    <div style={{marginBottom: 12}}>
      <Segment options={[
        {value:'guided', label:'Guided'},
        {value:'free',   label:'Free'},
        {value:'quick',  label:'Quick tap'},
      ]} value="quick" />
    </div>

    <div style={{
      padding:'8px 12px', background:'var(--copper-100)', border:'1px solid color-mix(in oklab, var(--copper-300) 25%, transparent)',
      borderRadius:6, marginBottom:12,
      display:'flex', alignItems:'center', gap:8,
    }}>
      <span style={{color:'var(--copper-300)'}}>{Ic.flash(14)}</span>
      <div style={{fontSize:12, color:'var(--copper-400)', fontWeight:500, lineHeight:1.3}}>
        Tap a tile to +1. Hold to set exact count. Perfect for repeated SKUs.
      </div>
    </div>

    <Eyebrow style={{marginBottom:8}}>Main Bar · top SKUs</Eyebrow>

    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6}}>
      {QUICK_TILES.map((q, i) => {
        const hasCount = q.count > 0;
        return (
          <div key={i} style={{
            background:'#FFF', border:'1px solid ' + (hasCount ? 'color-mix(in oklab, var(--dark-900) 35%, transparent)' : 'var(--border)'),
            borderRadius:8, padding:'10px 8px', textAlign:'center',
            cursor:'pointer', position:'relative',
          }}>
            <div style={{fontSize:11, fontWeight:600, color:'var(--fg-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{q.name}</div>
            <div style={{
              fontFamily:'Inter', fontVariantNumeric:'tabular-nums',
              fontSize:22, fontWeight:700, color: hasCount ? 'var(--dark-900)' : 'var(--fg-muted)',
              marginTop:4, lineHeight:1,
            }}>{q.count}</div>
            <div style={{fontSize:9, color:'var(--fg-muted)', textTransform:'uppercase', letterSpacing:'.08em', marginTop:3}}>{q.cat}</div>
          </div>
        );
      })}
    </div>

    <div style={{marginTop: 16, padding:14, background:'#FFF', border:'1px solid var(--border)', borderRadius:8}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div>
          <Eyebrow>Main Bar</Eyebrow>
          <div style={{fontSize:15, fontWeight:600, color:'var(--fg-primary)', marginTop:2}}>47 tapped · 12 unique SKUs</div>
        </div>
        <Btn variant="primary" size="sm">Done zone</Btn>
      </div>
    </div>
  </PhoneShell>
);

// ═══════════════════════ BARCODE SCANNER (camera overlay) ═══════════════════════
const PhoneBarcodeScanner = () => (
  <div style={{flex:1, display:'flex', flexDirection:'column', background:'#000', position:'relative', paddingTop: 44}}>
    {/* Fake camera feed — warm bokeh */}
    <div style={{
      position:'absolute', inset:0,
      background: 'radial-gradient(120% 80% at 30% 30%, rgba(255,200,140,.28) 0%, rgba(60,40,30,.85) 45%, #0D0A08 85%)',
    }}/>
    {/* Simulated bottle shapes */}
    <div style={{position:'absolute', left:40, top:240, width:70, height:240, background:'rgba(40,30,20,.8)', borderRadius:'36px 36px 10px 10px', opacity:.7}}/>
    <div style={{position:'absolute', left:120, top:220, width:80, height:260, background:'rgba(80,50,30,.7)', borderRadius:'40px 40px 10px 10px', opacity:.8}}/>
    <div style={{position:'absolute', left:216, top:250, width:76, height:220, background:'rgba(30,25,20,.8)', borderRadius:'38px 38px 10px 10px', opacity:.7}}/>

    {/* Top bar */}
    <div style={{
      position:'absolute', top:44, left:0, right:0, padding:'12px 16px',
      display:'flex', alignItems:'center', justifyContent:'space-between',
      background:'rgba(10,8,6,.5)', backdropFilter:'blur(10px)', zIndex:2,
    }}>
      <button style={{
        width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,.16)',
        border:'none', color:'#FFF', display:'grid', placeItems:'center', cursor:'pointer',
      }}>{Ic.close(18)}</button>
      <div style={{color:'#FFF', fontWeight:600, fontSize:14, letterSpacing:'.02em'}}>Scan barcode</div>
      <button style={{
        width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,.16)',
        border:'none', color:'#FFF', display:'grid', placeItems:'center', cursor:'pointer',
      }}>{Ic.flash(16)}</button>
    </div>

    {/* Framed scan area */}
    <div style={{
      position:'absolute', top:'40%', left:'50%', transform:'translate(-50%, -50%)',
      width: 260, height: 160, zIndex: 3,
    }}>
      {/* corner brackets */}
      {[
        {top:0, left:0, borderTop:'3px solid var(--gold-300)', borderLeft:'3px solid var(--gold-300)'},
        {top:0, right:0, borderTop:'3px solid var(--gold-300)', borderRight:'3px solid var(--gold-300)'},
        {bottom:0, left:0, borderBottom:'3px solid var(--gold-300)', borderLeft:'3px solid var(--gold-300)'},
        {bottom:0, right:0, borderBottom:'3px solid var(--gold-300)', borderRight:'3px solid var(--gold-300)'},
      ].map((s, i) => (
        <span key={i} style={{position:'absolute', width:30, height:30, borderTopLeftRadius: s.borderTop&&s.borderLeft?6:0, borderTopRightRadius: s.borderTop&&s.borderRight?6:0, borderBottomLeftRadius: s.borderBottom&&s.borderLeft?6:0, borderBottomRightRadius: s.borderBottom&&s.borderRight?6:0, ...s}}/>
      ))}
      {/* laser line */}
      <div style={{
        position:'absolute', left:'8%', right:'8%', top:'50%',
        height:2, background:'var(--gold-300)', boxShadow:'0 0 14px var(--gold-300)',
      }}/>
    </div>

    {/* Recognition result (just-scanned pill) */}
    <div style={{
      position:'absolute', top:'calc(40% + 105px)', left:'50%', transform:'translateX(-50%)',
      zIndex:3, background:'rgba(255,249,245,.96)', borderRadius:8, padding:'8px 14px',
      boxShadow:'0 8px 24px rgba(0,0,0,.4)', display:'flex', alignItems:'center', gap:10,
      border:'1px solid var(--border)',
    }}>
      <span style={{color:'var(--teal-300)'}}>{Ic.checkCircle(16)}</span>
      <div>
        <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)', lineHeight:1.2}}>Don Julio 1942 Añejo</div>
        <div style={{fontSize:10, color:'var(--fg-muted)', fontFamily:'JetBrains Mono, monospace', marginTop:1}}>811538010121 · +1 counted</div>
      </div>
    </div>

    {/* Bottom panel */}
    <div style={{
      position:'absolute', bottom:0, left:0, right:0,
      padding:'20px 20px calc(30px + env(safe-area-inset-bottom, 0px))',
      background:'linear-gradient(to top, rgba(10,8,6,.92) 40%, transparent)', zIndex:2,
    }}>
      <div style={{textAlign:'center', color:'rgba(255,249,245,.78)', fontSize:12, marginBottom:16, letterSpacing:'.02em'}}>
        Scanning continuously · Point at barcode
      </div>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <button style={{
          color:'var(--off-100)', background:'rgba(255,255,255,.14)',
          border:'none', borderRadius:6, padding:'8px 14px',
          fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer',
          display:'inline-flex', alignItems:'center', gap:6,
        }}>{Ic.edit(14)} Manual</button>
        <div style={{
          width:72, height:72, borderRadius:'50%', background:'rgba(255,249,245,.92)',
          display:'grid', placeItems:'center', position:'relative',
          boxShadow:'0 0 0 4px rgba(255,249,245,.2)',
        }}>
          <div style={{
            width:56, height:56, borderRadius:'50%', background:'var(--gold-300)',
            display:'grid', placeItems:'center', color:'var(--dark-900)',
          }}>{Ic.barcode(22)}</div>
        </div>
        <button style={{
          color:'var(--off-100)', background:'rgba(255,255,255,.14)',
          border:'none', borderRadius:6, padding:'8px 14px',
          fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer',
          display:'inline-flex', alignItems:'center', gap:6,
        }}>{Ic.camera(14)} Photo</button>
      </div>
    </div>
  </div>
);

// ═══════════════════════ RECOUNT (Count 2 focus list) ═══════════════════════
const PhoneRecount = ({ tab, setTab }) => (
  <PhoneShell title="Recount" sub="12 items flagged after Count 1" tab="count" onTab={setTab}>
    <div style={{
      padding:'10px 12px', background:'var(--raspberry-100)',
      border:'1px solid color-mix(in oklab, var(--raspberry-300) 25%, transparent)',
      borderRadius:6, marginBottom:12, display:'flex', gap:10, alignItems:'flex-start',
    }}>
      <span style={{color:'var(--raspberry-300)', marginTop:1}}>{Ic.alert(14)}</span>
      <div style={{fontSize:12, color:'var(--raspberry-400)', fontWeight:500, lineHeight:1.4}}>
        <strong style={{fontWeight:700}}>Count 1 closed at 15:04.</strong> These items had high variance vs. Craftable AVT — count them again carefully.
      </div>
    </div>

    <div style={{marginBottom:12}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 6}}>
        <Eyebrow>Recount progress</Eyebrow>
        <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:600}}>2 / 12</span>
      </div>
      <Progress value={2} total={12} tone="accent" />
    </div>

    <div style={{marginBottom:10}}>
      <Segment options={[
        {value:'all', label:'All · 12'},
        {value:'critical', label:'Critical · 5'},
        {value:'high', label:'High · 4'},
        {value:'pending', label:'Pending'},
      ]} value="all"/>
    </div>

    {RECOUNT.map((r, i) => {
      const isPending = r.status === 'pending';
      const isConfirmed = r.status === 'confirmed';
      const borderTone = r.severity === 'critical' ? 'var(--raspberry-300)' : r.severity === 'high' ? 'var(--copper-300)' : 'var(--amethyst-300)';
      return (
        <div key={i} style={{
          background:'#FFF', border:'1px solid var(--border)', borderRadius:8,
          padding:'12px 14px', marginBottom:6, display:'flex', alignItems:'center', gap:10,
          borderLeft: `3px solid ${isPending ? borderTone : 'var(--teal-300)'}`,
          opacity: r.status === 'resolved' ? 0.55 : 1,
        }}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:4}}>
              <SevChip sev={r.severity}/>
              <span style={{fontSize:11, color:'var(--fg-muted)'}}>{r.zone}</span>
            </div>
            <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)'}}>{r.name}</div>
            <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:2, display:'flex', gap:10}}>
              <span>AVT <strong style={{fontFamily:'JetBrains Mono, monospace', color:'var(--fg-secondary)'}}>{r.theo.toFixed(1)}</strong></span>
              <span>C1 <strong style={{fontFamily:'JetBrains Mono, monospace', color:'var(--raspberry-300)'}}>{r.c1.toFixed(1)}</strong></span>
              {r.c2 !== null && <span>C2 <strong style={{fontFamily:'JetBrains Mono, monospace', color:'var(--teal-300)'}}>{r.c2.toFixed(1)}</strong></span>}
            </div>
          </div>
          {isPending ? (
            <Btn variant="accent" size="sm" leading={Ic.scan(14)}>Count</Btn>
          ) : (
            <span style={{color:'var(--teal-300)'}}>{Ic.checkCircle(20)}</span>
          )}
        </div>
      );
    })}
  </PhoneShell>
);

// ═══════════════════════ SUMMARY (phone condensed) ═══════════════════════
const PhoneSummary = ({ tab, setTab }) => (
  <PhoneShell title="Audit summary" sub="Delilah LA · Count 1" tab="summary" onTab={setTab}>
    <div style={{
      background:'var(--dark-900)', color:'var(--off-100)',
      borderRadius:8, padding:16, marginBottom:10,
    }}>
      <Eyebrow style={{color:'rgba(255,249,245,.55)'}}>Status</Eyebrow>
      <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Count 1 complete</div>
      <div style={{fontSize:12, color:'rgba(255,249,245,.7)', marginTop:4}}>Submitted 15:04 · 01:42 elapsed</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:16}}>
        <div>
          <div style={{fontSize:11, color:'rgba(255,249,245,.55)', letterSpacing:'.08em', textTransform:'uppercase'}}>Items</div>
          <div style={{fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontSize:22, fontWeight:700, marginTop:2}}>506</div>
        </div>
        <div>
          <div style={{fontSize:11, color:'rgba(255,249,245,.55)', letterSpacing:'.08em', textTransform:'uppercase'}}>Flagged</div>
          <div style={{fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontSize:22, fontWeight:700, marginTop:2, color:'var(--raspberry-200)'}}>12</div>
        </div>
      </div>
    </div>

    <div style={{background:'#FFF', border:'1px solid var(--border)', borderRadius:8, padding:16, marginBottom:10}}>
      <Eyebrow style={{marginBottom:10}}>Variance impact</Eyebrow>
      {[
        {label:'Theoretical cost', v:'$184,220.40', tone:''},
        {label:'Actual cost',      v:'$178,540.10', tone:''},
        {label:'Variance',         v:'−$5,680.30',  tone:'critical'},
        {label:'Variance %',       v:'−3.08%',      tone:'critical'},
      ].map((s, i) => (
        <div key={i} style={{
          display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'8px 0', borderTop: i ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{fontSize:13, color:'var(--fg-secondary)'}}>{s.label}</div>
          <div style={{
            fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontWeight:700, fontSize:14,
            color: s.tone === 'critical' ? 'var(--raspberry-300)' : 'var(--fg-primary)',
          }}>{s.v}</div>
        </div>
      ))}
    </div>

    <Eyebrow style={{marginTop:16, marginBottom:8}}>By zone</Eyebrow>
    {ZONES.map(z => {
      const pct = Math.round((z.counted / z.total) * 100);
      return (
        <div key={z.id} style={{background:'#FFF', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:6}}>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom: 6}}>
            <span style={{fontSize:13, fontWeight:600}}>{z.name}</span>
            <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, color:'var(--fg-muted)'}}>{z.counted}/{z.total} · {pct}%</span>
          </div>
          <Progress value={z.counted} total={z.total} tone="ink" height={3}/>
        </div>
      );
    })}

    <Eyebrow style={{marginTop:16, marginBottom:8}}>Activity</Eyebrow>
    {ACTIVITY.slice(0,4).map((a, i) => (
      <div key={i} style={{padding:'8px 0', borderTop: i ? '1px solid var(--border)' : 'none', fontSize:12}}>
        <div style={{display:'flex', gap:8, alignItems:'baseline'}}>
          <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'var(--fg-muted)', minWidth:42}}>{a.t}</span>
          <span style={{fontWeight:600, color:'var(--amethyst-300)'}}>{a.user}</span>
          <span style={{color:'var(--fg-secondary)'}}>{a.text}</span>
        </div>
      </div>
    ))}

    <div style={{display:'flex', gap:8, marginTop:16}}>
      <Btn variant="secondary" size="md" style={{flex:1}} leading={Ic.download(14)}>CSV</Btn>
      <Btn variant="primary" size="md" style={{flex:1}}>Submit</Btn>
    </div>
  </PhoneShell>
);

window.PhoneScreens = {
  PhoneLogin, PhoneVenues, PhoneCountGuided, PhoneCountFree,
  PhoneCountQuick, PhoneBarcodeScanner, PhoneRecount, PhoneSummary,
};
