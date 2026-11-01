// "Ask HR", "contact support" anywhere in the app goes to the Support Desk:
// which messages count, the toast's Raise ticket, the link under a "speak to
// HR" line, and the desk opening straight on a new ticket with the message
// started.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:mobile_app/features/shared/app_toast.dart';
import 'package:mobile_app/features/support/presentation/support_desk_screen.dart';
import 'package:mobile_app/features/support/presentation/support_request_screen.dart';
import 'package:mobile_app/features/support/support_launcher.dart';

import 'support_test_helpers.dart';

void main() {
  final opened = <String?>[];
  void opener({String? about}) => opened.add(about);

  setUp(opened.clear);
  tearDown(() => unregisterSupportTicketOpener(opener));

  test('which messages send someone to HR or support', () {
    for (final yes in [
      'No KPI parameters are assigned to this employee for this cycle. Ask HR to assign them.',
      'Overtime is not enabled for your team. Speak to HR if you think it should be.',
      'Please contact your HR to change it.',
      'Contact support if this keeps happening.',
      'Your HR team will look at it.',
    ]) {
      expect(mentionsHrOrSupport(yes), isTrue, reason: yes);
    }
    for (final no in ['Leave approved', 'Sent to Asha', 'HR Notice', 'Marked by HR']) {
      expect(mentionsHrOrSupport(no), isFalse, reason: no);
    }
  });

  Future<void> toast(WidgetTester tester, String message) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: Builder(builder: (context) => TextButton(onPressed: () => showAppToast(context, message), child: const Text('go')))),
    ));
    await tester.tap(find.text('go'));
    await tester.pumpAndSettle();
  }

  testWidgets('a toast that says "ask HR" carries Raise ticket, with the message', (tester) async {
    registerSupportTicketOpener(opener);
    await toast(tester, 'No KPI parameters are assigned. Ask HR to assign them.');
    expect(find.text('Raise ticket'), findsOneWidget);
    await tester.tap(find.text('Raise ticket'));
    await tester.pump();
    expect(opened, ['No KPI parameters are assigned. Ask HR to assign them.']);
  });

  testWidgets('any other toast does not', (tester) async {
    registerSupportTicketOpener(opener);
    await toast(tester, 'Leave approved');
    expect(find.text('Raise ticket'), findsNothing);
  });

  testWidgets('without a signed-in shell there is nothing to offer', (tester) async {
    await toast(tester, 'Ask HR to assign them.');
    expect(find.text('Raise ticket'), findsNothing);
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: RaiseTicketLink(about: 'x'))));
    expect(find.byKey(const ValueKey('raise-ticket-link')), findsNothing);
  });

  testWidgets('the link under a "speak to HR" line raises a ticket about it', (tester) async {
    registerSupportTicketOpener(opener);
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: RaiseTicketLink(label: 'Ask HR about this policy', about: 'A question about the Leave policy:')),
    ));
    expect(find.text('Ask HR about this policy ›'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('raise-ticket-link')));
    expect(opened, ['A question about the Leave policy:']);
  });

  testWidgets('the desk opened to raise one goes straight to a new ticket, the message started', (tester) async {
    supportTall(tester);
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/support/topics')) return supportOk({'topics': supportTopics});
      return supportOk({'tickets': []});
    });
    await tester.pumpWidget(
      supportApp(
        SupportDeskScreen(
          shell: supportShell(client, realtime: FakeSupportRealtime()),
          raiseOnOpen: true,
          raiseAbout: 'Please assign KPI parameters for Asha for this review cycle.',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(SupportRequestScreen), findsOneWidget);
    final field = tester.widget<TextField>(find.byType(TextField).first);
    expect(field.controller?.text, startsWith('Please assign KPI parameters for Asha for this review cycle.'));
    // Back lands on the desk itself.
    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();
    expect(find.byType(SupportRequestScreen), findsNothing);
    expect(find.byType(SupportDeskScreen), findsOneWidget);
  });
}
