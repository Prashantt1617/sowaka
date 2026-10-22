import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ETYPE } from '../theme';
import { Avatar, Loadable, Pill, SearchInput, SelectBox, SkeletonPage } from '../ui';
import { IconPlus } from '../icons';
import type { Emp } from '../seed';
import { AddEmployeeWizard } from './AddEmployeeWizard';
import { AccountLimitModal } from './AccountLimitModal';
import { getAccountLimit } from '../../services/hrms';
import { EmployeeProfile, type ProfileTab } from './EmployeeProfile';
import { Td, Th } from './kpiUi';
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
  const [addOpen, setAddOpen] = useState(false);
  // Set to the company's limit when it is already reached: the popup instead of the wizard.
  const [limitReached, setLimitReached] = useState<number | null | false>(false);
  const [checkingLimit, setCheckingLimit] = useState(false);
  // A company without a limit (every company unless Sowaka sets one) goes straight to the wizard.
  // If the check itself fails, the wizard opens anyway: the server still refuses an account over the limit.
  const openAdd = () => {
    if (checkingLimit) return;
    setCheckingLimit(true);
    getAccountLimit()
      .then(({ max, used }) => { if (max !== null && used >= max) setLimitReached(max); else setAddOpen(true); })
      .catch(() => setAddOpen(true))
      .finally(() => setCheckingLimit(false));
  };
  const [selected, setSelected] = useState<Emp | null>(null);
  const [page, setPage] = useState(1);
  // Opened from elsewhere (Suwi's links): which person, and on which tab.
  const [initialTab, setInitialTab] = useState<ProfileTab | undefined>(undefined);
  const req = s.profileRequest;
  useEffect(() => {
    if (!req) return;
    const e = s.emps.find((x) => x.id === req.userId);
    if (e) {
      const tabs: Record<string, ProfileTab> = { calendar: 'calendar', salary: 'salary', performance: 'performance', requests: 'requests', orgchart: 'orgchart' };
      setInitialTab(req.tab ? tabs[req.tab] : undefined);
      setSelected(e);
    }
    s.clearProfileRequest();
  }, [req, s]);

  if (selected) return <EmployeeProfile key={selected.id} emp={selected} initialTab={initialTab} onBack={() => { setSelected(null); setInitialTab(undefined); }} onOpen={setSelected} />;

  // Departments actually present in this org, rather than a fixed list that
  // may name teams the company does not have.
  const teams = [...new Set(s.emps.map((e) => e.team).filter((t) => t && t !== '—'))].sort();

  let rows = s.emps.slice();
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
      {addOpen && <AddEmployeeWizard onClose={() => setAddOpen(false)} />}
      {limitReached !== false && <AccountLimitModal max={limitReached} onClose={() => setLimitReached(false)} />}
      <div className="pd-head" style={{ justifyContent: 'flex-end', marginTop: -8 }}>
        <div className="pd-actions">
          <button onClick={() => void exportEmployees(rows)} disabled={rows.length === 0} className="pd-btn"><IconExport /> Export list</button>
          <button onClick={openAdd} disabled={checkingLimit} className="pd-btn primary">
            <IconPlus size={15} /> Add user
          </button>
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
        </div>
        <div className="pd-countline" style={{ marginBottom: 14 }}><b>{rows.length}</b> of {s.emps.length} people</div>
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
                      <span className="sub">{r.employeeId}</span>
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
