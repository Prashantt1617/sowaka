import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { portal } from '../api/portal';
import type { DateRequestReason } from '../api/types';
import { Page } from '../components/Shell';
import { BottomBar, ChipGroup, Field, PrimaryButton, SecondaryButton } from '../components/ui';
import { addDays, fmtChip, fmtWeekday, today } from '../lib/format';
import { useFocusHeading } from '../lib/hooks';
import { nextMondays } from '../lib/links';
import { useMe } from '../session';

const REASONS: readonly DateRequestReason[] = ['Notice period', 'Personal', 'Something else'];

/** P7a · Can't make it? — request a new joining date (next 3 Mondays or Other; reason required). */
export function DateRequest() {
  const { header, me } = useMe();
  const navigate = useNavigate();
  const mondays = nextMondays(me.tj, 3);
  const options = [...mondays, 'other'] as const;
  const [choice, setChoice] = useState<string>();
  const [other, setOther] = useState('');
  const [reason, setReason] = useState<DateRequestReason>();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [sent, setSent] = useState<string>();
  const otherId = useId();
  const noteId = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>(sent ?? 'form');

  const requested = choice === 'other' ? other : choice;
  const minOther = addDays(today(), 1);
  const dateErr = !choice ? 'Pick a date.' : choice === 'other' && !other ? 'Choose a date.' : choice === 'other' && other < minOther ? 'Pick a date after today.' : undefined;
  const reasonErr = !reason ? 'Choose a reason.' : undefined;

  const send = async () => {
    setTouched(true);
    if (dateErr || reasonErr || !requested || !reason) return;
    setBusy(true);
    setErr(undefined);
    try {
      await portal.requestDate({ requestedTj: requested, reason, note: note.trim() || undefined });
      setSent(requested);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Page header={header({ back: '/' })}>
        <section className="closed rise" role="status">
          <span className="closed__icon closed__icon--declined" aria-hidden="true">
            ✓
          </span>
          <h1 className="display" ref={h1} tabIndex={-1}>
            Request sent
          </h1>
          <p className="body sub">
            We’ll let you know once HR confirms {choice === 'other' ? 'your new date' : fmtWeekday(sent)}. Your task due dates will move to match.
          </p>
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );

  return (
    <Page header={header({ back: '/' })} bg="white">
      <form
        className="form rise"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        aria-labelledby="date-title"
      >
        <h1 id="date-title" className="display" ref={h1} tabIndex={-1}>
          Can’t join on {fmtWeekday(me.tj)}?
        </h1>
        <p className="body sub">Pick a date that works for you. HR will confirm it.</p>
        <ChipGroup
          label="New date"
          name="new-date"
          options={options as readonly string[]}
          value={choice}
          onChange={setChoice}
          render={(o) => (o === 'other' ? 'Pick · Other' : fmtChip(o))}
        />
        {touched && dateErr && choice !== 'other' && (
          <p className="field__error" role="alert">
            {dateErr}
          </p>
        )}
        {choice === 'other' && (
          <Field label="Your date" htmlFor={otherId} error={touched ? dateErr : undefined}>
            <input id={otherId} className="input" type="date" min={minOther} value={other} onChange={(e) => setOther(e.target.value)} required />
          </Field>
        )}
        <ChipGroup label="Reason" name="reason" options={REASONS} value={reason} onChange={setReason} />
        {touched && reasonErr && (
          <p className="field__error" role="alert">
            {reasonErr}
          </p>
        )}
        <Field label="Note for HR (optional)" htmlFor={noteId}>
          <textarea id={noteId} className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {err && (
          <p className="field__error" role="alert">
            {err}
          </p>
        )}
        <BottomBar className="bottom-bar--split">
          <SecondaryButton onClick={() => navigate('/')}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </PrimaryButton>
        </BottomBar>
      </form>
    </Page>
  );
}
