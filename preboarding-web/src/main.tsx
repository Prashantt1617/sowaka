import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MOCK, setSession } from './api/client';
import './styles/tokens.css';
import './styles/app.css';

// Dev mock mode: ?mock=<state> signs the reviewer in with a fixture session.
if (MOCK && new URLSearchParams(window.location.search).has('mock')) setSession('mock-session');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// No zoom on the portal: iOS Safari ignores user-scalable=no for pinches, so its gesture events are stopped here.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
