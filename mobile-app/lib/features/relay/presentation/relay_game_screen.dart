import 'dart:async';

import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../data/relay_models.dart';
import '../data/relay_socket_service.dart';
import 'relay_lobby.dart';
import 'relay_play.dart';

/// Holds the connection and shows whichever screen the game is currently on.
///
/// The server decides the phase; this only renders it. The one thing computed
/// here is the second-by-second countdown, because a clock that only moved when
/// a message arrived would visibly stutter — every push corrects it.
class RelayGameScreen extends StatefulWidget {
  const RelayGameScreen({
    super.key,
    required this.session,
    this.pointsPerCorrect = 30,
    this.onHowToPlay,
  });

  final AuthSession session;

  /// What a correct answer pays, for the line under the pips.
  final int pointsPerCorrect;
  final VoidCallback? onHowToPlay;

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
      _state = state;
      _problem = null;
      // The server's clock wins on every message; the local tick only fills
      // the gaps between them.
      _secondsUntilStart = state.secondsUntilStart;
      _roundSecondsLeft = state.roundSecondsLeft;
      // A new question clears whatever the last one ended on.
      if (state.phase != RelayPhase.playing) _lastResult = null;
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    for (final subscription in _subscriptions) {
      subscription.cancel();
    }
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    if (state == null) {
      return Scaffold(
        backgroundColor: const Color(0xFF4FA3D1),
        body: Center(
          child: _problem == null
              ? const CircularProgressIndicator(color: Colors.white)
              : Padding(
                  padding: const EdgeInsets.all(28),
                  child: Text(
                    _problem!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: Colors.white,
                      fontSize: 15,
                    ),
                  ),
                ),
        ),
      );
    }

    return Scaffold(
      body: switch (state.phase) {
        RelayPhase.playing => RelayPlay(
          state: state,
          secondsLeft: _roundSecondsLeft,
          pointsPerCorrect: widget.pointsPerCorrect,
          lastResult: _lastResult,
          onSubmit: _socket.submitAnswer,
          onSkip: _socket.skipQuestion,
          onTyping: _socket.reportTyping,
        ),
        // The break and finished screens land next; until they do the lobby is
        // still an honest picture of a team between rounds.
        _ => RelayLobby(
          state: state,
          secondsLeft: _secondsUntilStart,
          onClose: () => Navigator.of(context).maybePop(),
          onHowToPlay: widget.onHowToPlay,
        ),
      },
    );
  }
}
