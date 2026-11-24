// HR's "Start a tour" post (`app_tour`): the type goes to and from the wire,
// an unknown type still reads as a plain post (what builds from before this
// card do with it), and the card draws HR's title, caption and button, the
// tour's own art until there is a picture, and opens the tour's start card.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/app_tour/app_tour.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';
import 'package:mobile_app/features/connect/presentation/app_tour_post_card.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart' show ManagerTab;

ConnectPost _post({Map<String, dynamic> body = const {}}) => ConnectPost.fromJson(_wire(body: body));

Map<String, dynamic> _wire({Map<String, dynamic> body = const {}, bool liked = false, int likeCount = 2}) => {
  'id': 'tour-1',
  'type': 'app_tour',
  'tag': 'App tour',
  'tagIcon': '🧭',
  'tagColor': '#0B6FAA',
  'tagTint': '#EEF5FB',
  'author': {'userId': '', 'name': 'Convrse', 'initials': 'C', 'designation': 'HR', 'avatarColor': '#0B6FAA'},
  'audience': {'label': 'Public'},
  'body': {
    'title': 'Take the Sowaka tour',
    'caption': 'See where everything lives in Connect in about a minute.',
    'actionLabel': 'Get tour',
    'text': 'Take the Sowaka tour\n\nSee where everything lives.\n\nUpdate the Sowaka app to take the tour.',
    'mediaKind': 'none',
    ...body,
  },
  'liked': liked,
  'likeCount': likeCount,
  'commentCount': 0,
  'comments': <dynamic>[],
  'publishedAt': '2026-11-24T06:00:00.000Z',
};

http.Response _ok(Map<String, dynamic> body) => http.Response.bytes(
  utf8.encode(jsonEncode({'success': true, ...body})),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Widget _frame(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: SizedBox(width: 361, child: child))),
);

void main() {
  group('the type on the wire', () {
    test('app_tour both ways', () {
      expect(_post().type, ConnectPostType.appTour);
      expect(connectPostTypeToWire(ConnectPostType.appTour), 'app_tour');
    });

    test('every type comes back as itself', () {
      for (final type in ConnectPostType.values) {
        final post = ConnectPost.fromJson({'id': 'x', 'type': connectPostTypeToWire(type)});
        expect(post.type, type, reason: connectPostTypeToWire(type));
      }
    });

    test('a type this build does not know is a plain post, as before', () {
      expect(ConnectPost.fromJson({'id': 'x', 'type': 'something_new'}).type, ConnectPostType.leadership);
    });
  });

  group('the card', () {
    testWidgets('HR\'s title, caption and button, and the tour\'s art', (tester) async {
      await tester.pumpWidget(
        _frame(
          AppTourPostCard(
            post: _post(body: {'title': 'Find your way', 'caption': 'A minute, start to finish.', 'actionLabel': 'Show me'}),
            onGetTour: () {},
          ),
        ),
      );
      expect(find.text('Find your way'), findsOneWidget);
      expect(find.text('A minute, start to finish.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Show me'), findsOneWidget);
      expect(find.byKey(const ValueKey('app-tour-post-art')), findsOneWidget);
      // What older builds show is not on this card.
      expect(find.textContaining('Update the Sowaka app'), findsNothing);
    });

    testWidgets('empty slots read as the defaults', (tester) async {
      await tester.pumpWidget(
        _frame(AppTourPostCard(post: _post(body: {'title': '', 'caption': '', 'actionLabel': ' '}), onGetTour: () {})),
      );
      expect(find.text('Take the Sowaka tour'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Get tour'), findsOneWidget);
    });

    test('a picture only when the post carries one', () {
      expect(AppTourPostCard(post: _post()).imageUrl, isNull);
      expect(
        AppTourPostCard(post: _post(body: {'mediaKind': 'image', 'mediaUrl': '/media/connect/a.png'})).imageUrl,
        '/media/connect/a.png',
      );
    });

    testWidgets('Get tour starts the tour, once a tap', (tester) async {
      var started = 0;
      await tester.pumpWidget(_frame(AppTourPostCard(post: _post(), onGetTour: () => started++)));
      await tester.tap(find.byKey(const ValueKey('app-tour-post-start')));
      await tester.pump();
      expect(started, 1);
    });

    testWidgets('on its own it opens the tour\'s start card', (tester) async {
      final host = AppTourHost(
        tabs: () => const [ManagerTab.connect],
        showTab: (_, _) {},
        showTeamSection: (_) {},
        openHelp: () {},
        closeProfile: () {},
        isManager: () => false,
        firstName: () => 'Priya',
      );
      AppTour.register(host);
      addTearDown(() {
        AppTour.close();
        AppTour.unregister(host);
      });
      await tester.pumpWidget(_frame(AppTourPostCard(post: _post())));
      await tester.tap(find.byKey(const ValueKey('app-tour-post-start')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(AppTour.isRunning, isTrue);
      expect(find.byKey(const ValueKey('app-tour-start-card')), findsOneWidget);
      AppTour.close();
      await tester.pump();
    });

    testWidgets('with no app around it, a tap does nothing and breaks nothing', (tester) async {
      await tester.pumpWidget(_frame(AppTourPostCard(post: _post())));
      await tester.tap(find.byKey(const ValueKey('app-tour-post-start')));
      await tester.pump();
      expect(AppTour.isRunning, isFalse);
      expect(tester.takeException(), isNull);
    });
  });
  testWidgets('in the feed: the company\'s author row, the card, and likes as on any post', (tester) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final session = AuthSession(
      token: 'token',
      user: const AuthUser(
        id: 'viewer',
        email: 'viewer@example.test',
        name: 'Viewer',
        role: 'employee',
        company: 'Convrse',
        org: 'convrse',
        interests: [],
      ),
    );
    var post = _wire();
    final reactions = <Uri>[];
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/connect/feed')) {
        return _ok({'posts': [post]});
      }
      if (path.endsWith('/connect/posts/tour-1/reaction')) {
        reactions.add(request.url);
        post = _wire(liked: true, likeCount: 3);
        return _ok({'post': post});
      }
      return _ok({});
    });
    final bloc = ConnectBloc(
      session: session,
      api: ConnectApiService(session: session, baseUrl: 'https://example.test', client: client),
    );
    await bloc.load();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ConnectFeedScreen(session: session, profileAction: const SizedBox.shrink(), bloc: bloc),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.byType(AppTourPostCard), findsOneWidget);
    expect(find.text('Convrse'), findsWidgets);
    expect(find.text('Take the Sowaka tour'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Get tour'), findsOneWidget);
    // The text older builds show stays off this card.
    expect(find.textContaining('Update the Sowaka app'), findsNothing);
    final heart = find.byKey(const ValueKey('post-like-heart'));
    await tester.ensureVisible(heart);
    await tester.pump();
    await tester.tap(heart);
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(reactions, hasLength(1));

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
  });
}
