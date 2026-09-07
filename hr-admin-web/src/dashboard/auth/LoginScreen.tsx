import { useState } from 'react';
import type { FormEvent } from 'react';
import { requestOtp, verifyOtp } from '../../services/auth';
import { ApiError } from '../../services/http';
import { useAuth } from './AuthContext';
import { Logo } from '../icons';

const inputStyle = {
  width: '100%',
  border: '1px solid #EBEBEB',
  borderRadius: 11,
  padding: '12px 14px',
  fontSize: 16,
  outline: 'none',
  background: '#fff',
  color: '#222222',
} as const;

const primaryBtn = {
  width: '100%',
  border: 'none',
  background: '#0571A6',
  color: '#fff',
  borderRadius: 11,
  padding: '13px',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(5,113,166,.26)',
} as const;

export function LoginScreen() {
  const { setUser } = useAuth();
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      await requestOtp(email.trim());
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setBusy(true);
    setError('');
    try {
      const user = await verifyOtp(email.trim(), otp.trim());
      setUser(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', width: '100%', background: '#F7F7F9', padding: 24 }}>
      <div style={{ width: 400, background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 20, boxShadow: '0 20px 50px rgba(60,40,24,.12)', padding: '34px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 22 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: '#0571A6', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(5,113,166,.28)' }}>
            <Logo />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px', lineHeight: 1 }}>Sowaka</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#717171', marginTop: 3 }}>HR Admin</div>
          </div>
        </div>

        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.4px', marginBottom: 6 }}>
          {step === 'email' ? 'Sign in' : 'Enter your code'}
        </div>
        <div style={{ fontSize: 16, color: '#717171', fontWeight: 500, lineHeight: 1.5, marginBottom: 22 }}>
          {step === 'email'
            ? 'We’ll email you a one-time sign-in code.'
            : `We sent a 6-digit code to ${email}.`}
        </div>

        {step === 'email' ? (
          <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
              style={inputStyle}
            />
            {error && <div style={{ fontSize: 14, color: '#A8475F', fontWeight: 600 }}>{error}</div>}
            <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoFocus
              style={{ ...inputStyle, letterSpacing: '6px', fontSize: 20, fontWeight: 700, textAlign: 'center' }}
            />
            {error && <div style={{ fontSize: 14, color: '#A8475F', fontWeight: 600 }}>{error}</div>}
            <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setOtp(''); setError(''); }}
              style={{ border: 'none', background: 'none', color: '#717171', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: 4 }}
            >
              ← Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
