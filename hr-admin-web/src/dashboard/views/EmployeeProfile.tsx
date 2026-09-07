// Employee profile — opened by clicking a row in the Employees table.
// Surfaces everything captured in the Add-user wizard (Basic / Personal /
// Salary / Payment), plus the person's shift, leave balance, any open requests
// and their performance (PMS) snapshot.
// Prototype: all per-person detail is derived deterministically from the row
// (seeded by employee ID) — no API, mirrors our seed-data phase.
import type { CSSProperties, ReactNode } from 'react';
import type { MockEmp } from './Employees';
import { MOCK_EMPS } from './Employees';
import { ETYPE, STAT, TYPE } from '../theme';
import type { LeaveType, ReqStatus } from '../theme';
import { Avatar, Card, Pill } from '../ui';

// —— Deterministic per-person derivations ————————————————————————————————
const GENDERS = ['Male', 'Female'];
const BANKS = ['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'State Bank of India', 'Kotak Mahindra Bank'];
const STATE_BY_CITY: Record<string, string> = {
  Bengaluru: 'Karnataka', Mumbai: 'Maharashtra', Gurugram: 'Haryana', Remote: 'Karnataka',
};
const WORKLOC_BY_CITY: Record<string, string> = {
  Bengaluru: 'Head Office — Bengaluru', Mumbai: 'Mumbai Sales Office', Gurugram: 'Delhi NCR Hub', Remote: 'Remote — India',
};
const SHIFT_BY_TEAM: Record<string, string> = {
  Engineering: 'Tech Team — General (9:30 AM – 6:30 PM)',
  Design: 'Tech Team — General (9:30 AM – 6:30 PM)',
  Sales: 'Sales Team — Field (10:00 AM – 7:00 PM)',
  Marketing: 'Sales Team — Field (10:00 AM – 7:00 PM)',
  Operations: 'Gurgaon 3D Team — Rotational',
  Finance: 'General Office (10:00 AM – 6:30 PM)',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RATINGS = ['Outstanding', 'Exceeds expectations', 'Meets expectations', 'Developing'];

function seedOf(emp: MockEmp): number {
  const m = emp.id.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 100;
}
function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function derive(emp: MockEmp) {
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
    workEmail: `${first}.${last}`.toLowerCase() + '@convrse.ai',
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
    shift: SHIFT_BY_TEAM[emp.team] || 'General Office (10:00 AM – 6:30 PM)',
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

// Open requests awaiting the manager / HR — a seeded mix.
type OpenReq = { kind: string; detail: string; status: ReqStatus; when: string };
function openRequests(seed: number): OpenReq[] {
  const out: OpenReq[] = [];
  if (seed % 3 === 0) out.push({ kind: 'Casual Leave', detail: '2 days off', status: 'Pending', when: 'Aug 22 – Aug 23' });
  if (seed % 4 === 1) out.push({ kind: 'Reimbursement', detail: `${inr(1500 + (seed * 37) % 6000)} · Internet`, status: 'Pending', when: 'Raised Aug 16' });
  if (seed % 5 === 2) out.push({ kind: 'Overtime', detail: `${(3 + seed % 3)}.5 hrs`, status: 'Pending', when: 'Worked Aug 18' });
  if (seed % 7 === 4) out.push({ kind: 'Attendance correction', detail: 'Missed evening punch', status: 'Pending', when: 'Aug 14' });
  return out;
}

// Performance (PMS) snapshot.
function performance(seed: number) {
  const goalsDone = 3 + (seed % 3);
  return {
    rating: RATINGS[seed % RATINGS.length],
    score: (3.4 + (seed % 16) / 10).toFixed(1),
    goalsDone,
    goalsTotal: goalsDone + 1 + (seed % 2),
    cycle: 'H1 2026 (Jan – Jun)',
    lastReview: `${['12', '18', '24', '06'][seed % 4]} Jul 2026`,
    nextReview: 'Jan 2027',
  };
}

// —— Component ——————————————————————————————————————————————————————————
export function EmployeeProfile({ emp, onBack, onOpen }: { emp: MockEmp; onBack: () => void; onOpen?: (e: MockEmp) => void }) {
  const d = derive(emp);
  const bal = leaveBalance(d.seed);
  const reqs = openRequests(d.seed);
  const pms = performance(d.seed);
  const basicA = d.basicM * 12;
  const hraA = d.hraM * 12;

  // Reporting line — manager above, direct reports below (from the roster).
  // Guard against a person being their own manager (seed-data quirk).
  const managerName = emp.manager && emp.manager !== emp.name ? emp.manager : '';
  const manager = managerName ? MOCK_EMPS.find((e) => e.name === managerName) : undefined;
  const reports = MOCK_EMPS.filter((e) => e.manager === emp.name && e.id !== emp.id);
  const peers = managerName
    ? MOCK_EMPS.filter((e) => e.manager === managerName && e.id !== emp.id).length
    : 0;

  return (
    <div style={{ animation: 'fade .3s ease both', maxWidth: 1180 }}>
      <button onClick={onBack} style={backBtn}>← Back to employees</button>

      {/* Identity header */}
      <Card style={{ padding: 0, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '22px 24px' }}>
          <Avatar name={emp.name} size={68} font={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.6px' }}>{emp.name}</div>
              <Pill label={emp.empType} tone={ETYPE[emp.empType]} />
              {d.isDirector && <Pill label="Director" tone={{ bg: '#F4E9F1', fg: '#8A4A78' }} />}
            </div>
            <div style={{ fontSize: 16, color: '#717171', fontWeight: 600, marginTop: 4 }}>
              {emp.role} · {emp.team} · {emp.id}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid #F0F0F2' }}>
          <Fact label="Work email" value={d.workEmail} />
          <Fact label="Mobile" value={d.mobile} />
          <Fact label="Work location" value={d.workLocation} />
          <Fact label="Reporting manager" value={emp.manager} border />
          <Fact label="Date of joining" value={emp.joining} border />
          <Fact label="Shift" value={d.shift} border />
        </div>
      </Card>

      {/* Open requests */}
      {reqs.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionTitle>Open requests <span style={{ color: '#9A6B25', background: '#F6E9D5', borderRadius: 20, padding: '2px 10px', fontSize: 13 }}>{reqs.length} pending</span></SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(reqs.length, 4)}, 1fr)`, gap: 12 }}>
            {reqs.map((r, i) => (
              <Card key={i} style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{r.kind}</div>
                  <Pill label={r.status} tone={STAT[r.status]} fontSize={11} />
                </div>
                <div style={{ fontSize: 15, color: '#484848', fontWeight: 600, marginTop: 6 }}>{r.detail}</div>
                <div style={{ fontSize: 13, color: '#9197A2', marginTop: 3 }}>{r.when}</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Two-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* Left — the captured record */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Section title="Basic details">
            <Grid>
              <Row label="First name" value={d.firstName} />
              <Row label="Middle name" value={d.middleName || '—'} />
              <Row label="Last name" value={d.lastName} />
              <Row label="Employee ID" value={emp.id} />
              <Row label="Date of joining" value={emp.joining} />
              <Row label="Gender" value={d.gender} />
              <Row label="Work email" value={d.workEmail} />
              <Row label="Mobile number" value={d.mobile} />
              <Row label="Designation" value={emp.role} />
              <Row label="Department" value={emp.team} />
              <Row label="Work location" value={d.workLocation} />
              <Row label="Reporting manager" value={emp.manager} />
              <Row label="Director / substantial interest" value={d.isDirector ? 'Yes' : 'No'} />
            </Grid>
          </Section>

          <Section title="Personal details">
            <Grid>
              <Row label="Date of birth" value={d.dob} />
              <Row label="Age" value={`${d.age} years`} />
              <Row label="Father's name" value={d.fatherName} />
              <Row label="PAN" value={d.pan} />
              <Row label="Personal email" value={d.personalEmail} />
              <Row label="Differently abled" value="None" />
            </Grid>
            <div style={{ marginTop: 4 }}>
              <Row label="Residential address" value={`${d.address}, ${d.city}, ${d.state} — ${d.pin}`} wide />
            </div>
          </Section>

          <Section title="Salary details">
            <Grid>
              <Row label="Salary template" value={d.template} />
              <Row label="Annual CTC" value={inr(d.ctc)} strong />
              <Row label="Monthly CTC" value={inr(Math.round(d.ctc / 12))} />
              <Row label="Employee category" value={d.level === 'associate' ? 'Skilled' : 'Highly skilled'} />
            </Grid>

            {/* Statutory chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '4px 0 16px' }}>
              <StatChip on label="Employees' Provident Fund" />
              <StatChip on={d.esi} label="Employees' State Insurance" />
              <StatChip on label="Labour Welfare Fund" />
              <StatChip on={emp.empType !== 'Contract'} label="Statutory Bonus" />
            </div>

            {/* Salary breakup */}
            <div style={{ border: '1px solid #F0F0F2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, padding: '10px 14px', background: '#F7F7F9', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', textTransform: 'uppercase' }}>
                <div>Component</div>
                <div style={{ textAlign: 'right' }}>Monthly</div>
                <div style={{ textAlign: 'right' }}>Annual</div>
              </div>
              <BreakRow name="Basic" sub="50% of CTC" monthly={d.basicM} annual={basicA} />
              <BreakRow name="House Rent Allowance" sub="50% of Basic" monthly={d.hraM} annual={hraA} />
              <BreakRow name="Fixed Allowance" sub="Balancing component" monthly={Math.round(d.ctc / 12 - d.basicM - d.hraM)} annual={d.ctc - basicA - hraA} />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, padding: '11px 14px', background: '#E7F4FB' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Cost to Company</div>
                <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#0571A6' }}>{inr(Math.round(d.ctc / 12))}</div>
                <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: '#0571A6' }}>{inr(d.ctc)}</div>
              </div>
            </div>

            {/* Statutory IDs */}
            <div style={{ marginTop: 14 }}>
              <Grid>
                <Row label="PF account number" value={d.pfAccount} />
                <Row label="Universal Account Number" value={d.uan} />
                {d.esi && <Row label="ESI number" value={d.esiNumber} />}
              </Grid>
            </div>
          </Section>

          <Section title="Payment information">
            <Grid>
              <Row label="Payment mode" value={d.payMode} />
              <Row label="Bank name" value={d.bank} />
              <Row label="Account number" value={d.accountNo} />
              <Row label="IFSC" value={d.ifsc} />
              <Row label="Account type" value={d.accountType} />
            </Grid>
          </Section>
        </div>

        {/* Right rail — balance, performance, shift */}
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

          <Section title="Performance (PMS)">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px' }}>{pms.score}</div>
              <div style={{ fontSize: 14, color: '#9197A2', fontWeight: 700 }}>/ 5.0</div>
              <Pill label={pms.rating} tone={{ bg: '#E4EDE0', fg: '#4F7A52' }} fontSize={12} />
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MiniRow label="Goals completed" value={`${pms.goalsDone} / ${pms.goalsTotal}`} />
              <MiniRow label="Review cycle" value={pms.cycle} />
              <MiniRow label="Last review" value={pms.lastReview} />
              <MiniRow label="Next review" value={pms.nextReview} />
            </div>
          </Section>

          <Section title="Shift & attendance">
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{d.shift}</div>
            <div style={{ fontSize: 13.5, color: '#717171', lineHeight: 1.5 }}>
              Follows the {emp.team} team template — working window, grace, overtime and weekly-off as configured in Shift Templates.
            </div>
          </Section>
        </div>
      </div>

      {/* Reporting line — this person's slice of the org chart */}
      <div style={{ marginTop: 18 }}>
        <Card style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 20px', borderBottom: '1px solid #F0F0F2' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Org chart</div>
            <div style={{ fontSize: 13.5, color: '#9197A2', fontWeight: 600 }}>
              Reporting line · {reports.length} direct report{reports.length === 1 ? '' : 's'}{peers > 0 ? ` · ${peers} peer${peers === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <div style={{ padding: '26px 20px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Manager */}
            {manager ? (
              <OrgNode emp={manager} caption="Reporting manager" onOpen={onOpen} />
            ) : managerName ? (
              <GhostNode name={managerName} caption="Reporting manager" />
            ) : (
              <div style={{ fontSize: 13.5, color: '#9197A2', fontWeight: 600 }}>No reporting manager on record</div>
            )}

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
  );
}

// —— Org-chart pieces ————————————————————————————————————————————————————
function Connector() {
  return <div style={{ width: 2, height: 26, background: '#E4E4E8', margin: '2px 0' }} />;
}

function OrgNode({ emp, caption, highlight, onOpen }: { emp: MockEmp; caption?: string; highlight?: boolean; onOpen?: (e: MockEmp) => void }) {
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

function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>{children}</div>;
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

function StatChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '5px 11px', borderRadius: 20, background: on ? '#E4EDE0' : '#F7F7F9', color: on ? '#4F7A52' : '#9197A2', border: `1px solid ${on ? '#CFE0C6' : '#EBEBEB'}` }}>
      <span style={{ fontWeight: 800 }}>{on ? '✓' : '✕'}</span>{label}
    </span>
  );
}

function BreakRow({ name, sub, monthly, annual }: { name: string; sub: string; monthly: number; annual: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, padding: '11px 14px', borderBottom: '1px solid #F0F0F2', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#222222' }}>{name}</div>
        <div style={{ fontSize: 12, color: '#9197A2', marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 14, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{inr(monthly)}</div>
      <div style={{ textAlign: 'right', fontSize: 14, color: '#222222', fontVariantNumeric: 'tabular-nums' }}>{inr(annual)}</div>
    </div>
  );
}

const backBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0571A6', fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: '2px 0', marginBottom: 14 };
