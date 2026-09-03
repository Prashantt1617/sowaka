part of '../../manager/presentation/manager_screen.dart';

class _GrowTab extends StatefulWidget {
  const _GrowTab({
    super.key,
    required this.state,
    required this.bloc,
    required this.onOpenProfile,
    required this.onNotifications,
    required this.onOpenComposer,
  });

  final ManagerState state;
  final ManagerBloc bloc;
  final VoidCallback onOpenProfile;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

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
            onOpenComposer: widget.onOpenComposer,
          ),
        ),
      );
    }

    // An individual contributor can't give feedback, so Grow is simply their
    // own growth screen (node 1498:5847) — no team list, search or progress.
    if (!widget.state.canManage) {
      return _EmployeeGrowthPage(
        name: data.managerName,
        designation: data.managerTeam,
        history: data.growthHistory,
        data: data,
        bloc: widget.bloc,
        onNotifications: widget.onNotifications,
        onOpenComposer: widget.onOpenComposer,
        embedded: true,
        onOpenProfile: widget.onOpenProfile,
      );
    }

    return Column(
      key: const ValueKey('grow'),
      children: [
        AppHomeHeader(
          profileAction: _ProfileAvatarAction(
            initial: data.managerInitial,
            photoUrl: data.managerPhotoUrl,
            onTap: widget.onOpenProfile,
            size: 30,
          ),
          onNotifications: widget.onNotifications,
          onQuickCreate: widget.onOpenComposer,
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              if (total > 0) ...[
                _FeedbackGivenCard(given: given, total: total, period: period),
                const SizedBox(height: 14),
              ],
              _FeedbackSearchField(
                query: _query,
                onChanged: (value) => setState(() => _query = value),
                onClear: () => setState(() => _query = ''),
                hint: 'Search employee',
              ),
              const SizedBox(height: 14),
              // Per node 781:6773 the viewer's own entry sits directly below
              // the search field, styled like every other person's card.
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _MyGrowthRow(
                  name: data.managerName,
                  designation: data.managerTeam,
                  initial: data.managerInitial,
                  photoUrl: data.managerPhotoUrl,
                  reviewed: data.growthHistory.isNotEmpty,
                  approverName: data.approverName,
                  onOpen: data.growthHistory.isEmpty
                      ? null
                      : () => openGrowth(
                          name: data.managerName,
                          designation: data.managerTeam,
                          history: data.growthHistory,
                        ),
                ),
              ),
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

/// "6/12 Feedback Given" progress card at the top of the Grow tab
/// (node 781:6795).
class _FeedbackGivenCard extends StatelessWidget {
  const _FeedbackGivenCard({
    required this.given,
    required this.total,
    required this.period,
  });

  final int given;
  final int total;

  /// Review period, e.g. `2026-06`, shown as "JUNE 2026" above the count.
  final String period;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 26),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFEBEBEB), width: 1.114),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 1.5,
            offset: Offset(0, 1),
          ),
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 1,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _periodTitle(period).toUpperCase(),
            style: const TextStyle(
              color: Color(0xFF0571A6),
              fontSize: 11.5,
              height: 17.25 / 11.5,
              letterSpacing: 0.6,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '$given/$total',
                style: const TextStyle(
                  color: Color(0xFF222222),
                  fontSize: 32,
                  height: 1,
                  letterSpacing: -0.16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              const Padding(
                padding: EdgeInsets.only(bottom: 4),
                child: Text(
                  'Feedback Given',
                  style: TextStyle(
                    color: Color(0xFF717171),
                    fontSize: 12,
                    height: 17.25 / 12,
                    letterSpacing: 0.6,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Outlined track with a solid fill, rather than a tinted track.
          Container(
            height: 12,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF0571A6), width: 1.114),
            ),
            clipBehavior: Clip.antiAlias,
            child: FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: total == 0 ? 0 : (given / total).clamp(0.0, 1.0),
              child: const ColoredBox(color: Color(0xFF0571A6)),
            ),
          ),
        ],
      ),
    );
  }
}

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
/// The viewer's own feedback entry in the Grow list (node 781:6813). Same card
/// as a teammate's row, but labelled "You (…)"; when the approver hasn't given
/// feedback yet there's nothing to open, so tapping explains that instead.
class _MyGrowthRow extends StatelessWidget {
  const _MyGrowthRow({
    required this.name,
    required this.designation,
    required this.initial,
    required this.photoUrl,
    required this.reviewed,
    required this.approverName,
    required this.onOpen,
  });

  final String name;
  final String designation;
  final String initial;
  final String? photoUrl;
  final bool reviewed;
  final String approverName;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    return PressableCard(
      onTap: onOpen ?? () => _explainPending(context),
      padding: const EdgeInsets.all(17),
      child: Row(
        children: [
          _ProfileAvatarAction(
            initial: initial,
            photoUrl: photoUrl,
            onTap: onOpen ?? () => _explainPending(context),
            size: 56,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        '$name (You)',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: MColors.ink,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (reviewed)
                      Container(
                        width: 14,
                        height: 14,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFF00C950),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.1),
                        ),
                        child: const Icon(
                          Icons.check_rounded,
                          size: 10,
                          color: Colors.white,
                        ),
                      )
                    else
                      Container(
                        width: 16,
                        height: 16,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFF8C8F),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.1),
                        ),
                        child: const Icon(
                          Icons.priority_high_rounded,
                          size: 10,
                          color: Colors.white,
                        ),
                      ),
                  ],
                ),
                if (designation.isNotEmpty)
                  Text(
                    designation,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: MColors.inkSoft,
                      fontSize: 14,
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

  void _explainPending(BuildContext context) {
    final by = approverName.isEmpty ? 'your manager' : approverName;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text("Feedback hasn't been given yet by $by."),
        behavior: SnackBarBehavior.floating,
        backgroundColor: MColors.ink,
      ),
    );
  }
}

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
      padding: const EdgeInsets.all(17),
      child: Row(
        children: [
          _TeamMemberPhoto(member: member, size: 56),
          const SizedBox(width: 16),
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
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (reviewed)
                      Container(
                        width: 14,
                        height: 14,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFF00C950),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.1),
                        ),
                        child: const Icon(
                          Icons.check_rounded,
                          size: 10,
                          color: Colors.white,
                        ),
                      )
                    else
                      Container(
                        width: 16,
                        height: 16,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: const Color(0xFFFF8C8F),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.1),
                        ),
                        child: const Icon(
                          Icons.priority_high_rounded,
                          size: 10,
                          color: Colors.white,
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
                      fontSize: 14,
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
    this.selectedIndex,
    this.onSelect,
  });

  final List<GrowthRecord> records;
  final List<double> values;
  final Color color;

  /// Which point is highlighted with the value pill; defaults to the last
  /// (most recent) point when null.
  final int? selectedIndex;
  final ValueChanged<int>? onSelect;

  int get _effectiveIndex => selectedIndex ?? values.length - 1;

  void _handleTap(Offset localPosition, Size size) {
    if (onSelect == null || values.isEmpty) return;
    const left = 28.0;
    const right = 26.0;
    final plotWidth = size.width - left - right;
    final nearest = values.length == 1
        ? 0
        : (((localPosition.dx - left) / plotWidth) * (values.length - 1))
              .round()
              .clamp(0, values.length - 1);
    onSelect!(nearest);
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      SizedBox(
        height: 158,
        width: double.infinity,
        child: LayoutBuilder(
          builder: (context, constraints) => GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (details) =>
                _handleTap(details.localPosition, constraints.biggest),
            child: CustomPaint(
              size: Size.infinite,
              painter: _GrowthChartPainter(values, color, _effectiveIndex),
            ),
          ),
        ),
      ),
      const SizedBox(height: 6),
      Padding(
        padding: const EdgeInsets.only(left: 28, right: 26),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: records.indexed
              .map(
                (entry) => GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: onSelect == null ? null : () => onSelect!(entry.$1),
                  child: Text(
                    _periodLabel(entry.$2.period),
                    style: TextStyle(
                      color: entry.$1 == _effectiveIndex
                          ? color
                          : MColors.inkFaint,
                      fontSize: 11,
                      fontWeight: entry.$1 == _effectiveIndex
                          ? FontWeight.w800
                          : FontWeight.w600,
                    ),
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
  const _GrowthChartPainter(this.values, this.color, this.selectedIndex);

  final List<double> values;
  final Color color;
  final int selectedIndex;

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
      final isSelected = entry.$1 == selectedIndex;
      canvas.drawCircle(
        entry.$2,
        isSelected ? 5.5 : 4,
        Paint()..color = isSelected ? color : Colors.white,
      );
      canvas.drawCircle(
        entry.$2,
        isSelected ? 4.25 : 3,
        Paint()
          ..color = color
          ..style = isSelected ? PaintingStyle.fill : PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );
    }

    final selected = selectedIndex.clamp(0, values.length - 1);
    final valueLabel = TextPainter(
      text: TextSpan(
        text: values[selected].toStringAsFixed(1),
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final selectedPoint = points[selected];
    final pillWidth = valueLabel.width + 16;
    const pillHeight = 23.0;
    final pillLeft = (selectedPoint.dx - pillWidth / 2).clamp(
      left,
      size.width - right - pillWidth,
    );
    final pillTop = math.max(0.0, selectedPoint.dy - 31);
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
      oldDelegate.values != values ||
      oldDelegate.color != color ||
      oldDelegate.selectedIndex != selectedIndex;
}

/// One review period on the growth timeline. Collapsed it shows the month and
/// overall score; expanded it lists each parameter with its stars, matching the
/// May 2026 card in the design. Expansion is controlled by the parent so it
/// can stay in sync with the growth chart's selected point.
class _GrowthMonthCard extends StatelessWidget {
  const _GrowthMonthCard({
    required this.record,
    required this.expanded,
    required this.onToggle,
  });

  final GrowthRecord record;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
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
            onTap: onToggle,
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
                    turns: expanded ? 0.5 : 0,
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
          if (expanded) ...[
            const Divider(height: 1, color: Color(0xFFF3F4F6)),
            ColoredBox(
              color: const Color(0xFFF7F7F9),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final (index, param) in record.parameters.indexed)
                      Padding(
                        padding: EdgeInsets.only(
                          bottom: index == record.parameters.length - 1
                              ? 0
                              : 12,
                        ),
                        child: _GrowthParamCard(param: param, fallback: note),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One parameter inside an expanded month card: name, stars with the score,
/// then the written insight for that parameter.
class _GrowthParamCard extends StatelessWidget {
  const _GrowthParamCard({required this.param, required this.fallback});

  final FeedbackParam param;

  /// Older records only carried a single note for the whole review; show it
  /// rather than leaving the insight blank.
  final String fallback;

  @override
  Widget build(BuildContext context) {
    final insight = param.note.trim().isNotEmpty ? param.note.trim() : fallback;
    final filled = param.score.round();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF3F4F6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            param.name,
            style: const TextStyle(
              color: Color(0xFF222222),
              fontSize: 15,
              height: 22.5 / 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              for (var star = 1; star <= 5; star++)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Icon(
                    star <= filled
                        ? Icons.star_rounded
                        : Icons.star_outline_rounded,
                    size: 20,
                    color: star <= filled
                        ? const Color(0xFF0571A6)
                        : const Color(0xFFD1D5DB),
                  ),
                ),
              const SizedBox(width: 8),
              Text(
                param.score.toStringAsFixed(param.score % 1 == 0 ? 0 : 1),
                style: const TextStyle(
                  color: Color(0xFF0571A6),
                  fontSize: 18,
                  height: 27 / 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 4),
              const Text(
                '/ 5',
                style: TextStyle(
                  color: Color(0xFF717171),
                  fontSize: 13,
                  height: 19.5 / 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (insight.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Divider(height: 1, color: Color(0xFFF3F4F6)),
            const SizedBox(height: 16),
            const Text(
              'INSIGHT',
              style: TextStyle(
                color: Color(0xFF717171),
                fontSize: 11.5,
                height: 17.25 / 11.5,
                letterSpacing: .6,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              insight,
              style: const TextStyle(
                color: Color(0xFF484848),
                fontSize: 13.5,
                height: 21.6 / 13.5,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
