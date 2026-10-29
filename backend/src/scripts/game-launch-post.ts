/**
 * Sowaka Engagements launching a game in a company's feed: a photo, GIF or
 * video, a title and a few words, and one button that opens the game. The
 * app draws it as its own card (`game_launch`), with no likes or comments,
 * and opens the game once however often the button is tapped.
 *
 * Run on the server (the database is production's; the local .env is not):
 *   node dist/scripts/game-launch-post.js post --org sowaka --game tile-up \
 *     --title "Tile Up is here" --caption "Scrabble with your colleagues. Start a room and invite them." \
 *     --media /tmp/tile-up.gif [--action "Play Tile Up"] [--pin-hours 24]
 *   node dist/scripts/game-launch-post.js list --org sowaka
 *   node dist/scripts/game-launch-post.js update --id <post id> [any of the flags below]
 *   node dist/scripts/game-launch-post.js unpost --id <post id>
 *
 * A tournament or a timed game: --starts 2026-10-29T18:00+05:30 puts a timer on
 * top of the card ("<game> starts in 01h 12m 05s"), then "Live now"; --ends
 * closes it ("This game has ended", the button off); --timer-label words it;
 * --lock-until-start keeps the button off until it starts. --enable-game
 * switches the game on for the company first (a tournament page is usually
 * off between events).
 *
 * Every colour on the card comes from here, as #RRGGBB or #AARRGGBB:
 *   --card-color --card-gradient "#a,#b" --border-color --text-color --muted-color
 *   --timer-bg --timer-color --timer-label-color --live-color
 *   --button-color --button-text-color
 * Anything left out keeps the card's light default (and the button the game's accent).
 *
 * --game is a catalog key the company has switched on (`companies.enabledGames`);
 * the post is refused otherwise, since its button would open nothing. --media is
 * a local .jpg/.png/.webp/.gif/.mp4/.mov file, optional. Nothing is pushed: the
 * post shows the next time the feed is read.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { companies, connectDb, connectPosts, gameCatalog } from '../config/db';
import type { ConnectPost } from '../models/connect.model';
import { deleteConnectMedia, uploadConnectMedia } from '../services/s3-connect-media.service';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function parse(argv: string[]) {
  const [command = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = 'true';
    else {
      flags[arg.slice(2)] = next;
      i++;
    }
  }
  return { command, flags };
}

const COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const THEME_FLAGS: Record<string, string> = {
  'card-color': 'card',
  'border-color': 'border',
  'text-color': 'text',
  'muted-color': 'muted',
  'timer-bg': 'timerBackground',
  'timer-color': 'timerText',
  'timer-label-color': 'timerLabel',
  'live-color': 'live',
  'button-color': 'button',
  'button-text-color': 'buttonText',
};

/** The colours given on the command line, checked; none given is an empty theme. */
function themeFrom(flags: Record<string, string>): Record<string, unknown> {
  const theme: Record<string, unknown> = {};
  for (const [flag, key] of Object.entries(THEME_FLAGS)) {
    const value = flags[flag]?.trim();
    if (value === undefined) continue;
    if (!COLOR.test(value)) throw new Error(`--${flag} must be #RRGGBB or #AARRGGBB`);
    theme[key] = value.toUpperCase();
  }
  if (flags['card-gradient'] !== undefined) {
    const stops = flags['card-gradient'].split(',').map((stop) => stop.trim());
    if (stops.length < 2 || !stops.every((stop) => COLOR.test(stop))) {
      throw new Error('--card-gradient must be two or more colours, comma separated');
    }
    theme.cardGradient = stops.map((stop) => stop.toUpperCase());
  }
  return theme;
}

/** A start or end time, with its zone: "2026-10-29T18:00+05:30". */
function timeFrom(flags: Record<string, string>, name: string): string | undefined {
  const value = flags[name]?.trim();
  if (value === undefined) return undefined;
  if (value === 'none') return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime()) || !/[+-]\d\d:?\d\d$|Z$/.test(value)) {
    throw new Error(`--${name} must be a time with its zone, e.g. 2026-10-29T18:00+05:30 (or none)`);
  }
  return at.toISOString();
}

/** What the card shows, from the flags given: only those are set. */
function bodyFrom(flags: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (flags.title !== undefined) body.title = flags.title.trim().slice(0, 80);
  if (flags.caption !== undefined) body.text = flags.caption.trim().slice(0, 600);
  if (flags.action !== undefined) body.actionLabel = flags.action.trim().slice(0, 40);
  if (flags['timer-label'] !== undefined) body.timerLabel = flags['timer-label'].trim().slice(0, 60);
  const startsAt = timeFrom(flags, 'starts');
  if (startsAt !== undefined) body.startsAt = startsAt;
  const endsAt = timeFrom(flags, 'ends');
  if (endsAt !== undefined) body.endsAt = endsAt;
  if (flags['lock-until-start'] !== undefined) body.lockUntilStart = flags['lock-until-start'] !== 'false';
  return body;
}

function need(flags: Record<string, string>, name: string): string {
  const value = (flags[name] ?? '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  await connectDb();
  switch (command) {
    case 'post': {
      const org = need(flags, 'org');
      const gameKey = need(flags, 'game');
      const title = need(flags, 'title').slice(0, 80);
      const caption = (flags.caption ?? '').trim().slice(0, 600);
      const company = await companies().findOne({ id: org }, { projection: { _id: 0, id: 1, enabledGames: 1 } });
      if (!company) throw new Error(`No company "${org}"`);
      const game = await gameCatalog().findOne({ key: gameKey }, { projection: { _id: 0, key: 1, name: 1, active: 1, accentColor: 1 } });
      if (!game || game.active === false) throw new Error(`No active catalog game "${gameKey}"`);
      if (!(company.enabledGames ?? []).includes(gameKey)) {
        if (flags['enable-game'] !== 'true') {
          throw new Error(`${org} does not have ${gameKey} switched on; its button would open nothing (add --enable-game to switch it on)`);
        }
        await companies().updateOne({ id: org }, { $addToSet: { enabledGames: gameKey } });
        console.log(`Switched ${gameKey} on for ${org}.`);
      }
      let media: Record<string, unknown> = { mediaKind: 'none' };
      if (flags.media) {
        const path = flags.media;
        const contentType = TYPES[extname(path).toLowerCase()];
        if (!contentType) throw new Error(`--media must be one of ${Object.keys(TYPES).join(' ')}`);
        const bytes = readFileSync(path);
        const uploaded = await uploadConnectMedia(
          'sowaka-engagements',
          { originalName: basename(path), contentType, size: statSync(path).size, bytes },
          contentType.startsWith('image/') ? 'post' : undefined,
        );
        if (!('objectKey' in uploaded) || !uploaded.objectKey) throw new Error('The media was not stored in S3');
        media = {
          mediaKind: contentType.startsWith('video/') ? 'video' : 'image',
          mediaObjectKey: uploaded.objectKey,
          mediaContentType: contentType,
          mediaSize: uploaded.size,
          mediaObjectKeys: [uploaded.objectKey],
          mediaContentTypes: [contentType],
        };
      }
      const timing = bodyFrom(flags);
      if (timing.startsAt && timing.endsAt && new Date(timing.endsAt as string) <= new Date(timing.startsAt as string)) {
        throw new Error('--ends must come after --starts');
      }
      const now = new Date();
      const pinHours = Number(flags['pin-hours'] ?? 0);
      const post: ConnectPost = {
        id: randomUUID(),
        org,
        type: 'game_launch',
        tag: 'Games',
        tagIcon: '🎮',
        tagColor: '#0571A6',
        tagTint: '#E8F3FA',
        // Faceless, like every Sowaka Engagements post: nobody to tap through to.
        author: { userId: '', name: 'Sowaka Engagements', initials: 'S', designation: 'Games', avatarColor: '#F5B82E' },
        audience: { label: 'Company', org },
        body: {
          gameKey,
          gameName: game.name,
          title,
          text: caption,
          actionLabel: (flags.action ?? `Play ${game.name}`).slice(0, 40),
          accentColor: game.accentColor ?? '#0571A6',
          ...bodyFrom(flags),
          theme: themeFrom(flags),
          ...media,
        },
        likedBy: [],
        comments: [],
        actionBy: {},
        pollVotes: {},
        publishedAt: now,
        pinnedUntil: pinHours > 0 ? new Date(now.getTime() + pinHours * 3_600_000) : null,
        createdAt: now,
        updatedAt: now,
      } as ConnectPost;
      await connectPosts().insertOne(post);
      console.log(`Posted ${post.id} to ${org}'s feed: "${title}" → ${gameKey}${pinHours > 0 ? `, pinned ${pinHours} h` : ''} (no push sent).`);
      break;
    }
    case 'list': {
      const org = need(flags, 'org');
      const rows = await connectPosts()
        .find({ org, type: 'game_launch' }, { projection: { _id: 0, id: 1, publishedAt: 1, pinnedUntil: 1, 'body.title': 1, 'body.gameKey': 1, 'body.mediaKind': 1 } })
        .sort({ publishedAt: -1 })
        .toArray();
      for (const row of rows) {
        const body = row.body as Record<string, unknown>;
        console.log(`${row.id}  ${row.publishedAt.toISOString()}  ${body.gameKey}  ${body.mediaKind}  "${body.title}"${row.pinnedUntil ? `  pinned until ${row.pinnedUntil.toISOString()}` : ''}`);
      }
      console.log(`${rows.length} game launch post(s) in ${org}.`);
      break;
    }
    case 'update': {
      const id = need(flags, 'id');
      const post = await connectPosts().findOne({ id, type: 'game_launch' });
      if (!post) throw new Error(`No game launch post ${id}`);
      const changes = bodyFrom(flags);
      const theme = themeFrom(flags);
      const current = post.body as Record<string, unknown>;
      const startsAt = (changes.startsAt ?? current.startsAt ?? '') as string;
      const endsAt = (changes.endsAt ?? current.endsAt ?? '') as string;
      if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new Error('--ends must come after --starts');
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(changes)) set[`body.${key}`] = value;
      for (const [key, value] of Object.entries(theme)) set[`body.theme.${key}`] = value;
      if (flags['reset-theme'] === 'true') {
        set['body.theme'] = theme;
        for (const key of Object.keys(theme)) delete set[`body.theme.${key}`];
      }
      if (flags['pin-hours'] !== undefined) {
        const hours = Number(flags['pin-hours']);
        set.pinnedUntil = hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null;
      }
      if (Object.keys(set).length === 1) throw new Error('Nothing to change: give a flag such as --title or --starts');
      // New times: the standings are for the new window, worked out again.
      const retimed = changes.startsAt !== undefined || changes.endsAt !== undefined;
      await connectPosts().updateOne({ id }, { $set: set, ...(retimed ? { $unset: { 'body.results': '', 'body.resultsWindow': '' } } : {}) });
      console.log(`Updated ${id}: ${Object.keys(set).filter((key) => key !== 'updatedAt').join(', ')}.`);
      break;
    }
    case 'unpost': {
      const id = need(flags, 'id');
      const post = await connectPosts().findOne({ id, type: 'game_launch' });
      if (!post) throw new Error(`No game launch post ${id}`);
      const keys = ((post.body as Record<string, unknown>).mediaObjectKeys as string[] | undefined) ?? [];
      await connectPosts().deleteOne({ id });
      await Promise.all(keys.map((key) => deleteConnectMedia(key).catch(() => undefined)));
      console.log(`Removed ${id} from ${post.org}'s feed${keys.length ? ' and its media' : ''}.`);
      break;
    }
    default:
      throw new Error('Commands: post, list, update, unpost (see the header of this file)');
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
