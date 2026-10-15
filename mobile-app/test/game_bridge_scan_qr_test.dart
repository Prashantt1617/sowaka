// `Sowaka.scanQr()`: offered to a page only where the app can scan (bridge
// version 5), answered over the same request/reply path as every other call
// with the text the scanner read, or null when it was cancelled; and the
// scanner itself, in the games' look, closing with the first code it reads.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/game_bridge.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/presentation/qr_scanner_screen.dart';

const _session = AuthSession(
  token: 'session-token',
  user: AuthUser(
    id: 'u-2',
    email: 'tanvi@getsowaka.com',
    name: 'Tanvi Shah',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
  ),
);

GameBridge _bridge({
  Future<String?> Function()? scanQr,
  List<http.Request>? requests,
}) => GameBridge(
  service: GamesApiService(
    session: _session,
    baseUrl: 'https://api.example.test',
    client: MockClient((request) async {
      requests?.add(request);
      return http.Response('{}', 200);
    }),
  ),
  gameKey: 'secret-squad',
  company: 'Sowaka',
  scanQr: scanQr,
);

/// The reply's arguments, read back out of `Sowaka.__reply(id, ok, payload)`.
({String id, bool ok, Object? payload}) _parse(String js) {
  final match = RegExp(
    r'__reply\(("[^"]*"), (true|false), (.*)\);$',
  ).firstMatch(js)!;
  return (
    id: jsonDecode(match.group(1)!) as String,
    ok: match.group(2) == 'true',
    payload: jsonDecode(match.group(3)!),
  );
}

String _ask(String id) => jsonEncode({'id': id, 'type': 'scanQr', 'data': {}});

void main() {
  group('the page script', () {
    test('offers scanQr where the app can scan, as version 5', () {
      final script = gameBridgeScript(
        playerName: 'Tanvi',
        userId: 'u-2',
        scansQr: true,
      );
      expect(script, contains('S.version = 5;'));
      expect(
        script,
        contains("S.scanQr = function () { return call('scanQr'); };"),
      );
    });

    test(
      'leaves it out where it cannot, so typeof Sowaka.scanQr is undefined',
      () {
        final script = gameBridgeScript(playerName: 'Tanvi', userId: 'u-2');
        expect(script, contains('S.version = 5;'));
        expect(script, isNot(contains('scanQr')));
      },
    );
  });

  group('the reply', () {
    test(
      'resolves with the text the scanner read, and asks the server nothing',
      () async {
        final requests = <http.Request>[];
        var scans = 0;
        final bridge = _bridge(
          requests: requests,
          scanQr: () async {
            scans++;
            return 'SQ1:s-1:0:4817';
          },
        );
        final js = await bridge.handle(_ask('c7'));
        final reply = _parse(js!);
        expect(scans, 1);
        expect(reply.id, 'c7');
        expect(reply.ok, isTrue);
        expect(reply.payload, 'SQ1:s-1:0:4817');
        expect(requests, isEmpty);
      },
    );

    test(
      'resolves with null when the scan is cancelled or the camera refused',
      () async {
        final bridge = _bridge(scanQr: () async => null);
        final reply = _parse((await bridge.handle(_ask('c8')))!);
        expect(reply.ok, isTrue);
        expect(reply.payload, isNull);
      },
    );

    test('hands text back as a value, never as script', () async {
      const nasty = '"); alert(1); </script> (';
      final bridge = _bridge(scanQr: () async => nasty);
      final js = (await bridge.handle(_ask('c9')))!;
      expect(js, isNot(contains('</script>')));
      expect(js, isNot(contains(' ')));
      expect(_parse(js).payload, nasty);
    });

    test('cuts an overlong code down', () async {
      final bridge = _bridge(scanQr: () async => 'x' * 5000);
      final reply = _parse((await bridge.handle(_ask('c10')))!);
      expect((reply.payload! as String).length, maxScannedLength);
    });

    test('a second ask while the scanner is open gets null at once', () async {
      final open = Completer<String?>();
      final bridge = _bridge(scanQr: () => open.future);
      final first = bridge.handle(_ask('c11'));
      final second = _parse((await bridge.handle(_ask('c12')))!);
      expect(second.id, 'c12');
      expect(second.payload, isNull);
      open.complete('SQ1:s-1:0:2063');
      expect(_parse((await first)!).payload, 'SQ1:s-1:0:2063');
      // Closed again: the next ask scans.
      expect(
        _parse((await bridge.handle(_ask('c14')))!).payload,
        'SQ1:s-1:0:2063',
      );
    });

    test('is refused where the phone cannot scan', () async {
      final reply = _parse((await _bridge().handle(_ask('c13')))!);
      expect(reply.ok, isFalse);
      expect((reply.payload! as Map)['status'], 501);
    });
  });

  group('the scanner screen', () {
    Future<List<String?>> pumpScanner(
      WidgetTester tester, {
      ValueChanged<ValueChanged<String>>? onReady,
    }) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final results = <String?>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () async {
                    results.add(
                      await Navigator.of(context).push<String>(
                        MaterialPageRoute(
                          builder: (_) => QrScannerScreen(
                            previewBuilder: (context, onCode) {
                              onReady?.call(onCode);
                              return const ColoredBox(color: Colors.black);
                            },
                          ),
                        ),
                      ),
                    );
                  },
                  child: const Text('Scan'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Scan'));
      await tester.pumpAndSettle();
      return results;
    }

    testWidgets(
      'shows the prompt and the way out, and closes with the code it reads',
      (tester) async {
        late ValueChanged<String> emit;
        final results = await pumpScanner(
          tester,
          onReady: (onCode) => emit = onCode,
        );
        expect(find.text('Point at a colleague’s code'), findsOneWidget);
        expect(find.text('SCAN A CODE'), findsOneWidget);
        expect(find.text('Cancel'), findsOneWidget);
        emit('SQ1:s-1:0:4817');
        // A second read on the way out is ignored.
        emit('SQ1:s-1:0:9999');
        await tester.pumpAndSettle();
        expect(results, ['SQ1:s-1:0:4817']);
        expect(find.text('Cancel'), findsNothing);
      },
    );

    testWidgets('Cancel closes it with nothing', (tester) async {
      final results = await pumpScanner(tester);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(results, [null]);
    });
  });
}
