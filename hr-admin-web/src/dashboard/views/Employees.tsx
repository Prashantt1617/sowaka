import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ETYPE } from '../theme';
import { Avatar, Loadable, Pill, SearchInput, SelectBox, SkeletonPage } from '../ui';
import type { Emp } from '../seed';
import { AddUserButton } from './AddUserButton';
import { EmployeeProfile, type ProfileTab } from './EmployeeProfile';
import { Td, Th } from './kpiUi';
import { canOpen } from '../access';
import { useLifecycleOn } from '../lifecycleSwitch';
import { PreboardingList } from './lifecycle/PreboardingList';
import { PREBOARDING_LIST_KEY } from './lifecycle/preboardingLinks';
import { readHandoff } from './lifecycle/format';
import './people.css';

/** Waits for the shared lists this page reads before drawing it. */
export function Employees() {
  const s = useStore();
  return (
    <Loadable state={s.listState('employees')} onRetry={() => void s.reload()} skeleton={<SkeletonPage rows={8} cols={6} />}>
      <EmployeesBody />
    </Loadable>
  );
}

function EmployeesBody() {
  const s = useStore();
  const [selected, setSelected] = useState<Emp | null>(null);
  const [page, setPage] = useState(1);
  // Who the list shows: everyone working here (on notice included), only those on notice, those who left,
  // or those still to join (their pre-boarding profiles; where the employee lifecycle is on).
  const [who, setWho] = useState<'working' | 'notice' | 'left' | 'preboarding'>(() => (readHandoff(PREBOARDING_LIST_KEY) ? 'preboarding' : 'working'));
  const lifecycle = useLifecycleOn(Boolean(s.user?.dashboardAccess));
  const preboarding = lifecycle === true && canOpen(s.user, 'preboarding');
  const showPreboarding = who === 'preboarding' && preboarding;
  // The departments of those still to join, for the team filter while their list shows.
  const [preTeams, setPreTeams] = useState<string[]>([]);
  // Bumped when Add user › Confirm new user adds someone to join: their list loads again.
  const [preKey, setPreKey] = useState(0);
  // Opened from elsewhere (Suwi's links): which person, and on which tab.
  const [initialTab, setInitialTab] = useState<ProfileTab | undefined>(undefined);
  const req = s.profileRequest;
  useEffect(() => {
    if (!req) return;
    const e = s.emps.find((x) => x.id === req.userId);
    if (e) {
      const tabs: Record<string, ProfileTab> = { calendar: 'calendar', salary: 'salary', performance: 'performance', requests: 'requests', orgchart: 'orgchart', activity: 'activity', exit: 'exit' };
      setInitialTab(req.tab ? tabs[req.tab] : undefined);
      setSelected(e);
    }
    s.clearProfileRequest();
  }, [req, s]);

  // The live record, not the row as it was clicked: after an edit the store
  // reloads, and the profile has to show (and edit from) what was saved.
  const open = selected ? s.emps.find((x) => x.id === selected.id) ?? selected : null;
  if (open) return <EmployeeProfile key={open.id} emp={open} initialTab={initialTab} onBack={() => { setSelected(null); setInitialTab(undefined); }} onOpen={setSelected} />;

  // Departments actually present in this org, rather than a fixed list that
  // may name teams the company does not have.
  const teams = showPreboarding ? preTeams : [...new Set(s.emps.map((e) => e.team).filter((t) => t && t !== '—'))].sort();

  // People who have left (access ended after their last day) are kept out unless asked for;
  // those on notice still work here, so they stay, tagged.
  const working = s.emps.filter((e) => !e.exit?.left);
  const leftCount = s.emps.length - working.length;
  let rows = who === 'left' ? s.emps.filter((e) => e.exit?.left) : who === 'notice' ? working.filter((e) => e.exit) : working.slice();
  const q = s.empSearch.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.employeeId.toLowerCase().includes(q) || r.role.toLowerCase().includes(q));
  if (s.empTeam !== 'all') rows = rows.filter((r) => r.team === s.empTeam);

  const PAGE_SIZE = 11; // first page ends after Meera Bose
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const firstShown = rows.length === 0 ? 0 : (curPage - 1) * PAGE_SIZE + 1;
  const lastShown = (curPage - 1) * PAGE_SIZE + pageRows.length;

  return (
    <div>
      <div className="pd-head" style={{ justifyContent: 'flex-end', marginTop: -8 }}>
        <div className="pd-actions">
          {!showPreboarding && <button onClick={() => void exportEmployees(rows)} disabled={rows.length === 0} className="pd-btn"><IconExport /> Export list</button>}
          {/* Add user: Add existing user (the wizard), Create new offer or Confirm new user (one flow with Onboarding's). */}
          <AddUserButton onConfirmed={() => { if (preboarding) { setWho('preboarding'); setPreKey((n) => n + 1); } }} />
        </div>
      </div>

      <section className="pd-card">
        <div className="pd-toolbar pd-grow-search">
          <SearchInput value={s.empSearch} onChange={s.setEmpSearch} placeholder="Search name, ID or role…" width={280} />
          <SelectBox value={s.empTeam} onChange={s.setEmpTeam}>
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </SelectBox>
          {(leftCount > 0 || working.some((e) => e.exit) || preboarding) && (
            <SelectBox value={showPreboarding ? 'preboarding' : who === 'preboarding' ? 'working' : who} onChange={(v) => {
              // Teams differ between the two lists: moving to or from Pre-boarding starts on All teams.
              if ((v === 'preboarding') !== showPreboarding) s.setEmpTeam('all');
              setWho(v as typeof who); setPage(1);
            }}>
              <option value="working">Working here</option>
              {(leftCount > 0 || working.some((e) => e.exit)) && <option value="notice">On notice</option>}
              {(leftCount > 0 || working.some((e) => e.exit)) && <option value="left">Left · {leftCount}</option>}
              {preboarding && <option value="preboarding">Pre-boarding</option>}
            </SelectBox>
          )}
        </div>
        {showPreboarding ? <PreboardingList key={preKey} search={s.empSearch} team={s.empTeam} onTeams={setPreTeams} /> : (
        <>
        <div className="pd-countline" style={{ marginBottom: 14 }}><b>{rows.length}</b> of {who === 'left' ? leftCount : working.length} {who === 'left' ? 'who left' : 'people'}</div>
        <div className="pd-tbl-wrap">
        <table className="pd-t">
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th width="16%">Role</Th>
              <Th width="11%">Team</Th>
              <Th width="11%">Location</Th>
              <Th width={110}>Type</Th>
              <Th width="13%">Manager</Th>
              <Th width={120}>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="phm-row pd-click" onClick={() => setSelected(r)}>
                <Td>
                  <span className="pd-who">
                    <Avatar name={r.name} size={34} font={14} src={r.photoUrl} />
                    <span className="txt">
                      <b>{r.name}</b>
                      <span className="sub">
                        {r.employeeId}
                        {r.exit && <ExitTag exit={r.exit} />}
                      </span>
                    </span>
                  </span>
                </Td>
                <Td>{r.role}</Td>
                <Td>{r.team && r.team !== '—' ? <span className="pd-tag">{r.team}</span> : r.team}</Td>
                <Td>{r.location}</Td>
                <Td><Pill label={r.empType} tone={ETYPE[r.empType]} /></Td>
                <Td>{r.manager}</Td>
                <Td>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.joining}</span>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="pd-empty">
                  No employees match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

      {rows.length > 0 && (
        <div className="pd-pager">
          <div>
            Showing {firstShown}–{lastShown} of {rows.length}
          </div>
          <div className="pages">
            <button onClick={() => setPage(curPage - 1)} disabled={curPage === 1}>
              ← Prev
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)} className={p === curPage ? 'on' : undefined}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage(curPage + 1)} disabled={curPage === pageCount}>
              Next →
            </button>
          </div>
        </div>
      )}
        </>
        )}
      </section>
    </div>
  );
}

function IconExport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}

/** The list as filtered on screen, as an Excel sheet. */
async function exportEmployees(rows: Emp[]) {
  // The spreadsheet library is large; it is fetched the first time someone exports.
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows.map((e) => ({
    'Employee ID': e.employeeId,
    Name: e.name,
    'Work email': e.email,
    Designation: e.role,
    Department: e.team,
    Location: e.location,
    'Employment type': e.empType,
    'Reporting manager': e.manager,
    'Date of joining': e.joining,
  })));
  ws['!cols'] = [12, 24, 30, 22, 20, 14, 14, 22, 14].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  XLSX.writeFile(wb, `employees-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** "On notice · 31 Dec" while they work their notice, "Left · 31 Dec" after. */
function ExitTag({ exit }: { exit: { lastWorkingDay: string; left: boolean } }) {
  const day = new Date(`${exit.lastWorkingDay}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
      background: exit.left ? 'var(--surface-2)' : 'var(--warn-bg)', color: exit.left ? 'var(--ink-3)' : 'var(--warn)' }}>
      {exit.left ? 'Left' : 'On notice'} · {day}
    </span>
  );
}
