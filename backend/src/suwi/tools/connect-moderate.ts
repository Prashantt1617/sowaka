// Feed moderation from Suwi (24 Nov, HR: "Remove the reported comment"). connect_reports lists and sorts
// the reports; this prepares ONE card that acts on one or many of them, through the same services the
// dashboard uses: removing the reported post or comment (engagement-feed.service, which closes every open
// report about it), or closing the report without touching the content, as dismissed (nothing wrong) or
// handled (dealt with elsewhere) (connect-moderation.service's reviewContentReport). Connect has no
// "hide": content is either up or removed, and the card says which. Nothing changes until HR confirms.
// A removal cannot be undone (the app's own delete); closing a report can be (Undo reopens it).
import { users } from '../../config/db';
import { listContentReports, reviewContentReport } from '../../services/connect-moderation.service';
import { removeFeedComment, removeFeedPost } from '../../services/engagement-feed.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose, SuwiActionError } from '../proposals';

type Action = 'remove' | 'dismiss' | 'handled';
interface Report { id: string; postId: string; commentId: string | null; target: 'post' | 'comment'; author: string; text: string; reason: string }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function adminOf(userId: string) {
  const u = await users().findOne({ userId }, { projection: { _id: 0, userId: 1, org: 1, email: 1, name: 1 } });
  if (!u) throw new SuwiActionError(404, 'Your account was not found');
  return u;
}

defineTools({
  name: 'prepare_moderate_reports',
  area: 'connect',
  acts: true,
  label: (i) => `Prepared: ${str(i.action) === 'remove' ? 'remove reported content' : str(i.action) === 'dismiss' ? 'dismiss reports' : 'close reports'}`,
  description: "Prepare ONE card acting on one or many open Connect content reports (reportId from connect_reports; or author name, or all true for every open one). action remove: takes the reported post or comment down (a post goes with its comments and likes; a comment with its replies) and closes every open report about it; cannot be undone. action dismiss: closes the report as nothing wrong, the content stays up. action handled: closes it as dealt with (e.g. HR spoke to the author), the content stays up. Connect has no 'hide': for content that should not be seen, use remove. Changes nothing until HR confirms; Undo reopens dismissed or handled reports. Read the reports first with connect_reports.",
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['remove', 'dismiss', 'handled'] },
      reportIds: { type: 'array', items: { type: 'string' }, description: 'reportId values from connect_reports' },
      author: { type: 'string', description: "Only open reports about this person's posts or comments" },
      all: { type: 'boolean', description: 'Every open report (narrowed by author if given)' },
      note: { type: 'string', description: 'Review note kept on the report (max 1000 characters)' },
    },
    required: ['action'],
  },
  api: { method: 'PATCH', path: '/admin/connect/reports/x' },
  async run(ctx, i) {
    const raw = str(i.action);
    if (raw === 'hide') throw new Error('Connect has no hide: content is either up or removed. Use remove to take it down, or dismiss / handled to leave it up and close the report.');
    if (!['remove', 'dismiss', 'handled'].includes(raw)) throw new Error('action must be remove, dismiss or handled');
    const action = raw as Action;
    const ids = Array.isArray(i.reportIds) ? i.reportIds.map((x) => str(x, 80)).filter(Boolean) : [];
    const author = str(i.author, 80).toLowerCase();
    if (!ids.length && !author && !i.all) throw new Error('Say which reports: reportIds from connect_reports, an author, or all true');
    const reports = await listContentReports(ctx.userId, 'all');
    const skipped: { who: string; reason: string }[] = [];
    let chosen = reports.filter((r) => r.status === 'open');
    if (ids.length) {
      const set = new Set(ids);
      for (const id of ids) {
        const r = reports.find((x) => x.id === id);
        if (!r) skipped.push({ who: id, reason: 'No report with that id in your company' });
        else if (r.status !== 'open') skipped.push({ who: `${r.authorName}'s ${r.commentId ? 'comment' : 'post'}`, reason: `Already ${r.status}${r.reviewedByName ? ` by ${r.reviewedByName}` : ''}` });
      }
      chosen = chosen.filter((r) => set.has(r.id));
    }
    if (author) chosen = chosen.filter((r) => r.authorName.toLowerCase().includes(author));
    if (action === 'remove') {
      for (const r of chosen.filter((x) => !x.stillPresent)) skipped.push({ who: `${r.authorName}'s ${r.target}`, reason: 'Already gone (deleted by its author or HR): dismiss or mark it handled instead' });
      chosen = chosen.filter((r) => r.stillPresent);
    }
    if (!chosen.length) return { data: { prepared: false, message: 'No open report matches.', skipped } };
    const items: Report[] = chosen.slice(0, 100).map((r) => ({
      id: r.id, postId: r.postId, commentId: r.commentId ?? null, target: r.target, author: r.authorName,
      text: str(r.currentText || r.excerpt, 300), reason: r.reasonLabel,
    }));
    // What comes down: each post once; a comment only when its post is not coming down anyway.
    const posts = new Set(items.filter((x) => x.target === 'post').map((x) => x.postId));
    const comments = new Set(items.filter((x) => x.target === 'comment' && !posts.has(x.postId)).map((x) => `${x.postId}|${x.commentId}`));
    const note = str(i.note, 1000);
    const title = action === 'remove'
      ? `Remove ${[posts.size ? plural(posts.size, 'reported post') : '', comments.size ? plural(comments.size, 'reported comment') : ''].filter(Boolean).join(' and ')}`
      : `${action === 'dismiss' ? 'Dismiss' : 'Close as handled'} ${plural(items.length, 'report')}`;
    const proposalId = await propose(ctx, {
      kind: 'moderate_reports', area: 'connect', title,
      summary: action === 'remove'
        ? `${title} from Connect, for everyone, and close the ${plural(items.length, 'report')} about ${items.length === 1 ? 'it' : 'them'}.`
        : `${title}. The content stays up exactly as it is.`,
      lines: [
        ...items.slice(0, 8).map((x) => ({ text: `${x.author}'s ${x.target}${x.text ? `: "${x.text}"` : ''} (reported as ${x.reason}).` })),
        ...(items.length > 8 ? [{ text: `And ${items.length - 8} more (listed in the table).` }] : []),
        ...(action === 'remove'
          ? [
              { text: posts.size ? 'A removed post goes with its likes and comments; a removed comment goes with the replies under it.' : 'A removed comment goes with the replies under it; the post stays.', why: 'The same delete the app and the dashboard\'s feed use, so phones redraw the post at once.' },
              { text: 'Every other open report about the same content is closed too, as actioned.' },
              { text: 'Removal cannot be undone.', tone: 'warn' as const },
            ]
          : [
              { text: action === 'dismiss' ? 'Each report is closed as dismissed: nothing needed doing. The author and reporter are not notified.' : 'Each report is closed as actioned (handled): it was dealt with outside the feed. The author and reporter are not notified.' },
              { text: 'Undo reopens the reports.', tone: 'info' as const },
            ]),
        ...(note ? [{ text: `Review note kept on the report: "${note}"` }] : []),
        ...(skipped.length ? [{ text: `Left out: ${skipped.length} (listed under the table).`, tone: 'warn' as const }] : []),
      ],
      preview: { field: action === 'remove' ? 'Removed' : action === 'dismiss' ? 'Dismissed' : 'Handled', rows: items.map((x) => ({ name: x.author, current: `${x.target}: ${x.text || '(no text)'}`, next: action === 'remove' ? 'Removed' : action === 'dismiss' ? 'Dismissed, stays up' : 'Handled, stays up' })), skipped: skipped.slice(0, 100) },
      effectiveFrom: ctx.today, undoable: action !== 'remove', typeToConfirm: action === 'remove' && items.length >= 10 ? String(items.length) : undefined,
      payload: { byUserId: ctx.userId, action, note, items, posts: [...posts], comments: [...comments] },
    });
    return {
      data: { prepared: true, title, reports: items.map((x) => ({ reportId: x.id, author: x.author, target: x.target, text: x.text })), leftOut: skipped, note: 'Nothing changes until HR presses Confirm on the card.' },
      proposalId, links: [{ label: 'Open the feed', view: 'feed' }],
    };
  },
});

defineExecutor('moderate_reports', {
  async run(p) {
    const { byUserId, action, note, items, posts, comments } = p.payload as { byUserId: string; action: Action; note: string; items: Report[]; posts: string[]; comments: string[] };
    const failed: string[] = [];
    let done = 0;
    if (action === 'remove') {
      const admin = await adminOf(byUserId);
      for (const id of posts) {
        try { await removeFeedPost(admin, id); done++; } catch (e) { failed.push(`a post (${(e as Error).message})`); }
      }
      for (const key of comments) {
        const [postId, commentId] = key.split('|');
        try { await removeFeedComment(admin, postId, commentId); done++; } catch (e) { failed.push(`a comment (${(e as Error).message})`); }
      }
      // A note HR wrote goes on the reports the removal closed.
      if (note) for (const x of items) await reviewContentReport(byUserId, x.id, { status: 'actioned', note }).catch(() => undefined);
      return { message: `Removed ${done} of ${posts.length + comments.length} from Connect and closed their reports.${failed.length ? ` Not done: ${failed.join('; ')}.` : ''}` };
    }
    const status = action === 'dismiss' ? 'dismissed' : 'actioned';
    const closed: string[] = [];
    for (const x of items) {
      try { await reviewContentReport(byUserId, x.id, { status, note }); closed.push(x.id); done++; } catch (e) { failed.push(`${x.author}'s ${x.target} (${(e as Error).message})`); }
    }
    return { message: `${action === 'dismiss' ? 'Dismissed' : 'Closed as handled'} ${plural(done, 'report')}; the content stays up.${failed.length ? ` Not done: ${failed.join('; ')}.` : ''}`, undo: { closed } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const closed = (p.undo?.closed as string[] | undefined) ?? [];
    let n = 0;
    for (const id of closed) { try { await reviewContentReport(byUserId, id, { status: 'open', note: 'Reopened (undo via Suwi)' }); n++; } catch { /* gone */ } }
    return `Reopened ${plural(n, 'report')}.`;
  },
});
