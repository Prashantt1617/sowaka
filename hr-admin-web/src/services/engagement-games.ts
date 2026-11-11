// Dashboard › Engagement › Games: the company's games, who plays them and
// their tournaments. Read only; relay teams go through services/relay.ts.
import { api } from './http';

export type GameKind = 'Solo challenge' | 'Group game' | 'Live event';

export interface GameLine {
  key: string;
  name: string;
  tagline: string;
  description: string;
  instructions: string;
  kind: GameKind;
  accentColor: string | null;
  /** Only a picture the dashboard can load; otherwise the page draws its own tile. */
  thumbnail: string | null;
  scoring: { higherIsBetter: boolean; label: string } | null;
  /** On the app only while one is on. */
  liveOnly: boolean;
  /** Not in the company's catalog, but run as events (Hint Relay). */
  eventOnly?: boolean;
  tournaments: number;
  /** Still to come, or on now. */
  tournamentsOpen: number;
}

export interface GamePerson {
  id: string;
  name: string;
  department: string;
  location: string;
  manager: string;
  /** No longer at the company. */
  left?: boolean;
}

export interface GamesOverview {
  games: GameLine[];
  people: GamePerson[];
  /** [game index, person index, seconds since 1970], oldest first. */
  plays: [number, number, number][];
  /** [person index, points games paid them]. */
  board: [number, number][];
}

export interface BoardRow {
  rank: number;
  userId: string;
  name: string;
  department: string;
  best: number | null;
  bestAt: string | null;
  points: number;
  plays: number;
  lastAt: string | null;
}

export interface Standing {
  place: number;
  userId?: string;
  name: string;
  detail: string;
}

export interface Tournament {
  id: string;
  type: 'cup' | 'poker' | 'relay' | 'squad' | 'launch';
  name: string;
  state: 'upcoming' | 'live' | 'done' | 'cancelled';
  phase: string;
  format: string;
  startsAt: string | null;
  endsAt: string | null;
  players: number;
  winner: string | null;
  standings: Standing[];
  /** A knockout the Tournament TV can show. */
  tv?: boolean;
}

export interface GameDetail {
  game: Omit<GameLine, 'tournaments' | 'tournamentsOpen'>;
  board: { by: 'best' | 'points'; label: string; higherIsBetter: boolean; rows: BoardRow[] };
  tournaments: Tournament[];
}

export function getGamesOverview() {
  return api<GamesOverview & { success: boolean }>('/admin/engagement/games');
}

export function getGameDetail(key: string) {
  return api<GameDetail & { success: boolean }>(`/admin/engagement/games/${encodeURIComponent(key)}`);
}
