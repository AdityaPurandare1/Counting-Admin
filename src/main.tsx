import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';

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
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
