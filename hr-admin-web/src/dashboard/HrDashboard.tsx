import { StoreProvider, useStore } from './store';
import { Suspense, useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { useBrandDocument } from './brand';
import { LoginScreen } from './auth/LoginScreen';
import { OVERVIEW_ITEM, SECTIONS, Sidebar, Topbar, Toast } from './Chrome';
import { canOpen } from './access';
import { Placeholder } from './views/Placeholder';
import { Drawers } from './drawers';
import { rememberBrandOrg } from './brand';
import { SuwiPanel } from './suwi/SuwiPanel';
import { VIEW_COMPONENTS, prefetchView } from './viewChunks';

function CurrentView() {
  const { view } = useStore();
  const Page = VIEW_COMPONENTS[view];
  if (!Page) return <Placeholder />;
  // Neutral while the page's code arrives (usually already prefetched).
  return (
    <Suspense fallback={<div style={{ minHeight: 400 }} />}>
      <Page />
    </Suspense>
  );
}

function LoadingBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'var(--ink-3)', fontSize: 12.5, fontWeight: 400 }}>
      <span style={{ width: 16, height: 16, border: '2px solid var(--line)', borderTopColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block', marginRight: 10, animation: 'spin .7s linear infinite' }} />
      Loading…
    </div>
  );
}

function Shell() {
  const { loading, loaded, view, setView } = useStore();
  const { user } = useAuth();
  // The page's code downloads alongside the start-up data, not after it.
  useEffect(() => { prefetchView(view); }, [view]);
  // Land on a tab this person may open, and leave one taken away from them.
  useEffect(() => {
    if (canOpen(user, view)) return;
    const first = [OVERVIEW_ITEM, ...SECTIONS.flatMap((s) => s.items)].find((item) => canOpen(user, item.key));
    if (first) setView(first.key);
  }, [user, view, setView]);
  // So the next sign-in screen on this device already wears their company.
  useEffect(() => { rememberBrandOrg(user?.org ?? user?.company); }, [user]);
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', padding: 16, gap: 20, overflow: 'hidden' }}>
      <Sidebar />
      <main className="scry" style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0 6px', margin: '0 -6px' }}>
        <Topbar />
        <div style={{ padding: '20px 4px 40px', flex: 1 }}>
          {loading && !loaded ? <LoadingBar /> : <CurrentView />}
        </div>
      </main>
      <Drawers />
      <SuwiPanel />
      <Toast />
    </div>
  );
}

function AccessDenied() {
  const { user, signOut } = useAuth();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--ink-2)', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 50.5, marginBottom: 12 }}>🔒</div>
      <h1 style={{ fontSize: 19, fontWeight: 400, margin: 0, color: 'var(--ink)' }}>No dashboard access</h1>
      <p style={{ maxWidth: 420, marginTop: 10, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-3)' }}>
        Your account{user?.email ? ` (${user.email})` : ''} isn’t authorized to use the HR dashboard.
        Ask an administrator to grant you dashboard access.
      </p>
      <button
        onClick={() => void signOut()}
        style={{ marginTop: 22, height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 400, fontSize: 12.5, cursor: 'pointer' }}
      >
        Sign out
      </button>
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  // Under the provider, and above both the sign-in screen and the shell, so
  // the tab wears the company on convrse.getsowaka.com before anyone signs in.
  useBrandDocument();
  if (!user) return <LoginScreen />;
  // Rule 4: the dashboard is only for select users granted dashboard access.
  if (!user.dashboardAccess) return <AccessDenied />;
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

export function HrDashboard() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
