// Setup › Employee lifecycle › Onboarding templates › one template: the Joiners and Edit joiners tabs.
// The same people flow as Shift templates (TemplatePeople.tsx), for the joiners being onboarded:
// who is on this template now (name, stage, joining date), and moving joiners onto it. A joiner is
// always on exactly one onboarding template, so nobody is "removed" here: they are moved onto
// another template from that template. GET / POST /admin/lifecycle/templates/:id/journeys.
import { useCallback, useMemo } from 'react';
import { useStore } from '../../store';
import type { Emp } from '../../seed';
import type { EmpType } from '../../theme';
import { LoadError, SkeletonLines } from '../../ui';
import { moveJourneysToTemplate } from '../../../services/lifecycle';
import type { TemplateJourney } from '../../../services/lifecycle';
import { TemplateEditPeople, TemplateMembers } from '../TemplatePeople';
import type { PeopleColumn, PeopleNoun } from '../TemplatePeople';
import { TAB_LABELS, columnLabel } from './boardModel';
import { errText, longDay } from './format';
import type { JoinersTab, TemplateJoinersData } from './hooks';

const JOINERS: PeopleNoun = ['joiner', 'joiners'];
const STATUS_LABEL: Record<string, string> = {
  draft: 'Offer not sent', offer_sent: 'Offer sent', accepted: 'Accepted', finalised: 'Finalised', active: 'On the portal',
  docs_approved: 'Documents approved', joined: 'Joined', moved_to_app: 'On the app', confirmed: 'Confirmed',
};

/** Where a joiner is: "Offer not sent", else the board's tab and step ("First week · Day 1"). */
function joinerStage(r: Pick<TemplateJourney, 'status' | 'tab' | 'column'>): string {
  if (r.status === 'draft') return STATUS_LABEL.draft;
  if (r.tab && r.column) return `${TAB_LABELS[r.tab]} · ${columnLabel(r.column)}`;
  return STATUS_LABEL[r.status] ?? r.status;
}

/** A journey as the people lists read a person: its id is the journey's; the joining date is Tj. */
const asEmp = (r: TemplateJourney): Emp => ({
  id: r.journeyId, name: r.name, email: '', employeeId: r.employeeId ?? '', photoUrl: '',
  role: r.designation ?? '', team: r.department ?? '', location: r.location ?? '', branch: '', recognition: '',
  empType: '' as EmpType, manager: r.managerName ?? '', managerId: r.managerUserId ?? '', dob: '', joining: r.tj ? longDay(r.tj) : '',
  joiningDate: r.tj ?? '', birthday: '', gender: '', phone: '', isDirector: false, documents: [], exit: null,
});

export function TemplateJoiners({ id, name, tab, data }: { id: string; name: string; tab: Exclude<JoinersTab, 'template'>; data: TemplateJoinersData }) {
  const { flash, setView, openProfile } = useStore();
  const { rows, error, reload } = data;
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.journeyId, r])), [rows]);
  const all = useMemo(() => (rows ?? []).map(asEmp), [rows]);
  const members = useMemo(() => all.filter((e) => byId.get(e.id)?.templateId === id), [all, byId, id]);
  const stageOf = useCallback((e: Emp) => { const r = byId.get(e.id); return r ? joinerStage(r) : '—'; }, [byId]);
  const columns = useMemo<PeopleColumn[]>(() => [
    { head: 'STAGE', cell: stageOf, width: '1.1fr' },
    { head: 'JOINING DATE', cell: (e) => (e.joiningDate ? longDay(e.joiningDate) : '—'), width: '0.9fr' },
    { head: 'DESIGNATION', cell: (e) => e.role || '—', width: '1fr' },
  ], [stageOf]);
  const placement = useCallback((e: Emp) => {
    const r = byId.get(e.id);
    const on = r?.templateId === id;
    return { on, elsewhere: on ? undefined : r?.templateName };
  }, [byId, id]);
  // A joiner who has joined opens their profile; one still in pre-boarding, the onboarding board.
  const open = useCallback((e: Emp) => {
    const r = byId.get(e.id);
    if (r?.userId) openProfile(r.userId); else setView('onboarding');
  }, [byId, openProfile, setView]);

  const move = async (ids: string[]) => {
    if (!ids.length) return;
    const n = `${ids.length} ${ids.length === 1 ? 'joiner' : 'joiners'}`;
    if (!window.confirm(`Move ${n} to ${name}? Done steps stay done; their open steps change to this template's.`)) return;
    try {
      const res = await moveJourneysToTemplate(id, ids);
      reload();
      flash(`${res.moved.length} ${res.moved.length === 1 ? 'joiner moves' : 'joiners move'} to ${name}`);
    } catch (e) { flash(errText(e, 'Could not move them'), 'error'); }
  };

  if (!rows) return <section className="pd-card">{error ? <LoadError text={error} onRetry={reload} /> : <SkeletonLines lines={6} />}</section>;
  if (tab === 'joiners') {
    return (
      <TemplateMembers members={members} title="Joiners on this template" noun={JOINERS} columns={columns} onOpen={open}
        placeholder="Search: Design team, joining after 1 Dec, interns in Pune…"
        note="Everyone being onboarded on this template now, from the offer to confirmation. Offers that ended (declined, expired, not joining) are not listed."
        emptyText="Nobody is on this template yet. Move joiners here in Edit joiners." />
    );
  }
  return (
    <TemplateEditPeople emps={all} placement={placement} onAdd={move} addWord="Move" noun={JOINERS} columns={columns} onOpen={open}
      placeholders={{ add: 'Who to move here? e.g. Design team, joining after 1 Dec, interns', remove: '' }}
      note={<>Every joiner is on exactly one onboarding template, so moving someone here takes them off the one they are on. Steps they have done stay done; their open steps change to {name}’s: steps both templates have carry on, steps only {name} has are added and dated by its rules, and the rest are cancelled. Someone whose offer is not sent yet starts {name}’s tasks afresh.</>}
      removeBlocked={`A joiner is always on exactly one onboarding template, so nobody is removed from here. To take someone off ${name}, open the template they should be on and move them there in Edit joiners.`} />
  );
}
