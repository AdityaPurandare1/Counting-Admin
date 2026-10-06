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

// Stale tab after a deploy: every build renames its hashed chunks and GitHub
// Pages serves only the newest set, so a tab opened before a deploy fails the
// first lazy import it tries afterwards ("Failed to fetch dynamically imported
// module …/assets/exceljs.min-<old hash>.js" on the audit report button,
// 2026-10-05). Vite raises `vite:preloadError` for exactly that case. Reload
// once to pick up the new index; the guard stops a loop if the reload itself
// lands on a broken deploy. State in sessionStorage survives the reload and
// is cleared on the next successful import so a later deploy can reload again.
window.addEventListener('vite:preloadError', (e) => {
  const key = 'kount:reloaded-for-stale-chunk';
  let already = false;
  try { already = sessionStorage.getItem(key) === '1'; } catch { /* storage blocked — just reload once per page load */ }
  if (already) return; // fall through to the normal error path; the user sees the alert
  e.preventDefault();
  try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
  logClientError('stale-chunk-reload', (e as unknown as { payload?: unknown }).payload);
  window.location.reload();
});
window.addEventListener('load', () => {
  try { sessionStorage.removeItem('kount:reloaded-for-stale-chunk'); } catch { /* ignore */ }
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
