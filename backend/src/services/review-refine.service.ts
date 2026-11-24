/**
 * "Refine with Suwi" on a manager's review comment (24 Nov 2026, HR: record the review by voice, then refine
 * it with Suwi). The manager's own words, often dictated, are tidied into a clear review comment: the same
 * facts and judgement, no new claims, plain language, at least the 75 characters a sent review needs where
 * the original says enough. Only for someone reviewing their own direct report, the same rule the review has.
 */
import { users } from '../config/db';
import { callModel } from '../suwi/llm';
import { SUWI_SMALL_MODEL } from '../suwi/digest';

export class RefineError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); this.name = 'RefineError'; }
}

const SYSTEM = `You tidy a manager's performance review comment about one person on one KPI parameter.
Rules:
- Keep the manager's facts, examples and judgement. Never add events, numbers, praise or criticism they did not give.
- Fix grammar, filler words and repetition from dictation ("um", "like", repeated phrases). Plain, professional English, second or third person as the original uses.
- Match the score: do not make a low score sound positive or a high score sound negative.
- 2 to 4 sentences, at least 80 characters when the original gives enough to say; never pad with generic lines.
- If the original is empty or says nothing specific, return it unchanged.
Return only the comment text, no quotes, no preface.`;

export async function refineReviewNote(managerUserId: string, input: { employeeUserId?: unknown; parameter?: unknown; score?: unknown; text?: unknown }) {
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 3000) : '';
  if (!text) throw new RefineError(400, 'Write or record something first');
  const employeeUserId = String(input.employeeUserId ?? '');
  const employee = await users().findOne({ userId: employeeUserId }, { projection: { _id: 0, name: 1, managerUserId: 1 } });
  if (!employee || employee.managerUserId !== managerUserId) throw new RefineError(403, 'You can refine reviews of your direct reports only');
  const parameter = typeof input.parameter === 'string' ? input.parameter.slice(0, 120) : '';
  const score = Number(input.score);
  const reply = await callModel({
    model: SUWI_SMALL_MODEL,
    system: SYSTEM,
    maxTokens: 500,
    thinking: 'minimal',
    messages: [{ role: 'user', content: `Parameter: ${parameter || 'not named'}\nScore: ${score >= 1 && score <= 5 ? `${score} of 5` : 'not given'}\nThe manager's comment:\n${text}` }],
  });
  const refined = reply.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('').trim();
  return { text: refined || text };
}
