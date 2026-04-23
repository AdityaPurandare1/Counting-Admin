// Desktop screens — manager POV, roles use 896px column per Woody
const { VENUES: V2, ZONES: Z2, VARIANCE_ROWS, ISSUES, ACTIVITY: ACT2, RECOUNT: RC2 } = window.KOUNT_DATA;

const DesktopShell = ({ children, page, onPage, role = 'Manager', user = 'Alex Chen' }) => (
  <div style={{flex:1, display:'flex', minHeight:820}}>
    {/* Sidebar */}
    <div style={{
      width:220, background:'var(--dark-900)', color:'var(--off-100)',
      display:'flex', flexDirection:'column', padding:'20px 0',
    }}>
      <div style={{padding:'0 20px 20px', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid rgba(255,249,245,.08)'}}>
        <div style={{
          width:30, height:30, borderRadius:6, background:'var(--off-100)',
          display:'grid', placeItems:'center', color:'var(--dark-900)',
          fontFamily:'JetBrains Mono, monospace', fontWeight:700, fontSize:13, letterSpacing:'.04em',
        }}>kΩ</div>
        <div>
          <div style={{fontSize:13, fontWeight:600, letterSpacing:'.04em'}}>kΩunt</div>
          <div style={{fontSize:10, color:'rgba(255,249,245,.55)', letterSpacing:'.1em', textTransform:'uppercase', marginTop:2}}>H.Wood Ops</div>
        </div>
      </div>

      <div style={{padding:'12px 10px', fontSize:10, color:'rgba(255,249,245,.4)', letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600}}>Audit</div>
      {[
        {k:'venues', label:'Venues',     icon: Ic.home(16)},
        {k:'variance', label:'Variance', icon: Ic.chart(16)},
        {k:'recount', label:'Recount',   icon: Ic.flag(16), badge: 12},
        {k:'summary', label:'Summary',   icon: Ic.list(16)},
      ].map(n => {
        const active = page === n.k;
        return (
          <button key={n.k} onClick={()=>onPage&&onPage(n.k)} style={{
            margin:'0 10px 2px', padding:'9px 12px', display:'flex', alignItems:'center', gap:10,
            background: active ? 'rgba(255,249,245,.08)' : 'transparent',
            border:'none', color: active ? 'var(--off-100)' : 'rgba(255,249,245,.65)',
            fontFamily:'inherit', fontSize:13, fontWeight: active ? 600 : 500, cursor:'pointer',
            borderRadius: 12, textAlign:'left', letterSpacing:'.01em',
          }}>
            <span style={{opacity: active ? 1 : .75}}>{n.icon}</span>
            <span style={{flex:1}}>{n.label}</span>
            {n.badge && <span style={{
              fontFamily:'JetBrains Mono, monospace', fontSize:10, fontWeight:700,
              padding:'1px 6px', borderRadius:9999, background:'var(--raspberry-300)', color:'#FFF',
            }}>{n.badge}</span>}
          </button>
        );
      })}

      <div style={{padding:'20px 10px 12px', fontSize:10, color:'rgba(255,249,245,.4)', letterSpacing:'.1em', textTransform:'uppercase', fontWeight:600}}>Team</div>
      {[
        {k:'issues', label:'Issues tracker', icon: Ic.alert(16), badge: 4},
        {k:'ai',    label:'Ask AI',          icon: Ic.sparkle(16)},
      ].map(n => {
        const active = page === n.k;
        return (
          <button key={n.k} onClick={()=>onPage&&onPage(n.k)} style={{
            margin:'0 10px 2px', padding:'9px 12px', display:'flex', alignItems:'center', gap:10,
            background: active ? 'rgba(255,249,245,.08)' : 'transparent',
            border:'none', color: active ? 'var(--off-100)' : 'rgba(255,249,245,.65)',
            fontFamily:'inherit', fontSize:13, fontWeight: active ? 600 : 500, cursor:'pointer',
            borderRadius: 12, textAlign:'left',
          }}>
            <span style={{opacity: .75}}>{n.icon}</span>
            <span style={{flex:1}}>{n.label}</span>
            {n.badge && <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:9999, background:'var(--copper-300)', color:'#FFF'}}>{n.badge}</span>}
          </button>
        );
      })}

      <div style={{flex:1}}/>

      <div style={{padding:'12px 16px', margin:'0 10px', borderRadius:12, background:'rgba(255,249,245,.06)', display:'flex', alignItems:'center', gap:10}}>
        <Avatar name={user} size={32} tone="var(--gold-300)" ink="var(--dark-900)"/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:12, fontWeight:600, color:'var(--off-100)'}}>{user}</div>
          <div style={{fontSize:10, color:'rgba(255,249,245,.55)', letterSpacing:'.06em', textTransform:'uppercase', marginTop:2}}>{role}</div>
        </div>
      </div>
      <div style={{padding:'14px 20px 0', fontFamily:'Azeret Mono, JetBrains Mono, monospace', fontSize:9, letterSpacing:'.14em', color:'rgba(255,249,245,.35)', textTransform:'uppercase'}}>© H.Wood Group 2026</div>
    </div>
    {/* Main panel */}
    <div style={{flex:1, display:'flex', flexDirection:'column', background:'var(--canvas)', overflow:'hidden'}}>
      {children}
    </div>
  </div>
);

// ═══════════════ VARIANCE DASHBOARD ═══════════════
const DesktopVariance = ({ page, setPage }) => {
  const totals = VARIANCE_ROWS.reduce((a, r) => {
    a.theo += r.theo * r.cost;
    a.act += r.act * r.cost;
    a.flagged += r.flagged ? 1 : 0;
    return a;
  }, { theo: 0, act: 0, flagged: 0 });
  const varTotal = totals.act - totals.theo;
  return (
    <DesktopShell page="variance" onPage={setPage}>
      {/* Topbar */}
      <div style={{
        padding:'18px 32px 16px', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', justifyContent:'space-between', background:'#FFF',
      }}>
        <div>
          <Eyebrow>Variance dashboard</Eyebrow>
          <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Delilah LA · Count 1 review</div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <Btn variant="secondary" size="sm" leading={Ic.download(14)}>Export CSV</Btn>
          <Btn variant="primary" size="md">Close Count 1 → Generate recount</Btn>
        </div>
      </div>

      <div style={{padding:'20px 32px', overflowY:'auto'}}>
        {/* Phase indicator */}
        <div style={{display:'flex', gap:8, marginBottom:20}}>
          {[
            {label:'AVT Upload', state:'done'},
            {label:'Count 1',    state:'active'},
            {label:'Review',     state:'next'},
            {label:'Count 2',    state:'next'},
            {label:'Final',      state:'next'},
          ].map((p, i) => (
            <div key={i} style={{
              flex:1, padding:'10px 14px', borderRadius:8, display:'flex', alignItems:'center', gap:8,
              background: p.state === 'active' ? 'var(--dark-900)' : p.state === 'done' ? 'var(--teal-100)' : '#FFF',
              color: p.state === 'active' ? 'var(--off-100)' : p.state === 'done' ? 'var(--teal-300)' : 'var(--fg-muted)',
              border: '1px solid ' + (p.state === 'active' ? 'var(--dark-900)' : p.state === 'done' ? 'color-mix(in oklab, var(--teal-300) 35%, transparent)' : 'var(--border)'),
              fontSize:12, fontWeight:600, letterSpacing:'.02em',
            }}>
              <span style={{
                width:18, height:18, borderRadius:'50%',
                background: p.state === 'active' ? 'var(--off-100)' : p.state === 'done' ? 'var(--teal-300)' : 'var(--border)',
                color: p.state === 'active' ? 'var(--dark-900)' : '#FFF',
                display:'grid', placeItems:'center', fontSize:10, fontWeight:700,
              }}>{p.state === 'done' ? '✓' : i+1}</span>
              {p.label}
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:20}}>
          {[
            {label:'Theoretical', value:`$${totals.theo.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2})}`, sub:'Per Craftable AVT'},
            {label:'Counted', value:`$${totals.act.toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2})}`, sub:'506 items · C1'},
            {label:'Variance', value:`−$${Math.abs(varTotal).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2})}`, sub:`${(varTotal/totals.theo*100).toFixed(2)}%`, tone:'critical'},
            {label:'Flagged items', value:totals.flagged, sub:'Auto-queued for recount', tone:'caution'},
          ].map((s, i) => (
            <Card key={i} padding={18}>
              <Eyebrow>{s.label}</Eyebrow>
              <div style={{
                font:'var(--text-headline-lg)', marginTop:6,
                fontVariantNumeric:'tabular-nums',
                color: s.tone === 'critical' ? 'var(--raspberry-300)' : s.tone === 'caution' ? 'var(--copper-300)' : 'var(--fg-primary)',
                letterSpacing:'-.01em',
              }}>{s.value}</div>
              <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:4}}>{s.sub}</div>
            </Card>
          ))}
        </div>

        {/* AVT upload row + filter */}
        <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, marginBottom:20}}>
          <Card padding={18} style={{display:'flex', alignItems:'center', gap:16}}>
            <div style={{
              width:52, height:52, borderRadius:8, background:'var(--teal-100)',
              display:'grid', placeItems:'center', color:'var(--teal-300)', flex:'none',
            }}>{Ic.file(24)}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)'}}>Craftable AVT · Week 16 · Uploaded Mon 14:22</div>
              <div style={{fontSize:12, color:'var(--fg-muted)', marginTop:2}}>delilah-la-avt-wk16.xlsx · 4,592 line items · by A. Chen</div>
            </div>
            <Btn variant="secondary" size="sm" leading={Ic.upload(14)}>Replace</Btn>
          </Card>
          <Card padding={18} style={{display:'flex', alignItems:'center', gap:12}}>
            <Eyebrow>Filter store</Eyebrow>
            <div style={{flex:1}}/>
            <select defaultValue="v1" style={{
              padding:'7px 10px', border:'1px solid var(--border-strong)', borderRadius:6,
              fontFamily:'inherit', fontSize:13, background:'#FFF', color:'var(--fg-primary)',
            }}>
              {V2.map(v => <option key={v.id} value={v.id}>{v.name} · {v.city}</option>)}
            </select>
          </Card>
        </div>

        {/* Filter tabs */}
        <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:12}}>
          <div style={{display:'flex', gap:4, background:'#FFF', border:'1px solid var(--border)', borderRadius:8, padding:4}}>
            {[
              {k:'all', label:'All · 10'},
              {k:'flagged', label:'Flagged · 6', active:true},
              {k:'missing', label:'Missing · 0'},
              {k:'critical', label:'Critical · 2'},
            ].map(t => (
              <button key={t.k} style={{
                padding:'6px 12px', border:'none',
                background: t.active ? 'var(--dark-900)' : 'transparent',
                color: t.active ? 'var(--off-100)' : 'var(--fg-secondary)',
                fontFamily:'inherit', fontSize:12, fontWeight:600,
                borderRadius:6, cursor:'pointer',
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{flex:1}}/>
          <div style={{
            position:'relative', width:260,
          }}>
            <span style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--fg-muted)'}}>{Ic.search(14)}</span>
            <input placeholder="Search items..." style={{
              width:'100%', height:32, padding:'0 10px 0 32px',
              border:'1px solid var(--border)', borderRadius:6, fontFamily:'inherit', fontSize:12, background:'#FFF', outline:'none',
            }}/>
          </div>
        </div>

        {/* Variance table */}
        <Card padding={0}>
          <div style={{
            display:'grid', gridTemplateColumns:'1.6fr .7fr .7fr .7fr .9fr .7fr', gap:14,
            padding:'12px 18px', borderBottom:'1px solid var(--border)', background:'var(--off-200)',
          }}>
            {['Item','Theoretical','Counted','Variance','Cost impact','Severity'].map((h,i) => (
              <div key={i} style={{
                font:'var(--text-label)', letterSpacing:'.1em', textTransform:'uppercase', color:'var(--fg-muted)',
                textAlign: i>0 && i<5 ? 'right' : 'left',
              }}>{h}</div>
            ))}
          </div>
          {VARIANCE_ROWS.map((r, i) => (
            <div key={i} style={{
              display:'grid', gridTemplateColumns:'1.6fr .7fr .7fr .7fr .9fr .7fr', gap:14,
              padding:'14px 18px', borderBottom: i < VARIANCE_ROWS.length-1 ? '1px solid var(--border)' : 'none',
              alignItems:'center',
            }}>
              <div>
                <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)'}}>{r.name}</div>
                <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:1}}>{r.flagged ? 'Flagged · ' : ''}Main Bar · 750ml</div>
              </div>
              <Num value={r.theo} size={13} bold={false} color="var(--fg-secondary)" />
              <Num value={r.act} size={13} bold={false} color="var(--fg-primary)" />
              <div style={{textAlign:'right'}}><Num value={r.diff} signed size={13} /></div>
              <div style={{textAlign:'right'}}><Money value={r.diff * r.cost} size={13} /></div>
              <SevChip sev={r.severity} />
            </div>
          ))}
        </Card>
      </div>
    </DesktopShell>
  );
};

// ═══════════════ VENUES DESKTOP ═══════════════
const DesktopVenues = ({ page, setPage }) => (
  <DesktopShell page="venues" onPage={setPage}>
    <div style={{padding:'18px 32px 16px', borderBottom:'1px solid var(--border)', background:'#FFF'}}>
      <Eyebrow>Manager console</Eyebrow>
      <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Venues · 6 active locations</div>
    </div>
    <div style={{padding:'24px 32px', overflowY:'auto'}}>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:20}}>
        {[
          {label:'This week', value:'3 audits', sub:'2 complete · 1 active'},
          {label:'Flagged items', value:'12', sub:'across 2 venues', tone:'critical'},
          {label:'Avg variance', value:'−2.4%', sub:'trending better vs last wk', tone:'positive'},
        ].map((s,i) => (
          <Card key={i} padding={18}>
            <Eyebrow>{s.label}</Eyebrow>
            <div style={{font:'var(--text-headline-lg)', marginTop:6, letterSpacing:'-.01em',
              color: s.tone === 'critical' ? 'var(--raspberry-300)' : s.tone === 'positive' ? 'var(--teal-300)' : 'var(--fg-primary)'
            }}>{s.value}</div>
            <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:4}}>{s.sub}</div>
          </Card>
        ))}
      </div>
      <Eyebrow style={{marginBottom:10}}>All venues</Eyebrow>
      <Card padding={0}>
        {V2.map((v, i) => (
          <div key={v.id} style={{
            display:'grid', gridTemplateColumns:'50px 2fr 1fr 1fr 1fr 120px',
            gap:16, padding:'14px 18px', alignItems:'center',
            borderBottom: i < V2.length-1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{width:40, height:40, borderRadius:6, background:'var(--off-200)', display:'grid', placeItems:'center', fontFamily:'Inter', fontWeight:700, fontSize:14, color:'var(--dark-700)'}}>
              {v.name.split(' ').map(w=>w[0]).slice(0,2).join('')}
            </div>
            <div>
              <div style={{fontSize:14, fontWeight:600, color:'var(--fg-primary)'}}>{v.name}</div>
              <div style={{fontSize:12, color:'var(--fg-muted)', marginTop:1}}>{v.addr} · {v.city}</div>
            </div>
            <div>
              <div style={{fontSize:11, color:'var(--fg-muted)', textTransform:'uppercase', letterSpacing:'.08em'}}>Items</div>
              <div style={{fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:600, marginTop:2}}>{v.items.toLocaleString()}</div>
            </div>
            <div>
              <div style={{fontSize:11, color:'var(--fg-muted)', textTransform:'uppercase', letterSpacing:'.08em'}}>Zones</div>
              <div style={{fontFamily:'JetBrains Mono, monospace', fontSize:14, fontWeight:600, marginTop:2}}>{v.zones}</div>
            </div>
            <div>
              <div style={{fontSize:11, color:'var(--fg-muted)', textTransform:'uppercase', letterSpacing:'.08em'}}>Last count</div>
              <div style={{fontSize:13, marginTop:2}}>{v.lastCount}</div>
            </div>
            <div style={{textAlign:'right'}}>
              {(() => {
                const t = v.status === 'active' ? 'positive' : v.status === 'overdue' ? 'critical' : v.status === 'scheduled' ? 'inform' : 'ghost';
                const l = v.status === 'active' ? 'In progress' : v.status === 'overdue' ? 'Overdue' : v.status === 'scheduled' ? 'Scheduled' : 'Idle';
                return <Pill tone={t} size="sm">{l}</Pill>;
              })()}
            </div>
          </div>
        ))}
      </Card>
    </div>
  </DesktopShell>
);

// ═══════════════ RECOUNT TRANSITION (Count 1 close modal) ═══════════════
const DesktopRecount = ({ page, setPage }) => (
  <DesktopShell page="recount" onPage={setPage}>
    <div style={{padding:'18px 32px 16px', borderBottom:'1px solid var(--border)', background:'#FFF', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <div>
        <Eyebrow>Count 1 → Count 2 handoff</Eyebrow>
        <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Recount focus list · Delilah LA</div>
      </div>
      <div style={{display:'flex', gap:8}}>
        <Btn variant="secondary" size="sm">View Count 1 report</Btn>
        <Btn variant="primary" size="md">Start Count 2</Btn>
      </div>
    </div>
    <div style={{padding:'24px 32px', overflowY:'auto'}}>
      <div style={{
        padding:16, background:'var(--dark-900)', color:'var(--off-100)', borderRadius:8, marginBottom:20,
        display:'flex', alignItems:'center', gap:18,
      }}>
        <div style={{
          width:52, height:52, borderRadius:8, background:'rgba(255,249,245,.08)',
          display:'grid', placeItems:'center', color:'var(--gold-300)',
        }}>{Ic.flag(22)}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:15, fontWeight:600}}>Count 1 closed at 15:04 · 12 items above severity threshold</div>
          <div style={{fontSize:12, color:'rgba(255,249,245,.65)', marginTop:3}}>
            Craftable AVT variance exceeds 10% on 5 critical items. Recount list is locked to these SKUs for Count 2. Estimated recount time: 18 min.
          </div>
        </div>
        <div style={{display:'flex', gap:14}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:10, color:'rgba(255,249,245,.55)', letterSpacing:'.08em', textTransform:'uppercase'}}>Cost at risk</div>
            <div style={{fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontSize:20, fontWeight:700, marginTop:3, color:'var(--raspberry-200)'}}>−$5,680</div>
          </div>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:10, marginBottom:20}}>
        {[
          {label:'Critical', value:5, tone:'critical'},
          {label:'High',     value:4, tone:'caution'},
          {label:'Medium',   value:3, tone:'caution'},
          {label:'Watch',    value:0, tone:'inform'},
          {label:'Resolved', value:2, tone:'positive'},
        ].map((s, i) => (
          <Card key={i} padding={14}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <SevDot sev={s.tone === 'caution' ? 'high' : s.tone === 'inform' ? 'watch' : s.tone === 'positive' ? 'low' : 'critical'} size={10}/>
              <Eyebrow>{s.label}</Eyebrow>
            </div>
            <div style={{fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontSize:26, fontWeight:700, marginTop:6, letterSpacing:'-.01em'}}>{s.value}</div>
          </Card>
        ))}
      </div>

      <Eyebrow style={{marginBottom:10}}>Focus list · sorted by severity</Eyebrow>
      <Card padding={0}>
        <div style={{display:'grid', gridTemplateColumns:'1.8fr .8fr .7fr .7fr .7fr .9fr .8fr', gap:14, padding:'12px 18px', borderBottom:'1px solid var(--border)', background:'var(--off-200)'}}>
          {['Item','Zone','AVT','Count 1','Count 2','Δ','Status'].map((h,i) => (
            <div key={i} style={{font:'var(--text-label)', letterSpacing:'.1em', textTransform:'uppercase', color:'var(--fg-muted)', textAlign: i>=2 && i<=5 ? 'right' : 'left'}}>{h}</div>
          ))}
        </div>
        {RC2.map((r, i) => (
          <div key={i} style={{
            display:'grid', gridTemplateColumns:'1.8fr .8fr .7fr .7fr .7fr .9fr .8fr', gap:14,
            padding:'14px 18px', alignItems:'center',
            borderBottom: i < RC2.length-1 ? '1px solid var(--border)' : 'none',
            opacity: r.status === 'resolved' ? 0.55 : 1,
          }}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <SevChip sev={r.severity}/>
              <div style={{fontSize:13, fontWeight:600, color:'var(--fg-primary)'}}>{r.name}</div>
            </div>
            <div style={{fontSize:12, color:'var(--fg-secondary)'}}>{r.zone}</div>
            <Num value={r.theo} size={13} bold={false} color="var(--fg-secondary)"/>
            <Num value={r.c1} size={13} color="var(--raspberry-300)" />
            <div style={{textAlign:'right'}}>{r.c2 !== null ? <Num value={r.c2} size={13} color="var(--teal-300)"/> : <span style={{color:'var(--fg-muted)', fontSize:12}}>—</span>}</div>
            <div style={{textAlign:'right'}}>{r.c2 !== null ? <Num value={r.c2 - r.theo} signed size={13}/> : <span style={{color:'var(--fg-muted)'}}>Pending</span>}</div>
            <div style={{textAlign:'right'}}>
              {r.status === 'resolved' && <Pill tone="positive" size="sm">Resolved</Pill>}
              {r.status === 'confirmed' && <Pill tone="critical" size="sm">Confirmed loss</Pill>}
              {r.status === 'pending' && <Pill tone="caution" size="sm">Pending</Pill>}
            </div>
          </div>
        ))}
      </Card>
    </div>
  </DesktopShell>
);

// ═══════════════ ISSUES TRACKER ═══════════════
const DesktopIssues = ({ page, setPage }) => (
  <DesktopShell page="issues" onPage={setPage}>
    <div style={{padding:'18px 32px 16px', borderBottom:'1px solid var(--border)', background:'#FFF', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <div>
        <Eyebrow>Issues tracker</Eyebrow>
        <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Flagged items across all venues</div>
      </div>
      <Btn variant="secondary" size="sm" leading={Ic.download(14)}>Export CSV</Btn>
    </div>
    <div style={{padding:'24px 32px', overflowY:'auto'}}>
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:20}}>
        {[
          {label:'Open', value:4, tone:'critical'},
          {label:'In review', value:1, tone:'caution'},
          {label:'Resolved (30d)', value:2, tone:'positive'},
          {label:'Cost recovered', value:'$8,420', tone:''},
        ].map((s, i) => (
          <Card key={i} padding={18}>
            <Eyebrow>{s.label}</Eyebrow>
            <div style={{font:'var(--text-headline-lg)', marginTop:6, letterSpacing:'-.01em',
              color: s.tone === 'critical' ? 'var(--raspberry-300)' : s.tone === 'caution' ? 'var(--copper-300)' : s.tone === 'positive' ? 'var(--teal-300)' : 'var(--fg-primary)',
              fontVariantNumeric:'tabular-nums'}}>{s.value}</div>
            <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:4}}>vs last week</div>
          </Card>
        ))}
      </div>

      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:12}}>
        <div style={{display:'flex', gap:4, background:'#FFF', border:'1px solid var(--border)', borderRadius:8, padding:4}}>
          {['All · 7', 'Open · 4', 'In review · 1', 'Resolved · 2'].map((l, i) => (
            <button key={i} style={{
              padding:'6px 12px', border:'none',
              background: i === 0 ? 'var(--dark-900)' : 'transparent',
              color: i === 0 ? 'var(--off-100)' : 'var(--fg-secondary)',
              fontFamily:'inherit', fontSize:12, fontWeight:600, borderRadius:6, cursor:'pointer',
            }}>{l}</button>
          ))}
        </div>
        <select defaultValue="all" style={{padding:'7px 10px', border:'1px solid var(--border-strong)', borderRadius:6, fontFamily:'inherit', fontSize:12, background:'#FFF'}}>
          <option value="all">All venues</option>
          {V2.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      <Card padding={0}>
        <div style={{display:'grid', gridTemplateColumns:'1.5fr 1fr .8fr .8fr .8fr 1fr', gap:14, padding:'12px 18px', borderBottom:'1px solid var(--border)', background:'var(--off-200)'}}>
          {['Item','Venue','Zone','Flagged','Severity','Status'].map((h,i) => (
            <div key={i} style={{font:'var(--text-label)', letterSpacing:'.1em', textTransform:'uppercase', color:'var(--fg-muted)'}}>{h}</div>
          ))}
        </div>
        {ISSUES.map((iss, i) => {
          const statusMap = {open: {tone:'critical', label:'Open'}, review:{tone:'caution', label:'In review'}, resolved:{tone:'positive', label:'Resolved'}};
          const st = statusMap[iss.status];
          return (
            <div key={i} style={{
              display:'grid', gridTemplateColumns:'1.5fr 1fr .8fr .8fr .8fr 1fr', gap:14,
              padding:'14px 18px', alignItems:'center',
              borderBottom: i < ISSUES.length-1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <Avatar name={iss.user} size={28} tone="var(--amethyst-200)" ink="var(--amethyst-400)"/>
                <div>
                  <div style={{fontSize:13, fontWeight:600}}>{iss.item}</div>
                  <div style={{fontSize:11, color:'var(--fg-muted)'}}>{iss.user}</div>
                </div>
              </div>
              <div style={{fontSize:13}}>{iss.venue}</div>
              <div style={{fontSize:13, color:'var(--fg-secondary)'}}>{iss.zone}</div>
              <div style={{fontSize:13, color:'var(--fg-muted)'}}>{iss.flagged}</div>
              <SevChip sev={iss.severity}/>
              <Pill tone={st.tone} size="sm">{st.label}</Pill>
            </div>
          );
        })}
      </Card>
    </div>
  </DesktopShell>
);

// ═══════════════ SUMMARY DESKTOP ═══════════════
const DesktopSummary = ({ page, setPage }) => (
  <DesktopShell page="summary" onPage={setPage}>
    <div style={{padding:'18px 32px 16px', borderBottom:'1px solid var(--border)', background:'#FFF', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <div>
        <Eyebrow>Audit summary</Eyebrow>
        <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Delilah LA · Count 1</div>
      </div>
      <div style={{display:'flex', gap:8}}>
        <Btn variant="secondary" size="sm" leading={Ic.download(14)}>Export CSV</Btn>
        <Btn variant="gold" size="md">Submit audit</Btn>
      </div>
    </div>
    <div style={{padding:'24px 32px', overflowY:'auto'}}>
      <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:16}}>
        <div>
          <Card padding={20} style={{marginBottom:16}}>
            <Eyebrow>Variance impact</Eyebrow>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:16, marginTop:14}}>
              {[
                {l:'Theoretical', v:'$184,220.40'},
                {l:'Counted',     v:'$178,540.10'},
                {l:'Variance',    v:'−$5,680.30', tone:'critical'},
                {l:'%',           v:'−3.08%', tone:'critical'},
              ].map((s, i) => (
                <div key={i}>
                  <div style={{fontSize:11, color:'var(--fg-muted)', letterSpacing:'.08em', textTransform:'uppercase', fontWeight:600}}>{s.l}</div>
                  <div style={{fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontSize:20, fontWeight:700, marginTop:4,
                    color: s.tone === 'critical' ? 'var(--raspberry-300)' : 'var(--fg-primary)', letterSpacing:'-.01em'}}>{s.v}</div>
                </div>
              ))}
            </div>
          </Card>

          <Eyebrow style={{marginBottom:8}}>By zone</Eyebrow>
          <Card padding={0} style={{marginBottom:16}}>
            {Z2.map((z, i) => {
              const pct = Math.round((z.counted / z.total) * 100);
              return (
                <div key={z.id} style={{padding:'14px 18px', borderBottom: i < Z2.length-1 ? '1px solid var(--border)' : 'none', display:'grid', gridTemplateColumns:'1fr 100px 1fr 60px', gap:14, alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:13, fontWeight:600}}>{z.name}</div>
                    <div style={{fontSize:11, color:'var(--fg-muted)', marginTop:1}}>{z.counted} of {z.total}</div>
                  </div>
                  <div><Num value={pct} size={14} color="var(--fg-primary)"/><span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, color:'var(--fg-muted)'}}>%</span></div>
                  <Progress value={z.counted} total={z.total} tone="ink" height={6}/>
                  <div style={{textAlign:'right'}}>
                    {pct === 100 ? <Pill tone="positive" size="sm">Done</Pill> : pct === 0 ? <Pill tone="ghost" size="sm">—</Pill> : <Pill tone="caution" size="sm">Open</Pill>}
                  </div>
                </div>
              );
            })}
          </Card>

          <Eyebrow style={{marginBottom:8}}>Item location lookup</Eyebrow>
          <Card padding={16}>
            <div style={{position:'relative', marginBottom:12}}>
              <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--fg-muted)'}}>{Ic.search(16)}</span>
              <input defaultValue="Don Julio" style={{width:'100%', height:38, padding:'0 12px 0 36px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, fontFamily:'inherit', outline:'none'}}/>
            </div>
            <div style={{padding:'10px 12px', background:'var(--off-200)', borderRadius:6, marginBottom:6}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div style={{fontSize:13, fontWeight:600}}>Don Julio 1942 Añejo</div>
                <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:12, color:'var(--fg-muted)'}}>UPC 811538010121</span>
              </div>
              <div style={{display:'flex', gap:18, marginTop:8, fontSize:12}}>
                <span><span style={{color:'var(--fg-muted)'}}>Main Bar · </span><strong style={{fontFamily:'JetBrains Mono, monospace', color:'var(--fg-primary)'}}>5</strong></span>
                <span><span style={{color:'var(--fg-muted)'}}>Back Bar · </span><strong style={{fontFamily:'JetBrains Mono, monospace', color:'var(--fg-primary)'}}>0</strong></span>
                <span><span style={{color:'var(--fg-muted)'}}>VIP · </span><strong style={{fontFamily:'JetBrains Mono, monospace', color:'var(--fg-primary)'}}>0</strong></span>
                <span style={{marginLeft:'auto', color:'var(--raspberry-300)'}}><strong style={{fontFamily:'JetBrains Mono, monospace'}}>AVT 8.0</strong> · Δ −3.0</span>
              </div>
            </div>
          </Card>
        </div>

        <div>
          <Eyebrow style={{marginBottom:8}}>Activity log</Eyebrow>
          <Card padding={14} style={{marginBottom:16}}>
            {ACT2.map((a, i) => (
              <div key={i} style={{padding:'10px 0', borderTop: i ? '1px solid var(--border)' : 'none', fontSize:12, display:'flex', gap:8}}>
                <span style={{fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'var(--fg-muted)', minWidth:42}}>{a.t}</span>
                <div style={{flex:1}}>
                  <div><span style={{fontWeight:600, color:'var(--amethyst-300)'}}>{a.user}</span> <span style={{color:'var(--fg-secondary)'}}>{a.text}</span></div>
                </div>
              </div>
            ))}
          </Card>

          <Eyebrow style={{marginBottom:8}}>Past audits</Eyebrow>
          <Card padding={14}>
            {[
              {when:'Apr 14', desc:'Delilah LA · Count 2 final', var: '−$1,240', tone:'critical'},
              {when:'Apr 10', desc:'Delilah Miami · Count 1',     var: '−$2,810', tone:'critical'},
              {when:'Apr 07', desc:'The Nice Guy · Count 2 final',var: '+$340',   tone:'positive'},
              {when:'Apr 03', desc:'Bird Streets · Count 1',      var: '−$560',   tone:'caution'},
            ].map((h, i) => (
              <div key={i} style={{padding:'10px 0', borderTop: i ? '1px solid var(--border)' : 'none', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div>
                  <div style={{fontSize:12, color:'var(--fg-muted)', fontFamily:'JetBrains Mono, monospace'}}>{h.when}</div>
                  <div style={{fontSize:13, marginTop:2}}>{h.desc}</div>
                </div>
                <span style={{fontFamily:'Inter', fontVariantNumeric:'tabular-nums', fontWeight:700, fontSize:13,
                  color: h.tone === 'critical' ? 'var(--raspberry-300)' : h.tone === 'positive' ? 'var(--teal-300)' : 'var(--copper-300)'}}>{h.var}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  </DesktopShell>
);

// ═══════════════ AI CHAT ═══════════════
const DesktopAI = ({ page, setPage }) => (
  <DesktopShell page="ai" onPage={setPage}>
    <div style={{padding:'18px 32px 16px', borderBottom:'1px solid var(--border)', background:'#FFF', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
      <div>
        <Eyebrow>Ask kΩunt</Eyebrow>
        <div style={{font:'var(--text-headline-md)', marginTop:4, letterSpacing:'-.005em'}}>Ops copilot · grounded in your audits</div>
      </div>
      <Pill tone="gold" size="sm">Claude Haiku</Pill>
    </div>
    <div style={{flex:1, display:'flex', flexDirection:'column', padding:'24px 32px', overflowY:'auto'}}>
      <div style={{flex:1, display:'flex', flexDirection:'column', gap:16, maxWidth: 760}}>
        {/* AI greeting */}
        <div style={{display:'flex', gap:12, alignItems:'flex-start'}}>
          <div style={{width:32, height:32, borderRadius:8, background:'var(--dark-900)', display:'grid', placeItems:'center', color:'var(--gold-300)', flex:'none'}}>{Ic.sparkle(16)}</div>
          <div>
            <div style={{fontSize:14, color:'var(--fg-primary)', lineHeight:1.5}}>
              Good afternoon, Alex. I can see Count 1 for Delilah LA just closed. <strong>Don Julio 1942</strong> and <strong>Macallan 18</strong> both landed in critical variance — shrink suggests ≈3 bottles of 1942 unaccounted for this week. Want me to cross-reference Main Bar camera windows and recent Slack flags?
            </div>
            <div style={{display:'flex', gap:6, marginTop:10, flexWrap:'wrap'}}>
              {['Cross-reference Main Bar', 'Draft GM Slack update', 'Compare to last Count 2', 'Explain severity scoring'].map(s => (
                <button key={s} style={{padding:'6px 12px', borderRadius:9999, border:'1px solid var(--border)', background:'#FFF', fontSize:12, fontWeight:500, fontFamily:'inherit', color:'var(--fg-secondary)', cursor:'pointer'}}>{s}</button>
              ))}
            </div>
          </div>
        </div>

        {/* User */}
        <div style={{display:'flex', gap:12, alignItems:'flex-start', justifyContent:'flex-end'}}>
          <div style={{background:'var(--dark-900)', color:'var(--off-100)', padding:'12px 16px', borderRadius:12, borderTopRightRadius:4, maxWidth:520, fontSize:14, lineHeight:1.5}}>
            Which venues are trending worse than last quarter on tequila shrink?
          </div>
          <Avatar name="Alex Chen" size={32}/>
        </div>

        {/* AI response w/ table-ish content */}
        <div style={{display:'flex', gap:12, alignItems:'flex-start'}}>
          <div style={{width:32, height:32, borderRadius:8, background:'var(--dark-900)', display:'grid', placeItems:'center', color:'var(--gold-300)', flex:'none'}}>{Ic.sparkle(16)}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:14, color:'var(--fg-primary)', lineHeight:1.5, marginBottom:10}}>
              Three venues are worse than Q1. Delilah LA is the largest mover.
            </div>
            <Card padding={0} style={{maxWidth: 560}}>
              {[
                {v:'Delilah LA',       q1:'−1.8%', now:'−3.1%',  delta:'+1.3 pp', tone:'critical'},
                {v:'Bird Streets',     q1:'−1.2%', now:'−2.0%',  delta:'+0.8 pp', tone:'caution'},
                {v:'Poppy',            q1:'−0.9%', now:'−1.3%',  delta:'+0.4 pp', tone:'caution'},
              ].map((r, i) => (
                <div key={i} style={{display:'grid', gridTemplateColumns:'1.4fr .8fr .8fr .9fr', gap:12, padding:'12px 14px', borderBottom: i < 2 ? '1px solid var(--border)' : 'none', alignItems:'center'}}>
                  <div style={{fontSize:13, fontWeight:600}}>{r.v}</div>
                  <div style={{fontSize:12, fontFamily:'JetBrains Mono, monospace', color:'var(--fg-muted)'}}>{r.q1}</div>
                  <div style={{fontSize:12, fontFamily:'JetBrains Mono, monospace', color:'var(--raspberry-300)', fontWeight:600}}>{r.now}</div>
                  <div style={{textAlign:'right'}}><Pill tone={r.tone} size="sm">{r.delta}</Pill></div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>

      {/* Composer */}
      <div style={{marginTop:20, background:'#FFF', border:'1px solid var(--border-strong)', borderRadius:8, padding:12, display:'flex', alignItems:'center', gap:10}}>
        <input placeholder="Ask about any audit, venue, SKU or trend..." style={{flex:1, border:'none', outline:'none', fontFamily:'inherit', fontSize:14, background:'transparent', color:'var(--fg-primary)'}}/>
        <button style={{width:36, height:36, borderRadius:6, border:'none', background:'var(--dark-900)', color:'var(--off-100)', display:'grid', placeItems:'center', cursor:'pointer'}}>{Ic.arrowRight(16)}</button>
      </div>
    </div>
  </DesktopShell>
);

window.DesktopScreens = {
  DesktopVenues, DesktopVariance, DesktopRecount, DesktopIssues, DesktopSummary, DesktopAI,
};
