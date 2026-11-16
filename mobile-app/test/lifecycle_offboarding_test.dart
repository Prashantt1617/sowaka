// The app's offboarding (canvas Y1R; 6Zs §6) against a fake lifecycle
// server: resigning (R0 → R1 → R1b), the Resignation tab's states (R2a,
// R2b) and withdrawing, the Off-boarding page (R3), handover uploads (R3b),
// the exit interview (R5), the account-closed screen (R6) and how sign-in
// reaches it, the manager's resignation card (R7) and Resignation tab (R8b),
// and the Held payslip (R4). Everything is hidden while the lifecycle is
// off. All people are fictional.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/bloc/auth_bloc.dart';
import 'package:mobile_app/features/auth/data/auth_api_service.dart';
import 'package:mobile_app/features/lifecycle/offboarding/offboarding.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/lifecycle_me_store.dart';
import 'package:mobile_app/features/lifecycle/onboarding/data/onboarding_models.dart' as onb;
import 'package:mobile_app/features/payroll/data/payroll_api_service.dart';
import 'package:mobile_app/features/quick_actions/presentation/quick_actions_screen.dart';
import 'package:mobile_app/features/shared/attachment_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'lifecycle_offboarding_fake.dart';

void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(393 * 3, 852 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Finder text(String value) => find.text(value, findRichText: true);
Finder key(String value) => find.byKey(ValueKey(value));

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
  }
  await tester.pumpAndSettle();
}

/// Taps [finder] after scrolling it into view.
Future<void> tapShown(WidgetTester tester, Finder finder) async {
  // A long list builds lazily: scroll until it exists.
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      finder,
      150,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await settle(tester);
}

/// A stand-in for one's own profile: Work detail's Resign row, then the
/// Resignation tab when the store says there is one.
class _ProfileHost extends StatelessWidget {
  const _ProfileHost(this.store);

  final OffboardingStore store;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: ListenableBuilder(
      listenable: store,
      builder: (context, _) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Work detail'),
          ResignEntryRow(store: store),
          if (store.showsResignationTab) ...[
            const Text('Resignation tab'),
            OwnResignationTab(
              key: ValueKey(store.resignation?.status),
              store: store,
              today: DateTime(2026, 12, 14),
            ),
          ],
        ],
      ),
    ),
  );
}

void main() {
  setUpAll(() async {
    await (FontLoader(
      'Sora',
    )..addFont(rootBundle.load('assets/fonts/sora/Sora-Variable.ttf'))).load();
  });

  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(FakeLifecycle.uninstall);

  Future<(FakeLifecycle, OffboardingStore)> pumpProfile(
    WidgetTester tester, [
    void Function(FakeLifecycle fake)? arrange,
  ]) async {
    phone(tester);
    final fake = FakeLifecycle();
    arrange?.call(fake);
    fake.install();
    final store = OffboardingStore.of(leaverSession);
    await tester.pumpWidget(MaterialApp(home: _ProfileHost(store)));
    await tester.runAsync(store.ensureLoaded);
    await settle(tester);
    return (fake, store);
  }

  testWidgets('off: no Resign row, no tab, no tile, no requests', (
    tester,
  ) async {
    final (fake, store) = await pumpProfile(
      tester,
      (fake) => fake.enabled = false,
    );
    expect(fake.calls, ['GET /lifecycle/me']);
    expect(key('resign-entry'), findsNothing);
    expect(text('Resignation tab'), findsNothing);
    expect(store.showsOffboardingPage, isFalse);
    expect(store.managerResignations, isEmpty);
  });

  testWidgets(
    'resign: reason, note, Not now, Yes send it → With manager → withdraw',
    (tester) async {
      final (fake, store) = await pumpProfile(tester);
      expect(text('Resign'), findsOneWidget);
      expect(text('Start your resignation'), findsOneWidget);
      expect(text('Resignation tab'), findsNothing);

      await tapShown(tester, key('resign-entry-row'));
      expect(key('resign-screen'), findsOneWidget);
      expect(text("Anything you'd like Meera and HR to know…"), findsOneWidget);
      expect(text('Thu, 31 Dec 2026'), findsOneWidget);
      expect(
        text(
          'Most people tell their manager before sending this. This form doesn\'t replace that conversation.',
        ),
        findsOneWidget,
      );
      expect(text('Only your manager and HR can see this.'), findsOneWidget);
      // No last-day picker, and Continue waits for a reason.
      expect(find.byType(CalendarDatePicker), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.descendant(
                of: key('resign-continue'),
                matching: find.byType(FilledButton),
              ),
            )
            .onPressed,
        isNull,
      );

      await tapShown(tester, key('resign-reason'));
      await tapShown(tester, key('resign-reason-Better opportunity'));
      await tester.enterText(
        key('resign-note'),
        'Happy to help brief whoever takes over.',
      );
      await tapShown(tester, key('resign-continue'));
      expect(text('Send your resignation?'), findsOneWidget);
      expect(
        text(
          'It goes to Meera first, then HR. Your last day is set from your notice period. You can withdraw it until HR accepts.',
        ),
        findsOneWidget,
      );
      expect(text('60 days'), findsOneWidget);

      await tapShown(tester, key('resign-not-now'));
      expect(text('Send your resignation?'), findsNothing);
      expect(key('resign-screen'), findsOneWidget);
      expect(
        fake.calls.where((c) => c == 'POST /lifecycle/resignation'),
        isEmpty,
      );

      await tapShown(tester, key('resign-continue'));
      await tapShown(tester, key('resign-send'));
      expect(fake.bodies['POST /lifecycle/resignation'], {
        'reason': 'Better opportunity',
        'note': 'Happy to help brief whoever takes over.',
      });
      expect(key('resign-screen'), findsNothing);
      // Back on the profile: the tab, With manager, and no Resign row.
      expect(text('Resignation tab'), findsOneWidget);
      expect(key('resign-entry'), findsNothing);
      expect(key('resignation-tab-open'), findsOneWidget);
      expect(text('With manager'), findsOneWidget);
      expect(text('Reviewing'), findsOneWidget);
      expect(text('Sun, 1 Nov 2026'), findsOneWidget);
      expect(text('You can withdraw until HR accepts.'), findsOneWidget);

      await tapShown(tester, key('resignation-withdraw'));
      expect(text('Withdraw your resignation?'), findsOneWidget);
      await tapShown(tester, key('off-confirm-yes'));
      expect(fake.calls, contains('POST /lifecycle/resignation/withdraw'));
      // The tab goes; the profile is back to normal.
      expect(text('Resignation tab'), findsNothing);
      expect(key('resign-entry'), findsOneWidget);
      expect(store.resignation, isNull);
    },
  );

  testWidgets('With HR after the manager accepts; On notice once HR accepts', (
    tester,
  ) async {
    final (fake, store) = await pumpProfile(tester, (fake) {
      fake.canResign = false;
      fake.resignation = {
        'id': 'res-1',
        'userId': 'ravi',
        'reason': 'Better opportunity',
        'noticeDays': 60,
        'submittedAt': '2026-11-01T05:00:00.000Z',
        'lastDayByNotice': '2026-12-31',
        'status': 'with_hr',
        'managerName': 'Meera Iyer',
        'manager': {
          'action': 'accept',
          'at': '2026-11-02T05:00:00.000Z',
          'byName': 'Meera Iyer',
        },
      };
    });
    expect(text('With HR'), findsOneWidget);
    expect(text('In review'), findsOneWidget);
    expect(text('Accepted 2 Nov'), findsOneWidget);
    expect(key('resignation-withdraw'), findsOneWidget);

    fake.onNotice();
    await tester.runAsync(store.refresh);
    await settle(tester);
    expect(key('resignation-tab-notice'), findsOneWidget);
    expect(text('ON NOTICE · ACCEPTED 4 NOV'), findsOneWidget);
    expect(text('17 days to go'), findsOneWidget);
    expect(text('Last day: Thu, 31 Dec'), findsOneWidget);
    // HR has accepted: no withdrawing now.
    expect(key('resignation-withdraw'), findsNothing);
    expect(key('before-you-go-card'), findsOneWidget);
    expect(text('0 of 4 done'), findsOneWidget);
    expect(text('2 of 4 uploaded · from Meera'), findsOneWidget);
    expect(text('IT desk, 2nd floor · by 31 Dec'), findsOneWidget);
    expect(text('Opens 26 Dec · answers go to HR only'), findsOneWidget);
    expect(text('HR emails it as a PDF'), findsOneWidget);
    expect(text('After 31 Dec'), findsOneWidget);
    expect(text('Early release'), findsOneWidget);
    expect(text('None'), findsOneWidget);
  });

  testWidgets(
    'Off-boarding page: notice, before you go, coming up; documents open payroll',
    (tester) async {
      phone(tester);
      final fake = FakeLifecycle()..onNotice();
      fake.install();
      final store = OffboardingStore.of(leaverSession);
      await tester.runAsync(store.ensureLoaded);
      expect(store.showsOffboardingPage, isTrue);
      final opened = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: OffboardingPage(
            store: store,
            today: DateTime(2026, 12, 14),
            chrome: OffboardingChrome(
              onOpenDocuments: () => opened.add('payroll'),
            ),
          ),
        ),
      );
      await settle(tester);
      expect(text('Off-boarding'), findsOneWidget);
      expect(text('Your notice'), findsOneWidget);
      expect(text('7 of 9 weeks'), findsOneWidget);
      for (final label in ['Resigned', 'Accepted', 'Handover', 'Last day']) {
        expect(
          find.descendant(of: find.byType(OffStepper), matching: text(label)),
          findsOneWidget,
        );
      }
      expect(text('by 24 Dec'), findsOneWidget);
      expect(text('0 of 4 done · start with your handover'), findsOneWidget);
      expect(text('2 of 4 uploaded · from Meera'), findsOneWidget);
      expect(
        text('Payslips and Form 16 · before your access ends'),
        findsOneWidget,
      );
      // Nothing after they have gone, nor the resignation itself.
      expect(text('Ask to stay in touch'), findsNothing);
      expect(text('Send resignation'), findsNothing);
      for (final line in [
        'Handover due to Meera',
        'Exit interview opens',
        'Last working day',
        'HR emails your settlement PDF',
      ]) {
        expect(text(line), findsOneWidget);
      }
      await tapShown(tester, key('off-task-documents'));
      expect(opened, ['payroll']);
    },
  );

  testWidgets('handover: upload a file, add a link, replace and remove', (
    tester,
  ) async {
    phone(tester);
    final fake = FakeLifecycle()..onNotice();
    fake.install();
    final store = OffboardingStore.of(leaverSession);
    await tester.runAsync(store.ensureLoaded);
    HandoverScreen.testPicker = (_) async => PickedAttachment(
      name: 'vendors.xlsx',
      bytes: Uint8List.fromList(utf8.encode('vendors')),
    );
    addTearDown(() => HandoverScreen.testPicker = null);
    await tester.pumpWidget(
      MaterialApp(
        home: HandoverScreen(store: store, managerName: 'Meera Iyer'),
      ),
    );
    await settle(tester);

    expect(text('Checklist from Meera'), findsOneWidget);
    expect(text('Added 2 Dec · due 24 Dec'), findsOneWidget);
    expect(key('handover-note'), findsOneWidget);
    expect(text('2 of 4 uploaded'), findsOneWidget);
    expect(text('ds-handover.pdf'), findsOneWidget);
    expect(text('Shared with Meera and HR.'), findsOneWidget);
    expect(text('Upload file'), findsNWidgets(2));

    await tapShown(tester, key('handover-upload-h3'));
    expect(fake.bodies['POST /lifecycle/offboarding/handover/h3'], {
      'filename': 'vendors.xlsx',
    });
    expect(text('vendors.xlsx'), findsOneWidget);
    expect(text('3 of 4 uploaded'), findsOneWidget);

    await tapShown(tester, key('handover-link-h4'));
    await tester.enterText(
      key('handover-link-field'),
      'drive.example.com/walkthrough',
    );
    await tapShown(tester, key('handover-link-save'));
    expect(fake.bodies['POST /lifecycle/offboarding/handover/h4'], {
      'url': 'https://drive.example.com/walkthrough',
    });
    expect(text('drive.example.com/walkthrough'), findsOneWidget);
    expect(text('4 of 4 uploaded'), findsOneWidget);

    await tapShown(tester, key('handover-replace-h1'));
    await tapShown(tester, key('handover-replace-remove'));
    expect(fake.calls, contains('DELETE /lifecycle/offboarding/handover/h1'));
    expect(text('ds-handover.pdf'), findsNothing);
    expect(text('3 of 4 uploaded'), findsOneWidget);
  });

  testWidgets(
    'handover before the checklist: says it is waiting on the manager',
    (tester) async {
      phone(tester);
      final fake = FakeLifecycle()..onNotice();
      fake.handover.clear();
      fake.install();
      final store = OffboardingStore.of(leaverSession);
      await tester.pumpWidget(
        MaterialApp(
          home: HandoverScreen(store: store, managerName: 'Meera Iyer'),
        ),
      );
      await settle(tester);
      expect(
        text(
          "Meera hasn't added the checklist yet. It shows here once they do.",
        ),
        findsOneWidget,
      );
    },
  );

  group('exit interview', () {
    Future<(FakeLifecycle, OffboardingStore)> pumpInterview(
      WidgetTester tester,
      ExitInterviewState state,
    ) async {
      phone(tester);
      final fake = FakeLifecycle()..onNotice();
      fake.install();
      final store = OffboardingStore.of(leaverSession);
      await tester.pumpWidget(
        MaterialApp(
          home: ExitInterviewScreen(
            store: store,
            interview: state,
            managerFirst: 'Meera',
          ),
        ),
      );
      await settle(tester);
      return (fake, store);
    }

    testWidgets('before Tl − 5 it says when it opens', (tester) async {
      await pumpInterview(
        tester,
        ExitInterviewState(opensAt: DateTime(2026, 12, 26)),
      );
      expect(key('exit-interview-locked'), findsOneWidget);
      expect(text('Opens Sat, 26 Dec'), findsOneWidget);
      expect(key('exit-interview-send'), findsNothing);
    });

    testWidgets('open: five optional questions, Send to HR, then sent', (
      tester,
    ) async {
      final (fake, _) = await pumpInterview(
        tester,
        ExitInterviewState(opensAt: DateTime(2026, 12, 26), open: true),
      );
      expect(
        text(
          "Your answers go to HR only. Meera won't see them, and they don't affect your settlement or relieving letter. You can skip any question.",
        ),
        findsOneWidget,
      );
      for (var n = 1; n <= 5; n++) {
        await tester.scrollUntilVisible(
          text('QUESTION $n OF 5'),
          150,
          scrollable: find.byType(Scrollable).first,
        );
        expect(text('QUESTION $n OF 5'), findsOneWidget);
      }
      await tester.drag(find.byType(Scrollable).first, const Offset(0, 2000));
      await tester.pumpAndSettle();
      Finder send() => find.descendant(
        of: key('exit-interview-send'),
        matching: find.byType(FilledButton),
      );
      expect(tester.widget<FilledButton>(send()).onPressed, isNull);

      await tapShown(tester, key('exit-reason-growth'));
      await tapShown(tester, key('exit-working-4'));
      await tapShown(tester, key('exit-manager-3'));
      await tapShown(tester, key('exit-come-back-maybe'));
      await tester.enterText(
        key('exit-change'),
        'Clearer growth paths for designers.',
      );
      await tester.pump();
      await tapShown(tester, key('exit-interview-send'));
      expect(fake.bodies['POST /lifecycle/offboarding/interview'], {
        'reason': 'growth',
        'workingHere': 4,
        'manager': 3,
        'comeBack': 'maybe',
        'change': 'Clearer growth paths for designers.',
      });
      expect(key('exit-interview-sent'), findsOneWidget);
      expect(text('Sent to HR'), findsOneWidget);
    });

    testWidgets('a skipped question is left out', (tester) async {
      final (fake, _) = await pumpInterview(
        tester,
        const ExitInterviewState(open: true),
      );
      await tapShown(tester, key('exit-come-back-no'));
      await tapShown(tester, key('exit-interview-send'));
      expect(fake.bodies['POST /lifecycle/offboarding/interview'], {
        'comeBack': 'no',
      });
    });
  });

  group('manager', () {
    Future<(FakeLifecycle, OffboardingStore)> pumpRequests(
      WidgetTester tester,
    ) async {
      phone(tester);
      final fake = FakeLifecycle()
        ..canResign = false
        ..managerResignations.addAll([
          reportResignation(),
          reportResignation(
            id: 'res-2',
            userId: 'neha',
            name: 'Neha Joshi',
            note: null,
          ),
        ]);
      fake.install();
      final store = OffboardingStore.of(managerSession);
      await tester.runAsync(store.ensureLoaded);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ManagerResignationRequests(
                  store: store,
                  today: DateTime(2026, 11, 2),
                ),
              ],
            ),
          ),
        ),
      );
      await settle(tester);
      return (fake, store);
    }

    testWidgets(
      'the card: sent, reason, notice, last day, note; Accept and Change last day, no Reject',
      (tester) async {
        final (fake, store) = await pumpRequests(tester);
        expect(store.pendingForManager, 2);
        expect(text('Resignation · Ravi Menon'), findsOneWidget);
        expect(text('Design Lead'), findsNWidgets(2));
        expect(text('Sun, 1 Nov'), findsNWidgets(2));
        expect(text('Better opportunity'), findsNWidgets(2));
        expect(text('60 days'), findsNWidgets(2));
        expect(text('Thu, 31 Dec'), findsNWidgets(2));
        expect(
          text(
            '“Thank you for the last five years. Happy to help brief whoever takes over the design system.”',
          ),
          findsOneWidget,
        );
        expect(text('Accept'), findsNWidgets(2));
        expect(text('Change last day'), findsNWidgets(2));
        expect(text('Release early'), findsNWidgets(2));
        expect(text('Reject'), findsNothing);
        expect(
          text('This request is private. Only you and HR can see it.'),
          findsNWidgets(2),
        );

        await tapShown(tester, key('resignation-accept-res-1'));
        expect(fake.bodies['POST /lifecycle/manager/resignations/res-1'], {
          'action': 'accept',
        });
        // Passed to HR: the pill, and no buttons left on it.
        expect(text('With HR'), findsOneWidget);
        expect(key('resignation-accept-res-1'), findsNothing);
        expect(store.pendingForManager, 1);
      },
    );

    testWidgets('Change last day and Release early pick a date', (
      tester,
    ) async {
      final (fake, _) = await pumpRequests(tester);
      await tapShown(tester, key('resignation-change-day-res-2'));
      expect(text('New last day'), findsOneWidget);
      await tester.tap(text('30'));
      await tester.pump();
      await tapShown(tester, text('OK'));
      expect(fake.bodies['POST /lifecycle/manager/resignations/res-2'], {
        'action': 'change_day',
        'date': '2026-12-30',
      });
      expect(text('You agreed:'), findsOneWidget);

      await tapShown(tester, key('resignation-release-early-res-1'));
      expect(text('Release on'), findsOneWidget);
      await tester.tap(text('20'));
      await tester.pump();
      await tapShown(tester, text('OK'));
      expect(fake.bodies['POST /lifecycle/manager/resignations/res-1'], {
        'action': 'release_early',
        'date': '2026-11-20',
      });
    });

    testWidgets(
      'Resignation tab on the report: checklist, note, add, remove, mark done; never pay',
      (tester) async {
        phone(tester);
        final fake = FakeLifecycle()..onNotice();
        fake.managerResignations.add({
          ...fake.resignation!,
          'name': 'Ravi Menon',
        });
        fake.install();
        final store = OffboardingStore.of(managerSession);
        await tester.runAsync(store.ensureLoaded);
        expect(store.resignationOf('ravi'), isNotNull);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  ManagerLeaverTab(
                    store: store,
                    userId: 'ravi',
                    name: 'Ravi Menon',
                    today: DateTime(2026, 12, 14),
                  ),
                ],
              ),
            ),
          ),
        );
        await settle(tester);
        expect(text('ON NOTICE · ACCEPTED 4 NOV'), findsOneWidget);
        expect(text('17 days to go'), findsOneWidget);
        expect(text('Handover checklist'), findsOneWidget);
        expect(text('NOTE FOR RAVI'), findsOneWidget);
        expect(text('2 of 4 uploaded'), findsOneWidget);
        expect(text('ds-handover.pdf · Uploaded 12 Dec'), findsOneWidget);
        expect(text('Waiting for Ravi'), findsNWidgets(2));
        expect(text('Other exit steps'), findsOneWidget);
        expect(text('Tracked by IT and admin'), findsOneWidget);
        expect(
          text('This tab is private. Only you and HR can see it.'),
          findsOneWidget,
        );
        expect(find.textContaining('₹'), findsNothing);

        await tester.enterText(key('manager-handover-new'), 'Client contacts');
        await tapShown(tester, key('manager-handover-add'));
        final added =
            fake.bodies['PUT /lifecycle/manager/leavers/ravi/handover'] as Map;
        expect(added['items'], [
          'Design system file and docs',
          'Open projects, status and owners',
          'Vendor and tool access list',
          'Walkthrough recording for Asha',
          'Client contacts',
        ]);
        expect(text('Client contacts'), findsOneWidget);
        expect(text('2 of 5 uploaded'), findsOneWidget);

        await tapShown(tester, key('manager-handover-remove-h3'));
        expect(
          (fake.bodies['PUT /lifecycle/manager/leavers/ravi/handover']
              as Map)['items'],
          isNot(contains('Vendor and tool access list')),
        );
        expect(text('2 of 4 uploaded'), findsOneWidget);

        await tester.enterText(
          key('manager-handover-note'),
          'By 24 Dec, please.',
        );
        await tester.pump();
        await tapShown(tester, key('manager-handover-note-save'));
        expect(
          (fake.bodies['PUT /lifecycle/manager/leavers/ravi/handover']
              as Map)['note'],
          'By 24 Dec, please.',
        );

        await tapShown(tester, key('manager-mark-handover-done'));
        expect(text('2 items are still waiting for Ravi.'), findsOneWidget);
        await tapShown(tester, key('off-confirm-yes'));
        expect(
          fake.calls,
          contains('POST /lifecycle/manager/leavers/ravi/handover/done'),
        );
        expect(key('manager-handover-done'), findsOneWidget);
      },
    );

    testWidgets(
      'before HR accepts the tab tracks the resignation and holds the checklist',
      (tester) async {
        phone(tester);
        final fake = FakeLifecycle()
          ..resignation = reportResignation(status: 'with_hr');
        fake.managerResignations.add(reportResignation(status: 'with_hr'));
        fake.install();
        final store = OffboardingStore.of(managerSession);
        await tester.runAsync(store.ensureLoaded);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ListView(
                children: [
                  ManagerLeaverTab(
                    store: store,
                    userId: 'ravi',
                    name: 'Ravi Menon',
                  ),
                ],
              ),
            ),
          ),
        );
        await settle(tester);
        expect(text('With HR'), findsOneWidget);
        expect(
          text(
            'Once HR accepts, you add the handover checklist for Ravi here.',
          ),
          findsOneWidget,
        );
        expect(key('manager-mark-handover-done'), findsNothing);
      },
    );
  });

  group('account closed (R6)', () {
    test(
      'a refusal carrying accountClosed, or one this device was told to expect',
      () async {
        final fromServer = await accountClosedFor(
          statusCode: 401,
          message: 'User is not active',
          body: {
            'accountClosed': {
              'company': {'name': 'Sowaka'},
              'lastWorkingDay': '2026-12-31',
              'hrEmail': 'hr@sowaka.test',
            },
          },
        );
        expect(fromServer?.companyName, 'Sowaka');
        expect(fromServer?.lastDay, DateTime(2026, 12, 31));
        expect(fromServer?.hrEmail, 'hr@sowaka.test');

        // Today's refusal, for someone this device never saw on notice: sign-in as before.
        expect(
          await accountClosedFor(
            statusCode: 403,
            message: 'This employee account is not active',
            email: 'a@sowaka.test',
          ),
          isNull,
        );
        await AccountClosedHints.remember(
          'ravi.menon@sowaka.test',
          AccountClosedInfo(
            companyName: 'Sowaka',
            lastDay: DateTime(2026, 12, 31),
          ),
        );
        final remembered = await accountClosedFor(
          statusCode: 403,
          message: 'This employee account is not active',
          email: 'Ravi.Menon@sowaka.test',
        );
        expect(remembered?.lastDay, DateTime(2026, 12, 31));
        // Anything else is not a closed account.
        expect(
          await accountClosedFor(
            statusCode: 401,
            message: 'Session expired or invalid',
            email: 'ravi.menon@sowaka.test',
          ),
          isNull,
        );
        expect(
          await accountClosedFor(
            statusCode: 500,
            message: 'not active',
            email: 'ravi.menon@sowaka.test',
          ),
          isNull,
        );
      },
    );

    test(
      'serving notice where the lifecycle is on is what the device remembers',
      () async {
        final fake = FakeLifecycle()..onNotice();
        fake.install();
        await OffboardingStore.of(leaverSession).ensureLoaded();
        await Future<void>.delayed(Duration.zero);
        final hint = await AccountClosedHints.read('ravi.menon@sowaka.test');
        expect(hint?.companyName, 'Sowaka');
        expect(hint?.lastDay, DateTime(2026, 12, 31));
      },
    );

    test(
      'sign-in: a closed account is routed to its screen, anyone else keeps the error',
      () async {
        final closed = AuthBloc(
          service: _RefusingAuth(
            const AuthApiException(
              'This employee account is not active',
              statusCode: 403,
              body: {
                'message': 'This employee account is not active',
                'accountClosed': {
                  'companyName': 'Sowaka',
                  'lastWorkingDay': '2026-12-31',
                },
              },
            ),
          ),
        );
        closed.add(const AuthEmailChanged('ravi.menon@sowaka.test'));
        closed.add(const RequestAuthOtp());
        await closed.stream.firstWhere(
          (state) => state.status == AuthStatus.idle,
        );
        expect(closed.state.closedAccount?.companyName, 'Sowaka');

        final other = AuthBloc(
          service: _RefusingAuth(
            const AuthApiException(
              'This employee account is not active',
              statusCode: 403,
            ),
          ),
        );
        other.add(const AuthEmailChanged('someone@convrse.test'));
        other.add(const RequestAuthOtp());
        await other.stream.firstWhere(
          (state) => state.status == AuthStatus.idle,
        );
        expect(other.state.closedAccount, isNull);
        expect(other.state.error, 'This employee account is not active');
      },
    );

    testWidgets('the screen: last day, HR email, Email HR, Back to sign in', (
      tester,
    ) async {
      phone(tester);
      final mails = <Uri>[];
      var back = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: AccountClosedScreen(
            info: AccountClosedInfo(
              companyName: 'Sowaka',
              lastDay: DateTime(2026, 12, 31),
              hrEmail: 'hr@sowaka.test',
            ),
            onBackToSignIn: () => back++,
            openMail: (uri) async => mails.add(uri),
          ),
        ),
      );
      expect(text('This account is no longer active'), findsOneWidget);
      expect(
        text(
          'Your last day at Sowaka was 31 Dec 2026. For your documents, contact HR at hr@sowaka.test.',
        ),
        findsOneWidget,
      );
      expect(text('Thank you for your time here.'), findsOneWidget);
      await tester.tap(key('account-closed-email-hr'));
      expect(mails.single.toString(), 'mailto:hr@sowaka.test');
      await tester.tap(key('account-closed-sign-in'));
      expect(back, 1);
    });

    testWidgets('without an HR email there is no Email HR', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: AccountClosedScreen(
            info: const AccountClosedInfo(),
            onBackToSignIn: () {},
          ),
        ),
      );
      expect(text('For your documents, contact HR.'), findsOneWidget);
      expect(key('account-closed-email-hr'), findsNothing);
    });
  });

  testWidgets(
    'a held payslip shows Gross and Held, never the credited amount',
    (tester) async {
      phone(tester);
      // Held shows only where the company has the lifecycle on.
      LifecycleMeStore.instance.value = const onb.LifecycleMe(enabled: true);
      addTearDown(LifecycleMeStore.instance.clear);
      Map<String, dynamic> slip(String period, {bool held = false}) => {
        'run': {
          'id': 'run-$period',
          'period': period,
          'status': 'paid',
          'paidAt': '$period-28T09:00:00.000Z',
        },
        'payslip': {
          'id': 'slip-$period',
          'period': period,
          'employeeName': 'Ravi Menon',
          if (held) 'held': {'reason': 'notice', 'since': '2026-11-01'},
          'earnings': [
            {
              'code': 'BASIC',
              'name': 'Basic',
              'fullPaise': 12400000,
              'paidPaise': 12400000,
            },
          ],
          'deductions': <dynamic>[],
          'grossPaise': 12400000,
          'netPayablePaise': 10640000,
          'reimbursementsPaise': 0,
          'inputs': {'workingDays': 30, 'payableDays': 30, 'lopDays': 0},
        },
      };
      final client = MockClient((request) async {
        return switch (request.url.path) {
          '/payroll/me/salary' => json({
            'success': true,
            'salary': {
              'period': '2026-11',
              'label': 'November 2026',
              'view': 'previous',
              'currentPeriod': '2026-12',
              'previousPeriod': '2026-11',
              'released': false,
              'payslipId': null,
              'periodFrom': '2026-11-01',
              'periodTo': '2026-11-30',
              'unpaidDays': {'period': '2026-11', 'count': 0, 'locked': false},
              'payslips': {'count': 2, 'from': '2026-10', 'to': '2026-11'},
              'daysPaid': 30,
              'daysInPeriod': 30,
              'baseDays': 30,
              'grossPaise': 12400000,
              'takeHomePaise': 10640000,
              'lines': <dynamic>[],
              'lop': {'days': 0},
              'notSetUp': null,
            },
          }),
          '/payslips/mine' => json({
            'success': true,
            'company': {'name': 'Sowaka', 'address': 'Bengaluru'},
            'payslips': [slip('2026-11', held: true), slip('2026-10')],
          }),
          _ => json({'success': false, 'message': 'Route not found'}, 404),
        };
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PayrollSalarySummaryHost(
              screen: PayrollScreen(
                api: PayrollApiService(
                  session: leaverSession,
                  baseUrl: 'https://example.test',
                  client: client,
                ),
                onClose: () {},
                profileAction: const SizedBox(width: 30, height: 30),
                onNotifications: () {},
                onQuickCreate: () {},
                onFixPunchDay: (_) {},
              ),
            ),
          ),
        ),
      );
      await settle(tester);
      await tester.scrollUntilVisible(
        text('Past payslips'),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.tap(text('Past payslips'));
      await settle(tester);
      expect(key('payslip-held-slip-2026-11'), findsOneWidget);
      expect(text('Gross ₹1,24,000'), findsOneWidget);
      expect(text('Held'), findsOneWidget);
      // October was paid as usual.
      expect(text('Credited 28 Oct'), findsOneWidget);
      expect(text('₹1,06,400'), findsOneWidget);

      await tester.tap(key('payslip-row-slip-2026-11'));
      await settle(tester);
      expect(text('Held'), findsOneWidget);
      expect(find.textContaining('Credited'), findsNothing);
    },
  );
}

class _RefusingAuth extends AuthApiService {
  _RefusingAuth(this.error)
    : super(
        baseUrl: 'https://example.test',
        client: MockClient((_) async => http.Response('', 500)),
      );

  final AuthApiException error;

  @override
  Future<void> requestOtp(String email) async => throw error;
}
