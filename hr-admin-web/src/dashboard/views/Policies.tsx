// Setup › Policies — what people read in the app under Actions › Policies.
//
// Each policy is a name, an optional line under it, and its points: one point per line here,
// stored as the "- " bullets the app draws (a "## " line is a heading, a blank line starts a new
// card). The app reads them live from the server, so a change shows the next time someone opens
// Policies: no app release.
//
// A company with none of its own sees the app's standard policies, written from its leave types
// and shift rules. Its first policy here replaces all of those, which the page says plainly.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card, EmptyRow, ListPending, PageActions, Pill, Spinner } from '../ui';
import { btn, btnClass, fieldLabel, hint, iconBtn as roundBtn, inp, textareaStyle } from '../ds';
import { IconChevronDown, IconInfo } from '../icons';
import { IconClose, IconEdit, IconPlus, IconTrash } from './peopleTable';
import {
  createPolicy, deletePolicy, getPolicies, reorderPolicies, updatePolicy, type PolicyDTO,
} from '../../services/hrms';

/** What the app shows a company that has written none of its own. */
const STANDARD = ['Leave', 'Attendance', 'Payroll', 'POSH', 'Overtime'];

/** The stored text as the editor shows it: one point per line, without the "- ". */
function pointsOf(body: string): string {
  return body.split('\n').map((line) => {
    const t = line.trim();
    if (t === '-') return '';
    return t.startsWith('- ') ? t.slice(2).trim() : t;
  }).join('\n');
}

/** The editor's lines as the app reads them: each line a "- " point, "## " lines headings, blank lines kept. */
function bodyOf(points: string): string {
  return points.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const t = line.trim();
    if (!t) return '';
    if (t.startsWith('## ')) return t;
    // Pasted bullets ("•", "*", "-", "1.") become plain points.
    const text = t.replace(/^([-•*·▪●–]|\d{1,2}[.)])\s+/, '').trim();
    return text ? `- ${text}` : '';
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const pointCount = (body: string) => body.split('\n').filter((l) => l.trim().startsWith('- ')).length;

/** "Leave" reads "Leave policy" in the app, as its list does. */
const heading = (title: string) => (/\b(policy|policies)$/i.test(title.trim()) ? title.trim() : `${title.trim()} policy`);

const updatedLabel = (iso: string) => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() === 0) return '';
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function Policies() {
  const { flash } = useStore();
  const [policies, setPolicies] = useState<PolicyDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<PolicyDTO | null>(null);
  // A new policy, with the name it starts from ('' for a blank one).
  const [adding, setAdding] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const reload = () =>
    getPolicies()
      .then((p) => { setPolicies(p); setFailed(false); })
      .catch((error: Error) => { setFailed(true); flash(error.message); })
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (p: PolicyDTO) => {
    const last = policies.length === 1;
    const message = last
      ? `Delete "${p.title}"? It is your only policy, so the app goes back to its standard policies.`
      : `Delete "${p.title}"? It disappears from the app. To keep it but hide it, edit it and untick "Shown in the app".`;
    if (!window.confirm(message)) return;
    try {
      await deletePolicy(p.key);
      await reload();
      flash(`${p.title} deleted`);
    } catch (error) { flash((error as Error).message); }
  };

  const move = async (index: number, by: -1 | 1) => {
    const next = [...policies];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setPolicies(next);
    setMoving(true);
    try {
      setPolicies(await reorderPolicies(next.map((p) => p.key)));
    } catch (error) {
      flash((error as Error).message);
      await reload();
    } finally { setMoving(false); }
  };

  const shown = policies.filter((p) => p.active).length;
  const none = !loading && !failed && policies.length === 0;

  return (
    <div>
      {(adding !== null || editing) && (
        <PolicySheet
          initial={editing}
          startTitle={adding ?? ''}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSaved={async (message) => { await reload(); flash(message); setAdding(null); setEditing(null); }}
        />
      )}

      <PageActions>
        <button className={btnClass('primary')} style={btn('primary')} onClick={() => setAdding('')}>
          <IconPlus size={15} stroke="currentColor" /> Add policy
        </button>
      </PageActions>

      <div style={note}>
        <span style={{ display: 'inline-flex', marginTop: 2, flexShrink: 0 }}><IconInfo size={15} stroke="var(--accent)" /></span>
        <div style={{ flex: 1 }}>
          {none ? (
            <>
              The app is showing its standard policies right now ({STANDARD.join(', ')}), written from your leave types and
              shift rules. <strong>Once you add a policy here, the app shows only the policies on this page</strong>, so add
              each one you want people to read.
            </>
          ) : (
            <>
              People read these in the app under Actions › Policies, in this order. Write each one as points, one per line;
              a change shows the next time someone opens Policies. Untick "Shown in the app" to take one off without deleting it.
            </>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {loading ? <Spinner /> : failed ? '' : policies.length === 0 ? '' : `${shown} of ${policies.length} shown`}
        </div>
      </div>

      {none && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Start with</span>
          {STANDARD.map((name) => (
            <button key={name} className={btnClass()} style={{ ...btn(), height: 32, fontSize: 13 }} onClick={() => setAdding(name)}>
              <IconPlus size={13} stroke="currentColor" /> {name}
            </button>
          ))}
        </div>
      )}

      <Card padded>
        <table style={tableStyle}>
          <thead className="ds-thead">
            <tr>
              <Th>Policy</Th>
              <Th width={110} right>Points</Th>
              <Th width={150}>Last changed</Th>
              <Th width={130}>In the app</Th>
              <Th right width={190}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p, i) => {
              const last = i === policies.length - 1;
              const when = updatedLabel(p.updatedAt);
              return (
                <tr key={p.key} className="dc-row">
                  <Td last={last}>
                    <strong style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{heading(p.title)}</strong>
                    {p.summary && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{p.summary}</div>}
                  </Td>
                  <Td right mono last={last}>{pointCount(p.body) || '—'}</Td>
                  <Td muted last={last}>
                    {when || '—'}
                    {p.updatedBy && <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>{p.updatedBy}</div>}
                    <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
                      Version {p.version ?? 1}{p.ackRequired === false ? ' · read only' : ''}
                    </div>
                  </Td>
                  <Td last={last}><Pill label={p.active ? 'Shown' : 'Hidden'} tone={p.active ? onPill : offPill} /></Td>
                  <Td right last={last}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="ds-icon-btn" style={roundBtn(34)} title="Move up" aria-label={`Move ${p.title} up`} disabled={i === 0 || moving} onClick={() => void move(i, -1)}>
                        <IconChevronDown size={15} stroke="currentColor" style={{ transform: 'rotate(180deg)' }} />
                      </button>
                      <button className="ds-icon-btn" style={roundBtn(34)} title="Move down" aria-label={`Move ${p.title} down`} disabled={last || moving} onClick={() => void move(i, 1)}>
                        <IconChevronDown size={15} stroke="currentColor" />
                      </button>
                      <button className="ds-icon-btn" style={roundBtn(34)} title="Edit" aria-label={`Edit ${p.title}`} onClick={() => setEditing(p)}><IconEdit /></button>
                      <button className="ds-icon-btn" style={{ ...roundBtn(34), color: 'var(--bad)' }} title="Delete" aria-label={`Delete ${p.title}`} onClick={() => void remove(p)}><IconTrash /></button>
                    </div>
                  </Td>
                </tr>
              );
            })}
            {(loading || (failed && policies.length === 0)) && (
              <tr><td colSpan={5} style={{ padding: 0 }}><ListPending state={loading ? 'loading' : 'error'} onRetry={() => { setLoading(true); void reload(); }} rows={4} cols={5} avatar={false} rowHeight={52} /></td></tr>
            )}
            {none && (
              <tr><td colSpan={5}><EmptyRow text="No policies of your own yet. Add one, or start with one of the standard names above." /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function PolicySheet({ initial, startTitle, onClose, onSaved }: {
  initial: PolicyDTO | null;
  startTitle: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? startTitle);
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [points, setPoints] = useState(initial ? pointsOf(initial.body) : '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [ackRequired, setAckRequired] = useState(initial?.ackRequired ?? true);
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const body = useMemo(() => bodyOf(points), [points]);
  // New points are a new version: the app shows it as Updated, with what changed, and people acknowledge it again.
  const newVersion = !!initial && body !== initial.body;

  const save = async () => {
    if (!title.trim()) { setError('Give the policy a name'); return; }
    if (!body) { setError('Add at least one point'); return; }
    if (newVersion && !changeNote.trim()) { setError('Say what changed: people read it before they acknowledge the update'); return; }
    setSaving(true); setError('');
    try {
      const input = { title: title.trim(), summary: summary.trim(), body, active, ackRequired, ...(newVersion ? { changeNote: changeNote.trim() } : {}) };
      if (initial) await updatePolicy(initial.key, input);
      else await createPolicy(input);
      onSaved(`${input.title} saved${active ? ', the app shows it now' : ' (hidden from the app)'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div className="scry" style={sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={initial ? 'Edit policy' : 'New policy'}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{initial ? 'Edit policy' : 'New policy'}</div>
          <button onClick={onClose} className="ds-icon-btn" style={roundBtn(42)} aria-label="Close"><IconClose size={18} stroke="currentColor" /></button>
        </div>

        <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
          <Field label="Name" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leave" className="ds-inp" style={inp} maxLength={80} autoFocus={!startTitle} />
            <div style={{ ...hint, marginTop: 6 }}>The app lists it as "{heading(title || 'Leave')}".</div>
          </Field>
          <Field label="Line under the name">
            <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Types, balances and how to apply" className="ds-inp" style={inp} maxLength={200} />
          </Field>
          <Field label="Points" required>
            <textarea
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder={'One point per line, e.g.\nApply at least 2 days ahead for planned leave\nYour manager approves within 48 hours'}
              rows={12}
              className="ds-inp"
              style={{ ...textareaStyle, minHeight: 220, lineHeight: 1.55 }}
              autoFocus={!!startTitle}
            />
            <div style={{ ...hint, marginTop: 6 }}>
              Each line is one bullet point. Leave an empty line to start a new group, and start a line with "## " for a heading.
            </div>
          </Field>
          {newVersion && (
            <Field label="What changed" required>
              <textarea
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="e.g. Casual leave goes up from 6 to 8 days a year."
                rows={3}
                maxLength={400}
                className="ds-inp"
                style={{ ...textareaStyle, minHeight: 72, lineHeight: 1.55 }}
              />
              <div style={{ ...hint, marginTop: 6 }}>
                This is version {(initial?.version ?? 1) + 1}. The app shows it as Updated with this note, and everyone who acknowledged it acknowledges it again.
              </div>
            </Field>
          )}
          <label style={checkRow}>
            <input type="checkbox" checked={ackRequired} onChange={(e) => setAckRequired(e.target.checked)} />
            People acknowledge it (untick to make it read only)
          </label>
          <div style={{ height: 10 }} />
          <label style={checkRow}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Shown in the app
          </label>

          <div style={{ ...fieldLabel, display: 'block', margin: '18px 0 8px' }}>How it reads in the app</div>
          <Preview title={title} summary={summary} body={body} />
          {error && <div style={{ ...errorTag, marginTop: 14 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '16px 20px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
          <button onClick={onClose} className={btnClass()} style={btn()}>Cancel</button>
          <button onClick={() => void save()} disabled={saving} className={btnClass('primary')} style={btn('primary')}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

type Block = { kind: 'heading'; text: string } | { kind: 'card'; lines: { text: string; bullet: boolean }[] };

/** The app's reading of the text (policies_models.dart parsePolicyBody): cards between blank lines, "- " bullets, "## " headings. */
function blocksOf(body: string): Block[] {
  const blocks: Block[] = [];
  let lines: { text: string; bullet: boolean }[] = [];
  const close = () => { if (lines.length) blocks.push({ kind: 'card', lines }); lines = []; };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) close();
    else if (line.startsWith('## ')) { close(); blocks.push({ kind: 'heading', text: line.slice(3).trim() }); }
    else if (line.startsWith('- ')) lines.push({ text: line.slice(2).trim(), bullet: true });
    else lines.push({ text: line, bullet: false });
  }
  close();
  return blocks;
}

function Preview({ title, summary, body }: { title: string; summary: string; body: string }) {
  const blocks = blocksOf(body);
  return (
    <div style={{ background: '#F7F7F9', borderRadius: 18, padding: 16, border: '1px solid var(--line)', color: '#2A2A2A' }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: '#2A2420', letterSpacing: -0.3 }}>{title.trim() || 'Policy name'}</div>
      {summary.trim() && <div style={{ fontSize: 12.5, color: '#6E655C', marginTop: 4 }}>{summary.trim()}</div>}
      <div style={{ marginTop: 12 }}>
        {blocks.length === 0 && <div style={{ fontSize: 13, color: '#A79D92' }}>The points show here as you type.</div>}
        {blocks.map((b, i) => b.kind === 'heading' ? (
          <div key={i} style={{ fontSize: 14.5, fontWeight: 800, color: '#2A2420', margin: `${i === 0 ? 0 : 8}px 0 8px` }}>{b.text}</div>
        ) : (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
            {b.lines.map((l, j) => (
              <div key={j} style={{ display: 'flex', fontSize: 13.5, lineHeight: 1.6, marginTop: j === 0 ? 0 : 4 }}>
                {l.bullet && <span style={{ width: 16, flexShrink: 0 }}>•</span>}
                <span style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{l.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...fieldLabel, display: 'block', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--bad)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
function Th({ children, right, width }: { children: ReactNode; right?: boolean; width?: number }) {
  return <th style={{ textAlign: right ? 'right' : 'left', width, fontSize: 12, lineHeight: '18px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontWeight: 400, padding: '10px 12px', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, muted, right, mono, last }: { children: ReactNode; muted?: boolean; right?: boolean; mono?: boolean; last?: boolean }) {
  return <td style={{ padding: '10px 12px', textAlign: right ? 'right' : 'left', borderBottom: last ? 'none' : '1px solid var(--line)', color: muted ? 'var(--ink-3)' : 'var(--ink)', fontVariantNumeric: mono ? 'tabular-nums' : undefined, verticalAlign: 'top' }}>{children}</td>;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13.5, lineHeight: 1.5 };
const note: CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 13, color: 'var(--ink-2)', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', marginBottom: 16, lineHeight: 1.5 };
const onPill = { bg: 'var(--p-green)', fg: 'var(--on-accent)' };
const offPill = { bg: 'var(--mute-bg)', fg: 'var(--ink-2)' };
const errorTag: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 14, padding: '10px 14px' };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', accentColor: 'var(--accent)' };
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', justifyContent: 'flex-end', zIndex: 60, animation: 'ovl .2s ease both' };
const sheet: CSSProperties = { width: 560, maxWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: '24px 0 0 24px', boxShadow: 'var(--shadow-drawer)', animation: 'drwIn .25s ease both' };
