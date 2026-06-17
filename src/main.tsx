import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logClientError } from './lib/telemetry';
import './styles/tokens.css';
import './styles/global.css';

// Global error telemetry — registered once at startup. Both handlers are
// best-effort and the logger itself never throws/recurses, so they're safe
// to leave on in prod. Uncaught render errors are handled by ErrorBoundary.
window.addEventListener('error', (e) => {
  logClientError('window.error', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  logClientError('unhandledrejection', e.reason);
});

// SPA redirect restore: if we arrived via public/404.html's fallback, the
// original path is parked in ?__redirect=... — swap it back into history
// before React Router boots so the user lands on the deep-linked route.
(() => {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('__redirect');
  if (redirect) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const clean = redirect.replace(/^\/+/, '');
    window.history.replaceState(null, '', base + '/' + clean);
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
