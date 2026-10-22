// What employees have reported from the Connect feed, and what HR did about it.
//
// A report is a complaint from one colleague about another, so the view leads
// with the words that were reported rather than with counts: the decision is
// always about the content, and the queue is short by design.
import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyRow, Pill, StatusTabs } from '../ui';
import { useStore } from '../store';
import * as L from './look';
import './look.css';
import {
  getContentReports,
  removeReportedPost,
  reviewContentReport,
  type ContentReportDTO,
} from '../../services/hrms';

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
    <Card style={{ padding: 20 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <StatusTabs<Filter>
          options={['open', 'actioned', 'dismissed', 'all']}
          active={filter}
          onSelect={setFilter}
          labels={{ open: 'Needs review', actioned: 'Actioned', dismissed: 'Dismissed' }}
        />
        {filter === 'open' && openCount > 0 && (
          <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>
            {openCount} waiting on you
          </span>
        )}
      </div>

      {reports === null ? (
        <div>
          <EmptyRow text="Loading…" />
        </div>
      ) : reports.length === 0 ? (
        <div>
          <EmptyRow
            text={
              filter === 'open'
                ? 'Nothing has been reported. Employees can report a post or a comment from the menu on it in the app.'
                : 'Nothing here.'
            }
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16, alignItems: 'start' }}>
        {reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            busy={busyId === report.id}
            onAction={() => close(report, 'actioned')}
            onDismiss={() => close(report, 'dismissed')}
            onRemove={() => removePost(report)}
          />
        ))}
        </div>
      )}
    </div>
    </Card>
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 20, background: 'var(--surface)' }}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={L.tag}>{report.reasonLabel}</span>
          <Pill label={STATUS_LABEL[report.status]} tone={STATUS_TONE[report.status]} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {report.target === 'comment' ? 'Comment' : report.postTag || 'Post'} by{' '}
            <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{report.authorName}</strong> · reported by{' '}
            <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{report.reporterName}</strong> ·{' '}
            {formatWhen(report.createdAt)}
          </span>
          {!report.stillPresent && (
            <Pill label="Already deleted" tone={L.TONES.mute} />
          )}
        </div>

        <Quote label="Reported content" text={report.excerpt || '(no text — see the post)'} />
        {edited && <Quote label="What it says now" text={report.currentText} muted />}

        {report.note && (
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            <span style={{ color: 'var(--ink-3)' }}>Reporter added: </span>
            {report.note}
          </div>
        )}

        {report.status === 'open' ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {report.stillPresent && report.target === 'post' && (
              <Button label="Remove post" tone="danger" busy={busy} onClick={onRemove} />
            )}
            <Button label="Mark actioned" tone="primary" busy={busy} onClick={onAction} />
            <Button label="Dismiss" tone="plain" busy={busy} onClick={onDismiss} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {STATUS_LABEL[report.status]}
            {report.reviewedByName ? ` by ${report.reviewedByName}` : ''}
            {report.reviewedAt ? ` · ${formatWhen(report.reviewedAt)}` : ''}
            {report.reviewNote ? ` · ${report.reviewNote}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function Quote({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '.08em',
          color: 'var(--hi)',
          marginBottom: 6,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          background: muted ? 'var(--surface-2)' : 'var(--surface-2)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: '12px 16px',
          fontSize: 13.5,
          fontStyle: 'italic',
          lineHeight: 1.55,
          color: muted ? 'var(--ink-3)' : 'var(--ink)',
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
    primary: { background: 'var(--accent-grad)', color: '#fff', border: '1px solid transparent' },
    danger: { background: 'var(--p-red)', color: '#fff', border: '1px solid transparent' },
    plain: { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-2)' },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        ...palette,
        borderRadius: 999,
        height: 32,
        padding: '0 12px',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'inherit',
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
