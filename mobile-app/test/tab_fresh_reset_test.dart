// A tab picked from the bar opens in its default state, wherever it was left;
// a switch made for a notification keeps the page it was sent to.
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

ManagerBloc _bloc() {
  final session = AuthSession(
    token: 'token',
    user: const AuthUser(
      id: 'pankaj',
      email: 'pankaj@example.test',
      name: 'Pankaj',
      role: 'manager',
      company: 'Sowaka',
      org: 'sowaka',
    ),
  );
  return ManagerBloc(
    session: session,
    service: ManagerApiService(
      session: session,
      baseUrl: 'https://example.test',
      client: MockClient((_) async => http.Response('{"success":true}', 200)),
    ),
  );
}

void main() {
  test('from the bar, a tab starts over: Teams back on My Team, the tab rebuilt', () async {
    final bloc = _bloc();
    addTearDown(bloc.dispose);
    await bloc.add(const ChangeManagerTab(ManagerTab.manage));
    await bloc.add(const ShowTeamSection(TeamSection.requests));
    expect(bloc.state.teamSection, TeamSection.requests);
    final before = bloc.state.resetsOf(ManagerTab.manage);

    await bloc.add(const ChangeManagerTab(ManagerTab.connect, fresh: true));
    await bloc.add(const ChangeManagerTab(ManagerTab.manage, fresh: true));

    expect(bloc.state.tab, ManagerTab.manage);
    expect(bloc.state.teamSection, TeamSection.myTeam);
    expect(bloc.state.resetsOf(ManagerTab.manage), before + 1);
  });

  test('a switch for a notification keeps where it was sent', () async {
    final bloc = _bloc();
    addTearDown(bloc.dispose);
    await bloc.add(const ShowTeamSection(TeamSection.requests));
    final before = bloc.state.resetsOf(ManagerTab.manage);

    await bloc.add(const ChangeManagerTab(ManagerTab.manage));

    expect(bloc.state.teamSection, TeamSection.requests);
    expect(bloc.state.resetsOf(ManagerTab.manage), before);
  });
}
