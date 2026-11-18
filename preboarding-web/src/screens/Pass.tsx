import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { portal } from '../api/portal';
import { ApiError, MOCK } from '../api/client';
import { Page, ClientLogo } from '../components/Shell';
import { Icon } from '../components/Icon';
import { BackLink, BottomBar, ErrorNote, PrimaryButton, Spinner } from '../components/ui';
import { addDays, fmtShort, fmtTime, fmtWeekday } from '../lib/format';
import { useAsync, useFocusHeading, useWide } from '../lib/hooks';
import { buildIcs, directionsUrl, downloadBlob } from '../lib/links';
import { useMe } from '../session';

/** P14 / W14 · Day-1 pass (+ Add to calendar .ics, directions). Opens at Tj − 7 (before: 200 `{ state: 'locked', opensOn }`). */
export function Pass() {
  const { header, me } = useMe();
  const wide = useWide();
  const navigate = useNavigate();
  const state = useAsync(() => portal.pass(), []);
  const [icsErr, setIcsErr] = useState<string>();
  const h1 = useFocusHeading<HTMLHeadingElement>(state.data ? 'pass' : 'loading');
  const hdr = header({ back: '/' });

  // Not open yet: the server answers 200 { state: 'locked', opensOn } (an older server answered 403).
  const lockedData = state.data && state.data.state === 'locked' ? state.data : undefined;
  if (state.error || lockedData) {
    const locked = Boolean(lockedData) || (state.error instanceof ApiError && state.error.status === 403);
    const opens = lockedData?.opensOn ?? me.tasks.find((t) => t.systemKey === 'day1_pass')?.opensAt?.slice(0, 10) ?? addDays(me.tj, -7);
    return (
      <Page header={hdr}>
        {locked ? (
          <section className="closed">
            <span className="closed__icon" aria-hidden="true">
              <Icon name="calendar" size={30} />
            </span>
            <h1 className="display" ref={h1} tabIndex={-1}>
              Your Day-1 pass opens on {fmtShort(opens)}
            </h1>
            <p className="body sub">It will show where to go, when, and who to ask for. We’ll email you the reporting details too.</p>
          </section>
        ) : (
          <ErrorNote error={state.error} onRetry={state.reload} />
        )}
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );
  }
  if (!state.data)
    return (
      <Page header={hdr}>
        <Spinner />
      </Page>
    );

  const pass = state.data;
  const date = pass.date ?? me.tj;
  const name = pass.candidateName ?? me.candidateName;
  const directions = directionsUrl(pass);
  const time = fmtTime(pass.reportingTime);

  const addToCalendar = async () => {
    setIcsErr(undefined);
    try {
      const data = MOCK ? buildIcs(pass, date, me.company.name) : await portal.passIcs();
      downloadBlob(data, 'text/calendar', 'Day 1.ics');
    } catch (e) {
      setIcsErr((e as Error).message);
    }
  };

  const facts: Array<[string, string | undefined]> = [
    ...(wide ? [] : ([['You', name]] as Array<[string, string]>)),
    ...(wide ? [] : ([['Team', pass.department]] as Array<[string, string | undefined]>)),
    ['Date', fmtWeekday(date)],
    ['Reporting time', time],
    ['Where', pass.place ?? (pass.meetingLink ? 'Online' : undefined)],
    ['Ask for', pass.askFor ? `${pass.askFor.name}${pass.askFor.phone ? ` · ${pass.askFor.phone}` : ''}` : pass.hrContact?.name],
    ...(wide
      ? ([
          ['Your manager', pass.managerName],
          ['Buddy', pass.buddyName],
        ] as Array<[string, string | undefined]>)
      : ([['Bring', pass.bring?.join(', ')]] as Array<[string, string | undefined]>)),
  ];

  const card = (
    <section className="pass-card rise" aria-label="Day-1 pass">
      <div className="pass-card__head">
        <span className="eyebrow eyebrow--light">Day-1 pass</span>
        <ClientLogo company={me.company} tone="dark" />
      </div>
      {wide && (
        <div className="pass-card__who">
          <p className="display">{name}</p>
          <p className="body">{[pass.designation, pass.department].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      <dl className="pass-card__facts">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="pass-fact">
              <dt className="eyebrow">{k}</dt>
              <dd className="body-strong">{v}</dd>
            </div>
          ))}
      </dl>
      {pass.meetingLink && (
        <a className="text-link pass-card__link" href={pass.meetingLink} target="_blank" rel="noreferrer">
          Join the meeting <Icon name="external" size={16} />
        </a>
      )}
      <div className="pass-card__actions">
        <button type="button" className="pill-btn pill-btn--white" onClick={addToCalendar}>
          <Icon name="calendar" size={18} /> Add to calendar
        </button>
        {directions && (
          <a className={wide ? 'pill-btn pill-btn--white' : 'icon-btn icon-btn--white'} href={directions} target="_blank" rel="noreferrer" aria-label="Get directions">
            <Icon name="pin" size={18} />
            {wide && ' Directions'}
          </a>
        )}
      </div>
    </section>
  );

  const agenda = pass.agenda && pass.agenda.length > 0 && (
    <section className="card agenda" aria-labelledby="agenda-title">
      <h2 id="agenda-title" className="h1">
        Your Day 1
      </h2>
      <ol className="agenda__list">
        {pass.agenda.map((a) => (
          <li key={`${a.time}-${a.title}`} className="agenda__item">
            <span className="label agenda__time">{fmtTime(a.time) ?? a.time}</span>
            <span>
              <span className="body-strong">{a.title}</span>
              {a.with && <span className="label">{a.with}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );

  const bring = wide && pass.bring && pass.bring.length > 0 && (
    <section className="card">
      <p className="eyebrow">Bring with you</p>
      <p className="body">{pass.bring.join(', ')}</p>
    </section>
  );

  const head = (
    <>
      <h1 className="display" ref={h1} tabIndex={-1}>
        Your Day-1 pass
      </h1>
      <p className="body sub">Show this at reception when you arrive</p>
    </>
  );

  if (wide)
    return (
      <Page header={header()} layout="wide">
        <BackLink to="/" />
        {head}
        <div className="two-col two-col--even">
          {card}
          <div className="stack">
            {agenda}
            {bring}
          </div>
        </div>
        {icsErr && (
          <p className="field__error" role="alert">
            {icsErr}
          </p>
        )}
      </Page>
    );
  return (
    <Page header={hdr}>
      {head}
      {card}
      {icsErr && (
        <p className="field__error" role="alert">
          {icsErr}
        </p>
      )}
      {agenda}
    </Page>
  );
}
