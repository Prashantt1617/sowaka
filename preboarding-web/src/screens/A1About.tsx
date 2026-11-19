// Web · About the company (18 Nov design, "Web · 8 About the company" and the five
// "Web · Story ·" screens): highlights as story rings, the first person they'll meet,
// their team, policies to read, and culture cards. A story opens full screen; opening
// one marks its Meet-us item seen (all seen completes the Meet us task).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { portal } from '../api/portal';
import type { JoiningDetails, MeetItem } from '../api/types';
import { A1Icon, A1Loading, Breadcrumb } from '../components/A1';
import { firstName, initials } from '../lib/format';
import { useMe } from '../session';
import { WebPage } from './A1Shell';
import { G2Story, type StoryKey } from '../components/fig/G2Story';

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
    // The design's order (App · Story · 1 Culture … 5 Policies), then the role.
    const out: StoryKey[] = ['welcome'];
    if (managerName) out.push('manager');
    if (managerName || j?.buddy) out.push('team');
    out.push('day1');
    if (policies.length) out.push('policies');
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
        <G2Story order={stories} at={open} onMove={show} onClose={() => setOpen(null)}
          company={me.company} candidate={me.candidateName} hr={me.hrContact.email} tj={me.tj} j={j} note={note} managerName={managerName} video={video} role={role} policies={policies} />
      )}
    </WebPage>
  );
}
