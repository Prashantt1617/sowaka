import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getSession, SESSION_EXPIRED_EVENT } from './api/client';
import { portal } from './api/portal';
import type { PortalHome } from './api/types';
import { rememberClient, type Bell, type HeaderProps } from './components/Shell';
import { Spinner, ErrorNote } from './components/ui';
import { JOINING_SUBJECT } from './lib/links';
import { fmtWeekday } from './lib/format';

interface SessionCtx {
  me: PortalHome;
  reload: () => Promise<void>;
  subject: string;
  /** Header props every signed-in screen shares (logo, HR, bell, joiner). */
  header: (extra?: Partial<HeaderProps>) => HeaderProps;
}

const Ctx = createContext<SessionCtx | null>(null);

export function useMe(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMe outside the signed-in area');
  return v;
}

/** Bell items, from what the home read model already says (there is no notifications endpoint). */
function bellFor(me: PortalHome): Bell {
  const items: Bell['items'] = [];
  if (me.banner?.kind === 'offer_updated') items.push({ title: 'HR updated your offer', sub: 'Please review the changes', to: '/offer' });
  for (const t of me.tasks) {
    if (t.status === 'sent_back') items.push({ title: t.title, sub: t.note ?? 'HR sent this back', to: '/documents' });
  }
  if (me.view === 'letter_ready') items.push({ title: 'Documents approved', sub: 'Sign your appointment letter', to: '/letters' });
  if (me.view === 'pass_unlocked') items.push({ title: 'Your Day-1 pass is ready', sub: `Day 1 is ${fmtWeekday(me.tj)}`, to: '/pass' });
  return { items };
}

/** Loads /portal/me for the signed-in screens; sends the candidate to sign in otherwise. */
export function SignedIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const [me, setMe] = useState<PortalHome>();
  const [error, setError] = useState<Error>();
  const hasSession = !!getSession();

  const reload = useCallback(async () => {
    try {
      const next = await portal.me();
      rememberClient(next.company, next.hrContact);
      setMe(next);
      setError(undefined);
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  useEffect(() => {
    if (hasSession) reload();
  }, [hasSession, reload]);

  useEffect(() => {
    const on = () => navigate('/sign-in?expired=1', { replace: true, state: { from: location.pathname } });
    window.addEventListener(SESSION_EXPIRED_EVENT, on);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, on);
  }, [navigate, location.pathname]);

  const value = useMemo<SessionCtx | null>(() => {
    if (!me) return null;
    const subject = JOINING_SUBJECT;
    const bell = bellFor(me);
    return {
      me,
      reload,
      subject,
      header: (extra) => ({
        company: me.company, hr: me.hrContact, help: true, bell, joiner: { name: me.candidateName, tj: me.tj },
        // Signing out clears the session and replaces this page in the history: Back lands on sign-in, not the portal.
        onSignOut: () => { portal.signOut(); navigate('/sign-in', { replace: true }); },
        ...extra,
      }),
    };
  }, [me, reload, navigate]);

  // A mail's link that lands signed out keeps its ?email= for the sign-in box.
  const linkEmail = new URLSearchParams(location.search).get('email');
  if (!hasSession) return <Navigate to={linkEmail ? `/sign-in?email=${encodeURIComponent(linkEmail)}` : '/sign-in'} replace state={{ from: location.pathname }} />;
  if (error && !me)
    return (
      <div className="page page--narrow page--bg-surface">
        <main className="page__main center-fill">
          <ErrorNote error={error} onRetry={reload} />
        </main>
      </div>
    );
  if (!value)
    return (
      <div className="page page--narrow page--bg-surface">
        <main className="page__main center-fill">
          <Spinner />
        </main>
      </div>
    );
  return (
    <Ctx.Provider value={value}>
      <Outlet />
    </Ctx.Provider>
  );
}
