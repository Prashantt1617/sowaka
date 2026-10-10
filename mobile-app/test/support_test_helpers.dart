// Shared fakes for the Support desk tests: a session, a fake live channel and
// server-shaped payloads.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/support/data/support_api_service.dart';
import 'package:mobile_app/features/support/data/support_models.dart';
import 'package:mobile_app/features/support/data/support_socket_service.dart';
import 'package:mobile_app/features/support/presentation/support_ui.dart';

final supportSession = AuthSession(
  token: 'token',
  user: const AuthUser(
    id: 'priya',
    email: 'priya@example.test',
    name: 'Priya',
    role: 'employee',
    company: 'Convrse',
    org: 'convrse',
  ),
);

class FakeSupportRealtime implements SupportRealtime {
  final changesController = StreamController<SupportChange>.broadcast();
  final reconnectsController = StreamController<void>.broadcast();
  bool connected = false;
  bool disposed = false;

  @override
  Stream<SupportChange> get changes => changesController.stream;

  @override
  Stream<void> get reconnects => reconnectsController.stream;

  @override
  void connect() => connected = true;

  @override
  void dispose() => disposed = true;
}

http.Response supportOk(Map<String, dynamic> body, [int status = 200]) =>
    http.Response.bytes(
      utf8.encode(jsonEncode({'success': true, ...body})),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

http.Response supportError(String message, int status) => http.Response.bytes(
  utf8.encode(jsonEncode({'success': false, 'message': message})),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

const supportTopics = [
  {'key': 'workplace', 'label': 'Workplace'},
  {'key': 'manager', 'label': 'Manager'},
  {'key': 'payroll', 'label': 'Payroll'},
  {'key': 'attendance', 'label': 'Attendance'},
  {'key': 'leaves', 'label': 'Leaves'},
  {'key': 'benefits', 'label': 'Benefits'},
  {'key': 'safety', 'label': 'Safety issues'},
  {'key': 'other', 'label': 'Other'},
];

String _iso(DateTime date) => date.toUtc().toIso8601String();

Map<String, dynamic> supportTicketJson(
  String id, {
  String topic = 'payroll',
  String label = 'Payroll',
  String status = 'assigned',
  String chip = 'In-process',
  int unread = 0,
  String preview = '',
}) => {
  'id': id,
  'ticketNo': 42,
  'topic': topic,
  'topicLabel': label,
  'status': status,
  'chip': chip,
  'createdAt': _iso(DateTime(2026, 9, 24, 10, 30)),
  'lastMessageAt': _iso(DateTime(2026, 9, 24, 10, 32)),
  'lastMessagePreview': preview,
  'unread': unread,
};

Map<String, dynamic> supportMessageJson(
  String id,
  String side,
  String text, {
  DateTime? at,
  List<Map<String, dynamic>> attachments = const [],
}) => {
  'id': id,
  'side': side,
  'senderLabel': switch (side) {
    'employee' => 'You',
    'staff' => 'HR team',
    _ => '',
  },
  'text': text,
  'attachments': attachments,
  'createdAt': _iso(at ?? DateTime(2026, 9, 24, 10, 32)),
};

SupportShell supportShell(http.Client client, {SupportRealtime? realtime}) =>
    SupportShell(
      api: SupportApiService(
        session: supportSession,
        baseUrl: 'https://example.test',
        client: client,
      ),
      profileAction: const SizedBox(width: 30, height: 30),
      onNotifications: () {},
      realtime: realtime,
    );

Widget supportApp(Widget home) => MaterialApp(home: home);

void supportTall(WidgetTester tester) {
  tester.view.physicalSize = const Size(430, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}
