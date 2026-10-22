// "Suwi noticed" and "Suwi's morning digest": two small Overview cards, and
// the counts the sidebar shows next to the pages a notice is about. Notices
// are worked out on the server without any model call; the digest is built
// once a day. Both stay hidden when Suwi is off or there is nothing to say.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { api } from '../../services/http';
import { Markdown } from './markdown';
import { SuwiOrb } from './SuwiPanel';

export type SuwiNotice = { key: string; icon: 'clock' | 'check' | 'rupee' | 'receipt' | 'spark' | 'calendar'; title: string; why: string; ask: string; view: string; count: number };
// enabled is unknown (undefined) until the server has answered.
type NoticesState = { enabled?: boolean; notices: SuwiNotice[]; counts: Record<string, number> };

// One fetch shared by the sidebar and the Overview card, refreshed every five minutes.
const EMPTY: NoticesState = { enabled: undefined, notices: [], counts: {} };
let cache: { at: number; data: NoticesState } | null = null;
let inflight: Promise<NoticesState> | null = null;
const listeners = new Set<(d: NoticesState) => void>();
function loadNotices(force = false): Promise<NoticesState> {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return Promise.resolve(cache.data);
  if (inflight) return inflight;
  inflight = api<NoticesState>('/suwi/notices')
    .then((r) => ({ enabled: r.enabled, notices: r.notices ?? [], counts: r.counts ?? {} }))
    .catch(() => EMPTY)
    .then((data) => { cache = { at: Date.now(), data }; listeners.forEach((l) => l(data)); return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useSuwiNotices(): NoticesState {
  const [data, setData] = useState<NoticesState>(cache?.data ?? EMPTY);
  useEffect(() => {
    listeners.add(setData);
    void loadNotices();
    const t = setInterval(() => void loadNotices(true), 5 * 60_000);
    return () => { listeners.delete(setData); clearInterval(t); };
  }, []);
  return data;
}

const ICON_PATHS: Record<SuwiNotice['icon'], ReactNode> = {
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></>,
  rupee: <path d="M7 5h10M7 9h10M7 5c5 0 6 2 6 4s-2 4-6 4l6 6" />,
  receipt: <><path d="M6 3h12v18l-2.5-1.5L13 21l-2-1.5L9 21l-3-1.5z" /><path d="M9 8h6M9 12h6" /></>,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
};
function NoticeIcon({ icon }: { icon: SuwiNotice['icon'] }) {
  return (
    <span className="sora-ic">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICON_PATHS[icon]}</svg>
    </span>
  );
}

/** The Overview card: one line per notice, each with a "Show me" that asks Suwi. */
function SuwiNoticedCard({ notices }: { notices: SuwiNotice[] }) {
  const s = useStore();
  return (
    <section className="sora-card">
      <div className="sora-card-h">
        <SuwiOrb />
        <div style={{ minWidth: 0 }}>
          <h3>Suwi noticed</h3>
          <small>from your data just now</small>
        </div>
      </div>
      <div className="sora-list">
        {notices.map((n) => (
          <div key={n.key} className="sora-li">
            <NoticeIcon icon={n.icon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{n.title}</b>
              <span className="s">{n.why}</span>
            </div>
            <button type="button" onClick={() => s.askSuwiQuestion(n.ask)} className="suwi-btn">Show me</button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Overview card: today's digest, built overnight (or now, the first time today). */
function SuwiDigestCard({ digest }: { digest: { date: string; text: string } }) {
  const s = useStore();
  return (
    <section className="sora-card">
      <div className="sora-card-h">
        <SuwiOrb />
        <div style={{ minWidth: 0 }}>
          <h3>Suwi's morning digest</h3>
          <small>{new Date(`${digest.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
        </div>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}><Markdown text={digest.text} onPerson={(id) => s.openProfile(id)} /></div>
    </section>
  );
}

/** Both cards for the Overview, side by side; nothing at all when Suwi is off or has nothing to say. */
export function SuwiOverviewCards() {
  const { enabled, notices } = useSuwiNotices();
  const [digest, setDigest] = useState<{ date: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ digest: { date: string; text: string } | null }>('/suwi/digest').then((r) => { if (live) setDigest(r.digest); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const showNotices = enabled && notices.length > 0;
  if (!showNotices && !digest) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18, alignItems: 'start', marginBottom: 22 }}>
      {showNotices && <SuwiNoticedCard notices={notices} />}
      {digest && <SuwiDigestCard digest={digest} />}
    </div>
  );
}
