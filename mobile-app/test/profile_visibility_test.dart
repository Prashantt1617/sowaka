// Who sees what on whose profile. Anyone in the company sees a colleague's
// Attendance, Work detail, Org chart and Rank and nothing else; the viewer's own reports
// keep everything their profile has always shown; and a name tapped anywhere
// opens the right one through `openPersonProfile`.
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
}) => {
  'userId': name.toLowerCase(),
  'name': name,
  'department': 'Faculty',
  'designation': 'Lecturer',
  'reportsToViewer': reportsToViewer,
  'inViewerChain': reportsToViewer,
  'isSelf': isSelf,
  'email': '${name.toLowerCase()}@example.test',
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

http.Response ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<ManagerBloc> boot(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final workspace = {
    'team': [
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
    'approverName': 'Demo Admin',
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
    if (request.url.path.endsWith('/profile/people/outsider')) {
      return ok({
        'person': {
          'userId': 'outsider',
          'name': 'Outsider Person',
          'department': 'Sales',
          'designation': 'Account Lead',
          // Even someone the server places below the viewer opens as the
          // colleague view when they are not in the viewer's own team.
          'inViewerChain': true,
          'email': 'outsider@example.test',
          'orgChart': <dynamic>[],
        },
      });
    }
    return http.Response('{"success":false}', 404);
  });
  addTearDown(() => ProfileApiService.testClient = null);
  const session = AuthSession(
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
    MaterialApp(home: ManagerScreen(session: session, bloc: bloc)),
  );
  await tester.pumpAndSettle(const Duration(seconds: 1));
  return bloc;
}

Future<void> close(WidgetTester tester, ManagerBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

void main() {
  group('which tabs a profile has', () {
    test('a colleague: attendance, work detail, org chart and rank', () {
      expect(colleagueProfileTabs, [
        ProfileTab.attendance,
        ProfileTab.workDetail,
        ProfileTab.orgChart,
        ProfileTab.rank,
      ]);
      expect(
        memberProfileTabs(
          inViewerChain: false,
          viewerCanManage: true,
          hasDocuments: true,
        ),
        colleagueProfileTabs,
      );
    });

    test('a report keeps everything it had, plus Rank', () {
      expect(
        memberProfileTabs(
          inViewerChain: true,
          viewerCanManage: true,
          hasDocuments: true,
        ),
        [
          ProfileTab.request,
          ProfileTab.attendance,
          ProfileTab.workDetail,
          ProfileTab.orgChart,
          ProfileTab.grow,
          ProfileTab.rank,
          ProfileTab.documentation,
        ],
      );
      // Requests only for a viewer who decides them; documents only when HR
      // has filed some.
      expect(
        memberProfileTabs(
          inViewerChain: true,
          viewerCanManage: false,
          hasDocuments: false,
        ),
        isNot(contains(ProfileTab.request)),
      );
      expect(
        memberProfileTabs(
          inViewerChain: true,
          viewerCanManage: true,
          hasDocuments: false,
        ),
        isNot(contains(ProfileTab.documentation)),
      );
    });

    test('one\'s own: Grow with a manager, the counsellor with Help', () {
      expect(
        ownProfileTabs(hasManager: false, showsHelp: false),
        isNot(contains(ProfileTab.grow)),
      );
      expect(
        ownProfileTabs(hasManager: true, showsHelp: true),
        containsAll([ProfileTab.grow, ProfileTab.counselor, ProfileTab.rank]),
      );
    });
  });

  testWidgets('a peer opens as the colleague view', (tester) async {
    final bloc = await boot(tester);
    expect(openPersonProfile('rana'), isTrue);
    await tester.pumpAndSettle();

    expect(find.text('Profile-Rana'), findsOneWidget);
    expect(find.text('Work detail'), findsOneWidget);
    expect(find.text('Org chart'), findsOneWidget);
    expect(find.text('Rank'), findsOneWidget);
    // The tab, and the open tab's own card under the same title.
    expect(find.text('Attendance'), findsWidgets);
    expect(find.text('Request'), findsNothing);
    expect(find.text('Documentation'), findsNothing);
    await close(tester, bloc);
  });

  testWidgets('a report keeps their full profile', (tester) async {
    final bloc = await boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();

    expect(find.text('Profile-Haider'), findsOneWidget);
    for (final label in ['Request', 'Attendance', 'Work detail', 'Org chart']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    await close(tester, bloc);
  });

  testWidgets('anyone else in the company is fetched, colleague tabs only', (
    tester,
  ) async {
    final bloc = await boot(tester);
    expect(openPersonProfile('outsider'), isTrue);
    await tester.pumpAndSettle();

    expect(find.text('Profile-Outsider'), findsOneWidget);
    expect(find.text('Outsider Person'), findsOneWidget);
    expect(find.text('Rank'), findsOneWidget);
    // The tab, and the open tab's own card under the same title.
    expect(find.text('Attendance'), findsWidgets);
    await close(tester, bloc);
  });

  testWidgets('one\'s own id opens one\'s own profile', (tester) async {
    final bloc = await boot(tester);
    expect(openPersonProfile('pankaj'), isTrue);
    await tester.pumpAndSettle();

    expect(find.text('My Profile'), findsOneWidget);
    await close(tester, bloc);
  });

  testWidgets('nothing to open without a shell', (tester) async {
    expect(openPersonProfile('anyone'), isFalse);
  });
}
