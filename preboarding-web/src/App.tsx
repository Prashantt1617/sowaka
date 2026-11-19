import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { MOCK } from './api/client';
import { portal } from './api/portal';
import { SignedIn } from './session';
import { AppEntry } from './appEntry';
import { Page, rememberClient } from './components/Shell';
import { OfferLink } from './screens/Offer';
import { Forgot, Reset, SignIn } from './screens/Auth';
import { Letters } from './screens/Letters';
import { Pass } from './screens/Pass';
import { DateRequest } from './screens/DateRequest';
import { A1Home } from './screens/A1Home';
import { A1Joining, A1Offer } from './screens/A1Sections';
import { A1Profile, A1ProfileSection } from './screens/A1Profile';
import { A1About } from './screens/A1About';
import './styles/a1.css';

// Dev-only state switcher for VITE_MOCK=1 (dropped from production builds).
const MockBar = import.meta.env.DEV ? lazy(() => import('./mock/MockBar')) : null;

function NotFound() {
  return (
    <Page header={{}}>
      <section className="closed">
        <h1 className="display">This page doesn’t exist</h1>
        <p className="body sub">Open the link in your offer email, or sign in to your joining portal.</p>
        <Link className="text-link" to="/sign-in">
          Sign in
        </Link>
      </section>
    </Page>
  );
}

/**
 * Every portal link in a mail carries `?c=<client token>`: on a device that never
 * opened the offer link, sign-in / forgot / reset still show the client's logo and HR.
 */
function useClientFromLink() {
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c');
    if (!c) return;
    portal.client(c).then(
      (r) => rememberClient(r.company, r.hrContact),
      () => undefined,
    );
  }, []);
}

export function App() {
  useClientFromLink();
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Routes>
        <Route path="/o/:token" element={<OfferLink />} />
        <Route path="/o/:token/letter" element={<OfferLink letter />} />
        <Route path="/app" element={<AppEntry />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset/:token" element={<Reset />} />
        <Route element={<SignedIn />}>
          {/* The 18 Nov portal: four tiles (offer, joining, profile, company). Older links land on their new place. */}
          <Route path="/" element={<A1Home />} />
          <Route path="/offer" element={<A1Offer />} />
          <Route path="/joining" element={<A1Joining />} />
          <Route path="/profile" element={<A1Profile />} />
          <Route path="/profile/:section" element={<A1ProfileSection />} />
          <Route path="/about" element={<A1About />} />
          <Route path="/documents" element={<Navigate to="/profile" replace />} />
          <Route path="/about-you" element={<Navigate to="/profile/emergency" replace />} />
          <Route path="/meet" element={<Navigate to="/about" replace />} />
          <Route path="/letters" element={<Letters />} />
          <Route path="/letters/:id" element={<Letters />} />
          <Route path="/pass" element={<Pass />} />
          <Route path="/date-request" element={<DateRequest />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      {MOCK && MockBar && (
        <Suspense fallback={null}>
          <MockBar />
        </Suspense>
      )}
    </BrowserRouter>
  );
}
