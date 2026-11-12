// The viewer's own contest entry shows their profile photo, on the feed card
// and on the entries page, even from a server that sends no entrant photos:
// the directory the cards fall back on leaves the viewer out.
import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/bloc/connect_bloc.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/connect/data/connect_socket_service.dart';
import 'package:mobile_app/features/connect/presentation/connect_feed_screen.dart';

const _myPhoto = 'https://example.test/photos/viewer-face.jpg';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'viewer',
    email: 'viewer@example.test',
    name: 'Ananya Bisht',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
    profilePhotoUrl: _myPhoto,
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

Map<String, dynamic> _entry(String id, String userId, {bool mine = false}) => {
  'id': id,
  'userId': userId,
  'name': mine ? 'Ananya Bisht' : 'Person $id',
  'initials': mine ? 'AB' : id.toUpperCase(),
  'text': 'When the build finally passes on a Friday',
  'votes': mine ? 3 : 1,
  'points': mine ? 30 : 10,
  'votedByViewer': false,
  'isMine': mine,
  'createdAt': '2026-11-12T06:00:00.000Z',
};

Map<String, dynamic> _contest() {
  final entries = [_entry('a', 'viewer', mine: true), _entry('b', 'other')];
  return {
    'id': 'contest',
    'type': 'caption_challenge',
    'tag': 'Contest',
    'author': {
      'userId': 'author',
      'name': 'Sowaka Engagement',
      'initials': 'SE',
    },
    'audience': {'label': 'Public'},
    'body': {
      'title': 'Caption this',
      'pointsPerVote': 10,
      'closesAt': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'entries': entries,
      'leaderboard': [
        for (final (i, e) in entries.indexed) {...e, 'rank': i + 1},
      ],
      'myEntryId': 'a',
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-11-12T06:00:00.000Z',
  };
}

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

String _urlOf(ImageProvider provider) {
  if (provider is ResizeImage) return _urlOf(provider.imageProvider);
  if (provider is CachedNetworkImageProvider) return provider.url;
  if (provider is NetworkImage) return provider.url;
  return provider.toString();
}

Finder _myFace() => find.byWidgetPredicate(
  (widget) =>
      widget is Image && _urlOf(widget.image).contains('viewer-face.jpg'),
);

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

void main() {
  setUpAll(_loadFonts);

  testWidgets(
    'my own entry shows my profile photo on the card and the entries page',
    (tester) async {
      tester.view.physicalSize = const Size(1179, 2556);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final contest = _contest();
      final client = MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/connect/feed'))
          return _ok({
            'posts': [contest],
          });
        if (path.endsWith('/connect/posts/contest'))
          return _ok({'post': contest});
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

      // On the feed card: my entry is first in the carousel.
      expect(_myFace(), findsWidgets);

      // On the entries page too.
      await tester.ensureVisible(find.text('View Entries'));
      await tester.pump();
      await tester.tap(find.text('View Entries'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.text('Leaderboard'), findsOneWidget);
      expect(_myFace(), findsWidgets);

      await tester.pumpWidget(const SizedBox.shrink());
      bloc.dispose();
    },
  );
}
