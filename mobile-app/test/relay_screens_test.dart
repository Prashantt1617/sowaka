import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/features/relay/data/relay_models.dart';
import 'package:mobile_app/features/relay/presentation/relay_how_to_play.dart';
import 'package:mobile_app/features/relay/presentation/relay_leaderboard.dart';
import 'package:mobile_app/features/relay/presentation/relay_lobby.dart';
import 'package:mobile_app/features/relay/presentation/relay_play.dart';
import 'package:mobile_app/features/relay/presentation/relay_post_card.dart';
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
  RelayOutcome? lastOutcome,
}) =>
    RelayState(
      phase: phase,
      eventName: 'Hint Relay',
      round: 2,
      rounds: 5,
      teamName: teamName,
      points: points,
      isLeader: isLeader,
      leadName: 'Rahul',
      leadIsAnswering: leadIsAnswering,
      prompt: prompt,
      questionNumber: 1,
      questionsPerRound: 4,
      pointsPerCorrect: 30,
      roundSecondsLeft: 120,
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
          pointsPerCorrect: 30,
          roundSeconds: 120,
          roundKinds: const ['movie', 'word', 'number', 'lyric', 'odd'],
          onBackToLobby: () {},
        ));
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
      await tester.tap(find.text('Submit'));
      await tester.pump();
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
    testWidgets('the lead moves on with Next Question', (tester) async {
      var moved = false;
      await _render(
        tester,
        const Size(393, 852),
        RelayPlay(state: _state(isLeader: true), secondsLeft: 120, onSkip: () => moved = true),
      );
      expect(find.text('SKIP'), findsNothing);
      await tester.ensureVisible(find.text('NEXT QUESTION'));
      await tester.tap(find.text('NEXT QUESTION'));
      expect(moved, isTrue);
    });

    testWidgets('a wrong answer plays the incorrect animation once, then clears', (tester) async {
      await _render(tester, const Size(393, 852), RelayPlay(state: _state(isLeader: true), secondsLeft: 120));
      final gif = find.byWidgetPredicate(
        (w) => w is Image && w.image is AssetImage && (w.image as AssetImage).assetName.endsWith('incorrect_answer.gif'),
      );
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
        'questionsPerRound': 4,
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
    });

    for (final MapEntry(key: phone, value: size) in _phones.entries) {
      testWidgets('$phone: the correct banner shows to everyone, confetti and all', (tester) async {
        await _render(
          tester,
          size,
          RelayPlay(
            state: _state(lastOutcome: const RelayOutcome(answer: 'Kuch Kuch Hota Hai', points: 30)),
            secondsLeft: 90,
          ),
        );
        expect(find.text('Correct! +30 points'), findsOneWidget);
        expect(find.text('Kuch Kuch Hota Hai'), findsOneWidget);
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
      await tester.ensureVisible(find.text('How to play'));
      await tester.tap(find.text('How to play'));
      expect(opened, isTrue);
    });

    testWidgets('the rules go back to the lobby', (tester) async {
      var back = false;
      await _render(
        tester,
        const Size(393, 852),
        RelayHowToPlay(videoUrl: '', pointsPerCorrect: 30, onBackToLobby: () => back = true),
      );
      await tester.tap(find.text('Back to Lobby'));
      expect(back, isTrue);
    });

    for (final MapEntry(key: phone, value: size) in _phones.entries) {
      testWidgets('$phone: the feed card fits, with a long team name', (tester) async {
        final post = ConnectPost.fromJson({
          'id': 'p1',
          'type': 'relay_game',
          'author': {'name': 'Sowaka', 'userId': 'x'},
          'body': {
            'title': 'Hint Relay',
            'startsAt': DateTime(2026, 9, 24, 16).toUtc().toIso8601String(),
            'rewardAmount': 1000000,
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
                  status: 'scheduled',
                  startsAt: null,
                  rewardAmount: 1000000,
                  pointsPerCorrect: 30,
                  instructionsVideoUrl: '',
                  teamName: '$_longName TEAM',
                  members: [
                    for (var i = 0; i < 6; i += 1)
                      RelayCardMember(name: '$_longName $i', isLeader: i == 0, isYou: i == 1),
                  ],
                ),
              ),
            ],
          ),
        );
        expect(find.text('View game'), findsOneWidget);
      });
    }
  });

  group('what arrives from the server', () {
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
