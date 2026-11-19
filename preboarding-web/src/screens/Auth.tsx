import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { portal } from '../api/portal';
import type { ClosedSignIn } from '../api/types';
import { Page, useLastClient } from '../components/Shell';
import { Icon } from '../components/Icon';
import { BottomBar, Eyebrow, Field, PrimaryButton } from '../components/ui';
import { useFocusHeading } from '../lib/hooks';
import { ClosedScreen } from './Closed';
import { FigLogo, FigPage, isAppHost } from '../components/fig/FigShell';
import { G3WebHeader } from '../components/fig/G3WebShell';
import { FigActions, FigField, FigNote } from '../components/fig/FigUi';
import { FigMail } from '../components/fig/icons';
import '../styles/fig-g1.css';

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

/** Web · 1 and 2 (18 Nov design) · Sign in: the personal email the portal was sent to, then the 6-digit code emailed to it (no password). */
export function SignIn() {
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
  const [wait, setWait] = useState(0);
  const client = useLastClient();
  const emailId = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>(sent ? 'code' : 'email');
  const from = (location.state as { from?: string } | null)?.from;
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setTimeout(() => setWait((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const sendCode = async () => {
    await portal.sendCode(email.trim());
    setSent(true);
    setCode('');
    setWait(30);
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (!sent) {
        if (!email.trim()) { setError('Enter your work email.'); return; }
        await sendCode(); return;
      }
      if (code.length !== 6) { setError('Enter the 6-digit code.'); return; }
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
  const company = client.company;
  const change = () => { setSent(false); setError(undefined); };
  // App · 1 asks for the work email; Web · 1 (the browser portal) for the personal email the offer went to.
  const app = isAppHost();
  return (
    <FigPage surface>
      <G3WebHeader company={company} />
      <form className="fig-signin" onSubmit={submit} noValidate aria-describedby={error ? 'signin-err' : undefined}>
        <div className="fig-signin__lead">
          {!sent && <div className="fig-signin__top" />}
          <div className="fig-signin__body">
            {sent
              ? <span className="fig-signin__mark fig-signin__mark--mail"><FigMail /></span>
              : <FigLogo company={company} className="fig-signin__mark" />}
            <div className="fig-signin__text">
              <h1 ref={h1} tabIndex={-1} className="fig-display">{sent ? 'Check your email' : app ? 'Log in with your work email' : `Welcome to ${company?.name ?? 'your joining portal'}`}</h1>
              {sent ? (
                <div className="fig-signin__sent">
                  <p className="fig-body fig-t2">Enter the 6-digit code we sent to your personal email.</p>
                  <div className="fig-signin__email">
                    <span className="fig-body-strong">{email.trim()}</span>
                    <button type="button" className="fig-link" onClick={change}>Change</button>
                  </div>
                </div>
              ) : <p className="fig-body fig-t2">{app ? 'The one HR set up for you.' : 'Sign in to see your offer, joining details and profile. We’ll email you a code, so there’s no password to remember.'}</p>}
            </div>
            {params.get('expired') && !sent && <FigNote>You were signed out. Please sign in again.</FigNote>}
            {!sent ? (
              <FigField id={emailId} label={app ? 'Work email' : 'Personal email'} help={app ? 'It’s on your pre-boarding page.' : 'Use the email your offer letter was sent to.'} type="email" inputMode="email" autoComplete="email" placeholder={app ? 'you@company.com' : 'you@example.com'}
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <CodeBoxes value={code} onChange={(c) => { setCode(c); if (c.length === 6) setError(undefined); }} />
                <p className="fig-resend">
                  {wait > 0
                    ? <><span>Didn’t get it? Check your spam folder, or resend in</span><b>{Math.floor(wait / 60)}:{String(wait % 60).padStart(2, '0')}</b></>
                    : <><span>Didn’t get it? Check your spam folder, or</span><button type="button" className="fig-link" onClick={() => { setError(undefined); void sendCode().catch((err) => setError((err as Error).message)); }}>send a new code</button></>}
                </p>
              </div>
            )}
            {error && <p id="signin-err" className="fig-field__error" role="alert">{error}</p>}
          </div>
        </div>
        <FigActions note={<>Trouble signing in?{client.hr ? <a className="fig-link" href={`mailto:${client.hr.email}`}>Write to HR</a> : ' Reply to the email from HR.'}</>}>
          <button type="submit" className="fig-btn" disabled={busy}>
            {busy ? (sent ? 'Checking…' : 'Sending…') : sent ? 'Verify and continue' : 'Send me a code'}
          </button>
        </FigActions>
      </form>
    </FigPage>
  );
}

/** Six boxes for the code: typing moves along, Backspace moves back, a pasted code fills them all. */
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { refs.current[Math.min(value.length, 5)]?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const put = (at: number, digits: string) => {
    const clean = digits.replace(/\D/g, '');
    if (!clean) return;
    const next = (value.slice(0, at) + clean).slice(0, 6);
    onChange(next);
    refs.current[Math.min(next.length, 5)]?.focus();
  };
  return (
    <div className="fig-otp" role="group" aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, k) => (
        <input key={k} ref={(el) => { refs.current[k] = el; }} inputMode="numeric" autoComplete={k === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${k + 1}`}
          className={value[k] ? 'has-value' : ''} value={value[k] ?? ''} maxLength={k === 0 ? 6 : 1}
          onChange={(e) => put(k, e.target.value)}
          onPaste={(e) => { e.preventDefault(); onChange(e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)); }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') { e.preventDefault(); const at = value[k] ? k : Math.max(0, k - 1); onChange(value.slice(0, at)); refs.current[at]?.focus(); }
            if (e.key === 'ArrowLeft' && k > 0) refs.current[k - 1]?.focus();
            if (e.key === 'ArrowRight' && k < 5) refs.current[k + 1]?.focus();
          }} />
      ))}
    </div>
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
