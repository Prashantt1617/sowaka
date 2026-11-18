// Payroll opens only behind the phone's own lock (Face ID, fingerprint or passcode).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/payroll/presentation/payroll_lock.dart';

class FakeLock implements DeviceLock {
  FakeLock(this.results);
  final List<DeviceLockResult> results;
  int asked = 0;
  @override
  Future<DeviceLockResult> unlock(String reason) async => results[(asked++).clamp(0, results.length - 1)];
}

Future<void> pump(WidgetTester tester, FakeLock lock, PayrollLockSession session, {VoidCallback? onClose}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(body: PayrollLockGate(lock: lock, session: session, onClose: onClose ?? () {}, child: const Text('SALARY'))),
  ));
  await tester.pumpAndSettle();
}

void main() {
  late PayrollLockSession session;
  setUp(() {
    session = PayrollLockSession.instance..lock();
  });

  testWidgets('the company switch off (features.payrollLock): Payroll opens straight away, no phone lock asked', (tester) async {
    final lock = FakeLock([DeviceLockResult.canceled]);
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: PayrollLockGate(lock: lock, session: session, enabled: false, onClose: () {}, child: const Text('SALARY'))),
    ));
    await tester.pumpAndSettle();
    expect(lock.asked, 0);
    expect(find.text('SALARY'), findsOneWidget);
  });

  testWidgets('asks for the phone lock on opening and shows Payroll once unlocked', (tester) async {
    final lock = FakeLock([DeviceLockResult.unlocked]);
    await pump(tester, lock, session);
    expect(lock.asked, 1);
    expect(find.text('SALARY'), findsOneWidget);
  });

  testWidgets('cancelled: stays locked, Unlock asks again', (tester) async {
    final lock = FakeLock([DeviceLockResult.canceled, DeviceLockResult.unlocked]);
    await pump(tester, lock, session);
    expect(find.text('SALARY'), findsNothing);
    expect(find.text('Payroll is locked'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('payroll-unlock')));
    await tester.pumpAndSettle();
    expect(lock.asked, 2);
    expect(find.text('SALARY'), findsOneWidget);
  });

  testWidgets('no screen lock on the phone: asked to set one, Payroll stays shut', (tester) async {
    final lock = FakeLock([DeviceLockResult.notSet]);
    await pump(tester, lock, session);
    expect(find.text('Set a screen lock to open Payroll'), findsOneWidget);
    expect(find.text('SALARY'), findsNothing);
  });

  testWidgets('unlocked once: opening Payroll again does not ask again', (tester) async {
    final lock = FakeLock([DeviceLockResult.unlocked]);
    await pump(tester, lock, session);
    await tester.pumpWidget(const MaterialApp(home: Text('elsewhere')));
    await pump(tester, lock, session);
    expect(lock.asked, 1);
    expect(find.text('SALARY'), findsOneWidget);
  });

  testWidgets('the app going to the background locks it again', (tester) async {
    final lock = FakeLock([DeviceLockResult.unlocked, DeviceLockResult.canceled]);
    await pump(tester, lock, session);
    session.didChangeAppLifecycleState(AppLifecycleState.paused);
    await tester.pumpAndSettle();
    expect(find.text('SALARY'), findsNothing);
  });

  testWidgets('Back leaves Payroll', (tester) async {
    var closed = false;
    await pump(tester, FakeLock([DeviceLockResult.canceled]), session, onClose: () => closed = true);
    await tester.tap(find.byKey(const ValueKey('payroll-lock-back')));
    expect(closed, isTrue);
  });
}
