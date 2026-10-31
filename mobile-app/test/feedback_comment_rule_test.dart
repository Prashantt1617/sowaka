// Who sees what on whose profile. Anyone in the company sees a colleague's
// Attendance, Work detail, Org chart and Rank and nothing else; the viewer's own reports
// keep everything their profile has always shown; and a name tapped anywhere
// opens the right one through `openPersonProfile`. The tab a profile opens
// on — Post from the feed, Org chart from the Team tab or an org chart, Work
// detail otherwise — is the first in its bar, and the one shown.
//
// Screenshots of the opening tabs, when asked for:
// `flutter test --update-goldens --dart-define=SCREENSHOTS=<dir> test/profile_visibility_test.dart`
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/profile/profile.dart';
import 'package:mobile_app/features/shared/photo_viewer.dart';

/// A 1x1 PNG, as a `data:` photo: no network in a test.
const photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

Map<String, dynamic> member(
  String name, {
  bool reportsToViewer = false,
  bool isSelf = false,
  String? photoUrl,
}) => {
  'userId': name.toLowerCase(),
  'name': name,
  'department': 'Faculty',
  'designation': 'Lecturer',
  'reportsToViewer': reportsToViewer,
  'inViewerChain': reportsToViewer,
  'isSelf': isSelf,
  'email': '${name.toLowerCase()}@example.test',
  'parameters': <dynamic>[],
  'history': <dynamic>[],
  'photoUrl': ?photoUrl,
};

http.Response ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);


/// The PUT a review goes out as, the last one sent.
Map<String, dynamic>? _sentBody;

Future<ManagerBloc> _boot(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1179, 2556);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final haider = {
    ...member('Haider', reportsToViewer: true),
    'feedbackStatus': 'pending',
    'parameters': [
      {'parameterId': 'p1', 'name': 'Ownership', 'score': 0, 'note': ''},
      {'parameterId': 'p2', 'name': 'Quality', 'score': 0, 'note': ''},
    ],
  };
  final workspace = {
    'team': [member('Pankaj', isSelf: true), haider],
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
    if (request.url.path.endsWith('/manager/workspace')) return ok(workspace);
    if (request.method == 'PUT' && request.url.path.endsWith('/manager/feedback/haider')) {
      _sentBody = jsonDecode(request.body) as Map<String, dynamic>;
      return ok({'feedback': {'status': _sentBody!['status']}});
    }
    return ok({
      'leaves': <dynamic>[],
      'overtime': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'records': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  });
  ConnectApiService.testClient = MockClient((request) async => ok({'posts': <dynamic>[], 'nextCursor': null, 'total': 0}));
  addTearDown(() => ConnectApiService.testClient = null);
  final session = AuthSession(
    token: 'token',
    user: AuthUser(id: 'pankaj', email: 'pankaj@example.test', name: 'Pankaj', role: 'manager', company: 'ACMT', org: 'acmt'),
  );
  final bloc = ManagerBloc(
    session: session,
    service: ManagerApiService(session: session, baseUrl: 'https://example.test', client: client),
  );
  await bloc.add(const LoadManagerDashboard());
  await tester.pumpWidget(MaterialApp(home: ManagerScreen(session: session, bloc: bloc)));
  await tester.pumpAndSettle(const Duration(seconds: 1));
  return bloc;
}

Future<void> _close(WidgetTester tester, ManagerBloc bloc) async {
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
  await tester.pump(const Duration(seconds: 30));
}

/// The profile's own Grow tab (the bottom bar has one too): the higher of the two.
Future<void> _openGrowTab(WidgetTester tester) async {
  final tabs = find.text('Grow').evaluate().toList()
    ..sort((a, b) => tester.getTopLeft(find.byWidget(a.widget)).dy.compareTo(tester.getTopLeft(find.byWidget(b.widget)).dy));
  await tester.ensureVisible(find.byWidget(tabs.first.widget));
  await tester.pumpAndSettle();
  await tester.tap(find.byWidget(tabs.first.widget));
  await tester.pumpAndSettle();
}

/// Scrolled into view, then tapped: the profile and the form both scroll.
Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

/// [name]'s comment box: the text field inside that parameter's card.
Finder _note(String name) => find.descendant(
  of: find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('feedback-param-') && (w.key! as ValueKey<String>).value.endsWith('-$name')),
  matching: find.byType(TextFormField),
);

String _count(WidgetTester tester, String name) =>
    tester.widget<Text>(find.byKey(ValueKey('feedback-note-count-$name'))).data!;

void main() {
  setUp(() => _sentBody = null);

  testWidgets('every comment needs 75 characters before the review can be sent', (tester) async {
    final bloc = await _boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    await _tap(tester, find.text('Give Feedback'));
    await tester.pumpAndSettle();

    // Scored, but no comments yet: Send waits, and each card says what is needed.
    for (final name in ['Ownership', 'Quality']) {
      await _tap(tester, find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'Rate $name 4 out of 5'));
      await tester.pump();
    }
    expect(_count(tester, 'Ownership'), '0 / 75 characters, needed to send');
    await _tap(tester, find.text('Send'));
    await tester.pumpAndSettle();
    expect(_sentBody, isNull, reason: 'Send is held while a comment is short');

    const long = 'Took the launch checklist end to end and kept every stakeholder informed through the week.';
    await tester.enterText(_note('Ownership'), long);
    await tester.enterText(_note('Quality'), 'Good month.');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(_count(tester, 'Ownership'), '${long.length} characters');
    expect(_count(tester, 'Quality'), '11 / 75 characters, needed to send');
    await _tap(tester, find.text('Send'));
    await tester.pumpAndSettle();
    expect(_sentBody, isNull, reason: 'one short comment still holds it');

    // A draft can be saved with short comments.
    await _tap(tester, find.text('Save'));
    await tester.pumpAndSettle();
    expect(_sentBody?['status'], 'saved');
    await _close(tester, bloc);
  });

  testWidgets('with 75 characters in every comment, the review is sent', (tester) async {
    final bloc = await _boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    await _tap(tester, find.text('Give Feedback'));
    for (final name in ['Ownership', 'Quality']) {
      await _tap(tester, find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'Rate $name 4 out of 5'));
    }
    const long = 'Took the launch checklist end to end and kept every stakeholder informed through the week.';
    await tester.enterText(_note('Ownership'), long);
    await tester.pump(const Duration(milliseconds: 400));
    final exactly75 = 'x' * 75;
    await tester.enterText(_note('Quality'), exactly75);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(_count(tester, 'Quality'), '75 characters');
    await _tap(tester, find.text('Send'));
    await tester.pumpAndSettle();
    expect(_sentBody?['status'], 'sent');
    final notes = (_sentBody!['parameters'] as List).map((p) => (p as Map)['note']).toList();
    expect(notes, [long, exactly75]);
    await _close(tester, bloc);
  });
}
