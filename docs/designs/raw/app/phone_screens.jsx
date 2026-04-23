// Phone screens — counter POV, 390x820 canvas. Cleaner, airier rework.
const { VENUES, ZONES, GUIDED_ITEMS, QUICK_TILES, RECOUNT, ACTIVITY } = window.KOUNT_DATA;

/* ──────────────────────────────────────────────────────────────
   Shared shell
   ────────────────────────────────────────────────────────────── */
const PhoneShell = ({ title, sub, right, children, tab, onTab, hideNav, pad = '16px 18px 96px' }) => (
  <div style={{ flex:1, display:'flex', flexDirection:'column', background:'var(--canvas)', position:'relative', paddingTop: 44 }}>
    {/* Top bar — title only, no logo, no border */}
    <div style={{
      padding: '14px 20px 10px',
      display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap: 12,
    }}>
      <div style={{minWidth:0}}>
        {sub && <div style={{fontSize:10.5, color:'var(--fg-muted)', letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600, marginBottom: 3}}>{sub}</div>}
        <div style={{fontSize:20, fontWeight:700, letterSpacing:'-.015em', color:'var(--fg-primary)', lineHeight:1.1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{title}</div>
      </div>
      <div style={{display:'flex', gap:8, alignItems:'center', flex:'none'}}>
        {right || (
          <button style={{
            width:36, height:36, borderRadius:10, border:'none',
            background:'transparent', color:'var(--fg-secondary)', display:'grid', placeItems:'center', cursor:'pointer',
          }}>{Ic.menu(20)}</button>
        )}
      </div>
    </div>

    {/* Scrollable content */}
    <div style={{flex:1, overflowY:'auto', padding: pad, position:'relative'}}>{children}</div>

    {/* Bottom nav */}
    {!hideNav && <PhoneNav tab={tab} onTab={onTab} />}
  </div>
);

const PhoneNav = ({ tab, onTab }) => {
  const items = [
    { k:'venues',   label:'Venues',   icon: Ic.home },
    { k:'count',    label:'Count',    icon: Ic.clipboard },
    { k:'variance', label:'Variance', icon: Ic.chart },
    { k:'summary',  label:'Summary',  icon: Ic.list },
  ];
  return (
    <div style={{
      position:'absolute', left:0, right:0, bottom:0,
      background:'rgba(255,249,245,.92)', backdropFilter:'blur(14px)',
      borderTop:'1px solid var(--border)',
      display:'flex', padding:'8px 12px 22px',
    }}>
      {items.map(t => {
        const active = tab === t.k;
        return (
          <button key={t.k} onClick={() => onTab && onTab(t.k)} style={{
            flex:1, border:'none', background:'transparent',
            display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            color: active ? 'var(--dark-900)' : 'var(--fg-muted)',
            fontFamily:'inherit', fontSize:10, fontWeight: active ? 700 : 500, cursor:'pointer',
            padding:'4px 0', letterSpacing:'.02em',
          }}>
            <span style={{
              display:'grid', placeItems:'center', width:34, height:24, borderRadius:12,
              background: active ? 'var(--dark-900)' : 'transparent',
              color: active ? 'var(--off-100)' : 'currentColor',
              transition:'background .15s',
            }}>{t.icon(18)}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/* tiny inline status dot */
const StatusDot = ({ color = 'var(--teal-300)', pulse }) => (
  <span style={{
    width:6, height:6, borderRadius:'50%', background: color, display:'inline-block',
    boxShadow: pulse ? `0 0 0 4px color-mix(in oklab, ${color} 25%, transparent)` : 'none',
  }} />
);

/* ═══════════════════════ LOGIN ═══════════════════════ */
const PhoneLogin = () => (
  <div style={{flex:1, display:'flex', flexDirection:'column', background:'var(--canvas)', padding:'72px 30px 36px', position:'relative'}}>
    <div style={{flex:1, display:'flex', flexDirection:'column', justifyContent:'center'}}>
      <div style={{marginBottom: 40}}>
        <div style={{
          width:48, height:48, borderRadius:12, background:'var(--dark-900)',
          display:'grid', placeItems:'center', color:'var(--off-100)',
          fontFamily:'JetBrains Mono, monospace', fontWeight:700, fontSize:18, letterSpacing:'.06em',
          marginBottom: 28,
        }}>kΩ</div>
        <div style={{fontSize:26, fontWeight:700, color:'var(--fg-primary)', letterSpacing:'-.02em', marginBottom: 8, lineHeight:1.15}}>
          Sign in to<br/>kΩunt
        </div>
        <div style={{fontSize:14, color:'var(--fg-secondary)', lineHeight:1.5}}>
          Restricted to H.Wood Group staff with venue access.
        </div>
      </div>

      <div style={{marginBottom: 14}}>
        <div style={{fontSize:11, fontWeight:600, color:'var(--fg-muted)', marginBottom: 6, letterSpacing:'.06em', textTransform:'uppercase'}}>Email</div>
        <input defaultValue="m.reyes@hwood.com" style={{
          width:'100%', height:48, border:'none', borderBottom:'1.5px solid var(--border-strong)', borderRadius:0,
          padding:'0 2px', fontFamily:'inherit', fontSize:15, background:'transparent', color:'var(--fg-primary)', outline:'none',
        }}/>
      </div>
      <div style={{marginBottom: 28}}>
        <div style={{fontSize:11, fontWeight:600, color:'var(--fg-muted)', marginBottom: 6, letterSpacing:'.06em', textTransform:'uppercase'}}>Name</div>
        <input defaultValue="Miguel Reyes" style={{
          width:'100%', height:48, border:'none', borderBottom:'1.5px solid var(--border-strong)', borderRadius:0,
          padding:'0 2px', fontFamily:'inherit', fontSize:15, background:'transparent', color:'var(--fg-primary)', outline:'none',
        }}/>
      </div>
      <Btn variant="primary" size="lg" fullWidth>Continue</Btn>
      <div style={{display:'flex', alignItems:'center', gap:8, marginTop: 20, justifyContent:'center'}}>
        <span style={{color:'var(--fg-muted)'}}>{Ic.lock(12)}</span>
        <div style={{fontSize:11, color:'var(--fg-muted)'}}>Email-gated · verified at sign-in</div>
      </div>
    </div>
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop: 16}}>
      <div style={{fontFamily:'Azeret Mono, JetBrains Mono, monospace', fontSize:10, color:'var(--fg-muted)', letterSpacing:'.1em'}}>© H.WOOD GROUP 2026</div>
      <div style={{fontSize:10, color:'var(--fg-muted)', letterSpacing:'.04em'}}>v2.4.1</div>
    </div>
  </div>
);

/* ═══════════════════════ VENUES ═══════════════════════ */
const PhoneVenues = ({ tab, setTab }) => {
  const statusMap = {
    active:    { tone:'var(--teal-300)',      label:'In progress' },
    overdue:   { tone:'var(--raspberry-300)', label:'Overdue' },
    scheduled: { tone:'var(--amethyst-300)',  label:'Scheduled' },
    idle:      { tone:'var(--fg-muted)',      label:'Idle' },
  };
  return (
    <PhoneShell title="Venues" sub="Wednesday · Apr 22" tab="venues" onTab={setTab}>
      {/* Summary strip */}
      <div style={{
        background:'var(--dark-900)', color:'var(--off-100)', borderRadius:14,
        padding:'16px 18px', marginBottom: 18,
        display:'flex', alignItems:'center', gap:16,
      }}>
        <div style={{flex:1}}>
          <div style={{fontSize:10.5, letterSpacing:'.12em', textTransform:'uppercase', color:'rgba(255,249,245,.55)', fontWeight:600}}>This week</div>
          <div style={{fontSize:16, fontWeight:600, marginTop:4}}>1 active · 1 overdue</div>
          <div style={{fontSize:12, color:'rgba(255,249,245,.6)', marginTop:2}}>Complete Poppy by Friday</div>
        </div>
        <button style={{
          border:'1px solid rgba(255,249,245,.25)', background:'transparent', color:'var(--off-100)',
          borderRadius:8, padding:'8px 12px', fontSize:12, fontWeight:600, fontFamily:'inherit', cursor:'pointer',
        }}>Schedule</button>
      </div>

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10}}>
        <Eyebrow>6 venues · all regions</Eyebrow>
        <span style={{fontSize:11, color:'var(--fg-muted)'}}>Sort: last count</span>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap: 2}}>
        {VENUES.map((v, i) => {
          const s = statusMap[v.status] || statusMap.idle;
          return (
            <div key={v.id} style={{
              background:'transparent',
              padding: '14px 4px', display:'flex', alignItems:'center', gap:14,
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
                  <StatusDot color={s.tone} pulse={v.status === 'active'} />
                  <span style={{fontSize:10.5, letterSpacing:'.1em', textTransform:'uppercase', color: s.tone, fontWeight:700}}>{s.label}</span>
                </div>
                <div style={{fontSize:16, fontWeight:600, color:'var(--fg-primary)', letterSpacing:'-.005em'}}>{v.name}</div>
                <div style={{fontSize:12, color:'var(--fg-muted)', marginTop:2}}>
                  {v.city} · {v.items.toLocaleString()} items · last {v.lastCount}
                </div>
              </div>
              <span style={{color:'var(--fg-muted)'}}>{Ic.chevronRight(18)}</span>
            </div>
          );
        })}
      </div>
    </PhoneShell>
  );
};

/* ═══════════════════════ COUNT · GUIDED ═══════════════════════ */
const PhoneCountGuided = ({ tab, setTab, density = 'comfy' }) => {
  const activeZone = 'bar-main';
  return (
    <PhoneShell
      title="Delilah LA"
      sub="Count 1 · Main Bar"
      tab="count"
      onTab={setTab}
      right={
        <div style={{
          display:'inline-flex', alignItems:'center', gap:6,
          padding:'6px 10px 6px 8px', borderRadius: 999,
          background:'var(--teal-100)', color:'var(--teal-300)',
          fontSize:11, fontWeight:700, letterSpacing:'.02em',
        }}>
          <StatusDot color="var(--teal-300)" pulse/>
          <span style={{fontFamily:'JetBrains Mono, monospace'}}>00:42:18</span>
        </div>
      }
    >
      {/* Progress block */}
      <div style={{marginBottom: 18}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 8}}>
          <span style={{fontSize:13, color:'var(--fg-secondary)', fontWeight:500}}>Main Bar progress</span>
          <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:13, fontWeight:600, color:'var(--fg-primary)'}}>
            142<span style={{color:'var(--fg-muted)'}}> / 184</span>
          </span>
        </div>
        <Progress value={142} total={184} tone="ink" height={3} />
      </div>

      {/* Zone chips */}
      <div style={{display:'flex', gap:6, overflowX:'auto', marginBottom:16, paddingBottom: 2, marginLeft:-2, marginRight:-2, paddingLeft:2, paddingRight:2}}>
        {ZONES.map(z => {
          const active = z.id === activeZone;
          const done = z.counted === z.total;
          return (
            <button key={z.id} style={{
              flex:'none', padding:'7px 14px', borderRadius: 999,
              border: active ? 'none' : '1px solid var(--border)',
              background: active ? 'var(--dark-900)' : '#FFF',
              color: active ? 'var(--off-100)' : 'var(--fg-secondary)',
              fontFamily:'inherit', fontSize: 12.5, fontWeight: 600, cursor:'pointer',
              display:'flex', alignItems:'center', gap: 8, letterSpacing:'.005em',
            }}>
              {done && !active && <span style={{color:'var(--teal-300)', display:'grid', placeItems:'center'}}>{Ic.check(12)}</span>}
              {z.name}
              <span style={{
                fontFamily:'JetBrains Mono, monospace', fontSize:10.5,
                opacity: active ? .7 : .55,
              }}>
                {z.counted}/{z.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode segment */}
      <div style={{marginBottom: 14}}>
        <Segment options={[
          {value:'guided', label:'Guided'},
          {value:'free',   label:'Free'},
          {value:'quick',  label:'Quick tap'},
        ]} value="guided" />
      </div>

      {/* Hero: now counting card */}
      <div style={{
        background:'#FFF', borderRadius:16,
        padding:18, marginBottom: 14,
        boxShadow:'0 1px 0 rgba(0,0,0,.02), 0 12px 28px -16px rgba(35,31,32,.18)',
        border:'1px solid var(--border)',
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10}}>
          <span style={{fontSize:10.5, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--fg-muted)', fontWeight:700}}>Now counting · 7 / 184</span>
        </div>
        <div style={{fontSize:22, fontWeight:700, color:'var(--fg-primary)', letterSpacing:'-.015em', lineHeight:1.15}}>
          Don Julio 1942 Añejo
        </div>
        <div style={{fontSize:12.5, color:'var(--fg-muted)', marginTop:4}}>
          Tequila · 750ml · PAR 8
        </div>

        {/* stepper */}
        <div style={{display:'flex', alignItems:'center', gap:10, marginTop:18}}>
          <button style={{
            width:48, height:48, border:'1px solid var(--border)', background:'#FFF',
            borderRadius:12, color:'var(--fg-primary)', display:'grid', placeItems:'center', cursor:'pointer',
          }}>{Ic.minus(20)}</button>
          <div style={{
            flex:1, height:48, background:'var(--off-200)', borderRadius:12,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontWeight:700, fontSize:26, color:'var(--fg-primary)',
            letterSpacing:'-.01em',
          }}>6</div>
          <button style={{
            width:48, height:48, background:'var(--dark-900)', color:'var(--off-100)',
            borderRadius:12, border:'none', display:'grid', placeItems:'center', cursor:'pointer',
          }}>{Ic.plus(20)}</button>
        </div>

        {/* partials */}
        <div style={{display:'flex', gap:6, marginTop:10}}>
          {[0.25, 0.5, 0.75, 1].map(p => {
            const active = p === 1;
            return (
              <button key={p} style={{
                flex:1, height:34, borderRadius:10,
                border: active ? 'none' : '1px solid var(--border)',
                background: active ? 'var(--dark-900)' : 'transparent',
                color: active ? 'var(--off-100)' : 'var(--fg-secondary)',
                fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer',
                letterSpacing:'.01em',
              }}>{p === 1 ? 'Full' : `${Math.round(p*100)}%`}</button>
            );
          })}
        </div>

        <div style={{display:'flex', gap:8, marginTop:14}}>
          <Btn variant="secondary" size="md" style={{flex:1}} leading={Ic.flag(14)}>Flag</Btn>
          <Btn variant="primary" size="md" style={{flex:2}} trailing={Ic.arrowRight(14)}>Next item</Btn>
        </div>
      </div>

      {/* Recent */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop: 20, marginBottom: 6}}>
        <Eyebrow>Just counted</Eyebrow>
        <span style={{fontSize:11, color:'var(--fg-muted)'}}>View all</span>
      </div>
      <div style={{display:'flex', flexDirection:'column'}}>
        {GUIDED_ITEMS.slice(1, 5).map((it, i) => (
          <div key={it.id} style={{
            padding: density === 'dense' ? '10px 4px' : '13px 4px',
            display:'flex', alignItems:'center', gap:12,
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
          }}>
            <span style={{color:'var(--teal-300)', display:'grid', placeItems:'center'}}>{Ic.checkCircle(16)}</span>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:13.5, fontWeight:600, color:'var(--fg-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
              <div style={{fontSize:11.5, color:'var(--fg-muted)', marginTop:1}}>{it.category}</div>
            </div>
            <span style={{
              fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:600, color:'var(--fg-primary)',
            }}>{it.counted}<span style={{color:'var(--fg-muted)', fontWeight:400}}> / {it.par}</span></span>
          </div>
        ))}
      </div>
    </PhoneShell>
  );
};

/* ═══════════════════════ COUNT · FREE ═══════════════════════ */
const PhoneCountFree = ({ tab, setTab }) => (
  <PhoneShell title="Delilah LA" sub="Main Bar · Free mode" tab="count" onTab={setTab}>
    {/* Primary action tiles */}
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14}}>
      {[
        { key:'barcode', label:'Scan',   icon:Ic.barcode(22), primary:true },
        { key:'photo',   label:'Photo',  icon:Ic.camera(22) },
        { key:'manual',  label:'Manual', icon:Ic.edit(22) },
      ].map(t => (
        <button key={t.key} style={{
          padding:'16px 8px',
          border: t.primary ? 'none' : '1px solid var(--border)',
          background: t.primary ? 'var(--dark-900)' : '#FFF',
          color: t.primary ? 'var(--off-100)' : 'var(--fg-primary)',
          borderRadius:12, cursor:'pointer', fontFamily:'inherit', fontSize:12.5, fontWeight:600,
          display:'flex', flexDirection:'column', alignItems:'center', gap:8, letterSpacing:'.005em',
        }}>
          <span>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>

    {/* Mode segment */}
    <div style={{marginBottom: 14}}>
      <Segment options={[
        {value:'guided', label:'Guided'},
        {value:'free',   label:'Free'},
        {value:'quick',  label:'Quick tap'},
      ]} value="free" />
    </div>

    {/* Search */}
    <div style={{position:'relative', marginBottom: 16}}>
      <span style={{position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--fg-muted)'}}>{Ic.search(16)}</span>
      <input placeholder="Search items or scan UPC…" style={{
        width:'100%', height:44, padding:'0 14px 0 40px',
        border:'1px solid var(--border)', borderRadius:12, fontFamily:'inherit', fontSize:13.5,
        background:'#FFF', color:'var(--fg-primary)', outline:'none',
      }}/>
    </div>

    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 8}}>
      <Eyebrow>Counted items</Eyebrow>
      <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'var(--fg-muted)'}}>142 total</span>
    </div>

    <div style={{display:'flex', flexDirection:'column'}}>
      {GUIDED_ITEMS.slice(0,6).map((it, i) => (
        <div key={it.id} style={{
          padding:'12px 4px',
          display:'flex', alignItems:'center', gap:12,
          borderTop: i === 0 ? 'none' : '1px solid var(--border)',
        }}>
          <div style={{
            width:38, height:38, borderRadius:10, background:'var(--off-200)',
            display:'grid', placeItems:'center', color:'var(--fg-muted)', flex:'none',
          }}>{Ic.wine(18)}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:13.5, fontWeight:600, color:'var(--fg-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
            <div style={{fontSize:11.5, color:'var(--fg-muted)', marginTop:2}}>{it.category}</div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:6}}>
            <button style={{
              width:30, height:30, border:'1px solid var(--border)', background:'#FFF',
              borderRadius:8, color:'var(--fg-primary)', display:'grid', placeItems:'center', cursor:'pointer',
            }}>{Ic.minus(14)}</button>
            <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:700, minWidth:26, textAlign:'center', color:'var(--fg-primary)'}}>{it.counted}</span>
            <button style={{
              width:30, height:30, border:'none', background:'var(--dark-900)',
              borderRadius:8, color:'var(--off-100)', display:'grid', placeItems:'center', cursor:'pointer',
            }}>{Ic.plus(14)}</button>
          </div>
        </div>
      ))}
    </div>
  </PhoneShell>
);

/* ═══════════════════════ COUNT · QUICK TAP ═══════════════════════ */
const PhoneCountQuick = ({ tab, setTab }) => (
  <PhoneShell title="Delilah LA" sub="Main Bar · Quick tap" tab="count" onTab={setTab}>
    <div style={{marginBottom: 14}}>
      <Segment options={[
        {value:'guided', label:'Guided'},
        {value:'free',   label:'Free'},
        {value:'quick',  label:'Quick tap'},
      ]} value="quick" />
    </div>

    <div style={{
      padding:'11px 14px', background:'var(--off-200)', borderRadius:12, marginBottom:14,
      display:'flex', alignItems:'center', gap:10,
    }}>
      <span style={{color:'var(--dark-800)', display:'grid', placeItems:'center'}}>{Ic.flash(14)}</span>
      <div style={{fontSize:12, color:'var(--dark-800)', lineHeight:1.35}}>
        Tap a tile to +1. Long-press to set an exact count.
      </div>
    </div>

    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 8}}>
      <Eyebrow>Top SKUs · Main Bar</Eyebrow>
      <span style={{fontSize:11, color:'var(--fg-muted)'}}>Customize</span>
    </div>

    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8}}>
      {QUICK_TILES.map((q, i) => {
        const hasCount = q.count > 0;
        return (
          <div key={i} style={{
            background: hasCount ? 'var(--dark-900)' : '#FFF',
            color: hasCount ? 'var(--off-100)' : 'var(--fg-primary)',
            border: hasCount ? 'none' : '1px solid var(--border)',
            borderRadius:12, padding:'14px 10px 12px',
            cursor:'pointer', position:'relative', textAlign:'left',
            minHeight: 78,
            display:'flex', flexDirection:'column', justifyContent:'space-between',
          }}>
            <div style={{fontSize:11.5, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', opacity: hasCount ? .85 : 1}}>
              {q.name}
            </div>
            <div style={{display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:4}}>
              <div style={{fontSize:9.5, letterSpacing:'.1em', textTransform:'uppercase', opacity:.5, fontWeight:600}}>{q.cat}</div>
              <div style={{
                fontFamily:'Inter', fontVariantNumeric:'tabular-nums',
                fontSize:22, fontWeight:700, lineHeight:1, letterSpacing:'-.02em',
                color: hasCount ? 'var(--off-100)' : 'var(--fg-muted)',
              }}>{q.count}</div>
            </div>
          </div>
        );
      })}
    </div>

    <div style={{
      marginTop: 18, padding:'14px 16px', background:'#FFF', border:'1px solid var(--border)', borderRadius:12,
      display:'flex', justifyContent:'space-between', alignItems:'center',
    }}>
      <div>
        <Eyebrow>Main Bar</Eyebrow>
        <div style={{fontSize:14, fontWeight:600, color:'var(--fg-primary)', marginTop:3}}>47 tapped · 12 unique</div>
      </div>
      <Btn variant="primary" size="sm">Done zone</Btn>
    </div>
  </PhoneShell>
);

/* ═══════════════════════ BARCODE SCANNER ═══════════════════════ */
const PhoneBarcodeScanner = () => (
  <div style={{flex:1, display:'flex', flexDirection:'column', background:'#000', position:'relative', paddingTop: 44}}>
    {/* camera feed */}
    <div style={{
      position:'absolute', inset:0,
      background: 'radial-gradient(120% 80% at 30% 30%, rgba(255,200,140,.28) 0%, rgba(60,40,30,.85) 45%, #0D0A08 85%)',
    }}/>
    {/* bottles */}
    <div style={{position:'absolute', left:40, top:240, width:70, height:240, background:'rgba(40,30,20,.8)', borderRadius:'36px 36px 10px 10px', opacity:.7}}/>
    <div style={{position:'absolute', left:120, top:220, width:80, height:260, background:'rgba(80,50,30,.7)', borderRadius:'40px 40px 10px 10px', opacity:.8}}/>
    <div style={{position:'absolute', left:216, top:250, width:76, height:220, background:'rgba(30,25,20,.8)', borderRadius:'38px 38px 10px 10px', opacity:.7}}/>

    {/* Top bar */}
    <div style={{
      position:'absolute', top:44, left:0, right:0, padding:'14px 16px',
      display:'flex', alignItems:'center', justifyContent:'space-between', zIndex:2,
    }}>
      <button style={{
        width:40, height:40, borderRadius:'50%', background:'rgba(0,0,0,.42)',
        border:'none', color:'#FFF', display:'grid', placeItems:'center', cursor:'pointer',
        backdropFilter:'blur(10px)',
      }}>{Ic.close(20)}</button>
      <div style={{color:'#FFF', fontWeight:600, fontSize:14, letterSpacing:'.01em'}}>Scan barcode</div>
      <button style={{
        width:40, height:40, borderRadius:'50%', background:'rgba(0,0,0,.42)',
        border:'none', color:'#FFF', display:'grid', placeItems:'center', cursor:'pointer',
        backdropFilter:'blur(10px)',
      }}>{Ic.flash(18)}</button>
    </div>

    {/* Frame */}
    <div style={{
      position:'absolute', top:'40%', left:'50%', transform:'translate(-50%, -50%)',
      width: 270, height: 170, zIndex: 3,
    }}>
      {[
        {top:0, left:0, borderTop:'3px solid var(--gold-300)', borderLeft:'3px solid var(--gold-300)'},
        {top:0, right:0, borderTop:'3px solid var(--gold-300)', borderRight:'3px solid var(--gold-300)'},
        {bottom:0, left:0, borderBottom:'3px solid var(--gold-300)', borderLeft:'3px solid var(--gold-300)'},
        {bottom:0, right:0, borderBottom:'3px solid var(--gold-300)', borderRight:'3px solid var(--gold-300)'},
      ].map((s, i) => (
        <span key={i} style={{position:'absolute', width:34, height:34, ...s}}/>
      ))}
      <div style={{
        position:'absolute', left:'8%', right:'8%', top:'50%',
        height:1.5, background:'var(--gold-300)', boxShadow:'0 0 18px var(--gold-300)',
      }}/>
    </div>

    {/* Recognition chip */}
    <div style={{
      position:'absolute', top:'calc(40% + 115px)', left:'50%', transform:'translateX(-50%)',
      zIndex:3, background:'rgba(255,249,245,.98)', borderRadius:12, padding:'10px 14px',
      boxShadow:'0 12px 28px rgba(0,0,0,.5)', display:'flex', alignItems:'center', gap:12,
    }}>
      <span style={{color:'var(--teal-300)', display:'grid', placeItems:'center'}}>{Ic.checkCircle(18)}</span>
      <div>
        <div style={{fontSize:13.5, fontWeight:600, color:'var(--fg-primary)', lineHeight:1.2}}>Don Julio 1942 Añejo</div>
        <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:2}}>+1 counted · PAR 8</div>
      </div>
    </div>

    {/* Bottom panel */}
    <div style={{
      position:'absolute', bottom:0, left:0, right:0,
      padding:'20px 20px 34px',
      background:'linear-gradient(to top, rgba(10,8,6,.92) 40%, transparent)', zIndex:2,
    }}>
      <div style={{textAlign:'center', color:'rgba(255,249,245,.72)', fontSize:12, marginBottom:18, letterSpacing:'.01em'}}>
        Scanning continuously
      </div>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <button style={{
          color:'var(--off-100)', background:'rgba(255,255,255,.14)',
          border:'none', borderRadius:10, padding:'10px 14px',
          fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer',
          display:'inline-flex', alignItems:'center', gap:6,
        }}>{Ic.edit(14)} Manual</button>
        <div style={{
          width:68, height:68, borderRadius:'50%', background:'var(--gold-300)',
          display:'grid', placeItems:'center', color:'var(--dark-900)',
          boxShadow:'0 0 0 4px rgba(255,249,245,.2)',
        }}>{Ic.barcode(24)}</div>
        <button style={{
          color:'var(--off-100)', background:'rgba(255,255,255,.14)',
          border:'none', borderRadius:10, padding:'10px 14px',
          fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer',
          display:'inline-flex', alignItems:'center', gap:6,
        }}>{Ic.camera(14)} Photo</button>
      </div>
    </div>
  </div>
);

/* ═══════════════════════ RECOUNT ═══════════════════════ */
const PhoneRecount = ({ tab, setTab }) => (
  <PhoneShell title="Recount" sub="Count 2 · 12 items flagged" tab="count" onTab={setTab}>
    <div style={{
      padding:'12px 14px', background:'var(--raspberry-100)',
      borderRadius:12, marginBottom:16, display:'flex', gap:10, alignItems:'flex-start',
    }}>
      <span style={{color:'var(--raspberry-300)', marginTop:1, display:'grid', placeItems:'center'}}>{Ic.alert(16)}</span>
      <div style={{fontSize:12.5, color:'var(--raspberry-400)', lineHeight:1.45}}>
        Count 1 closed at 15:04. High variance vs. AVT — recount carefully.
      </div>
    </div>

    <div style={{marginBottom:16}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 8}}>
        <span style={{fontSize:13, color:'var(--fg-secondary)', fontWeight:500}}>Recount progress</span>
        <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:13, fontWeight:600}}>
          2<span style={{color:'var(--fg-muted)'}}> / 12</span>
        </span>
      </div>
      <Progress value={2} total={12} tone="ink" height={3}/>
    </div>

    <div style={{marginBottom:12}}>
      <Segment options={[
        {value:'all', label:'All · 12'},
        {value:'critical', label:'Critical · 5'},
        {value:'high', label:'High · 4'},
      ]} value="all"/>
    </div>

    <div style={{display:'flex', flexDirection:'column'}}>
      {RECOUNT.map((r, i) => {
        const isPending = r.status === 'pending';
        const sevColor = r.severity === 'critical' ? 'var(--raspberry-300)' : r.severity === 'high' ? 'var(--copper-300)' : 'var(--amethyst-300)';
        return (
          <div key={i} style={{
            padding:'14px 4px', display:'flex', alignItems:'center', gap:12,
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            opacity: r.status === 'resolved' ? 0.5 : 1,
          }}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
                <StatusDot color={isPending ? sevColor : 'var(--teal-300)'} />
                <span style={{fontSize:10, letterSpacing:'.14em', textTransform:'uppercase', color: isPending ? sevColor : 'var(--teal-300)', fontWeight:700}}>
                  {isPending ? r.severity : 'Recounted'}
                </span>
                <span style={{fontSize:11, color:'var(--fg-muted)'}}>· {r.zone}</span>
              </div>
              <div style={{fontSize:13.5, fontWeight:600, color:'var(--fg-primary)'}}>{r.name}</div>
              <div style={{fontSize:11.5, color:'var(--fg-muted)', marginTop:3, display:'flex', gap:12, fontFamily:'JetBrains Mono, monospace'}}>
                <span>AVT <strong style={{color:'var(--fg-secondary)', fontWeight:600}}>{r.theo.toFixed(1)}</strong></span>
                <span>C1 <strong style={{color:'var(--raspberry-300)', fontWeight:600}}>{r.c1.toFixed(1)}</strong></span>
                {r.c2 !== null && <span>C2 <strong style={{color:'var(--teal-300)', fontWeight:600}}>{r.c2.toFixed(1)}</strong></span>}
              </div>
            </div>
            {isPending ? (
              <Btn variant="primary" size="sm" leading={Ic.scan(14)}>Count</Btn>
            ) : (
              <span style={{color:'var(--teal-300)', display:'grid', placeItems:'center'}}>{Ic.checkCircle(22)}</span>
            )}
          </div>
        );
      })}
    </div>
  </PhoneShell>
);

/* ═══════════════════════ SUMMARY ═══════════════════════ */
const PhoneSummary = ({ tab, setTab }) => (
  <PhoneShell title="Audit summary" sub="Delilah LA · Count 1" tab="summary" onTab={setTab}>
    {/* hero stat card */}
    <div style={{
      background:'var(--dark-900)', color:'var(--off-100)',
      borderRadius:16, padding:20, marginBottom:14,
    }}>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <StatusDot color="var(--teal-300)" />
        <span style={{fontSize:10.5, letterSpacing:'.14em', textTransform:'uppercase', color:'rgba(255,249,245,.6)', fontWeight:700}}>Count 1 · Complete</span>
      </div>
      <div style={{fontSize:24, fontWeight:700, marginTop:6, letterSpacing:'-.01em', lineHeight:1.15}}>−$5,680.30</div>
      <div style={{fontSize:12.5, color:'rgba(255,249,245,.65)', marginTop:3}}>−3.08% variance · 01:42 elapsed</div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:18, paddingTop:16, borderTop:'1px solid rgba(255,249,245,.1)'}}>
        <div>
          <div style={{fontSize:10.5, color:'rgba(255,249,245,.5)', letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600}}>Items</div>
          <div style={{fontVariantNumeric:'tabular-nums', fontSize:20, fontWeight:700, marginTop:4, letterSpacing:'-.01em'}}>506</div>
        </div>
        <div>
          <div style={{fontSize:10.5, color:'rgba(255,249,245,.5)', letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600}}>Flagged</div>
          <div style={{fontVariantNumeric:'tabular-nums', fontSize:20, fontWeight:700, marginTop:4, letterSpacing:'-.01em', color:'var(--raspberry-200)'}}>12</div>
        </div>
      </div>
    </div>

    {/* cost breakdown */}
    <div style={{background:'#FFF', border:'1px solid var(--border)', borderRadius:12, padding:'4px 16px', marginBottom:16}}>
      {[
        {label:'Theoretical cost', v:'$184,220.40', tone:''},
        {label:'Actual cost',      v:'$178,540.10', tone:''},
        {label:'Variance',         v:'−$5,680.30',  tone:'critical'},
      ].map((s, i) => (
        <div key={i} style={{
          display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'12px 0', borderTop: i ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{fontSize:13, color:'var(--fg-secondary)'}}>{s.label}</div>
          <div style={{
            fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontWeight:600, fontSize:14,
            color: s.tone === 'critical' ? 'var(--raspberry-300)' : 'var(--fg-primary)',
          }}>{s.v}</div>
        </div>
      ))}
    </div>

    <Eyebrow style={{marginTop:4, marginBottom:10}}>By zone</Eyebrow>
    <div style={{display:'flex', flexDirection:'column'}}>
      {ZONES.map((z, i) => {
        const pct = Math.round((z.counted / z.total) * 100);
        return (
          <div key={z.id} style={{padding:'12px 4px', borderTop: i === 0 ? 'none' : '1px solid var(--border)'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 6}}>
              <span style={{fontSize:13, fontWeight:500, color:'var(--fg-primary)'}}>{z.name}</span>
              <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11.5, color:'var(--fg-muted)'}}>{z.counted}/{z.total} · {pct}%</span>
            </div>
            <Progress value={z.counted} total={z.total} tone="ink" height={2}/>
          </div>
        );
      })}
    </div>

    <Eyebrow style={{marginTop:20, marginBottom:8}}>Activity</Eyebrow>
    <div style={{display:'flex', flexDirection:'column'}}>
      {ACTIVITY.slice(0,4).map((a, i) => (
        <div key={i} style={{padding:'10px 4px', borderTop: i ? '1px solid var(--border)' : 'none', fontSize:12.5}}>
          <div style={{display:'flex', gap:10, alignItems:'baseline'}}>
            <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'var(--fg-muted)', minWidth:42}}>{a.t}</span>
            <div style={{flex:1, minWidth:0}}>
              <span style={{fontWeight:600, color:'var(--fg-primary)'}}>{a.user}</span>
              <span style={{color:'var(--fg-secondary)'}}> {a.text}</span>
            </div>
          </div>
        </div>
      ))}
    </div>

    <div style={{display:'flex', gap:8, marginTop:20}}>
      <Btn variant="secondary" size="md" style={{flex:1}} leading={Ic.download(14)}>Export</Btn>
      <Btn variant="primary" size="md" style={{flex:1}}>Submit</Btn>
    </div>
  </PhoneShell>
);

window.PhoneScreens = {
  PhoneLogin, PhoneVenues, PhoneCountGuided, PhoneCountFree,
  PhoneCountQuick, PhoneBarcodeScanner, PhoneRecount, PhoneSummary,
};
