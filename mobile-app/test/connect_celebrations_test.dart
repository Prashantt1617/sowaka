// Birthdays and work anniversaries in the feed.
//
// The person whose day it is sees their own card (pinned at the top by the
// server): what the day is, how many wishes are new, and "View all wishes"
// (Figma 3840:81136 and 3840:81108). Everyone else sees one day's cards of the
// company as a row of small cards, "Celebrations of the day", each opening
// that person's own wishes (3886:93781) — a sheet with hearts, replies, quick
// emoji and a box to wish in.
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

/// Today in India, as the server keys a day's celebrations.
String _today() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  String two(int value) => value.toString().padLeft(2, '0');
  return '${now.year}-${two(now.month)}-${two(now.day)}';
}

final _club = 'celebrations:sowaka:${_today()}';

Map<String, dynamic> _comment(
  String id,
  String userId,
  String name,
  String text, {
  String? parentId,
  int likeCount = 0,
}) => {
  'id': id,
  'userId': userId,
  'name': name,
  'text': text,
  'parentId': ?parentId,
  'likeCount': likeCount,
  'createdAt': DateTime.now()
      .subtract(const Duration(hours: 1))
      .toUtc()
      .toIso8601String(),
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
http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// The feed, a post on its own, wishes, hearts on them, the wished mark and
/// the celebrant's "seen" — as the server answers them.
class _Server {
  _Server(this.posts);

  List<Map<String, dynamic>> posts;
  final actions = <String>[];
  final seen = <String>[];
  final sentComments = <Map<String, dynamic>>[];
  final likedComments = <String>[];

  /// Posts only a single read finds — beyond the feed's pages.
  final extra = <Map<String, dynamic>>[];

  Map<String, dynamic> _update(
    String id,
    Map<String, dynamic> Function(Map<String, dynamic>) change,
  ) {
    final index = posts.indexWhere((post) => post['id'] == id);
    posts[index] = change(posts[index]);
    return posts[index];
  }

  late final client = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/connect/feed')) {
      return _json({'success': true, 'posts': posts});
    }
    final match = RegExp(r'/connect/posts/([^/]+)(/.*)?$').firstMatch(path);
    if (match == null) return _json({'success': true});
    final id = match.group(1)!;
    final rest = match.group(2) ?? '';
    if (rest == '/actions') {
      actions.add(id);
      return _json({
        'success': true,
        'post': _update(id, (post) => {...post, 'actionValue': 'done'}),
      });
    }
    if (rest == '/wishes/seen') {
      seen.add(id);
      return _json({
        'success': true,
        'post': _update(
          id,
          (post) => {
            ...post,
            'body': {
              ...post['body'] as Map<String, dynamic>,
              'newWishCount': 0,
            },
          },
        ),
      });
    }
    if (rest == '/comments') {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      sentComments.add(body);
      final comment = {
        ..._comment(
          'sent-${sentComments.length}',
          'viewer',
          'Viewer Person',
          body['text'] as String,
          parentId: body['parentId'] as String?,
        ),
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      };
      return _json({
        'success': true,
        'post': _update(id, (post) {
          final comments = [...post['comments'] as List, comment];
          return {
            ...post,
            'comments': comments,
            'commentCount': comments.length,
          };
        }),
      });
    }
    final like = RegExp(r'^/comments/([^/]+)/reaction$').firstMatch(rest);
    if (like != null) {
      final commentId = like.group(1)!;
      likedComments.add(commentId);
      return _json({
        'success': true,
        'post': _update(id, (post) {
          return {
            ...post,
            'comments': [
              for (final comment
                  in (post['comments'] as List).cast<Map<String, dynamic>>())
                if (comment['id'] == commentId)
                  {
                    ...comment,
                    'liked': !(comment['liked'] as bool? ?? false),
                    'likeCount':
                        (comment['likeCount'] as int? ?? 0) +
                        ((comment['liked'] as bool? ?? false) ? -1 : 1),
                  }
                else
                  comment,
            ],
          };
        }),
      });
    }
    if (rest.isEmpty && request.method == 'GET') {
      final post = [...posts, ...extra].firstWhere((post) => post['id'] == id);
      return _json({'success': true, 'post': post});
    }
    return _json({'success': true});
  });
}

Future<ConnectBloc> _pumpFeed(
  WidgetTester tester,
  _Server server, {
  ConnectComposerController? controller,
}) async {
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
          composerController: controller,
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

Finder _inSheet(Finder finder) => find.descendant(
  of: find.byKey(const ValueKey('wishes-sheet')),
  matching: finder,
);

TextEditingController _box(WidgetTester tester) => tester
    .widget<TextField>(_inSheet(find.byKey(const ValueKey('wish-box'))))
    .controller!;

void main() {
  group("the celebrant's own card", () {
    testWidgets('a birthday: the day, the new wishes, View all wishes', (
      tester,
    ) async {
      final server = _Server([
        _celebration(
          id: 'mine',
          type: 'birthday',
          personUserId: 'viewer',
          personName: 'Viewer Person',
          extra: {'pinnedForCelebrant': true, 'newWishCount': 2},
          comments: [
            _comment('c1', 'riya', 'Riya Sharma', 'Happy birthday!'),
            _comment('c2', 'kabir', 'Kabir Shah', 'Have a great one'),
            _comment('c3', 'dev', 'Dev Iyer', 'Many happy returns'),
            _comment('c4', 'meera', 'Meera Rao', '🎉🎉'),
          ],
        ),
      ]);
      final bloc = await _pumpFeed(tester, server);

      expect(find.byKey(const ValueKey('celebrant-card-mine')), findsOneWidget);
      expect(find.text('Birthday Wishes'), findsOneWidget);
      expect(find.text('Happy Birthday'), findsOneWidget);
      expect(find.text('Viewer Person'), findsOneWidget);
      expect(find.text('2 new'), findsOneWidget);
      // Two faces and the other two as "+2".
      expect(find.text('+2'), findsOneWidget);
      // No button to wish themselves, and not the usual card.
      expect(find.textContaining('Wish Viewer'), findsNothing);
      expect(find.byKey(const ValueKey('celebrations-section')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('view-all-wishes')));
      await _settle(tester);

      expect(_inSheet(find.text('Birthday Wishes')), findsOneWidget);
      expect(_inSheet(find.text('Have a great one')), findsOneWidget);
      // Opening them is seeing them: the count goes, here and on the server.
      expect(server.seen, ['mine']);
      expect(find.text('2 new'), findsNothing);
      // The celebrant thanks people rather than wishing themselves.
      expect(_inSheet(find.text('Say thanks…')), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets('an anniversary: years, company and since when', (
      tester,
    ) async {
      final server = _Server([
        _celebration(
          id: 'mine',
          type: 'anniversary',
          personUserId: 'viewer',
          personName: 'Viewer Person',
          extra: {
            'years': 3,
            'companyName': 'Convrse Space',
            'joinedOn': '2023-10-15T00:00:00.000Z',
            'pinnedForCelebrant': true,
            'newWishCount': 0,
          },
          comments: [_comment('c1', 'riya', 'Riya Sharma', 'Three years!')],
        ),
      ]);
      final bloc = await _pumpFeed(tester, server);

      expect(find.text('Work Anniversary'), findsOneWidget);
      expect(
        find.textContaining('Congratulations! ', findRichText: true),
        findsOneWidget,
      );
      // The design's own "3" (Figma 4010:63927), not a typed one.
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('celebrant-years')),
          matching: find.byWidgetPredicate(
            (w) =>
                w is Image &&
                w.image is AssetImage &&
                (w.image as AssetImage).assetName ==
                    'assets/images/celebrations/years/year_3.png',
          ),
        ),
        findsOneWidget,
      );
      expect(find.text('years'), findsOneWidget);
      expect(find.text('at Convrse Space'), findsOneWidget);
      expect(find.text('Since Oct 2023'), findsOneWidget);
      // Nothing new: no pill.
      expect(find.textContaining(' new'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('view-all-wishes')));
      await _settle(tester);
      expect(_inSheet(find.text('Work Anniversary Wishes')), findsOneWidget);
      expect(_inSheet(find.text('Three years!')), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets('a server that sends no count shows none and is not asked', (
      tester,
    ) async {
      final server = _Server([
        _celebration(
          id: 'mine',
          type: 'anniversary',
          personUserId: 'viewer',
          personName: 'Viewer Person',
          extra: {
            'years': 1,
            'subtitle': 'Design · joined October 2025',
            'pinnedForCelebrant': true,
          },
        ),
      ]);
      final bloc = await _pumpFeed(tester, server);

      expect(find.text('year'), findsOneWidget);
      expect(find.text('Since Oct 2025'), findsOneWidget);
      expect(find.textContaining(' new'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('view-all-wishes')));
      await _settle(tester);
      expect(
        _inSheet(find.text('No wishes yet. They will show up here.')),
        findsOneWidget,
      );
      expect(server.seen, isEmpty);
      await _tearDown(tester, bloc);
    });
  });

  group('celebrations of the day', () {
    List<Map<String, dynamic>> twoCelebrations() => [
      _celebration(
        id: 'b1',
        type: 'birthday',
        personUserId: 'riya',
        personName: 'Riya Sharma',
        extra: {'celebrationGroup': _club, 'personDepartment': 'Engineering'},
        comments: [
          _comment('c1', 'meera', 'Meera Rao', 'Happy birthday Riya!'),
          _comment('c2', 'dev', 'Dev Iyer', 'Have a blast'),
          _comment('c3', 'kabir', 'Kabir Shah', 'HBD!'),
        ],
      ),
      _celebration(
        id: 'a1',
        type: 'anniversary',
        personUserId: 'priya',
        personName: 'Priya Bhatt',
        extra: {
          'celebrationGroup': _club,
          'years': 3,
          'companyName': 'Sowaka',
          'personDepartment': 'Product manager',
        },
      ),
    ];

    testWidgets('one row, a small card per person', (tester) async {
      final bloc = await _pumpFeed(tester, _Server(twoCelebrations()));

      expect(
        find.byKey(const ValueKey('celebrations-section')),
        findsOneWidget,
      );
      expect(find.text('Celebrations of the day'), findsOneWidget);
      expect(find.byKey(const ValueKey('celebration-tile-b1')), findsOneWidget);
      expect(find.byKey(const ValueKey('celebration-tile-a1')), findsOneWidget);
      expect(find.text('Birthday'), findsOneWidget);
      expect(find.text('Work Anniversary'), findsOneWidget);
      expect(find.text('Riya Sharma'), findsOneWidget);
      expect(find.text('Engineering'), findsOneWidget);
      expect(find.text('Product manager'), findsOneWidget);
      expect(find.text('Wish Riya'), findsOneWidget);
      expect(find.text('Wish Priya'), findsOneWidget);
      // Riya: two faces and "+1", "Wished". Priya: nobody yet.
      expect(find.text('+1'), findsOneWidget);
      expect(find.text('Wished'), findsOneWidget);
      expect(find.text('Be first to wish'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('celebration-tile-a1')),
          matching: find.byKey(const ValueKey('celebration-years')),
        ),
        findsOneWidget,
      );
      // Not the single cards as well.
      expect(find.text('Happy Birthday, Riya Sharma!'), findsNothing);
      // The row scrolls sideways.
      final row = tester.widget<SingleChildScrollView>(
        find.byKey(const ValueKey('celebrations-row')),
      );
      expect(row.scrollDirection, Axis.horizontal);
      await _tearDown(tester, bloc);
    });

    testWidgets('one person on their own is still the row', (tester) async {
      final bloc = await _pumpFeed(tester, _Server([twoCelebrations().last]));
      expect(find.text('Celebrations of the day'), findsOneWidget);
      expect(find.text('Wish Priya'), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets('a past day says which', (tester) async {
      final post = _celebration(
        id: 'old',
        type: 'birthday',
        personUserId: 'riya',
        personName: 'Riya Sharma',
        extra: {'celebrationGroup': 'celebrations:sowaka:2026-03-02'},
      );
      final bloc = await _pumpFeed(tester, _Server([post]));
      expect(find.text('Celebrations · 2 Mar'), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets(
      'Wish opens their wishes with one written; sending it marks it wished',
      (tester) async {
        final server = _Server(twoCelebrations());
        final bloc = await _pumpFeed(tester, server);

        await tester.tap(find.byKey(const ValueKey('celebration-wish-b1')));
        await _settle(tester);

        expect(_inSheet(find.text('Birthday Wishes')), findsOneWidget);
        expect(_inSheet(find.text('Happy birthday Riya!')), findsOneWidget);
        expect(
          _box(tester).text,
          'Happy Birthday, Riya! 🎂 Hope you have an amazing day!',
        );
        // Nothing is marked until the wish goes.
        expect(server.actions, isEmpty);

        await tester.tap(_inSheet(find.byKey(const ValueKey('wish-send'))));
        await _settle(tester);

        expect(
          server.sentComments.single['text'],
          startsWith('Happy Birthday'),
        );
        expect(server.actions, ['b1']);
        expect(_box(tester).text, isEmpty);

        // Back on the feed, the card says who else wished with them.
        Navigator.of(tester.element(find.byType(BottomSheet))).pop();
        await _settle(tester);
        expect(find.text('Wish Riya'), findsNothing);
        expect(find.text('You Wished with'), findsOneWidget);
        await _tearDown(tester, bloc);
      },
    );

    testWidgets('the card itself opens that person’s wishes only', (
      tester,
    ) async {
      final bloc = await _pumpFeed(tester, _Server(twoCelebrations()));

      await tester.tap(find.text('Be first to wish'));
      await _settle(tester);

      expect(_inSheet(find.text('Work Anniversary Wishes')), findsOneWidget);
      expect(
        _inSheet(find.text('No wishes yet — be the first.')),
        findsOneWidget,
      );
      expect(_inSheet(find.text('Wish Priya…')), findsOneWidget);
      expect(_inSheet(find.text('Happy birthday Riya!')), findsNothing);
      await _tearDown(tester, bloc);
    });

    testWidgets('a notification about one lands on its card and its wishes', (
      tester,
    ) async {
      final server = _Server([
        for (var i = 0; i < 8; i++)
          {
            ..._celebration(
              id: 'p$i',
              type: 'new_post',
              personUserId: '',
              personName: 'Post $i',
            ),
            'body': {'text': 'Post number $i ' * 20},
          },
        ...twoCelebrations(),
      ]);
      final controller = ConnectComposerController();
      final bloc = await _pumpFeed(tester, server, controller: controller);

      controller.openPost('a1', comments: true);
      // It scrolls a screen at a time, a frame each, then opens the wishes.
      for (var i = 0; i < 40; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      expect(_inSheet(find.text('Work Anniversary Wishes')), findsOneWidget);
      final tile = tester.getRect(
        find.byKey(const ValueKey('celebration-tile-a1')),
      );
      expect(tile.top, greaterThanOrEqualTo(0));
      expect(tile.top, lessThan(2556 / 3));
      await _tearDown(tester, bloc);
    });
  });

  group('the wishes sheet', () {
    Map<String, dynamic> birthday() => _celebration(
      id: 'b1',
      type: 'birthday',
      personUserId: 'subham',
      personName: 'Subham Sharma',
      extra: {'celebrationGroup': _club},
      comments: [
        _comment('w1', 'sarah', 'Sarah Kim', 'Happy birthday lets celebrate'),
        _comment(
          'r1',
          'viewer',
          'Viewer Person',
          '@Sarah Thankyou for sure.',
          parentId: 'w1',
        ),
        _comment('w2', 'raj', 'Raj Patel', 'Hey! happy birthday', likeCount: 5),
      ],
    );

    Future<(ConnectBloc, _Server)> open(WidgetTester tester) async {
      final server = _Server([birthday()]);
      final bloc = await _pumpFeed(tester, server);
      await tester.tap(find.byKey(const ValueKey('celebration-tile-b1')));
      await _settle(tester);
      return (bloc, server);
    }

    testWidgets('wishes, likes, and your replies under "You Replied"', (
      tester,
    ) async {
      final (bloc, _) = await open(tester);

      expect(_inSheet(find.text('Sarah Kim')), findsOneWidget);
      expect(_inSheet(find.text('1h ago')), findsNWidgets(2));
      expect(_inSheet(find.text('You Replied')), findsOneWidget);
      expect(
        _inSheet(find.text('@Sarah Thankyou for sure.', findRichText: true)),
        findsOneWidget,
      );
      // Raj's wish has five hearts, and a Reply of its own.
      expect(_inSheet(find.text('5')), findsOneWidget);
      expect(_inSheet(find.text('Reply')), findsOneWidget);
      // Eight quick emoji and the box.
      for (final emoji in ['❤️', '🙌', '🔥', '👏', '😍', '🎉', '💯', '😂']) {
        expect(_inSheet(find.text(emoji)), findsOneWidget);
      }
      expect(_inSheet(find.text('Wish Subham…')), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets('an emoji goes in where the cursor is', (tester) async {
      final (bloc, _) = await open(tester);

      await tester.tap(_inSheet(find.byKey(const ValueKey('wish-emoji-🎉'))));
      await tester.pump();
      expect(_box(tester).text, '🎉');

      _box(tester).value = const TextEditingValue(
        text: 'Happy day',
        selection: TextSelection.collapsed(offset: 5),
      );
      await tester.tap(_inSheet(find.byKey(const ValueKey('wish-emoji-❤️'))));
      await tester.pump();
      expect(_box(tester).text, 'Happy❤️ day');
      await _tearDown(tester, bloc);
    });

    testWidgets('a heart likes the wish, and again unlikes it', (tester) async {
      final (bloc, server) = await open(tester);

      await tester.tap(_inSheet(find.byKey(const ValueKey('wish-like-w2'))));
      await _settle(tester);
      expect(server.likedComments, ['w2']);
      expect(_inSheet(find.text('6')), findsOneWidget);

      await tester.tap(_inSheet(find.byKey(const ValueKey('wish-like-w2'))));
      await _settle(tester);
      expect(server.likedComments, ['w2', 'w2']);
      expect(_inSheet(find.text('5')), findsOneWidget);
      await _tearDown(tester, bloc);
    });

    testWidgets('Reply answers that wish, and then reads You Replied', (
      tester,
    ) async {
      final (bloc, server) = await open(tester);

      await tester.tap(_inSheet(find.byKey(const ValueKey('wish-reply-w2'))));
      await tester.pump();
      expect(_box(tester).text, '@Raj ');
      expect(_inSheet(find.text('Replying to Raj Patel')), findsOneWidget);

      await tester.enterText(
        _inSheet(find.byKey(const ValueKey('wish-box'))),
        '@Raj thank you!',
      );
      await tester.tap(_inSheet(find.byKey(const ValueKey('wish-send'))));
      await _settle(tester);

      expect(server.sentComments.single['parentId'], 'w2');
      expect(_inSheet(find.text('You Replied')), findsNWidgets(2));
      expect(_inSheet(find.text('Reply')), findsNothing);
      expect(
        _inSheet(find.text('@Raj thank you!', findRichText: true)),
        findsOneWidget,
      );
      // A reply is not a wish: the card is not marked wished for it.
      expect(server.actions, isEmpty);
      await _tearDown(tester, bloc);
    });
  });
}
