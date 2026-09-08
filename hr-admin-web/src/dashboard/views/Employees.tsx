import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ETYPE } from '../theme';
import { Avatar, Card, Pill, SearchInput, SelectBox } from '../ui';
import { IconPlus } from '../icons';
import type { Emp } from '../seed';
import { AddEmployeeWizard } from './AddEmployeeWizard';
import { EmployeeProfile } from './EmployeeProfile';
import { NameCell, Td, Th } from './kpiUi';
import { primaryBtn, smallBtn } from './kpiStyles';

export function Employees() {
  const s = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Emp | null>(null);
  const [page, setPage] = useState(1);

  if (selected) return <EmployeeProfile emp={selected} onBack={() => setSelected(null)} onOpen={setSelected} />;

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16, flexWrap: 'wrap' }}>
        <SearchInput value={s.empSearch} onChange={s.setEmpSearch} placeholder="Search name, ID or role…" width={280} />
        <SelectBox value={s.empTeam} onChange={s.setEmpTeam}>
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </SelectBox>
        <div style={{ marginLeft: 'auto', fontSize: 16, color: '#717171', fontWeight: 600 }}>{rows.length} of {s.emps.length} people</div>
        <button onClick={() => setAddOpen(true)} style={primaryBtn}>
          <IconPlus size={15} /> Add user
        </button>
      </div>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
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
              <tr key={r.id} className="phm-row" onClick={() => setSelected(r)} style={{ cursor: 'pointer' }}>
                <Td>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <Avatar name={r.name} size={34} font={13} />
                    <span style={{ minWidth: 0 }}>
                      <NameCell name={r.name} />
                      <span style={{ display: 'block', fontSize: 13, color: '#9197A2', fontWeight: 600 }}>{r.employeeId}</span>
                    </span>
                  </span>
                </Td>
                <Td muted>{r.role}</Td>
                <Td muted>{r.team}</Td>
                <Td muted>{r.location}</Td>
                <Td><Pill label={r.empType} tone={ETYPE[r.empType]} /></Td>
                <Td muted>{r.manager}</Td>
                <Td muted>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.joining}</span>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>
                  No employees match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

const pageBtn: CSSProperties = { ...smallBtn };
const pageBtnDisabled: CSSProperties = { color: '#9197A2', cursor: 'not-allowed', background: '#F7F7F9' };
const pageNum: CSSProperties = { minWidth: 32, height: 32, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const pageNumActive: CSSProperties = { background: '#0571A6', color: '#fff', borderColor: '#0571A6' };
