// One's own profile ends in a Settings tab (Figma 3857:82656): Privacy
// Policy, Blocked users, Log out and Delete my account. Log out asks first
// (3861:82911); the others open what they always did.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/presentation/blocked_people_screen.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/services/api_config.dart';

http.Response ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const session = AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'pankaj',
    email: 'pankaj@example.test',
    name: 'Pankaj',
    role: 'manager',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// The Settings tab on its own, with the sign-out and the browser stood in.
Future<({List<String> opened, List<int> signedOut})> pumpTab(
  WidgetTester tester, {
  bool linksOpen = true,
}) async {
  phone(tester);
  final opened = <String>[];
  final signedOut = <int>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ProfileSettingsTab(
          session: session,
          onLogOut: () async => signedOut.add(1),
          openLink: (url) async {
            opened.add(url);
            return linksOpen;
          },
        ),
      ),
    ),
  );
  return (opened: opened, signedOut: signedOut);
}

void main() {
  test('Settings is last on one\'s own profile and on nobody else\'s', () {
    expect(
      ownProfileTabs(hasManager: true, showsHelp: true).last,
      ProfileTab.settings,
    );
    expect(
      ownProfileTabs(hasManager: false, showsHelp: false).last,
      ProfileTab.settings,
    );
    for (final inChain in [true, false]) {
      expect(
        memberProfileTabs(
          inViewerChain: inChain,
          viewerCanManage: true,
          hasDocuments: true,
        ),
        isNot(contains(ProfileTab.settings)),
      );
    }
  });

  testWidgets('own profile: Settings shows the four rows, and log out asks', (
    tester,
  ) async {
    phone(tester);
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/manager/workspace')) {
        return ok({
          'team': <dynamic>[],
          'recognitionCandidates': <dynamic>[],
          'nominations': <dynamic>[],
          'myParameters': <dynamic>[],
          'growthHistory': <dynamic>[],
          'holidays': <dynamic>[],
          'myOrgChart': <dynamic>[],
          'weekoffDays': [0],
          'shift': <String, dynamic>{},
          'hasManager': true,
          'teamLevel': 2,
        });
      }
      return ok({
        'leaves': <dynamic>[],
        'overtime': <dynamic>[],
        'regularizations': <dynamic>[],
        'claims': <dynamic>[],
        'types': <dynamic>[],
        'records': <dynamic>[],
        'balance': <String, dynamic>{},
      });
    });
    final bloc = ManagerBloc(
      session: session,
      service: ManagerApiService(
        session: session,
        baseUrl: 'https://example.test',
        client: client,
      ),
    );
    await bloc.add(const LoadManagerDashboard());
    await tester.pumpWidget(
      MaterialApp(
        home: ManagerScreen(session: session, bloc: bloc),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 1));
    await tester.tap(
      find
          .byWidgetPredicate(
            (widget) => widget.runtimeType.toString() == '_ProfileAvatarAction',
          )
          .first,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('profile-screen')), findsOneWidget);

    // Last in a row that scrolls.
    await tester.dragUntilVisible(
      find.text('Settings'),
      find.text('Work detail'),
      const Offset(-200, 0),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    for (final label in [
      'Privacy Policy',
      'Blocked users',
      'Log out',
      'Delete my account',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    // Settings carries what the footer under every tab used to.
    expect(find.byKey(const ValueKey('profile-logout')), findsNothing);
    expect(find.text('Privacy policy'), findsNothing);
    expect(find.text('Blocked people'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('profile-settings-logout')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('logout-dialog')), findsOneWidget);
    expect(find.text('Are you sure you want to log out?'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('logout-cancel')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('logout-dialog')), findsNothing);
    expect(find.byKey(const ValueKey('profile-screen')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
  });

  testWidgets('Log out: Cancel keeps them signed in, Log Out signs out', (
    tester,
  ) async {
    final calls = await pumpTab(tester);

    await tester.tap(find.byKey(const ValueKey('profile-settings-logout')));
    await tester.pumpAndSettle();
    expect(find.byType(LogOutDialog), findsOneWidget);
    expect(find.text('Log Out'), findsNWidgets(2)); // title and button
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.byType(LogOutDialog), findsNothing);
    expect(calls.signedOut, isEmpty);

    await tester.tap(find.byKey(const ValueKey('profile-settings-logout')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('logout-confirm')));
    await tester.pumpAndSettle();
    expect(find.byType(LogOutDialog), findsNothing);
    expect(calls.signedOut, hasLength(1));
  });

  testWidgets('Privacy Policy and Delete my account open their pages', (
    tester,
  ) async {
    final calls = await pumpTab(tester);

    await tester.tap(find.text('Privacy Policy'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();

    expect(calls.opened, [
      ApiConfig.privacyPolicyUrl,
      ApiConfig.dataDeletionUrl,
    ]);
    expect(find.text('Sowaka data and privacy'), findsNothing);
  });

  testWidgets('with no browser, the data and privacy sheet shows instead', (
    tester,
  ) async {
    await pumpTab(tester, linksOpen: false);

    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();

    expect(find.text('Sowaka data and privacy'), findsOneWidget);
    expect(find.text('Deleting your account'), findsOneWidget);
  });

  testWidgets('Blocked users opens the blocked people list', (tester) async {
    await pumpTab(tester);

    await tester.tap(find.text('Blocked users'));
    await tester.pumpAndSettle();

    expect(find.byType(BlockedPeopleScreen), findsOneWidget);
  });
}
