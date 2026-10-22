import { useEffect, useState } from 'react';
import { createGame, deleteGame, GameDTO, GameInput, getGames, publishGame, updateGame } from '../../services/hrms';
import { ApiError } from '../../services/http';
import { useStore } from '../store';
import { Card, ListPending, LoadingFigure } from '../ui';
import type { LoadState } from '../ui';

const empty: GameInput = { name: '', description: '', hostedUrl: '', technology: 'vanilla_js', accentColor: '#4F8C89', instructions: '', active: true };
const field = { width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', font: 'inherit', boxSizing: 'border-box' as const };
const button = (bg: string, color = '#fff') => ({ border: 'none', background: bg, color, borderRadius: 999, padding: '9px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer' });

export function Games() {
  const { flash } = useStore();
  const [games, setGames] = useState<GameDTO[]>([]);
  const [editing, setEditing] = useState<GameDTO | 'new' | null>(null);
  const [form, setForm] = useState<GameInput>(empty);
  const [busy, setBusy] = useState(false);
  // Until the games have loaded once: a skeleton, then Retry if it failed.
  const [state, setState] = useState<LoadState>('loading');
  const load = async () => { try { setGames(await getGames()); setState('ready'); } catch (e) { setState((st) => (st === 'ready' ? st : 'error')); flash(e instanceof ApiError ? e.message : 'Could not load games', 'error'); } };
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
      <div style={{ color: 'var(--ink-3)', fontSize: 14 }}><LoadingFigure state={state} w={14} h={12}>{games.length}</LoadingFigure> hosted game{state === 'ready' && games.length === 1 ? '' : 's'}</div>
      <button onClick={() => open()} style={button('var(--accent)')}>＋ Add game</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 16 }}>
      {games.map((game) => <div key={game.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ height: 7, background: game.accentColor }} />
        <div style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><div style={{ fontSize: 17, fontWeight: 600 }}>🎮 {game.name}</div><div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{game.technology === 'react_js' ? 'REACT JS' : 'VANILLA JS'} · {game.active ? 'ACTIVE' : 'INACTIVE'}</div></div></div>
          <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.5, minHeight: 38 }}>{game.description}</p>
          <a href={game.hostedUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#4F8C89', wordBreak: 'break-all' }}>{game.hostedUrl}</a>
          <div style={{ marginTop: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 8 }}>LEADERBOARD</div>
            {(game.leaderboard ?? []).slice(0, 5).map((entry) => <div key={entry.userId} style={{ display: 'flex', padding: '5px 0', fontSize: 13 }}><b style={{ width: 28 }}>#{entry.rank}</b><span style={{ flex: 1 }}>{entry.playerName}</span><b>{entry.score.toLocaleString('en-IN')}</b></div>)}
            {(game.leaderboard ?? []).length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No scores yet.</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><button disabled={!game.active} onClick={() => void publish(game)} style={button(game.active ? '#4F8C89' : 'var(--ink-4)')}>Generate post</button><button onClick={() => open(game)} style={button('var(--surface-2)', 'var(--ink-2)')}>Edit</button><button onClick={() => void remove(game)} style={button('var(--bad-bg)', 'var(--bad)')}>Delete</button></div>
        </div>
      </div>)}
      {state !== 'ready' && <Card style={{ gridColumn: '1 / -1' }}><ListPending state={state} onRetry={() => { setState('loading'); void load(); }} rows={3} cols={2} rowHeight={90} /></Card>}
      {state === 'ready' && games.length === 0 && <div style={{ color: 'var(--ink-3)', padding: 30 }}>Add the first hosted game to generate a Connect post.</div>}
    </div>
    {editing && <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--scrim)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: 560, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', padding: 24 }}>
        <h2 style={{ margin: '0 0 18px' }}>{editing === 'new' ? 'Add hosted game' : 'Edit game'}</h2>
        <div style={{ display: 'grid', gap: 13 }}>
          <input style={field} placeholder="Game name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <textarea style={{ ...field, minHeight: 80 }} placeholder="Description shown in Connect" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input style={field} placeholder="https://username.github.io/game" value={form.hostedUrl} onChange={(e) => setForm({ ...form, hostedUrl: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><select style={field} value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value as GameInput['technology'] })}><option value="vanilla_js">Vanilla JS</option><option value="react_js">React JS</option></select><input type="color" style={{ ...field, height: 43 }} value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} /></div>
          <textarea style={{ ...field, minHeight: 70 }} placeholder="Optional play instructions" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          <label style={{ fontSize: 14 }}><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active and publishable</label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 20 }}><button onClick={() => setEditing(null)} style={button('var(--surface-2)', 'var(--ink-2)')}>Cancel</button><button disabled={busy} onClick={() => void save()} style={button('var(--accent)')}>{busy ? 'Saving…' : 'Save game'}</button></div>
      </div>
    </div>}
  </div>;
}
