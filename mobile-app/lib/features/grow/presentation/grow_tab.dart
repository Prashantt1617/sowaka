part of '../../manager/presentation/manager_screen.dart';

class _GrowTab extends StatefulWidget {
  const _GrowTab({
    super.key,
    required this.state,
    required this.onOpenProfile,
    required this.onNotifications,
  });

  final ManagerState state;
  final VoidCallback onOpenProfile;
  final VoidCallback onNotifications;

  @override
  State<_GrowTab> createState() => _GrowTabState();
}

class _GrowTabState extends State<_GrowTab> {
  String? _selectedParameter;

  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;
    final history = data.growthHistory;
    final parameterNames = history.isEmpty
        ? const <String>[]
        : history.last.parameters.map((item) => item.name).toList();
    final selected = parameterNames.contains(_selectedParameter)
        ? _selectedParameter
        : null;
    final selectedIndex = selected == null
        ? -1
        : parameterNames.indexOf(selected);
    final trendColor = _growthParameterColor(selectedIndex);
    final values = history.map((record) {
      if (selected == null) return record.overallScore;
      return record.parameters
              .where((item) => item.name == selected)
              .map((item) => item.score)
              .firstOrNull ??
          0;
    }).toList();

    return Column(
      key: const ValueKey('grow'),
      children: [
        AppHomeHeader(
          profileAction: _ProfileAvatarAction(
            key: const ValueKey('grow-profile-avatar'),
            initial: data.managerInitial,
            onTap: widget.onOpenProfile,
            size: 30,
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
              if (history.isEmpty)
                const _GrowthEmptyState()
              else ...[
                const Text(
                  'Trend',
                  style: TextStyle(
                    color: MColors.ink,
                    fontSize: 18,
                    letterSpacing: -0.1,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 12),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _GrowthChip(
                        label: 'Overall',
                        color: MColors.terra,
                        selected: selected == null,
                        onTap: () => setState(() => _selectedParameter = null),
                      ),
                      ...parameterNames.indexed.map(
                        (entry) => Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: _GrowthChip(
                            label: entry.$2,
                            color: _growthParameterColor(entry.$1),
                            selected: selected == entry.$2,
                            onTap: () =>
                                setState(() => _selectedParameter = entry.$2),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                _GrowthChart(
                  records: history,
                  values: values,
                  color: trendColor,
                ),
                if (selected != null) ...[
                  const SizedBox(height: 22),
                  const _GrowthSectionLabel('MONTH BY MONTH'),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 205,
                    child: ListView.separated(
                      clipBehavior: Clip.none,
                      scrollDirection: Axis.horizontal,
                      itemCount: history.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 12),
                      itemBuilder: (context, index) {
                        final record = history.reversed.elementAt(index);
                        final parameter = record.parameters
                            .where((item) => item.name == selected)
                            .firstOrNull;
                        return SizedBox(
                          width: 270,
                          child: _GrowthMonthCard(
                            record: record,
                            parameter: parameter,
                          ),
                        );
                      },
                    ),
                  ),
                ],
                const SizedBox(height: 22),
                const Center(
                  child: Text(
                    'Full history is retained ✦',
                    style: TextStyle(color: MColors.inkFaint, fontSize: 12),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

Color _growthParameterColor(int index) {
  if (index < 0) return MColors.terra;
  return switch (index % 3) {
    1 => MColors.teal,
    2 => MColors.plum,
    _ => MColors.terra,
  };
}

class _GrowthEmptyState extends StatelessWidget {
  const _GrowthEmptyState();

  @override
  Widget build(BuildContext context) => const PressableCard(
    padding: EdgeInsets.all(20),
    child: Row(
      children: [
        IconBox(
          icon: Icons.show_chart_rounded,
          color: MColors.plum,
          tint: MColors.plumTint,
        ),
        SizedBox(width: 13),
        Expanded(
          child: Text(
            'Your trend and month-by-month feedback will appear after your manager shares the first review.',
            style: TextStyle(
              color: MColors.inkSoft,
              fontSize: 14,
              height: 1.45,
            ),
          ),
        ),
      ],
    ),
  );
}

class _GrowthChip extends StatelessWidget {
  const _GrowthChip({
    required this.label,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    borderRadius: BorderRadius.circular(99),
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 9),
      decoration: BoxDecoration(
        color: selected ? color : const Color(0xFFF1EBE1),
        border: Border.all(
          color: selected ? Colors.transparent : const Color(0x1A462D1C),
        ),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: selected ? Colors.white : MColors.inkSoft,
          fontSize: 13,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
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

class _GrowthSectionLabel extends StatelessWidget {
  const _GrowthSectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
    label,
    style: const TextStyle(
      color: MColors.inkFaint,
      fontSize: 11,
      fontWeight: FontWeight.w800,
      letterSpacing: 1.1,
    ),
  );
}

class _GrowthMonthCard extends StatelessWidget {
  const _GrowthMonthCard({required this.record, required this.parameter});

  final GrowthRecord record;
  final FeedbackParam? parameter;

  @override
  Widget build(BuildContext context) {
    final score = parameter?.score ?? record.overallScore;
    final notes = record.parameters
        .where((item) => item.note.trim().isNotEmpty)
        .map((item) => '${item.name}: ${item.note.trim()}')
        .join('\n\n');
    final note = parameter?.note.trim().isNotEmpty == true
        ? parameter!.note
        : notes.isNotEmpty
        ? notes
        : 'No feedback was recorded in this cycle.';
    return PressableCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _periodTitle(record.period),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: MColors.inkSoft,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Text(
                score.toStringAsFixed(1),
                style: TextStyle(
                  color: scoreColor(score),
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const Text(
                '/5',
                style: TextStyle(
                  color: MColors.inkFaint,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Divider(height: 1, color: MColors.line),
          ),
          Expanded(
            child: SingleChildScrollView(
              child: Text(
                note,
                style: const TextStyle(
                  color: MColors.inkSoft,
                  fontSize: 13.5,
                  height: 1.65,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
