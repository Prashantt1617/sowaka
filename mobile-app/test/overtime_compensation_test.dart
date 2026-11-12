// Overtime is compensated as the person chooses (Figma 3205:39887 and
// 4453:64935): the form's COMPENSATION field opens a sheet with
// "Leave (Comp-off)" and "Overtime Pay"; comp-off then asks for a full day
// (+1 Comp-off) or a half day (+0.5). The field reads the choice, Apply stays
// off until there is one, and the request carries it to the server. Where HR
// has no Comp-off leave type, comp-off is greyed out with the reason. The
// manager sees the choice on the request card and in its detail.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';

http.Response _ok(Map<String, dynamic> body) => http.Response(
  jsonEncode({'success': true, ...body}),
  200,
  headers: {'content-type': 'application/json'},
);

String _ymd(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

Map<String, dynamic> _overtimeJson({
  required String id,
  required String name,
  Map<String, dynamic>? compensation,
  String duration = 'full_day',
  String status = 'pending',
}) {
  final day = _ymd(DateTime.now().subtract(const Duration(days: 2)));
  return {
    'id': id,
    'userId': name.toLowerCase(),
    'employee': {'name': name, 'department': 'Design'},
    'workDate': day,
    'startTime': '${day}T04:00:00.000Z',
    'endTime': '${day}T12:00:00.000Z',
    'hours': duration == 'full_day' ? 8 : 4,
    'duration': duration,
    'compensation': compensation,
    'note': 'Release night',
    'status': status,
    'createdAt': '${day}T13:00:00.000Z',
  };
}

const _employee = AuthUser(
  id: 'tanvi',
  email: 'tanvi@sowaka.test',
  name: 'Tanvi Arora',
  role: 'employee',
  company: 'Sowaka',
  org: 'sowaka',
  joiningDate: '2025-01-01',
);

/// A server for one employee whose template has [leaveTypes]; every POST to
/// /overtime lands in [posted].
MockClient _employeeServer(
  List<Map<String, dynamic>> posted, {
  required List<String> leaveTypes,
}) {
  return MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/manager/workspace')) {
      return _ok({
        'team': <dynamic>[],
        'holidays': <dynamic>[],
        'overtimeEnabled': true,
        'hasManager': true,
        'shift': {
          'name': 'Default',
          'startTime': '09:30',
          'endTime': '18:30',
          'minHalfDayHours': 4,
          'minFullDayHours': 8,
          'overtimeBackdateDays': 7,
          'leaveTypes': [
            for (final key in leaveTypes)
              {
                'key': key,
                'name': key == 'comp_off' ? 'Comp-off' : 'Casual Leave',
                'advanceDays': 30,
                'allowBackdated': true,
                'backdatedDays': 3,
                'unpaid': false,
              },
          ],
        },
      });
    }
    if (request.method == 'POST' && path.endsWith('/overtime')) {
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      posted.add(body);
      return _ok({
        'overtime': {
          ..._overtimeJson(
            id: 'ot-new',
            name: 'Tanvi Arora',
            compensation: body['compensation'] as Map<String, dynamic>?,
            duration: body['duration'] as String,
          ),
          'workDate': body['workDate'],
        },
      });
    }
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
}

/// The Overtime form, open, for an employee whose template has [leaveTypes].
Future<(ManagerBloc, List<Map<String, dynamic>>)> _openForm(
  WidgetTester tester, {
  List<String> leaveTypes = const ['casual', 'comp_off'],
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final posted = <Map<String, dynamic>>[];
  final session = AuthSession(token: 'token', user: _employee);
  final bloc = ManagerBloc(
    session: session,
    service: ManagerApiService(
      session: session,
      baseUrl: 'https://example.test',
      client: _employeeServer(posted, leaveTypes: leaveTypes),
    ),
  );
  final controller = QuickActionsController();
  addTearDown(() {
    bloc.dispose();
    controller.dispose();
  });
  await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: StreamBuilder<ManagerState>(
          stream: bloc.stream,
          initialData: bloc.state,
          builder: (context, snapshot) => QuickActionsScreen(
            bloc: bloc,
            dashboard: (snapshot.data ?? bloc.state).dashboard!,
            controller: controller,
            profileAction: const SizedBox(width: 30, height: 30),
            onNotifications: () {},
            onOpenComposer: () {},
          ),
        ),
      ),
    ),
  );
  await _settle(tester);
  controller.openOvertime();
  await _settle(tester);
  await tester.tap(find.text('Apply Overtime').first);
  await _settle(tester);
  expect(find.byKey(const ValueKey('apply-overtime')), findsOneWidget);
  return (bloc, posted);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 30)),
    );
    await tester.pump(const Duration(milliseconds: 300));
  }
}

/// Today, from the date picker, and a duration from its sheet.
Future<void> _pickDateAndDuration(WidgetTester tester, String duration) async {
  await tester.tap(find.text('Select date'));
  await _settle(tester);
  await tester.tap(find.text('OK'));
  await _settle(tester);
  await tester.tap(find.text('Select duration'));
  await _settle(tester);
  await tester.tap(find.text(duration).last);
  await _settle(tester);
}

Future<void> _tapApply(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Apply Overtime').last);
  await tester.tap(find.text('Apply Overtime').last);
  await _settle(tester);
}

void main() {
  testWidgets(
    'comp-off: both sheets, the field reads the choice, and it is sent',
    (tester) async {
      final (_, posted) = await _openForm(tester);
      expect(find.text('COMPENSATION'), findsOneWidget);
      expect(find.text('Select compensation'), findsOneWidget);

      await _pickDateAndDuration(tester, 'Full day');
      // Date and duration alone are not enough: Apply stays off.
      await _tapApply(tester);
      expect(posted, isEmpty);

      // First sheet (3205:39887): the two kinds.
      await tester.ensureVisible(find.text('Select compensation'));
      await tester.tap(find.text('Select compensation'));
      await _settle(tester);
      expect(find.text('Leave (Comp-off)'), findsOneWidget);
      expect(find.text('Overtime Pay'), findsOneWidget);
      expect(find.textContaining("isn't set up"), findsNothing);
      await tester.tap(find.text('Leave (Comp-off)'));
      await _settle(tester);

      // Second sheet (4453:64935): how much comp-off.
      expect(find.text('+1 Comp-off'), findsOneWidget);
      expect(find.text('+0.5 Comp-off'), findsOneWidget);
      await tester.tap(find.text('+1 Comp-off'));
      await _settle(tester);

      expect(find.text('Leave (Comp-off) · Full day'), findsOneWidget);
      expect(
        find.text('Once approved, 1 day is added to your comp-off balance.'),
        findsOneWidget,
      );

      await _tapApply(tester);
      expect(posted, hasLength(1));
      expect(posted.single['duration'], 'full_day');
      expect(posted.single['compensation'], {'kind': 'comp_off', 'days': 1});
      // The confirmation repeats it.
      expect(find.text('Leave (Comp-off) · Full day'), findsWidgets);
    },
  );

  testWidgets('a half day of comp-off sends 0.5', (tester) async {
    final (_, posted) = await _openForm(tester);
    await _pickDateAndDuration(tester, 'Full day');
    await tester.ensureVisible(find.text('Select compensation'));
    await tester.tap(find.text('Select compensation'));
    await _settle(tester);
    await tester.tap(find.text('Leave (Comp-off)'));
    await _settle(tester);
    await tester.tap(find.text('+0.5 Comp-off'));
    await _settle(tester);
    expect(find.text('Leave (Comp-off) · Half day'), findsOneWidget);
    await _tapApply(tester);
    expect(posted.single['compensation'], {'kind': 'comp_off', 'days': 0.5});
  });

  testWidgets('half a day of overtime cannot be a full day of comp-off', (
    tester,
  ) async {
    final (_, posted) = await _openForm(tester);
    await _pickDateAndDuration(tester, 'Half day');
    await tester.ensureVisible(find.text('Select compensation'));
    await tester.tap(find.text('Select compensation'));
    await _settle(tester);
    await tester.tap(find.text('Leave (Comp-off)'));
    await _settle(tester);
    expect(find.text('Needs a full day of overtime'), findsOneWidget);
    // Greyed: a tap does nothing, the sheet stays.
    await tester.tap(find.text('+1 Comp-off'));
    await _settle(tester);
    expect(find.text('+1 Comp-off'), findsOneWidget);
    await tester.tap(find.text('+0.5 Comp-off'));
    await _settle(tester);
    expect(find.text('Leave (Comp-off) · Half day'), findsOneWidget);
    await _tapApply(tester);
    expect(posted.single['duration'], 'half_day');
    expect(posted.single['compensation'], {'kind': 'comp_off', 'days': 0.5});
  });

  testWidgets(
    'no Comp-off leave type: comp-off is greyed with the reason; overtime pay is sent',
    (tester) async {
      final (_, posted) = await _openForm(tester, leaveTypes: const ['casual']);
      await _pickDateAndDuration(tester, 'Full day');
      await tester.ensureVisible(find.text('Select compensation'));
      await tester.tap(find.text('Select compensation'));
      await _settle(tester);
      expect(find.text("Comp-off isn't set up — ask HR"), findsOneWidget);
      await tester.tap(find.text('Leave (Comp-off)'));
      await _settle(tester);
      // Still the first sheet: nothing was chosen.
      expect(find.text('+1 Comp-off'), findsNothing);
      expect(find.text('Overtime Pay'), findsOneWidget);
      await tester.tap(find.text('Overtime Pay'));
      await _settle(tester);
      expect(find.text('Overtime Pay'), findsOneWidget);
      expect(
        find.text('Once approved, it is paid with your salary.'),
        findsOneWidget,
      );
      await _tapApply(tester);
      expect(posted.single['compensation'], {'kind': 'pay'});
    },
  );

  test('a request reads its compensation; one from before has none', () {
    final compOff = OvertimeRequest.fromJson(
      _overtimeJson(
        id: 'a',
        name: 'Asha',
        compensation: {'kind': 'comp_off', 'days': 1},
      ),
    );
    expect(compOff.compensationLabel, 'Leave (Comp-off) · Full day');
    expect(
      compOff.compensationDetail,
      'Leave (Comp-off) · Full day, +1 Comp-off',
    );
    final half = OvertimeRequest.fromJson(
      _overtimeJson(
        id: 'b',
        name: 'Asha',
        compensation: {'kind': 'comp_off', 'days': 0.5},
      ),
    );
    expect(
      half.compensationDetail,
      'Leave (Comp-off) · Half day, +0.5 Comp-off',
    );
    final pay = OvertimeRequest.fromJson(
      _overtimeJson(id: 'c', name: 'Asha', compensation: {'kind': 'pay'}),
    );
    expect(pay.compensationDetail, 'Overtime Pay');
    final legacy = OvertimeRequest.fromJson(
      _overtimeJson(id: 'd', name: 'Asha'),
    );
    expect(legacy.compensationLabel, isEmpty);
    // Deciding keeps it.
    expect(
      compOff.copyWith(decision: LeaveDecision.approved).compensationDetail,
      'Leave (Comp-off) · Full day, +1 Comp-off',
    );
  });

  testWidgets('the manager sees the compensation on the card and in detail', (
    tester,
  ) async {
    // Wide enough for the requests toolbar in the test font, which is wider
    // than any real one.
    tester.view.physicalSize = const Size(480 * 3, 1400 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    Map<String, dynamic> member(String name, {bool self = false}) => {
      'userId': name.toLowerCase(),
      'name': name,
      'department': 'Design',
      'designation': 'Designer',
      'reportsToViewer': !self,
      'isSelf': self,
      'isManager': self,
      'parameters': <dynamic>[],
      'history': <dynamic>[],
    };
    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/manager/workspace')) {
        return _ok({
          'team': [
            member('Pankaj', self: true),
            member('Asha'),
            member('Bala'),
          ],
          'recognitionCandidates': <dynamic>[],
          'nominations': <dynamic>[],
          'recognitionHistory': <dynamic>[],
          'myParameters': <dynamic>[],
          'growthHistory': <dynamic>[],
          'holidays': <dynamic>[],
          'myOrgChart': <dynamic>[],
          'weekoffDays': [0],
          'shift': <String, dynamic>{},
          'overtimeEnabled': true,
          'hasManager': true,
          'teamLevel': 1,
          'managerScore': 0,
        });
      }
      return _ok({
        'leaves': <dynamic>[],
        'overtime': path.endsWith('/overtime/inbox')
            ? [
                _overtimeJson(
                  id: 'ot1',
                  name: 'Asha',
                  compensation: {'kind': 'comp_off', 'days': 1},
                ),
                _overtimeJson(
                  id: 'ot2',
                  name: 'Bala',
                  compensation: {'kind': 'pay'},
                ),
              ]
            : <dynamic>[],
        'regularizations': <dynamic>[],
        'claims': <dynamic>[],
        'types': <dynamic>[],
        'records': <dynamic>[],
        'balance': <String, dynamic>{},
      });
    });
    final session = AuthSession(
      token: 'token',
      user: const AuthUser(
        id: 'pankaj',
        email: 'pankaj@sowaka.test',
        name: 'Pankaj',
        role: 'manager',
        company: 'Sowaka',
        org: 'sowaka',
        interests: [],
      ),
    );
    final bloc = ManagerBloc(
      session: session,
      service: ManagerApiService(
        session: session,
        baseUrl: 'https://example.test',
        client: client,
      ),
    );
    await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
    expect(bloc.state.dashboard!.overtime, hasLength(2));

    await tester.pumpWidget(
      MaterialApp(
        home: ManagerScreen(session: session, bloc: bloc),
      ),
    );
    bloc.add(const ChangeManagerTab(ManagerTab.manage));
    bloc.add(const ShowTeamSection(TeamSection.requests));
    await tester.pumpAndSettle(const Duration(seconds: 1));

    final cardText = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '')
        .join(' | ');
    expect(cardText, contains('Compensation:'));
    expect(cardText, contains('Leave (Comp-off) · Full day, +1 Comp-off'));
    expect(cardText, contains('Overtime Pay'));

    // The detail page: its own Compensation row.
    final asha = find.ancestor(
      of: find.text('Leave (Comp-off) · Full day, +1 Comp-off'),
      matching: find.byWidgetPredicate(
        (w) => w.runtimeType.toString() == '_TeamRequestCard',
      ),
    );
    final details = find.descendant(
      of: asha,
      matching: find.text('View details'),
    );
    await tester.ensureVisible(details);
    await tester.tap(details);
    await tester.pumpAndSettle(const Duration(seconds: 1));
    expect(find.text('Compensation'), findsOneWidget);
    expect(
      find.text('Leave (Comp-off) · Full day, +1 Comp-off'),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();
    await tester.pump(const Duration(seconds: 30));
  });
}
