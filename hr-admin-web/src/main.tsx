import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// After a deploy a page that was already open still asks for the old build's
// files (a lazy page, the PDF library), and they are gone: load the new build
// instead of failing, at most once a minute so a real outage cannot loop.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'dashboard.reloadedForNewBuild';
  let last = 0;
  try { last = Number(sessionStorage.getItem(key) ?? 0); } catch { /* storage off: reload anyway */ }
  if (Date.now() - last < 60_000) return;
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* as above */ }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
