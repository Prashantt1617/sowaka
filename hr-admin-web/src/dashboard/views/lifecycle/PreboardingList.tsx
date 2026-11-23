// People › Employees › Pre-boarding: everyone still to join, by joining date, with
// how far their Employee profile is, the sections HR approved and the documents
// waiting for HR. A row opens the candidate's pre-boarding profile.
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useStore } from '../../store';
import { Avatar, LoadError, SkeletonRows } from '../../ui';
import { listPreboarding, isNotAvailable } from '../../../services/lifecycle';
import type { PreboardingRow } from '../../../services/lifecycle';
import { Td, Th } from '../kpiUi';
import { errText, shortDay } from './format';
import { pctColour } from './boardModel';
import { candidateStatus, preboardingHref, rememberPreboardingList } from './preboardingLinks';

export function PreboardingList({ search, team, onTeams }: { search: string; team: string; onTeams: (teams: string[]) => void }) {
  const s = useStore();
  const [rows, setRows] = useState<PreboardingRow[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError('');
    listPreboarding()
      .then((list) => {
        if (!live) return;
        const all = Array.isArray(list) ? list : [];
        setRows(all);
        onTeams([...new Set(all.map((r) => r.department).filter((d): d is string => Boolean(d)))].sort());
      })
      .catch((e: unknown) => { if (live) setError(isNotAvailable(e) ? 'Employee lifecycle is not switched on for your company.' : errText(e, 'Could not load the pre-boarding list')); });
    return () => { live = false; };
  }, [attempt, onTeams]);

  if (error && !rows) return <LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!rows) return <SkeletonRows rows={5} cols={6} />;

  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => (team === 'all' || r.department === team)
    && (!q || r.name.toLowerCase().includes(q) || (r.designation ?? '').toLowerCase().includes(q) || (r.department ?? '').toLowerCase().includes(q)));

  const open = (journeyId: string) => { rememberPreboardingList(); s.setView('preboarding', journeyId); };
  // The name is a real link (a new tab with Ctrl / Cmd / middle click); a plain click opens it here.
  const onLink = (e: MouseEvent<HTMLAnchorElement>, journeyId: string) => {
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(journeyId);
  };

  return (
    <>
      <div className="pd-countline" style={{ marginBottom: 14 }}><b>{shown.length}</b> of {rows.length} joining</div>
      <div className="pd-tbl-wrap">
        <table className="pd-t">
          <thead>
            <tr>
              <Th>Candidate</Th>
              <Th width="20%">Role</Th>
              <Th width={130}>Joining</Th>
              <Th width={150}>Profile</Th>
              <Th width={120}>Approved</Th>
              <Th width={150}>Documents waiting</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const pct = r.profileTotal ? Math.round((r.profileDone / r.profileTotal) * 100) : 0;
              return (
                <tr key={r.journeyId} className="phm-row pd-click" onClick={() => open(r.journeyId)}>
                  <Td>
                    <span className="pd-who">
                      <Avatar name={r.name} size={34} font={14} />
                      <span className="txt">
                        <a href={preboardingHref(r.journeyId)} onClick={(e) => onLink(e, r.journeyId)} style={{ color: 'inherit', textDecoration: 'none' }}><b>{r.name}</b></a>
                        <span className="sub">{candidateStatus(String(r.status))}</span>
                      </span>
                    </span>
                  </Td>
                  <Td>{[r.designation, r.department].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td><span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.tj ? shortDay(r.tj) : 'Not set'}</span></Td>
                  <Td>
                    <span style={{ display: 'grid', gap: 5, maxWidth: 130 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.profileDone} of {r.profileTotal}</span>
                      <span style={{ height: 5, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                        <i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: pctColour(pct) }} />
                      </span>
                    </span>
                  </Td>
                  <Td><span style={{ fontVariantNumeric: 'tabular-nums', color: r.approvedSections ? 'var(--ok)' : 'var(--ink-3)' }}>{r.approvedSections} of {r.profileTotal}</span></Td>
                  <Td>
                    {r.documentsWaiting > 0
                      ? <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontVariantNumeric: 'tabular-nums' }}>{r.documentsWaiting} to review</span>
                      : <span style={{ color: 'var(--ink-3)' }}>None</span>}
                  </Td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="pd-empty">
                  {rows.length === 0 ? 'No one is in pre-boarding right now.' : 'No one matches your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
