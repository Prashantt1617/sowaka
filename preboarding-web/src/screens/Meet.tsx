import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mediaUrl } from '../api/client';
import { portal } from '../api/portal';
import type { MeetItem } from '../api/types';
import { Page } from '../components/Shell';
import { Icon } from '../components/Icon';
import { AskHrSheet, BottomBar, ErrorNote, PrimaryButton, Spinner, StoryBar } from '../components/ui';
import { useAsync, useFocusHeading } from '../lib/hooks';
import { useMe } from '../session';

const TAGS: Record<MeetItem['kind'], string> = { manager_note: 'From your manager', video: 'How we work', card: 'Meet us' };

/** P10 · Meet us reels. Seen = 80% of a video, or 3 s on a card. Mobile layout, centred on desktop. */
export function Meet() {
  const { header, me, subject } = useMe();
  const navigate = useNavigate();
  const state = useAsync(() => portal.meet(), []);
  const [i, setI] = useState<number>();
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [askOpen, setAskOpen] = useState(false);
  const reported = useRef<Set<string>>(new Set());
  const h1 = useFocusHeading<HTMLHeadingElement>(i);

  const items = state.data?.items ?? [];
  useEffect(() => {
    if (!state.data || i !== undefined) return;
    const s = new Set(state.data.items.filter((x) => x.seen).map((x) => x.id));
    setSeen(s);
    const first = state.data.items.findIndex((x) => !x.seen);
    setI(first === -1 ? 0 : first);
  }, [state.data, i]);

  const markSeen = (id: string) => {
    if (reported.current.has(id)) return;
    reported.current.add(id);
    setSeen((s) => new Set(s).add(id));
    portal.meetSeen(id).catch(() => reported.current.delete(id));
  };

  const item = i !== undefined ? items[i] : undefined;
  const isVideo = !!item?.videoUrl;

  // a card counts as seen after 3 s on screen
  useEffect(() => {
    if (!item || isVideo || seen.has(item.id)) return;
    const t = window.setTimeout(() => markSeen(item.id), 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, isVideo]);

  if (state.error)
    return (
      <Page header={header({ close: '/' })}>
        <ErrorNote error={state.error} onRetry={state.reload} />
      </Page>
    );
  if (!state.data || i === undefined)
    return (
      <Page header={header({ close: '/' })}>
        <Spinner />
      </Page>
    );
  if (!item)
    return (
      <Page header={header({ close: '/' })}>
        <section className="closed">
          <h1 className="display">Nothing here yet</h1>
          <p className="body sub">Your team will add a hello before you join.</p>
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );

  const last = i === items.length - 1;
  const tone = isVideo ? 'dark' : 'light';
  const tag = item.tag ?? TAGS[item.kind];
  const subtitle =
    item.subtitle ??
    (item.kind === 'manager_note' ? (isVideo ? 'Your manager · video' : 'A note from your manager') : item.kind === 'video' ? 'Short video' : undefined);

  return (
    <Page header={header({ close: '/', tone, help: false, bell: undefined })} bg={isVideo ? 'dark' : 'white'} tone={tone} className="meet">
      <StoryBar total={items.length} current={i} done={items.map((x) => seen.has(x.id))} light={isVideo} />
      <p className="label reel-count">
        Meet the team · {i + 1} of {items.length}
      </p>
      <section className="reel meet-reel rise" key={item.id} aria-labelledby={`meet-${item.id}`}>
        <div className="meet-reel__media">
          {isVideo ? (
            <video
              className="meet-reel__video"
              src={mediaUrl(item.videoUrl!)}
              controls
              playsInline
              preload="metadata"
              aria-label={item.title}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration && v.currentTime / v.duration >= 0.8) markSeen(item.id);
              }}
            />
          ) : item.kind === 'manager_note' ? (
            <blockquote className="quote">
              <p className="body">“{item.text}”</p>
              {item.authorName && (
                <footer className="label" style={item.authorPhotoUrl ? { display: 'flex', alignItems: 'center', gap: 8 } : undefined}>
                  {item.authorPhotoUrl && <AuthorFace src={mediaUrl(item.authorPhotoUrl)} />}
                  {/* "Neha R. · Design lead · your manager": the role once, however the server words it. */}
                  {[item.authorName, item.authorRole?.replace(/\s*·\s*your manager$/i, '').trim(), 'your manager'].filter(Boolean).join(' · ')}
                </footer>
              )}
            </blockquote>
          ) : (
            <div className="meet-card">
              {(item.text ?? '').split(/\n{2,}/).map((para, k) => (
                <p key={k} className="body">
                  {para}
                </p>
              ))}
            </div>
          )}
          <div className="meet-reel__side">
            <button
              type="button"
              className={`side-action ${liked.has(item.id) ? 'is-on' : ''}`}
              aria-pressed={liked.has(item.id)}
              aria-label="Like"
              onClick={() =>
                setLiked((s) => {
                  const n = new Set(s);
                  if (n.has(item.id)) n.delete(item.id);
                  else n.add(item.id);
                  return n;
                })
              }
            >
              <Icon name="heart" />
            </button>
            <button type="button" className="side-action" aria-label="Ask a question" onClick={() => setAskOpen(true)}>
              <Icon name="chat" />
              <span className="side-action__text" aria-hidden="true">
                Ask
              </span>
            </button>
          </div>
        </div>
        <p className="eyebrow">{tag.toUpperCase()}</p>
        <h1 id={`meet-${item.id}`} className="display" ref={h1} tabIndex={-1}>
          {item.title}
        </h1>
        {subtitle && <p className="body sub">{subtitle}</p>}
        {seen.has(item.id) && <span className="sr-only">Seen</span>}
      </section>
      <BottomBar>
        <PrimaryButton onClick={() => (last ? navigate('/') : setI(i + 1))}>{last ? 'Done · back to home' : 'Next'}</PrimaryButton>
      </BottomBar>
      <AskHrSheet open={askOpen} onClose={() => setAskOpen(false)} name={me.hrContact.name} email={me.hrContact.email} subject={subject} />
    </Page>
  );
}

/** The note's author's face beside their name; gone (the name stands alone) if it fails to load. */
function AuthorFace({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      width={28}
      height={28}
      onError={() => setFailed(true)}
      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
    />
  );
}
