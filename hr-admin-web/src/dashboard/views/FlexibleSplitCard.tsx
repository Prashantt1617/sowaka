// Employee profile › Salary details › Flexible split: what the person chose on
// the app (Payroll › Change my split) for the flexible heads of their
// template, the split in force now and every version of the financial year.
// Read only: the employee changes it on the app. Payroll access only; hidden
// otherwise, and when the template has no flexible heads and nothing was ever
// split.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ApiError } from '../../services/http';
import { getEmployeeSplit } from '../../services/payroll';
import type { EmployeeSplitDTO, SplitComponentDTO, SplitVersionDTO } from '../../services/payroll';
import { LoadError, Pill, SkeletonLines } from '../ui';
import * as Lk from './look';
import './people.css';

const money = (paise: number | null | undefined) => (paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined });

function fyOf(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
function previousFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function FlexibleSplitCard({ userId, name }: { userId: string; name: string }) {
  const thisFy = fyOf(new Date());
  const [fy, setFy] = useState(thisFy);
  const [split, setSplit] = useState<EmployeeSplitDTO | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');
    getEmployeeSplit(userId, fy)
      .then((s) => { if (live) { setSplit(s); setState('ready'); } })
      .catch((e: unknown) => { if (live) setState(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'hidden' : 'error'); });
    return () => { live = false; };
  }, [userId, fy, attempt]);

  if (state === 'hidden') return null;
  // Nothing to split, ever, in the year being looked at: no card (the year can still be switched back).
  if (state === 'ready' && split && !split.available && split.versions.length === 0 && fy === thisFy) return null;

  const head = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
      <div style={{ flex: 1 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Flexible split</h3>
        <div style={{ ...Lk.cardNote, marginTop: 2 }}>What {name} chose on the app for the flexible heads. Each month&apos;s run pays the split in force for that month; what is left unassigned is paid as the balancing component and taxed in full.</div>
      </div>
      <select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year" style={select}>
        {[thisFy, previousFy(thisFy)].map((f) => <option key={f} value={f}>FY {f}</option>)}
      </select>
    </div>
  );

  if (state !== 'ready' || !split) {
    return (
      <section className="pd-card" style={{ marginBottom: 20 }}>
        {head}
        {state === 'error' ? <LoadError compact text="The flexible split could not be loaded." onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonLines lines={4} />}
      </section>
    );
  }

  const cur = split.current;
  const codes = new Map<string, { name: string; limitPaise: number | null }>();
  for (const c of [...split.baseline, ...(cur?.components ?? [])]) if (!codes.has(c.code)) codes.set(c.code, { name: c.name, limitPaise: c.limitPaise });
  const amountIn = (list: SplitComponentDTO[] | undefined, code: string) => list?.find((c) => c.code === code)?.amountPaise;
  const assigned = cur ? cur.assignedPaise : split.baseline.reduce((t, c) => t + c.amountPaise, 0);
  const pool = cur?.poolPaise ?? split.poolPaise;
  const unassigned = cur ? cur.unassignedPaise : pool != null ? Math.max(0, pool - assigned) : null;
  const versions = [...split.versions].reverse();

  return (
    <section className="pd-card" style={{ marginBottom: 20 }}>
      {head}
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kv k="Pool a month" v={money(pool)} sub={split.template ? `Template ${split.template.name}` : 'No salary structure'} />
        <Kv k="Assigned" v={money(assigned)} />
        <Kv k="Unassigned" v={money(unassigned)} sub="Paid as the balancing component" />
        <Kv k="In force" v={cur ? `From ${monthLabel(cur.effectiveFrom)}` : 'No split chosen'} sub={cur ? `Submitted ${dayLabel(cur.submittedAt)}` : split.asOf ? 'The structure\'s own amounts apply' : 'The year has not started'} />
        <Kv k="A change now applies from" v={monthLabel(split.window.effectiveFrom)} sub={`Until ${dayLabel(split.window.closesOn)} · bills due ${dayLabel(split.billsDueOn)}`} />
      </div>

      {codes.size === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{split.hasSalaryStructure ? 'The template has no flexible heads.' : 'No salary structure assigned.'}</div>
      ) : (
        <table className="lk-t" style={Lk.table}>
          <thead>
            <tr>
              <th style={Lk.th}>Flexible head</th>
              <th style={{ ...Lk.th, textAlign: 'right' }}>Limit a month</th>
              <th style={{ ...Lk.th, textAlign: 'right' }}>Without a split</th>
              <th style={{ ...Lk.th, textAlign: 'right' }}>In force{split.asOf ? ` (${monthLabel(split.asOf)})` : ''}</th>
            </tr>
          </thead>
          <tbody>
            {[...codes].map(([code, c]) => {
              const now = cur ? amountIn(cur.components, code) ?? 0 : amountIn(split.baseline, code) ?? 0;
              return (
                <tr key={code}>
                  <td style={Lk.td}>{c.name}</td>
                  <td style={num}>{money(c.limitPaise)}</td>
                  <td style={{ ...num, color: 'var(--ink-2)' }}>{money(amountIn(split.baseline, code) ?? null)}</td>
                  <td style={{ ...num, fontWeight: 500 }}>{money(now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ ...Lk.eyebrow, marginTop: 20, marginBottom: 8 }}>History · FY {split.fy}</div>
      {versions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No split submitted this year.</div>
      ) : (
        <table className="lk-t" style={Lk.table}>
          <thead>
            <tr>
              <th style={Lk.th}>Months</th>
              <th style={Lk.th}>Submitted</th>
              <th style={Lk.th}>Split</th>
              <th style={{ ...Lk.th, textAlign: 'right' }}>Assigned</th>
              <th style={{ ...Lk.th, textAlign: 'right' }}>Unassigned</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => <VersionRow key={v.effectiveFrom} v={v} />)}
          </tbody>
        </table>
      )}
      {versions.some((v) => v.poolSource === 'current_template') && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>* Saved before the pool was kept with a split: read against today&apos;s pool.</div>}
    </section>
  );
}

function VersionRow({ v }: { v: SplitVersionDTO }) {
  return (
    <tr>
      <td style={Lk.td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{monthLabel(v.effectiveFrom)}{v.effectiveTo !== v.effectiveFrom ? ` – ${monthLabel(v.effectiveTo)}` : ''}</span>
          {v.inForce && <Pill label="In force" tone={Lk.TONES.ok} />}
        </div>
      </td>
      <td style={{ ...Lk.td, color: 'var(--ink-2)' }}>{dayLabel(v.submittedAt)}</td>
      <td style={{ ...Lk.td, color: 'var(--ink-2)' }}>{v.components.filter((c) => c.amountPaise > 0).map((c) => `${c.name} ${money(c.amountPaise)}`).join(' · ') || 'Nothing assigned'}</td>
      <td style={num}>{money(v.assignedPaise)}</td>
      <td style={num}>{money(v.unassignedPaise)}{v.poolSource === 'current_template' ? ' *' : ''}</td>
    </tr>
  );
}

function Kv({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <div style={Lk.kvDt}>{k}</div>
      <div style={{ ...Lk.kvDd, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      {sub && <div style={{ ...Lk.cellSub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const num: CSSProperties = { ...Lk.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const select: CSSProperties = { height: 32, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 999, fontSize: 12, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
