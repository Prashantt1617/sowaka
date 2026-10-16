import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../auth/data/auth_models.dart';
import '../../connect/data/connect_models.dart';
import '../../games/data/games_api_service.dart';
import '../../games/data/games_models.dart';
import '../../games/presentation/web_game_screen.dart';
import '../../shared/app_toast.dart';
import '../data/secret_squad_post.dart';
import 'secret_squad_envelope.dart';
import 'secret_squad_style.dart';

/// Opens a catalog game for the card; the app pushes its web game screen.
typedef SquadGameOpener =
    Future<void> Function(BuildContext context, GameCatalogEntry game);

/// Secret Squad's post in the Connect feed: the "Secret Squad Feed Card"
/// design. The violet card, the animated top-secret envelope, when the
/// session is, a live countdown to its lobby ("Lobby opens in 22:50:10",
/// then "Lobby open · starts in 2:14", "Playing now", "Ended", or
/// "Cancelled"), the surprise rewards, and Let's Play.
///
/// Let's Play opens the catalog game (`gameKey`, `secret-squad`) in the
/// app's web game screen, with the Sowaka bridge (and its QR scanner) in it.
/// A person whose company's catalog does not have the game is sent to the
/// web lobby (`webUrl`) in their browser instead.
///
/// The card draws itself whole, as the Hint Relay's does: the game is the
/// whole interaction, so there is no like or comment row under it.
class SecretSquadPostCard extends StatefulWidget {
  const SecretSquadPostCard({
    super.key,
    required this.post,
    required this.session,
    this.service,
    this.now,
    this.openGame,
    this.openUrl,
    this.envelopeTime,
  });

  final ConnectPost post;
  final AuthSession session;

  /// Supplied by tests; the card makes its own otherwise.
  final GamesApiService? service;

  /// The clock, for tests.
  final DateTime Function()? now;

  /// What opening the game does; by default the app's web game screen.
  final SquadGameOpener? openGame;

  /// What opening the web lobby does; by default the phone's browser.
  final Future<void> Function(Uri url)? openUrl;

  /// Freezes the envelope at this point of its loop; screenshots only.
  final double? envelopeTime;

  @override
  State<SecretSquadPostCard> createState() => _SecretSquadPostCardState();
}

class _SecretSquadPostCardState extends State<SecretSquadPostCard> {
  late SecretSquadPost _squad = SecretSquadPost(widget.post.body);
  Timer? _ticker;
  bool _opening = false;

  DateTime _now() => widget.now?.call() ?? DateTime.now();

  SquadCardPhase get _phase => _squad.phaseAt(_now());

  bool get _ticking =>
      _phase != SquadCardPhase.ended && _phase != SquadCardPhase.cancelled;

  @override
  void initState() {
    super.initState();
    _tick();
  }

  @override
  void didUpdateWidget(covariant SecretSquadPostCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.post.body, widget.post.body)) {
      _squad = SecretSquadPost(widget.post.body);
      _tick();
    }
  }

  /// Once a second while there is a clock to move; it stops itself once the
  /// session is over or called off.
  void _tick() {
    _ticker?.cancel();
    _ticker = null;
    if (!_ticking) return;
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
      if (!_ticking) {
        _ticker?.cancel();
        _ticker = null;
      }
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _play() async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      final game = await _findGame();
      if (!mounted) return;
      if (game != null) {
        await (widget.openGame ?? _openInApp)(context, game);
        return;
      }
      final web = _squad.webUrl;
      if (web != null) {
        await (widget.openUrl ?? _openInBrowser)(Uri.parse(web));
        return;
      }
      showAppToast(context, 'Secret Squad is not open for you yet.');
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  /// The company's Secret Squad, if this app can open it: from the catalog
  /// the phone keeps, else asked for now. Null when the company does not
  /// have it (or it cannot be found offline).
  Future<GameCatalogEntry?> _findGame() async {
    final service = widget.service ?? GamesApiService(session: widget.session);
    bool opens(GameCatalogEntry game) =>
        game.key == _squad.gameKey && game.hasWebPage;
    try {
      final kept = (await service.catalogFromCache())?.where(opens).firstOrNull;
      if (kept != null) return kept;
    } catch (_) {}
    try {
      return (await service.catalog()).where(opens).firstOrNull;
    } catch (_) {
      return null;
    }
  }

  Future<void> _openInApp(BuildContext context, GameCatalogEntry game) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WebGameScreen.catalog(
          game: game,
          session: widget.session,
          service: widget.service,
        ),
      ),
    );
  }

  Future<void> _openInBrowser(Uri url) async {
    try {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) showAppToast(context, 'Could not open Secret Squad.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final squad = _squad;
    final phase = _phase;
    final start = squad.startsAt;
    return Semantics(
      container: true,
      label: '${squad.title} team game',
      // Its own Material, so its text never falls back to the debug style
      // wherever it is put.
      child: Material(
        type: MaterialType.transparency,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            // 0 14px 30px -16px rgba(27,31,85,.7)
            boxShadow: const [
              BoxShadow(
                color: Color(0xB31B1F55),
                offset: Offset(0, 14),
                blurRadius: 26,
                spreadRadius: -16,
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(26),
            child: CustomPaint(
              painter: const _CardGradientPainter(),
              child: Stack(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _heading(squad),
                        if (start != null) ...[
                          const SizedBox(height: 22),
                          _when(start),
                        ],
                        const SizedBox(height: 16),
                        _StatusBox(phase: phase, squad: squad, now: _now()),
                        const SizedBox(height: 16),
                        _RewardsBox(
                          title: squad.rewards,
                          note: squad.rewardsNote,
                        ),
                        const SizedBox(height: 20),
                        _PlayButton(
                          label: 'Let’s Play',
                          busy: _opening,
                          onTap: phase == SquadCardPhase.cancelled
                              ? null
                              : _play,
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    top: 22,
                    right: 18,
                    child: SecretSquadEnvelope(debugTime: widget.envelopeTime),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _heading(SecretSquadPost squad) {
    return Padding(
      // Clear of the envelope.
      padding: const EdgeInsets.only(right: 108),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            squad.kicker,
            style: SquadStyle.lexend(
              12,
              FontWeight.w600,
              SquadStyle.lilac,
              spacing: 12 * 0.16,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            squad.title,
            style: SquadStyle.lexend(
              31,
              FontWeight.w700,
              Colors.white,
              height: 1.05,
              spacing: -0.31,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            squad.subtitle,
            style: SquadStyle.lexend(
              15,
              FontWeight.w400,
              SquadStyle.lilacText,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }

  Widget _when(DateTime start) {
    final style = SquadStyle.lexend(15, FontWeight.w600, Colors.white);
    Widget item(_IconKind icon, String text) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CustomPaint(
          size: const Size.square(18),
          painter: _LineIconPainter(icon, Colors.white),
        ),
        const SizedBox(width: 8),
        Text(text, style: style),
      ],
    );
    return Wrap(
      spacing: 22,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        item(_IconKind.calendar, SecretSquadPost.dateLabel(start)),
        item(_IconKind.clock, SecretSquadPost.timeLabel(start)),
      ],
    );
  }
}

/// The card's violet: `linear-gradient(165deg, #5B4BD6 0%, #3A2E9E 45%,
/// #1B1F55 100%)`, laid over whatever size the card turns out to be.
class _CardGradientPainter extends CustomPainter {
  const _CardGradientPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final gradient = SquadStyle.cssGradient(
      165,
      size,
      const [SquadStyle.violetTop, SquadStyle.violetMid, SquadStyle.navyDeep],
      const [0, 0.45, 1],
    );
    canvas.drawRect(rect, Paint()..shader = gradient.createShader(rect));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// The white box: the countdown, or where the session is.
class _StatusBox extends StatelessWidget {
  const _StatusBox({
    required this.phase,
    required this.squad,
    required this.now,
  });

  final SquadCardPhase phase;
  final SecretSquadPost squad;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final (label, value) = switch (phase) {
      SquadCardPhase.countdown => (
        'Lobby opens in',
        squad.lobbyOpensAt == null
            ? '--:--:--'
            : SecretSquadPost.clock(
                SecretSquadPost.remaining(squad.lobbyOpensAt, now),
              ),
      ),
      SquadCardPhase.lobby => (
        'Lobby open · starts in',
        SecretSquadPost.shortClock(
          SecretSquadPost.remaining(squad.startsAt, now),
        ),
      ),
      SquadCardPhase.playing => (
        squad.office.isEmpty
            ? 'Squads are hunting'
            : '${squad.office} is hunting',
        'Playing now',
      ),
      SquadCardPhase.ended => ('Thanks for playing', 'Ended'),
      SquadCardPhase.cancelled => ('This session was called off', 'Cancelled'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(
            label,
            textAlign: TextAlign.center,
            style: SquadStyle.lexend(13, FontWeight.w400, SquadStyle.grey),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              style: SquadStyle.lexend(
                30,
                FontWeight.w700,
                phase == SquadCardPhase.cancelled
                    ? SquadStyle.grey
                    : SquadStyle.clockInk,
                spacing: 0.6,
                tabular: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RewardsBox extends StatelessWidget {
  const _RewardsBox({required this.title, required this.note});

  final String title;
  final String note;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: SquadStyle.lilacBox,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const CustomPaint(
              size: Size.square(24),
              painter: _LineIconPainter(_IconKind.trophy, SquadStyle.gold),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: SquadStyle.lexend(
                    14,
                    FontWeight.w600,
                    SquadStyle.violetMid,
                    spacing: 14 * 0.04,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  note,
                  style: SquadStyle.lexend(
                    13,
                    FontWeight.w400,
                    SquadStyle.grey,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The lime 3D button: it sits on a 6 px ledge and sinks 4 px into it when
/// pressed.
class _PlayButton extends StatefulWidget {
  const _PlayButton({required this.label, required this.busy, this.onTap});

  final String label;
  final bool busy;
  final VoidCallback? onTap;

  @override
  State<_PlayButton> createState() => _PlayButtonState();
}

class _PlayButtonState extends State<_PlayButton> {
  bool _down = false;

  void _press(bool down) {
    if (widget.onTap == null || _down == down) return;
    setState(() => _down = down);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    // Held down while the game is being found, so the tap shows it took.
    final down = _down || widget.busy;
    final ledge = down ? 2.0 : 6.0;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _press(true),
        onTapUp: (_) => _press(false),
        onTapCancel: () => _press(false),
        onTap: widget.onTap,
        child: Opacity(
          opacity: enabled ? 1 : 0.45,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 80),
            curve: Curves.ease,
            transform: Matrix4.translationValues(0, down ? 4 : 0, 0),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
            decoration: BoxDecoration(
              color: SquadStyle.lime,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: SquadStyle.limeEdge, width: 2.5),
              boxShadow: [
                BoxShadow(color: SquadStyle.limeEdge, offset: Offset(0, ledge)),
              ],
            ),
            child: Text(
              widget.label,
              textAlign: TextAlign.center,
              style: SquadStyle.lexend(22, FontWeight.w700, SquadStyle.limeInk),
            ),
          ),
        ),
      ),
    );
  }
}

enum _IconKind { calendar, clock, trophy }

/// The design's line icons (24-unit artboards, round caps and joins).
class _LineIconPainter extends CustomPainter {
  const _LineIconPainter(this.kind, this.color);

  final _IconKind kind;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    switch (kind) {
      case _IconKind.calendar:
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            const Rect.fromLTWH(3, 4, 18, 18),
            const Radius.circular(2),
          ),
          paint,
        );
        canvas.drawPath(
          Path()
            ..moveTo(16, 2)
            ..lineTo(16, 6)
            ..moveTo(8, 2)
            ..lineTo(8, 6)
            ..moveTo(3, 10)
            ..lineTo(21, 10),
          paint,
        );
      case _IconKind.clock:
        canvas.drawCircle(const Offset(12, 12), 9, paint);
        canvas.drawPath(
          Path()
            ..moveTo(12, 7)
            ..lineTo(12, 12)
            ..lineTo(15, 14),
          paint,
        );
      case _IconKind.trophy:
        canvas.drawPath(
          Path()
            ..moveTo(8, 21)
            ..lineTo(16, 21)
            ..moveTo(12, 17)
            ..lineTo(12, 21)
            // The cup.
            ..moveTo(7, 4)
            ..lineTo(17, 4)
            ..lineTo(17, 9)
            ..arcToPoint(const Offset(7, 9), radius: const Radius.circular(5))
            ..close()
            // The handles.
            ..moveTo(17, 5)
            ..lineTo(20, 5)
            ..lineTo(20, 7)
            ..arcToPoint(const Offset(17, 10), radius: const Radius.circular(3))
            ..moveTo(7, 5)
            ..lineTo(4, 5)
            ..lineTo(4, 7)
            ..arcToPoint(
              const Offset(7, 10),
              radius: const Radius.circular(3),
              clockwise: false,
            ),
          paint,
        );
    }
  }

  @override
  bool shouldRepaint(covariant _LineIconPainter oldDelegate) =>
      oldDelegate.kind != kind || oldDelegate.color != color;
}
