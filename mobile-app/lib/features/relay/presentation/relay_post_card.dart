import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../auth/data/auth_models.dart';
import '../../connect/data/connect_models.dart';
import '../data/relay_api_service.dart';
import '../data/relay_models.dart';
import 'relay_game_screen.dart';
import 'relay_style.dart';

/// The game's post in the Connect feed (Figma 2606:35400), and the only way in.
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

  static const _cream = Color(0xFFFAFAF7);
  static const _mist = Color(0xFFE5EDFF);

  @override
  void initState() {
    super.initState();
    if (widget.card != null) {
      _card = widget.card;
      return;
    }
    RelayApiService(session: widget.session).myCard().then((card) {
      if (mounted) setState(() => _card = card);
    }).catchError((_) {});
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
      DateTime.tryParse(_body['startsAt'] as String? ?? '')?.toLocal();

  /// HR's figure from the post; the card never invents one.
  int get _reward => (_body['rewardAmount'] as num?)?.toInt() ?? _card?.rewardAmount ?? 0;

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
    return LayoutBuilder(
      builder: (context, box) => Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          gradient: _gradientFor(Size(box.maxWidth, 545)),
        ),
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _heading(),
            const SizedBox(height: 18),
            _when(),
            const SizedBox(height: 18),
            _rewardBox(),
            if (_card?.teamName != null) ...[
              const SizedBox(height: 18),
              Container(height: 1, color: const Color(0xF7CCFCFF)),
              const SizedBox(height: 18),
              _team(_card!),
            ],
            const SizedBox(height: 18),
            GestureDetector(
              onTap: _open,
              child: SizedBox(
                height: 101,
                child: Stack(
                  children: [
                    // The button is artwork in the design, cropped from a
                    // larger image — reproduced as drawn, not restyled.
                    Positioned.fill(
                      child: LayoutBuilder(
                        builder: (context, box) => Stack(
                          clipBehavior: Clip.none,
                          children: [
                            Positioned(
                              left: -0.0518 * box.maxWidth,
                              top: -0.7192 * box.maxHeight,
                              width: 1.0976 * box.maxWidth,
                              height: 2.4658 * box.maxHeight,
                              child: Image.asset('${RelayStyle.asset}/game_cta.png', fit: BoxFit.fill),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(13, 28, 12, 39),
                      child: Center(
                        child: Text(
                          'View game',
                          textAlign: TextAlign.center,
                          style: RelayStyle.sora(
                            24,
                            weight: FontWeight.w700,
                            color: const Color(0xFF078442),
                            height: 24,
                            spacing: -0.16,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The card's own `linear-gradient(148.81deg, #57B9E8 1.91%, #147381 98.09%)`.
  LinearGradient _gradientFor(Size size) {
    const degrees = 148.81229242720906;
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

  Widget _heading() {
    return SizedBox(
      height: 165,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 181,
            top: 48 - 59.21,
            child: Image.asset(
              '${RelayStyle.asset}/question_mark.png',
              width: 168,
              height: 168,
              fit: BoxFit.cover,
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
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
    // Date at one end, time at the other, as drawn, both at full size. Only
    // the date gives way, and only on a phone too narrow for both — splitting
    // the row into equal halves shrank it on every phone.
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
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
                Text('Starts ${at.day} ${months[at.month - 1]}', style: style),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
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

  Widget _rewardBox() {
    return Container(
      constraints: const BoxConstraints(minHeight: 106),
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
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'REWARDS UP TO',
                  style: RelayStyle.sora(
                    12,
                    weight: FontWeight.w600,
                    color: RelayStyle.tertiary,
                    spacing: 1.2,
                  ),
                ),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '₹${_indianGrouping(_reward)}',
                    style: RelayStyle.sora(38, weight: FontWeight.w700),
                  ),
                ),
                const SizedBox(height: 2),
                Text('For the top teams', style: RelayStyle.sora(13, color: RelayStyle.tertiary)),
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

  /// 10000 → 10,000 and 1000000 → 10,00,000, the way rupees are written.
  static String _indianGrouping(int value) {
    final digits = value.toString();
    if (digits.length <= 3) return digits;
    final last3 = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    final groups = <String>[];
    while (rest.length > 2) {
      groups.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) groups.insert(0, rest);
    return '${groups.join(',')},$last3';
  }
}
