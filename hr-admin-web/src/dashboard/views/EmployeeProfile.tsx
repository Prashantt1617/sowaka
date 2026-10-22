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
import type { CSSProperties, ReactNode } from 'react';
import type { Emp } from '../seed';
import { useStore } from '../store';
import { IconFile } from '../icons';
import { ETYPE, STAT, TYPE } from '../theme';
import type { LeaveType, ReqStatus } from '../theme';
import { Avatar, Pill, StatusTabs } from '../ui';
import { PdBank, PdCalendar, PdChart, PdClock, PdEdit, PdFile, PdStar, PdTarget, PdTrash, PdUser } from './pdIcons';
import './people.css';
import { periodLabel, periodShort } from '../period';
import { EmployeeKpiPanel } from './KpiAssign';
import { assignShift, clearCalendarDay, clearReportingManager, deleteEmployee, getCompanySettings, getEmployeeCalendar, getShifts, setCalendarDay, setReportingManager, updateEmployeeDetails } from '../../services/hrms';
import type { EmployeeDetailsInput, ShiftDTO } from '../../services/hrms';
import { Field, GENDERS as GENDER_CHOICES, Select, TypeOrPick, grid2, grid3, infoCallout, infoIcon, inputStyle } from './AddEmployeeWizard';
import { ApiError } from '../../services/http';
import { useAuth } from '../auth/AuthContext';
import { canOpen, SALARY_DETAILS } from '../access';
import { getEmployeePayslips, getPaymentDetails, inr as inrPaise, savePaymentDetails, type PaymentDetailsDTO, type PaymentDetailsInput, type PayrollRunDTO, type PayslipDTO } from '../../services/payroll';
import { EmployeeSalary } from './EmployeeSalary';
import { IncomeTaxCard } from './IncomeTaxCard';
import { LossOfPayExplainer } from '../LossOfPayExplainer';
import { downloadPayslipPdf } from '../payslip';
import { downloadTdsSheetPdf } from '../tdsSheet';
import type { CalendarDayDTO, CalendarDayStatus, EmployeeCalendarDTO, HrDayStatus } from '../../services/hrms';

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

// Leave balance — annual entitlement per type, minus a seeded "taken".
type LeaveBal = { key: LeaveType; name: string; entitled: number; taken: number };
function leaveBalance(seed: number): LeaveBal[] {
  return [
    { key: 'Sick', name: 'Sick Leave', entitled: 12, taken: seed % 6 },
    { key: 'Casual', name: 'Casual Leave', entitled: 12, taken: (seed * 3) % 9 },
    { key: 'Earned', name: 'Earned Leave', entitled: 18, taken: (seed * 2) % 13 },
  ];
}

function ratingWord(score: number): string {
  if (score >= 4.5) return RATINGS[0];
  if (score >= 4) return RATINGS[1];
  if (score >= 2.5) return RATINGS[2];
  return RATINGS[3];
}

/** First word, last word, and whatever sits between. */
function nameParts(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? '', middle: words.slice(1, -1).join(' '), last: words.length > 1 ? words[words.length - 1] : '' };
}

const EMP_TYPE_VALUE: Record<string, 'full_time' | 'contract' | 'intern'> = { 'Full-time': 'full_time', Contract: 'contract', Intern: 'intern' };

/** YYYY-MM-DD as the profile shows dates, e.g. 15 Oct 2026. */
const showDate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, day] = iso.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};

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
  const bal = leaveBalance(d.seed);
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
  const seesSalary = canOpen(user, SALARY_DETAILS);
  // Edit details: for someone given the right, on themselves and anyone below them.
  const [editingDetails, setEditingDetails] = useState(false);
  // HR (a dashboard admin with the right) edits anyone; others their own reporting line.
  const canEditDetails = user?.canEditEmployees === true && (user.dashboardAdmin === true || isSelfOrBelow(s.emps, user.id, emp));
  // This month, fetched once: it names the shift in the header and seeds the
  // Calendar tab, so opening that tab does not ask for the same month again.
  const [currentMonth, setCurrentMonth] = useState<EmployeeCalendarDTO | null>(null);
  useEffect(() => {
    let live = true;
    setCurrentMonth(null);
    getEmployeeCalendar(emp.id, thisMonth()).then((c) => { if (live) setCurrentMonth(c); }).catch(() => undefined);
    return () => { live = false; };
  }, [emp.id]);
  // Review state for the current cycle, from the feedback managers actually submitted.
  const review = s.fbEmps.find((f) => f.userId === emp.id);

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
      <div className="pd-prof-top">
        <button onClick={onBack} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>{backLabel}</button>
        {user?.dashboardAdmin === true && user.id !== emp.id && (
          <button type="button" onClick={() => setDeleting(true)} className="pd-btn sm" style={{ color: 'var(--bad)' }}><PdTrash /> Delete employee</button>
        )}
      </div>
      {deleting && <DeleteEmployee emp={emp} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); void s.reload(); onBack(); }} />}

      {/* Identity header */}
      <section className="pd-card pd-phead">
        <div className="ph-id">
          <Avatar name={emp.name} size={52} font={21} src={emp.photoUrl} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pn">
              <h1>{emp.name}</h1>
              <Pill label={emp.empType} tone={ETYPE[emp.empType]} />
              {emp.isDirector && <Pill label="Director" tone={{ bg: 'var(--t-lilac)', fg: 'var(--t-plum-i)' }} />}
            </div>
            <span className="sub">
              {emp.role} · {emp.team} · {emp.employeeId}
            </span>
          </div>
        </div>
        <div className="pd-facts">
          <Fact label="Work email" value={d.workEmail} />
          <Fact label="Employee ID" value={emp.employeeId} />
          <Fact label="Work location" value={d.workLocation} />
          <Fact label="Reporting manager" value={emp.manager} />
          <Fact label="Date of joining" value={emp.joining} />
          <Fact label="Shift" value={currentMonth ? `${currentMonth.shift} · ${currentMonth.window}` : '—'} />
        </div>
      </section>

      {/* One page, five views of the same person. */}
      <div className="pd-ptabs">
        <StatusTabs<ProfileTab>
          options={seesSalary ? ['profile', 'performance', 'calendar', 'requests', 'salary', 'orgchart'] : ['profile', 'performance', 'calendar', 'requests', 'orgchart']}
          active={tab}
          onSelect={setTab}
          labels={{ profile: 'Profile', performance: 'Performance', calendar: 'Calendar', requests: 'Requests', salary: 'Salary details', orgchart: 'Org chart' }}
        />
      </div>

      {tab === 'profile' && (
        <div className="pd-psecs">
          <div className="pd-psecs">
            <div data-focus="details"><Section title="Basic details" icon={<PdUser />} action={canEditDetails ? <button type="button" onClick={() => setEditingDetails(true)} className="pd-sec-act"><PdEdit /> Edit details</button> : undefined}>
            <Grid>
              <Row label="First name" value={d.firstName} />
              <Row label="Middle name" value={d.middleName || '—'} />
              <Row label="Last name" value={d.lastName} />
              <Row label="Employee ID" value={emp.employeeId} />
              <Row label="Date of joining" value={emp.joining} />
              <Row label="Work email" value={d.workEmail} />
              <Row label="Designation" value={emp.role} />
              <Row label="Department" value={emp.team} />
              <Row label="Work location" value={d.workLocation} />
              <Row label="Employee type" value={emp.empType} />
              <Row label="Mobile number" value={emp.phone || '—'} />
              <Row label="Gender" value={emp.gender || '—'} />
              <Row label="Date of birth" value={showDate(emp.birthday)} />
              <ManagerRow emp={emp} />
              <Row label="Director / substantial interest" value={emp.isDirector ? 'Yes' : 'No'} />
            </Grid>
          </Section></div>
            {canEditDetails && (
              <div data-focus="shift"><Section title="Shift template" icon={<PdClock />}>
                <ShiftPicker emp={emp} onChanged={() => getEmployeeCalendar(emp.id, thisMonth()).then(setCurrentMonth).catch(() => undefined)} />
              </Section></div>
            )}
            {/* Only when something is filed; an empty box said nothing useful. */}
            {emp.documents.length > 0 && (
            <Section title="Documents" icon={<PdFile />}>
              <div className="pd-list">
                {emp.documents.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="pd-li"
                    style={{ textDecoration: 'none', color: 'inherit', pointerEvents: doc.url ? 'auto' : 'none' }}
                  >
                    <span className="pd-li-i">
                      <IconFile size={15} stroke="currentColor" />
                    </span>
                    <span className="grow">
                      <b>{doc.type}</b>
                      <span className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}{doc.uploadedOn ? ` · ${doc.uploadedOn}` : ''}</span>
                    </span>
                    <span className="pd-sec-act">Open</span>
                  </a>
                ))}
              </div>
          </Section>
            )}
            <div data-focus="bank"><PaymentDetails userId={emp.id} /></div>
          </div>
        </div>
      )}

      {editingDetails && <EditDetails emp={emp} onClose={() => setEditingDetails(false)} />}

      {tab === 'performance' && (
        <div className="pd-psecs">
          <div className="pd-psecs">
            <Section title="Performance (PMS)" icon={<PdStar />}>
            {review && review.status !== 'none' ? (
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
            {review && review.history.length > 0 ? (
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
            <EmployeeKpiPanel
              userId={emp.id}
              userName={emp.name}
              designation={emp.role}
              period={s.cycle.period}
              nextPeriod={s.cycle.next}
              // Someone with the edit right sets KPIs for the people below them, not for themselves.
              readOnly={user?.canEditEmployees === true && emp.id === user.id ? 'You set KPIs for the people who report to you, not for yourself.' : undefined}
            />
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
            <Section title="Leave balance" icon={<PdCalendar />}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, paddingTop: 8 }}>
              {bal.map((b) => {
                const available = b.entitled - b.taken;
                const pct = Math.round((b.taken / b.entitled) * 100);
                return (
                  <div key={b.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: TYPE[b.key], flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--ink-2)' }}>{b.name}</span>
                    </div>
                    <span style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{available}<span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}> / {b.entitled}</span></span>
                    <div className="pd-bar" style={{ marginTop: 6 }}>
                      <i style={{ width: `${pct}%`, background: TYPE[b.key] }} />
                    </div>
                    <div className="pd-subnote">{b.taken} taken · {available} available</div>
                  </div>
                );
              })}
            </div>
          </Section>
          </div>
          <RequestsForEmployee emp={emp} />
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
                Reporting line · {reports.length} direct report{reports.length === 1 ? '' : 's'}{peers > 0 ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}
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
        </section>
      </div>
        </div>
      )}
    </div>
  );
}

export type ProfileTab = 'profile' | 'performance' | 'calendar' | 'requests' | 'salary' | 'orgchart';

// —— Calendar: one month, every day named ————————————————————————————————
const CAL_TONE: Record<CalendarDayStatus, { bg: string; fg: string; label: string }> = {
  present: { bg: 'var(--ok-bg)', fg: 'var(--ok)', label: 'Present' },
  half_day: { bg: 'var(--warn-bg)', fg: 'var(--warn)', label: 'Half day' },
  missed_punch: { bg: 'var(--t-peach)', fg: 'var(--warn)', label: 'Missed punch' },
  absent: { bg: 'var(--bad-bg)', fg: 'var(--bad)', label: 'Absent' },
  on_leave: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'On leave' },
  week_off: { bg: 'var(--surface-2)', fg: 'var(--ink-4)', label: 'Week off' },
  holiday: { bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)', label: 'Holiday' },
  upcoming: { bg: 'var(--surface)', fg: 'var(--ink-4)', label: 'Upcoming' },
};
const LEAVE_NAMES: Record<string, string> = { sick: 'Sick leave', casual: 'Casual leave', earned: 'Earned leave', comp_off: 'Comp off' };
// The current month by Indian time: the month HR can still correct.
const thisMonth = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
// What HR can mark a day as, in the order the dialog offers them.
const HR_CHOICES: HrDayStatus[] = ['present', 'half_day', 'absent', 'on_leave', 'week_off', 'holiday'];
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
  const [rows, setRows] = useState<{ run: PayrollRunDTO; payslip: PayslipDTO }[] | null>(null);
  const [company, setCompany] = useState<{ name: string; address: string }>({ name: '', address: '' });
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<PayslipDTO | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    getEmployeePayslips(userId)
      .then((r) => { if (live) { setRows(r.payslips); setCompany(r.company); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [userId]);

  const salaryCard = <div className="pd-card-h"><h3>Payslips</h3></div>;
  if (error) return <section className="pd-card">{salaryCard}<div style={{ padding: '8px 0', color: 'var(--bad)', fontWeight: 400, fontSize: 13 }}>{error}</div></section>;
  if (!rows) return <section className="pd-card">{salaryCard}<div className="pd-empty">Loading…</div></section>;
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
            return (
              <tr key={run.id}>
                <td style={slipTd}><b>{periodTitle(run.period)}</b></td>
                <td style={slipTd}><Pill label={tone.label} tone={{ bg: tone.bg, fg: tone.fg }} /></td>
                <td style={{ ...slipTd, textAlign: 'right' }}>{payslip.inputs.payableDays} / {payslip.inputs.workingDays}</td>
                <td style={{ ...slipTd, textAlign: 'right' }}>
                  {payslip.inputs.lopDays > 0 && lines.length > 0 ? (
                    <button type="button" onClick={() => setExplain(payslip)} title="Why is there a loss of pay?" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--bad)', fontWeight: 500, fontSize: 14, fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                      {payslip.inputs.lopDays} {payslip.inputs.lopDays === 1 ? 'day' : 'days'}
                    </button>
                  ) : (
                    <span style={{ color: payslip.inputs.lopDays ? 'var(--bad)' : 'var(--ink-4)', fontWeight: 500 }}>{payslip.inputs.lopDays} {payslip.inputs.lopDays === 1 ? 'day' : 'days'}</span>
                  )}
                </td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inrPaise(full)}</td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--bad)' }}>−{inrPaise(lopPaise + payslip.employeeDeductionsPaise)}</td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><strong>{inrPaise(payslip.netPayablePaise)}</strong></td>
                <td style={{ ...slipTd, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => void downloadPayslipPdf(payslip, company)} className="pd-btn primary sm">Download slip</button>
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
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  // The day HR is marking, if any. Only the current month can be marked.
  const [editing, setEditing] = useState<CalendarDayDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = month === thisMonth() || (editableMonth !== undefined && month === editableMonth);
  const reload = async () => {
    const fresh = await getEmployeeCalendar(userId, month);
    setCal(fresh);
    if (fresh.month === thisMonth()) onChanged(fresh);
  };
  const mark = async (day: CalendarDayDTO, status: HrDayStatus | null, note: string) => {
    setSaving(true);
    try {
      if (status) await setCalendarDay(userId, day.date, status, note.trim() || undefined);
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
    if (initial && initial.month === month) { setCal(initial); setLoading(false); return; }
    let live = true;
    setLoading(true); setError('');
    getEmployeeCalendar(userId, month)
      .then((c) => { if (live) setCal(c); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the month'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [userId, month, initial]);

  // Monday-first grid, the way the app lays the month out.
  const lead = cal ? (new Date(`${cal.month}-01T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const worked = cal ? cal.totals.present + cal.totals.half_day + cal.totals.missed_punch + cal.totals.absent + cal.totals.on_leave : 0;

  return (
    // Inside the payroll run's dialog it sits flat; on the profile it is its own card.
    <section className={startMonth ? undefined : 'pd-card'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="pd-calnav">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="pd-round">‹</button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="pd-inp" style={{ height: 42, borderRadius: 999, fontSize: 14, fontWeight: 500, padding: '0 14px' }} />
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()} className="pd-round">›</button>
        </div>
        {loading && <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>Loading…</span>}
        {cal && (
          <div style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 400 }}>
            {cal.shift} · {cal.window} · {cal.punchFormat}
          </div>
        )}
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 400, marginBottom: 12 }}>{error}</div>}

      {cal && (
        <div className="pd-legend">
          {(['present', 'half_day', 'missed_punch', 'absent', 'on_leave', 'week_off', 'holiday'] as CalendarDayStatus[]).map((k) => (
            <span key={k}>
              <i style={{ background: k === 'week_off' ? 'var(--line-2)' : CAL_TONE[k].fg }} />{CAL_TONE[k].label} <span style={{ color: 'var(--ink-3)' }}>{cal.totals[k]}</span>
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
          {(cal?.days ?? []).map((day) => {
            const tone = CAL_TONE[day.status];
            const detail = day.status === 'on_leave' ? (LEAVE_NAMES[day.label ?? ''] ?? (day.label ?? '').split('_').map((w) => w && w[0].toUpperCase() + w.slice(1)).join(' ') + ' leave')
              : day.status === 'holiday' || day.status === 'week_off' ? day.label
                : day.status === 'upcoming' ? ''
                  : day.label ?? (day.punchIn ? `${clockOf(day.punchIn)} – ${clockOf(day.punchOut)}` : '');
            const prev = day.hr ? CAL_TONE[day.hr.previousStatus] : null;
            const ring = highlight?.(day) ?? null;
            return (
              <div
                key={day.date}
                title={`${day.date}${detail ? ` · ${detail}` : ''}${day.hr ? ` · marked by ${day.hr.setByName ?? 'HR'}, was ${prev?.label}` : ''}${editable ? ' · click to mark' : ''}`}
                onClick={editable ? () => setEditing(day) : undefined}
                className={day.status === 'upcoming' ? 'pd-cd future' : 'pd-cd'}
                style={{ background: day.status === 'upcoming' ? undefined : tone.bg, color: day.status === 'upcoming' ? undefined : tone.fg, borderColor: day.status === 'week_off' ? 'var(--line)' : undefined, cursor: editable ? 'pointer' : 'default', boxShadow: ring ? 'inset 0 0 0 2px var(--bad)' : day.hr ? 'inset 0 0 0 2px var(--accent)' : undefined }}
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
                {day.status !== 'upcoming' && <div style={{ fontSize: 11, fontWeight: 400 }}>{day.hr ? '→ ' : ''}{tone.label}</div>}
                {detail && !(day.hr && detail === tone.label) && <div style={{ fontSize: 11, opacity: .85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
      {editable && <div className="pd-subnote" style={{ marginTop: 12 }}>{highlight ? 'Ringed days cost pay. ' : ''}Click any day to mark it. The mark replaces what the punches, leave or holidays say, on the dashboard, in payroll and in the employee's app.</div>}
      {editing && <MarkDay day={editing} saving={saving} onClose={() => setEditing(null)} onSave={(status, note) => void mark(editing, status, note)} />}
    </section>
  );
}

/** Pick what one day was. Shows what it is now and, when HR already marked it, what it was before. */
function MarkDay({ day, saving, onClose, onSave }: { day: CalendarDayDTO; saving: boolean; onClose: () => void; onSave: (status: HrDayStatus | null, note: string) => void }) {
  const [status, setStatus] = useState<HrDayStatus>(day.hr && HR_CHOICES.includes(day.status as HrDayStatus) ? (day.status as HrDayStatus) : 'present');
  const [note, setNote] = useState(day.hr?.note ?? '');
  const recorded = day.hr ? CAL_TONE[day.hr.previousStatus] : CAL_TONE[day.status];
  const when = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (
    <div className="pd-scrim">
      <div className="bg" onClick={onClose} />
      <div className="pd-modal" style={{ width: 'min(440px, 100%)' }}>
        <div className="pd-md-h">
          <div>
            <h3>{when}</h3>
            <div className="pd-md-sub">
              Recorded as <strong style={{ color: recorded.fg }}>{recorded.label}</strong>
              {day.hr && <> · now <strong style={{ color: CAL_TONE[day.status].fg }}>{CAL_TONE[day.status].label}</strong>, marked by {day.hr.setByName ?? 'HR'}</>}
            </div>
          </div>
        </div>
        <div className="pd-md-b">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {HR_CHOICES.map((choice) => {
              const tone = CAL_TONE[choice];
              const on = status === choice;
              return (
                <button key={choice} type="button" onClick={() => setStatus(choice)}
                  style={{ border: `1.5px solid ${on ? tone.fg : 'transparent'}`, background: tone.bg, color: tone.fg, borderRadius: 999, height: 40, padding: '0 6px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {tone.label}
                </button>
              );
            })}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional), e.g. client visit approved by email"
            className="pd-inp" style={{ width: '100%' }} />
        </div>
        <div className="pd-md-f">
          {day.hr && <button type="button" disabled={saving} onClick={() => onSave(null, '')} className="pd-btn ghost" style={{ color: 'var(--bad)', paddingLeft: 0 }}>Remove mark</button>}
          <button type="button" onClick={onClose} className="pd-btn" style={{ marginLeft: 'auto' }}>Cancel</button>
          <button type="button" disabled={saving} onClick={() => onSave(status, note)} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// —— Requests: this person's, from the live queues ———————————————————————
type Req = { id: string; kind: string; detail: string; when: string; status: ReqStatus; ord: number };
function RequestsForEmployee({ emp }: { emp: Emp }) {
  const s = useStore();
  const mine = (id?: string) => id === emp.id;
  const rows: Req[] = [
    ...s.leaves.filter((r) => mine(r.submitterId)).map((r) => ({ id: `lv-${r.id}`, kind: `${r.type} leave`, detail: r.days, when: `${r.from} – ${r.to}`, status: r.status, ord: r.ord })),
    ...s.ots.filter((r) => mine(r.submitterId)).map((r) => ({ id: `ot-${r.id}`, kind: 'Overtime', detail: r.duration, when: r.otDate, status: r.status, ord: r.ord })),
    ...s.rbs.filter((r) => mine(r.submitterId)).map((r) => ({ id: `rb-${r.id}`, kind: 'Reimbursement', detail: `${r.type} · ${r.amount}`, when: r.billDate, status: r.status, ord: r.ord })),
    ...s.corrs.filter((r) => mine(r.submitterId)).map((r) => ({ id: `cr-${r.id}`, kind: 'Attendance correction', detail: r.dayType, when: r.workDate, status: r.status, ord: r.ord })),
  ].sort((a, b) => b.ord - a.ord);
  const pending = rows.filter((r) => r.status === 'Pending').length;
  return (
    <section className="pd-card">
      <div className="pd-card-h" style={{ marginBottom: 8 }}>
        <div>
          <h3>Requests</h3>
          <small>{rows.length} raised{pending ? ` · ${pending} pending` : ''}</small>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="pd-empty" style={{ padding: 28 }}>No requests from this employee.</div>
      ) : <div className="pd-list">{rows.map((r) => (
        <div key={r.id} className="pd-li" style={{ display: 'grid', gridTemplateColumns: '34px 1.3fr 1.2fr 1fr auto', gap: 12, padding: '10px 0' }}>
          <span className="pd-li-i">{r.kind === 'Overtime' ? <PdClock size={15} /> : r.kind === 'Reimbursement' ? <PdFile size={15} /> : <PdCalendar size={15} />}</span>
          <div style={{ fontSize: 14, fontWeight: 400 }}>{r.kind}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 400 }}>{r.detail}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r.when}</div>
          <Pill label={r.status} tone={STAT[r.status]} fontSize={11.5} />
        </div>
      ))}</div>}
    </section>
  );
}

// —— Org-chart pieces ————————————————————————————————————————————————————
function Connector() {
  return <div className="pd-ovline" />;
}

function OrgNode({ emp, caption, highlight, onOpen }: { emp: Emp; caption?: string; highlight?: boolean; onOpen?: (e: Emp) => void }) {
  const clickable = !highlight && !!onOpen;
  return (
    <button
      onClick={clickable ? () => onOpen!(emp) : undefined}
      className={highlight ? 'pd-onode me' : 'pd-onode'}
      style={{ cursor: clickable ? 'pointer' : 'default', padding: highlight ? '4px 14px' : undefined }}
    >
      <Avatar name={emp.name} size={34} font={14} />
      <span className="txt">
        <b>{emp.name}</b>
        <span className="sub">{emp.role}</span>
      </span>
      {caption && <span className={highlight ? 'cnt' : 'cap'} style={highlight ? { background: 'none', fontSize: 12, marginLeft: 'auto', paddingLeft: 18 } : undefined}>{caption}</span>}
    </button>
  );
}

// Manager named on the record but not found in the roster.
function GhostNode({ name, caption }: { name: string; caption: string }) {
  return (
    <div className="pd-onode ghost">
      <Avatar name={name} size={34} font={14} />
      <span className="txt">
        <b>{name}</b>
        <span className="sub">Manager</span>
      </span>
      <span className="cap">{caption}</span>
    </div>
  );
}

// —— Building blocks ——————————————————————————————————————————————————
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="pd-fact">
      <span className="pd-eyebrow">{label}</span>
      <b>{value}</b>
    </div>
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
  useEffect(() => {
    let live = true;
    getPaymentDetails(userId).then((x) => live && setD(x)).catch(() => live && setD(null));
    return () => { live = false; };
  }, [userId]);
  if (!d) return null;
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

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="pd-card pd-psec">
      <div className="pd-sec-h">
        {icon && <span className="pd-ps-i">{icon}</span>}
        <h3>{title}</h3>
        {action}
      </div>
      <div className="pd-sec-b">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="pd-pfg">{children}</div>;
}

// Reporting manager, changeable here. The server checks the new manager is in
// the same company and isn't someone who reports to this person.
function ManagerRow({ emp }: { emp: Emp }) {
  const { emps, flash, reload } = useStore();
  const [current, setCurrent] = useState({ id: emp.managerId, name: emp.manager });
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCurrent({ id: emp.managerId, name: emp.manager }); }, [emp.managerId, emp.manager]);
  const needle = q.trim().toLowerCase();
  const options = emps
    .filter((e) => e.id !== emp.id && e.id !== current.id)
    .filter((e) => !needle || e.name.toLowerCase().includes(needle) || (e.employeeId ?? '').toLowerCase().includes(needle))
    .slice(0, 8);
  const save = async (next: Emp | null) => {
    setSaving(true);
    try {
      if (next) {
        const r = await setReportingManager(emp.id, next.id);
        setCurrent({ id: next.id, name: next.name });
        flash(`${emp.name} now reports to ${next.name}${r.movedRequests ? ` · ${r.movedRequests} pending request${r.movedRequests === 1 ? '' : 's'} moved to them` : ''}`);
      } else {
        await clearReportingManager(emp.id);
        setCurrent({ id: '', name: '' });
        flash(`${emp.name} no longer has a reporting manager`);
      }
      setEditing(false); setQ('');
      void reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not change the manager', 'error');
    } finally {
      setSaving(false);
    }
  };
  const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--hi)', fontWeight: 400, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div className="pd-pf">
      <span className="pl">Reporting manager</span>
      <div className="pv" style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span>{current.name || '—'}</span>
        {!editing && <button type="button" onClick={() => setEditing(true)} style={link}>Change</button>}
      </div>
      {editing && (
        <div style={{ gridColumn: 2, marginTop: 8, border: '1px solid var(--line)', borderRadius: 16, padding: 10, maxWidth: 440, background: 'var(--surface)', boxShadow: '0 18px 40px -12px rgba(20,16,60,.28)' }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee ID" aria-label="Search for the new manager"
            className="pd-inp" style={{ width: '100%', height: 40, borderRadius: 999 }} />
          <div style={{ marginTop: 6, display: 'grid' }}>
            {options.length === 0 && <div style={{ padding: '8px 4px', fontSize: 13, color: 'var(--ink-4)' }}>Nobody matches.</div>}
            {options.map((o) => (
              <button key={o.id} type="button" disabled={saving} onClick={() => save(o)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', border: 'none', borderRadius: 10, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <Avatar name={o.name} size={28} font={11} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{o.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>{[o.employeeId, o.role].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8, paddingLeft: 6, paddingRight: 6 }}>
            <button type="button" onClick={() => { setEditing(false); setQ(''); }} style={{ ...link, color: 'var(--ink-3)' }}>Cancel</button>
            {current.id && <button type="button" disabled={saving} onClick={() => save(null)} style={{ ...link, color: 'var(--bad)', marginLeft: 'auto' }}>Remove manager</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; wide?: boolean; strong?: boolean }) {
  return (
    <div className="pd-pf">
      <span className="pl">{label}</span>
      <span className="pv" style={strong ? { fontWeight: 500 } : undefined}>{value}</span>
    </div>
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

function isSelfOrBelow(emps: Emp[], editorId: string, emp: Emp): boolean {
  const byId = new Map(emps.map((e) => [e.id, e]));
  const seen = new Set<string>();
  let current: Emp | undefined = emp;
  while (current && !seen.has(current.id)) {
    if (current.id === editorId) return true;
    seen.add(current.id);
    current = current.managerId ? byId.get(current.managerId) : undefined;
  }
  return false;
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

/** Every Basic detail of one person, editable; only what changed is sent. */
function EditDetails({ emp, onClose }: { emp: Emp; onClose: () => void }) {
  const { emps, flash, reload } = useStore();
  const before = detailsOf(emp);
  const [form, setForm] = useState<DetailsForm>(before);
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
  const missing = {
    firstName: !form.firstName.trim(),
    email: !/^\S+@\S+\.\S+$/.test(form.email.trim()),
    joiningDate: !form.joiningDate,
  };

  const save = async () => {
    setTouched(true);
    if (Object.values(missing).some(Boolean)) return;
    const name = [form.firstName, form.middleName, form.lastName].map((w) => w.trim()).filter(Boolean).join(' ');
    const changes: EmployeeDetailsInput = {};
    if (name !== emp.name) changes.name = name;
    if (form.email.trim().toLowerCase() !== before.email.toLowerCase()) changes.email = form.email.trim();
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
    if (Object.keys(changes).length === 0) { onClose(); return; }
    setSaving(true);
    try {
      await updateEmployeeDetails(emp.id, changes);
      flash(`${name}'s details saved`);
      await reload();
      onClose();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the details', 'error');
    } finally {
      setSaving(false);
    }
  };

  const emailChanged = form.email.trim().toLowerCase() !== before.email.toLowerCase();
  const idChanged = form.employeeId.trim() !== before.employeeId && before.employeeId !== '';
  return (
    <div className="pd-scrim">
      <div className="bg" onClick={saving ? undefined : onClose} />
      <div role="dialog" aria-label={`Edit ${emp.name}'s details`} className="pd-modal" style={{ width: 'min(760px, 100%)', maxHeight: '100%', overflow: 'hidden' }}>
        <div className="pd-md-h">
          <div>
            <h3>Edit details</h3>
            <div className="pd-md-sub">{emp.name}{before.employeeId ? ` · ${before.employeeId}` : ''}</div>
          </div>
        </div>
        <div style={{ padding: '20px 20px 4px', overflowY: 'auto' }}>
          <div style={grid3}>
            <Field label="First name" required error={touched && missing.firstName}>
              <input autoFocus value={form.firstName} onChange={(e) => set('firstName', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Middle name">
              <input value={form.middleName} onChange={(e) => set('middleName', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Last name">
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Employee ID">
              <input value={form.employeeId} onChange={(e) => set('employeeId', e.target.value.toUpperCase())} style={inputStyle} />
            </Field>
            <Field label="Date of Joining" required error={touched && missing.joiningDate}>
              <input type="date" value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Work Email" required error={touched && missing.email}>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Mobile Number">
              <input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="+91 98765 43210" style={inputStyle} />
            </Field>
          </div>
          {(emailChanged || idChanged) && (
            <div style={{ ...infoCallout, marginBottom: 18 }}>
              <span style={infoIcon}>i</span>
              <span>
                {emailChanged && <>{form.firstName.trim() || 'They'} will sign in with the new <strong>email</strong>, and payslips go there from now on. </>}
                {idChanged && <>Punches are matched by <strong>Employee ID</strong>: the biometric device must use the new ID too.</>}
              </span>
            </div>
          )}
          <div style={grid2}>
            <Field label="Gender">
              <Select value={form.gender} onChange={(v) => set('gender', v)} placeholder="Select gender" options={GENDER_CHOICES} />
            </Field>
            <Field label="Date of birth">
              <input type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Designation">
              <TypeOrPick id="edit-emp-designation" value={form.designation} onChange={(v) => set('designation', v)} placeholder="Type or pick a designation" options={uniq([...emps.map((e) => e.role), ...saved.designations])} />
            </Field>
            <Field label="Department">
              <TypeOrPick id="edit-emp-department" value={form.department} onChange={(v) => set('department', v)} placeholder="Type or pick a department" options={uniq([...emps.map((e) => e.team), ...saved.departments])} />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Work Location">
              <TypeOrPick id="edit-emp-location" value={form.location} onChange={(v) => set('location', v)} placeholder="Type or pick a location" options={uniq(emps.map((e) => e.location))} />
            </Field>
            <Field label="Employee type">
              <Select value={form.empType} onChange={(v) => set('empType', v || before.empType)} placeholder="Select type" options={Object.keys(EMP_TYPE_VALUE)} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 400, color: 'var(--ink-2)', cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={form.isDirector} onChange={(e) => set('isDirector', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
            <span>Employee is a <strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Director / person with substantial interest</strong> in the company.</span>
          </label>
          <div className="pd-subnote" style={{ marginBottom: 16 }}>The reporting manager is changed on the profile itself.</div>
        </div>
        <div className="pd-md-f line">
          <button type="button" disabled={saving} onClick={onClose} className="pd-btn">Cancel</button>
          <button type="button" disabled={saving} onClick={save} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Which shift template this person follows, changeable here (for someone with
 * the edit right). A change starts the next day; today stays on the old one.
 */
function ShiftPicker({ emp, onChanged }: { emp: Emp; onChanged: () => void }) {
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

  if (error) return <div style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 400, padding: '6px 0' }}>{error}</div>;
  if (!shifts) return <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 0' }}>Loading…</div>;
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
