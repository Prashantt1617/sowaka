import { randomUUID } from 'node:crypto';
import { connectPosts } from '../config/db';
import type { PokerEvent } from '../models/poker.model';
import { pokerResults } from './poker-db';
import { boardOf, officeLeague } from './poker-floor';

/**
 * The standings post for the feed: the top ten, the office league and the
 * day's biggest table, from Sowaka Engagements. Posted by the host
 * (`poker-event.ts post-standings`) or, when the event asks for it, on the
 * hour during open play.
 */
export async function standingsText(event: PokerEvent, now: number): Promise<string | null> {
  const results = await pokerResults().find({ eventId: event.id }, { projection: { _id: 0 } }).toArray();
  const board = boardOf(results, event.config);
  if (!board.length) return null;
  const time = new Date(now).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const fmt = (n: number) => n.toLocaleString('en-IN');
  const top = board.slice(0, 10).map((r) => `${r.rank}. ${r.name} — ${fmt(r.score)}`);
  const league = officeLeague(board).map((o, i) => `${i + 1}. ${o.office} ${fmt(o.average)}`);
  const biggest = results.filter((r) => r.round === 'open' && !r.voided).sort((a, b) => b.points - a.points)[0];
  const lines = [
    `♠ ${event.name}: standings at ${time}`,
    '',
    ...top,
    '',
    `Office league: ${league.join(' · ')}`,
    ...(biggest ? ['', `Biggest table so far: ${biggest.name}, ${fmt(biggest.points)} points.`] : []),
    '',
    'Tables are open in the Games tab. Sit down any time.',
  ];
  return lines.join('\n').slice(0, 1200);
}

export async function postStandings(event: PokerEvent, now: number): Promise<string | null> {
  const text = await standingsText(event, now);
  if (!text) return null;
  const id = randomUUID();
  const at = new Date(now);
  await connectPosts().insertOne({
    id,
    org: event.org,
    type: 'new_post',
    tag: 'New Post',
    tagIcon: '✍️',
    tagColor: '#BE5A36',
    tagTint: '#F6E5DB',
    author: { userId: '', name: 'Sowaka Engagements', initials: 'S', designation: 'Engagement', avatarColor: '#F5B82E' },
    audience: { label: 'Company', org: event.org },
    body: { postKind: 'text', text, mediaKind: 'none', mediaTitle: '', mediaDuration: '', linkUrl: '', linkTitle: '', linkDomain: '', sendTo: 'all_company', official: true },
    likedBy: [],
    comments: [],
    actionBy: {},
    pollVotes: {},
    publishedAt: at,
    createdAt: at,
    updatedAt: at,
  } as never);
  return id;
}
