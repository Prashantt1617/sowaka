part of '../../manager/presentation/manager_screen.dart';

class _GrowTab extends StatefulWidget {
  const _GrowTab({
    super.key,
    required this.state,
    required this.bloc,
    required this.onOpenProfile,
    required this.onNotifications,
  });

  final ManagerState state;
  final ManagerBloc bloc;
  final VoidCallback onOpenProfile;
  final VoidCallback onNotifications;

  @override
  State<_GrowTab> createState() => _GrowTabState();
}

class _GrowTabState extends State<_GrowTab> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;
    final period = _EmployeeGrowthPage._currentPeriod();
    final team = data.team;
    // "Given" counts reports whose review for the current period is already
    // sent — the same signal the team list shows as a green dot.
    final given = team
        .where((member) => member.history.any((r) => r.period == period))
        .length;
    final total = team.length;
    final percent = total == 0 ? 0 : ((given / total) * 100).round();
    final filtered = _query.isEmpty
        ? team
        : team
              .where(
                (member) =>
                    member.name.toLowerCase().contains(_query.toLowerCase()),
              )
              .toList();

    void openGrowth({
      required String name,
      required String designation,
      required List<GrowthRecord> history,
      int? memberId,
    }) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => _EmployeeGrowthPage(
            name: name,
            designation: designation,
            history: history,
            memberId: memberId,
            data: data,
            bloc: widget.bloc,
            onNotifications: widget.onNotifications,
          ),
        ),
      );
    }

    return Column(
      key: const ValueKey('grow'),
      children: [
        AppHomeHeader(
          profileAction: Semantics(
            button: true,
            label: 'Open profile',
            child: InkWell(
              borderRadius: BorderRadius.circular(99),
              onTap: widget.onOpenProfile,
              child: AvatarBadge(
                initial: data.managerInitial,
                index: 1,
                size: 30,
              ),
            ),
          ),
          onNotifications: widget.onNotifications,
          onQuickCreate: () => ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Quick create coming soon')),
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              _MyFeedbackCard(
                history: data.growthHistory,
                approverName: data.approverName,
                onOpen: data.growthHistory.isEmpty
                    ? null
                    : () => openGrowth(
                        name: data.managerName,
                        designation: data.managerTeam,
                        history: data.growthHistory,
                      ),
              ),
              const SizedBox(height: 14),
              if (total > 0) ...[
                _FeedbackGivenCard(
                  given: given,
                  total: total,
                  percent: percent,
                ),
                const SizedBox(height: 14),
              ],
              _FeedbackSearchField(
                query: _query,
                onChanged: (value) => setState(() => _query = value),
                onClear: () => setState(() => _query = ''),
                hint: 'Search employee',
              ),
              const SizedBox(height: 14),
              for (final member in filtered)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _GrowthTeamRow(
                    member: member,
                    reviewed: member.history.any((r) => r.period == period),
                    onTap: () => openGrowth(
                      name: member.name,
                      designation: member.designation.isEmpty
                          ? member.team
                          : member.designation,
                      history: member.history,
                      memberId: member.id,
                    ),
                  ),
                ),
              if (filtered.isEmpty && _query.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Center(
                    child: Text(
                      'No teammates match "$_query".',
                      style: const TextStyle(
                        color: MColors.inkFaint,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// "6/12 Feedback Given" progress card at the top of the Grow tab.
class _FeedbackGivenCard extends StatelessWidget {
  const _FeedbackGivenCard({
    required this.given,
    required this.total,
    required this.percent,
  });

  final int given;
  final int total;
  final int percent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: MColors.line),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                '$given/$total',
                style: const TextStyle(
                  color: Color(0xFF101828),
                  fontSize: 26,
                  height: 1,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Feedback Given',
                  style: TextStyle(
                    color: Color(0xFF6A7282),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFDBEAFE),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$percent%',
                  style: const TextStyle(
                    color: Color(0xFF0571A6),
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: total == 0 ? 0 : given / total,
              minHeight: 8,
              backgroundColor: const Color(0xFFE9EEF3),
              valueColor: const AlwaysStoppedAnimation(Color(0xFF0571A6)),
            ),
          ),
        ],
      ),
    );
  }
}

/// The signed-in user's own latest review, shown at the top of Grow. When no
/// manager has reviewed them yet it says so rather than rendering an empty card.
class _MyFeedbackCard extends StatelessWidget {
  const _MyFeedbackCard({
    required this.history,
    required this.approverName,
    required this.onOpen,
  });

  final List<GrowthRecord> history;
  final String approverName;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final latest = history.isEmpty ? null : history.last;
    if (latest == null) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: MColors.line),
        ),
        child: Row(
          children: [
            const IconBox(
              icon: Icons.show_chart_rounded,
              color: MColors.plum,
              tint: MColors.plumTint,
              size: 38,
              iconSize: 19,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Your feedback',
                    style: TextStyle(
                      color: MColors.ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    "Feedback hasn't been provided yet by $approverName.",
                    style: const TextStyle(
                      color: MColors.inkSoft,
                      fontSize: 12.5,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }
    final previous = history.length >= 2
        ? history[history.length - 2].overallScore
        : null;
    final delta = previous == null ? null : latest.overallScore - previous;
    return PressableCard(
      onTap: onOpen,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'YOUR FEEDBACK',
                  style: TextStyle(
                    color: Color(0xFF6A7282),
                    fontSize: 11,
                    letterSpacing: .6,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (delta != null)
                Text(
                  '${delta >= 0 ? '+' : ''}${delta.toStringAsFixed(1)} pts',
                  style: TextStyle(
                    color: delta >= 0
                        ? const Color(0xFF16A34A)
                        : const Color(0xFFDC2626),
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                latest.overallScore.toStringAsFixed(1),
                style: const TextStyle(
                  color: Color(0xFF101828),
                  fontSize: 32,
                  height: 1,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              const Padding(
                padding: EdgeInsets.only(bottom: 4),
                child: Text(
                  '/ 5',
                  style: TextStyle(
                    color: Color(0xFF6A7282),
                    fontSize: 15,
                    height: 1,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const Spacer(),
              Text(
                _periodTitle(latest.period),
                style: const TextStyle(
                  color: MColors.inkSoft,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Team row in the Grow tab; the dot shows whether this period's review is in.
class _GrowthTeamRow extends StatelessWidget {
  const _GrowthTeamRow({
    required this.member,
    required this.reviewed,
    required this.onTap,
  });

  final TeamMember member;
  final bool reviewed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          _TeamMemberPhoto(member: member, size: 42),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        member.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: MColors.ink,
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: reviewed
                            ? const Color(0xFF34C759)
                            : const Color(0xFFFF383C),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                ),
                if (member.designation.isNotEmpty)
                  Text(
                    member.designation,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: MColors.inkSoft,
                      fontSize: 12.5,
                    ),
                  ),
              ],
            ),
          ),
          SvgPicture.asset(
            'assets/icons/chevron_right_expand.svg',
            width: 20,
            height: 20,
            colorFilter: const ColorFilter.mode(
              MColors.inkFaint,
              BlendMode.srcIn,
            ),
          ),
        ],
      ),
    );
  }
}

class _GrowthChart extends StatelessWidget {
  const _GrowthChart({
    required this.records,
    required this.values,
    required this.color,
  });

  final List<GrowthRecord> records;
  final List<double> values;
  final Color color;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      SizedBox(
        height: 158,
        width: double.infinity,
        child: CustomPaint(painter: _GrowthChartPainter(values, color)),
      ),
      const SizedBox(height: 6),
      Padding(
        padding: const EdgeInsets.only(left: 28, right: 26),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: records
              .map(
                (record) => Text(
                  _periodLabel(record.period),
                  style: const TextStyle(
                    color: MColors.inkFaint,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              )
              .toList(),
        ),
      ),
    ],
  );
}

class _GrowthChartPainter extends CustomPainter {
  const _GrowthChartPainter(this.values, this.color);

  final List<double> values;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    var minValue = values.reduce(math.min);
    var maxValue = values.reduce(math.max);
    var min = ((minValue - .5) * 2).floor() / 2;
    var max = ((maxValue + .5) * 2).ceil() / 2;
    if (max - min < 2) {
      final middle = (min + max) / 2;
      min = middle - 1;
      max = middle + 1;
    }
    if (min < 0) {
      max -= min;
      min = 0;
    }
    if (max > 5) {
      min -= max - 5;
      max = 5;
    }
    min = math.max(0, min);
    final range = max - min == 0 ? 1.0 : max - min;
    const left = 28.0;
    const right = 26.0;
    const top = 18.0;
    const bottom = 8.0;
    final plotWidth = size.width - left - right;
    final plotHeight = size.height - top - bottom;
    double yFor(double value) => top + (1 - (value - min) / range) * plotHeight;

    for (var index = 0; index < 5; index++) {
      final guide = min + range * index / 4;
      final y = yFor(guide);
      final grid = Paint()
        ..color = MColors.line
        ..strokeWidth = 1;
      if (index == 0) {
        canvas.drawLine(Offset(left, y), Offset(size.width - right, y), grid);
      } else {
        const dash = 4.0;
        for (var x = left; x < size.width - right; x += dash * 2) {
          canvas.drawLine(
            Offset(x, y),
            Offset(math.min(x + dash, size.width - right), y),
            grid,
          );
        }
      }
      final label = TextPainter(
        text: TextSpan(
          text: guide.toStringAsFixed(1),
          style: const TextStyle(
            color: MColors.inkFaint,
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      label.paint(canvas, Offset(0, y - label.height / 2));
    }
    final line = Paint()
      ..color = color
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final fill = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [color.withValues(alpha: .18), Colors.transparent],
      ).createShader(Offset.zero & size);
    final points = values.indexed.map((entry) {
      final x = values.length == 1
          ? left + plotWidth / 2
          : left + entry.$1 * plotWidth / (values.length - 1);
      final y = yFor(entry.$2.clamp(0, 5));
      return Offset(x, y);
    }).toList();
    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (final point in points.skip(1)) {
      path.lineTo(point.dx, point.dy);
    }
    final area = Path.from(path)
      ..lineTo(points.last.dx, top + plotHeight)
      ..lineTo(points.first.dx, top + plotHeight)
      ..close();
    canvas
      ..drawPath(area, fill)
      ..drawPath(path, line);
    for (final entry in points.indexed) {
      final isLast = entry.$1 == points.length - 1;
      canvas.drawCircle(
        entry.$2,
        isLast ? 5.5 : 4,
        Paint()..color = isLast ? color : Colors.white,
      );
      canvas.drawCircle(
        entry.$2,
        isLast ? 4.25 : 3,
        Paint()
          ..color = color
          ..style = isLast ? PaintingStyle.fill : PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );
    }

    final valueLabel = TextPainter(
      text: TextSpan(
        text: values.last.toStringAsFixed(1),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final last = points.last;
    final pillWidth = valueLabel.width + 16;
    const pillHeight = 23.0;
    final pillLeft = (last.dx - pillWidth / 2).clamp(
      left,
      size.width - right - pillWidth,
    );
    final pillTop = math.max(0.0, last.dy - 31);
    final pill = RRect.fromRectAndRadius(
      Rect.fromLTWH(pillLeft, pillTop, pillWidth, pillHeight),
      const Radius.circular(99),
    );
    canvas.drawRRect(pill, Paint()..color = color);
    valueLabel.paint(
      canvas,
      Offset(
        pillLeft + (pillWidth - valueLabel.width) / 2,
        pillTop + (pillHeight - valueLabel.height) / 2,
      ),
    );
  }

  @override
  bool shouldRepaint(_GrowthChartPainter oldDelegate) =>
      oldDelegate.values != values || oldDelegate.color != color;
}

/// One review period on the growth timeline. Collapsed it shows the month and
/// overall score; expanded it lists each parameter with its stars, matching the
/// May 2026 card in the design.
class _GrowthMonthCard extends StatefulWidget {
  const _GrowthMonthCard({
    required this.record,
    this.initiallyExpanded = false,
  });

  final GrowthRecord record;
  final bool initiallyExpanded;

  @override
  State<_GrowthMonthCard> createState() => _GrowthMonthCardState();
}

class _GrowthMonthCardState extends State<_GrowthMonthCard> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final record = widget.record;
    final note = record.parameters
        .map((item) => item.note.trim())
        .firstWhere((value) => value.isNotEmpty, orElse: () => '');
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: MColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Text(
                    _periodTitle(record.period),
                    style: const TextStyle(
                      color: Color(0xFF101828),
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 6),
                  AnimatedRotation(
                    turns: _expanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: const Icon(
                      Icons.expand_more_rounded,
                      size: 20,
                      color: Color(0xFF6A7282),
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0x17675AFF),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '${record.overallScore.toStringAsFixed(1)} / 5',
                      style: const TextStyle(
                        color: Color(0xFF4F46E5),
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_expanded) ...[
            const Divider(height: 1, color: MColors.line),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final param in record.parameters)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _GrowthParamRow(param: param),
                    ),
                  if (note.isNotEmpty)
                    Text(
                      note,
                      style: const TextStyle(
                        color: MColors.inkSoft,
                        fontSize: 13,
                        height: 1.5,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Performance ★★★★☆ 4 / 5" row inside an expanded month card.
class _GrowthParamRow extends StatelessWidget {
  const _GrowthParamRow({required this.param});

  final FeedbackParam param;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          param.name,
          style: const TextStyle(
            color: Color(0xFF101828),
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (var i = 1; i <= 5; i++)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(
                  i <= param.score.round()
                      ? Icons.star_rounded
                      : Icons.star_outline_rounded,
                  size: 20,
                  color: i <= param.score.round()
                      ? const Color(0xFF0571A6)
                      : const Color(0xFFD1D5DB),
                ),
              ),
            const SizedBox(width: 6),
            Text(
              param.score.toStringAsFixed(param.score % 1 == 0 ? 0 : 1),
              style: const TextStyle(
                color: Color(0xFF0571A6),
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            const Text(
              ' / 5',
              style: TextStyle(color: Color(0xFF6A7282), fontSize: 12.5),
            ),
          ],
        ),
      ],
    );
  }
}
