// App — orchestrates screens, tabs, tweaks, and frames
const { useState, useEffect } = React;

const TWEAKS = /*EDITMODE-BEGIN*/{
  "accent": "ink",
  "density": "comfy",
  "scanStyle": "laser",
  "showFrames": true
}/*EDITMODE-END*/;

const PHONE_SCREENS = [
  { k:'login',    label:'Login' },
  { k:'venues',   label:'Venues' },
  { k:'guided',   label:'Count · guided' },
  { k:'free',     label:'Count · free' },
  { k:'quick',    label:'Count · quick tap' },
  { k:'scanner',  label:'Barcode scanner' },
  { k:'recount',  label:'Recount' },
  { k:'summary',  label:'Summary' },
];
const DESKTOP_SCREENS = [
  { k:'venues',   label:'Venues' },
  { k:'variance', label:'Variance dashboard' },
  { k:'recount',  label:'Recount handoff' },
  { k:'summary',  label:'Audit summary' },
  { k:'issues',   label:'Issues tracker' },
  { k:'ai',       label:'Ask kΩunt (AI)' },
];

// Persisted screen selection
const load = (k, d) => { try { return JSON.parse(localStorage.getItem('kount.'+k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem('kount.'+k, JSON.stringify(v)); } catch {} };

function PhoneFrame({ children, show }) {
  if (!show) return <div style={{width:410, height:840, display:'flex', flexDirection:'column'}}><div style={{width:390, height:820, borderRadius:12, overflow:'hidden', border:'1px solid var(--border)', display:'flex', flexDirection:'column', background:'var(--canvas)'}}>{children}</div></div>;
  return (
    <div className="phone">
      <div className="phone-notch"/>
      <div className="phone-screen">
        <div className="phone-status">
          <span>9:41</span>
          <span style={{display:'flex', gap:6, alignItems:'center'}}>
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 9h1M4 7h1M7 5h1M10 3h1M13 1h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5a6 6 0 0112 0M3 6.5a4 4 0 018 0M5.5 8a1.5 1.5 0 013 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            <svg width="22" height="10" viewBox="0 0 22 10" fill="none"><rect x="0.5" y="1" width="18" height="8" rx="1.8" stroke="currentColor"/><rect x="2" y="2.5" width="15" height="5" rx="0.6" fill="currentColor"/><rect x="19.5" y="3.5" width="1.5" height="3" rx="0.5" fill="currentColor"/></svg>
          </span>
        </div>
        <div className="phone-content">{children}</div>
        <div className="phone-home"/>
      </div>
    </div>
  );
}

function DesktopFrame({ children, show }) {
  if (!show) return <div style={{flex:1, minHeight:820, border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', display:'flex', background:'var(--canvas)'}}>{children}</div>;
  return (
    <div className="desktop">
      <div className="desktop-chrome">
        <div className="tl" style={{background:'#FF5F57'}}/>
        <div className="tl" style={{background:'#FEBC2E'}}/>
        <div className="tl" style={{background:'#28C840'}}/>
        <div className="addr">kount.hwood.internal / {new Date().toLocaleDateString()}</div>
        <div style={{width:40}}/>
      </div>
      <div style={{flex:1, display:'flex'}}>{children}</div>
    </div>
  );
}

function App() {
  const [phone, setPhone] = useState(() => load('phone', 'guided'));
  const [desktop, setDesktop] = useState(() => load('desktop', 'variance'));
  const [tweaks, setTweaks] = useState(TWEAKS);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  useEffect(() => save('phone', phone), [phone]);
  useEffect(() => save('desktop', desktop), [desktop]);

  // Tweak host protocol
  useEffect(() => {
    const onMsg = e => {
      if (e.data?.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const updateTweak = (k, v) => {
    const next = { ...tweaks, [k]: v };
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*');
  };

  // Apply accent on body
  useEffect(() => {
    document.body.setAttribute('data-accent', tweaks.accent);
  }, [tweaks.accent]);

  const P = window.PhoneScreens;
  const D = window.DesktopScreens;

  const renderPhone = () => {
    switch (phone) {
      case 'login':   return <P.PhoneLogin/>;
      case 'venues':  return <P.PhoneVenues tab="venues" setTab={k => { if (k === 'count') setPhone('guided'); else if (k === 'summary') setPhone('summary'); else setPhone(k); }}/>;
      case 'guided':  return <P.PhoneCountGuided tab="count" setTab={k => setPhone(k === 'count' ? 'guided' : k)} density={tweaks.density}/>;
      case 'free':    return <P.PhoneCountFree tab="count" setTab={k => setPhone(k === 'count' ? 'guided' : k)}/>;
      case 'quick':   return <P.PhoneCountQuick tab="count" setTab={k => setPhone(k === 'count' ? 'guided' : k)}/>;
      case 'scanner': return <P.PhoneBarcodeScanner/>;
      case 'recount': return <P.PhoneRecount tab="count" setTab={k => setPhone(k === 'count' ? 'recount' : k)}/>;
      case 'summary': return <P.PhoneSummary tab="summary" setTab={k => setPhone(k === 'summary' ? 'summary' : k)}/>;
      default: return null;
    }
  };

  const renderDesktop = () => {
    switch (desktop) {
      case 'venues':   return <D.DesktopVenues page={desktop} setPage={setDesktop}/>;
      case 'variance': return <D.DesktopVariance page={desktop} setPage={setDesktop}/>;
      case 'recount':  return <D.DesktopRecount page={desktop} setPage={setDesktop}/>;
      case 'summary':  return <D.DesktopSummary page={desktop} setPage={setDesktop}/>;
      case 'issues':   return <D.DesktopIssues page={desktop} setPage={setDesktop}/>;
      case 'ai':       return <D.DesktopAI page={desktop} setPage={setDesktop}/>;
      default: return null;
    }
  };

  return (
    <div className="stage">
      <div className="stage-header">
        <div className="brand-lock">
          <div className="brand-mark">kΩ</div>
          <div className="brand-text">
            <div className="wordmark">kΩunt</div>
            <div className="sub">Inventory audit · H.Wood Group concept</div>
          </div>
        </div>
        <div style={{display:'flex', gap:16, flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--fg-muted)', fontWeight:600, marginBottom:6}}>Phone · counter POV</div>
            <div className="screen-picker">
              {PHONE_SCREENS.map(s => <button key={s.k} className={phone === s.k ? 'active' : ''} onClick={() => setPhone(s.k)}>{s.label}</button>)}
            </div>
          </div>
          <div>
            <div style={{fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--fg-muted)', fontWeight:600, marginBottom:6}}>Desktop · manager POV</div>
            <div className="screen-picker">
              {DESKTOP_SCREENS.map(s => <button key={s.k} className={desktop === s.k ? 'active' : ''} onClick={() => setDesktop(s.k)}>{s.label}</button>)}
            </div>
          </div>
        </div>
      </div>

      <div className="surfaces">
        <div>
          <div className="surface-tag"><span className="dot"/> iPhone · Bartender / Counter</div>
          <PhoneFrame show={tweaks.showFrames}>{renderPhone()}</PhoneFrame>
        </div>
        <div>
          <div className="surface-tag"><span className="dot" style={{background:'var(--amethyst-300)'}}/> Desktop · Manager / Ops</div>
          <DesktopFrame show={tweaks.showFrames}>{renderDesktop()}</DesktopFrame>
        </div>
      </div>

      <div style={{fontSize:11, color:'var(--fg-muted)', letterSpacing:'.04em', lineHeight:1.6, maxWidth:720}}>
        <strong style={{color:'var(--fg-secondary)', letterSpacing:'.06em', textTransform:'uppercase', fontSize:10}}>Notes</strong><br/>
        Brand: "kΩunt" (k-omega-unt). Omega nods at variance/tolerance. Counter-facing phone app is ink-on-cream with gold accents for active state; manager desktop is the same palette with raspberry reserved for variance/critical. Pipeline is AVT (Craftable) → Count 1 → Review → Recount → Final.
      </div>

      <div className={`tweaks-panel ${tweaksOpen ? 'open' : ''}`}>
        <h4>Tweaks</h4>
        <div className="tweak-row">
          <div className="tweak-label">Accent color</div>
          <div style={{display:'flex', gap:8}}>
            {[
              {k:'ink',       color:'#0D0A08'},
              {k:'gold',      color:'#C9A24C'},
              {k:'raspberry', color:'#C13A57'},
              {k:'teal',      color:'#3F7D73'},
            ].map(o => (
              <div key={o.k} className={`tweak-swatch ${tweaks.accent === o.k ? 'active' : ''}`} onClick={() => updateTweak('accent', o.k)} style={{background:o.color}}>
                <svg viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <div className="tweak-label">Phone density</div>
          <div className="tweak-choices">
            {['comfy','dense'].map(d => (
              <button key={d} className={`tweak-choice ${tweaks.density === d ? 'active' : ''}`} onClick={() => updateTweak('density', d)}>{d}</button>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <div className="tweak-label">Show device frames</div>
          <div className="tweak-choices">
            {[['true','On'],['false','Off']].map(([v, l]) => (
              <button key={v} className={`tweak-choice ${String(tweaks.showFrames) === v ? 'active' : ''}`} onClick={() => updateTweak('showFrames', v === 'true')}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('app-root')).render(<App/>);
