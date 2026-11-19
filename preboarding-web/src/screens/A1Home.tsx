// Web · home (18 Nov design, "Web · 3 Home before app access" and "Web · 4 Home once HR
// generates app access"): "Hello, Priya" and four tiles: the offer letter, joining
// details, the employee profile and the company. Once HR has generated app access
// (Mark joined), the install card comes first, with the work email to sign in with,
// and the tiles follow under "Or keep going here". Anything waiting (a letter to
// sign, a document sent back, the Day-1 pass) shows as a line above the tiles.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portal } from '../api/portal';
import type { PortalHome, PortalOfferView, ProfileView } from '../api/types';
import { A1Icon, A1Logo } from '../components/A1';
import { CopyButton } from '../components/ui';
import { firstName, fmtShort, fmtWeekday } from '../lib/format';
import { useFocusHeading } from '../lib/hooks';
import { APP_LINK } from '../lib/links';
import { useMe } from '../session';
import { ClosedScreen } from './Closed';
import { FigHomeHeader, FigPage, FigPowered } from '../components/fig/FigShell';
import { FigProgress } from '../components/fig/FigUi';
import { FigCheck, FigChevronRight, FigIcon3D, FigWavingHand } from '../components/fig/icons';
import '../styles/fig-g1.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "15 Dec 2026" */
export const dayMonthYear = (key: string) => { const [y, m, d] = key.slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

/** What waits on the candidate, most pressing first (the lines above the tiles). */
export function noticesFor(me: PortalHome): Array<{ title: string; to: string; brand?: boolean }> {
  const out: Array<{ title: string; to: string; brand?: boolean }> = [];
  if (me.banner?.kind === 'offer_updated' || me.view === 'offer_updated') out.push({ title: 'HR updated your offer. Please review it', to: '/offer', brand: true });
  if (me.tasks.some((t) => t.status === 'sent_back')) out.push({ title: 'HR sent back a document. See what to fix', to: '/profile', brand: true });
  if (me.view === 'letter_ready') out.push({ title: 'Your appointment letter is ready to sign', to: '/letters', brand: true });
  if (me.view === 'pass_unlocked') out.push({ title: `Your Day-1 pass is ready · ${fmtWeekday(me.tj)}`, to: '/pass' });
  return out;
}

export function A1Home() {
  const { me, reload } = useMe();
  const [profile, setProfile] = useState<ProfileView>();
  const [offer, setOffer] = useState<PortalOfferView>();
  const h1 = useFocusHeading<HTMLHeadingElement>('a1-home');
  useEffect(() => { reload(); }, [reload]);
  const closed = me.view === 'closed';
  useEffect(() => {
    if (closed) return;
    portal.profile().then(setProfile, () => undefined);
    portal.offer({ kind: 'session' }).then(setOffer, () => undefined);
  }, [closed]);

  if (closed) {
    const state = me.status === 'not_joining' ? 'not_joining' : me.status === 'declined' ? 'declined' : me.status === 'expired' ? 'expired' : 'moved_to_app';
    return <ClosedScreen state={state} company={me.company} hr={me.hrContact} />;
  }

  // App access: HR marked them joined and made their work email.
  const access = me.view === 'joined';
  const notices = access ? [] : noticesFor(me);
  const accepted = offer ? ['accepted', 'finalised'].includes(offer.state) : me.path.find((p) => p.key === 'offer')?.state === 'done';
  const offerSub = offer?.sentAt ? `Sent ${fmtShort(offer.sentAt)}` : offer?.acceptedAt ? `Accepted ${fmtShort(offer.acceptedAt)}` : offer?.validTill ? `Reply by ${fmtShort(offer.validTill)}` : 'Your offer from HR';
  const pct = profile && profile.total ? Math.round((profile.done / profile.total) * 100) : 0;

  return (
    <FigPage>
      <FigHomeHeader company={me.company} />
      <main id="main" className="fig-main">
        {access && (
          // App access (HR marked them joined): the install card first. Not in the Figma set; kept from the A1 look.
          <div className="a1" style={{ minHeight: 0, background: 'none' }}>
            <section className="a1-install" aria-label="Install the Sowaka Connect app">
              <div className="a1-row" style={{ gap: 16 }}>
                <A1Logo company={me.company} className="a1-install__mark" />
                <span style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>Sowaka Connect</span>
              </div>
              <ol>
                <li className="step"><b>1</b>Install</li>
                <li aria-hidden="true" style={{ display: 'flex', color: 'rgba(255,255,255,.8)' }}><A1Icon name="chevron" size={18} width={2} /></li>
                <li className="step"><b>2</b>Log in with work email</li>
              </ol>
              {me.workEmail && (
                <div className="a1-install__email">
                  <span className="a1-strong" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{me.workEmail}</span>
                  <CopyButton text={me.workEmail} label="Copy work email" />
                </div>
              )}
              <a className="a1-install__cta" href={APP_LINK}><A1Icon name="download" size={20} width={2} />Install the app</a>
            </section>
          </div>
        )}

        <div className="fig-hello">
          <h1 className="fig-display" ref={h1} tabIndex={-1}>{access ? 'Or keep going here' : `Hello, ${firstName(me.candidateName)}`}</h1>
          {!access && <FigWavingHand />}
        </div>
        {notices.map((n) => (
          <Link key={n.title} to={n.to} className="fig-home-notice"><span>{n.title}</span><FigChevronRight /></Link>
        ))}

        <div className="fig-tiles">
          <div className="fig-tiles__row">
            <Link to="/offer" className="fig-tile fig-tile--tall fig-tile--green">
              <span className="fig-tile__lead">
                <FigIcon3D name="document-approved" size={64} />
                <span className="fig-tile__text"><span className="fig-subtitle">View offer letter</span><span className="fig-label fig-t2">{offerSub}</span></span>
              </span>
              <span className="fig-tile__foot">
                {accepted
                  ? <span className="fig-tile__chip fig-tile__chip--done"><FigCheck />Accepted</span>
                  : <span className="fig-tile__chip fig-tile__chip--wide">Review<FigChevronRight size={18} stroke={1.5} /></span>}
              </span>
            </Link>
            <Link to="/joining" className="fig-tile fig-tile--tall fig-tile--blue">
              <span className="fig-tile__lead">
                <FigIcon3D name="calendar" size={64} />
                <span className="fig-tile__text"><span className="fig-subtitle">Joining details</span><span className="fig-label-strong">{me.tj ? dayMonthYear(me.tj) : 'Date to be set'}</span></span>
              </span>
              <span className="fig-tile__foot"><span className="fig-tile__chip fig-tile__chip--wide">View details<FigChevronRight size={18} stroke={1.5} /></span></span>
            </Link>
          </div>

          <Link to="/profile" className="fig-tile fig-tile--amber" style={{ gap: 16 }}>
            <span className="fig-tile__row">
              <FigIcon3D name="user" size={64} />
              <span className="fig-tile__text"><span className="fig-title">Employee profile</span><span className="fig-body fig-t2">{profile ? `${profile.done} of ${profile.total} sections done` : 'Fill in before you join'}</span></span>
            </span>
            <span className="fig-tile__meter"><b>{pct}% done</b><FigProgress value={pct} white label="Employee profile done" /></span>
          </Link>

          <Link to="/about" className="fig-tile fig-tile--red">
            <span className="fig-tile__row" style={{ gap: 16 }}>
              <FigIcon3D name="team" size={64} />
              <span className="fig-title">About the company</span>
            </span>
            <span className="fig-tile__chip fig-tile__chip--split">View<FigChevronRight size={18} stroke={1.5} /></span>
          </Link>
        </div>
      </main>
      <FigPowered />
    </FigPage>
  );
}
