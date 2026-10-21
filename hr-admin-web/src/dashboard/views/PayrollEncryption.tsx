// Payroll › Salary encryption: the panel that turns end-to-end encryption on
// and manages it, and the gate every salary screen sits behind while the
// company's payroll key is locked in this browser.
//
// The passphrase and the payroll key never leave this browser: the server
// only ever stores them locked. See docs/PAYROLL_ENCRYPTION.md.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import type { CryptoStatus } from '../../services/payroll-core';
import {
  cachedPayrollStatus,
  isPayrollUnlocked,
  lockPayroll,
  onPayrollLockChange,
  payrollCryptoChanged,
  payrollCryptoStatus,
  sealedPayroll,
} from '../../services/payrollSealed';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** The company's encryption status and lock, kept fresh for this component. */
function useCrypto() {
  const [status, setStatus] = useState<CryptoStatus | null>(cachedPayrollStatus());
  const [loaded, setLoaded] = useState(Boolean(cachedPayrollStatus()));
  const [, rerender] = useState(0);
  useEffect(() => {
    let alive = true;
    void payrollCryptoStatus().then((s) => { if (alive) { setStatus(s); setLoaded(true); } });
    const off = onPayrollLockChange(() => { if (alive) { setStatus(cachedPayrollStatus()); rerender((n) => n + 1); } });
    return () => { alive = false; off(); };
  }, []);
  return { status, loaded, unlocked: isPayrollUnlocked() };
}

/** After unlocking: finish a rotation someone's access removal asked for, and lock anything still readable. */
async function afterUnlock(flash: (m: string) => void) {
  let s = await payrollCryptoChanged();
  if (s?.rotationRequired) {
    await sealedPayroll.rotate();
    flash('Payroll key rotated: someone who held it no longer has payroll access');
    s = await payrollCryptoChanged();
  }
  if ((s?.plaintextRemaining?.total ?? 0) > 0) {
    const r = await sealedPayroll.lockExisting();
    flash(`Locked ${r.sealed} record${r.sealed === 1 ? '' : 's'} that were still readable`);
    await payrollCryptoChanged();
  }
}

// —— The gate ————————————————————————————————————————————————————————————

/** Shows `children` unless the company's salaries are encrypted and locked here. */
export function PayrollUnlockGate({ children }: { children: ReactNode }) {
  const { status, loaded, unlocked } = useCrypto();
  if (!loaded) return <Card style={{ padding: '30px 22px', textAlign: 'center', color: '#717171', fontSize: 15 }}>Loading…</Card>;
  if (!status || status.mode !== 'encrypted' || unlocked) return <>{children}</>;
  return <UnlockCard status={status} />;
}

function UnlockCard({ status }: { status: CryptoStatus }) {
  const { flash } = useStore();
  const [pass, setPass] = useState('');
  const [mode, setMode] = useState<'unlock' | 'recover' | 'create'>(status.me.key ? 'unlock' : 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const holders = status.holders;
  const waiting = Boolean(status.me.key) && !status.me.wrappedDataKey;

  return (
    <Card style={{ padding: '26px 26px', maxWidth: 560 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>🔒</span>
        <div style={{ fontSize: 19, fontWeight: 800 }}>Unlock payroll</div>
      </div>
      <div style={{ fontSize: 14.5, color: '#717171', lineHeight: 1.55, marginBottom: 16 }}>
        This company's salaries are end-to-end encrypted. They open only in your browser, with your own passphrase.
      </div>

      {mode === 'create' && (
        <CreateKeyForm busy={busy} onSubmit={(p) => run(async () => {
          await sealedPayroll.createMyKey(p);
          await payrollCryptoChanged();
          flash('Your key is ready. Ask someone who holds the payroll key to grant you access.');
          setMode('unlock');
        })} />
      )}

      {mode === 'unlock' && (waiting ? (
        <div style={note}>
          Your key is ready. Waiting for someone who holds the payroll key ({holders} {holders === 1 ? 'person' : 'people'}) to open
          {' '}<strong>Payroll Runs › Salary encryption</strong> and click <strong>Grant access</strong>.
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await sealedPayroll.unlock(pass); setPass(''); await afterUnlock(flash); }); }}>
          <label style={label} htmlFor="payroll-unlock-pass">Your passphrase</label>
          <input id="payroll-unlock-pass" type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} style={input} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
            <button type="submit" disabled={busy || !pass} style={primaryBtn}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          </div>
        </form>
      ))}

      {mode === 'recover' && (
        <RecoverForm busy={busy} onSubmit={(rk, p) => run(async () => { await sealedPayroll.recover(rk, p); await afterUnlock(flash); flash('Recovered: your new passphrase unlocks payroll from now on'); })} />
      )}

      {error && <div style={errorBox}>{error}</div>}

      <div style={{ marginTop: 16, fontSize: 13.5, color: '#717171' }}>
        {mode !== 'recover' && status.recovery && (
          <button type="button" onClick={() => { setMode('recover'); setError(''); }} style={linkBtn}>Forgot passphrase? Use recovery key</button>
        )}
        {mode === 'recover' && (
          <button type="button" onClick={() => { setMode(status.me.key ? 'unlock' : 'create'); setError(''); }} style={linkBtn}>Back</button>
        )}
      </div>
    </Card>
  );
}

// —— The panel (top of Payroll Runs) ——————————————————————————————————————

type Panel = null | 'setup' | 'change' | 'newRecovery' | 'grant';

export function PayrollEncryptionCard() {
  const { flash } = useStore();
  const { status, loaded, unlocked } = useCrypto();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shownKey, setShownKey] = useState<{ key: string; lockError?: string } | null>(null);
  if (!loaded || !status) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const encrypted = status.mode === 'encrypted';
  const pendingGrants = status.members.filter((m) => m.hasKey && !m.granted);
  const remaining = status.plaintextRemaining?.total ?? 0;

  if (shownKey) {
    return (
      <Card style={{ padding: '22px 24px', marginBottom: 18 }}>
        <RecoveryKeyBox recoveryKey={shownKey.key} onDone={() => setShownKey(null)} />
        {shownKey.lockError && (
          <div style={{ ...errorBox, marginTop: 14 }}>
            Encryption is on, but locking the existing records stopped: {shownKey.lockError}. Close this, then click <strong>Finish locking</strong>.
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card style={{ padding: '18px 22px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20 }}>{encrypted ? '🔐' : '🔓'}</span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800 }}>Salary encryption</div>
          <div style={{ fontSize: 13.5, color: '#717171', marginTop: 2 }}>
            {encrypted
              ? `On · ${status.holders} ${status.holders === 1 ? 'person holds' : 'people hold'} the payroll key${status.since ? ` · since ${new Date(status.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${unlocked ? ' · unlocked in this browser' : ''}`
              : 'Off · salaries are protected by access settings only'}
          </div>
        </div>
        {!encrypted && panel !== 'setup' && <button type="button" onClick={() => setPanel('setup')} style={primaryBtn}>Set up encryption</button>}
        {encrypted && unlocked && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pendingGrants.length > 0 && <button type="button" onClick={() => setPanel('grant')} style={primaryBtn}>Grant access ({pendingGrants.length})</button>}
            <button type="button" onClick={() => setPanel(panel === 'change' ? null : 'change')} style={ghostBtn}>Change passphrase</button>
            <button type="button" onClick={() => setPanel(panel === 'newRecovery' ? null : 'newRecovery')} style={ghostBtn}>New recovery key</button>
            <button type="button" onClick={() => { lockPayroll(); flash('Payroll locked in this browser'); }} style={ghostBtn}>Lock</button>
          </div>
        )}
      </div>

      {encrypted && status.rotationRequired && (
        <div style={{ ...warnBox, marginTop: 14 }}>
          Someone who held the payroll key no longer has payroll access. The key is rotated automatically the next time a key holder unlocks.
          {unlocked && <> <button type="button" disabled={busy} onClick={() => void run(async () => { await sealedPayroll.rotate(); await payrollCryptoChanged(); flash('Payroll key rotated'); })} style={linkBtn}>Rotate now</button></>}
        </div>
      )}
      {encrypted && remaining > 0 && (
        <div style={{ ...warnBox, marginTop: 14 }}>
          {remaining} payroll record{remaining === 1 ? ' is' : 's are'} still readable.
          {unlocked
            ? <> <button type="button" disabled={busy} onClick={() => void run(async () => { const r = await sealedPayroll.lockExisting(); await payrollCryptoChanged(); flash(`Locked ${r.sealed} record${r.sealed === 1 ? '' : 's'}`); })} style={linkBtn}>Finish locking</button></>
            : ' Unlock below to finish locking them.'}
        </div>
      )}

      {panel === 'setup' && !encrypted && (
        <SetupForm busy={busy} onCancel={() => setPanel(null)} onSubmit={(p) => run(async () => {
          const r = await sealedPayroll.setup(p);
          await payrollCryptoChanged();
          setPanel(null);
          setShownKey({ key: r.recoveryKey, lockError: r.lockError });
        })} />
      )}

      {panel === 'change' && unlocked && (
        <ChangePassphraseForm busy={busy} onCancel={() => setPanel(null)} onSubmit={(oldP, newP) => run(async () => {
          await sealedPayroll.changePassphrase(oldP, newP);
          await payrollCryptoChanged();
          setPanel(null);
          flash('Passphrase changed: use the new one from now on');
        })} />
      )}

      {panel === 'newRecovery' && unlocked && (
        <div style={section}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Make a new recovery key?</div>
          <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.55, marginBottom: 12 }}>
            The current recovery key stops working at once and the payroll key is renewed. You'll see the new recovery key once.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const key = await sealedPayroll.replaceRecoveryKey();
              await payrollCryptoChanged();
              setPanel(null);
              setShownKey({ key });
            })} style={primaryBtn}>{busy ? 'Making it…' : 'Make a new recovery key'}</button>
            <button type="button" onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {panel === 'grant' && unlocked && (
        <div style={section}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Give the payroll key to</div>
          {pendingGrants.map((m) => <div key={m.userId} style={{ fontSize: 14.5, padding: '4px 0' }}>{m.name}</div>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const names = await sealedPayroll.grantPending();
              await payrollCryptoChanged();
              setPanel(null);
              flash(names.length ? `Access granted to ${names.join(', ')}` : 'Nobody was waiting');
            })} style={primaryBtn}>{busy ? 'Granting…' : 'Grant access'}</button>
            <button type="button" onClick={() => setPanel(null)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {encrypted && unlocked && status.members.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid #F1F1F4', paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13.5, color: '#484848' }}>
          {status.members.map((m) => (
            <span key={m.userId}>{m.name}: <span style={{ color: m.granted ? '#4F7A52' : m.hasKey ? '#9A6B25' : '#717171', fontWeight: 600 }}>{m.granted ? 'holds the key' : m.hasKey ? 'waiting for access' : 'no key yet'}</span></span>
          ))}
        </div>
      )}

      {error && <div style={errorBox}>{error}</div>}
    </Card>
  );
}

// —— Forms ——————————————————————————————————————————————————————————————

function NewPassphrase({ value, again, onValue, onAgain, idPrefix }: { value: string; again: string; onValue: (v: string) => void; onAgain: (v: string) => void; idPrefix: string }) {
  const short = value.length > 0 && value.length < 10;
  const mismatch = again.length > 0 && again !== value;
  return (
    <>
      <label style={label} htmlFor={`${idPrefix}-new`}>New passphrase (at least 10 characters; a few random words work well)</label>
      <input id={`${idPrefix}-new`} type="password" autoComplete="new-password" value={value} onChange={(e) => onValue(e.target.value)} style={input} />
      {short && <div style={hint}>Use at least 10 characters.</div>}
      <label style={{ ...label, marginTop: 10 }} htmlFor={`${idPrefix}-again`}>Type it again</label>
      <input id={`${idPrefix}-again`} type="password" autoComplete="new-password" value={again} onChange={(e) => onAgain(e.target.value)} style={input} />
      {mismatch && <div style={hint}>The two don't match.</div>}
    </>
  );
}

const passphraseOk = (p: string, again: string) => p.length >= 10 && p === again;

function SetupForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (p: string) => void; onCancel: () => void }) {
  const [p, setP] = useState('');
  const [again, setAgain] = useState('');
  const [understood, setUnderstood] = useState(false);
  return (
    <form style={section} onSubmit={(e) => { e.preventDefault(); if (passphraseOk(p, again) && understood) onSubmit(p); }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Turn on salary encryption</div>
      <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.55, marginBottom: 14 }}>
        Salaries, payslips and tax declarations are locked with a key that only payroll people hold. Nobody else can read them in the database, Sowaka included.
        Salaries already saved here are locked straight away.
      </div>
      <NewPassphrase value={p} again={again} onValue={setP} onAgain={setAgain} idPrefix="setup" />
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, fontSize: 14, color: '#484848', lineHeight: 1.5 }}>
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ marginTop: 3 }} />
        I understand that if every payroll person's passphrase and the recovery key are lost, the salaries can't be recovered by anyone.
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="submit" disabled={busy || !passphraseOk(p, again) || !understood} style={primaryBtn}>{busy ? 'Turning it on…' : 'Turn on encryption'}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </form>
  );
}

function CreateKeyForm({ busy, onSubmit }: { busy: boolean; onSubmit: (p: string) => void }) {
  const [p, setP] = useState('');
  const [again, setAgain] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (passphraseOk(p, again)) onSubmit(p); }}>
      <div style={{ fontSize: 14.5, color: '#484848', marginBottom: 10 }}>You don't have a payroll key yet. Choose a passphrase to make one.</div>
      <NewPassphrase value={p} again={again} onValue={setP} onAgain={setAgain} idPrefix="create" />
      <button type="submit" disabled={busy || !passphraseOk(p, again)} style={{ ...primaryBtn, marginTop: 14 }}>{busy ? 'Making your key…' : 'Create my key'}</button>
    </form>
  );
}

function RecoverForm({ busy, onSubmit }: { busy: boolean; onSubmit: (recoveryKey: string, p: string) => void }) {
  const [rk, setRk] = useState('');
  const [p, setP] = useState('');
  const [again, setAgain] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (rk.trim() && passphraseOk(p, again)) onSubmit(rk.trim(), p); }}>
      <label style={label} htmlFor="recover-key">Recovery key</label>
      <input id="recover-key" value={rk} onChange={(e) => setRk(e.target.value)} placeholder="xxxxxxxx-xxxxxxxx-…" style={{ ...input, fontFamily: 'ui-monospace, Menlo, monospace' }} />
      <div style={{ height: 10 }} />
      <NewPassphrase value={p} again={again} onValue={setP} onAgain={setAgain} idPrefix="recover" />
      <button type="submit" disabled={busy || !rk.trim() || !passphraseOk(p, again)} style={{ ...primaryBtn, marginTop: 14 }}>{busy ? 'Recovering…' : 'Recover and set new passphrase'}</button>
    </form>
  );
}

function ChangePassphraseForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (oldP: string, newP: string) => void; onCancel: () => void }) {
  const [oldP, setOldP] = useState('');
  const [p, setP] = useState('');
  const [again, setAgain] = useState('');
  return (
    <form style={section} onSubmit={(e) => { e.preventDefault(); if (oldP && passphraseOk(p, again)) onSubmit(oldP, p); }}>
      <label style={label} htmlFor="change-old">Current passphrase</label>
      <input id="change-old" type="password" autoComplete="current-password" value={oldP} onChange={(e) => setOldP(e.target.value)} style={input} />
      <div style={{ height: 10 }} />
      <NewPassphrase value={p} again={again} onValue={setP} onAgain={setAgain} idPrefix="change" />
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="submit" disabled={busy || !oldP || !passphraseOk(p, again)} style={primaryBtn}>{busy ? 'Changing…' : 'Change passphrase'}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </form>
  );
}

/** The recovery key, shown once: copy it, confirm it's saved, then it's gone from the screen. */
function RecoveryKeyBox({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const { flash } = useStore();
  const [saved, setSaved] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(recoveryKey).then(() => flash('Recovery key copied'), () => flash('Select the key and copy it'));
  };
  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>Your recovery key</div>
      <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.55, marginBottom: 12 }}>
        This is shown once. It opens payroll if passphrases are forgotten. Keep it somewhere safe and offline, for example a password manager and a printed copy, or split between two founders.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ flex: 1, minWidth: 260, padding: '12px 14px', background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 15, letterSpacing: '.02em', wordBreak: 'break-all', userSelect: 'all' }}>{recoveryKey}</code>
        <button type="button" onClick={copy} style={ghostBtn}>Copy</button>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 14.5, color: '#222' }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I saved it somewhere safe
      </label>
      <button type="button" disabled={!saved} onClick={onDone} style={{ ...primaryBtn, marginTop: 12 }}>Done</button>
    </div>
  );
}

// —— Styles ————————————————————————————————————————————————————————————

const label: CSSProperties = { display: 'block', fontSize: 13.5, fontWeight: 700, color: '#484848', marginBottom: 5 };
const input: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #D9DCE1', borderRadius: 9, fontSize: 15.5, fontFamily: 'inherit', background: '#fff', color: '#222', boxSizing: 'border-box' };
const hint: CSSProperties = { fontSize: 12.5, color: '#A8475F', marginTop: 4 };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 16px', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: '#0571A6', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
const section: CSSProperties = { marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F1F4', maxWidth: 560 };
const note: CSSProperties = { background: '#F7F7F9', border: '1px solid #EBEBEB', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#484848', lineHeight: 1.55 };
const warnBox: CSSProperties = { background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#8A6A20', lineHeight: 1.5 };
const errorBox: CSSProperties = { marginTop: 12, background: '#FBEFF2', border: '1px solid #EBD9DE', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#A8475F', lineHeight: 1.5 };
