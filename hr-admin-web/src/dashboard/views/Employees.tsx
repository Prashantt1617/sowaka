import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ETYPE } from '../theme';
import type { EmpType } from '../theme';
import { Avatar, Card, EmptyRow, Pill, SearchInput, SelectBox } from '../ui';
import { IconPlus } from '../icons';
import { AddEmployeeWizard } from './AddEmployeeWizard';

const COLS = '2fr 1.4fr 1fr 1.1fr 1fr 1.3fr 1fr';

// —— Mock employee database (frontend-capture phase, ~50 people) ——————————
type MockEmp = { name: string; id: string; role: string; team: string; location: string; empType: EmpType; manager: string; joining: string };

const FIRST = ['Ananya', 'Rahul', 'Priya', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Rohan', 'Isha', 'Aditya', 'Meera', 'Karan', 'Neha', 'Siddharth', 'Divya', 'Aman', 'Pooja', 'Nikhil', 'Riya', 'Varun', 'Tara', 'Kabir', 'Anjali', 'Dev', 'Sana', 'Yash', 'Ira', 'Nitin', 'Zoya', 'Harsh', 'Lata', 'Om', 'Bhavna', 'Raj', 'Simran', 'Kunal', 'Naina', 'Gaurav', 'Payal', 'Manav', 'Ritu', 'Sahil', 'Diya', 'Vivek', 'Aarti', 'Rehan', 'Kiara', 'Tarun', 'Nisha', 'Ved'];
const LAST = ['Rao', 'Sharma', 'Nair', 'Iyer', 'Gupta', 'Mehta', 'Reddy', 'Singh', 'Das', 'Kulkarni', 'Bose', 'Menon', 'Kapoor', 'Joshi', 'Pillai', 'Chopra', 'Verma', 'Shetty', 'Bhat', 'Malhotra'];
const TEAMS = ['Engineering', 'Design', 'Sales', 'Marketing', 'Operations', 'Finance'];
const ROLES: Record<string, string[]> = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'Engineering Manager', 'QA Engineer'],
  Design: ['Product Designer', 'UX Designer', 'Design Lead'],
  Sales: ['Account Executive', 'Sales Development Rep', 'Regional Sales Head'],
  Marketing: ['Marketing Associate', 'Content Lead', 'Growth Manager'],
  Operations: ['People Operations', 'Customer Success Manager', 'Ops Analyst'],
  Finance: ['Finance Analyst', 'Accountant', 'Finance Manager'],
};
const LOCATIONS = ['Bengaluru', 'Mumbai', 'Gurugram', 'Remote'];
const MANAGERS = ['Ananya Rao', 'Vikram Nair', 'Priya Iyer', 'Rahul Sharma', 'Meera Menon'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MOCK_EMPS: MockEmp[] = Array.from({ length: 50 }, (_, i) => {
  const team = TEAMS[i % TEAMS.length];
  const roles = ROLES[team];
  const empType: EmpType = i % 11 === 5 ? 'Intern' : i % 7 === 3 ? 'Contract' : 'Full-time';
  const day = ((i * 7) % 27) + 1;
  const month = MONTHS[i % 12];
  const year = 2022 + (i % 4);
  return {
    name: `${FIRST[i]} ${LAST[i % LAST.length]}`,
    id: `EMP-${101 + i}`,
    role: roles[i % roles.length],
    team,
    location: LOCATIONS[i % LOCATIONS.length],
    empType,
    manager: MANAGERS[i % MANAGERS.length],
    joining: `${String(day).padStart(2, '0')} ${month} ${year}`,
  };
});

export function Employees() {
  const s = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  let rows = MOCK_EMPS.slice();
  const q = s.empSearch.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.role.toLowerCase().includes(q));
  if (s.empTeam !== 'all') rows = rows.filter((r) => r.team === s.empTeam);

  const PAGE_SIZE = 11; // first page ends after Meera Bose
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const firstShown = rows.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1;
  const lastShown = (curPage - 1) * PAGE_SIZE + pageRows.length;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {addOpen && <AddEmployeeWizard onClose={() => setAddOpen(false)} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16, flexWrap: 'wrap' }}>
        <SearchInput value={s.empSearch} onChange={s.setEmpSearch} placeholder="Search name, ID or role…" width={280} />
        <SelectBox value={s.empTeam} onChange={s.setEmpTeam}>
          <option value="all">All teams</option>
          <option value="Design">Design</option>
          <option value="Engineering">Engineering</option>
          <option value="Sales">Sales</option>
          <option value="Marketing">Marketing</option>
          <option value="Operations">Operations</option>
          <option value="Finance">Finance</option>
        </SelectBox>
        <div style={{ marginLeft: 'auto', fontSize: 16, color: '#717171', fontWeight: 600 }}>{rows.length} of {MOCK_EMPS.length} people</div>
        <button
          onClick={() => setAddOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0571A6', border: 'none', color: '#fff', borderRadius: 11, padding: '9px 16px', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(5,113,166,.26)' }}
        >
          <IconPlus /> Add user
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.5px', color: '#717171' }}>
          <div>EMPLOYEE</div>
          <div>ROLE</div>
          <div>TEAM</div>
          <div>LOCATION</div>
          <div>TYPE</div>
          <div>MANAGER</div>
          <div>JOINED</div>
        </div>
        {pageRows.map((r) => (
          <div
            key={r.id}
            className="dc-row"
            style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '13px 22px', borderBottom: '1px solid #F0F0F2', alignItems: 'center', cursor: 'pointer', transition: 'background .12s' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <Avatar name={r.name} size={38} font={14} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>{r.id}</div>
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.role}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.team}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.location}</div>
            <div>
              <Pill label={r.empType} tone={ETYPE[r.empType]} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.joining}</div>
          </div>
        ))}
        {rows.length === 0 && <EmptyRow text="No employees match your search." />}
      </Card>

      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <div style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>
            Showing {firstShown}–{lastShown} of {rows.length}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setPage(curPage - 1)}
              disabled={curPage === 1}
              style={{ ...pageBtn, ...(curPage === 1 ? pageBtnDisabled : {}) }}
            >
              ← Prev
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                style={{ ...pageNum, ...(p === curPage ? pageNumActive : {}) }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage(curPage + 1)}
              disabled={curPage === pageCount}
              style={{ ...pageBtn, ...(curPage === pageCount ? pageBtnDisabled : {}) }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const pageBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '7px 13px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const pageBtnDisabled: CSSProperties = { color: '#9197A2', cursor: 'not-allowed', background: '#F7F7F9' };
const pageNum: CSSProperties = { minWidth: 32, height: 32, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const pageNumActive: CSSProperties = { background: '#0571A6', color: '#fff', borderColor: '#0571A6' };
