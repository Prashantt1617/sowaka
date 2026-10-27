// Who sees what on whose profile. Anyone in the company sees a colleague's
// Attendance, Work detail, Org chart and Rank and nothing else; the viewer's own reports
// keep everything their profile has always shown; and a name tapped anywhere
// opens the right one through `openPersonProfile`. The tab a profile opens
// on — Post from the feed, Org chart from the Team tab or an org chart, Work
// detail otherwise — is the first in its bar, and the one shown.
//
// Screenshots of the opening tabs, when asked for:
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/profile_visibility_test.dart`
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
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

const _screenshots = String.fromEnvironment('SCREENSHOTS');

/// Rana's one post, for the Post tab.
const Map<String, dynamic> _ranaPost = {
  'id': 'p1',
  'type': 'new_post',
  'tag': 'Post',
  'author': {'userId': 'rana', 'name': 'Rana', 'initials': 'R'},
  'audience': {'label': 'Public'},
  'body': {'text': 'Lab results are in: the new batch passed every check.'},
  'liked': false,
  'likeCount': 3,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-24T06:00:00.000Z',
};

/// The shell, signed in as Pankaj. [phone] lays it out as the screenshots
/// are: 393x852 at 2x.
Future<ManagerBloc> boot(
  WidgetTester tester, {
  String? ownPhoto,
  bool phone = false,
}) async {
  tester.view.physicalSize = phone
      ? const Size(393 * 2, 852 * 2)
      : const Size(1179, 2556);
  tester.view.devicePixelRatio = phone ? 2 : 3;
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
  ConnectApiService.testClient = MockClient((request) async {
    final rana = request.url.path.endsWith('/connect/users/rana/posts');
    return ok({
      'posts': rana ? [_ranaPost] : <dynamic>[],
      'nextCursor': null,
      'total': rana ? 1 : 0,
    });
  });
  addTearDown(() => ConnectApiService.testClient = null);
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
    MaterialApp(
      debugShowCheckedModeBanner: false,
      home: ManagerScreen(session: session, bloc: bloc),
    ),
  );
  await tester.pumpAndSettle(const Duration(seconds: 1));
  return bloc;
}

Future<void> close(WidgetTester tester, ManagerBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
  // The shell's launch leaves time limits running (the notification
  // service's wait for its setup among them); they run out here rather than
  // outliving the test.
  await tester.pump(const Duration(seconds: 30));
}

/// The open profile's tab bar: its labels in order, and which one is shown.
({List<String> labels, int selected}) tabBar(WidgetTester tester) {
  final dynamic bar = tester.widget(
    find
        .byWidgetPredicate(
          (widget) => widget.runtimeType.toString() == '_ProfileTabs',
        )
        .last,
  );
  return (
    labels: List<String>.from(bar.labels as List),
    selected: bar.selected as int,
  );
}

Finder _avatar() => find
    .byWidgetPredicate(
      (widget) => widget.runtimeType.toString() == '_ProfileAvatarAction',
    )
    .first;

void main() {
  setUpAll(() async {
    for (final (family, file) in [
      ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
      (
        'Plus Jakarta Sans',
        'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
      ),
      // Text with no family of its own (the feed's cards) reads as words
      // in the screenshots rather than the test font's boxes.
      if (_screenshots.isNotEmpty)
        (
          'Roboto',
          'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
        ),
    ]) {
      await (FontLoader(family)..addFont(rootBundle.load(file))).load();
    }
  });

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

  group('the tab a profile opens on is first in its bar', () {
    test('by where it was opened from', () {
      expect(openingTabFor(ProfileEntry.feed), ProfileTab.posts);
      expect(openingTabFor(ProfileEntry.team), ProfileTab.orgChart);
      expect(openingTabFor(ProfileEntry.orgChart), ProfileTab.orgChart);
      expect(openingTabFor(ProfileEntry.elsewhere), isNull);
    });

    test('moved to the front, the rest in their usual order', () {
      final report = memberProfileTabs(
        inViewerChain: true,
        viewerCanManage: true,
        hasDocuments: true,
      );
      final own = ownProfileTabs(hasManager: true, showsHelp: true);
      for (final tabs in [colleagueProfileTabs, report, own]) {
        for (final entry in ProfileEntry.values) {
          final laidOut = profileTabsOpeningOn(tabs, openingTabFor(entry));
          expect(
            laidOut.first,
            openingTabFor(entry) ?? ProfileTab.workDetail,
            reason: '$entry',
          );
          expect(laidOut, hasLength(tabs.length), reason: '$entry');
          expect(laidOut.skip(1), [
            for (final tab in tabs)
              if (tab != laidOut.first) tab,
          ], reason: '$entry');
        }
      }
      expect(profileTabsOpeningOn(colleagueProfileTabs, ProfileTab.posts), [
        ProfileTab.posts,
        ProfileTab.workDetail,
        ProfileTab.attendance,
        ProfileTab.orgChart,
        ProfileTab.rank,
      ]);
      expect(profileTabsOpeningOn(own, ProfileTab.orgChart).take(3), [
        ProfileTab.orgChart,
        ProfileTab.workDetail,
        ProfileTab.request,
      ]);
      // A profile without the tab — no Post where there is no Connect —
      // keeps its usual order.
      final noPosts = [
        for (final tab in colleagueProfileTabs)
          if (tab != ProfileTab.posts) tab,
      ];
      expect(profileTabsOpeningOn(noPosts, ProfileTab.posts), noPosts);
    });

    testWidgets('a colleague from a post in the feed: Post first, shown', (
      tester,
    ) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('rana', from: ProfileEntry.feed), isTrue);
      // First and shown from the first frames, not once the posts load.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(tabBar(tester).labels.first, 'Post');
      expect(tabBar(tester).selected, 0);
      await tester.pumpAndSettle();
      final bar = tabBar(tester);
      expect(bar.labels, [
        'Post',
        'Work detail',
        'Attendance',
        'Org chart',
        'Rank',
      ]);
      expect(bar.selected, 0);
      expect(
        find.text('Lab results are in: the new batch passed every check.'),
        findsOneWidget,
      );
      await close(tester, bloc);
    });

    testWidgets('a report from an org chart: Org chart first, shown', (
      tester,
    ) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('haider', from: ProfileEntry.orgChart), isTrue);
      await tester.pumpAndSettle();
      final bar = tabBar(tester);
      expect(bar.labels.take(4), [
        'Org chart',
        'Work detail',
        'Request',
        'Attendance',
      ]);
      expect(bar.selected, 0);
      await close(tester, bloc);
    });

    testWidgets('someone from the Team tab: Org chart first, shown', (
      tester,
    ) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('rana', from: ProfileEntry.team), isTrue);
      await tester.pumpAndSettle();
      expect(tabBar(tester).labels.first, 'Org chart');
      expect(tabBar(tester).selected, 0);
      await close(tester, bloc);
    });

    testWidgets('a row tapped on the Team tab: Org chart first, own too', (
      tester,
    ) async {
      final bloc = await boot(tester);
      await bloc.add(const ChangeManagerTab(ManagerTab.manage));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Haider').first);
      await tester.pumpAndSettle();
      expect(find.text('Profile-Haider'), findsOneWidget);
      expect(tabBar(tester).labels.first, 'Org chart');
      expect(tabBar(tester).selected, 0);

      Navigator.of(tester.element(find.text('Profile-Haider'))).pop();
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('Pankaj').first);
      await tester.pumpAndSettle();
      expect(find.text('My Profile'), findsOneWidget);
      expect(tabBar(tester).labels.take(2), ['Org chart', 'Work detail']);
      expect(tabBar(tester).selected, 0);
      await close(tester, bloc);
    });

    testWidgets('anywhere else: Work detail first, as ever', (tester) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();
      expect(tabBar(tester).labels, [
        'Work detail',
        'Attendance',
        'Org chart',
        'Rank',
        'Post',
      ]);
      expect(tabBar(tester).selected, 0);
      await close(tester, bloc);
    });

    testWidgets('one\'s own from the avatar: Work detail first, shown', (
      tester,
    ) async {
      final bloc = await boot(tester);
      await tester.tap(_avatar());
      await tester.pumpAndSettle();
      expect(find.text('My Profile'), findsOneWidget);
      expect(tabBar(tester).labels.take(2), ['Work detail', 'Request']);
      expect(tabBar(tester).selected, 0);
      await close(tester, bloc);
    });

    testWidgets('one\'s own from the feed or an org chart: that tab first', (
      tester,
    ) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('pankaj', from: ProfileEntry.feed), isTrue);
      await tester.pumpAndSettle();
      expect(find.text('My Profile'), findsOneWidget);
      expect(tabBar(tester).labels.take(2), ['Post', 'Work detail']);
      expect(tabBar(tester).selected, 0);

      expect(openPersonProfile('pankaj', from: ProfileEntry.orgChart), isTrue);
      await tester.pumpAndSettle();
      expect(tabBar(tester).labels.take(2), ['Org chart', 'Work detail']);
      expect(tabBar(tester).selected, 0);
      await close(tester, bloc);
    });

    testWidgets('a tab tapped stays shown', (tester) async {
      final bloc = await boot(tester);
      expect(openPersonProfile('rana', from: ProfileEntry.feed), isTrue);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Rank'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Rank'));
      await tester.pumpAndSettle();
      final bar = tabBar(tester);
      expect(bar.labels.first, 'Post');
      expect(bar.labels[bar.selected], 'Rank');
      await close(tester, bloc);
    });
  });

  group('screenshots of the opening tab', skip: _screenshots.isEmpty, () {
    Future<void> capture(String name) => expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile(Uri.file('$_screenshots/$name.png')),
    );

    testWidgets('from a post in the feed', (tester) async {
      final bloc = await boot(tester, phone: true);
      openPersonProfile('rana', from: ProfileEntry.feed);
      await tester.pumpAndSettle();
      await capture('1-from-feed-post-first');
      await close(tester, bloc);
    });

    testWidgets('from an org chart', (tester) async {
      final bloc = await boot(tester, phone: true);
      openPersonProfile('haider', from: ProfileEntry.orgChart);
      await tester.pumpAndSettle();
      await capture('2-from-org-chart-org-chart-first');
      await close(tester, bloc);
    });

    testWidgets('one\'s own from the avatar', (tester) async {
      final bloc = await boot(tester, phone: true, ownPhoto: photo);
      await tester.tap(_avatar());
      await tester.pumpAndSettle();
      await capture('3-own-from-avatar-work-detail-first');
      await close(tester, bloc);
    });
  });

  testWidgets('nothing to open without a shell', (tester) async {
    expect(openPersonProfile('anyone'), isFalse);
  });
}
