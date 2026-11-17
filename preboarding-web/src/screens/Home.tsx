import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portal } from '../api/portal';
import type { PathKey, PortalHome, TaskView } from '../api/types';
import { Page } from '../components/Shell';
import { Plant } from '../components/Plant';
import { Icon } from '../components/Icon';
import { AskHrSheet, CopyButton, Eyebrow, Ring } from '../components/ui';
import { addDays, daysBetween, firstName, fmtShort, fmtTime, fmtWeekday, initials, today } from '../lib/format';
import { useFocusHeading, useWide } from '../lib/hooks';
import { APP_LINK } from '../lib/links';
import { homeTiles, passOpensOn, type TileIcon } from '../lib/tiles';
import { useMe } from '../session';
import { ClosedScreen } from './Closed';

export const PATH_ROUTE: Record<PathKey, string> = {
  offer: '/offer',
  docs: '/documents',
  about: '/about',
  meet: '/meet',
  letter: '/letters',
  pass: '/pass',
};

const PATH_TASK: Record<PathKey, string> = {
  offer: 'accept_offer',
  docs: 'upload_documents',
  about: 'about_you',
  meet: 'meet_us',
  letter: 'sign_letters',
  pass: 'day1_pass',
};

function taskFor(me: PortalHome, key: PathKey): TaskView | undefined {
  return me.tasks.find((t) => t.systemKey === PATH_TASK[key]);
}

const stateOf = (me: PortalHome, key: PathKey) => me.path.find((p) => p.key === key)?.state;

function dueLine(me: PortalHome, key: PathKey, state: string): string {
  const t = taskFor(me, key);
  if (key === 'offer' && state === 'done') return 'Accepted';
  if (key === 'pass') return fmtWeekday(me.tj);
  // Documents approved, letters not uploaded yet: HR is making them, not waiting on the candidate's documents.
  if (key === 'letter' && state === 'locked') return stateOf(me, 'docs') === 'done' ? 'HR is preparing' : 'After docs';
  if (state === 'done') return 'Done';
  if (t?.dueAt) return `Due ${fmtShort(t.dueAt)}`;
  if (t?.dueLabel) return t.dueLabel;
  return 'Any time';
}

function TileIconView({ icon }: { icon: TileIcon }) {
  if ('count' in icon) return <>{icon.count}</>;
  if ('icon' in icon) return <Icon name={icon.icon} />;
  return <>{icon.text}</>;
}

/** P7 / P7b / P11 / P13 / P15 · W7 / W15 · Home. */
export function Home() {
  const { me, reload, header, subject } = useMe();
  const wide = useWide();
  const [askOpen, setAskOpen] = useState(false);
  const [meetCount, setMeetCount] = useState<number>();
  const h1 = useFocusHeading<HTMLHeadingElement>('home');

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (me.view === 'joined' || me.view === 'closed') return;
    portal.meet().then((r) => setMeetCount(r.items.length), () => undefined);
  }, [me.view]);

  if (me.view === 'closed') {
    const state = me.status === 'not_joining' ? 'not_joining' : me.status === 'declined' ? 'declined' : me.status === 'expired' ? 'expired' : 'moved_to_app';
    return <ClosedScreen state={state} company={me.company} hr={me.hrContact} />;
  }

  const first = firstName(me.candidateName);
  const joined = me.view === 'joined';
  const pathDone = me.path.filter((p) => p.state === 'done').length;
  const time = fmtTime(me.reportingTime);
  const dayLabel = `${fmtWeekday(me.tj)}${time ? ` · ${time}` : ''}`;
  const days = me.daysToGo;

  // hero per view (copy from 3Rb §5 · 7)
  const hero: { eyebrow: string; title: string; sub?: string; cta: string; to: string; external?: boolean } = (() => {
    switch (me.view) {
      case 'offer_updated':
        return { eyebrow: 'HR updated your offer', title: 'Please review the changes', sub: 'Accept the new offer to continue', cta: 'See changes', to: '/offer' };
      case 'letter_ready':
        return { eyebrow: 'Documents approved', title: 'Sign your appointment letter', sub: 'And your NDA · 3 min', cta: 'Read and sign', to: '/letters' };
      case 'pass_unlocked':
        return { eyebrow: dayLabel, title: days === 1 ? '1 day to go' : days <= 0 ? 'Day 1 is today' : `${days} days to go`, cta: 'Open Day-1 pass', to: '/pass' };
      case 'joined': {
        const n = Math.min(7, Math.max(1, daysBetween(me.tj, today()) + 1));
        return {
          eyebrow: `Day ${n} of week 1`,
          title: 'You’ve sprouted',
          sub: wide ? 'Pre-boarding is done. The rest of your onboarding is in the app.' : 'Pre-boarding is done',
          cta: 'Open the app',
          to: APP_LINK,
          external: true,
        };
      }
      case 'tasks_open':
      default:
        return {
          eyebrow: dayLabel,
          title: days === 1 ? 'Day 1 is tomorrow' : days <= 0 ? 'Day 1 is today' : `Day 1 is in ${days} days`,
          sub: 'Your seed is planted',
          cta: `Day-1 pass on ${fmtShort(passOpensOn(me))}`,
          to: '/pass',
        };
    }
  })();

  // week-1 rows on the joined view
  const week1 = me.tasks.filter((t) => t.phase === 'first_week' && t.status !== 'cancelled' && t.status !== 'skipped').slice(0, 4);
  const week1Done = week1.filter((t) => t.status === 'done').length;
  const firstOpen = week1.findIndex((t) => t.status !== 'done');

  // up next
  const upTask = me.upNext ? taskFor(me, me.upNext.key) : undefined;
  const upNext = joined
    ? { title: 'Continue in the app', meta: 'Sign in with your work email and a one-time code', to: APP_LINK, external: true, done: week1Done, total: week1.length || 4 }
    : me.upNext
      ? {
          title: me.upNext.title,
          meta: me.upNext.helper ?? upTask?.helper ?? (me.upNext.due ? `Due ${fmtShort(me.upNext.due)}` : ''),
          to: PATH_ROUTE[me.upNext.key],
          external: false,
          done: pathDone,
          total: me.path.length,
        }
      : undefined;

  const tiles = homeTiles(me, meetCount);

  const heroCard = (
    <section className={`hero-card rise ${wide ? 'hero-card--web' : ''}`} aria-labelledby="hero-title">
      <div className="hero-card__text">
        <Eyebrow>{hero.eyebrow}</Eyebrow>
        <h2 id="hero-title" className={wide ? 'display-xl' : 'display'}>
          {hero.title}
        </h2>
        {hero.sub && <p className="body">{hero.sub}</p>}
        {hero.external ? (
          <a className="pill-btn pill-btn--brand" href={hero.to}>
            {hero.cta}
          </a>
        ) : (
          <Link className="pill-btn pill-btn--brand" to={hero.to}>
            {hero.cta}
          </Link>
        )}
      </div>
      <Plant stage={me.plant.stage} water={me.plant.water} droop={me.plant.droop} size={wide ? 186 : 136} />
    </section>
  );

  const pathStrip = !joined && (
    <section className="path" aria-labelledby="path-title">
      <div className="section-head">
        <h2 id="path-title" className="h1">
          Your path
        </h2>
        <span className="label">
          {pathDone} of {me.path.length} done
        </span>
      </div>
      <ol className="path__nodes">
        {me.path.map((p, i) => {
          const node = (
            <>
              <span className={`node node--${p.state} ${p.state === 'current' ? 'pulse' : ''} ${p.state === 'done' ? 'pop' : ''}`} aria-hidden="true">
                {p.state === 'done' ? <Icon name="check" size={18} /> : p.state === 'locked' ? <span className="node__dot" /> : i + 1}
              </span>
              <span className="path__label">{p.label}</span>
              {wide && <span className="label path__due">{dueLine(me, p.key, p.state)}</span>}
              <span className="sr-only">
                {p.state === 'done' ? ', done' : p.state === 'current' ? ', up now' : p.state === 'locked' ? ', locked' : ', to do'}
              </span>
            </>
          );
          return (
            <li key={p.key} className={`path__item path__item--${p.state}`}>
              {p.state === 'locked' ? <span className="path__link">{node}</span> : <Link to={PATH_ROUTE[p.key]} className="path__link">{node}</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );

  const upNextCard = upNext && (
    <UpNextCard title={upNext.title} meta={upNext.meta} to={upNext.to} external={upNext.external} done={upNext.done} total={upNext.total} />
  );

  const tilesRow = !joined && (
    <div className="tiles">
      {tiles.map((t) => {
        const inner = (
          <>
            <span className="tile__icon" aria-hidden="true">
              <TileIconView icon={t.icon} />
            </span>
            <span className="body-strong">{t.title}</span>
            <span className="label">{t.sub}</span>
          </>
        );
        return t.askHr ? (
          <button key={t.key} type="button" className="tile" onClick={() => setAskOpen(true)}>
            {inner}
          </button>
        ) : (
          <Link key={t.key} to={t.to!} className="tile">
            {inner}
          </Link>
        );
      })}
    </div>
  );

  const batch = !joined && (
    <div className="batch">
      {me.batch.count > 0 && (
        <>
          <span className="batch__avatars" aria-hidden="true">
            {me.batch.names.slice(0, 2).map((n) => (
              <span key={n} className="avatar avatar--sm">
                {initials(n).slice(0, 1)}
              </span>
            ))}
            {me.batch.count > 2 && <span className="avatar avatar--sm avatar--more">+{me.batch.count - 2}</span>}
          </span>
          <span className="body-strong">
            {me.batch.count === 1 ? '1 person joins with you' : `${me.batch.count} people join with you`}
          </span>
        </>
      )}
      {me.pendingDateRequest ? (
        <span className="label batch__link" role="status">
          New date asked: {fmtShort(me.pendingDateRequest.requestedTj)} · HR will reply soon
        </span>
      ) : (
        <Link to="/date-request" className="text-link batch__link">
          Can’t join on {fmtShort(me.tj)}?
        </Link>
      )}
    </div>
  );

  const joinedBlock = joined && (
    <>
      {me.workEmail && (
        <section className="card work-email">
          <Eyebrow>Your work email</Eyebrow>
          <div className="work-email__row">
            <span>
              <span className="body-strong work-email__addr">{me.workEmail}</span>
              <span className="label">Set up by HR · use it to sign in to the app</span>
            </span>
            <CopyButton text={me.workEmail} />
          </div>
        </section>
      )}
      {week1.length > 0 && (
        <section className="card week1" aria-labelledby="week1-title">
          <div className="section-head">
            <h2 id="week1-title" className="h1">
              Week 1
            </h2>
            <span className="label">Open until {fmtWeekday(me.portalOpenUntil ?? addDays(me.tj, 7))}</span>
          </div>
          <ul className="task-rows">
            {week1.map((t, i) => (
              <li key={t.id} className="task-row">
                <span className="task-row__icon" aria-hidden="true">
                  <Icon name="doc" size={18} />
                </span>
                <span className="task-row__text">
                  <span className="body-strong">{t.title}</span>
                  <span className="label">{t.helper ?? t.dueLabel ?? (t.surface === 'app' ? 'In the app' : '')}</span>
                </span>
                <span className={`tick tick--${t.status === 'done' ? 'done' : i === firstOpen ? 'current' : 'todo'}`} aria-label={t.status === 'done' ? 'Done' : i === firstOpen ? 'Up now' : 'To do'} role="img">
                  {t.status === 'done' && <Icon name="check" size={14} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  const greeting = (
    <div className="greeting">
      <h1 className="display" ref={h1} tabIndex={-1}>
        Hello, {first}
      </h1>
      <p className="body sub">
        {me.designation ? `${me.designation} · ` : ''}joining {fmtWeekday(me.tj)}
      </p>
    </div>
  );

  const ask = <AskHrSheet open={askOpen} onClose={() => setAskOpen(false)} name={me.hrContact.name} email={me.hrContact.email} subject={subject} />;

  if (wide)
    return (
      <Page header={header()} layout="wide">
        <div className="home-web__top">
          {greeting}
          {batch}
        </div>
        {heroCard}
        {pathStrip}
        <div className={`home-web__row ${joined ? 'home-web__row--joined' : ''}`}>
          {upNextCard}
          {tilesRow}
          {joined && (
            <button type="button" className="tile" onClick={() => setAskOpen(true)}>
              <span className="tile__icon" aria-hidden="true">
                @
              </span>
              <span className="body-strong">Ask HR</span>
              <span className="label">Send an email</span>
            </button>
          )}
        </div>
        {joinedBlock}
        {ask}
      </Page>
    );

  return (
    <Page header={header()} layout="narrow">
      {greeting}
      {heroCard}
      {pathStrip}
      {upNextCard}
      {joinedBlock}
      {tilesRow}
      {batch}
      {ask}
    </Page>
  );
}

function UpNextCard({ title, meta, to, external, done, total }: { title: string; meta: string; to: string; external: boolean; done: number; total: number }) {
  const body = (
    <>
      <span className="up-next__text">
        <span className="eyebrow eyebrow--light">Up next</span>
        <span className="up-next__title">{title}</span>
        {meta && <span className="up-next__meta">{meta}</span>}
      </span>
      <Ring done={done} total={total} light />
    </>
  );
  return external ? (
    <a className="up-next" href={to}>
      {body}
    </a>
  ) : (
    <Link className="up-next" to={to}>
      {body}
    </Link>
  );
}
