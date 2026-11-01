// The review form's rules, from a report's profile Grow tab:
//
// - Every parameter's comment needs 75 characters before the review can be
//   sent. Nothing counts while typing; Send says which comment is short and
//   sends nothing. A draft may be short.
// - Last month stays open: it can be picked from the month row, reads as
//   due rather than missed, and opens a form on that month's parameters that
//   is sent for that month.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_api_service.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/profile/profile.dart';

Map<String, dynamic> member(
  String name, {
  bool reportsToViewer = false,
  bool isSelf = false,
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
};

http.Response ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// 'YYYY-MM' for this month, and for the one before it.
String _key(DateTime date) =>
    '${date.year}-${date.month.toString().padLeft(2, '0')}';
final _thisMonth = _key(DateTime.now());
final _lastMonth = _key(DateTime(DateTime.now().year, DateTime.now().month - 1));
const _monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String _short(String period) => '${_monthsShort[int.parse(period.substring(5)) - 1]} ${period.substring(0, 4)}';

/// The PUT a review goes out as, the last one sent.
Map<String, dynamic>? _sentBody;

Future<ManagerBloc> _boot(
  WidgetTester tester, {
  Map<String, dynamic>? previousCycle,
}) async {
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
    'previousCycle': ?previousCycle,
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

Future<void> _rate(WidgetTester tester, List<String> names) async {
  for (final name in names) {
    await _tap(tester, find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'Rate $name 4 out of 5'));
    await tester.pump();
  }
}

/// Lets a toast from the last tap go, so the next one is the only one shown.
Future<void> _dismissToasts(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 10));
  await tester.pumpAndSettle();
}

const _long75 = 'Took the launch checklist end to end and kept every stakeholder informed through the week.';

void main() {
  setUp(() => _sentBody = null);

  testWidgets('no reviews yet: a clean empty chart, ending at this month', (tester) async {
    final bloc = await _boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);

    expect(find.byKey(const ValueKey('grow-empty-chart')), findsOneWidget);
    expect(find.text('No reviews yet'), findsOneWidget);
    // The axis is the six months up to this one: none still to come.
    final now = DateTime.now();
    final first = _monthsShort[DateTime(now.year, now.month - 5).month - 1];
    final last = _monthsShort[now.month - 1];
    expect(find.bySemanticsLabel(RegExp('^Overall score, $first to $last' r'(\n|$)')), findsOneWidget);
    await _close(tester, bloc);
  });

  testWidgets('no live count; Send refuses a short comment with a clear message', (tester) async {
    final bloc = await _boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    await _tap(tester, find.text('Give Feedback'));

    // Nothing counts characters under the comments.
    expect(find.textContaining('characters'), findsNothing);
    expect(find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('feedback-note-count-')), findsNothing);

    await _rate(tester, ['Ownership', 'Quality']);
    await _tap(tester, find.text('Send'));
    expect(_sentBody, isNull, reason: 'empty comments are not sent');
    expect(find.text('Write at least 75 characters in each comment before sending. "Ownership" has 0.'), findsOneWidget);
    await _dismissToasts(tester);

    // One long comment, one short, typed and Send tapped straight away: the
    // text still in the box is what is judged.
    await tester.enterText(_note('Ownership'), _long75);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(_note('Quality'), 'Good month.');
    await tester.pump();
    expect(find.textContaining('characters'), findsNothing, reason: 'still no count while typing');
    await _tap(tester, find.text('Send'));
    expect(_sentBody, isNull, reason: 'one short comment still holds it');
    expect(find.text('Write at least 75 characters in each comment before sending. "Quality" has 11.'), findsOneWidget);
    await _dismissToasts(tester);

    // A draft can be saved with short comments.
    await _tap(tester, find.text('Save'));
    expect(_sentBody?['status'], 'saved');
    expect(_sentBody!.containsKey('period'), isFalse, reason: 'the live cycle needs no period');
    await _close(tester, bloc);
  });

  testWidgets('with 75 characters in every comment, the review is sent', (tester) async {
    final bloc = await _boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    await _tap(tester, find.text('Give Feedback'));
    await _rate(tester, ['Ownership', 'Quality']);
    await tester.enterText(_note('Ownership'), _long75);
    await tester.pump(const Duration(milliseconds: 400));
    final exactly75 = 'x' * 75;
    // Send tapped with the box still focused, before the pause that commits it.
    await tester.enterText(_note('Quality'), exactly75);
    await tester.pump();
    await _tap(tester, find.text('Send'));
    expect(_sentBody?['status'], 'sent');
    final notes = (_sentBody!['parameters'] as List).map((p) => (p as Map)['note']).toList();
    expect(notes, [_long75, exactly75]);
    await _close(tester, bloc);
  });

  testWidgets('last month can be picked and reviewed, on its own parameters', (tester) async {
    final bloc = await _boot(
      tester,
      previousCycle: {
        'period': _lastMonth,
        'feedbackStatus': 'pending',
        'score': 0,
        'parameters': [
          {'parameterId': 'p1', 'name': 'Ownership', 'score': 0, 'note': ''},
          {'parameterId': 'p3', 'name': 'Delivery', 'score': 0, 'note': ''},
        ],
        'extra': '',
      },
    );
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);

    // The month row offers the picker, with last month in it.
    await _tap(tester, find.text(_short(_thisMonth)));
    expect(find.text('Select Month'), findsOneWidget);
    await tester.drag(find.byType(ListWheelScrollView), const Offset(0, 52));
    await tester.pumpAndSettle();
    await _tap(tester, find.text('Select'));

    // Due, not missed.
    expect(find.text(_short(_lastMonth)), findsOneWidget);
    expect(find.text('Feedback missed'), findsNothing);
    expect(find.text('Pending'), findsOneWidget);
    expect(find.text('Feedback for ${_short(_lastMonth)} can still be given until this cycle ends'), findsOneWidget);

    await _tap(tester, find.text('Give Feedback'));
    // That month's form: its title and its parameters.
    expect(find.text(_short(_lastMonth)), findsOneWidget);
    expect(_note('Delivery'), findsOneWidget);
    expect(_note('Quality'), findsNothing);

    await _rate(tester, ['Ownership', 'Delivery']);
    await tester.enterText(_note('Ownership'), _long75);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(_note('Delivery'), _long75);
    await tester.pump(const Duration(milliseconds: 400));
    await _tap(tester, find.text('Send'));
    expect(_sentBody?['status'], 'sent');
    expect(_sentBody?['period'], _lastMonth);
    expect((_sentBody!['parameters'] as List).map((p) => (p as Map)['parameterId']).toList(), ['p1', 'p3']);

    // Back on Grow, last month now reads as reviewed and can still be edited;
    // this month is untouched and still due.
    final haider = bloc.state.dashboard!.team.firstWhere((m) => m.userId == 'haider');
    expect(haider.previousCycle?.status.name, 'sent');
    expect(haider.status.name, 'pending');
    expect(haider.history.map((r) => r.period), [_lastMonth]);
    await tester.pumpAndSettle();
    expect(find.text('You can edit the feedback for ${_short(_lastMonth)} till this cycle ends.'), findsOneWidget);
    await _close(tester, bloc);
  });

  testWidgets('without a previous cycle from the server, last month is not offered', (tester) async {
    final bloc = await _boot(tester);
    expect(openPersonProfile('haider'), isTrue);
    await tester.pumpAndSettle();
    await _openGrowTab(tester);
    // One month only: the row is not a picker.
    await _tap(tester, find.text(_short(_thisMonth)));
    expect(find.text('Select Month'), findsNothing);
    await _close(tester, bloc);
  });
}
