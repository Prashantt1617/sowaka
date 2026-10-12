// A post with media reads as the design draws it (node 400:9408): the
// photos first, what the author wrote under them, then the likes and
// comments, each 12 apart. A post with no caption leaves no gap for one, and
// a text-only post is as it was. The composer shows a post the same way.
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

/// A one-pixel photo, inline, so nothing goes to the network.
const _photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const _caption = 'Planning day with the whole team';

Map<String, dynamic> _post(
  Map<String, dynamic> body, {
  String type = 'new_post',
  String authorId = 'author-1',
}) => {
  'id': 'p1',
  'type': type,
  'tag': type,
  'author': {
    'userId': authorId,
    'name': 'Author One',
    'initials': 'A',
    'designation': 'Designer',
  },
  'audience': {'label': 'Public'},
  'body': body,
  'likeCount': 0,
  'commentCount': 0,
  'comments': const [],
  'publishedAt': '2026-09-28T06:00:00.000Z',
};

Future<ConnectBloc> _pumpFeed(
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

/// The post's photo: the inline one above, not the app's own artwork.
final _photos = find.byWidgetPredicate(
  (widget) => widget is Image && widget.image is MemoryImage,
);

/// The post's photo frame.
Rect _media(WidgetTester tester) => tester.getRect(_photos.first);

/// The top edge of the action bar: the hairline the likes sit under.
double _actionBarTop(WidgetTester tester) => tester
    .getRect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Container &&
            widget.decoration is BoxDecoration &&
            (widget.decoration! as BoxDecoration).border ==
                const Border(top: BorderSide(color: Color(0x66EBEBEB))),
      ),
    )
    .top;

void main() {
  testWidgets('the caption sits under the photo, 12 below it', (tester) async {
    final bloc = await _pumpFeed(
      tester,
      _post({'text': _caption, 'mediaKind': 'image', 'mediaUrl': _photo}),
    );
    final media = _media(tester);
    final caption = tester.getRect(find.text(_caption));
    expect(caption.top, closeTo(media.bottom + 12, 0.01));
    expect(_actionBarTop(tester), closeTo(caption.bottom + 12, 0.01));
    // In line with the photo, not the old full-bleed strip.
    expect(caption.left, media.left);
    await _tearDown(tester, bloc);
  });

  testWidgets('with no caption the action bar sits 12 under the photo', (
    tester,
  ) async {
    final bloc = await _pumpFeed(
      tester,
      _post({'text': '  \n ', 'mediaKind': 'image', 'mediaUrl': _photo}),
    );
    expect(_actionBarTop(tester), closeTo(_media(tester).bottom + 12, 0.01));
    await _tearDown(tester, bloc);
  });

  testWidgets('a leadership post with photos puts its message under them', (
    tester,
  ) async {
    final bloc = await _pumpFeed(
      tester,
      _post({
        'text': _caption,
        'mediaKind': 'image',
        'mediaUrls': [_photo, _photo],
      }, type: 'leadership'),
    );
    expect(
      tester.getRect(find.text(_caption)).top,
      closeTo(_media(tester).bottom + 12, 0.01),
    );
    await _tearDown(tester, bloc);
  });

  testWidgets('a text-only post keeps its text where it was', (tester) async {
    final bloc = await _pumpFeed(
      tester,
      _post({'text': _caption, 'mediaKind': 'none'}),
    );
    expect(_photos, findsNothing);
    final text = tester.getRect(find.text(_caption));
    final header = tester.getRect(find.text('Author One'));
    expect(text.top, greaterThan(header.bottom));
    expect(_actionBarTop(tester), closeTo(text.bottom + 14, 0.01));
    await _tearDown(tester, bloc);
  });

  testWidgets('editing a photo post shows the photo above the message', (
    tester,
  ) async {
    final bloc = await _pumpFeed(
      tester,
      _post({
        'postKind': 'media',
        'text': _caption,
        'mediaKind': 'image',
        'mediaUrl': _photo,
        'mediaObjectKey': 'connect/p1.png',
      }, authorId: 'viewer'),
    );
    await tester.tap(
      find.byWidgetPredicate((widget) => widget is PopupMenuButton),
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Edit post'));
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 300));
    }

    final mediaLabel = tester.getRect(find.text('VIDEO OR PHOTO'));
    final message = tester.getRect(
      find.byKey(const ValueKey('composer-message')),
    );
    final preview = tester.getRect(_photos.last);
    expect(preview.top, greaterThan(mediaLabel.bottom));
    expect(message.top, greaterThan(preview.bottom));
    expect(find.text(_caption), findsOneWidget);
    await _tearDown(tester, bloc);
  });
}
