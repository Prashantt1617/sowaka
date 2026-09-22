import { randomUUID } from 'node:crypto';
import { connectPosts, games, gameScores, users } from '../config/db';
import { ConnectPost } from '../models/connect.model';
import { Game } from '../models/game.model';
import { companyDisplayName } from './company-settings.service';

export class GameError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export interface GameInput {
  name?: string; description?: string; hostedUrl?: string; technology?: string;
  accentColor?: string; instructions?: string; active?: boolean;
}

async function adminOrg(userId: string) {
  const admin = await users().findOne({ userId });
  if (!admin) throw new GameError(404, 'Admin user not found');
  return admin.org ?? admin.email.split('@').at(1) ?? 'default';
}

function validateInput(input: GameInput, existing?: Game) {
  const name = input.name?.trim() ?? existing?.name ?? '';
  const description = input.description?.trim() ?? existing?.description ?? '';
  const hostedUrl = input.hostedUrl?.trim() ?? existing?.hostedUrl ?? '';
  if (!name) throw new GameError(400, 'Game name is required');
  if (!description) throw new GameError(400, 'Game description is required');
  let url: URL;
  try { url = new URL(hostedUrl); } catch { throw new GameError(400, 'Hosted URL is invalid'); }
  if (url.protocol !== 'https:') throw new GameError(400, 'Hosted URL must use HTTPS');
  const technology = input.technology ?? existing?.technology ?? 'vanilla_js';
  if (technology !== 'vanilla_js' && technology !== 'react_js') {
    throw new GameError(400, 'Technology must be vanilla_js or react_js');
  }
  const accentColor = input.accentColor?.trim() ?? existing?.accentColor ?? '#4F8C89';
  if (!/^#[0-9A-Fa-f]{6}$/.test(accentColor)) throw new GameError(400, 'Accent color is invalid');
  return { name: name.slice(0, 100), description: description.slice(0, 500), hostedUrl,
    technology: technology as Game['technology'], accentColor, instructions: input.instructions?.trim().slice(0, 1000) ?? existing?.instructions,
    active: input.active ?? existing?.active ?? true };
}

export async function listGamesForAdmin(adminUserId: string) {
  const org = await adminOrg(adminUserId);
  const list = await games().find({ org }).sort({ updatedAt: -1 }).toArray();
  return Promise.all(list.map(async (game) => ({ ...game, leaderboard: await leaderboard(game.id, org, 10) })));
}

export async function createGame(adminUserId: string, input: GameInput) {
  const org = await adminOrg(adminUserId); const now = new Date(); const values = validateInput(input);
  const game: Game = { id: randomUUID(), org, ...values, createdBy: adminUserId, createdAt: now, updatedAt: now };
  await games().insertOne(game); return game;
}

export async function updateGame(adminUserId: string, gameId: string, input: GameInput) {
  const org = await adminOrg(adminUserId); const existing = await games().findOne({ id: gameId, org });
  if (!existing) throw new GameError(404, 'Game not found');
  const values = validateInput(input, existing); const updatedAt = new Date();
  await games().updateOne({ id: gameId, org }, { $set: { ...values, updatedAt } });
  return { ...existing, ...values, updatedAt };
}

export async function deleteGame(adminUserId: string, gameId: string) {
  const org = await adminOrg(adminUserId); const result = await games().deleteOne({ id: gameId, org });
  if (!result.deletedCount) throw new GameError(404, 'Game not found');
  await gameScores().deleteMany({ gameId, org }); return { id: gameId };
}

export async function publishGame(adminUserId: string, gameId: string) {
  const org = await adminOrg(adminUserId); const game = await games().findOne({ id: gameId, org, active: true });
  if (!game) throw new GameError(404, 'Active game not found');
  const now = new Date();
  const post: ConnectPost = {
    id: randomUUID(), org, type: 'live_game', tag: 'Live Game', tagIcon: '🎮',
    tagColor: '#E0483B', tagTint: '#FBE2DE',
    // The company hosting the game, not the product running it.
    author: { userId: adminUserId, name: await companyDisplayName(org, 'Your company'), initials: 'G', designation: 'Auto · Games', avatarColor: game.accentColor },
    audience: { label: 'Company', org },
    body: { gameId: game.id, title: game.name, subtitle: game.description, hostedUrl: game.hostedUrl,
      technology: game.technology, accentColor: game.accentColor, instructions: game.instructions,
      startsAtLabel: 'PLAY NOW', actionLabel: 'Play now', actionDoneLabel: 'Played', leaderboardEnabled: true },
    likedBy: [], comments: [], actionBy: {}, pollVotes: {}, publishedAt: now, createdAt: now, updatedAt: now,
  };
  await connectPosts().insertOne(post); return post;
}

export async function getGameForPlayer(userId: string, gameId: string) {
  const user = await users().findOne({ userId }); if (!user) throw new GameError(404, 'User not found');
  const org = user.org ?? user.email.split('@').at(1) ?? 'default';
  const game = await games().findOne({ id: gameId, org, active: true });
  if (!game) throw new GameError(404, 'Game not found');
  return { game, leaderboard: await leaderboard(gameId, org, 20) };
}

export async function submitGameScore(userId: string, gameId: string, rawScore: unknown) {
  const user = await users().findOne({ userId }); if (!user) throw new GameError(404, 'User not found');
  const org = user.org ?? user.email.split('@').at(1) ?? 'default';
  if (!await games().findOne({ id: gameId, org, active: true })) throw new GameError(404, 'Game not found');
  const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
  if (!Number.isFinite(score) || score < 0 || score > 1_000_000_000) throw new GameError(400, 'Score is invalid');
  const normalized = Math.round(score); const now = new Date();
  const existing = await gameScores().findOne({ gameId, userId });
  if (!existing) {
    await gameScores().insertOne({ gameId, org, userId, playerName: user.name, score: normalized, achievedAt: now, updatedAt: now });
  } else if (normalized > existing.score) {
    await gameScores().updateOne({ gameId, userId, score: existing.score }, {
      $set: { score: normalized, playerName: user.name, achievedAt: now, updatedAt: now },
    });
  }
  return { score: normalized, leaderboard: await leaderboard(gameId, org, 20) };
}

async function leaderboard(gameId: string, org: string, limit: number) {
  const scores = await gameScores().find({ gameId, org }).sort({ score: -1, achievedAt: 1 }).limit(limit).toArray();
  return scores.map((entry, index) => ({ rank: index + 1, userId: entry.userId, playerName: entry.playerName,
    score: entry.score, achievedAt: entry.achievedAt }));
}
