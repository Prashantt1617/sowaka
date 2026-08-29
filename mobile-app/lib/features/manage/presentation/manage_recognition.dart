part of '../../manager/presentation/manager_screen.dart';

class _AwardCard extends StatelessWidget {
  const _AwardCard({
    required this.award,
    required this.team,
    required this.onNominate,
  });

  final AwardNomination award;
  final List<TeamMember> team;
  final VoidCallback onNominate;

  @override
  Widget build(BuildContext context) {
    final palette = awardPalette(award.key);
    final nominee = award.nomineeId == null
        ? null
        : team.where((item) => item.id == award.nomineeId).firstOrNull;
    return PressableCard(
      padding: const EdgeInsets.all(13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconBox(
            icon: awardIcon(award.icon),
            color: palette.$1,
            tint: palette.$2,
            size: 40,
          ),
          const Spacer(),
          Text(
            award.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: MColors.ink,
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            nominee?.name ?? award.subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: nominee == null ? MColors.inkSoft : palette.$1,
              fontSize: 12.2,
              height: 1.25,
              fontWeight: nominee == null ? FontWeight.w500 : FontWeight.w800,
            ),
          ),
          const SizedBox(height: 9),
          Semantics(
            button: true,
            label: nominee == null
                ? 'Nominate someone for ${award.title}'
                : 'Change nomination for ${award.title}',
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: onNominate,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: nominee == null
                      ? Text(
                          '+ Nominate',
                          style: TextStyle(
                            color: palette.$1,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w800,
                          ),
                        )
                      : Row(
                          children: [
                            Icon(
                              Icons.check_circle_rounded,
                              size: 14,
                              color: palette.$1,
                            ),
                            const SizedBox(width: 5),
                            Flexible(
                              child: Text(
                                'Submitted',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: palette.$1,
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            const Flexible(
                              child: Text(
                                '  · Change',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: MColors.inkSoft,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AwardPicker extends StatefulWidget {
  const _AwardPicker({required this.state, required this.bloc});

  final ManagerState state;
  final ManagerBloc bloc;

  @override
  State<_AwardPicker> createState() => _AwardPickerState();
}

class _AwardPickerState extends State<_AwardPicker> {
  TeamMember? _selected;
  final TextEditingController _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _close() => widget.bloc.add(const CloseAwardPicker());

  @override
  Widget build(BuildContext context) {
    final data = widget.state.dashboard!;
    final award = data.awards.firstWhere(
      (item) => item.key == widget.state.awardPickerKey,
    );
    final selected = _selected;
    return Positioned.fill(
      child: GestureDetector(
        onTap: _close,
        child: Container(
          color: MColors.ink.withValues(alpha: .44),
          alignment: Alignment.bottomCenter,
          child: GestureDetector(
            onTap: () {},
            child: SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(context).viewInsets.bottom,
                ),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(18, 10, 18, 24),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Center(
                        child: Container(
                          width: 38,
                          height: 4,
                          decoration: BoxDecoration(
                            color: MColors.line,
                            borderRadius: BorderRadius.circular(99),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (selected != null)
                            GestureDetector(
                              onTap: () => setState(() => _selected = null),
                              child: const Padding(
                                padding: EdgeInsets.only(right: 10, top: 2),
                                child: Icon(
                                  Icons.chevron_left_rounded,
                                  color: MColors.ink,
                                ),
                              ),
                            ),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  award.title,
                                  style: const TextStyle(
                                    color: MColors.ink,
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  selected == null
                                      ? 'Choose one teammate for this recognition.'
                                      : 'Why are you nominating them?',
                                  style: const TextStyle(
                                    color: MColors.inkSoft,
                                    fontSize: 13.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      if (selected == null)
                        _pickList(data, award)
                      else
                        _reasonStep(award, selected),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _pickList(ManagerDashboard data, AwardNomination award) {
    if (data.recognitionCandidates.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 26),
        child: Text(
          'You have no direct reports to nominate yet.',
          style: TextStyle(color: MColors.inkSoft, fontSize: 13.5),
        ),
      );
    }
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 360),
      child: ListView.separated(
        shrinkWrap: true,
        itemCount: data.recognitionCandidates.length,
        separatorBuilder: (context, index) =>
            const Divider(height: 1, color: MColors.line),
        itemBuilder: (context, index) {
          final member = data.recognitionCandidates[index];
          return ListTile(
            contentPadding: EdgeInsets.zero,
            leading: AvatarBadge(
              initial: member.initial,
              index: member.avatarIndex,
              size: 38,
            ),
            title: Text(
              member.name,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: MColors.ink,
              ),
            ),
            subtitle: Text(member.team),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => setState(() => _selected = member),
          );
        },
      ),
    );
  }

  Widget _reasonStep(AwardNomination award, TeamMember member) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: MColors.bg,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              AvatarBadge(
                initial: member.initial,
                index: member.avatarIndex,
                size: 40,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        color: MColors.ink,
                        fontSize: 15,
                      ),
                    ),
                    Text(
                      member.team,
                      style: const TextStyle(
                        color: MColors.inkSoft,
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _reason,
          autofocus: true,
          maxLines: 3,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText:
                'What did ${member.name.split(' ').first} do to deserve this?',
            filled: true,
            fillColor: MColors.bg,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _reason.text.trim().isEmpty
                ? null
                : () => widget.bloc.add(
                    NominateAward(award.key, member.id, _reason.text.trim()),
                  ),
            style: FilledButton.styleFrom(
              backgroundColor: MColors.ink,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            child: const Text(
              'Submit nomination',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
            ),
          ),
        ),
      ],
    );
  }
}

const Map<String, String> _awardTitles = {
  'artist': 'Best Artist',
  'mentor': 'Best Mentor',
  'culture': 'Culture Champion',
  'rising': 'Rising Star',
};

void _showPastNominations(BuildContext context, List<Nomination> history) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.white,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (context) => SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: MColors.line,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Past nominations',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: MColors.ink,
              ),
            ),
            const SizedBox(height: 14),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: history.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, i) {
                  final n = history[i];
                  return Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: MColors.bg,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                n.employeeName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                  color: MColors.ink,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(99),
                                border: Border.all(color: MColors.line),
                              ),
                              child: Text(
                                _awardTitles[n.category] ?? n.category,
                                style: const TextStyle(
                                  color: MColors.inkSoft,
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (n.reason.isNotEmpty) ...[
                          const SizedBox(height: 7),
                          Text(
                            n.reason,
                            style: const TextStyle(
                              color: MColors.inkSoft,
                              fontSize: 13,
                              height: 1.45,
                            ),
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
