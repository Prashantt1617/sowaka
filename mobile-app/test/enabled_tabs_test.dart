// Which tabs a person sees is the company's decision, sent at sign-in. The
// app draws that list and nothing else, and a company that was never given a
// list gets the four the app has always had.
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';

void main() {
  test('a full list maps to tabs in the order given', () {
    expect(visibleTabs(['connect', 'team', 'grow', 'actions', 'care', 'talk']), [
      ManagerTab.connect,
      ManagerTab.manage,
      ManagerTab.grow,
      ManagerTab.quick,
      ManagerTab.care,
      ManagerTab.talk,
    ]);
  });

  test('no list means the four the app has always had', () {
    expect(visibleTabs(const []), [
      ManagerTab.connect,
      ManagerTab.manage,
      ManagerTab.grow,
      ManagerTab.quick,
    ]);
  });

  test('unknown keys are skipped, and a list of only unknowns falls back', () {
    expect(visibleTabs(['talk', 'payroll', 'connect']), [
      ManagerTab.talk,
      ManagerTab.connect,
    ]);
    expect(visibleTabs(['payroll']), visibleTabs(const []));
  });

  test('a key is not drawn twice', () {
    expect(visibleTabs(['talk', 'talk', 'Talk ']), [ManagerTab.talk]);
  });

  test('the tab list survives the session round trip', () {
    final user = AuthUser.fromJson({
      'id': 'u1',
      'email': 'priya@toyota.in',
      'name': 'Priya',
      'role': 'employee',
      'company': 'Toyota',
      'org': 'toyota',
      'enabledTabs': ['connect', 'talk'],
    });
    final again = AuthUser.fromJson(user.toJson());
    expect(again.enabledTabs, ['connect', 'talk']);
    expect(user.copyWith(interests: const ['x']).enabledTabs, ['connect', 'talk']);
  });

  test('the app opens on the first tab the company shows', () {
    final session = AuthSession(
      token: 't',
      user: const AuthUser(
        id: 'u1',
        email: 'priya@toyota.in',
        name: 'Priya',
        role: 'employee',
        company: 'Toyota',
        org: 'toyota',
        enabledTabs: ['talk', 'connect'],
      ),
    );
    final bloc = ManagerBloc(session: session);
    expect(bloc.state.tab, ManagerTab.talk);
    bloc.dispose();
  });
}
