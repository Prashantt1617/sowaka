// Final settlement's statement, laid out as HRSettlement draws it: Earnings and Deductions, each line
// with how it was worked out under its name, where it comes from and the amount; Gross, Total
// deductions and the Net settlement; Add a line. Every figure is the server's (the settlement's
// lines and totals): nothing is added up or filled in here. Changing a line, approving, paid and
// reopen are People › Exits' own pieces (ExitDetail.tsx).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { settlementAction } from '../../../../services/hrms';
import type { ExitDTO, SettlementDTO, SettlementLine } from '../../../../services/hrms';
import { LineEdit, SettlementNotSetUp, StatementActions, TaxNote, undecidedLine } from '../../ExitDetail';
import type { Run } from '../../ExitDetail';
import { firstName, inrPaise } from './parts';

type Props = { exit: ExitDTO; settlement: SettlementDTO; busy: string; run: Run; userId: string; sourceOf: (line: SettlementLine) => string; addLine?: ReactNode };

export function SettlementStatement(props: Props) {
  const { exit, settlement, userId } = props;
  // No salary structure: nothing is worked out (no ₹0 lines, no total) and nothing can be approved.
  if (settlement.notSetUp) return <SettlementNotSetUp userId={userId} name={exit.name} message={settlement.notSetUp} />;
  return <Lines {...props} />;
}

function Lines({ exit, settlement, busy, run, userId, sourceOf, addLine }: Props) {
  const [editing, setEditing] = useState('');
  const draft = settlement.status === 'draft';
  const cls = draft ? 'ob-st draft' : 'ob-st';
  const pay = settlement.payablePaise >= 0;
  const earnings = settlement.lines.filter((l) => l.side === 'earning');
  const deductions = settlement.lines.filter((l) => l.side === 'deduction');

  const group = (title: string, lines: SettlementLine[], totalLabel: string, total: number, first: boolean) => (
    <>
      <div className={`ob-st-r head${first ? '' : ' next'}`}>
        <span>{title}</span><span>{first ? 'From' : ''}</span><span className="amt">{first ? 'Amount' : ''}</span>{draft && <span />}
      </div>
      {lines.length === 0 && <div className="ob-st-r"><span className="sub">Nothing here.</span></div>}
      {lines.map((l) => {
        const changed = l.changedReason !== undefined;
        const open = editing === l.key;
        return (
          <div key={l.key}>
            <div id={`line-${l.key}`} className={`ob-st-r${open ? ' on' : ''}`}>
              <span className="what">
                <span>{l.label}</span>
                {l.note && <span className="sub">{l.note}</span>}
                {changed && <span className="sub chg">Changed{l.changedByName ? ` by ${l.changedByName}` : ''}: {l.changedReason}</span>}
              </span>
              <span><span className="ob-st-src">{sourceOf(l)}</span></span>
              <span className="amt">
                {inrPaise(l.amountPaise)}
                {changed && l.computedPaise !== l.amountPaise && <span className="sub was">{inrPaise(l.computedPaise)}</span>}
              </span>
              {draft && (
                <span className="act">
                  <button type="button" id={`edit-${l.key}`} disabled={!!busy} onClick={() => setEditing(open ? '' : l.key)} className="pd-btn ghost sm">
                    {open ? 'Close' : undecidedLine(l) ? 'Pay it' : 'Change'}
                  </button>
                </span>
              )}
            </div>
            {open && (
              <LineEdit line={l} busy={!!busy}
                onSave={async (amountPaise, why) => { if (await run(`line-${l.key}`, () => settlementAction(userId, 'line', { key: l.key, amountPaise, reason: why }), amountPaise == null ? 'Line put back' : 'Line changed')) setEditing(''); }} />
            )}
          </div>
        );
      })}
      <div className="ob-st-r tot"><span>{totalLabel}</span><span /><span className="amt">{inrPaise(total)}</span>{draft && <span />}</div>
    </>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className={cls}>
        {group('Earnings', earnings, 'Gross', settlement.earningsPaise, true)}
        {group('Deductions', deductions, 'Total deductions', settlement.deductionsPaise, false)}
        <div id="settle-total" className={`ob-st-net${pay ? '' : ' recover'}`}>
          <span>
            <b>{pay ? 'Net settlement' : `To recover from ${firstName(exit.name)}`}</b>
            {!pay && <small>Deductions are more than the earnings</small>}
          </span>
          <b className="n">{inrPaise(Math.abs(settlement.payablePaise))}</b>
        </div>
        {draft && addLine}
      </div>
      {settlement.tax && <TaxNote tax={settlement.tax} />}
      <StatementActions exit={exit} settlement={settlement} busy={busy} run={run} userId={userId} />
    </div>
  );
}
