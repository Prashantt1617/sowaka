// A name or a face in the Connect feed opens that person's profile: the
// author of a post, the people in the two comment previews under it — on a
// poll card too — and the entrants on a contest's entries sheet.
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
    name: 'Viewer',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    interests: [],
  ),
);

Map<String, dynamic> _comment(String id, String userId, String name) => {
  'id': id,
  'userId': userId,
  'name': name,
  'text': 'Nice one',
  'createdAt': '2026-09-28T06:00:00.000Z',
};

Map<String, dynamic> _post(
  String id,
  String type,
  Map<String, dynamic> body, {
  List<Map<String, dynamic>> comments = const [],
}) => {
  'id': id,
  'type': type,
  'tag': type,
  'author': {
    'userId': 'author-$id',
    'name': 'Author $id',
    'initials': 'A',
    'designation': 'Designer',
  },
  'audience': {'label': 'Public'},
  'body': body,
  'likeCount': 0,
  'commentCount': comments.length,
  'comments': comments,
  'publishedAt': '2026-09-28T06:00:00.000Z',
};

Future<(List<String>, ConnectBloc)> _pumpFeed(
  WidgetTester tester,
  Map<String, dynamic> post,
) async {
  tester.view.physicalSize = const Size(1179, 2556 * 2);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/connect/feed')) {
      return http.Response(
        jsonEncode({
          'success': true,
          'posts': [post],
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
  );
  await bloc.load();

  final opened = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ConnectFeedScreen(
          session: _session,
          profileAction: const SizedBox.shrink(),
          bloc: bloc,
          onOpenPerson: opened.add,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  return (opened, bloc);
}

/// Takes the feed down before the test ends: the bloc's live connection
/// leaves a timer behind otherwise.
Future<void> _tearDown(WidgetTester tester, ConnectBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

void main() {
  testWidgets('a post author and the commenters under it open profiles', (
    tester,
  ) async {
    final (opened, bloc) = await _pumpFeed(
      tester,
      _post(
        '1',
        'new_post',
        {'text': 'Hello team', 'mediaKind': 'none'},
        comments: [
          _comment('c1', 'riya', 'Riya Sharma'),
          _comment('c2', 'kabir', 'Kabir Shah'),
        ],
      ),
    );
    await tester.tap(find.text('Author 1'));
    await tester.tap(find.text('Riya Sharma'));
    await tester.tap(find.text('Kabir Shah'));
    expect(opened, ['author-1', 'riya', 'kabir']);
    await _tearDown(tester, bloc);
  });

  testWidgets('a tag in a comment opens the person it names', (tester) async {
    final (opened, bloc) = await _pumpFeed(
      tester,
      _post(
        '4',
        'new_post',
        {'text': 'Hello team', 'mediaKind': 'none'},
        comments: [
          {
            ..._comment('c4', 'riya', 'Riya Sharma'),
            'text': 'Thanks @Ana Bisht and @Ana, cc @Anaya',
            'mentions': [
              {'userId': 'ana', 'name': 'Ana'},
              {'userId': 'ana-bisht', 'name': 'Ana Bisht'},
            ],
          },
        ],
      ),
    );
    // The longer name is read whole, the shorter one only where it stands
    // alone — "@Anaya" is somebody else, untagged.
    expect(find.text('@Anaya'), findsNothing);
    await tester.tap(find.text('@Ana Bisht'));
    await tester.tap(find.text('@Ana'));
    expect(opened, ['ana-bisht', 'ana']);
    await _tearDown(tester, bloc);
  });

  testWidgets('the poll card opens its author and commenters', (tester) async {
    final (opened, bloc) = await _pumpFeed(
      tester,
      _post(
        '2',
        'survey',
        {
          'title': 'Where to?',
          'options': [
            {'id': 'a', 'label': 'Bowling', 'votes': 1},
            {'id': 'b', 'label': 'Cricket', 'votes': 0},
          ],
        },
        comments: [_comment('c3', 'james', 'James Lee')],
      ),
    );
    await tester.tap(find.text('Author 2'));
    await tester.tap(find.text('James Lee'));
    expect(opened, ['author-2', 'james']);
    await _tearDown(tester, bloc);
  });

  testWidgets('an entrant on the entries sheet opens their profile', (
    tester,
  ) async {
    final entry = {
      'id': 'e1',
      'userId': 'meena',
      'name': 'Meena Nair',
      'initials': 'MN',
      'text': 'Purr my last email',
      'votes': 2,
      'points': 20,
      'votedByViewer': false,
      'isMine': false,
      'createdAt': '2026-09-28T07:00:00.000Z',
    };
    final (opened, bloc) = await _pumpFeed(
      tester,
      _post('3', 'caption_challenge', {
        'title': 'Caption this',
        'pointsPerVote': 10,
        'entries': [entry],
        'leaderboard': [
          {...entry, 'rank': 1},
        ],
      }),
    );
    await tester.tap(find.text('View Entries'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Meena Nair').last);
    expect(opened, ['meena']);
    await _tearDown(tester, bloc);
  });
}
