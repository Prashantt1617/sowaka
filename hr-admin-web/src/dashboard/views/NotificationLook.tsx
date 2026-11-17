// Setup › Notifications › Sounds and pictures: how each kind of push sounds and
// looks on people's phones. One row per kind (a contest posted, closing soon,
// results; a tournament's lobby, your match, bets, the champion; everything
// else): a sound with a play button, a picture (the post's own, or one uploaded
// here) and a switch. The words of each push stay as the server writes them.
// Phones download new sounds by themselves; one that has not yet plays its own
// sound. Saved on the company (/admin/notification-look).
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useStore } from '../store';
import { Card, LoadError, SkeletonForm, Th } from '../ui';
import { TH, TR, btn, btnClass, cellName, cellSub, hint } from '../ds';
import { mediaUrl } from '../../services/api';
import {
  getNotificationLook,
  saveNotificationLook,
  uploadNotificationPicture,
  uploadNotificationSound,
} from '../../services/notificationLook';
import type { KindLook, KindRow, NotificationKind, NotificationLookDTO, NotificationSound } from '../../services/notificationLook';
import './people.css';

type Draft = Record<NotificationKind, KindLook>;
const draftOf = (d: NotificationLookDTO): Draft => Object.fromEntries(d.kinds.map((k) => [k.kind, { ...k.look }])) as Draft;
const same = (a: KindLook, b: KindLook) => JSON.stringify(a) === JSON.stringify(b);
const COLS = '1.35fr 1.1fr 1.25fr 64px';

/** Where a sound plays from: a built-in one from the dashboard's own copy, an uploaded one from the API. */
function soundSrc(sound: NotificationSound): string {
  return sound.builtIn || !sound.url ? `${import.meta.env.BASE_URL}notification-sounds/${sound.key}.wav` : mediaUrl(sound.url);
}

export function NotificationLook() {
  const { flash } = useStore();
  const [data, setData] = useState<NotificationLookDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string>('');
  // Pictures uploaded since the page opened: their preview, by media key.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [soundName, setSoundName] = useState('');
  const soundFile = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    getNotificationLook()
      .then((d) => { if (live) { setData(d); setDraft(draftOf(d)); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load notification sounds'); });
    return () => { live = false; };
  }, [attempt]);

  useEffect(() => () => { player.current?.pause(); }, []);

  if (error) return <Card><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></Card>;
  if (!data || !draft) return <Card style={{ padding: 22 }}><SkeletonForm fields={8} /></Card>;

  const saved = draftOf(data);
  const changed = data.kinds.filter((k) => !same(draft[k.kind], saved[k.kind])).map((k) => k.kind);
  const dirty = changed.length > 0;
  const set = (kind: NotificationKind, patch: Partial<KindLook>) => setDraft({ ...draft, [kind]: { ...draft[kind], ...patch } });

  const play = (sound: NotificationSound | undefined) => {
    player.current?.pause();
    if (!sound || playing === sound.key) { setPlaying(''); return; }
    const audio = new Audio(soundSrc(sound));
    player.current = audio;
    setPlaying(sound.key);
    audio.onended = () => setPlaying((k) => (k === sound.key ? '' : k));
    audio.play().catch(() => { setPlaying(''); flash('That sound could not be played here', 'error'); });
  };

  const save = async () => {
    setSaving(true);
    try {
      const byKind = new Map(data.kinds.map((k) => [k.kind, k]));
      // A kind put back exactly as the default is stored as "the default".
      const body = Object.fromEntries(changed.map((k) => [k, same(draft[k], byKind.get(k)!.defaultLook) ? null : draft[k]]));
      const next = await saveNotificationLook(body);
      setData(next);
      setDraft(draftOf(next));
      flash('Saved. The next notifications go out with these sounds and pictures.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickPicture = async (kind: NotificationKind, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(kind);
    try {
      const { objectKey, url } = await uploadNotificationPicture(file);
      setPreviews((p) => ({ ...p, [objectKey]: mediaUrl(url) }));
      set(kind, { pictureKey: objectKey });
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not upload the picture', 'error');
    } finally {
      setUploading('');
    }
  };

  const addSound = async () => {
    const file = soundFile.current?.files?.[0];
    if (!file) { flash('Choose a WAV file first', 'error'); return; }
    const name = soundName.trim() || file.name.replace(/\.[^.]+$/, '');
    setUploading('sound');
    try {
      const sound = await uploadNotificationSound(file, name);
      const next = await getNotificationLook();
      setData(next);
      // Keep what is being edited; only the list of sounds is new.
      setSoundName('');
      if (soundFile.current) soundFile.current.value = '';
      flash(`${sound.name} added${sound.version > 1 ? ` (version ${sound.version})` : ''}. Phones download it the next time the app opens.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not upload the sound', 'error');
    } finally {
      setUploading('');
    }
  };

  const pictureOf = (row: KindRow) => {
    const key = draft[row.kind].pictureKey;
    if (!key) return '';
    if (previews[key]) return previews[key];
    return key === data.kinds.find((k) => k.kind === row.kind)?.look.pictureKey && row.pictureUrl ? mediaUrl(row.pictureUrl) : '';
  };

  return (
    <Card padded>
      <div style={{ display: 'grid', gap: 20 }}>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: 780, lineHeight: 1.55 }}>
          How each kind of notification sounds and looks on people’s phones. The words stay as Sowaka writes them.
          A phone plays a new sound once the app has downloaded it (the next time it opens); until then it plays its own.
          Pictures show on Android now, and on iPhone from the next app release.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={TH(COLS)}>
              <Th>NOTIFICATION</Th>
              <Th>SOUND</Th>
              <Th>PICTURE</Th>
              <Th>ON</Th>
            </div>
            {data.kinds.map((row, i) => {
              const look = draft[row.kind];
              const sound = data.sounds.find((s) => s.key === look.sound);
              const picture = pictureOf(row);
              const isDefault = same(look, row.defaultLook);
              return (
                <div key={row.kind} style={{ ...TR(COLS, i === data.kinds.length - 1), opacity: look.enabled ? 1 : 0.6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={cellName}>{row.label}</div>
                    <div style={{ ...cellSub, marginTop: 2 }}>{row.when}</div>
                    <div style={{ ...cellSub, marginTop: 4 }}>
                      {isDefault
                        ? 'Sowaka’s default'
                        : <button type="button" onClick={() => set(row.kind, { ...row.defaultLook })} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'var(--accent-ink)', cursor: 'pointer' }}>Changed · use default</button>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span className="pd-pick" style={{ flex: 1, minWidth: 0 }}>
                      <select id={`look-${row.kind}-sound`} aria-label={`${row.label}: sound`} value={look.sound ?? ''} disabled={!look.enabled}
                        onChange={(e) => set(row.kind, { sound: e.target.value || null })} className="pd-inp" style={{ height: 38 }}>
                        <option value="">Phone’s own sound</option>
                        {data.sounds.map((s) => <option key={s.key} value={s.key}>{s.name}{s.builtIn ? '' : ' (uploaded)'}</option>)}
                      </select>
                    </span>
                    <button type="button" aria-label={playing === sound?.key ? 'Stop' : `Play ${sound?.name ?? 'sound'}`} disabled={!sound}
                      onClick={() => play(sound)} className={btnClass()} style={{ ...btn('secondary', 'sm'), width: 38, height: 38, padding: 0, justifyContent: 'center' }}>
                      {playing === sound?.key ? '■' : '▶'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                    {row.hasOwnPicture && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
                        <input type="checkbox" checked={look.ownPicture} disabled={!look.enabled} onChange={(e) => set(row.kind, { ownPicture: e.target.checked })} />
                        {row.kind.startsWith('cup_') ? 'The tournament’s own picture' : 'The contest’s own picture'}
                      </label>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {picture
                        ? <img src={picture} alt="" style={{ width: 64, height: 32, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
                        : look.pictureKey ? <span style={hint}>Picture chosen</span> : null}
                      <label className={btnClass()} style={{ ...btn('secondary', 'sm'), cursor: look.enabled ? 'pointer' : 'default' }}>
                        {uploading === row.kind ? 'Uploading…' : look.pictureKey ? 'Change' : row.hasOwnPicture && look.ownPicture ? 'Upload one for when there is none' : 'Upload a picture'}
                        <input type="file" accept="image/jpeg,image/png" disabled={!look.enabled || uploading !== ''} onChange={(e) => void pickPicture(row.kind, e)} style={{ display: 'none' }} />
                      </label>
                      {look.pictureKey && (
                        <button type="button" onClick={() => set(row.kind, { pictureKey: null })} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12.5, color: 'var(--accent-ink)', cursor: 'pointer' }}>Remove</button>
                      )}
                    </div>
                  </div>
                  <button type="button" id={`look-${row.kind}-on`} role="switch" aria-checked={look.enabled} aria-label={`${row.label}: sound and picture`}
                    onClick={() => set(row.kind, { enabled: !look.enabled })}
                    style={{ width: 38, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', transition: 'background .15s', display: 'flex', background: look.enabled ? 'var(--accent)' : 'var(--line-2)', justifyContent: look.enabled ? 'flex-end' : 'flex-start' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ ...hint, marginTop: -8 }}>Off: the notification still goes out, with the phone’s own sound and no picture. Pictures: JPEG or PNG, wide (2:1), under 1 MB is best.</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving || !dirty} onClick={() => void save()} className={btnClass('primary')} style={btn('primary')}>{saving ? 'Saving…' : 'Save'}</button>
          {dirty && <button type="button" onClick={() => setDraft(draftOf(data))} className={btnClass()} style={btn()}>Undo changes</button>}
        </div>
        <div style={{ display: 'grid', gap: 12, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Your own sounds</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 720 }}>
            A WAV file, 30 seconds or shorter (a second or two is best) and under 1 MB. Give it the name of a sound above (say “Chime”) to replace that one for your company.
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input id="look-sound-name" value={soundName} onChange={(e) => setSoundName(e.target.value.slice(0, 40))} placeholder="Name, e.g. Diwali drum" className="pd-inp" style={{ width: 240, height: 38 }} aria-label="Sound name" />
            <input ref={soundFile} id="look-sound-file" type="file" accept="audio/wav,audio/x-wav,.wav" aria-label="WAV file" style={{ fontSize: 13 }} />
            <button type="button" disabled={uploading !== ''} onClick={() => void addSound()} className={btnClass()} style={btn()}>{uploading === 'sound' ? 'Uploading…' : 'Add sound'}</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.sounds.map((s) => (
              <button key={s.key} type="button" onClick={() => play(s)} className={btnClass()} style={btn('secondary', 'sm')} aria-label={`${playing === s.key ? 'Stop' : 'Play'} ${s.name}`}>
                {playing === s.key ? '■' : '▶'} {s.name}{s.builtIn ? '' : ` · v${s.version}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
