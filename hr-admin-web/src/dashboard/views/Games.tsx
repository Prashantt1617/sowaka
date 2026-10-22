import { useEffect, useState } from 'react';
import { createGame, deleteGame, GameDTO, GameInput, getGames, publishGame, updateGame } from '../../services/hrms';
import { ApiError } from '../../services/http';
import { useStore } from '../store';
import './look.css';

const empty: GameInput = { name: '', description: '', hostedUrl: '', technology: 'vanilla_js', accentColor: '#4F8C89', instructions: '', active: true };
const field = { width: '100%', minHeight: 42, border: '1px solid var(--line-2)', borderRadius: 12, padding: '10px 12px', font: 'inherit', fontSize: 13, lineHeight: '20px', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' as const };
const button = (bg: string, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, border: bg === 'var(--surface-2)' ? '1px solid var(--line-2)' : '1px solid transparent', background: bg === 'var(--surface-2)' ? 'var(--surface)' : bg === 'var(--accent)' ? 'var(--accent-grad)' : bg, color: bg === 'var(--surface-2)' ? 'var(--ink)' : color, borderRadius: 999, padding: '0 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' });

export function Games() {
  const { flash } = useStore();
  const [games, setGames] = useState<GameDTO[]>([]);
  const [editing, setEditing] = useState<GameDTO | 'new' | null>(null);
  const [form, setForm] = useState<GameInput>(empty);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setGames(await getGames()); } catch (e) { flash(e instanceof ApiError ? e.message : 'Could not load games', 'error'); } };
  useEffect(() => { void load(); }, []);
  const open = (game?: GameDTO) => {
    setEditing(game ?? 'new');
    setForm(game ? { name: game.name, description: game.description, hostedUrl: game.hostedUrl, technology: game.technology, accentColor: game.accentColor, instructions: game.instructions ?? '', active: game.active } : empty);
  };
  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'new') await createGame(form);
      else if (editing) await updateGame(editing.id, form);
      setEditing(null); await load(); flash('Game saved');
    } catch (e) { flash(e instanceof ApiError ? e.message : 'Could not save game', 'error'); }
    finally { setBusy(false); }
  };
  const remove = async (game: GameDTO) => {
    if (!window.confirm(`Delete ${game.name} and its leaderboard?`)) return;
    try { await deleteGame(game.id); await load(); flash('Game deleted'); } catch (e) { flash(e instanceof ApiError ? e.message : 'Could not delete game', 'error'); }
  };
  const publish = async (game: GameDTO) => {
    try { await publishGame(game.id); flash(`${game.name} published to Connect`); } catch (e) { flash(e instanceof ApiError ? e.message : 'Could not publish game', 'error'); }
  };

  return <div style={{ animation: 'fade .3s ease both' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <div style={{ color: 'var(--ink-3)', fontSize: 16, letterSpacing: '-.02em' }}>{games.length} hosted game{games.length === 1 ? '' : 's'}</div>
      <button onClick={() => open()} className="lk-btn-p" style={{ ...button('var(--accent)'), height: 40, padding: '0 16px', fontSize: 13, boxShadow: '0 8px 18px -10px var(--accent)' }}>＋ Add game</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 20 }}>
      {games.map((game) => <div key={game.id} style={{ background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
        <div style={{ height: 6, background: game.accentColor }} />
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>🎮 {game.name}</div><div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{game.technology === 'react_js' ? 'REACT JS' : 'VANILLA JS'} · {game.active ? 'ACTIVE' : 'INACTIVE'}</div></div></div>
          <p style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.5, minHeight: 38, margin: '10px 0' }}>{game.description}</p>
          <a href={game.hostedUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent-ink)', wordBreak: 'break-all' }}>{game.hostedUrl}</a>
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', color: 'var(--hi)', marginBottom: 8 }}>LEADERBOARD</div>
            {(game.leaderboard ?? []).slice(0, 5).map((entry) => <div key={entry.userId} style={{ display: 'flex', padding: '5px 0', fontSize: 13 }}><b style={{ width: 28 }}>#{entry.rank}</b><span style={{ flex: 1 }}>{entry.playerName}</span><b>{entry.score.toLocaleString('en-IN')}</b></div>)}
            {(game.leaderboard ?? []).length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No scores yet.</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><button disabled={!game.active} onClick={() => void publish(game)} style={button(game.active ? 'var(--accent)' : 'var(--ink-4)')}>Generate post</button><button onClick={() => open(game)} style={button('var(--surface-2)', 'var(--ink-2)')}>Edit</button><button onClick={() => void remove(game)} style={button('var(--bad-bg)', 'var(--bad)')}>Delete</button></div>
        </div>
      </div>)}
      {games.length === 0 && <div style={{ color: 'var(--ink-3)', padding: 30 }}>Add the first hosted game to generate a Connect post.</div>}
    </div>
    {editing && <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--scrim)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: 560, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', padding: 20 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>{editing === 'new' ? 'Add hosted game' : 'Edit game'}</h2>
        <div style={{ display: 'grid', gap: 14 }}>
          <input style={field} placeholder="Game name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <textarea style={{ ...field, minHeight: 80 }} placeholder="Description shown in Connect" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input style={field} placeholder="https://username.github.io/game" value={form.hostedUrl} onChange={(e) => setForm({ ...form, hostedUrl: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><select style={field} value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value as GameInput['technology'] })}><option value="vanilla_js">Vanilla JS</option><option value="react_js">React JS</option></select><input type="color" style={{ ...field, height: 43 }} value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} /></div>
          <textarea style={{ ...field, minHeight: 70 }} placeholder="Optional play instructions" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          <label style={{ fontSize: 13, color: 'var(--ink-2)' }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active and publishable</label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 20 }}><button onClick={() => setEditing(null)} style={button('var(--surface-2)', 'var(--ink-2)')}>Cancel</button><button disabled={busy} onClick={() => void save()} style={button('var(--accent)')}>{busy ? 'Saving…' : 'Save game'}</button></div>
      </div>
    </div>}
  </div>;
}
