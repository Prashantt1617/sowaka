// A tapped game-challenge notification ({destination: 'game_challenge',
// gameKey, challengeId}) lands on the Games tab with the game open on that
// challenge; and the Rank tab reads a game challenge's points as its own kind.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/games/data/games_api_service.dart';
import 'package:mobile_app/features/games/data/games_models.dart';
import 'package:mobile_app/features/games/presentation/web_game_screen.dart';
import 'package:mobile_app/features/manager/bloc/manager_bloc.dart';
import 'package:mobile_app/features/manager/data/manager_api_service.dart';
import 'package:mobile_app/features/manager/data/manager_models.dart';
import 'package:mobile_app/features/manager/presentation/manager_screen.dart';
import 'package:mobile_app/features/profile/data/leaderboard_models.dart';
import 'package:mobile_app/services/notification_service.dart';

AuthSession _session(List<String> tabs) => AuthSession(
  token: 'token',
  user: AuthUser(
    id: 'u-divya',
    email: 'divya.rao@getsowaka.com',
    name: 'Divya Rao',
    role: 'employee',
    company: 'Sowaka',
    org: 'sowaka',
    enabledTabs: tabs,
    interests: const [],
  ),
);

/// Enough of a dashboard for the screen to build.
http.Client _dashboardServer() => MockClient((request) async {
  if (request.url.path.endsWith('/manager/workspace')) {
    return http.Response(
      jsonEncode({
        'success': true,
        'team': <dynamic>[],
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
        'approverName': '',
        'hasManager': false,
        'teamLevel': 1,
        'managerScore': 0,
      }),
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
      'managerScore': 0,
      'growthHistory': <dynamic>[],
      'team': <dynamic>[],
    }),
    200,
  );
});

Future<(ManagerBloc, List<(String, String)>)> _pump(WidgetTester tester, List<String> tabs) async {
  final session = _session(tabs);
  final bloc = ManagerBloc(
    session: session,
    service: ManagerApiService(session: session, baseUrl: 'https://example.test', client: _dashboardServer()),
  );
  await bloc.add(const LoadManagerDashboard());
  final opened = <(String, String)>[];
  await tester.pumpWidget(
    MaterialApp(
      home: ManagerScreen(
        session: session,
        bloc: bloc,
        onOpenGameChallenge: (gameKey, challengeId) => opened.add((gameKey, challengeId)),
      ),
    ),
  );
  // Not pumpAndSettle: the feed's spinner never settles without a server.
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pump(const Duration(milliseconds: 300));
  return (bloc, opened);
}

Future<void> _tearDown(WidgetTester tester, ManagerBloc bloc) async {
  AppNotificationService.instance.pendingDestination = null;
  await tester.pumpWidget(const SizedBox.shrink());
  bloc.dispose();
}

void main() {
  testWidgets('a challenge notification opens the Games tab and the game on that challenge', (tester) async {
    final (bloc, opened) = await _pump(tester, ['connect', 'games']);
    expect(bloc.state.tab, ManagerTab.connect);

    AppNotificationService.instance.openDestination({
      'destination': 'game_challenge',
      'gameKey': 'odd-one-out',
      'challengeId': 'ch-1',
      'scenario': 'game_challenge_received',
    });
    await tester.pump();
    await tester.pump();

    final tab = bloc.state.tab;
    final calls = [...opened];
    await _tearDown(tester, bloc);
    expect(tab, ManagerTab.games);
    expect(calls, [('odd-one-out', 'ch-1')]);
  });

  testWidgets('without a Games tab the game still opens, from wherever they are', (tester) async {
    final (bloc, opened) = await _pump(tester, ['connect', 'team']);
    AppNotificationService.instance.openDestination({
      'destination': 'game_challenge',
      'gameKey': 'odd-one-out',
      'challengeId': 'ch-2',
    });
    await tester.pump();
    await tester.pump();
    final tab = bloc.state.tab;
    final calls = [...opened];
    await _tearDown(tester, bloc);
    expect(tab, ManagerTab.connect);
    expect(calls, [('odd-one-out', 'ch-2')]);
  });

  testWidgets('a challenge notification without a game opens nothing', (tester) async {
    final (bloc, opened) = await _pump(tester, ['connect', 'games']);
    AppNotificationService.instance.openDestination({'destination': 'game_challenge'});
    await tester.pump();
    await tester.pump();
    final tab = bloc.state.tab;
    final calls = [...opened];
    await _tearDown(tester, bloc);
    expect(tab, ManagerTab.games);
    expect(calls, isEmpty);
  });

  group('finding the game a notification names', () {
    GamesApiService serving(http.Response Function() answer) => GamesApiService(
      session: _session(['games']),
      baseUrl: 'https://api.example.test',
      client: MockClient((_) async => answer()),
    );
    final catalog = {
      'success': true,
      'games': [
        {'key': 'odd-one-out', 'name': 'Odd One Out', 'kind': 'web', 'hasPage': true, 'version': 'v1'},
        {'key': 'half-done', 'name': 'Half Done', 'kind': 'web', 'hasPage': false},
      ],
    };

    test('a game the company has', () async {
      final game = await findCatalogGame(serving(() => http.Response(jsonEncode(catalog), 200)), 'odd-one-out');
      expect(game?.name, 'Odd One Out');
    });

    test('not one it does not, nor one this app cannot open', () async {
      final service = serving(() => http.Response(jsonEncode(catalog), 200));
      expect(await findCatalogGame(service, 'chess-club'), isNull);
      expect(await findCatalogGame(service, 'half-done'), isNull);
    });

    test('offline, the catalog last kept', () async {
      // The fetch above kept it in memory; now the server is unreachable.
      final service = serving(() => throw http.ClientException('offline'));
      expect((await findCatalogGame(service, 'odd-one-out'))?.key, 'odd-one-out');
    });
  });

  test('the game screen carries the challenge it was opened on', () {
    const game = GameCatalogEntry(key: 'odd-one-out', name: 'Odd One Out', kind: GameKind.web, hasPage: true);
    final screen = WebGameScreen.catalog(game: game, session: _session(['games']), challengeId: 'ch-1');
    expect(screen.challengeId, 'ch-1');
  });

  test("the Rank tab reads a game challenge's points as its own kind, with its game", () {
    final row = PointActivity.fromJson({
      'source': 'game_challenge',
      'title': 'Odd One Out',
      'detail': 'Game · Beat Pooja 4,320–3,980',
      'points': 17,
      'at': '2026-10-10T10:00:00.000Z',
      'gameKey': 'odd-one-out',
    });
    expect(row.source, PointSource.gameChallenge);
    expect(row.title, 'Odd One Out');
    expect(row.gameKey, 'odd-one-out');
    expect(row.points, 17);
    expect(PointActivity.fromJson({'source': 'hint_relay'}).gameKey, isNull);
  });
}
