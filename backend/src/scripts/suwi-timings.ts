/**
 * The last questions Suwi answered and how long each took: total, time to the first words, each model
 * round, each tool, and how it was answered (instant, model, or a kept answer).
 *
 *   node dist/scripts/suwi-timings.js [count] [org]      (on the server, with the backend's .env)
 */
import { connectDb, getDb } from '../config/db';

async function main() {
  const count = Math.min(200, Number(process.argv[2]) || 15);
  const org = process.argv[3];
  await connectDb();
  const rows = await getDb().collection('suwi_audit').find({ kind: 'question', ...(org ? { org } : {}) }).sort({ at: -1 }).limit(count).toArray();
  for (const r of rows) {
    const t = r.timing as { path?: string; totalMs?: number; firstTextMs?: number; rounds?: { ms: number; input: number; output: number }[] } | undefined;
    const tools = ((r.tools ?? []) as { name: string; ms: number }[]).map((x) => `${x.name} ${x.ms}ms`).join(', ');
    const rounds = (t?.rounds ?? []).map((x) => `${x.ms}ms (${x.input} in/${x.output} out)`).join(' + ');
    console.log(`${new Date(r.at).toISOString().slice(0, 19)} ${r.org} | ${t?.path ?? 'old'} | total ${t?.totalMs ?? '?'} ms${t?.firstTextMs !== undefined ? `, first words ${t.firstTextMs} ms` : ''} | "${String(r.question ?? '').slice(0, 60)}"${rounds ? ` | rounds ${rounds}` : ''}${tools ? ` | tools ${tools}` : ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
