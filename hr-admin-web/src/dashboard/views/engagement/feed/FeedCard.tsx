// One Connect post drawn the way the app's feed card draws it: author, time,
// tag, words, media and whatever the post type adds (poll options, a
// contest's call to enter, a game's play button). Read-only.
import { mediaUrl } from '../../../../services/api';
import type { FeedCardDTO } from '../../../../services/engagement-feed';
import { Avatar } from '../../../ui';
import { ago, shortDate } from './format';

function AuthorAvatar({ post }: { post: FeedCardDTO }) {
  const { author } = post;
  if (author.photoUrl) return <Avatar name={author.name} size={40} src={mediaUrl(author.photoUrl)} />;
  if (!author.userId) {
    // System authors (birthdays, Sowaka Engagements) wear their own colour.
    return (
      <span
        aria-hidden
        style={{ width: 40, height: 40, borderRadius: 20, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flex: 'none', background: author.avatarColor || 'var(--ink-3)' }}
      >
        {author.initials || author.name.slice(0, 1)}
      </span>
    );
  }
  return <Avatar name={author.name} size={40} />;
}

export function FeedCard({ post }: { post: FeedCardDTO }) {
  const b = post.body;
  const media = b.media ?? [];
  const isPoll = post.type === 'survey' && (b.options?.length ?? 0) > 0;
  const total = b.totalVotes ?? 0;
  const celebration = ['birthday', 'anniversary', 'new_joinee', 'kudos', 'award'].includes(post.type) && b.personName;
  const game = b.game;
  const sub = [post.author.designation, ago(post.publishedAt)].filter(Boolean).join(' · ');

  return (
    <article className="af-card">
      {post.pinnedUntil && (
        <div className="af-pin">
          <PinGlyph />
          Pinned until {shortDate(post.pinnedUntil)}
          {!post.leadingPin && <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>· not leading (pin limit)</span>}
        </div>
      )}
      <div className="af-h">
        <AuthorAvatar post={post} />
        <div style={{ minWidth: 0 }}>
          <div className="nm">
            {post.author.name}
            {post.auto && <span className="af-co">Auto</span>}
            {b.challenge?.official && <span className="af-co">Company</span>}
          </div>
          <small>
            {sub}
            {post.audience.kind !== 'company' ? ` · ${post.audience.label}` : ''}
          </small>
        </div>
      </div>
      {post.tag && (
        <span className="af-tag" style={{ color: post.tagColor || 'var(--hi)', background: post.tagTint || 'var(--hi-soft)' }}>
          {post.tagIcon ? `${post.tagIcon} ` : ''}
          {post.tag}
        </span>
      )}

      {celebration && (
        <div className="af-person">
          <Avatar name={b.personName} size={44} src={b.personPhotoUrl ? mediaUrl(b.personPhotoUrl) : undefined} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{b.personName}</div>
            {post.type === 'anniversary' && b.years ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{b.years} year{b.years === 1 ? '' : 's'}</div>
            ) : null}
          </div>
        </div>
      )}

      {b.title && <div className="af-t">{b.title}</div>}
      {b.text && <p className="af-b">{b.text}</p>}
      {b.subtitle && !b.text && <p className="af-b">{b.subtitle}</p>}

      {game && (
        <div className="af-game" style={{ background: `linear-gradient(135deg, ${game.accentColor || '#0571A6'}, ${game.accentColor || '#0571A6'}CC)` }}>
          <div>
            <b>{game.name || 'Game'}</b>
            <small>{gameWhen(game)}</small>
          </div>
          <span className="af-play">{game.actionLabel || 'Play now'}</span>
        </div>
      )}

      {media.length > 0 && (
        <div className={`af-media${media.length > 1 ? ' n2' : ''}`}>
          {media.slice(0, 4).map((m, i) =>
            m.video ? (
              <video key={i} src={mediaUrl(m.url)} controls preload="metadata" onClick={(e) => e.stopPropagation()} />
            ) : (
              <img key={i} src={mediaUrl(m.url)} alt="" loading="lazy" decoding="async" />
            ),
          )}
        </div>
      )}
      {media.length > 4 && <div className="af-meta">+{media.length - 4} more</div>}

      {b.link && (
        <a className="af-link" href={b.link.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {b.link.imageUrl && <img src={b.link.imageUrl} alt="" loading="lazy" />}
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 13.5, fontWeight: 600 }}>{b.link.title || b.link.url}</b>
            <span>{b.link.domain}</span>
          </div>
        </a>
      )}

      {isPoll && (
        <div className="af-opts">
          {b.options!.map((o) => (
            <div key={o.id} className="af-opt">
              <i style={{ width: total ? `${(o.votes / total) * 100}%` : 0 }} />
              {o.videoUrl ? (
                // The clip's first frame, opening the video itself on a click.
                <a
                  className="af-optvid"
                  href={mediaUrl(o.videoUrl)}
                  target="_blank"
                  rel="noreferrer"
                  title="Play video"
                  aria-label={`Play the video for ${o.label}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <video src={mediaUrl(o.videoUrl)} preload="metadata" muted playsInline />
                  <PlayGlyph />
                </a>
              ) : (
                o.imageUrl && <img src={mediaUrl(o.imageUrl)} alt="" loading="lazy" />
              )}
              <span>{o.label}</span>
              <span className="v">
                {o.votes} · {total ? Math.round((o.votes / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      )}

      {b.event && (b.event.date || b.event.location) && (
        <div className="af-meta">
          {[b.event.date, b.event.time].filter(Boolean).join(' · ') && <span>{[b.event.date, b.event.time].filter(Boolean).join(' · ')}</span>}
          {b.event.location && <span>{b.event.location}</span>}
          {b.event.prize && <span>Prize: {b.event.prize}</span>}
        </div>
      )}

      {b.challenge && <span className="af-cta">Take part · {b.challenge.pointsPerVote} points per vote</span>}

      <div className="af-meta">
        {post.likeCount > 0 && <span>{post.likeCount} like{post.likeCount === 1 ? '' : 's'}</span>}
        {post.commentCount > 0 && <span>{post.commentCount} comment{post.commentCount === 1 ? '' : 's'}</span>}
        {isPoll && <span>{total} vote{total === 1 ? '' : 's'}</span>}
        {b.challenge && <span>{b.challenge.entries} entr{b.challenge.entries === 1 ? 'y' : 'ies'}</span>}
        {b.challenge?.closesAt && (
          <span>{new Date(b.challenge.closesAt).getTime() > Date.now() ? `Closes ${shortDate(b.challenge.closesAt)}` : 'Closed'}</span>
        )}
      </div>
    </article>
  );
}

function gameWhen(game: NonNullable<FeedCardDTO['body']['game']>) {
  const now = Date.now();
  if (game.endsAt && new Date(game.endsAt).getTime() < now) return 'Ended';
  if (game.startsAt && new Date(game.startsAt).getTime() > now) return `Starts ${shortDate(game.startsAt)}`;
  if (game.endsAt) return `Open until ${shortDate(game.endsAt)}`;
  return 'Open now';
}

function PlayGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PinGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6l-1 7 3 3H7l3-3z" />
      <path d="M12 13v8" />
    </svg>
  );
}
