// Engagement › Feed › Post the app tour: HR puts an invitation to the app's
// Sowaka tour in everyone's feed. The app draws it as its own card (a picture,
// a title, a caption and a button that opens the tour's start card); the
// preview here and the feed column's card draw it the same way, from
// `AppTourArt` and `AppTourCardBody`, so a new design changes one place.
import { useEffect, useMemo, useState } from 'react';
import globePng from '../../../../assets/app-tour-globe.png';
import planePng from '../../../../assets/app-tour-plane.png';
import { ApiError } from '../../../../services/http';
import { getAppTourStatus, postAppTour, type AppTourWords } from '../../../../services/engagement-feed';
import { useAuth } from '../../../auth/AuthContext';
import { useBrand } from '../../../brand';
import { btn, btnClass } from '../../../ds';
import { ORG_DISPLAY_NAME } from '../../../org';
import { useStore } from '../../../store';
import { SkeletonLines } from '../../../ui';
import { useLoad } from '../../../useLoad';
import { Modal } from '../../kpiUi';
import * as L from '../../look';
import { shortDate } from './format';

/** The tour's own blues (the app's start card). */
const TOUR_BLUE = '#0B6FAA';
const TOUR_PANEL = '#EEF5FB';

const LIMITS = { title: 80, caption: 300, actionLabel: 24 } as const;

/**
 * The post's picture: HR's own, or until there is one the tour's start-card
 * art (its globe and paper plane on the tour's pale blue), as the app draws it.
 */
export function AppTourArt({ src }: { src?: string }) {
  if (src) {
    return (
      <div style={{ borderRadius: 12, overflow: 'hidden', background: 'var(--surface-2)' }}>
        <img src={src} alt="" style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      style={{ borderRadius: 12, background: TOUR_PANEL, aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}
    >
      <div style={{ position: 'relative', width: 112, height: 112 }}>
        <img src={globePng} alt="" style={{ position: 'absolute', inset: 0, width: 112, height: 112 }} />
        <img src={planePng} alt="" style={{ position: 'absolute', left: 58, top: 2, width: 52, height: 57 }} />
      </div>
    </div>
  );
}

/** Everything under the author row: picture, title, caption, the button. */
export function AppTourCardBody({ words, imageSrc }: { words: AppTourWords; imageSrc?: string }) {
  return (
    <>
      <AppTourArt src={imageSrc} />
      {words.title && <div className="af-t">{words.title}</div>}
      {words.caption && <p className="af-b">{words.caption}</p>}
      <span className="af-cta" style={{ background: TOUR_BLUE }}>
        {words.actionLabel || 'Get tour'}
      </span>
    </>
  );
}

export function AppTourDialog({ onClose, onPosted }: { onClose: () => void; onPosted: (postId: string) => void }) {
  const { flash } = useStore();
  const brand = useBrand();
  const { user } = useAuth();
  // The post is from the company, under its own name, as the app shows it.
  const companyName = brand.name ?? user?.company ?? ORG_DISPLAY_NAME;
  const status = useLoad(() => getAppTourStatus(), []);
  const defaults = status.data?.defaults;
  const current = status.data?.current ?? null;
  const [words, setWords] = useState<AppTourWords | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  // The server's words to start from, once they are in.
  useEffect(() => {
    if (defaults && !words) setWords({ ...defaults });
  }, [defaults, words]);

  const imageSrc = useMemo(() => (image ? URL.createObjectURL(image) : undefined), [image]);
  useEffect(() => () => {
    if (imageSrc) URL.revokeObjectURL(imageSrc);
  }, [imageSrc]);

  const set = (patch: Partial<AppTourWords>) => setWords((w) => (w ? { ...w, ...patch } : w));

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      flash('Pick a JPEG, PNG or WEBP picture', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      flash('The picture must be 50 MB or smaller', 'error');
      return;
    }
    setImage(file);
  }

  const blocked = Boolean(current) && !replace;
  const ready = Boolean(words && words.title.trim() && words.caption.trim() && words.actionLabel.trim());

  async function post() {
    if (!words || !ready || blocked) return;
    setSaving(true);
    try {
      const done = await postAppTour(
        { title: words.title.trim(), caption: words.caption.trim(), actionLabel: words.actionLabel.trim() },
        image,
        Boolean(current) && replace,
      );
      flash(done.replaced.length > 0 ? 'Posted. The earlier app tour post is gone from the feed.' : 'Posted to everyone’s feed');
      onPosted(done.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Someone posted one meanwhile: show it and ask again.
        void status.reload().catch(() => undefined);
      }
      flash(error instanceof Error ? error.message : 'Could not post the app tour', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Post the app tour"
      subtitle="A card in everyone’s feed whose button opens the app’s Sowaka tour"
      onClose={onClose}
      width={880}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>
            Goes to everyone in the company, from the company. No push is sent.
          </span>
          <button className={btnClass()} style={btn()} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnClass('primary')}
            style={{ ...btn('primary'), opacity: saving || !ready || blocked ? 0.6 : 1 }}
            disabled={saving || !ready || blocked}
            onClick={post}
          >
            {saving ? 'Posting…' : 'Post to feed'}
          </button>
        </>
      }
    >
      {!words ? (
        status.state === 'error' ? (
          <div style={L.note}>Could not load the app tour post. Close this and try again.</div>
        ) : (
          <SkeletonLines lines={6} />
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {current && (
              <div style={L.note}>
                <div style={{ marginBottom: 8 }}>
                  An app tour post is already in the feed: “{current.title || 'App tour'}”, posted {shortDate(current.publishedAt)}.
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} style={{ marginTop: 2 }} />
                  Replace it. The one in the feed is deleted, with its likes and comments.
                </label>
              </div>
            )}
            <div>
              <label style={L.label} htmlFor="at-title">Title</label>
              <input id="at-title" className="lk-in" style={L.input} value={words.title} maxLength={LIMITS.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div>
              <label style={L.label} htmlFor="at-caption">Caption</label>
              <textarea id="at-caption" className="lk-in" style={L.textarea} value={words.caption} maxLength={LIMITS.caption} onChange={(e) => set({ caption: e.target.value })} />
            </div>
            <div>
              <label style={L.label} htmlFor="at-label">Button label</label>
              <input id="at-label" className="lk-in" style={{ ...L.input, maxWidth: 220 }} value={words.actionLabel} maxLength={LIMITS.actionLabel} onChange={(e) => set({ actionLabel: e.target.value })} />
            </div>
            <div>
              <div style={L.label}>Picture (optional)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label className={btnClass()} style={{ ...btn('secondary', 'sm'), cursor: 'pointer' }}>
                  {image ? 'Change picture' : 'Upload a picture'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} style={{ display: 'none' }} />
                </label>
                {image && (
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--accent-ink)', cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div style={{ ...L.cardNote, marginTop: 6 }}>
                {image ? image.name : 'Without one, the app draws the tour’s globe and plane. JPEG, PNG or WEBP, shown 16:9.'}
              </div>
            </div>
          </div>

          <div>
            <div style={{ ...L.label, marginBottom: 8 }}>Preview</div>
            <div className="af" style={{ minHeight: 0, maxHeight: 'none' }}>
              <article className="af-card">
                <div className="af-h">
                  <span
                    aria-hidden
                    style={{ width: 40, height: 40, borderRadius: 20, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flex: 'none', background: TOUR_BLUE }}
                  >
                    {companyName.trim().slice(0, 1).toUpperCase() || 'S'}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="nm">{companyName}</div>
                    <small>HR · now</small>
                  </div>
                </div>
                <AppTourCardBody words={words} imageSrc={imageSrc} />
              </article>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
