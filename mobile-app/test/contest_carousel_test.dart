// A contest card's entries move on by themselves, a page every two seconds
// and back round to the first after the last. A swipe still moves them, a
// finger held on them holds them, and the two seconds start over from
// wherever they are let go. With motion turned down on the phone they wait
// for a swipe.
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

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

/// No live connection: the test lets time pass, and the real socket would
/// dial out when it did.
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

/// A caption contest with three captions in, and no closing time, so only
/// the carousel keeps time.
Map<String, dynamic> _captionPost() => {
  'id': 'post-1',
  'type': 'caption_challenge',
  'tag': 'Caption Challenge',
  'author': {'name': 'Sowaka Engagement', 'initials': 'SE'},
  'audience': <String, dynamic>{},
  'body': {
    'title': 'Caption this',
    'pointsPerVote': 10,
    'entries': [
      for (final (i, text) in const [
        'Purr my last email',
        'Per my last meow',
        'Circling back to the treats',
      ].indexed)
        {
          'id': 'e$i',
          'userId': 'user-$i',
          'name': 'Person $i',
          'initials': 'P$i',
          'text': text,
          'votes': 0,
          'points': 0,
          'votedByViewer': false,
          'isMine': false,
          'createdAt': '2026-10-10T07:00:00.000Z',
        },
    ],
  },
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-10T06:00:00.000Z',
};

Future<ConnectBloc> _pumpFeed(
  WidgetTester tester, {
  bool reduceMotion = false,
}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/connect/feed')) {
      return http.Response(
        jsonEncode({
          'success': true,
          'posts': [_captionPost()],
        }),
        200,
      );
    }
    return http.Response(jsonEncode({'success': true}), 200);
  });
  final bloc = ConnectBloc(
    session: _session,
    api: ConnectApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: client,
    ),
    socket: _QuietSocket(),
  );
  await bloc.load();
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
        child: child!,
      ),
      home: Scaffold(
        body: ConnectFeedScreen(
          session: _session,
          profileAction: const SizedBox.shrink(),
          bloc: bloc,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  return bloc;
}

/// Lets the next page turn, and its 350 ms slide, play out.
Future<void> _waitAPage(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 2));
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

void main() {
  testWidgets('the entries move on every two seconds and wrap round', (
    tester,
  ) async {
    final bloc = await _pumpFeed(tester);
    expect(find.text('1 of 3'), findsOneWidget);

    await _waitAPage(tester);
    expect(find.text('2 of 3'), findsOneWidget);

    await _waitAPage(tester);
    expect(find.text('3 of 3'), findsOneWidget);

    // After the last, back round to the first.
    await _waitAPage(tester);
    expect(find.text('1 of 3'), findsOneWidget);

    await _tearDown(tester, bloc);
  });

  testWidgets('a swipe still moves them, and a held finger holds them', (
    tester,
  ) async {
    final bloc = await _pumpFeed(tester);
    final carousel = find.byType(PageView);
    expect(find.text('1 of 3'), findsOneWidget);

    // A swipe left moves on a page straight away.
    await tester.drag(carousel, const Offset(-250, 0));
    await _settle(tester);
    expect(find.text('2 of 3'), findsOneWidget);

    // And back.
    await tester.drag(carousel, const Offset(250, 0));
    await _settle(tester);
    expect(find.text('1 of 3'), findsOneWidget);

    // A finger resting on the carousel holds it however long it stays.
    final finger = await tester.startGesture(tester.getCenter(carousel));
    await tester.pump(const Duration(seconds: 5));
    expect(find.text('1 of 3'), findsOneWidget);

    // Let go, and the two seconds start over from there: not a moment
    // sooner.
    await finger.up();
    await tester.pump(const Duration(milliseconds: 1900));
    expect(find.text('1 of 3'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('2 of 3'), findsOneWidget);

    await _tearDown(tester, bloc);
  });

  testWidgets('with motion turned down they wait for a swipe', (tester) async {
    final bloc = await _pumpFeed(tester, reduceMotion: true);
    expect(find.text('1 of 3'), findsOneWidget);

    await _waitAPage(tester);
    await _waitAPage(tester);
    expect(find.text('1 of 3'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-250, 0));
    await _settle(tester);
    expect(find.text('2 of 3'), findsOneWidget);

    await _tearDown(tester, bloc);
  });
}
