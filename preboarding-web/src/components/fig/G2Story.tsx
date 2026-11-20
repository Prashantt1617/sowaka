// The full-screen story (Figma "App · Story ·" Culture, Your manager, Your team, Day 1, Policies;
// nodes 4967:93675 … 4967:93854): the segments, HR's header with Close and one story.
// No reply field or Like (removed 20 Nov 2026, not needed). Moved out of A1About so the
// About page and the story stay apart.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { JoiningDetails, MeetItem } from '../../api/types';
import { A1Logo } from '../A1';
import { firstName, fmtTime, fmtWeekday, initials } from '../../lib/format';
import type { PortalPolicy } from './G2Policy';
import { G2Close } from './icons/g2-close';
import { G2Play } from './icons/g2-play';
import { G2Directions } from './icons/g2-directions';
import { G2ChevronRight } from './icons/g2-chevron-right';
import pin3d from './icons/g2-3d-pin.png';

export type StoryKey = 'welcome' | 'manager' | 'team' | 'day1' | 'policies' | 'role';

/** Per story: background, the HR mark's colour, the line under HR, where the content sits, the reply hint. */
const LOOK: Record<StoryKey, { cls: string; mark: string; sub: string; pb: number }> = {
  welcome: { cls: 'g2-story--brand', mark: '#0571A6', sub: 'Pinned by HR', pb: 218.5 },
  manager: { cls: 'g2-story--green', mark: '#15803D', sub: 'Before you join', pb: 204.5 },
  team: { cls: 'g2-story--amber', mark: '#0571A6', sub: 'Before you join', pb: 228.5 },
  day1: { cls: 'g2-story--blue', mark: '#B45309', sub: 'Before you join', pb: 208.5 },
  policies: { cls: 'g2-story--tint', mark: '#0571A6', sub: 'Before you join', pb: 186.5 },
  role: { cls: 'g2-story--tint', mark: '#0571A6', sub: 'Before you join', pb: 186.5 },
};
const TEAM_TONES = [['#FFFFFF', '#0571A6'], ['#F7F7F9', '#15803D'], ['#F7F7F9', '#B45309'], ['#F7F7F9', '#B45309']];
const dayMonth = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Face({ name, photo, className, style }: { name: string; photo?: string; className: string; style?: CSSProperties }) {
  const [bad, setBad] = useState(false);
  return <span className={className} style={style} aria-hidden="true">{photo && !bad ? <img src={photo} alt="" onError={() => setBad(true)} /> : initials(name)}</span>;
}

export function G2Story({ order, at, onMove, onClose, company, candidate, tj, j, note, managerName, video, role, policies, onOpenPolicy }: {
  order: StoryKey[]; at: StoryKey; onMove: (k: StoryKey) => void; onClose: () => void; company: { name: string; logoUrl?: string }; candidate: string; /** No longer used (the reply bar is gone); still passed by the About page. */ hr?: string; tj: string;
  j?: JoiningDetails; note?: MeetItem; managerName?: string; video?: MeetItem; role?: MeetItem; policies: PortalPolicy[];
  /** A quick read opens that policy (G2Policy). */
  onOpenPolicy?: (p: PortalPolicy) => void;
}) {
  const i = Math.max(0, order.indexOf(at));
  const look = LOOK[at];
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setPlaying(false); }, [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && i < order.length - 1) onMove(order[i + 1]);
      if (e.key === 'ArrowLeft' && i > 0) onMove(order[i - 1]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [i, order, onMove, onClose]);

  const time = fmtTime(j?.reportingTime);
  const directions = j?.mapLink ?? (j?.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.place)}` : undefined);
  const mFirst = managerName ? firstName(managerName) : '';
  const team = [managerName, j?.buddy?.name].filter((n): n is string => Boolean(n));

  let content: ReactNode = null;
  if (at === 'welcome') {
    const about = video?.text ?? video?.subtitle ?? 'We’re glad you’re joining us. Everything you need before your first day is in this portal.';
    content = (
      <div className="g2-story__stack" style={{ gap: 28 }}>
        <div className="g2-story__lead" style={{ gap: 20 }}>
          <h2 className="g2-story__title g2-story__title--lines"><span>Welcome to</span><span>{company.name}</span><span>{firstName(candidate)}!</span></h2>
          <p className="g2-story__line">{about}</p>
        </div>
        {video?.videoUrl && (playing
          ? <video className="g2-story__video" src={video.videoUrl} controls autoPlay playsInline />
          : <button type="button" className="g2-story__cta" style={{ gap: 16.5, paddingRight: 28.375 }} onClick={() => setPlaying(true)}><G2Play />Watch the welcome video</button>)}
      </div>
    );
  } else if (at === 'manager' && managerName) {
    const line = note?.text ?? [j?.manager?.designation, `${mFirst} will meet you${j?.place ? ` at ${j.place}` : ''} on your first day.`].filter(Boolean).join('. ');
    content = (
      <div className="g2-story__stack" style={{ gap: 16 }}>
        <Face name={managerName} photo={note?.authorPhotoUrl} className="g2-story__face" />
        <h2 className="g2-story__title">Meet {managerName}</h2>
        <span className="g2-story__pill">Your manager</span>
        {note?.videoUrl ? <video className="g2-story__video" src={note.videoUrl} controls playsInline /> : <p className="g2-story__line">{line}</p>}
      </div>
    );
  } else if (at === 'team') {
    content = (
      <div className="g2-story__stack" style={{ gap: 20 }}>
        <span className="g2-story__faces">
          {team.map((n, k) => <span key={n} className="g2-story__mini" style={{ background: TEAM_TONES[k % 4][0], color: TEAM_TONES[k % 4][1] }}>{initials(n)}</span>)}
        </span>
        <h2 className="g2-story__title g2-story__title--lines"><span>Your team</span>{j?.department && <span>{j.department}</span>}</h2>
        <div className="g2-story__lead" style={{ gap: 8 }}>
          <p className="g2-story__line">{team.map(firstName).join(' · ')}</p>
          <p className="g2-story__line g2-story__line--sm">and you, from {dayMonth(tj)}</p>
        </div>
      </div>
    );
  } else if (at === 'day1') {
    content = (
      <div className="g2-story__stack" style={{ gap: 24 }}>
        <div className="g2-story__lead" style={{ gap: 16, alignItems: 'center' }}>
          <span className="g2-story__pin"><img src={pin3d} alt="" width={64} height={64} /></span>
          <h2 className="g2-story__title">{j?.place ?? fmtWeekday(tj)}</h2>
          {(j?.place || time) && <p className="g2-story__line">{[j?.place ? fmtWeekday(j?.date ?? tj) : '', time ? `see you at ${time}` : ''].filter(Boolean).join(' · ')}</p>}
        </div>
        {directions && <a className="g2-story__cta" style={{ gap: 12, paddingRight: 24.453 }} href={directions} target="_blank" rel="noreferrer"><G2Directions />Get directions</a>}
      </div>
    );
  } else if (at === 'policies') {
    content = (
      <div className="g2-story__lead" style={{ gap: 20 }}>
        <h2 className="g2-story__title">{policies.length === 1 ? '1 quick read' : `${policies.length} quick reads`} before you join</h2>
        <div className="g2-story__reads">
          {policies.map((p) => (
            <button type="button" key={p.key || p.title} className="g2-story__read" onClick={() => onOpenPolicy?.(p)}>
              <span className="g2-story__read-text"><span className="g2-story__read-title">{p.title}</span>{p.summary && <span className="g2-story__read-sub">{p.summary}</span>}</span>
              <span className="g2-story__read-go"><G2ChevronRight /></span>
            </button>
          ))}
        </div>
      </div>
    );
  } else if (at === 'role' && role) {
    content = (
      <div className="g2-story__stack" style={{ gap: 16 }}>
        <h2 className="g2-story__title">{role.title}</h2>
        {role.subtitle && <span className="g2-story__pill">{role.subtitle}</span>}
        <p className="g2-story__line">{role.text}</p>
      </div>
    );
  }

  const onBrand = at === 'welcome';
  return (
    <div className="a1-story" role="dialog" aria-modal="true" aria-label={`Story ${i + 1} of ${order.length}`}>
      <div className={`g2-story ${look.cls}`}>
        <div className="g2-story__top">
          <div className="g2-story__segs">
            {order.map((k, n) => <span key={k}><i style={{ width: n <= i ? '100%' : '0%' }} /></span>)}
          </div>
          <div className="g2-story__who">
            <span style={{ color: look.mark, display: 'flex' }}><A1Logo company={company} className="g2-story__mark" /></span>
            <span className="g2-story__by"><b>{company.name} HR</b><span>{look.sub}</span></span>
            <button type="button" className="g2-story__close" aria-label="Close" onClick={onClose}><G2Close color={onBrand ? '#FFFFFF' : '#0571A6'} /></button>
          </div>
        </div>
        <div className="g2-story__main" style={{ paddingBottom: look.pb }}>
          {i > 0 && <button type="button" className="a1-story__tap" style={{ left: 0 }} aria-label="Previous story" onClick={() => onMove(order[i - 1])} />}
          {i < order.length - 1 && <button type="button" className="a1-story__tap" style={{ right: 0 }} aria-label="Next story" onClick={() => onMove(order[i + 1])} />}
          <div className="g2-story__content">{content}</div>
        </div>
      </div>
    </div>
  );
}
