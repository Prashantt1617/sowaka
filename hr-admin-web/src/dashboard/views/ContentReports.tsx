// What employees have reported from the Connect feed, and what HR did about it.
//
// A report is a complaint from one colleague about another, so the view leads
// with the words that were reported rather than with counts: the decision is
// always about the content, and the queue is short by design.
import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyRow, Pill, StatusTabs } from '../ui';
import { useStore } from '../store';
import {
  getContentReports,
  removeReportedPost,
  reviewContentReport,
  type ContentReportDTO,
} from '../../services/hrms';

type Filter = 'open' | 'actioned' | 'dismissed' | 'all';

const STATUS_TONE: Record<ContentReportDTO['status'], { bg: string; fg: string }> = {
  open: { bg: '#FDF1DC', fg: '#9A6B25' },
  actioned: { bg: '#E4F3EA', fg: '#2E7D51' },
  dismissed: { bg: '#F1F1F4', fg: '#717171' },
};

const STATUS_LABEL: Record<ContentReportDTO['status'], string> = {
  open: 'Needs review',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

export function ContentReports() {
  const { flash } = useStore();
  const [filter, setFilter] = useState<Filter>('open');
  const [reports, setReports] = useState<ContentReportDTO[] | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(
    async (next: Filter) => {
      try {
        setReports(await getContentReports(next));
      } catch (error) {
        flash(error instanceof Error ? error.message : 'Could not load reports');
        setReports([]);
      }
    },
    [flash],
  );

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function close(report: ContentReportDTO, status: 'actioned' | 'dismissed') {
    setBusyId(report.id);
    try {
      await reviewContentReport(report.id, { status });
      flash(status === 'actioned' ? 'Report closed as actioned' : 'Report dismissed');
      await load(filter);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not update the report');
    } finally {
      setBusyId('');
    }
  }

  async function removePost(report: ContentReportDTO) {
    if (
      !window.confirm(
        `Delete ${report.authorName}'s post from the feed? This cannot be undone, and every open report about it is closed.`,
      )
    ) {
      return;
    }
    setBusyId(report.id);
    try {
      await removeReportedPost(report.postId);
      flash('Post removed from the feed');
      await load(filter);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Could not remove the post');
    } finally {
      setBusyId('');
    }
  }

  const openCount = (reports ?? []).filter((report) => report.status === 'open').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <StatusTabs<Filter>
          options={['open', 'actioned', 'dismissed', 'all']}
          active={filter}
          onSelect={setFilter}
          labels={{ open: 'Needs review', actioned: 'Actioned', dismissed: 'Dismissed' }}
        />
        {filter === 'open' && openCount > 0 && (
          <span style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>
            {openCount} waiting on you
          </span>
        )}
      </div>

      {reports === null ? (
        <Card>
          <EmptyRow text="Loading…" />
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyRow
            text={
              filter === 'open'
                ? 'Nothing has been reported. Employees can report a post or a comment from the menu on it in the app.'
                : 'Nothing here.'
            }
          />
        </Card>
      ) : (
        reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            busy={busyId === report.id}
            onAction={() => close(report, 'actioned')}
            onDismiss={() => close(report, 'dismissed')}
            onRemove={() => removePost(report)}
          />
        ))
      )}
    </div>
  );
}

function ReportCard({
  report,
  busy,
  onAction,
  onDismiss,
  onRemove,
}: {
  report: ContentReportDTO;
  busy: boolean;
  onAction: () => void;
  onDismiss: () => void;
  onRemove: () => void;
}) {
  // What was reported and what is there now can differ — an author can edit a
  // post after someone reports it, so both are shown when they disagree.
  const edited =
    report.stillPresent &&
    report.currentText.trim().length > 0 &&
    !report.currentText.startsWith(report.excerpt.replace(/…$/, ''));

  return (
    <Card>
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Pill label={report.reasonLabel} tone={{ bg: '#FBE9E7', fg: '#B23B2E' }} />
          <Pill label={STATUS_LABEL[report.status]} tone={STATUS_TONE[report.status]} />
          <span style={{ fontSize: 14, color: '#717171' }}>
            {report.target === 'comment' ? 'Comment' : report.postTag || 'Post'} by{' '}
            <strong style={{ color: '#222222' }}>{report.authorName}</strong> · reported by{' '}
            <strong style={{ color: '#222222' }}>{report.reporterName}</strong> ·{' '}
            {formatWhen(report.createdAt)}
          </span>
          {!report.stillPresent && (
            <Pill label="Already deleted" tone={{ bg: '#F1F1F4', fg: '#717171' }} />
          )}
        </div>

        <Quote label="Reported content" text={report.excerpt || '(no text — see the post)'} />
        {edited && <Quote label="What it says now" text={report.currentText} muted />}

        {report.note && (
          <div style={{ fontSize: 15, color: '#484848' }}>
            <span style={{ color: '#717171' }}>Reporter added: </span>
            {report.note}
          </div>
        )}

        {report.status === 'open' ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {report.stillPresent && report.target === 'post' && (
              <Button label="Remove post" tone="danger" busy={busy} onClick={onRemove} />
            )}
            <Button label="Mark actioned" tone="primary" busy={busy} onClick={onAction} />
            <Button label="Dismiss" tone="plain" busy={busy} onClick={onDismiss} />
          </div>
        ) : (
          <div style={{ fontSize: 14, color: '#717171' }}>
            {STATUS_LABEL[report.status]}
            {report.reviewedByName ? ` by ${report.reviewedByName}` : ''}
            {report.reviewedAt ? ` · ${formatWhen(report.reviewedAt)}` : ''}
            {report.reviewNote ? ` · ${report.reviewNote}` : ''}
          </div>
        )}
      </div>
    </Card>
  );
}

function Quote({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.5px',
          color: '#9197A2',
          marginBottom: 5,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          background: muted ? '#FBFBFC' : '#F7F7F9',
          border: '1px solid #EBEBEB',
          borderRadius: 12,
          padding: '12px 14px',
          fontSize: 15,
          lineHeight: 1.55,
          color: muted ? '#717171' : '#222222',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function Button({
  label,
  tone,
  busy,
  onClick,
}: {
  label: string;
  tone: 'primary' | 'danger' | 'plain';
  busy: boolean;
  onClick: () => void;
}) {
  const palette = {
    primary: { background: '#0571A6', color: '#fff', border: '1px solid #0571A6' },
    danger: { background: '#fff', color: '#C4382E', border: '1px solid #F0C7C2' },
    plain: { background: '#fff', color: '#484848', border: '1px solid #EBEBEB' },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        ...palette,
        borderRadius: 10,
        padding: '8px 16px',
        fontSize: 14,
        fontWeight: 700,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
