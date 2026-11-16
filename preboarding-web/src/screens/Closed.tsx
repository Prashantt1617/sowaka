import type { ReactNode } from 'react';
import type { Company, HrContact } from '../api/types';
import { Page } from '../components/Shell';
import { Plant } from '../components/Plant';
import { Icon } from '../components/Icon';
import { BottomBar, Eyebrow } from '../components/ui';
import { fmtShort } from '../lib/format';
import { APP_LINK, mailto, offerSubject } from '../lib/links';
import { useFocusHeading } from '../lib/hooks';

export type ClosedState = 'declined' | 'expired' | 'replaced' | 'moved_to_app' | 'not_joining';

/** One template for every closed state (P3b, P3c, P3e, P16, PX). Mobile layout, centred at 430 px on desktop. */
export function ClosedScreen({ state, company, hr, validTill }: { state: ClosedState; company: Company; hr: HrContact; validTill?: string }) {
  const h1 = useFocusHeading<HTMLHeadingElement>(state);
  const subject = offerSubject(company.name);
  const emailHr = (
    <a className="btn btn--primary" href={mailto(hr.email, subject)}>
      Email HR
    </a>
  );
  const copy: Record<ClosedState, { eyebrow: string; title: string; sub: string; cta: ReactNode }> = {
    declined: {
      eyebrow: 'Offer declined',
      title: 'Thanks for letting us know',
      sub: 'HR has been told. If you change your mind, reply to your offer email.',
      cta: (
        <button type="button" className="btn btn--primary" onClick={() => window.close()}>
          Close
        </button>
      ),
    },
    expired: {
      eyebrow: validTill ? `Offer expired on ${fmtShort(validTill)}` : 'Offer expired',
      title: 'This offer is no longer open',
      sub: 'Still interested? Email HR and they can send you a new offer.',
      cta: emailHr,
    },
    replaced: {
      eyebrow: 'You have a newer offer',
      title: 'Check your email',
      sub: 'HR sent you an updated offer. Open the latest email to see it.',
      cta: emailHr,
    },
    moved_to_app: {
      eyebrow: 'Week 1 is done',
      title: 'Continue in the app',
      // CONTRACT decision 1: the app signs in with the work email and a one-time code.
      sub: 'Your tasks, documents and plant are all in the app. Sign in to the app with your work email — we’ll send a code.',
      cta: (
        <a className="btn btn--primary" href={APP_LINK}>
          Open the app
        </a>
      ),
    },
    not_joining: {
      eyebrow: 'Joining cancelled',
      title: 'This portal is closed',
      sub: 'HR has cancelled your joining. Your documents are kept only as long as the law requires.',
      cta: emailHr,
    },
  };
  const c = copy[state];
  const app = state === 'moved_to_app';
  return (
    <Page header={{ company, hr }} layout="narrow" bg={app ? 'tint' : 'surface'}>
      <section className="closed rise">
        <div className="closed__art">
          {app ? (
            <Plant stage={1} size={150} sway />
          ) : (
            <span className={`closed__icon closed__icon--${state}`} aria-hidden="true">
              <Icon name={state === 'replaced' ? 'mail' : state === 'expired' ? 'calendar' : state === 'declined' ? 'check' : 'lock'} size={34} />
            </span>
          )}
        </div>
        <Eyebrow>{c.eyebrow}</Eyebrow>
        <h1 className="display" ref={h1} tabIndex={-1}>
          {c.title}
        </h1>
        <p className="body sub">{c.sub}</p>
      </section>
      <BottomBar>{c.cta}</BottomBar>
    </Page>
  );
}
