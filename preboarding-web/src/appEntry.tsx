// The portal inside the Sowaka app. The app (signed in as the joiner) asks the server for
// a portal session (POST /lifecycle/portal-session) and opens `/onboarding/app?c=…#t=<token>`
// in its own page, between the app's header and its tabs. This entry keeps the token as the
// portal's session (the fragment never reaches a server or a log), marks the page as hosted
// by the app, and goes on to the home. While hosted:
// - <html data-host="app"> hides the portal's own web header (the app draws its header);
// - signing out, or a session that ran out, tells the app (`SowakaPortal` channel) instead
//   of showing the sign-in page: the app gets a fresh session and loads the page again.
import { Navigate } from 'react-router-dom';
import { getSession, SESSION_EXPIRED_EVENT, setSession } from './api/client';
import { portal } from './api/portal';

const HOST_KEY = 'sowaka.portal.host';

type Channel = { postMessage: (message: string) => void };
const channel = () => (window as unknown as { SowakaPortal?: Channel }).SowakaPortal;

/** Whether the app hosts this page (set by the /app entry, kept for the WebView's life). */
export function inApp(): boolean {
  try {
    return sessionStorage.getItem(HOST_KEY) === 'app';
  } catch {
    return document.documentElement.dataset.host === 'app';
  }
}

function tellApp(message: 'expired' | 'signed-out') {
  try {
    channel()?.postMessage(message);
  } catch {
    /* no app around: nothing to tell */
  }
}

let installed = false;
function installHost() {
  document.documentElement.dataset.host = 'app';
  if (installed) return;
  installed = true;
  // The app draws its own header over the page: the portal's web header goes.
  const style = document.createElement('style');
  style.textContent = 'html[data-host="app"] .a1-web-head { display: none; }';
  document.head.appendChild(style);
  window.addEventListener(SESSION_EXPIRED_EVENT, () => tellApp('expired'));
  const signOut = portal.signOut;
  portal.signOut = () => {
    signOut();
    tellApp('signed-out');
  };
}

// A reload inside the app (or a link within the portal) keeps the hosted look.
if (inApp()) installHost();

/** `/app#t=<portal token>`: the app's way in. Without a token, the usual signed-in check decides. */
export function AppEntry() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
  if (token) {
    setSession(token);
    try {
      sessionStorage.setItem(HOST_KEY, 'app');
    } catch {
      /* private mode: the attribute alone */
    }
    installHost();
  }
  if (!token && !getSession()) tellApp('expired');
  // Replacing this entry drops the fragment: the token leaves the address and the history.
  return <Navigate to="/" replace />;
}
