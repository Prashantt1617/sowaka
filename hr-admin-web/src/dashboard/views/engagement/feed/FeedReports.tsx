// What employees reported from the app (was Dashboard › Moderate feed): one
// card per reported post or comment, with every report about it, its reasons
// and what HR can do. A report never removes anything on its own.
import { useMemo, useState } from 'react';
import { getContentReports, reviewContentReport, type ContentReportDTO } from '../../../../services/hrms';
import { removeFeedComment, removeFeedPost } from '../../../../services/engagement-feed';
import { Avatar, EmptyRow, ListPending, Pill, StatusTabs } from '../../../ui';
import { btn, btnClass } from '../../../ds';
import { useStore } from '../../../store';
import { useLoad } from '../../../useLoad';
import * as L from '../../look';
import { shortDate } from './format';

type Filter = 'open' | 'actioned' | 'dismissed' | 'all';

const STATUS_TONE: Record<ContentReportDTO['status'], { bg: string; fg: string }> = {
  open: L.TONES.warn,
  actioned: L.TONES.ok,
  dismissed: L.TONES.mute,
};
const STATUS_LABEL: Record<ContentReportDTO['status'], string> = {
  open: 'Needs review',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

type Group = { key: string; first: ContentReportDTO; reports: ContentReportDTO[]; open: ContentReportDTO[] };

export function FeedReports({ rev, onReview, onChanged }: { rev: number; onReview: (postId: string) => void; onChanged: () => void }) {
  const { flash } = useStore();
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState('');
  const list = useLoad(() => getContentReports(filter), [filter, rev]);

  // Several people can report the same thing: one card per target.
  const groups = useMemo<Group[]>(() => {
    const by = new Map<string, ContentReportDTO[]>();
    for (const r of list.data ?? []) {
      const key = `${r.postId}|${r.commentId ?? ''}`;
      by.set(key, [...(by.get(key) ?? []), r]);
    }
    return [...by.entries()]
      .map(([key, reports]) => ({ key, first: reports[0], reports, open: reports.filter((r) => r.status === 'open') }))
      .sort((a, b) => b.open.length - a.open.length || b.reports.length - a.reports.length);
  }, [list.data]);

  async function run(g: Group, job: () => Promise<unknown>, done: string) {
    setBusy(g.key);
    try {
      await job();
      flash(done);
      await list.reload();
      onChanged();
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not update the report', 'error');
    } finally {
      setBusy('');
    }
  }

  const close = (g: Group, status: 'actioned' | 'dismissed') =>
    run(
      g,
      () => Promise.all(g.open.map((r) => reviewContentReport(r.id, { status }))),
      status === 'actioned' ? 'Closed as actioned' : g.open.length > 1 ? 'Reports dismissed' : 'Report dismissed',
    );

  const remove = (g: Group) => {
    const r = g.first;
    const what = r.target === 'comment' ? 'comment' : 'post';
    if (
      !window.confirm(
        `Delete ${r.authorName}'s ${what} from the feed? This cannot be undone, and every open report about it is closed.`,
      )
    ) {
      return;
    }
    void run(
      g,
      () => (r.target === 'comment' && r.commentId ? removeFeedComment(r.postId, r.commentId) : removeFeedPost(r.postId)),
      r.target === 'comment' ? 'Comment removed' : 'Post removed from the feed',
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusTabs<Filter>
          options={['open', 'actioned', 'dismissed', 'all']}
          active={filter}
          onSelect={setFilter}
          labels={{ open: 'Needs review', actioned: 'Actioned', dismissed: 'Dismissed' }}
        />
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-3)' }}>
        Posts and comments employees reported from the app. A report never removes anything on its own.
      </p>

      {list.data == null ? (
        <ListPending state={list.state} onRetry={list.retry} rows={3} cols={2} rowHeight={92} />
      ) : groups.length === 0 ? (
        <EmptyRow
          text={
            filter === 'open'
              ? 'Nothing waiting for review. Employees can report a post or a comment from its menu in the app.'
              : 'Nothing here.'
          }
        />
      ) : (
        <div className="fd-reps">
          {groups.map((g) => (
            <ReportGroup
              key={g.key}
              g={g}
              busy={busy === g.key}
              onReview={() => onReview(g.first.postId)}
              onAction={() => close(g, 'actioned')}
              onDismiss={() => close(g, 'dismissed')}
              onRemove={() => remove(g)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportGroup({
  g,
  busy,
  onReview,
  onAction,
  onDismiss,
  onRemove,
}: {
  g: Group;
  busy: boolean;
  onReview: () => void;
  onAction: () => void;
  onDismiss: () => void;
  onRemove: () => void;
}) {
  const r = g.first;
  const reasons = [...new Set(g.reports.map((x) => x.reasonLabel))];
  const notes = g.reports.filter((x) => x.note);
  const status: ContentReportDTO['status'] = g.open.length ? 'open' : r.status;
  // An author can edit after a report, so both are shown when they differ.
  const edited =
    r.stillPresent && r.currentText.trim().length > 0 && !r.currentText.startsWith(r.excerpt.replace(/…$/, ''));
  const sb = (kind: Parameters<typeof btn>[0]) => ({ ...btn(kind, 'sm'), opacity: busy ? 0.6 : 1 });

  return (
    <article className="fd-rep">
      <div className="fd-rep-h">
        <Avatar name={r.authorName} size={34} />
        <div className="txt">
          <b>{r.authorName}</b>
          <span>
            {r.target === 'comment' ? 'Comment' : 'Post'}
            {r.postTag ? ` in ${r.postTag}` : ''} · first reported {shortDate(g.reports[g.reports.length - 1].createdAt)}
          </span>
        </div>
        <Pill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
        {!r.stillPresent && <Pill label="Already deleted" tone={L.TONES.mute} />}
      </div>

      <blockquote className="fd-quote">{r.excerpt || '(no text — see the post)'}</blockquote>
      {edited && (
        <div>
          <div style={{ ...L.eyebrow, marginBottom: 6 }}>What it says now</div>
          <blockquote className="fd-quote" style={{ color: 'var(--ink-3)' }}>{r.currentText}</blockquote>
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              <span style={{ color: 'var(--ink-3)' }}>{n.reporterName} added: </span>
              {n.note}
            </div>
          ))}
        </div>
      )}

      <div className="fd-rep-f">
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {g.reports.length} report{g.reports.length === 1 ? '' : 's'} by {[...new Set(g.reports.map((x) => x.reporterName))].join(', ')} ·
          {reasons.map((reason) => (
            <span key={reason} style={L.tag}>
              {reason}
            </span>
          ))}
        </span>
        {g.open.length > 0 ? (
          <div className="acts">
            {r.stillPresent && (
              <button className={btnClass()} style={sb('secondary')} disabled={busy} onClick={onReview}>
                Review
              </button>
            )}
            <button className={btnClass()} style={sb('secondary')} disabled={busy} onClick={onDismiss}>
              Dismiss
            </button>
            <button className={btnClass('primary')} style={sb('primary')} disabled={busy} onClick={onAction}>
              Mark actioned
            </button>
            {r.stillPresent && (
              <button className={btnClass('danger')} style={sb('danger')} disabled={busy} onClick={onRemove}>
                Remove
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {STATUS_LABEL[r.status]}
            {r.reviewedByName ? ` by ${r.reviewedByName}` : ''}
            {r.reviewedAt ? ` · ${shortDate(r.reviewedAt)}` : ''}
            {r.reviewNote ? ` · ${r.reviewNote}` : ''}
          </div>
        )}
      </div>
    </article>
  );
}
