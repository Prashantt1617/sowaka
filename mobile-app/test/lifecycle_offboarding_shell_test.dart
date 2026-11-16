// Where offboarding sits in the signed-in app: the Resign row at the bottom
// of one's own Work detail and the Resignation tab on one's own profile; the
// Off-boarding tile in the Action tab; a report's resignation in Team ›
// Requests (counted in its badge) and the Resignation tab on their profile.
// None of it shows while the lifecycle is off. All people are fictional.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_offboarding_fake.dart';

Map<String, dynamic> member({
  required String userId,
  required String name,
  bool reportsToViewer = false,
  bool isSelf = false,
  bool isManager = false,
}) => {
  'userId': userId,
  'name': name,
  'department': 'Design',
  'designation': 'Design Lead',
  'reportsToViewer': reportsToViewer,
  'isSelf': isSelf,
  'isManager': isManager,
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

http.Client workspace(List<Map<String, dynamic>> team) =>
    MockClient((request) async {
      if (request.url.path.endsWith('/manager/workspace')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'team': team,
            'recognitionCandidates': <dynamic>[],
            'nominations': <dynamic>[],
            'recognitionHistory': <dynamic>[],
            'myParameters': <dynamic>[],
            'growthHistory': <dynamic>[],
            'holidays': <dynamic>[],
            'myOrgChart': <dynamic>[],
            'weekoffDays': [0],
            'shift': <String, dynamic>{},
            'hasManager': true,
            'teamLevel': 2,
            'managerScore': 0,
          }),
          200,
        );
      }
      return http.Response(
        jsonEncode({
          'success': true,
          'leaves': <dynamic>[],
          'overtime': <dynamic>[],
          'regularizations': <dynamic>[],
          'claims': <dynamic>[],
          'types': <dynamic>[],
          'records': <dynamic>[],
          'balance': <String, dynamic>{},
        }),
        200,
      );
    });

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(FakeLifecycle.uninstall);

  Future<ManagerBloc> pumpShell(
    WidgetTester tester,
    AuthSession session,
    List<Map<String, dynamic>> team, {
    double width = 393,
  }) async {
    // Team Requests is laid out for 480 in the test font, as its own tests do.
    tester.view.physicalSize = Size(width * 3, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final bloc = ManagerBloc(
      session: session,
      service: ManagerApiService(
        session: session,
        baseUrl: 'https://example.test',
        client: workspace(team),
      ),
    );
    await bloc.add(const LoadManagerDashboard());
    await tester.pumpWidget(
      MaterialApp(
        home: ManagerScreen(session: session, bloc: bloc),
      ),
    );
    await tester.pumpAndSettle(const Duration(seconds: 1));
    return bloc;
  }

  Future<void> finish(WidgetTester tester, ManagerBloc bloc) async {
    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
    await tester.pump(const Duration(seconds: 30));
  }

  Future<void> openOwnProfile(WidgetTester tester) async {
    await tester.tap(
      find
          .byWidgetPredicate(
            (widget) => widget.runtimeType.toString() == '_ProfileAvatarAction',
          )
          .first,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('profile-screen')), findsOneWidget);
  }

  final leaverTeam = [
    member(userId: 'meera', name: 'Meera Iyer', isManager: true),
    member(userId: 'ravi', name: 'Ravi Menon', isSelf: true),
  ];

  testWidgets(
    'own profile, lifecycle off: no Resign row and no Resignation tab',
    (tester) async {
      (FakeLifecycle()..enabled = false).install();
      final bloc = await pumpShell(tester, leaverSession, leaverTeam);
      await openOwnProfile(tester);
      expect(find.byKey(const ValueKey('resign-entry')), findsNothing);
      expect(find.text('Resignation'), findsNothing);
      await finish(tester, bloc);
    },
  );

  testWidgets(
    'own profile: Resign at the bottom of Work detail; after sending, the Resignation tab',
    (tester) async {
      final fake = FakeLifecycle()..install();
      final bloc = await pumpShell(tester, leaverSession, leaverTeam);
      await openOwnProfile(tester);
      final row = find.byKey(const ValueKey('resign-entry-row'));
      await tester.scrollUntilVisible(
        row,
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Start your resignation'), findsOneWidget);
      expect(find.text('Resignation'), findsNothing);

      await tester.tap(row);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('resign-reason')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('resign-reason-Relocation')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('resign-continue')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('resign-send')));
      await tester.pumpAndSettle();
      expect(fake.bodies['POST /lifecycle/resignation'], {
        'reason': 'Relocation',
      });

      // The profile opens on its new tab, which tracks it.
      expect(find.text('Resignation'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('resignation-tab-open')),
        findsOneWidget,
      );
      expect(find.text('With manager'), findsOneWidget);
      expect(find.byKey(const ValueKey('resign-entry')), findsNothing);
      await finish(tester, bloc);
    },
  );

  testWidgets(
    'Action tab: the Off-boarding tile while on notice opens the page',
    (tester) async {
      (FakeLifecycle()..onNotice()).install();
      final bloc = await pumpShell(tester, leaverSession, leaverTeam);
      bloc.add(const ChangeManagerTab(ManagerTab.quick));
      await tester.pumpAndSettle(const Duration(seconds: 1));
      final tile = find.byKey(const ValueKey('offboarding-card'));
      await tester.scrollUntilVisible(
        tile,
        200,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Off-boarding'), findsOneWidget);
      expect(find.text('Last day 31 Dec'), findsOneWidget);
      await tester.tap(tile);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('offboarding-page')), findsOneWidget);
      expect(find.text('Before you go'), findsOneWidget);
      await finish(tester, bloc);
    },
  );

  testWidgets('Action tab: no tile before HR accepts', (tester) async {
    final fake = FakeLifecycle()..resignation = reportResignation();
    fake.install();
    final bloc = await pumpShell(tester, leaverSession, leaverTeam);
    bloc.add(const ChangeManagerTab(ManagerTab.quick));
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(find.byKey(const ValueKey('offboarding-card')), findsNothing);
    await finish(tester, bloc);
  });

  final managerTeam = [
    member(userId: 'meera', name: 'Meera Iyer', isSelf: true),
    member(userId: 'ravi', name: 'Ravi Menon', reportsToViewer: true),
    member(userId: 'neha', name: 'Neha Joshi', reportsToViewer: true),
  ];

  testWidgets(
    'manager: the resignation in Requests, counted; the Resignation tab on the report only',
    (tester) async {
      final fake = FakeLifecycle()
        ..managerResignations.add(reportResignation());
      fake.install();
      final bloc = await pumpShell(
        tester,
        managerSession,
        managerTeam,
        width: 480,
      );
      bloc.add(const ChangeManagerTab(ManagerTab.manage));
      await tester.pumpAndSettle(const Duration(seconds: 1));

      await tester.tap(find.text('Ravi Menon').first);
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(find.text('Resignation'), findsOneWidget);
      // The bar scrolls: from the Team tab it opens on the org chart.
      await tester.dragUntilVisible(
        find.text('Resignation'),
        find.text('Work detail'),
        const Offset(-150, 0),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Resignation'));
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(find.byKey(const ValueKey('manager-leaver-tab')), findsOneWidget);
      expect(find.text('With manager'), findsOneWidget);
      Navigator.of(
        tester.element(find.byKey(const ValueKey('manager-leaver-tab'))),
      ).pop();
      await tester.pumpAndSettle();

      await tester.tap(find.text('Neha Joshi').first);
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(find.text('Resignation'), findsNothing);
      Navigator.of(tester.element(find.text('Neha Joshi').first)).pop();
      await tester.pumpAndSettle();

      bloc.add(const ShowTeamSection(TeamSection.requests));
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(find.text('Resignation · Ravi Menon'), findsOneWidget);
      expect(find.text('Reject'), findsNothing);
      // The badge beside Requests counts it.
      expect(find.text('1'), findsWidgets);
      expect(find.text('Currently you have no request'), findsNothing);
      await finish(tester, bloc);
    },
  );
}
