// Web · About the company (18 Nov design, "Web · 8 About the company" and the five
// "Web · Story ·" screens): highlights as story rings, the first person they'll meet,
// their team, policies to read, and culture cards. A story opens full screen; opening
// one marks its Meet-us item seen (all seen completes the Meet us task).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { portal } from '../api/portal';
import type { JoiningDetails, MeetItem } from '../api/types';
import { A1Icon, A1Loading, A1Logo, Breadcrumb } from '../components/A1';
import { firstName, fmtTime, fmtWeekday, initials } from '../lib/format';
import { mailto } from '../lib/links';
import { useMe } from '../session';
import { WebPage } from './A1Shell';

type StoryKey = 'welcome' | 'manager' | 'team' | 'day1' | 'policies' | 'role';
const WHEN: Record<StoryKey, string> = { welcome: 'Pinned by HR', manager: 'Your manager', team: 'Your team', day1: 'Your first day', policies: 'Quick reads', role: 'Your role' };
const REPLY: Record<StoryKey, (manager?: string) => string> = {
  welcome: () => 'Say hi to HR', manager: (m) => (m ? `Reply to ${m}` : 'Ask HR a question'), team: () => 'Say hi to the team',
  day1: () => 'Ask about your first day', policies: () => 'Ask HR a question', role: () => 'Ask about your role',
};
const LIKED_KEY = 'sowaka.portal.storyLikes';
function readLikes(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem(LIKED_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; } }
const BG: Record<StoryKey, string> = { welcome: '#0571A6', manager: '#15803D', team: '#2563EB', day1: '#B45309', policies: '#045A85', role: '#2E3139' };
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
                {j?.manager?.email
                  ? <a className="a1-meet__btn" href={mailto(j.manager.email, `Hello from ${firstName(me.candidateName)}`)}><A1Icon name="mail" size={18} />Say hi to {firstName(managerName)}</a>
                  : note && <button type="button" className="a1-meet__btn" onClick={() => show('manager')}><A1Icon name={note.videoUrl ? 'play' : 'mail'} size={18} />{note.videoUrl ? `Watch ${firstName(managerName)}’s hello` : `Read ${firstName(managerName)}’s note`}</button>}
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

function Story({ order, at, onMove, onClose, company, candidate, hr, tj, j, note, managerName, video, role, policies }: {
  order: StoryKey[]; at: StoryKey; onMove: (k: StoryKey) => void; onClose: () => void; company: { name: string; logoUrl?: string }; candidate: string; hr: string; tj: string;
  j?: JoiningDetails; note?: MeetItem; managerName?: string; video?: MeetItem; role?: MeetItem; policies: Array<{ title: string; summary: string }>;
}) {
  const i = Math.max(0, order.indexOf(at));
  const bg = BG[at];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight' && i < order.length - 1) onMove(order[i + 1]); if (e.key === 'ArrowLeft' && i > 0) onMove(order[i - 1]); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [i, order, onMove, onClose]);
  const time = fmtTime(j?.reportingTime);
  const directions = j?.mapLink ?? (j?.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.place)}` : undefined);
  const managerEmail = j?.manager?.email;
  const reply = REPLY[at](at === 'manager' && managerEmail && managerName ? firstName(managerName) : undefined);
  const [msg, setMsg] = useState('');
  useEffect(() => setMsg(''), [at]);
  // A like is kept on this device only: the story is HR's, and nothing is sent.
  const [likes, setLikes] = useState(readLikes);
  const liked = Boolean(likes[at]);
  const toggleLike = () => { const next = { ...likes, [at]: !liked }; setLikes(next); try { localStorage.setItem(LIKED_KEY, JSON.stringify(next)); } catch { /* not kept */ } };
  return (
    <div className="a1-story" role="dialog" aria-modal="true" aria-label={`Story ${i + 1} of ${order.length}`}>
      <div className="a1-story__panel" style={{ background: bg }}>
        <div style={{ padding: '12px 12px 0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="a1-story__segs" style={{ gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))` }}>
            {order.map((k, n) => <span key={k}><i className={n === i ? 'run' : ''} style={{ width: n <= i ? '100%' : '0%' }} /></span>)}
          </div>
          <div className="a1-row">
            <A1Logo company={company} className="a1-story__logo" />
            <span className="a1-stack"><span className="a1-strong">{company.name} HR</span><span style={{ fontSize: 12, lineHeight: '16px', color: 'rgba(255,255,255,.85)' }}>{WHEN[at]}</span></span>
            <button type="button" className="a1-icon-btn" style={{ color: '#fff', width: 44, height: 44 }} aria-label="Close" onClick={onClose}><A1Icon name="close" size={24} width={2} /></button>
          </div>
        </div>
        <div className="a1-story__main">
          {i > 0 && <button type="button" className="a1-story__tap" style={{ left: 0 }} aria-label="Previous story" onClick={() => onMove(order[i - 1])} />}
          {i < order.length - 1 && <button type="button" className="a1-story__tap" style={{ right: 0 }} aria-label="Next story" onClick={() => onMove(order[i + 1])} />}
          <div className="a1-story__content">
            {at === 'welcome' && (
              <>
                <h2 className="a1-story__title" style={{ fontSize: 32, lineHeight: '40px' }}>Welcome to {company.name}, {firstName(candidate)}!</h2>
                {video?.videoUrl ? <video className="a1-story__video" src={video.videoUrl} controls playsInline /> : <p className="a1-story__line">We’re glad you’re joining us. Everything you need before your first day is in this portal.</p>}
                {video?.subtitle && <p className="a1-story__line">{video.subtitle}</p>}
              </>
            )}
            {at === 'manager' && managerName && (
              <>
                <Face name={managerName} photo={note?.authorPhotoUrl} className="a1-story__face" />
                <h2 className="a1-story__title">Meet {managerName}</h2>
                <span className="a1-story__pill">Your manager</span>
                {note?.videoUrl ? <video className="a1-story__video" src={note.videoUrl} controls playsInline /> : <p className="a1-story__line">{note?.text ?? `${firstName(managerName)} will meet you on your first day.`}</p>}
              </>
            )}
            {at === 'team' && (
              <>
                <span style={{ display: 'flex' }}>
                  {[managerName, j?.buddy?.name, candidate].filter((n): n is string => Boolean(n)).map((n, k) => (
                    <span key={n} className="a1-story__face" style={{ width: 72, height: 72, fontSize: 22, marginLeft: k ? -18 : 0, border: `3px solid ${bg}`, boxShadow: 'none', color: bg }}>{initials(n)}</span>
                  ))}
                </span>
                <h2 className="a1-story__title">Your team{j?.department ? `, ${j.department}` : ''}</h2>
                <p className="a1-story__line">{[managerName && `${firstName(managerName)}, your manager`, j?.buddy && `${firstName(j.buddy.name)}, your buddy`].filter(Boolean).join(' · ')}</p>
                <p className="a1-story__line" style={{ fontSize: 14 }}>and you, from {fmtWeekday(tj)}</p>
              </>
            )}
            {at === 'day1' && (
              <>
                <span style={{ width: 96, height: 96, borderRadius: 999, background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><A1Icon name="pin" size={48} width={1.6} /></span>
                <h2 className="a1-story__title">{j?.place ?? fmtWeekday(j?.date ?? tj)}</h2>
                <p className="a1-story__line">{j?.place
                  ? [fmtWeekday(j?.date ?? tj), time ? `see you at ${time}` : ''].filter(Boolean).join(' · ')
                  : [time ? `See you at ${time}` : '', 'HR will share the place soon'].filter(Boolean).join(' · ')}</p>
                {directions && <a className="a1-story__cta" style={{ color: bg }} href={directions} target="_blank" rel="noreferrer"><A1Icon name="send" size={20} width={2} />Get directions</a>}
              </>
            )}
            {at === 'policies' && (
              <>
                <h2 className="a1-story__title">{policies.length === 1 ? '1 quick read' : `${policies.length} quick reads`} before you join</h2>
                <div className="a1-story__reads">
                  {policies.map((p) => <div key={p.title} className="a1-story__read"><span style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600 }}>{p.title}</span>{p.summary && <span style={{ fontSize: 13, lineHeight: '18px', color: 'rgba(255,255,255,.9)' }}>{p.summary}</span>}</div>)}
                </div>
              </>
            )}
            {at === 'role' && role && (
              <>
                <h2 className="a1-story__title">{role.title}</h2>
                {role.subtitle && <span className="a1-story__pill">{role.subtitle}</span>}
                <p className="a1-story__line" style={{ textAlign: 'left' }}>{role.text}</p>
              </>
            )}
          </div>
        </div>
        <form className="a1-story__foot" onSubmit={(e) => { e.preventDefault(); const to = at === 'manager' && managerEmail ? managerEmail : hr; window.location.href = `${mailto(to, at === 'manager' ? 'Hello before I join' : 'Question before I join')}&body=${encodeURIComponent(msg)}`; setMsg(''); }}>
          <label style={{ flex: 1, display: 'flex' }}>
            <span className="sr-only">{reply}</span>
            <input className="a1-story__input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={reply} enterKeyHint="send" />
          </label>
          {msg.trim()
            ? <button type="submit" className="a1-story__icon" aria-label="Send"><A1Icon name="send" size={24} width={2} /></button>
            : <button type="button" className="a1-story__icon" aria-label={liked ? 'Liked' : 'Like'} aria-pressed={liked} onClick={toggleLike}><svg width="28" height="28" viewBox="0 0 24 24" fill={liked ? '#FFFFFF' : 'none'} stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></svg></button>}
        </form>
      </div>
    </div>
  );
}
