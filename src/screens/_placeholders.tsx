/* Stub screens for v0.1. Real ports from docs/designs/raw/desktop_screens.jsx
   land in v0.2+. Each one renders a topbar + a placeholder so we can see
   routing works end-to-end. */

function Shell({ title, eyebrow, children }: { title: string; eyebrow: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="content">
        {children ?? <div className="placeholder">Port coming in v0.2</div>}
      </div>
    </>
  );
}

export function Venues()   { return <Shell eyebrow="Overview"   title="Venues" />; }
export function Variance() { return <Shell eyebrow="Variance dashboard" title="Count 1 review" />; }
export function Recount()  { return <Shell eyebrow="Recount handoff"    title="Flagged items" />; }
export function Summary()  { return <Shell eyebrow="Audit summary"      title="All audits" />; }
export function Issues()   { return <Shell eyebrow="Issues tracker"     title="Open issues" />; }
export function AI()       { return <Shell eyebrow="Ask kΩunt"          title="AI assistant" />; }
