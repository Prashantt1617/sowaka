import { StoreProvider, useStore } from './store';
import { Component, Suspense, use, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { View } from './theme';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { useBrandDocument } from './brand';
import { LoginScreen } from './auth/LoginScreen';
import { OVERVIEW_ITEM, SECTIONS, Sidebar, Topbar, Toast } from './Chrome';
import { canOpen } from './access';
import { Placeholder } from './views/Placeholder';
import { Drawers } from './drawers';
import { rememberBrandOrg } from './brand';
import { SuwiPanel } from './suwi/SuwiPanel';
import { hasViewPage, isPageCodeFailure, prefetchAllViews, prefetchView, viewPage } from './viewChunks';

function ViewPage({ view }: { view: View }) {
  const Page = use(viewPage(view));
  return <Page />;
}

const PAGE_FALLBACK = <div style={{ minHeight: 400 }} />;

/** The Tournament TV's stream view (`?stream=1`): the TV alone, no sidebar or top bar. */
const TV_STREAM = (() => {
  try {
    return new URLSearchParams(window.location.search).get('stream') === '1';
  } catch {
    return false;
  }
})();

// If a page's code cannot be fetched, its area stays empty and the rest of the
// dashboard keeps working; opening the page again retries. Any other error
// carries on up, as it always has.
class PageCodeBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error === null) return this.props.children;
    if (isPageCodeFailure(this.state.error)) return PAGE_FALLBACK;
    throw this.state.error;
  }
}

function CurrentView() {
  const { view } = useStore();
  if (!hasViewPage(view)) return <Placeholder />;
  // Neutral while the page's code arrives (usually already prefetched).
  return (
    <PageCodeBoundary key={view}>
      <Suspense fallback={PAGE_FALLBACK}>
        <ViewPage view={view} />
      </Suspense>
    </PageCodeBoundary>
  );
}

function Shell() {
  const { view, setView, loaded } = useStore();
  const { user } = useAuth();
  // The page's code downloads alongside the start-up data, not after it.
  useEffect(() => { prefetchView(view); }, [view]);
  // Once the start-up data is in, the other pages' code follows while the
  // browser is idle, so opening one later does not wait on the network.
  useEffect(() => {
    if (!loaded) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => prefetchAllViews(), { timeout: 5000 });
    return () => cancel(id);
  }, [loaded]);
  // Land on a tab this person may open, and leave one taken away from them.
  useEffect(() => {
    if (canOpen(user, view)) return;
    const first = [OVERVIEW_ITEM, ...SECTIONS.flatMap((s) => s.items)].find((item) => canOpen(user, item.key));
    if (first) setView(first.key);
  }, [user, view, setView]);
  // So the next sign-in screen on this device already wears their company.
  useEffect(() => { rememberBrandOrg(user?.org ?? user?.company); }, [user]);
  if (TV_STREAM && canOpen(user, 'cuptv')) {
    return (
      <div style={{ minHeight: '100vh', width: '100%', background: '#15122B' }}>
        <PageCodeBoundary>
          <Suspense fallback={PAGE_FALLBACK}>
            <ViewPage view="cuptv" />
          </Suspense>
        </PageCodeBoundary>
        <Toast />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', padding: 16, gap: 20, overflow: 'hidden' }}>
      <Sidebar />
      <main className="scry" style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '16px 6px', margin: '-16px -6px' }}>
        <Topbar />
        <div style={{ padding: '20px 0 32px', flex: 1 }}>
          {/* Each view shows its own loading state until the data it needs has arrived. */}
          <CurrentView />
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
