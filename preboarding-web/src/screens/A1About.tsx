// Web · About the company (18 Nov design, "Web · 8 About the company" and the five
// "Web · Story ·" screens): highlights as story rings, the first person they'll meet,
// their team, policies to read, and culture cards. A story opens full screen; opening
// one marks its Meet-us item seen (all seen completes the Meet us task).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { portal } from '../api/portal';
import type { JoiningDetails, MeetItem } from '../api/types';
import { A1Icon, A1Loading, A1Logo, Breadcrumb } from '../components/A1';
import { firstName, fmtShort, fmtTime, fmtWeekday, initials } from '../lib/format';
import { mailto } from '../lib/links';
import { useMe } from '../session';
import { WebPage } from './A1Shell';
import { FigPlay } from '../components/fig/icons';
import { G4StoryChevron } from '../components/fig/icons/g4-StoryChevron';
import { G4StoryClose } from '../components/fig/icons/g4-StoryClose';
import { G4StoryDirections } from '../components/fig/icons/g4-StoryDirections';
import { G4StoryHeart } from '../components/fig/icons/g4-StoryHeart';
import pin3d from '../components/fig/icons/g4-pin-3d.png';
import '../styles/fig-g4.css';

type StoryKey = 'welcome' | 'manager' | 'team' | 'day1' | 'policies' | 'role';
const SEEN_ITEM: Partial<Record<StoryKey, string>> = { welcome: 'company_video', manager: 'manager_note', policies: 'policies', role: 'role' };
const FACE_TONES = [['#E8F7EE', '#15803D'], ['#FEF4E2', '#B45309'], ['#EAF1FE', '#2563EB'], ['#FDECEA', '#D92D20']];

function Face({ name, photo, className, tone = 0 }: { name: string; photo?: string; className: string; tone?: number }) {
  const [bad, setBad] = useState(false);
  const [bg, fg] = FACE_TONES[tone % FACE_TONES.length];
  return <span className={className} style={{ background: bg, color: fg }} aria-hidden="true">{photo && !bad ? <img src={photo} alt="" onError={() => setBad(true)} /> : initials(name)}</span>;
}

/** The policies item's lines ("Title: summary"), as reads. */
const policiesOf = (item?: MeetItem) => (item?.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const at = l.indexOf(': '); return at > 0 ? { title: l.slice(0, at), summary: l.slice(at + 2) } : { title: l, summary: '' }; });

export function A1About() {
  const { me } = useMe();
  const [items, setItems] = useState<MeetItem[]>();
  const [j, setJ] = useState<JoiningDetails>();
  const [open, setOpen] = useState<StoryKey | null>(null);
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
  const stories = useMemo(() => {
    const out: StoryKey[] = [];
    if (managerName) out.push('manager');
    if (managerName || j?.buddy) out.push('team');
    out.push('day1');
    if (policies.length) out.push('policies');
    out.push('welcome');
    if (role) out.push('role');
    return out;
  }, [managerName, j?.buddy, policies.length, role]);

  const markSeen = useCallback((k: StoryKey) => {
    const id = SEEN_ITEM[k];
    const item = id ? items?.find((i) => i.id === id) : undefined;
    if (item && !item.seen) portal.meetSeen(item.id).then(() => setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, seen: true } : i))), () => undefined);
  }, [items]);
  const show = (k: StoryKey) => { setOpen(k); markSeen(k); };
  const seenStory = (k: StoryKey) => { const id = SEEN_ITEM[k]; return id ? Boolean(byId(id)?.seen) : false; };

  const ring = (k: StoryKey, label: string, face: React.ReactNode) => (
    <button key={k} type="button" className={`a1-story-btn${seenStory(k) ? ' a1-story-btn--seen' : ''}`} onClick={() => show(k)}>
      <span className="a1-story-btn__ring">{face}</span><span>{label}</span>
    </button>
  );
  const iconFace = (name: Parameters<typeof A1Icon>[0]['name'], bg: string, fg: string) => <span className="a1-story-btn__face" style={{ background: bg, color: fg }}><A1Icon name={name} size={26} /></span>;
  const team = [
    ...(managerName ? [{ name: managerName, sub: 'Manager', photo: note?.authorPhotoUrl, buddy: false }] : []),
    ...(j?.buddy ? [{ name: j.buddy.name, sub: j.buddy.designation ?? '', photo: undefined, buddy: true }] : []),
  ];

  return (
    <WebPage>
      <div style={{ background: '#fff' }}><Breadcrumb title="About the company" /></div>
      {!items ? <A1Loading /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 32 }}>
          <nav aria-label="Highlights" className="a1-stories">
            <div className="a1-stories__row">
              {stories.map((k) => k === 'manager' ? ring(k, firstName(managerName ?? 'Manager'), <Face name={managerName ?? ''} photo={note?.authorPhotoUrl} className="a1-story-btn__face" />)
                : k === 'team' ? ring(k, 'Team', iconFace('team', '#EAF1FE', '#2563EB'))
                  : k === 'day1' ? ring(k, 'Day 1', iconFace('pin', '#FEF4E2', '#B45309'))
                    : k === 'policies' ? ring(k, 'Policies', iconFace('doc', '#FDECEA', '#D92D20'))
                      : k === 'welcome' ? ring(k, 'Culture', <span className="a1-story-btn__face" style={{ background: '#0571A6', color: '#fff' }}><A1Icon name="play" size={24} /></span>)
                        : ring(k, 'Your role', iconFace('badge', '#EFEFF2', '#4A4E5A')))}
            </div>
          </nav>

          {managerName && (
            <section style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 className="a1-section-h">The first person you’ll meet</h2>
              <div className="a1-meet">
                <div className="a1-row" style={{ gap: 16 }}>
                  <Face name={managerName} photo={note?.authorPhotoUrl} className="a1-meet__face" />
                  <span className="a1-stack" style={{ gap: 4 }}><span style={{ fontSize: 18, lineHeight: '24px', fontWeight: 600 }}>{managerName}</span><span className="a1-intro">{[j?.manager?.designation ?? note?.authorRole, 'your manager'].filter(Boolean).join(' · ')}</span></span>
                </div>
                <span className="a1-row" style={{ gap: 8, fontSize: 14, lineHeight: '20px' }}><span style={{ color: 'var(--a1-green)', display: 'flex' }}><A1Icon name="pin" size={18} /></span>{j?.place ? `Meets you at ${j.place}` : 'Meets you on your first day'}</span>
                {note && <button type="button" className="a1-meet__btn" onClick={() => show('manager')}><A1Icon name={note.videoUrl ? 'play' : 'mail'} size={18} />{note.videoUrl ? `Watch ${firstName(managerName)}’s hello` : `Read ${firstName(managerName)}’s note`}</button>}
              </div>
            </section>
          )}

          {team.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 className="a1-section-h" style={{ padding: '0 16px' }}>Your team{j?.department ? `, ${j.department}` : ''}</h2>
              <div className="a1-hscroll"><div className="a1-hscroll__row">
                {team.map((p, n) => (
                  <span key={p.name} className="a1-person">
                    <Face name={p.name} photo={p.photo} className="a1-person__face" tone={n} />
                    <span className="a1-strong">{firstName(p.name)}</span>
                    {p.buddy ? <span className="a1-chip a1-chip--green">Your buddy</span> : <span className="a1-small">{p.sub}</span>}
                  </span>
                ))}
                {me.batch.count > 0 && (
                  <span className="a1-person"><span className="a1-person__face" style={{ background: '#EFEFF2', color: '#4A4E5A' }}>+{me.batch.count}</span><span className="a1-strong">Joining with you</span><span className="a1-small">{me.batch.names.slice(0, 2).map(firstName).join(', ')}</span></span>
                )}
              </div></div>
            </section>
          )}

          {policies.length > 0 && (
            <section style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 className="a1-section-h">Policies to read</h2>
              <ul className="a1-list">
                {policies.map((p, n) => {
                  const [bg, fg] = [['#FDECEA', '#D92D20'], ['#E8F7EE', '#15803D'], ['#EAF1FE', '#2563EB']][n % 3];
                  return (
                    <li key={p.title}><button type="button" className="a1-policy" onClick={() => show('policies')}>
                      <span className="a1-policy__icon" style={{ background: bg, color: fg }}><A1Icon name="doc" size={22} /></span>
                      <span className="a1-stack"><span className="a1-strong">{p.title}</span>{p.summary && <span className="a1-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</span>}</span>
                      <A1Icon name="chevron" size={20} />
                    </button></li>
                  );
                })}
              </ul>
              <span className="a1-small">You’ll confirm these in your first week.</span>
            </section>
          )}

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="a1-section-h" style={{ padding: '0 16px' }}>Culture and values</h2>
            <div className="a1-hscroll"><div className="a1-hscroll__row">
              <button type="button" className="a1-culture" style={{ background: '#0571A6' }} onClick={() => show('welcome')}><span className="a1-culture__play"><A1Icon name="play" size={20} /></span><span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600 }}>{video?.title ?? `Welcome to ${me.company.name}`}</span></button>
              {role && <button type="button" className="a1-culture" style={{ background: '#15803D' }} onClick={() => show('role')}><span className="a1-culture__play"><A1Icon name="badge" size={20} /></span><span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600 }}>{role.title}</span></button>}
              <button type="button" className="a1-culture" style={{ background: '#B45309' }} onClick={() => show('day1')}><span className="a1-culture__play"><A1Icon name="pin" size={20} /></span><span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600 }}>Your first day</span></button>
            </div></div>
          </section>
        </div>
      )}
      {open && (
        <Story order={stories} at={open} onMove={show} onClose={() => setOpen(null)}
          company={me.company} candidate={me.candidateName} hr={me.hrContact.email} tj={me.tj} j={j} note={note} managerName={managerName} video={video} role={role} policies={policies} />
      )}
    </WebPage>
  );
}

// The story viewer as in Figma ("Web · Story · Culture / Your manager / Your team / Day 1 /
// Policies", 4967:95263–95442): a light page per story (Culture on the brand colour), green
// progress, the company's HR at the top, the story in the middle, a reply pill and a like.
const THEME: Record<StoryKey, { bg: string; logo: string; dark?: boolean; pb: number }> = {
  welcome: { bg: '#0571A6', logo: '#0571A6', dark: true, pb: 218.5 },
  manager: { bg: '#E8F7EE', logo: '#15803D', pb: 204.5 },
  team: { bg: '#FEF4E2', logo: '#0571A6', pb: 228.5 },
  day1: { bg: '#EAF1FE', logo: '#B45309', pb: 208.5 },
  policies: { bg: '#E8F2F8', logo: '#0571A6', pb: 186.5 },
  role: { bg: '#F7F7F9', logo: '#0571A6', pb: 204.5 },
};
const TEAM_TONES = ['#0571A6', '#15803D', '#B45309', '#B45309'];
const REPLY: Record<StoryKey, (manager?: string) => string> = {
  welcome: () => 'Say hi to HR', manager: (m) => (m ? `Reply to ${firstName(m)}` : 'Ask HR a question'), team: () => 'Say hi to the team',
  day1: () => 'Ask about the office', policies: () => 'Ask HR a question', role: () => 'Ask HR a question',
};

function Story({ order, at, onMove, onClose, company, candidate, hr, tj, j, note, managerName, video, role, policies }: {
  order: StoryKey[]; at: StoryKey; onMove: (k: StoryKey) => void; onClose: () => void; company: { name: string; logoUrl?: string }; candidate: string; hr: string; tj: string;
  j?: JoiningDetails; note?: MeetItem; managerName?: string; video?: MeetItem; role?: MeetItem; policies: Array<{ title: string; summary: string }>;
}) {
  const i = Math.max(0, order.indexOf(at));
  const t = THEME[at];
  // Likes stay on this page (the API has no story likes yet).
  const [liked, setLiked] = useState<Partial<Record<StoryKey, boolean>>>({});
  const [playing, setPlaying] = useState(false);
  const [openRead, setOpenRead] = useState<string | null>(null);
  useEffect(() => { setPlaying(false); setOpenRead(null); }, [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight' && i < order.length - 1) onMove(order[i + 1]); if (e.key === 'ArrowLeft' && i > 0) onMove(order[i - 1]); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [i, order, onMove, onClose]);
  const time = fmtTime(j?.reportingTime);
  const directions = j?.mapLink ?? (j?.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.place)}` : undefined);
  const team = [managerName, j?.buddy?.name].filter((n): n is string => Boolean(n));
  const managerLine = note?.text ?? [j?.manager?.designation ?? note?.authorRole, `${firstName(managerName ?? '')} will meet you ${j?.place ? `at ${j.place}` : 'on your first day'}.`].filter(Boolean).join('. ');
  const day = j?.date ?? tj;
  return (
    <div className="a1-story" role="dialog" aria-modal="true" aria-label={`Story ${i + 1} of ${order.length}`}>
      <div className={`a1-story__panel g4-story${t.dark ? ' g4-story--dark' : ''}`} style={{ background: t.bg }}>
        <div className="g4-story__top">
          <div className="g4-story__segs">
            {order.map((k, n) => <span key={k} className={n <= i ? 'is-done' : undefined} />)}
          </div>
          <div className="g4-story__who">
            <span className="g4-story__logo" style={{ color: t.logo }}>{company.logoUrl ? <A1Logo company={company} className="g4-story__logo-img" /> : initials(company.name).slice(0, 2)}</span>
            <span className="g4-story__from"><span className="g4-story__name">{company.name} HR</span><span className="g4-story__when">{at === 'welcome' ? 'Pinned by HR' : 'Before you join'}</span></span>
            <button type="button" className="g4-story__close" aria-label="Close" onClick={onClose}><G4StoryClose /></button>
          </div>
        </div>
        <div className="a1-story__main g4-story__main" style={{ paddingBottom: t.pb }}>
          {i > 0 && <button type="button" className="a1-story__tap" style={{ left: 0 }} aria-label="Previous story" onClick={() => onMove(order[i - 1])} />}
          {i < order.length - 1 && <button type="button" className="a1-story__tap" style={{ right: 0 }} aria-label="Next story" onClick={() => onMove(order[i + 1])} />}
          <div className="a1-story__content g4-story__content">
            {at === 'welcome' && (
              <div className="g4-story__stack" style={{ gap: 28 }}>
                <div className="g4-story__stack" style={{ gap: 20 }}>
                  <h2 className="g4-story__title g4-story__title--lines"><span>Welcome to</span><span>{company.name}</span><span>{firstName(candidate)}!</span></h2>
                  <p className="g4-story__line">{video?.text ?? video?.subtitle ?? 'We’re glad you’re joining us. Everything you need before your first day is in this portal.'}</p>
                </div>
                {video?.videoUrl && (playing
                  ? <video className="a1-story__video" src={video.videoUrl} controls autoPlay playsInline />
                  : <button type="button" className="g4-story__cta" onClick={() => setPlaying(true)}><FigPlay size={20} />Watch the welcome video</button>)}
              </div>
            )}
            {at === 'manager' && managerName && (
              <div className="g4-story__stack" style={{ gap: 16 }}>
                <Face name={managerName} photo={note?.authorPhotoUrl} className="g4-story__face" />
                <h2 className="g4-story__title">Meet {managerName}</h2>
                <span className="g4-story__pill">Your manager</span>
                <p className="g4-story__line">{managerLine}</p>
                {note?.videoUrl && (playing
                  ? <video className="a1-story__video" src={note.videoUrl} controls autoPlay playsInline />
                  : <button type="button" className="g4-story__cta" onClick={() => setPlaying(true)}><FigPlay size={20} />Watch {firstName(managerName)}’s hello</button>)}
              </div>
            )}
            {at === 'team' && (
              <div className="g4-story__stack" style={{ gap: 20 }}>
                <span className="g4-story__faces">
                  {team.map((n, k) => <span key={n} className="g4-story__teamface" style={{ color: TEAM_TONES[k % TEAM_TONES.length], background: k ? '#F7F7F9' : '#fff' }}>{initials(n)}</span>)}
                </span>
                <h2 className="g4-story__title g4-story__title--lines"><span>Your team</span>{j?.department && <span>{j.department}</span>}</h2>
                <div className="g4-story__stack" style={{ gap: 8 }}>
                  <p className="g4-story__line">{team.map(firstName).join(' · ')}</p>
                  <p className="g4-story__line g4-story__line--sm">and you, from {fmtShort(day)}</p>
                </div>
              </div>
            )}
            {at === 'day1' && (
              <div className="g4-story__stack" style={{ gap: 24 }}>
                <div className="g4-story__stack" style={{ gap: 16 }}>
                  <span className="g4-story__pin"><img src={pin3d} alt="" width={64} height={64} /></span>
                  <h2 className="g4-story__title">{j?.place ?? fmtWeekday(day)}</h2>
                  <p className="g4-story__line">{[fmtWeekday(day), time ? `see you at ${time}` : ''].filter(Boolean).join(' · ')}</p>
                </div>
                {directions && <a className="g4-story__cta g4-story__cta--dir" href={directions} target="_blank" rel="noreferrer"><G4StoryDirections />Get directions</a>}
              </div>
            )}
            {at === 'policies' && (
              <div className="g4-story__stack" style={{ gap: 20 }}>
                <h2 className="g4-story__title">{policies.length === 1 ? '1 quick read' : `${policies.length} quick reads`} before you join</h2>
                <div className="g4-story__reads">
                  {policies.map((p) => (
                    <button key={p.title} type="button" className="g4-story__read" aria-expanded={openRead === p.title} onClick={() => setOpenRead((cur) => (cur === p.title ? null : p.title))}>
                      <span className="g4-story__read-text"><span className="g4-story__read-title">{p.title}</span>{p.summary && <span className={`g4-story__read-sub${openRead === p.title ? ' is-open' : ''}`}>{p.summary}</span>}</span>
                      <span className="g4-story__read-go"><G4StoryChevron /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {at === 'role' && role && (
              <div className="g4-story__stack" style={{ gap: 16 }}>
                <h2 className="g4-story__title">{role.title}</h2>
                {role.subtitle && <span className="g4-story__pill">{role.subtitle}</span>}
                <p className="g4-story__line">{role.text}</p>
              </div>
            )}
          </div>
        </div>
        <div className="g4-story__foot">
          <a className="g4-story__reply" href={mailto(hr, 'Question before I join')}>{REPLY[at](managerName)}</a>
          <button type="button" className={`g4-story__like${liked[at] ? ' is-on' : ''}`} aria-label="Like" aria-pressed={Boolean(liked[at])} onClick={() => setLiked((cur) => ({ ...cur, [at]: !cur[at] }))}><G4StoryHeart /></button>
        </div>
      </div>
    </div>
  );
}
