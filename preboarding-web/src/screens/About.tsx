import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { portal } from '../api/portal';
import type { AboutYou } from '../api/types';
import { Page } from '../components/Shell';
import { BottomBar, ChipGroup, ErrorNote, Field, PrimaryButton, Spinner, StoryBar } from '../components/ui';
import { addDays, fmtWeekday, today } from '../lib/format';
import { useAsync, useFocusHeading } from '../lib/hooks';
import { useMe } from '../session';

const RELATIONS = ['Parent', 'Partner', 'Sibling', 'Friend'] as const;
type Relation = (typeof RELATIONS)[number];

const digits = (s: string) => s.replace(/\D/g, '');
/** "+91 98765 43210" / "9876543210" / "919876543210" → "+919876543210" (or null) */
export function normalisePhone(s: string): string | null {
  let d = digits(s);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 ? `+91${d}` : null;
}
/** "+919812345612" → "+91 98xxx xxx12" */
function maskPhone(p?: string): string {
  if (!p) return '+91';
  const d = digits(p).slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 2)}xxx xxx${d.slice(8)}` : p;
}

/** P9 · About you (2 steps): emergency contact, PF. Mobile layout, centred on desktop. */
export function About() {
  const { header, me, reload } = useMe();
  const navigate = useNavigate();
  const state = useAsync(() => portal.about(), []);
  const [step, setStep] = useState<0 | 1 | 2>();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<Relation>();
  const [phone, setPhone] = useState('');
  const [pfChoice, setPfChoice] = useState<'uan' | 'first'>();
  const [uan, setUan] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string>();
  const nameId = useId();
  const phoneId = useId();
  const ownId = useId();
  const uanId = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>(step);

  useEffect(() => {
    const a = state.data;
    if (!a || step !== undefined) return;
    if (a.emergencyContact) {
      setName(a.emergencyContact.name);
      setRelation(a.emergencyContact.relation);
      setPhone(a.emergencyContact.phone);
    }
    if (a.pf) {
      setPfChoice(a.pf.firstJob ? 'first' : 'uan');
      setUan(a.pf.uan ?? '');
    }
    setStep(!a.emergencyContact ? 0 : !a.pf ? 1 : 2);
  }, [state.data, step]);

  if (state.error)
    return (
      <Page header={header({ back: '/', tone: 'dark' })} bg="white">
        <ErrorNote error={state.error} onRetry={state.reload} />
      </Page>
    );
  if (!state.data || step === undefined)
    return (
      <Page header={header({ back: '/', tone: 'dark' })} bg="white">
        <Spinner />
      </Page>
    );

  const about = state.data;
  const editableUntil = about.editableUntil ?? addDays(me.tj, -1);
  const locked = today() > editableUntil;

  const own = about.phone ? normalisePhone(about.phone) : null;
  const theirs = normalisePhone(phone);
  const phoneErr = !phone ? 'Add their phone number.' : !theirs ? 'Use +91 and 10 digits.' : own && theirs === own ? 'This is your own number. Add someone else’s.' : undefined;
  const nameErr = !name.trim() ? 'Add their name.' : undefined;
  const relErr = !relation ? 'Choose how you know them.' : undefined;
  const uanDigits = digits(uan);
  const uanErr = pfChoice === 'uan' && uanDigits.length !== 12 ? 'A UAN has 12 digits.' : undefined;
  const pfErr = !pfChoice ? 'Choose one.' : uanErr;

  const save = async (body: Pick<AboutYou, 'emergencyContact' | 'pf'>, next: 0 | 1 | 2) => {
    setBusy(true);
    setSaveErr(undefined);
    try {
      state.setData(await portal.saveAbout(body));
      setTouched(false);
      setStep(next);
      if (next === 2) reload();
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ec = () => ({ name: name.trim(), relation: relation!, phone: theirs! });
  const onContinue = () => {
    setTouched(true);
    if (step === 0) {
      if (nameErr || relErr || phoneErr) return;
      save({ emergencyContact: ec(), pf: about.pf }, about.pf ? 2 : 1);
    } else if (step === 1) {
      if (pfErr) return;
      save({ emergencyContact: ec(), pf: pfChoice === 'first' ? { firstJob: true } : { firstJob: false, uan: uanDigits } }, 2);
    }
  };

  const hdr = header({ back: step === 1 ? () => setStep(0) : '/', tone: 'dark', help: false, bell: undefined });

  if (step === 2)
    return (
      <Page header={hdr} bg="white">
        <StoryBar total={2} current={2} />
        <section className="reel-end rise" role="status">
          <p className="display-xl pop">2/2</p>
          <h1 className="display" ref={h1} tabIndex={-1}>
            Details saved
          </h1>
          <p className="body sub">HR has your emergency contact and PF details. You’ll introduce yourself to the team in the app on Day 1.</p>
          {!locked && (
            <button type="button" className="text-link" onClick={() => setStep(0)}>
              Change these details
            </button>
          )}
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );

  return (
    <Page header={hdr} bg="white">
      <StoryBar total={2} current={step} />
      {locked && (
        <p className="banner banner--blue body" role="status">
          These details were locked on {fmtWeekday(editableUntil)}. Email HR to change them.
        </p>
      )}
      {step === 0 ? (
        <form
          className="reel form rise"
          onSubmit={(e) => {
            e.preventDefault();
            onContinue();
          }}
          aria-labelledby="about-title"
        >
          <h1 id="about-title" className="display" ref={h1} tabIndex={-1}>
            Emergency contact
          </h1>
          <p className="body sub">Who should we call if something happens to you?</p>
          <Field label="Your phone" htmlFor={ownId}>
            <input id={ownId} className="input" value={maskPhone(about.phone)} readOnly aria-readonly="true" />
          </Field>
          <Field label="Emergency contact" htmlFor={nameId} error={touched ? nameErr : undefined}>
            <input id={nameId} className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required disabled={locked} />
          </Field>
          <ChipGroup label="Relation" name="relation" options={RELATIONS} value={relation} onChange={setRelation} disabled={locked} />
          {touched && relErr && (
            <p className="field__error" role="alert">
              {relErr}
            </p>
          )}
          <Field label="Their phone" htmlFor={phoneId} error={touched ? phoneErr : undefined}>
            <input id={phoneId} className="input" type="tel" inputMode="tel" placeholder="+91" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" required disabled={locked} />
          </Field>
          {saveErr && (
            <p className="field__error" role="alert">
              {saveErr}
            </p>
          )}
          <BottomBar>
            <PrimaryButton type="submit" disabled={busy || locked}>
              {busy ? 'Saving…' : 'Continue'}
            </PrimaryButton>
          </BottomBar>
        </form>
      ) : (
        <form
          className="reel form rise"
          onSubmit={(e) => {
            e.preventDefault();
            onContinue();
          }}
          aria-labelledby="pf-title"
        >
          <h1 id="pf-title" className="display" ref={h1} tabIndex={-1}>
            Your PF account
          </h1>
          <p className="body sub">Had a PF account before? Add your UAN so it moves with you.</p>
          <fieldset className="radio-cards">
            <legend className="sr-only">Your PF account</legend>
            {(
              [
                ['uan', 'I have a UAN', 'From a previous job'],
                ['first', 'This is my first job', 'We’ll create one for you'],
              ] as const
            ).map(([v, t, s]) => (
              <label key={v} className={`radio-card ${pfChoice === v ? 'is-on' : ''}`}>
                <input type="radio" name="pf" value={v} checked={pfChoice === v} onChange={() => setPfChoice(v)} disabled={locked} />
                <span className="radio-card__dot" aria-hidden="true" />
                <span>
                  <span className="body-strong">{t}</span>
                  <span className="label">{s}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {touched && !pfChoice && (
            <p className="field__error" role="alert">
              Choose one.
            </p>
          )}
          {pfChoice === 'uan' && (
            <Field label="UAN (12 digits)" htmlFor={uanId} error={touched ? uanErr : undefined}>
              <input
                id={uanId}
                className="input"
                inputMode="numeric"
                placeholder="1000 0000 0000"
                value={uan}
                onChange={(e) => setUan(e.target.value.replace(/[^\d ]/g, '').slice(0, 14))}
                autoComplete="off"
                required
                disabled={locked}
              />
            </Field>
          )}
          {saveErr && (
            <p className="field__error" role="alert">
              {saveErr}
            </p>
          )}
          <BottomBar>
            <PrimaryButton type="submit" disabled={busy || locked}>
              {busy ? 'Saving…' : 'Continue'}
            </PrimaryButton>
          </BottomBar>
        </form>
      )}
    </Page>
  );
}
