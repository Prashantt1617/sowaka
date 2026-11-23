// About the company (Figma "App · 7 About the company", 4967:92990; the stories are G2's): highlights as story rings, the first person they'll meet,
// their team, policies to read, and culture cards. A story opens full screen; opening
// one marks its Meet-us item seen (all seen completes the Meet us task).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { portal } from '../api/portal';
import type { JoiningDetails, MeetItem } from '../api/types';
import { FigLoading, FigPage, isAppHost } from '../components/fig/FigShell';
import { G3SectionHead, G3WebBottom, G3WebTop } from '../components/fig/G3WebShell';
import { FigRow } from '../components/fig/FigUi';
import { FigCalendar, FigClock, FigFileText, FigIcon3D, FigMessageCircle, FigPass, FigPin, FigPlay, FigShield } from '../components/fig/icons';
import { firstName, initials } from '../lib/format';
import { useMe } from '../session';
import '../styles/fig-g1.css';
import { G2Story, type StoryKey } from '../components/fig/G2Story';
import { G2Policy, type PortalPolicy } from '../components/fig/G2Policy';

// The highlight rings in the App · 7 frame's order (the stories themselves keep G2's order).
const RING_ORDER: StoryKey[] = ['manager', 'team', 'day1', 'policies', 'welcome', 'role'];
const SEEN_ITEM: Partial<Record<StoryKey, string>> = { welcome: 'company_video', manager: 'manager_note', policies: 'policies', role: 'role' };
// Initials colours in the design's order: the manager green, the buddy amber, then brand, amber.
const FACE_TONES = ['var(--color-text-success)', 'var(--color-text-warning)', 'var(--color-text-brand)', 'var(--color-text-warning)'];

function Face({ name, photo, className, tone = 0 }: { name: string; photo?: string; className?: string; tone?: number }) {
  const [bad, setBad] = useState(false);
  return <span className={className} style={{ color: FACE_TONES[tone % FACE_TONES.length] }} aria-hidden="true">{photo && !bad ? <img src={photo} alt="" onError={() => setBad(true)} /> : initials(name)}</span>;
}

/**
 * The company's policies as the app reads them (the server sends them with their text);
 * an older server sent only "Title: summary" lines, read as titles without text.
 */
const policiesOf = (item?: MeetItem): PortalPolicy[] => item?.policies?.length
  ? item.policies
  : (item?.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const at = l.indexOf(': '); return at > 0 ? { key: '', title: l.slice(0, at), summary: l.slice(at + 2), body: '' } : { key: '', title: l, summary: '', body: '' }; });

export function A1About() {
  const { me } = useMe();
  const [items, setItems] = useState<MeetItem[]>();
  const [j, setJ] = useState<JoiningDetails>();
  const [open, setOpen] = useState<StoryKey | null>(null);
  const [reading, setReading] = useState<PortalPolicy | null>(null);
  useEffect(() => {
    portal.meet().then((r) => setItems(r.items), () => setItems([]));
    portal.joining().then(setJ, () => undefined);
  }, []);
  const byId = (id: string) => items?.find((i) => i.id === id);
  const note = byId('manager_note');
  const video = byId('company_video');
  const role = byId('role');
  const policies = policiesOf(byId('policies'));
  const managerName = j?.manager?.name ?? note?.authorName;
  // The template's pre-boarding watch list (videos, pictures, text cards), shown first.
  const watch = useMemo(() => (items ?? []).filter((x) => x.kind === 'watch'), [items]);
  const stories = useMemo(() => {
    // The watch list, then the design's order (App · Story · 1 Culture … 5 Policies), then the role.
    const out: StoryKey[] = [...watch.map((w) => w.id as StoryKey), 'welcome'];
    if (managerName) out.push('manager');
    if (managerName || j?.buddy) out.push('team');
    out.push('day1');
    if (policies.length) out.push('policies');
    if (role) out.push('role');
    return out;
  }, [watch, managerName, j?.buddy, policies.length, role]);

  const markSeen = useCallback((k: StoryKey) => {
    const id = k.startsWith('watch:') ? k : SEEN_ITEM[k as keyof typeof SEEN_ITEM];
    const item = id ? items?.find((i) => i.id === id) : undefined;
    if (item && !item.seen) portal.meetSeen(item.id).then(() => setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, seen: true } : i))), () => undefined);
  }, [items]);
  const show = (k: StoryKey) => { setOpen(k); markSeen(k); };
  /** A policy opens on its own, straight from its row (reading it counts as seeing the policies story). */
  const read = (p: PortalPolicy) => { setReading(p); markSeen('policies'); };
  const seenStory = (k: StoryKey) => { const id = k.startsWith('watch:') ? k : SEEN_ITEM[k as keyof typeof SEEN_ITEM]; return id ? Boolean(byId(id)?.seen) : false; };

  const ring = (k: StoryKey, label: string, face: ReactNode, inner = '') => (
    <button key={k} type="button" className={`g1-hl${seenStory(k) ? ' g1-hl--seen' : ''}`} onClick={() => show(k)}>
      <span className="g1-hl__ring"><span className={`g1-hl__face ${inner}`}>{face}</span></span>
      <span className="fig-label-strong">{label}</span>
    </button>
  );
  const team = [
    ...(managerName ? [{ name: managerName, sub: 'Manager', photo: note?.authorPhotoUrl, buddy: false }] : []),
    ...(j?.buddy ? [{ name: j.buddy.name, sub: j.buddy.designation ?? '', photo: undefined, buddy: true }] : []),
  ];
  const app = isAppHost();
  const POLICY_ICON = [<FigShield key="s" />, <FigCalendar key="c" />, <FigClock key="k" size={22} />];

  return (
    <FigPage>
      <G3WebTop />
      <G3SectionHead title="About the company" flat white />
      <main id="main" className="fig-main">
        {!items ? <FigLoading /> : (
          <div className="g1-about">
            <nav aria-label="Highlights" className="g1-hls">
              <div className="g1-hls__row">
                {watch.map((w) => ring(w.id as StoryKey, w.title.length > 12 ? `${w.title.slice(0, 11)}…` : w.title,
                  w.mediaType === 'image' && w.imageUrl ? <img src={w.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : w.mediaType === 'video' ? <FigPlay /> : <FigFileText />,
                  w.mediaType === 'image' ? '' : 'g1-hl__face--brand'))}
                {RING_ORDER.filter((k) => stories.includes(k)).map((k) => k === 'manager' ? ring(k, firstName(managerName ?? 'Manager'), <Face name={managerName ?? ''} photo={note?.authorPhotoUrl} />, 'g1-hl__face--initials')
                  : k === 'team' ? ring(k, 'Team', <FigIcon3D name="team" size={40} />, 'g1-hl__face--pad')
                    : k === 'day1' ? ring(k, 'Day 1', <FigPin size={26} />, 'g1-hl__face--amber')
                      : k === 'policies' ? ring(k, 'Policies', <FigFileText />, 'g1-hl__face--amber')
                        : k === 'welcome' ? ring(k, 'Culture', <FigPlay />, 'g1-hl__face--brand')
                          : ring(k, 'Your role', <FigPass size={26} />, 'g1-hl__face--grey'))}
              </div>
            </nav>

            {managerName && (
              <section className="g1-about__sec">
                <h2 className="fig-title">The first person you’ll meet</h2>
                <div className={`g1-meet${app ? '' : ' g1-meet--web'}`}>
                  <div className="g1-meet__who">
                    <Face name={managerName} photo={note?.authorPhotoUrl} className="g1-meet__face" />
                    <span className="g1-meet__text">
                      <span className="fig-title">{managerName}</span>
                      <span className="fig-body fig-t2">{[j?.manager?.designation ?? note?.authorRole, 'your manager'].filter(Boolean).join(' · ')}</span>
                    </span>
                  </div>
                  {app && <span className="g1-meet__where"><FigPin size={18} />Meets you at reception on your first day</span>}
                  <button type="button" className="g1-meet__btn" onClick={() => show('manager')}><FigMessageCircle />Say hi to {firstName(managerName)}</button>
                </div>
              </section>
            )}

            {team.length > 0 && (
              <section className="g1-about__sec g1-about__sec--bleed">
                <h2 className="fig-title">Your team</h2>
                <div className="g1-scroll"><div className="g1-scroll__row">
                  {team.map((p, n) => (
                    <span key={p.name} className="g1-person">
                      <Face name={p.name} photo={p.photo} className="g1-person__face" tone={n} />
                      <span className="fig-body-strong">{firstName(p.name)}</span>
                      {p.buddy ? (app ? <span className="g1-person__buddy">Your buddy</span> : <span className="fig-label fig-t3">Your Buddy</span>) : <span className="fig-label fig-t3">{p.sub}</span>}
                    </span>
                  ))}
                  {me.batch.count > 0 && (
                    <span className="g1-person"><span className="g1-person__face" style={{ color: 'var(--color-text-secondary)' }}>+{me.batch.count}</span><span className="fig-body-strong">Joining with you</span><span className="fig-label fig-t3">{me.batch.names.slice(0, 2).map(firstName).join(', ')}</span></span>
                  )}
                </div></div>
              </section>
            )}

            {policies.length > 0 && (
              <section className="g1-about__sec">
                <h2 className="fig-title">Policies to read</h2>
                <ul className="fig-list">
                  {policies.map((p, n) => (
                    <li key={p.title}>
                      <FigRow onClick={() => (p.body ? read(p) : show('policies'))} className="g1-policy"
                        lead={<span className={`g1-policy__icon g1-policy__icon--${n % 3}`}>{POLICY_ICON[n % 3]}</span>}
                        title={p.title} sub={p.summary || undefined} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="g1-about__sec g1-about__sec--bleed">
              <h2 className="fig-title">Culture and values</h2>
              <div className="g1-scroll"><div className="g1-scroll__row">
                <button type="button" className="g1-culture g1-culture--brand" onClick={() => show('welcome')}><span className="g1-culture__play"><FigPlay size={20} /></span><span className="fig-subtitle">{video?.title ?? 'Welcome from HR'}</span></button>
                {role && <button type="button" className="g1-culture g1-culture--green" onClick={() => show('role')}><span className="g1-culture__play"><FigPlay size={20} /></span><span className="fig-subtitle">{role.title}</span></button>}
                <button type="button" className="g1-culture g1-culture--amber" onClick={() => show('day1')}><span className="g1-culture__play"><FigPlay size={20} /></span><span className="fig-subtitle">Your first day</span></button>
              </div></div>
            </section>
          </div>
        )}
      </main>
      <G3WebBottom />
      {open && (
        <G2Story order={stories} at={open} onMove={show} onClose={() => setOpen(null)} watch={watch}
          company={me.company} candidate={me.candidateName} hr={me.hrContact.email} tj={me.tj} j={j} note={note} managerName={managerName} video={video} role={role} policies={policies}
          onOpenPolicy={(p) => { if (p.body) { setOpen(null); read(p); } }} />
      )}
      {reading && <G2Policy policy={reading} onClose={() => setReading(null)} />}
    </FigPage>
  );
}
