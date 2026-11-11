// A game's tile, drawn like the app's. The catalog's own picture when the
// dashboard can load it; the app's bundled pictures (assets/…) it cannot, so
// the known games get a drawing of their tile and any other a lettered one.
import type { ReactElement } from 'react';
import type { GameLine } from '../../../../services/engagement-games';

const word = (letters: string[], colors: string[]) =>
  letters.map((l, i) => (
    <g key={i}>
      <rect x={8 + i * 12} y={24} width={11} height={14} rx={2} fill={colors[i]} />
      <text x={13.5 + i * 12} y={34.5} fontSize={8} fontWeight={800} fill="#fff" textAnchor="middle">{l}</text>
    </g>
  ));

const DRAWN: Record<string, ReactElement> = {
  pool: (
    <svg viewBox="0 0 64 64" aria-hidden><rect x="0" y="0" width="64" height="64" fill="#1F6B45" /><rect x="6" y="14" width="52" height="36" rx="6" fill="#174F33" /><rect x="10" y="18" width="44" height="28" rx="3" fill="#2E8B5A" /><circle cx="20" cy="32" r="3.5" fill="#fff" /><circle cx="38" cy="27" r="3.5" fill="#F2C94C" /><circle cx="43" cy="36" r="3.5" fill="#E05A4F" /><circle cx="33" cy="38" r="3.5" fill="#1A1A2E" /><path d="M12 42 24 33" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
  ),
  'speed-poker': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#1E5E3A" /><rect x="18" y="16" width="18" height="26" rx="3" fill="#fff" transform="rotate(-12 27 29)" /><rect x="30" y="16" width="18" height="26" rx="3" fill="#fff" transform="rotate(10 39 29)" /><text x="23" y="30" fontSize="11" fontWeight="800" fill="#1A1A2E" transform="rotate(-12 27 29)">A</text><text x="36" y="31" fontSize="11" fontWeight="800" fill="#D33" transform="rotate(10 39 29)">K</text><circle cx="18" cy="50" r="4" fill="#E05A4F" /><circle cx="46" cy="50" r="4" fill="#3B82F6" /></svg>
  ),
  'tile-up': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#F7F1DE" />{word(['W', 'O', 'R', 'D'], ['#2B2A4A', '#F2A93B', '#2B2A4A', '#E86FA3'])}<path d="M10 18l3-3 3 3" stroke="#2B2A4A" strokeWidth="2" fill="none" /></svg>
  ),
  'sky-hop': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#6D5BD0" /><rect x="0" y="48" width="64" height="16" fill="#3E9A5A" /><rect x="14" y="0" width="8" height="22" fill="#4FB08A" /><rect x="14" y="34" width="8" height="14" fill="#4FB08A" /><rect x="40" y="0" width="8" height="16" fill="#4FB08A" /><rect x="40" y="28" width="8" height="20" fill="#4FB08A" /><circle cx="30" cy="27" r="4" fill="#F2C94C" /><circle cx="52" cy="12" r="5" fill="#F9D976" opacity=".8" /></svg>
  ),
  scribble: (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#2B2A4A" /><rect x="14" y="14" width="36" height="36" rx="4" fill="#FFF8E7" /><circle cx="26" cy="28" r="6" fill="#F2A93B" /><path d="M20 44c4-8 16-8 22 0" stroke="#1A1A2E" strokeWidth="2" fill="none" /><path d="M42 38l6 6-3 3-6-6z" fill="#E86FA3" /></svg>
  ),
  'word-trip': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#2B2A4A" /><circle cx="32" cy="32" r="16" fill="none" stroke="#F2C94C" strokeWidth="6" />{([['W', 32, 15], ['O', 49, 32], ['R', 32, 49], ['D', 15, 32]] as const).map(([l, x, y]) => <g key={l}><rect x={x - 6} y={y - 6} width={12} height={12} rx={2} fill="#F2C94C" /><text x={x} y={y + 3.5} fontSize={8} fontWeight={800} fill="#2B2A4A" textAnchor="middle">{l}</text></g>)}</svg>
  ),
  trails: (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#FFF8E7" /><path d="M16 20h30v12H18v12h28" stroke="#4FB08A" strokeWidth="7" fill="none" strokeLinejoin="round" />{([[16, 20, '1'], [32, 32, '2'], [46, 44, '3']] as const).map(([x, y, n]) => <g key={n}><circle cx={x} cy={y} r={6} fill="#1A1A2E" /><text x={x} y={y + 3} fontSize={7} fontWeight={800} fill="#fff" textAnchor="middle">{n}</text></g>)}</svg>
  ),
  'odd-one-out': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#FFF8E7" />{([[20, 22], [42, 22], [20, 44]] as const).map(([x, y]) => <g key={`${x}${y}`}><rect x={x - 9} y={y - 9} width={18} height={18} rx={4} fill="#F2C94C" /><circle cx={x} cy={y} r={4.5} fill="#1A1A2E" /></g>)}<rect x="33" y="35" width="18" height="18" rx="4" fill="#E86FA3" /><path d="M42 39l6 10h-12z" fill="#fff" /></svg>
  ),
  'hint-relay': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#0571A6" /><circle cx="20" cy="26" r="7" fill="#E7F2F7" /><circle cx="44" cy="26" r="7" fill="#E7F2F7" /><path d="M10 48c2-8 18-8 20 0M34 48c2-8 18-8 20 0" fill="#E7F2F7" /><path d="M27 20h10l-3-3M37 32H27l3 3" stroke="#F2C94C" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  'secret-squad': (
    <svg viewBox="0 0 64 64" aria-hidden><rect width="64" height="64" fill="#1A1A2E" /><path d="M14 30c4-10 32-10 36 0" fill="#F2C94C" /><rect x="12" y="28" width="40" height="5" rx="2.5" fill="#F2C94C" /><circle cx="24" cy="40" r="6" fill="none" stroke="#fff" strokeWidth="3" /><circle cx="40" cy="40" r="6" fill="none" stroke="#fff" strokeWidth="3" /><path d="M30 40h4" stroke="#fff" strokeWidth="3" /></svg>
  ),
};

/** The drawing for a game, by its key or, for a key spelt differently, by its name. */
function drawnFor(game: Pick<GameLine, 'key' | 'name'>): ReactElement | null {
  if (DRAWN[game.key]) return DRAWN[game.key];
  const byName = game.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (DRAWN[byName]) return DRAWN[byName];
  if (byName.includes('pool')) return DRAWN.pool;
  return null;
}

export function GameIcon({ game, size }: { game: Pick<GameLine, 'key' | 'name' | 'thumbnail' | 'accentColor'>; size?: 'xs' | 'lg' | 'xl' }) {
  const drawn = game.thumbnail ? null : drawnFor(game);
  return (
    <span className={`eg-ic${size ? ` ${size}` : ''}`} aria-hidden>
      {game.thumbnail ? (
        <img src={game.thumbnail} alt="" loading="lazy" />
      ) : (
        drawn ?? (
          <span className="eg-letter" style={{ background: game.accentColor || 'var(--accent)', fontSize: size === 'xs' ? 11 : 24 }}>
            {game.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
        )
      )}
    </span>
  );
}

/** The game's own colour for its bars and buttons, or the dashboard's. */
export const accentOf = (game: Pick<GameLine, 'accentColor'>) =>
  game.accentColor && /^#[0-9a-fA-F]{6}$/.test(game.accentColor) ? game.accentColor : 'var(--accent)';
