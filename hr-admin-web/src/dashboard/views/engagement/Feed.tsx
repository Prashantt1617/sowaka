// Dashboard › Engagement › Feed: the company's Connect feed as employees see
// it, on the left, and on the right the selected post's numbers or the queue
// of what employees reported. Replaces Engagement posts and Moderate feed.
//
// Everything here is the org's own stored data. Nothing on this page posts
// to the feed or sends a push.
import { useCallback, useEffect, useState } from 'react';
import {
  getFeedPage,
  getFeedSummary,
  pinFeedPost,
  removeFeedPost,
  unpinFeedPost,
  type FeedAs,
  type FeedCardDTO,
} from '../../../services/engagement-feed';
import { btn, btnClass } from '../../ds';
import { IconStar } from '../../icons';
import { useStore } from '../../store';
import { Card, EmptyRow, LoadError, LoadingFigure, PageActions, SelectBox, SkeletonLines, StatusTabs, SummaryCard } from '../../ui';
import { useLoad } from '../../useLoad';
import { Modal } from '../kpiUi';
import * as L from '../look';
import { FeedCard, PinGlyph } from './feed/FeedCard';
import { FeedReports } from './feed/FeedReports';
import { PostInsights } from './feed/PostInsights';
import { dayInput, shortDate } from './feed/format';
import './feed/feed.css';
import '../look.css';

type Side = 'ins' | 'rep';

export function Feed() {
  const { flash, setView } = useStore();
  const [as, setAs] = useState<FeedAs>('all');
  const [side, setSide] = useState<Side>('ins');
  const [sel, setSel] = useState('');
  // Bumped after any change, so the tiles, the open post and the reports refetch.
  const [rev, setRev] = useState(0);
  const [pinFor, setPinFor] = useState<FeedCardDTO | null>(null);
  const [busy, setBusy] = useState('');

  const summary = useLoad(() => getFeedSummary(), [rev]);
  const feed = useFeedPages(as, rev);

  // Start on the first post. A post opened from a report may be further down
  // than the pages loaded so far, so a selection is never second-guessed.
  const posts = feed.posts;
  useEffect(() => {
    if (!sel && posts && posts.length > 0) setSel(posts[0].id);
  }, [posts, sel]);

  const changed = () => setRev((n) => n + 1);

  async function unpin(post: FeedCardDTO) {
    setBusy(post.id);
    try {
      await unpinFeedPost(post.id);
      flash('Unpinned. It moves back into date order.');
      changed();
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not unpin the post', 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove(post: FeedCardDTO) {
    if (
      !window.confirm(
        `Delete ${post.author.name}'s post from the feed? This cannot be undone. Its likes and comments go with it, and every open report about it is closed.`,
      )
    ) {
      return;
    }
    setBusy(post.id);
    try {
      await removeFeedPost(post.id);
      flash('Post removed from the feed');
      if (sel === post.id) setSel('');
      changed();
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not remove the post', 'error');
    } finally {
      setBusy('');
    }
  }

  const s = summary.data;
  const st = summary.state;
  const people = s?.people ?? [];
  const depts = [...new Set(people.map((p) => p.department || 'No department'))].sort();

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button className={btnClass()} style={btn()} onClick={() => setView('contests')}>
          <IconStar /> Contests
        </button>
      </PageActions>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="In the feed now" value={<LoadingFigure state={st}>{s?.total ?? 0}</LoadingFigure>} sub="Posts employees can scroll to" />
        <SummaryCard
          label="Pinned to the top"
          value={<LoadingFigure state={st}>{`${s?.pinned ?? 0} / ${s?.pinMax ?? 3}`}</LoadingFigure>}
          sub={`The feed leads with up to ${s?.pinMax ?? 3} pins`}
        />
        <SummaryCard
          label="Reported items to review"
          value={<LoadingFigure state={st}>{s?.reportsOpen ?? 0}</LoadingFigure>}
          sub={s && s.reportsOpen > 0 ? 'Open the Reports panel' : 'Nothing waiting'}
          onClick={() => setSide('rep')}
          active={side === 'rep'}
        />
      </div>

      <div className="fd-grid">
        <Card padded style={{ padding: 20 }}>
          <div className="fd-left">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={L.cardTitle}>As employees see it</div>
                <div style={L.cardNote}>Click a post for its insights</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
              <StatusTabs<'live'> options={['live']} active="live" onSelect={() => undefined} labels={{ live: 'Live' }} counts={{ live: s?.total ?? 0 }} />
              <SelectBox value={as} onChange={(v) => { setAs(v as FeedAs); setSel(''); }}>
                <option value="all">Everything (HR view)</option>
                <optgroup label="By who it went to">
                  <option value="company">Company-wide posts</option>
                  <option value="team">Team posts</option>
                  <option value="list">Private list posts</option>
                </optgroup>
                {depts.map((d) => (
                  <optgroup key={d} label={`As someone in ${d}`}>
                    {people
                      .filter((p) => (p.department || 'No department') === d)
                      .map((p) => (
                        <option key={p.userId} value={`person:${p.userId}`}>
                          {p.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </SelectBox>
            </div>

            <div className="af">
              <div className="af-bar">
                <span className="af-logo">sowaka</span>
                <span>{as.startsWith('person:') ? `${people.find((p) => `person:${p.userId}` === as)?.name ?? 'Their'} feed` : 'Connect · home feed'}</span>
              </div>
              {posts == null ? (
                feed.state === 'error' ? (
                  <div className="af-empty"><LoadError text="The feed could not be loaded." onRetry={feed.retry} compact /></div>
                ) : (
                  <div className="af-card"><SkeletonLines lines={6} /></div>
                )
              ) : posts.length === 0 ? (
                <div className="af-empty">{as === 'all' ? 'Nothing has been posted yet.' : 'No posts for this audience.'}</div>
              ) : (
                <>
                  {posts.map((post) => (
                    <FeedItem
                      key={post.id}
                      post={post}
                      on={sel === post.id}
                      busy={busy === post.id}
                      onSelect={() => { setSel(post.id); setSide('ins'); }}
                      onPin={() => setPinFor(post)}
                      onUnpin={() => unpin(post)}
                      onRemove={() => remove(post)}
                    />
                  ))}
                  {feed.hasMore && (
                    <button className={btnClass()} style={{ ...btn('secondary', 'sm'), alignSelf: 'center' }} onClick={feed.more} disabled={feed.loadingMore}>
                      {feed.loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>

        <Card padded style={{ padding: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <StatusTabs<Side>
              options={['ins', 'rep']}
              active={side}
              onSelect={setSide}
              labels={{ ins: 'Post insights', rep: 'Reports' }}
              counts={{ rep: s?.reportsOpen ?? 0 }}
            />
          </div>
          {side === 'rep' ? (
            <FeedReports
              rev={rev}
              onChanged={changed}
              onReview={(postId) => {
                setSel(postId);
                setSide('ins');
              }}
            />
          ) : sel ? (
            <PostInsights postId={sel} rev={rev} onChanged={changed} />
          ) : posts && posts.length === 0 ? (
            <EmptyRow text="No post selected. Pick a post in the feed to see its numbers." />
          ) : (
            <SkeletonLines lines={8} />
          )}
        </Card>
      </div>

      {pinFor && (
        <PinDialog
          post={pinFor}
          pinned={s?.pinned ?? 0}
          pinMax={s?.pinMax ?? 3}
          onClose={() => setPinFor(null)}
          onDone={() => {
            setPinFor(null);
            setSel(pinFor.id);
            changed();
          }}
        />
      )}
    </div>
  );
}

function FeedItem({
  post,
  on,
  busy,
  onSelect,
  onPin,
  onUnpin,
  onRemove,
}: {
  post: FeedCardDTO;
  on: boolean;
  busy: boolean;
  onSelect: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onRemove: () => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const sm = (kind: Parameters<typeof btn>[0]) => ({ ...btn(kind, 'sm'), height: 30, padding: '0 10px', opacity: busy ? 0.6 : 1 });
  return (
    <div
      className={`fd-it${on ? ' on' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <FeedCard post={post} />
      <div className="fd-ctl">
        <span className="fd-s" title="Likes">♥ {post.likeCount}</span>
        <span className="fd-s" title="Comments">💬 {post.commentCount}</span>
        <span className="sp" />
        {post.pinnedUntil ? (
          <button className={btnClass('ok')} style={sm('ok')} disabled={busy} onClick={stop(onUnpin)} aria-pressed>
            <PinGlyph size={13} /> Unpin
          </button>
        ) : (
          <button className={btnClass()} style={sm('secondary')} disabled={busy} onClick={stop(onPin)}>
            <PinGlyph size={13} /> Pin
          </button>
        )}
        <button className={btnClass('no')} style={sm('no')} disabled={busy} onClick={stop(onRemove)} aria-label="Remove post">
          Remove
        </button>
      </div>
    </div>
  );
}

function PinDialog({
  post,
  pinned,
  pinMax,
  onClose,
  onDone,
}: {
  post: FeedCardDTO;
  pinned: number;
  pinMax: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { flash } = useStore();
  // A contest stays pinned until it closes; anything else a week.
  const closes = post.body.challenge?.closesAt;
  const closesDay = closes && new Date(closes).getTime() > Date.now() ? dayInput(0, new Date(closes)) : '';
  const [until, setUntil] = useState(closesDay || dayInput(7));
  const [saving, setSaving] = useState(false);
  const today = dayInput(0);
  const full = pinned >= pinMax;
  const name = post.body.title || post.body.text.slice(0, 60) || post.tag;

  async function save() {
    if (!until || until < today) {
      flash('Pick today or a later date', 'error');
      return;
    }
    setSaving(true);
    try {
      // To the end of the picked day, local time.
      await pinFeedPost(post.id, new Date(`${until}T23:59:00`).toISOString());
      flash(`Pinned until ${shortDate(`${until}T23:59:00`, false)}`);
      onDone();
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not pin the post', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Pin to the top of the feed"
      onClose={onClose}
      width={520}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button className={btnClass()} style={btn()} onClick={onClose}>
            Cancel
          </button>
          <button className={btnClass('primary')} style={{ ...btn('primary'), opacity: saving || full ? 0.6 : 1 }} disabled={saving || full} onClick={save}>
            Pin post
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        “{name}” stays above everything else in {post.audience.kind === 'company' ? 'everyone’s' : `${post.audience.label}’s`} feed until the end of the day you pick.
      </p>
      <label style={L.label} htmlFor="fd-until">Pinned until</label>
      <input id="fd-until" className="lk-in" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} style={{ ...L.input, maxWidth: 220 }} />
      {full && (
        <div style={{ ...L.note, marginTop: 14 }}>
          {pinMax} posts are already pinned, the most the feed shows. Unpin one first.
        </div>
      )}
    </Modal>
  );
}

/** The feed a page at a time; a change of audience or `rev` starts again from the top. */
function useFeedPages(as: FeedAs, rev: number) {
  const [posts, setPosts] = useState<FeedCardDTO[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shownAs, setShownAs] = useState(as);
  const { flash } = useStore();

  useEffect(() => {
    let live = true;
    // On a refresh after an action the old list stays until the new one lands;
    // another audience is another feed, so that starts from the skeleton.
    if (shownAs !== as || attempt > 0) setPosts(null);
    setShownAs(as);
    setState('loading');
    getFeedPage(as)
      .then((page) => {
        if (!live) return;
        setPosts(page.posts);
        setCursor(page.nextCursor);
        setState('ready');
      })
      .catch(() => {
        if (!live) return;
        setPosts(null);
        setState('error');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [as, rev, attempt]);

  const more = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getFeedPage(as, cursor);
      setPosts((prev) => {
        const seen = new Set((prev ?? []).map((p) => p.id));
        return [...(prev ?? []), ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not load more posts', 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [as, cursor, flash]);

  return { posts, state, hasMore: Boolean(cursor), more, loadingMore, retry: () => setAttempt((n) => n + 1) };
}
