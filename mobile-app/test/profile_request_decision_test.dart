// A request decided from a teammate's profile has to leave the profile. The
// page was handed a copy of the dashboard when it was pushed and kept reading
// it, so Approve raised its toast and the card stayed exactly where it was,
// still offering Approve.
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

Map<String, dynamic> leave(String status) => {
  'id': 'leave-1',
  'userId': 'haider',
  'employee': {'name': 'Haider', 'department': 'Faculty'},
  'type': 'casual',
  'startDate': '2026-10-01',
  'endDate': '2026-10-01',
  'days': 1,
  'reason': 'Family function',
  'createdAt': '2026-09-28T04:00:00.000Z',
  'status': status,
  'managerNote': '',
};

void main() {
  testWidgets('approving from a profile clears the card', (tester) async {
    final workspace = {
      'success': true,
      'team': [
        member(name: 'Pankaj', department: 'Faculty', isSelf: true),
        member(name: 'Haider', department: 'Faculty', reportsToViewer: true),
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

    var decided = false;
    final client = MockClient((request) async {
      final path = request.url.path;
      if (request.method == 'PATCH' && path.endsWith('/leaves/leave-1/decision')) {
        decided = true;
        return http.Response(jsonEncode({'success': true, 'leave': leave('approved')}), 200);
      }
      if (path.endsWith('/manager/workspace')) {
        return http.Response(jsonEncode(workspace), 200);
      }
      if (path.endsWith('/leaves/inbox')) {
        // The server keeps sending the request as pending until it is decided,
        // so a page reading live state is the only thing that can clear it.
        return http.Response(
          jsonEncode({'success': true, 'leaves': [leave(decided ? 'approved' : 'pending')]}),
          200,
        );
      }
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

    await tester.pumpWidget(
      MaterialApp(home: ManagerScreen(session: session, bloc: bloc)),
    );
    bloc.add(const ChangeManagerTab(ManagerTab.manage));
    await tester.pumpAndSettle(const Duration(seconds: 1));

    await tester.tap(find.text('Haider'));
    await tester.pumpAndSettle(const Duration(seconds: 1));
    // The section is collapsed until it is opened.
    await tester.tap(find.text('Open Requests'));
    await tester.pumpAndSettle();
    await tester.dragUntilVisible(
      find.text('Approve').first,
      find.byType(Scrollable).last,
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();
    expect(find.text('Approve'), findsWidgets);

    await tester.tap(find.text('Approve').first);
    await tester.pumpAndSettle(const Duration(seconds: 1));

    final approveGone = find.text('Approve').evaluate().isEmpty;

    await tester.pumpWidget(const SizedBox.shrink());
    bloc.dispose();

    expect(decided, isTrue, reason: 'the decision should reach the server');
    expect(approveGone, isTrue, reason: 'the decided request should leave the profile');
  });
}
