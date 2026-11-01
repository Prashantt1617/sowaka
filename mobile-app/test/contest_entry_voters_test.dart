// A photo contest's entries: who voted for an entry ("Voted by", opened from
// its vote count, as a like count opens the likes), deleting one of your own
// entries by its id when you have several, and tagging a colleague with "@"
// in a photo's story — sent to the server, and drawn as a link to their
// profile on the entry.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
// The platform behind `FilePicker.pickFiles`, swapped for a fake: on this
// test's platform the app's photo picker is the file browser.
// ignore: implementation_imports
import 'package:file_picker/src/platform/file_picker_platform_interface.dart';
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

Map<String, dynamic> _entry(
  String id, {
  required String userId,
  required String name,
  int votes = 0,
  String text = '',
  List<Map<String, String>> mentions = const [],
  String createdAt = '2026-10-31T06:00:00.000Z',
}) => {
  'id': id,
  'userId': userId,
  'name': name,
  'initials': name.substring(0, 1),
  'text': text,
  'votes': votes,
  'points': votes * 10,
  'votedByViewer': false,
  'isMine': userId == 'viewer',
  'createdAt': createdAt,
  if (mentions.isNotEmpty) 'mentions': mentions,
};

/// A photo contest as the server sends it: Manav's photo, which tags Chitra
/// in its story and has two votes, then the viewer's own two photos.
Map<String, dynamic> _contest({List<String> without = const []}) {
  final entries = [
    _entry(
      'manav-1',
      userId: 'manav',
      name: 'Manav Shah',
      votes: 2,
      text: 'Shot with @Chitra Rao on the roof',
      mentions: [
        {'userId': 'chitra', 'name': 'Chitra Rao'},
      ],
    ),
    _entry(
      'mine-1',
      userId: 'viewer',
      name: 'Vera Viewer',
      votes: 1,
      createdAt: '2026-10-31T07:00:00.000Z',
    ),
    _entry(
      'mine-2',
      userId: 'viewer',
      name: 'Vera Viewer',
      createdAt: '2026-10-31T08:00:00.000Z',
    ),
  ].where((entry) => !without.contains(entry['id'])).toList();
  final mine = [
    for (final entry in entries)
      if (entry['isMine'] == true) entry['id'] as String,
  ];
  return {
    'id': 'contest',
    'type': 'photo_story_challenge',
    'tag': 'Best Photo',
    'author': {'userId': 'author', 'name': 'HR', 'initials': 'H'},
    'audience': {'label': 'Public'},
    'body': {
      'title': 'Best photo',
      'task': 'Your best desk photo',
      'pointsPerVote': 10,
      'closesAt': DateTime.now()
          .add(const Duration(days: 1))
          .toUtc()
          .toIso8601String(),
      'entries': entries,
      'leaderboard': [
        for (final (index, entry) in entries.indexed)
          {...entry, 'rank': index + 1},
      ],
      // As the server says it below the limit of five: still null, so the
      // app keeps offering another photo.
      'myEntryId': null,
      'myEntryIds': mine,
      'maxEntries': 5,
      'myVoteEntryId': null,
    },
    'liked': false,
    'likeCount': 0,
    'commentCount': 0,
    'comments': <dynamic>[],
    'publishedAt': '2026-10-31T06:00:00.000Z',
  };
}

http.Response _ok(Map<String, dynamic> json) =>
    http.Response(jsonEncode({'success': true, ...json}), 200);

class _Server {
  Map<String, dynamic> contest = _contest();

  /// The entries whose voters were asked for.
  final voterReads = <String>[];

  /// The `entryId` each delete named (null: none named).
  final deletes = <String?>[];

  /// What each entry sent carried, from its multipart form.
  final sentText = <String>[];
  final sentMentions = <String?>[];

  /// Whose profile the page asked to open.
  final opened = <String>[];

  late final client = MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/auth/teammates')) {
      return _ok({
        'teammates': [
          for (final (id, name) in [
            ('viewer', 'Vera Viewer'),
            ('manav', 'Manav Shah'),
            ('chitra', 'Chitra Rao'),
            ('kiran', 'Kiran Das'),
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
    final voters = RegExp(
      r'/connect/posts/contest/captions/([^/]+)/voters$',
    ).firstMatch(path);
    if (voters != null) {
      voterReads.add(voters.group(1)!);
      return _ok({
        'voters': [
          {
            'userId': 'kiran',
            'name': 'Kiran Das',
            'initials': 'KD',
            'designation': 'Artist',
            'department': 'Design',
            'avatarColor': '#335577',
          },
          {
            'userId': 'chitra',
            'name': 'Chitra Rao',
            'initials': 'CR',
            'designation': 'Artist',
            'department': '3D',
            'avatarColor': '#553377',
          },
        ],
      });
    }
    if (path.endsWith('/connect/posts/contest/captions')) {
      if (request.method == 'DELETE') {
        final id = request.url.queryParameters['entryId'];
        deletes.add(id);
        contest = _contest(without: [?id]);
        return _ok({'post': contest});
      }
      final form = latin1.decode(request.bodyBytes);
      String? field(String name) => RegExp(
        'name="$name"\\r\\n\\r\\n(.*?)\\r\\n',
      ).firstMatch(form)?.group(1);
      sentText.add(field('text') ?? '');
      sentMentions.add(field('mentionedUserIds'));
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
Future<_Server> _openEntries(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final server = _Server();
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
  expect(find.text('The gallery'), findsOneWidget);
  return server;
}

/// Lets a page, a sheet or a dialog come or go.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
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

/// The gallery's cards, in the order the page shows them.
final _galleryCards = find.byWidgetPredicate(
  (widget) => widget.runtimeType.toString() == '_GalleryEntryCard',
);

/// Opens the [index]th photo in the gallery full screen, by a tap on its
/// picture.
Future<void> _openPhoto(WidgetTester tester, int index) async {
  final card = _galleryCards.at(index);
  await tester.ensureVisible(card);
  await tester.pump();
  await tester.tapAt(tester.getTopLeft(card) + const Offset(80, 90));
  await _settle(tester);
  expect(find.byKey(const ValueKey('entry-view')), findsOneWidget);
}

/// The app's photo picker, on this platform the file browser, made to hand
/// back [path].
class _FakeFilePicker extends FilePickerMacOS {
  _FakeFilePicker(this.path);

  final String path;

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
    bool cancelUploadOnWindowBlur = true,
  }) async => FilePickerResult([
    PlatformFile(path: path, name: 'desk.png', size: File(path).lengthSync()),
  ]);
}

/// A 1×1 PNG, written where the fake picker can point at it.
String _writePhoto() {
  final dir = Directory.systemTemp.createTempSync('contest_entry_voters');
  addTearDown(() => dir.deleteSync(recursive: true));
  final file = File('${dir.path}/desk.png');
  file.writeAsBytesSync(
    base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    ),
  );
  return file.path;
}

/// Lets file reads, image decoding and the upload (real work, under
/// `runAsync`) go on, pumping frames between, until [done] — given time
/// enough for a machine busy with other tests.
Future<void> _realWork(WidgetTester tester, bool Function() done) async {
  for (var i = 0; i < 150 && !done(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 40));
    await tester.pump(const Duration(milliseconds: 100));
  }
  // A few frames more, for whatever follows from it.
  for (var i = 0; i < 3; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

bool _cropShowing() => find.text('Crop your photo').evaluate().isNotEmpty;

bool _storyShowing() =>
    !_cropShowing() && find.byType(TextField).evaluate().isNotEmpty;

void main() {
  setUpAll(_loadFonts);

  testWidgets('a photo open full screen says how many voted, and the count '
      'opens "Voted by" with who they were', (tester) async {
    final server = await _openEntries(tester);
    await _openPhoto(tester, 0);

    final count = find.byKey(const ValueKey('entry-voters-manav-1'));
    expect(
      find.descendant(
        of: count,
        matching: find.text('2 votes · See who voted'),
      ),
      findsOneWidget,
    );
    await tester.tap(count);
    await _settle(tester);

    expect(server.voterReads, ['manav-1']);
    expect(find.text('Voted by'), findsOneWidget);
    expect(find.text('Kiran Das'), findsOneWidget);
    expect(find.text('Design'), findsOneWidget);
    // A row opens that person's profile, the sheet put away first.
    await tester.tap(find.text('Kiran Das'));
    await _settle(tester);
    expect(server.opened, ['kiran']);
    expect(find.text('Voted by'), findsNothing);
  });

  testWidgets('on the page, the vote count of your own photo (which cannot '
      'be voted for) opens who voted for it', (tester) async {
    final server = await _openEntries(tester);
    final mine = _galleryCards.at(1);
    await tester.ensureVisible(mine);
    await tester.pump();
    final button = find.descendant(
      of: mine,
      matching: find.byWidgetPredicate(
        (widget) =>
            widget is Semantics && widget.properties.label == 'See who voted',
      ),
    );
    expect(button, findsOneWidget);
    await tester.tap(button);
    await _settle(tester);
    expect(server.voterReads, ['mine-1']);
    expect(find.text('Voted by'), findsOneWidget);
  });

  testWidgets('a photo nobody has voted for says so and opens nothing', (
    tester,
  ) async {
    final server = await _openEntries(tester);
    await _openPhoto(tester, 2);
    await tester.tap(find.byKey(const ValueKey('entry-voters-mine-2')));
    await _settle(tester);
    expect(find.text('No votes yet'), findsOneWidget);
    expect(find.text('Voted by'), findsNothing);
    expect(server.voterReads, isEmpty);
  });

  testWidgets('your own photo, open full screen, can be deleted — that one, '
      'by its id, not your latest', (tester) async {
    final server = await _openEntries(tester);
    // Someone else's photo offers no Delete.
    await _openPhoto(tester, 0);
    expect(find.byKey(const ValueKey('entry-delete-manav-1')), findsNothing);
    // A tap on the dimmed backdrop puts it away.
    await tester.tapAt(const Offset(10, 10));
    await _settle(tester);

    // The first of the viewer's two photos.
    await _openPhoto(tester, 1);
    await tester.tap(find.byKey(const ValueKey('entry-delete-mine-1')));
    await _settle(tester);
    expect(find.text('Delete your photo?'), findsOneWidget);
    expect(find.textContaining('It has 1 vote.'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await _settle(tester);

    expect(server.deletes, ['mine-1']);
    // The view put away; the page has the other photo still.
    expect(find.byKey(const ValueKey('entry-view')), findsNothing);
    expect(_galleryCards, findsNWidgets(2));
  });

  testWidgets('a photo\'s story draws whoever it tags as a link to their '
      'profile', (tester) async {
    final server = await _openEntries(tester);
    await _openPhoto(tester, 0);
    final tag = find.text('@Chitra Rao');
    expect(tag, findsOneWidget);
    await tester.tap(tag);
    await tester.pump();
    expect(server.opened, ['chitra']);
  });

  testWidgets('"@" in a photo\'s story offers colleagues to tag; the one '
      'picked is sent with the entry', (tester) async {
    final path = _writePhoto();
    final before = FilePickerPlatform.instance;
    FilePickerPlatform.instance = _FakeFilePicker(path);
    addTearDown(() => FilePickerPlatform.instance = before);
    final server = await _openEntries(tester);

    await tester.runAsync(() async {
      await tester.tap(find.byKey(const ValueKey('entries-pinned-cta')));
      await _realWork(tester, _cropShowing);
      expect(find.text('Crop your photo'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await _realWork(tester, _storyShowing);

      final story = find.byType(TextField);
      expect(story, findsOneWidget);
      await tester.enterText(story, 'With @Chi');
      await tester.pump();
      // The colleagues whose name starts so, never the viewer.
      expect(find.text('Chitra Rao'), findsOneWidget);
      expect(find.text('Vera Viewer'), findsNothing);
      await tester.tap(find.text('Chitra Rao'));
      await tester.pump();
      expect(
        tester.widget<TextField>(story).controller!.text,
        'With @Chitra Rao ',
      );
      await tester.enterText(story, 'With @Chitra Rao at the offsite');
      await tester.pump();
      await tester.tap(
        find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.label == 'Send',
        ),
      );
      await _realWork(tester, () => server.sentText.isNotEmpty);
    });
    await _settle(tester);

    expect(server.sentText, ['With @Chitra Rao at the offsite']);
    expect(server.sentMentions, ['["chitra"]']);
  });

  testWidgets('a tag deleted from the story before sending is not sent', (
    tester,
  ) async {
    final path = _writePhoto();
    final before = FilePickerPlatform.instance;
    FilePickerPlatform.instance = _FakeFilePicker(path);
    addTearDown(() => FilePickerPlatform.instance = before);
    final server = await _openEntries(tester);

    await tester.runAsync(() async {
      await tester.tap(find.byKey(const ValueKey('entries-pinned-cta')));
      await _realWork(tester, _cropShowing);
      await tester.tap(find.text('Done'));
      await _realWork(tester, _storyShowing);
      final story = find.byType(TextField);
      await tester.enterText(story, '@Kir');
      await tester.pump();
      await tester.tap(find.text('Kiran Das'));
      await tester.pump();
      await tester.enterText(story, 'Just the desk');
      await tester.pump();
      await tester.tap(
        find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.label == 'Send',
        ),
      );
      await _realWork(tester, () => server.sentText.isNotEmpty);
    });
    await _settle(tester);

    expect(server.sentText, ['Just the desk']);
    expect(server.sentMentions, [null]);
  });
}
