// Engagement posts — the contests HR publishes into Connect for people to play
// with. The composer is the app's contest screen (contest_composer.dart,
// frames 3417:51828 and 3464:62471) at the phone's width: pick the format from
// the pills, write it straight onto a live preview of the card, choose how
// long it runs, and go live. The one thing the dashboard adds is the points
// per vote, which the app always leaves at 10.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  deleteEngagementPost,
  getEngagementPosts,
  publishCaptionChallenge,
  type EngagementPostDTO,
  type EngagementPostType,
} from '../../services/hrms';
import { ApiError } from '../../services/http';
import { useStore } from '../store';

const ICONS = '/engagement';
const SORA = "'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// The composer's palette (contest_composer.dart) and the card's
// (_EngagementColors in engagement_cards.dart).
const C = {
  ink: '#222222',
  secondary: '#484848',
  tertiary: '#717171',
  brand: '#0571A6',
  muted: '#96B7C7',
  surface: '#F7F7F9',
  border: '#EBEBEB',
  card: '#A08CFF',
  headerDivider: 'rgba(196, 181, 253, 0.4)',
  points: '#FFE786',
  onCard: '#EBEBEB',
  tile: '#EAEEEF',
  pickedRing: '#CEFCFA',
  pillSelected: '#DDDAFF',
};

/** The points a vote is worth, as the server clamps them (normalizePoints). */
const MIN_POINTS = 1;
const MAX_POINTS = 100;
const DEFAULT_POINTS = 10;

type Format = {
  type: EngagementPostType;
  label: string;
  icon: string;
  /** The heading a card falls back to — the same defaults the server applies. */
  defaultTitle: string;
};

/** The three formats, in the app's order (ContestFormat). */
const FORMATS: Format[] = [
  {
    type: 'caption_challenge',
    label: 'Caption This',
    icon: `${ICONS}/contest_caption.png`,
    defaultTitle: 'Caption this',
  },
  {
    type: 'photo_story_challenge',
    label: 'Best Photo',
    icon: `${ICONS}/contest_photo.png`,
    defaultTitle: 'Caught red handed',
  },
  {
    type: 'most_likely',
    label: 'Most Likely',
    icon: `${ICONS}/contest_most_likely.png`,
    defaultTitle: 'Most Likely',
  },
];

// Closing times read in India time, whatever zone the browser is in.
const IST_WEEKDAY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_CLOSES = new Intl.DateTimeFormat(undefined, { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** "Friday, 5 pm" / "Friday, 5:30 pm", as the app writes a closing time. */
function weekdayTime(when: Date) {
  const part = Object.fromEntries(IST_WEEKDAY_TIME.formatToParts(when).map((p) => [p.type, p.value]));
  const minute = part.minute === '00' ? '' : `:${part.minute}`;
  return `${part.weekday}, ${part.hour}${minute} ${part.dayPeriod.toLowerCase()}`;
}

/** Which of the two lengths a closing time matches, if either (_selectedDays). */
function selectedDays(closesAt: string): 1 | 2 | null {
  const when = Date.parse(closesAt);
  if (Number.isNaN(when)) return null;
  const hours = (when - Date.now()) / 3_600_000;
  if (hours > 0 && hours <= 24) return 1;
  if (hours > 24 && hours <= 48) return 2;
  return null;
}

const listButton = (bg: string, color = '#fff'): CSSProperties => ({
  border: 'none',
  background: bg,
  color,
  borderRadius: 9,
  padding: '9px 14px',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
});

const capsLabel: CSSProperties = {
  fontFamily: SORA,
  fontSize: 11,
  lineHeight: '16.5px',
  fontWeight: 600,
  letterSpacing: 0.9,
  color: C.tertiary,
  textTransform: 'uppercase',
};

export function EngagementPosts() {
  const { flash } = useStore();
  const [posts, setPosts] = useState<EngagementPostDTO[]>([]);

  const load = async () => {
    try {
      setPosts(await getEngagementPosts());
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load engagement posts', 'error');
    }
  };
  useEffect(() => {
    void load();
  }, []);

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
      flash(e instanceof ApiError ? e.message : 'Could not delete', 'error');
    }
  };

  return (
    <div
      style={{
        animation: 'fade .3s ease both',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 28,
      }}
    >
      <ContestComposer onPublished={load} />

      <div style={{ flex: '1 1 340px', minWidth: 0 }}>
        <div style={{ ...capsLabel, marginBottom: 10 }}>
          Already in the feed · {posts.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {posts.length === 0 && (
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
              Nothing published yet. A contest gives the feed something to play
              with for a day or two.
            </div>
          )}
          {posts.map((post) => {
            const entries = Number((post.body.entryCount as number) ?? 0);
            const points = Number(post.body.pointsPerVote ?? DEFAULT_POINTS);
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
                    {String(post.body.task || post.body.question || '')}
                  </div>
                  <div style={{ fontSize: 12, color: '#9197A2', marginTop: 5 }}>
                    {entries} {entries === 1 ? 'entry' : 'entries'} · {points} pts per vote
                    {post.body.closesAt
                      ? ` · closes ${IST_CLOSES.format(new Date(String(post.body.closesAt)))}`
                      : ''}
                  </div>
                </div>
                <button
                  style={listButton('#FDECEC', '#B4231F')}
                  onClick={() => void remove(post)}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ composer

/** The app's contest screen, at the phone's width, with points per vote. */
function ContestComposer({ onPublished }: { onPublished: () => Promise<void> }) {
  const { flash } = useStore();
  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [title, setTitle] = useState(FORMATS[0].defaultTitle);
  const [task, setTask] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Held as text so the field can be cleared while typing; read as a number.
  const [points, setPoints] = useState(String(DEFAULT_POINTS));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const pointsValue = Number(points);
  const pointsValid =
    points.trim() !== '' &&
    Number.isInteger(pointsValue) &&
    pointsValue >= MIN_POINTS &&
    pointsValue <= MAX_POINTS;

  // The app's _canPost, plus a points value the server will keep as given.
  const canPost =
    pointsValid &&
    (format.type === 'caption_challenge'
      ? title.trim() !== '' && photo !== null
      : format.type === 'photo_story_challenge'
        ? task.trim() !== ''
        : title.trim() !== '');
  const ready = canPost && !busy;

  const chooseFormat = (next: Format) => {
    if (next.type === format.type) return;
    // A name still at the old format's default follows the new format.
    if (title.trim() === '' || title.trim() === format.defaultTitle) {
      setTitle(next.defaultTitle);
    }
    setFormat(next);
  };

  const pickPhoto = (file: File | null) => {
    if (!file) return;
    setPhoto(file);
    setPhotoUrl(URL.createObjectURL(file));
    if (fileInput.current) fileInput.current.value = '';
  };

  const chooseDays = (days: 1 | 2) => {
    setClosesAt(new Date(Date.now() + days * 86_400_000).toISOString());
    setSheetOpen(false);
  };

  const reset = () => {
    setFormat(FORMATS[0]);
    setTitle(FORMATS[0].defaultTitle);
    setTask('');
    setClosesAt('');
    setPhoto(null);
    setPhotoUrl(null);
    setPoints(String(DEFAULT_POINTS));
  };

  const goLive = async () => {
    if (!ready) return;
    const name = title.trim();
    setBusy(true);
    try {
      await publishCaptionChallenge({
        type: format.type,
        // ContestDraft.body: Best Photo falls back to its default name.
        title:
          format.type === 'photo_story_challenge' ? name || format.defaultTitle : name,
        task: task.trim(),
        closesAt,
        pointsPerVote: pointsValue,
        photo: format.type === 'caption_challenge' ? photo : null,
      });
      reset();
      await onPublished();
      flash(`${format.label} is live in Connect`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not publish', 'error');
    } finally {
      setBusy(false);
    }
  };

  const closesText = Number.isNaN(Date.parse(closesAt))
    ? 'Click to select close time'
    : `Closes ${weekdayTime(new Date(closesAt))}`;

  const hint = !pointsValid
    ? `Points per vote must be a whole number from ${MIN_POINTS} to ${MAX_POINTS}.`
    : format.type === 'caption_challenge'
      ? !photo
        ? 'Upload the picture people will caption.'
        : !title.trim()
          ? 'Name the contest on the card.'
          : ''
      : format.type === 'photo_story_challenge'
        ? !task.trim()
          ? 'Write the task on the card.'
          : ''
        : !title.trim()
          ? 'Write the tag on the card.'
          : '';

  return (
    <div
      style={{
        flex: '0 0 auto',
        // The phone's 352 card plus its 20 either side and the panel's 1px rule.
        width: 394,
        maxWidth: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 24,
        padding: 20,
        fontFamily: SORA,
      }}
    >
      <div style={capsLabel}>Select the contest</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 8, marginTop: 8 }}>
        {FORMATS.map((f) => (
          <ContestPill
            key={f.type}
            format={f}
            selected={f.type === format.type}
            onClick={() => chooseFormat(f)}
          />
        ))}
      </div>

      <PointsField value={points} valid={pointsValid} onChange={setPoints} />

      <div style={{ marginTop: 22 }}>
        <PreviewCard
          points={pointsValid ? pointsValue : DEFAULT_POINTS}
          format={format}
          title={title}
          task={task}
          onTitle={setTitle}
          onTask={setTask}
          closesText={closesText}
          onTapCloses={() => setSheetOpen(true)}
          photoUrl={photoUrl}
          onPick={() => fileInput.current?.click()}
        />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
      />

      <button
        type="button"
        disabled={!ready}
        onClick={() => void goLive()}
        style={{
          display: 'block',
          width: '100%',
          marginTop: 32,
          padding: 16,
          border: 'none',
          borderRadius: 16,
          background: ready ? C.brand : C.muted,
          color: '#fff',
          fontFamily: SORA,
          fontSize: 16,
          lineHeight: '16.2px',
          fontWeight: 600,
          letterSpacing: -0.16,
          cursor: ready ? 'pointer' : 'default',
        }}
      >
        {busy ? 'Going live…' : 'Go live'}
      </button>
      <div
        style={{
          minHeight: 16,
          marginTop: 8,
          fontSize: 11.5,
          lineHeight: '16px',
          color: C.tertiary,
          textAlign: 'center',
        }}
      >
        {busy ? '' : hint}
      </div>

      {sheetOpen && (
        <CloseTimeSheet
          selected={selectedDays(closesAt)}
          onChoose={chooseDays}
          onDismiss={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/** One format pill (node 3417:53522): lilac and outlined in brand blue when chosen. */
function ContestPill({
  format,
  selected,
  onClick,
}: {
  format: Format;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        background: selected ? C.pillSelected : C.surface,
        border: `1.114px solid ${selected ? C.brand : C.border}`,
        borderRadius: 999,
        cursor: 'pointer',
        fontFamily: SORA,
      }}
    >
      <img src={format.icon} alt="" width={24} height={24} style={{ objectFit: 'cover' }} />
      <span
        style={{
          fontSize: 12,
          lineHeight: '18px',
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: selected ? C.brand : C.secondary,
        }}
      >
        {format.label}
      </span>
    </button>
  );
}

/** What a vote is worth: HR's to set here, 1–100 as the server clamps it. */
function PointsField({
  value,
  valid,
  onChange,
}: {
  value: string;
  valid: boolean;
  onChange: (value: string) => void;
}) {
  const current = Number(value);
  const step = (delta: number) => {
    const base = Number.isFinite(current) && value.trim() !== '' ? Math.round(current) : DEFAULT_POINTS;
    onChange(String(Math.min(MAX_POINTS, Math.max(MIN_POINTS, base + delta))));
  };
  const stepper: CSSProperties = {
    width: 34,
    height: 34,
    border: 'none',
    background: 'transparent',
    color: C.brand,
    fontSize: 18,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: SORA,
  };
  return (
    <div style={{ marginTop: 18 }}>
      <label htmlFor="contest-points" style={capsLabel}>
        Points per vote
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: '#fff',
            border: `1.114px solid ${valid ? C.border : '#E5484D'}`,
            borderRadius: 12,
          }}
        >
          <button type="button" aria-label="Fewer points" style={stepper} onClick={() => step(-1)}>
            −
          </button>
          <input
            id="contest-points"
            type="number"
            inputMode="numeric"
            min={MIN_POINTS}
            max={MAX_POINTS}
            step={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => {
              if (value.trim() === '' || !Number.isFinite(current)) onChange(String(DEFAULT_POINTS));
              else onChange(String(Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(current)))));
            }}
            style={{
              width: 48,
              border: 'none',
              outline: 'none',
              textAlign: 'center',
              fontFamily: SORA,
              fontSize: 15,
              fontWeight: 700,
              color: C.ink,
              background: 'transparent',
              MozAppearance: 'textfield',
            }}
          />
          <button type="button" aria-label="More points" style={stepper} onClick={() => step(1)}>
            +
          </button>
        </div>
        <span style={{ fontSize: 11.5, lineHeight: '15px', color: C.tertiary }}>
          {MIN_POINTS}–{MAX_POINTS}. Each vote an entry gets earns its author this many points.
        </span>
      </div>
    </div>
  );
}

/** A text field that is the card's own type, growing with what is typed. */
function CardField({
  value,
  onChange,
  placeholder,
  maxLength,
  singleLine,
  style,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  singleLine?: boolean;
  style: CSSProperties;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, style.fontSize]);
  return (
    <textarea
      ref={ref}
      className="contest-card-field"
      aria-label={ariaLabel}
      rows={1}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') e.preventDefault();
      }}
      style={{
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        padding: 0,
        margin: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        caretColor: '#fff',
        fontFamily: SORA,
        ...style,
      }}
    />
  );
}

/** The contest as it will look in the feed (node 3417:53527); it is the form. */
function PreviewCard({
  points,
  format,
  title,
  task,
  onTitle,
  onTask,
  closesText,
  onTapCloses,
  photoUrl,
  onPick,
}: {
  points: number;
  format: Format;
  title: string;
  task: string;
  onTitle: (value: string) => void;
  onTask: (value: string) => void;
  closesText: string;
  onTapCloses: () => void;
  photoUrl: string | null;
  onPick: () => void;
}) {
  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: C.card,
        borderRadius: 20,
        boxShadow: '0 4px 16px rgba(109, 40, 217, 0.10)',
      }}
    >
      {/* Placeholder colour for the fields typed on the card. */}
      <style>{`.contest-card-field::placeholder{color:rgba(255,255,255,0.6);opacity:1}
#contest-points::-webkit-inner-spin-button,#contest-points::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}`}</style>

      {/* _EngagementHeaderView */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '18px 12.915px 14px 22px',
          borderBottom: `1.129px solid ${C.headerDivider}`,
        }}
      >
        <img
          src={`${ICONS}/sowaka_logo.png`}
          alt=""
          width={48}
          height={48}
          style={{ borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }}
        />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
          <div
            style={{
              fontSize: 16,
              lineHeight: '24px',
              fontWeight: 600,
              letterSpacing: -0.16,
              color: '#fff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Sowaka Engagement
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <img src={`${ICONS}/star.png`} alt="" width={14} height={14} style={{ objectFit: 'contain' }} />
            <span
              style={{
                fontSize: 12,
                lineHeight: '16.2px',
                fontWeight: 600,
                letterSpacing: -0.16,
                color: C.points,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {points} pts per vote received
            </span>
          </div>
        </div>
        <img
          src={`${ICONS}/dots_menu_light.svg`}
          alt=""
          width={20}
          height={20}
          style={{ padding: 4, flex: '0 0 auto' }}
        />
      </div>

      <div style={{ padding: '14px 22px 18px' }}>
        {format.type === 'photo_story_challenge' ? (
          <div style={{ paddingTop: 4 }}>
            <CardField
              ariaLabel="Task"
              value={task}
              onChange={onTask}
              maxLength={400}
              placeholder="Post a photo of someone looking angry in the office."
              style={{
                fontSize: 20,
                lineHeight: 1.26,
                fontWeight: 600,
                letterSpacing: -0.16,
                color: C.onCard,
              }}
            />
          </div>
        ) : (
          <CardField
            ariaLabel="Contest name"
            value={title}
            onChange={onTitle}
            maxLength={80}
            singleLine
            placeholder={format.defaultTitle}
            style={{ fontSize: 24, lineHeight: '28px', fontWeight: 700, color: '#fff' }}
          />
        )}
        {format.type === 'most_likely' && (
          <div
            style={{
              paddingTop: 4,
              fontSize: 12,
              lineHeight: '16.2px',
              fontWeight: 600,
              letterSpacing: -0.16,
              color: C.onCard,
            }}
          >
            Nominate the teammate who fits this tag
          </div>
        )}
        <div style={{ paddingTop: 4 }}>
          <button
            type="button"
            onClick={onTapCloses}
            style={{
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: SORA,
              fontSize: 11,
              lineHeight: '16.5px',
              fontWeight: 400,
              color: C.onCard,
              textAlign: 'left',
            }}
          >
            {closesText}
          </button>
        </div>
        {format.type === 'caption_challenge' && (
          <CaptionCarousel photoUrl={photoUrl} onPick={onPick} />
        )}
      </div>
    </div>
  );
}

/** The upload tray from the exported art, cropped as the design crops it, at 56x59. */
function UploadTrayIcon({ scale = 1 }: { scale?: number }) {
  return (
    <div
      style={{
        width: 56 * scale,
        height: 59 * scale,
        overflow: 'hidden',
        position: 'relative',
        flex: '0 0 auto',
      }}
    >
      <img
        src={`${ICONS}/upload_image.png`}
        alt=""
        style={{
          position: 'absolute',
          left: -40 * scale,
          top: 0,
          width: 136 * scale,
          height: 100.5 * scale,
          maxWidth: 'none',
        }}
      />
    </div>
  );
}

/** The picture row (node 3417:53559): "Upload Image" until there is one, then
 * the picture in its thick frame with the upload tile peeking in to change it. */
function CaptionCarousel({ photoUrl, onPick }: { photoUrl: string | null; onPick: () => void }) {
  const framed = 210 + 12;
  const tucked = 20;
  // The row is the card's body: 352 less 22 either side.
  const rowWidth = 308;
  const peek = (rowWidth - framed) / 2 + 22;
  const tileButton: CSSProperties = {
    position: 'absolute',
    padding: 0,
    cursor: 'pointer',
    boxSizing: 'border-box',
    fontFamily: SORA,
  };
  return (
    <div style={{ position: 'relative', height: 196 }}>
      {photoUrl && (
        <button
          type="button"
          aria-label="Change picture"
          onClick={onPick}
          style={{
            ...tileButton,
            top: 16 + (176 - 135) / 2,
            left: `calc(50% + ${framed / 2 - tucked}px)`,
            width: tucked + peek + 24,
            height: 135,
            paddingLeft: tucked - 4,
            display: 'flex',
            alignItems: 'center',
            background: C.tile,
            borderRadius: 12,
            border: '4px solid #fff',
          }}
        >
          <span style={{ width: peek, display: 'flex', justifyContent: 'center' }}>
            <UploadTrayIcon scale={40 / 59} />
          </span>
        </button>
      )}
      {photoUrl ? (
        <button
          type="button"
          aria-label="Change picture"
          onClick={onPick}
          style={{
            ...tileButton,
            top: 16 + 8.5 - 6,
            left: `calc(50% - ${framed / 2}px)`,
            width: framed,
            height: 159 + 12,
            background: C.pickedRing,
            border: `6px solid ${C.pickedRing}`,
            borderRadius: 18,
            overflow: 'hidden',
          }}
        >
          <img
            src={photoUrl}
            alt="The picture to caption"
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 12,
            }}
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPick}
          style={{
            ...tileButton,
            top: 16 + 8.5,
            left: 'calc(50% - 105px)',
            width: 210,
            height: 159,
            background: C.tile,
            border: '6px solid #fff',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', left: 65, top: 9 }}>
            <UploadTrayIcon />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 90,
              textAlign: 'center',
              fontSize: 12,
              lineHeight: '13.333px',
              fontWeight: 600,
              color: C.secondary,
            }}
          >
            Upload Image
          </div>
          <div
            style={{
              position: 'absolute',
              left: 11,
              width: 175,
              top: 107,
              textAlign: 'center',
              fontSize: 10,
              lineHeight: '13.333px',
              fontWeight: 300,
              color: '#000',
            }}
          >
            Upload the image of your choice from the library.
          </div>
        </button>
      )}
    </div>
  );
}

/** "Select time — 1 day / 2 day" (node 3464:62883), as a sheet over the composer. */
function CloseTimeSheet({
  selected,
  onChoose,
  onDismiss,
}: {
  selected: 1 | 2 | null;
  onChoose: (days: 1 | 2) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const option = (days: 1 | 2) => {
    const on = (selected ?? 1) === days;
    return (
      <button
        type="button"
        onClick={() => onChoose(days)}
        style={{
          padding: '4px 14px',
          borderRadius: 10,
          border: `1px solid ${C.brand}`,
          background: on ? C.brand : 'transparent',
          color: on ? '#fff' : C.brand,
          fontFamily: SORA,
          fontSize: 16,
          lineHeight: '22px',
          fontWeight: 400,
          letterSpacing: 0.4,
          cursor: 'pointer',
        }}
      >
        {days} day
      </button>
    );
  };

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        animation: 'fade .2s ease both',
      }}
    >
      <div
        role="dialog"
        aria-label="Select time"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          minHeight: 137,
          boxSizing: 'border-box',
          paddingBottom: 24,
          background: '#fff',
          borderRadius: '28px 28px 0 0',
          boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, background: '#D1D5DB' }} />
        </div>
        <div style={{ padding: '8px 16px' }}>
          <div
            style={{
              fontSize: 16,
              lineHeight: '22px',
              fontWeight: 400,
              letterSpacing: 0.4,
              color: C.ink,
            }}
          >
            Select time
          </div>
          <div style={{ display: 'flex', gap: 26, marginTop: 8 }}>
            {option(1)}
            {option(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
