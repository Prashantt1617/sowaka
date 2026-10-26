// The dashboard's parts load side by side, and one that fails keeps what was
// on screen instead of failing the rest. Only the workspace is the page.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';

final _session = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'priya',
    email: 'priya@example.test',
    name: 'Priya',
    role: 'manager',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

http.Response _ok(Map<String, dynamic> body) => http.Response(jsonEncode({'success': true, ...body}), 200);

ManagerApiService _service({required Set<String> failing, List<String>? calls}) => ManagerApiService(
  session: _session,
  baseUrl: 'https://example.test',
  client: MockClient((request) async {
    final path = request.url.path;
    calls?.add(path);
    if (failing.any(path.endsWith)) return http.Response(jsonEncode({'message': 'down'}), 500);
    if (path.endsWith('/manager/workspace')) return _ok({'team': <dynamic>[], 'shift': <String, dynamic>{}});
    return _ok({
      'leaves': [
        {'id': 'l1', 'type': 'casual', 'startDate': '2026-10-01', 'endDate': '2026-10-01', 'status': 'pending'},
      ],
      'overtime': <dynamic>[],
      'records': <dynamic>[],
      'regularizations': <dynamic>[],
      'claims': <dynamic>[],
      'types': <dynamic>[],
      'balance': <String, dynamic>{},
    });
  }),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('every part is asked for at once, before any answer is awaited', () async {
    final calls = <String>[];
    await _service(failing: {}, calls: calls).fetchDashboard(keep: false);
    expect(
      calls.toSet(),
      containsAll(['/manager/workspace', '/leaves/mine', '/leaves/balance', '/overtime/mine', '/attendance/mine']),
    );
  });

  test('a list that fails keeps the rest: the dashboard still loads', () async {
    final dashboard = await _service(
      failing: {'/overtime/mine', '/overtime/inbox', '/reimbursements/mine', '/attendance/mine'},
    ).fetchDashboard(keep: false);
    expect(dashboard.myLeaves, hasLength(1));
    expect(dashboard.myOvertime, isEmpty);
    expect(dashboard.attendance, isEmpty);
  });

  test('the workspace failing is the page failing', () async {
    await expectLater(
      _service(failing: {'/manager/workspace'}).fetchDashboard(keep: false),
      throwsA(isA<ManagerApiException>()),
    );
  });
}
