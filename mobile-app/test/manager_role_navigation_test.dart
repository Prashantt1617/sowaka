import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

void main() {
  test('an employee opens on Connect but may still browse Team', () {
    final bloc = ManagerBloc(session: _session('employee'));

    // Team is open to everyone — an individual contributor sees the same list
    // read-only, with no requests segment and no decisions — so the tab is
    // selectable even though nothing on it can be managed.
    expect(bloc.state.canManage, isFalse);
    // Everyone lands on Connect, whatever their role.
    expect(bloc.state.tab, ManagerTab.connect);

    bloc.add(const ChangeManagerTab(ManagerTab.manage));
    expect(bloc.state.tab, ManagerTab.manage);
    expect(bloc.state.canManage, isFalse);

    bloc.dispose();
  });

  test('a manager also opens on Connect, and can manage', () {
    final bloc = ManagerBloc(session: _session('manager'));

    expect(bloc.state.canManage, isTrue);
    expect(bloc.state.tab, ManagerTab.connect);

    bloc.dispose();
  });

  test('the Team tab opens on the request queue and returns to the team', () async {
    final bloc = ManagerBloc(session: _session('manager'));

    bloc.add(const ShowTeamSection(TeamSection.requests));
    await Future<void>.delayed(Duration.zero);
    expect(bloc.state.teamSection, TeamSection.requests);
    expect(bloc.state.view, ManagerView.home);

    bloc.add(const ShowTeamSection(TeamSection.myTeam));
    await Future<void>.delayed(Duration.zero);
    expect(bloc.state.teamSection, TeamSection.myTeam);

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
