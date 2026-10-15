// Birthdays and work anniversaries in the feed.
//
// The person whose day it is sees their own card (pinned at the top by the
// server) with their wishes and "View all wishes", which opens the post's
// comments. Everyone else sees one day's cards of the company clubbed into
// one, a row per person, each row opening that person's own wish thread.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer Person',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

const _club = 'celebrations:sowaka:2026-10-15';

Map<String, dynamic> _comment(
  String id,
  String userId,
  String name,
  String text,
) => {
  'id': id,
  'userId': userId,
  'name': name,
  'text': text,
  'createdAt': '2026-10-15T05:00:00.000Z',
};

Map<String, dynamic> _celebration({
  required String id,
  required String type,
  required String personUserId,
  required String personName,
  Map<String, dynamic> extra = const {},
  List<Map<String, dynamic>> comments = const [],
  String? actionValue,
}) => {
  'id': id,
  'type': type,
  'tag': type,
  'tagIcon': type == 'birthday' ? '🎂' : '🎉',
  'author': {'name': 'Sowaka', 'initials': 'S', 'designation': 'Auto · HRIS'},
  'audience': {'label': 'Public'},
  'body': {
    'personUserId': personUserId,
    'personName': personName,
    'personInitials': personName.split(' ').map((w) => w[0]).join(),
    'subtitle': 'Designer · turns a year wiser today',
    ...extra,
  },
  'likeCount': 0,
  'liked': false,
  'commentCount': comments.length,
  'comments': comments,
  'actionValue': ?actionValue,
  'publishedAt': '2026-10-15T00:31:00.000Z',
};

/// The cards carry emoji, which a plain string response cannot.
http.Response _json(String body, int status) => http.Response.bytes(
  utf8.encode(body),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

class _Server {
  _Server(this.posts);

  List<Map<String, dynamic>> posts;
  final actions = <String>[];

  late final client = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/connect/feed')) {
      return _json(jsonEncode({'success': true, 'posts': posts}), 200);
    }
    final action = RegExp(r'/connect/posts/([^/]+)/actions$').firstMatch(path);
    if (action != null) {
      final id = action.group(1)!;
      actions.add(id);
      final index = posts.indexWhere((post) => post['id'] == id);
      posts[index] = {...posts[index], 'actionValue': 'done'};
      return _json(jsonEncode({'success': true, 'post': posts[index]}), 200);
    }
    return http.Response(jsonEncode({'success': true}), 200);
  });
}

Future<ConnectBloc> _pumpFeed(WidgetTester tester, _Server server) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final bloc = ConnectBloc(
    session: _session,
    api: ConnectApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: server.client,
    ),
  );
  await bloc.load();
  await tester.pumpWidget(
    MaterialApp(
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

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

Finder _sheetTitle(String text) =>
    find.textContaining(text, findRichText: true);

void main() {
  group('the celebrant', () {
    testWidgets('sees their wishes and opens them with View all wishes', (
      tester,
    ) async {
      final server = _Server([
        _celebration(
          id: 'mine',
          type: 'birthday',
          personUserId: 'viewer',
          personName: 'Viewer Person',
          extra: {'pinnedForCelebrant': true},
          comments: [
            _comment('c1', 'riya', 'Riya Sharma', 'Happy birthday!'),
            _comment('c2', 'kabir', 'Kabir Shah', 'Have a great one'),
          ],
        ),
      ]);
      final bloc = await _pumpFeed(tester, server);

      expect(find.byKey(const ValueKey('celebrant-pinned')), findsOneWidget);
      expect(find.text('2 wishes for you'), findsOneWidget);
      // No button to wish themselves.
      expect(find.textContaining('Wish Viewer'), findsNothing);
      expect(_sheetTitle('Wishes · '), findsNothing);

      await tester.ensureVisible(find.text('View all wishes'));
      await tester.tap(find.text('View all wishes'));
      await _settle(tester);

      expect(_sheetTitle('Wishes · 2'), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets('an anniversary works the same way', (tester) async {
      final server = _Server([
        _celebration(
          id: 'mine',
          type: 'anniversary',
          personUserId: 'viewer',
          personName: 'Viewer Person',
          extra: {
            'years': 3,
            'companyName': 'Sowaka',
            'pinnedForCelebrant': true,
          },
        ),
      ]);
      final bloc = await _pumpFeed(tester, server);

      expect(find.text('Your wishes will show up here'), findsOneWidget);
      expect(find.textContaining('Congratulations'), findsNothing);
      await tester.ensureVisible(find.text('View all wishes'));
      await tester.tap(find.text('View all wishes'));
      await _settle(tester);

      expect(_sheetTitle('Wishes · 0'), findsOneWidget);
      expect(
        find.text('No wishes yet. They will show up here.'),
        findsOneWidget,
      );
      await _tearDown(tester, bloc);
    });

    testWidgets('everyone else still gets the button to wish them', (
      tester,
    ) async {
      final server = _Server([
        _celebration(
          id: 'b1',
          type: 'birthday',
          personUserId: 'riya',
          personName: 'Riya Sharma',
          extra: {'celebrationGroup': _club},
        ),
      ]);
      final bloc = await _pumpFeed(tester, server);

      // A club of one is the usual card.
      expect(find.byKey(const ValueKey('celebrations-card')), findsNothing);
      expect(find.text('🎂 Wish Riya'), findsOneWidget);
      expect(find.text('View all wishes'), findsNothing);
      expect(find.byKey(const ValueKey('celebrant-pinned')), findsNothing);
      await _tearDown(tester, bloc);
    });
  });

  group('the clubbed card', () {
    List<Map<String, dynamic>> twoCelebrations() => [
      _celebration(
        id: 'b1',
        type: 'birthday',
        personUserId: 'riya',
        personName: 'Riya Sharma',
        extra: {'celebrationGroup': _club},
        comments: [
          _comment('c1', 'meera', 'Meera Rao', 'Happy birthday Riya!'),
        ],
      ),
      _celebration(
        id: 'a1',
        type: 'anniversary',
        personUserId: 'kabir',
        personName: 'Kabir Shah',
        extra: {'celebrationGroup': _club, 'years': 2, 'companyName': 'Sowaka'},
        comments: [
          _comment('c2', 'meera', 'Meera Rao', 'Two years, Kabir!'),
          _comment('c3', 'dev', 'Dev Iyer', 'Congrats!'),
        ],
      ),
    ];

    testWidgets('one card, a row per person', (tester) async {
      final bloc = await _pumpFeed(tester, _Server(twoCelebrations()));

      expect(find.byKey(const ValueKey('celebrations-card')), findsOneWidget);
      expect(find.text('Riya Sharma'), findsOneWidget);
      expect(find.text('Kabir Shah'), findsOneWidget);
      expect(find.text('2 years at Sowaka'), findsOneWidget);
      // Not the single cards as well.
      expect(find.text('Happy Birthday, Riya Sharma!'), findsNothing);
      expect(find.text('View 1 wish'), findsOneWidget);
      expect(find.text('View 2 wishes'), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets("a person's wishes open their own thread", (tester) async {
      final bloc = await _pumpFeed(tester, _Server(twoCelebrations()));

      await tester.tap(find.byKey(const ValueKey('celebration-wishes-a1')));
      await _settle(tester);

      expect(_sheetTitle('Wishes · 2'), findsOneWidget);
      expect(find.text('Two years, Kabir!'), findsOneWidget);
      expect(find.text('Happy birthday Riya!'), findsNothing);
      await _tearDown(tester, bloc);
    });

    testWidgets(
      'Wish marks it sent and opens that thread with the wish written',
      (tester) async {
        final server = _Server(twoCelebrations());
        final bloc = await _pumpFeed(tester, server);

        await tester.tap(find.byKey(const ValueKey('celebration-wish-b1')));
        await _settle(tester);

        expect(server.actions, ['b1']);
        expect(_sheetTitle('Wishes · 1'), findsOneWidget);
        expect(find.text('Happy birthday Riya!'), findsOneWidget);
        final box = tester.widget<TextField>(
          find.descendant(
            of: find.byType(BottomSheet),
            matching: find.byType(TextField),
          ),
        );
        expect(
          box.controller?.text,
          'Happy Birthday, Riya! 🎂 Hope you have an amazing day!',
        );
        await _tearDown(tester, bloc);
      },
    );
  });
}
