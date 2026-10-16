import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/shared/app_update.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeService extends AppUpdateService {
  _FakeService(this.status);

  AppUpdateStatus status;
  int calls = 0;

  @override
  Future<AppUpdateStatus> check() async {
    calls += 1;
    return status;
  }
}

AppUpdateStatus _status(String mode, [String version = '1.3.8']) =>
    AppUpdateStatus.fromJson({
      'mode': mode,
      'version': version,
      'storeUrl': 'https://apps.apple.com/app/id6791144997',
    });

Widget _app(AppUpdateService service) => MaterialApp(
  builder: (context, child) =>
      AppUpdateGate(service: service, child: child ?? const SizedBox()),
  home: const Scaffold(body: Text('The app')),
);

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AppUpdateGate.optional.value = null;
  });

  testWidgets('nothing shows when no update is asked for', (tester) async {
    await tester.pumpWidget(_app(_FakeService(_status('none'))));
    await tester.pumpAndSettle();
    expect(find.text('The app'), findsOneWidget);
    expect(find.text('We are better than ever'), findsNothing);
  });

  testWidgets('force covers the app and has no way to close it', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_FakeService(_status('force'))));
    await tester.pumpAndSettle();
    expect(find.text('We are better than ever'), findsOneWidget);
    expect(find.text('Update now'), findsOneWidget);
    // Nothing to close it with, and tapping around does nothing.
    await tester.tapAt(const Offset(20, 20));
    await tester.pumpAndSettle();
    expect(find.text('Update now'), findsOneWidget);
    // The screen is opaque and on top: a tap where the app's text sits
    // lands on the update screen, not on the app.
    final hits = tester.hitTestOnBinding(tester.getCenter(find.text('The app')));
    final appText = tester.renderObject(find.text('The app'));
    expect(hits.path.any((entry) => entry.target == appText), isFalse);
  });

  testWidgets('optional shows the strip, which closes for that version', (
    tester,
  ) async {
    final service = _FakeService(_status('optional'));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) =>
            AppUpdateGate(service: service, child: child ?? const SizedBox()),
        home: const Scaffold(
          body: Column(children: [AppUpdateStrip(), Text('The app')]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // A strip in the feed, not a screen over the app.
    expect(find.text('We are better than ever'), findsOneWidget);
    expect(find.text('Update'), findsOneWidget);
    expect(find.text('Update now'), findsNothing);
    expect(find.text('The app'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();
    expect(find.text('We are better than ever'), findsNothing);

    // Back in the foreground: same version, still closed.
    AppUpdateGate.recheck();
    await tester.pumpAndSettle();
    expect(service.calls, 2);
    expect(find.text('We are better than ever'), findsNothing);

    // A newer version asks again.
    service.status = _status('optional', '1.3.9');
    AppUpdateGate.recheck();
    await tester.pumpAndSettle();
    expect(find.text('We are better than ever'), findsOneWidget);

    // Turned off on the server: the strip goes.
    service.status = _status('none');
    AppUpdateGate.recheck();
    await tester.pumpAndSettle();
    expect(find.text('We are better than ever'), findsNothing);
  });

  testWidgets('force turned off on the server lets the app through', (
    tester,
  ) async {
    final service = _FakeService(_status('force'));
    await tester.pumpWidget(_app(service));
    await tester.pumpAndSettle();
    expect(find.text('Update now'), findsOneWidget);
    service.status = _status('none');
    AppUpdateGate.recheck();
    await tester.pumpAndSettle();
    expect(find.text('Update now'), findsNothing);
  });

  test('a status with no store to open asks for nothing', () {
    final status = AppUpdateStatus.fromJson({'mode': 'force'});
    expect(status.mode, AppUpdateMode.none);
  });
}
