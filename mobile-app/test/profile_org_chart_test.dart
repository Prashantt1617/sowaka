// The Org chart on a profile is the Team tab's team: on one's own, the same
// people the Team tab shows; on anyone else's, their manager, them, their
// peers and their reports, fetched for them. Everyone on it opens their own
// profile, which shows what it always has.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/profile/profile.dart';

Map<String, dynamic> member(
  String name, {
  bool reportsToViewer = false,
  bool isSelf = false,
  bool isManager = false,
}) => {
  'userId': name.toLowerCase(),
  'name': name,
  'department': 'Faculty',
  'designation': 'Lecturer',
  'reportsToViewer': reportsToViewer,
  'inViewerChain': reportsToViewer,
  'isSelf': isSelf,
  'isManager': isManager,
  'email': '${name.toLowerCase()}@example.test',
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

Map<String, dynamic> person(
  String userId,
  String name, {
  List<dynamic>? orgChart,
}) => {
  'userId': userId,
  'name': name,
  'department': 'Sales',
  'designation': 'Account Lead',
  'email': '$userId@example.test',
  'orgChart': orgChart ?? <dynamic>[],
};

http.Response ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// Signs Pankaj in: Meera is his manager, Rana his peer, Haider reports to
/// him. [team] answers `/profile/people/outsider/team`; null is a server from
/// before that route.
Future<ManagerBloc> boot(
  WidgetTester tester, {
  List<Map<String, dynamic>>? team,
}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final workspace = {
    'team': [
      member('Meera', isManager: true),
      member('Pankaj', isSelf: true),
      member('Haider', reportsToViewer: true),
      member('Rana'),
    ],
    'recognitionCandidates': <dynamic>[],
    'nominations': <dynamic>[],
    'myParameters': <dynamic>[],
    'growthHistory': <dynamic>[],
    'holidays': <dynamic>[],
    'myOrgChart': <dynamic>[],
    'weekoffDays': [0],
    'shift': <String, dynamic>{},
    'approverName': 'Meera',
    'hasManager': true,
    'teamLevel': 2,
  };
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/manager/workspace')) return ok(workspace);
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
  ProfileApiService.testClient = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/profile/people/outsider/team')) {
      if (team == null) {
        return http.Response(
          '{"success":false,"message":"Route not found"}',
          404,
        );
      }
      return ok({'team': team});
    }
    if (path.endsWith('/profile/people/outsider')) {
      return ok({
        'person': person(
          'outsider',
          'Outsider Person',
          orgChart: [
            {'userId': 'chief', 'name': 'Chief', 'designation': 'CEO'},
            {'userId': 'boss', 'name': 'Boss', 'designation': 'Head of Sales'},
            {'userId': 'outsider', 'name': 'Outsider Person', 'isSelf': true},
            {
              'userId': 'kid',
              'name': 'Kid',
              'designation': 'Intern',
              'isReport': true,
            },
          ],
        ),
      });
    }
    if (path.endsWith('/profile/people/boss')) {
      return ok({'person': person('boss', 'Boss')});
    }
    return http.Response('{"success":false}', 404);
  });
  addTearDown(() => ProfileApiService.testClient = null);
  final session = AuthSession(
    token: 'token',
    user: AuthUser(
      id: 'pankaj',
      email: 'pankaj@example.test',
      name: 'Pankaj',
      role: 'manager',
      company: 'ACMT',
      org: 'acmt',
    ),
  );
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
  return bloc;
}

Future<void> openOrgChart(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Org chart'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Org chart'));
  await tester.pumpAndSettle();
}

Future<void> close(WidgetTester tester, ManagerBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
  // The shell's bounded start-up calls leave their time limits running.
  await tester.pump(const Duration(minutes: 1));
}

void main() {
  testWidgets('one\'s own Org chart is the Team tab\'s team', (tester) async {
    final bloc = await boot(tester);
    expect(openPersonProfile('pankaj'), isTrue);
    await tester.pumpAndSettle();
    await openOrgChart(tester);

    // Pankaj leads Haider, so — as on the Team tab — the team he belongs to
    // is a card of faces, and his reports hang under Direct Reports.
    expect(find.text('My Team'), findsOneWidget);
    expect(find.text('Direct Reports'), findsOneWidget);
    expect(find.text('Pankaj (You)'), findsOneWidget);
    expect(find.text('Haider'), findsOneWidget);
    expect(find.text('Meera (Manager)'), findsNothing);

    await tester.tap(find.text('My Team'));
    await tester.pumpAndSettle();
    expect(find.text('Meera (Manager)'), findsOneWidget);
    expect(find.text('Rana'), findsOneWidget);

    // A report on it opens their full profile, as from the Team tab.
    await tester.ensureVisible(find.text('Haider'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Haider'));
    await tester.pumpAndSettle();
    expect(find.text('Profile-Haider'), findsOneWidget);
    expect(find.text('Request'), findsOneWidget);
    await close(tester, bloc);
  });

  testWidgets(
    'a colleague\'s Org chart is their team, and opens anyone on it',
    (tester) async {
      final bloc = await boot(
        tester,
        team: [
          {
            ...person('boss', 'Boss'),
            'designation': 'Head of Sales',
            'role': 'manager',
          },
          {...person('outsider', 'Outsider Person'), 'role': 'self'},
          {...person('pankaj', 'Pankaj'), 'role': 'peer'},
          {...person('sam', 'Sam'), 'role': 'peer'},
        ],
      );
      expect(openPersonProfile('outsider'), isTrue);
      await tester.pumpAndSettle();
      await openOrgChart(tester);

      expect(find.text("Outsider's Team"), findsOneWidget);
      expect(find.text('Boss (Manager)'), findsOneWidget);
      expect(find.text('Outsider Person'), findsWidgets);
      expect(find.text('Sam'), findsOneWidget);
      // The viewer, when they are on it, is "(You)".
      expect(find.text('Pankaj (You)'), findsOneWidget);

      await tester.tap(find.text('Boss (Manager)'));
      await tester.pumpAndSettle();
      expect(find.text('Profile-Boss'), findsOneWidget);
      // Still the colleague view: nothing more than it always showed.
      expect(find.text('Request'), findsNothing);
      await close(tester, bloc);
    },
  );

  testWidgets('an older server: drawn from the reporting line', (tester) async {
    final bloc = await boot(tester);
    expect(openPersonProfile('outsider'), isTrue);
    await tester.pumpAndSettle();
    await openOrgChart(tester);

    // Their manager heads their team; the chain above them is not part of it.
    expect(find.text('Boss (Manager)'), findsNothing);
    expect(find.text("Outsider's Team"), findsOneWidget);
    expect(find.text('Direct Reports'), findsOneWidget);
    expect(find.text('Kid'), findsOneWidget);
    expect(find.text('Chief'), findsNothing);
    await tester.tap(find.text("Outsider's Team"));
    await tester.pumpAndSettle();
    expect(find.text('Boss (Manager)'), findsOneWidget);
    await close(tester, bloc);
  });
}
