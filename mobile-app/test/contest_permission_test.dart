// Contests are started from the Posts composer's Contest chip, and only by
// people granted it (`canCreateContests`), whatever tabs their company has.
// Without the grant the chip is simply not there: no disabled chip, no gap.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

AuthSession _session(
  List<String> enabledTabs, {
  required bool canCreateContests,
}) => AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: const [],
    enabledTabs: enabledTabs,
    canCreateContests: canCreateContests,
  ),
);

/// No live connection: a test that lets time pass would otherwise have the
/// real socket dialling out.
class _QuietSocket implements ConnectSocketService {
  @override
  Stream<ConnectChange> get changes => const Stream.empty();
  @override
  Stream<void> get reconnects => const Stream.empty();
  @override
  bool get isConnected => false;
  @override
  void connect() {}
  @override
  void dispose() {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The feed, empty, with a composer controller attached. [created] collects
/// what is posted to the server.
Future<(ConnectBloc, ConnectComposerController)> _pumpFeed(
  WidgetTester tester,
  AuthSession session, {
  List<Map<String, dynamic>>? created,
}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/connect/feed')) {
      return http.Response(
        jsonEncode({'success': true, 'posts': <dynamic>[]}),
        200,
      );
    }
    if (request.method == 'POST' &&
        request.url.path.endsWith('/connect/posts')) {
      final sent = jsonDecode(request.body) as Map<String, dynamic>;
      created?.add(sent);
      return http.Response(
        jsonEncode({
          'success': true,
          'post': {
            'id': 'new-contest',
            'type': sent['type'],
            'tag': 'Most Likely',
            'author': {'name': 'Viewer', 'initials': 'V'},
            'audience': <String, dynamic>{},
            'body': sent['body'],
            'likeCount': 0,
            'commentCount': 0,
            'comments': <dynamic>[],
            'publishedAt': '2026-10-10T06:00:00.000Z',
          },
        }),
        200,
      );
    }
    return http.Response(jsonEncode({'success': true}), 200);
  });
  final bloc = ConnectBloc(
    session: session,
    api: ConnectApiService(
      session: session,
      baseUrl: 'https://example.test',
      client: client,
    ),
    socket: _QuietSocket(),
  );
  await bloc.load();
  final controller = ConnectComposerController();
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ConnectFeedScreen(
          session: session,
          profileAction: const SizedBox.shrink(),
          bloc: bloc,
          composerController: controller,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  return (bloc, controller);
}

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

void main() {
  group('AuthUser.canCreateContests', () {
    test('is read from the server and off unless it says true', () {
      AuthUser read(Map<String, dynamic> extra) =>
          AuthUser.fromJson({'id': 'u', 'email': 'u@x.test', ...extra});
      expect(read({'canCreateContests': true}).canCreateContests, isTrue);
      expect(read({'canCreateContests': false}).canCreateContests, isFalse);
      expect(read({}).canCreateContests, isFalse);
      expect(read({'canCreateContests': 'yes'}).canCreateContests, isFalse);
    });

    test('survives the session store and a photo change', () {
      final user = AuthUser.fromJson({
        'id': 'u',
        'email': 'u@x.test',
        'canCreateContests': true,
      });
      expect(AuthUser.fromJson(user.toJson()).canCreateContests, isTrue);
      expect(
        user
            .copyWith(profilePhotoUrl: 'https://x.test/p.png')
            .canCreateContests,
        isTrue,
      );
    });
  });

  /// Opens the quick composer and returns the left edge of the first chip.
  Future<double> openComposer(
    WidgetTester tester,
    ConnectComposerController controller,
  ) async {
    controller.openComposer();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    // The chips draw their labels in capitals, in the design's order: Media,
    // Poll, Contest, Kudos, Recommend. What comes back is where the chip after
    // Poll starts: Contest's place, or Kudos in it when there is no Contest.
    expect(find.text('MEDIA'), findsOneWidget);
    final third = find.text('CONTEST').evaluate().isEmpty
        ? find.text('KUDOS')
        : find.text('CONTEST');
    return tester.getTopLeft(third).dx;
  }

  testWidgets('with the grant, Contest is offered even with a Games tab', (
    tester,
  ) async {
    final (bloc, controller) = await _pumpFeed(
      tester,
      _session([
        'connect',
        'team',
        'games',
        'actions',
      ], canCreateContests: true),
    );
    await openComposer(tester, controller);
    expect(find.text('CONTEST'), findsOneWidget);
    // After Poll and before Kudos (node 3809:76076).
    expect(
      tester.getTopLeft(find.text('CONTEST')).dx,
      greaterThan(tester.getTopLeft(find.text('POLL')).dx),
    );
    expect(
      tester.getTopLeft(find.text('CONTEST')).dx,
      lessThan(tester.getTopLeft(find.text('KUDOS')).dx),
    );
    await _tearDown(tester, bloc);
  });

  testWidgets('with the grant and no Games tab, Contest is offered too', (
    tester,
  ) async {
    final (bloc, controller) = await _pumpFeed(
      tester,
      _session(['connect', 'team', 'grow', 'actions'], canCreateContests: true),
    );
    await openComposer(tester, controller);
    expect(find.text('CONTEST'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('without the grant there is no Contest, and no gap for it', (
    tester,
  ) async {
    // Where Contest starts when it is there.
    final (withBloc, withController) = await _pumpFeed(
      tester,
      _session(['connect', 'team', 'grow', 'actions'], canCreateContests: true),
    );
    final rowStart = await openComposer(tester, withController);
    await _tearDown(tester, withBloc);

    final (bloc, controller) = await _pumpFeed(
      tester,
      _session([
        'connect',
        'team',
        'grow',
        'actions',
      ], canCreateContests: false),
    );
    final firstChip = await openComposer(tester, controller);
    expect(find.text('CONTEST'), findsNothing);
    // Kudos moves up to where Contest was: nothing is held open for it.
    expect(firstChip, rowStart);
    await _tearDown(tester, bloc);
  });

  testWidgets('without the grant a Games tab changes nothing', (tester) async {
    final (bloc, controller) = await _pumpFeed(
      tester,
      _session([
        'connect',
        'team',
        'games',
        'actions',
      ], canCreateContests: false),
    );
    await openComposer(tester, controller);
    expect(find.text('CONTEST'), findsNothing);
    await _tearDown(tester, bloc);
  });
}
