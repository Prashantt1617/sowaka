import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../connect/data/connect_models.dart';
import '../data/relay_api_service.dart';
import '../data/relay_models.dart';
import 'relay_game_screen.dart';
import 'relay_buttons.dart';
import 'relay_leaderboard.dart';
import 'relay_spinning_cube.dart';
import 'relay_style.dart';

/// The game's post in the Connect feed, and the only way in: counting down to
/// the start (Figma 2790:43744), live, and once it is over the result
/// (2759:43071).
///
/// The post itself is the same for the whole company; the team block is this
/// viewer's own, fetched separately, so nobody's feed shows somebody else's
/// team.
class RelayPostCard extends StatefulWidget {
  const RelayPostCard({super.key, required this.post, required this.session, this.card});

  final ConnectPost post;
  final AuthSession session;

  /// Supplied only by tests; the feed always asks the server.
  @visibleForTesting
  final RelayCard? card;

  @override
  State<RelayPostCard> createState() => _RelayPostCardState();
}

class _RelayPostCardState extends State<RelayPostCard> {
  RelayCard? _card;
  Timer? _ticker;

  static const _cream = Color(0xFFFAFAF7);
  static const _mist = Color(0xFFE5EDFF);

  @override
  void initState() {
    super.initState();
    // Once a second for the countdown; it stops itself when there is nothing
    // left to count.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      // Redrawn once more on the way out, so zero turns into the live dot.
      setState(() {});
      if (_phase != _CardPhase.upcoming) _ticker?.cancel();
    });
    if (widget.card != null) {
      _card = widget.card;
      return;
    }
    RelayApiService(session: widget.session).myCard().then((card) {
      if (mounted) setState(() => _card = card);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Map<String, dynamic> get _body => widget.post.body;

  String get _title {
    final title = (_body['title'] as String? ?? '').trim();
    return title.isEmpty ? 'Hint Relay' : title;
  }

  String get _subtitle {
    final subtitle = (_body['subtitle'] as String? ?? '').trim();
    return subtitle.isEmpty ? 'Many clues. One answer.' : subtitle;
  }

  DateTime? get _startsAt =>
      DateTime.tryParse(_body['startsAt'] as String? ?? '')?.toLocal() ?? _card?.startsAt;

  /// Where the game is, from the server's word where it has one and the clock
  /// otherwise — a card loaded before kick-off turns live on its own.
  _CardPhase get _phase {
    final card = _card;
    if (card != null && card.isFinished) return _CardPhase.over;
    if (card != null && card.isLive) return _CardPhase.live;
    final at = _startsAt;
    if (at != null && at.isAfter(DateTime.now())) return _CardPhase.upcoming;
    return at == null ? _CardPhase.upcoming : _CardPhase.live;
  }

  void _open() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RelayGameScreen(
          session: widget.session,
          // Feed → lobby → How to play → back to lobby.
          startWithRules: false,
          instructionsVideoUrl: _card?.instructionsVideoUrl ?? '',
          pointsPerCorrect: (_body['pointsPerCorrect'] as num?)?.toInt() ?? _card?.pointsPerCorrect ?? 0,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final over = _phase == _CardPhase.over;
    return LayoutBuilder(
      builder: (context, box) => Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          gradient: over
              ? _gradientFor(Size(box.maxWidth, 700), 144.7696351299595)
              : _gradientFor(Size(box.maxWidth, 683), 145.43061670358364),
        ),
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: over ? _finished() : _upcomingOrLive(),
        ),
      ),
    );
  }

  List<Widget> _upcomingOrLive() {
    return [
      _heading(),
      const SizedBox(height: 18),
      _when(),
      // Live, the countdown has nothing left to count; the dot up top says so.
      if (_phase == _CardPhase.upcoming) ...[
        const SizedBox(height: 18),
        _clockBox(),
      ],
      const SizedBox(height: 18),
      _rewardBox(),
      if (_card?.teamName != null) ...[
        const SizedBox(height: 18),
        Container(height: 1, color: const Color(0xF7CCFCFF)),
        const SizedBox(height: 18),
        _team(_card!),
      ],
      const SizedBox(height: 18),
      RelayCtaButton(
        label: 'Let’s Play',
        labelPadding: const EdgeInsets.fromLTRB(13, 28, 12, 39),
        onTap: _open,
      ),
    ];
  }

  /// The result: who won, the podium, and the way to the whole table.
  List<Widget> _finished() {
    final podium = _card?.podium ?? const <RelayStanding>[];
    return [
      _heading(over: true),
      if (podium.isNotEmpty) ...[
        const SizedBox(height: 18),
        Column(
          children: [
            RelayStyle.svg('crown', width: 20, height: 20),
            const SizedBox(height: 8),
            _pill('${podium.first.name.toUpperCase()} TAKES THE WIN'),
          ],
        ),
        const SizedBox(height: 18),
        RelayPodium(
          top: podium,
          title: 'Final standings',
          surface: 'score_sunburst.jpg',
          surfaceLeft: -0.0016,
          surfaceTop: -0.3685,
        ),
      ],
      const SizedBox(height: 18),
      RelayCtaButton(
        label: 'View Leaderboard',
        labelPadding: const EdgeInsets.fromLTRB(13, 28, 12, 39),
        onTap: _open,
      ),
    ];
  }

  /// The frosted pill the finished post uses for its status and its winner.
  Widget _pill(String text, {bool dot = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0x24FFFFFF),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0x66FFFFFF)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[RelayStyle.svg('status_dot', width: 7, height: 7), const SizedBox(width: 6)],
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: RelayStyle.sora(11, weight: FontWeight.w700, color: Colors.white, spacing: 1.5),
            ),
          ),
        ],
      ),
    );
  }

  /// The card's own `linear-gradient(<angle>, #57B9E8 1.91%, #147381 98.09%)`.
  LinearGradient _gradientFor(Size size, double degrees) {
    final radians = degrees * math.pi / 180;
    final dx = math.sin(radians);
    final dy = -math.cos(radians);
    final half = (size.width * dx.abs() + size.height * dy.abs()) / 2;
    Alignment at(double stop) {
      final along = half * (2 * stop - 1);
      return Alignment(dx * along / (size.width / 2), dy * along / (size.height / 2));
    }

    return LinearGradient(
      begin: at(0.019124),
      end: at(0.98088),
      colors: const [Color(0xFF57B9E8), Color(0xFF147381)],
    );
  }

  /// Once the game is over the label becomes a "GAME OVER" pill, ten taller,
  /// and the block closes up under the title (133 rather than 165).
  Widget _heading({bool over = false}) {
    final titleTop = over ? 26.0 + 32 : 16.0 + 32;
    return SizedBox(
      // Finished, the block is only as tall as what is in it.
      height: over ? null : 165,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 181,
            top: titleTop - 59.21,
            child: const RelaySpinningCube(),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (over)
                _pill('GAME OVER', dot: true)
              else
                // The live dot sits opposite the label, centred on its line,
                // without pushing the title down.
                SizedBox(
                  width: double.infinity,
                  height: 16,
                  child: Stack(
                    clipBehavior: Clip.none,
                    children: [
                      Text(
                        'TEAM CHALLENGE',
                        style: RelayStyle.sora(
                          13,
                          weight: FontWeight.w600,
                          color: RelayStyle.surface,
                          spacing: 1.6,
                        ),
                      ),
                      if (_phase == _CardPhase.live)
                        const Positioned(right: 0, top: -5, child: _LiveBadge()),
                    ],
                  ),
                ),
              const SizedBox(height: 32),
              Text(
                _title,
                maxLines: 1,
                overflow: TextOverflow.visible,
                style: RelayStyle.sora(40, weight: FontWeight.w600, color: _cream, spacing: -1),
              ),
              const SizedBox(height: 5),
              Text(_subtitle, style: RelayStyle.sora(16, color: _mist)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _when() {
    final at = _startsAt;
    if (at == null) return const SizedBox.shrink();
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    final hour = at.hour % 12 == 0 ? 12 : at.hour % 12;
    final minutes = at.minute == 0 ? '' : ':${at.minute.toString().padLeft(2, '0')}';
    final meridiem = at.hour < 12 ? 'A.M.' : 'P.M.';
    final style = RelayStyle.sora(16, weight: FontWeight.w600, color: _cream);
    // Date then time, 18 apart, as drawn. Only the date gives way, and only on
    // a phone too narrow for both.
    return Row(
      children: [
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                RelayStyle.svg('calendar', width: 18, height: 18),
                const SizedBox(width: 8),
                Text('${at.day} ${months[at.month - 1]}', style: style),
              ],
            ),
          ),
        ),
        const SizedBox(width: 18),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(width: 18, height: 18, child: Center(child: RelayStyle.svg('clock', width: 17, height: 17))),
            const SizedBox(width: 8),
            Text('$hour$minutes $meridiem', style: style),
          ],
        ),
      ],
    );
  }

  /// "Game start in", counting down to the second.
  Widget _clockBox() {
    final at = _startsAt;
    final left = at == null ? Duration.zero : at.difference(DateTime.now());
    final seconds = left.isNegative ? 0 : left.inSeconds;
    String two(int n) => n.toString().padLeft(2, '0');
    final value = '${two(seconds ~/ 3600)}:${two(seconds % 3600 ~/ 60)}:${two(seconds % 60)}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          Text(
            'Game start in ',
            style: RelayStyle.sora(12, weight: FontWeight.w600, color: RelayStyle.tertiary, height: 16.2, spacing: -0.16),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: RelayStyle.sora(32, weight: FontWeight.w600, color: RelayStyle.brand, spacing: -0.16)
                .copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
          ),
        ],
      ),
    );
  }

  Widget _rewardBox() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: const Color(0xFFE7F7FF),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: RelayStyle.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFEBEBEB)),
            ),
            alignment: Alignment.center,
            child: Image.asset('${RelayStyle.asset}/trophy.png', width: 32, height: 32),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'SURPRISE REWARDS',
                    style: RelayStyle.sora(20, weight: FontWeight.w600, color: RelayStyle.tertiary, height: 24, spacing: 0.4),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'For the top teams',
                  style: RelayStyle.sora(14, color: RelayStyle.tertiary, height: 16.2, spacing: -0.16),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _team(RelayCard card) {
    // The lead first, crowned, as the design stacks them.
    final ordered = [
      ...card.members.where((m) => m.isLeader),
      ...card.members.where((m) => !m.isLeader),
    ];
    final shown = ordered.take(3).toList();
    final extra = ordered.length - shown.length;
    const tints = [Color(0xFFF8D6C2), Color(0xFFCBE3C9), Color(0xFFDCCCEB)];
    final teammates = math.max(0, card.members.length - 1);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('YOUR TEAM', style: RelayStyle.sora(12, color: _mist, spacing: 1.2)),
              const SizedBox(height: 5),
              Text(
                card.teamName!,
                overflow: TextOverflow.ellipsis,
                style: RelayStyle.sora(22, weight: FontWeight.w600, color: _cream),
              ),
              const SizedBox(height: 5),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  '1 lead + $teammates teammate${teammates == 1 ? '' : 's'}',
                  maxLines: 1,
                  style: RelayStyle.sora(14, color: _mist),
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 38,
          width: 38.0 * (shown.length + (extra > 0 ? 1 : 0)) - 7.0 * (shown.length + (extra > 0 ? 1 : 0) - 1),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              for (var i = 0; i < shown.length; i += 1)
                Positioned(left: 31.0 * i, child: _bubble(_initials(shown[i].name), tints[i % tints.length])),
              if (extra > 0)
                Positioned(
                  left: 31.0 * shown.length,
                  child: _bubble('+$extra', const Color(0xFFCDE3E8), bold: true),
                ),
              if (shown.isNotEmpty && shown.first.isLeader)
                Positioned(left: 9, top: -16, child: RelayStyle.svg('crown', width: 20, height: 20)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bubble(String text, Color color, {bool bold = false}) => Container(
    width: 38,
    height: 38,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    alignment: Alignment.center,
    child: Text(
      text,
      style: RelayStyle.sora(
        10,
        weight: bold ? FontWeight.w700 : FontWeight.w400,
        color: const Color(0xFF155844),
      ),
    ),
  );

  static String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.take(2).toString().toUpperCase();
    return (parts.first.characters.first + parts.last.characters.first).toUpperCase();
  }

}

enum _CardPhase { upcoming, live, over }

/// "● LIVE" in the finished post's frosted pill, the dot breathing so the
/// card reads as happening now.
class _LiveBadge extends StatefulWidget {
  const _LiveBadge();

  @override
  State<_LiveBadge> createState() => _LiveBadgeState();
}

class _LiveBadgeState extends State<_LiveBadge> with SingleTickerProviderStateMixin {
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Live now',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0x24FFFFFF),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: const Color(0x66FFFFFF)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            FadeTransition(
              opacity: Tween<double>(begin: 1, end: 0.35).animate(_pulse),
              child: Container(
                width: 7,
                height: 7,
                decoration: const BoxDecoration(color: RelayStyle.online, shape: BoxShape.circle),
              ),
            ),
            const SizedBox(width: 6),
            Text('LIVE', style: RelayStyle.sora(11, weight: FontWeight.w700, color: Colors.white, spacing: 1.5)),
          ],
        ),
      ),
    );
  }
}
