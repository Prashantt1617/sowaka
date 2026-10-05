// Offline handling: a request that never reaches the server marks the app
// offline and surfaces as a plain exception; the banner shows while it is
// and leaves when a request gets through.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/shared/network_status.dart';
import 'package:mobile_app/features/shared/offline_banner.dart';

final _session = AuthSession(
  token: 't',
  user: const AuthUser(id: 'u', email: 'u@x', name: 'U', role: 'employee', company: 'C', org: 'c'),
);

void main() {
  setUp(NetworkStatus.reportSuccess);

  test('a connection failure marks the app offline; a reply clears it', () async {
    var down = true;
    final api = ManagerApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: MockClient((request) async {
        if (down) throw const SocketException('Connection refused');
        return http.Response('{"success":true,"offices":[]}', 200);
      }),
    );
    await expectLater(
      api.fetchPunchOffices(),
      throwsA(isA<ManagerApiException>().having((e) => e.offline, 'offline', true)),
    );
    expect(NetworkStatus.offline.value, isTrue);
    down = false;
    await api.fetchPunchOffices();
    expect(NetworkStatus.offline.value, isFalse);
  });

  test('a refusal from the server is not offline', () async {
    final api = ManagerApiService(
      session: _session,
      baseUrl: 'https://example.test',
      client: MockClient((request) async => http.Response('{"message":"nope"}', 403)),
    );
    await expectLater(api.fetchPunchOffices(), throwsA(isA<ManagerApiException>().having((e) => e.offline, 'offline', false)));
    expect(NetworkStatus.offline.value, isFalse);
  });

  testWidgets('the banner shows only while offline, over the content', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: OfflineAware(child: Text('feed')))));
    expect(find.text('No internet connection.'), findsNothing);
    NetworkStatus.reportFailure(const SocketException('down'));
    await tester.pump();
    expect(find.text('No internet connection.'), findsOneWidget);
    expect(find.text('feed'), findsOneWidget);
    NetworkStatus.reportSuccess();
    await tester.pump();
    expect(find.text('No internet connection.'), findsNothing);
  });

  testWidgets('the launch screen is white, with the banner over a skeleton', (tester) async {
    NetworkStatus.reportFailure(const SocketException('down'));
    await tester.pumpWidget(const MaterialApp(home: OfflineSkeletonScreen()));
    expect(find.text('No internet connection.'), findsOneWidget);
    expect(tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor, Colors.white);
    NetworkStatus.reportSuccess();
  });
}
