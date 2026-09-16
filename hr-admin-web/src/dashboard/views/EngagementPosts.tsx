// Engagement posts — the formats HR publishes into Connect for people to play
// with, as opposed to the announcements and celebrations the feed generates on
// its own. The picker is where new formats land.
import { useEffect, useRef, useState } from 'react';
import {
  deleteEngagementPost,
  getEngagementPosts,
  publishCaptionChallenge,
  type CaptionChallengeInput,
  type EngagementPostDTO,
} from '../../services/hrms';
import { ApiError } from '../../services/http';
import { useStore } from '../store';

const DEFAULTS: Record<string, { title: string; task: string }> = {
  caption_challenge: { title: 'Caption this', task: '' },
  photo_story_challenge: { title: 'Caught red handed', task: "Today's task: " },
  most_likely: { title: 'Most Likely', task: '' },
};

const emptyFor = (type: CaptionChallengeInput['type']): CaptionChallengeInput => ({
  type,
  title: DEFAULTS[type].title,
  task: DEFAULTS[type].task,
  pointsPerVote: 10,
  closesAt: '',
  photo: null,
  label: '',
  question: '',
});

const field = {
  width: '100%',
  border: '1px solid #EBEBEB',
  borderRadius: 10,
  padding: '10px 12px',
  font: 'inherit',
  boxSizing: 'border-box' as const,
};
const label = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: '#717171',
  marginBottom: 6,
};
const button = (bg: string, color = '#fff') => ({
  border: 'none',
  background: bg,
  color,
  borderRadius: 9,
  padding: '9px 14px',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
});

/** The formats on offer. Adding one means an entry here and its own field set. */
const FORMATS = [
  {
    key: 'caption_challenge' as const,
    name: 'Caption Challenge',
    icon: '💬',
    blurb: 'Post a picture. Everyone writes one caption, and votes decide the winner.',
  },
  {
    key: 'photo_story_challenge' as const,
    name: 'Caught Challenge',
    icon: '📸',
    blurb: 'Set a task. People go out and catch a photo, and tell the story behind it.',
  },
  {
    key: 'most_likely' as const,
    name: 'Most Likely',
    icon: '🫵',
    blurb: 'Ask a question. Nobody writes anything — they tag the colleague it fits.',
  },
];

export function EngagementPosts() {
  const { flash } = useStore();
  const [posts, setPosts] = useState<EngagementPostDTO[]>([]);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState<CaptionChallengeInput>(emptyFor('caption_challenge'));
  const [preview, setPreview] = useState<string | null>(null);
  // Held as two fields because that is how a date and a time are picked, and
  // joined into the single instant the API stores.
  const [closesDate, setClosesDate] = useState('');
  const [closesTime, setClosesTime] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setPosts(await getEngagementPosts());
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load engagement posts');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const set = <K extends keyof CaptionChallengeInput>(
    key: K,
    value: CaptionChallengeInput[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const pickPhoto = (file: File | null) => {
    set('photo', file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };

  const close = () => {
    setComposing(false);
    setForm(emptyFor('caption_challenge'));
    setPreview(null);
    setClosesDate('');
    setClosesTime('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const needsPhoto = form.type === 'caption_challenge';
  const isMostLikely = form.type === 'most_likely';

  const publish = async () => {
    if (needsPhoto && !form.photo) {
      flash('Add the picture people will be captioning');
      return;
    }
    if (isMostLikely && !form.question.trim()) {
      flash('Write the question people are tagging someone for');
      return;
    }
    if (!isMostLikely && !form.task.trim()) {
      flash('Describe what people are being asked to do');
      return;
    }
    if (closesDate && !closesTime) {
      flash('Pick a time for the closing date');
      return;
    }
    if (closesTime && !closesDate) {
      flash('Pick a date for the closing time');
      return;
    }
    // Local wall-clock, sent as an instant — whoever is reading the card sees
    // it in their own zone.
    const closesAt = closesDate
      ? new Date(`${closesDate}T${closesTime}`).toISOString()
      : '';
    if (closesDate && Number.isNaN(Date.parse(closesAt))) {
      flash('That closing date is not valid');
      return;
    }
    setBusy(true);
    try {
      await publishCaptionChallenge({ ...form, closesAt });
      close();
      await load();
      flash(`${FORMATS.find((f) => f.key === form.type)?.name} published to Connect`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (post: EngagementPostDTO) => {
    const entries = Number((post.body.entryCount as number) ?? 0);
    const warning = entries
      ? `Delete this challenge? ${entries} ${entries === 1 ? 'entry' : 'entries'} and the points they earned go with it.`
      : 'Delete this challenge?';
    if (!window.confirm(warning)) return;
    try {
      await deleteEngagementPost(post.id);
      await load();
      flash('Challenge deleted');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete');
    }
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <div style={{ fontSize: 13, color: '#717171' }}>
          {posts.length} published
        </div>
        {!composing && (
          <button style={button('#0571A6')} onClick={() => setComposing(true)}>
            New engagement post
          </button>
        )}
      </div>

      {composing && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #EBEBEB',
            borderRadius: 14,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            {FORMATS.map((format) => (
              <div
                key={format.key}
                onClick={() => setForm(emptyFor(format.key))}
                style={{
                  border:
                    form.type === format.key ? '1.5px solid #0571A6' : '1.5px solid #EBEBEB',
                  background: form.type === format.key ? '#F2F8FB' : '#fff',
                  borderRadius: 12,
                  padding: '12px 14px',
                  flex: 1,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {format.icon} {format.name}
                </div>
                <div style={{ fontSize: 12.5, color: '#717171', marginTop: 2 }}>
                  {format.blurb}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={label}>Heading</label>
              <input
                style={field}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Caption this"
              />
            </div>
            <div>
              <label style={label}>Points per vote</label>
              <input
                style={field}
                type="number"
                min={1}
                max={100}
                value={form.pointsPerVote}
                onChange={(e) => set('pointsPerVote', Number(e.target.value))}
              />
            </div>
          </div>

          {!isMostLikely && (
            <div style={{ marginTop: 14 }}>
              <label style={label}>Task</label>
              <textarea
                style={{ ...field, minHeight: 88, resize: 'vertical' }}
                value={form.task}
                onChange={(e) => set('task', e.target.value)}
                placeholder="What should be the description of the contest?"
              />
            </div>
          )}

          {isMostLikely && (
            <>
              <div style={{ marginTop: 14 }}>
                <label style={label}>Question label (small, above the question)</label>
                <input
                  style={field}
                  value={form.label}
                  onChange={(e) => set('label', e.target.value)}
                  placeholder="Lunch Thief"
                />
              </div>
              <div style={{ marginTop: 14 }}>
                <label style={label}>The question</label>
                <input
                  style={field}
                  value={form.question}
                  onChange={(e) => set('question', e.target.value)}
                  placeholder="Who is most likely to eat your lunch?"
                />
              </div>
              <div style={{ fontSize: 11.5, color: '#9197A2', marginTop: 8 }}>
                The lines around the question — &ldquo;Tag a colleague who is
                most likely to relate with the question.&rdquo; and
                &ldquo;Someone came to your mind immediately, tag them.&rdquo; —
                are the same on every Most Likely post and are written by the
                card itself.
              </div>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            <label style={label}>End on</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                style={field}
                type="date"
                value={closesDate}
                onChange={(e) => setClosesDate(e.target.value)}
              />
              <input
                style={field}
                type="time"
                value={closesTime}
                onChange={(e) => setClosesTime(e.target.value)}
              />
            </div>
            <div style={{ fontSize: 11.5, color: '#9197A2', marginTop: 5 }}>
              Entries and votes are refused after this. Leave both empty to
              keep the challenge open until you delete it.
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={label}>
              {needsPhoto ? 'Picture' : 'Picture — not needed for this format'}
            </label>
            {needsPhoto ? (
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                style={{ fontSize: 13 }}
              />
            ) : (
              <div style={{ fontSize: 12.5, color: '#717171' }}>
                {isMostLikely
                  ? 'Most Likely has no picture — the question card is the whole post.'
                  : 'Entrants supply their own photo with their story, so there is nothing to upload here.'}
              </div>
            )}
            {preview && (
              <img
                src={preview}
                alt=""
                style={{
                  display: 'block',
                  marginTop: 12,
                  width: 260,
                  height: 160,
                  objectFit: 'cover',
                  borderRadius: 12,
                  border: '1px solid #EBEBEB',
                }}
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              style={{ ...button('#0571A6'), opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? 'Publishing…' : 'Publish to Connect'}
            </button>
            <button style={button('#F1F1F4', '#484848')} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {posts.length === 0 && !composing && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #EBEBEB',
              borderRadius: 14,
              padding: '38px 20px',
              textAlign: 'center',
              color: '#717171',
              fontSize: 14,
            }}
          >
            Nothing published yet. A challenge gives the feed something to play
            with for a few days.
          </div>
        )}
        {posts.map((post) => {
          const entries = Number((post.body.entryCount as number) ?? 0);
          return (
            <div
              key={post.id}
              style={{
                background: '#fff',
                border: '1px solid #EBEBEB',
                borderRadius: 14,
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div style={{ fontSize: 22 }}>{post.tagIcon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {String(post.body.title ?? 'Caption this')}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: '#717171',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(post.body.task ?? post.body.question ?? '')}
                </div>
                <div style={{ fontSize: 12, color: '#9197A2', marginTop: 5 }}>
                  {entries} {entries === 1 ? 'entry' : 'entries'}
                  {post.body.closesAt
                    ? ` · closes ${new Date(String(post.body.closesAt)).toLocaleString(
                        undefined,
                        { dateStyle: 'medium', timeStyle: 'short' },
                      )}`
                    : ''}
                </div>
              </div>
              <button
                style={button('#FDECEC', '#B4231F')}
                onClick={() => void remove(post)}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
