/**
 * Game voice (walkie-talkie) on a scratch database: one mic per table, a clip
 * goes to everyone else at the table and to nobody else, the limits, and the
 * company switch.
 *
 *   MONGODB_DB=game_voice_scratch npm run game-voice:check
 */
import { companies, connectDb, getDb } from '../config/db';
import { VoiceGame, VoiceTable, dropMic, holdMic, releaseMic, resetVoice, sendClip, voiceOn } from '../services/game-voice.service';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
}
async function refused(run: () => Promise<unknown>) {
  try { await run(); return { status: 0, message: '' }; }
  catch (error) { return { status: (error as { status?: number }).status ?? -1, message: (error as Error).message }; }
}

/** Two tables: Asha, Bala and Chitra at 4821; Dev alone at 5000. */
const tables: Record<string, VoiceTable> = {
  asha: { channel: 'pool:voiceco:4821', members: ['asha', 'bala', 'chitra'] },
  bala: { channel: 'pool:voiceco:4821', members: ['asha', 'bala', 'chitra'] },
  chitra: { channel: 'pool:voiceco:4821', members: ['asha', 'bala', 'chitra'] },
  dev: { channel: 'pool:voiceco:5000', members: ['dev'] },
};
const sent: Array<{ to: string; event: string; payload: Record<string, unknown> }> = [];
const game: VoiceGame = {
  async tableOf(_org, userId) { return tables[userId] ?? null; },
  emitTo(to, event, payload) { sent.push({ to, event, payload: payload as Record<string, unknown> }); },
};
const who = (userId: string, org = 'voiceco') => ({ org, userId, name: `${userId[0].toUpperCase()}${userId.slice(1)} Rao` });
const clip = (extra: Record<string, unknown> = {}) => ({ data: Buffer.alloc(3000, 7).toString('base64'), mime: 'audio/mp4', ms: 2400, ...extra });

(async () => {
  await connectDb();
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  await companies().insertMany([
    { id: 'voiceco', name: 'Voice Co', features: { gameVoice: true } },
    { id: 'quietco', name: 'Quiet Co' },
  ] as never);
  resetVoice();

  console.log('the switch');
  ok('on where the company has it', await voiceOn('voiceco'));
  ok('off where it does not', !(await voiceOn('quietco')));
  ok('a company without it cannot take the mic', (await refused(() => holdMic(game, who('asha', 'quietco')))).status === 403);

  console.log('one mic per table');
  const held = await holdMic(game, who('asha'));
  ok('Asha takes the mic for about 17 s', held.until - Date.now() > 16_000 && held.maxMs === 15_000, held);
  ok('the others hear "Asha is talking", Asha does not', sent.filter((s) => s.event === 'voice:floor').map((s) => s.to).sort().join() === 'bala,chitra'
    && sent.every((s) => s.payload.userId === 'asha'), sent);
  const busy = await refused(() => holdMic(game, who('bala')));
  ok('Bala cannot take it while Asha holds it', busy.status === 409 && /Asha is talking/.test(busy.message), busy);
  ok('another table has its own mic', (await holdMic(game, who('dev'))).until > Date.now());
  ok('nobody hears a table they are not at', !sent.some((s) => s.to === 'dev' && s.payload.userId === 'asha'));

  console.log('the clip');
  sent.length = 0;
  await sendClip(game, who('asha'), clip());
  const clips = sent.filter((s) => s.event === 'voice:clip');
  ok('goes to Bala and Chitra only, with who and how long', clips.map((s) => s.to).sort().join() === 'bala,chitra'
    && clips.every((s) => s.payload.userId === 'asha' && s.payload.name === 'Asha Rao' && s.payload.ms === 2400 && s.payload.mime === 'audio/mp4'), clips.map((s) => s.to));
  ok('and the mic is free again for them', sent.filter((s) => s.event === 'voice:floor').every((s) => s.payload.userId === null)
    && sent.filter((s) => s.event === 'voice:floor').length === 2);
  ok('a clip without the mic is refused', (await refused(() => sendClip(game, who('asha'), clip()))).status === 409);
  await holdMic(game, who('bala'));
  ok('Bala can talk now', true);
  ok('too short is refused (a tap)', (await refused(() => sendClip(game, who('bala'), clip({ ms: 200 })))).status === 400);
  await holdMic(game, who('bala'));
  ok('too big is refused', (await refused(() => sendClip(game, who('bala'), clip({ data: 'A'.repeat(170_000) })))).status === 400);
  await holdMic(game, who('bala'));
  ok('a format we do not play is refused', (await refused(() => sendClip(game, who('bala'), clip({ mime: 'text/html' })))).status === 400);
  await holdMic(game, who('bala'));
  ok('not base64 is refused', (await refused(() => sendClip(game, who('bala'), clip({ data: '<script>' })))).status === 400);

  console.log('letting go');
  await holdMic(game, who('chitra'));
  sent.length = 0;
  await releaseMic(game, who('chitra'));
  ok('a release frees the mic and tells the others', sent.filter((s) => s.event === 'voice:floor' && s.payload.userId === null).length === 2);
  await holdMic(game, who('asha'));
  await dropMic(game, 'voiceco', 'asha');
  ok('a dropped connection frees it too', (await holdMic(game, who('bala'))).until > Date.now());
  ok('someone not at a table cannot talk', (await refused(() => holdMic(game, who('nobody')))).status === 409);
  // Bala holds the mic, then leaves the table: the seat is gone before the release comes.
  await releaseMic(game, who('bala'));
  await holdMic(game, who('bala'));
  const before = tables.bala;
  delete tables.bala;
  sent.length = 0;
  await releaseMic(game, who('bala'));
  tables.bala = before;
  ok('a holder who has left the table still frees the mic for the others', sent.filter((s) => s.event === 'voice:floor' && s.payload.userId === null).map((s) => s.to).sort().join() === 'asha,chitra', sent);
  ok('and Asha can take it at once', (await holdMic(game, who('asha'))).until > Date.now());

  await db.dropDatabase();
  console.log(`\n${failed ? `${failed} failed, ` : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
