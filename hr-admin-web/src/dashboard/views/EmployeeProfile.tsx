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
import { getEmployeeCalendar } from '../../services/hrms';
import { getEmployeePayslips, getSalaryStructure, inr as inrPaise, type PayrollRunDTO, type PayslipDTO, type SalaryStructureDTO } from '../../services/payroll';
import { LossOfPayExplainer } from '../LossOfPayExplainer';
import { printPayslip } from '../payslip';
import type { CalendarDayStatus, EmployeeCalendarDTO } from '../../services/hrms';

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
  const [first, last = ''] = emp.name.split(' ');
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
    firstName: first, middleName: '', lastName: last,
    workEmail: emp.email || '—',
    personalEmail: `${first}${seed}`.toLowerCase() + '@gmail.com',
    mobile: `+91 9${String(80000000 + (seed * 137) % 19999999).padStart(8, '0')}`,
    isDirector: seed % 25 === 0,
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

// —— Component ——————————————————————————————————————————————————————————
export function EmployeeProfile({ emp, onBack, onOpen }: { emp: Emp; onBack: () => void; onOpen?: (e: Emp) => void }) {
  const s = useStore();
  const d = derive(emp);
  const bal = leaveBalance(d.seed);
  const [tab, setTab] = useState<ProfileTab>('profile');
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
      <button onClick={onBack} style={backBtn}>← Back to employees</button>

      {/* Identity header */}
      <Card style={{ padding: 0, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '22px 24px' }}>
          <Avatar name={emp.name} size={68} font={26} src={emp.photoUrl} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.6px' }}>{emp.name}</div>
              <Pill label={emp.empType} tone={ETYPE[emp.empType]} />
              {d.isDirector && <Pill label="Director" tone={{ bg: '#F4E9F1', fg: '#8A4A78' }} />}
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
          options={['profile', 'performance', 'calendar', 'requests', 'salary', 'orgchart']}
          active={tab}
          onSelect={setTab}
          labels={{ profile: 'Profile', performance: 'Performance', calendar: 'Calendar', requests: 'Requests', salary: 'Salary details', orgchart: 'Org chart' }}
        />
      </div>

      {tab === 'profile' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18, alignItems: 'start', maxWidth: 820 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Section title="Basic details">
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
              <Row label="Reporting manager" value={emp.manager} />
              <Row label="Director / substantial interest" value={d.isDirector ? 'Yes' : 'No'} />
            </Grid>
          </Section>
            <Section title="Documents">
            {emp.documents.length === 0 ? (
              <div style={{ fontSize: 15, color: '#9197A2', fontWeight: 500 }}>Nothing filed yet. Documents are added from the employee's record.</div>
            ) : (
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
            )}
          </Section>
          </div>
        </div>
      )}

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
            <Section title="KPIs">
            <EmployeeKpiPanel
              userId={emp.id}
              userName={emp.name}
              designation={emp.role}
              period={s.cycle.period}
              nextPeriod={s.cycle.next}
            />
          </Section>
          </div>
        </div>
      )}

      {tab === 'calendar' && <EmployeeCalendar userId={emp.id} initial={currentMonth} />}
      {tab === 'salary' && <SalarySlips userId={emp.id} />}

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

type ProfileTab = 'profile' | 'performance' | 'calendar' | 'requests' | 'salary' | 'orgchart';

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
const thisMonth = () => new Date().toISOString().slice(0, 7);
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
  const [structure, setStructure] = useState<SalaryStructureDTO | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRows(null);
    setStructure(undefined);
    getSalaryStructure(userId)
      .then((r) => { if (live) setStructure(r.structure); })
      .catch(() => { if (live) setStructure(null); });
    getEmployeePayslips(userId)
      .then((r) => { if (live) { setRows(r.payslips); setCompany(r.company); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [userId]);

  const salaryCard = structure === undefined ? null : (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Fact label="Monthly salary" value={structure && structure.annualCtcPaise > 0 ? inrPaise(Math.round(structure.annualCtcPaise / 12)) : '—'} />
        <Fact label="Annual CTC" value={structure && structure.annualCtcPaise > 0 ? inrPaise(structure.annualCtcPaise) : '—'} />
        <Fact label="Salary template" value={structure?.salaryTemplateCode ? `${structure.salaryTemplateCode.charAt(0)}${structure.salaryTemplateCode.slice(1).toLowerCase()}${structure.status === 'active' ? '' : ' · not on payroll'}` : '—'} />
      </div>
    </Card>
  );
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
                  <button type="button" onClick={() => printPayslip(payslip, company)} style={{ background: '#0571A6', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Download slip</button>
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

function EmployeeCalendar({ userId, initial }: { userId: string; initial: EmployeeCalendarDTO | null }) {
  const [month, setMonth] = useState(thisMonth());
  const [cal, setCal] = useState<EmployeeCalendarDTO | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
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
            const detail = day.status === 'on_leave' ? (LEAVE_NAMES[day.label ?? ''] ?? day.label)
              : day.status === 'holiday' || day.status === 'week_off' ? day.label
                : day.status === 'upcoming' ? ''
                  : day.label ?? (day.punchIn ? `${clockOf(day.punchIn)} – ${clockOf(day.punchOut)}` : '');
            return (
              <div key={day.date} title={`${day.date}${detail ? ` · ${detail}` : ''}`} style={{ minHeight: 84, padding: 10, borderBottom: '1px solid #F0F0F2', borderRight: '1px solid #F0F0F2', background: day.status === 'upcoming' ? '#fff' : tone.bg, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: day.status === 'upcoming' ? '#C7CBD3' : '#222222' }}>{Number(day.date.slice(8))}</span>
                  {day.lateByMinutes > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#7E5FB0' }}>late {day.lateByMinutes}m</span>}
                </div>
                {day.status !== 'upcoming' && <div style={{ fontSize: 12.5, fontWeight: 700, color: tone.fg }}>{tone.label}</div>}
                {detail && <div style={{ fontSize: 12, color: tone.fg, opacity: .85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>}
              </div>
            );
          })}
        </div>
      </Card>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid #F0F0F2', fontSize: 16, fontWeight: 800 }}>{title}</div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </Card>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 26px' }}>{children}</div>;
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
