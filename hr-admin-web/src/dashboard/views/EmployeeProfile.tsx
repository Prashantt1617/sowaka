// Employee profile — opened by clicking a row in the Employees table.
// Surfaces everything captured in the Add-user wizard (Basic / Personal /
// Salary / Payment), plus the person's shift, leave balance, any open requests
// and their performance (PMS) snapshot.
// Identity, reporting line, department, KPIs and the performance review come
// from the API. The salary, personal and leave-balance blocks are still derived
// deterministically from the employee ID — those features are planned but not
// wired to a backend yet, so the sections stand as placeholders rather than
// being removed.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { Emp, EmpDocument } from '../seed';
import { useStore } from '../store';
import { docStatus } from './lifecycle/preboardingLinks';
import { ETYPE, STAT, TYPE } from '../theme';
import type { LeaveType, ReqStatus } from '../theme';
import { Avatar, ListPending, LoadError, LoadingFigure, Pill, Skeleton, SkeletonForm, SkeletonFrame, SkeletonLines, SkeletonRows, StatusTabs } from '../ui';
import { BasicDetailsGrid, Connector, DocumentList, Fact, GhostNode, Grid, LockedField, OrgNode, ProfileHeader, Row, Section, SkeletonGrid } from './profileParts';
import { EMP_TYPE_VALUE, nameParts, showDate } from './profileWords';
import type { ProfileDocItem } from './profileParts';
import type { LoadState } from '../ui';
import { useLoad } from '../useLoad';
import { PdBank, PdCalendar, PdChart, PdClock, PdEdit, PdFile, PdStar, PdTarget, PdTrash, PdUser } from './pdIcons';
import './people.css';
import { periodLabel, periodShort } from '../period';
import { EmployeeKpiPanel } from './KpiAssign';
import { assignShift, clearCalendarDay, clearReportingManager, deleteEmployee, getCompanySettings, listExits, getEmployeeCalendar, getShifts, setCalendarDay, setReportingManager, updateEmployeeDetails } from '../../services/hrms';
import type { EmployeeDetailsInput, ExitDTO, ShiftDTO } from '../../services/hrms';
import { ExitBanner, ExitDialog } from './ExitDialog';
import { ExitDetail } from './ExitDetail';
import { StartExit } from './lifecycle/offboarding/StartExit';
import { Field, GENDERS as GENDER_CHOICES, Select, TypeOrPick, grid2, grid3, infoCallout, infoIcon, inputStyle } from './AddEmployeeWizard';
import { ApiError } from '../../services/http';
import { useAuth } from '../auth/AuthContext';
import { canOpen, isTeamScope, SALARY_DETAILS } from '../access';
import { getEmployeePayslips, getEpfBalance, getPaymentDetails, inr as inrPaise, saveEpfBalance, savePaymentDetails, type EpfBalanceDTO, type PaymentDetailsDTO, type PaymentDetailsInput, type PayrollRunDTO, type PayslipDTO } from '../../services/payroll';
import { EmployeeSalary } from './EmployeeSalary';
import { EmployeeActivity } from './EmployeeActivity';
import { isSelfOrBelow } from './selfOrBelow';
import { IncomeTaxCard } from './IncomeTaxCard';
import { LossOfPayExplainer } from '../LossOfPayExplainer';
import { employedDaysOf, lossOfPayDaysOf, notEmployedNote } from '../payslipDays';
import { downloadPayslipPdf } from '../payslip';
import { downloadTdsSheetPdf } from '../tdsSheet';
import type { CalendarDayDTO, CalendarDayStatus, EmployeeCalendarDTO, HrDayStatus, LeaveBalanceItemDTO } from '../../services/hrms';
import { getEmployeeLeaveBalance, setEmployeeLeaveTotal } from '../../services/hrms';
import { btn, btnClass } from '../ds';
import { MarkDay } from './MarkDay';

// —— Deterministic per-person derivations ————————————————————————————————
const GENDERS = ['Male', 'Female'];
const BANKS = ['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'State Bank of India', 'Kotak Mahindra Bank'];
const STATE_BY_CITY: Record<string, string> = {
  Bengaluru: 'Karnataka', Mumbai: 'Maharashtra', Gurugram: 'Haryana', Remote: 'Karnataka',
};
const WORKLOC_BY_CITY: Record<string, string> = {
  Bengaluru: 'Head Office — Bengaluru', Mumbai: 'Mumbai Sales Office', Gurugram: 'Delhi NCR Hub', Remote: 'Remote — India',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RATINGS = ['Outstanding', 'Exceeds expectations', 'Meets expectations', 'Developing'];

function seedOf(emp: Emp): number {
  const m = emp.employeeId.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 100;
}
function derive(emp: Emp) {
  const seed = seedOf(emp);
  const { first, middle, last } = nameParts(emp.name);
  const gender = GENDERS[seed % 2];
  const level = /Manager|Head|Lead/.test(emp.role) ? 'lead' : /Senior/.test(emp.role) ? 'senior' : 'associate';
  const ctc = (level === 'lead' ? 2800000 : level === 'senior' ? 1800000 : 900000) + (seed % 9) * 60000;
  const basicM = Math.round((ctc * 0.5) / 12);
  const hraM = Math.round(basicM * 0.5);
  const template = emp.empType === 'Contract' ? 'Contract / Consultant' : level === 'lead' ? 'Senior Management' : 'Standard';
  const esi = ctc / 12 <= 21000; // ESI only up to ₹21k/mo
  const dobYear = 1988 + (seed % 14);
  const dobMonth = seed % 12;
  const dobDay = ((seed * 5) % 27) + 1;
  const age = 2026 - dobYear;

  return {
    seed, gender, level, ctc, basicM, hraM, template, esi, age,
    firstName: first, middleName: middle, lastName: last,
    workEmail: emp.email || '—',
    personalEmail: `${first}${seed}`.toLowerCase() + '@gmail.com',
    mobile: `+91 9${String(80000000 + (seed * 137) % 19999999).padStart(8, '0')}`,
    workLocation: WORKLOC_BY_CITY[emp.location] || emp.location,
    dob: `${String(dobDay).padStart(2, '0')} ${MONTHS[dobMonth]} ${dobYear}`,
    fatherName: `Mr. ${last} (Sr.)`,
    pan: `A${String.fromCharCode(65 + seed % 26)}QPJ${String(1000 + seed).slice(-4)}${String.fromCharCode(65 + (seed * 3) % 26)}`,
    address: `${100 + seed % 400}, ${['Green Meadows', 'Lake View', 'Palm Residency', 'Orchid Enclave', 'Sunrise Towers'][seed % 5]}`,
    city: emp.location === 'Remote' ? 'Bengaluru' : emp.location,
    state: STATE_BY_CITY[emp.location] || 'Karnataka',
    pin: String(560000 + (seed * 7) % 40000),
    pfAccount: `KA/BNG/00${String(12345 + seed).slice(-5)}/000/000${seed % 9}`,
    uan: String(100000000000 + seed * 813).slice(0, 12),
    esiNumber: esi ? String(3100000000000000 + seed * 91).slice(0, 17) : '',
    bank: BANKS[seed % BANKS.length],
    accountNo: '••••••' + String(1000 + (seed * 271) % 8999),
    ifsc: ['HDFC', 'ICIC', 'UTIB', 'SBIN', 'KKBK'][seed % 5] + '0' + String(100000 + seed * 13).slice(-6),
    accountType: 'Savings',
    payMode: 'Direct Deposit (Automated Process)',
  };
}

// A leave type's colour: the three originals keep theirs, anything HR added takes the accent.
const TYPE_BY_KEY: Record<string, LeaveType> = { sick: 'Sick', casual: 'Casual', earned: 'Earned' };
const leaveColour = (key: string) => (TYPE_BY_KEY[key] ? TYPE[TYPE_BY_KEY[key]] : 'var(--accent)');
const days = (n: number) => String(Math.round(n * 10) / 10);

/**
 * The employee's real leave balance, as their app shows it: every type on their template.
 * HR can change a type's total for the year (pencil on the card); what is taken is the
 * approved leave and never changes here, so the total cannot go below it.
 */
function LeaveBalanceSection({ userId, canEdit }: { userId: string; canEdit?: boolean }) {
  const [state, setState] = useState<{ types: LeaveBalanceItemDTO[]; unlimitedLeave?: true } | 'loading' | 'error'>('loading');
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setState('loading');
    getEmployeeLeaveBalance(userId).then((b) => live && setState({ types: b.types, unlimitedLeave: b.unlimitedLeave }), () => live && setState('error'));
    return () => { live = false; };
  }, [userId]);
  const save = async (b: LeaveBalanceItemDTO) => {
    if (!editing) return;
    const total = Number(editing.value);
    if (!Number.isFinite(total) || total < 0) { setError('Enter a number of days'); return; }
    if (total < b.used) { setError(`${days(b.used)} days are already taken, so the total can’t be less`); return; }
    setSaving(true);
    setError('');
    try {
      const next = await setEmployeeLeaveTotal(userId, b.key, total);
      setState({ types: next.types });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the total');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title="Leave balance" icon={<PdCalendar />}>
      {state === 'loading' ? <SkeletonLines lines={2} />
        : state === 'error' ? <div className="pd-subnote" style={{ paddingTop: 8 }}>Couldn't load the leave balance.</div>
        : state.types.length === 0 ? <div className="pd-subnote" style={{ paddingTop: 8 }}>No leave types on this person's shift template.</div>
        : state.unlimitedLeave ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05 }}>Unlimited leave</span>
            <div className="pd-subnote" style={{ marginTop: 6 }}>Their template keeps no leave balance · {days(state.types.reduce((a, t) => a + (t.used || 0), 0))} taken this year</div>
          </div>
        )
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16, paddingTop: 8 }}>
            {state.types.map((b) => {
              const pct = b.total > 0 ? Math.min(100, Math.round((b.used / b.total) * 100)) : 0;
              const open = editing?.key === b.key;
              return (
                <div key={b.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: leaveColour(b.key), flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ink-2)', flex: 1 }}>{b.name}</span>
                    {canEdit && b.editable && !open && (
                      <button type="button" className="pd-sec-act" aria-label={`Edit ${b.name} total`} title="Edit the total"
                        onClick={() => { setError(''); setEditing({ key: b.key, value: days(b.total) }); }}
                        style={{ padding: 2 }}><PdEdit /></button>
                    )}
                  </div>
                  {b.unpaid ? (
                    <>
                      <span style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6 }}>Unpaid</span>
                      <div className="pd-subnote" style={{ marginTop: 6 }}>No balance · {days(b.used)} taken this year</div>
                    </>
                  ) : b.unlimited ? (
                    <>
                      <span style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6 }}>Unlimited</span>
                      <div className="pd-subnote" style={{ marginTop: 6 }}>Their template keeps no balance · {days(b.used)} taken this year</div>
                    </>
                  ) : open ? (
                    <form onSubmit={(e) => { e.preventDefault(); void save(b); }} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                      <label style={{ fontSize: 11.5, color: 'var(--ink-3)' }} htmlFor={`lt-${b.key}`}>Total for the year</label>
                      <input id={`lt-${b.key}`} type="number" min={b.used} step={0.5} autoFocus value={editing.value}
                        onChange={(e) => setEditing({ key: b.key, value: e.target.value })}
                        style={{ height: 34, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 8, font: 'inherit', fontSize: 14, background: 'var(--surface)', color: 'var(--ink)' }} />
                      <div className="pd-subnote">{days(b.used)} taken · stays as it is</div>
                      {error && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</div>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="submit" className={btnClass('primary')} style={{ ...btn('primary'), height: 32, padding: '0 12px', fontSize: 12.5 }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                        <button type="button" className={btnClass()} style={{ ...btn(), height: 32, padding: '0 12px', fontSize: 12.5 }} disabled={saving} onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{b.short ? <span style={{ color: 'var(--bad)' }}>−{days(b.short)}</span> : days(b.remaining)}<span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}> / {days(b.total)}</span></span>
                      <div className="pd-bar" style={{ marginTop: 6 }}>
                        <i style={{ width: `${pct}%`, background: leaveColour(b.key) }} />
                      </div>
                      <div className="pd-subnote">{days(b.used)} taken · {b.short ? <span style={{ color: 'var(--bad)' }}>{days(b.short)} over</span> : <>{days(b.remaining)} available</>}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </Section>
  );
}

function ratingWord(score: number): string {
  if (score >= 4.5) return RATINGS[0];
  if (score >= 4) return RATINGS[1];
  if (score >= 2.5) return RATINGS[2];
  return RATINGS[3];
}



// —— Component ——————————————————————————————————————————————————————————
export function EmployeeProfile({ emp, onBack, onOpen, initialTab, focus, backLabel = '← Back to employees' }: {
  emp: Emp;
  onBack: () => void;
  onOpen?: (e: Emp) => void;
  /** Open on this tab, and scroll to and highlight this section (People › Tasks sends people straight to what's missing). */
  initialTab?: ProfileTab;
  focus?: 'details' | 'shift' | 'kpi' | 'salary' | 'bank';
  backLabel?: string;
}) {
  const s = useStore();
  const d = derive(emp);
  const [tab, setTab] = useState<ProfileTab>(initialTab ?? 'profile');
  // The section to bring into view once it has loaded (some load their own data).
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-focus="${focus}"]`);
      if (el || ++tries > 30) window.clearInterval(timer);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'box-shadow .3s'; el.style.borderRadius = '16px';
      el.style.boxShadow = '0 0 0 3px var(--accent)';
      window.setTimeout(() => { el.style.boxShadow = 'none'; }, 2600);
    }, 200);
    return () => window.clearInterval(timer);
  }, [focus, emp.id]);
  // What someone earns is its own access, apart from Employees.
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  // Their exit, when HR has recorded one (admins only: the server says the same).
  const [exitRow, setExitRow] = useState<ExitDTO | null>(null);
  const [exitReady, setExitReady] = useState(false);
  const [exitTick, setExitTick] = useState(0);
  const seesSalary = canOpen(user, SALARY_DETAILS);
  // Exits: dashboard admins, where the company has them switched on, for anyone but themselves.
  // The employee lifecycle on for this company: Exit starts the offboarding journey from its template.
  const lifecycleOnHere = user?.features?.lifecycle === true;
  const seesExit = !isTeamScope(user) && user?.dashboardAdmin === true && user?.features?.exits === true && user.id !== emp.id;
  // Edit details: for someone given the right, on themselves and anyone below them.
  const [editingDetails, setEditingDetails] = useState(false);
  // HR (a dashboard admin with the right) edits anyone; others their own reporting line.
  const canEditDetails = user?.canEditEmployees === true && (user.dashboardAdmin === true || isSelfOrBelow(s.emps, user.id, emp));
  // This month, fetched once: it names the shift in the header and seeds the
  // Calendar tab, so opening that tab does not ask for the same month again.
  const [currentMonth, setCurrentMonth] = useState<EmployeeCalendarDTO | null>(null);
  const [currentMonthState, setCurrentMonthState] = useState<LoadState>('loading');
  useEffect(() => {
    let live = true;
    setCurrentMonth(null);
    setCurrentMonthState('loading');
    getEmployeeCalendar(emp.id, thisMonth())
      .then((c) => { if (live) { setCurrentMonth(c); setCurrentMonthState('ready'); } })
      .catch(() => { if (live) setCurrentMonthState('error'); });
    return () => { live = false; };
  }, [emp.id]);
  // Review state for the current cycle, from the feedback managers actually submitted.
  const review = s.fbEmps.find((f) => f.userId === emp.id);
  const reviewState = s.listState('feedback', 'cycle');
  // A review section waits for the feedback list rather than saying "No review".
  const reviewPending = reviewState === 'error'
    ? <LoadError compact text="Reviews could not be loaded." onRetry={() => void s.reload()} />
    : <SkeletonLines lines={4} />;

  // Reporting line — manager above, direct reports below (from the roster).
  // Guard against a person being their own manager (seed-data quirk).
  // The roster fills a missing manager with a dash; that is nobody, not a name.
  const managerName = emp.manager && emp.manager !== '—' && emp.manager !== emp.name ? emp.manager : '';
  const manager = emp.managerId ? s.emps.find((e) => e.id === emp.managerId) : undefined;
  const reports = s.emps.filter((e) => e.managerId === emp.id && e.id !== emp.id);
  const peers = emp.managerId
    ? s.emps.filter((e) => e.managerId === emp.managerId && e.id !== emp.id).length
    : 0;

  return (
    <div className="pd-prof" style={{ animation: 'fade .3s ease both' }}>
      <ExitLoader userId={emp.id} enabled={user?.dashboardAdmin === true && user?.features?.exits === true} tick={exitTick} onLoaded={(e) => { setExitRow(e); setExitReady(true); }} />
      <div className="pd-prof-top">
        <button onClick={onBack} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>{backLabel}</button>
        {SHOW_DELETE_EMPLOYEE && !isTeamScope(user) && user?.dashboardAdmin === true && user.id !== emp.id && (
          <button type="button" onClick={() => setDeleting(true)} className="pd-btn sm" style={{ color: 'var(--bad)' }}><PdTrash /> Delete employee</button>
        )}
      </div>
      {/* On the page body: this page fades in with a transform, which would pin a fixed dialog to the page instead of the screen. */}
      {deleting && createPortal(<DeleteEmployee emp={emp} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); void s.reload(); onBack(); }} />, document.body)}
      {exitRow && <ExitBanner exit={exitRow} />}

      {/* Identity header */}
      <ProfileHeader name={emp.name} photoUrl={emp.photoUrl} sub={`${emp.role} · ${emp.team} · ${emp.employeeId}`}
        pills={<>
          <Pill label={emp.empType} tone={ETYPE[emp.empType]} />
          {emp.isDirector && <Pill label="Director" tone={{ bg: 'var(--t-lilac)', fg: 'var(--t-plum-i)' }} />}
        </>}>
        <Fact label="Work email" value={d.workEmail} />
        <Fact label="Employee ID" value={emp.employeeId} />
        <Fact label="Work location" value={d.workLocation} />
        <Fact label="Reporting manager" value={emp.manager} />
        <Fact label="Date of joining" value={emp.joining} />
        <Fact label="Shift" value={<LoadingFigure state={currentMonthState} w={140} h={12}>{currentMonth ? `${currentMonth.shift} · ${currentMonth.window}` : '—'}</LoadingFigure>} />
      </ProfileHeader>

      {/* One page, several views of the same person. */}
      <div className="pd-ptabs">
        <StatusTabs<ProfileTab>
          options={[...(seesSalary ? ['profile', 'performance', 'calendar', 'requests', 'salary', 'orgchart', 'activity'] as ProfileTab[] : ['profile', 'performance', 'calendar', 'requests', 'orgchart', 'activity'] as ProfileTab[]), ...(seesExit ? ['exit' as const] : [])]}
          active={tab}
          onSelect={setTab}
          labels={{ profile: 'Profile', performance: 'Performance', calendar: 'Calendar', requests: 'Requests', salary: 'Salary details', orgchart: 'Org chart', activity: 'Activity', exit: 'Exit' }}
        />
      </div>

      {tab === 'profile' && (
        <div className="pd-psecs">
          <div className="pd-psecs">
            <div data-focus="details"><Section title="Basic details" icon={<PdUser />} action={canEditDetails && !editingDetails ? <button type="button" onClick={() => setEditingDetails(true)} className="pd-sec-act"><PdEdit /> Edit</button> : undefined}>
            {editingDetails ? <BasicDetailsEditor emp={emp} onDone={() => setEditingDetails(false)} /> : (
            <BasicDetailsGrid d={{
              name: emp.name, employeeId: emp.employeeId, joining: emp.joining, workEmail: d.workEmail, designation: emp.role, department: emp.team,
              workLocation: d.workLocation, employeeType: emp.empType, mobile: emp.phone, gender: emp.gender, dob: showDate(emp.birthday),
              manager: emp.manager, isDirector: emp.isDirector,
            }} />
            )}
          </Section></div>
            {canEditDetails && (
              <div data-focus="shift"><Section title="Shift template" icon={<PdClock />}>
                <ShiftPicker emp={emp} onChanged={() => getEmployeeCalendar(emp.id, thisMonth()).then(setCurrentMonth).catch(() => undefined)} />
              </Section></div>
            )}
            {/* Only when something is filed or uploaded; an empty box said nothing useful. */}
            {emp.documents.length > 0 && (
            <Section title="Documents" icon={<PdFile />}>
              <EmployeeDocuments documents={emp.documents} />
            </Section>
            )}
            <div data-focus="bank"><PaymentDetails userId={emp.id} /></div>
            <EpfBalance userId={emp.id} />
          </div>
        </div>
      )}


      {tab === 'performance' && (
        <div className="pd-psecs">
          <div className="pd-psecs">
            <Section title="Performance (PMS)" icon={<PdStar />}>
            {reviewState !== 'ready' ? reviewPending : review && review.status !== 'none' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '6px 0' }}>
                  <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                    {review.overall > 0 ? review.overall.toFixed(1) : '—'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>/ 5.0</div>
                  {review.overall > 0 && (
                    <Pill label={ratingWord(review.overall)} tone={{ bg: 'var(--p-green)', fg: '#fff' }} fontSize={11.5} />
                  )}
                </div>
                <div className="pd-pfg">
                  <MiniRow label="Review cycle" value={periodLabel(s.cycle.period)} />
                  <MiniRow label="Reviewed by" value={review.managerName} />
                  <MiniRow label="Last updated" value={review.date || '—'} />
                </div>
                {review.params.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {review.params.map((p, i) => (
                      <div key={`${p.name}-${i}`} style={{ padding: '6px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 400, flex: 1, minWidth: 0 }}>{p.name}</span>
                          <span style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                            {p.score > 0 ? p.score.toFixed(1) : '—'}
                          </span>
                        </div>
                        {p.note && (
                          <div className="pd-subnote" style={{ marginTop: 2 }}>{p.note}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {review.extra && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                    {review.extra}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, padding: '6px 0' }}>
                No review submitted for {periodLabel(s.cycle.period)}
                {review?.managerName && review.managerName !== '—' ? ` — ${review.managerName} has not started it yet.` : '.'}
              </div>
            )}
          </Section>
            <Section title="Review history" icon={<PdChart />}>
            {reviewState !== 'ready' ? reviewPending : review && review.history.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
                {review.history.map((h) => (
                  <div key={h.period} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, width: 76, flexShrink: 0 }}>
                      {periodShort(h.period)}
                    </span>
                    <span className="pd-bar" style={{ flex: 1 }}>
                      <i style={{ width: `${(h.overall / 5) * 100}%`, background: 'var(--accent)' }} />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', width: 30, textAlign: 'right' }}>
                      {h.overall.toFixed(1)}
                    </span>
                  </div>
                ))}
                <div className="pd-subnote" style={{ marginTop: 2 }}>
                  Sent reviews only. A cycle with no bar is one nobody submitted.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, padding: '6px 0' }}>
                No earlier reviews yet.
              </div>
            )}
          </Section>
          </div>
          <div className="pd-psecs">
            <div data-focus="kpi"><Section title="KPIs" icon={<PdTarget />}>
            {s.listState('cycle') !== 'ready' ? reviewPending : <EmployeeKpiPanel
              userId={emp.id}
              userName={emp.name}
              designation={emp.role}
              period={s.cycle.period}
              nextPeriod={s.cycle.next}
              // Someone with the edit right sets KPIs for the people below them, not for themselves.
              readOnly={user?.canEditEmployees === true && emp.id === user.id ? 'You set KPIs for the people who report to you, not for yourself.' : undefined}
            />}
          </Section></div>
          </div>
        </div>
      )}

      {tab === 'calendar' && <EmployeeCalendar userId={emp.id} initial={currentMonth} onChanged={setCurrentMonth} />}
      {tab === 'salary' && seesSalary && (
        <div>
          <div data-focus="salary"><EmployeeSalary userId={emp.id} name={emp.name} /></div>
          <IncomeTaxCard userId={emp.id} />
          <div style={{ marginTop: 20 }}><SalarySlips userId={emp.id} /></div>
        </div>
      )}

      {tab === 'requests' && (
        <div className="pd-psecs">
          <div className="pd-psecs">
            <LeaveBalanceSection userId={emp.id} canEdit={canEditDetails && emp.id !== user?.id} />
          </div>
          <RequestsForEmployee emp={emp} />
        </div>
      )}

      {tab === 'exit' && seesExit && (
        <div>
          {!exitReady ? <section className="pd-card"><SkeletonForm fields={6} /></section> : (
            <>
              {/* With the employee lifecycle on, an exit starts here exactly as on the Offboarding board: the
                  offboarding template's notice, tasks and app page (24 Nov 2026, HR: "record the exit
                  according to the new setup"). Once started it is run from the board. */}
              {lifecycleOnHere && !exitRow && (
                <StartExit presetUserId={emp.id} onBack={() => setTab('profile')} onStarted={() => { setExitTick((n) => n + 1); void s.reload(); }} />
              )}
              {lifecycleOnHere && exitRow && exitRow.state !== 'left' && (
                <section className="pd-card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{emp.name.split(' ')[0]}'s exit follows the offboarding template: tasks, notice and settlement are run from the Offboarding board.</span>
                  <button type="button" className="pd-btn primary" onClick={() => s.setView('offboarding')}>Open on the Offboarding board</button>
                </section>
              )}
              {/* Recorded or changed here until they have gone; after that, only the settlement and its lists. */}
              {!lifecycleOnHere && exitRow?.state !== 'left' && (
                <ExitDialog key={`${exitTick}:${exitRow?.recordedAt ?? 'none'}`} variant="card" emp={emp} exit={exitRow} emps={s.emps}
                  onClose={() => undefined} onSaved={() => { setExitTick((n) => n + 1); void s.reload(); }} />
              )}
              {exitRow && <ExitDetail key={`detail:${exitTick}`} userId={emp.id} embedded />}
            </>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="pd-psecs">
          <Section title="Activity" icon={<PdClock />}>
            <EmployeeActivity userId={emp.id} />
          </Section>
        </div>
      )}

      {tab === 'orgchart' && (
        <div>
      {/* Reporting line — this person's slice of the org chart */}
      <div>
        <section className="pd-card">
          <div className="pd-card-h" style={{ marginBottom: 20 }}>
            <div>
              <h3>Org chart</h3>
              <small>
                Reporting line{s.listState('employees') === 'ready' && <> · {reports.length} direct report{reports.length === 1 ? '' : 's'}{peers > 0 ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}</>}
              </small>
            </div>
            <button
              type="button"
              onClick={() => { s.setOrgChartFocus(emp.id); s.setView('orgchart'); }}
              className="pd-sec-act"
              style={{ color: 'var(--accent-ink)', fontSize: 13 }}
            >
              Open in org chart ↗
            </button>
          </div>
          {s.listState('employees') !== 'ready' ? (
            <ListPending state={s.listState('employees')} onRetry={() => void s.reload()} rows={3} cols={1} />
          ) : (
          <div style={{ padding: '0 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Manager — nothing at all above someone who has none; the chart starts with them. */}
            {manager ? (
              <OrgNode emp={manager} caption="Reporting manager" onOpen={onOpen} />
            ) : managerName ? (
              <GhostNode name={managerName} caption="Reporting manager" />
            ) : null}

            {managerName && <Connector />}

            {/* This employee — highlighted */}
            <OrgNode emp={emp} caption="This employee" highlight />

            {/* Direct reports */}
            {reports.length > 0 && (
              <>
                <Connector />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%' }}>
                  {reports.map((r) => <OrgNode key={r.id} emp={r} onOpen={onOpen} />)}
                </div>
              </>
            )}
            {reports.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400, marginTop: 14 }}>No direct reports</div>
            )}
          </div>
          )}
        </section>
      </div>
        </div>
      )}
    </div>
  );
}

/** Delete employee is hidden from the dashboard for now; the dialog and the server's delete stay. */
const SHOW_DELETE_EMPLOYEE = false as boolean;

export type ProfileTab = 'profile' | 'performance' | 'calendar' | 'requests' | 'salary' | 'orgchart' | 'activity' | 'exit';

// —— Calendar: one month, every day named ————————————————————————————————
const CAL_TONE: Record<CalendarDayStatus, { bg: string; fg: string; label: string }> = {
  present: { bg: 'var(--ok-bg)', fg: 'var(--ok)', label: 'Present' },
  half_day: { bg: 'var(--warn-bg)', fg: 'var(--warn)', label: 'Half day' },
  missed_punch: { bg: 'var(--t-peach)', fg: 'var(--warn)', label: 'Missed punch' },
  absent: { bg: 'var(--bad-bg)', fg: 'var(--bad)', label: 'Absent' },
  on_leave: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'On leave' },
  // Its own day: unpaid, so neither leave nor an absence.
  unpaid_leave: { bg: 'var(--t-plum)', fg: 'var(--t-plum-i)', label: 'Leave without pay' },
  week_off: { bg: 'var(--surface-2)', fg: 'var(--ink-4)', label: 'Week off' },
  holiday: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)', label: 'Holiday' },
  upcoming: { bg: 'var(--surface)', fg: 'var(--ink-4)', label: 'Upcoming' },
  // Not theirs yet: an empty day, like one still to come.
  before_joining: { bg: 'var(--surface)', fg: 'var(--ink-4)', label: 'Before joining' },
};
/** A day drawn empty: still to come, or before the person joined. */
const blankDay = (status: CalendarDayStatus) => status === 'upcoming' || status === 'before_joining';
const LEAVE_NAMES: Record<string, string> = { sick: 'Sick leave', casual: 'Casual leave', earned: 'Earned leave', comp_off: 'Comp off' };
// The current month by Indian time: the month HR can still correct.
const thisMonth = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
// What HR can mark a day as, in the order the dialog offers them.
// The day dialog is MarkDay.tsx's, shared with the Company calendar (it asks which leave an "On leave" day comes out of).
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const clockOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

// ------------------------------------------------------------- salary slips
// Every payslip a payroll run produced for them, newest first. A draft run's
// slip is a preview; approved and paid ones are the record. Download opens
// the printable slip.

const RUN_TONE: Record<PayrollRunDTO['status'], { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--surface-2)', fg: 'var(--ink-3)', label: 'Draft' },
  pending_approval: { bg: 'var(--t-sky)', fg: 'var(--t-sky-i)', label: 'Pending approval' },
  approved: { bg: 'var(--ok-bg)', fg: 'var(--ok)', label: 'Approved' },
  rejected: { bg: 'var(--bad-bg)', fg: 'var(--bad)', label: 'Rejected' },
  paid: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'Paid' },
};

const periodTitle = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function SalarySlips({ userId }: { userId: string }) {
  const [explain, setExplain] = useState<PayslipDTO | null>(null);
  const slips = useLoad(() => getEmployeePayslips(userId), [userId]);
  const rows = slips.data?.payslips;
  const company = slips.data?.company ?? { name: '', address: '' };

  const salaryCard = <div className="pd-card-h"><h3>Payslips</h3></div>;
  if (slips.state === 'error') return <section className="pd-card">{salaryCard}<LoadError text="The payslips could not be loaded." onRetry={slips.retry} /></section>;
  if (!rows) return <section className="pd-card">{salaryCard}<SkeletonRows rows={3} cols={7} avatar={false} rowHeight={54} /></section>;
  if (rows.length === 0) {
    return <section className="pd-card">{salaryCard}<div className="pd-empty">No salary slips yet — they appear here once a payroll run includes this person.</div></section>;
  }
  return (
    <section className="pd-card">
    {salaryCard}
    <div className="pd-tbl-wrap">
      <table className="pd-t">
        <thead>
          <tr>
            {['Month', 'Status', 'Paid days', 'Loss of pay', 'Gross', 'Deductions', 'Net pay', ''].map((h, i) => (
              <th key={h || i} style={{ textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ run, payslip }) => {
            const tone = RUN_TONE[run.status];
            const full = payslip.earnings.reduce((t, e) => t + e.fullPaise, 0) + payslip.inputs.overtimePaise + payslip.reimbursementsPaise;
            const lopPaise = payslip.earnings.reduce((t, e) => t + (e.fullPaise - e.paidPaise), 0);
            const lines = (payslip.inputs.attendanceDeductions ?? []).filter((l) => l.days > 0);
            // Paid days out of the days employed, and real loss of pay; "Joined 16 Oct" / "Left …" as a note, not loss of pay.
            const lopDays = lossOfPayDaysOf(payslip.inputs);
            const notEmployed = notEmployedNote(payslip);
            return (
              <tr key={run.id}>
                <td style={slipTd}><b>{periodTitle(run.period)}</b></td>
                <td style={slipTd}><Pill label={tone.label} tone={{ bg: tone.bg, fg: tone.fg }} /></td>
                <td style={{ ...slipTd, textAlign: 'right' }}>{payslip.inputs.payableDays} / {employedDaysOf(payslip.inputs)}</td>
                <td style={{ ...slipTd, textAlign: 'right' }}>
                  {(lopDays > 0 || notEmployed) && lines.length > 0 ? (
                    <button type="button" onClick={() => setExplain(payslip)} title={lopDays > 0 ? 'Why is there a loss of pay?' : 'The days not paid'} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: lopDays ? 'var(--bad)' : 'var(--ink-4)', fontWeight: 500, fontSize: 14, fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                      {lopDays} {lopDays === 1 ? 'day' : 'days'}
                    </button>
                  ) : (
                    <span style={{ color: lopDays ? 'var(--bad)' : 'var(--ink-4)', fontWeight: 500 }}>{lopDays} {lopDays === 1 ? 'day' : 'days'}</span>
                  )}
                  {notEmployed && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, whiteSpace: 'nowrap' }}>{notEmployed}</div>}
                </td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inrPaise(full)}</td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>−{inrPaise(lopPaise + payslip.employeeDeductionsPaise)}</td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><strong>{inrPaise(payslip.netPayablePaise)}</strong></td>
                <td style={{ ...slipTd, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => void downloadPayslipPdf(payslip, company, run).catch((e) => alert(e instanceof Error ? e.message : String(e)))} className="pd-btn primary sm">Download slip</button>
                    {payslip.id && <button type="button" onClick={() => void downloadTdsSheetPdf(payslip.id!).catch((e) => alert(e instanceof Error ? e.message : String(e)))} className="pd-btn sm">TDS sheet</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {explain && <LossOfPayExplainer userId={userId} payslip={explain} onClose={() => setExplain(null)} />}
    </section>
  );
}

const slipTd: CSSProperties = { verticalAlign: 'middle' };

/**
 * One person's month, day by day; HR clicks a day to mark it. Also opened from
 * a payroll run on the run's month (`startMonth`), with the days that cost pay
 * ringed (`highlight`) and editable while that month's run is open (`editableMonth`).
 */
export function EmployeeCalendar({ userId, initial, onChanged, startMonth, editableMonth, highlight, onMarked }: {
  userId: string;
  initial: EmployeeCalendarDTO | null;
  onChanged: (c: EmployeeCalendarDTO) => void;
  startMonth?: string;
  editableMonth?: string;
  highlight?: (day: CalendarDayDTO) => string | null;
  onMarked?: () => void;
}) {
  const { flash } = useStore();
  const [month, setMonth] = useState(startMonth ?? thisMonth());
  const [cal, setCal] = useState<EmployeeCalendarDTO | null>(initial);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // The day HR is marking, if any. Only the current month can be marked.
  const [editing, setEditing] = useState<CalendarDayDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const monthEditable = month === thisMonth() || (editableMonth !== undefined && month === editableMonth);
  // The server says which days HR may mark now (the open pay period reaches back into last month);
  // an older server without the flag keeps the month rule.
  const dayEditable = (day: CalendarDayDTO) => day.status !== 'before_joining' && (day.canMark ?? monthEditable);
  const reload = async () => {
    const fresh = await getEmployeeCalendar(userId, month);
    setCal(fresh);
    if (fresh.month === thisMonth()) onChanged(fresh);
  };
  const mark = async (day: CalendarDayDTO, status: HrDayStatus | null, note: string, leaveType?: string) => {
    setSaving(true);
    try {
      if (status) await setCalendarDay(userId, day.date, status, note.trim() || undefined, leaveType);
      else await clearCalendarDay(userId, day.date);
      await reload();
      setEditing(null);
      onMarked?.();
      flash(status ? `${day.date} marked ${CAL_TONE[status].label.toLowerCase()}` : `${day.date} back to the recorded state`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    // The profile already holds this month; only other months are fetched here.
    if (initial && initial.month === month) { setCal(initial); setError(''); return; }
    let live = true;
    setError('');
    getEmployeeCalendar(userId, month)
      .then((c) => { if (live) setCal(c); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the month'); });
    return () => { live = false; };
  }, [userId, month, initial, attempt]);
  // Another month (or person) shows its own skeleton, not the last month's days.
  const shown = cal && cal.month === month ? cal : null;
  const loading = !shown && !error;
  // Only part of the month may be open (26–31 of last month for a 26th–25th pay cycle): say which days.
  const open = shown ? shown.days.filter(dayEditable) : [];
  const markable = shown ? shown.days.filter((d) => d.status !== 'before_joining') : [];
  const dayNo = (d: CalendarDayDTO) => Number(d.date.slice(8));
  const markHint = open.length === 0 || open.length === markable.length
    ? 'Click any day to mark it'
    : open.length === 1
      ? `Only the ${dayNo(open[0])}${ordinal(dayNo(open[0]))} can be marked now`
      : `Only the ${dayNo(open[0])}${ordinal(dayNo(open[0]))} to the ${dayNo(open[open.length - 1])}${ordinal(dayNo(open[open.length - 1]))} can be marked now (the open pay period); click one to mark it`;

  // Monday-first grid, the way the app lays the month out.
  const lead = shown ? (new Date(`${shown.month}-01T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const worked = shown ? shown.totals.present + shown.totals.half_day + shown.totals.missed_punch + shown.totals.absent + shown.totals.on_leave + (shown.totals.unpaid_leave ?? 0) : 0;

  return (
    // Inside the payroll run's dialog it sits flat; on the profile it is its own card.
    <section className={startMonth ? undefined : 'pd-card'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="pd-calnav">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="pd-round">‹</button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="pd-inp" style={{ height: 42, borderRadius: 999, fontSize: 14, fontWeight: 500, padding: '0 14px' }} />
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()} className="pd-round">›</button>
        </div>
        {shown && (
          <div style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 400 }}>
            {shown.shift} · {shown.window} · {shown.punchFormat}
          </div>
        )}
      </div>
      {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}

      {loading && (
        <SkeletonFrame style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} w={92} h={27} r={999} />)}
        </SkeletonFrame>
      )}
      {shown && (
        <div className="pd-legend">
          {(['present', 'half_day', 'missed_punch', 'absent', 'on_leave', 'unpaid_leave', 'week_off', 'holiday'] as CalendarDayStatus[]).map((k) => (
            <span key={k}>
              <i style={{ background: k === 'week_off' ? 'var(--line-2)' : CAL_TONE[k].fg }} />{CAL_TONE[k].label} <span style={{ color: 'var(--ink-3)' }}>{shown.totals[k] ?? 0}</span>
            </span>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{worked} working days so far</span>
        </div>
      )}

      <div>
        <div className="pd-cal" style={{ marginBottom: 6 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="pd-cdh">{d.toUpperCase()}</div>
          ))}
        </div>
        <div className="pd-cal">
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} className="pd-cd empty" />)}
          {loading && Array.from({ length: 35 }, (_, i) => (
            <div key={`sk-${i}`} className="sk-delay" aria-hidden style={{ minHeight: 84, padding: 10, borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Skeleton w={18} h={12} />
              <Skeleton w="64%" h={10} style={{ opacity: 0.7 }} />
            </div>
          ))}
          {(shown?.days ?? []).map((day) => {
            const tone = CAL_TONE[day.status];
            const leaveName = LEAVE_NAMES[day.label ?? ''] ?? (day.label ?? '').split('_').map((w) => w && w[0].toUpperCase() + w.slice(1)).join(' ') + ' leave';
            const detail = day.status === 'on_leave' ? leaveName
              : day.status === 'unpaid_leave' ? (day.halfDay ? 'Half day' : '')
              : day.status === 'holiday' || day.status === 'week_off' ? day.label
                : blankDay(day.status) ? ''
                  : day.label ?? (day.punchIn ? `${clockOf(day.punchIn)} – ${clockOf(day.punchOut)}` : '');
            const prev = day.hr ? CAL_TONE[day.hr.previousStatus] : null;
            const ring = highlight?.(day) ?? null;
            return (
              <div
                key={day.date}
                title={`${day.date}${day.status === 'before_joining' ? ' · before joining' : ''}${detail ? ` · ${detail}` : ''}${day.hr ? ` · marked by ${day.hr.setByName ?? 'HR'}, was ${prev?.label}` : ''}${dayEditable(day) ? ' · click to mark' : ''}`}
                onClick={dayEditable(day) ? () => setEditing(day) : undefined}
                className={blankDay(day.status) ? 'pd-cd future' : 'pd-cd'}
                style={{ background: blankDay(day.status) ? undefined : tone.bg, color: blankDay(day.status) ? undefined : tone.fg, borderColor: day.status === 'week_off' ? 'var(--line)' : undefined, cursor: dayEditable(day) ? 'pointer' : 'default', boxShadow: ring ? 'inset 0 0 0 2px var(--bad)' : day.hr ? 'inset 0 0 0 2px var(--accent)' : undefined }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                  <b>{Number(day.date.slice(8))}</b>
                  {ring ? <span style={{ fontSize: 10.5, fontWeight: 600, color: '#fff', background: 'var(--p-red)', borderRadius: 999, padding: '1px 6px' }}>{ring}</span>
                    : day.hr ? <span style={{ fontSize: 10.5, fontWeight: 600, color: '#fff', background: 'var(--p-blue)', borderRadius: 999, padding: '1px 6px' }}>HR</span>
                    : day.lateByMinutes > 0 && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--t-lilac-i)' }}>late {day.lateByMinutes}m</span>}
                </div>
                {day.hr && prev && (
                  <div style={{ fontSize: 11, fontWeight: 400, color: prev.fg, textDecoration: 'line-through', opacity: .75 }}>{prev.label}</div>
                )}
                {!blankDay(day.status) && <div style={{ fontSize: 11, fontWeight: 400 }}>{day.hr ? '→ ' : ''}{tone.label}</div>}
                {detail && !(day.hr && detail === tone.label) && <div style={{ fontSize: 11, opacity: .85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
      {(shown?.days.some(dayEditable) ?? monthEditable) && <div className="pd-subnote" style={{ marginTop: 12 }}>{highlight ? 'Ringed days cost pay. ' : ''}{markHint}. The mark replaces what the punches, leave or holidays say, on the dashboard, in payroll and in the employee's app.</div>}
      {editing && <MarkDay day={editing} userId={userId} saving={saving} onClose={() => setEditing(null)} onSave={(status, note, leaveType) => void mark(editing, status, note, leaveType)} />}
    </section>
  );
}

// —— Requests: this person's, from the live queues ———————————————————————
type Req = { id: string; kind: string; detail: string; when: string; status: ReqStatus; ord: number; label?: string };
function RequestsForEmployee({ emp }: { emp: Emp }) {
  const s = useStore();
  const mine = (id?: string) => id === emp.id;
  const rows: Req[] = [
    ...s.leaves.filter((r) => mine(r.submitterId)).map((r) => ({ id: `lv-${r.id}`, kind: `${r.type} leave`, detail: r.days, when: `${r.from} – ${r.to}`, status: r.status, label: r.statusLabel, ord: r.ord })),
    ...s.ots.filter((r) => mine(r.submitterId)).map((r) => ({ id: `ot-${r.id}`, kind: 'Overtime', detail: r.duration, when: r.otDate, status: r.status, ord: r.ord })),
    ...s.rbs.filter((r) => mine(r.submitterId)).map((r) => ({ id: `rb-${r.id}`, kind: 'Reimbursement', detail: `${r.type} · ${r.amount}`, when: r.billDate, status: r.status, ord: r.ord })),
    ...s.corrs.filter((r) => mine(r.submitterId)).map((r) => ({ id: `cr-${r.id}`, kind: 'Attendance correction', detail: r.dayType, when: r.workDate, status: r.status, ord: r.ord })),
  ].sort((a, b) => b.ord - a.ord);
  const pending = rows.filter((r) => r.status === 'Pending').length;
  const st = s.listState('leaves', 'overtime', 'claims', 'corrections');
  return (
    <section className="pd-card">
      <div className="pd-card-h" style={{ marginBottom: 8 }}>
        <div>
          <h3>Requests</h3>
          {st === 'ready' && <small>{rows.length} raised{pending ? ` · ${pending} pending` : ''}</small>}
        </div>
      </div>
      {st !== 'ready' ? (
        <ListPending state={st} onRetry={() => void s.reload()} rows={4} cols={4} avatar={false} rowHeight={48} />
      ) : rows.length === 0 ? (
        <div className="pd-empty" style={{ padding: 28 }}>No requests from this employee.</div>
      ) : <div className="pd-list">{rows.map((r) => (
        <div key={r.id} className="pd-li" style={{ display: 'grid', gridTemplateColumns: '34px 1.3fr 1.2fr 1fr auto', gap: 12, padding: '10px 0' }}>
          <span className="pd-li-i">{r.kind === 'Overtime' ? <PdClock size={15} /> : r.kind === 'Reimbursement' ? <PdFile size={15} /> : <PdCalendar size={15} />}</span>
          <div style={{ fontSize: 14, fontWeight: 400 }}>{r.kind}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 400 }}>{r.detail}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r.when}</div>
          <Pill label={r.label ?? r.status} tone={STAT[r.status]} fontSize={11.5} />
        </div>
      ))}</div>}
    </section>
  );
}

// Bank account, PAN and UAN. Encrypted on the server; people with payroll
// access see them in full and can change them, everyone else sees the last
// four characters only.
function PaymentDetails({ userId }: { userId: string }) {
  const { flash } = useStore();
  const [d, setD] = useState<PaymentDetailsDTO | null>(null);
  const [form, setForm] = useState<PaymentDetailsInput | null>(null);
  const [saving, setSaving] = useState(false);
  // Hidden for someone not allowed to see them (403), as before; any other failure says so.
  const [state, setState] = useState<LoadState | 'hidden'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setD(null);
    setState('loading');
    getPaymentDetails(userId)
      .then((x) => { if (live) { setD(x); setState('ready'); } })
      .catch((e: unknown) => { if (live) { setD(null); setState(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'hidden' : 'error'); } });
    return () => { live = false; };
  }, [userId, attempt]);
  if (state === 'hidden') return null;
  if (state !== 'ready' || !d) {
    return (
      <Section title="Payment and tax IDs">
        {state === 'error' ? <LoadError compact text="Payment details could not be loaded." onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonGrid rows={3} />}
      </Section>
    );
  }
  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      setD(await savePaymentDetails(userId, form));
      setForm(null);
      flash('Payment details saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save payment details', 'error');
    } finally {
      setSaving(false);
    }
  };
  const field = (label: string, key: keyof PaymentDetailsInput, placeholder?: string) => (
    <label className="pd-label">
      {label}
      <input value={(form?.[key] as string | undefined) ?? ''} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="pd-inp" />
    </label>
  );
  return (
    <Section
      title="Payment and tax IDs"
      icon={<PdBank />}
      action={d.canEdit && !form ? <button type="button" onClick={() => setForm({ bankName: d.bankName, accountHolder: d.accountHolder, ifsc: d.ifsc, accountNumber: d.accountNumber, pan: d.pan, uan: d.uan, accountType: d.accountType ?? 'savings', payMode: d.payMode ?? 'bank_transfer' })} className="pd-sec-act"><PdEdit /> Edit</button> : undefined}
    >
      {form ? (
        <div style={{ paddingTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {field('Bank name', 'bankName', 'e.g. HDFC Bank')}
            {field('Account holder', 'accountHolder')}
            {field('Account number', 'accountNumber', '9 to 18 digits')}
            {field('IFSC', 'ifsc', 'e.g. HDFC0001234')}
            {field('PAN', 'pan', 'ABCDE1234F')}
            {field('UAN', 'uan', '12 digits')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setForm(null)} className="pd-btn">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <Grid>
          <Row label="Bank" value={d.bankName ?? '—'} />
          <Row label="Account number" value={d.accountNumber ?? '—'} />
          <Row label="IFSC" value={d.ifsc ?? '—'} />
          <Row label="Account holder" value={d.accountHolder ?? '—'} />
          <Row label="PAN" value={d.pan ?? '—'} />
          <Row label="UAN" value={d.uan ?? '—'} />
        </Grid>
      )}
      {!d.unmasked && (d.accountNumber || d.pan || d.uan) && <div className="pd-subnote" style={{ marginTop: 8 }}>Shown masked: full numbers are visible only with payroll access.</div>}
    </Section>
  );
}

// The PF balance from the employee's EPFO passbook: Sowaka cannot read EPFO,
// so HR (or the employee, in the app) types it in with the date it is as on.
// The app adds the PF payroll put in after that date. Payroll access only.
function EpfBalance({ userId }: { userId: string }) {
  const { flash } = useStore();
  const [b, setB] = useState<EpfBalanceDTO | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden'>('loading');
  const [form, setForm] = useState<{ rupees: string; asOn: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    setState('loading');
    getEpfBalance(userId)
      .then((x) => { if (live) { setB(x); setState('ready'); } })
      .catch(() => { if (live) setState('hidden'); });
    return () => { live = false; };
  }, [userId]);
  if (state !== 'ready') return null;
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const save = async () => {
    if (!form) return;
    const rupees = Number(form.rupees.replace(/[^0-9]/g, ''));
    if (form.rupees.trim() === '' || !Number.isSafeInteger(rupees) || !form.asOn) {
      flash('Enter the balance in rupees and the date it is as on', 'error');
      return;
    }
    setSaving(true);
    try {
      setB(await saveEpfBalance(userId, { balancePaise: rupees * 100, asOn: form.asOn }));
      setForm(null);
      flash('EPF balance saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the EPF balance', 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section
      title="EPF balance"
      action={!form ? <button type="button" onClick={() => setForm({ rupees: b ? String(b.balancePaise / 100) : '', asOn: b?.asOn ?? today })} className="pd-sec-act"><PdEdit /> {b ? 'Edit' : 'Add'}</button> : undefined}
    >
      {form ? (
        <div style={{ paddingTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label className="pd-label">
              Balance (₹)
              <input inputMode="numeric" value={form.rupees} placeholder="From the EPFO passbook" onChange={(e) => setForm({ ...form, rupees: e.target.value.replace(/[^0-9]/g, '') })} className="pd-inp" />
            </label>
            <label className="pd-label">
              As on
              <input type="date" max={today} value={form.asOn} onChange={(e) => setForm({ ...form, asOn: e.target.value })} className="pd-inp" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setForm(null)} className="pd-btn">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <Grid>
          <Row label="Balance" value={b ? inrPaise(b.balancePaise) : '—'} />
          <Row label="As on" value={b ? `${showDate(b.asOn)} · by ${b.source === 'hr' ? 'HR' : 'the employee'}` : '—'} />
        </Grid>
      )}
      <div className="pd-subnote" style={{ marginTop: 8 }}>From the EPFO passbook. The app adds the PF paid through payroll after this date.</div>
    </Section>
  );
}

/**
 * Everything filed against the person: what they uploaded on the joining portal (with where its review
 * stands) and what HR filed. Each file opens or downloads.
 */
function EmployeeDocuments({ documents }: { documents: EmpDocument[] }) {
  const item = (doc: EmpDocument): ProfileDocItem => ({
    id: doc.id,
    title: doc.type,
    sub: `${doc.source === 'onboarding' ? 'Uploaded on the joining portal' : 'Filed by HR'}${doc.uploadedOn ? ` · ${doc.uploadedOn}` : ''}`,
    status: doc.source === 'onboarding' ? docStatus(doc.status) : null,
    files: doc.files,
  });
  return (
    <DocumentList groups={[
      { key: 'onboarding', title: 'From onboarding', list: documents.filter((d) => d.source === 'onboarding').map(item) },
      { key: 'filed', title: 'Filed', list: documents.filter((d) => d.source !== 'onboarding').map(item) },
    ]} />
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="pd-pf">
      <span className="pl">{label}</span>
      <span className="pv">{value}</span>
    </div>
  );
}

/** Reads the person's exit, if any, whenever they or `tick` change. */
function ExitLoader({ userId, enabled, tick, onLoaded }: { userId: string; enabled: boolean; tick: number; onLoaded: (e: ExitDTO | null) => void }) {
  useEffect(() => {
    if (!enabled) { onLoaded(null); return; }
    let live = true;
    listExits().then((all) => { if (live) onLoaded(all.find((x) => x.userId === userId) ?? null); }).catch(() => { if (live) onLoaded(null); });
    return () => { live = false; };
  }, [userId, enabled, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The editor themselves, or anyone below them in the reporting line. The server checks the same. */
/** Delete an employee for good, after their name is typed. History (attendance, leave, payslips) stays. */
function DeleteEmployee({ emp, onClose, onDeleted }: { emp: Emp; onClose: () => void; onDeleted: () => void }) {
  const { flash } = useStore();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === emp.name.trim().toLowerCase();
  const run = async () => {
    setBusy(true);
    try {
      await deleteEmployee(emp.id, typed.trim());
      flash(`${emp.name} deleted`);
      onDeleted();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not delete', 'error');
      setBusy(false);
    }
  };
  return (
    <div onClick={onClose} className="pd-scrim" style={{ zIndex: 70, background: 'rgba(20, 16, 50, 0.38)' }}>
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" style={{ width: 'min(460px, 100%)' }}>
        <div className="pd-md-h"><h3>Delete {emp.name}?</h3></div>
        <div className="pd-md-b">
          <div>
            Their account, profile, sign-ins, salary set-up and bank details are deleted for good and they can no longer use the app. Past attendance, leave and payslips stay, so payroll and reports still add up. This can't be undone.
          </div>
          <label className="pd-label">
            <span>Type <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{emp.name}</strong> to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus className="pd-inp" style={{ width: '100%' }} />
          </label>
        </div>
        <div className="pd-md-f">
          <button type="button" onClick={onClose} className="pd-btn">Cancel</button>
          <button type="button" disabled={!matches || busy} onClick={() => void run()} className="pd-btn danger" style={matches ? undefined : { background: 'var(--bad-bg)', borderColor: 'var(--bad-bg)', color: 'var(--bad)', opacity: 1 }}>{busy ? 'Deleting…' : 'Delete for good'}</button>
        </div>
      </div>
    </div>
  );
}


type DetailsForm = {
  firstName: string; middleName: string; lastName: string; employeeId: string; joiningDate: string;
  email: string; mobile: string; gender: string; location: string; designation: string; department: string;
  empType: string; birthday: string; isDirector: boolean;
};

function detailsOf(emp: Emp): DetailsForm {
  const { first, middle, last } = nameParts(emp.name);
  const dash = (v: string) => (v === '—' ? '' : v);
  return {
    firstName: first, middleName: middle, lastName: last,
    employeeId: dash(emp.employeeId), joiningDate: emp.joiningDate, email: emp.email,
    mobile: emp.phone, gender: emp.gender, location: dash(emp.location),
    designation: dash(emp.role), department: dash(emp.team),
    empType: emp.empType, birthday: emp.birthday, isDirector: emp.isDirector,
  };
}

/**
 * The reporting manager, as a field like any other: a search over everyone at
 * the company (anyone can be a manager), or no manager at all.
 */
function ManagerPicker({ emp, value, onChange }: { emp: Emp; value: { id: string; name: string }; onChange: (next: { id: string; name: string }) => void }) {
  const { emps } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const options = emps
    .filter((e) => e.id !== emp.id && e.id !== value.id)
    .filter((e) => !needle || e.name.toLowerCase().includes(needle) || (e.employeeId ?? '').toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pick = (next: { id: string; name: string }) => { onChange(next); setOpen(false); setQ(''); };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value.id ? 'var(--ink)' : 'var(--ink-4)' }}>{value.name || 'No reporting manager'}</span>
        <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 6px)', left: 0, right: 0, border: '1px solid var(--line)', borderRadius: 16, padding: 10, background: 'var(--surface)', boxShadow: '0 18px 40px -12px rgba(20,16,60,.28)' }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee ID" aria-label="Search for the reporting manager"
            className="pd-inp" style={{ width: '100%', height: 40, borderRadius: 999 }} />
          {options.length > 0 && <div style={{ padding: '8px 6px 0', fontSize: 11.5, color: 'var(--ink-3)' }}>{options.length} {options.length === 1 ? 'person' : 'people'}</div>}
          <div className="scry" role="listbox" style={{ marginTop: 4, display: 'grid', maxHeight: 280, overflowY: 'auto' }}>
            {options.length === 0 && <div style={{ padding: '8px 4px', fontSize: 13, color: 'var(--ink-4)' }}>Nobody matches.</div>}
            {options.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => pick({ id: o.id, name: o.name })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', border: 'none', borderRadius: 10, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <Avatar name={o.name} size={28} font={11} src={o.photoUrl} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{o.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>{[o.employeeId, o.role].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
          {value.id && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
              <button type="button" onClick={() => pick({ id: '', name: '' })} style={{ background: 'none', border: 'none', padding: '0 6px', color: 'var(--bad)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>No reporting manager</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Basic details, edited in place: every editable field at once, one Save.
 * Full name and work email stay in view but locked. The reporting manager is
 * one of the fields; only what changed is sent.
 */
export function BasicDetailsEditor({ emp, onDone }: { emp: Emp; onDone: () => void }) {
  const { emps, flash, reload } = useStore();
  const before = detailsOf(emp);
  const [form, setForm] = useState<DetailsForm>(before);
  const [manager, setManager] = useState({ id: emp.managerId, name: emp.manager });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState<{ departments: string[]; designations: string[] }>({ departments: [], designations: [] });
  useEffect(() => {
    getCompanySettings()
      .then((c) => setSaved({ departments: c.departmentList ?? [], designations: c.designationList ?? [] }))
      .catch(() => undefined);
  }, []);
  const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter((v) => v && v !== '—'))].sort();
  const set = <K extends keyof DetailsForm>(k: K, v: DetailsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const missing = { joiningDate: !form.joiningDate };

  const save = async () => {
    setTouched(true);
    if (Object.values(missing).some(Boolean)) return;
    const changes: EmployeeDetailsInput = {};
    if (form.employeeId.trim() !== before.employeeId) changes.employeeId = form.employeeId.trim();
    if (form.joiningDate !== before.joiningDate) changes.joiningDate = form.joiningDate;
    if (form.birthday !== before.birthday) changes.birthday = form.birthday;
    if (form.mobile.trim() !== before.mobile) changes.mobile = form.mobile.trim();
    if (form.gender !== before.gender) changes.gender = form.gender;
    if (form.location.trim() !== before.location) changes.location = form.location.trim();
    if (form.designation.trim() !== before.designation) changes.designation = form.designation.trim();
    if (form.department.trim() !== before.department) changes.department = form.department.trim();
    if (form.empType !== before.empType) changes.employeeType = EMP_TYPE_VALUE[form.empType];
    if (form.isDirector !== before.isDirector) changes.isDirector = form.isDirector;
    const managerChanged = manager.id !== (emp.managerId || '');
    if (Object.keys(changes).length === 0 && !managerChanged) { onDone(); return; }
    setSaving(true);
    try {
      if (Object.keys(changes).length > 0) await updateEmployeeDetails(emp.id, changes);
      let moved = 0;
      if (managerChanged) {
        if (manager.id) moved = (await setReportingManager(emp.id, manager.id)).movedRequests ?? 0;
        else await clearReportingManager(emp.id);
      }
      flash(`Basic details updated${moved ? ` · ${moved} pending request${moved === 1 ? '' : 's'} moved to ${manager.name}` : ''}`);
      await reload();
      onDone();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the details', 'error');
    } finally {
      setSaving(false);
    }
  };

  const idChanged = form.employeeId.trim() !== before.employeeId && before.employeeId !== '';
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={grid3}>
        <LockedField label="First name" value={before.firstName} />
        <LockedField label="Middle name" value={before.middleName} />
        <LockedField label="Last name" value={before.lastName} />
      </div>
      <div style={grid2}>
        <Field label="Employee ID">
          <input value={form.employeeId} onChange={(e) => set('employeeId', e.target.value.toUpperCase())} style={inputStyle} />
        </Field>
        <Field label="Date of joining" required error={touched && missing.joiningDate}>
          <input type="date" value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <div style={grid2}>
        <LockedField label="Work email" value={before.email} />
        <Field label="Mobile number">
          <input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="+91 98765 43210" style={inputStyle} />
        </Field>
      </div>
      {idChanged && (
        <div style={{ ...infoCallout, marginBottom: 18 }}>
          <span style={infoIcon}>i</span>
          <span>Punches are matched by <strong>Employee ID</strong>: the biometric device must use the new ID too.</span>
        </div>
      )}
      <div style={grid2}>
        <Field label="Designation">
          <TypeOrPick id="edit-emp-designation" value={form.designation} onChange={(v) => set('designation', v)} placeholder="Type or pick a designation" options={uniq([...emps.map((e) => e.role), ...saved.designations])} />
        </Field>
        <Field label="Department">
          <TypeOrPick id="edit-emp-department" value={form.department} onChange={(v) => set('department', v)} placeholder="Type or pick a department" options={uniq([...emps.map((e) => e.team), ...saved.departments])} />
        </Field>
      </div>
      <div style={grid2}>
        <Field label="Work location">
          <TypeOrPick id="edit-emp-location" value={form.location} onChange={(v) => set('location', v)} placeholder="Type or pick a location" options={uniq(emps.map((e) => e.location))} />
        </Field>
        <Field label="Employee type">
          <Select value={form.empType} onChange={(v) => set('empType', v || before.empType)} placeholder="Select type" options={Object.keys(EMP_TYPE_VALUE)} />
        </Field>
      </div>
      <div style={grid2}>
        <Field label="Gender">
          <Select value={form.gender} onChange={(v) => set('gender', v)} placeholder="Select gender" options={GENDER_CHOICES} />
        </Field>
        <Field label="Date of birth">
          <input type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <div style={grid2}>
        <Field label="Reporting manager">
          <ManagerPicker emp={emp} value={manager} onChange={setManager} />
        </Field>
        <div />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 400, color: 'var(--ink-2)', cursor: 'pointer', marginBottom: 16 }}>
        <input type="checkbox" checked={form.isDirector} onChange={(e) => set('isDirector', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
        <span>Employee is a <strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Director / person with substantial interest</strong> in the company.</span>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={saving} onClick={onDone} className="pd-btn">Cancel</button>
        <button type="button" disabled={saving} onClick={() => void save()} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

/**
 * Which shift template this person follows, changeable here (for someone with
 * the edit right). A change starts the next day; today stays on the old one.
 */
export function ShiftPicker({ emp, onChanged }: { emp: Emp; onChanged: () => void }) {
  const { flash } = useStore();
  const [shifts, setShifts] = useState<ShiftDTO[] | null>(null);
  const [picked, setPicked] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = () => getShifts()
    .then((all) => {
      setShifts(all);
      const current = all.find((t) => t.assignedUserIds.includes(emp.id)) ?? all.find((t) => t.isDefault);
      // On nothing yet: start from the first template they could be put on.
      setPicked(current?.id ?? all.find((t) => t.active || t.isDefault)?.id ?? '');
      setError('');
    })
    .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the shift templates'));
  useEffect(() => { void load(); }, [emp.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !shifts) return <LoadError compact text={error} onRetry={() => { setError(''); void load(); }} />;
  if (error) return <div style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 400, padding: '6px 0' }}>{error}</div>;
  if (!shifts) return <SkeletonLines lines={2} />;
  const usable = shifts.filter((t) => t.active || t.isDefault);
  if (usable.length === 0) return <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 0' }}>No shift templates yet. Create one in Shifts › Templates.</div>;
  const assigned = shifts.find((t) => t.assignedUserIds.includes(emp.id));
  const current = assigned ?? shifts.find((t) => t.isDefault);
  const nameOf = (t: ShiftDTO) => `${t.name}${t.isDefault ? ' (default)' : ''}`;
  const save = async () => {
    const target = usable.find((t) => t.id === picked);
    if (!target || target.id === current?.id) return;
    setSaving(true);
    try {
      const r = await assignShift(target.id, [emp.id]);
      flash(`${emp.name} moves to ${target.name}${r.effectiveFrom ? ` from ${showDate(r.effectiveFrom)}` : ''}`);
      await load();
      onChanged();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not change the shift', 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>
        Now on <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{current ? nameOf(current) : 'the company policy'}</strong>
        {current && !assigned && ' · nobody picked one for them, so the default applies'}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Shift template" value={picked} onChange={(e) => setPicked(e.target.value)} className="pd-inp" style={{ width: 'auto', minWidth: 260, flex: '1 1 260px', height: 40, borderRadius: 999 }}>
          {usable.map((t) => <option key={t.id} value={t.id}>{nameOf(t)}</option>)}
        </select>
        <button type="button" disabled={saving || picked === current?.id} onClick={save} className="pd-btn primary"
          style={{ cursor: picked === current?.id ? 'default' : 'pointer' }}>
          {saving ? 'Saving…' : 'Assign'}
        </button>
      </div>
      <div className="pd-subnote" style={{ marginTop: 8 }}>A change starts tomorrow; today stays on the current shift.</div>
    </div>
  );
}

/** "st", "nd", "rd" or "th" for a day of the month. */
function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
}
