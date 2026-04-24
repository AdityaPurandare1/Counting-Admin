/* Stub screens — Variance lives in ./Variance.tsx as of v0.3.
   The rest are still placeholders; each gets its own real port in later
   versions (Recount + Summary in v0.5, Issues in v0.6, AI in v0.7). */
import type { ReactNode } from 'react';

function Shell({ title, eyebrow, children }: { title: string; eyebrow: string; children?: ReactNode }) {
  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="content">
        {children ?? <div className="placeholder">Port coming in a later version — see README roadmap.</div>}
      </div>
    </>
  );
}

export function Issues() { return <Shell eyebrow="Issues tracker" title="Open issues" />; }
export function AI()     { return <Shell eyebrow="Ask kΩunt"      title="AI assistant" />; }
