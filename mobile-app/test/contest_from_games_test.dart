// Where the app has the Games tab, contests are created there: the Connect
// composer drops its Contest chip, and the contest screen opens on the
// format the Games tab picked and publishes from Go live. A company without
// the Games tab keeps the chip.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

AuthSession _session(List<String> enabledTabs) => AuthSession(
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
  group('contestsStartFromGames', () {
    test('a company with the Games tab creates contests there', () {
      expect(
        contestsStartFromGames(['connect', 'team', 'games', 'actions']),
        isTrue,
      );
      // The keys are read the way the tab bar reads them.
      expect(contestsStartFromGames([' Games ']), isTrue);
    });

    test('one without it keeps the Connect composer', () {
      expect(
        contestsStartFromGames(['connect', 'team', 'grow', 'actions']),
        isFalse,
      );
      // No list at all is the four tabs the app always had.
      expect(contestsStartFromGames(const []), isFalse);
    });
  });

  testWidgets('the quick composer drops Contest where Games is a tab', (
    tester,
  ) async {
    final (bloc, controller) = await _pumpFeed(
      tester,
      _session(['connect', 'team', 'games', 'actions']),
    );
    controller.openComposer();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    // The chips draw their labels in capitals.
    expect(find.text('MEDIA'), findsOneWidget);
    expect(find.text('CONTEST'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('and keeps it where there is no Games tab', (tester) async {
    final (bloc, controller) = await _pumpFeed(
      tester,
      _session(['connect', 'team', 'grow', 'actions']),
    );
    controller.openComposer();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('MEDIA'), findsOneWidget);
    expect(find.text('CONTEST'), findsOneWidget);
    await _tearDown(tester, bloc);
  });

  testWidgets('the Games entry opens on its format and publishes on Go live', (
    tester,
  ) async {
    final session = _session(['connect', 'team', 'games', 'actions']);
    final created = <Map<String, dynamic>>[];
    final (bloc, controller) = await _pumpFeed(
      tester,
      session,
      created: created,
    );

    final opened = openContestComposer(
      tester.element(find.byType(ConnectFeedScreen)),
      session: session,
      format: ContestFormat.mostLikely,
      feed: controller,
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    // Frame 3677:40066: the feed label, no format pills, no Done.
    expect(
      find.text('THIS CONTEST WILL BE POSTED ON THE FEED'),
      findsOneWidget,
    );
    expect(find.text('SELECT THE CONTEST'), findsNothing);
    expect(find.text('Done'), findsNothing);
    // Most Likely opens named after itself, which is enough to go live.
    expect(
      tester
          .widget<EditableText>(find.byType(EditableText).first)
          .controller
          .text,
      'Most Likely',
    );

    await tester.tap(find.text('Go live'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    final post = await opened;
    expect(post?.id, 'new-contest');
    expect(post?.type, ConnectPostType.mostLikely);
    expect(created.single['type'], 'most_likely');
    // It went up through the feed, so it is at the top of it already.
    expect(bloc.state.posts.first.id, 'new-contest');
    expect(find.text('THIS CONTEST WILL BE POSTED ON THE FEED'), findsNothing);
    await _tearDown(tester, bloc);
  });

  testWidgets('backing out of the Games entry publishes nothing', (
    tester,
  ) async {
    final session = _session(['connect', 'games']);
    final created = <Map<String, dynamic>>[];
    final (bloc, controller) = await _pumpFeed(
      tester,
      session,
      created: created,
    );

    final opened = openContestComposer(
      tester.element(find.byType(ConnectFeedScreen)),
      session: session,
      format: ContestFormat.caption,
      feed: controller,
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    // A caption contest needs its picture before it can go live.
    await tester.tap(find.text('Go live'));
    await tester.pump();
    expect(created, isEmpty);

    await tester.tap(find.bySemanticsLabel('Back'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    expect(await opened, isNull);
    expect(created, isEmpty);
    await _tearDown(tester, bloc);
  });
}
