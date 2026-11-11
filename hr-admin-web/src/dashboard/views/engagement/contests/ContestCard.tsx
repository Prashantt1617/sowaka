// The contest card as the Connect app draws it in the feed (engagement_cards.dart):
// the dark author band, the name in dark ink on the violet, the countdown and
// the LIVE / CLOSED pill, then the format's own middle (the picture with the
// leading caption, the leading photo, or "Who's been tagged") and its button.
// Read only: here it shows HR what employees see.
import { useEffect, useState, type CSSProperties } from 'react';
import type { ContestDetailDTO } from '../../../../services/engagement-contests';
import { C, ICONS, SORA } from './ContestComposer';

// _EngagementColors in engagement_cards.dart, for what the composer's palette lacks.
const APP = {
  band: '#160D2C',
  ink: '#222222',
  inkSecondary: '#484848',
  inkTertiary: '#717171',
  border: '#EBEBEB',
  livePill: '#CCFF44',
  liveGreen: '#34C759',
  ctaText: '#078442',
  brand: '#0571A6',
  bubble: '#FBEFEA',
  bars: ['#FFCC00', '#0088FF', '#00C8B3'],
  muted: '#96B7C7',
};

/** "END IN: 02:14:05", or "Ended" (contestCountdownLabel). */
function countdown(closesAt: string | null, now: number) {
  if (!closesAt) return '';
  const left = Date.parse(closesAt) - now;
  if (left <= 0) return 'Ended';
  const two = (v: number) => String(v).padStart(2, '0');
  return `END IN: ${two(Math.floor(left / 3_600_000))}:${two(Math.floor(left / 60_000) % 60)}:${two(Math.floor(left / 1000) % 60)}`;
}

function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  return now;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function Face({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', flex: '0 0 auto', display: 'grid', placeItems: 'center',
        background: 'linear-gradient(160deg,#4F8C89,#7FB3B0)', color: '#fff', fontWeight: 700,
        fontSize: Math.round(size * 0.36), border: '2px solid #fff',
      }}
    >
      {initials(name)}
    </span>
  );
}

const ctaStyle: CSSProperties = {
  height: 52, borderRadius: 14, background: APP.livePill, border: `3px solid ${APP.ctaText}`, boxShadow: `0 5px 0 ${APP.ctaText}`,
  display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 19, color: APP.ctaText, margin: '10px 4px 6px',
};

export function ContestCard({ detail }: { detail: ContestDetailDTO }) {
  const c = detail.contest;
  const closed = c.status === 'closed';
  const now = useNow(!closed);
  const ml = c.type === 'most_likely';
  const photo = c.type === 'photo_story_challenge';
  const top = detail.entries[0];
  const tags = detail.tagged.slice(0, 3);
  const maxTag = Math.max(1, ...tags.map((t) => t.points));
  const count = ml ? detail.tagged.length : detail.entries.length;

  return (
    <div style={{ width: '100%', maxWidth: 352, overflow: 'hidden', background: C.card, borderRadius: 'var(--r-lg)', boxShadow: '0 4px 16px rgba(109, 40, 217, 0.10)', fontFamily: SORA, color: APP.ink }}>
      {/* _EngagementHeaderView on the feed's dark band */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 12.9px 14px 22px', background: APP.band, borderBottom: `1.129px solid ${C.headerDivider}` }}>
        <img src={`${ICONS}/sowaka_logo.png`} alt="" width={48} height={48} style={{ borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 16, lineHeight: '24px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Sowaka Engagement</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <img src={`${ICONS}/star.png`} alt="" width={14} height={14} style={{ objectFit: 'contain' }} />
            <span style={{ fontSize: 12, lineHeight: '16.2px', fontWeight: 600, color: C.points }}>{c.pointsPerVote} pts per vote received</span>
          </div>
        </div>
        <img src={`${ICONS}/dots_menu_light.svg`} alt="" width={20} height={20} style={{ padding: 4, flex: '0 0 auto' }} />
      </div>

      <div style={{ padding: '14px 22px 18px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: photo ? 20 : 24, lineHeight: photo ? 1.26 : '28px', fontWeight: 700, overflowWrap: 'anywhere' }}>{c.name}</div>
        {ml && (
          <div style={{ paddingTop: 4, fontSize: 12, lineHeight: '16.2px', fontWeight: 600, color: APP.inkSecondary }}>
            {c.question || 'Nominate the teammate who fits this tag'}
          </div>
        )}
        {c.type === 'caption_challenge' && c.task && (
          <div style={{ paddingTop: 4, fontSize: 12, lineHeight: '16.2px', fontWeight: 600, color: APP.inkSecondary }}>{c.task}</div>
        )}
        {/* _CountdownRow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 8px' }}>
          <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: APP.inkSecondary, whiteSpace: 'nowrap' }}>{countdown(c.closesAt, now)}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 16px', borderRadius: 999, background: closed ? '#fff' : APP.livePill, border: `1.1px solid ${closed ? APP.inkTertiary : APP.liveGreen}`, boxShadow: '0 4px 2px rgba(113,134,255,.25)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: closed ? APP.inkTertiary : APP.liveGreen }} />
            <span style={{ fontSize: 10, lineHeight: '18px', fontWeight: 700, letterSpacing: 0.3, color: closed ? APP.inkTertiary : APP.liveGreen }}>{closed ? 'CLOSED' : 'LIVE'}</span>
          </span>
        </div>

        {c.type === 'caption_challenge' && (
          <div style={{ position: 'relative', padding: '6px 10px 0' }}>
            <div style={{ height: 170, background: '#fff', borderRadius: 12, border: '6px solid #fff', transform: 'rotate(-2.5deg)', boxShadow: '0 6px 18px rgba(30,20,90,.2)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
              {c.mediaUrl ? (
                <img src={c.mediaUrl} alt="The picture to caption" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
              ) : (
                <span style={{ fontSize: 12, color: APP.inkTertiary }}>Picture not available</span>
              )}
            </div>
            {top && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: -22, position: 'relative', padding: '0 2px' }}>
                <Face name={top.by.name} />
                <div style={{ flex: 1, background: APP.bubble, borderRadius: 14, padding: '10px 12px', boxShadow: `3px 3px 0 ${APP.band}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{top.text}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: APP.inkSecondary, whiteSpace: 'nowrap' }}>▲ {top.votes}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {photo && (
          <div style={{ background: '#fff', borderRadius: 14, border: `1px solid ${APP.border}`, padding: '12px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, paddingBottom: 8 }}>Team’s snap</div>
            {top?.photoUrl ? (
              <div style={{ transform: 'rotate(-2deg)', border: '5px solid #fff', boxShadow: '0 6px 18px rgba(30,20,90,.2)', borderRadius: 10, overflow: 'hidden', height: 170 }}>
                <img src={top.photoUrl} alt={`${top.by.name}'s photo`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ) : (
              <div style={{ height: 120, borderRadius: 10, background: '#F2F2F5', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: APP.inkTertiary }}>Be the first one to catch</div>
            )}
            {top && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13 }}>
                <Face name={top.by.name} size={28} />
                <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top.text || top.by.name}</span>
                <span style={{ fontSize: 12, color: APP.inkSecondary }}>{top.votes} {top.votes === 1 ? 'vote' : 'votes'}</span>
              </div>
            )}
          </div>
        )}

        {ml && (
          <div style={{ background: '#fff', borderRadius: 14, border: `1px solid ${APP.border}`, padding: '12px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, paddingBottom: 8, borderBottom: `1px solid ${APP.border}` }}>Who’s been tagged</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12 }}>
              {tags.length === 0 && <div style={{ height: 48, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, color: APP.inkTertiary }}>Be the first one to play</div>}
              {tags.map((t, i) => {
                const col = APP.bars[i] ?? APP.muted;
                return (
                  <div key={t.person.userId} style={{ position: 'relative', height: 48, borderRadius: 12, border: `2px solid ${col}`, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 10px 0 4px', gap: 8 }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round((t.points / maxTag) * 100)}%`, background: col, opacity: 0.85 }} />
                    <span style={{ position: 'relative' }}><Face name={t.person.name} size={36} /></span>
                    <span style={{ position: 'relative', flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.person.name}</span>
                    <span style={{ position: 'relative', fontSize: 16, fontWeight: 700 }}>{t.points}pt</span>
                  </div>
                );
              })}
            </div>
            <span style={{ display: 'inline-block', marginTop: 13, padding: '6px 16px', borderRadius: 999, border: `1px solid ${APP.border}`, fontSize: 12, fontWeight: 600, color: APP.brand }}>See all nominations</span>
          </div>
        )}

        {count > 0 && !ml && (
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: C.onCard, paddingTop: 12 }}>1 of {count}</div>
        )}
        {closed ? (
          <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, fontWeight: 600, color: APP.inkSecondary }}>This contest has closed.</div>
        ) : (
          <div style={ctaStyle}>{ml ? 'Nominate' : photo ? 'Add your photo' : 'Add your answer'}</div>
        )}
        {!ml && (
          <div style={{ alignSelf: 'center', fontSize: 16, fontWeight: 600, borderBottom: `1px solid ${APP.ink}`, marginTop: 4 }}>View Entries</div>
        )}
      </div>
    </div>
  );
}
