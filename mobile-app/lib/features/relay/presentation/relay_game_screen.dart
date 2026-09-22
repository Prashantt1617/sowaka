import 'dart:async';

import 'package:flutter/material.dart';

import '../../../services/api_config.dart';
import '../../auth/data/auth_models.dart';
import '../data/relay_models.dart';
import '../data/relay_socket_service.dart';
import 'relay_how_to_play.dart';
import 'relay_leaderboard.dart';
import 'relay_lobby.dart';
import 'relay_play.dart';
import 'relay_style.dart';

/// Holds the connection and shows whichever screen the game is on.
///
/// The server decides the phase; this only renders it. Before kick-off the
/// player chooses between the rules and the lobby and can go back and forth;
/// once the game starts that choice ends, because the round is what matters.
///
/// The one thing computed here is the second-by-second countdown, since a clock
/// that only moved when a message arrived would visibly stall — every push
/// corrects it.
class RelayGameScreen extends StatefulWidget {
  const RelayGameScreen({
    super.key,
    required this.session,
    this.instructionsVideoUrl = '',
    this.pointsPerCorrect = 0,
    this.startWithRules = true,
  });

  final AuthSession session;

  /// From the post, so the rules can show before the first state arrives.
  final String instructionsVideoUrl;

  /// HR's figure from the card, for the rules before the first update lands.
  final int pointsPerCorrect;

  /// "View game" opens on the rules; a return visit can go straight in.
  final bool startWithRules;

  @override
  State<RelayGameScreen> createState() => _RelayGameScreenState();
}

class _RelayGameScreenState extends State<RelayGameScreen> {
  late final RelaySocketService _socket;
  final _subscriptions = <StreamSubscription<dynamic>>[];
  Timer? _ticker;

  RelayState? _state;
  String? _problem;
  RelayResult? _lastResult;
  late bool _showingRules = widget.startWithRules;

  /// The round's last question, held on screen while its correct answer is
  /// celebrated. Answering it ends the team's round, so without this the
  /// leaderboard would replace the question before the banner, confetti and
  /// chime could play.
  RelayState? _finale;
  Timer? _finaleTimer;

  /// The round clock as it stood when the last answer landed; the break's
  /// countdown is for the leaderboard, not this question.
  int _finaleSeconds = 0;

  /// Long enough for the chime and the banner, and most of the confetti.
  static const _finaleFor = Duration(milliseconds: 3200);

  /// Counted down locally between pushes, reset by each one.
  int _secondsUntilStart = 0;
  int _roundSecondsLeft = 0;

  @override
  void initState() {
    super.initState();
    _socket = RelaySocketService(session: widget.session)..connect();
    _subscriptions.add(_socket.states.listen(_onState));
    _subscriptions.add(
      _socket.results.listen((result) {
        if (mounted) setState(() => _lastResult = result);
      }),
    );
    _subscriptions.add(
      _socket.errors.listen((message) {
        if (mounted) setState(() => _problem = message);
      }),
    );
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        if (_secondsUntilStart > 0) _secondsUntilStart -= 1;
        if (_roundSecondsLeft > 0) _roundSecondsLeft -= 1;
      });
    });
  }

  void _onState(RelayState state) {
    if (!mounted) return;
    setState(() {
      final previous = _state;
      final endsOnCorrect = previous != null &&
          previous.phase == RelayPhase.playing &&
          state.phase == RelayPhase.breakTime &&
          state.round == previous.round &&
          state.lastOutcome != null;
      if (endsOnCorrect && _finale == null) {
        _finale = previous.answeredWith(state);
        _finaleSeconds = _roundSecondsLeft;
        _finaleTimer?.cancel();
        _finaleTimer = Timer(_finaleFor, () {
          if (mounted) setState(() => _finale = null);
        });
      } else if (_finale != null && state.phase != RelayPhase.breakTime) {
        // The game moved on regardless (a new round, or the end): follow it.
        _finaleTimer?.cancel();
        _finale = null;
      }
      _state = state;
      _problem = null;
      // The server's clock wins on every message; the local tick only fills
      // the gaps between them.
      _secondsUntilStart = state.secondsUntilStart;
      _roundSecondsLeft = state.roundSecondsLeft;
      // A new question clears whatever the last one ended on.
      if (previous == null ||
          previous.questionNumber != state.questionNumber ||
          state.phase != RelayPhase.playing) {
        _lastResult = null;
      }
    });
  }

  void _close() => Navigator.of(context).maybePop();

  /// A playable address: the card's, already resolved, or the server's —
  /// which is a path on this API when media is stored locally.
  String _videoUrl(RelayState? state) {
    if (widget.instructionsVideoUrl.isNotEmpty) return widget.instructionsVideoUrl;
    final fromServer = state?.instructionsVideoUrl ?? '';
    return fromServer.startsWith('/') ? '${ApiConfig.baseUrl}$fromServer' : fromServer;
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _finaleTimer?.cancel();
    for (final subscription in _subscriptions) {
      subscription.cancel();
    }
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    final lobby = state == null || state.phase == RelayPhase.lobby;

    // The rules stay reachable until the game begins, and not after.
    if (_showingRules && lobby) {
      return Scaffold(
        body: RelayHowToPlay(
          videoUrl: _videoUrl(state),
          pointsPerCorrect: state?.pointsPerCorrect ?? widget.pointsPerCorrect,
          roundSeconds: state?.roundSeconds ?? 0,
          roundKinds: state?.roundKinds ?? const [],
          onClose: _close,
          onBackToLobby: () => setState(() => _showingRules = false),
        ),
      );
    }

    if (state == null) {
      return Scaffold(
        body: RelayBackdrop(
          scroll: false,
          child: Center(
            child: _problem == null
                ? const CircularProgressIndicator(color: Colors.white)
                : Text(
                    _problem!,
                    textAlign: TextAlign.center,
                    style: RelayStyle.sora(15, color: Colors.white),
                  ),
          ),
        ),
      );
    }

    final finale = _finale;
    if (finale != null) {
      return Scaffold(
        body: RelayPlay(
          state: finale,
          secondsLeft: _finaleSeconds,
          lastResult: _lastResult,
        ),
      );
    }

    return Scaffold(
      body: switch (state.phase) {
        RelayPhase.lobby => RelayLobby(
          state: state,
          secondsLeft: _secondsUntilStart,
          onClose: _close,
          onHowToPlay: () => setState(() => _showingRules = true),
        ),
        RelayPhase.playing => RelayPlay(
          state: state,
          secondsLeft: _roundSecondsLeft,
          lastResult: _lastResult,
          onSubmit: _socket.submitAnswer,
          onSkip: _socket.skipQuestion,
          onTyping: _socket.reportTyping,
        ),
        RelayPhase.breakTime || RelayPhase.finished => RelayLeaderboard(
          state: state,
          secondsLeft: _roundSecondsLeft,
          onClose: _close,
        ),
      },
    );
  }
}
