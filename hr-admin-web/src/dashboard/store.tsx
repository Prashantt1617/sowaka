// Central state + handlers for the HR dashboard. Data is loaded from the
// live manager-scoped API and mutated through it (approve/decline).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { View, ReqStatus, FeedbackStatus } from './theme';
import { emptyForm } from './seed';
import type { Emp, FbEmp, Feedback, FbMgr, Leave, Overtime, Reimb, UserForm } from './seed';
import { adaptEmployees, adaptFeedbackList, adaptLeave, adaptOvertime, adaptReimb } from './adapters';
import {
  decideLeave,
  decideOvertime,
  decideReimb,
  createEmployee,
  getAllEmployees,
  getAllFeedback,
  getLeaveInbox,
  getOvertimeInbox,
  getReimbInbox,
} from '../services/hrms';
import type { EmployeeDTO, FeedbackDTO } from '../services/hrms';
import { getKpiCycle } from '../services/kpi';
import type { KpiCycleDTO } from '../services/kpi';
import { ApiError } from '../services/http';
import { useAuth } from './auth/AuthContext';

type LeaveStatusFilter = ReqStatus | 'all';
type FbStatusFilter = FeedbackStatus | 'all';

export type Store = ReturnType<typeof useProvideStore>;

const first = (name: string) => name.split(' ')[0];

function useProvideStore() {
  const { user, signOut } = useAuth();
  const managerName = user?.name ?? '';
  const currentUserId = user?.id ?? '';
  // Rule 8: a dashboard user cannot override a request they themselves submitted.
  const blockSelfOverride = (submitterId?: string): boolean => {
    if (submitterId && submitterId === currentUserId) {
      flash('You cannot override your own request');
      return true;
    }
    return false;
  };

  const [view, setViewRaw] = useState<View>('overview');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // leave
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveStatus, setLeaveStatus] = useState<LeaveStatusFilter>('all');
  const [leaveType, setLeaveType] = useState('all');
  const [leaveSort, setLeaveSort] = useState('recent');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveTo, setLeaveTo] = useState('');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineText, setDeclineText] = useState('');
  // leave override confirm modal (approve/decline + note)
  const [lvConfirm, setLvConfirm] = useState<{ id: string; action: 'approve' | 'decline' } | null>(null);
  const [lvNote, setLvNote] = useState('');

  // feedback
  const [fbs, setFbs] = useState<Feedback[]>([]);
  const [fbSearch, setFbSearch] = useState('');
  const [fbStatus, setFbStatus] = useState<FbStatusFilter>('all');
  const [fbDrawerId, setFbDrawerId] = useState<string | null>(null);
  const [fbMgrs, setFbMgrs] = useState<FbMgr[]>([]);
  const [fbFrom, setFbFrom] = useState('');
  const [fbTo, setFbTo] = useState('');
  // Roster-wide review state: the employee cards below the manager rollup.
  const [fbEmps, setFbEmps] = useState<FbEmp[]>([]);
  /**
   * The raw records behind the adapted view, kept so Performance Reviews can
   * re-derive any past cycle without another round trip — `getAllFeedback`
   * already returns every cycle, not just the live one.
   */
  const [fbRaw, setFbRaw] = useState<FeedbackDTO[]>([]);
  const [empRaw, setEmpRaw] = useState<EmployeeDTO[]>([]);
  const [fbEmpSearch, setFbEmpSearch] = useState('');
  /** Manager card currently drilled into — null shows the whole org. */
  const [fbMgrFilter, setFbMgrFilter] = useState<string | null>(null);
  /** Employee whose review card is open. */
  const [fbEmpId, setFbEmpId] = useState<string | null>(null);
  /**
   * The org's live review cycle, from the server.
   *
   * It depends on the company's configured start day, so the browser cannot
   * derive it — an org opening cycles on the 10th is in `2026-08` on 8 Sep.
   * Every KPI and feedback view reads this so they cannot disagree about which
   * cycle is live.
   *
   * Seeded with the calendar month so nothing has to handle null, but that seed
   * is a guess — on a 5th-of-month org it names the wrong dates. `cycleLoaded`
   * says whether the real one has arrived, and views wait on it rather than
   * showing the guess.
   */
  const [cycleLoaded, setCycleLoaded] = useState(false);
  const [cycle, setCycle] = useState<KpiCycleDTO>(() => {
    const period = new Date().toISOString().slice(0, 7);
    const [y, m] = period.split('-').map(Number);
    return {
      period,
      next: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7),
      startDay: 1,
      start: `${period}-01`,
      end: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
    };
  });

  // reimbursements
  const [rbs, setRbs] = useState<Reimb[]>([]);
  const [rbSearch, setRbSearch] = useState('');
  const [rbStatus, setRbStatus] = useState<LeaveStatusFilter>('all');
  const [rbType, setRbType] = useState('all');
  const [rbSort, setRbSort] = useState('recent');
  const [rbDrawerId, setRbDrawerId] = useState<string | null>(null);
  const [rbDeclineId, setRbDeclineId] = useState<string | null>(null);
  const [rbDeclineText, setRbDeclineText] = useState('');
  const [rbBillId, setRbBillId] = useState<string | null>(null);
  const [rbConfirm, setRbConfirm] = useState<{ id: string; action: 'approve' | 'decline' } | null>(null);
  const [rbNote, setRbNote] = useState('');
  const [rbFrom, setRbFrom] = useState('');
  const [rbTo, setRbTo] = useState('');

  // overtime
  const [ots, setOts] = useState<Overtime[]>([]);
  const [otSearch, setOtSearch] = useState('');
  const [otStatus, setOtStatus] = useState<LeaveStatusFilter>('all');
  const [otDrawerId, setOtDrawerId] = useState<string | null>(null);
  const [otDeclineId, setOtDeclineId] = useState<string | null>(null);
  const [otDeclineText, setOtDeclineText] = useState('');
  const [otFrom, setOtFrom] = useState('');
  const [otTo, setOtTo] = useState('');
  // overtime override confirm modal (approve/decline + note)
  const [otConfirm, setOtConfirm] = useState<{ id: string; action: 'approve' | 'decline' } | null>(null);
  const [otNote, setOtNote] = useState('');

  // employees
  const [emps, setEmps] = useState<Emp[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [empTeam, setEmpTeam] = useState('all');
  const [empDrawerId, setEmpDrawerId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        void signOut();
        return;
      }
      flash(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    },
    [flash, signOut],
  );

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [lv, ot, rb, fb, emp, live] = await Promise.all([
        getLeaveInbox(),
        getOvertimeInbox(),
        getReimbInbox(),
        getAllFeedback(),
        getAllEmployees(),
        getKpiCycle(),
      ]);
      setCycle(live);
      setCycleLoaded(true);
      setFbRaw(fb);
      setEmpRaw(emp);
      // Resolve each request's real manager (org-wide data spans many managers).
      const mgrByUser = new Map(emp.map((e) => [e.userId, e.managerName ?? '']));
      const mgrName = (userId: string) => mgrByUser.get(userId) || '—';
      setLeaves(lv.map((d) => adaptLeave(d, mgrName(d.userId))));
      setOts(ot.map((d) => adaptOvertime(d, mgrName(d.userId))));
      setRbs(rb.map((d) => adaptReimb(d, mgrName(d.userId))));
      const { fbs: fbRows, fbMgrs: fbManagers, fbEmps: fbEmployees } = adaptFeedbackList(fb, emp, live.period);
      setFbMgrs(fbManagers);
      setFbs(fbRows);
      setFbEmps(fbEmployees);
      setEmps(adaptEmployees(emp));
      setLoaded(true);
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  }, [user, handleError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const closeAllOverlays = () => {
    setDrawerId(null);
    setDeclineId(null);
    setFbDrawerId(null);
    setFbEmpId(null);
    setRbDrawerId(null);
    setRbDeclineId(null);
    setRbConfirm(null);
    setOtDrawerId(null);
    setOtConfirm(null);
    setLvConfirm(null);
    setEmpDrawerId(null);
    setAddOpen(false);
  };

  const setView = (v: View) => {
    closeAllOverlays();
    setViewRaw(v);
  };

  // ---- leave ----
  const approve = async (id: string) => {
    const r = leaves.find((l) => l.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setDrawerId(null);
    setDeclineId(null);
    try {
      const updated = await decideLeave(id, 'approved');
      setLeaves((s) => s.map((l) => (l.id === id ? adaptLeave(updated, r?.manager ?? managerName) : l)));
      flash(`${r ? first(r.name) : 'Leave'}’s leave approved`);
    } catch (e) {
      handleError(e);
    }
  };
  const openDecline = (id: string) => {
    setDeclineId(id);
    setDeclineText('');
  };
  const cancelDecline = () => {
    setDeclineId(null);
    setDeclineText('');
  };
  const confirmDecline = async (id: string) => {
    const txt = declineText.trim();
    const r = leaves.find((l) => l.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setDeclineId(null);
    setDeclineText('');
    setDrawerId(null);
    try {
      const updated = await decideLeave(id, 'declined', txt || undefined);
      setLeaves((s) => s.map((l) => (l.id === id ? adaptLeave(updated, r?.manager ?? managerName) : l)));
      flash(`${r ? first(r.name) : 'Leave'}’s leave declined`);
    } catch (e) {
      handleError(e);
    }
  };

  // Confirm modal for leave overrides — captures an optional note for why the
  // request was overridden, on BOTH approve and decline.
  const lvAsk = (id: string, action: 'approve' | 'decline') => {
    const r = leaves.find((l) => l.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setLvNote('');
    setLvConfirm({ id, action });
  };
  const lvCloseConfirm = () => setLvConfirm(null);
  const lvDecide = async () => {
    if (!lvConfirm) return;
    const { id, action } = lvConfirm;
    const r = leaves.find((l) => l.id === id);
    if (blockSelfOverride(r?.submitterId)) {
      setLvConfirm(null);
      return;
    }
    const note = lvNote.trim();
    setLvConfirm(null);
    setDrawerId(null);
    try {
      const updated = await decideLeave(id, action === 'approve' ? 'approved' : 'declined', note || undefined);
      setLeaves((s) => s.map((l) => (l.id === id ? adaptLeave(updated, r?.manager ?? managerName) : l)));
      flash(`${r ? first(r.name) : 'Leave'}’s leave ${action === 'approve' ? 'approved' : 'declined'}`);
    } catch (e) {
      handleError(e);
    }
  };

  // ---- reimbursements ----
  const rbApprove = async (id: string) => {
    const r = rbs.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setRbDrawerId(null);
    setRbDeclineId(null);
    setRbConfirm(null);
    try {
      const updated = await decideReimb(id, 'approved', rbNote.trim() || undefined);
      setRbs((s) => s.map((x) => (x.id === id ? adaptReimb(updated, r?.manager ?? managerName) : x)));
      flash(`${r ? first(r.name) : 'Claim'}’s claim approved`);
    } catch (e) {
      handleError(e);
    }
  };
  const rbOpenDecline = (id: string) => {
    setRbDeclineId(id);
    setRbDeclineText('');
  };
  const rbCancelDecline = () => {
    setRbDeclineId(null);
    setRbDeclineText('');
  };
  const rbConfirmDecline = async (id: string) => {
    const r = rbs.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setRbDeclineId(null);
    setRbDeclineText('');
    setRbDrawerId(null);
    setRbConfirm(null);
    try {
      const updated = await decideReimb(id, 'declined', rbNote.trim() || undefined);
      setRbs((s) => s.map((x) => (x.id === id ? adaptReimb(updated, r?.manager ?? managerName) : x)));
      flash(`${r ? first(r.name) : 'Claim'}’s claim declined`);
    } catch (e) {
      handleError(e);
    }
  };
  // open a confirmation screen before deciding a claim
  const rbAsk = (id: string, action: 'approve' | 'decline') => {
    const r = rbs.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setRbNote('');
    setRbConfirm({ id, action });
  };
  const rbCloseConfirm = () => setRbConfirm(null);

  // ---- feedback reminders (client-side — no backend reminder endpoint) ----
  const remindMgr = (id: string) => {
    const m = fbMgrs.find((x) => x.id === id);
    setFbMgrs((s) => s.map((x) => (x.id === id ? { ...x, reminded: true } : x)));
    flash(`Reminder sent to ${m ? first(m.name) : 'manager'}`);
  };
  const remindAll = () => {
    const pend = fbMgrs.filter((m) => m.done < m.total);
    setFbMgrs((s) => s.map((m) => (m.done < m.total ? { ...m, reminded: true } : m)));
    flash(`Reminder sent to ${pend.length} manager${pend.length === 1 ? '' : 's'}`);
  };

  // ---- overtime ----
  const otApprove = async (id: string) => {
    const r = ots.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setOtDrawerId(null);
    setOtDeclineId(null);
    try {
      const updated = await decideOvertime(id, 'approved');
      setOts((s) => s.map((x) => (x.id === id ? adaptOvertime(updated, r?.manager ?? managerName) : x)));
      flash(`${r ? first(r.name) : 'Overtime'}’s overtime approved`);
    } catch (e) {
      handleError(e);
    }
  };
  const otOpenDecline = (id: string) => {
    setOtDeclineId(id);
    setOtDeclineText('');
  };
  const otCancelDecline = () => {
    setOtDeclineId(null);
    setOtDeclineText('');
  };
  const otConfirmDecline = async (id: string) => {
    const r = ots.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    const note = otDeclineText.trim();
    setOtDeclineId(null);
    setOtDeclineText('');
    setOtDrawerId(null);
    try {
      const updated = await decideOvertime(id, 'declined', note || undefined);
      setOts((s) => s.map((x) => (x.id === id ? adaptOvertime(updated, r?.manager ?? managerName) : x)));
      flash(`${r ? first(r.name) : 'Overtime'}’s overtime declined`);
    } catch (e) {
      handleError(e);
    }
  };

  // Confirm modal for overtime overrides — captures an optional note on both
  // approve and decline.
  const otAsk = (id: string, action: 'approve' | 'decline') => {
    const r = ots.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) return;
    setOtNote('');
    setOtConfirm({ id, action });
  };
  const otCloseConfirm = () => setOtConfirm(null);
  const otDecide = async () => {
    if (!otConfirm) return;
    const { id, action } = otConfirm;
    const r = ots.find((x) => x.id === id);
    if (blockSelfOverride(r?.submitterId)) {
      setOtConfirm(null);
      return;
    }
    const note = otNote.trim();
    setOtConfirm(null);
    setOtDrawerId(null);
    try {
      const updated = await decideOvertime(id, action === 'approve' ? 'approved' : 'declined', note || undefined);
      setOts((s) => s.map((x) => (x.id === id ? adaptOvertime(updated, r?.manager ?? managerName) : x)));
      flash(`${r ? first(r.name) : 'Overtime'}’s overtime ${action === 'approve' ? 'approved' : 'declined'}`);
    } catch (e) {
      handleError(e);
    }
  };

  // ---- employees ----
  const setFormField = (k: keyof UserForm, v: string) => setForm((s) => ({ ...s, [k]: v }));
  const saveUser = async () => {
    const f = form;
    if (!f.name.trim()) {
      flash('Please enter a name');
      return;
    }
    if (!f.email.trim()) { flash('Please enter a work email'); return; }
    try {
      const manager = emps.find((employee) => employee.name === f.manager);
      await createEmployee({
        name: f.name.trim(), email: f.email.trim(), designation: f.role.trim() || undefined,
        department: f.team, location: f.location,
        employeeType: f.empType === 'Contract' ? 'contract' : f.empType === 'Intern' ? 'intern' : 'full_time',
        managerUserId: manager?.id, birthday: f.dob || undefined, joiningDate: f.joining || undefined,
      });
      const refreshed = await getAllEmployees();
      setEmps(adaptEmployees(refreshed));
      setAddOpen(false); setForm(emptyForm());
      flash(`${f.name.trim()} added and welcomed in Connect`);
    } catch (e) { handleError(e); }
  };

  // overview cross-navigation
  const goOvertimeRow = (id: string) => {
    closeAllOverlays();
    setViewRaw('overtime');
    setOtDrawerId(id);
  };
  const goReimbRow = (id: string) => {
    closeAllOverlays();
    setViewRaw('reimbursements');
    setRbDrawerId(id);
  };

  return {
    view, setView,
    toast, flash, loading, loaded, reload,
    user, signOut, currentUserId,
    // leave
    leaves, leaveSearch, setLeaveSearch, leaveStatus, setLeaveStatus, leaveType, setLeaveType,
    leaveSort, setLeaveSort, drawerId, setDrawerId, declineId, declineText, setDeclineText,
    approve, openDecline, cancelDecline, confirmDecline,
    leaveFrom, setLeaveFrom, leaveTo, setLeaveTo,
    lvConfirm, lvNote, setLvNote, lvAsk, lvCloseConfirm, lvDecide,
    // feedback
    fbs, fbSearch, setFbSearch, fbStatus, setFbStatus, fbDrawerId, setFbDrawerId, fbMgrs,
    remindMgr, remindAll, fbFrom, setFbFrom, fbTo, setFbTo,
    fbEmps, fbEmpSearch, setFbEmpSearch, fbMgrFilter, setFbMgrFilter, fbEmpId, setFbEmpId, cycle, cycleLoaded,
    fbRaw, empRaw,
    // reimbursements
    rbs, rbSearch, setRbSearch, rbStatus, setRbStatus, rbType, setRbType, rbSort, setRbSort,
    rbDrawerId, setRbDrawerId, rbDeclineId, rbDeclineText, setRbDeclineText,
    rbApprove, rbOpenDecline, rbCancelDecline, rbConfirmDecline,
    rbBillId, setRbBillId, rbConfirm, rbAsk, rbCloseConfirm, rbNote, setRbNote,
    rbFrom, setRbFrom, rbTo, setRbTo,
    // overtime
    ots, otSearch, setOtSearch, otStatus, setOtStatus, otDrawerId, setOtDrawerId,
    otDeclineId, otDeclineText, setOtDeclineText,
    otApprove, otOpenDecline, otCancelDecline, otConfirmDecline,
    otFrom, setOtFrom, otTo, setOtTo,
    otConfirm, otNote, setOtNote, otAsk, otCloseConfirm, otDecide,
    // employees
    emps, empSearch, setEmpSearch, empTeam, setEmpTeam, empDrawerId, setEmpDrawerId,
    addOpen, setAddOpen, form, setFormField, saveUser,
    // cross-nav
    goOvertimeRow, goReimbRow,
  };
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useProvideStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore must be used within StoreProvider');
  return s;
}
