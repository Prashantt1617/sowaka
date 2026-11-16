import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { MOCK } from './api/client';
import { SignedIn } from './session';
import { Page } from './components/Shell';
import { OfferLink, OfferSession } from './screens/Offer';
import { Forgot, Reset, SignIn } from './screens/Auth';
import { Home } from './screens/Home';
import { Documents } from './screens/Documents';
import { About } from './screens/About';
import { Meet } from './screens/Meet';
import { Letters } from './screens/Letters';
import { Pass } from './screens/Pass';
import { DateRequest } from './screens/DateRequest';

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

export function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Routes>
        <Route path="/o/:token" element={<OfferLink />} />
        <Route path="/o/:token/letter" element={<OfferLink letter />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset/:token" element={<Reset />} />
        <Route element={<SignedIn />}>
          <Route path="/" element={<Home />} />
          <Route path="/offer" element={<OfferSession />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/about" element={<About />} />
          <Route path="/meet" element={<Meet />} />
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
