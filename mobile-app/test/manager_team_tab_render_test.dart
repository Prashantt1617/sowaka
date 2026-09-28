// Renders the real Team tab for a manager with two direct reports, against a
// payload shaped like the server's, and asserts both names are on screen.
// They once appeared on the org chart alone.
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

Map<String, dynamic> member({
  required String name,
  required String department,
  bool reportsToViewer = false,
  bool isSelf = false,
  bool isManager = false,
}) => {
  'userId': name.toLowerCase(),
  'name': name,
  'department': department,
  'designation': 'Faculty',
  'reportsToViewer': reportsToViewer,
  'isSelf': isSelf,
  'isManager': isManager,
  'parameters': <dynamic>[],
  'history': <dynamic>[],
};

void main() {
  testWidgets('a manager sees both direct reports on the Team tab', (
    tester,
  ) async {
    final workspace = {
      'success': true,
      'team': [
        member(
          name: 'Demo Admin',
          department: 'People & Culture',
          isManager: true,
        ),
        member(name: 'Pankaj', department: 'Faculty', isSelf: true),
        member(
          name: 'Haider',
          department: 'Faculty',
          reportsToViewer: true,
        ),
        member(
          name: 'Naveen',
          department: 'Faculty',
          reportsToViewer: true,
        ),
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
      'approverName': 'Demo Admin',
      'hasManager': true,
      'teamLevel': 2,
      'managerScore': 0,
    };

    final client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/manager/workspace')) {
        return http.Response(jsonEncode(workspace), 200);
      }
      // The five-second poll re-reads reviews and folds them into the team.
      if (path.endsWith('/manager/feedback-snapshot')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'managerScore': 0,
            'growthHistory': <dynamic>[],
            'team': [
              {'userId': 'haider', 'feedbackStatus': 'saved', 'score': 4},
              {'userId': 'naveen', 'feedbackStatus': 'sent', 'score': 4},
            ],
          }),
          200,
        );
      }
      // Every other call the dashboard makes in parallel: an empty list of
      // whatever it asked for is enough to let the screen build.
      return http.Response(
        jsonEncode({
          'success': true,
          'leaves': <dynamic>[],
          'overtime': <dynamic>[],
          'regularizations': <dynamic>[],
          'claims': <dynamic>[],
          'types': <dynamic>[],
          'records': <dynamic>[],
          'balance': <String, dynamic>{},
        }),
        200,
      );
    });

    final session = AuthSession(
      token: 'token',
      user: const AuthUser(
        id: 'pankaj',
        email: 'pankaj@example.test',
        name: 'Pankaj',
        role: 'manager',
        company: 'ACMT',
        org: 'acmt',
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

    await bloc.add(const LoadManagerDashboard());
    expect(bloc.state.dashboard, isNotNull);
    expect(
      bloc.state.dashboard!.team.where((m) => m.reportsToViewer).length,
      2,
    );

    await tester.pumpWidget(
      MaterialApp(home: ManagerScreen(session: session, bloc: bloc)),
    );
    bloc.add(const ChangeManagerTab(ManagerTab.manage));
    await tester.pumpAndSettle(const Duration(seconds: 1));

    final onScreen = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? '')
        .where((s) => s.isNotEmpty)
        .toList();

    // The poll folds each review into the member it belongs to. Who that
    // member is to the viewer must survive it: the merge once rebuilt them
    // without the flag, and five seconds after opening the app the Team tab
    // flattened to one list and the feedback tab emptied.
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle(const Duration(seconds: 1));
    final afterPoll = bloc.state.dashboard!.team;
    final stillReports = afterPoll.where((m) => m.reportsToViewer).length;
    final stillSelf = afterPoll.where((m) => m.isSelf).length;
    final onScreenAfterPoll = tester
        .widgetList<Text>(find.byType(Text))
        .map((t) => t.data ?? '')
        .where((s) => s.isNotEmpty)
        .toList();

    // Torn down inside the body: the bloc polls on a timer, and the test
    // binding fails a test that ends with one still pending.
    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();

    expect(onScreen, contains('Haider'), reason: 'on screen: $onScreen');
    expect(onScreen, contains('Naveen'), reason: 'on screen: $onScreen');
    expect(stillReports, 2, reason: 'reports lost after the poll');
    expect(stillSelf, 1, reason: 'the viewer lost themselves after the poll');
    expect(
      onScreenAfterPoll,
      contains('Direct Reports'),
      reason: 'after the poll: $onScreenAfterPoll',
    );
  });
}
