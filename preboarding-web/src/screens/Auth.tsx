import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { portal } from '../api/portal';
import type { ClosedSignIn } from '../api/types';
import { Page, useLastClient } from '../components/Shell';
import { Icon } from '../components/Icon';
import { BottomBar, Eyebrow, Field, PrimaryButton } from '../components/ui';
import { useFocusHeading, useWide } from '../lib/hooks';
import { ClosedScreen } from './Closed';

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input
        id={id}
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
      />
      <button type="button" className="input-wrap__toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

const EMAIL_KEY = 'sowaka.portal.email';
function lastEmail(): string {
  try { return localStorage.getItem(EMAIL_KEY) ?? ''; } catch { return ''; }
}
function rememberEmail(email: string) {
  try { localStorage.setItem(EMAIL_KEY, email.trim()); } catch { /* not kept: they type it next time */ }
}

/** P6 / W6 · Sign in — the email the portal was sent to, then a one-time code emailed to it (no password). */
export function SignIn() {
  const wide = useWide();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // The portal mail's link carries the address it went to (?email=); else the one last used on this device.
  const [email, setEmail] = useState(() => params.get('email')?.trim() || lastEmail());
  const [code, setCode] = useState('');
  // Once the code is on its way, the form asks for it.
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [closed, setClosed] = useState<ClosedSignIn>();
  const [busy, setBusy] = useState(false);
  const client = useLastClient();
  const emailId = useId();
  const codeId = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>('sign-in');
  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (!sent) {
        await portal.sendCode(email.trim());
        setSent(true);
        return;
      }
      const out = await portal.verifyCode(email.trim(), code.trim());
      if ('closed' in out) { setClosed(out.closed); return; }
      rememberEmail(email);
      navigate(from && from !== '/sign-in' ? from : '/', { replace: true });
    } catch (err) {
      // A server from before the closed answer was 200 says it with a 403: the same closed screen.
      const info = err instanceof ApiError ? (err.details?.closed as ClosedSignIn | undefined) : undefined;
      if (info?.state) setClosed(info);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (closed) return <ClosedScreen state={closed.state} company={closed.company} hr={closed.hrContact} />;

  // 6Zs P6: "Header: light, help" (the help sheet needs the client's HR, known from the offer link or the mail's link).
  const header = { ...client, help: true };
  const form = (
    <form className="form" onSubmit={submit} noValidate={false} aria-describedby={error ? 'signin-err' : undefined}>
      <h1 className="display" ref={h1} tabIndex={-1}>
        Sign in
      </h1>
      <p className="body sub">{sent ? `We sent a 6-digit code to ${email.trim()}` : 'Use the email your joining portal was sent to. We’ll email you a code.'}</p>
      {params.get('expired') && (
        <p className="banner banner--blue body" role="status">
          You were signed out. Please sign in again.
        </p>
      )}
      {!sent ? (
        <Field label="Email" htmlFor={emailId}>
          <input id={emailId} className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
      ) : (
        <>
          <Field label="Code" htmlFor={codeId}>
            <input id={codeId} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus />
          </Field>
          <span style={{ display: 'flex', gap: 16 }}>
            <button type="button" className="text-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
              onClick={() => { setError(undefined); void portal.sendCode(email.trim()).catch((err) => setError((err as Error).message)); }}>Send a new code</button>
            <button type="button" className="text-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
              onClick={() => { setSent(false); setCode(''); setError(undefined); }}>Use another email</button>
          </span>
        </>
      )}
      {error && (
        <p id="signin-err" className="field__error" role="alert">
          {error}
        </p>
      )}
      <BottomBar>
        <PrimaryButton type="submit" disabled={busy || !email || (sent && code.length !== 6)}>
          {busy ? (sent ? 'Signing in…' : 'Sending…') : sent ? 'Sign in' : 'Send code'}
        </PrimaryButton>
      </BottomBar>
    </form>
  );

  if (wide)
    return (
      <Page header={header} layout="wide">
        <div className="two-col two-col--even signin-web">
          <section className="signin-web__intro card">
            <h2 className="display">Your joining portal</h2>
            <p className="body">Everything you need before Day 1, in one place.</p>
            <ul className="check-list">
              {['Upload your documents', 'Meet your team', 'Sign your appointment letter', 'Get your Day-1 pass'].map((t) => (
                <li key={t}>
                  <span className="node node--done" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                  <span className="body">{t}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card signin-web__form">{form}</section>
        </div>
      </Page>
    );
  return (
    <Page header={header} layout="narrow" bg="white">
      {form}
    </Page>
  );
}

/** Forgot password (not drawn): sends a reset link; never says whether the email exists. */
export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const client = useLastClient();
  const id = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>(sent);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await portal.forgot(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page header={{ ...client, help: true, back: '/sign-in' }} layout="narrow" bg="white">
      {sent ? (
        <section className="closed" role="status">
          <span className="closed__icon" aria-hidden="true">
            <Icon name="mail" size={34} />
          </span>
          <Eyebrow>Check your inbox</Eyebrow>
          <h1 className="display" ref={h1} tabIndex={-1}>
            Reset link sent
          </h1>
          <p className="body sub">If {email} has a joining portal account, we’ve emailed it a link to set a new password. The link works for a limited time.</p>
          <BottomBar>
            <Link to="/sign-in" className="btn btn--primary">
              Back to sign in
            </Link>
          </BottomBar>
        </section>
      ) : (
        <form className="form" onSubmit={submit}>
          <h1 className="display" ref={h1} tabIndex={-1}>
            Forgot password?
          </h1>
          <p className="body sub">Enter the email HR sent your login to. We’ll email you a link to set a new password.</p>
          <Field label="Email" htmlFor={id}>
            <input id={id} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <BottomBar>
            <PrimaryButton type="submit" disabled={busy || !email}>
              {busy ? 'Sending…' : 'Send reset link'}
            </PrimaryButton>
          </BottomBar>
        </form>
      )}
    </Page>
  );
}

/** /reset/:token — set a new password from the emailed link. */
export function Reset() {
  const { token = '' } = useParams();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const client = useLastClient();
  const id1 = useId();
  const id2 = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>(done);
  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8 || pw !== pw2) return;
    setBusy(true);
    setError(undefined);
    try {
      await portal.reset(token, pw);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page header={{ ...client, help: true }} layout="narrow" bg="white">
      {done ? (
        <section className="closed" role="status">
          <span className="closed__icon closed__icon--declined" aria-hidden="true">
            <Icon name="check" size={34} />
          </span>
          <Eyebrow>Password changed</Eyebrow>
          <h1 className="display" ref={h1} tabIndex={-1}>
            You’re ready to sign in
          </h1>
          <p className="body sub">Use your email and the new password.</p>
          <BottomBar>
            <Link to="/sign-in" className="btn btn--primary">
              Sign in
            </Link>
          </BottomBar>
        </section>
      ) : (
        <form className="form" onSubmit={submit}>
          <h1 className="display" ref={h1} tabIndex={-1}>
            Set a new password
          </h1>
          <p className="body sub">At least 8 characters.</p>
          <Field label="New password" htmlFor={id1} error={tooShort ? 'Use at least 8 characters.' : undefined}>
            <PasswordInput id={id1} value={pw} onChange={setPw} autoComplete="new-password" />
          </Field>
          <Field label="Type it again" htmlFor={id2} error={mismatch ? 'The two passwords don’t match.' : undefined}>
            <PasswordInput id={id2} value={pw2} onChange={setPw2} autoComplete="new-password" />
          </Field>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
          <BottomBar>
            <PrimaryButton type="submit" disabled={busy || pw.length < 8 || pw !== pw2}>
              {busy ? 'Saving…' : 'Save password'}
            </PrimaryButton>
          </BottomBar>
        </form>
      )}
    </Page>
  );
}
