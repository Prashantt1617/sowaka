import type { PathKey, PortalHome } from '../api/types';
import { addDays, fmtShort } from './format';

/** A home tile's icon: a number (steps left, videos), one of the portal's icons, or "@". */
export type TileIcon = { count: number } | { icon: 'play' | 'pen' | 'check' | 'calendar' } | { text: string };
export interface HomeTile {
  key: string;
  icon: TileIcon;
  title: string;
  sub: string;
  to?: string;
  askHr?: boolean;
}

const stateOf = (me: PortalHome, key: PathKey) => me.path.find((p) => p.key === key)?.state;

/** The day the Day-1 pass opens: its task's opensAt, else Tj − 7 (CONTRACT decision 4). */
export function passOpensOn(me: PortalHome): string {
  const t = me.tasks.find((x) => x.systemKey === 'day1_pass');
  return t?.opensAt ? t.opensAt.slice(0, 10) : addDays(me.tj, -7);
}

/**
 * The two tiles under Up next, from the real state (3Rb §5 · 7 draws them per view):
 * what is still to do first (About you, Meet the team, the letters when they can be
 * signed), then where things stand (letters signed; the Day-1 pass, open now or the
 * day it opens), then Ask HR. The hero's own item never gets a tile too. Tasks open
 * shows up to two of those; the other views one, then Ask HR.
 */
export function homeTiles(me: PortalHome, meetCount?: number): HomeTile[] {
  const state = (key: PathKey) => stateOf(me, key);
  const hero: PathKey | undefined = me.view === 'offer_updated' ? 'offer' : me.view === 'letter_ready' ? 'letter' : me.view === 'pass_unlocked' ? 'pass' : undefined;
  const todo: HomeTile[] = [];
  if (state('about') && state('about') !== 'done') todo.push({ key: 'about', icon: { count: 2 }, title: 'About you', sub: '2 quick steps', to: '/about' });
  if (state('meet') && state('meet') !== 'done') {
    todo.push({ key: 'meet', icon: meetCount ? { count: meetCount } : { icon: 'play' }, title: 'Meet the team', sub: meetCount ? `${meetCount} short videos` : 'Short videos', to: '/meet' });
  }
  if (hero !== 'letter' && (state('letter') === 'current' || state('letter') === 'todo')) {
    todo.push({ key: 'letter', icon: { icon: 'pen' }, title: 'Sign your letters', sub: 'Appointment letter and NDA', to: '/letters' });
  }
  const status: HomeTile[] = [];
  if (state('letter') === 'done') status.push({ key: 'letter-done', icon: { icon: 'check' }, title: 'Letters signed', sub: 'Saved in your documents', to: '/letters' });
  if (hero !== 'pass' && state('pass')) {
    const open = state('pass') !== 'locked';
    status.push({ key: 'pass', icon: { icon: 'calendar' }, title: 'Day-1 pass', sub: open ? 'Open now' : `Ready on ${fmtShort(passOpensOn(me))}`, to: '/pass' });
  }
  const ask: HomeTile = { key: 'ask', icon: { text: '@' }, title: 'Ask HR', sub: 'Send an email', askHr: true };
  if (me.view === 'tasks_open') return [...todo, ...status, ask].slice(0, 2);
  return [...[...todo, ...status].slice(0, 1), ask];
}
