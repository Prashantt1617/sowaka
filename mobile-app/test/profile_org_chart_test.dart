// The Org chart on a profile: the person's manager on top, the person under
// them, and the people who report to the person under that — nothing else.
// On one's own the manager reads "(Manager)" and one's own card "(You)"; on
// someone else's their card is the highlighted one and the viewer, wherever
// they are on it, reads "(You)". Everyone on it opens their own profile.
//
// Screenshots of both:
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/profile_org_chart_test.dart`
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/profile/profile.dart';

const _screenshots = String.fromEnvironment('SCREENSHOTS');

const _brand = Color(0xFF0571A6);
const _personFill = Color(0xFFE5F5FD);

/// Who is who, as in the design's sample.
const _designations = {
  'harsh': 'Product Manager',
  'ananya': 'UX Researcher',
  'yami': 'Frontend Engineer',
  'ankit': 'Senior Product Designer',
  'sumit': 'QA Testing',
  'raghav': 'UI/UX Designer II',
  'shivani': 'Associate Product Designer',
  'priya': 'UX Writer',
  'meera': 'VP Product',
};

const _names = {
  'harsh': 'Harsh Choudhary',
  'ananya': 'Ananya Bisht',
  'yami': 'Yami Guri',
  'ankit': 'Ankit Tomar',
  'sumit': 'Sumit Rana',
  'raghav': 'Raghav Sharma',
  'shivani': 'Shivani Singh',
  'priya': 'Priya Nair',
  'meera': 'Meera Iyer',
};

const _reports = ['yami', 'ankit', 'sumit', 'raghav', 'shivani'];

/// Whether each is in today, for the dots: Harsh on leave, Sumit not in.
const _marks = {'harsh': 'leave', 'sumit': 'not_in', 'raghav': 'leave'};

/// A row of the viewer's own team, as `/manager/workspace` sends it.
Map<String, dynamic> member(
  String id, {
  bool reportsToViewer = false,
  bool isSelf = false,
  bool isManager = false,
  String? managerName,
}) => {
  'userId': id,
  'name': _names[id],
  'department': 'Product',
  'designation': _designations[id],
  'reportsToViewer': reportsToViewer,
  'inViewerChain': reportsToViewer,
  'isSelf': isSelf,
  'isManager': isManager,
  'managerName': managerName,
  'todayMark': _marks[id] ?? 'present',
  'todayStatus': _marks.containsKey(id) ? 'absent' : 'present',
  'email': '$id@example.test',
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

/// A row of `/profile/people/:userId/team`.
Map<String, dynamic> teamRow(String id, String role) => {
  'userId': id,
  'name': _names[id],
  'designation': _designations[id],
  'department': 'Product',
  'photoUrl': null,
  'role': role,
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

/// Signs [viewer] in with [team] as their own team. [personTeams] answers
/// `/profile/people/:userId/team`; anyone not in it gets a server from before
/// that route.
Future<ManagerBloc> boot(
  WidgetTester tester, {
  required String viewer,
  required List<Map<String, dynamic>> team,
  Map<String, List<Map<String, dynamic>>> personTeams = const {},
  String? managerName,
}) async {
  // A phone: 393 by 852 at 2x.
  tester.view.physicalSize = const Size(393 * 2, 852 * 2);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final workspace = {
    'team': team,
    'recognitionCandidates': <dynamic>[],
    'nominations': <dynamic>[],
    'myParameters': <dynamic>[],
    'growthHistory': <dynamic>[],
    'holidays': <dynamic>[],
    'myOrgChart': <dynamic>[],
    'weekoffDays': [0],
    'shift': <String, dynamic>{},
    'approverName': managerName,
    'hasManager': managerName != null,
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
    final teamOf = RegExp(r'/profile/people/([^/]+)/team$').firstMatch(path);
    if (teamOf != null) {
      final rows = personTeams[teamOf.group(1)];
      if (rows == null) {
        return http.Response(
          '{"success":false,"message":"Route not found"}',
          404,
        );
      }
      return ok({'team': rows});
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
    final someone = RegExp(
      r'/profile/people/([^/]+)$',
    ).firstMatch(path)?.group(1);
    if (_names[someone] case final name?) {
      return ok({'person': person(someone!, name)});
    }
    return http.Response('{"success":false}', 404);
  });
  addTearDown(() => ProfileApiService.testClient = null);
  final session = AuthSession(
    token: 'token',
    user: AuthUser(
      id: viewer,
      email: '$viewer@example.test',
      name: _names[viewer] ?? viewer,
      role: 'manager',
      company: 'Convrse',
      org: 'convrse',
      designation: _designations[viewer],
      department: 'Product',
      managerName: managerName,
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
      debugShowCheckedModeBanner: false,
      // The app's own type (main.dart), for the faces' initials.
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
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

/// The card's own decoration, nearest above [name].
BoxDecoration cardOf(WidgetTester tester, String name) {
  final ink = find.ancestor(of: find.text(name), matching: find.byType(Ink));
  return tester.widget<Ink>(ink.first).decoration! as BoxDecoration;
}

double leftOf(WidgetTester tester, String name) => tester
    .getTopLeft(
      find.ancestor(of: find.text(name), matching: find.byType(Ink)).first,
    )
    .dx;

/// The screen as it stands, and again scrolled to the end of the chart.
Future<void> capture(WidgetTester tester, String name, String last) async {
  if (_screenshots.isEmpty) return;
  final screen = find.byType(MaterialApp);
  // Let the header's logo and the faces finish loading.
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 300)),
  );
  await tester.pumpAndSettle();
  await expectLater(
    screen,
    matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
  );
  await tester.scrollUntilVisible(
    find.text(last),
    200,
    scrollable: find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .last,
  );
  await tester.drag(
    find
        .byWidgetPredicate(
          (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
        )
        .last,
    const Offset(0, -400),
  );
  await tester.pumpAndSettle();
  await expectLater(
    screen,
    matchesGoldenFile(Uri.file('$_screenshots/$name-scrolled.png')),
  );
}

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      (
        'Plus Jakarta Sans',
        'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
      ),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
  });

  testWidgets('one\'s own Org chart: the manager, you, and your reports', (
    tester,
  ) async {
    final bloc = await boot(
      tester,
      viewer: 'ananya',
      managerName: 'Harsh Choudhary',
      team: [
        member('harsh', isManager: true),
        member('ananya', isSelf: true),
        // A peer: on the Team tab, not on the Org chart.
        member('priya'),
        for (final id in _reports) member(id, reportsToViewer: true),
      ],
    );
    expect(openPersonProfile('ananya'), isTrue);
    await tester.pumpAndSettle();
    await openOrgChart(tester);

    expect(find.text('Harsh Choudhary (Manager)'), findsOneWidget);
    expect(find.text('Ananya Bisht (You)'), findsOneWidget);
    for (final id in _reports) {
      expect(find.text(_names[id]!), findsOneWidget);
    }
    // Nobody else: no peers, no team headings.
    expect(find.text('Priya Nair'), findsNothing);
    expect(find.text('My Team'), findsNothing);
    expect(find.text('Direct Reports'), findsNothing);

    // One's own card: white, ringed in the brand blue.
    final mine = cardOf(tester, 'Ananya Bisht (You)');
    expect(mine.color, Colors.white);
    expect((mine.border! as Border).top.color, _brand);
    expect(cardOf(tester, 'Harsh Choudhary (Manager)').border, isNull);
    // Each level indented under the one above.
    final manager = leftOf(tester, 'Harsh Choudhary (Manager)');
    final you = leftOf(tester, 'Ananya Bisht (You)');
    final report = leftOf(tester, 'Yami Guri');
    expect(you, greaterThan(manager));
    expect(report, greaterThan(you));
    expect(leftOf(tester, 'Shivani Singh'), report);

    await capture(tester, 'own-profile', 'Shivani Singh');

    // A report opens their own profile.
    await tester.ensureVisible(find.text('Yami Guri'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Yami Guri'));
    await tester.pumpAndSettle();
    expect(find.text('Profile-Yami'), findsOneWidget);
    await close(tester, bloc);
  });

  testWidgets(
    'someone else\'s Org chart: their manager, them highlighted, their reports',
    (tester) async {
      final bloc = await boot(
        tester,
        viewer: 'ankit',
        managerName: 'Ananya Bisht',
        team: [
          member('ananya', isManager: true, managerName: 'Harsh Choudhary'),
          member('ankit', isSelf: true),
          for (final id in _reports.where((id) => id != 'ankit')) member(id),
        ],
        personTeams: {
          'ananya': [
            teamRow('harsh', 'manager'),
            teamRow('ananya', 'self'),
            teamRow('priya', 'peer'),
            for (final id in _reports) teamRow(id, 'report'),
          ],
        },
      );
      expect(openPersonProfile('ananya'), isTrue);
      await tester.pumpAndSettle();
      await openOrgChart(tester);

      // Their manager, plain: "(Manager)" is one's own profile's word.
      expect(find.text('Harsh Choudhary'), findsOneWidget);
      expect(find.textContaining('(Manager)'), findsNothing);
      // The viewer among their reports.
      expect(find.text('Ankit Tomar (You)'), findsOneWidget);
      expect(find.text('Ananya Bisht (You)'), findsNothing);
      for (final id in _reports.where((id) => id != 'ankit')) {
        expect(find.text(_names[id]!), findsOneWidget);
      }
      // No peers, and nobody above the manager.
      expect(find.text('Priya Nair'), findsNothing);
      expect(find.text('Meera Iyer'), findsNothing);
      expect(find.text("Ananya's Team"), findsNothing);

      // Their card, filled pale blue and ringed; the viewer's own is plain.
      final theirs = tester
          .widgetList<Ink>(find.byType(Ink))
          .map((ink) => ink.decoration)
          .whereType<BoxDecoration>()
          .where((box) => box.color == _personFill)
          .toList();
      expect(theirs, hasLength(1));
      expect((theirs.single.border! as Border).top.color, _brand);
      expect(cardOf(tester, 'Ankit Tomar (You)').color, Colors.white);
      expect(cardOf(tester, 'Ankit Tomar (You)').border, isNull);

      await capture(tester, 'someone-elses-profile', 'Shivani Singh');

      // Their manager opens their own profile.
      await tester.ensureVisible(find.text('Harsh Choudhary'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Harsh Choudhary'));
      await tester.pumpAndSettle();
      expect(find.text('Profile-Harsh'), findsOneWidget);
      await close(tester, bloc);
    },
  );

  testWidgets('an older server: drawn from the reporting line', (tester) async {
    final bloc = await boot(
      tester,
      viewer: 'ananya',
      managerName: 'Harsh Choudhary',
      team: [member('harsh', isManager: true), member('ananya', isSelf: true)],
    );
    expect(openPersonProfile('outsider'), isTrue);
    await tester.pumpAndSettle();
    await openOrgChart(tester);

    // Their manager — the card above them on the line — and their report;
    // the chain above the manager is not part of it.
    expect(find.text('Boss'), findsOneWidget);
    expect(find.text('Kid'), findsOneWidget);
    expect(find.text('Chief'), findsNothing);
    expect(leftOf(tester, 'Kid'), greaterThan(leftOf(tester, 'Boss')));
    await close(tester, bloc);
  });
}
