// Custom audience lists from the composer: the sheet's lists, the picker of
// the whole company (A to Z, without the viewer; comma search; select all),
// the review sheet (remove, rename), saving a list through the API and
// choosing it, editing and deleting one, and the post going out with the
// list's id — the server copies its people onto the post.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/audience_lists.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';
import 'package:mobile_app/features/connect/presentation/audience_lists_ui.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Viewer Person',
    role: 'manager',
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

Map<String, dynamic> _row(String id, String name, String designation) => {
  'userId': id,
  'name': name,
  'designation': designation,
  'department': '3D',
  'city': 'Gurugram',
};

/// As the server sends the directory: not in order, and with the viewer.
final _people = [
  _row('tara', 'Tara Chopra', 'Animator'),
  _row('viewer', 'Viewer Person', 'Lead'),
  _row('meera', 'Meera Nair', 'Rigging Artist'),
  _row('aarav', 'Aarav Mehta', '3D Artist'),
  _row('kabir', 'Kabir Singh', 'Lighting Lead'),
  _row('ishita', 'Ishita Rao', '3D Generalist'),
];

http.Response _ok(Map<String, dynamic> json, [int status = 200]) =>
    http.Response(jsonEncode({'success': true, ...json}), status);

/// A fake server holding the viewer's lists, recording what is sent.
class _Server {
  _Server({List<Map<String, dynamic>>? lists}) : lists = [...?lists];

  final List<Map<String, dynamic>> lists;
  final requests = <(String, String, Map<String, dynamic>?)>[];
  Map<String, dynamic>? postedBody;

  late final client = MockClient((request) async {
    final path = request.url.path;
    final body = request.body.isEmpty
        ? null
        : jsonDecode(request.body) as Map<String, dynamic>;
    requests.add((request.method, path, body));
    if (path.endsWith('/connect/feed')) return _ok({'posts': <dynamic>[]});
    if (path.endsWith('/connect/audience-lists/people')) {
      return _ok({'people': _people});
    }
    if (path.endsWith('/connect/audience-lists') && request.method == 'GET') {
      return _ok({'lists': lists});
    }
    if (path.endsWith('/connect/audience-lists') && request.method == 'POST') {
      final list = {
        'id': 'list-new',
        'name': body!['name'],
        'memberUserIds': body['memberUserIds'],
      };
      lists.add(list);
      return _ok({'list': list}, 201);
    }
    if (path.contains('/connect/audience-lists/') && request.method == 'PATCH') {
      final id = path.split('/').last;
      final list = lists.firstWhere((list) => list['id'] == id);
      if (body!['name'] != null) list['name'] = body['name'];
      if (body['memberUserIds'] != null) {
        list['memberUserIds'] = body['memberUserIds'];
      }
      return _ok({'list': list});
    }
    if (path.contains('/connect/audience-lists/') && request.method == 'DELETE') {
      final id = path.split('/').last;
      lists.removeWhere((list) => list['id'] == id);
      return _ok({'id': id});
    }
    if (path.endsWith('/connect/posts') && request.method == 'POST') {
      postedBody = body;
      final listId = (body!['body'] as Map)['listId'];
      return _ok({
        'post': {
          'id': 'post-1',
          'type': 'new_post',
          'tag': 'New Post',
          'author': {
            'userId': 'viewer',
            'name': 'Viewer Person',
            'initials': 'VP',
          },
          'audience': {
            'label': listId == null
                ? 'Public'
                : lists.firstWhere((list) => list['id'] == listId)['name'],
            'listId': ?listId,
          },
          'body': {'text': (body['body'] as Map)['text'], 'postKind': 'text'},
          'liked': false,
          'likeCount': 0,
          'commentCount': 0,
          'comments': <dynamic>[],
          'publishedAt': '2026-10-12T06:00:00.000Z',
        },
      }, 201);
    }
    return _ok({});
  });

  int count(String method, String pathEnd) => requests
      .where((request) => request.$1 == method && request.$2.endsWith(pathEnd))
      .length;
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
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 150));
  }
}

/// The feed, then the composer opened from "Start a post".
Future<ConnectBloc> _openComposer(WidgetTester tester, _Server server) async {
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
    socket: _QuietSocket(),
  );
  await bloc.load();
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(fontFamily: 'Plus Jakarta Sans'),
      home: Scaffold(
        body: ConnectFeedScreen(
          session: _session,
          profileAction: const SizedBox.shrink(),
          bloc: bloc,
        ),
      ),
    ),
  );
  await _settle(tester);
  await tester.tap(find.text('Start a post.....'));
  await _settle(tester);
  expect(find.byKey(const ValueKey('composer-audience')), findsOneWidget);
  return bloc;
}

Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

Future<void> _openSheet(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('composer-audience')));
  await _settle(tester);
  expect(find.text('Who can see this post'.toUpperCase()), findsOneWidget);
}

/// Names in the picker, top to bottom.
List<String> _pickerNames(WidgetTester tester) {
  final rows = find.descendant(
    of: find.byKey(const ValueKey('audience-people')),
    matching: find.byWidgetPredicate(
      (widget) =>
          widget.key is ValueKey &&
          '${(widget.key! as ValueKey).value}'.startsWith('audience-person-'),
    ),
  );
  final found = rows.evaluate().toList()
    ..sort(
      (a, b) => tester
          .getTopLeft(find.byWidget(a.widget))
          .dy
          .compareTo(tester.getTopLeft(find.byWidget(b.widget)).dy),
    );
  return [
    for (final element in found)
      '${(element.widget.key! as ValueKey).value}'.substring(
        'audience-person-'.length,
      ),
  ];
}

Finder _person(String id) => find.byKey(ValueKey('audience-person-$id'));

String _composerLabel(WidgetTester tester) {
  final chip = find.byKey(const ValueKey('composer-audience'));
  return tester
      .widgetList<Text>(find.descendant(of: chip, matching: find.byType(Text)))
      .map((text) => text.data ?? '')
      .join();
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('a list is made from the whole company — A to Z, without the '
      'viewer — by comma search and select all, reviewed, saved, chosen, '
      'and the post goes to it', (tester) async {
    final server = _Server();
    final bloc = await _openComposer(tester, server);
    expect(_composerLabel(tester), 'Public');

    await _openSheet(tester);
    // A manager's Team is their direct reports.
    expect(find.text('Your direct reports'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('audience-create')));
    await _settle(tester);

    // The whole company, A to Z, and never the viewer.
    expect(_pickerNames(tester), ['aarav', 'ishita', 'kabir', 'meera', 'tara']);
    expect(find.text('Viewer Person'), findsNothing);
    expect(find.text('5 people'), findsOneWidget);

    // Several names at once: everyone each matches shows, and each name that
    // matches one person ticks them.
    await tester.enterText(
      find.byKey(const ValueKey('audience-search')),
      'aarav, ishita, meera',
    );
    await tester.pump(const Duration(milliseconds: 900));
    await _settle(tester);
    expect(_pickerNames(tester), ['aarav', 'ishita', 'meera']);
    expect(find.text('3 people selected'), findsOneWidget);

    // Select all ticks everyone shown; with a search cleared, that is
    // everyone, and tapping again unticks them all.
    await tester.tap(find.byKey(const ValueKey('audience-search-clear')));
    await _settle(tester);
    expect(_pickerNames(tester), hasLength(5));
    await tester.tap(find.byKey(const ValueKey('audience-select-all')));
    await _settle(tester);
    expect(find.text('5 people selected'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('audience-select-all')));
    await _settle(tester);
    expect(find.text('5 people selected'), findsNothing);

    // Three picked by hand, then the review.
    for (final id in ['aarav', 'ishita', 'meera']) {
      await tester.tap(_person(id));
      await tester.pump();
    }
    await _settle(tester);
    expect(find.text('3 people selected'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('audience-selection-bar')));
    await _settle(tester);
    expect(find.text('Review list'), findsOneWidget);
    expect(find.text('Create list · 3'), findsOneWidget);

    // One taken off, and the list named.
    await tester.tap(find.byKey(const ValueKey('audience-remove-ishita')));
    await _settle(tester);
    expect(find.text('Create list · 2'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('audience-list-name')),
      '3D Gurugram',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('audience-save')));
    await _settle(tester);

    // Saved through the API with exactly those people, and now the audience.
    final create = server.requests.singleWhere(
      (request) =>
          request.$1 == 'POST' && request.$2.endsWith('/audience-lists'),
    );
    expect(create.$3!['name'], '3D Gurugram');
    expect(
      (create.$3!['memberUserIds'] as List).toSet(),
      {'aarav', 'meera'},
    );
    expect(find.text('Review list'), findsNothing);
    expect(find.byType(AudienceListPicker), findsNothing);
    expect(_composerLabel(tester), '3D Gurugram');

    // The post goes out to the list, by its id.
    await tester.enterText(
      find.byKey(const ValueKey('quick-post-caption')),
      'Render review at 4',
    );
    await tester.pump();
    await tester.tap(find.text('Post'));
    await _settle(tester);
    final sent = server.postedBody!['body'] as Map<String, dynamic>;
    expect(sent['sendTo'], 'list');
    expect(sent['listId'], 'list-new');
    expect(sent['text'], 'Render review at 4');
    // The card that stands in while it publishes says where it is going.
    expect(bloc.state.posts.first.audience.label, '3D Gurugram');
    expect(bloc.state.posts.first.audience.listId, 'list-new');

    await _tearDown(tester, bloc);
  });

  testWidgets('a saved list is chosen from the sheet, and the post carries '
      'its id; Public sends no list', (tester) async {
    final server = _Server(
      lists: [
        {
          'id': 'crew',
          'name': '3d crew',
          'memberUserIds': ['aarav', 'meera', 'tara'],
        },
      ],
    );
    final bloc = await _openComposer(tester, server);
    await _openSheet(tester);
    expect(find.text('3d crew'), findsOneWidget);
    expect(find.text('3 people'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('audience-list-crew')));
    await _settle(tester);
    expect(_composerLabel(tester), '3d crew');

    // And back to Public.
    await _openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('audience-public')));
    await _settle(tester);
    expect(_composerLabel(tester), 'Public');
    await tester.enterText(
      find.byKey(const ValueKey('quick-post-caption')),
      'Hello all',
    );
    await tester.pump();
    await tester.tap(find.text('Post'));
    await _settle(tester);
    final sent = server.postedBody!['body'] as Map<String, dynamic>;
    expect(sent.containsKey('listId'), isFalse);
    expect(sent['sendTo'], isNot('list'));

    // The lists were asked for once for the session, not on every opening.
    expect(server.count('GET', '/connect/audience-lists'), 1);
    await _tearDown(tester, bloc);
  });

  testWidgets('a list is edited — renamed, its people changed — and the '
      'composer follows it; deleting the chosen list falls back to Public', (
    tester,
  ) async {
    final server = _Server(
      lists: [
        {
          'id': 'crew',
          'name': '3d crew',
          'memberUserIds': ['aarav', 'meera'],
        },
      ],
    );
    final bloc = await _openComposer(tester, server);
    await _openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('audience-list-crew')));
    await _settle(tester);
    expect(_composerLabel(tester), '3d crew');

    // Edit from the list's "⋯" menu: the picker opens with its people ticked.
    await _openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('audience-list-crew-menu')));
    await _settle(tester);
    await tester.tap(find.text('Edit list'));
    await _settle(tester);
    expect(find.text('2 people selected'), findsOneWidget);
    await tester.tap(_person('kabir'));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('audience-selection-bar')));
    await _settle(tester);
    expect(find.text('Save list · 3'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('audience-list-name')),
      'Lighting crew',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('audience-save')));
    await _settle(tester);
    final patch = server.requests.singleWhere(
      (request) => request.$1 == 'PATCH',
    );
    expect(patch.$2, endsWith('/connect/audience-lists/crew'));
    expect(patch.$3!['name'], 'Lighting crew');
    expect(
      (patch.$3!['memberUserIds'] as List).toSet(),
      {'aarav', 'meera', 'kabir'},
    );
    // Back on the sheet with the new name; put away, the composer follows.
    expect(find.text('Lighting crew'), findsOneWidget);
    expect(find.text('3 people'), findsOneWidget);
    await tester.tapAt(const Offset(20, 100));
    await _settle(tester);
    expect(_composerLabel(tester), 'Lighting crew');

    // Delete, confirmed: gone from the server and the sheet, and the post
    // that was going to it goes to Public.
    await _openSheet(tester);
    await tester.longPress(find.byKey(const ValueKey('audience-list-crew')));
    await _settle(tester);
    await tester.tap(find.text('Delete list'));
    await _settle(tester);
    await tester.tap(find.text('Delete'));
    await _settle(tester);
    expect(server.count('DELETE', '/connect/audience-lists/crew'), 1);
    // Gone from the sheet (the composer behind it moves on once it closes).
    expect(
      find.descendant(of: find.byType(BottomSheet), matching: find.text('Lighting crew')),
      findsNothing,
    );
    await tester.tapAt(const Offset(20, 100));
    await _settle(tester);
    expect(_composerLabel(tester), 'Public');

    await _tearDown(tester, bloc);
  });

  test('the audience a post body carries, and the label it shows', () {
    const list = AudienceListSummary(
      id: 'crew',
      name: '3d crew',
      memberIds: ['a'],
    );
    expect(audienceBodyFields(const PublicAudience()), {
      'sendTo': 'all_company',
    });
    expect(audienceBodyFields(const TeamAudience()), {'sendTo': 'my_team'});
    expect(audienceBodyFields(const ListAudience(list)), {
      'sendTo': 'list',
      'listId': 'crew',
    });
    expect(audienceChoiceLabel(const ListAudience(list)), '3d crew');
    // The author is sent the list; everyone else only "Private".
    final mine = ConnectAudience.fromJson({
      'label': '3d crew',
      'listId': 'crew',
    });
    final theirs = ConnectAudience.fromJson({'label': 'Private'});
    expect(mine.isList, isTrue);
    expect(mine.label, '3d crew');
    expect(theirs.isList, isTrue);
    expect(theirs.listId, isNull);
    expect(ConnectAudience.fromJson({'label': 'Public'}).isList, isFalse);
  });

  test('the directory comes A to Z without the viewer, with department and '
      'city', () async {
    final server = _Server();
    final store = AudienceListsStore(
      session: _session,
      api: ConnectApiService(
        session: _session,
        baseUrl: 'https://example.test',
        client: server.client,
      ),
    );
    final people = await store.loadPeople();
    expect(people.map((person) => person.id), [
      'aarav',
      'ishita',
      'kabir',
      'meera',
      'tara',
    ]);
    expect(people.first.department, '3D');
    expect(people.first.city, 'Gurugram');
    expect(people.first.initials, 'AM');
    // Asked for once.
    await store.loadPeople();
    expect(server.count('GET', '/audience-lists/people'), 1);
  });
}
