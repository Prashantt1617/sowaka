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
import { Avatar, Card, Pill, StatusTabs } from '../ui';
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
      el.style.boxShadow = '0 0 0 3px #0571A6';
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
    <div style={{ animation: 'fade .3s ease both', maxWidth: 1180 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button onClick={onBack} style={backBtn}>{backLabel}</button>
        {user?.dashboardAdmin === true && user.id !== emp.id && (
          <button type="button" onClick={() => setDeleting(true)} style={{ background: '#fff', color: '#C4382E', border: '1px solid #F0C9C4', padding: '8px 14px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Delete employee</button>
        )}
      </div>
      {deleting && <DeleteEmployee emp={emp} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); void s.reload(); onBack(); }} />}

      {/* Identity header */}
      <Card style={{ padding: 0, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '22px 24px' }}>
          <Avatar name={emp.name} size={68} font={26} src={emp.photoUrl} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.6px' }}>{emp.name}</div>
              <Pill label={emp.empType} tone={ETYPE[emp.empType]} />
              {emp.isDirector && <Pill label="Director" tone={{ bg: '#F4E9F1', fg: '#8A4A78' }} />}
            </div>
            <div style={{ fontSize: 16, color: '#717171', fontWeight: 600, marginTop: 4 }}>
              {emp.role} · {emp.team} · {emp.employeeId}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid #F0F0F2' }}>
          <Fact label="Work email" value={d.workEmail} />
          <Fact label="Employee ID" value={emp.employeeId} />
          <Fact label="Work location" value={d.workLocation} />
          <Fact label="Reporting manager" value={emp.manager} border />
          <Fact label="Date of joining" value={emp.joining} border />
          <Fact label="Shift" value={currentMonth ? `${currentMonth.shift} · ${currentMonth.window}` : '—'} border />
        </div>
      </Card>

      {/* One page, five views of the same person. */}
      <div style={{ marginBottom: 18 }}>
        <StatusTabs<ProfileTab>
          options={seesSalary ? ['profile', 'performance', 'calendar', 'requests', 'salary', 'orgchart'] : ['profile', 'performance', 'calendar', 'requests', 'orgchart']}
          active={tab}
          onSelect={setTab}
          labels={{ profile: 'Profile', performance: 'Performance', calendar: 'Calendar', requests: 'Requests', salary: 'Salary details', orgchart: 'Org chart' }}
        />
      </div>

      {tab === 'profile' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18, alignItems: 'start', maxWidth: 820 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div data-focus="details"><Section title="Basic details" action={canEditDetails ? <button type="button" onClick={() => setEditingDetails(true)} style={editBtn}>Edit details</button> : undefined}>
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
              <div data-focus="shift"><Section title="Shift template">
                <ShiftPicker emp={emp} onChanged={() => getEmployeeCalendar(emp.id, thisMonth()).then(setCurrentMonth).catch(() => undefined)} />
              </Section></div>
            )}
            {/* Only when something is filed; an empty box said nothing useful. */}
            {emp.documents.length > 0 && (
            <Section title="Documents">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {emp.documents.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#FBFBFC', border: '1px solid #EBEBEB', borderRadius: 11, padding: '11px 13px', textDecoration: 'none', color: 'inherit', pointerEvents: doc.url ? 'auto' : 'none' }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFE7F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <IconFile size={16} stroke="#7E5FB0" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#222222' }}>{doc.type}</div>
                      <div style={{ fontSize: 13, color: '#717171', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}{doc.uploadedOn ? ` · ${doc.uploadedOn}` : ''}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0571A6' }}>Open</span>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Section title="Performance (PMS)">
            {review && review.status !== 'none' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px' }}>
                    {review.overall > 0 ? review.overall.toFixed(1) : '—'}
                  </div>
                  <div style={{ fontSize: 14, color: '#9197A2', fontWeight: 700 }}>/ 5.0</div>
                  {review.overall > 0 && (
                    <Pill label={ratingWord(review.overall)} tone={{ bg: '#E4EDE0', fg: '#4F7A52' }} fontSize={12} />
                  )}
                </div>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <MiniRow label="Review cycle" value={periodLabel(s.cycle.period)} />
                  <MiniRow label="Reviewed by" value={review.managerName} />
                  <MiniRow label="Last updated" value={review.date || '—'} />
                </div>
                {review.params.length > 0 && (
                  <div style={{ marginTop: 16, borderTop: '1px solid #F0F0F2', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {review.params.map((p, i) => (
                      <div key={`${p.name}-${i}`}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1, minWidth: 0 }}>{p.name}</span>
                          <span style={{ fontSize: 14.5, fontWeight: 800 }}>
                            {p.score > 0 ? p.score.toFixed(1) : '—'}
                          </span>
                        </div>
                        {p.note && (
                          <div style={{ fontSize: 13, color: '#717171', lineHeight: 1.5, marginTop: 3 }}>{p.note}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {review.extra && (
                  <div style={{ marginTop: 14, borderTop: '1px solid #F0F0F2', paddingTop: 12, fontSize: 13.5, color: '#484848', lineHeight: 1.6 }}>
                    {review.extra}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.55 }}>
                No review submitted for {periodLabel(s.cycle.period)}
                {review?.managerName && review.managerName !== '—' ? ` — ${review.managerName} has not started it yet.` : '.'}
              </div>
            )}
          </Section>
            <Section title="Review history">
            {review && review.history.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {review.history.map((h) => (
                  <div key={h.period} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <span style={{ fontSize: 13.5, color: '#717171', fontWeight: 600, width: 76, flexShrink: 0 }}>
                      {periodShort(h.period)}
                    </span>
                    <span style={{ flex: 1, height: 7, borderRadius: 5, background: '#F0F0F2', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${(h.overall / 5) * 100}%`, height: '100%', background: '#BFD8E8' }} />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', width: 30, textAlign: 'right' }}>
                      {h.overall.toFixed(1)}
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 12.5, color: '#9197A2', marginTop: 2, lineHeight: 1.5 }}>
                  Sent reviews only. A cycle with no bar is one nobody submitted.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: '#717171', lineHeight: 1.55 }}>
                No earlier reviews yet.
              </div>
            )}
          </Section>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div data-focus="kpi"><Section title="KPIs">
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
          <div style={{ marginTop: 22 }}><SalarySlips userId={emp.id} /></div>
        </div>
      )}

      {tab === 'requests' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.7fr', gap: 18, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Section title="Leave balance">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {bal.map((b) => {
                const available = b.entitled - b.taken;
                const pct = Math.round((b.taken / b.entitled) * 100);
                return (
                  <div key={b.key}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: TYPE[b.key], flexShrink: 0 }} />
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{b.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800 }}>{available}<span style={{ color: '#9197A2', fontWeight: 600 }}> / {b.entitled}</span></span>
                    </div>
                    <div style={{ height: 7, borderRadius: 5, background: '#F0F0F2', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: TYPE[b.key], opacity: .55 }} />
                    </div>
                    <div style={{ fontSize: 12.5, color: '#9197A2', marginTop: 4 }}>{b.taken} taken · {available} available</div>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => { s.setOrgChartFocus(emp.id); s.setView('orgchart'); }}
              style={{ background: '#0571A6', color: '#fff', border: 'none', borderRadius: 11, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Open in org chart ↗
            </button>
          </div>
      {/* Reporting line — this person's slice of the org chart */}
      <div>
        <Card style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px', borderBottom: '1px solid #F0F0F2' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Org chart</div>
            <div style={{ fontSize: 13.5, color: '#9197A2', fontWeight: 600 }}>
              Reporting line · {reports.length} direct report{reports.length === 1 ? '' : 's'}{peers > 0 ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <div style={{ padding: '26px 20px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%' }}>
                  {reports.map((r) => <OrgNode key={r.id} emp={r} onOpen={onOpen} />)}
                </div>
              </>
            )}
            {reports.length === 0 && (
              <div style={{ fontSize: 13, color: '#9197A2', fontWeight: 600, marginTop: 14 }}>No direct reports</div>
            )}
          </div>
        </Card>
      </div>
        </div>
      )}
    </div>
  );
}

export type ProfileTab = 'profile' | 'performance' | 'calendar' | 'requests' | 'salary' | 'orgchart';

// —— Calendar: one month, every day named ————————————————————————————————
const CAL_TONE: Record<CalendarDayStatus, { bg: string; fg: string; label: string }> = {
  present: { bg: '#E6F1E7', fg: '#4F7A52', label: 'Present' },
  half_day: { bg: '#FBF1DD', fg: '#9A6B25', label: 'Half day' },
  missed_punch: { bg: '#FBE9DE', fg: '#B25A1B', label: 'Missed punch' },
  absent: { bg: '#F8E3E7', fg: '#A8475F', label: 'Absent' },
  on_leave: { bg: '#E7F2F7', fg: '#0571A6', label: 'On leave' },
  week_off: { bg: '#F1F1F4', fg: '#9197A2', label: 'Week off' },
  holiday: { bg: '#EFE7F2', fg: '#7E5FB0', label: 'Holiday' },
  upcoming: { bg: '#FFFFFF', fg: '#C7CBD3', label: 'Upcoming' },
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
  draft: { bg: '#F7F7F9', fg: '#717171', label: 'Draft' },
  pending_approval: { bg: '#E7ECF4', fg: '#4A6FA5', label: 'Pending approval' },
  approved: { bg: '#E6F1E7', fg: '#4F7A52', label: 'Approved' },
  rejected: { bg: '#F8E3E7', fg: '#A8475F', label: 'Rejected' },
  paid: { bg: '#E7F2F7', fg: '#0571A6', label: 'Paid' },
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

  const salaryCard = <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>Payslips</div>;
  if (error) return <div>{salaryCard}<Card><div style={{ padding: 28, color: '#A8475F', fontWeight: 600 }}>{error}</div></Card></div>;
  if (!rows) return <div>{salaryCard}<Card><div style={{ padding: 40, textAlign: 'center', color: '#717171', fontWeight: 600 }}>Loading…</div></Card></div>;
  if (rows.length === 0) {
    return <div>{salaryCard}<Card><div style={{ padding: 40, textAlign: 'center', color: '#717171', fontWeight: 600 }}>No salary slips yet — they appear here once a payroll run includes this person.</div></Card></div>;
  }
  return (
    <div>
    {salaryCard}
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
        <thead>
          <tr>
            {['Month', 'Status', 'Paid days', 'Loss of pay', 'Gross', 'Deductions', 'Net pay', ''].map((h, i) => (
              <th key={h || i} style={{ textAlign: i >= 2 ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '12px 18px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' }}>{h}</th>
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
                <td style={slipTd}><strong>{periodTitle(run.period)}</strong></td>
                <td style={slipTd}><Pill label={tone.label} tone={{ bg: tone.bg, fg: tone.fg }} /></td>
                <td style={{ ...slipTd, textAlign: 'right' }}>{payslip.inputs.payableDays} / {payslip.inputs.workingDays}</td>
                <td style={{ ...slipTd, textAlign: 'right' }}>
                  {payslip.inputs.lopDays > 0 && lines.length > 0 ? (
                    <button type="button" onClick={() => setExplain(payslip)} title="Why is there a loss of pay?" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#A8475F', fontWeight: 700, fontSize: 16, fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                      {payslip.inputs.lopDays} {payslip.inputs.lopDays === 1 ? 'day' : 'days'}
                    </button>
                  ) : (
                    <span style={{ color: payslip.inputs.lopDays ? '#A8475F' : '#9197A2', fontWeight: 700 }}>{payslip.inputs.lopDays} {payslip.inputs.lopDays === 1 ? 'day' : 'days'}</span>
                  )}
                </td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inrPaise(full)}</td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#A8475F' }}>−{inrPaise(lopPaise + payslip.employeeDeductionsPaise)}</td>
                <td style={{ ...slipTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><strong>{inrPaise(payslip.netPayablePaise)}</strong></td>
                <td style={{ ...slipTd, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => void downloadPayslipPdf(payslip, company)} style={{ background: '#0571A6', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Download slip</button>
                    {payslip.id && <button type="button" onClick={() => void downloadTdsSheetPdf(payslip.id!).catch((e) => alert(e instanceof Error ? e.message : String(e)))} style={{ background: '#fff', color: '#0571A6', border: '1px solid #0571A6', padding: '8px 14px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>TDS sheet</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {explain && <LossOfPayExplainer userId={userId} payslip={explain} onClose={() => setExplain(null)} />}
    </Card>
    </div>
  );
}

const slipTd: CSSProperties = { padding: '13px 18px', borderBottom: '1px solid #F4F4F6', verticalAlign: 'middle' };

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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} style={calNav}>‹</button>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ border: '1px solid #EBEBEB', borderRadius: 11, padding: '8px 12px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', background: '#fff', color: '#222222' }} />
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()} style={{ ...calNav, opacity: month >= thisMonth() ? 0.4 : 1 }}>›</button>
        {loading && <span style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>Loading…</span>}
        {cal && (
          <div style={{ marginLeft: 'auto', fontSize: 14, color: '#717171', fontWeight: 600 }}>
            {cal.shift} · {cal.window} · {cal.punchFormat}
          </div>
        )}
      </div>
      {error && <div style={{ fontSize: 14, color: '#A8475F', fontWeight: 600, marginBottom: 12 }}>{error}</div>}

      {cal && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {(['present', 'half_day', 'missed_punch', 'absent', 'on_leave', 'week_off', 'holiday'] as CalendarDayStatus[]).map((k) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: CAL_TONE[k].bg, color: CAL_TONE[k].fg, borderRadius: 999, padding: '5px 11px', fontSize: 13, fontWeight: 700 }}>
              {CAL_TONE[k].label} <span style={{ opacity: .8 }}>{cal.totals[k]}</span>
            </span>
          ))}
          <span style={{ alignSelf: 'center', fontSize: 13, color: '#9197A2', fontWeight: 600 }}>{worked} working days so far</span>
        </div>
      )}

      <Card style={{ padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #F0F0F2' }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, letterSpacing: '.5px', color: '#717171' }}>{d.toUpperCase()}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} style={{ minHeight: 84, borderBottom: '1px solid #F0F0F2', borderRight: '1px solid #F0F0F2', background: '#FAFAFB' }} />)}
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
                style={{ minHeight: 84, padding: 10, borderBottom: '1px solid #F0F0F2', borderRight: '1px solid #F0F0F2', background: day.status === 'upcoming' ? '#fff' : tone.bg, display: 'flex', flexDirection: 'column', gap: 6, cursor: editable ? 'pointer' : 'default', boxShadow: ring ? 'inset 0 0 0 3px #C4382E' : day.hr ? 'inset 0 0 0 2px #0571A6' : undefined }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: day.status === 'upcoming' ? '#C7CBD3' : '#222222' }}>{Number(day.date.slice(8))}</span>
                  {ring ? <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: '#C4382E', borderRadius: 5, padding: '1px 5px' }}>{ring}</span>
                    : day.hr ? <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: '#0571A6', borderRadius: 5, padding: '1px 5px' }}>HR</span>
                    : day.lateByMinutes > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#7E5FB0' }}>late {day.lateByMinutes}m</span>}
                </div>
                {day.hr && prev && (
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: prev.fg, textDecoration: 'line-through', opacity: .75 }}>{prev.label}</div>
                )}
                {day.status !== 'upcoming' && <div style={{ fontSize: 12.5, fontWeight: 700, color: tone.fg }}>{day.hr ? '→ ' : ''}{tone.label}</div>}
                {detail && !(day.hr && detail === tone.label) && <div style={{ fontSize: 12, color: tone.fg, opacity: .85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>}
              </div>
            );
          })}
        </div>
      </Card>
      {editable && <div style={{ fontSize: 13, color: '#9197A2', marginTop: 10 }}>{highlight ? 'Ringed days cost pay. ' : ''}Click any day to mark it. The mark replaces what the punches, leave or holidays say, on the dashboard, in payroll and in the employee's app.</div>}
      {editing && <MarkDay day={editing} saving={saving} onClose={() => setEditing(null)} onSave={(status, note) => void mark(editing, status, note)} />}
    </div>
  );
}

/** Pick what one day was. Shows what it is now and, when HR already marked it, what it was before. */
function MarkDay({ day, saving, onClose, onSave }: { day: CalendarDayDTO; saving: boolean; onClose: () => void; onSave: (status: HrDayStatus | null, note: string) => void }) {
  const [status, setStatus] = useState<HrDayStatus>(day.hr && HR_CHOICES.includes(day.status as HrDayStatus) ? (day.status as HrDayStatus) : 'present');
  const [note, setNote] = useState(day.hr?.note ?? '');
  const recorded = day.hr ? CAL_TONE[day.hr.previousStatus] : CAL_TONE[day.status];
  const when = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.35)' }} />
      <div style={{ position: 'relative', width: 'min(440px, 100%)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(34,34,34,.25)', padding: '20px 22px' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{when}</div>
        <div style={{ fontSize: 13.5, color: '#717171', marginTop: 4 }}>
          Recorded as <strong style={{ color: recorded.fg }}>{recorded.label}</strong>
          {day.hr && <> · now <strong style={{ color: CAL_TONE[day.status].fg }}>{CAL_TONE[day.status].label}</strong>, marked by {day.hr.setByName ?? 'HR'}</>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, margin: '16px 0 12px' }}>
          {HR_CHOICES.map((choice) => {
            const tone = CAL_TONE[choice];
            const on = status === choice;
            return (
              <button key={choice} type="button" onClick={() => setStatus(choice)}
                style={{ border: `2px solid ${on ? tone.fg : 'transparent'}`, background: tone.bg, color: tone.fg, borderRadius: 10, padding: '10px 6px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                {tone.label}
              </button>
            );
          })}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional), e.g. client visit approved by email"
          style={{ width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 14, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
          {day.hr && <button type="button" disabled={saving} onClick={() => onSave(null, '')} style={{ background: 'none', border: 'none', color: '#A8475F', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Remove mark</button>}
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button type="button" disabled={saving} onClick={() => onSave(status, note)} style={{ background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
const calNav: CSSProperties = { width: 36, height: 36, borderRadius: 10, border: '1px solid #EBEBEB', background: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer', color: '#484848', fontFamily: 'inherit' };

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
    <Card style={{ padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px', borderBottom: '1px solid #F0F0F2' }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Requests</div>
        <div style={{ fontSize: 13.5, color: '#9197A2', fontWeight: 600 }}>{rows.length} raised{pending ? ` · ${pending} pending` : ''}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#9197A2', fontSize: 15, fontWeight: 600 }}>No requests from this employee.</div>
      ) : rows.map((r) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.2fr 1fr auto', gap: 12, alignItems: 'center', padding: '13px 20px', borderBottom: '1px solid #F0F0F2' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{r.kind}</div>
          <div style={{ fontSize: 14, color: '#484848', fontWeight: 600 }}>{r.detail}</div>
          <div style={{ fontSize: 13.5, color: '#717171' }}>{r.when}</div>
          <Pill label={r.status} tone={STAT[r.status]} fontSize={12} />
        </div>
      ))}
    </Card>
  );
}

// —— Org-chart pieces ————————————————————————————————————————————————————
function Connector() {
  return <div style={{ width: 2, height: 26, background: '#E4E4E8', margin: '2px 0' }} />;
}

function OrgNode({ emp, caption, highlight, onOpen }: { emp: Emp; caption?: string; highlight?: boolean; onOpen?: (e: Emp) => void }) {
  const clickable = !highlight && !!onOpen;
  return (
    <button
      onClick={clickable ? () => onOpen!(emp) : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6,
        width: 172, padding: '14px 12px', borderRadius: 14, background: highlight ? '#E7F4FB' : '#fff',
        border: `${highlight ? 2 : 1}px solid ${highlight ? '#0571A6' : '#EBEBEB'}`,
        boxShadow: highlight ? '0 6px 18px rgba(5,113,166,.14)' : '0 3px 10px rgba(34,34,34,.06)',
        cursor: clickable ? 'pointer' : 'default', font: 'inherit',
      }}
    >
      {caption && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: highlight ? '#0571A6' : '#B0B4BC' }}>{caption}</span>}
      <Avatar name={emp.name} size={44} font={15} />
      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#222222', lineHeight: 1.2 }}>{emp.name}</div>
      <div style={{ fontSize: 12.5, color: '#717171', lineHeight: 1.3 }}>{emp.role}</div>
    </button>
  );
}

// Manager named on the record but not found in the roster.
function GhostNode({ name, caption }: { name: string; caption: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, width: 172, padding: '14px 12px', borderRadius: 14, background: '#fff', border: '1px dashed #D8D8DC' }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#B0B4BC' }}>{caption}</span>
      <Avatar name={name} size={44} font={15} />
      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#222222', lineHeight: 1.2 }}>{name}</div>
      <div style={{ fontSize: 12.5, color: '#9197A2', lineHeight: 1.3 }}>Manager</div>
    </div>
  );
}

// —— Building blocks ——————————————————————————————————————————————————
function Fact({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div style={{ padding: '14px 22px', borderTop: border ? '1px solid #F0F0F2' : 'none', borderLeft: '1px solid #F0F0F2', minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.03em', color: '#9197A2', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#222222', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 700, color: '#717171' }}>
      {label}
      <input value={(form?.[key] as string | undefined) ?? ''} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ padding: '8px 10px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 15, fontFamily: 'inherit' }} />
    </label>
  );
  return (
    <Section
      title="Payment and tax IDs"
      action={d.canEdit && !form ? <button type="button" onClick={() => setForm({ bankName: d.bankName, accountHolder: d.accountHolder, ifsc: d.ifsc, accountNumber: d.accountNumber, pan: d.pan, uan: d.uan, accountType: d.accountType ?? 'savings', payMode: d.payMode ?? 'bank_transfer' })} style={editBtn}>Edit</button> : undefined}
    >
      {form ? (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {field('Bank name', 'bankName', 'e.g. HDFC Bank')}
            {field('Account holder', 'accountHolder')}
            {field('Account number', 'accountNumber', '9 to 18 digits')}
            {field('IFSC', 'ifsc', 'e.g. HDFC0001234')}
            {field('PAN', 'pan', 'ABCDE1234F')}
            {field('UAN', 'uan', '12 digits')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => void save()} disabled={saving} style={{ ...editBtn, background: '#0571A6', color: '#fff', borderColor: '#0571A6' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setForm(null)} style={editBtn}>Cancel</button>
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
      {!d.unmasked && (d.accountNumber || d.pan || d.uan) && <div style={{ fontSize: 12.5, color: '#9197A2', marginTop: 10 }}>Shown masked: full numbers are visible only with payroll access.</div>}
    </Section>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid #F0F0F2', fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1 }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </Card>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 26px' }}>{children}</div>;
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
  const label = { fontSize: 12.5, fontWeight: 700, letterSpacing: '.03em', color: '#9197A2', textTransform: 'uppercase' as const };
  const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#0571A6', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div style={{ minWidth: 0, gridColumn: editing ? '1 / -1' : undefined }}>
      <div style={label}>Reporting manager</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#222222' }}>{current.name || '—'}</span>
        {!editing && <button type="button" onClick={() => setEditing(true)} style={link}>Change</button>}
      </div>
      {editing && (
        <div style={{ marginTop: 8, border: '1px solid #EBEBEB', borderRadius: 12, padding: 10, maxWidth: 440, background: '#fff' }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or employee ID" aria-label="Search for the new manager"
            style={{ width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 15, fontFamily: 'inherit' }} />
          <div style={{ marginTop: 6, display: 'grid' }}>
            {options.length === 0 && <div style={{ padding: '8px 4px', fontSize: 14, color: '#9197A2' }}>Nobody matches.</div>}
            {options.map((o) => (
              <button key={o.id} type="button" disabled={saving} onClick={() => save(o)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <Avatar name={o.name} size={28} font={11} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#222222' }}>{o.name}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: '#717171' }}>{[o.employeeId, o.role].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, borderTop: '1px solid #F0F0F2', paddingTop: 8 }}>
            <button type="button" onClick={() => { setEditing(false); setQ(''); }} style={{ ...link, color: '#717171' }}>Cancel</button>
            {current.id && <button type="button" disabled={saving} onClick={() => save(null)} style={{ ...link, color: '#A8475F', marginLeft: 'auto' }}>Remove manager</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, wide, strong }: { label: string; value: string; wide?: boolean; strong?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.03em', color: '#9197A2', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: strong ? 800 : 600, color: '#222222', marginTop: 3, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: '#222222' }}>{value}</span>
    </div>
  );
}

const backBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0571A6', fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: '2px 0', marginBottom: 14 };

const editBtn: CSSProperties = { background: '#fff', color: '#0571A6', border: '1px solid #CFE0F2', padding: '6px 12px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };

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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,38,.45)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(460px, 100%)', padding: '20px 22px', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Delete {emp.name}?</div>
        <div style={{ fontSize: 14, color: '#484848', lineHeight: 1.5 }}>
          Their account, profile, sign-ins, salary set-up and bank details are deleted for good and they can no longer use the app. Past attendance, leave and payslips stay, so payroll and reports still add up. This can't be undone.
        </div>
        <label style={{ display: 'block', fontSize: 13, color: '#717171', fontWeight: 600, margin: '14px 0 6px' }}>Type <strong style={{ color: '#222222' }}>{emp.name}</strong> to confirm</label>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #D9DCE1', borderRadius: 8, fontSize: 15, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button type="button" disabled={!matches || busy} onClick={() => void run()} style={{ background: matches ? '#C4382E' : '#E8B4AE', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: matches ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>{busy ? 'Deleting…' : 'Delete for good'}</button>
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={saving ? undefined : onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.35)' }} />
      <div role="dialog" aria-label={`Edit ${emp.name}'s details`} style={{ position: 'relative', width: 'min(760px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(34,34,34,.25)' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #F0F0F2' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Edit details</div>
          <div style={{ fontSize: 13.5, color: '#717171', marginTop: 3 }}>{emp.name}{before.employeeId ? ` · ${before.employeeId}` : ''}</div>
        </div>
        <div style={{ padding: '18px 22px 4px', overflowY: 'auto' }}>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 600, color: '#484848', cursor: 'pointer', marginBottom: 18 }}>
            <input type="checkbox" checked={form.isDirector} onChange={(e) => set('isDirector', e.target.checked)} />
            <span>Employee is a <strong>Director / person with substantial interest</strong> in the company.</span>
          </label>
          <div style={{ fontSize: 13, color: '#9197A2', marginBottom: 14 }}>The reporting manager is changed on the profile itself.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: '1px solid #F0F0F2' }}>
          <button type="button" disabled={saving} onClick={onClose} style={{ background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button type="button" disabled={saving} onClick={save} style={{ background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{saving ? 'Saving…' : 'Save'}</button>
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

  if (error) return <div style={{ fontSize: 14, color: '#A8475F', fontWeight: 600 }}>{error}</div>;
  if (!shifts) return <div style={{ fontSize: 14, color: '#9197A2' }}>Loading…</div>;
  const usable = shifts.filter((t) => t.active || t.isDefault);
  if (usable.length === 0) return <div style={{ fontSize: 14, color: '#9197A2' }}>No shift templates yet. Create one in Shifts › Templates.</div>;
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
    <div>
      <div style={{ fontSize: 14, color: '#717171', marginBottom: 10 }}>
        Now on <strong style={{ color: '#222222' }}>{current ? nameOf(current) : 'the company policy'}</strong>
        {current && !assigned && ' · nobody picked one for them, so the default applies'}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Shift template" value={picked} onChange={(e) => setPicked(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: 260, flex: '1 1 260px' }}>
          {usable.map((t) => <option key={t.id} value={t.id}>{nameOf(t)}</option>)}
        </select>
        <button type="button" disabled={saving || picked === current?.id} onClick={save}
          style={{ background: '#0571A6', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: picked === current?.id ? 'default' : 'pointer', opacity: saving || picked === current?.id ? 0.5 : 1, fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : 'Assign'}
        </button>
      </div>
      <div style={{ fontSize: 13, color: '#9197A2', marginTop: 8 }}>A change starts tomorrow; today stays on the current shift.</div>
    </div>
  );
}
