// Overtime pay or comp-off is the person's preference (Figma 3205:39887 and
// 4453:64935): the form's PREFERENCE field opens a sheet with
// "Leave (Comp-off)" and "Overtime Pay"; comp-off then takes its days from
// the duration (full +1, half +0.5), asking only when no duration is chosen.
// The field reads the choice, Apply stays off until there is one, and the
// request carries it to the server. Where HR has no Comp-off leave type,
// comp-off is greyed out with the reason. The manager sees the preference on
// the request card and in its detail, and makes the final call there with a
// "Manager's decision" dropdown under the Reason; approving sends it, and the
// decision is what shows afterwards.
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
  Map<String, dynamic>? preferredCompensation,
  bool sendPreferred = false,
  bool compOffAvailable = true,
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
    if (sendPreferred) 'preferredCompensation': preferredCompensation,
    'compOffAvailable': compOffAvailable,
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
    'comp-off with a duration chosen: no second sheet, the days follow it',
    (tester) async {
      final (_, posted) = await _openForm(tester);
      expect(find.text('PREFERENCE'), findsOneWidget);
      expect(find.text('Select preference'), findsOneWidget);
      expect(find.text('COMPENSATION'), findsNothing);

      await _pickDateAndDuration(tester, 'Full day');
      // Date and duration alone are not enough: Apply stays off.
      await _tapApply(tester);
      expect(posted, isEmpty);

      // First sheet (3205:39887): the two kinds.
      await tester.ensureVisible(find.text('Select preference'));
      await tester.tap(find.text('Select preference'));
      await _settle(tester);
      expect(find.text('Leave (Comp-off)'), findsOneWidget);
      expect(find.text('Overtime Pay'), findsOneWidget);
      expect(find.textContaining("isn't set up"), findsNothing);
      await tester.tap(find.text('Leave (Comp-off)'));
      await _settle(tester);

      // The duration already says a full day: the full/half sheet is not shown.
      expect(find.text('+1 Comp-off'), findsNothing);
      expect(find.text('+0.5 Comp-off'), findsNothing);
      expect(find.text('Leave (Comp-off) · Full day'), findsOneWidget);
      expect(
        find.text(
          'If approved as you prefer, 1 day is added to your comp-off '
          'balance. Your manager makes the final call.',
        ),
        findsOneWidget,
      );

      await _tapApply(tester);
      expect(posted, hasLength(1));
      expect(posted.single['duration'], 'full_day');
      expect(posted.single['compensation'], {'kind': 'comp_off', 'days': 1});
      // The confirmation repeats it, as their preference.
      expect(find.text('Leave (Comp-off) · Full day'), findsWidgets);
      expect(find.text('Preference'), findsOneWidget);
      expect(find.text('Compensation'), findsNothing);
    },
  );

  testWidgets('a half-day duration gives 0.5 comp-off, no sheet', (
    tester,
  ) async {
    final (_, posted) = await _openForm(tester);
    await _pickDateAndDuration(tester, 'Half day');
    await tester.ensureVisible(find.text('Select preference'));
    await tester.tap(find.text('Select preference'));
    await _settle(tester);
    await tester.tap(find.text('Leave (Comp-off)'));
    await _settle(tester);
    expect(find.text('+0.5 Comp-off'), findsNothing);
    expect(find.text('Leave (Comp-off) · Half day'), findsOneWidget);
    await _tapApply(tester);
    expect(posted.single['duration'], 'half_day');
    expect(posted.single['compensation'], {'kind': 'comp_off', 'days': 0.5});
  });

  testWidgets(
    'comp-off before a duration asks full or half; the duration then sets it',
    (tester) async {
      final (_, posted) = await _openForm(tester);
      await tester.ensureVisible(find.text('Select preference'));
      await tester.tap(find.text('Select preference'));
      await _settle(tester);
      await tester.tap(find.text('Leave (Comp-off)'));
      await _settle(tester);
      // No duration yet: the second sheet (4453:64935) asks how much.
      expect(find.text('+1 Comp-off'), findsOneWidget);
      expect(find.text('+0.5 Comp-off'), findsOneWidget);
      await tester.tap(find.text('+1 Comp-off'));
      await _settle(tester);
      expect(find.text('Leave (Comp-off) · Full day'), findsOneWidget);
      // A half-day duration afterwards brings the comp-off down to match.
      await _pickDateAndDuration(tester, 'Half day');
      expect(find.text('Leave (Comp-off) · Half day'), findsOneWidget);
      await _tapApply(tester);
      expect(posted.single['duration'], 'half_day');
      expect(posted.single['compensation'], {'kind': 'comp_off', 'days': 0.5});
    },
  );

  testWidgets(
    'no Comp-off leave type: comp-off is greyed with the reason; overtime pay is sent',
    (tester) async {
      final (_, posted) = await _openForm(tester, leaveTypes: const ['casual']);
      await _pickDateAndDuration(tester, 'Full day');
      await tester.ensureVisible(find.text('Select preference'));
      await tester.tap(find.text('Select preference'));
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
        find.text(
          'If approved as you prefer, it is paid with your salary. '
          'Your manager makes the final call.',
        ),
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
    // A server from before the decision sends no preferredCompensation:
    // the compensation is the preference.
    expect(
      compOff.preferenceDetail,
      'Leave (Comp-off) · Full day, +1 Comp-off',
    );
    expect(compOff.compensationCardRows, [
      ('Preference:', 'Leave (Comp-off) · Full day, +1 Comp-off'),
    ]);
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
    expect(legacy.preferenceLabel, isEmpty);
    expect(legacy.compensationCardRows, isEmpty);
    // Deciding keeps it.
    expect(
      compOff.copyWith(decision: LeaveDecision.approved).compensationDetail,
      'Leave (Comp-off) · Full day, +1 Comp-off',
    );
  });

  test('an approved request reads the decision and the preference apart', () {
    final overridden = OvertimeRequest.fromJson(
      _overtimeJson(
        id: 'a',
        name: 'Asha',
        status: 'approved',
        compensation: {'kind': 'pay'},
        preferredCompensation: {'kind': 'comp_off', 'days': 1},
        sendPreferred: true,
      ),
    );
    expect(overridden.decisionDetail, 'Overtime Pay');
    expect(overridden.preferenceLabel, 'Leave (Comp-off) · Full day');
    expect(overridden.decisionDiffersFromPreference, isTrue);
    expect(overridden.compensationCardRows, [
      ('Decision:', 'Overtime Pay'),
      ('Preferred:', 'Leave (Comp-off) · Full day'),
    ]);
    final asAsked = OvertimeRequest.fromJson(
      _overtimeJson(
        id: 'b',
        name: 'Asha',
        status: 'approved',
        compensation: {'kind': 'comp_off', 'days': 0.5},
        preferredCompensation: {'kind': 'comp_off', 'days': 0.5},
        sendPreferred: true,
      ),
    );
    expect(asAsked.decisionDiffersFromPreference, isFalse);
    expect(asAsked.compensationCardRows, [
      ('Decision:', 'Leave (Comp-off) · Half day, +0.5 Comp-off'),
    ]);
    // No preference (an older app), decided as pay.
    final legacyDecided = OvertimeRequest.fromJson(
      _overtimeJson(
        id: 'c',
        name: 'Asha',
        status: 'approved',
        compensation: {'kind': 'pay'},
        sendPreferred: true,
      ),
    );
    expect(legacyDecided.preferenceLabel, isEmpty);
    expect(legacyDecided.decisionDiffersFromPreference, isFalse);
    // A pending request does not show a decision yet.
    final pending = OvertimeRequest.fromJson(
      _overtimeJson(
        id: 'd',
        name: 'Asha',
        compensation: {'kind': 'pay'},
        preferredCompensation: {'kind': 'pay'},
        sendPreferred: true,
        compOffAvailable: false,
      ),
    );
    expect(pending.hasCompensationDecision, isFalse);
    expect(pending.decisionDetail, isEmpty);
    expect(pending.compOffAvailable, isFalse);
  });

  group('the manager', () {
    // A manager with Asha (full day, prefers comp-off), Bala (prefers pay)
    // and Chitra (half day, prefers 0.5 comp-off, no Comp-off type for her)
    // in the inbox. Every decision PATCH lands in [decided], and the server
    // answers as it would: approved, with the decision as `compensation` and
    // the preference kept.
    late List<Map<String, dynamic>> decided;
    late ManagerBloc bloc;
    late AuthSession session;

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

    final inbox = <String, Map<String, dynamic>>{
      'ot1': _overtimeJson(
        id: 'ot1',
        name: 'Asha',
        compensation: {'kind': 'comp_off', 'days': 1},
      ),
      'ot2': _overtimeJson(
        id: 'ot2',
        name: 'Bala',
        compensation: {'kind': 'pay'},
      ),
      'ot3': _overtimeJson(
        id: 'ot3',
        name: 'Chitra',
        duration: 'half_day',
        compensation: {'kind': 'comp_off', 'days': 0.5},
        compOffAvailable: false,
      ),
    };

    Future<void> openRequests(WidgetTester tester) async {
      // Wide enough for the requests toolbar in the test font, which is wider
      // than any real one.
      tester.view.physicalSize = const Size(480 * 3, 1400 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      decided = [];
      final client = MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/manager/workspace')) {
          return _ok({
            'team': [
              member('Pankaj', self: true),
              member('Asha'),
              member('Bala'),
              member('Chitra'),
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
        if (request.method == 'PATCH' && path.contains('/overtime/')) {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          decided.add(body);
          final id = path.split('/')[path.split('/').length - 2];
          final original = inbox[id]!;
          return _ok({
            'overtime': {
              ...original,
              'status': body['decision'],
              'compensation': body['compensation'] ?? original['compensation'],
              'preferredCompensation': original['compensation'],
            },
          });
        }
        return _ok({
          'leaves': <dynamic>[],
          'overtime': path.endsWith('/overtime/inbox')
              ? inbox.values.toList()
              : <dynamic>[],
          'regularizations': <dynamic>[],
          'claims': <dynamic>[],
          'types': <dynamic>[],
          'records': <dynamic>[],
          'balance': <String, dynamic>{},
        });
      });
      session = AuthSession(
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
      bloc = ManagerBloc(
        session: session,
        service: ManagerApiService(
          session: session,
          baseUrl: 'https://example.test',
          client: client,
        ),
      );
      await tester.runAsync(() => bloc.add(const LoadManagerDashboard()));
      expect(bloc.state.dashboard!.overtime, hasLength(3));
      await tester.pumpWidget(
        MaterialApp(
          home: ManagerScreen(session: session, bloc: bloc),
        ),
      );
      bloc.add(const ChangeManagerTab(ManagerTab.manage));
      bloc.add(const ShowTeamSection(TeamSection.requests));
      await tester.pumpAndSettle(const Duration(seconds: 1));
    }

    Future<void> close(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox.shrink());
      bloc.dispose();
      await tester.pump(const Duration(seconds: 30));
    }

    String allText(WidgetTester tester) => tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '')
        .join(' | ');

    Future<void> openDetail(WidgetTester tester, String cardText) async {
      final card = find.ancestor(
        of: find.text(cardText),
        matching: find.byWidgetPredicate(
          (w) => w.runtimeType.toString() == '_TeamRequestCard',
        ),
      );
      final details = find.descendant(
        of: card,
        matching: find.text('View details'),
      );
      await tester.ensureVisible(details);
      await tester.tap(details);
      await tester.pumpAndSettle(const Duration(seconds: 1));
    }

    testWidgets('sees the preference on the card and in detail', (
      tester,
    ) async {
      await openRequests(tester);
      final cardText = allText(tester);
      expect(cardText, contains('Preference:'));
      expect(cardText, isNot(contains('Compensation:')));
      expect(cardText, contains('Leave (Comp-off) · Full day, +1 Comp-off'));
      expect(cardText, contains('Overtime Pay'));

      // The detail page: the employee's preference, then the reason, and
      // directly below the reason the manager's decision, preselected to it.
      await openDetail(tester, 'Leave (Comp-off) · Full day, +1 Comp-off');
      expect(find.text("Employee's preference"), findsOneWidget);
      expect(
        find.text('Leave (Comp-off) · Full day, +1 Comp-off'),
        findsOneWidget,
      );
      expect(find.text('Compensation'), findsNothing);
      final dropdown = find.byKey(const ValueKey('overtime-manager-decision'));
      expect(dropdown, findsOneWidget);
      expect(find.text("Manager's decision"), findsOneWidget);
      expect(
        find.descendant(
          of: dropdown,
          matching: find.text('Leave (Comp-off) · Full day'),
        ),
        findsOneWidget,
      );
      final reasonY = tester.getTopLeft(find.text('Release night')).dy;
      final labelY = tester.getTopLeft(find.text("Manager's decision")).dy;
      final dropdownY = tester.getTopLeft(dropdown).dy;
      expect(labelY, greaterThan(reasonY));
      expect(dropdownY, greaterThan(labelY));
      await close(tester);
    });

    testWidgets('approving sends the decision; the decision shows afterwards', (
      tester,
    ) async {
      await openRequests(tester);
      await openDetail(tester, 'Leave (Comp-off) · Full day, +1 Comp-off');

      // Overtime pay instead of the comp-off she asked for.
      await tester.tap(find.byKey(const ValueKey('overtime-manager-decision')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Overtime Pay').last);
      await tester.pumpAndSettle();
      expect(
        find.text(
          'This differs from their preference (Leave (Comp-off) · Full day).',
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Approve').last);
      await tester.pumpAndSettle();
      // The sheet says what approving gives: overtime pay.
      expect(find.text('Overtime Pay'), findsWidgets);
      await tester.runAsync(() async {
        await tester.tap(find.text('Confirm approve'));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(decided, hasLength(1));
      expect(decided.single['decision'], 'approved');
      expect(decided.single['compensation'], {'kind': 'pay'});

      // Back on the list: the card shows the decision and what was preferred.
      final after = bloc.state.dashboard!.overtime.firstWhere(
        (r) => r.id == 'ot1',
      );
      expect(after.decision, LeaveDecision.approved);
      expect(after.compensationCardRows, [
        ('Decision:', 'Overtime Pay'),
        ('Preferred:', 'Leave (Comp-off) · Full day'),
      ]);
      final listText = allText(tester);
      expect(listText, contains('Decision:'));
      expect(listText, contains('Preferred:'));
      await close(tester);
    });

    testWidgets('approving as preferred sends the preference', (tester) async {
      await openRequests(tester);
      await openDetail(tester, 'Overtime Pay');
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('overtime-manager-decision')),
          matching: find.text('Overtime Pay'),
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Approve').last);
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.text('Confirm approve'));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(decided.single['compensation'], {'kind': 'pay'});
      await close(tester);
    });

    testWidgets(
      'a half-day claim without Comp-off set up: comp-off is greyed, pay preselected',
      (tester) async {
        await openRequests(tester);
        await openDetail(tester, 'Leave (Comp-off) · Half day, +0.5 Comp-off');
        final dropdown = find.byKey(
          const ValueKey('overtime-manager-decision'),
        );
        // Her preference can't be given, so overtime pay is what is decided.
        expect(
          find.descendant(of: dropdown, matching: find.text('Overtime Pay')),
          findsOneWidget,
        );
        await tester.tap(dropdown);
        await tester.pumpAndSettle();
        expect(
          find.text("Leave (Comp-off) · Half day (Comp-off isn't set up)"),
          findsWidgets,
        );
        final items = tester
            .widgetList<DropdownMenuItem<Object>>(
              find.byWidgetPredicate((w) => w is DropdownMenuItem),
            )
            .toList();
        expect(items.where((i) => !i.enabled), hasLength(2));
        await close(tester);
      },
    );
  });
}
