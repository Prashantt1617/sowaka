// A photo contest entry's story — the words its entrant wrote under the
// photo — on the feed card, the entries page and the entry opened full
// screen (Figma 3327:20672, 3327:20846). On the card it rides in the caption
// contest's pink bubble, whose arrow votes; on the gallery tile it is one
// line; opened, it is all there. An entry without a story keeps the photo's
// own row: the face, the votes and the Vote button.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
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

const _story = 'Available on teams, unavailable emotionally';

Map<String, dynamic> _entry(
  String id, {
  required String name,
  String text = '',
  int votes = 0,
}) => {
  'id': id,
  'userId': 'user-$id',
  'name': name,
  'initials': name.substring(0, 2).toUpperCase(),
  'text': text,
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': false,
  'isMine': false,
  'createdAt': '2026-11-10T06:00:00.000Z',
};

Map<String, dynamic> _contest(List<Map<String, dynamic>> entries) {
  final ranked = [...entries]
    ..sort((a, b) => (b['votes'] as int).compareTo(a['votes'] as int));
  return {
    'id': 'contest',
    'type': 'photo_story_challenge',
    'tag': 'Photo Challenge',
    'author': {
      'userId': 'author',
      'name': 'Sowaka Engagement',
      'initials': 'SE',
    },
    'audience': {'label': 'Public'},
    'body': {
      'title': 'Post a photo of someone looking angry in the office.',
      'pointsPerVote': 10,
      'closesAt': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'entries': entries,
      'leaderboard': [
        for (final (index, entry) in ranked.indexed)
          {...entry, 'rank': index + 1},
      ],
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-11-10T06:00:00.000Z',
  };
}

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

/// Pumps the feed with [contest] on it, the carousel held still; returns
/// the bloc and the entries a vote was sent for.
Future<(ConnectBloc, List<String>)> _pumpFeed(
  WidgetTester tester,
  Map<String, dynamic> contest, {
  Size size = const Size(1179, 2556),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final votes = <String>[];
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/captions/vote')) {
      votes.add(jsonDecode(request.body)['entryId'] as String);
      return _ok({});
    }
    if (request.url.path.endsWith('/connect/feed')) {
      return _ok({
        'posts': [contest],
      });
    }
    return _ok({});
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
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: true),
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
  return (bloc, votes);
}

Future<void> _loadFonts() async {
  for (final (family, file) in [
    (
      'Plus Jakarta Sans',
      'assets/fonts/plus_jakarta_sans/PlusJakartaSans-Variable.ttf',
    ),
    ('Sora', 'assets/fonts/sora/Sora-Variable.ttf'),
  ]) {
    await (FontLoader(family)..addFont(rootBundle.load(file))).load();
  }
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 600));
  await tester.pump(const Duration(milliseconds: 600));
}

Future<void> _openEntries(WidgetTester tester) async {
  await tester.ensureVisible(find.text('View Entries'));
  await tester.pump();
  await tester.tap(find.text('View Entries'));
  await _settle(tester);
}

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

final _view = find.byKey(const ValueKey('entry-view'));
Finder _inView(Finder finder) => find.descendant(of: _view, matching: finder);

RenderParagraph _paragraph(WidgetTester tester, Finder text) =>
    tester.renderObject<RenderParagraph>(text);

void main() {
  setUpAll(_loadFonts);

  testWidgets('on the feed card a story rides in the pink bubble, whose '
      'arrow votes; without one the photo keeps its Vote button', (
    tester,
  ) async {
    final (bloc, votes) = await _pumpFeed(
      tester,
      _contest([
        _entry('a', name: 'Kabir Shah', text: _story, votes: 11),
        _entry('b', name: 'Meena Nair', votes: 2),
      ]),
    );
    expect(find.text('1 of 2'), findsOneWidget);
    // The caption card's bubble, quote mark and all, with its count.
    expect(find.text('“$_story'), findsOneWidget);
    expect(find.text('11 votes'), findsOneWidget);
    expect(find.text('Vote'), findsNothing);

    await tester.ensureVisible(find.text('11 votes'));
    await tester.pump();
    await tester.tap(find.text('11 votes'));
    await tester.pump();
    expect(votes, ['a']);

    // The entry without a story: its face, its votes and the Vote button.
    await tester.drag(find.byType(PageView).first, const Offset(-250, 0));
    await _settle(tester);
    expect(find.text('2 of 2'), findsOneWidget);
    expect(find.text('2 votes'), findsOneWidget);
    expect(find.text('Vote'), findsOneWidget);
    await tester.tap(find.text('Vote'));
    await tester.pump();
    expect(votes, ['a', 'b']);

    await _tearDown(tester, bloc);
  });

  testWidgets('a card where no entry has a story keeps its height', (
    tester,
  ) async {
    Future<double> cardHeight(List<Map<String, dynamic>> entries) async {
      final (bloc, _) = await _pumpFeed(tester, _contest(entries));
      final height = tester
          .getSize(
            find
                .ancestor(
                  of: find.byType(PageView).first,
                  matching: find.byType(SizedBox),
                )
                .first,
          )
          .height;
      await _tearDown(tester, bloc);
      return height;
    }

    final plain = await cardHeight([_entry('b', name: 'Meena Nair')]);
    final story = await cardHeight([
      _entry('a', name: 'Kabir Shah', text: _story),
      _entry('b', name: 'Meena Nair'),
    ]);
    expect(plain, 201 + 13 + 32);
    expect(story, 201 + 13 + 80);
  });

  testWidgets('a story is one line on its gallery tile and whole on the '
      'entry opened; without one there is neither', (tester) async {
    const long =
        'Available on teams, unavailable emotionally, and somehow still on '
        'mute in the stand-up while the whole floor waits for the slide that '
        'never loads, coffee going cold beside a keyboard nobody has touched';
    final (bloc, _) = await _pumpFeed(
      tester,
      _contest([
        _entry('a', name: 'Kabir Shah', text: long, votes: 11),
        _entry('b', name: 'Meena Nair', votes: 2),
      ]),
    );
    await _openEntries(tester);

    final tile = find.text(long);
    await tester.ensureVisible(tile);
    await tester.pump();
    expect(tile, findsOneWidget);
    final line = tester.widget<Text>(tile);
    expect(line.maxLines, 1);
    expect(line.overflow, TextOverflow.ellipsis);
    expect(_paragraph(tester, tile).didExceedMaxLines, isTrue);
    // It sits in the tile's footer, under the name and points.
    expect(
      tester.getTopLeft(tile).dy,
      greaterThan(tester.getBottomLeft(find.text('110 pts').first).dy),
    );

    // Opened, the whole story is under the photo, none of it cut.
    await tester.tap(find.text('#1'));
    await _settle(tester);
    final whole = _inView(find.text(long));
    expect(whole, findsOneWidget);
    expect(tester.widget<Text>(whole).maxLines, isNull);
    expect(_paragraph(tester, whole).didExceedMaxLines, isFalse);
    final story = _inView(find.byKey(const ValueKey('entry-story')));
    expect(story, findsOneWidget);
    // Under the photo: below the name on the card.
    expect(
      tester.getTopLeft(whole).dy,
      greaterThan(tester.getBottomLeft(_inView(find.text('Kabir Shah'))).dy),
    );
    // And on the screen.
    expect(
      tester.getBottomLeft(story).dy,
      lessThanOrEqualTo(
        tester.view.physicalSize.height / tester.view.devicePixelRatio,
      ),
    );

    // The entry without a story has no line on its tile and none opened.
    await tester.drag(_inView(find.byType(PageView)), const Offset(-300, 0));
    await _settle(tester);
    expect(_inView(find.text('Meena Nair')), findsOneWidget);
    expect(_inView(find.byKey(const ValueKey('entry-story'))), findsNothing);

    await _tearDown(tester, bloc);
  });

  testWidgets('a story too long for the room scrolls rather than being cut', (
    tester,
  ) async {
    final long = List.filled(
      40,
      'Available on teams, unavailable emotionally.',
    ).join(' ');
    final (bloc, _) = await _pumpFeed(
      tester,
      _contest([_entry('a', name: 'Kabir Shah', text: long, votes: 11)]),
      size: const Size(1080, 1920),
    );
    await _openEntries(tester);
    await tester.tap(find.text('#1'));
    await _settle(tester);

    final story = _inView(find.byKey(const ValueKey('entry-story')));
    final scroll = tester.state<ScrollableState>(
      find.descendant(of: story, matching: find.byType(Scrollable)),
    );
    expect(scroll.position.maxScrollExtent, greaterThan(0));
    final whole = _inView(find.text(long));
    expect(_paragraph(tester, whole).didExceedMaxLines, isFalse);
    // The picture keeps the room the story leaves it.
    expect(tester.getSize(story).height, lessThanOrEqualTo(_storyCap(tester)));

    await tester.drag(story, const Offset(0, -200));
    await tester.pump();
    expect(scroll.position.pixels, greaterThan(0));
    // Still open: the drag scrolled the story, not the card away.
    expect(_view, findsOneWidget);

    await _tearDown(tester, bloc);
  });
}

/// The most the story takes: 30% of the screen's height, in logical pixels.
double _storyCap(WidgetTester tester) =>
    tester.view.physicalSize.height / tester.view.devicePixelRatio * 0.3;
