import { StoreProvider, useStore } from './store';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginScreen } from './auth/LoginScreen';
import { Sidebar, Topbar, Toast } from './Chrome';
import { Overview } from './views/Overview';
import { LeaveRequests } from './views/LeaveRequests';
import { Overtime } from './views/Overtime';
import { Feedback } from './views/Feedback';
import { Reimbursements } from './views/Reimbursements';
import { Employees } from './views/Employees';
import { Placeholder } from './views/Placeholder';
import { Drawers } from './drawers';
import { Games } from './views/Games';
import { ContentReports } from './views/ContentReports';
import { PayHeadMaster } from './views/PayHeadMaster';
import { SalaryTemplates } from './views/SalaryTemplates';
import { StatutoryComponents } from './views/StatutoryComponents';
import { PayrollRuns } from './views/PayrollRuns';
import { PaySchedule, TaxDetails } from './views/OrgSetup';
import { ReimbursementTypes } from './views/ReimbursementTypes';
import { ReviewCycle } from './views/ReviewCycle';
import { ShiftBulkAssign } from './views/ShiftBulkAssign';
import { ShiftTemplates } from './views/ShiftTemplates';
import { HolidayBank } from './views/HolidayBank';
import { Policies } from './views/Policies';
import { Organisation } from './views/Organisation';
import { Departments } from './views/Departments';
import { Designations } from './views/Designations';
import { OrgChart } from './views/OrgChart';
import { Accesses } from './views/Accesses';
import { KpiParameters } from './views/KpiParameters';
import { KpiTemplates } from './views/KpiTemplates';
import { KpiBulkAssign } from './views/KpiBulkAssign';

function CurrentView() {
  const { view } = useStore();
  switch (view) {
    case 'organisation':
      return <Organisation />;
    case 'overview':
      return <Overview />;
    case 'leave':
      return <LeaveRequests />;
    case 'overtime':
      return <Overtime />;
    case 'kpi':
      return <KpiParameters />;
    case 'kpibulk':
      return <KpiBulkAssign />;
    case 'kpitemplates':
      return <KpiTemplates />;
    case 'feedback':
      return <Feedback />;
    case 'reimbursements':
      return <Reimbursements />;
    case 'departments':
      return <Departments />;
    case 'designations':
      return <Designations />;
    case 'employees':
      return <Employees />;
    case 'orgchart':
      return <OrgChart />;
    case 'usersroles':
      return <Accesses />;
    case 'reimbursementtypes':
      return <ReimbursementTypes />;
    case 'cycle':
      return <ReviewCycle />;
    case 'games':
      return <Games />;
    case 'contentreports':
      return <ContentReports />;
    case 'payheads':
      return <PayHeadMaster />;
    case 'templates':
      return <SalaryTemplates />;
    case 'statutorycomponents':
      return <StatutoryComponents />;
    case 'payruns':
      return <PayrollRuns />;
    case 'payschedule':
      return <PaySchedule />;
    case 'taxdetails':
      return <TaxDetails />;
    case 'shiftbulk':
      return <ShiftBulkAssign />;
    case 'shifttypes':
      return <ShiftTemplates />;
    case 'holidaybank':
      return <HolidayBank />;
    case 'policies':
      return <Policies />;
    default:
      return <Placeholder />;
  }
}

function LoadingBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: '#717171', fontSize: 16, fontWeight: 600 }}>
      <span style={{ width: 16, height: 16, border: '2px solid #EBEBEB', borderTopColor: '#0571A6', borderRadius: '50%', display: 'inline-block', marginRight: 10, animation: 'spin .7s linear infinite' }} />
      Loading…
    </div>
  );
}

function Shell() {
  const { loading, loaded } = useStore();
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', background: '#F7F7F9', overflow: 'hidden' }}>
      <Sidebar />
      <main className="scry" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        <div style={{ padding: '28px 34px 60px', flex: 1 }}>
          {loading && !loaded ? <LoadingBar /> : <CurrentView />}
        </div>
      </main>
      <Drawers />
      <Toast />
    </div>
  );
}

function AccessDenied() {
  const { user, signOut } = useAuth();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F7F7F9', color: '#484848', textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 50.5, marginBottom: 12 }}>🔒</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>No dashboard access</h1>
      <p style={{ maxWidth: 420, marginTop: 10, fontSize: 16, lineHeight: 1.5, color: '#717171' }}>
        Your account{user?.email ? ` (${user.email})` : ''} isn’t authorized to use the HR dashboard.
        Ask an administrator to grant you dashboard access.
      </p>
      <button
        onClick={() => void signOut()}
        style={{ marginTop: 22, padding: '10px 20px', borderRadius: 10, border: '1px solid #EBEBEB', background: '#fff', color: '#484848', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
      >
        Sign out
      </button>
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  if (!user) return <LoginScreen />;
  // Rule 4: the dashboard is only for select users granted dashboard access.
  if (!user.dashboardAccess) return <AccessDenied />;
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

export function HrDashboard() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
