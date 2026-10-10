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
  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;

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
          child: _TeamFeedbackList(
            data: data,
            bloc: widget.bloc,
            onNotifications: widget.onNotifications,
            onOpenComposer: widget.onOpenComposer,
            leading: [
              // Node 2408:75660. Someone at the top of the reporting tree has
              // nobody reviewing them, so there is nothing to open and the card
              // would only promise a review that never comes.
              if (data.hasManager) ...[
                _YourFeedbackCard(
                  initial: data.managerInitial,
                  photoUrl: data.managerPhotoUrl,
                  onOpen: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => _EmployeeGrowthPage(
                        name: data.managerName,
                        designation: data.managerTeam,
                        history: data.growthHistory,
                        data: data,
                        bloc: widget.bloc,
                        onNotifications: widget.onNotifications,
                        onOpenComposer: widget.onOpenComposer,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// This month's reviews for a manager's direct reports (node 3114:55009): the
/// Team Feedback card, then a card per report, still-to-review first. It is
/// the Feedback section of the Team tab, and the body of a manager's Grow tab
/// under their own "Your Feedback" card.
class _TeamFeedbackList extends StatefulWidget {
  const _TeamFeedbackList({
    super.key,
    required this.data,
    required this.bloc,
    required this.onNotifications,
    required this.onOpenComposer,
    this.leading = const [],
    this.fromTeamTab = false,
  });

  final ManagerDashboard data;
  final ManagerBloc bloc;
  final VoidCallback onNotifications;
  final VoidCallback onOpenComposer;

  /// What sits above the Team Feedback card — the Grow tab's own review card.
  final List<Widget> leading;

  /// Opened from the Team tab, a report's page keeps the Team sections above
  /// it, as the design draws it (node 3165:59012).
  final bool fromTeamTab;

  @override
  State<_TeamFeedbackList> createState() => _TeamFeedbackListState();
}

class _TeamFeedbackListState extends State<_TeamFeedbackList> {
  String _query = '';

  void _open(TeamMember member) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _EmployeeGrowthPage(
          name: member.name,
          designation: member.designation.isEmpty
              ? member.team
              : member.designation,
          history: member.history,
          memberId: member.id,
          data: widget.data,
          bloc: widget.bloc,
          onNotifications: widget.onNotifications,
          onOpenComposer: widget.onOpenComposer,
          showTeamSections: widget.fromTeamTab,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final period = _EmployeeGrowthPage._currentPeriod();
    // Feedback only flows downward, to direct reports: never the viewer, a
    // peer, or the viewer's own manager, all of whom are in the team list.
    final team = _reviewableReports(widget.data);
    // "Given" counts reports whose review for the current period is already
    // sent — the same signal each row below ticks green.
    final given = team.where(_reviewedThisMonth).length;
    final total = team.length;
    final query = _query.toLowerCase();
    final filtered = [
      for (final member in team)
        if (query.isEmpty || member.name.toLowerCase().contains(query)) member,
    ];
    // The ones still to review come first, each group in the server's order.
    final ordered = [
      ...filtered.where((member) => !_reviewedThisMonth(member)),
      ...filtered.where(_reviewedThisMonth),
    ];

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        ...widget.leading,
        if (total > 0) ...[
          _FeedbackGivenCard(given: given, total: total, period: period),
          const SizedBox(height: 12),
          _FeedbackSearchField(
            query: _query,
            onChanged: (value) => setState(() => _query = value),
            onClear: () => setState(() => _query = ''),
            hint: 'Search employee',
          ),
        ] else
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 40),
            child: Center(
              child: Text(
                'No direct reports to review yet.',
                style: TextStyle(
                  color: MColors.inkFaint,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        // 16 between the cards (node 3114:55263, pt-[16px]).
        for (final member in ordered) ...[
          const SizedBox(height: 16),
          _FeedbackMemberRow(
            member: member,
            reviewed: _reviewedThisMonth(member),
            onTap: () => _open(member),
          ),
        ],
        if (ordered.isEmpty && _query.isNotEmpty)
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
    );
  }
}

/// The viewer's own reviews, as the first thing on a manager's Grow tab
/// (node 2408:75660). Opens their growth page; only shown to someone who has a
/// manager to be reviewed by.
class _YourFeedbackCard extends StatelessWidget {
  const _YourFeedbackCard({
    required this.initial,
    required this.photoUrl,
    required this.onOpen,
  });

  final String initial;
  final String? photoUrl;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: _growCardDecoration(16),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.all(17.114),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ProfileAvatarAction(
                  initial: initial,
                  photoUrl: photoUrl,
                  onTap: onOpen,
                  size: 56,
                ),
                const SizedBox(width: 16),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Your Feedback',
                              style: TextStyle(
                                color: Color(0xFF222222),
                                fontSize: 17,
                                height: 25.5 / 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          _GrowChevron(),
                        ],
                      ),
                      Text(
                        'Your manager reviews your performance against your '
                        'KPIs every month.',
                        style: TextStyle(
                          color: Color(0xFF717171),
                          fontSize: 14,
                          height: 20 / 14,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _GrowChevron extends StatelessWidget {
  const _GrowChevron();

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      'assets/icons/chevron_right_expand.svg',
      width: 20,
      height: 20,
      colorFilter: const ColorFilter.mode(Color(0xFF717171), BlendMode.srcIn),
    );
  }
}

BoxDecoration _growCardDecoration(double radius) => BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.circular(radius),
  border: Border.all(color: const Color(0xFFEBEBEB), width: 1.114),
  boxShadow: const [
    BoxShadow(color: Color(0x1A000000), blurRadius: 1.5, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x1A000000), blurRadius: 1, offset: Offset(0, 1)),
  ],
);

/// "Team Feedback": how many of this month's reviews are in (nodes 2395:70619,
/// 2408:75654). The bulb opens a note on why the reviews matter — closed by
/// default, since a manager who has read it once does not need it every visit.
class _FeedbackGivenCard extends StatefulWidget {
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
  State<_FeedbackGivenCard> createState() => _FeedbackGivenCardState();
}

class _FeedbackGivenCardState extends State<_FeedbackGivenCard> {
  bool _tipOpen = false;

  @override
  Widget build(BuildContext context) {
    final given = widget.given;
    final total = widget.total;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 26),
      decoration: _growCardDecoration(24),
      // Set in Sora, as the design draws the whole card (node 3114:55209).
      child: DefaultTextStyle.merge(
        style: const TextStyle(fontFamily: 'Sora'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.only(bottom: 8),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: Color(0xFFEBEBEB))),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Team Feedback',
                            style: TextStyle(
                              color: Color(0xFF101828),
                              fontSize: 16,
                              height: 16.2 / 16,
                              letterSpacing: -0.16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        Semantics(
                          button: true,
                          label: _tipOpen ? 'Hide tip' : 'Why this matters',
                          child: GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => setState(() => _tipOpen = !_tipOpen),
                            child: Image.asset(
                              'assets/icons/grow/light_bulb.png',
                              width: 24,
                              height: 24,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_tipOpen)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0x1FFFB000),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        "Review your team's performance against their KPIs every "
                        "month, so they have clarity on what they're doing well "
                        'and where they can grow. A good leader uses this '
                        'feedback to help their team grow and stay engaged.',
                        style: TextStyle(
                          color: Color(0xFF222222),
                          fontSize: 12,
                          height: 16.2 / 12,
                          letterSpacing: -0.16,
                          fontWeight: FontWeight.w300,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              _periodTitle(widget.period).toUpperCase(),
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
            // Width stated outright: in a start-aligned column the track sized
            // itself to the fill, so the outline hugged the blue and the rest
            // of the bar was simply not there.
            Container(
              height: 12,
              width: double.infinity,
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
            const SizedBox(height: 8),
            const Text(
              "Review your team's performance every month",
              style: TextStyle(
                color: Color(0xFF484848),
                fontSize: 12,
                height: 16.2 / 12,
                letterSpacing: -0.16,
                fontWeight: FontWeight.w300,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One report in the feedback list (node 3114:55246): photo, name with this
/// month's state beside it — a yellow "Pending" pill until the review is in, a
/// green tick after — the designation under it, and a chevron to their page.
class _FeedbackMemberRow extends StatelessWidget {
  const _FeedbackMemberRow({
    required this.member,
    required this.reviewed,
    required this.onTap,
  });

  final TeamMember member;
  final bool reviewed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final subtitle = member.designation.isNotEmpty
        ? member.designation
        : member.team;
    return _TeamCardShell(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _TeamMemberPhoto(member: member, size: 56),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Flexible(
                            child: Text(
                              member.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontFamily: 'Sora',
                                color: Color(0xFF222222),
                                fontSize: 17,
                                height: 25.5 / 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          if (reviewed)
                            const _FeedbackDoneBadge()
                          else
                            const _FeedbackPendingPill(),
                        ],
                      ),
                    ),
                    SvgPicture.asset('assets/icons/team/row_chevron.svg'),
                  ],
                ),
                if (subtitle.isNotEmpty)
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: 'Sora',
                      color: Color(0xFF717171),
                      fontSize: 14,
                      height: 20 / 14,
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

/// "Pending" on a pale yellow wash (node 3515:67404).
class _FeedbackPendingPill extends StatelessWidget {
  const _FeedbackPendingPill();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFFEFDDA),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Text(
        'Pending',
        style: TextStyle(
          fontFamily: 'Sora',
          color: Color(0xFFFFCC00),
          fontSize: 10,
          height: 16.2 / 10,
          letterSpacing: -0.16,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// The review is in: a green square with a white tick (node 3114:55290).
class _FeedbackDoneBadge extends StatelessWidget {
  const _FeedbackDoneBadge();

  @override
  Widget build(BuildContext context) {
    // The tick alone says nothing to a screen reader.
    return Semantics(
      label: 'Feedback given',
      child: Container(
        width: 16.228,
        height: 16.228,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xFF00C950),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: Colors.white, width: 1.114),
        ),
        child: SvgPicture.asset('assets/icons/feedback_check_tick.svg'),
      ),
    );
  }
}

/// Six months of overall scores (node 2406:74944): the five before this one
/// and this one, which has no point yet. A reviewed month is a hollow point
/// on the line, a month nobody reviewed sits on the baseline in grey, and
/// the month whose score is shown above is filled, with the score in a pill
/// over it. A fixed 0–5 scale and no axis: the pill says the number.
class _GrowthChart extends StatelessWidget {
  const _GrowthChart({
    required this.periods,
    required this.scores,
    required this.highlightPeriod,
    required this.currentPeriod,
    required this.firstReviewed,
    this.onSelect,
  });

  /// Oldest first, six of them.
  final List<String> periods;

  /// Overall score by period, for the months that were reviewed.
  final Map<String, double> scores;

  /// The month whose score the card above shows.
  final String highlightPeriod;
  final String currentPeriod;

  /// Months before the first review show nothing: there was nothing to miss.
  final String firstReviewed;
  final ValueChanged<String>? onSelect;

  /// Where the first and last month sit, as a share of the width.
  static const edge = 0.055;

  /// The six months ending at [current], oldest first.
  static List<String> windowEndingAt(String current) {
    final parts = current.split('-');
    var year = int.tryParse(parts[0]) ?? DateTime.now().year;
    var month =
        int.tryParse(parts.length > 1 ? parts[1] : '') ?? DateTime.now().month;
    final out = <String>[];
    for (var i = 0; i < 6; i++) {
      out.insert(0, '$year-${month.toString().padLeft(2, '0')}');
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
    }
    return out;
  }

  void _handleTap(Offset position, Size size) {
    if (onSelect == null || periods.length < 2) return;
    final left = size.width * edge;
    final step = (size.width - 2 * left) / (periods.length - 1);
    final index = ((position.dx - left) / step).round().clamp(
      0,
      periods.length - 1,
    );
    final period = periods[index];
    // Nothing to open before the first review, or after this month.
    if (period.compareTo(firstReviewed) < 0 ||
        period.compareTo(currentPeriod) > 0) {
      return;
    }
    onSelect!(period);
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 110,
    width: double.infinity,
    child: LayoutBuilder(
      builder: (context, constraints) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapUp: (details) =>
            _handleTap(details.localPosition, constraints.biggest),
        child: CustomPaint(
          size: Size.infinite,
          painter: _GrowthChartPainter(
            periods: periods,
            scores: scores,
            highlightPeriod: highlightPeriod,
            currentPeriod: currentPeriod,
            firstReviewed: firstReviewed,
          ),
        ),
      ),
    ),
  );
}

class _GrowthChartPainter extends CustomPainter {
  const _GrowthChartPainter({
    required this.periods,
    required this.scores,
    required this.highlightPeriod,
    required this.currentPeriod,
    required this.firstReviewed,
  });

  final List<String> periods;
  final Map<String, double> scores;
  final String highlightPeriod;
  final String currentPeriod;
  final String firstReviewed;

  static const _blue = Color(0xFF0571A6);
  static const _grey = Color(0xFF717171);
  static const _lavender = Color(0xFF7B61FF);

  /// Score 5 and score 0, from the top of the chart. Room above for the pill.
  static const _top = 14.0;
  static const _baseline = 76.0;
  static const _labelTop = 97.0;

  @override
  void paint(Canvas canvas, Size size) {
    if (periods.isEmpty) return;
    final left = size.width * _GrowthChart.edge;
    final step = periods.length == 1
        ? 0.0
        : (size.width - 2 * left) / (periods.length - 1);
    double yFor(double value) =>
        _baseline - (value.clamp(0, 5) / 5) * (_baseline - _top);

    // One slot per month: where its point is, and what kind of month it was.
    final points = <Offset?>[];
    final missed = <bool>[];
    for (final (index, period) in periods.indexed) {
      final x = left + index * step;
      final score = scores[period];
      if (score != null) {
        points.add(Offset(x, yFor(score)));
        missed.add(false);
      } else if (period.compareTo(firstReviewed) >= 0 &&
          period.compareTo(currentPeriod) < 0) {
        points.add(Offset(x, _baseline));
        missed.add(true);
      } else {
        points.add(null);
        missed.add(false);
      }
    }
    final plotted = points.whereType<Offset>().toList();

    if (plotted.length >= 2) {
      final path = Path()..moveTo(plotted.first.dx, plotted.first.dy);
      for (final point in plotted.skip(1)) {
        path.lineTo(point.dx, point.dy);
      }
      final area = Path.from(path)
        ..lineTo(plotted.last.dx, _baseline)
        ..lineTo(plotted.first.dx, _baseline)
        ..close();
      canvas.drawPath(
        area,
        Paint()
          ..shader = const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0x487B61FF), Color(0x007B61FF)],
          ).createShader(Rect.fromLTWH(0, _top, size.width, _baseline - _top)),
      );
      canvas.drawPath(
        path,
        Paint()
          ..color = _blue
          ..strokeWidth = 2.2
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round,
      );
    }

    // The month on show: a dashed drop to the baseline, the point filled, and
    // the score in a pill above it.
    final highlightIndex = periods.indexOf(highlightPeriod);
    final highlight = highlightIndex >= 0 ? points[highlightIndex] : null;
    if (highlight != null) {
      const pillWidth = 36.0;
      const pillHeight = 18.0;
      final pillTop = (highlight.dy - 27).clamp(0.0, _baseline);
      final dash = Paint()
        ..color = _lavender.withValues(alpha: .4)
        ..strokeWidth = 1;
      var y = pillTop + pillHeight;
      while (y < _baseline) {
        canvas.drawLine(
          Offset(highlight.dx, y),
          Offset(highlight.dx, (y + 3).clamp(0.0, _baseline)),
          dash,
        );
        y += 6;
      }
      final pillLeft = (highlight.dx - pillWidth / 2).clamp(
        0.0,
        size.width - pillWidth,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(pillLeft, pillTop, pillWidth, pillHeight),
          const Radius.circular(6),
        ),
        Paint()..color = _blue,
      );
      final score = scores[highlightPeriod];
      final label = TextPainter(
        text: TextSpan(
          text: score == null ? '-/5' : '${score.toStringAsFixed(1)}/5',
          style: const TextStyle(
            fontFamily: 'Sora',
            color: Colors.white,
            fontSize: 9.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      label.paint(
        canvas,
        Offset(
          pillLeft + (pillWidth - label.width) / 2,
          pillTop + (pillHeight - label.height) / 2,
        ),
      );
    }

    for (final (index, point) in points.indexed) {
      if (point == null) continue;
      if (index == highlightIndex) {
        canvas.drawCircle(point, 6, Paint()..color = _blue);
      } else if (missed[index]) {
        canvas.drawCircle(point, 4, Paint()..color = _grey);
      } else {
        canvas.drawCircle(point, 4, Paint()..color = Colors.white);
        canvas.drawCircle(
          point,
          4,
          Paint()
            ..color = _blue
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2,
        );
      }
    }

    // Month labels; this month in blue, as the one still to come.
    for (final (index, period) in periods.indexed) {
      final label = TextPainter(
        text: TextSpan(
          text: _periodLabel(period),
          style: TextStyle(
            fontFamily: 'Sora',
            color: period == currentPeriod ? _blue : _grey,
            fontSize: 9,
            height: 11.3 / 9,
            fontWeight: FontWeight.w700,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      label.paint(
        canvas,
        Offset(left + index * step - label.width / 2, _labelTop),
      );
    }
  }

  @override
  bool shouldRepaint(_GrowthChartPainter old) =>
      old.periods != periods ||
      old.scores != scores ||
      old.highlightPeriod != highlightPeriod ||
      old.currentPeriod != currentPeriod ||
      old.firstReviewed != firstReviewed;
}

/// One reviewed parameter (node 3165:60344): name, stars with the score,
/// then the manager's insight for it.
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
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEBEBEB)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 7,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            param.name,
            style: const TextStyle(
              fontFamily: 'Sora',
              color: Color(0xFF222222),
              fontSize: 15,
              height: 22.5 / 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              // The design's 20px StarIcons, 4 apart (node 3165:60350): blue
              // for each point earned, a pale grey for the rest.
              for (var star = 1; star <= 5; star++) ...[
                if (star > 1) const SizedBox(width: 4),
                SvgPicture.asset(
                  star <= filled
                      ? 'assets/icons/grow/param_star_filled.svg'
                      : 'assets/icons/grow/param_star_empty.svg',
                ),
              ],
              const SizedBox(width: 12),
              Text(
                param.score.toStringAsFixed(param.score % 1 == 0 ? 0 : 1),
                style: const TextStyle(
                  fontFamily: 'Sora',
                  color: Color(0xFF0571A6),
                  fontSize: 18,
                  height: 27 / 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 12),
              const Text(
                '/ 5',
                style: TextStyle(
                  fontFamily: 'Sora',
                  color: Color(0xFF717171),
                  fontSize: 13,
                  height: 19.5 / 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          if (insight.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Divider(
              height: 1.114,
              thickness: 1.114,
              color: Color(0xFFF3F4F6),
            ),
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
