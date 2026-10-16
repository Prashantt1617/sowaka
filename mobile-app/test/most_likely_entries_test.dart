// Most Likely's Entries page (Figma 3929:53104, 3929:53531): the people
// named as bars filled in proportion to their points, ordered by points or
// by who was tagged last; under each, "Tag by:" with the faces of whoever
// tagged them and "View all", which lists them in a sheet; "YOUR VOTE" says
// whom the viewer tagged and, while the contest is live, opens a picker that
// moves the tag (the old one taken back, the new one sent); "YOUR RANK" is
// the viewer's place once someone has tagged them.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Vera Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

Map<String, dynamic> _tagger(
  String id,
  String name, {
  String designation = '',
  String department = '',
  String location = '',
  int minute = 0,
}) => {
  'userId': id,
  'name': name,
  'initials': name.split(' ').map((part) => part[0]).join(),
  'designation': designation,
  'department': department,
  'location': location,
  'taggedAt': DateTime.utc(2026, 10, 15, 6, minute).toIso8601String(),
};

/// Manav's seven taggers, latest first, as the server sends them.
final _manavTaggers = [
  _tagger(
    'aarav',
    'Aarav Mehta',
    designation: '3D Artist',
    department: '3D',
    location: 'Gurugram',
    minute: 30,
  ),
  _tagger('ishita', 'Ishita Rao', minute: 25),
  _tagger('meera', 'Meera Nair', minute: 20),
  _tagger('sana', 'Sana Das', minute: 15),
  _tagger('qadir', 'Qadir Tak', minute: 10),
  _tagger('xena', 'Xena Young', minute: 5),
  _tagger('ravi', 'Ravi Mani', minute: 1),
];

Map<String, dynamic> _row(
  String userId,
  String name, {
  required int rank,
  required List<Map<String, dynamic>> taggedBy,
  required int lastTagMinute,
  bool mine = false,
}) => {
  'id': userId,
  'userId': userId,
  'name': name,
  'initials': name[0],
  'text': '',
  'votes': taggedBy.length,
  'points': taggedBy.length * 10,
  'votedByViewer': false,
  'isMine': mine,
  'rank': rank,
  'createdAt': DateTime.utc(2026, 10, 15, 6, lastTagMinute).toIso8601String(),
  'taggedBy': taggedBy,
};

/// The contest as the server sends it to the viewer, who has tagged
/// [myTagged] (or no one) and is tagged once themselves when [tagged].
Map<String, dynamic> _contest({String? myTagged, bool tagged = true}) {
  final kiranTaggers = [
    _tagger('meera', 'Meera Nair', minute: 50),
    if (myTagged == 'kiran') _tagger('viewer', 'Vera Viewer', minute: 55),
  ];
  final manavTaggers = [
    if (myTagged == 'manav') _tagger('viewer', 'Vera Viewer', minute: 55),
    ..._manavTaggers,
  ];
  return {
    'id': 'contest',
    'type': 'most_likely',
    'tag': 'Most Likely',
    'author': {
      'userId': 'author',
      'name': 'Sowaka Engagement',
      'initials': 'SE',
    },
    'audience': {'label': 'Public'},
    'body': {
      'title': 'Lunch Theif',
      'question': 'Nominate the teammate who fits this tag',
      'pointsPerVote': 10,
      'closesAt': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'entries': <dynamic>[],
      'leaderboard': [
        _row(
          'manav',
          'Manav Shah',
          rank: 1,
          taggedBy: manavTaggers,
          lastTagMinute: myTagged == 'manav' ? 55 : 30,
        ),
        _row(
          'kiran',
          'Kiran Das',
          rank: 2,
          taggedBy: kiranTaggers,
          lastTagMinute: myTagged == 'kiran' ? 55 : 50,
        ),
        if (tagged)
          _row(
            'viewer',
            'Vera Viewer',
            rank: 3,
            taggedBy: [_tagger('kiran', 'Kiran Das', minute: 40)],
            lastTagMinute: 40,
            mine: true,
          ),
      ],
      'myTaggedUserId': myTagged,
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-10-15T06:00:00.000Z',
  };
}

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

class _Server {
  _Server(this.contest);

  Map<String, dynamic> contest;

  /// What reached the server, in order: 'DELETE' for a tag taken back,
  /// `'TAG <id>'` for one sent.
  final calls = <String>[];

  /// Who the page asked to see.
  final opened = <String>[];

  late final client = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/auth/teammates')) {
      return _ok({
        'teammates': [
          for (final (id, name) in [
            ('viewer', 'Vera Viewer'),
            ('manav', 'Manav Shah'),
            ('kiran', 'Kiran Das'),
            ('aarav', 'Aarav Mehta'),
          ])
            {
              'userId': id,
              'name': name,
              'designation': 'Artist',
              'department': '3D',
            },
        ],
      });
    }
    if (path.endsWith('/connect/posts/contest/captions')) {
      if (request.method == 'DELETE') {
        calls.add('DELETE');
        contest = _contest();
      } else {
        final id = jsonDecode(request.body)['taggedUserId'] as String;
        calls.add('TAG $id');
        contest = _contest(myTagged: id);
      }
      return _ok({'post': contest});
    }
    if (path.endsWith('/connect/posts/contest')) {
      return _ok({'post': contest});
    }
    return _ok({});
  });
}

/// Opens the contest's Entries page the way the Games tab does, with the
/// directory of colleagues read through [server] too.
Future<_Server> _openEntries(
  WidgetTester tester, {
  String? myTagged,
  bool tagged = true,
}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final server = _Server(_contest(myTagged: myTagged, tagged: tagged));
  final api = ConnectApiService(
    session: _session,
    baseUrl: 'https://example.test',
    client: server.client,
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => http.runWithClient(
                () => unawaited(
                  openContestEntries(
                    context,
                    _session,
                    'contest',
                    api: api,
                    onOpenPerson: server.opened.add,
                  ),
                ),
                () => server.client,
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await _settle(tester);
  expect(find.text('Leaderboard'), findsOneWidget);
  return server;
}

/// Lets a page, a sheet and the bars' fill come or go.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
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

Finder _fill(String userId) => find.byKey(ValueKey('tag-bar-fill-$userId'));

/// A name on the board is drawn twice, in each ink (see _SplitInk); the
/// first is the one under.
double _rowTop(WidgetTester tester, String firstName) =>
    tester.getTopLeft(find.textContaining(firstName).first).dy;

void main() {
  setUpAll(_loadFonts);

  testWidgets('each bar fills in proportion to its points', (tester) async {
    await _openEntries(tester);
    // Settled: the leader full, Kiran a seventh of it, the viewer a seventh.
    final full = tester.getSize(_fill('manav')).width;
    expect(full, greaterThan(300));
    expect(tester.getSize(_fill('kiran')).width, closeTo(full / 7, 1));
    expect(tester.getSize(_fill('viewer')).width, closeTo(full / 7, 1));
    expect(find.text('70pt'), findsNWidgets(2), reason: 'two inks, split');
    expect(find.textContaining('Kiran'), findsWidgets);
    // The viewer's own row says so.
    expect(find.textContaining('(You)'), findsWidgets);
  });

  testWidgets('the fill grows in when the page opens', (tester) async {
    final server = await _openEntries(tester);
    expect(server.calls, isEmpty);
    // Back, then open again, watching the first frames this time.
    await tester.tap(find.bySemanticsLabel('Back'));
    await _settle(tester);
    expect(_fill('manav'), findsNothing);
    await tester.tap(find.text('open'));
    await tester.pump();
    for (var i = 0; i < 20 && _fill('manav').evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    final first = tester.getSize(_fill('manav')).width;
    await tester.pump(const Duration(milliseconds: 150));
    final later = tester.getSize(_fill('manav')).width;
    await _settle(tester);
    final settled = tester.getSize(_fill('manav')).width;
    expect(first, lessThan(later));
    expect(later, lessThan(settled));
  });

  testWidgets('Most recent orders the people by when they were last tagged', (
    tester,
  ) async {
    await _openEntries(tester);
    expect(_rowTop(tester, 'Manav'), lessThan(_rowTop(tester, 'Kiran')));
    expect(_rowTop(tester, 'Kiran'), lessThan(_rowTop(tester, 'Vera')));
    await tester.tap(find.text('Most recent'));
    await tester.pump();
    // Kiran last tagged at 6:50, the viewer at 6:40, Manav at 6:30.
    expect(_rowTop(tester, 'Kiran'), lessThan(_rowTop(tester, 'Vera')));
    expect(_rowTop(tester, 'Vera'), lessThan(_rowTop(tester, 'Manav')));
    await tester.tap(find.text('Most voted'));
    await tester.pump();
    expect(_rowTop(tester, 'Manav'), lessThan(_rowTop(tester, 'Kiran')));
  });

  testWidgets('Tag by shows six faces and a count, and View all lists them', (
    tester,
  ) async {
    final server = await _openEntries(tester);
    final rows = find.byKey(const ValueKey('tag-by-row'));
    expect(rows, findsNWidgets(3));
    final manavRow = rows.first;
    Finder inRow(String text) =>
        find.descendant(of: manavRow, matching: find.text(text));
    // Latest first: Aarav's face leads, the seventh tagger is "+1".
    for (final initials in ['AM', 'IR', 'MN', 'SD', 'QT', 'XY']) {
      expect(inRow(initials), findsOneWidget, reason: initials);
    }
    expect(inRow('RM'), findsNothing);
    expect(inRow('+1'), findsOneWidget);
    expect(inRow('Tag by:'), findsOneWidget);
    expect(inRow('View all'), findsOneWidget);
    expect(
      tester.getTopLeft(inRow('AM')).dx,
      lessThan(tester.getTopLeft(inRow('IR')).dx),
    );

    await tester.tap(inRow('View all'));
    await _settle(tester);
    final sheet = find.byKey(const ValueKey('tag-by-sheet'));
    expect(sheet, findsOneWidget);
    Finder inSheet(String text) =>
        find.descendant(of: sheet, matching: find.text(text));
    expect(inSheet('Tag by'), findsOneWidget);
    for (final tagger in _manavTaggers) {
      expect(inSheet(tagger['name'] as String), findsOneWidget);
    }
    expect(inSheet('3D Artist · 3D · Gurugram'), findsOneWidget);
    expect(
      tester.getTopLeft(inSheet('Aarav Mehta')).dy,
      lessThan(tester.getTopLeft(inSheet('Ravi Mani')).dy),
    );

    // A tap on someone opens their profile, the sheet going first.
    await tester.tap(inSheet('Ishita Rao'));
    await _settle(tester);
    expect(server.opened, ['ishita']);
    expect(sheet, findsNothing);
  });

  testWidgets('a row with few taggers has no count', (tester) async {
    await _openEntries(tester);
    final kiranRow = find.byKey(const ValueKey('tag-by-row')).at(1);
    expect(
      find.descendant(of: kiranRow, matching: find.text('MN')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: kiranRow, matching: find.textContaining('+')),
      findsNothing,
    );
  });

  testWidgets('YOUR VOTE moves the tag: the old one back, the new one sent', (
    tester,
  ) async {
    final server = await _openEntries(tester, myTagged: 'manav');
    expect(find.text('Manav Shah'), findsOneWidget, reason: 'YOUR VOTE');
    expect(find.textContaining('(You tagged)'), findsWidgets);

    await tester.tap(find.text('Manav Shah'));
    await _settle(tester);
    final sheet = find.byKey(const ValueKey('vote-picker-sheet'));
    expect(sheet, findsOneWidget);
    Finder inSheet(String text) =>
        find.descendant(of: sheet, matching: find.text(text));
    expect(inSheet('Change your vote'), findsOneWidget);
    // The viewer cannot tag themselves; whoever they tagged leads the list.
    expect(inSheet('Vera Viewer'), findsNothing);
    expect(
      tester.getTopLeft(inSheet('Manav Shah')).dy,
      lessThan(tester.getTopLeft(inSheet('Kiran Das')).dy),
    );
    // The search narrows it.
    await tester.enterText(
      find.byKey(const ValueKey('vote-picker-search')),
      'kir',
    );
    await tester.pump();
    expect(inSheet('Manav Shah'), findsNothing);

    await tester.tap(inSheet('Kiran Das'));
    await _settle(tester);
    expect(server.calls, ['DELETE', 'TAG kiran']);
    expect(sheet, findsNothing);
    // YOUR VOTE follows, and the board marks the new tag.
    expect(find.text('Kiran Das'), findsOneWidget);
    expect(find.text('Manav Shah'), findsNothing);
  });

  testWidgets('picking the person already tagged sends nothing', (
    tester,
  ) async {
    final server = await _openEntries(tester, myTagged: 'manav');
    await tester.tap(find.text('Manav Shah'));
    await _settle(tester);
    final sheet = find.byKey(const ValueKey('vote-picker-sheet'));
    await tester.tap(
      find.descendant(of: sheet, matching: find.text('Manav Shah')),
    );
    await _settle(tester);
    expect(server.calls, isEmpty);
  });

  testWidgets('a first vote goes straight in, with nothing to take back', (
    tester,
  ) async {
    final server = await _openEntries(tester);
    expect(find.text('Vote for someone'), findsOneWidget);
    await tester.tap(find.text('Vote for someone'));
    await _settle(tester);
    expect(find.text('Vote for someone'), findsNWidgets(2), reason: 'title');
    await tester.tap(
      find.descendant(
        of: find.byKey(const ValueKey('vote-picker-sheet')),
        matching: find.text('Aarav Mehta'),
      ),
    );
    await _settle(tester);
    expect(server.calls, ['TAG aarav']);
  });

  testWidgets('YOUR RANK: the viewer\'s place once tagged, else their entry', (
    tester,
  ) async {
    await _openEntries(tester);
    expect(find.text('#3'), findsOneWidget);
    expect(find.text('of 3 · 10 pts'), findsOneWidget);
    expect(find.text('Submit your entry'), findsNothing);
  });

  testWidgets('not tagged and not yet nominating: Submit your entry, and '
      'the Nominate button', (tester) async {
    await _openEntries(tester, tagged: false);
    expect(find.text('Submit your entry'), findsOneWidget);
    expect(find.text('Nominate'), findsOneWidget);
  });

  testWidgets('not tagged but already nominating: not tagged yet', (
    tester,
  ) async {
    await _openEntries(tester, myTagged: 'kiran', tagged: false);
    expect(find.text('Not tagged yet'), findsOneWidget);
    expect(find.text('Nominate'), findsNothing);
  });
}
