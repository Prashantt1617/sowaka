// The Support desk's dialogs: send a ticket back to the head (staff, optional
// note), resolve (final: there is no reopen in phase 1), and the company's
// ticket types (a Support head or a dashboard admin).
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { IconChevronDown, IconClose, IconPlus } from '../icons';
import {
  SUPPORT_MANAGER_TOPIC,
  SUPPORT_MAX_TOPICS,
  SUPPORT_MAX_TOPIC_LABEL,
  type SupportTopic,
} from '../../services/support';

// While the action is on its way the dialog stays: closing it then would free
// the desk underneath before the action has landed.
function DialogShell({ title, busy, onClose, children, width = 480 }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={busy ? undefined : onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div style={{ position: 'relative', width: `min(${width}px, 100%)`, background: '#fff', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', padding: '20px 22px', animation: 'pop .18s ease both' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Buttons({ busy, onClose, onConfirm, label, busyLabel, tone = '#0571A6', disabled }: { busy: boolean; onClose: () => void; onConfirm: () => void; label: string; busyLabel: string; tone?: string; disabled?: boolean }) {
  const off = busy || disabled;
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
      <button type="button" disabled={busy} onClick={onClose} style={{ ...ghostBtn, opacity: busy ? 0.55 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>Cancel</button>
      <button type="button" disabled={off} onClick={onConfirm} style={{ ...primaryBtn, background: tone, opacity: off ? 0.55 : 1, cursor: off ? 'not-allowed' : 'pointer' }}>
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

export function SendBackDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <DialogShell title="Send back to the Support head?" busy={busy} onClose={onClose}>
      <div style={{ fontSize: 13, color: '#484848', lineHeight: 1.55, marginTop: 8 }}>
        The ticket leaves your desk and goes back to the head’s queue with its conversation. The employee isn’t told.
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '.06em', color: '#717171', margin: '16px 0 6px' }}>NOTE FOR THE HEAD · OPTIONAL</div>
      <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="e.g. This is a leave question, not payroll" style={textarea} />
      <Buttons busy={busy} onClose={onClose} onConfirm={() => onConfirm(note.trim())} label="Send back" busyLabel="Sending…" />
    </DialogShell>
  );
}

export function ConfirmResolveDialog({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <DialogShell title="Resolve this ticket?" busy={busy} onClose={onClose}>
      <div style={{ fontSize: 13, color: '#484848', lineHeight: 1.55, marginTop: 8 }}>
        The conversation closes for good. The employee is notified and can’t reply here; to continue they raise a new ticket.
      </div>
      <Buttons busy={busy} onClose={onClose} onConfirm={onConfirm} label="Resolve" busyLabel="Resolving…" tone="#4F7A52" />
    </DialogShell>
  );
}

// —— Ticket types ————————————————————————————————————————————————————————————

/** A row being edited: `key` is absent on a type added here, until it is saved. */
type TopicRow = { id: string; key?: string; label: string };

const tidy = (label: string) => label.replace(/\s+/g, ' ').trim();

/** What stops a save, as the server would say it; '' when there is nothing. */
function topicProblem(rows: TopicRow[]): string {
  if (rows.length === 0) return 'Keep at least one type of ticket.';
  if (rows.length > SUPPORT_MAX_TOPICS) return `Up to ${SUPPORT_MAX_TOPICS} types of ticket.`;
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const label = tidy(row.label);
    if (!label) return `Type ${i + 1} needs a name.`;
    if (label.length > SUPPORT_MAX_TOPIC_LABEL) return `Keep names to ${SUPPORT_MAX_TOPIC_LABEL} characters.`;
    const folded = label.toLowerCase();
    if (seen.has(folded)) return `"${label}" is listed twice.`;
    seen.add(folded);
  }
  return '';
}

/**
 * The company's ticket types, as the app lists them when an employee raises a
 * ticket: rename in place, move, add, remove, then save the whole list.
 * Renaming keeps a type's tickets together; removing one only stops new ones.
 */
export function TicketTypesDialog({ topics, busy, error, onClose, onSave }: {
  topics: SupportTopic[];
  busy: boolean;
  /** Why the last save was refused, if it was. */
  error: string;
  onClose: () => void;
  onSave: (topics: { key?: string; label: string }[]) => void;
}) {
  const [rows, setRows] = useState<TopicRow[]>(() => topics.map((t) => ({ id: t.key, key: t.key, label: t.label })));
  const [draft, setDraft] = useState('');
  const problem = topicProblem(rows);
  const full = rows.length >= SUPPORT_MAX_TOPICS;
  const removed = topics.filter((t) => !rows.some((r) => r.key === t.key));
  const changed = rows.length !== topics.length || rows.some((r, i) => r.key !== topics[i]?.key || tidy(r.label) !== topics[i]?.label);

  const patch = (id: string, label: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, label } : r)));
  const move = (i: number, by: -1 | 1) => setRows((rs) => {
    const next = [...rs];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return next;
  });
  const add = () => {
    const label = tidy(draft);
    if (!label || full) return;
    setRows((rs) => [...rs, { id: `new-${Date.now()}-${rs.length}`, label }]);
    setDraft('');
  };

  return (
    <DialogShell title="Ticket types" busy={busy} onClose={onClose} width={560}>
      <div style={{ fontSize: 13, color: '#484848', lineHeight: 1.55, marginTop: 8 }}>
        What employees choose from when they raise a ticket in the app, in this order. Renaming a type keeps its tickets together; removing one stops new tickets of that type, and tickets already raised keep theirs.
      </div>
      <div className="scry" style={{ maxHeight: 'min(420px, 52vh)', overflowY: 'auto', margin: '14px -4px 0', padding: '0 4px' }}>
        {rows.map((r, i) => {
          const tooLong = tidy(r.label).length > SUPPORT_MAX_TOPIC_LABEL;
          return (
            <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid #F7F7F9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 22, textAlign: 'right', fontSize: 12.5, fontWeight: 500, color: '#9197A2', flexShrink: 0 }}>{i + 1}</span>
                <input value={r.label} onChange={(e) => patch(r.id, e.target.value)} disabled={busy} aria-label={`Type ${i + 1}`} maxLength={SUPPORT_MAX_TOPIC_LABEL}
                  style={{ ...input, flex: 1, borderColor: tooLong || !tidy(r.label) ? '#E8B7C3' : '#EBEBEB' }} />
                {!r.key && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#4A6FA5', background: '#E7ECF4', borderRadius: 'var(--r-lg)', padding: '2px 8px' }}>New</span>}
                <button type="button" title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)} style={iconBtn(i === 0)}>
                  <IconChevronDown stroke="#484848" style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button type="button" title="Move down" disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)} style={iconBtn(i === rows.length - 1)}>
                  <IconChevronDown stroke="#484848" />
                </button>
                <button type="button" title="Remove" disabled={busy || rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} style={iconBtn(rows.length === 1)}>
                  <IconClose size={14} stroke="#A8475F" />
                </button>
              </div>
              {r.key === SUPPORT_MANAGER_TOPIC && (
                <div style={{ fontSize: 12, color: '#717171', margin: '4px 0 0 29px' }}>Tickets of this type never go to the requester’s manager or anyone above them.</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy || full} maxLength={SUPPORT_MAX_TOPIC_LABEL}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }}
          placeholder={full ? `Up to ${SUPPORT_MAX_TOPICS} types` : 'Add a type, e.g. IT & laptops'} style={{ ...input, flex: 1 }} />
        <button type="button" disabled={busy || full || !tidy(draft)} onClick={add}
          style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: busy || full || !tidy(draft) ? 0.55 : 1, cursor: busy || full || !tidy(draft) ? 'not-allowed' : 'pointer' }}>
          <IconPlus size={14} stroke="#484848" /> Add
        </button>
      </div>
      {removed.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#9A6B25', background: '#FBF4EA', borderRadius: 10, padding: '8px 11px', marginTop: 12, lineHeight: 1.45 }}>
          Removing {removed.map((t) => t.label).join(', ')}. Tickets already raised keep their type.
        </div>
      )}
      {(problem || error) && <div style={{ fontSize: 12.5, color: '#A8475F', marginTop: 10 }}>{problem || error}</div>}
      <Buttons busy={busy} onClose={onClose} disabled={Boolean(problem) || !changed} label="Save"
        busyLabel="Saving…" onConfirm={() => onSave(rows.map((r) => ({ ...(r.key ? { key: r.key } : {}), label: tidy(r.label) })))} />
    </DialogShell>
  );
}

const input: CSSProperties = { minWidth: 0, border: '1px solid #EBEBEB', borderRadius: 10, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none', color: '#222222', background: '#fff' };
const iconBtn = (off: boolean): CSSProperties => ({ width: 32, height: 32, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #EBEBEB', borderRadius: 999, background: '#fff', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.4 : 1, padding: 0 });
const textarea: CSSProperties = { width: '100%', resize: 'vertical', border: '1px solid #EBEBEB', borderRadius: 10, padding: '9px 11px', fontSize: 13, lineHeight: 1.45, fontFamily: 'inherit', outline: 'none', color: '#222222' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 999, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 999, fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' };
