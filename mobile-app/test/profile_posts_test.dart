// The Post tab on a profile: on every profile where the company has Connect,
// after Rank, with a count; the person's posts as the feed's own cards, a page
// at a time; "No posts yet."; and a failed or slow load that says so, with a
// retry, while the rest of the profile carries on. What is done to a post
// there reaches the feed under it.
import 'dart:async';
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
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/profile/profile.dart';

http.Response _ok(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode({'success': true, ...body})),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Map<String, dynamic> _post(String id, String text, {String author = 'rana'}) => {
  'id': id,
  'type': 'new_post',
  'tag': 'Post',
  'author': {'userId': author, 'name': 'Rana', 'initials': 'R'},
  'audience': {'label': 'Public'},
  'body': {'text': text},
  'liked': false,
  'likeCount': 0,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-10-10T06:00:00.000Z',
};

AuthSession _sessionFor({List<String> enabledTabs = const []}) => AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'pankaj',
    email: 'pankaj@example.test',
    name: 'Pankaj',
    role: 'manager',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: enabledTabs,
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

/// A person's posts never come from the device's copy of the feed.
class _NoCacheApi extends ConnectApiService {
  _NoCacheApi(MockClient client)
    : super(session: _sessionFor(), baseUrl: 'https://example.test', client: client);

  @override
  Future<({List<ConnectPost> posts, String? nextCursor})?> fetchFeedFromCache() =>
      throw StateError('a profile read the feed cache');
}

/// The shell, signed in as Pankaj, with Rana in his team list but not
/// reporting to him. [posts] answers every Connect request.
Future<ManagerBloc> _boot(
  WidgetTester tester,
  Future<http.Response> Function(http.Request request) posts, {
  List<String> enabledTabs = const [],
}) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  Map<String, dynamic> member(String name, {bool isSelf = false}) => {
    'userId': name.toLowerCase(),
    'name': name,
    'department': 'Faculty',
    'designation': 'Lecturer',
    'reportsToViewer': false,
    'inViewerChain': false,
    'isSelf': isSelf,
    'email': '${name.toLowerCase()}@example.test',
    'parameters': <dynamic>[],
    'history': <dynamic>[],
  };
  final workspace = {
    'team': [member('Pankaj', isSelf: true), member('Rana')],
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
    if (request.url.path.endsWith('/manager/workspace')) return _ok(workspace);
    return _ok({
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  });
  ConnectApiService.testClient = MockClient((request) {
    if (request.url.path.endsWith('/connect/feed')) {
      return Future.value(_ok({'posts': <dynamic>[], 'nextCursor': null}));
    }
    return posts(request);
  });
  addTearDown(() => ConnectApiService.testClient = null);
  ProfileApiService.testClient = MockClient(
    (request) async => http.Response('{"success":false}', 404),
  );
  addTearDown(() => ProfileApiService.testClient = null);
  final session = _sessionFor(enabledTabs: enabledTabs);
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
    MaterialApp(home: ManagerScreen(session: session, bloc: bloc)),
  );
  await tester.pumpAndSettle(const Duration(seconds: 1));
  return bloc;
}

Future<void> _close(WidgetTester tester, ManagerBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
  // The shell's launch leaves time limits running (the notification
  // service's wait for its token among them); they run out here rather than
  // outliving the test.
  await tester.pump(const Duration(seconds: 30));
}

Future<void> _openPostTab(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Post'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Post'));
  await tester.pumpAndSettle();
}

Finder _text(String text) => find.textContaining(text, findRichText: true);

void main() {
  group('which profiles have it', () {
    test('every one, after Rank', () {
      for (final tabs in [
        colleagueProfileTabs,
        memberProfileTabs(inViewerChain: true, viewerCanManage: true, hasDocuments: true),
        ownProfileTabs(hasManager: true, showsHelp: true),
      ]) {
        expect(tabs.indexOf(ProfileTab.posts), tabs.indexOf(ProfileTab.rank) + 1);
      }
      expect(ProfileTab.posts.label, 'Post');
    });

    test('only where the company has Connect', () {
      expect(profileShowsPosts(const []), isTrue);
      expect(profileShowsPosts(const ['connect', 'team']), isTrue);
      expect(profileShowsPosts(const ['team', 'grow', 'actions']), isFalse);
    });
  });

  group('one person\'s posts, in the feed\'s own bloc', () {
    test('a page at a time, with the count, never from the device', () async {
      final asked = <Uri>[];
      final bloc = ConnectBloc(
        session: _sessionFor(),
        api: _NoCacheApi(
          MockClient((request) async {
            asked.add(request.url);
            final cursor = request.url.queryParameters['cursor'];
            return cursor == null
                ? _ok({
                    'posts': [for (var i = 1; i <= 5; i++) _post('p$i', 'Post $i')],
                    'nextCursor': 'after-5',
                    'total': 6,
                  })
                : _ok({'posts': [_post('p6', 'Post 6')], 'nextCursor': null});
          }),
        ),
        socket: _QuietSocket(),
        authorUserId: 'rana',
      );
      await bloc.load();
      await Future<void>.delayed(Duration.zero);
      expect(asked.first.path, '/connect/users/rana/posts');
      expect(asked.first.queryParameters['limit'], '5');
      expect(asked.last.queryParameters['cursor'], 'after-5');
      expect(bloc.state.posts.map((post) => post.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
      expect(bloc.state.total, 6);
      expect(bloc.state.hasMore, isFalse);
      bloc.dispose();
    });

    test('a like and a delete there reach the feed under it', () async {
      final saved = <ConnectPost>[];
      final deleted = <String>[];
      final bloc = ConnectBloc(
        session: _sessionFor(),
        api: _NoCacheApi(
          MockClient((request) async {
            if (request.url.path.endsWith('/reaction')) {
              return _ok({'post': {..._post('p1', 'Post 1'), 'liked': true, 'likeCount': 1}});
            }
            if (request.method == 'DELETE') return _ok({'id': 'p2'});
            return _ok({
              'posts': [_post('p1', 'Post 1'), _post('p2', 'Post 2')],
              'nextCursor': null,
              'total': 2,
            });
          }),
        ),
        socket: _QuietSocket(),
        authorUserId: 'rana',
        onPostSaved: saved.add,
        onPostDeleted: deleted.add,
      );
      await bloc.load();
      await bloc.toggleReaction('p1');
      expect(saved.single.liked, isTrue);
      await bloc.deletePost('p2');
      expect(deleted, ['p2']);
      expect(bloc.state.total, 1);

      // The feed takes in only what it has loaded.
      final feed = ConnectBloc(
        session: _sessionFor(),
        api: ConnectApiService(
          session: _sessionFor(),
          baseUrl: 'https://example.test',
          client: MockClient(
            (request) async => _ok({
              'posts': [_post('p1', 'Post 1'), _post('p2', 'Post 2')],
              'nextCursor': null,
            }),
          ),
        ),
        socket: _QuietSocket(),
      );
      await feed.load();
      feed.adoptPost(saved.single);
      feed.adoptPost(ConnectPost.fromJson(_post('elsewhere', 'Not in the feed')));
      feed.forgetPost('p2');
      expect(feed.state.posts.map((post) => post.id), ['p1']);
      expect(feed.state.posts.single.liked, isTrue);
      bloc.dispose();
      feed.dispose();
    });

    testWidgets('a page that never comes gives up and says so', (tester) async {
      final api = ConnectApiService(
        session: _sessionFor(),
        baseUrl: 'https://example.test',
        client: MockClient((request) => Completer<http.Response>().future),
      );
      Object? failure;
      unawaited(api.fetchPersonPosts('rana').catchError((Object error) {
        failure = error;
        return (posts: <ConnectPost>[], nextCursor: null, total: null);
      }));
      await tester.pump(ConnectApiService.personPostsLimit - const Duration(seconds: 1));
      expect(failure, isNull);
      await tester.pump(const Duration(seconds: 2));
      expect(failure, isA<ConnectTimeoutException>());
    });
  });

  group('the tab on a profile', () {
    testWidgets('their posts as the feed draws them, with the count', (tester) async {
      final asked = <Uri>[];
      final bloc = await _boot(tester, (request) async {
        asked.add(request.url);
        return request.url.queryParameters['cursor'] == null
            ? _ok({
                'posts': [for (var i = 1; i <= 5; i++) _post('p$i', 'Hello from Rana $i')],
                'nextCursor': 'after-5',
                'total': 7,
              })
            : _ok({
                'posts': [_post('p6', 'Hello from Rana 6'), _post('p7', 'Hello from Rana 7')],
                'nextCursor': null,
              });
      });
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();

      // Asked for as the page opens, so the badge is there before the tab is.
      expect(find.text('Post'), findsOneWidget);
      expect(find.text('7'), findsOneWidget);
      await _openPostTab(tester);
      expect(_text('Hello from Rana 1'), findsOneWidget);
      // The next page, as the end of the loaded ones comes near.
      await tester.drag(find.byType(CustomScrollView).last, const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(asked.any((url) => url.queryParameters['cursor'] == 'after-5'), isTrue);
      expect(_text('Hello from Rana 7'), findsOneWidget);
      expect(asked.every((url) => url.path == '/connect/users/rana/posts'), isTrue);
      await _close(tester, bloc);
    });

    testWidgets('nobody\'s posts yet', (tester) async {
      final bloc = await _boot(
        tester,
        (request) async => _ok({'posts': <dynamic>[], 'nextCursor': null, 'total': 0}),
      );
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();
      await _openPostTab(tester);
      expect(find.text('No posts yet.'), findsOneWidget);
      await _close(tester, bloc);
    });

    testWidgets('a failed load says so and tries again, the profile unharmed', (
      tester,
    ) async {
      var fail = true;
      final bloc = await _boot(tester, (request) async {
        if (fail) {
          return http.Response(jsonEncode({'success': false, 'message': 'Server busy'}), 500);
        }
        return _ok({'posts': [_post('p1', 'Back again')], 'nextCursor': null, 'total': 1});
      });
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();
      await _openPostTab(tester);
      expect(find.text('Server busy'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);

      // The other tabs are as they were.
      await tester.ensureVisible(find.text('Work detail'));
      await tester.tap(find.text('Work detail'));
      await tester.pumpAndSettle();
      expect(find.text('Department'), findsOneWidget);

      fail = false;
      await _openPostTab(tester);
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(_text('Back again'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
      await _close(tester, bloc);
    });

    testWidgets('a load that never answers gives up on its own', (tester) async {
      final bloc = await _boot(tester, (request) => Completer<http.Response>().future);
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();
      await _openPostTab(tester);
      await tester.pump(ConnectApiService.personPostsLimit + const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.text('Sowaka is taking too long to answer. Try again.'), findsOneWidget);
      await _close(tester, bloc);
    });

    testWidgets('one\'s own profile has it too', (tester) async {
      final asked = <Uri>[];
      final bloc = await _boot(tester, (request) async {
        asked.add(request.url);
        return _ok({'posts': [_post('mine', 'My own post', author: 'pankaj')], 'nextCursor': null, 'total': 1});
      });
      expect(openPersonProfile('pankaj'), isTrue);
      await tester.pumpAndSettle();
      await _openPostTab(tester);
      expect(_text('My own post'), findsOneWidget);
      expect(asked.first.path, '/connect/users/pankaj/posts');
      await _close(tester, bloc);
    });

    testWidgets('not where the company has no Connect', (tester) async {
      final bloc = await _boot(
        tester,
        (request) async => fail('nothing should ask for posts'),
        enabledTabs: const ['team', 'grow', 'actions'],
      );
      expect(openPersonProfile('rana'), isTrue);
      await tester.pumpAndSettle();
      expect(find.text('Post'), findsNothing);
      await _close(tester, bloc);
    });
  });
}
