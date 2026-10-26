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
import 'package:mobile_app/features/shared/photo_viewer.dart';

/// A 1x1 PNG, as a `data:` photo: no network in a test.
const photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

Map<String, dynamic> member(
  String name, {
  bool reportsToViewer = false,
  bool isSelf = false,
  String? photoUrl,
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
  'photoUrl': ?photoUrl,
};

http.Response ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<ManagerBloc> boot(WidgetTester tester, {String? ownPhoto}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final workspace = {
    'team': [
      member('Pankaj', isSelf: true),
      member('Haider', reportsToViewer: true),
      member('Rana', photoUrl: photo),
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
  final session = AuthSession(
    token: 'token',
    user: AuthUser(
      id: 'pankaj',
      email: 'pankaj@example.test',
      name: 'Pankaj',
      role: 'manager',
      company: 'ACMT',
      org: 'acmt',
      employeeId: 'AC042',
      employmentType: 'full_time',
      profilePhotoUrl: ownPhoto,
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
    test('a colleague: attendance, work detail, org chart, rank and posts', () {
      expect(colleagueProfileTabs, [
        ProfileTab.workDetail,
        ProfileTab.attendance,
        ProfileTab.orgChart,
        ProfileTab.rank,
        ProfileTab.posts,
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

    test('a report keeps everything it had, plus Rank and Post', () {
      expect(
        memberProfileTabs(
          inViewerChain: true,
          viewerCanManage: true,
          hasDocuments: true,
        ),
        [
          ProfileTab.workDetail,
          ProfileTab.request,
          ProfileTab.attendance,
          ProfileTab.orgChart,
          ProfileTab.grow,
          ProfileTab.rank,
          ProfileTab.posts,
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

  testWidgets('one\'s own work detail has the employee ID and type', (
    tester,
  ) async {
    final bloc = await boot(tester);
    await tester.tap(
      find
          .byWidgetPredicate(
            (widget) => widget.runtimeType.toString() == '_ProfileAvatarAction',
          )
          .first,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('profile-screen')), findsOneWidget);
    // The tab row sits under the pinned header until the page scrolls.
    await tester.ensureVisible(find.text('Work detail'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Work detail'));
    await tester.pumpAndSettle();

    expect(find.text('Employee ID'), findsOneWidget);
    expect(find.text('AC042'), findsOneWidget);
    expect(find.text('Employment Type'), findsOneWidget);
    await close(tester, bloc);
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

  group('the profile photo, full screen with pinch to zoom', () {
    testWidgets('a colleague\'s photo opens, zooms and closes', (tester) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('profile-photo')));
      await tester.pumpAndSettle();
      expect(find.byType(PhotoViewer), findsOneWidget);
      final zoom = tester.widget<InteractiveViewer>(
        find.byKey(const ValueKey('photo-viewer-zoom')),
      );
      expect(zoom.minScale, 1);
      expect(zoom.maxScale, 4);
      expect(find.bySemanticsLabel("Rana's photo"), findsOneWidget);

      // A double tap zooms in, another back out.
      final surface = find.byKey(const ValueKey('photo-viewer-surface'));
      Future<void> doubleTap() async {
        await tester.tap(surface);
        await tester.pump(const Duration(milliseconds: 50));
        await tester.tap(surface);
        await tester.pumpAndSettle();
      }

      await doubleTap();
      expect(zoom.transformationController!.value.getMaxScaleOnAxis(), 2.5);
      await doubleTap();
      expect(zoom.transformationController!.value.getMaxScaleOnAxis(), 1);

      // Two fingers pinch it bigger.
      final centre = tester.getCenter(surface);
      final a = await tester.startGesture(centre - const Offset(40, 0));
      final b = await tester.startGesture(
        centre + const Offset(40, 0),
        pointer: 2,
      );
      await tester.pump();
      for (var i = 0; i < 6; i++) {
        await a.moveBy(const Offset(-10, 0));
        await b.moveBy(const Offset(10, 0));
        await tester.pump();
      }
      await a.up();
      await b.up();
      await tester.pumpAndSettle();
      expect(
        zoom.transformationController!.value.getMaxScaleOnAxis(),
        greaterThan(1.5),
      );

      await tester.tap(find.byKey(const ValueKey('photo-viewer-close')));
      await tester.pumpAndSettle();
      expect(find.byType(PhotoViewer), findsNothing);
      expect(find.text('Profile-Rana'), findsOneWidget);
      await close(tester, bloc);
    });

    testWidgets('someone with no photo has nothing to open', (tester) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('haider'), isTrue);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('profile-photo')), findsNothing);
      await close(tester, bloc);
    });

    testWidgets('one\'s own photo opens too, with Change photo there', (
      tester,
    ) async {
      final bloc = await boot(tester, ownPhoto: photo);
      expect(openPersonProfile('pankaj'), isTrue);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('own-profile-photo')));
      await tester.pumpAndSettle();
      expect(find.byType(PhotoViewer), findsOneWidget);
      expect(find.byKey(const ValueKey('photo-viewer-change')), findsOneWidget);
      expect(find.text('Change photo'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('photo-viewer-close')));
      await tester.pumpAndSettle();
      expect(find.byType(PhotoViewer), findsNothing);
      expect(find.text('My Profile'), findsOneWidget);
      await close(tester, bloc);
    });
  });

  testWidgets('nothing to open without a shell', (tester) async {
    expect(openPersonProfile('anyone'), isFalse);
  });
}
