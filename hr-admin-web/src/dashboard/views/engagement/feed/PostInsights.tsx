// The right-hand panel for one post: what it is, who it went to, and what
// people did with it. Only what is stored — likes, comments, votes, entries,
// players and the publish push — never an estimate.
import { useState } from 'react';
import { mediaUrl } from '../../../../services/api';
import { getFeedPost, removeFeedComment, type FeedPostDetailDTO } from '../../../../services/engagement-feed';
import { Avatar, EmptyRow, LoadError, Pill, SkeletonLines } from '../../../ui';
import { btn, btnClass } from '../../../ds';
import { useStore } from '../../../store';
import { useLoad } from '../../../useLoad';
import * as L from '../../look';
import { shortDate } from './format';

export function PostInsights({ postId, rev, onChanged }: { postId: string; rev: number; onChanged: () => void }) {
  const { flash, setView } = useStore();
  const detail = useLoad(() => getFeedPost(postId), [postId, rev]);
  const [busy, setBusy] = useState('');

  if (detail.state === 'error') return <LoadError text="This post could not be loaded. It may have been removed." onRetry={detail.retry} />;
  if (!detail.data) return <SkeletonLines lines={8} />;
  const { post, insights, comments } = detail.data as FeedPostDetailDTO;
  const b = post.body;

  async function removeComment(id: string, name: string, replies: number) {
    const extra = replies ? ` and the ${replies} repl${replies === 1 ? 'y' : 'ies'} under it` : '';
    if (!window.confirm(`Remove ${name}'s comment${extra}? This cannot be undone, and any open report on it is closed.`)) return;
    setBusy(id);
    try {
      await removeFeedComment(post.id, id);
      flash('Comment removed');
      await detail.reload();
      onChanged();
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not remove the comment', 'error');
    } finally {
      setBusy('');
    }
  }

  // The third figure depends on what the post is.
  const extra: [string, number | string, string][] = [];
  if (post.type === 'survey') extra.push(['Votes', b.totalVotes ?? 0, `${b.options?.length ?? 0} options`]);
  if (b.challenge) {
    extra.push(['Entries', b.challenge.entries, '']);
    extra.push(['Votes on entries', b.challenge.votes, `${b.challenge.pointsPerVote} points each`]);
  }
  if (insights.players != null) extra.push(['Players', insights.players, post.type === 'game_launch' ? 'Scored while it was on' : 'Have a score']);

  const kpis: [string, number | string, string][] = [
    ['Audience', insights.audienceSize, post.audience.label],
    ['Likes', post.likeCount, ''],
    ['Comments', comments.length, ''],
    ...extra,
  ];
  const repliesUnder = (id: string): number => {
    const kids = comments.filter((c) => c.parentId === id);
    return kids.length + kids.reduce((n, k) => n + repliesUnder(k.id), 0);
  };
  const titleText = b.title || b.text || b.personName || post.tag || 'Post';

  return (
    <div>
      <div className="fd-ih">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill label="Live" tone={L.TONES.ok} />
            <Pill label={post.tag || 'Post'} tone={L.TONES.mute} />
            {post.pinnedUntil && <Pill label={`Pinned until ${shortDate(post.pinnedUntil, false)}`} tone={L.TONES.warn} />}
            {post.type === 'game_launch' && <Pill label="Posted by Sowaka Engagements" tone={L.TONES.info} />}
            {post.auto && post.type !== 'game_launch' && <Pill label="Auto-posted" tone={L.TONES.info} />}
            {insights.reportsOpen > 0 && <Pill label={`Reported ×${insights.reportsOpen}`} tone={L.TONES.bad} />}
          </div>
          <h3>{titleText.length > 90 ? `${titleText.slice(0, 90)}…` : titleText}</h3>
          <div className="sub">
            {post.author.name} · {shortDate(post.publishedAt)} · Audience: {post.audience.label}
            {insights.pushSent > 0 ? ` · Push sent to ${insights.pushSent} ${insights.pushSent === 1 ? 'person' : 'people'}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {b.game && (
            <button className={btnClass()} style={btn('secondary', 'sm')} onClick={() => setView('games')}>
              Open games
            </button>
          )}
          {b.challenge && (
            <button className={btnClass()} style={btn('secondary', 'sm')} onClick={() => setView('contests')}>
              Open contests
            </button>
          )}
        </div>
      </div>

      <div className="fd-kpi">
        {kpis.map(([label, value, sub]) => (
          <div key={label} className="fd-k">
            <span>{label}</span>
            <b>{value}</b>
            {sub && <small>{sub}</small>}
          </div>
        ))}
      </div>

      <div className="fd-sec">
        <h4>
          Comments · {comments.length}
          <small>Removing takes the comment and its replies down for everyone</small>
        </h4>
        {comments.length === 0 ? (
          <EmptyRow text={post.type === 'game_launch' ? 'Game launch posts take no comments.' : 'No comments yet.'} />
        ) : (
          comments.map((c) => (
            <div key={c.id} className={`fd-cm${c.parentId ? ' reply' : ''}`}>
              <Avatar name={c.name} size={30} src={c.photoUrl ? mediaUrl(c.photoUrl) : undefined} />
              <div className="grow">
                <b style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name}</b>{' '}
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {shortDate(c.createdAt)}
                  {c.likeCount ? ` · ${c.likeCount} like${c.likeCount === 1 ? '' : 's'}` : ''}
                </span>
                {c.reportsOpen > 0 && (
                  <>
                    {' '}
                    <Pill label={`Reported ×${c.reportsOpen}`} tone={L.TONES.warn} />
                  </>
                )}
                <p>{c.text}</p>
              </div>
              <button
                className={btnClass('no')}
                style={{ ...btn('no', 'sm'), opacity: busy === c.id ? 0.6 : 1 }}
                disabled={busy === c.id}
                onClick={() => removeComment(c.id, c.name, repliesUnder(c.id))}
                aria-label={`Remove ${c.name}'s comment`}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
