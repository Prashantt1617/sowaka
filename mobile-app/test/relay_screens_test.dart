import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/relay/data/relay_models.dart';
import 'package:mobile_app/features/relay/presentation/relay_buttons.dart';
import 'package:mobile_app/features/relay/presentation/relay_confetti.dart';
import 'package:mobile_app/features/relay/presentation/relay_error_mark.dart';
import 'package:mobile_app/features/relay/presentation/relay_how_to_play.dart';
import 'package:mobile_app/features/relay/presentation/relay_leaderboard.dart';
import 'package:mobile_app/features/relay/presentation/relay_lobby.dart';
import 'package:mobile_app/features/relay/presentation/relay_play.dart';
import 'package:mobile_app/features/relay/presentation/relay_post_card.dart';
import 'package:mobile_app/features/relay/presentation/relay_round_demo.dart';
import 'package:mobile_app/features/relay/presentation/relay_score_reveal.dart';
import 'package:mobile_app/features/auth/data/auth_models.dart';
import 'package:mobile_app/features/connect/data/connect_models.dart';

/// Every game screen, on every phone size people will actually hold, with the
/// awkward data real events produce: long names, a lone player, an empty
/// table, a six-person team, a clue that is one letter.
///
/// A layout overflow is reported as an exception in a widget test, so these
/// fail on the stripes you would otherwise only find on somebody's phone.

const _phones = <String, Size>{
  'iPhone SE': Size(320, 568),
  'iPhone 8': Size(375, 667),
  'iPhone 16': Size(393, 852),
  'iPhone 16 Pro Max': Size(430, 932),
};

RelayTeammate _mate(String name, {bool present = true, bool leader = false, bool you = false}) =>
    RelayTeammate(name: name, present: present, isLeader: leader, hasClue: present, isYou: you);

RelayState _state({
  RelayPhase phase = RelayPhase.playing,
  bool isLeader = false,
  List<RelayPiece> pieces = const [],
  bool leadIsAnswering = false,
  List<RelayStanding> standings = const [],
  List<RelayTeammate>? teammates,
  String teamName = 'Kritik TEAM',
  String prompt = 'Guess the movie',
  int points = 320,
  int round = 2,
  RelayOutcome? lastOutcome,
  RelayRoundFinish? roundFinish,
}) =>
    RelayState(
      phase: phase,
      eventName: 'Hint Relay',
      round: round,
      rounds: 5,
      teamName: teamName,
      points: points,
      isLeader: isLeader,
      leadName: 'Rahul',
      leadIsAnswering: leadIsAnswering,
      prompt: prompt,
      questionNumber: 1,
      questionsPerRound: 5,
      pointsPerCorrect: 40,
      roundSecondsLeft: 150,
      questionSecondsLeft: 30,
      secondsUntilStart: 8,
      instructionsVideoUrl: '',
      pieces: pieces,
      teammates: teammates ??
          [
            _mate('Rohan', leader: true),
            _mate('Ananya Bisht', you: true),
            _mate('Meenakshi'),
            _mate('Rishita', present: false),
            _mate('Rishita', present: false),
          ],
      standings: standings,
      yourRank: 7,
      pointsThisRound: 100,
      lastOutcome: lastOutcome,
      roundFinish: roundFinish,
      roundSeconds: 150,
      roundKinds: const ['odd', 'word', 'movie', 'number', 'person'],
    );

const _longName = 'Venkataraghavan Subramaniam Iyengar-Krishnamurthy';

final _table = [
  const RelayStanding(rank: 1, name: 'Shiv Team', points: 980),
  const RelayStanding(rank: 2, name: 'Ananya Team', points: 860),
  const RelayStanding(rank: 3, name: 'Tanvi Team', points: 790),
  const RelayStanding(rank: 4, name: '$_longName TEAM', points: 12345),
  for (var i = 5; i <= 44; i += 1) RelayStanding(rank: i, name: 'Team $i', points: 1000 - i),
];

/// Pumps a screen at a phone size and fails on any exception, overflow included.
Future<void> _render(WidgetTester tester, Size size, Widget screen) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: screen)));
  await tester.pump(const Duration(milliseconds: 300));
  expect(tester.takeException(), isNull);
}

void main() {
  for (final MapEntry(key: phone, value: size) in _phones.entries) {
    group(phone, () {
      testWidgets('lobby, a full team', (tester) async {
        await _render(tester, size, RelayLobby(state: _state(phase: RelayPhase.lobby), secondsLeft: 8));
      });

      testWidgets('lobby, very long names and a six-person team', (tester) async {
        await _render(
          tester,
          size,
          RelayLobby(
            state: _state(
              phase: RelayPhase.lobby,
              teammates: [
                _mate(_longName, leader: true),
                for (var i = 0; i < 5; i += 1) _mate('$_longName $i', present: i.isEven, you: i == 0),
              ],
            ),
            secondsLeft: 3599,
          ),
        );
      });

      testWidgets('lobby, nobody there yet', (tester) async {
        await _render(tester, size, RelayLobby(state: _state(phase: RelayPhase.lobby, teammates: const []), secondsLeft: 0));
      });

      testWidgets('how to play', (tester) async {
        await _render(tester, size, RelayHowToPlay(
          videoUrl: '',
          pointsPerCorrect: 40,
          roundSeconds: 150,
          questionsPerRound: 5,
          roundKinds: const ['odd', 'word', 'movie', 'number', 'person'],
          onBackToLobby: () {},
        ));
        expect(find.text('There are 5 questions in every round.'), findsOneWidget);
        // Five examples as different as a letter and a plot, all one size.
        final sizes = {for (final card in tester.widgetList(find.byType(RelayRoundDemo))) tester.getSize(find.byWidget(card))};
        expect(sizes, hasLength(1));

      });

      for (final kind in ['odd', 'word', 'movie', 'number', 'person', 'unknown']) {
        for (final place in RelayDemoPlace.values) {
          testWidgets('round example: $kind, ${place.name}', (tester) async {
            await _render(
              tester,
              size,
              SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: RelayRoundDemo(round: 3, kind: kind, place: place, onClose: () {}),
              ),
            );
          });
        }
      }

      testWidgets('the score reveal, a long round saved', (tester) async {
        await _render(
          tester,
          size,
          RelayPlay(
            state: _state(isLeader: true),
            secondsLeft: 0,
            reveal: const RelayRoundFinish(secondsSaved: 150, timeBonus: 75, roundPoints: 200),
          ),
        );
        await tester.pump(const Duration(seconds: 5));
        expect(tester.takeException(), isNull);
      });

      testWidgets('clue, a sentence', (tester) async {
        await _render(
          tester,
          size,
          RelayPlay(
            state: _state(
              pieces: const [
                RelayPiece(
                  label: 'Clue 1',
                  text: 'The main character enters a world where dreams can be manipulated, and then some more words to make it long.',
                ),
              ],
              leadIsAnswering: true,
            ),
            secondsLeft: 120,
          ),
        );
      });

      testWidgets('clue, several pieces at once', (tester) async {
        await _render(
          tester,
          size,
          RelayPlay(
            state: _state(
              prompt: 'Form the five-letter word',
              pieces: const [
                RelayPiece(label: 'Letter 1', text: 'K'),
                RelayPiece(label: 'Letter 4', text: 'C'),
              ],
            ),
            secondsLeft: 7,
          ),
        );
      });

      testWidgets('clue, nothing dealt yet', (tester) async {
        await _render(tester, size, RelayPlay(state: _state(), secondsLeft: 120));
      });

      testWidgets('lead, after a wrong answer', (tester) async {
        await _render(
          tester,
          size,
          RelayPlay(
            state: _state(isLeader: true, prompt: 'Which one does not belong in this rather long question?'),
            secondsLeft: 120,
            lastResult: const RelayResult(correct: false, skipped: false, answer: ''),
          ),
        );
      });

      testWidgets('leaderboard, 44 teams', (tester) async {
        await _render(
          tester,
          size,
          RelayLeaderboard(state: _state(phase: RelayPhase.breakTime, standings: _table), secondsLeft: 90),
        );
      });

      testWidgets('leaderboard, a long team name and a big score', (tester) async {
        await _render(
          tester,
          size,
          RelayLeaderboard(
            state: _state(
              phase: RelayPhase.breakTime,
              standings: _table,
              teamName: '$_longName TEAM',
              points: 123456,
            ),
            secondsLeft: 5,
          ),
        );
      });

      testWidgets('final table, only two teams', (tester) async {
        await _render(
          tester,
          size,
          RelayLeaderboard(state: _state(phase: RelayPhase.finished, standings: _table.take(2).toList()), secondsLeft: 0),
        );
      });

      testWidgets('final table, empty', (tester) async {
        await _render(tester, size, RelayLeaderboard(state: _state(phase: RelayPhase.finished), secondsLeft: 0));
      });
    });
  }

  group('the lead can actually submit', () {
    testWidgets('typing enables Submit, and Submit sends the answer', (tester) async {
      String? sent;
      await _render(
        tester,
        const Size(393, 852),
        RelayPlay(state: _state(isLeader: true), secondsLeft: 120, onSubmit: (a) => sent = a),
      );
      await tester.enterText(find.byType(TextField), 'Inception');
      await tester.pump();
      await tester.ensureVisible(find.text('Submit'));
      // Beside the label: typing in a test leaves the caret's drag handle
      // hanging over the middle of the button.
      await tester.tapAt(tester.getCenter(find.byType(RelayCtaButton)) + const Offset(90, 0));
      await tester.pump(const Duration(milliseconds: 200));
      expect(sent, 'Inception');
    });

    testWidgets('an empty answer is not sent', (tester) async {
      var sent = false;
      await _render(
        tester,
        const Size(393, 852),
        RelayPlay(state: _state(isLeader: true), secondsLeft: 120, onSubmit: (_) => sent = true),
      );
      await tester.ensureVisible(find.text('Submit'));
      await tester.tap(find.text('Submit'));
      await tester.pump();
      expect(sent, isFalse);
    });

    testWidgets('a member never sees an answer box', (tester) async {
      await _render(tester, const Size(393, 852), RelayPlay(state: _state(), secondsLeft: 120));
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Submit'), findsNothing);
    });

    testWidgets('a lead never sees a clue', (tester) async {
      await _render(
        tester,
        const Size(393, 852),
        RelayPlay(
          state: _state(isLeader: true, pieces: const [RelayPiece(label: 'Clue 1', text: 'secret')]),
          secondsLeft: 120,
        ),
      );
      expect(find.textContaining('secret'), findsNothing);
    });
  });

  group('moving on, and getting it right', () {
    testWidgets('the lead moves on with Skip', (tester) async {
      var moved = false;
      await _render(
        tester,
        const Size(393, 852),
        RelayPlay(state: _state(isLeader: true), secondsLeft: 120, onSkip: () => moved = true),
      );
      expect(find.text('If you skip you can’t come back'), findsOneWidget);
      await tester.ensureVisible(find.text('SKIP'));
      await tester.tap(find.text('SKIP'));
      expect(moved, isTrue);
    });

    testWidgets('the round score shows on the question', (tester) async {
      await _render(tester, const Size(393, 852), RelayPlay(state: _state(), secondsLeft: 120));
      expect(find.text('YOUR SCORE'), findsOneWidget);
      expect(find.text('100 pts'), findsOneWidget);
    });

    testWidgets('ⓘ shows this round\'s example over the game, and the cross closes it', (tester) async {
      await _render(tester, const Size(393, 852), RelayPlay(state: _state(), secondsLeft: 120));
      expect(find.byType(RelayRoundDemo), findsNothing);
      await tester.tap(find.byWidgetPredicate((w) => w.runtimeType.toString() == 'SvgPicture' &&
          (w as dynamic).bytesLoader.assetName.toString().endsWith('info.svg')));
      await tester.pump();
      // Round 2 of the default order is Unscramble.
      expect(find.text('Unscramble'), findsOneWidget);
      expect(find.text('ROUND 2'), findsOneWidget);
      await tester.tap(find.byWidgetPredicate((w) => w.runtimeType.toString() == 'SvgPicture' &&
          (w as dynamic).bytesLoader.assetName.toString().endsWith('cross_brand.svg')));
      await tester.pump();
      expect(find.byType(RelayRoundDemo), findsNothing);
    });

    testWidgets('a wrong answer plays the incorrect animation once, then clears', (tester) async {
      await _render(tester, const Size(393, 852), RelayPlay(state: _state(isLeader: true), secondsLeft: 120));
      final gif = find.byType(RelayErrorMark);
      expect(gif, findsNothing);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RelayPlay(
              state: _state(isLeader: true),
              secondsLeft: 119,
              lastResult: const RelayResult(correct: false, skipped: false, answer: ''),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(gif, findsOneWidget);
      await tester.pump(const Duration(milliseconds: 2200));
      expect(gif, findsNothing);
    });

    testWidgets('pips show how each question went', (tester) async {
      final state = RelayState.fromJson({
        'phase': 'playing',
        'isLeader': false,
        'questionNumber': 3,
        'questionsPerRound': 5,
        'roundOutcomes': ['correct', 'skipped'],
        'event': {'round': 2, 'rounds': 5},
      });
      await _render(tester, const Size(393, 852), RelayPlay(state: state, secondsLeft: 60));
      String assetOf(int n) {
        final pip = find.ancestor(of: find.text('$n'), matching: find.byType(Stack)).first;
        final svg = find.descendant(of: pip, matching: find.byWidgetPredicate((w) => w.runtimeType.toString() == 'SvgPicture'));
        return (tester.widget(svg) as dynamic).bytesLoader.assetName as String;
      }
      expect(assetOf(1), endsWith('pip_correct.svg'));
      expect(assetOf(2), endsWith('pip_skipped.svg'));
      expect(assetOf(3), endsWith('pip_active.svg'));
      expect(assetOf(4), endsWith('pip_idle.svg'));
      expect(assetOf(5), endsWith('pip_idle.svg'));
    });

    for (final MapEntry(key: phone, value: size) in _phones.entries) {
      testWidgets('$phone: a correct answer scores in front of the confetti', (tester) async {
        await _render(
          tester,
          size,
          RelayPlay(
            state: _state(lastOutcome: const RelayOutcome(answer: 'Kuch Kuch Hota Hai', points: 30)),
            secondsLeft: 90,
          ),
        );
        // The score rises over the page — drawn twice, outline then fill —
        // with the confetti behind it. The green banner that used to say the
        // same thing along the bottom is gone.
        expect(find.text('+30'), findsNWidgets(2));
        expect(find.byType(RelayConfetti), findsOneWidget);
        expect(find.textContaining('Correct!'), findsNothing);
        await tester.pump(const Duration(seconds: 2));
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('feed → lobby → how to play → back', () {
    testWidgets('the lobby opens the rules from its How to play button', (tester) async {
      var opened = false;
      await _render(
        tester,
        const Size(393, 852),
        RelayLobby(state: _state(phase: RelayPhase.lobby), secondsLeft: 8, onHowToPlay: () => opened = true),
      );
      await tester.ensureVisible(find.text('How to Play'));
      await tester.tap(find.text('How to Play'));
      await tester.pump(const Duration(milliseconds: 200));
      expect(opened, isTrue);
    });

    testWidgets('the rules go back to the lobby', (tester) async {
      var back = false;
      await _render(
        tester,
        const Size(393, 852),
        RelayHowToPlay(videoUrl: '', pointsPerCorrect: 40, onBackToLobby: () => back = true),
      );
      await tester.tap(find.text('Back to Lobby'));
      expect(back, isTrue);
    });

    for (final MapEntry(key: phone, value: size) in _phones.entries) {
      for (final status in ['scheduled', 'live', 'finished']) {
        testWidgets('$phone: the feed card fits when $status, with a long team name', (tester) async {
          final post = ConnectPost.fromJson({
            'id': 'p1',
            'type': 'relay_game',
            'author': {'name': 'Sowaka', 'userId': 'x'},
            'body': {
              'title': 'Hint Relay',
              'startsAt': DateTime.now().add(const Duration(hours: 22, minutes: 50)).toUtc().toIso8601String(),
            },
          });
          await _render(
            tester,
            size,
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                RelayPostCard(
                  post: post,
                  session: const AuthSession(
                    token: 't',
                    user: AuthUser(id: 'u', email: 'e', name: 'n', role: 'employee', company: 'c'),
                  ),
                  card: RelayCard(
                    title: 'Hint Relay',
                    status: status,
                    startsAt: null,
                    pointsPerCorrect: 40,
                    instructionsVideoUrl: '',
                    teamName: '$_longName TEAM',
                    members: [
                      for (var i = 0; i < 6; i += 1)
                        RelayCardMember(name: '$_longName $i', isLeader: i == 0, isYou: i == 1),
                    ],
                    podium: status == 'finished' ? _table.take(3).toList() : const [],
                  ),
                ),
              ],
            ),
          );
          expect(find.textContaining('₹'), findsNothing);
          switch (status) {
            case 'scheduled':
              expect(find.text('Game start in '), findsOneWidget);
              expect(find.textContaining(RegExp(r'^22:(49|50):\d\d$')), findsOneWidget);
              expect(find.text('SURPRISE REWARDS'), findsOneWidget);
              expect(find.text('Let’s Play'), findsOneWidget);
            case 'live':
              expect(find.text('LIVE'), findsOneWidget);
              expect(find.text('LIVE NOW'), findsNothing);
              expect(find.text('Game start in '), findsNothing);
              expect(find.text('Let’s Play'), findsOneWidget);
            case 'finished':
              expect(find.text('GAME OVER'), findsOneWidget);
              expect(find.text('SHIV TEAM TAKES THE WIN'), findsOneWidget);
              expect(find.text('Final standings'), findsOneWidget);
              expect(find.text('View Leaderboard'), findsOneWidget);
          }
        });
      }
    }
  });

  group('the score reveal', () {
    test('the handoff\'s examples end on the right score', () {
      for (final (seconds, score, last) in [(120, 20, 80), (60, 40, 70), (40, 75, 95), (20, 100, 110)]) {
        final steps = relayRevealSteps(seconds: seconds, score: score);
        expect(steps.first, (seconds: seconds, score: score));
        expect(steps.last, (seconds: 0, score: last));
        // Ten seconds and five points a step, as drawn.
        expect(steps.length, seconds ~/ 10 + 1);
      }
    });

    test('an odd clock drops to the next ten, then tens, and ends on floor(47 / 2)', () {
      final steps = relayRevealSteps(seconds: 47, score: 20);
      expect([for (final s in steps) s.seconds], [47, 40, 30, 20, 10, 0]);
      expect([for (final s in steps) s.score], [20, 23, 28, 33, 38, 43]);
    });

    testWidgets('it counts down, floats the gain, lands on the total and hands over', (tester) async {
      var done = false;
      tester.view.physicalSize = const Size(393, 852);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RelayPlay(
              state: _state(isLeader: true),
              secondsLeft: 0,
              reveal: const RelayRoundFinish(secondsSaved: 120, timeBonus: 60, roundPoints: 20),
              onRevealDone: () => done = true,
            ),
          ),
        ),
      );
      // The question is gone; the clock and the score are what's left.
      expect(find.byType(TextField), findsNothing);
      expect(find.text('SKIP'), findsNothing);
      expect(find.text('Converting remaining time to points…'), findsOneWidget);
      expect(find.text('120 s'), findsOneWidget);
      expect(find.text('20 pts'), findsOneWidget);
      await tester.pump(RelayScoreReveal.step);
      expect(find.text('110 s'), findsOneWidget);
      expect(find.text('25 pts'), findsOneWidget);
      expect(find.text('+5'), findsOneWidget);
      await tester.pump(RelayScoreReveal.step * 12);
      expect(find.text('0 s'), findsOneWidget);
      expect(find.text('80 pts'), findsOneWidget);
      expect(done, isFalse);
      await tester.pump(RelayScoreReveal.hold + RelayScoreReveal.step);
      expect(done, isTrue);
    });
  });

  testWidgets('the reveal\'s sound goes with each step that adds points, and nowhere else', (tester) async {
    var sounds = 0;
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RelayScoreReveal(secondsSaved: 47, roundPoints: 20, onPoints: () => sounds += 1),
        ),
      ),
    );
    expect(sounds, 0, reason: 'nothing before the score starts to climb');
    await tester.pump(RelayScoreReveal.step);
    expect(sounds, 1);
    await tester.pump(RelayScoreReveal.step * 10 + RelayScoreReveal.hold);
    // 47 → 40 → 30 → 20 → 10 → 0: five steps, each adding points.
    expect(sounds, 5);
  });

  testWidgets('the reveal\'s sound is stopped when it ends, and when it is taken away early', (tester) async {
    var silenced = 0;
    Widget reveal() => MaterialApp(
          home: Scaffold(
            body: RelayScoreReveal(secondsSaved: 20, roundPoints: 0, onSilence: () => silenced += 1),
          ),
        );
    await tester.pumpWidget(reveal());
    await tester.pump(RelayScoreReveal.step * 3 + RelayScoreReveal.hold);
    expect(silenced, 1, reason: 'at the end of the count');

    await tester.pumpWidget(const SizedBox());
    silenced = 0;
    await tester.pumpWidget(reveal());
    await tester.pump(RelayScoreReveal.step);
    // The leaderboard (or a new round) replaces it mid-count.
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: Text('Leaderboard'))));
    expect(silenced, 1, reason: 'cut short, it still goes quiet');
  });

  group('the leaderboard looks ahead', () {
    testWidgets('the table holds still until the next round opens, six seconds in', (tester) async {
      await _render(
        tester,
        const Size(393, 852),
        RelayLeaderboard(state: _state(phase: RelayPhase.breakTime, standings: _table), secondsLeft: 90),
      );
      // Nothing is held open for the card, so the standings stay exactly where
      // they landed while everyone reads them.
      expect(find.byType(RelayRoundDemo), findsNothing);
      final landed = tester.getTopLeft(find.text('LEADERBOARD')).dy;
      await tester.pump(const Duration(seconds: 5));
      expect(tester.getTopLeft(find.text('LEADERBOARD')).dy, landed);

      // Then the card arrives and the table moves down with it.
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      // Round 3 of the default order is Plot Picks.
      expect(find.text('NEXT ROUND-3'), findsOneWidget);
      expect(find.text('Plot Picks'), findsOneWidget);
      expect(tester.getTopLeft(find.text('LEADERBOARD')).dy, greaterThan(landed));
    });

    testWidgets('after the last round there is nothing ahead', (tester) async {
      await _render(
        tester,
        const Size(393, 852),
        RelayLeaderboard(state: _state(phase: RelayPhase.breakTime, round: 5, standings: _table), secondsLeft: 40),
      );
      expect(find.byType(RelayRoundDemo), findsNothing);
    });

    testWidgets('totals read in points', (tester) async {
      await _render(
        tester,
        const Size(393, 852),
        RelayLeaderboard(state: _state(phase: RelayPhase.breakTime, standings: _table), secondsLeft: 90),
      );
      expect(find.text('+100 points this round'), findsOneWidget);
      expect(find.text('320 pts'), findsOneWidget);
      expect(find.text('Top 3'), findsOneWidget);
    });
  });

  group('guess who', () {
    testWidgets('a hint reads as a hint, not a plot clue', (tester) async {
      await _render(
        tester,
        const Size(393, 852),
        RelayPlay(
          state: _state(
            round: 5,
            prompt: 'Guess the personality',
            pieces: const [RelayPiece(label: 'Hint 1', text: 'Runs like the ground insulted him.')],
          ),
          secondsLeft: 90,
        ),
      );
      expect(find.text('YOUR HINT'), findsOneWidget);
      expect(find.text('Every teammate has a hint about who it is'), findsOneWidget);
    });

    testWidgets('round 5 of the event is explained as Guess Who, with its hints and answer', (tester) async {
      await _render(
        tester,
        const Size(393, 852),
        SingleChildScrollView(child: RelayRoundDemo(round: 5, kind: 'person')),
      );
      expect(find.text('Guess Who'), findsOneWidget);
      expect(find.text('Plot Picks'), findsNothing);
      expect(find.text('88.06'), findsOneWidget);
      expect(find.text('Neeraj Chopra'), findsOneWidget);
    });
  });

  group('what arrives from the server', () {
    test("the round's last correct answer keeps its question on screen", () {
      final question = _state(isLeader: true, prompt: 'Guess the movie');
      final done = RelayState.fromJson({
        'phase': 'break',
        'isLeader': true,
        'questionNumber': 4,
        'questionsPerRound': 4,
        'team': {'name': 'Kritik TEAM', 'points': 450},
        'pointsThisRound': 130,
        'roundOutcomes': ['correct', 'skipped', 'correct', 'correct'],
        'lastOutcome': {'outcome': 'correct', 'answer': 'Inception', 'points': 30},
        'event': {'round': 2, 'rounds': 5},
      });
      final held = question.answeredWith(done);
      expect(held.phase, RelayPhase.playing);
      expect(held.prompt, 'Guess the movie');
      expect(held.lastOutcome?.answer, 'Inception');
      expect(held.roundOutcomes, hasLength(4));
      expect(held.points, 450);
    });

    test('what the reveal needs arrives with the round\'s end, and is held with the question', () {
      final done = RelayState.fromJson({
        'phase': 'break',
        'roundFinish': {'secondsSaved': 47, 'timeBonus': 23, 'roundPoints': 120},
        'event': {'round': 2, 'rounds': 5},
      });
      final finish = _state().answeredWith(done).roundFinish;
      expect(finish?.secondsSaved, 47);
      expect(finish?.timeBonus, 23);
      expect(finish?.roundPoints, 120);
    });

    test('an empty message does not crash the app', () {
      final state = RelayState.fromJson(const {});
      expect(state.phase, RelayPhase.lobby);
      expect(state.pieces, isEmpty);
    });

    test('unexpected shapes are ignored rather than thrown', () {
      final state = RelayState.fromJson({
        'phase': 'something-new',
        'pieces': ['not a map', 3, null],
        'teammates': 'nope',
        'standings': [
          {'rank': '1'},
        ],
        'pointsPerCorrect': 30.0,
      });
      expect(state.phase, RelayPhase.lobby);
      expect(state.pieces, isEmpty);
      expect(state.pointsPerCorrect, 30);
    });

    test('a finished game reads as finished', () {
      expect(RelayState.fromJson(const {'phase': 'finished'}).phase, RelayPhase.finished);
      expect(RelayState.fromJson(const {'phase': 'break'}).phase, RelayPhase.breakTime);
    });
  });
}
