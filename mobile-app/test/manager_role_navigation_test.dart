import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

void main() {
  test('an employee opens on Grow but may still browse Team', () {
    final bloc = ManagerBloc(session: _session('employee'));

    // Team is open to everyone — an individual contributor sees the same list
    // read-only, with no requests segment and no decisions — so the tab is
    // selectable even though nothing on it can be managed.
    expect(bloc.state.canManage, isFalse);
    expect(bloc.state.tab, ManagerTab.grow);

    bloc.add(const ChangeManagerTab(ManagerTab.manage));
    expect(bloc.state.tab, ManagerTab.manage);
    expect(bloc.state.canManage, isFalse);

    bloc.dispose();
  });

  test('manager starts on Manage', () {
    final bloc = ManagerBloc(session: _session('manager'));

    expect(bloc.state.canManage, isTrue);
    expect(bloc.state.tab, ManagerTab.manage);

    bloc.dispose();
  });

  test('manager request queues open and return to the action hub', () async {
    final bloc = ManagerBloc(session: _session('manager'));

    bloc.add(const OpenLeaveRequests());
    await Future<void>.delayed(Duration.zero);
    expect(bloc.state.view, ManagerView.leaveRequests);

    bloc.add(const CloseLeaveRequests());
    await Future<void>.delayed(Duration.zero);
    expect(bloc.state.view, ManagerView.home);

    bloc.add(const OpenOvertimeRequests());
    await Future<void>.delayed(Duration.zero);
    expect(bloc.state.view, ManagerView.overtimeRequests);

    bloc.add(const CloseOvertimeRequests());
    await Future<void>.delayed(Duration.zero);
    expect(bloc.state.view, ManagerView.home);

    bloc.dispose();
  });
}

AuthSession _session(String role) {
  return AuthSession(
    token: 'token',
    user: AuthUser(
      id: 'user-id',
      email: 'user@example.com',
      name: 'Test User',
      role: role,
      company: 'Sowaka',
    ),
  );
}
