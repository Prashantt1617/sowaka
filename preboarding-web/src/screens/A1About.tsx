// About the company: the stories alone (23 Nov; the page of rings, team and policies went). Arriving opens
// the first story full screen; closing goes back to Home. Opening a story marks its Meet-us item seen
// (all seen completes the Meet us task); a policy opens from its story and returns to it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { portal } from '../api/portal';
import { mediaUrl } from '../api/client';
import type { JoiningDetails, MeetItem } from '../api/types';
import { FigLoading, FigPage } from '../components/fig/FigShell';
import { useMe } from '../session';
import '../styles/fig-g1.css';
import { G2Story, type StoryKey } from '../components/fig/G2Story';
import { G2Policy, type PortalPolicy } from '../components/fig/G2Policy';

const SEEN_ITEM: Partial<Record<StoryKey, string>> = { welcome: 'company_video', manager: 'manager_note', policies: 'policies', role: 'role' };

/**
 * The company's policies as the app reads them (the server sends them with their text);
 * an older server sent only "Title: summary" lines, read as titles without text.
 */
export const policiesOf = (item?: MeetItem): PortalPolicy[] => item?.policies?.length
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
  // Warm the watch list as soon as it arrives: pictures into the browser cache, videos' first bytes,
  // so each story opens without waiting (the links are cacheable and stay the same all day).
  useEffect(() => {
    const held: Array<HTMLImageElement | HTMLVideoElement> = [];
    for (const w of watch) {
      if (w.mediaType === 'image' && w.imageUrl) { const img = new Image(); img.src = mediaUrl(w.imageUrl); held.push(img); }
      if (w.mediaType === 'video' && w.videoUrl) { const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.src = mediaUrl(w.videoUrl); v.load(); held.push(v); }
    }
    return () => { for (const el of held) if (el instanceof HTMLVideoElement) { el.removeAttribute('src'); el.load(); } };
  }, [watch]);
  const stories = useMemo(() => {
    // The watch list, then the design's order (App · Story · 1 Culture … 5 Policies), then the role.
    const out: StoryKey[] = [...watch.map((w) => w.id as StoryKey), 'welcome'];
    if (managerName) out.push('manager');
    if (managerName || j?.buddy) out.push('team');
    out.push('day1');
    if (role) out.push('role');
    return out;
  }, [watch, managerName, j?.buddy, role]);

  const markSeen = useCallback((k: StoryKey) => {
    const id = k.startsWith('watch:') ? k : SEEN_ITEM[k as keyof typeof SEEN_ITEM];
    const item = id ? items?.find((i) => i.id === id) : undefined;
    if (item && !item.seen) portal.meetSeen(item.id).then(() => setItems((cur) => cur?.map((i) => (i.id === item.id ? { ...i, seen: true } : i))), () => undefined);
  }, [items]);
  const show = (k: StoryKey) => { setOpen(k); markSeen(k); };
  // From Home's About the company tile (?stories=1): straight into the stories, first one open.
  const [params, setParams] = useSearchParams();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !items || !stories.length) return;
    autoOpened.current = true;
    show(stories[0]);
    setParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, stories, params]);
  /** A policy opens on its own, straight from its row (reading it counts as seeing the policies story). */
  const read = (p: PortalPolicy) => { setReading(p); markSeen('policies'); };

  const navigate = useNavigate();
  // About the company is the stories alone (23 Nov): closing them goes back to Home.
  const home = () => navigate('/', { replace: true });

  return (
    <FigPage>
      {!open && !reading && <FigLoading />}
      {open && (
        <G2Story order={stories} at={open} onMove={show} onClose={home} watch={watch}
          company={me.company} candidate={me.candidateName} hr={me.hrContact.email} tj={me.tj} j={j} note={note} managerName={managerName} video={video} role={role} policies={policies}
          onOpenPolicy={(p) => { if (p.body) { setOpen(null); read(p); } }} />
      )}
      {reading && <G2Policy policy={reading} onClose={() => { setReading(null); show('policies'); }} />}
    </FigPage>
  );
}
