import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { logClientError } from '@/lib/telemetry';
import { Btn, Card, Eyebrow } from '@/components/atoms';

/* Top-level React error boundary (v0.37). A render-time throw anywhere
   below this would otherwise blank the whole SPA with no trace; here we
   report it to telemetry and show a minimal recoverable fallback. */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Fold the component stack into extra context so the logged message
    // points at the offending tree, not just the throw site.
    const componentStack = info?.componentStack ?? '';
    logClientError('react.render', error, { level: 'error' });
    // Best-effort: surface the component stack too, but don't let a second
    // throw escape the boundary.
    if (componentStack) {
      logClientError(
        'react.render.componentStack',
        new Error(`${error?.message ?? 'render error'}\n${componentStack}`),
        { level: 'warn' },
      );
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <Card padding={28} style={{ width: 'min(440px, 92vw)', textAlign: 'center' }}>
          <Eyebrow>Error</Eyebrow>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 8, lineHeight: 1.5 }}>
            The page hit an unexpected error and couldn't continue. Reloading usually clears it —
            the issue has been logged.
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
            <Btn variant="primary" onClick={() => window.location.reload()}>Reload</Btn>
          </div>
        </Card>
      </div>
    );
  }
}
