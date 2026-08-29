part of '../../manager/presentation/manager_screen.dart';

class _ManageContent extends StatelessWidget {
  const _ManageContent({
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
  Widget build(BuildContext context) {
    return switch (state.view) {
      ManagerView.home => _TeamHome(
        state: state,
        bloc: bloc,
        onOpenProfile: onOpenProfile,
        onNotifications: onNotifications,
      ),
      ManagerView.feedbackList => _FeedbackList(state: state, bloc: bloc),
      ManagerView.leaveRequests => _RequestList(
        state: state,
        bloc: bloc,
        type: _RequestType.leave,
      ),
      ManagerView.overtimeRequests => _RequestList(
        state: state,
        bloc: bloc,
        type: _RequestType.overtime,
      ),
      ManagerView.attendanceCorrections => _RequestList(
        state: state,
        bloc: bloc,
        type: _RequestType.attendance,
      ),
    };
  }
}

class _FeedbackList extends StatelessWidget {
  const _FeedbackList({required this.state, required this.bloc});

  final ManagerState state;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) {
    final data = state.dashboard!;
    final open = data.team
        .where((item) => item.status != FeedbackStatus.sent)
        .toList();
    final completed = data.team
        .where((item) => item.status == FeedbackStatus.sent)
        .toList();
    int urgency(TeamMember member) {
      if (member.missedMonths > 0 || member.status == FeedbackStatus.missed) {
        return 0;
      }
      final days = _daysUntil(data.today, member.next);
      return days >= 0 && days <= 4 ? 1 : 2;
    }

    int sortByUrgency(TeamMember a, TeamMember b) {
      final byGroup = urgency(a).compareTo(urgency(b));
      return byGroup != 0 ? byGroup : a.next.compareTo(b.next);
    }

    final pending = open..sort(sortByUrgency);
    final done = completed..sort((a, b) => b.next.compareTo(a.next));
    final query = state.searchQuery.trim().toLowerCase();
    final visible =
        data.team.where((item) {
          final matches =
              query.isEmpty ||
              item.name.toLowerCase().contains(query) ||
              item.team.toLowerCase().contains(query);
          if (!matches) return false;
          return switch (state.feedbackFilter) {
            FeedbackFilter.all => true,
            FeedbackFilter.pending => item.status != FeedbackStatus.sent,
            FeedbackFilter.done => item.status == FeedbackStatus.sent,
          };
        }).toList()..sort((a, b) {
          if (a.status == FeedbackStatus.sent &&
              b.status != FeedbackStatus.sent) {
            return 1;
          }
          if (a.status != FeedbackStatus.sent &&
              b.status == FeedbackStatus.sent) {
            return -1;
          }
          return a.status == FeedbackStatus.sent
              ? b.next.compareTo(a.next)
              : sortByUrgency(a, b);
        });
    final grouped = state.feedbackFilter == FeedbackFilter.all && query.isEmpty;
    final progress = data.team.isEmpty
        ? 0.0
        : completed.length / data.team.length;

    return Column(
      key: const ValueKey('feedback-list'),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(20, 54, 20, 10),
          child: Column(
            children: [
              Row(
                children: [
                  RoundIconButton(
                    icon: Icons.chevron_left_rounded,
                    onTap: () => bloc.add(const CloseFeedbackList()),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${_monthName(data.today.month)} · for you to action',
                          style: const TextStyle(
                            color: MColors.inkSoft,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        const Text(
                          'Monthly Check-ins',
                          style: TextStyle(
                            color: MColors.ink,
                            fontSize: 27,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  AvatarBadge(initial: data.managerInitial, index: 1, size: 42),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _FeedbackStat(
                      value: open.length,
                      label: 'feedback to give',
                      color: MColors.terra,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _FeedbackStat(
                      value: done.length,
                      label: 'done',
                      color: MColors.sageDeep,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 36),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Feedback',
                      style: TextStyle(
                        color: MColors.ink,
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      '${completed.length} of ${data.team.length} given',
                      style: const TextStyle(
                        color: MColors.inkSoft,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 8,
                  color: MColors.terra,
                  backgroundColor: MColors.line,
                ),
              ),
              const SizedBox(height: 14),
              _FeedbackSearchField(
                query: state.searchQuery,
                onChanged: (value) => bloc.add(ChangeFeedbackSearch(value)),
                onClear: () => bloc.add(const ChangeFeedbackSearch('')),
              ),
              const SizedBox(height: 12),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _FeedbackFilterChip(
                      label: 'All',
                      count: data.team.length,
                      selected: state.feedbackFilter == FeedbackFilter.all,
                      onTap: () => bloc.add(
                        const ChangeFeedbackFilter(FeedbackFilter.all),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _FeedbackFilterChip(
                      label: 'Pending',
                      count: pending.length,
                      dot: MColors.gold,
                      selected: state.feedbackFilter == FeedbackFilter.pending,
                      onTap: () => bloc.add(
                        const ChangeFeedbackFilter(FeedbackFilter.pending),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _FeedbackFilterChip(
                      label: 'Done',
                      count: done.length,
                      dot: MColors.sageDeep,
                      selected: state.feedbackFilter == FeedbackFilter.done,
                      onTap: () => bloc.add(
                        const ChangeFeedbackFilter(FeedbackFilter.done),
                      ),
                    ),
                  ],
                ),
              ),
              if (visible.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(
                    child: Text(
                      'Nothing here — nicely done.',
                      style: TextStyle(color: MColors.inkFaint),
                    ),
                  ),
                )
              else if (grouped) ...[
                if (pending.isNotEmpty) ...[
                  const _FeedbackGroupHeader(
                    label: 'Pending',
                    color: MColors.gold,
                  ),
                  _FeedbackRows(
                    members: pending,
                    today: data.today,
                    bloc: bloc,
                  ),
                ],
                if (done.isNotEmpty) ...[
                  const _FeedbackGroupHeader(
                    label: 'Done',
                    color: MColors.sageDeep,
                  ),
                  _GivenFeedbackRows(members: done, bloc: bloc),
                ],
              ] else if (state.feedbackFilter == FeedbackFilter.done)
                _GivenFeedbackRows(members: visible, bloc: bloc)
              else if (state.feedbackFilter == FeedbackFilter.all) ...[
                if (visible.any((item) => item.status != FeedbackStatus.sent))
                  _FeedbackRows(
                    members: visible
                        .where((item) => item.status != FeedbackStatus.sent)
                        .toList(),
                    today: data.today,
                    bloc: bloc,
                  ),
                if (visible.any(
                  (item) => item.status == FeedbackStatus.sent,
                )) ...[
                  const SizedBox(height: 10),
                  _GivenFeedbackRows(
                    members: visible
                        .where((item) => item.status == FeedbackStatus.sent)
                        .toList(),
                    bloc: bloc,
                  ),
                ],
              ] else
                _FeedbackRows(members: visible, today: data.today, bloc: bloc),
            ],
          ),
        ),
      ],
    );
  }
}

class _FeedbackStat extends StatelessWidget {
  const _FeedbackStat({
    required this.value,
    required this.label,
    required this.color,
  });
  final int value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(15),
      border: Border.all(color: const Color(0xFFF0E8DD)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$value',
          style: TextStyle(
            color: color,
            fontSize: 23,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 1),
        Text(
          label,
          style: const TextStyle(
            color: MColors.inkSoft,
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _FeedbackSearchField extends StatefulWidget {
  const _FeedbackSearchField({
    required this.query,
    required this.onChanged,
    required this.onClear,
    this.hint = 'Find a teammate',
  });

  final String query;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;
  final String hint;

  @override
  State<_FeedbackSearchField> createState() => _FeedbackSearchFieldState();
}

class _FeedbackSearchFieldState extends State<_FeedbackSearchField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.query);
  }

  @override
  void didUpdateWidget(covariant _FeedbackSearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.query != _controller.text) {
      _controller.value = TextEditingValue(
        text: widget.query,
        selection: TextSelection.collapsed(offset: widget.query.length),
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: _controller,
    onChanged: widget.onChanged,
    decoration: InputDecoration(
      hintText: widget.hint,
      prefixIcon: const Icon(Icons.search_rounded, size: 20),
      suffixIcon: widget.query.isEmpty
          ? null
          : IconButton(
              onPressed: widget.onClear,
              icon: const Icon(Icons.close_rounded, size: 18),
            ),
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(13),
        borderSide: const BorderSide(color: MColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(13),
        borderSide: const BorderSide(color: MColors.terra),
      ),
    ),
  );
}

class _FeedbackFilterChip extends StatelessWidget {
  const _FeedbackFilterChip({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
    this.dot,
  });
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  final Color? dot;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(99),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
      decoration: BoxDecoration(
        color: selected ? MColors.ink : Colors.white,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: selected ? MColors.ink : MColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot != null) ...[
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : MColors.inkSoft,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '$count',
            style: TextStyle(
              color: selected ? Colors.white70 : MColors.inkFaint,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    ),
  );
}

class _FeedbackGroupHeader extends StatelessWidget {
  const _FeedbackGroupHeader({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(6, 18, 6, 8),
    child: Row(
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            color: MColors.inkSoft,
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            letterSpacing: .6,
          ),
        ),
      ],
    ),
  );
}

class _FeedbackRows extends StatelessWidget {
  const _FeedbackRows({
    required this.members,
    required this.today,
    required this.bloc,
  });
  final List<TeamMember> members;
  final DateTime today;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFF0E8DD)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0D462D1C),
          blurRadius: 26,
          offset: Offset(0, 12),
        ),
      ],
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: members.indexed.map((entry) {
        final member = entry.$2;
        final overdue =
            member.missedMonths > 0 || member.status == FeedbackStatus.missed;
        final days = _daysUntil(today, member.next);
        final due = overdue
            ? 'Missed ${member.missedMonths == 0 ? 1 : member.missedMonths}mo'
            : days == 0
            ? 'Due today'
            : days == 1
            ? 'Due tomorrow'
            : days > 1 && days <= 4
            ? 'Due in ${days}d'
            : null;
        return InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) =>
                  _FeedbackFormPage(bloc: bloc, memberId: member.id),
            ),
          ),
          child: Container(
            color: overdue ? const Color(0xFFFBF2E8) : Colors.transparent,
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
            decoration: entry.$1 == 0
                ? null
                : const BoxDecoration(
                    border: Border(top: BorderSide(color: Color(0xFFF4ECE0))),
                  ),
            child: Row(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: const Color(0xFFD2C6B4),
                      width: 2,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                AvatarBadge(
                  initial: member.initial,
                  index: member.avatarIndex,
                  size: 34,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        member.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: MColors.ink,
                          fontSize: 15.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(text: member.team),
                            if (due != null)
                              TextSpan(
                                text: ' · $due',
                                style: TextStyle(
                                  color: overdue ? MColors.live : MColors.gold,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                          ],
                        ),
                        style: const TextStyle(
                          color: MColors.inkSoft,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                SvgPicture.asset(
                  'assets/icons/chevron_right_expand.svg',
                  width: 19,
                  height: 19,
                  colorFilter: const ColorFilter.mode(
                    Color(0xFFC9BDAC),
                    BlendMode.srcIn,
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    ),
  );
}

class _GivenFeedbackRows extends StatelessWidget {
  const _GivenFeedbackRows({required this.members, required this.bloc});
  final List<TeamMember> members;
  final ManagerBloc bloc;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFFF0E8DD)),
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: members.indexed.map((entry) {
        final member = entry.$2;
        return InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) =>
                  _FeedbackFormPage(bloc: bloc, memberId: member.id),
            ),
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
            decoration: entry.$1 == 0
                ? null
                : const BoxDecoration(
                    border: Border(top: BorderSide(color: Color(0xFFF4ECE0))),
                  ),
            child: Row(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    color: MColors.sageDeep,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    size: 13,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 12),
                Opacity(
                  opacity: .55,
                  child: AvatarBadge(
                    initial: member.initial,
                    index: member.avatarIndex,
                    size: 32,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    member.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: MColors.inkFaint,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
                ),
                Text(
                  member.score.toStringAsFixed(1),
                  style: TextStyle(
                    color: scoreColor(member.score),
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    ),
  );
}

// Kept for the legacy report-card layout used by older manager builds.
// ignore: unused_element
class _FeedbackAnchorBanner extends StatelessWidget {
  const _FeedbackAnchorBanner({required this.month, required this.sessions});

  final String month;
  final int sessions;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: MColors.terraTint,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          const IconBox(
            icon: Icons.edit_calendar_rounded,
            color: MColors.terra,
            tint: Colors.white,
            size: 44,
            iconSize: 23,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$month cycle · $sessions sessions allocated',
                  style: const TextStyle(
                    color: MColors.terraDeep,
                    fontSize: 14.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                const Text(
                  'Anchor: 5th · Auto-closes 35 days after if unsent',
                  style: TextStyle(
                    color: MColors.terraDeep,
                    fontSize: 13,
                    height: 1.3,
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

// ignore: unused_element
class _FeedbackSectionHead extends StatelessWidget {
  const _FeedbackSectionHead({
    required this.label,
    required this.count,
    required this.color,
  });

  final String label;
  final int count;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(
              color: color,
              fontSize: 13,
              fontWeight: FontWeight.w800,
              letterSpacing: .9,
            ),
          ),
          const SizedBox(width: 8),
          Container(
            constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Text(
              '$count',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ignore: unused_element
class _FeedbackReportCard extends StatelessWidget {
  const _FeedbackReportCard({
    required this.member,
    required this.today,
    required this.showDue,
    required this.onTap,
  });

  final TeamMember member;
  final DateTime today;
  final bool showDue;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final done = member.params.where((item) => item.score > 0).length;
    final total = member.params.length;
    final started = member.status != FeedbackStatus.pending || done > 0;
    final note = member.params
        .map((item) => item.note.trim())
        .firstWhere((item) => item.isNotEmpty, orElse: () => '');
    final (status, statusColor) = switch (member.status) {
      FeedbackStatus.pending => ('Not started', MColors.inkFaint),
      FeedbackStatus.saved => ('Ready to send', MColors.gold),
      FeedbackStatus.sent => ('Sent', MColors.sageDeep),
      FeedbackStatus.missed => ('Missed', MColors.live),
    };

    return PressableCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          AvatarBadge(
            initial: member.initial,
            index: member.avatarIndex,
            size: 54,
          ),
          const SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        member.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: MColors.ink,
                          fontSize: 17.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.2,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (showDue)
                      _FeedbackDueChip(today: today, date: member.next)
                    else
                      Text(
                        shortDate(member.next),
                        style: const TextStyle(
                          color: MColors.inkFaint,
                          fontSize: 12.5,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    if (showDue)
                      _FeedbackProgressMeter(done: done, total: total)
                    else
                      _FeedbackScoreRing(score: member.score),
                    const SizedBox(width: 10),
                    Flexible(
                      child: Text(
                        status,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 7),
                Text(
                  started
                      ? (note.isEmpty ? 'Scores recorded — add notes.' : note)
                      : 'Tap to start this month’s feedback',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: started ? MColors.inkSoft : MColors.inkFaint,
                    fontSize: 13.5,
                    height: 1.42,
                    fontStyle: started ? FontStyle.normal : FontStyle.italic,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          SvgPicture.asset(
            'assets/icons/chevron_right_expand.svg',
            width: 24,
            height: 24,
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

class _FeedbackDueChip extends StatelessWidget {
  const _FeedbackDueChip({required this.today, required this.date});

  final DateTime today;
  final DateTime date;

  @override
  Widget build(BuildContext context) {
    final days = _daysUntil(today, date);
    final urgent = days <= 7;
    final soon = days > 7 && days <= 14;
    final color = urgent
        ? MColors.live
        : soon
        ? MColors.gold
        : MColors.inkSoft;
    final tint = urgent
        ? const Color(0xFFFBE6E3)
        : soon
        ? MColors.goldTint
        : const Color(0xFFEFEAE2);
    final label = days < 0
        ? 'Closed'
        : days == 0
        ? 'Due today'
        : 'Due in ${days}d';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.schedule_rounded, size: 12, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedbackProgressMeter extends StatelessWidget {
  const _FeedbackProgressMeter({required this.done, required this.total});

  final int done;
  final int total;

  @override
  Widget build(BuildContext context) {
    final complete = total > 0 && done == total;
    final color = complete
        ? MColors.sageDeep
        : done == 0
        ? MColors.inkFaint
        : MColors.gold;
    final progress = total == 0 ? 0.0 : done / total;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 72,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              minHeight: 7,
              value: progress,
              color: color,
              backgroundColor: MColors.line,
            ),
          ),
        ),
        const SizedBox(width: 7),
        Text(
          '$done/$total scored',
          style: TextStyle(
            color: color,
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _FeedbackScoreRing extends StatelessWidget {
  const _FeedbackScoreRing({required this.score});

  final double score;

  @override
  Widget build(BuildContext context) {
    final color = scoreColor(score <= 0 ? 1 : score);
    return SizedBox(
      width: 44,
      height: 44,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: 38,
            height: 38,
            child: CircularProgressIndicator(
              value: (score / 5).clamp(0.0, 1.0),
              strokeWidth: 4,
              color: color,
              backgroundColor: MColors.line,
              strokeCap: StrokeCap.round,
            ),
          ),
          Text(
            score.toStringAsFixed(1),
            style: TextStyle(
              color: color,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecordFeedback extends StatefulWidget {
  const _RecordFeedback({
    required this.state,
    required this.bloc,
    this.onClose,
  });

  final ManagerState state;
  final ManagerBloc bloc;

  /// Set when the form is a pushed route (opened from Grow or a profile) so
  /// closing pops instead of resetting the Manage tab's view.
  final VoidCallback? onClose;

  @override
  State<_RecordFeedback> createState() => _RecordFeedbackState();
}

class _RecordFeedbackState extends State<_RecordFeedback> {
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _speechInitialized = false;
  String? _listeningField;

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _speech.cancel();
    super.dispose();
  }

  Future<void> _toggleSpeech({
    required String field,
    required String currentText,
    required ValueChanged<String> onText,
  }) async {
    if (_speech.isListening && _listeningField == field) {
      await _speech.stop();
      if (mounted) setState(() => _listeningField = null);
      return;
    }
    if (_speech.isListening) await _speech.cancel();

    final available = _speechInitialized
        ? true
        : await _speech.initialize(
            onStatus: (status) {
              if ((status == 'done' || status == 'notListening') && mounted) {
                setState(() => _listeningField = null);
              }
            },
            onError: (error) {
              if (!mounted) return;
              setState(() => _listeningField = null);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Voice input unavailable: ${error.errorMsg}'),
                  behavior: SnackBarBehavior.floating,
                  backgroundColor: MColors.ink,
                ),
              );
            },
          );
    _speechInitialized = available;
    if (!available) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Speech recognition is unavailable or microphone access was denied.',
          ),
          behavior: SnackBarBehavior.floating,
          backgroundColor: MColors.ink,
        ),
      );
      return;
    }

    final prefix = currentText.trim();
    if (mounted) setState(() => _listeningField = field);
    await _speech.listen(
      onResult: (result) {
        final words = result.recognizedWords.trim();
        if (words.isEmpty) return;
        onText(prefix.isEmpty ? words : '$prefix $words');
        if (result.finalResult && mounted) {
          setState(() => _listeningField = null);
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    final bloc = widget.bloc;
    final member = state.selectedMember;
    if (member == null) return const SizedBox.shrink();

    final locked =
        member.status == FeedbackStatus.sent ||
        member.status == FeedbackStatus.missed;
    final scored = state.recordParams.where((item) => item.score > 0);
    final complete = scored.length == state.recordParams.length;
    final overall = scored.isEmpty
        ? 0.0
        : scored.fold<double>(0, (sum, item) => sum + item.score) /
              state.recordParams.length;
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;

    return Column(
      children: [
        AppHomeHeader(
          profileAction: AvatarBadge(
            initial: member.initial,
            index: member.avatarIndex,
            size: 30,
          ),
          onNotifications: () {},
          onQuickCreate: () {},
        ),
        _GrowthPageTopBar(
          name: member.name,
          designation: _periodTitle(_EmployeeGrowthPage._currentPeriod()),
          onBack: widget.onClose,
        ),
        Expanded(
          child: state.recordParams.isEmpty
              ? const Center(
                  child: Text(
                    'No feedback parameters configured.',
                    style: TextStyle(color: MColors.inkSoft),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  children: [
                    _OverallScoreCard(
                      overall: overall,
                      previousScore: member.previousScore,
                    ),
                    const SizedBox(height: 12),
                    for (final (index, param) in state.recordParams.indexed)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _ParamCard(
                          key: ValueKey(
                            'feedback-param-${member.id}-${param.name}',
                          ),
                          param: param,
                          locked: locked,
                          listening: _listeningField == 'param-$index',
                          onScore: (value) =>
                              bloc.add(UpdateFeedbackScore(index, value)),
                          onNote: (value) =>
                              bloc.add(UpdateFeedbackNote(index, value)),
                          onVoice: () => _toggleSpeech(
                            field: 'param-$index',
                            currentText: param.note,
                            onText: (value) =>
                                bloc.add(UpdateFeedbackNote(index, value)),
                          ),
                        ),
                      ),
                  ],
                ),
        ),
        if (!locked && !keyboardOpen && state.recordParams.isNotEmpty)
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: MColors.line)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: ActionButton(
                      label: 'Save',
                      icon: Icons.save_outlined,
                      background: Colors.white,
                      foreground: MColors.ink,
                      border: MColors.line,
                      onTap: () => bloc.add(const SaveFeedback()),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: ActionButton(
                      label: 'Send to ${member.name.split(' ').first}',
                      icon: Icons.send_rounded,
                      background: complete ? MColors.terra : MColors.line,
                      foreground: complete ? Colors.white : MColors.inkFaint,
                      onTap: complete
                          ? () => _confirmSend(context, bloc, member)
                          : null,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  void _confirmSend(BuildContext context, ManagerBloc bloc, TeamMember member) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => _ConfirmSendSheet(
        member: member,
        onSend: () {
          Navigator.of(context).pop();
          bloc.add(const SendFeedback());
        },
      ),
    );
  }
}

/// Overall score header on the feedback form: the running average of the
/// parameter scores, plus how it moved against the previous review period.
class _OverallScoreCard extends StatelessWidget {
  const _OverallScoreCard({
    required this.overall,
    required this.previousScore,
    this.showAveragesNote = false,
  });

  final double overall;
  final double? previousScore;

  /// The growth timeline shows the explanatory line; the feedback form does not.
  final bool showAveragesNote;

  @override
  Widget build(BuildContext context) {
    final delta = (previousScore == null || overall <= 0)
        ? null
        : overall - previousScore!;
    final up = (delta ?? 0) >= 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: MColors.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'OVERALL SCORE',
                  style: TextStyle(
                    color: Color(0xFF6A7282),
                    fontSize: 11,
                    letterSpacing: .6,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      overall <= 0 ? '—' : overall.toStringAsFixed(1),
                      style: const TextStyle(
                        color: Color(0xFF101828),
                        fontSize: 44,
                        height: 1,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Padding(
                      padding: EdgeInsets.only(bottom: 6),
                      child: Text(
                        '/ 5',
                        style: TextStyle(
                          color: Color(0xFF6A7282),
                          fontSize: 18,
                          height: 1,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                if (showAveragesNote) ...[
                  const SizedBox(height: 8),
                  const Text(
                    'This score averages all the parameters below.',
                    style: TextStyle(
                      color: Color(0xFF6A7282),
                      fontSize: 13,
                      height: 1.4,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (delta != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: up ? const Color(0xFFF0FDF4) : const Color(0xFFFEF2F2),
                border: Border.all(
                  color: up ? const Color(0xFFBBF7D0) : const Color(0xFFFECACA),
                  width: 1.114,
                ),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '${up ? '+' : ''}${delta.toStringAsFixed(1)} pts',
                style: TextStyle(
                  color: up ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                  fontSize: 12.5,
                  height: 1.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
